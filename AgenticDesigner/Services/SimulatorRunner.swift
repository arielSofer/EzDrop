//
//  SimulatorRunner.swift
//  AgenticDesigner
//
//  Builds an exported SwiftUI package into a real .app bundle and launches
//  it in the iOS Simulator. An executable SwiftPM package cannot be
//  installed on iOS by itself, so the generated sources are compiled
//  directly with swiftc into an app bundle, then installed and launched
//  with simctl. Requires full Xcode (not just Command Line Tools) and a
//  non-sandboxed app so the build tools can be spawned.
//

import Foundation

enum SimulatorRunError: LocalizedError {
    case xcodeNotFound
    case noSimulatorDevice
    case commandFailed(command: String, output: String, logPath: String?)

    var errorDescription: String? {
        switch self {
        case .xcodeNotFound:
            return "Xcode not found. Install the full Xcode app to run in the simulator."
        case .noSimulatorDevice:
            return "No iPhone simulator available. Install an iOS runtime in Xcode ▸ Settings ▸ Platforms."
        case .commandFailed(let command, let output, let logPath):
            let logLine = logPath.map { "\nFull log: \($0)" } ?? ""
            return "\(command) failed:\n\(output)\(logLine)"
        }
    }
}

nonisolated enum SimulatorRunner {

    enum Target: Sendable {
        case iPhone
        case iPad
    }

    struct LaunchResult {
        let deviceName: String
        let bundleIdentifier: String
    }

    static func buildAndLaunch(
        exportRoot: URL,
        appName: String,
        target: Target = .iPhone,
        progress: @escaping @Sendable (String) -> Void
    ) throws -> LaunchResult {
        let developerDir = try findDeveloperDir()

        progress("Compiling \(appName)…")
        let appBundle = try compileAppBundle(exportRoot: exportRoot, appName: appName, developerDir: developerDir)

        progress("Starting simulator…")
        let device = try pickDevice(target: target, developerDir: developerDir)
        if !device.booted {
            _ = try? run("/usr/bin/xcrun", ["simctl", "boot", device.udid], developerDir: developerDir)
        }
        _ = try? run("/usr/bin/open", ["-a", "Simulator"])
        _ = try run("/usr/bin/xcrun", ["simctl", "bootstatus", device.udid, "-b"], developerDir: developerDir)

        progress("Installing on \(device.name)…")
        let bundleId = "com.agenticdesigner.generated.\(appName)"
        _ = try run("/usr/bin/xcrun", ["simctl", "install", device.udid, appBundle.path], developerDir: developerDir)
        _ = try run("/usr/bin/xcrun", ["simctl", "launch", "--terminate-running-process", device.udid, bundleId], developerDir: developerDir)

        return LaunchResult(deviceName: device.name, bundleIdentifier: bundleId)
    }

    /// Builds the embedded watchOS target from the exported Xcode project,
    /// boots a real Apple Watch Simulator, installs the watch bundle, and
    /// launches it. This keeps the Run button as direct for Watch as it is
    /// for iPhone/iPad, while still using the native watchOS toolchain.
    static func buildAndLaunchWatch(
        projectRoot: URL,
        appName: String,
        progress: @escaping @Sendable (String) -> Void
    ) throws -> LaunchResult {
        let developerDir = try findDeveloperDir()
        let project = projectRoot.appendingPathComponent("\(appName).xcodeproj")
        let buildRoot = projectRoot.appendingPathComponent("WatchSimulatorBuild", isDirectory: true)

        progress("Compiling \(appName) Watch App…")
        _ = try run("/usr/bin/xcodebuild", [
            "-project", project.path,
            "-target", "\(appName)Watch",
            "-sdk", "watchsimulator",
            "-configuration", "Debug",
            "SYMROOT=\(buildRoot.path)",
            "CODE_SIGNING_ALLOWED=NO",
            "build"
        ], developerDir: developerDir)

        let watchApp = buildRoot
            .appendingPathComponent("Debug-watchsimulator", isDirectory: true)
            .appendingPathComponent("\(appName)Watch.app", isDirectory: true)
        guard FileManager.default.fileExists(atPath: watchApp.path) else {
            throw SimulatorRunError.commandFailed(command: "xcodebuild", output: "Watch app bundle was not produced at \(watchApp.path)", logPath: nil)
        }

        progress("Starting Apple Watch Simulator…")
        let device = try pickWatchDevice(developerDir: developerDir)
        if !device.booted {
            _ = try? run("/usr/bin/xcrun", ["simctl", "boot", device.udid], developerDir: developerDir)
        }
        _ = try? run("/usr/bin/open", ["-a", "Simulator"])
        _ = try run("/usr/bin/xcrun", ["simctl", "bootstatus", device.udid, "-b"], developerDir: developerDir)

        progress("Installing on \(device.name)…")
        _ = try run("/usr/bin/xcrun", ["simctl", "install", device.udid, watchApp.path], developerDir: developerDir)
        let bundleId = try watchBundleIdentifier(at: watchApp)
        _ = try run("/usr/bin/xcrun", ["simctl", "launch", "--terminate-running-process", device.udid, bundleId], developerDir: developerDir)
        return LaunchResult(deviceName: device.name, bundleIdentifier: bundleId)
    }

    // MARK: - Build

    private static func compileAppBundle(exportRoot: URL, appName: String, developerDir: String) throws -> URL {
        let fileManager = FileManager.default
        let sourcesDir = exportRoot.appendingPathComponent("Sources", isDirectory: true)
        let buildDir = exportRoot.appendingPathComponent("SimulatorBuild", isDirectory: true)
        let appBundle = buildDir.appendingPathComponent("\(appName).app", isDirectory: true)

        if fileManager.fileExists(atPath: buildDir.path) {
            try fileManager.removeItem(at: buildDir)
        }
        try fileManager.createDirectory(at: appBundle, withIntermediateDirectories: true)

        var sourceFiles: [String] = []
        if let enumerator = fileManager.enumerator(at: sourcesDir, includingPropertiesForKeys: nil) {
            for case let url as URL in enumerator where url.pathExtension == "swift" {
                sourceFiles.append(url.path)
            }
        }
        guard !sourceFiles.isEmpty else {
            throw SimulatorRunError.commandFailed(command: "export", output: "No generated Swift sources found at \(sourcesDir.path)", logPath: nil)
        }

        #if arch(arm64)
        let arch = "arm64"
        #else
        let arch = "x86_64"
        #endif

        _ = try run(
            "/usr/bin/xcrun",
            ["-sdk", "iphonesimulator", "swiftc",
             "-target", "\(arch)-apple-ios17.0-simulator",
             "-parse-as-library"]
            + sourceFiles.sorted()
            + ["-o", appBundle.appendingPathComponent(appName).path],
            developerDir: developerDir
        )

        let exportedPlist = NSDictionary(contentsOfFile: exportRoot.appendingPathComponent("Info.plist").path)
        let usageDescriptions = (exportedPlist as? [String: String]) ?? [:]
        // Array-valued keys are lost by the [String: String] cast above, so the
        // orientation (which is an array) has to be read separately — without
        // it a landscape game runs portrait-locked in the simulator.
        let orientations = exportedPlist?["UISupportedInterfaceOrientations"] as? [String] ?? []
        try infoPlist(appName: appName, usageDescriptions: usageDescriptions, orientations: orientations)
            .write(to: appBundle.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)

        let resourcesDir = sourcesDir.appendingPathComponent("\(appName)/Resources", isDirectory: true)
        if fileManager.fileExists(atPath: resourcesDir.path) {
            for item in try fileManager.contentsOfDirectory(at: resourcesDir, includingPropertiesForKeys: nil) {
                try fileManager.copyItem(at: item, to: appBundle.appendingPathComponent(item.lastPathComponent))
            }
        }

        return appBundle
    }

    private static func infoPlist(appName: String, usageDescriptions: [String: String],
                                  orientations: [String] = []) -> String {
        let usageEntries = usageDescriptions.sorted { $0.key < $1.key }
            .map { "    <key>\($0.key)</key>\n    <string>\($0.value)</string>" }
            .joined(separator: "\n")
        let orientationEntry = orientations.isEmpty ? "" :
            "    <key>UISupportedInterfaceOrientations</key>\n    <array>\n"
            + orientations.map { "        <string>\($0)</string>" }.joined(separator: "\n")
            + "\n    </array>"
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>CFBundleExecutable</key>
            <string>\(appName)</string>
            <key>CFBundleIdentifier</key>
            <string>com.agenticdesigner.generated.\(appName)</string>
            <key>CFBundleName</key>
            <string>\(appName)</string>
            <key>CFBundlePackageType</key>
            <string>APPL</string>
            <key>CFBundleShortVersionString</key>
            <string>1.0</string>
            <key>CFBundleVersion</key>
            <string>1</string>
            <key>CFBundleSupportedPlatforms</key>
            <array><string>iPhoneSimulator</string></array>
            <key>MinimumOSVersion</key>
            <string>17.0</string>
            <key>UIDeviceFamily</key>
            <array><integer>1</integer><integer>2</integer></array>
        \(usageEntries)
        \(orientationEntry)
            <key>UILaunchScreen</key>
            <dict/>
        </dict>
        </plist>
        """
    }

    // MARK: - Simulator selection

    private static func pickDevice(target: Target, developerDir: String) throws -> (udid: String, name: String, booted: Bool) {
        let json = try run("/usr/bin/xcrun", ["simctl", "list", "devices", "available", "--json"], developerDir: developerDir)
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let runtimes = root["devices"] as? [String: [[String: Any]]]
        else {
            throw SimulatorRunError.noSimulatorDevice
        }

        var candidates: [(udid: String, name: String, booted: Bool)] = []
        let devicePrefix = target == .iPad ? "iPad" : "iPhone"
        // Newest iOS runtime first so a fresh install lands on a modern device.
        for runtime in runtimes.keys.sorted(by: >) where runtime.contains("SimRuntime.iOS") {
            for device in runtimes[runtime] ?? [] {
                guard let name = device["name"] as? String, name.hasPrefix(devicePrefix),
                      let udid = device["udid"] as? String
                else { continue }
                candidates.append((udid, name, (device["state"] as? String) == "Booted"))
            }
        }

        if let booted = candidates.first(where: { $0.booted }) {
            return booted
        }
        guard let first = candidates.first else {
            throw SimulatorRunError.noSimulatorDevice
        }
        return first
    }

    private static func pickWatchDevice(developerDir: String) throws -> (udid: String, name: String, booted: Bool) {
        let json = try run("/usr/bin/xcrun", ["simctl", "list", "devices", "available", "--json"], developerDir: developerDir)
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let runtimes = root["devices"] as? [String: [[String: Any]]]
        else { throw SimulatorRunError.noSimulatorDevice }

        var candidates: [(udid: String, name: String, booted: Bool)] = []
        for runtime in runtimes.keys.sorted(by: >) where runtime.contains("SimRuntime.watchOS") {
            for device in runtimes[runtime] ?? [] {
                guard let name = device["name"] as? String, name.contains("Apple Watch"),
                      let udid = device["udid"] as? String else { continue }
                candidates.append((udid, name, (device["state"] as? String) == "Booted"))
            }
        }
        if let booted = candidates.first(where: { $0.booted }) { return booted }
        guard let first = candidates.first else { throw SimulatorRunError.noSimulatorDevice }
        return first
    }

    private static func watchBundleIdentifier(at app: URL) throws -> String {
        guard let plist = NSDictionary(contentsOf: app.appendingPathComponent("Info.plist")),
              let identifier = plist["CFBundleIdentifier"] as? String else {
            throw SimulatorRunError.commandFailed(command: "Info.plist", output: "Watch bundle identifier is missing", logPath: nil)
        }
        return identifier
    }

    // MARK: - Process helpers

    private static func findDeveloperDir() throws -> String {
        let simulatorPlatform = "/Platforms/iPhoneSimulator.platform"
        if let selected = try? run("/usr/bin/xcode-select", ["-p"]) {
            let path = selected.trimmingCharacters(in: .whitespacesAndNewlines)
            if FileManager.default.fileExists(atPath: path + simulatorPlatform) {
                return path
            }
        }
        let fallback = "/Applications/Xcode.app/Contents/Developer"
        if FileManager.default.fileExists(atPath: fallback + simulatorPlatform) {
            return fallback
        }
        throw SimulatorRunError.xcodeNotFound
    }

    @discardableResult
    private static func run(_ executable: String, _ arguments: [String], developerDir: String? = nil) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let developerDir {
            var environment = ProcessInfo.processInfo.environment
            environment["DEVELOPER_DIR"] = developerDir
            process.environment = environment
        }

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()

        let output = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            let command = ([URL(fileURLWithPath: executable).lastPathComponent] + arguments.prefix(2)).joined(separator: " ")
            let fullCommand = ([executable] + arguments).joined(separator: " ")
            let fullOutput = """
            Command failed (\(process.terminationStatus)):
            \(fullCommand)

            \(output)
            """
            print("📱 AgenticDesigner simulator run failed:\n\(fullOutput)")
            let logPath = writeFailureLog(fullOutput)
            throw SimulatorRunError.commandFailed(
                command: command,
                output: summarizedFailureOutput(output),
                logPath: logPath
            )
        }
        return output
    }

    private static func summarizedFailureOutput(_ output: String) -> String {
        let lines = output
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map(String.init)
        let errorWindow = lines.firstIndex { $0.localizedCaseInsensitiveContains("error:") }
        let selected: [String]
        if let errorWindow {
            let start = max(0, errorWindow - 6)
            let end = min(lines.count, errorWindow + 18)
            selected = Array(lines[start..<end])
        } else {
            selected = Array(lines.suffix(40))
        }
        return selected.joined(separator: "\n")
    }

    struct XcodeProjectLaunchResult {
        let deviceName: String
        let deviceUDID: String
        let bundleIdentifier: String
        /// Still running a few seconds after launch — "simctl launch exited 0"
        /// alone also passes for an app that trapped in FirebaseApp.configure().
        let aliveAfterLaunch: Bool
    }

    /// Builds the EXPORTED .xcodeproj with xcodebuild (which resolves the
    /// firebase-ios-sdk package — the real backend, not the stubbed SwiftPM
    /// preview build), installs it on a simulator, launches it, and verifies
    /// the process survives. This is the missing last leg of "prompt → app
    /// running against a real backend" that previously required opening Xcode.
    static func buildAndLaunchXcodeProject(
        projectRoot: URL,
        appName: String,
        bundleId: String,
        progress: @escaping @Sendable (String) -> Void
    ) throws -> XcodeProjectLaunchResult {
        let developerDir = try findDeveloperDir()
        let project = projectRoot.appendingPathComponent("\(appName).xcodeproj")
        guard FileManager.default.fileExists(atPath: project.path) else {
            throw SimulatorRunError.commandFailed(command: "xcodebuild", output: "No \(appName).xcodeproj at \(projectRoot.path) — export_xcode_project first.", logPath: nil)
        }
        let buildRoot = projectRoot.appendingPathComponent("SimulatorBuild", isDirectory: true)

        progress("Building \(appName).xcodeproj (resolves Firebase — first build takes minutes)…")
        _ = try run("/usr/bin/xcodebuild", [
            "-project", project.path,
            "-scheme", appName,
            "-sdk", "iphonesimulator",
            "-configuration", "Debug",
            "-destination", "generic/platform=iOS Simulator",
            "SYMROOT=\(buildRoot.path)",
            "CODE_SIGNING_ALLOWED=NO",
            "build",
        ], developerDir: developerDir)

        let appBundle = buildRoot
            .appendingPathComponent("Debug-iphonesimulator", isDirectory: true)
            .appendingPathComponent("\(appName).app", isDirectory: true)
        guard FileManager.default.fileExists(atPath: appBundle.path) else {
            throw SimulatorRunError.commandFailed(command: "xcodebuild", output: "Build succeeded but no app bundle at \(appBundle.path).", logPath: nil)
        }

        progress("Starting simulator…")
        let device = try pickDevice(target: .iPhone, developerDir: developerDir)
        if !device.booted {
            _ = try? run("/usr/bin/xcrun", ["simctl", "boot", device.udid], developerDir: developerDir)
        }
        _ = try? run("/usr/bin/open", ["-a", "Simulator"])
        _ = try run("/usr/bin/xcrun", ["simctl", "bootstatus", device.udid, "-b"], developerDir: developerDir)

        progress("Installing on \(device.name)…")
        _ = try run("/usr/bin/xcrun", ["simctl", "install", device.udid, appBundle.path], developerDir: developerDir)
        _ = try run("/usr/bin/xcrun", ["simctl", "launch", "--terminate-running-process", device.udid, bundleId], developerDir: developerDir)

        // The truth check: give the app a moment to reach (or crash in) its
        // first frame, then ask launchd whether it is STILL running.
        Thread.sleep(forTimeInterval: 4)
        let processes = (try? run("/usr/bin/xcrun", ["simctl", "spawn", device.udid, "launchctl", "list"], developerDir: developerDir)) ?? ""
        let alive = processes.contains(bundleId)

        return XcodeProjectLaunchResult(
            deviceName: device.name,
            deviceUDID: device.udid,
            bundleIdentifier: bundleId,
            aliveAfterLaunch: alive
        )
    }

    struct ArchiveResult {
        let archivePath: String
        let ipaPath: String?
    }

    /// `xcodebuild archive` + `-exportArchive` — the TestFlight/App Store leg.
    /// Needs a signing team (set_product_identity developmentTeam) and a
    /// distribution certificate on this Mac; failures surface verbatim so the
    /// agent can report exactly which signing prerequisite is missing.
    static func archiveIPA(
        projectRoot: URL,
        appName: String,
        teamId: String?,
        method: String,
        progress: @escaping @Sendable (String) -> Void
    ) throws -> ArchiveResult {
        let developerDir = try findDeveloperDir()
        let project = projectRoot.appendingPathComponent("\(appName).xcodeproj")
        let archive = projectRoot.appendingPathComponent("\(appName).xcarchive")
        let exportDir = projectRoot.appendingPathComponent("IPA", isDirectory: true)

        progress("Archiving \(appName)…")
        var arguments = [
            "-project", project.path,
            "-scheme", appName,
            "-destination", "generic/platform=iOS",
            "-archivePath", archive.path,
            "archive",
        ]
        if let teamId, !teamId.isEmpty {
            arguments.append("DEVELOPMENT_TEAM=\(teamId)")
            arguments.append("-allowProvisioningUpdates")
        }
        _ = try run("/usr/bin/xcodebuild", arguments, developerDir: developerDir)

        progress("Exporting IPA (\(method))…")
        let options = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
        \t<key>method</key>
        \t<string>\(method)</string>
        \(teamId.map { "\t<key>teamID</key>\n\t<string>\($0)</string>" } ?? "")
        </dict>
        </plist>
        """
        let optionsURL = projectRoot.appendingPathComponent("ExportOptions.plist")
        try options.write(to: optionsURL, atomically: true, encoding: .utf8)
        do {
            _ = try run("/usr/bin/xcodebuild", [
                "-exportArchive",
                "-archivePath", archive.path,
                "-exportPath", exportDir.path,
                "-exportOptionsPlist", optionsURL.path,
                "-allowProvisioningUpdates",
            ], developerDir: developerDir)
        } catch {
            // The archive itself is still a deliverable — Xcode's Organizer
            // can upload it even when headless export needs more setup.
            return ArchiveResult(archivePath: archive.path, ipaPath: nil)
        }
        let ipa = (try? FileManager.default.contentsOfDirectory(at: exportDir, includingPropertiesForKeys: nil))?
            .first { $0.pathExtension == "ipa" }
        return ArchiveResult(archivePath: archive.path, ipaPath: ipa?.path)
    }

    /// `simctl ui <udid> appearance dark|light` — lets the agent screenshot
    /// both appearances without a human touching the simulator.
    static func setAppearance(_ mode: String) throws -> String {
        let developerDir = try findDeveloperDir()
        let json = try run("/usr/bin/xcrun", ["simctl", "list", "devices", "booted", "--json"], developerDir: developerDir)
        guard let data = json.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let devices = parsed["devices"] as? [String: [[String: Any]]],
              let booted = devices.values.flatMap({ $0 }).first(where: { ($0["state"] as? String) == "Booted" }),
              let udid = booted["udid"] as? String else {
            throw SimulatorRunError.noSimulatorDevice
        }
        _ = try run("/usr/bin/xcrun", ["simctl", "ui", udid, "appearance", mode], developerDir: developerDir)
        return (booted["name"] as? String) ?? udid
    }

    private static func writeFailureLog(_ output: String) -> String? {
        do {
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("AgenticDesignerSimulatorRun", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let url = directory.appendingPathComponent("last-run-error.log")
            try output.write(to: url, atomically: true, encoding: .utf8)
            return url.path
        } catch {
            print("📱 AgenticDesigner could not write simulator failure log: \(error.localizedDescription)")
            return nil
        }
    }
}
