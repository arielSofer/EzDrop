//
//  FirebaseProvisioner.swift
//  AgenticDesigner
//
//  Drives the locally installed firebase CLI so "connect a real backend"
//  stops being four manual console steps. Everything runs --non-interactive:
//  a CLI prompt inside a GUI app is a hang, so any state that would prompt
//  (not logged in, ToS not accepted) must surface as a clear instruction
//  instead.
//
//  What this CAN do end-to-end: create the Firebase project, register the
//  iOS app, pull its client config (the GoogleService-Info values), create
//  the Firestore database, deploy the generated security rules.
//  What it CANNOT do (and says so): `firebase login` (interactive OAuth in
//  a browser), enabling console sign-in methods (Admin API only), billing.
//

import Foundation

nonisolated enum FirebaseProvisioner {

    struct CLIError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    struct ProvisionResult {
        var projectId: String
        var appId: String = ""
        var apiKey: String = ""
        var messagingSenderId: String = ""
        var storageBucket: String = ""
        var steps: [String] = []
        var warnings: [String] = []
    }

    // MARK: - CLI discovery

    /// GUI apps launch with a minimal PATH, so the CLI is found by probing
    /// known install locations rather than trusting the environment.
    static func cliPath() -> String? {
        let candidates = [
            "/opt/homebrew/bin/firebase",
            "/usr/local/bin/firebase",
            (NSHomeDirectory() as NSString).appendingPathComponent(".local/bin/firebase"),
        ]
        return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    /// nil when logged in; otherwise the instruction to show the user.
    static func loginProblem() -> String? {
        guard let cli = cliPath() else {
            return "The firebase CLI is not installed. Install it with: brew install firebase-cli (or npm i -g firebase-tools), then run `firebase login` once in Terminal."
        }
        guard let output = try? run(cli, ["login:list"]) else {
            return "Could not run the firebase CLI at \(cli)."
        }
        if output.localizedCaseInsensitiveContains("No authorized accounts") {
            return "The firebase CLI is installed but not signed in. Run `firebase login` once in Terminal (it opens a browser), then call this tool again."
        }
        return nil
    }

    // MARK: - Provisioning chain

    /// Creates (or reuses) the project, registers the iOS app, and returns
    /// the client config ready to drop into FirebaseConfig.
    static func provision(
        projectId: String,
        displayName: String,
        bundleId: String
    ) throws -> ProvisionResult {
        guard let cli = cliPath() else { throw CLIError(message: "firebase CLI not found.") }
        var result = ProvisionResult(projectId: projectId)

        // 1 — Project. "Already exists" for OUR id is fine (idempotent
        // re-run); any other failure is real.
        do {
            _ = try run(cli, ["projects:create", projectId, "--display-name", displayName, "--non-interactive"])
            result.steps.append("Created Firebase project '\(projectId)'.")
        } catch {
            let text = (error as? CLIError)?.message ?? error.localizedDescription
            if text.localizedCaseInsensitiveContains("already exists")
                || text.localizedCaseInsensitiveContains("HTTP Error: 409") {
                // Reachable for us, or taken by someone else? Listing tells.
                let mine = (try? run(cli, ["projects:list"])) ?? ""
                if mine.contains(projectId) {
                    result.steps.append("Project '\(projectId)' already exists — reusing it.")
                } else {
                    throw CLIError(message: "Project id '\(projectId)' is taken by another account. Pick a different projectId (they are global across all of Firebase).")
                }
            } else {
                throw CLIError(message: "projects:create failed: \(text.prefix(600))")
            }
        }

        // 2 — iOS app registration (or reuse).
        var appId = ""
        do {
            let created = try run(cli, ["apps:create", "IOS", displayName, "--bundle-id", bundleId, "--project", projectId, "--non-interactive"])
            appId = firstMatch(in: created, pattern: #"App ID:\s*([0-9]+:[0-9]+:ios:[a-f0-9]+)"#) ?? ""
            result.steps.append("Registered iOS app (\(bundleId)).")
        } catch {
            // Perhaps it already exists — find it in the list.
            let list = (try? run(cli, ["apps:list", "IOS", "--project", projectId])) ?? ""
            appId = firstMatch(in: list, pattern: #"([0-9]+:[0-9]+:ios:[a-f0-9]+)"#) ?? ""
            if appId.isEmpty {
                let text = (error as? CLIError)?.message ?? error.localizedDescription
                throw CLIError(message: "apps:create failed and no existing iOS app found: \(text.prefix(600))")
            }
            result.steps.append("iOS app already registered — reusing it.")
        }
        result.appId = appId

        // 3 — Client config. sdkconfig prints the GoogleService-Info plist;
        // parse the real keys out of it rather than scraping lines.
        let configOutput = try run(cli, ["apps:sdkconfig", "IOS", appId, "--project", projectId, "--non-interactive"])
        guard let start = configOutput.range(of: "<?xml"),
              let end = configOutput.range(of: "</plist>") else {
            throw CLIError(message: "apps:sdkconfig returned no plist. Raw output: \(configOutput.prefix(400))")
        }
        let plistText = String(configOutput[start.lowerBound..<end.upperBound])
        guard let data = plistText.data(using: .utf8),
              let plist = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else {
            throw CLIError(message: "Could not parse the sdkconfig plist.")
        }
        result.apiKey = plist["API_KEY"] as? String ?? ""
        result.messagingSenderId = plist["GCM_SENDER_ID"] as? String ?? ""
        result.storageBucket = plist["STORAGE_BUCKET"] as? String ?? ""
        if let realAppId = plist["GOOGLE_APP_ID"] as? String { result.appId = realAppId }
        result.steps.append("Pulled the iOS client config (API key, sender id, bucket).")

        // 4 — Firestore database. New projects have none; rules deploy fails
        // without it. Failure here is a warning, not an error — the console
        // may require accepting terms once.
        do {
            _ = try run(cli, ["firestore:databases:create", "(default)", "--location", "nam5", "--project", projectId, "--non-interactive"])
            result.steps.append("Created the Firestore database (nam5).")
        } catch {
            let text = (error as? CLIError)?.message ?? error.localizedDescription
            if text.localizedCaseInsensitiveContains("already exists") {
                result.steps.append("Firestore database already exists.")
            } else {
                result.warnings.append("Could not create the Firestore database automatically (\(text.prefix(200))). Open the Firebase console once, create Firestore, then deploy_firestore_rules.")
            }
        }

        result.warnings.append("Sign-in methods must still be enabled once in the console (Authentication ▸ Sign-in method ▸ Email/Password) — the CLI has no command for it.")
        return result
    }

    /// Deploys firestore.rules from an export directory (which now ships
    /// firebase.json + .firebaserc, so the CLI knows what to deploy where).
    static func deployRules(exportDir: URL, projectId: String) throws -> String {
        guard let cli = cliPath() else { throw CLIError(message: "firebase CLI not found.") }
        guard FileManager.default.fileExists(atPath: exportDir.appendingPathComponent("firebase.json").path) else {
            throw CLIError(message: "No firebase.json at \(exportDir.path) — re-export first (exports now include it next to firestore.rules).")
        }
        return try run(
            cli,
            ["deploy", "--only", "firestore:rules", "--project", projectId, "--non-interactive"],
            currentDirectory: exportDir
        )
    }

    // MARK: - Plumbing

    private static func firstMatch(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        guard let match = regex.firstMatch(in: text, range: range), match.numberOfRanges > 1,
              let captured = Range(match.range(at: match.numberOfRanges - 1), in: text) else { return nil }
        return String(text[captured])
    }

    @discardableResult
    private static func run(
        _ executable: String,
        _ arguments: [String],
        currentDirectory: URL? = nil
    ) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let currentDirectory { process.currentDirectoryURL = currentDirectory }
        // The CLI is a node script: it needs its own bin dir on PATH (for
        // `node`) even though we invoke it by absolute path.
        var environment = ProcessInfo.processInfo.environment
        let extraPaths = "/opt/homebrew/bin:/usr/local/bin"
        environment["PATH"] = extraPaths + ":" + (environment["PATH"] ?? "/usr/bin:/bin")
        process.environment = environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw CLIError(message: output.isEmpty ? "\(executable) exited \(process.terminationStatus)" : output)
        }
        return output
    }
}
