//
//  ChatGPTSubscriptionService.swift
//  AgenticDesigner
//
//  "Connect my ChatGPT subscription" — done the only way that is actually
//  legitimate.
//
//  THERE IS NO OAUTH that lets a third-party app authenticate a ChatGPT
//  subscription and call models with it: the ChatGPT plan and the API platform
//  are separate products with separate billing. Anything that appears to offer
//  it is lifting a browser session token, which violates OpenAI's terms and
//  gets the user's account banned. This app will not do that.
//
//  What IS sanctioned: OpenAI's own Codex CLI has a first-party "sign in with
//  ChatGPT" flow, and Codex speaks MCP. So the user signs in through OpenAI's
//  own browser flow, and we drive the CLI they already authenticated, pointed
//  at this app's MCP server. Credentials never pass through this app — we only
//  ever ask the CLI whether it is logged in.
//

import Foundation
import Combine

@MainActor
final class ChatGPTSubscriptionService: ObservableObject {

    enum Status: Equatable {
        case notInstalled
        case signedOut
        case ready(account: String)

        var isReady: Bool { if case .ready = self { return true }; return false }
    }

    @Published private(set) var status: Status = .notInstalled
    @Published private(set) var isBusy = false
    @Published private(set) var transcript: [String] = []

    private var runningProcess: Process?

    /// Homebrew and npm global installs; PATH is minimal inside a GUI app.
    private static let candidatePaths = [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        "/usr/bin/codex"
    ]

    static var codexPath: String? {
        candidatePaths.first { FileManager.default.isExecutableFile(atPath: $0) }
    }

    var installHint: String {
        "brew install codex   (or: npm i -g @openai/codex)"
    }

    // MARK: - Status

    func refreshStatus() async {
        guard let path = Self.codexPath else {
            status = .notInstalled
            return
        }
        let result = await Self.run(path, ["login", "status"], timeout: 20)
        let output = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
        // "Logged in using ChatGPT" / "Logged in using an API key" / "Not logged in"
        if result.status == 0, output.lowercased().contains("logged in") {
            status = .ready(account: output)
        } else {
            status = .signedOut
        }
    }

    /// Runs OpenAI's own login flow — it opens a browser and handles the whole
    /// exchange. We never see a token; we just poll the CLI afterwards.
    func signIn() async {
        guard let path = Self.codexPath else { return }
        isBusy = true
        defer { isBusy = false }
        _ = await Self.run(path, ["login"], timeout: 300)
        await refreshStatus()
    }

    // MARK: - Wiring this app's tools into Codex

    /// Registers this app's MCP server with Codex (idempotent). After this,
    /// Codex can drive every design/logic/export tool the app exposes.
    @discardableResult
    func ensureMCPServerRegistered(port: UInt16) async -> Bool {
        guard let path = Self.codexPath else { return false }
        let url = "http://127.0.0.1:\(port)/mcp"
        let existing = await Self.run(path, ["mcp", "list"], timeout: 30)
        if existing.output.contains(url) { return true }
        let added = await Self.run(path, ["mcp", "add", "agenticdesigner", "--url", url], timeout: 30)
        return added.status == 0
    }

    // MARK: - Running a goal on the subscription

    /// Streams `codex exec`, which runs on the user's ChatGPT plan rather than
    /// per-token API billing — so there is no credit ceiling to hit.
    ///
    /// `--sandbox danger-full-access` is required, not casual: Codex's default
    /// sandbox blocks network, including loopback, so the MCP call to this app
    /// never arrives (it surfaces as "user cancelled MCP tool call"). Approvals
    /// are deliberately NOT bypassed — shell commands still go through Codex's
    /// own approval policy.
    func run(goal: String, workingDirectory: URL) async {
        guard let path = Self.codexPath, status.isReady else { return }
        isBusy = true
        transcript = []
        defer { isBusy = false; runningProcess = nil }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: path)
        process.arguments = [
            "exec",
            "--sandbox", "danger-full-access",
            "--skip-git-repo-check",
            "-C", workingDirectory.path,
            goal
        ]
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
        process.environment = environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        runningProcess = process

        do {
            try process.run()
        } catch {
            transcript.append("Failed to start Codex: \(error.localizedDescription)")
            return
        }

        // Stream lines as they arrive so the panel shows progress live.
        let handle = pipe.fileHandleForReading
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            handle.readabilityHandler = { [weak self] fileHandle in
                let data = fileHandle.availableData
                guard !data.isEmpty else {
                    fileHandle.readabilityHandler = nil
                    continuation.resume()
                    return
                }
                guard let chunk = String(data: data, encoding: .utf8) else { return }
                Task { @MainActor in
                    for line in chunk.split(separator: "\n", omittingEmptySubsequences: true) {
                        self?.transcript.append(String(line))
                    }
                }
            }
        }
        process.waitUntilExit()
    }

    func cancel() {
        runningProcess?.terminate()
        runningProcess = nil
        isBusy = false
    }

    // MARK: - Process helper

    private static func run(_ executable: String, _ arguments: [String], timeout: TimeInterval) async -> (status: Int32, output: String) {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let process = Process()
                process.executableURL = URL(fileURLWithPath: executable)
                process.arguments = arguments
                var environment = ProcessInfo.processInfo.environment
                environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (environment["PATH"] ?? "")
                process.environment = environment

                let pipe = Pipe()
                process.standardOutput = pipe
                process.standardError = pipe
                do {
                    try process.run()
                } catch {
                    continuation.resume(returning: (1, "Could not launch \(executable): \(error.localizedDescription)"))
                    return
                }
                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                continuation.resume(returning: (
                    process.terminationStatus,
                    String(data: data, encoding: .utf8) ?? ""
                ))
            }
        }
    }
}
