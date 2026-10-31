//
//  GitSyncService.swift
//  AgenticDesigner
//
//  "Your app, in your repo" — a real git repository per project. When sync is
//  enabled, every checkpoint (the same snapshots CheckpointStore already takes
//  before agent runs, themes, templates and edits) is also committed to a local
//  git repo, and exports are mirrored into it — so the design file AND the
//  generated source get true history, branching and a push-to-GitHub path.
//
//  The repo lives in Application Support/AgenticDesigner/GitRepos/<project>/:
//      project.agenticdesign   — pretty-printed, sorted keys → meaningful diffs
//      Exports/Xcode/          — mirror of the last export_xcode_project
//      Exports/SwiftPM/        — mirror of the last export_ios_source
//
//  Plumbing is /usr/bin/git (ships with the Xcode CLT this app already needs);
//  publishing uses the GitHub CLI (`gh`) when present.
//

import Foundation

enum GitSyncError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let text) = self { return text }
        return nil
    }
}

enum GitSyncService {

    private static let gitPath = "/usr/bin/git"

    /// Serial queue so auto-commits never block the canvas and never interleave.
    private static let queue = DispatchQueue(label: "com.agentic.gitsync", qos: .utility)

    // MARK: - Locations & state

    private static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("AgenticDesigner/GitRepos", isDirectory: true)
    }

    private static func safeName(_ projectName: String) -> String {
        let safe = projectName
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        return safe.isEmpty ? "Untitled" : safe
    }

    static func repoDirectory(projectName: String) -> URL {
        root.appendingPathComponent(safeName(projectName), isDirectory: true)
    }

    private static func enabledKey(_ projectName: String) -> String {
        "gitSync.enabled.\(safeName(projectName))"
    }

    static var isGitAvailable: Bool {
        FileManager.default.isExecutableFile(atPath: gitPath)
    }

    static func isEnabled(projectName: String) -> Bool {
        UserDefaults.standard.bool(forKey: enabledKey(projectName))
            && FileManager.default.fileExists(
                atPath: repoDirectory(projectName: projectName).appendingPathComponent(".git").path
            )
    }

    // MARK: - Enable / disable

    /// Creates the repo (idempotent), writes the current project into it and
    /// makes the initial commit. Returns the repo directory.
    @discardableResult
    static func enable(project: DesignProject) throws -> URL {
        guard isGitAvailable else {
            throw GitSyncError.message("git not found at \(gitPath) — install the Xcode Command Line Tools.")
        }
        let repo = repoDirectory(projectName: project.name)
        try FileManager.default.createDirectory(at: repo, withIntermediateDirectories: true)

        if !FileManager.default.fileExists(atPath: repo.appendingPathComponent(".git").path) {
            try runGit(repo, ["init", "-b", "main"])
        }
        // Commits fail without an identity; give the repo a local one only if
        // the user has none configured globally.
        if ((try? runGit(repo, ["config", "user.email"])) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            try runGit(repo, ["config", "user.name", "AgenticDesigner"])
            try runGit(repo, ["config", "user.email", "agenticdesigner@localhost"])
        }

        let gitignore = repo.appendingPathComponent(".gitignore")
        if !FileManager.default.fileExists(atPath: gitignore.path) {
            try """
            .DS_Store
            xcuserdata/
            DerivedData/
            build/
            """.write(to: gitignore, atomically: true, encoding: .utf8)
        }
        let readme = repo.appendingPathComponent("README.md")
        if !FileManager.default.fileExists(atPath: readme.path) {
            try """
            # \(project.name)

            Built with AgenticDesigner. `project.agenticdesign` is the design + logic \
            document; `Exports/` holds the generated source (Xcode project / SwiftPM).
            """.write(to: readme, atomically: true, encoding: .utf8)
        }

        try writeProjectFile(project, into: repo)
        try commitIfDirty(repo, message: "Enable git sync")
        UserDefaults.standard.set(true, forKey: enabledKey(project.name))
        return repo
    }

    static func disable(projectName: String) {
        UserDefaults.standard.set(false, forKey: enabledKey(projectName))
    }

    // MARK: - Auto-commit (called by CheckpointStore on every snapshot)

    /// Fire-and-forget: mirrors the project into the repo and commits, on a
    /// background queue. Never throws — a git hiccup must not break a design edit.
    static func recordCheckpoint(project: DesignProject, label: String) {
        guard isEnabled(projectName: project.name) else { return }
        let repo = repoDirectory(projectName: project.name)
        queue.async {
            do {
                try writeProjectFile(project, into: repo)
                try commitIfDirty(repo, message: "checkpoint: \(label)")
            } catch {
                print("⚠️ Git sync commit failed: \(error.localizedDescription)")
            }
        }
    }

    // MARK: - Export mirroring

    /// Copies an export into <repo>/Exports/<kind>/ and commits it. Synchronous
    /// (source trees are small); returns a one-line note for the tool result,
    /// or nil when sync is off. Export failures here never fail the export itself.
    static func syncExport(projectName: String, kind: String, from source: URL) -> String? {
        guard isEnabled(projectName: projectName) else { return nil }
        let repo = repoDirectory(projectName: projectName)
        // An export written into the repo itself needs no mirror — just commit it.
        let insideRepo = source.standardizedFileURL.path.hasPrefix(repo.standardizedFileURL.path)
        do {
            if !insideRepo {
                let destination = repo
                    .appendingPathComponent("Exports", isDirectory: true)
                    .appendingPathComponent(kind, isDirectory: true)
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                try FileManager.default.createDirectory(
                    at: destination.deletingLastPathComponent(), withIntermediateDirectories: true
                )
                try FileManager.default.copyItem(at: source, to: destination)
            }
            try queue.sync {
                try commitIfDirty(repo, message: "export: \(kind)")
            }
            return "Git: export committed to \(repo.path)"
        } catch {
            return "Git: export commit failed — \(error.localizedDescription)"
        }
    }

    // MARK: - Manual commit / status / push

    @discardableResult
    static func commitNow(project: DesignProject, message: String?) throws -> String {
        guard isEnabled(projectName: project.name) else {
            throw GitSyncError.message("Git sync is not enabled for this project — enable it first.")
        }
        let repo = repoDirectory(projectName: project.name)
        return try queue.sync {
            try writeProjectFile(project, into: repo)
            let trimmed = message?.trimmingCharacters(in: .whitespacesAndNewlines)
            let committed = try commitIfDirty(
                repo, message: (trimmed?.isEmpty == false ? trimmed! : "manual commit")
            )
            return committed ? "Committed." : "Nothing to commit — repo already up to date."
        }
    }

    static func status(projectName: String) throws -> String {
        guard isEnabled(projectName: projectName) else {
            return "Git sync: OFF. enable_git_sync starts a local repo with full history for this project."
        }
        let repo = repoDirectory(projectName: projectName)
        let branch = (try? runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"]))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "main"
        let count = (try? runGit(repo, ["rev-list", "--count", "HEAD"]))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "0"
        let dirty = ((try? runGit(repo, ["status", "--porcelain"])) ?? "")
            .split(separator: "\n").count
        let remote = remoteURL(projectName: projectName)
        let log = (try? runGit(repo, ["log", "--oneline", "-5"]))?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? "(no commits yet)"
        return """
        Git sync: ON — \(repo.path)
        Branch: \(branch) · \(count) commit(s) · \(dirty) uncommitted change(s)
        Remote: \(remote ?? "none — push_to_github publishes this repo")
        Recent commits:
        \(log)
        """
    }

    static func remoteURL(projectName: String) -> String? {
        let repo = repoDirectory(projectName: projectName)
        let url = (try? runGit(repo, ["remote", "get-url", "origin"]))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return (url?.isEmpty == false) ? url : nil
    }

    /// Publishes the repo. With an existing `origin` it just pushes; otherwise it
    /// creates the GitHub repo via the `gh` CLI (which must be installed + authed).
    static func push(project: DesignProject, repoName: String?, isPrivate: Bool) throws -> String {
        guard isEnabled(projectName: project.name) else {
            throw GitSyncError.message("Git sync is not enabled for this project — enable it first.")
        }
        let repo = repoDirectory(projectName: project.name)
        // Never push a stale tree: capture the current project state first.
        try queue.sync {
            try writeProjectFile(project, into: repo)
            try commitIfDirty(repo, message: "pre-push snapshot")
        }
        guard (try? runGit(repo, ["rev-parse", "HEAD"])) != nil else {
            throw GitSyncError.message("Repo has no commits yet — commit before pushing.")
        }

        if let existing = remoteURL(projectName: project.name) {
            try runGit(repo, ["push", "-u", "origin", "HEAD"])
            return "Pushed to \(existing)"
        }

        guard let gh = ghPath else {
            throw GitSyncError.message(
                "No 'origin' remote and the GitHub CLI (gh) is not installed. Either " +
                "`brew install gh && gh auth login`, or add a remote manually: " +
                "git -C \"\(repo.path)\" remote add origin <url> && git push -u origin main"
            )
        }
        let name = normalizedRepoName(repoName ?? project.name)
        let output = try run(gh, [
            "repo", "create", name,
            isPrivate ? "--private" : "--public",
            "--source", repo.path,
            "--push"
        ], workingDirectory: repo)
        let created = remoteURL(projectName: project.name) ?? name
        return "Created GitHub repo and pushed: \(created)\n\(output.trimmingCharacters(in: .whitespacesAndNewlines))"
    }

    // MARK: - Internals

    private static func writeProjectFile(_ project: DesignProject, into repo: URL) throws {
        let encoder = JSONEncoder()
        // Pretty + sorted keys → line-stable JSON, so git diffs show the actual change.
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(project)
        try data.write(to: repo.appendingPathComponent("project.agenticdesign"), options: [.atomic])
    }

    /// Stages everything and commits only when the tree actually changed.
    @discardableResult
    private static func commitIfDirty(_ repo: URL, message: String) throws -> Bool {
        try runGit(repo, ["add", "-A"])
        let porcelain = try runGit(repo, ["status", "--porcelain"])
        guard !porcelain.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        try runGit(repo, ["commit", "-m", message])
        return true
    }

    private static var ghPath: String? {
        ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "/usr/bin/gh"]
            .first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    private static func normalizedRepoName(_ name: String) -> String {
        let lowered = name.lowercased()
        let mapped = lowered.map { character -> Character in
            (character.isLetter || character.isNumber || character == "-" || character == "_" || character == ".")
                ? character : "-"
        }
        let collapsed = String(mapped)
            .replacingOccurrences(of: "--+", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-."))
        return collapsed.isEmpty ? "agentic-app" : collapsed
    }

    @discardableResult
    private static func runGit(_ repo: URL, _ arguments: [String]) throws -> String {
        try run(gitPath, ["-C", repo.path] + arguments)
    }

    @discardableResult
    private static func run(_ executable: String, _ arguments: [String], workingDirectory: URL? = nil) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let workingDirectory {
            process.currentDirectoryURL = workingDirectory
        }
        // GUI apps inherit a minimal PATH; gh shells out to git and expects both.
        var environment = ProcessInfo.processInfo.environment
        let path = environment["PATH"] ?? ""
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + path
        process.environment = environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw GitSyncError.message(
                "\(URL(fileURLWithPath: executable).lastPathComponent) \(arguments.first ?? "") failed: \(output.trimmingCharacters(in: .whitespacesAndNewlines))"
            )
        }
        return output
    }
}
