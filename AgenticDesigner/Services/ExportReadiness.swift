//
//  ExportReadiness.swift
//  AgenticDesigner
//
//  Product truth. The designer could always show a rich logic graph — 33
//  flows, 192 blocks — while the exported binary silently contained a
//  fraction of it, because `scopedFlowsForExport` drops any flow that isn't
//  bound to a screen or element. A tool that lets you believe an unbound
//  flow will run is a tool that manufactures confidence it hasn't earned.
//
//  This audits the gap between what the canvas PROMISES and what the
//  compiled app can actually DO, and says so out loud.
//

import Foundation

struct ReadinessFinding: Identifiable {
    enum Severity: String {
        case blocker   // The app cannot do what the screens claim.
        case warning   // It will run, but something is fake or missing.
        case info
    }
    let id = UUID()
    let severity: Severity
    let title: String
    let detail: String
}

@MainActor
enum ExportReadiness {

    /// The honest list of unimplemented blocks lives in LogicExporter, next to
    /// the codegen, so it cannot drift out of sync with reality. Reading a
    /// hand-maintained copy here is exactly how the truth-check came to print
    /// "READY" over an app whose login could never succeed.
    private static var previewOnlyBlocks: Set<LogicBlockType> {
        LogicExporter.blocksWithoutNativeCodegen
    }

    static func audit(project: DesignProject, flows: [LogicFlow]) -> [ReadinessFinding] {
        var findings: [ReadinessFinding] = []

        let screens = project.pages.flatMap { $0.nodes.filter { $0.type == .Frame } }
        let screenIds = Set(screens.map(\.id))
        var elementIds: Set<UUID> = []
        func collect(_ node: DesignNode) {
            elementIds.insert(node.id)
            node.children.forEach(collect)
        }
        screens.forEach(collect)

        // 1. Flows the exporter will DROP — the single most dangerous lie,
        //    because the canvas counts them and the binary doesn't have them.
        // Game-event triggers (On Game Over/Win/Score/Tap/Drag/Collision/
        // Entity Destroyed) and app-launch/custom events fire without a node
        // binding — the game screen's export closure calls them directly.
        let selfTriggering: Set<LogicBlockType> = [
            .onGameOver, .onGameWin, .onGameScore, .onGameTap, .onGameDrag,
            .onGameCollision, .onGameEntityDestroyed, .onAppLaunch, .customEvent,
            .onGameStart, .onGameLifeLost, .onGameSpawned, .onGameImpact, .onGameLaunched,
        ]
        let unbound = flows.filter { flow in
            guard !flow.blocks.isEmpty else { return false }
            if flow.blocks.contains(where: { selfTriggering.contains($0.type) }) { return false }
            if let screenNodeId = flow.screenNodeId, screenIds.contains(screenNodeId) { return false }
            let boundToElement = flow.blocks.contains { block in
                if let connected = block.connectedDesignNodeId, elementIds.contains(connected) { return true }
                return block.parameters.contains { parameter in
                    guard let reference = parameter.nodeReference else { return false }
                    return elementIds.contains(reference) || screenIds.contains(reference)
                }
            }
            return !boundToElement
        }
        if !unbound.isEmpty {
            findings.append(ReadinessFinding(
                severity: .blocker,
                title: "\(unbound.count) flow(s) will NOT be in the exported app",
                detail: """
                These flows have no trigger bound to a screen or element, so the exporter drops \
                them — they run in the preview and are absent from the binary: \
                \(unbound.map(\.name).joined(separator: ", ")). \
                Bind each one's trigger to a button or screen.
                """
            ))
        }

        // 2. Blocks with no native implementation.
        var previewOnly: [String] = []
        for flow in flows {
            for block in flow.blocks where previewOnlyBlocks.contains(block.type) {
                previewOnly.append("\(flow.name) → \(block.label)")
            }
        }
        if !previewOnly.isEmpty {
            findings.append(ReadinessFinding(
                severity: .blocker,
                title: "\(previewOnly.count) block(s) have no native implementation",
                detail: "They do nothing in the exported app: \(previewOnly.joined(separator: ", "))."
            ))
        }

        // 3. Backend blocks with no backend configured — the screens will say
        //    "secured" while nothing is wired to anything.
        let usesFirebase = flows.contains { $0.blocks.contains { $0.category == .firebase } }
        let usesSupabase = flows.contains { $0.blocks.contains {
            [.supabaseSignUp, .supabaseSignIn, .supabaseSignOut, .supabaseCurrentUser,
             .supabaseInsert, .supabaseQuery, .supabaseUpdate, .supabaseDelete].contains($0.type)
        } }
        if usesFirebase, !(project.firebaseConfig?.isConfigured ?? false) {
            findings.append(ReadinessFinding(
                severity: .blocker,
                title: "Firebase flows exist, but Firebase is not configured",
                detail: """
                No project credentials, so no GoogleService-Info.plist can be generated and \
                FirebaseApp.configure() traps at launch. Call set_firebase_config with the \
                Firebase console's projectId / apiKey / appId / messagingSenderId (Project \
                settings ▸ your iOS app), then re-export — the plist is then written into the \
                app target for you.
                """
            ))
        } else if usesFirebase, let config = project.firebaseConfig,
                  config.apiKey.isEmpty || config.appId.isEmpty || config.messagingSenderId.isEmpty {
            // A projectId alone passes isConfigured but is NOT enough for a
            // plist — the app would build and then trap on first launch.
            findings.append(ReadinessFinding(
                severity: .blocker,
                title: "Firebase credentials are incomplete",
                detail: "Missing \([config.apiKey.isEmpty ? "apiKey" : nil, config.appId.isEmpty ? "appId" : nil, config.messagingSenderId.isEmpty ? "messagingSenderId" : nil].compactMap { $0 }.joined(separator: ", ")) — set_firebase_config needs all of them before a GoogleService-Info.plist can be written."
            ))
        }
        if usesSupabase, !(project.supabaseConfig?.isConfigured ?? false) {
            findings.append(ReadinessFinding(
                severity: .blocker,
                title: "Supabase flows exist, but Supabase is not configured",
                detail: "Set the project URL and anon key (set_supabase_config), or the auth/data calls fail at runtime."
            ))
        }

        // 4. Sensor use without the matching permission prompt.
        let sensorBlocks: Set<LogicBlockType> = [.getLocation, .readHeartRate, .readStepCount, .readMotion]
        let usedSensors = flows.flatMap { $0.blocks }.filter { sensorBlocks.contains($0.type) }
        if !usedSensors.isEmpty {
            findings.append(ReadinessFinding(
                severity: .info,
                title: "\(usedSensors.count) sensor block(s) will read real hardware",
                detail: "Location uses CLLocation.distance with accuracy/jitter filtering; Health uses HealthKit. The Mac preview shows sample values — only a physical device proves them."
            ))
        }

        // 5. Screens whose data is hardcoded — "history" that looks real.
        let boundVariables = Set(flows.flatMap { $0.blocks }.compactMap { block in
            block.parameters.compactMap(\.variableReference)
        }.flatMap { $0 })
        let dataScreens = screens.filter { screen in
            let text = allText(in: screen)
            let looksLikeData = text.contains { $0.contains("$") || $0.contains("km") || $0.contains("bpm") }
            let hasBinding = hasAnyBinding(screen)
            return looksLikeData && !hasBinding
        }
        if !dataScreens.isEmpty {
            findings.append(ReadinessFinding(
                severity: .warning,
                title: "\(dataScreens.count) screen(s) show hardcoded data as if it were real",
                detail: """
                \(dataScreens.map(\.name).joined(separator: ", ")) display numbers that are baked into the design \
                and never come from a variable or the backend. An honest empty state beats invented user data.
                """
            ))
        }
        _ = boundVariables

        // 6. Apple Watch. SPM cannot produce a watch app BUNDLE — that needs a
        //    watchOS App target in Xcode. The generated workout session and
        //    connectivity code are real and compile, but until that target
        //    exists there is no watch app, only watch code.
        if project.platformSettings.enabledPlatforms.contains(.appleWatch) {
            findings.append(ReadinessFinding(
                severity: .info,
                title: "Apple Watch: use export_xcode_project for a real watch app",
                detail: """
                export_xcode_project produces a genuine watchOS App target (WatchWorkoutService — \
                HKWorkoutSession + live heart rate — and PhoneWatchSync) embedded into the iPhone \
                app; both targets build and the watch app runs on a watch. The SwiftPM export \
                (export_ios_source) CANNOT build a watch bundle — there the watch screens only run \
                inside the phone app. Pick the Xcode export to ship the watch.
                """
            ))
        }

        // 7. Auth without a profile write — an account with no username is not
        //    a user record.
        let hasRegister = flows.contains { $0.blocks.contains { $0.type == .firebaseRegister || $0.type == .supabaseSignUp } }
        let writesProfile = flows.contains { $0.blocks.contains {
            [.firestoreSetDocument, .firestoreAddDocument, .supabaseInsert].contains($0.type)
        } }
        if hasRegister, !writesProfile {
            findings.append(ReadinessFinding(
                severity: .warning,
                title: "Sign-up creates an account but never stores a profile",
                detail: "The auth user only carries an email. Write users/{uid} with the username, or the name the user typed is discarded."
            ))
        }

        // 8. Permissions asked all at once on launch — the popup ambush that
        //    gets every one of them denied.
        let launchPermissions = flows.filter { flow in
            flow.blocks.contains { [.onAppLaunch, .onScreenLoad].contains($0.type) }
                && flow.blocks.contains { $0.type == .requestPermission }
        }
        if launchPermissions.count > 1 {
            findings.append(ReadinessFinding(
                severity: .warning,
                title: "\(launchPermissions.count) permission prompts fire on launch",
                detail: """
                Asking before the user has seen any value reads as an ambush and is the fastest way \
                to get denied — and iOS only lets you ask once. Use Permissions.requestLocation() / \
                requestNotifications() / requestHealth() at the moment each one buys the user something.
                """
            ))
        }

        // 9. Node bindings the native export still can't honour.
        var unsupportedBindings = 0
        func scanBindings(_ node: DesignNode) {
            for binding in node.logicBindings ?? [] where LogicExporter.bindingKindsWithoutNativeSupport.contains(binding.kind) {
                unsupportedBindings += 1
            }
            node.children.forEach(scanBindings)
        }
        screens.forEach(scanBindings)
        if unsupportedBindings > 0 {
            findings.append(ReadinessFinding(
                severity: .warning,
                title: "\(unsupportedBindings) binding(s) don't affect the native app",
                detail: "selectedIndex bindings render on the canvas and in the preview but are dropped in the SwiftUI export — that element won't reflect the variable on device."
            ))
        }

        // 10. Packaging.
        if project.name.isEmpty || project.name.lowercased().contains("untitled") {
            findings.append(ReadinessFinding(
                severity: .warning,
                title: "Project is still called \"\(project.name)\"",
                detail: "The bundle identifier and app name are derived from this — set a real product name before shipping."
            ))
        }

        return findings
    }

    /// A blunt verdict a human can act on.
    static func summary(_ findings: [ReadinessFinding]) -> String {
        let blockers = findings.filter { $0.severity == .blocker }
        let warnings = findings.filter { $0.severity == .warning }

        var lines: [String] = []
        if blockers.isEmpty && warnings.isEmpty {
            lines.append("READY — every flow is bound, every block has a native implementation, and backends are configured.")
        } else if blockers.isEmpty {
            lines.append("RUNS, WITH CAVEATS — no blockers, but \(warnings.count) thing(s) are not what they appear.")
        } else {
            lines.append("NOT A WORKING APP — \(blockers.count) blocker(s). The screens promise more than the binary can do.")
        }
        for finding in findings {
            let tag = finding.severity.rawValue.uppercased()
            lines.append("\n[\(tag)] \(finding.title)\n  \(finding.detail)")
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Helpers

    private static func allText(in node: DesignNode) -> [String] {
        var out: [String] = []
        if let text = node.text { out.append(text) }
        for child in node.children { out.append(contentsOf: allText(in: child)) }
        return out
    }

    private static func hasAnyBinding(_ node: DesignNode) -> Bool {
        if let bindings = node.logicBindings, !bindings.isEmpty { return true }
        if node.repeatBinding != nil { return true }
        return node.children.contains { hasAnyBinding($0) }
    }
}
