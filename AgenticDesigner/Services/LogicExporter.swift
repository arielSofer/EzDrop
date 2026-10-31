//
//  LogicExporter.swift
//  AgenticDesigner
//
//  Exports the project's logic as a structured JSON "Logic Blueprint":
//  every screen, its elements, and its flows expressed as trigger → steps
//  with success/error branches — everything a code generator needs.
//

import Foundation
import AppKit
import UniformTypeIdentifiers

// MARK: - Blueprint types

struct LogicBlueprint: Codable {
    let projectName: String
    let exportDate: Date
    let screens: [ScreenBlueprint]
    let firebase: FirebaseConfig?
    let apiEndpoints: [APIEndpointConfig]
    let globalVariables: [LogicVariable]
}

struct ScreenBlueprint: Codable {
    let screenName: String
    let screenSize: CGSize
    let elements: [ElementBlueprint]
    let flows: [FlowBlueprint]
}

struct ElementBlueprint: Codable {
    let id: String
    let name: String
    let type: String
    let text: String?
}

struct FlowBlueprint: Codable {
    let name: String
    let trigger: TriggerBlueprint
    let steps: [StepBlueprint]
}

struct TriggerBlueprint: Codable {
    let type: String
    let elementName: String?
}

struct StepBlueprint: Codable {
    let type: String
    let parameters: [String: String]
    let onSuccess: [StepBlueprint]?
    let onError: [StepBlueprint]?
}

// MARK: - Exporter

enum LogicExporter {

    // MARK: Public entry points

    @MainActor
    static func exportWithSavePanel(project: DesignProject, flows: [LogicFlow], currentPageId: UUID? = nil) -> String {
        let panel = NSOpenPanel()
        panel.title = "Export SwiftUI Project"
        panel.prompt = "Export"
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true

        guard panel.runModal() == .OK, let directory = panel.url else {
            return "Export cancelled."
        }

        do {
            let url = try exportSwiftUISource(project: project, flows: flows, currentPageId: currentPageId, to: directory)
            return "Exported SwiftUI project: \(url.lastPathComponent)"
        } catch {
            return "Export failed: \(error.localizedDescription)"
        }
    }

    static func exportSwiftUISource(project: DesignProject, flows: [LogicFlow], currentPageId: UUID? = nil, to directory: URL) throws -> URL {
        let appName = swiftIdentifier(project.name, fallback: "ExportedApp")
        let root = directory.appendingPathComponent("\(appName)SwiftUIExport", isDirectory: true)
        let sources = root.appendingPathComponent("Sources/\(appName)", isDirectory: true)
        let shared = sources.appendingPathComponent("Shared", isDirectory: true)
        let screens = sources.appendingPathComponent("Screens", isDirectory: true)
        let resources = sources.appendingPathComponent("Resources", isDirectory: true)

        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: root.path) {
            try fileManager.removeItem(at: root)
        }
        try fileManager.createDirectory(at: shared, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: screens, withIntermediateDirectories: true)

        let screenNodes = allScreens(project: project)
            .filter { screen in
                screen.supportedPlatforms?.contains(where: project.platformSettings.enabledPlatforms.contains) ?? true
            }
        let allFlows = scopedFlowsForExport(mergedFlows(project: project, liveFlows: flows, currentPageId: currentPageId), screens: screenNodes)
        let variables = mergedVariables(project: project, flows: allFlows, screens: screenNodes)
        let variableTypes = Dictionary(uniqueKeysWithValues: variables.map { ($0.name, $0.type) })
        let imageAssets = try copyImageAssets(from: screenNodes, to: resources)
        // 2D games: the SwiftPM/simulator-run path needs the SpriteKit runtime
        // + scene JSON + sprite assets too — without this, a generated screen
        // references AgentGameView and the build fails "cannot find in scope".
        try exportGameScenes(from: screenNodes, sharedDir: shared, resources: resources)
        let hasGameScenes = !collectGameNodes(screenNodes).isEmpty

        try packageSwift(appName: appName, project: project, hasResources: !imageAssets.isEmpty || hasGameScenes).write(to: root.appendingPathComponent("Package.swift"), atomically: true, encoding: .utf8)
        try readme(project: project, appName: appName).write(to: root.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)
        // Continuous location (a tracked activity) needs the background mode;
        // a one-shot read does not.
        let needsBackgroundLocation = needsBackgroundLocation(in: allFlows)
        try infoPlistSource(
            usageDescriptions: requiredUsageDescriptions(in: allFlows),
            needsBackgroundLocation: needsBackgroundLocation,
            orientation: project.platformSettings.orientation
        ).write(to: root.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)
        let dynamicProps = dynamicProperties(in: allFlows)
        try appStateSource(variables: variables, firstScreen: screenNodes.first, screens: screenNodes, dynamic: dynamicProps).write(to: shared.appendingPathComponent("AppState.swift"), atomically: true, encoding: .utf8)
        try actionsSource(appName: appName, project: project, flows: allFlows, screens: screenNodes, variables: variables, dynamic: dynamicProps, imageAssets: imageAssets).write(to: shared.appendingPathComponent("GeneratedActions.swift"), atomically: true, encoding: .utf8)
        try supportSource(appName: appName, hasResources: !imageAssets.isEmpty, imageAssets: imageAssets).write(to: shared.appendingPathComponent("GeneratedSupport.swift"), atomically: true, encoding: .utf8)
        try sensorServicesSource().write(to: shared.appendingPathComponent("SensorServices.swift"), atomically: true, encoding: .utf8)
        try persistenceSource().write(to: shared.appendingPathComponent("StateStore.swift"), atomically: true, encoding: .utf8)
        try authServiceSource().write(to: shared.appendingPathComponent("AuthService.swift"), atomically: true, encoding: .utf8)
        try permissionsSource().write(to: shared.appendingPathComponent("Permissions.swift"), atomically: true, encoding: .utf8)
        try storeServiceSource().write(to: shared.appendingPathComponent("StoreService.swift"), atomically: true, encoding: .utf8)
        try pushServiceSource().write(to: shared.appendingPathComponent("PushService.swift"), atomically: true, encoding: .utf8)

        // Rules ship with the app source, not as an afterthought: an open
        // database is the single most common way a "finished" app leaks every
        // user's data.
        let collections = firestoreCollections(in: allFlows, declared: project.firebaseConfig)
        if !collections.isEmpty {
            try firestoreRulesSource(
                collections: collections,
                publicRead: project.firebaseConfig?.publicReadCollections ?? []
            ).write(to: root.appendingPathComponent("firestore.rules"), atomically: true, encoding: .utf8)
            // Without firebase.json the documented `firebase deploy --only
            // firestore:rules` aborts before doing anything — the rules file
            // alone is a suggestion, these two make it deployable.
            try firebaseDeployConfigJSON()
                .write(to: root.appendingPathComponent("firebase.json"), atomically: true, encoding: .utf8)
            if let projectId = project.firebaseConfig?.projectId, !projectId.isEmpty {
                try firebaseRCSource(projectId: projectId)
                    .write(to: root.appendingPathComponent(".firebaserc"), atomically: true, encoding: .utf8)
            }
        }
        let hasWatch = project.platformSettings.enabledPlatforms.contains(.appleWatch)
        let usesPush = allFlows.contains { $0.blocks.contains { $0.type == .registerForPush } }
        try rootViewSource(appName: appName, screens: iosViewScreens(screenNodes), flows: allFlows).write(to: sources.appendingPathComponent("RootView.swift"), atomically: true, encoding: .utf8)
        try appSource(appName: appName, hasWatch: hasWatch, usesPush: usesPush).write(to: sources.appendingPathComponent("\(appName)App.swift"), atomically: true, encoding: .utf8)

        for screen in screenNodes {
            let fileName = "\(swiftIdentifier(screen.name, fallback: "Screen"))View.swift"
            try screenSource(screen: screen, flows: allFlows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamicProps).write(to: screens.appendingPathComponent(fileName), atomically: true, encoding: .utf8)
        }

        if hasWatch {
            let watch = sources.appendingPathComponent("Watch", isDirectory: true)
            try fileManager.createDirectory(at: watch, withIntermediateDirectories: true)
            try watchRootSource(screens: watchViewScreens(screenNodes), flows: allFlows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamicProps).write(to: watch.appendingPathComponent("WatchRootView.swift"), atomically: true, encoding: .utf8)
            // The part that makes it an actual watch app rather than a watch
            // screen: a real workout session and phone/watch state sync.
            try watchWorkoutSource().write(to: watch.appendingPathComponent("WatchWorkoutService.swift"), atomically: true, encoding: .utf8)
        }

        // Layer five of the truth check: the flows promise navigation, this
        // makes a machine tap through and prove it.
        let uiTests = root.appendingPathComponent("\(appName)UITests", isDirectory: true)
        try fileManager.createDirectory(at: uiTests, withIntermediateDirectories: true)
        try UITestGenerator.source(appName: appName, screens: screenNodes, flows: allFlows)
            .write(to: uiTests.appendingPathComponent("\(appName)UITests.swift"), atomically: true, encoding: .utf8)

        // Every user-visible string, extracted for translation. Without this an
        // exported app is permanently monolingual.
        try writeLocalization(screens: screenNodes, to: root, appName: appName)

        try applySourceOverrides(project: project, root: root)
        return root
    }

    /// Writes `Base.lproj/Localizable.strings` plus a Hebrew stub, so the
    /// exported app is translatable from the moment it ships — and so RTL is a
    /// language setting rather than a rewrite. Keys are the English strings,
    /// which keeps the generated views readable.
    private static func writeLocalization(screens: [DesignNode], to root: URL, appName: String) throws {
        var strings: Set<String> = []
        func collect(_ node: DesignNode) {
            if let text = node.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                strings.insert(text)
            }
            node.children.forEach(collect)
        }
        screens.forEach(collect)
        guard !strings.isEmpty else { return }

        let body = strings.sorted().map { value in
            "\"\(value.replacingOccurrences(of: "\"", with: "\\\""))\" = \"\(value.replacingOccurrences(of: "\"", with: "\\\""))\";"
        }.joined(separator: "\n")

        for language in ["Base", "he"] {
            let directory = root.appendingPathComponent("\(language).lproj", isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let header = language == "he"
                ? "// Hebrew translations. Values still hold the English source — replace them.\n// The app already lays out right-to-left when this language is active.\n"
                : "// Generated from the design's text layers.\n"
            try (header + body + "\n")
                .write(to: directory.appendingPathComponent("Localizable.strings"), atomically: true, encoding: .utf8)
        }
    }

    /// Code Mode hand-edits win over generation in EVERY export path: any
    /// generated .swift file whose name matches a stored override is replaced
    /// with the edited content. Keyed by file name so the same override applies
    /// to both the SwiftPM and Xcode folder layouts.
    static func applySourceOverrides(project: DesignProject, root: URL) throws {
        guard let overrides = project.sourceOverrides, !overrides.isEmpty else { return }
        let enumerator = FileManager.default.enumerator(at: root, includingPropertiesForKeys: nil)
        while let url = enumerator?.nextObject() as? URL {
            guard url.pathExtension == "swift",
                  let content = overrides[url.lastPathComponent] else { continue }
            try content.write(to: url, atomically: true, encoding: .utf8)
        }
    }

    // The iOS app shows everything EXCEPT watch-only screens; the watch app
    // shows the dedicated watch screen(s) if any exist, otherwise every screen
    // adapted. Keeps a "Watch Runner" off the phone and the phone screens off
    // the watch.
    private static func iosViewScreens(_ screens: [DesignNode]) -> [DesignNode] {
        let phone = screens.filter { screen in
            // Watch-named screens belong to the watch app, not the phone.
            if screen.supportedPlatforms == nil,
               screen.name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased().hasPrefix("watch") {
                return false
            }
            guard let platforms = screen.supportedPlatforms else { return true }
            return platforms.contains(.iPhone) || platforms.contains(.iPad)
        }
        return phone.isEmpty ? screens : phone
    }
    private static func watchViewScreens(_ screens: [DesignNode]) -> [DesignNode] {
        let dedicated = screens.filter { $0.supportedPlatforms?.contains(.appleWatch) == true }
        if !dedicated.isEmpty { return dedicated }

        // Watch* named screens are the designer's DEDICATED watch UI — they
        // always win over any phone-screen mirroring heuristic. (Previously a
        // phone-storyboard fallback outranked them, so the watch app showed
        // the iPhone screens.)
        let namedWatchScreens = screens.filter {
            $0.name.trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
                .hasPrefix("watch")
        }
        if !namedWatchScreens.isEmpty { return namedWatchScreens }

        // No dedicated watch UI at all: mirror the phone flow when its
        // screens follow the alarm storyboard names, else adapt everything.
        let alarmStoryboardOrder = ["Home", "Ringing", "MathChallenge", "Success", "AlarmsList", "Settings"]
        let alarmStoryboard = alarmStoryboardOrder.compactMap { name in
            screens.first { $0.name == name }
        }
        if alarmStoryboard.count >= 3 { return alarmStoryboard }

        return screens
    }

    // MARK: - Xcode project export (signable, App-Store-shippable)
    //
    // The SPM export above compiles, but SwiftPM cannot build an app BUNDLE —
    // no Info.plist, no code signing, no watch app bundle. That left every
    // exported app one manual Xcode setup away from ever shipping. This writes
    // a real .xcodeproj (verified to build a .app, and to embed a watchOS app
    // bundle when the watch is enabled) using Xcode 16+ synchronized folder
    // groups, so the file list never drifts out of sync with the project.
    static func exportXcodeProject(project: DesignProject, flows: [LogicFlow], currentPageId: UUID? = nil, to directory: URL) throws -> URL {
        let appName = swiftIdentifier(project.name, fallback: "ExportedApp")
        let bundleId = sanitizedBundleId(project.bundleIdentifier) ?? "com.agentic.\(appName.lowercased())"
        let root = directory.appendingPathComponent("\(appName)Xcode", isDirectory: true)
        let sharedDir = root.appendingPathComponent("Shared", isDirectory: true)
        let iosDir = root.appendingPathComponent("iOS", isDirectory: true)

        let fileManager = FileManager.default
        if fileManager.fileExists(atPath: root.path) { try fileManager.removeItem(at: root) }
        try fileManager.createDirectory(at: sharedDir, withIntermediateDirectories: true)
        try fileManager.createDirectory(at: iosDir, withIntermediateDirectories: true)

        let screenNodes = allScreens(project: project)
            .filter { screen in
                screen.supportedPlatforms?.contains(where: project.platformSettings.enabledPlatforms.contains) ?? true
            }
        let allFlows = scopedFlowsForExport(mergedFlows(project: project, liveFlows: flows, currentPageId: currentPageId), screens: screenNodes)
        let variables = mergedVariables(project: project, flows: allFlows, screens: screenNodes)
        let variableTypes = Dictionary(uniqueKeysWithValues: variables.map { ($0.name, $0.type) })
        let resources = iosDir.appendingPathComponent("Resources", isDirectory: true)
        let imageAssets = try copyImageAssets(from: screenNodes, to: resources)
        // 2D games: copy the SpriteKit runtime, bundle each scene's JSON, and
        // copy its sprite art — so exported screens render real, playable games.
        try exportGameScenes(from: screenNodes, sharedDir: sharedDir, resources: resources)
        let dynamicProps = dynamicProperties(in: allFlows)
        let hasWatch = project.platformSettings.enabledPlatforms.contains(.appleWatch)
        let usesPush = allFlows.contains { $0.blocks.contains { $0.type == .registerForPush } }

        // Shared services + state — compiled into BOTH the iOS and watch
        // targets (each guards its platform-specific APIs with #if).
        try appStateSource(variables: variables, firstScreen: screenNodes.first, screens: screenNodes, dynamic: dynamicProps).write(to: sharedDir.appendingPathComponent("AppState.swift"), atomically: true, encoding: .utf8)
        try actionsSource(appName: appName, project: project, flows: allFlows, screens: screenNodes, variables: variables, dynamic: dynamicProps, imageAssets: imageAssets).write(to: sharedDir.appendingPathComponent("GeneratedActions.swift"), atomically: true, encoding: .utf8)
        try supportSource(appName: appName, hasResources: !imageAssets.isEmpty, imageAssets: imageAssets).write(to: sharedDir.appendingPathComponent("GeneratedSupport.swift"), atomically: true, encoding: .utf8)
        try sensorServicesSource().write(to: sharedDir.appendingPathComponent("SensorServices.swift"), atomically: true, encoding: .utf8)
        try persistenceSource().write(to: sharedDir.appendingPathComponent("StateStore.swift"), atomically: true, encoding: .utf8)
        try authServiceSource().write(to: sharedDir.appendingPathComponent("AuthService.swift"), atomically: true, encoding: .utf8)
        try permissionsSource().write(to: sharedDir.appendingPathComponent("Permissions.swift"), atomically: true, encoding: .utf8)
        try storeServiceSource().write(to: sharedDir.appendingPathComponent("StoreService.swift"), atomically: true, encoding: .utf8)
        try pushServiceSource().write(to: sharedDir.appendingPathComponent("PushService.swift"), atomically: true, encoding: .utf8)

        // iOS target: its own @main, the phone root view, and every screen.
        let firebaseEnabled = project.firebaseConfig?.isEnabled == true
        try xcodeAppEntry(appName: appName, rootView: "RootView", structName: "\(appName)App", withPushDelegate: usesPush, firebaseConfigure: firebaseEnabled).write(to: iosDir.appendingPathComponent("App.swift"), atomically: true, encoding: .utf8)
        try rootViewSource(appName: appName, screens: iosViewScreens(screenNodes), flows: allFlows).write(to: iosDir.appendingPathComponent("RootView.swift"), atomically: true, encoding: .utf8)
        for screen in screenNodes {
            let fileName = "\(swiftIdentifier(screen.name, fallback: "Screen"))View.swift"
            try screenSource(screen: screen, flows: allFlows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamicProps).write(to: iosDir.appendingPathComponent(fileName), atomically: true, encoding: .utf8)
        }
        // App icon (blank icon = rejection) and privacy manifest (required by
        // Apple for the UserDefaults/file APIs the generated code uses). Both
        // live in the iOS sync folder so the target picks them up.
        let brandHex = project.brand?.isSet == true ? project.brand?.accent : nil
        try writeAppIcon(to: iosDir, appName: appName, hex: brandHex)
        try privacyManifestSource().write(to: iosDir.appendingPathComponent("PrivacyInfo.xcprivacy"), atomically: true, encoding: .utf8)

        // GoogleService-Info.plist, generated from the project's Firebase
        // credentials. FirebaseApp.configure() reads it by name at launch and
        // TRAPS if it is missing, so an app whose flows sign users in cannot
        // ship without it. It goes in the synchronized iOS folder, which means
        // the app target copies it as a resource with no manual step — the one
        // thing that used to stand between an export and a working login.
        if let plist = googleServiceInfoPlist(config: project.firebaseConfig, bundleId: bundleId) {
            try plist.write(to: iosDir.appendingPathComponent("GoogleService-Info.plist"), atomically: true, encoding: .utf8)
        }

        if hasWatch {
            let watchDir = root.appendingPathComponent("Watch", isDirectory: true)
            try fileManager.createDirectory(at: watchDir, withIntermediateDirectories: true)
            try xcodeAppEntry(appName: appName, rootView: "WatchRootView", structName: "\(appName)WatchApp").write(to: watchDir.appendingPathComponent("WatchApp.swift"), atomically: true, encoding: .utf8)
            try watchRootSource(screens: watchViewScreens(screenNodes), flows: allFlows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamicProps).write(to: watchDir.appendingPathComponent("WatchRootView.swift"), atomically: true, encoding: .utf8)
            try watchWorkoutSource().write(to: watchDir.appendingPathComponent("WatchWorkoutService.swift"), atomically: true, encoding: .utf8)
            // The watch app needs its own icon and privacy manifest too.
            try writeAppIcon(to: watchDir, appName: appName, hex: brandHex, platform: "watchos")
            try privacyManifestSource().write(to: watchDir.appendingPathComponent("PrivacyInfo.xcprivacy"), atomically: true, encoding: .utf8)
        }

        // Firestore rules ship next to the project, same as the SPM export.
        let collections = firestoreCollections(in: allFlows, declared: project.firebaseConfig)
        if !collections.isEmpty {
            try firestoreRulesSource(
                collections: collections,
                publicRead: project.firebaseConfig?.publicReadCollections ?? []
            ).write(to: root.appendingPathComponent("firestore.rules"), atomically: true, encoding: .utf8)
            // Without firebase.json the documented `firebase deploy --only
            // firestore:rules` aborts before doing anything — the rules file
            // alone is a suggestion, these two make it deployable.
            try firebaseDeployConfigJSON()
                .write(to: root.appendingPathComponent("firebase.json"), atomically: true, encoding: .utf8)
            if let projectId = project.firebaseConfig?.projectId, !projectId.isEmpty {
                try firebaseRCSource(projectId: projectId)
                    .write(to: root.appendingPathComponent(".firebaserc"), atomically: true, encoding: .utf8)
            }
        }

        // Array-valued plist keys (UIBackgroundModes) can't be build settings,
        // so they live in a partial Info.plist at the root — deliberately
        // OUTSIDE the synchronized folders, or the folder group would also try
        // to copy it as a resource ("multiple commands produce Info.plist").
        if needsBackgroundLocation(in: allFlows) {
            let partialPlist = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
            \t<key>UIBackgroundModes</key>
            \t<array>
            \t\t<string>location</string>
            \t</array>
            </dict>
            </plist>

            """
            try partialPlist.write(to: root.appendingPathComponent("Info.plist"), atomically: true, encoding: .utf8)
        }

        // Push needs the aps-environment entitlement. It lives at the root
        // (outside the synchronized folders) and is referenced by
        // CODE_SIGN_ENTITLEMENTS. It only takes effect once the user enables
        // the Push Notifications capability on their signing profile.
        if usesPush {
            let entitlements = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
            \t<key>aps-environment</key>
            \t<string>development</string>
            </dict>
            </plist>

            """
            try entitlements.write(to: root.appendingPathComponent("\(appName).entitlements"), atomically: true, encoding: .utf8)
        }

        let projectDir = root.appendingPathComponent("\(appName).xcodeproj", isDirectory: true)
        try fileManager.createDirectory(at: projectDir, withIntermediateDirectories: true)
        try xcodeProjectPBX(
            appName: appName,
            bundleId: bundleId,
            hasWatch: hasWatch,
            usageDescriptions: requiredUsageDescriptions(in: allFlows),
            needsBackgroundLocation: needsBackgroundLocation(in: allFlows),
            firebaseEnabled: project.firebaseConfig?.isEnabled == true,
            usesPush: usesPush,
            orientation: project.platformSettings.orientation,
            developmentTeam: project.developmentTeam,
            forcedInterfaceStyle: forcedInterfaceStyle(for: project)
        ).write(to: projectDir.appendingPathComponent("project.pbxproj"), atomically: true, encoding: .utf8)

        // StoreKit test config (so purchases work in the simulator) + a shared
        // scheme that attaches it and makes `xcodebuild -scheme` deterministic.
        let productIds = purchaseProductIds(in: allFlows)
        if !productIds.isEmpty {
            try storeKitConfigSource(productIds: productIds)
                .write(to: root.appendingPathComponent("Products.storekit"), atomically: true, encoding: .utf8)
        }
        let schemesDir = projectDir.appendingPathComponent("xcshareddata/xcschemes", isDirectory: true)
        try fileManager.createDirectory(at: schemesDir, withIntermediateDirectories: true)
        try xcodeSchemeSource(appName: appName, storeKitConfig: !productIds.isEmpty)
            .write(to: schemesDir.appendingPathComponent("\(appName).xcscheme"), atomically: true, encoding: .utf8)

        try xcodeReadme(project: project, appName: appName, bundleId: bundleId, hasWatch: hasWatch)
            .write(to: root.appendingPathComponent("README.md"), atomically: true, encoding: .utf8)

        try applySourceOverrides(project: project, root: root)
        return root
    }

    /// A per-target @main entry. Each target gets its own App struct so the
    /// iOS and watch apps are independent bundles (not one file switching on
    /// #if os(watchOS), which cannot express two separate product targets).
    private static func xcodeAppEntry(appName: String, rootView: String, structName: String, withPushDelegate: Bool = false, firebaseConfigure: Bool = false) -> String {
        let pushLine = withPushDelegate ? "\n    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate" : ""
        // FirebaseApp.configure() MUST run before any Auth/Firestore call.
        // Guarded so the app still builds before the SDK/GoogleService-Info are
        // added; once they are, this is what makes Firebase actually work.
        let firebaseImport = firebaseConfigure ? "\n        #if canImport(FirebaseCore)\n        import FirebaseCore\n        #endif" : ""
        let firebaseInit = firebaseConfigure ? """

            init() {
                #if canImport(FirebaseCore)
                FirebaseApp.configure()
                #endif
            }
        """ : ""
        return """
        import SwiftUI\(firebaseImport)

        @main
        struct \(structName): App {
            @StateObject private var state = AppState()\(pushLine)
        \(firebaseInit)
            var body: some Scene {
                WindowGroup {
                    \(rootView)()
                        .environmentObject(state)
                        .task { await state.restoreOnLaunch() }
                }
            }
        }

        """
    }

    // App name used for the exported package; exposed so callers (e.g. the
    // simulator runner) can locate the export root and name the .app bundle.
    static func exportAppName(project: DesignProject) -> String {
        swiftIdentifier(project.name, fallback: "ExportedApp")
    }

    /// A reverse-DNS bundle id is [A-Za-z0-9.-] only; anything else silently
    /// breaks signing. Returns nil for empty/invalid so the caller can fall
    /// back to the derived id.
    private static func sanitizedBundleId(_ raw: String?) -> String? {
        guard let raw = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty else { return nil }
        let allowed = raw.filter { $0.isLetter || $0.isNumber || $0 == "." || $0 == "-" }
        return allowed.contains(".") ? allowed : nil
    }

    static func buildBlueprint(project: DesignProject, flows: [LogicFlow], currentPageId: UUID? = nil) -> LogicBlueprint {
        // The flows passed in are the live (possibly unsaved) flows for the
        // current page; other pages contribute their persisted flows.
        var screens: [ScreenBlueprint] = []
        let livePageId = currentPageId ?? project.pages.first?.id

        for page in project.pages {
            let pageFlows = page.id == livePageId ? flows : page.logicFlows
            let rootScreens = page.nodes.filter { $0.type == .Frame }

            if rootScreens.isEmpty {
                screens.append(screenBlueprint(
                    name: page.name,
                    size: CGSize(width: 390, height: 844),
                    nodes: page.nodes,
                    flows: pageFlows
                ))
                continue
            }

            for screen in rootScreens {
                let flowsForScreen = pageFlows.filter {
                    $0.screenNodeId == nil || $0.screenNodeId == screen.id
                }
                screens.append(screenBlueprint(
                    name: screen.name,
                    size: CGSize(width: screen.width, height: screen.height),
                    nodes: [screen],
                    flows: flowsForScreen
                ))
            }
        }

        return LogicBlueprint(
            projectName: project.name,
            exportDate: Date(),
            screens: screens,
            firebase: project.firebaseConfig,
            apiEndpoints: project.apiEndpoints,
            globalVariables: project.globalVariables
        )
    }

    // MARK: - Screen assembly

    private static func screenBlueprint(
        name: String,
        size: CGSize,
        nodes: [DesignNode],
        flows: [LogicFlow]
    ) -> ScreenBlueprint {
        var elements: [ElementBlueprint] = []
        var nodeNames: [UUID: String] = [:]

        func walk(_ nodes: [DesignNode]) {
            for node in nodes {
                elements.append(ElementBlueprint(
                    id: node.id.uuidString,
                    name: node.name,
                    type: node.type.rawValue,
                    text: node.text
                ))
                nodeNames[node.id] = node.name
                walk(node.children)
            }
        }
        walk(nodes)

        let exportedFlows = flows.flatMap { flow in
            flowBlueprints(for: flow, nodeNames: nodeNames)
        }

        return ScreenBlueprint(
            screenName: name,
            screenSize: size,
            elements: elements,
            flows: exportedFlows
        )
    }

    // MARK: - Flow assembly

    // Each event block becomes one exported flow: trigger + the chain of
    // steps reachable from it. Port 0 feeds the main/success chain, port 1
    // feeds the error chain of branching blocks.
    private static func flowBlueprints(for flow: LogicFlow, nodeNames: [UUID: String]) -> [FlowBlueprint] {
        let eventBlocks = flow.blocks.filter {
            BlockCatalog.definition(for: $0.type)?.inputPortCount == 0
        }

        return eventBlocks.map { event in
            var visited: Set<UUID> = [event.id]
            let steps = chain(from: event.id, port: 0, in: flow, nodeNames: nodeNames, visited: &visited)

            let elementParam = event.parameters.first { $0.type == .nodeReference }
            let elementName = elementParam?.nodeReference.flatMap { nodeNames[$0] }

            return FlowBlueprint(
                name: eventBlocks.count > 1 ? "\(flow.name) — \(event.label)" : flow.name,
                trigger: TriggerBlueprint(type: event.type.rawValue, elementName: elementName),
                steps: steps
            )
        }
    }

    private static func chain(
        from blockId: UUID,
        port: Int,
        in flow: LogicFlow,
        nodeNames: [UUID: String],
        visited: inout Set<UUID>
    ) -> [StepBlueprint] {
        var steps: [StepBlueprint] = []
        var currentId = blockId
        var currentPort = port

        while let connection = flow.connections.first(where: {
            $0.sourceBlockId == currentId && $0.sourcePortIndex == currentPort
        }) {
            guard visited.insert(connection.targetBlockId).inserted,
                  let block = flow.blocks.first(where: { $0.id == connection.targetBlockId })
            else { break }

            let definition = BlockCatalog.definition(for: block.type)
            let isBranching = (definition?.outputPortCount ?? 1) > 1

            if isBranching {
                var successVisited = visited
                var errorVisited = visited
                let onSuccess = chain(from: block.id, port: 0, in: flow, nodeNames: nodeNames, visited: &successVisited)
                let onError = chain(from: block.id, port: 1, in: flow, nodeNames: nodeNames, visited: &errorVisited)
                visited.formUnion(successVisited)
                visited.formUnion(errorVisited)

                steps.append(StepBlueprint(
                    type: block.type.rawValue,
                    parameters: parameterMap(block, nodeNames: nodeNames),
                    onSuccess: onSuccess.isEmpty ? nil : onSuccess,
                    onError: onError.isEmpty ? nil : onError
                ))
                break // branches consume the rest of the chain
            }

            steps.append(StepBlueprint(
                type: block.type.rawValue,
                parameters: parameterMap(block, nodeNames: nodeNames),
                onSuccess: nil,
                onError: nil
            ))

            currentId = block.id
            currentPort = 0
        }

        return steps
    }

    private static func parameterMap(_ block: LogicBlock, nodeNames: [UUID: String]) -> [String: String] {
        var map: [String: String] = [:]

        for param in block.parameters {
            if let nodeId = param.nodeReference, let name = nodeNames[nodeId] {
                map[param.key] = "{{\(name).value}}"
            } else if let variable = param.variableReference, !variable.isEmpty {
                map[param.key] = "{{\(variable)}}"
            } else if let value = param.value, !value.isEmpty {
                map[param.key] = value
            }
        }

        if let comment = block.comment {
            map["_comment"] = comment
        }

        return map
    }

    // MARK: - Dynamic node state
    //
    // The canvas renders each node as fixed literals (a button's fill color,
    // a text's string, a frame's position...). A UI-update block (setText,
    // setColor, animate, ...) that targets a node needs that one property to
    // instead read from published AppState, seeded with the node's designed
    // value so first render is unchanged. This scan finds exactly which
    // (node, property) pairs need that treatment, so every other node keeps
    // emitting plain literals.

    private enum DynamicNodeProperty: Hashable {
        case text, fill, textColor, opacityChannel, image
        case x, y, width, height
    }

    private static func dynamicProperties(in flows: [LogicFlow]) -> [UUID: Set<DynamicNodeProperty>] {
        var result: [UUID: Set<DynamicNodeProperty>] = [:]
        func add(_ nodeId: UUID?, _ property: DynamicNodeProperty) {
            guard let nodeId else { return }
            result[nodeId, default: []].insert(property)
        }
        for flow in flows {
            for block in flow.blocks {
                let element = nodeReference(block, key: "element")
                switch block.type {
                case .setText, .clearField:
                    add(element, .text)
                case .setColor:
                    add(element, (paramValue(block, "property") ?? "fill") == "textColor" ? .textColor : .fill)
                case .setVisible, .setEnabled, .setLoading:
                    add(element, .opacityChannel)
                case .setImage:
                    add(element, .image)
                case .animate:
                    switch paramValue(block, "property") ?? "opacity" {
                    case "opacity": add(element, .opacityChannel)
                    case "scale", "x": add(element, .x); add(element, .y); add(element, .width); add(element, .height)
                    case "y": add(element, .y)
                    case "width": add(element, .width)
                    case "height": add(element, .height)
                    default: break
                    }
                default:
                    break
                }
            }
        }
        return result
    }

    private static func dynamicVarName(_ nodeId: UUID, _ property: DynamicNodeProperty) -> String {
        let short = nodeId.uuidString.replacingOccurrences(of: "-", with: "").prefix(12)
        switch property {
        case .text: return "nodeText_\(short)"
        case .fill: return "nodeFill_\(short)"
        case .textColor: return "nodeTextColor_\(short)"
        case .opacityChannel: return "nodeOpacity_\(short)"
        case .image: return "nodeImage_\(short)"
        case .x: return "nodeX_\(short)"
        case .y: return "nodeY_\(short)"
        case .width: return "nodeWidth_\(short)"
        case .height: return "nodeHeight_\(short)"
        }
    }

    // Emits one @Published line per (node, property) pair, seeded with the
    // node's current designed value so the initial render is unchanged.
    private static func dynamicStateLines(screens: [DesignNode], dynamic: [UUID: Set<DynamicNodeProperty>]) -> String {
        guard !dynamic.isEmpty else { return "" }
        var nodesById: [UUID: DesignNode] = [:]
        func index(_ node: DesignNode) {
            nodesById[node.id] = node
            node.children.forEach(index)
        }
        screens.forEach(index)

        var lines: [String] = []
        for (nodeId, properties) in dynamic.sorted(by: { $0.key.uuidString < $1.key.uuidString }) {
            guard let node = nodesById[nodeId] else { continue }
            for property in properties.sorted(by: { "\($0)" < "\($1)" }) {
                let name = dynamicVarName(nodeId, property)
                switch property {
                case .text:
                    lines.append("@Published var \(name): String = \(swiftString(node.text ?? node.name))")
                case .fill:
                    lines.append("@Published var \(name): String = \(swiftString(node.style.fill))")
                case .textColor:
                    lines.append("@Published var \(name): String = \(swiftString(node.style.textColor ?? node.style.fill))")
                case .opacityChannel:
                    lines.append("@Published var \(name): Double = \(node.style.opacity)")
                case .image:
                    lines.append("@Published var \(name): String = \(swiftString(node.imageSource ?? node.imageName ?? ""))")
                case .x:
                    lines.append("@Published var \(name): Double = \(node.x)")
                case .y:
                    lines.append("@Published var \(name): Double = \(node.y)")
                case .width:
                    lines.append("@Published var \(name): Double = \(node.width)")
                case .height:
                    lines.append("@Published var \(name): Double = \(node.height)")
                }
            }
        }
        return lines.joined(separator: "\n    ")
    }

    // MARK: - SwiftUI source export

    private static func allScreens(project: DesignProject) -> [DesignNode] {
        project.pages.flatMap { page in
            page.nodes.filter { $0.type == .Frame }
        }
    }

    // Live flows are the (possibly unsaved) editor flows for the page the
    // user is currently on; every other page contributes its persisted flows.
    private static func mergedFlows(project: DesignProject, liveFlows: [LogicFlow], currentPageId: UUID?) -> [LogicFlow] {
        guard let livePageId = currentPageId ?? project.pages.first?.id else { return liveFlows }
        return project.pages.flatMap { page in
            page.id == livePageId ? liveFlows : page.logicFlows
        }
    }

    /// Flows dropped by the last export because nothing triggers them. Read by
    /// the export report — a flow that vanishes silently is how a canvas comes
    /// to promise far more than the binary can do.
    private(set) static var lastDroppedFlowNames: [String] = []

    /// THE HONEST LIST. Blocks the palette offers that this exporter cannot
    /// turn into working native code.
    ///
    /// It lives here, next to the codegen, because a truth-check kept in a
    /// separate file drifts the moment someone adds a block — and a stale
    /// truth-check is worse than none: it prints "READY" over a broken app.
    /// If you implement one of these, delete it from this set; if you add a
    /// block without codegen, add it here.
    static let blocksWithoutNativeCodegen: Set<LogicBlockType> = [
        // Events that are never bound to anything in the generated app.
        // onWatchAction is a complication/entry-point event with no host UI
        // to bind to yet; onChange/onShake/onLocationChanged remain unwired.
        .onShake, .onLocationChanged, .onWatchAction, .onChange,
        // Emit nothing / a bare comment.
        .scrollTo, .customAction,
        // Claim success without doing the thing.
        .presentColorPicker, .presentDatePicker,
        .firestoreListenDocument, .firestoreListenQuery, .firestoreBatchWrite,
    ]

    /// Node-level bindings the native export honours. The others are read on
    /// the canvas and in the preview, then discarded — so a view bound to
    /// `.visibility` ships permanently visible.
    static let bindingKindsWithoutNativeSupport: Set<NodeLogicBindingKind> = [
        .selectedIndex,
    ]

    private static func scopedFlowsForExport(_ flows: [LogicFlow], screens: [DesignNode]) -> [LogicFlow] {
        let screenIds = Set(screens.map(\.id))
        let nodeIds = Set(screens.flatMap { flattenedNodeIds($0) })

        let kept = flows.filter { flow in
            isBound(flow, screenIds: screenIds, nodeIds: nodeIds)
        }
        lastDroppedFlowNames = flows
            .filter { !$0.blocks.isEmpty && !isBound($0, screenIds: screenIds, nodeIds: nodeIds) }
            .map(\.name)
        return kept
    }

    /// A flow only reaches the binary if something can trigger it: it belongs
    /// to an exported screen, or one of its blocks is bound to a real element.
    private static func isBound(_ flow: LogicFlow, screenIds: Set<UUID>, nodeIds: Set<UUID>) -> Bool {
        if let screenNodeId = flow.screenNodeId {
            return screenIds.contains(screenNodeId)
        }
        return flow.blocks.contains { block in
            if let connectedDesignNodeId = block.connectedDesignNodeId,
               nodeIds.contains(connectedDesignNodeId) {
                return true
            }
            return block.parameters.contains { parameter in
                guard let nodeReference = parameter.nodeReference else { return false }
                return nodeIds.contains(nodeReference) || screenIds.contains(nodeReference)
            }
        }
    }

    nonisolated private static func flattenedNodeIds(_ node: DesignNode) -> [UUID] {
        [node.id] + node.children.flatMap(flattenedNodeIds)
    }

    // Collects every variable referenced anywhere: explicit project/flow
    // declarations, a block parameter's structured variableReference, a
    // {{var}} placeholder inside any literal (alert copy, URLs, ...), and
    // every node's TextField/toggle logicBindings — any of these leaving a
    // variable undeclared means AppState is missing a @Published property
    // the generated code goes on to reference, which fails to compile.
    // Where a name gets conflicting type hints (e.g. bound as text somewhere
    // and used with Increment elsewhere), the first non-string hint wins.
    private static func mergedVariables(project: DesignProject, flows: [LogicFlow], screens: [DesignNode]) -> [LogicVariable] {
        var declared: [String: LogicVariable] = [:]
        for variable in project.globalVariables + flows.flatMap(\.variables) {
            if declared[variable.name] == nil { declared[variable.name] = variable }
        }

        var inferredTypes: [String: VariableType] = [:]
        func hint(_ name: String, _ type: VariableType) {
            guard !name.isEmpty else { return }
            if inferredTypes[name] == nil || inferredTypes[name] == .string {
                inferredTypes[name] = type
            }
        }

        for flow in flows {
            for block in flow.blocks {
                for param in block.parameters {
                    if let name = param.variableReference {
                        hint(name, inferredVariableType(for: block, parameterKey: param.key))
                    }
                    if let raw = param.value {
                        for name in templateVariableNames(in: raw) { hint(name, .string) }
                    }
                }
            }
        }

        func scanBindings(_ node: DesignNode) {
            for binding in node.logicBindings ?? [] { hint(binding.variableName, .string) }
            node.children.forEach(scanBindings)
        }
        screens.forEach(scanBindings)

        for (name, type) in inferredTypes where declared[name] == nil {
            declared[name] = LogicVariable(name: name, type: type, scope: .global)
        }

        return declared.values.sorted { $0.name < $1.name }
    }

    private static func templateVariableNames(in raw: String) -> [String] {
        guard raw.contains("{{") else { return [] }
        var names: [String] = []
        var remainder = Substring(raw)
        while let openRange = remainder.range(of: "{{") {
            remainder = remainder[openRange.upperBound...]
            guard let closeRange = remainder.range(of: "}}") else { break }
            names.append(String(remainder[remainder.startIndex..<closeRange.lowerBound]).trimmingCharacters(in: .whitespaces))
            remainder = remainder[closeRange.upperBound...]
        }
        return names
    }

    private static func copyImageAssets(from screens: [DesignNode], to resources: URL) throws -> [String: String] {
        var paths: [String] = []

        func walk(_ node: DesignNode) {
            for candidate in [node.imageSource, node.imageName].compactMap({ $0 }) {
                if FileManager.default.fileExists(atPath: candidate), !paths.contains(candidate) {
                    paths.append(candidate)
                }
            }
            node.children.forEach(walk)
        }

        screens.forEach(walk)
        guard !paths.isEmpty else { return [:] }

        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)

        var result: [String: String] = [:]
        var usedNames = Set<String>()
        for path in paths {
            let source = URL(fileURLWithPath: path)
            let ext = source.pathExtension.isEmpty ? "png" : source.pathExtension
            let rawBase = source.deletingPathExtension().lastPathComponent
            let base = swiftIdentifier(rawBase, fallback: "ImageAsset")
            var resourceName = base
            var index = 2
            while usedNames.contains(resourceName) {
                resourceName = "\(base)\(index)"
                index += 1
            }
            usedNames.insert(resourceName)

            let destination = resources.appendingPathComponent(resourceName).appendingPathExtension(ext)
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.copyItem(at: source, to: destination)
            result[path] = destination.lastPathComponent
        }

        return result
    }

    // MARK: - 2D game export

    /// Stable bundle-resource base name for a game node's scene JSON. Shared by
    /// the code generator (nodeViews) and the resource writer so they always
    /// agree without threading a lookup map through every call.
    static func gameSceneResourceName(for node: DesignNode) -> String {
        "GameScene_" + node.id.uuidString.replacingOccurrences(of: "-", with: "")
    }

    private static func collectGameNodes(_ nodes: [DesignNode]) -> [DesignNode] {
        var found: [DesignNode] = []
        func walk(_ n: DesignNode) {
            if n.gameScene != nil { found.append(n) }
            n.children.forEach(walk)
        }
        nodes.forEach(walk)
        return found
    }

    /// The SpriteKit runtime source (AgentGameKit.swift), shipped as a bundled
    /// resource so it can be copied verbatim into exports. Same code that powers
    /// the in-app preview — one engine, both surfaces.
    private static func gameRuntimeSource() -> String? {
        let candidates: [(String, String?)] = [("AgentGameKit", "swifttext"), ("AgentGameKit", "swift")]
        for (name, ext) in candidates {
            if let url = Bundle.main.url(forResource: name, withExtension: ext, subdirectory: "Resources")
                ?? Bundle.main.url(forResource: name, withExtension: ext),
               let source = try? String(contentsOf: url, encoding: .utf8) {
                return source
            }
        }
        return nil
    }

    /// Copies the runtime, writes each game scene's JSON, and copies its sprite
    /// art into the export's Resources — rewriting each entity's sprite path to
    /// the bundled file name the runtime resolves at load time.
    private static func exportGameScenes(from screens: [DesignNode], sharedDir: URL, resources: URL) throws {
        let gameNodes = collectGameNodes(screens)
        guard !gameNodes.isEmpty else { return }

        // 1. The engine.
        if let runtime = gameRuntimeSource() {
            try runtime.write(to: sharedDir.appendingPathComponent("AgentGameKit.swift"), atomically: true, encoding: .utf8)
        }

        try FileManager.default.createDirectory(at: resources, withIntermediateDirectories: true)
        var usedSpriteNames = Set<String>()

        // Copies one asset into Resources and returns its bundled file name.
        // nil when the path doesn't resolve to a real file.
        func bundleAsset(_ src: String?) throws -> String? {
            guard let src, FileManager.default.fileExists(atPath: src) else { return nil }
            let source = URL(fileURLWithPath: src)
            let ext = source.pathExtension.isEmpty ? "png" : source.pathExtension
            let rawBase = source.deletingPathExtension().lastPathComponent
            var resourceName = swiftIdentifier(rawBase, fallback: "Sprite")
            var index = 2
            while usedSpriteNames.contains(resourceName) {
                resourceName = "\(swiftIdentifier(rawBase, fallback: "Sprite"))\(index)"
                index += 1
            }
            usedSpriteNames.insert(resourceName)
            let destination = resources.appendingPathComponent(resourceName).appendingPathExtension(ext)
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.copyItem(at: source, to: destination)
            return destination.lastPathComponent
        }

        for node in gameNodes {
            guard var spec = node.effectiveGameSpec else { continue }

            // 2. Copy every referenced asset — sprites, animation frames,
            //    parallax layers, background, music — rewriting to bundle names.
            for i in spec.entities.indices {
                if let bundled = try bundleAsset(spec.entities[i].sprite) {
                    spec.entities[i].sprite = bundled
                }
                if let frames = spec.entities[i].frames {
                    spec.entities[i].frames = try frames.map { try bundleAsset($0) ?? $0 }
                }
            }
            for i in spec.parallax.indices {
                if let bundled = try bundleAsset(spec.parallax[i].sprite) {
                    spec.parallax[i].sprite = bundled
                }
            }
            if let bundled = try bundleAsset(spec.backgroundImage) { spec.backgroundImage = bundled }
            if let bundled = try bundleAsset(spec.music) { spec.music = bundled }

            // 3. Bundle the scene JSON under the shared resource name.
            let encoder = JSONEncoder()
            let data = try encoder.encode(spec)
            let jsonURL = resources.appendingPathComponent(gameSceneResourceName(for: node)).appendingPathExtension("json")
            try data.write(to: jsonURL, options: .atomic)
        }
    }

    private static func inferredVariableType(for block: LogicBlock, parameterKey: String) -> VariableType {
        switch block.type {
        case .toggleVariable:
            return .boolean
        case .incrementVariable, .decrementVariable, .mathOperation:
            return .number
        // Sensor readings are numeric. Without these, the variable is inferred
        // as String and the generated `state.latitude = location...latitude`
        // assigns a Double into a String — the exported package fails to build.
        case .getLocation, .onLocationChanged, .readHeartRate, .readStepCount,
             .readMotion, .readBatteryLevel:
            return .number
        case .appendToArray, .removeFromArray, .arrayOperation:
            return .array
        default:
            return .string
        }
    }

    // A real .xcodeproj (objectVersion 77 / Xcode 16+). Uses synchronized
    // folder groups so the target's file list is the folder's contents — no
    // per-file PBXBuildFile bookkeeping to drift out of sync. The exact
    // structure here was verified to `xcodebuild ... build` a signable .app,
    // and to embed a watchOS app bundle at <app>.app/Watch/ when watch is on.
    private static func xcodeProjectPBX(
        appName: String,
        bundleId: String,
        hasWatch: Bool,
        usageDescriptions: [(key: String, value: String)],
        needsBackgroundLocation: Bool,
        firebaseEnabled: Bool,
        usesPush: Bool = false,
        orientation: AppOrientation = .portrait,
        developmentTeam: String? = nil,
        forcedInterfaceStyle: String? = nil
    ) -> String {
        func infoplistLine(_ key: String, _ value: String) -> String {
            let escaped = value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"")
            return "\t\t\t\tINFOPLIST_KEY_\(key) = \"\(escaped)\";"
        }
        // iOS usage-description keys come straight from the flows. Array keys
        // like UIBackgroundModes are NOT expressible as INFOPLIST_KEY_* build
        // settings (they silently drop), so those go in a partial Info.plist
        // (written at the project root, outside the synchronized folders) that
        // Xcode MERGES with the generated keys via INFOPLIST_FILE.
        var iosKeys = usageDescriptions.map { infoplistLine($0.key, $0.value) }
        if needsBackgroundLocation {
            iosKeys.append(infoplistLine("NSLocationAlwaysAndWhenInUseUsageDescription",
                "Your location is tracked during an activity, including when the screen is locked, so distance and pace stay accurate."))
        }
        let iosUsage = iosKeys.sorted().joined(separator: "\n")
        // Orientation: a landscape game that ships portrait-locked is a broken
        // product, so the project setting becomes a real build setting.
        let orientationSettings: String = {
            guard orientation != .portrait else { return "" }
            let phone = orientation.plistOrientations.joined(separator: " ")
            return "\t\t\t\tINFOPLIST_KEY_UISupportedInterfaceOrientations_iPhone = \"\(phone)\";\n"
                 + "\t\t\t\tINFOPLIST_KEY_UISupportedInterfaceOrientations_iPad = \"\(phone) UIInterfaceOrientationPortraitUpsideDown\";\n"
        }()
        let infoplistFileLine = needsBackgroundLocation ? "\t\t\t\tINFOPLIST_FILE = Info.plist;\n" : ""
        let entitlementsLine = usesPush ? "\t\t\t\tCODE_SIGN_ENTITLEMENTS = \(appName).entitlements;\n" : ""

        // The watch target always reads Health (the workout service uses
        // HKWorkoutSession + live heart rate), so it always needs those keys.
        let watchKeys = [
            infoplistLine("NSHealthShareUsageDescription", "Heart rate and step data are read to show your activity statistics."),
            infoplistLine("NSHealthUpdateUsageDescription", "Workout data is written to Health so your activity stays in one place."),
            "\t\t\t\tINFOPLIST_KEY_WKApplication = YES;",
            "\t\t\t\tINFOPLIST_KEY_WKCompanionAppBundleIdentifier = \(bundleId);"
        ].sorted().joined(separator: "\n")

        // Signing team, so a fresh export runs on a device / archives without
        // opening Xcode to click one dropdown. Forced interface style keeps
        // system chrome (alerts, keyboard, sheets) matched to the single
        // authored palette until real adaptive dark palettes exist — a light
        // app with a dark keyboard reads as broken.
        let teamLine = developmentTeam.map { "\t\t\t\tDEVELOPMENT_TEAM = \($0);\n" } ?? ""
        let styleLine = forcedInterfaceStyle.map { "\t\t\t\tINFOPLIST_KEY_UIUserInterfaceStyle = \($0);\n" } ?? ""

        func iosBuildSettings(_ configName: String) -> String {
            """
            \t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
            \t\t\t\tASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS = YES;
            \t\t\t\tCODE_SIGN_STYLE = Automatic;
            \(teamLine)\(styleLine)\(entitlementsLine)\t\t\t\tCURRENT_PROJECT_VERSION = 1;
            \t\t\t\tGENERATE_INFOPLIST_FILE = YES;
            \(infoplistFileLine)\t\t\t\tINFOPLIST_KEY_UIApplicationSceneManifest_Generation = YES;
            \t\t\t\tINFOPLIST_KEY_UILaunchScreen_Generation = YES;
            \(orientationSettings)\(iosUsage.isEmpty ? "" : iosUsage + "\n")\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = 17.0;
            \t\t\t\tMARKETING_VERSION = 1.0;
            \t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = \(bundleId);
            \t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
            \t\t\t\tSDKROOT = iphoneos;
            \t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;
            \t\t\t\tSWIFT_VERSION = 5.0;
            \t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";
            """
        }
        func watchBuildSettings(_ configName: String) -> String {
            """
            \t\t\t\tASSETCATALOG_COMPILER_APPICON_NAME = AppIcon;
            \t\t\t\tASSETCATALOG_COMPILER_GENERATE_ASSET_SYMBOLS = YES;
            \t\t\t\tCODE_SIGN_STYLE = Automatic;
            \(teamLine)\t\t\t\tCURRENT_PROJECT_VERSION = 1;
            \t\t\t\tGENERATE_INFOPLIST_FILE = YES;
            \t\t\t\tINFOPLIST_KEY_CFBundleDisplayName = \(appName);
            \(watchKeys)
            \t\t\t\tMARKETING_VERSION = 1.0;
            \t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = \(bundleId).watchkitapp;
            \t\t\t\tPRODUCT_NAME = "$(TARGET_NAME)";
            \t\t\t\tSDKROOT = watchos;
            \t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;
            \t\t\t\tSWIFT_VERSION = 5.0;
            \t\t\t\tTARGETED_DEVICE_FAMILY = 4;
            \t\t\t\tWATCHOS_DEPLOYMENT_TARGET = 10.0;
            """
        }

        // Section fragments that only exist when the watch target is present.
        // Firebase Swift Package. Added only when the project has configured
        // Firebase — then it's what the user wants, and the #if canImport
        // guards flip to the real SDK. The three products match the imports the
        // generated code and Package.swift already use.
        let firebaseProducts = [
            ("FirebaseAuth", "DEAD00000000000000000021", "DEAD00000000000000000024"),
            ("FirebaseFirestore", "DEAD00000000000000000022", "DEAD00000000000000000025"),
            ("FirebaseAnalytics", "DEAD00000000000000000023", "DEAD00000000000000000026"),
        ]
        var buildFileEntries: [String] = []
        if hasWatch {
            buildFileEntries.append("\t\tDEAD0000000000000000001B /* \(appName)Watch.app in Embed Watch Content */ = {isa = PBXBuildFile; fileRef = DEAD0000000000000000000A /* \(appName)Watch.app */; settings = {ATTRIBUTES = (RemoveHeadersOnCopy, ); }; };")
        }
        if firebaseEnabled {
            for (name, prodId, buildId) in firebaseProducts {
                buildFileEntries.append("\t\t\(buildId) /* \(name) in Frameworks */ = {isa = PBXBuildFile; productRef = \(prodId) /* \(name) */; };")
            }
        }
        let buildFileSection = buildFileEntries.isEmpty ? "" : """

        /* Begin PBXBuildFile section */
        \(buildFileEntries.joined(separator: "\n"))
        /* End PBXBuildFile section */
        """

        let iosFrameworkFiles = firebaseEnabled
            ? "\n" + firebaseProducts.map { "\t\t\t\t\($0.2) /* \($0.0) in Frameworks */," }.joined(separator: "\n") + "\n\t\t\t"
            : ""
        let iosPackageDeps = firebaseEnabled
            ? "\n\t\t\tpackageProductDependencies = (\n" + firebaseProducts.map { "\t\t\t\t\($0.1) /* \($0.0) */," }.joined(separator: "\n") + "\n\t\t\t);"
            : ""
        let projectPackageRefs = firebaseEnabled
            ? "\n\t\t\tpackageReferences = (\n\t\t\t\tDEAD00000000000000000020 /* XCRemoteSwiftPackageReference \"firebase-ios-sdk\" */,\n\t\t\t);"
            : ""
        let packageRefSection = firebaseEnabled ? """


        /* Begin XCRemoteSwiftPackageReference section */
        \t\tDEAD00000000000000000020 /* XCRemoteSwiftPackageReference "firebase-ios-sdk" */ = {
        \t\t\tisa = XCRemoteSwiftPackageReference;
        \t\t\trepositoryURL = "https://github.com/firebase/firebase-ios-sdk";
        \t\t\trequirement = {
        \t\t\t\tkind = upToNextMajorVersion;
        \t\t\t\tminimumVersion = 10.0.0;
        \t\t\t};
        \t\t};
        /* End XCRemoteSwiftPackageReference section */

        /* Begin XCSwiftPackageProductDependency section */
        \(firebaseProducts.map { name, prodId, _ in
        "\t\t\(prodId) /* \(name) */ = {\n\t\t\tisa = XCSwiftPackageProductDependency;\n\t\t\tpackage = DEAD00000000000000000020 /* XCRemoteSwiftPackageReference \"firebase-ios-sdk\" */;\n\t\t\tproductName = \(name);\n\t\t};"
        }.joined(separator: "\n"))
        /* End XCSwiftPackageProductDependency section */
        """ : ""

        let containerProxySection = hasWatch ? """

        /* Begin PBXContainerItemProxy section */
        \t\tDEAD0000000000000000001D /* PBXContainerItemProxy */ = {
        \t\t\tisa = PBXContainerItemProxy;
        \t\t\tcontainerPortal = DEAD00000000000000000001 /* Project object */;
        \t\t\tproxyType = 1;
        \t\t\tremoteGlobalIDString = DEAD00000000000000000008;
        \t\t\tremoteInfo = \(appName)Watch;
        \t\t};
        /* End PBXContainerItemProxy section */
        """ : ""

        let copyFilesSection = hasWatch ? """

        /* Begin PBXCopyFilesBuildPhase section */
        \t\tDEAD00000000000000000017 /* Embed Watch Content */ = {
        \t\t\tisa = PBXCopyFilesBuildPhase;
        \t\t\tbuildActionMask = 2147483647;
        \t\t\tdstPath = "$(CONTENTS_FOLDER_PATH)/Watch";
        \t\t\tdstSubfolderSpec = 16;
        \t\t\tfiles = (
        \t\t\t\tDEAD0000000000000000001B /* \(appName)Watch.app in Embed Watch Content */,
        \t\t\t);
        \t\t\tname = "Embed Watch Content";
        \t\t\trunOnlyForDeploymentPostprocessing = 0;
        \t\t};
        /* End PBXCopyFilesBuildPhase section */
        """ : ""

        let watchFileRef = hasWatch ? "\n\t\tDEAD0000000000000000000A /* \(appName)Watch.app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = \(appName)Watch.app; sourceTree = BUILT_PRODUCTS_DIR; };" : ""
        let watchSyncGroup = hasWatch ? """

        \t\tDEAD00000000000000000006 /* Watch */ = {
        \t\t\tisa = PBXFileSystemSynchronizedRootGroup;
        \t\t\tpath = Watch;
        \t\t\tsourceTree = "<group>";
        \t\t};
        """ : ""
        let watchGroupChild = hasWatch ? "\n\t\t\t\tDEAD00000000000000000006 /* Watch */," : ""
        let watchProductChild = hasWatch ? "\n\t\t\t\tDEAD0000000000000000000A /* \(appName)Watch.app */," : ""
        let watchFrameworksPhase = hasWatch ? "\n\t\tDEAD00000000000000000019 /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };" : ""
        let watchSourcesPhase = hasWatch ? "\n\t\tDEAD00000000000000000018 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };" : ""
        let watchResourcesPhase = hasWatch ? "\n\t\tDEAD0000000000000000001A /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };" : ""
        let iosEmbedPhaseRef = hasWatch ? "\n\t\t\t\tDEAD00000000000000000017 /* Embed Watch Content */," : ""
        let iosDependency = hasWatch ? "\n\t\t\t\tDEAD0000000000000000001C /* PBXTargetDependency */," : ""
        let watchTarget = hasWatch ? """

        \t\tDEAD00000000000000000008 /* \(appName)Watch */ = {
        \t\t\tisa = PBXNativeTarget;
        \t\t\tbuildConfigurationList = DEAD0000000000000000000D /* Build configuration list for PBXNativeTarget "\(appName)Watch" */;
        \t\t\tbuildPhases = (
        \t\t\t\tDEAD00000000000000000018 /* Sources */,
        \t\t\t\tDEAD00000000000000000019 /* Frameworks */,
        \t\t\t\tDEAD0000000000000000001A /* Resources */,
        \t\t\t);
        \t\t\tbuildRules = ();
        \t\t\tdependencies = ();
        \t\t\tfileSystemSynchronizedGroups = (
        \t\t\t\tDEAD00000000000000000004 /* Shared */,
        \t\t\t\tDEAD00000000000000000006 /* Watch */,
        \t\t\t);
        \t\t\tname = \(appName)Watch;
        \t\t\tproductName = \(appName)Watch;
        \t\t\tproductReference = DEAD0000000000000000000A /* \(appName)Watch.app */;
        \t\t\tproductType = "com.apple.product-type.application";
        \t\t};
        """ : ""
        let targetDependencySection = hasWatch ? """

        /* Begin PBXTargetDependency section */
        \t\tDEAD0000000000000000001C /* PBXTargetDependency */ = {
        \t\t\tisa = PBXTargetDependency;
        \t\t\ttarget = DEAD00000000000000000008 /* \(appName)Watch */;
        \t\t\ttargetProxy = DEAD0000000000000000001D /* PBXContainerItemProxy */;
        \t\t};
        /* End PBXTargetDependency section */
        """ : ""
        let watchTargetAttr = hasWatch ? "\n\t\t\t\t\tDEAD00000000000000000008 = {CreatedOnToolsVersion = 26.6; };" : ""
        let watchTargetRef = hasWatch ? "\n\t\t\t\tDEAD00000000000000000008 /* \(appName)Watch */," : ""
        let watchBuildConfigs = hasWatch ? """

        \t\tDEAD00000000000000000012 /* Debug */ = {
        \t\t\tisa = XCBuildConfiguration;
        \t\t\tbuildSettings = {
        \(watchBuildSettings("Debug"))
        \t\t\t};
        \t\t\tname = Debug;
        \t\t};
        \t\tDEAD00000000000000000013 /* Release */ = {
        \t\t\tisa = XCBuildConfiguration;
        \t\t\tbuildSettings = {
        \(watchBuildSettings("Release"))
        \t\t\t};
        \t\t\tname = Release;
        \t\t};
        """ : ""
        let watchConfigList = hasWatch ? """

        \t\tDEAD0000000000000000000D /* Build configuration list for PBXNativeTarget "\(appName)Watch" */ = {
        \t\t\tisa = XCConfigurationList;
        \t\t\tbuildConfigurations = (DEAD00000000000000000012 /* Debug */, DEAD00000000000000000013 /* Release */, );
        \t\t\tdefaultConfigurationIsVisible = 0;
        \t\t\tdefaultConfigurationName = Release;
        \t\t};
        """ : ""

        return """
        // !$*UTF8*$!
        {
        \tarchiveVersion = 1;
        \tclasses = {
        \t};
        \tobjectVersion = 77;
        \tobjects = {
        \(buildFileSection)\(containerProxySection)\(copyFilesSection)

        /* Begin PBXFileReference section */
        \t\tDEAD00000000000000000009 /* \(appName).app */ = {isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = \(appName).app; sourceTree = BUILT_PRODUCTS_DIR; };\(watchFileRef)
        /* End PBXFileReference section */

        /* Begin PBXFileSystemSynchronizedRootGroup section */
        \t\tDEAD00000000000000000004 /* Shared */ = {
        \t\t\tisa = PBXFileSystemSynchronizedRootGroup;
        \t\t\tpath = Shared;
        \t\t\tsourceTree = "<group>";
        \t\t};
        \t\tDEAD00000000000000000005 /* iOS */ = {
        \t\t\tisa = PBXFileSystemSynchronizedRootGroup;
        \t\t\tpath = iOS;
        \t\t\tsourceTree = "<group>";
        \t\t};\(watchSyncGroup)
        /* End PBXFileSystemSynchronizedRootGroup section */

        /* Begin PBXFrameworksBuildPhase section */
        \t\tDEAD00000000000000000015 /* Frameworks */ = {isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (\(iosFrameworkFiles)); runOnlyForDeploymentPostprocessing = 0; };\(watchFrameworksPhase)
        /* End PBXFrameworksBuildPhase section */

        /* Begin PBXGroup section */
        \t\tDEAD00000000000000000002 /* main */ = {
        \t\t\tisa = PBXGroup;
        \t\t\tchildren = (
        \t\t\t\tDEAD00000000000000000004 /* Shared */,
        \t\t\t\tDEAD00000000000000000005 /* iOS */,\(watchGroupChild)
        \t\t\t\tDEAD00000000000000000003 /* Products */,
        \t\t\t);
        \t\t\tsourceTree = "<group>";
        \t\t};
        \t\tDEAD00000000000000000003 /* Products */ = {
        \t\t\tisa = PBXGroup;
        \t\t\tchildren = (
        \t\t\t\tDEAD00000000000000000009 /* \(appName).app */,\(watchProductChild)
        \t\t\t);
        \t\t\tname = Products;
        \t\t\tsourceTree = "<group>";
        \t\t};
        /* End PBXGroup section */

        /* Begin PBXNativeTarget section */
        \t\tDEAD00000000000000000007 /* \(appName) */ = {
        \t\t\tisa = PBXNativeTarget;
        \t\t\tbuildConfigurationList = DEAD0000000000000000000C /* Build configuration list for PBXNativeTarget "\(appName)" */;
        \t\t\tbuildPhases = (
        \t\t\t\tDEAD00000000000000000014 /* Sources */,
        \t\t\t\tDEAD00000000000000000015 /* Frameworks */,
        \t\t\t\tDEAD00000000000000000016 /* Resources */,\(iosEmbedPhaseRef)
        \t\t\t);
        \t\t\tbuildRules = ();
        \t\t\tdependencies = (\(iosDependency)
        \t\t\t);
        \t\t\tfileSystemSynchronizedGroups = (
        \t\t\t\tDEAD00000000000000000004 /* Shared */,
        \t\t\t\tDEAD00000000000000000005 /* iOS */,
        \t\t\t);
        \t\t\tname = \(appName);\(iosPackageDeps)
        \t\t\tproductName = \(appName);
        \t\t\tproductReference = DEAD00000000000000000009 /* \(appName).app */;
        \t\t\tproductType = "com.apple.product-type.application";
        \t\t};\(watchTarget)
        /* End PBXNativeTarget section */

        /* Begin PBXProject section */
        \t\tDEAD00000000000000000001 /* Project object */ = {
        \t\t\tisa = PBXProject;
        \t\t\tattributes = {
        \t\t\t\tBuildIndependentTargetsInParallel = 1;
        \t\t\t\tLastSwiftUpdateCheck = 2660;
        \t\t\t\tLastUpgradeCheck = 2660;
        \t\t\t\tTargetAttributes = {
        \t\t\t\t\tDEAD00000000000000000007 = {CreatedOnToolsVersion = 26.6; };\(watchTargetAttr)
        \t\t\t\t};
        \t\t\t};
        \t\t\tbuildConfigurationList = DEAD0000000000000000000B /* Build configuration list for PBXProject "\(appName)" */;
        \t\t\tcompatibilityVersion = "Xcode 15.0";
        \t\t\tdevelopmentRegion = en;
        \t\t\thasScannedForEncodings = 0;
        \t\t\tknownRegions = (en, Base, );
        \t\t\tmainGroup = DEAD00000000000000000002 /* main */;
        \t\t\tminimizedProjectReferenceProxies = 1;
        \t\t\tpreferredProjectObjectVersion = 77;
        \t\t\tproductRefGroup = DEAD00000000000000000003 /* Products */;\(projectPackageRefs)
        \t\t\tprojectDirPath = "";
        \t\t\tprojectRoot = "";
        \t\t\ttargets = (
        \t\t\t\tDEAD00000000000000000007 /* \(appName) */,\(watchTargetRef)
        \t\t\t);
        \t\t};
        /* End PBXProject section */

        /* Begin PBXResourcesBuildPhase section */
        \t\tDEAD00000000000000000016 /* Resources */ = {isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };\(watchResourcesPhase)
        /* End PBXResourcesBuildPhase section */

        /* Begin PBXSourcesBuildPhase section */
        \t\tDEAD00000000000000000014 /* Sources */ = {isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0; };\(watchSourcesPhase)
        /* End PBXSourcesBuildPhase section */\(targetDependencySection)

        /* Begin XCBuildConfiguration section */
        \t\tDEAD0000000000000000000E /* Debug */ = {
        \t\t\tisa = XCBuildConfiguration;
        \t\t\tbuildSettings = {
        \t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
        \t\t\t\tCLANG_ENABLE_MODULES = YES;
        \t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu17;
        \t\t\t\tONLY_ACTIVE_ARCH = YES;
        \t\t\t\tSWIFT_OPTIMIZATION_LEVEL = "-Onone";
        \t\t\t\tSWIFT_VERSION = 5.0;
        \t\t\t};
        \t\t\tname = Debug;
        \t\t};
        \t\tDEAD0000000000000000000F /* Release */ = {
        \t\t\tisa = XCBuildConfiguration;
        \t\t\tbuildSettings = {
        \t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
        \t\t\t\tCLANG_ENABLE_MODULES = YES;
        \t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu17;
        \t\t\t\tSWIFT_COMPILATION_MODE = wholemodule;
        \t\t\t\tSWIFT_VERSION = 5.0;
        \t\t\t};
        \t\t\tname = Release;
        \t\t};
        \t\tDEAD00000000000000000010 /* Debug */ = {
        \t\t\tisa = XCBuildConfiguration;
        \t\t\tbuildSettings = {
        \(iosBuildSettings("Debug"))
        \t\t\t};
        \t\t\tname = Debug;
        \t\t};
        \t\tDEAD00000000000000000011 /* Release */ = {
        \t\t\tisa = XCBuildConfiguration;
        \t\t\tbuildSettings = {
        \(iosBuildSettings("Release"))
        \t\t\t};
        \t\t\tname = Release;
        \t\t};\(watchBuildConfigs)
        /* End XCBuildConfiguration section */

        /* Begin XCConfigurationList section */
        \t\tDEAD0000000000000000000B /* Build configuration list for PBXProject "\(appName)" */ = {
        \t\t\tisa = XCConfigurationList;
        \t\t\tbuildConfigurations = (DEAD0000000000000000000E /* Debug */, DEAD0000000000000000000F /* Release */, );
        \t\t\tdefaultConfigurationIsVisible = 0;
        \t\t\tdefaultConfigurationName = Release;
        \t\t};
        \t\tDEAD0000000000000000000C /* Build configuration list for PBXNativeTarget "\(appName)" */ = {
        \t\t\tisa = XCConfigurationList;
        \t\t\tbuildConfigurations = (DEAD00000000000000000010 /* Debug */, DEAD00000000000000000011 /* Release */, );
        \t\t\tdefaultConfigurationIsVisible = 0;
        \t\t\tdefaultConfigurationName = Release;
        \t\t};\(watchConfigList)
        /* End XCConfigurationList section */\(packageRefSection)
        \t};
        \trootObject = DEAD00000000000000000001 /* Project object */;
        }

        """
    }

    // MARK: - StoreKit test config + shared scheme

    /// The literal product ids a flow tries to buy (templated ids can't be
    /// pre-seeded, so they're skipped).
    private static func purchaseProductIds(in flows: [LogicFlow]) -> [String] {
        var ids: [String] = []
        var seen: Set<String> = []
        for flow in flows {
            for block in flow.blocks where block.type == .purchaseProduct {
                guard let id = paramValue(block, "productId"),
                      !id.isEmpty, !id.contains("{{"), seen.insert(id).inserted else { continue }
                ids.append(id)
            }
        }
        return ids
    }

    /// A .storekit configuration so purchases can be TESTED in the simulator
    /// with no App Store Connect setup. Products default to non-consumable at
    /// $4.99 — the developer tweaks type/price in Xcode's StoreKit editor.
    private static func storeKitConfigSource(productIds: [String]) -> String {
        let products = productIds.enumerated().map { index, id -> String in
            let internalId = String(format: "%08X", index + 1)
            let name = id.split(separator: ".").last.map(String.init) ?? "Product"
            return """
                    {
                      "displayPrice" : "4.99",
                      "familyShareable" : false,
                      "internalID" : "\(internalId)",
                      "localizations" : [
                        {
                          "description" : "\(name)",
                          "displayName" : "\(name)",
                          "locale" : "en_US"
                        }
                      ],
                      "productID" : "\(id)",
                      "referenceName" : "\(name)",
                      "type" : "NonConsumable"
                    }
            """
        }.joined(separator: ",\n")
        return """
        {
          "identifier" : "5D8C3F1A",
          "nonRenewingSubscriptions" : [],
          "products" : [
        \(products)
          ],
          "settings" : {
            "_billingIssuesEnabled" : false,
            "_failTransactionsEnabled" : false
          },
          "subscriptionGroups" : [],
          "version" : {
            "major" : 3,
            "minor" : 0
          }
        }

        """
    }

    /// A shared scheme. Needed for two reasons: it makes `xcodebuild -scheme`
    /// deterministic, and it's the only place a StoreKit test configuration can
    /// be attached to the Run action.
    private static func xcodeSchemeSource(appName: String, storeKitConfig: Bool) -> String {
        let storeKitRef = storeKitConfig
            ? "\n      <StoreKitConfigurationFileReference\n         identifier = \"../Products.storekit\">\n      </StoreKitConfigurationFileReference>"
            : ""
        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <Scheme
           LastUpgradeVersion = "2660"
           version = "1.7">
           <BuildAction
              parallelizeBuildables = "YES"
              buildImplicitDependencies = "YES">
              <BuildActionEntries>
                 <BuildActionEntry
                    buildForTesting = "YES"
                    buildForRunning = "YES"
                    buildForProfiling = "YES"
                    buildForArchiving = "YES"
                    buildForAnalyzing = "YES">
                    <BuildableReference
                       BuildableIdentifier = "primary"
                       BlueprintIdentifier = "DEAD00000000000000000007"
                       BuildableName = "\(appName).app"
                       BlueprintName = "\(appName)"
                       ReferencedContainer = "container:\(appName).xcodeproj">
                    </BuildableReference>
                 </BuildActionEntry>
              </BuildActionEntries>
           </BuildAction>
           <TestAction
              buildConfiguration = "Debug"
              selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
              selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
              shouldUseLaunchSchemeArgsEnv = "YES">
           </TestAction>
           <LaunchAction
              buildConfiguration = "Debug"
              selectedDebuggerIdentifier = "Xcode.DebuggerFoundation.Debugger.LLDB"
              selectedLauncherIdentifier = "Xcode.DebuggerFoundation.Launcher.LLDB"
              launchStyle = "0"
              useCustomWorkingDirectory = "NO"
              ignoresPersistentStateOnLaunch = "NO"
              debugDocumentVersioning = "YES"
              debugServiceExtension = "internal"
              allowLocationSimulation = "YES">
              <BuildableProductRunnable
                 runnableDebuggingMode = "0">
                 <BuildableReference
                    BuildableIdentifier = "primary"
                    BlueprintIdentifier = "DEAD00000000000000000007"
                    BuildableName = "\(appName).app"
                    BlueprintName = "\(appName)"
                    ReferencedContainer = "container:\(appName).xcodeproj">
                 </BuildableReference>
              </BuildableProductRunnable>\(storeKitRef)
           </LaunchAction>
           <ProfileAction
              buildConfiguration = "Release"
              shouldUseLaunchSchemeArgsEnv = "YES"
              savedToolIdentifier = ""
              useCustomWorkingDirectory = "NO"
              debugDocumentVersioning = "YES">
              <BuildableProductRunnable
                 runnableDebuggingMode = "0">
                 <BuildableReference
                    BuildableIdentifier = "primary"
                    BlueprintIdentifier = "DEAD00000000000000000007"
                    BuildableName = "\(appName).app"
                    BlueprintName = "\(appName)"
                    ReferencedContainer = "container:\(appName).xcodeproj">
                 </BuildableReference>
              </BuildableProductRunnable>
           </ProfileAction>
           <AnalyzeAction
              buildConfiguration = "Debug">
           </AnalyzeAction>
           <ArchiveAction
              buildConfiguration = "Release"
              revealArchiveInOrganizer = "YES">
           </ArchiveAction>
        </Scheme>

        """
    }

    // MARK: - App icon + privacy manifest (App Store submission blockers)

    /// Writes an Assets.xcassets with a real 1024×1024 AppIcon into `folder`.
    /// A blank icon is both an App Store rejection and looks broken; this gives
    /// a clean branded placeholder the user can replace.
    private static func writeAppIcon(to folder: URL, appName: String, hex: String?, platform: String = "ios") throws {
        let catalog = folder.appendingPathComponent("Assets.xcassets", isDirectory: true)
        let iconSet = catalog.appendingPathComponent("AppIcon.appiconset", isDirectory: true)
        try FileManager.default.createDirectory(at: iconSet, withIntermediateDirectories: true)
        try #"{"info":{"author":"xcode","version":1}}"#
            .write(to: catalog.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
        try "{\"images\":[{\"filename\":\"icon-1024.png\",\"idiom\":\"universal\",\"platform\":\"\(platform)\",\"size\":\"1024x1024\"}],\"info\":{\"author\":\"xcode\",\"version\":1}}"
            .write(to: iconSet.appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
        if let png = appIconPNGData(appName: appName, hex: hex) {
            try png.write(to: iconSet.appendingPathComponent("icon-1024.png"))
        }
    }

    private static func appIconPNGData(appName: String, hex: String?) -> Data? {
        let side = 1024
        guard let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
              let ctx = NSGraphicsContext(bitmapImageRep: rep) else { return nil }
        let size = CGFloat(side)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = ctx
        let base = nsColor(fromHex: hex) ?? deterministicColor(for: appName)
        let top = base.blended(withFraction: 0.22, of: .white) ?? base
        // App icons are square with no transparency; the OS masks the corners.
        NSGradient(colors: [top, base])?.draw(in: NSRect(x: 0, y: 0, width: size, height: size), angle: -90)
        let letter = String(appName.first.map { String($0).uppercased() } ?? "A")
        let paragraph = NSMutableParagraphStyle()
        paragraph.alignment = .center
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 560, weight: .bold),
            .foregroundColor: NSColor.white.withAlphaComponent(0.95),
            .paragraphStyle: paragraph
        ]
        let str = NSAttributedString(string: letter, attributes: attrs)
        let textSize = str.size()
        str.draw(at: NSPoint(x: (size - textSize.width) / 2, y: (size - textSize.height) / 2))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    private static func nsColor(fromHex hex: String?) -> NSColor? {
        guard var value = hex, value.hasPrefix("#") else { return nil }
        value.removeFirst()
        guard value.count == 6, let rgb = Int(value, radix: 16) else { return nil }
        return NSColor(
            srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }

    /// A stable colour per app name, so no-brand exports still get a distinct
    /// icon instead of all sharing one grey.
    private static func deterministicColor(for name: String) -> NSColor {
        let hue = CGFloat(abs(name.hashValue) % 360) / 360
        return NSColor(hue: hue, saturation: 0.62, brightness: 0.72, alpha: 1)
    }

    /// Apple REQUIRES a privacy manifest for apps using "required reason" APIs.
    /// The generated code uses UserDefaults (StateStore/auth) and reads files
    /// from Application Support — both are declared here, or the app is rejected
    /// at submission.
    private static func privacyManifestSource() -> String {
        """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
        \t<key>NSPrivacyTracking</key>
        \t<false/>
        \t<key>NSPrivacyTrackingDomains</key>
        \t<array/>
        \t<key>NSPrivacyCollectedDataTypes</key>
        \t<array/>
        \t<key>NSPrivacyAccessedAPITypes</key>
        \t<array>
        \t\t<dict>
        \t\t\t<key>NSPrivacyAccessedAPIType</key>
        \t\t\t<string>NSPrivacyAccessedAPICategoryUserDefaults</string>
        \t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
        \t\t\t<array>
        \t\t\t\t<string>CA92.1</string>
        \t\t\t</array>
        \t\t</dict>
        \t\t<dict>
        \t\t\t<key>NSPrivacyAccessedAPIType</key>
        \t\t\t<string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
        \t\t\t<key>NSPrivacyAccessedAPITypeReasons</key>
        \t\t\t<array>
        \t\t\t\t<string>C617.1</string>
        \t\t\t</array>
        \t\t</dict>
        \t</array>
        </dict>
        </plist>

        """
    }

    private static func xcodeReadme(project: DesignProject, appName: String, bundleId: String, hasWatch: Bool) -> String {
        """
        # \(project.name) — Xcode Project

        A ready-to-open Xcode project. Unlike the SwiftPM export, this one builds
        a real, signable **app bundle** you can archive and submit.

        ## Run / ship
        1. Open **\(appName).xcodeproj** in Xcode.
        2. Select the **\(appName)** scheme and a device or simulator, then Run.
        3. To submit: set your Team under Signing & Capabilities (bundle id
           `\(bundleId)`), then Product ▸ Archive.
        \(hasWatch ? "\n        The watch app (`\(bundleId).watchkitapp`) is a second target embedded\n        automatically into the iOS app under `\(appName).app/Watch/`. Archiving the\n        iOS app ships the watch app with it.\n" : "")
        ## Notes
        - Permission usage descriptions are set as build settings (Info tab) from
          the sensors your flows actually use — nothing more is requested.
        - Source files live in `Shared/`, `iOS/`\(hasWatch ? ", and `Watch/`" : ""). They are folder
          references (synchronized groups): drop a new file in and it's in the
          build, no project edits.
        \(firebaseReadmeNotes(project))\(firestoreCollectionsExist(project) ? "- `firestore.rules` holds owner-scoped, deny-by-default security rules matching the flows — deploy them (`firebase deploy --only firestore:rules`) before shipping. Test them in the console's Rules Playground.\n" : "")
        """
    }

    /// Whatever Firebase setup is still MANUAL after this export. Every line
    /// here is a step that, if skipped, produces an app that builds and then
    /// fails at the first sign-in — so the README says exactly which ones are
    /// already done and which are not.
    private static func firebaseReadmeNotes(_ project: DesignProject) -> String {
        guard let config = project.firebaseConfig, config.isEnabled else { return "" }
        var lines = ["- Firebase: the firebase-ios-sdk package is already declared in the project."]
        if config.isConfigured, !config.apiKey.isEmpty, !config.appId.isEmpty, !config.messagingSenderId.isEmpty {
            lines.append("- `GoogleService-Info.plist` was GENERATED from the project's Firebase credentials (project `\(config.projectId)`) and is already in the app target — no manual drag needed.")
        } else {
            lines.append("- `GoogleService-Info.plist` is MISSING (no Firebase credentials set). FirebaseApp.configure() traps without it: download it from the Firebase console, or set the credentials in the designer (set_firebase_config) and re-export.")
        }
        let methods = [
            config.enableEmailAuth ? "Email/Password" : nil,
            config.enableGoogleAuth ? "Google" : nil,
            config.enableAppleAuth ? "Apple" : nil,
            config.enableAnonymousAuth ? "Anonymous" : nil,
        ].compactMap { $0 }
        if !methods.isEmpty {
            lines.append("- Enable these sign-in methods in the Firebase console (Authentication ▸ Sign-in method): \(methods.joined(separator: ", ")). The app cannot turn them on for you.")
        }
        if !config.publicReadCollections.isEmpty {
            lines.append("- Shared collections (any signed-in user reads, owner writes): \(config.publicReadCollections.joined(separator: ", ")).")
        }
        return lines.joined(separator: "\n") + "\n"
    }

    private static func firestoreCollectionsExist(_ project: DesignProject) -> Bool {
        project.pages.contains { page in
            page.logicFlows.contains { $0.blocks.contains { $0.category == .firebase } }
        }
    }

    private static func packageSwift(appName: String, project: DesignProject, hasResources: Bool) -> String {
        let platforms = project.platformSettings.enabledPlatforms
        // Do NOT claim macOS support: the generated code uses CoreLocation /
        // CoreMotion / HealthKit APIs that are unavailable on macOS, so
        // declaring .macOS made the package fail to build for a platform it
        // advertised — while the readiness check said "ship ready".
        let platformLines = platforms.map { platform -> String in
            switch platform {
            case .iPhone, .iPad: return ".iOS(.v17)"
            case .appleWatch: return ".watchOS(.v10)"
            }
        }
        let uniquePlatforms = Array(Set(platformLines)).sorted().joined(separator: ",\n        ")
        let firebaseEnabled = project.firebaseConfig?.isEnabled == true

        let dependencies = firebaseEnabled
            ? ",\n    dependencies: [\n        .package(url: \"https://github.com/firebase/firebase-ios-sdk\", from: \"10.0.0\")\n    ]"
            : ""
        let targetDependencies = firebaseEnabled
            ? ",\n                    dependencies: [\n                        .product(name: \"FirebaseAuth\", package: \"firebase-ios-sdk\"),\n                        .product(name: \"FirebaseFirestore\", package: \"firebase-ios-sdk\"),\n                        .product(name: \"FirebaseAnalytics\", package: \"firebase-ios-sdk\")\n                    ]"
            : ""

        return """
        // swift-tools-version: 5.9
        import PackageDescription

        let package = Package(
            name: "\(appName)",
            platforms: [
                \(uniquePlatforms.isEmpty ? ".iOS(.v17)" : uniquePlatforms)
            ],
            products: [
                .executable(name: "\(appName)", targets: ["\(appName)"])
            ]\(dependencies),
            targets: [
                .executableTarget(
                    name: "\(appName)"\(hasResources ? ",\n                    resources: [.process(\"Resources\")]" : "")\(targetDependencies),
                    linkerSettings: [.linkedLibrary("sqlite3")]
                )
            ]
        )

        \(firebaseEnabled ? "// Firebase is enabled for this project — Xcode will resolve the package dependency above the first time you build. The fast \"Run\" button in AgenticDesigner compiles sources directly and cannot resolve SPM dependencies, so Firebase blocks only go live once you open Package.swift in Xcode and build normally." : "")

        """
    }

    // Background location is required when a flow tracks continuously — either
    // an onLocationChanged subscription or startTracking with background on.
    // Setting allowsBackgroundLocationUpdates without UIBackgroundModes=location
    // CRASHES on device, so the plist and the code must agree.
    private static func needsBackgroundLocation(in flows: [LogicFlow]) -> Bool {
        flows.contains { flow in
            flow.blocks.contains { block in
                block.type == .onLocationChanged
                    || (block.type == .startTracking && (paramValue(block, "background") ?? "true") != "false")
            }
        }
    }

    // Scans every flow for blocks that need an iOS usage-description string
    // (camera, photo library, location, microphone, Face ID) so the
    // generated Info.plist only asks for what this project actually uses.
    private static func requiredUsageDescriptions(in flows: [LogicFlow]) -> [(key: String, value: String)] {
        var result: [String: String] = [:]
        for flow in flows {
            for block in flow.blocks {
                switch block.type {
                case .requestPermission:
                    switch paramValue(block, "kind") ?? "camera" {
                    case "camera": result["NSCameraUsageDescription"] = "This app uses the camera as part of its logic flows."
                    case "photoLibrary": result["NSPhotoLibraryUsageDescription"] = "This app accesses your photo library as part of its logic flows."
                    case "location": result["NSLocationWhenInUseUsageDescription"] = "This app uses your location as part of its logic flows."
                    case "microphone": result["NSMicrophoneUsageDescription"] = "This app uses the microphone as part of its logic flows."
                    default: break
                    }
                case .biometricAuth:
                    result["NSFaceIDUsageDescription"] = "This app uses Face ID to authenticate you."

                // A sensor block IS a permission requirement. Relying on a
                // separate requestPermission block meant a flow could read GPS
                // or HealthKit with no usage description in the plist — which
                // does not prompt, it crashes on device.
                case .getLocation, .onLocationChanged, .startTracking:
                    result["NSLocationWhenInUseUsageDescription"] =
                        "Your location is used to track distance and pace while you are active."
                case .readHeartRate, .readStepCount:
                    result["NSHealthShareUsageDescription"] =
                        "Heart rate and step data are read to show your activity statistics."
                    result["NSHealthUpdateUsageDescription"] =
                        "Workout data is written to Health so your activity stays in one place."
                case .readMotion, .onShake:
                    result["NSMotionUsageDescription"] =
                        "Motion data is used to detect movement and device gestures."

                default:
                    break
                }
            }
        }
        return result.sorted { $0.key < $1.key }
    }

    // Written alongside the export as scaffolding for the Xcode app target
    // the README already tells users to create for signed builds; also read
    // back by SimulatorRunner so the fast "Run" path asks for the same
    // permissions the flows actually use.
    private static func infoPlistSource(
        usageDescriptions: [(key: String, value: String)],
        needsBackgroundLocation: Bool = false,
        orientation: AppOrientation = .portrait
    ) -> String {
        var entries = usageDescriptions.map { "    <key>\($0.key)</key>\n    <string>\($0.value)</string>" }

        // A landscape game locked to portrait is unplayable, so the project's
        // orientation must reach the SOURCE export too, not just the Xcode
        // project's build settings.
        if orientation != .portrait {
            let items = orientation.plistOrientations
                .map { "        <string>\($0)</string>" }
                .joined(separator: "\n")
            entries.append("    <key>UISupportedInterfaceOrientations</key>\n    <array>\n" + items + "\n    </array>")
        }

        if needsBackgroundLocation {
            // LocationService checks for this at runtime before ever setting
            // allowsBackgroundLocationUpdates — that property crashes without
            // the capability, so the plist and the code must agree.
            entries.append("""
                <key>UIBackgroundModes</key>
                <array>
                    <string>location</string>
                </array>
            """)
            // Tracking with the screen locked is "Always" territory; iOS
            // escalates from WhenInUse only if this string exists.
            entries.append("""
                <key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
                <string>Your location is tracked during an activity, including when the screen is locked, so distance and pace stay accurate.</string>
            """)
        }

        return [
            #"<?xml version="1.0" encoding="UTF-8"?>"#,
            #"<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">"#,
            #"<plist version="1.0">"#,
            "<dict>",
            entries.joined(separator: "\n"),
            "</dict>",
            "</plist>",
            ""
        ].joined(separator: "\n")
    }

    private static func readme(project: DesignProject, appName: String) -> String {
        let platforms = project.platformSettings.enabledPlatforms.map(\.displayName).joined(separator: ", ")
        return """
        # \(project.name) SwiftUI Export

        This folder contains generated SwiftUI source for \(project.name).

        Open `Package.swift` in Xcode to inspect and run the generated SwiftUI code. The export includes shared state, generated actions, screen views, and a root view that simulates navigation and alerts.

        Enabled platforms: \(platforms.isEmpty ? "iPhone, iPad" : platforms)

        Notes:
        - iPhone and iPad share the same responsive SwiftUI source.
        - Apple Watch export adds a compact watch-friendly root view when enabled.
        - This first-pass export writes clean app source. If you need signed archive targets, create iOS/watchOS app targets in Xcode and add these generated files.
        - `Info.plist` at the export root lists any permission usage-description keys your flows need (camera, location, Face ID, ...) — merge it into your app target's Info.plist when you create one.
        - Firebase blocks compile either way, but only run once you add the Firebase SPM package in Xcode (see Package.swift). Supabase, SQLite, and Algolia blocks need no extra package.

        """
    }

    private static func appSource(appName: String, hasWatch: Bool, usesPush: Bool = false) -> String {
        let content = hasWatch
            ? """
                    #if os(watchOS)
                    WatchRootView()
                        .environmentObject(state)
                        .task { await state.restoreOnLaunch() }
                    #else
                    RootView()
                        .environmentObject(state)
                        .task { await state.restoreOnLaunch() }
                    #endif
            """
            : """
                    RootView()
                        .environmentObject(state)
                        .task { await state.restoreOnLaunch() }
            """
        // The APNs delegate adaptor is iOS-only (watchOS has no UIApplication).
        let pushAdaptor = usesPush ? """

            #if os(iOS)
            @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
            #endif
        """ : ""
        return """
        import SwiftUI

        @main
        struct \(appName)App: App {
            @StateObject private var state = AppState()\(pushAdaptor)

            var body: some Scene {
                WindowGroup {
        \(content)
                }
            }
        }

        """
    }

    /// Properties AppState always declares itself. A project variable with one
    /// of these names is honoured (reads/writes hit the built-in property) but
    /// never re-declared.
    private static let appStateReservedProperties: Set<String> = [
        "currentScreen", "navigationPath", "presentedSheet", "presentedBottomSheet",
        "alertTitle", "alertMessage", "toastMessage", "colorSchemeOverride",
        "currentUserEmail", "currentUserId", "pendingConfirmation",
    ]

    private static func appStateSource(variables: [LogicVariable], firstScreen: DesignNode?, screens: [DesignNode], dynamic: [UUID: Set<DynamicNodeProperty>]) -> String {
        let first = swiftString(firstScreen.map { swiftIdentifier($0.name, fallback: "Screen") } ?? "Home")
        // A project variable named like one of AppState's own properties
        // ("currentUserId" is the obvious one — it is what {{uid}} resolves to,
        // so naming a variable that is the CORRECT thing to do) must not be
        // re-declared: "invalid redeclaration" failed the whole build.
        var variableLines = variables
            .filter { !appStateReservedProperties.contains(swiftIdentifier($0.name, fallback: "value")) }
            .map { variable in
                "@Published var \(swiftIdentifier(variable.name, fallback: "value")): \(swiftType(for: variable.type)) = \(swiftDefault(for: variable))"
            }
        // Every repeat-list item alias ("book" in {{book.title}}) gets a
        // state slot: tapping a cell stores that cell's item JSON here, so
        // downstream flows and other screens can read the selected item.
        let declared = Set(variables.map { swiftIdentifier($0.name, fallback: "value") })
            .union(appStateReservedProperties)
        for alias in repeatAliases(in: screens) where !declared.contains(alias) {
            variableLines.append("@Published var \(alias): String = \"{}\"")
        }
        let variableLinesJoined = variableLines.joined(separator: "\n    ")
        let dynamicLines = dynamicStateLines(screens: screens, dynamic: dynamic)

        // Persistence: only scalar variables round-trip through StateStore.
        // Without this, StateStore and AuthService.restore() were both defined
        // and never called — the app looked like it saved state and restored
        // sessions, and did neither.
        // Sensitive variables (passwords, tokens, PINs) are treated as
        // ephemeral: they never touch StateStore, so a secret can't be
        // recovered off-disk. This is the persistence POLICY, applied by name
        // rather than left to the caller to remember for every field.
        let persistable = variables.filter { [.string, .number, .boolean].contains($0.type) && !looksSensitive($0.name) }
        let snapshotEntries = persistable.map { v in
            "            \(swiftString(v.name)): String(describing: \(swiftIdentifier(v.name, fallback: "value")))"
        }.joined(separator: ",\n")
        let snapshotLiteral = persistable.isEmpty ? "[:]" : "[\n\(snapshotEntries)\n        ]"
        let applyLines = persistable.map { v -> String in
            let id = swiftIdentifier(v.name, fallback: "value")
            switch v.type {
            case .number:  return "        if let __v = values[\(swiftString(v.name))], let __n = Double(__v) { \(id) = __n }"
            case .boolean: return "        if let __v = values[\(swiftString(v.name))] { \(id) = (__v == \"true\") }"
            default:       return "        if let __v = values[\(swiftString(v.name))] { \(id) = __v }"
            }
        }.joined(separator: "\n")

        return """
        import SwiftUI
        import Combine

        final class AppState: ObservableObject {
            @Published var currentScreen: String = \(first)
            @Published var navigationPath: [String] = []
            @Published var presentedSheet: String?
            @Published var presentedBottomSheet: String?
            @Published var alertTitle: String?
            @Published var alertMessage: String?
            @Published var toastMessage: String?
            @Published var colorSchemeOverride: ColorScheme?
            @Published var currentUserEmail: String = ""
            @Published var currentUserId: String = ""
            @Published var pendingConfirmation: PendingConfirmation?
            \(variableLinesJoined)
            \(dynamicLines)

            // MARK: - Session & state restoration
            private var __cancellables = Set<AnyCancellable>()
            private var __persistTask: Task<Void, Never>?

            init() {
                // Any change to a published value schedules a debounced save, so
                // a crash / force-quit / OS eviction can't silently lose state.
                objectWillChange
                    .sink { [weak self] _ in self?.__schedulePersist() }
                    .store(in: &__cancellables)
            }

            private func __schedulePersist() {
                __persistTask?.cancel()
                __persistTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: 300_000_000)
                    guard let self, !Task.isCancelled else { return }
                    StateStore.save(self.__variableSnapshot())
                }
            }

            func __variableSnapshot() -> [String: String] {
                \(snapshotLiteral)
            }

            func __applyPersisted(_ values: [String: String]) {
        \(applyLines.isEmpty ? "        // No scalar variables to restore." : applyLines)
            }

            /// Call once at launch (the exported App entry does this in .task).
            /// Restores the signed-in session and the last saved scalar state.
            @MainActor
            func restoreOnLaunch() async {
                AuthService.shared.restore()
                currentUserId = AuthService.shared.userId
                currentUserEmail = AuthService.shared.email
                __applyPersisted(StateStore.load())
            }

            // Timers created by On Timer events (screen-scoped) and Start
            // Timer blocks (named). Task-based so cancellation is immediate.
            private var generatedTimers: [String: Task<Void, Never>] = [:]

            func scheduleGeneratedTimer(id: String, seconds: Double, repeats: Bool, _ body: @escaping @MainActor () async -> Void) {
                cancelGeneratedTimer(id: id)
                generatedTimers[id] = Task { @MainActor in
                    repeat {
                        try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0.05) * 1_000_000_000))
                        guard !Task.isCancelled else { return }
                        await body()
                    } while repeats && !Task.isCancelled
                }
            }

            func cancelGeneratedTimer(id: String) {
                generatedTimers[id]?.cancel()
                generatedTimers[id] = nil
            }

            func cancelGeneratedTimers(prefix: String) {
                for key in generatedTimers.keys where key.hasPrefix(prefix) {
                    cancelGeneratedTimer(id: key)
                }
            }

            func navigate(to screen: String) {
                if currentScreen != screen {
                    navigationPath.append(currentScreen)
                    currentScreen = screen
                }
            }

            func goBack() {
                if let previous = navigationPath.popLast() {
                    currentScreen = previous
                }
            }

            func resetPresentation() {
                presentedSheet = nil
                alertTitle = nil
                alertMessage = nil
                toastMessage = nil
            }

            // Confirm Dialog blocks await this; RootView renders the actual
            // alert and resumes it when the user taps Confirm or Cancel.
            func confirm(title: String, message: String, confirmLabel: String, cancelLabel: String) async -> Bool {
                await withCheckedContinuation { continuation in
                    pendingConfirmation = PendingConfirmation(title: title, message: message, confirmLabel: confirmLabel, cancelLabel: cancelLabel, continuation: continuation)
                }
            }
        }

        struct PendingConfirmation: Identifiable {
            let id = UUID()
            let title: String
            let message: String
            let confirmLabel: String
            let cancelLabel: String
            let continuation: CheckedContinuation<Bool, Never>
        }

        """
    }

    // Item aliases of every repeat-list template anywhere in the design —
    // each needs an AppState slot for "which item was tapped".
    private static func repeatAliases(in screens: [DesignNode]) -> [String] {
        var aliases: Set<String> = []
        func walk(_ node: DesignNode) {
            if let binding = node.repeatBinding {
                aliases.insert(swiftIdentifier(binding.itemAlias, fallback: "item"))
            }
            node.children.forEach(walk)
        }
        screens.forEach(walk)
        return aliases.sorted()
    }

    private static func actionsSource(appName: String, project: DesignProject, flows: [LogicFlow], screens: [DesignNode], variables: [LogicVariable], dynamic: [UUID: Set<DynamicNodeProperty>], imageAssets: [String: String]) -> String {
        let variableTypes = Dictionary(uniqueKeysWithValues: variables.map { ($0.name, $0.type) })
        var functions: [String] = []
        var emittedNames = Set<String>()
        for flow in flows {
            let events = flow.blocks.filter { BlockCatalog.definition(for: $0.type)?.inputPortCount == 0 }
            for event in events {
                let name = actionFunctionName(flow: flow, event: event)
                // A duplicated flow (identical name + block ids) must not emit
                // the same function twice — that's a compile error downstream.
                guard emittedNames.insert(name).inserted else { continue }
                var visited: Set<UUID> = [event.id]
                let body = swiftStatements(from: event.id, port: 0, in: flow, screens: screens, variableTypes: variableTypes, project: project, dynamic: dynamic, imageAssets: imageAssets, visited: &visited)
                functions.append("""
                    func \(name)() async {
                \(indent(body.isEmpty ? "print(\"No generated actions for \(swiftEscaped(flow.name))\")" : body, spaces: 8))
                    }
                """)
            }
        }

        // Custom Event flows are reachable by name — Start Timer ticks (and
        // any future generated hook) enter the flow graph through here.
        var customEventCases: [String: [String]] = [:]
        for flow in flows {
            for event in flow.blocks where event.type == .customEvent {
                let eventName = event.parameters.first { $0.key == "name" }?.value ?? "customEvent"
                customEventCases[eventName, default: []].append("await \(actionFunctionName(flow: flow, event: event))()")
            }
        }
        let dispatcherCases = customEventCases.sorted { $0.key < $1.key }.map { name, calls in
            "        case \(swiftString(name)):\n\(calls.map { "            \($0)" }.joined(separator: "\n"))"
        }.joined(separator: "\n")
        functions.append("""
            func runCustomEvent(named name: String) async {
                switch name {
        \(dispatcherCases.isEmpty ? "        case \"__none\": break" : dispatcherCases)
                default:
                    break
                }
            }
        """)

        return """
        import SwiftUI
        #if canImport(FirebaseAuth)
        import FirebaseAuth
        #endif
        #if canImport(FirebaseFirestore)
        import FirebaseFirestore
        #endif
        #if canImport(FirebaseAnalytics)
        import FirebaseAnalytics
        #endif
        #if canImport(LocalAuthentication)
        import LocalAuthentication
        #endif
        #if canImport(AVFoundation)
        import AVFoundation
        #endif
        #if canImport(Photos)
        import Photos
        #endif
        #if canImport(CoreLocation)
        import CoreLocation
        #endif
        #if canImport(UserNotifications)
        import UserNotifications
        #endif

        @MainActor
        final class GeneratedActions {
            let state: AppState
            // Carries the most recent HTTP Request's response to a
            // downstream Parse JSON / Handle Error block in the same flow.
            private var __lastResponseData = Data()
            private var __lastStatusCode = 0
            // Set Header / Set Body accumulate here and the next HTTP Request
            // consumes and clears them — that is what makes those blocks real
            // instead of no-ops (so an Authorization header actually ships).
            private var __pendingHeaders: [String: String] = [:]
            private var __pendingBody: Data?

            init(state: AppState) {
                self.state = state
            }

        \(functions.joined(separator: "\n\n"))
        }

        """
    }

    private static func rootViewSource(appName: String, screens: [DesignNode], flows: [LogicFlow]) -> String {
        let cases = screens.map { screen in
            "case \(swiftString(screenKey(screen))): \(swiftIdentifier(screen.name, fallback: "Screen"))View(actions: GeneratedActions(state: state))"
        }.joined(separator: "\n        ")
        let fallback = screens.first.map { "\(swiftIdentifier($0.name, fallback: "Screen"))View(actions: GeneratedActions(state: state))" } ?? "Text(\"No screens exported\")"
        let launchCalls = eventCalls(types: [.onAppLaunch], flows: flows, nodeId: nil, receiver: "GeneratedActions(state: state)")
        // Per-screen background hexes so the fit-scale letterbox (different
        // aspect ratios: SE, iPad) is painted in the screen's own color and
        // reads as intentional bleed, not black bars.
        let backgroundCases = screens.map { screen in
            "case \(swiftString(screenKey(screen))): return \(swiftString(screen.style.fill.hasPrefix("#") ? screen.style.fill : "#FFFFFF"))"
        }.joined(separator: "\n        ")
        let firstFill = screens.first.map { $0.style.fill.hasPrefix("#") ? $0.style.fill : "#FFFFFF" } ?? "#FFFFFF"

        return """
        import SwiftUI

        struct RootView: View {
            @EnvironmentObject private var state: AppState

            var body: some View {
                NavigationStack {
                    ZStack {
                        Color(hex: backgroundHex(for: state.currentScreen)).ignoresSafeArea()
                        // Screens are authored at 390x844; DesignScaledHost
                        // (GeneratedSupport.swift) fit-scales them to THIS
                        // device via a UIKit transform, which — unlike
                        // .scaleEffect — moves hit-testing with the pixels.
                        DesignScaledHost {
                            Group {
                                switch state.currentScreen {
                                \(cases)
                                default: \(fallback)
                                }
                            }
                            .environmentObject(state)
                        }
                        .ignoresSafeArea()
                    }
                }
                .sheet(item: Binding(
                    get: { state.presentedSheet.map(IdentifiedString.init(value:)) },
                    set: { state.presentedSheet = $0?.value }
                )) { item in
                    DesignScaledHost { sheetView(item.value).environmentObject(state) }
                }
                .sheet(item: Binding(
                    get: { state.presentedBottomSheet.map(IdentifiedString.init(value:)) },
                    set: { state.presentedBottomSheet = $0?.value }
                )) { item in
                    DesignScaledHost { sheetView(item.value).environmentObject(state) }
                        .presentationDetents([.medium, .large])
                }
                .preferredColorScheme(state.colorSchemeOverride)
                .alert(state.alertTitle ?? "", isPresented: Binding(
                    get: { state.alertTitle != nil },
                    set: { if !$0 { state.alertTitle = nil; state.alertMessage = nil } }
                )) {
                    Button("OK", role: .cancel) { state.alertTitle = nil; state.alertMessage = nil }
                } message: {
                    Text(state.alertMessage ?? "")
                }
                .alert(state.pendingConfirmation?.title ?? "", isPresented: Binding(
                    get: { state.pendingConfirmation != nil },
                    set: { isPresented in
                        if !isPresented, let pending = state.pendingConfirmation {
                            pending.continuation.resume(returning: false)
                            state.pendingConfirmation = nil
                        }
                    }
                )) {
                    Button(state.pendingConfirmation?.cancelLabel ?? "Cancel", role: .cancel) {
                        state.pendingConfirmation?.continuation.resume(returning: false)
                        state.pendingConfirmation = nil
                    }
                    Button(state.pendingConfirmation?.confirmLabel ?? "Confirm") {
                        state.pendingConfirmation?.continuation.resume(returning: true)
                        state.pendingConfirmation = nil
                    }
                } message: {
                    Text(state.pendingConfirmation?.message ?? "")
                }
                .overlay(alignment: .bottom) {
                    if let toast = state.toastMessage {
                        Text(toast)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.black.opacity(0.86))
                            .clipShape(Capsule())
                            .padding(.bottom, 28)
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .onChange(of: state.toastMessage) { _ in
                    guard state.toastMessage != nil else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        state.toastMessage = nil
                    }
                }
                .onAppear {
        \(indent(launchCalls.isEmpty ? "// no app launch actions" : launchCalls, spaces: 12))
                }
            }

            @ViewBuilder
            private func sheetView(_ key: String) -> some View {
                switch key {
                \(cases)
                default: Text(key)
                }
            }

            private func backgroundHex(for screen: String) -> String {
                switch screen {
                \(backgroundCases)
                default: return \(swiftString(firstFill))
                }
            }
        }

        struct IdentifiedString: Identifiable {
            let value: String
            var id: String { value }
        }

        """
    }

    private static func screenSource(screen: DesignNode, flows: [LogicFlow], variableTypes: [String: VariableType], imageAssets: [String: String], dynamic: [UUID: Set<DynamicNodeProperty>]) -> String {
        let viewName = swiftIdentifier(screen.name, fallback: "Screen")

        // A screen that IS a game: the whole screen is the SpriteKit surface,
        // loaded from the bundled scene JSON and played by the copied runtime.
        // Game events feed the LOGIC layer: score/over/win/collision fire the
        // flows wired in Logic Mode, exactly like in the preview.
        if screen.effectiveGameSpec != nil {
            let gameFlows = flows.filter { $0.screenNodeId == nil || $0.screenNodeId == screen.id }
            var eventLines: [String] = []
            func calls(_ type: LogicBlockType) -> String {
                gameFlows.compactMap { flow in
                    flow.blocks.first { $0.type == type }.map { event in
                        "await actions.\(actionFunctionName(flow: flow, event: event))()"
                    }
                }.joined(separator: "\n                            ")
            }
            let scoreSync = variableTypes["gameScore"] != nil
                ? "state.gameScore = \(variableTypes["gameScore"] == .number ? "Double(score)" : "String(score)")" : "_ = score"
            eventLines.append("case .scoreChanged(let score):\n                            \(scoreSync)\n                            \(calls(.onGameScore).isEmpty ? "break" : calls(.onGameScore))")
            eventLines.append("case .gameOver:\n                            \(calls(.onGameOver).isEmpty ? "break" : calls(.onGameOver))")
            eventLines.append("case .won:\n                            \(calls(.onGameWin).isEmpty ? "break" : calls(.onGameWin))")
            var collisionLines: [String] = []
            for flow in gameFlows {
                guard let event = flow.blocks.first(where: { $0.type == .onGameCollision }) else { continue }
                let fa = event.parameters.first { $0.key == "categoryA" }?.value ?? ""
                let fb = event.parameters.first { $0.key == "categoryB" }?.value ?? ""
                var conditions: [String] = []
                if !fa.isEmpty { conditions.append("(a == \(swiftString(fa)) || b == \(swiftString(fa)))") }
                if !fb.isEmpty { conditions.append("(a == \(swiftString(fb)) || b == \(swiftString(fb)))") }
                let condition = conditions.isEmpty ? "true" : conditions.joined(separator: " && ")
                let usesIds = flow.blocks.contains { block in
                    block.parameters.contains { parameter in
                        guard let reference = parameter.variableReference else { return false }
                        return reference == "gameCollisionEntityA" || reference == "gameCollisionEntityB"
                    }
                }
                var assigns: [String] = []
                if usesIds {
                    let swapExpr = fa.isEmpty ? "false" : "(b == \(swiftString(fa)))"
                    assigns.append("let __cs = \(swapExpr)")
                    if variableTypes["gameCollisionEntityA"] != nil { assigns.append("state.gameCollisionEntityA = __cs ? idB : idA") }
                    if variableTypes["gameCollisionEntityB"] != nil { assigns.append("state.gameCollisionEntityB = __cs ? idA : idB") }
                }
                let body = (assigns + ["await actions.\(actionFunctionName(flow: flow, event: event))()"]).joined(separator: "; ")
                collisionLines.append("if \(condition) { \(body) }")
            }
            eventLines.append("case .collision(let a, let b, let idA, let idB):\n                            \(collisionLines.isEmpty ? "_ = a; _ = b; _ = idA; _ = idB" : "_ = idA; _ = idB\n                            " + collisionLines.joined(separator: "\n                            "))")
            // Each coordinate is assigned ONLY if that variable exists. Emitting
            // gameTapY just because gameTapX was declared produced code that
            // referenced a member of AppState the project never defined.
            func axisAssign(_ name: String, _ expr: String, integer: String) -> String? {
                guard let type = variableTypes[name] else { return nil }
                return "state.\(name) = \(type == .number ? expr : integer)"
            }
            var tapParts = [axisAssign("gameTapX", "Double(x)", integer: "String(Int(x))"),
                            axisAssign("gameTapY", "Double(y)", integer: "String(Int(y))")].compactMap { $0 }
            if tapParts.isEmpty { tapParts = ["_ = x; _ = y"] }
            let tapSet = tapParts.joined(separator: "; ")
            eventLines.append("case .tap(let x, let y):\n                            \(tapSet)\n                            \(calls(.onGameTap).isEmpty ? "break" : calls(.onGameTap))")
            var dragLines: [String] = []
            for flow in gameFlows {
                guard let event = flow.blocks.first(where: { $0.type == .onGameDrag }) else { continue }
                let wanted = event.parameters.first { $0.key == "phase" }?.value ?? "move"
                let condition = wanted == "any" ? "true" : "phase == \(swiftString(wanted))"
                dragLines.append("if \(condition) { await actions.\(actionFunctionName(flow: flow, event: event))() }")
            }
            var dragParts = [axisAssign("gameDragX", "Double(x)", integer: "String(Int(x))"),
                             axisAssign("gameDragY", "Double(y)", integer: "String(Int(y))")].compactMap { $0 }
            if dragParts.isEmpty { dragParts = ["_ = x; _ = y"] }
            let dragSet = dragParts.joined(separator: "; ")
            eventLines.append("case .drag(let phase, let x, let y):\n                            \(dragSet)\n                            \(dragLines.isEmpty ? "_ = phase" : dragLines.joined(separator: "\n                            "))")
            var destroyedLines: [String] = []
            for flow in gameFlows {
                guard let event = flow.blocks.first(where: { $0.type == .onGameEntityDestroyed }) else { continue }
                let wanted = event.parameters.first { $0.key == "category" }?.value ?? ""
                let condition = wanted.isEmpty ? "true" : "category == \(swiftString(wanted))"
                destroyedLines.append("if \(condition) { await actions.\(actionFunctionName(flow: flow, event: event))() }")
            }
            eventLines.append("case .entityDestroyed(let category):\n                            \(destroyedLines.isEmpty ? "_ = category" : destroyedLines.joined(separator: "\n                            "))")
            eventLines.append("case .started:\n                            \(calls(.onGameStart).isEmpty ? "break" : calls(.onGameStart))")
            let livesSet = variableTypes["gameLives"] != nil ? "state.gameLives = \(variableTypes["gameLives"] == .number ? "Double(remaining)" : "String(remaining)")" : "_ = remaining"
            eventLines.append("case .lifeLost(let remaining):\n                            \(livesSet)\n                            \(calls(.onGameLifeLost).isEmpty ? "break" : calls(.onGameLifeLost))")
            var spawnedLines: [String] = []
            for flow in gameFlows {
                guard let event = flow.blocks.first(where: { $0.type == .onGameSpawned }) else { continue }
                let wanted = event.parameters.first { $0.key == "category" }?.value ?? ""
                let condition = wanted.isEmpty ? "true" : "category == \(swiftString(wanted))"
                spawnedLines.append("if \(condition) { await actions.\(actionFunctionName(flow: flow, event: event))() }")
            }
            eventLines.append("case .spawned(let category):\n                            \(spawnedLines.isEmpty ? "_ = category" : spawnedLines.joined(separator: "\n                            "))")
            var impactLines: [String] = []
            for flow in gameFlows {
                guard let event = flow.blocks.first(where: { $0.type == .onGameImpact }) else { continue }
                let fa = event.parameters.first { $0.key == "categoryA" }?.value ?? ""
                let fb = event.parameters.first { $0.key == "categoryB" }?.value ?? ""
                let minForce = Double(event.parameters.first { $0.key == "minForce" }?.value ?? "0") ?? 0
                var conditions: [String] = []
                if !fa.isEmpty { conditions.append("(a == \(swiftString(fa)) || b == \(swiftString(fa)))") }
                if !fb.isEmpty { conditions.append("(a == \(swiftString(fb)) || b == \(swiftString(fb)))") }
                if minForce > 0 { conditions.append("force >= \(minForce)") }
                let condition = conditions.isEmpty ? "true" : conditions.joined(separator: " && ")
                // Normalize entity ids to the filter's order (see LogicSimulator).
                // ONLY for flows that actually read them: these are shared app
                // state, and impact events run as concurrent tasks, so a flow
                // that merely shakes the screen used to overwrite the ids a
                // damage flow was about to read — and the damage landed on the
                // wrong entity.
                let flowUsesEntityIds = flow.blocks.contains { block in
                    block.parameters.contains { parameter in
                        guard let reference = parameter.variableReference else { return false }
                        return reference == "gameImpactEntityA" || reference == "gameImpactEntityB"
                    }
                }
                var assigns: [String] = []
                if flowUsesEntityIds,
                   variableTypes["gameImpactEntityA"] != nil || variableTypes["gameImpactEntityB"] != nil {
                    let swapExpr = fa.isEmpty ? "false" : "(b == \(swiftString(fa)))"
                    assigns.append("let __sw = \(swapExpr)")
                    if variableTypes["gameImpactEntityA"] != nil { assigns.append("state.gameImpactEntityA = __sw ? idB : idA") }
                    if variableTypes["gameImpactEntityB"] != nil { assigns.append("state.gameImpactEntityB = __sw ? idA : idB") }
                }
                let body = (assigns + ["await actions.\(actionFunctionName(flow: flow, event: event))()"]).joined(separator: "; ")
                impactLines.append("if \(condition) { \(body) }")
            }
            let forceSet = variableTypes["gameImpactForce"] != nil
                ? "state.gameImpactForce = \(variableTypes["gameImpactForce"] == .number ? "Double(force)" : "String(Int(force))")" : ""
            eventLines.append("case .impact(let a, let b, let force, let idA, let idB):\n                            \(forceSet.isEmpty ? "" : forceSet + "\n                            ")\(impactLines.isEmpty ? "_ = a; _ = b; _ = force; _ = idA; _ = idB" : "_ = idA; _ = idB\n                            " + impactLines.joined(separator: "\n                            "))")
            let launchedSet = variableTypes["gameLaunched"] != nil ? "state.gameLaunched = entityId" : "_ = entityId"
            eventLines.append("case .launched(let entityId):\n                            \(launchedSet)\n                            \(calls(.onGameLaunched).isEmpty ? "break" : calls(.onGameLaunched))")
            eventLines.append("default:\n                            break")

            return """
            import SwiftUI

            struct \(viewName)View: View {
                @EnvironmentObject private var state: AppState
                let actions: GeneratedActions

                var body: some View {
                    AgentGameView(spec: GameSceneLoader.load(\(swiftString(gameSceneResourceName(for: screen)))), onEvent: { event in
                        _ = Swift.Task<Void, Never> { @MainActor in
                            switch event {
                            \(eventLines.joined(separator: "\n                            "))
                            }
                        }
                    })
                        .ignoresSafeArea()
                }
            }

            """
        }

        let scopedFlows = flows.filter { $0.screenNodeId == nil || $0.screenNodeId == screen.id }
        let nodes = nodeViews(screen.children, flows: scopedFlows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamic, level: 4)
        var appearCalls = eventCalls(types: [.onScreenLoad, .onScreenOpened], flows: scopedFlows, nodeId: screen.id)
        // On Timer event flows arm while their screen is showing and stand
        // down when it leaves — seconds/repeats come from the event block.
        var timerLines: [String] = []
        for flow in scopedFlows {
            for event in flow.blocks where event.type == .onTimer {
                let seconds = Double(event.parameters.first { $0.key == "seconds" }?.value ?? "1") ?? 1
                let repeats = event.parameters.first { $0.key == "repeats" }?.value == "true"
                let timerId = "screen:\(viewName):\(event.id.uuidString.prefix(8))"
                timerLines.append("state.scheduleGeneratedTimer(id: \(swiftString(timerId)), seconds: \(seconds), repeats: \(repeats)) { await actions.\(actionFunctionName(flow: flow, event: event))() }")
            }
        }
        if !timerLines.isEmpty {
            appearCalls = (appearCalls.isEmpty ? "" : appearCalls + "\n") + timerLines.joined(separator: "\n")
        }
        var disappearCalls = eventCalls(types: [.onScreenDisappear], flows: scopedFlows, nodeId: screen.id)
        if !timerLines.isEmpty {
            disappearCalls = "state.cancelGeneratedTimers(prefix: \(swiftString("screen:\(viewName):")))" + (disappearCalls.isEmpty ? "" : "\n" + disappearCalls)
        }
        let screenBackground = shapeStyleExpression(fill: screen.style.fill, gradient: screen.style.gradient, width: screen.width, height: screen.height)

        // A screen with a vertical/both scroll axis becomes a real ScrollView:
        // its content is sized to the tallest child so the whole screen (e.g.
        // a hero photo + details) scrolls. Non-scroll screens stay a fixed
        // top-anchored ZStack.
        let scrolls = (screen.scrollBehavior?.axis == "vertical" || screen.scrollBehavior?.axis == "both")
        let contentHeight = max(screen.children.map { $0.y + $0.height }.max() ?? screen.height, screen.height)
        let contentBlock: String
        if scrolls {
            contentBlock = """
                ScrollView(.vertical, showsIndicators: false) {
                            ZStack(alignment: .topLeading) {
                \(nodes)
                            }
                            .frame(width: \(Int(screen.width)), height: \(Int(contentHeight)), alignment: .topLeading)
                        }
                        .frame(width: \(Int(screen.width)))
            """
        } else {
            contentBlock = """
                ZStack(alignment: .topLeading) {
                \(nodes)
                            }
                            .frame(width: \(Int(screen.width)), height: \(Int(screen.height)))
            """
        }

        return """
        import SwiftUI

        struct \(viewName)View: View {
            @EnvironmentObject private var state: AppState
            let actions: GeneratedActions

            var body: some View {
                // Rendered at the design canvas's native point size and anchored to the
                // top, rather than scaled with .scaleEffect(), so tap/gesture hit-testing
                // stays pixel-aligned with what's drawn — scaleEffect visually rescales
                // content but does not reliably rescale touch hit-testing to match,
                // which made buttons far from the top-left corner miss their real taps.
                ZStack(alignment: .top) {
                    \(screenBackground)
                    \(contentBlock)
                }
                .ignoresSafeArea()
                .onAppear {
        \(indent(appearCalls.isEmpty ? "// no screen appear actions" : appearCalls, spaces: 12))
                }
                .onDisappear {
        \(indent(disappearCalls.isEmpty ? "// no screen disappear actions" : disappearCalls, spaces: 12))
                }
            }
        }

        """
    }

    // Watch screens are generated with their own layout logic: instead of the
    // phone's absolute positioning, elements re-flow into a vertical stack
    // inside a ScrollView, which the Digital Crown scrolls natively on
    // watchOS. Buttons become full-width tinted watch buttons wired to the
    // same GeneratedActions as the phone UI.
    private static func watchRootSource(screens: [DesignNode], flows: [LogicFlow], variableTypes: [String: VariableType], imageAssets: [String: String], dynamic: [UUID: Set<DynamicNodeProperty>]) -> String {
        let cases = screens.map { screen in
            "case \(swiftString(screenKey(screen))): \(swiftIdentifier(screen.name, fallback: "Screen"))WatchView(actions: GeneratedActions(state: state))"
        }.joined(separator: "\n                ")
        let fallback = screens.first.map { "\(swiftIdentifier($0.name, fallback: "Screen"))WatchView(actions: GeneratedActions(state: state))" } ?? "Text(\"No screens exported\")"
        let launchCalls = eventCalls(types: [.onAppLaunch], flows: flows, nodeId: nil, receiver: "GeneratedActions(state: state)")
        let screenViews = screens.map { screen in
            watchScreenSource(screen: screen, flows: flows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamic)
        }.joined(separator: "\n")

        return """
        #if os(watchOS)
        import SwiftUI

        struct WatchRootView: View {
            @EnvironmentObject private var state: AppState

            var body: some View {
                NavigationStack {
                    Group {
                        switch state.currentScreen {
                        \(cases)
                        default: \(fallback)
                        }
                    }
                }
                .alert(state.alertTitle ?? "", isPresented: Binding(
                    get: { state.alertTitle != nil },
                    set: { if !$0 { state.alertTitle = nil; state.alertMessage = nil } }
                )) {
                    Button("OK", role: .cancel) { state.alertTitle = nil; state.alertMessage = nil }
                } message: {
                    Text(state.alertMessage ?? "")
                }
                .alert(state.pendingConfirmation?.title ?? "", isPresented: Binding(
                    get: { state.pendingConfirmation != nil },
                    set: { isPresented in
                        if !isPresented, let pending = state.pendingConfirmation {
                            pending.continuation.resume(returning: false)
                            state.pendingConfirmation = nil
                        }
                    }
                )) {
                    Button(state.pendingConfirmation?.cancelLabel ?? "Cancel", role: .cancel) {
                        state.pendingConfirmation?.continuation.resume(returning: false)
                        state.pendingConfirmation = nil
                    }
                    Button(state.pendingConfirmation?.confirmLabel ?? "Confirm") {
                        state.pendingConfirmation?.continuation.resume(returning: true)
                        state.pendingConfirmation = nil
                    }
                } message: {
                    Text(state.pendingConfirmation?.message ?? "")
                }
                .overlay(alignment: .bottom) {
                    if let toast = state.toastMessage {
                        Text(toast)
                            .font(.footnote)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.black.opacity(0.86))
                            .clipShape(Capsule())
                            .transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                }
                .onChange(of: state.toastMessage) {
                    guard state.toastMessage != nil else { return }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                        state.toastMessage = nil
                    }
                }
                .onAppear {
        \(indent(launchCalls.isEmpty ? "// no app launch actions" : launchCalls, spaces: 12))
                }
            }
        }

        \(screenViews)
        #endif

        """
    }

    private static func watchScreenSource(screen: DesignNode, flows: [LogicFlow], variableTypes: [String: VariableType], imageAssets: [String: String], dynamic: [UUID: Set<DynamicNodeProperty>]) -> String {
        let viewName = swiftIdentifier(screen.name, fallback: "Screen")
        let scopedFlows = flows.filter { $0.screenNodeId == nil || $0.screenNodeId == screen.id }
        let elements = watchElementViews(screen.children, flows: scopedFlows, variableTypes: variableTypes, imageAssets: imageAssets, compactAlarmHome: screen.name == "Home")
        var appearCalls = eventCalls(types: [.onScreenLoad, .onScreenOpened], flows: scopedFlows, nodeId: screen.id)
        // On Timer flows arm while this watch screen shows — without this the
        // watch never ticks and time-based logic (alarms!) silently no-ops.
        var timerLines: [String] = []
        for flow in scopedFlows {
            for event in flow.blocks where event.type == .onTimer {
                let seconds = Double(event.parameters.first { $0.key == "seconds" }?.value ?? "1") ?? 1
                let repeats = event.parameters.first { $0.key == "repeats" }?.value == "true"
                let timerId = "watch:\(viewName):\(event.id.uuidString.prefix(8))"
                timerLines.append("state.scheduleGeneratedTimer(id: \(swiftString(timerId)), seconds: \(seconds), repeats: \(repeats)) { await actions.\(actionFunctionName(flow: flow, event: event))() }")
            }
        }
        if !timerLines.isEmpty {
            appearCalls = (appearCalls.isEmpty ? "" : appearCalls + "\n") + timerLines.joined(separator: "\n")
        }

        // Digital Crown: bind a real .digitalCrownRotation to the state
        // variable the block names, and run its flow on each turn. This is the
        // difference between "there's an onDigitalCrown block" and the crown
        // actually driving the app.
        let crownFlow = scopedFlows.first { $0.blocks.contains { $0.type == .onDigitalCrown } }
        let crownBlock = crownFlow?.blocks.first { $0.type == .onDigitalCrown }
        let crownVar = crownBlock
            .flatMap { block in block.parameters.first { $0.key == "valueVariable" }?.variableReference }
            .map { swiftIdentifier($0, fallback: "crown") }
        let crownState = "@State private var __crown: Double = 0"
        let crownModifier: String
        let crownOnChange: String
        if let crownBlock, let crownVar {
            let sensitivity = crownBlock.parameters.first { $0.key == "sensitivity" }?.value ?? "medium"
            let step = sensitivity == "high" ? "0.05" : (sensitivity == "low" ? "0.5" : "0.15")
            let crownCalls = eventCalls(types: [.onDigitalCrown], flows: scopedFlows, nodeId: nil)
            crownModifier = """
            .focusable(true)
                    .digitalCrownRotation($__crown, from: -1000, through: 1000, by: \(step), sensitivity: .medium, isContinuous: false)
            """
            crownOnChange = """
            .onChange(of: __crown) { _, newValue in
                        state.\(crownVar) = newValue
            \(indent(crownCalls.isEmpty ? "" : crownCalls, spaces: 16))
                    }
            """
        } else {
            crownModifier = ""
            crownOnChange = ""
        }

        // FAITHFUL rendering: the same absolute-layout generator the iPhone
        // screens use, scaled to the physical watch display — the watch app
        // looks like the DESIGN, not like a generic settings list. (The old
        // semantic list adaptation lost every color/position the designer set.)
        let nodes = nodeViews(screen.children, flows: scopedFlows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamic, level: 5)
        let screenBackground = shapeStyleExpression(fill: screen.style.fill, gradient: screen.style.gradient, width: screen.width, height: screen.height)
        _ = elements // legacy semantic adaptation retained above for reference

        return """
        struct \(viewName)WatchView: View {
            @EnvironmentObject private var state: AppState
            let actions: GeneratedActions
            \(crownVar != nil ? crownState : "")

            var body: some View {
                GeometryReader { geo in
                    let scale = min(geo.size.width / \(max(Int(screen.width), 1)), geo.size.height / \(max(Int(screen.height), 1)))
                    ZStack(alignment: .topLeading) {
                        \(screenBackground)
                        ZStack(alignment: .topLeading) {
        \(nodes)
                        }
                        .frame(width: \(Int(screen.width)), height: \(Int(screen.height)), alignment: .topLeading)
                    }
                    .frame(width: \(Int(screen.width)), height: \(Int(screen.height)), alignment: .topLeading)
                    .scaleEffect(scale, anchor: .topLeading)
                    .offset(x: (geo.size.width - \(Int(screen.width)) * scale) / 2,
                            y: (geo.size.height - \(Int(screen.height)) * scale) / 2)
                }
                .ignoresSafeArea()
                // Watch screens already contain their own compact heading.
                // A navigation title consumes valuable vertical space and
                // pushes the Snooze/Stop actions below the 45/46mm viewport.
                .navigationBarBackButtonHidden(true)
                \(crownModifier)
                \(crownOnChange)
                .onAppear {
        \(indent(appearCalls.isEmpty ? "// no screen appear actions" : appearCalls, spaces: 12))
                }
            }
        }

        """
    }

    private static func watchElementViews(_ nodes: [DesignNode], flows: [LogicFlow], variableTypes: [String: VariableType], imageAssets: [String: String], compactAlarmHome: Bool = false) -> String {
        var lines: [String] = []

        func firstText(in node: DesignNode) -> String? {
            if node.type == .Text, let text = node.text, !text.isEmpty { return text }
            for child in node.children {
                if let found = firstText(in: child) { return found }
            }
            return nil
        }

        func emit(_ node: DesignNode) {
            // On the watch, a tap is a tap: onWatchTap and onTap both fire.
            let tapAction = eventCalls(types: [.onTap, .onWatchTap], flows: flows, nodeId: node.id)
            let longPressAction = eventCalls(types: [.onWatchLongPress, .onLongPress], flows: flows, nodeId: node.id)
            let longPressModifier = longPressAction.isEmpty
                ? ""
                : "\n.onLongPressGesture { \(longPressAction) }"
            switch node.type {
            case .Text:
                // The Alarm Home canvas contains phone-only explanatory copy
                // below the primary action. Omitting that copy on the compact
                // watch surface keeps Snooze and Stop in the first viewport.
                if compactAlarmHome, let text = node.text, text.count > 15 { return }
                var line = "Text(\(boundText(node) ?? swiftString(node.text ?? node.name)))\(watchFont(node.style.fontSize))"
                if let textColor = node.style.textColor {
                    line += ".foregroundColor(Color(hex: \"\(textColor)\"))"
                }
                // A text label the user wired a watch tap/long-press to becomes
                // interactive rather than inert.
                if !tapAction.isEmpty {
                    line += "\n.contentShape(Rectangle()).onTapGesture { \(tapAction) }"
                }
                line += longPressModifier
                lines.append(line)
            case .Button:
                lines.append("""
                Button {
                \(indent(tapAction.isEmpty ? "// no action" : tapAction, spaces: 4))
                } label: {
                    Text(\(boundText(node) ?? swiftString(node.text ?? node.name)))
                        .frame(maxWidth: .infinity, minHeight: 44)
                        .contentShape(Rectangle())
                }
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(Rectangle())
                .buttonStyle(.plain)
                .tint(Color(hex: "\(node.style.fill)"))\(longPressModifier)
                """)
            case .Input:
                let field = isSecureInput(node) ? "SecureField" : "TextField"
                lines.append("\(field)(\(swiftString(node.text ?? "")), text: \(binding(for: node, variableTypes: variableTypes) ?? ".constant(\"\")"))")
            case .Icon:
                guard !tapAction.isEmpty else { break }
                lines.append("""
                Button {
                \(indent(tapAction, spaces: 4))
                } label: {
                    Label(\(swiftString(node.name)), systemImage: \(swiftString(node.iconName ?? "circle")))
                }
                """)
            case .Image:
                let image = "\(imageExpression(for: node, imageAssets: imageAssets)).frame(maxWidth: .infinity).frame(height: 64).clipShape(RoundedRectangle(cornerRadius: 8))"
                if tapAction.isEmpty {
                    lines.append(image)
                } else {
                    lines.append("""
                    Button {
                    \(indent(tapAction, spaces: 4))
                    } label: {
                        \(image)
                    }
                    .buttonStyle(.plain)
                    """)
                }
            case .Rectangle:
                break // decorative on the watch
            case .Frame:
                if tapAction.isEmpty {
                    node.children.forEach(emit)
                } else {
                    // A tappable container becomes a single watch button
                    // labelled with its first text (or its name).
                    lines.append("""
                    Button {
                    \(indent(tapAction, spaces: 4))
                    } label: {
                        Text(\(swiftString(firstText(in: node) ?? node.name))).frame(maxWidth: .infinity)
                    }
                    .tint(Color(hex: "\(node.style.fill)"))
                    """)
                }
            }
        }

        nodes.forEach(emit)
        return lines.joined(separator: "\n")
    }

    private static func watchFont(_ fontSize: CGFloat?) -> String {
        switch fontSize ?? 15 {
        // The canvas uses phone-sized typography. WatchOS needs a denser
        // scale so the primary action remains visible without requiring a
        // crown scroll before the user can Snooze or Stop.
        case 48...: return ".font(.title2)"
        case 24..<48: return ".font(.headline)"
        case 17..<24: return ".font(.subheadline)"
        case 13..<17: return ".font(.caption)"
        default: return ".font(.caption2)"
        }
    }

    // Real hardware for the exported app. The preview can only fake a
    // gyroscope or a heart rate; this is the code that actually reads them on
    // device — and it is deliberately conservative, because a fitness app that
    // accumulates distance from GPS noise while the phone sits on a table is
    // worse than one with no distance at all.
    private static func sensorServicesSource() -> String {
        """
        // Generated by AgenticDesigner — device sensors.
        import Foundation
        import Combine

        #if canImport(CoreLocation)
        import CoreLocation
        #endif
        #if canImport(CoreMotion)
        import CoreMotion
        #endif
        #if canImport(HealthKit)
        import HealthKit
        #endif
        #if canImport(UIKit)
        import UIKit
        #endif

        #if canImport(CoreLocation)
        /// GPS with the filtering a real tracker needs.
        ///
        /// Distance is geodesic (`CLLocation.distance(from:)`), never a
        /// degrees-to-kilometres approximation, and elapsed time comes from the
        /// fixes' own timestamps rather than a timer tick — a timer drifts,
        /// especially in the background.
        @MainActor
        public final class LocationService: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
            public static let shared = LocationService()

            @Published public private(set) var latitude: Double = 0
            @Published public private(set) var longitude: Double = 0
            /// Metres, accumulated only from fixes that passed every gate.
            @Published public private(set) var distanceMeters: Double = 0
            /// km/h, smoothed over the last few accepted fixes.
            @Published public private(set) var speedKmh: Double = 0
            @Published public private(set) var horizontalAccuracy: Double = -1
            @Published public private(set) var isTracking = false
            @Published public private(set) var authorized = false
            /// Paused by the user.
            @Published public private(set) var isPaused = false
            /// Paused because the runner actually stopped moving (a traffic
            /// light, a photo). Resumes by itself when they set off again.
            @Published public private(set) var isAutoPaused = false

            private let manager = CLLocationManager()
            private var lastAccepted: CLLocation?
            private var speedSamples: [Double] = []
            private var onceContinuation: CheckedContinuation<CLLocation?, Never>?
            private var stillSince: Date?
            private var movingSince: Date?

            /// Below this, the person is standing still, not running.
            private let stillSpeed: CLLocationSpeed = 0.6      // m/s ≈ 2.2 km/h
            private let stillGrace: TimeInterval = 8           // seconds before auto-pause
            private let movingSpeed: CLLocationSpeed = 1.2     // m/s to auto-resume instantly
            private let resumeGrace: TimeInterval = 3          // sustained-movement auto-resume

            // Gates. Tuned for a human on foot.
            private let worstUsableAccuracy: CLLocationDistance = 25   // metres
            private let maxPlausibleSpeed: CLLocationSpeed = 12        // m/s ≈ 43 km/h
            private let noiseFloor: CLLocationDistance = 1.5           // metres
            private let maxFixAge: TimeInterval = 5                    // seconds

            public var onLocationChanged: ((Double, Double) -> Void)?
            /// Fires each time accepted distance changes: (metres, km/h). This
            /// is how a Start Tracking block streams live values into the
            /// variables its screen is bound to.
            public var onDistanceChange: ((Double, Double) -> Void)?

            private override init() {
                super.init()
                manager.delegate = self
                manager.desiredAccuracy = kCLLocationAccuracyBestForNavigation
                manager.activityType = .fitness
            }

            public func requestAuthorization() {
                manager.requestWhenInUseAuthorization()
            }

            private var authContinuation: CheckedContinuation<Bool, Never>?

            /// Shows the prompt (if needed) and resolves when the user actually
            /// decides — driven by locationManagerDidChangeAuthorization, not a
            /// fixed timeout.
            public func awaitAuthorization() async -> Bool {
                if isAuthorized() { return true }
                return await withCheckedContinuation { continuation in
                    authContinuation = continuation
                    manager.requestWhenInUseAuthorization()
                }
            }

            /// One-shot read. Returns nil if permission is missing or no usable
            /// fix arrives — callers must handle that rather than show a zero.
            public func requestOnce() async -> CLLocation? {
                guard isAuthorized() else {
                    requestAuthorization()
                    return nil
                }
                return await withCheckedContinuation { continuation in
                    onceContinuation = continuation
                    manager.requestLocation()
                }
            }

            /// `background: true` keeps fixes coming with the screen locked and
            /// the app suspended — without it a run silently stops the moment
            /// the phone goes in a pocket. It requires the "Location updates"
            /// background mode in the target's capabilities; setting the flag
            /// without that entitlement crashes, so it is guarded.
            public func startTracking(background: Bool = true) {
                guard isAuthorized() else { requestAuthorization(); return }
                resetRun()
                isTracking = true
                isAutoPaused = false

                if background, hasBackgroundLocationMode {
                    manager.allowsBackgroundLocationUpdates = true
                    // These two do not exist on watchOS — this file is shared,
                    // so it must compile for the watch as well as the phone.
                    #if !os(watchOS)
                    manager.pausesLocationUpdatesAutomatically = false
                    manager.showsBackgroundLocationIndicator = true
                    #endif
                }
                manager.startUpdatingLocation()
            }

            public func stopTracking() {
                isTracking = false
                isAutoPaused = false
                if manager.allowsBackgroundLocationUpdates {
                    manager.allowsBackgroundLocationUpdates = false
                }
                manager.stopUpdatingLocation()
            }

            /// Manual pause. Distance stops accruing but fixes keep arriving, so
            /// resuming does not create a teleport across the paused stretch.
            public func pause() {
                isPaused = true
            }

            public func resume() {
                isPaused = false
                isAutoPaused = false
                lastAccepted = nil   // do not bridge the gap we did not measure
                stillSince = nil
                movingSince = nil
            }

            /// True only if the app declares the background mode. Reading it from
            /// the bundle keeps this honest: no entitlement, no background claim.
            private var hasBackgroundLocationMode: Bool {
                let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String]
                return modes?.contains("location") ?? false
            }

            /// Clears the accumulated route — call when a new run starts. Must
            /// reset the pause flags too: a run that ended while standing still
            /// left isPaused/stillSince set, and the next run then recorded 0 m.
            public func resetRun() {
                distanceMeters = 0
                speedKmh = 0
                lastAccepted = nil
                speedSamples.removeAll()
                isPaused = false
                isAutoPaused = false
                stillSince = nil
                movingSince = nil
            }

            private func isAuthorized() -> Bool {
                let status = manager.authorizationStatus
                authorized = status == .authorizedWhenInUse || status == .authorizedAlways
                return authorized
            }

            public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
                let granted = isAuthorized()
                // The prompt only fires this once the user has chosen — resume
                // any waiter with their real answer. `.notDetermined` is the
                // pre-decision state and is ignored.
                if manager.authorizationStatus != .notDetermined, let continuation = authContinuation {
                    authContinuation = nil
                    continuation.resume(returning: granted)
                }
            }

            public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
                for location in locations { ingest(location) }
                if let continuation = onceContinuation {
                    onceContinuation = nil
                    continuation.resume(returning: locations.last)
                }
            }

            public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
                if let continuation = onceContinuation {
                    onceContinuation = nil
                    continuation.resume(returning: nil)
                }
            }

            private func ingest(_ location: CLLocation) {
                // 1. A negative accuracy means the fix is invalid; a large one
                //    means it is a guess from cell towers, not GPS.
                guard location.horizontalAccuracy > 0,
                      location.horizontalAccuracy <= worstUsableAccuracy else { return }
                // 2. Cached fixes arrive first and are stale.
                guard abs(location.timestamp.timeIntervalSinceNow) <= maxFixAge else { return }

                latitude = location.coordinate.latitude
                longitude = location.coordinate.longitude
                horizontalAccuracy = location.horizontalAccuracy
                onLocationChanged?(latitude, longitude)

                guard isTracking else { lastAccepted = location; return }
                guard let previous = lastAccepted else { lastAccepted = location; return }

                // 3. Geodesic metres, and REAL elapsed time between fixes.
                let delta = location.distance(from: previous)
                let dt = location.timestamp.timeIntervalSince(previous.timestamp)
                guard dt > 0 else { return }

                // 4. Reject teleports (tunnels, tower hand-offs).
                let impliedSpeed = delta / dt
                guard impliedSpeed <= maxPlausibleSpeed else {
                    lastAccepted = location
                    return
                }

                // 5. Auto-pause: a runner waiting at a crossing should not have
                //    the wait averaged into their pace. Decided from measured
                //    speed, with a grace period so one slow fix cannot pause a
                //    run — and it un-pauses itself when they move again.
                let observed = location.speed >= 0 ? location.speed : impliedSpeed
                if observed < stillSpeed {
                    movingSince = nil
                    let since = stillSince ?? location.timestamp
                    stillSince = since
                    if !isAutoPaused, location.timestamp.timeIntervalSince(since) >= stillGrace {
                        isAutoPaused = true
                        speedKmh = 0
                    }
                } else {
                    stillSince = nil
                    if isAutoPaused {
                        // Resume on a clear burst of speed OR on sustained
                        // movement above the still threshold. Requiring the full
                        // movingSpeed left a dead zone: a steady 0.6–1.2 m/s walk
                        // after a pause stayed paused forever and silently
                        // stopped counting distance.
                        let movingStart = movingSince ?? location.timestamp
                        movingSince = movingStart
                        if observed >= movingSpeed || location.timestamp.timeIntervalSince(movingStart) >= resumeGrace {
                            isAutoPaused = false
                            movingSince = nil
                            // Do not bridge the stationary gap into one long segment.
                            lastAccepted = location
                            return
                        }
                    }
                }

                // A paused run keeps receiving fixes (so resuming is accurate)
                // but must not accumulate distance.
                guard !isPaused, !isAutoPaused else {
                    lastAccepted = location
                    return
                }

                // 6. Movement must clear the noise floor AND the accuracy of
                //    the fix. A phone on a table with 15 m accuracy produces
                //    5 m jitter every second; without this, and when the OS
                //    reports speed = -1 (common indoors), that jitter was
                //    logged as an 18 km/h run. Require the step to exceed the
                //    position uncertainty, not just a fixed 1.5 m.
                let movementFloor = max(noiseFloor, location.horizontalAccuracy * 0.5)
                guard delta >= movementFloor else { return }

                distanceMeters += delta
                lastAccepted = location

                // 7. The receiver's Doppler speed is better than a derived one.
                speedSamples.append(observed)
                if speedSamples.count > 5 { speedSamples.removeFirst() }
                let mean = speedSamples.reduce(0, +) / Double(speedSamples.count)
                speedKmh = mean * 3.6

                onDistanceChange?(distanceMeters, speedKmh)
            }
        }
        #endif

        #if canImport(HealthKit)
        /// HealthKit reads (heart rate, steps). On Apple Watch these are live.
        @MainActor
        public final class HealthService: ObservableObject {
            public static let shared = HealthService()

            @Published public private(set) var heartRate: Double = 0
            @Published public private(set) var steps: Double = 0
            @Published public private(set) var authorized = false

            private let store = HKHealthStore()

            private init() {}

            public func requestAuthorization() async -> Bool {
                guard HKHealthStore.isHealthDataAvailable() else { return false }
                var types: Set<HKObjectType> = []
                if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { types.insert(hr) }
                if let steps = HKObjectType.quantityType(forIdentifier: .stepCount) { types.insert(steps) }
                do {
                    try await store.requestAuthorization(toShare: [], read: types)
                    authorized = true
                } catch {
                    authorized = false
                }
                return authorized
            }

            /// Most recent heart-rate sample, in bpm. nil when unavailable —
            /// callers must not substitute a fake number.
            public func latestHeartRate() async -> Double? {
                guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return nil }
                let sample: HKQuantitySample? = await withCheckedContinuation { continuation in
                    let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
                    let query = HKSampleQuery(
                        sampleType: type, predicate: nil, limit: 1, sortDescriptors: [sort]
                    ) { _, samples, _ in
                        continuation.resume(returning: samples?.first as? HKQuantitySample)
                    }
                    store.execute(query)
                }
                guard let sample else { return nil }
                let bpm = sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute()))
                heartRate = bpm
                return bpm
            }

            /// Steps since midnight.
            public func todaySteps() async -> Double? {
                guard let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return nil }
                let start = Calendar.current.startOfDay(for: Date())
                let predicate = HKQuery.predicateForSamples(withStart: start, end: Date())
                let total: Double? = await withCheckedContinuation { continuation in
                    let query = HKStatisticsQuery(
                        quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum
                    ) { _, statistics, _ in
                        continuation.resume(returning: statistics?.sumQuantity()?.doubleValue(for: .count()))
                    }
                    store.execute(query)
                }
                if let total { steps = total }
                return total
            }
        }
        #endif

        #if canImport(CoreMotion)
        /// Accelerometer / device motion.
        @MainActor
        public final class MotionService: ObservableObject {
            public static let shared = MotionService()

            @Published public private(set) var x: Double = 0
            @Published public private(set) var y: Double = 0
            @Published public private(set) var z: Double = 0

            private let manager = CMMotionManager()
            private init() {}

            /// Reads one sample. Returns false when the hardware is absent
            /// (e.g. the Simulator) so a flow can take its error branch.
            @discardableResult
            public func readOnce() -> Bool {
                guard manager.isAccelerometerAvailable else { return false }
                if !manager.isAccelerometerActive {
                    manager.accelerometerUpdateInterval = 0.1
                    manager.startAccelerometerUpdates()
                }
                guard let data = manager.accelerometerData else { return false }
                x = data.acceleration.x
                y = data.acceleration.y
                z = data.acceleration.z
                return true
            }

            public func stop() { manager.stopAccelerometerUpdates() }
        }
        #endif

        /// Battery level, 0–100. Returns nil where there is no battery API.
        @MainActor
        public enum DeviceInfo {
            public static func batteryPercent() -> Double? {
                #if canImport(UIKit) && !os(watchOS)
                UIDevice.current.isBatteryMonitoringEnabled = true
                let level = UIDevice.current.batteryLevel
                guard level >= 0 else { return nil }
                return Double(level) * 100
                #else
                return nil
                #endif
            }
        }
        """
    }

    // A watch screen is not a watch app. This is the part that makes it one:
    // a real HKWorkoutSession with a LIVE heart-rate stream, and
    // WatchConnectivity so Start/Pause/Finish mean the same thing on both
    // devices. Without these, "Apple Watch synced" is a caption, not a claim.
    private static func watchWorkoutSource() -> String {
        """
        // Generated by AgenticDesigner — Apple Watch workout session.
        import Foundation
        import Combine

        #if canImport(HealthKit)
        import HealthKit
        #endif
        #if canImport(WatchConnectivity)
        import WatchConnectivity
        #endif

        #if os(watchOS) && canImport(HealthKit)
        /// A real workout: HealthKit keeps the app alive in the background,
        /// streams heart rate, and accrues distance/energy — none of which a
        /// one-shot `readHeartRate` query can do.
        @MainActor
        public final class WatchWorkoutService: NSObject, ObservableObject,
                                                HKWorkoutSessionDelegate, HKLiveWorkoutBuilderDelegate {
            public static let shared = WatchWorkoutService()

            @Published public private(set) var heartRate: Double = 0
            @Published public private(set) var activeEnergy: Double = 0
            @Published public private(set) var distanceMeters: Double = 0
            @Published public private(set) var elapsed: TimeInterval = 0
            @Published public private(set) var isRunning = false
            @Published public private(set) var isPaused = false

            private let store = HKHealthStore()
            private var session: HKWorkoutSession?
            private var builder: HKLiveWorkoutBuilder?
            // Guards against a second start() slipping past the !isRunning check
            // while the first is still awaiting authorization (isRunning is only
            // set true after the await), which would leak a duplicate session.
            private var starting = false

            private override init() { super.init() }

            /// End and release the session/builder. Idempotent: safe to call on
            /// a failed start, a delegate failure, or a normal finish.
            private func cleanupSession() {
                session?.end()
                session = nil
                builder = nil
            }

            public func requestAuthorization() async -> Bool {
                guard HKHealthStore.isHealthDataAvailable() else { return false }
                let share: Set = [HKQuantityType.workoutType()]
                var read: Set<HKObjectType> = [HKQuantityType.workoutType()]
                for id in [HKQuantityTypeIdentifier.heartRate,
                           .activeEnergyBurned,
                           .distanceWalkingRunning] {
                    if let type = HKQuantityType.quantityType(forIdentifier: id) { read.insert(type) }
                }
                do {
                    try await store.requestAuthorization(toShare: share, read: read)
                    return true
                } catch {
                    return false
                }
            }

            public func start(activity: HKWorkoutActivityType = .running) async {
                guard !isRunning, !starting, session == nil else { return }
                starting = true
                defer { starting = false }
                guard await requestAuthorization() else { return }

                let configuration = HKWorkoutConfiguration()
                configuration.activityType = activity
                configuration.locationType = .outdoor

                do {
                    let session = try HKWorkoutSession(healthStore: store, configuration: configuration)
                    let builder = session.associatedWorkoutBuilder()
                    builder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
                    session.delegate = self
                    builder.delegate = self

                    self.session = session
                    self.builder = builder

                    let start = Date()
                    session.startActivity(with: start)
                    try await builder.beginCollection(at: start)
                    isRunning = true
                    isPaused = false
                    PhoneWatchSync.shared.send(["workout": "started"])
                } catch {
                    // A throw after self.session was set would otherwise leave a
                    // dangling session that the next start() overwrites, leaking
                    // the HealthKit session.
                    cleanupSession()
                    isRunning = false
                }
            }

            public func pause() {
                session?.pause()
                isPaused = true
                PhoneWatchSync.shared.send(["workout": "paused"])
            }

            public func resume() {
                session?.resume()
                isPaused = false
                PhoneWatchSync.shared.send(["workout": "resumed"])
            }

            public func finish() async {
                guard let session, let builder else { return }
                let end = Date()
                session.end()
                try? await builder.endCollection(at: end)
                _ = try? await builder.finishWorkout()
                isRunning = false
                isPaused = false
                self.session = nil
                self.builder = nil
                let finalDistance = distanceMeters
                PhoneWatchSync.shared.send(["workout": "finished", "distance": finalDistance])
            }

            // MARK: HKWorkoutSessionDelegate

            nonisolated public func workoutSession(
                _ workoutSession: HKWorkoutSession,
                didChangeTo toState: HKWorkoutSessionState,
                from fromState: HKWorkoutSessionState,
                date: Date
            ) {
                Task { @MainActor in
                    self.isRunning = toState == .running || toState == .paused
                    self.isPaused = toState == .paused
                    // A session that ended out from under us (system stop, low
                    // battery) must release its resources too, or the next start
                    // sees a non-nil session and refuses to run.
                    if toState == .ended || toState == .stopped {
                        self.cleanupSession()
                    }
                }
            }

            nonisolated public func workoutSession(
                _ workoutSession: HKWorkoutSession,
                didFailWithError error: Error
            ) {
                Task { @MainActor in
                    self.isRunning = false
                    self.isPaused = false
                    self.cleanupSession()
                }
            }

            // MARK: HKLiveWorkoutBuilderDelegate — the live stream

            nonisolated public func workoutBuilder(
                _ workoutBuilder: HKLiveWorkoutBuilder,
                didCollectDataOf collectedTypes: Set<HKSampleType>
            ) {
                for type in collectedTypes {
                    guard let quantityType = type as? HKQuantityType,
                          let statistics = workoutBuilder.statistics(for: quantityType) else { continue }

                    Task { @MainActor in
                        switch quantityType.identifier {
                        case HKQuantityTypeIdentifier.heartRate.rawValue:
                            let unit = HKUnit.count().unitDivided(by: .minute())
                            self.heartRate = statistics.mostRecentQuantity()?.doubleValue(for: unit) ?? self.heartRate
                        case HKQuantityTypeIdentifier.activeEnergyBurned.rawValue:
                            self.activeEnergy = statistics.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? self.activeEnergy
                        case HKQuantityTypeIdentifier.distanceWalkingRunning.rawValue:
                            self.distanceMeters = statistics.sumQuantity()?.doubleValue(for: .meter()) ?? self.distanceMeters
                        default:
                            break
                        }
                        self.elapsed = workoutBuilder.elapsedTime
                    }
                }
            }

            nonisolated public func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}
        }
        #endif

        #if canImport(WatchConnectivity)
        /// Start/Pause/Finish must mean the same thing on both devices.
        public final class PhoneWatchSync: NSObject, ObservableObject, WCSessionDelegate {
            public static let shared = PhoneWatchSync()

            @Published public private(set) var lastMessage: [String: Any] = [:]
            @Published public private(set) var isReachable = false

            public var onMessage: (([String: Any]) -> Void)?

            private override init() {
                super.init()
                guard WCSession.isSupported() else { return }
                WCSession.default.delegate = self
                WCSession.default.activate()
            }

            public func send(_ message: [String: Any]) {
                guard WCSession.isSupported() else { return }
                let session = WCSession.default
                if session.isReachable {
                    session.sendMessage(message, replyHandler: nil, errorHandler: nil)
                } else {
                    // Queued until the counterpart is reachable — a run must not
                    // be lost because the phone was in a pocket out of range.
                    try? session.updateApplicationContext(message)
                }
            }

            public func session(
                _ session: WCSession,
                activationDidCompleteWith state: WCSessionActivationState,
                error: Error?
            ) {
                let reachable = session.isReachable
                Task { @MainActor in self.isReachable = reachable }
            }

            public func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
                Task { @MainActor in
                    self.lastMessage = message
                    self.onMessage?(message)
                }
            }

            public func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
                Task { @MainActor in
                    self.lastMessage = context
                    self.onMessage?(context)
                }
            }

            #if os(iOS)
            public func sessionDidBecomeInactive(_ session: WCSession) {}
            public func sessionDidDeactivate(_ session: WCSession) { WCSession.default.activate() }
            #endif
        }
        #endif
        """
    }

    /// "Light" or "Dark" — whichever matches the authored palette. Generated
    /// colors are single-valued, so letting the SYSTEM flip appearance mixes
    /// dark keyboards/alerts into a light design (or vice versa). Until
    /// adaptive palettes exist, pinning the style is the professional choice.
    private static func forcedInterfaceStyle(for project: DesignProject) -> String? {
        let firstScreen = project.pages
            .flatMap(\.nodes)
            .first { $0.type == .Frame }
        guard let fill = firstScreen?.style.fill, fill.hasPrefix("#"), fill.count >= 7,
              let value = Int(fill.dropFirst().prefix(6), radix: 16) else { return nil }
        let r = Double((value >> 16) & 0xFF) / 255
        let g = Double((value >> 8) & 0xFF) / 255
        let b = Double(value & 0xFF) / 255
        return (0.299 * r + 0.587 * g + 0.114 * b) < 0.5 ? "Dark" : "Light"
    }

    /// The plist FirebaseApp.configure() looks for. Every value is a public
    /// client identifier (they ship inside every Firebase app on the store) —
    /// access is controlled by the security rules, not by hiding these.
    /// Returns nil unless all four required keys are present, because a
    /// half-filled plist crashes at launch instead of degrading.
    private static func googleServiceInfoPlist(config: FirebaseConfig?, bundleId: String) -> String? {
        guard let config, config.isEnabled else { return nil }
        let required = [config.apiKey, config.appId, config.messagingSenderId, config.projectId]
        guard required.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { return nil }
        let bucket = config.storageBucket.isEmpty ? "\(config.projectId).appspot.com" : config.storageBucket

        func entry(_ key: String, _ value: String) -> String {
            "\t<key>\(key)</key>\n\t<string>\(xmlEscaped(value))</string>"
        }
        func flag(_ key: String, _ value: Bool) -> String {
            "\t<key>\(key)</key>\n\t<\(value)/>"
        }

        return """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
        \(entry("API_KEY", config.apiKey))
        \(entry("GCM_SENDER_ID", config.messagingSenderId))
        \(entry("GOOGLE_APP_ID", config.appId))
        \(entry("PROJECT_ID", config.projectId))
        \(entry("STORAGE_BUCKET", bucket))
        \(entry("BUNDLE_ID", bundleId))
        \(entry("PLIST_VERSION", "1"))
        \(flag("IS_ADS_ENABLED", false))
        \(flag("IS_ANALYTICS_ENABLED", false))
        \(flag("IS_APPINVITE_ENABLED", true))
        \(flag("IS_GCM_ENABLED", true))
        \(flag("IS_SIGNIN_ENABLED", true))
        </dict>
        </plist>

        """
    }

    private static func firebaseDeployConfigJSON() -> String {
        """
        {
          "firestore": {
            "rules": "firestore.rules"
          }
        }

        """
    }

    private static func firebaseRCSource(projectId: String) -> String {
        """
        {
          "projects": {
            "default": "\(projectId)"
          }
        }

        """
    }

    private static func xmlEscaped(_ text: String) -> String {
        text.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    /// Firestore rules. The default database is open to the world; shipping
    /// without rules means any user can read every other user's profile and
    /// runs. These deny by default and let a signed-in user touch only their
    /// own documents.
    ///
    /// `publicRead` names the collections that are SHARED (a catalog, a social
    /// feed): readable by any signed-in user, writable only by the document's
    /// owner. Applying the owner-only read rule to those would leave a feed
    /// nobody can read — technically secure, functionally broken.
    private static func firestoreRulesSource(
        collections: [FirestoreCollection],
        publicRead: [String] = []
    ) -> String {
        let shared = Set(publicRead)
        let blocks = collections.map { collection -> String in
            if shared.contains(collection.name) {
                return """
                    // \(collection.name): shared — any signed-in user reads, only the owner writes.
                    match /\(collection.name)/{docId} {
                      allow read: if isSignedIn();
                      allow create: if isOwner(request.resource.data.userId);
                      allow update, delete: if isOwner(resource.data.userId);
                    }
                """
            }
            if collection.ownerScoped {
                return """
                    // \(collection.name): documents named by uid — path-scoped to the owner.
                    match /\(collection.name)/{userId} {
                      allow read, write: if isOwner(userId);
                      match /{document=**} { allow read, write: if isOwner(userId); }
                    }
                """
            } else {
                // Auto-ID docs / list queries: the document must CARRY a userId
                // field, checked on read and on create. This is the rule that
                // makes addDocument("runs", …) actually succeed.
                return """
                    // \(collection.name): auto-ID documents, scoped by a userId field.
                    match /\(collection.name)/{docId} {
                      allow read: if isOwner(resource.data.userId);
                      allow create: if isOwner(request.resource.data.userId);
                      allow update, delete: if isOwner(resource.data.userId);
                    }
                """
            }
        }.joined(separator: "\n\n")

        return """
        rules_version = '2';

        // Generated by AgenticDesigner.
        //
        // Deny by default. A collection is reachable only by the user who owns
        // it. `isVerified()` is provided so you can additionally gate sensitive
        // writes on a confirmed email — e.g. change `allow create` to
        // `if isOwner(...) && isVerified()`; it is NOT applied by default so a
        // brand-new account can still write its own profile.
        //
        // Test these in the Firebase console's Rules Playground BEFORE shipping.
        service cloud.firestore {
          match /databases/{database}/documents {

            function isSignedIn() {
              return request.auth != null;
            }

            function isOwner(userId) {
              return isSignedIn() && request.auth.uid == userId;
            }

            function isVerified() {
              return isSignedIn() && request.auth.token.email_verified == true;
            }

        \(blocks.isEmpty ? "        // No user-scoped collections detected in the flows." : blocks)

            // Anything not matched above is denied.
            match /{document=**} {
              allow read, write: if false;
            }
          }
        }
        """
    }

    /// A collection the flows use, and whether documents in it are keyed by
    /// the user's uid (setDocument with {{uid}}) or auto-ID (addDocument /
    /// query). The two need DIFFERENT rules: a uid-keyed doc checks the path;
    /// an auto-ID doc has to carry a userId field the rule checks instead —
    /// otherwise `addDocument` and `query` are denied at runtime and every
    /// save silently fails.
    private struct FirestoreCollection {
        let name: String
        var ownerScoped: Bool   // documents are named {uid}
        var collectionScoped: Bool  // auto-ID docs / list queries
    }

    private static func firestoreCollections(
        in flows: [LogicFlow],
        declared config: FirebaseConfig? = nil
    ) -> [FirestoreCollection] {
        var byName: [String: FirestoreCollection] = [:]
        // Only simple names — a value with a slash or brace would rewrite the
        // rules structure (a real injection: "x} match /{d=**}{allow...").
        let validName = { (name: String) in
            !name.isEmpty && name.allSatisfy { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
        }
        for flow in flows {
            for block in flow.blocks {
                guard let collection = paramValue(block, "collection"), validName(collection) else { continue }
                var entry = byName[collection] ?? FirestoreCollection(name: collection, ownerScoped: false, collectionScoped: false)
                switch block.type {
                case .firestoreSetDocument, .firestoreUpdateDocument, .firestoreDeleteDocument, .firestoreGetDocument:
                    let docId = paramValue(block, "documentId") ?? ""
                    if docId.contains("{{uid}}") || docId.contains("{{userId}}") || docId.isEmpty == false {
                        entry.ownerScoped = true
                    } else {
                        entry.collectionScoped = true
                    }
                case .firestoreAddDocument, .firestoreQuery:
                    entry.collectionScoped = true
                default:
                    continue
                }
                byName[collection] = entry
            }
        }
        // Collections the PROJECT declares (BackendBlueprint / set_firebase_config)
        // but no flow touches yet — a public catalog the app only reads later,
        // or a schema written ahead of the screens. Without them the deployed
        // rules deny a collection the app is documented to use.
        for template in config?.defaultCollections ?? [] {
            let name = template.name
            guard validName(name), byName[name] == nil else { continue }
            byName[name] = FirestoreCollection(
                name: name,
                ownerScoped: name == "users",
                collectionScoped: name != "users"
            )
        }
        return byName.values.sorted { $0.name < $1.name }
    }

    // The parts of "having an account" that a sign-up flow alone does not give
    // you: staying signed in across launches, knowing whether the email was
    // ever verified, and letting someone use the app BEFORE handing over an
    // identity. Forcing login before any value is delivered is how a fitness
    // app loses the user at screen one.
    private static func authServiceSource() -> String {
        """
        // Generated by AgenticDesigner — session, verification, guest mode.
        import Foundation
        import Combine

        #if canImport(FirebaseAuth)
        import FirebaseAuth
        #endif

        @MainActor
        public final class AuthService: ObservableObject {
            public static let shared = AuthService()

            public enum Mode: String {
                case signedOut
                case guest        // Using the app with no account yet.
                case signedIn
            }

            @Published public private(set) var mode: Mode = .signedOut
            @Published public private(set) var userId: String = ""
            @Published public private(set) var email: String = ""
            /// False until the user clicks the link in their inbox. Gate
            /// anything that trusts the address (billing, sharing) on this.
            @Published public private(set) var isEmailVerified = false

            private let modeKey = "auth.mode"
            private let guestIdKey = "auth.guestId"

            private init() {}

            // MARK: Session restoration

            /// Call once at launch. Without this the user is thrown back to the
            /// login screen on every cold start even though their session is
            /// still perfectly valid.
            public func restore() {
                #if canImport(FirebaseAuth)
                if let user = Auth.auth().currentUser {
                    userId = user.uid
                    email = user.email ?? ""
                    isEmailVerified = user.isEmailVerified
                    mode = .signedIn
                    // The cached flag can be stale — the user may have clicked
                    // the link on another device since the last launch.
                    Task { await self.refreshVerification() }
                    return
                }
                #endif
                if UserDefaults.standard.string(forKey: modeKey) == Mode.guest.rawValue {
                    userId = guestId()
                    mode = .guest
                    return
                }
                mode = .signedOut
            }

            // MARK: Guest mode

            /// A stable local identity so a guest's data has somewhere to live
            /// and can be migrated intact if they later create an account.
            public func continueAsGuest() {
                userId = guestId()
                email = ""
                isEmailVerified = false
                mode = .guest
                UserDefaults.standard.set(Mode.guest.rawValue, forKey: modeKey)
            }

            private func guestId() -> String {
                if let existing = UserDefaults.standard.string(forKey: guestIdKey) { return existing }
                let fresh = "guest_" + UUID().uuidString
                UserDefaults.standard.set(fresh, forKey: guestIdKey)
                return fresh
            }

            /// The id a guest's local data was written under, so it can be
            /// re-parented to the real uid after sign-up.
            public var previousGuestId: String? {
                UserDefaults.standard.string(forKey: guestIdKey)
            }

            // MARK: Email verification

            @discardableResult
            public func sendVerificationEmail() async -> Bool {
                #if canImport(FirebaseAuth)
                guard let user = Auth.auth().currentUser else { return false }
                do {
                    try await user.sendEmailVerification()
                    return true
                } catch {
                    return false
                }
                #else
                return false
                #endif
            }

            @discardableResult
            public func refreshVerification() async -> Bool {
                #if canImport(FirebaseAuth)
                guard let user = Auth.auth().currentUser else { return false }
                try? await user.reload()
                isEmailVerified = Auth.auth().currentUser?.isEmailVerified ?? false
                return isEmailVerified
                #else
                return false
                #endif
            }

            // MARK: Sign in / out

            public func didSignIn(userId: String, email: String, verified: Bool) {
                self.userId = userId
                self.email = email
                self.isEmailVerified = verified
                mode = .signedIn
                UserDefaults.standard.set(Mode.signedIn.rawValue, forKey: modeKey)
            }

            public func signOut() {
                #if canImport(FirebaseAuth)
                try? Auth.auth().signOut()
                #endif
                userId = ""
                email = ""
                isEmailVerified = false
                mode = .signedOut
                UserDefaults.standard.removeObject(forKey: modeKey)
            }
        }
        """
    }

    /// Permissions asked in context, at the moment they buy the user something
    /// — not fired all at once on launch, which reads as a popup ambush and is
    /// the fastest way to get every one of them denied.
    private static func permissionsSource() -> String {
        """
        // Generated by AgenticDesigner — progressive permissions.
        import Foundation
        import Combine

        #if canImport(CoreLocation)
        import CoreLocation
        #endif
        #if canImport(UserNotifications)
        import UserNotifications
        #endif
        #if canImport(HealthKit)
        import HealthKit
        #endif

        @MainActor
        public enum Permissions {

            /// Ask ONLY when the user starts something that needs it. Returns
            /// the current state so a caller can show its own explanation first
            /// — the system prompt can be shown exactly once, so spending it
            /// without context is spending it badly.
            public enum Status { case granted, denied, notAsked }

            // MARK: Location — ask when a run starts, not at launch.

            public static func locationStatus() -> Status {
                #if canImport(CoreLocation)
                switch CLLocationManager().authorizationStatus {
                case .authorizedAlways, .authorizedWhenInUse: return .granted
                case .denied, .restricted: return .denied
                default: return .notAsked
                }
                #else
                return .denied
                #endif
            }

            @discardableResult
            public static func requestLocation() async -> Bool {
                #if canImport(CoreLocation)
                switch locationStatus() {
                case .granted: return true
                case .denied: return false
                case .notAsked:
                    // Await the user's ACTUAL decision via the auth-change
                    // callback. The old 400 ms sleep reported "denied" for
                    // everyone, because nobody taps Allow that fast.
                    return await LocationService.shared.awaitAuthorization()
                }
                #else
                return false
                #endif
            }

            // MARK: Notifications — ask only after the user opts into a reminder.

            public static func notificationStatus() async -> Status {
                #if canImport(UserNotifications)
                let settings = await UNUserNotificationCenter.current().notificationSettings()
                switch settings.authorizationStatus {
                case .authorized, .provisional, .ephemeral: return .granted
                case .denied: return .denied
                default: return .notAsked
                }
                #else
                return .denied
                #endif
            }

            @discardableResult
            public static func requestNotifications() async -> Bool {
                #if canImport(UserNotifications)
                guard await notificationStatus() != .denied else { return false }
                let granted = try? await UNUserNotificationCenter.current()
                    .requestAuthorization(options: [.alert, .sound, .badge])
                return granted ?? false
                #else
                return false
                #endif
            }

            // MARK: Health — ask only when the user connects a Watch.

            @discardableResult
            public static func requestHealth() async -> Bool {
                #if canImport(HealthKit)
                return await HealthService.shared.requestAuthorization()
                #else
                return false
                #endif
            }
        }
        """
    }

    /// Crash-safe state. A run that only lives in memory is one force-quit away
    /// from never having happened.
    // Real StoreKit 2. Never returns a fake success: a purchase is only
    // "successful" once StoreKit hands back a cryptographically VERIFIED
    // transaction — a cancel, a pending parental-approval, or an unverified
    // receipt all return nil so the flow takes its Error branch.
    private static func storeServiceSource() -> String {
        """
        // Generated by AgenticDesigner — StoreKit 2 purchases.
        import Foundation
        import StoreKit

        @MainActor
        public final class StoreService: ObservableObject {
            public static let shared = StoreService()

            @Published public private(set) var purchasedIds: Set<String> = []

            private init() { Task { await refreshEntitlements() } }

            /// Buy a product. Returns the transaction id on a VERIFIED purchase,
            /// nil on cancel / pending / failure.
            public func purchase(productId: String) async -> String? {
                do {
                    let products = try await Product.products(for: [productId])
                    guard let product = products.first else { return nil }
                    switch try await product.purchase() {
                    case .success(let verification):
                        guard case .verified(let transaction) = verification else { return nil }
                        await transaction.finish()
                        purchasedIds.insert(transaction.productID)
                        return String(transaction.id)
                    case .userCancelled, .pending:
                        return nil
                    @unknown default:
                        return nil
                    }
                } catch {
                    return nil
                }
            }

            /// Restore prior purchases. True if any entitlement is now active.
            public func restore() async -> Bool {
                try? await AppStore.sync()
                await refreshEntitlements()
                return !purchasedIds.isEmpty
            }

            public func isPurchased(_ productId: String) -> Bool { purchasedIds.contains(productId) }

            private func refreshEntitlements() async {
                var active: Set<String> = []
                for await result in Transaction.currentEntitlements {
                    if case .verified(let transaction) = result { active.insert(transaction.productID) }
                }
                purchasedIds = active
            }
        }
        """
    }

    // Real APNs registration. The token only exists once Apple's servers hand
    // it back to the app delegate — so register() suspends on a continuation
    // that the delegate resolves, rather than pretending a token is ready.
    private static func pushServiceSource() -> String {
        """
        // Generated by AgenticDesigner — APNs registration (iOS).
        import Foundation
        #if os(iOS)
        import UIKit
        import UserNotifications

        @MainActor
        public final class PushService: NSObject, ObservableObject {
            public static let shared = PushService()

            @Published public private(set) var deviceToken: String?
            private var tokenContinuation: CheckedContinuation<String?, Never>?

            private override init() { super.init() }

            /// Ask permission, register with APNs, and await the device token.
            /// Returns nil if the user denies or registration fails — the app
            /// must handle that rather than claim it is subscribed to push.
            public func register() async -> String? {
                let center = UNUserNotificationCenter.current()
                let granted = (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
                guard granted else { return nil }
                return await withCheckedContinuation { continuation in
                    self.tokenContinuation = continuation
                    UIApplication.shared.registerForRemoteNotifications()
                }
            }

            fileprivate func didRegister(_ token: Data) {
                let hex = token.map { String(format: "%02x", $0) }.joined()
                deviceToken = hex
                tokenContinuation?.resume(returning: hex)
                tokenContinuation = nil
            }

            fileprivate func didFail() {
                tokenContinuation?.resume(returning: nil)
                tokenContinuation = nil
            }
        }

        /// Wired into the app via @UIApplicationDelegateAdaptor so the APNs
        /// token callback has somewhere to land.
        public final class PushAppDelegate: NSObject, UIApplicationDelegate {
            public func application(_ application: UIApplication,
                                    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
                Task { @MainActor in PushService.shared.didRegister(deviceToken) }
            }
            public func application(_ application: UIApplication,
                                    didFailToRegisterForRemoteNotificationsWithError error: Error) {
                Task { @MainActor in PushService.shared.didFail() }
            }
        }
        #endif
        """
    }

    private static func persistenceSource() -> String {
        """
        // Generated by AgenticDesigner — local-first persistence.
        import Foundation
        import Security

        /// Secrets live here, never in UserDefaults: a token in a plist is one
        /// unencrypted backup away from leaking. Save Value / Load Value blocks
        /// whose key names a secret (password, token, pin, ...) route here
        /// automatically.
        public enum GeneratedKeychain {
            private static func query(forKey key: String) -> [String: Any] {
                [kSecClass as String: kSecClassGenericPassword,
                 kSecAttrService as String: Bundle.main.bundleIdentifier ?? "generated.app",
                 kSecAttrAccount as String: key]
            }

            public static func set(_ value: String, forKey key: String) {
                var attributes = query(forKey: key)
                SecItemDelete(attributes as CFDictionary)
                attributes[kSecValueData as String] = Data(value.utf8)
                attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
                SecItemAdd(attributes as CFDictionary, nil)
            }

            public static func get(forKey key: String) -> String? {
                var request = query(forKey: key)
                request[kSecReturnData as String] = true
                request[kSecMatchLimit as String] = kSecMatchLimitOne
                var result: AnyObject?
                guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess,
                      let data = result as? Data else { return nil }
                return String(data: data, encoding: .utf8)
            }

            public static func remove(forKey key: String) {
                SecItemDelete(query(forKey: key) as CFDictionary)
            }
        }

        /// Autosaves app state to disk and restores it on launch, so a crash,
        /// a force-quit or an OS eviction cannot silently destroy an in-progress
        /// session.
        public enum StateStore {
            private static var url: URL {
                let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
                return base.appendingPathComponent("app-state.json")
            }

            public static func save(_ values: [String: String]) {
                guard let data = try? JSONSerialization.data(withJSONObject: values) else { return }
                // Atomic: a crash mid-write must not leave a corrupt file.
                try? data.write(to: url, options: .atomic)
            }

            public static func load() -> [String: String] {
                guard let data = try? Data(contentsOf: url),
                      let values = try? JSONSerialization.jsonObject(with: data) as? [String: String]
                else { return [:] }
                return values
            }

            public static func clear() {
                try? FileManager.default.removeItem(at: url)
            }
        }
        """
    }

    private static func supportSource(appName: String, hasResources: Bool, imageAssets: [String: String] = [:]) -> String {
        // Runtime map from the ORIGINAL design-time file path to the bundled
        // resource name. Lets a dynamically set image source (e.g. a tapped
        // list row storing its own file path) resolve to the copied asset,
        // since the sandboxed app can't read the original Mac path.
        let assetMapLiteral: String
        if imageAssets.isEmpty {
            assetMapLiteral = "[:]"
        } else {
            let entries = imageAssets.sorted { $0.key < $1.key }
                .map { "            \(swiftString($0.key)): \(swiftString($0.value))" }
                .joined(separator: ",\n")
            assetMapLiteral = "[\n\(entries)\n        ]"
        }
        return """
        import SwiftUI
        import SQLite3

        /// Native hour:minute wheels bound to two string state variables.
        /// iOS shows wheels; watchOS uses its default crown-driven pickers.
        struct GeneratedTimePicker: View {
            @Binding var hour: String
            @Binding var minute: String

            var body: some View {
                HStack(spacing: 2) {
                    Picker("", selection: Binding(
                        get: { Int(hour) ?? 6 },
                        set: { hour = String($0) })) {
                        ForEach(0..<24, id: \\.self) { Text(String(format: "%02d", $0)).tag($0) }
                    }
                    .labelsHidden()
                    Text(":").font(.headline)
                    Picker("", selection: Binding(
                        get: { Int(minute) ?? 0 },
                        set: { minute = String(format: "%02d", $0) })) {
                        ForEach(0..<60, id: \\.self) { Text(String(format: "%02d", $0)).tag($0) }
                    }
                    .labelsHidden()
                }
                #if os(iOS)
                .pickerStyle(.wheel)
                #endif
            }
        }

        /// String-level JSON-array append: deterministic formatting so string
        /// matching (contains / replace) works reliably on the stored list.
        enum GeneratedJSONList {
            static func appending(_ list: String, item: String) -> String {
                var trimmed = list.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.hasPrefix("[") { trimmed = "[]" }
                return trimmed == "[]" ? "[\\(item)]" : String(trimmed.dropLast()) + ",\\(item)]"
            }
        }

        /// Clean text rendering for number state: whole values print "47",
        /// not "47.0"; fractional values keep their decimals.
        enum GeneratedNumber {
            static func clean(_ value: Double) -> String {
                value.truncatingRemainder(dividingBy: 1) == 0
                    ? String(Int(value)) : String(value)
            }
            static func clean(_ value: String) -> String { value }
        }

        enum GeneratedAssetMap {
            static let byPath: [String: String] = \(assetMapLiteral)
        }

        #if canImport(UIKit) && !os(watchOS)
        import SwiftUI

        /// Renders design-time-coordinate screens (authored at 390x844) on ANY
        /// device size by scaling a UIKit container. Deliberately NOT SwiftUI
        /// .scaleEffect: that is a GeometryEffect — it rescales pixels but not
        /// hit-testing, so buttons away from the anchor stop responding. A
        /// UIView transform moves rendering AND touch delivery together.
        /// Fit-scaling (min of the two ratios) guarantees nothing is cropped;
        /// the letterbox, when any, shows the screen's own background color.
        public struct DesignScaledHost<Content: View>: UIViewControllerRepresentable {
            let designSize: CGSize
            let content: () -> Content

            public init(designSize: CGSize = CGSize(width: 390, height: 844), @ViewBuilder content: @escaping () -> Content) {
                self.designSize = designSize
                self.content = content
            }

            public func makeUIViewController(context: Context) -> ScalingController<Content> {
                ScalingController(designSize: designSize, rootView: content())
            }

            public func updateUIViewController(_ controller: ScalingController<Content>, context: Context) {
                controller.host.rootView = content()
                controller.view.setNeedsLayout()
            }

            public final class ScalingController<Inner: View>: UIViewController {
                let host: UIHostingController<Inner>
                private let designSize: CGSize

                init(designSize: CGSize, rootView: Inner) {
                    self.designSize = designSize
                    self.host = UIHostingController(rootView: rootView)
                    super.init(nibName: nil, bundle: nil)
                    addChild(host)
                    view.addSubview(host.view)
                    host.didMove(toParent: self)
                    host.view.backgroundColor = .clear
                    view.backgroundColor = .clear
                    // The hosted content manages its own insets — double
                    // safe-area application would shift the scaled layout.
                    host.view.insetsLayoutMarginsFromSafeArea = false
                }

                @available(*, unavailable)
                required init?(coder: NSCoder) { fatalError("unsupported") }

                public override func viewDidLayoutSubviews() {
                    super.viewDidLayoutSubviews()
                    let size = view.bounds.size
                    guard size.width > 1, size.height > 1 else { return }
                    let scale = min(size.width / designSize.width, size.height / designSize.height)
                    host.view.transform = .identity
                    host.view.bounds = CGRect(origin: .zero, size: designSize)
                    host.view.transform = CGAffineTransform(scaleX: scale, y: scale)
                    host.view.center = CGPoint(x: size.width / 2, y: size.height / 2)
                }
            }
        }
        #endif

        #if canImport(UIKit)
        import UIKit
        #elseif canImport(AppKit)
        import AppKit
        #endif
        #if canImport(WatchKit)
        import WatchKit
        #endif
        #if canImport(AVFoundation)
        import AVFoundation
        #endif
        #if canImport(UserNotifications)
        import UserNotifications
        #endif

        enum GeneratedHaptics {
            static func play() {
                #if os(watchOS)
                WKInterfaceDevice.current().play(.click)
                #elseif os(iOS)
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                #endif
            }
        }

        extension Color {
            init(hex: String) {
                let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
                var value: UInt64 = 0
                Scanner(string: cleaned).scanHexInt64(&value)
                let r, g, b, a: UInt64
                switch cleaned.count {
                case 8: (r, g, b, a) = ((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
                case 6: (r, g, b, a) = ((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255)
                default: (r, g, b, a) = (17, 24, 39, 255)
                }
                self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: Double(a) / 255)
            }
        }

        \(hasResources ? generatedImageSource(appName: appName) : "")

        // Backs Image nodes targeted by a Set Image block: shows a remote
        // URL once one is set, otherwise the gray placeholder the canvas
        // itself falls back to for unresolved images.
        struct DynamicRemoteImage: View {
            let source: String

            // Self-contained (doesn't depend on the conditionally-generated
            // GeneratedImage/GeneratedResources, since this view is always
            // emitted even for exports with no static image assets):
            // resolves a bundled resource name the same way GeneratedImage
            // does, for the common case of swapping between two *local*
            // images (e.g. Set Image pointed at another design asset).
            private static func bundledImage(named rawName: String) -> Image? {
                // A dynamic source may be an original design-time file path
                // (from a list item); map it to its bundled resource name.
                let name = GeneratedAssetMap.byPath[rawName] ?? rawName
                let bundle = Bundle.main.resourceURL
                    .flatMap { url in Bundle.allBundles.first { $0.bundleURL.path.hasPrefix(url.path) && $0 != Bundle.main } }
                    ?? Bundle.main
                guard let url = bundle.url(forResource: name, withExtension: nil) else { return nil }
                #if canImport(UIKit)
                return UIImage(contentsOfFile: url.path).map { Image(uiImage: $0) }
                #elseif canImport(AppKit)
                return NSImage(contentsOf: url).map { Image(nsImage: $0) }
                #else
                return nil
                #endif
            }

            var body: some View {
                if source.hasPrefix("http://") || source.hasPrefix("https://"), let url = URL(string: source) {
                    AsyncImage(url: url) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Color.gray.opacity(0.2)
                    }
                } else if let bundled = Self.bundledImage(named: source) {
                    bundled.resizable().scaledToFill()
                } else {
                    Color.gray.opacity(0.2)
                }
            }
        }

        enum GeneratedClipboard {
            static func copy(_ text: String) {
                #if os(iOS)
                UIPasteboard.general.string = text
                #elseif canImport(AppKit)
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(text, forType: .string)
                #endif
            }
        }

        enum GeneratedSound {
            #if canImport(AVFoundation)
            private static var player: AVAudioPlayer?
            #endif

            static func play(_ file: String) {
                #if canImport(AVFoundation)
                let base = (file as NSString).deletingPathExtension
                let ext = (file as NSString).pathExtension
                guard let url = Bundle.main.url(forResource: base, withExtension: ext.isEmpty ? nil : ext)
                    ?? GeneratedResourcesLookup.bundle?.url(forResource: base, withExtension: ext.isEmpty ? nil : ext)
                else {
                    print("Play Sound: '\\(file)' not found in the app's Resources.")
                    return
                }
                player = try? AVAudioPlayer(contentsOf: url)
                player?.play()
                #endif
            }

            static func stop() {
                #if canImport(AVFoundation)
                player?.stop()
                stopRinging()
                #endif
            }

            #if canImport(AVFoundation)
            private static var ringEngine: AVAudioEngine?
            private static var ringTimer: Timer?
            #endif

            /// Looping synthesized alarm ring — no sound asset required.
            /// Styles: classic (double chirp), beep (fast high), pulse (slow low).
            static func startRinging(_ style: String, autoStop: Double = 0) {
                #if canImport(AVFoundation)
                stopRinging()
                if autoStop > 0 {
                    // Preview mode: ring briefly, then stop on our own.
                    DispatchQueue.main.asyncAfter(deadline: .now() + autoStop) { stopRinging() }
                }
                let frequency: Double
                let onDuration: Double
                let offDuration: Double
                switch style.lowercased() {
                case "beep":  frequency = 1318; onDuration = 0.12; offDuration = 0.12
                case "pulse": frequency = 659;  onDuration = 0.45; offDuration = 0.35
                default:      frequency = 880;  onDuration = 0.22; offDuration = 0.14
                }
                let engine = AVAudioEngine()
                let sampleRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
                var phase: Double = 0
                let source = AVAudioSourceNode { _, _, frameCount, audioBufferList -> OSStatus in
                    let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
                    let increment = 2.0 * Double.pi * frequency / sampleRate
                    for frame in 0..<Int(frameCount) {
                        let sample = Float(sin(phase)) * 0.6
                        phase += increment
                        if phase > 2.0 * Double.pi { phase -= 2.0 * Double.pi }
                        for buffer in ablPointer {
                            buffer.mData?.assumingMemoryBound(to: Float.self)[frame] = sample
                        }
                    }
                    return noErr
                }
                engine.attach(source)
                engine.connect(source, to: engine.mainMixerNode, format: nil)
                engine.mainMixerNode.outputVolume = 1
                try? engine.start()
                ringEngine = engine
                // Gate the tone on/off for the ring pattern.
                var isOn = true
                ringTimer = Timer.scheduledTimer(withTimeInterval: onDuration, repeats: true) { timer in
                    isOn.toggle()
                    ringEngine?.mainMixerNode.outputVolume = isOn ? 1 : 0
                    timer.fireDate = Date().addingTimeInterval(isOn ? onDuration : offDuration)
                }
                #endif
            }

            static func stopRinging() {
                #if canImport(AVFoundation)
                ringTimer?.invalidate()
                ringTimer = nil
                ringEngine?.stop()
                ringEngine = nil
                #endif
            }
        }

        // Points sound lookups at the same resource bundle images use, when
        // this export has one (see GeneratedResources in the image support
        // file). Kept separate so sound-only exports don't need an image.
        enum GeneratedResourcesLookup {
            static var bundle: Bundle? {
                #if canImport(UIKit)
                Bundle.main.resourceURL.flatMap { url in
                    Bundle.allBundles.first { $0.bundleURL.path.hasPrefix(url.path) && $0 != Bundle.main }
                } ?? Bundle.main
                #else
                Bundle.main
                #endif
            }
        }

        enum GeneratedNotifications {
            static func schedule(title: String, body: String, seconds: Double) {
                #if canImport(UserNotifications)
                let content = UNMutableNotificationContent()
                content.title = title
                if !body.isEmpty { content.body = body }
                let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, seconds), repeats: false)
                let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)
                UNUserNotificationCenter.current().add(request)
                #endif
            }

            /// A real alarm: daily calendar-triggered notification at hour:minute.
            /// Requests permission on first use; replaces any prior alarm.
            static func scheduleAt(title: String, body: String, hour: String, minute: String) {
                #if canImport(UserNotifications)
                let center = UNUserNotificationCenter.current()
                center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
                    var comps = DateComponents()
                    comps.hour = Int(hour) ?? 6
                    comps.minute = Int(minute) ?? 0
                    let content = UNMutableNotificationContent()
                    content.title = title
                    if !body.isEmpty { content.body = body }
                    content.sound = .default
                    let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
                    let request = UNNotificationRequest(identifier: "generated.alarm", content: content, trigger: trigger)
                    center.removePendingNotificationRequests(withIdentifiers: ["generated.alarm"])
                    center.add(request)
                }
                #endif
            }

            static func setBadge(_ count: Int) {
                #if os(iOS)
                UNUserNotificationCenter.current().setBadgeCount(count)
                #elseif canImport(AppKit)
                NSApp.dockTile.badgeLabel = count > 0 ? "\\(count)" : nil
                #endif
            }
        }

        enum GeneratedShare {
            static func present(text: String, urlString: String) {
                #if os(iOS)
                var items: [Any] = []
                if !text.isEmpty { items.append(text) }
                if let url = URL(string: urlString), !urlString.isEmpty { items.append(url) }
                guard !items.isEmpty,
                      let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
                      let root = scene.keyWindow?.rootViewController
                else { return }
                root.present(UIActivityViewController(activityItems: items, applicationActivities: nil), animated: true)
                #elseif canImport(AppKit)
                var items: [Any] = []
                if !text.isEmpty { items.append(text) }
                if let url = URL(string: urlString), !urlString.isEmpty { items.append(url) }
                guard !items.isEmpty else { return }
                NSSharingServicePicker(items: items).show(relativeTo: .zero, of: NSApp.keyWindow?.contentView ?? NSView(), preferredEdge: .minY)
                #endif
            }

            static func sendEmail(to: String, subject: String, body: String) {
                var components = URLComponents(string: "mailto:\\(to)")
                components?.queryItems = [
                    URLQueryItem(name: "subject", value: subject),
                    URLQueryItem(name: "body", value: body)
                ]
                open(components?.url)
            }

            static func sendSMS(number: String, body: String) {
                open(URL(string: "sms:\\(number)&body=\\(body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"))
            }

            static func launchMaps(query: String) {
                let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
                open(URL(string: "https://maps.apple.com/?q=\\(encoded)"))
            }

            private static func open(_ url: URL?) {
                guard let url else { return }
                #if os(iOS)
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                #elseif canImport(AppKit)
                NSWorkspace.shared.open(url)
                #endif
            }
        }

        enum GeneratedJSON {
            static func encode(_ value: Any) -> String {
                guard JSONSerialization.isValidJSONObject(value),
                      let data = try? JSONSerialization.data(withJSONObject: value)
                else { return "\\"\\(value)\\"" }
                return String(data: data, encoding: .utf8) ?? "{}"
            }
        }

        // Runtime side of repeat-list bindings: parses the bound variable's
        // JSON array, substitutes {{alias.field}} tokens per item, and
        // resolves dot-paths into the "selected item" JSON a tapped cell
        // stores in state.
        enum GeneratedRepeat {
            static func items(from raw: String, filter: String = "", category: String = "") -> [Any] {
                let all: [Any]
                if let data = raw.data(using: .utf8),
                   let parsed = try? JSONSerialization.jsonObject(with: data),
                   let array = parsed as? [Any] {
                    all = array
                } else {
                    all = raw.split(separator: "\\n").map(String.init)
                }
                let searchNeedle = filter.trimmingCharacters(in: .whitespaces).lowercased()
                let categoryNeedle = category.trimmingCharacters(in: .whitespaces).lowercased()
                guard !searchNeedle.isEmpty || !categoryNeedle.isEmpty else { return all }
                return all.filter { item in
                    if !searchNeedle.isEmpty, !matches(item, needle: searchNeedle) { return false }
                    if !categoryNeedle.isEmpty, !matches(item, needle: categoryNeedle) { return false }
                    return true
                }
            }

            private static func matches(_ item: Any, needle: String) -> Bool {
                if let dict = item as? [String: Any] { return dict.values.contains { matches($0, needle: needle) } }
                if let array = item as? [Any] { return array.contains { matches($0, needle: needle) } }
                return encode(item).lowercased().contains(needle)
            }

            static func encode(_ item: Any) -> String {
                if let string = item as? String { return string }
                if JSONSerialization.isValidJSONObject(item),
                   let data = try? JSONSerialization.data(withJSONObject: item),
                   let string = String(data: data, encoding: .utf8) {
                    return string
                }
                return "\\(item)"
            }

            static func substitute(_ text: String, alias: String, item: Any) -> String {
                guard text.contains("{{") else { return text }
                var result = ""
                var remainder = Substring(text)
                while let open = remainder.range(of: "{{") {
                    result += String(remainder[remainder.startIndex..<open.lowerBound])
                    remainder = remainder[open.upperBound...]
                    guard let close = remainder.range(of: "}}") else {
                        result += "{{" + String(remainder)
                        return result
                    }
                    let token = remainder[remainder.startIndex..<close.lowerBound].trimmingCharacters(in: .whitespaces)
                    remainder = remainder[close.upperBound...]
                    if token == alias {
                        result += encode(item)
                    } else if token.hasPrefix(alias + ".") {
                        result += resolvePath(String(token.dropFirst(alias.count + 1)), in: item)
                    } else {
                        result += "{{" + token + "}}"
                    }
                }
                result += String(remainder)
                return result
            }

            // Reads "path.to.field" out of a JSON string (the selected-item
            // value a tapped cell stored in state).
            static func resolve(_ raw: String, _ path: String) -> String {
                guard let data = raw.data(using: .utf8),
                      let parsed = try? JSONSerialization.jsonObject(with: data) else { return raw }
                return resolvePath(path, in: parsed)
            }

            private static func resolvePath(_ path: String, in item: Any) -> String {
                var current = item
                for component in path.split(separator: ".") {
                    let key = String(component)
                    if let dict = current as? [String: Any], let next = dict[key] {
                        current = next
                    } else if let array = current as? [Any], let index = Int(key), array.indices.contains(index) {
                        current = array[index]
                    } else {
                        return ""
                    }
                }
                if let string = current as? String { return string }
                if let number = current as? NSNumber {
                    if CFGetTypeID(number) == CFBooleanGetTypeID() {
                        return number.boolValue ? "true" : "false"
                    }
                    return number.stringValue
                }
                return encode(current)
            }
        }

        enum GeneratedDateFormat {
            static func format(_ input: String, pattern: String) -> String {
                let date = ISO8601DateFormatter().date(from: input) ?? Date()
                let formatter = DateFormatter()
                formatter.dateFormat = pattern
                return formatter.string(from: date)
            }
        }

        enum GeneratedPlatform {
            static func matches(_ raw: String) -> Bool {
                switch raw {
                case "appleWatch":
                    #if os(watchOS)
                    return true
                    #else
                    return false
                    #endif
                case "iPad":
                    #if os(iOS)
                    return UIDevice.current.userInterfaceIdiom == .pad
                    #else
                    return false
                    #endif
                default:
                    #if os(iOS)
                    return UIDevice.current.userInterfaceIdiom != .pad
                    #elseif os(watchOS)
                    return false
                    #else
                    return true
                    #endif
                }
            }
        }

        // A tiny local SQLite database in the app's Documents folder for
        // SQLite Query/Execute blocks — no external package needed since
        // libsqlite3 ships with the OS.
        enum GeneratedSQLite {
            private static var db: OpaquePointer?

            private static func open() -> OpaquePointer? {
                if let db { return db }
                let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("app.sqlite3")
                var handle: OpaquePointer?
                guard sqlite3_open(url.path, &handle) == SQLITE_OK else { return nil }
                db = handle
                return handle
            }

            static func execute(_ sql: String) -> Bool {
                guard let handle = open() else { return false }
                return sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK
            }

            static func query(_ sql: String) -> [[String: String]]? {
                guard let handle = open() else { return nil }
                var statement: OpaquePointer?
                guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
                defer { sqlite3_finalize(statement) }

                var rows: [[String: String]] = []
                while sqlite3_step(statement) == SQLITE_ROW {
                    var row: [String: String] = [:]
                    for column in 0..<sqlite3_column_count(statement) {
                        let name = String(cString: sqlite3_column_name(statement, column))
                        if let text = sqlite3_column_text(statement, column) {
                            row[name] = String(cString: text)
                        }
                    }
                    rows.append(row)
                }
                return rows
            }
        }


        """
    }

    private static func nodeViews(_ nodes: [DesignNode], flows: [LogicFlow], variableTypes: [String: VariableType], imageAssets: [String: String], dynamic: [UUID: Set<DynamicNodeProperty>], level: Int, repeatItem: (alias: String, itemExpr: String)? = nil) -> String {
        // Render in zIndex order (stable for equal zIndex), matching the
        // in-app canvas/preview. Without this, sendToBack/bringToFront/setZIndex
        // had no effect in the exported app — a node sent to back still drew
        // last (on top), e.g. a hero image covering the back button above it.
        let ordered = nodes.enumerated().sorted { lhs, rhs in
            let lz = lhs.element.zIndex ?? 0, rz = rhs.element.zIndex ?? 0
            return lz == rz ? lhs.offset < rhs.offset : lz < rz
        }.map { $0.element }
        return ordered.map { node in
            let indentText = String(repeating: " ", count: level * 4)
            let props = dynamic[node.id] ?? []

            // A repeat-list template renders as a ForEach over its bound
            // array variable — one positioned cell per item — instead of a
            // single static node.
            if node.repeatBinding != nil {
                return repeatForEachExpression(node, flows: flows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamic, level: level)
            }

            // Inside a repeat cell, wired taps first record WHICH item's
            // cell fired (state.<alias> = this item) so the flow can read
            // {{alias.field}} values for the tapped row.
            func withItemContext(_ calls: String) -> String {
                guard !calls.isEmpty, let repeatItem else { return calls }
                let aliasVar = swiftIdentifier(repeatItem.alias, fallback: "item")
                return "state.\(aliasVar) = GeneratedRepeat.encode(\(repeatItem.itemExpr))\n" + calls
            }

            let widthExpr = props.contains(.width) ? "state.\(dynamicVarName(node.id, .width))" : "\(Int(node.width))"
            let heightExpr = props.contains(.height) ? "state.\(dynamicVarName(node.id, .height))" : "\(Int(node.height))"
            let xExpr = props.contains(.x) ? "state.\(dynamicVarName(node.id, .x)) + (\(widthExpr)) / 2" : "\(Int(node.x + node.width / 2))"
            let yExpr = props.contains(.y) ? "state.\(dynamicVarName(node.id, .y)) + (\(heightExpr)) / 2" : "\(Int(node.y + node.height / 2))"
            let frame = ".frame(width: \(widthExpr), height: \(heightExpr), alignment: \(swiftFrameAlignment(for: node)))"
            let position = ".position(x: \(xExpr), y: \(yExpr))"

            let tapAction = withItemContext(eventCalls(types: [.onTap, .onWatchTap], flows: flows, nodeId: node.id))
            let submitAction = eventCalls(types: [.onSubmit], flows: flows, nodeId: node.id)
            let children = node.children.isEmpty ? "" : "\n\(nodeViews(node.children, flows: flows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamic, level: level + 1, repeatItem: repeatItem))\n\(indentText)"

            let rawText = node.text ?? node.name
            let textExpr: String
            if props.contains(.text) {
                textExpr = "state.\(dynamicVarName(node.id, .text))"
            } else if let bound = boundText(node) {
                textExpr = bound
            } else if let repeatItem, rawText.contains("{{") {
                // "{{book.title}}" in a cell resolves against THIS item.
                textExpr = "GeneratedRepeat.substitute(\(swiftString(rawText)), alias: \(swiftString(repeatItem.alias)), item: \(repeatItem.itemExpr))"
            } else if rawText.contains("{{"), tokensResolve(in: rawText, variableTypes: variableTypes) {
                // "{{workout.title}}" OUTSIDE a repeat cell — a detail screen
                // showing the tapped item, a greeting showing {{profile.name}}.
                // These used to export as the literal braces, so a detail
                // screen rendered its template tokens instead of the document.
                textExpr = "verbatim: \(swiftInterpolatedString(rawText, variableTypes: variableTypes))"
            } else {
                // LocalizedStringKey, not String: a bare literal is frozen in
                // English forever, while this one picks up Localizable.strings
                // (and therefore Hebrew / RTL) with no further code change.
                textExpr = "LocalizedStringKey(\(swiftString(rawText)))"
            }
            let fillExpr = props.contains(.fill)
                ? "Color(hex: state.\(dynamicVarName(node.id, .fill)))"
                : shapeStyleExpression(fill: node.style.fill, gradient: node.style.gradient, width: node.width, height: node.height)

            let expression: String
            if let picker = node.timePicker {
                expression = "GeneratedTimePicker(hour: $state.\(swiftIdentifier(picker.hourVariable, fallback: "alarmHour")), minute: $state.\(swiftIdentifier(picker.minuteVariable, fallback: "alarmMinute")))"
            } else if node.gameScene != nil {
                // A live SpriteKit game surface: the spec ships as a bundled
                // JSON resource, played by the copied AgentGameKit runtime.
                expression = "AgentGameView(spec: GameSceneLoader.load(\(swiftString(gameSceneResourceName(for: node)))))"
            } else {
            switch node.type {
            case .Text:
                expression = "Text(\(textExpr))"
            case .Button:
                // .contentShape(Rectangle()) makes the WHOLE button frame
                // tappable. Without it, a button with an empty/short label and
                // a clear fill (every transparent nav-bar / overlay hit target)
                // has no hit region and silently ignores taps.
                expression = "Button(action: {\n\(indent(tapAction, spaces: (level + 1) * 4))\n\(indentText)}) { Text(\(textExpr)).frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(Rectangle()) }.buttonStyle(.plain)"
            case .Input:
                let inputField = isSecureInput(node) ? "SecureField" : "TextField"
                expression = "\(inputField)(\(swiftString(node.text ?? "")), text: \(binding(for: node, variableTypes: variableTypes) ?? ".constant(\"\")"))\(submitAction.isEmpty ? "" : ".onSubmit { \(submitAction) }")"
            case .Image:
                expression = props.contains(.image)
                    ? "DynamicRemoteImage(source: state.\(dynamicVarName(node.id, .image)))"
                    : imageExpression(for: node, imageAssets: imageAssets)
            case .Icon:
                expression = "Image(systemName: \(swiftString(node.iconName ?? "circle"))).resizable().scaledToFit()"
            case .Rectangle:
                expression = "RoundedRectangle(cornerRadius: \(Int(node.style.cornerRadius))).fill(\(fillExpr))"
            case .Frame:
                if let scrollBehavior = node.scrollBehavior {
                    let contentSize = scrollContentSize(for: node)
                    let offset = scrollOffset(for: scrollBehavior)
                    expression = """
                    ScrollView(\(swiftScrollAxes(scrollBehavior.axis)), showsIndicators: \(scrollBehavior.showsIndicators ?? true)) {
                    \(indentText)    ZStack(alignment: .topLeading) {\(children)
                    \(indentText)    }
                    \(indentText)    .frame(width: \(Int(contentSize.width)), height: \(Int(contentSize.height)), alignment: .topLeading)
                    \(indentText)    .offset(x: \(Int(offset.x)), y: \(Int(offset.y)))
                    \(indentText)}
                    """
                } else if let scrollableChild = node.children.first(where: { $0.repeatBinding?.isScrollable == true }),
                          let childBinding = scrollableChild.repeatBinding {
                    // Recycler view: a frame whose direct child is a
                    // scrollable repeat template becomes a ScrollView along
                    // that template's axis, its content sized at runtime to
                    // fit however many items the bound array holds.
                    let axis = childBinding.axis == .horizontal ? ".horizontal" : ".vertical"
                    let step = (childBinding.axis == .horizontal ? scrollableChild.width : scrollableChild.height) + (scrollableChild.style.spacing ?? 8)
                    let sourceVar = "state.\(swiftIdentifier(childBinding.sourceVariable, fallback: "items"))"
                    let margin = childBinding.axis == .horizontal ? scrollableChild.x : scrollableChild.y
                    let spanExpr = "max(CGFloat(GeneratedRepeat.items(from: \(sourceVar)).count) * \(Int(step)) + \(Int(margin * 2)), \(Int(childBinding.axis == .horizontal ? node.width : node.height)))"
                    let contentWidth = childBinding.axis == .horizontal ? spanExpr : "\(Int(node.width))"
                    let contentHeight = childBinding.axis == .horizontal ? "\(Int(node.height))" : spanExpr
                    expression = """
                    ScrollView(\(axis), showsIndicators: true) {
                    \(indentText)    ZStack(alignment: .topLeading) {\(children)
                    \(indentText)    }
                    \(indentText)    .frame(width: \(contentWidth), height: \(contentHeight), alignment: .topLeading)
                    \(indentText)}
                    """
                } else {
                    expression = "ZStack(alignment: .topLeading) {\(children)}"
                }
            }
            }
            // Tap/gesture modifiers and their contentShape MUST come before
            // .position(). .position() makes a view fill its whole parent, so a
            // gesture attached AFTER it would fire anywhere on screen — e.g. a
            // card's tap swallowing every tap in the parent, including nav-bar
            // taps. Attaching before .position() confines the hit area to the
            // node's own frame.
            let tapModifiers = (node.type == .Button || tapAction.isEmpty)
                ? ""
                : "\n\(indentText).contentShape(Rectangle())\n\(indentText).onTapGesture { \(tapAction) }"
            let gestures = gestureModifiers(for: node, flows: flows, indentText: indentText, transform: withItemContext)
            let accessibility = accessibilityModifiers(for: node, indentText: indentText)
            let preModifiers = preFrameModifiers(for: node, dynamic: props, nodeId: node.id)
            let preModifierText = preModifiers.isEmpty ? "" : "\n" + indent(preModifiers, spaces: level * 4)
            let postModifiers = postFrameModifiers(for: node, dynamic: props, nodeId: node.id)
            let postModifierText = postModifiers.isEmpty ? "" : "\n" + indent(postModifiers, spaces: level * 4)
            // A node driven by a dynamic opacity also stops intercepting taps
            // once it fades out (opacity → 0), so a hidden/faded overlay (e.g. a
            // splash screen after its fade, or a setVisible-hidden element)
            // doesn't block the content beneath it.
            let opacityModifier = props.contains(.opacityChannel)
                ? "\n\(indentText).opacity(state.\(dynamicVarName(node.id, .opacityChannel)))\n\(indentText).allowsHitTesting(state.\(dynamicVarName(node.id, .opacityChannel)) > 0.05)"
                : ""
            // Visibility / enabled logicBindings — previously read on the canvas
            // and in the preview, then DROPPED here, so an error banner bound to
            // .visibility shipped permanently on-screen and a disabled CTA
            // stayed tappable. Now they drive real SwiftUI modifiers.
            let bindingModifiers = stateBindingModifiers(for: node, variableTypes: variableTypes, indentText: indentText)
            return """
            \(indentText)\(expression)\(preModifierText)
            \(indentText)\(frame)\(postModifierText)\(tapModifiers)\(gestures)
            \(indentText)\(position)\(opacityModifier)\(bindingModifiers)\(accessibility)
            """
        }.joined(separator: "\n")
    }

    /// Accessibility, emitted for EVERY node — previously zero accessibility
    /// modifiers reached the exported app, which made it both unusable with
    /// VoiceOver and untestable, since XCUITest addresses elements by
    /// identifier. The identifier is the node's designer-given name, so a
    /// generated UI test can refer to "Login Button" and mean it.
    private static func accessibilityModifiers(for node: DesignNode, indentText: String) -> String {
        var modifiers: [String] = [".accessibilityIdentifier(\(swiftString(accessibilityIdentifier(for: node))))"]

        switch node.type {
        case .Button:
            // A label whose text is an icon or empty tells VoiceOver nothing;
            // the node name is the human description in that case.
            let title = node.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let label = title.isEmpty ? node.name : title
            modifiers.append(".accessibilityLabel(\(swiftString(label)))")
            modifiers.append(".accessibilityAddTraits(.isButton)")
        case .Image, .Icon:
            // Decorative art should be skipped by VoiceOver rather than
            // announced as "image"; named imagery gets a real label.
            let looksDecorative = node.name.lowercased().contains("background")
                || node.name.lowercased().contains("decor")
            modifiers.append(looksDecorative
                ? ".accessibilityHidden(true)"
                : ".accessibilityLabel(\(swiftString(node.name)))")
        case .Input:
            modifiers.append(".accessibilityLabel(\(swiftString(node.name)))")
        case .Text:
            // The rendered string is already the label; only headings need a trait.
            if (node.style.fontSize ?? 16) >= 24 {
                modifiers.append(".accessibilityAddTraits(.isHeader)")
            }
        default:
            break
        }
        return "\n" + modifiers.map { indentText + $0 }.joined(separator: "\n" )
    }

    /// Stable, test-friendly identifier derived from the designer's node name.
    static func accessibilityIdentifier(for node: DesignNode) -> String {
        let cleaned = node.name
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[^A-Za-z0-9]+", with: "_", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return cleaned.isEmpty ? "node_\(node.id.uuidString.prefix(8))" : cleaned
    }

    /// SwiftUI modifiers for a node's visibility / enabled logic bindings.
    /// `.visibility` collapses the node (opacity 0 + no hit testing) when the
    /// condition is false; `.enabled` disables it. This is what makes a bound
    /// error banner or CTA actually react to state.
    private static func stateBindingModifiers(for node: DesignNode, variableTypes: [String: VariableType], indentText: String) -> String {
        guard let bindings = node.logicBindings else { return "" }
        var out: [String] = []
        for binding in bindings {
            switch binding.kind {
            case .visibility:
                let cond = bindingBoolExpr(binding, variableTypes: variableTypes)
                out.append(".opacity((\(cond)) ? 1 : 0)")
                out.append(".allowsHitTesting(\(cond))")
            case .enabled:
                let cond = bindingBoolExpr(binding, variableTypes: variableTypes)
                out.append(".disabled(!(\(cond)))")
            default:
                continue  // text/value handled elsewhere; isOn/selectedIndex n/a here
            }
        }
        return out.isEmpty ? "" : "\n" + out.map { indentText + $0 }.joined(separator: "\n")
    }

    /// The boolean a visibility/enabled binding evaluates: either its explicit
    /// condition, or the plain truthiness of its variable.
    private static func bindingBoolExpr(_ binding: NodeLogicBinding, variableTypes: [String: VariableType]) -> String {
        let lhs = "state.\(swiftIdentifier(binding.variableName, fallback: "value"))"
        guard let condition = binding.condition else {
            // No explicit condition → truthy test appropriate to the type.
            switch variableTypes[binding.variableName] ?? .string {
            case .boolean: return lhs
            case .number: return "\(lhs) != 0"
            default: return "!(String(describing: \(lhs)).isEmpty)"
            }
        }
        let left = "state.\(swiftIdentifier(condition.left, fallback: "value"))"
        let right = swiftString(condition.right ?? "")
        switch condition.operation {
        case .equals: return "String(describing: \(left)) == \(right)"
        case .notEquals: return "String(describing: \(left)) != \(right)"
        case .greaterThan: return "(Double(String(describing: \(left))) ?? 0) > (Double(\(right)) ?? 0)"
        case .lessThan: return "(Double(String(describing: \(left))) ?? 0) < (Double(\(right)) ?? 0)"
        case .contains: return "String(describing: \(left)).contains(\(right))"
        case .isEmpty: return "String(describing: \(left)).isEmpty"
        case .isNotEmpty: return "!String(describing: \(left)).isEmpty"
        case .isTrue: return "String(describing: \(left)) == \"true\""
        case .isFalse: return "String(describing: \(left)) != \"true\""
        }
    }

    // One positioned cell per item of the template's bound array variable.
    // Each cell is the template rendered at local origin inside a fixed-size
    // wrapper, and the wrapper is positioned along the repeat axis by index —
    // the exported equivalent of what RepeatBindingExpander does in the
    // preview.
    private static func repeatForEachExpression(_ node: DesignNode, flows: [LogicFlow], variableTypes: [String: VariableType], imageAssets: [String: String], dynamic: [UUID: Set<DynamicNodeProperty>], level: Int) -> String {
        guard let binding = node.repeatBinding else { return "" }
        let indentText = String(repeating: " ", count: level * 4)
        let loopVar = "__repeat_\(String(node.id.uuidString.prefix(8)).replacingOccurrences(of: "-", with: ""))"
        let sourceVar = "state.\(swiftIdentifier(binding.sourceVariable, fallback: "items"))"
        let cap = min(binding.maxItems ?? 50, 50)
        let spacing = node.style.spacing ?? 8
        let stepX = binding.axis == .horizontal ? Int(node.width + spacing) : 0
        let stepY = binding.axis == .vertical ? Int(node.height + spacing) : 0

        var cell = node
        cell.repeatBinding = nil
        cell.x = 0
        cell.y = 0
        let cellCode = nodeViews([cell], flows: flows, variableTypes: variableTypes, imageAssets: imageAssets, dynamic: dynamic, level: level + 1, repeatItem: (alias: binding.itemAlias, itemExpr: "\(loopVar).element"))

        // Live filters: reactively drop non-matching items (and reflow, since
        // positions use the filtered index) as the search or category variable
        // changes.
        let filterArg = binding.filterVariable.map { ", filter: state.\(swiftIdentifier($0, fallback: "query"))" } ?? ""
        let categoryArg = binding.categoryVariable.map { ", category: state.\(swiftIdentifier($0, fallback: "category"))" } ?? ""

        // Empty state: a data-bound list with zero documents used to render as
        // blank space, which reads as "the app is broken" — the single worst
        // first-run impression an account app can make (the first list IS
        // empty). A quiet, honest placeholder in the template's own slot.
        let emptyLabel = binding.itemAlias.isEmpty ? "items" : binding.itemAlias + "s"
        let emptyState = """
        \(indentText)if GeneratedRepeat.items(from: \(sourceVar)\(filterArg)\(categoryArg)).isEmpty {
        \(indentText)    Text("No \(swiftEscaped(emptyLabel)) yet")
        \(indentText)        .font(.system(size: 15))
        \(indentText)        .foregroundColor(.secondary)
        \(indentText)        .frame(width: \(Int(node.width)), height: \(Int(node.height)))
        \(indentText)        .position(x: \(Int(node.x + node.width / 2)), y: \(Int(node.y + node.height / 2)))
        \(indentText)}
        """

        return """
        \(emptyState)
        \(indentText)ForEach(Array(GeneratedRepeat.items(from: \(sourceVar)\(filterArg)\(categoryArg)).prefix(\(cap)).enumerated()), id: \\.offset) { \(loopVar) in
        \(indentText)    ZStack(alignment: .topLeading) {
        \(cellCode)
        \(indentText)    }
        \(indentText)    .frame(width: \(Int(node.width)), height: \(Int(node.height)), alignment: .topLeading)
        \(indentText)    .position(x: \(Int(node.x + node.width / 2)) + CGFloat(\(loopVar).offset) * \(stepX), y: \(Int(node.y + node.height / 2)) + CGFloat(\(loopVar).offset) * \(stepY))
        \(indentText)}
        """
    }

    // Double-tap / long-press / swipe flows attach as simultaneous gestures,
    // so they coexist with a Button's own single tap. Swipe events fire only
    // when the actual drag direction matches the event's direction filter.
    private static func gestureModifiers(for node: DesignNode, flows: [LogicFlow], indentText: String, transform: (String) -> String) -> String {
        var modifiers: [String] = []

        let doubleTap = transform(eventCalls(types: [.onDoubleTap], flows: flows, nodeId: node.id))
        if !doubleTap.isEmpty {
            modifiers.append(".simultaneousGesture(TapGesture(count: 2).onEnded { \(doubleTap.replacingOccurrences(of: "\n", with: "; ")) })")
        }

        let longPress = transform(eventCalls(types: [.onLongPress], flows: flows, nodeId: node.id))
        if !longPress.isEmpty {
            modifiers.append(".simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in \(longPress.replacingOccurrences(of: "\n", with: "; ")) })")
        }

        var swipeBranches: [String] = []
        for flow in flows {
            for event in flow.blocks where event.type == .onSwipe && eventMatches(event, nodeId: node.id, flow: flow) {
                let direction = event.parameters.first { $0.key == "direction" }?.value ?? ""
                let call = transform("_ = Swift.Task<Void, Never> { @MainActor in await actions.\(actionFunctionName(flow: flow, event: event))() }")
                    .replacingOccurrences(of: "\n", with: "; ")
                if direction.isEmpty {
                    swipeBranches.append(call)
                } else {
                    swipeBranches.append("if __direction == \(swiftString(direction)) { \(call) }")
                }
            }
        }
        if !swipeBranches.isEmpty {
            modifiers.append("""
            .simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { __swipe in
            \(indentText)    let __direction = abs(__swipe.translation.width) > abs(__swipe.translation.height) ? (__swipe.translation.width < 0 ? "left" : "right") : (__swipe.translation.height < 0 ? "up" : "down")
            \(indentText)    _ = __direction
            \(indentText)    \(swipeBranches.joined(separator: "\n\(indentText)    "))
            \(indentText)})
            """)
        }

        guard !modifiers.isEmpty else { return "" }
        return "\n\(indentText)" + modifiers.joined(separator: "\n\(indentText)")
    }

    // Generated action functions are async (Firebase/HTTP/Supabase calls
    // need to await), so every call site launches a Task rather than calling
    // straight through.
    private static func eventCalls(
        types: Set<LogicBlockType>,
        flows: [LogicFlow],
        nodeId: UUID?,
        receiver: String = "actions"
    ) -> String {
        var calls: [String] = []
        for flow in flows {
            for event in flow.blocks where types.contains(event.type) {
                if let nodeId {
                    guard eventMatches(event, nodeId: nodeId, flow: flow) else { continue }
                }
                calls.append("_ = Swift.Task<Void, Never> { @MainActor in await \(receiver).\(actionFunctionName(flow: flow, event: event))() }")
            }
        }
        return calls.joined(separator: "\n")
    }

    private static func eventMatches(_ event: LogicBlock, nodeId: UUID, flow: LogicFlow) -> Bool {
        if event.connectedDesignNodeId == nodeId {
            return true
        }
        if event.parameters.contains(where: { $0.nodeReference == nodeId }) {
            return true
        }
        if (event.type == .onScreenLoad || event.type == .onScreenOpened || event.type == .onScreenDisappear),
           flow.screenNodeId == nodeId {
            return true
        }
        return false
    }

    // Walks one execution chain, turning each connected block into a Swift
    // statement. Any block whose catalog definition has more than one output
    // port (If/Else, Switch, every Firebase/Firestore/Supabase/API call, ...)
    // branches: every one of its output ports gets its own recursive chain,
    // and the branch consumes the rest of THIS chain (matching how the
    // designer reads a branch — everything downstream lives inside one arm
    // or another, never after the branch back at this level).
    private static func swiftStatements(
        from blockId: UUID,
        port: Int,
        in flow: LogicFlow,
        screens: [DesignNode],
        variableTypes: [String: VariableType],
        project: DesignProject,
        dynamic: [UUID: Set<DynamicNodeProperty>] = [:],
        imageAssets: [String: String] = [:],
        visited: inout Set<UUID>
    ) -> String {
        var lines: [String] = []
        var currentId = blockId
        var currentPort = port
        while let connection = flow.connections.first(where: { $0.sourceBlockId == currentId && $0.sourcePortIndex == currentPort }),
              visited.insert(connection.targetBlockId).inserted,
              let block = flow.blocks.first(where: { $0.id == connection.targetBlockId }) {

            let outputCount = max(1, BlockCatalog.definition(for: block.type)?.outputPortCount ?? 1)
            if outputCount > 1 {
                var chains: [String] = []
                var visitedUnion = visited
                for outputPort in 0..<outputCount {
                    var portVisited = visited
                    chains.append(swiftStatements(from: block.id, port: outputPort, in: flow, screens: screens, variableTypes: variableTypes, project: project, dynamic: dynamic, imageAssets: imageAssets, visited: &portVisited))
                    visitedUnion.formUnion(portVisited)
                }
                visited = visitedUnion
                lines.append(swiftBranch(block, chains: chains, screens: screens, variableTypes: variableTypes, project: project))
                break
            }

            if let statement = swiftStatement(block, screens: screens, variableTypes: variableTypes, dynamic: dynamic, project: project, imageAssets: imageAssets) {
                lines.append(statement)
            }
            currentId = block.id
            currentPort = 0
        }
        return lines.joined(separator: "\n")
    }

    // MARK: - Branching blocks (If/Else, Switch, every Success/Error block)

    private static func swiftBranch(
        _ block: LogicBlock,
        chains: [String],
        screens: [DesignNode],
        variableTypes: [String: VariableType],
        project: DesignProject
    ) -> String {
        let onSuccess = chains.first ?? ""
        let onError = chains.count > 1 ? chains[1] : ""

        switch block.type {
        case .ifCondition, .compare:
            return ifElse(swiftCondition(block, variableTypes: variableTypes), onSuccess, onError)

        case .isEmpty:
            return ifElse("\(swiftValueExpr(block, key: "value", variableTypes: variableTypes)).isEmpty", onSuccess, onError)

        case .contains:
            let haystack = swiftValueExpr(block, key: "value", variableTypes: variableTypes)
            let needle = swiftStringParam(block, "substring", variableTypes: variableTypes)
            return ifElse("\(haystack).contains(\(needle))", onSuccess, onError)

        case .logicalAnd:
            return ifElse("(\(swiftBoolExpr(block, "a", variableTypes)) && \(swiftBoolExpr(block, "b", variableTypes)))", onSuccess, onError)

        case .logicalOr:
            return ifElse("(\(swiftBoolExpr(block, "a", variableTypes)) || \(swiftBoolExpr(block, "b", variableTypes)))", onSuccess, onError)

        case .logicalNot:
            return ifElse("!(\(swiftBoolExpr(block, "value", variableTypes)))", onSuccess, onError)

        case .platformCondition:
            let platform = paramValue(block, "platform") ?? "iPhone"
            return ifElse("GeneratedPlatform.matches(\(swiftString(platform)))", onSuccess, onError)

        case .switchCase:
            let value = swiftValueExpr(block, key: "value", variableTypes: variableTypes)
            let cases = (paramValue(block, "cases") ?? "").split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
            let case1 = cases.indices.contains(0) ? swiftString(cases[0]) : nil
            let case2 = cases.indices.contains(1) ? swiftString(cases[1]) : nil
            let defaultChain = chains.count > 2 ? chains[2] : ""
            var switchLines = ["switch \(value) {"]
            if let case1 { switchLines.append("case \(case1):\n\(indent(onSuccess.isEmpty ? "break" : onSuccess, spaces: 4))") }
            if let case2 { switchLines.append("case \(case2):\n\(indent(onError.isEmpty ? "break" : onError, spaces: 4))") }
            switchLines.append("default:\n\(indent(defaultChain.isEmpty ? "break" : defaultChain, spaces: 4))")
            switchLines.append("}")
            return switchLines.joined(separator: "\n")

        default:
            return asyncBranch(block, onSuccess: onSuccess, onError: onError, screens: screens, variableTypes: variableTypes, project: project)
        }
    }

    private static func ifElse(_ condition: String, _ thenBody: String, _ elseBody: String) -> String {
        """
        if \(condition) {
        \(indent(thenBody.isEmpty ? "// no-op" : thenBody, spaces: 4))
        } else {
        \(indent(elseBody.isEmpty ? "// no-op" : elseBody, spaces: 4))
        }
        """
    }

    private static func swiftBoolExpr(_ block: LogicBlock, _ key: String, _ variableTypes: [String: VariableType]) -> String {
        "(\(swiftValueExpr(block, key: key, variableTypes: variableTypes)) == \"true\")"
    }

    // Every Firebase/Firestore/Supabase/SQLite/Algolia/HTTP call and every
    // native async action (biometrics, permissions, downloads, confirm
    // dialogs, form validation) shares one shape: do the work, set a local
    // success flag, then branch on it. Firebase/Firestore calls are guarded
    // by #if canImport(...) so the export always compiles even before the
    // user adds those SPM packages in Xcode — they degrade to a clear
    // console message and the Error branch until then.
    private static func asyncBranch(
        _ block: LogicBlock,
        onSuccess: String,
        onError: String,
        screens: [DesignNode],
        variableTypes: [String: VariableType],
        project: DesignProject
    ) -> String {
        let suffix = block.id.uuidString.replacingOccurrences(of: "-", with: "").prefix(8)
        let flag = "opSuccess_\(suffix)"
        let setup = asyncSetup(block, flag: flag, screens: screens, variableTypes: variableTypes, project: project)
        return """
        \(setup)
        if \(flag) {
        \(indent(onSuccess.isEmpty ? "// no-op" : onSuccess, spaces: 4))
        } else {
        \(indent(onError.isEmpty ? "// no-op" : onError, spaces: 4))
        }
        """
    }

    private static func asyncSetup(
        _ block: LogicBlock,
        flag: String,
        screens: [DesignNode],
        variableTypes: [String: VariableType],
        project: DesignProject
    ) -> String {
        func store(_ key: String = "variable") -> String? {
            // Canonically a "Store In" target is a .variableReference, set by the
            // GUI inspector. But an agent driving via MCP may pass the variable
            // name as a plain value ({"variable":"userName"}); honour that too,
            // otherwise the block silently no-ops — exactly the kind of quiet
            // lie this codebase exists to kill.
            let fallback = block.parameters.first { $0.key == key && $0.type == .variable }?
                .value?.trimmingCharacters(in: .whitespacesAndNewlines)
            let ref = variableReference(block, key: key)
                ?? (fallback.flatMap { $0.isEmpty ? nil : $0 })
            return ref.map { "state.\(swiftIdentifier($0, fallback: "value"))" }
        }

        // Reads a parameter that names a TEXT FIELD (Email/Password on an auth
        // block) rather than a value. Such a parameter carries a nodeReference,
        // which swiftValueExpr cannot see — so signIn(withEmail:) compiled to
        // an empty string literal and the login could never succeed no matter
        // what the user typed. Resolve it to the variable that field's
        // TextField is actually bound to.
        func fieldValue(_ key: String) -> String {
            if let nodeId = nodeReference(block, key: key),
               let node = findNode(id: nodeId, in: screens),
               let binding = node.logicBindings?.first(where: { $0.kind == .value || $0.kind == .text }) {
                return "state.\(swiftIdentifier(binding.variableName, fallback: "value"))"
            }
            return swiftValueExpr(block, key: key, variableTypes: variableTypes)
        }

        switch block.type {

        // MARK: Device sensors

        // Start the live tracking engine — the missing call that made the
        // whole distance/pace engine dead code. It streams distance and speed
        // into the given variables as the fixes arrive, so the UI (bound to
        // those variables) updates during the run.
        case .startTracking:
            let distanceVar = variableReference(block, key: "distanceVariable")
                .map { "state.\(swiftIdentifier($0, fallback: "distance"))" }
            let speedVar = variableReference(block, key: "speedVariable")
                .map { "state.\(swiftIdentifier($0, fallback: "speed"))" }
            let background = (paramValue(block, "background") ?? "true") != "false"
            // Only capture the AppState reference when the closure actually
            // writes to it — an unused capture is a warning, and a tracking
            // block that stores nothing is worth surfacing in review anyway.
            let capture = (distanceVar != nil || speedVar != nil) ? "[state] " : ""
            return """
            var \(flag) = false
            #if canImport(CoreLocation)
            if await Permissions.requestLocation() {
                // Capture the AppState reference explicitly (it's an
                // ObservableObject, so the mutation propagates to the UI).
                LocationService.shared.onDistanceChange = { \(capture)meters, kmh in
                    \(distanceVar.map { "\($0) = meters" } ?? "_ = meters")
                    \(speedVar.map { "\($0) = kmh" } ?? "_ = kmh")
                }
                LocationService.shared.startTracking(background: \(background))
                \(flag) = true
            }
            #endif
            """

        case .stopTracking:
            return """
            #if canImport(CoreLocation)
            LocationService.shared.stopTracking()
            #endif
            """

        // MARK: Apple Watch
        // These drive the real HKWorkoutSession service. They are the block
        // face of the watch engine: a non-programmer wires "Start Watch
        // Workout" to a button and gets live heart rate, not a mock.
        case .startWatchWorkout:
            let activity = paramValue(block, "activity") ?? "running"
            let hkActivity: String = {
                switch activity {
                case "walking": return ".walking"
                case "cycling": return ".cycling"
                case "hiking": return ".hiking"
                case "swimming": return ".swimming"
                case "other": return ".other"
                default: return ".running"
                }
            }()
            return """
            var \(flag) = false
            #if os(watchOS) && canImport(HealthKit)
            await WatchWorkoutService.shared.start(activity: \(hkActivity))
            \(flag) = WatchWorkoutService.shared.isRunning
            #endif
            """

        case .pauseWatchWorkout:
            return """
            #if os(watchOS) && canImport(HealthKit)
            if WatchWorkoutService.shared.isPaused {
                WatchWorkoutService.shared.resume()
            } else {
                WatchWorkoutService.shared.pause()
            }
            #endif
            """

        case .endWatchWorkout:
            return """
            #if os(watchOS) && canImport(HealthKit)
            await WatchWorkoutService.shared.finish()
            #endif
            """

        case .watchHaptic:
            let type = paramValue(block, "type") ?? "notification"
            let hkType: String = {
                switch type {
                case "success": return ".success"
                case "failure": return ".failure"
                case "retry": return ".retry"
                case "start": return ".start"
                case "stop": return ".stop"
                case "click": return ".click"
                case "directionUp": return ".directionUp"
                case "directionDown": return ".directionDown"
                default: return ".notification"
                }
            }()
            return """
            #if os(watchOS) && canImport(WatchKit)
            WKInterfaceDevice.current().play(\(hkType))
            #endif
            """

        // Every one of these can genuinely fail (permission denied, no
        // hardware, no fix yet). They take the error branch instead of
        // writing a plausible-looking zero — a fitness screen that shows
        // "0.00 km" because GPS was refused is a lie, not a reading.
        case .getLocation:
            let lat = store("latitudeVariable")
            let lon = store("longitudeVariable")
            return """
            var \(flag) = false
            #if canImport(CoreLocation)
            if let __loc_\(flag) = await LocationService.shared.requestOnce() {
                \(lat.map { "\($0) = __loc_\(flag).coordinate.latitude" } ?? "")
                \(lon.map { "\($0) = __loc_\(flag).coordinate.longitude" } ?? "")
                \(flag) = true
            }
            #endif
            """

        case .readHeartRate:
            let target = store()
            return """
            var \(flag) = false
            #if canImport(HealthKit)
            if await HealthService.shared.requestAuthorization(),
               let __bpm_\(flag) = await HealthService.shared.latestHeartRate() {
                \(target.map { "\($0) = __bpm_\(flag)" } ?? "")
                \(flag) = true
            }
            #endif
            """

        case .readStepCount:
            let target = store()
            return """
            var \(flag) = false
            #if canImport(HealthKit)
            if await HealthService.shared.requestAuthorization(),
               let __steps_\(flag) = await HealthService.shared.todaySteps() {
                \(target.map { "\($0) = __steps_\(flag)" } ?? "")
                \(flag) = true
            }
            #endif
            """

        case .readMotion:
            let xVar = store("xVariable")
            let yVar = store("yVariable")
            let zVar = store("zVariable")
            return """
            var \(flag) = false
            #if canImport(CoreMotion)
            if MotionService.shared.readOnce() {
                \(xVar.map { "\($0) = MotionService.shared.x" } ?? "")
                \(yVar.map { "\($0) = MotionService.shared.y" } ?? "")
                \(zVar.map { "\($0) = MotionService.shared.z" } ?? "")
                \(flag) = true
            }
            #endif
            """

        case .readBatteryLevel:
            let target = store()
            return """
            var \(flag) = false
            if let __battery_\(flag) = DeviceInfo.batteryPercent() {
                \(target.map { "\($0) = __battery_\(flag)" } ?? "")
                \(flag) = true
            }
            """

        // MARK: HTTP
        case .httpRequest:
            let url = swiftStringParam(block, "url", variableTypes: variableTypes)
            let method = swiftStringParam(block, "method", variableTypes: variableTypes)
            let body = paramValue(block, "body").map { swiftInterpolatedString($0, variableTypes: variableTypes) }
            let headerLines = (paramValue(block, "headers") ?? "").split(separator: "\n").compactMap { line -> String? in
                let parts = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                guard parts.count == 2 else { return nil }
                return "request.setValue(\(swiftInterpolatedString(parts[1], variableTypes: variableTypes)), forHTTPHeaderField: \(swiftString(parts[0])))"
            }.joined(separator: "\n")
            return """
            var \(flag) = false
            do {
                guard let __url_\(flag) = URL(string: \(url)) else { throw URLError(.badURL) }
                var request = URLRequest(url: __url_\(flag))
                request.httpMethod = \(method)
                // Consume anything Set Header / Set Body queued before this call.
                for (__k, __v) in __pendingHeaders { request.setValue(__v, forHTTPHeaderField: __k) }
                if let __pb = __pendingBody { request.httpBody = __pb; request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
                __pendingHeaders = [:]; __pendingBody = nil
            \(headerLines.isEmpty ? "" : indent(headerLines, spaces: 4) + "\n")\(body.map { "    request.httpBody = Data((\($0)).utf8)\n    request.setValue(\"application/json\", forHTTPHeaderField: \"Content-Type\")\n" } ?? "")    let (data, response) = try await URLSession.shared.data(for: request)
                __lastResponseData = data
                __lastStatusCode = (response as? HTTPURLResponse)?.statusCode ?? 0
                \(flag) = (200..<300).contains(__lastStatusCode)
            } catch {
                print("HTTP Request failed: \\(error.localizedDescription)")
            }
            """

        case .setRequestHeader:
            let key = swiftStringParam(block, "key", variableTypes: variableTypes)
            let value = swiftStringParam(block, "value", variableTypes: variableTypes)
            // Queue-only, cannot fail; declare the branch flag so the Success
            // chain (2-output block) continues.
            return "__pendingHeaders[\(key)] = \(value)\nlet \(flag) = true"

        case .setRequestBody:
            let bodyValue = swiftStringParam(block, "body", variableTypes: variableTypes)
            return "__pendingBody = Data((\(bodyValue)).utf8)\nlet \(flag) = true"

        case .buildURL:
            guard let storeIn = store() else { return "let \(flag) = false" }
            let base = swiftStringParam(block, "base", variableTypes: variableTypes)
            let path = swiftStringParam(block, "path", variableTypes: variableTypes)
            let queryLiteral = keyValueLiteral(block, "query", variableTypes: variableTypes)
            return """
            var \(flag) = false
            do {
                var __components_\(flag) = URLComponents(string: \(base) + \(path))
                let __query_\(flag): [String: Any] = \(queryLiteral)
                if !__query_\(flag).isEmpty {
                    __components_\(flag)?.queryItems = __query_\(flag).map { URLQueryItem(name: $0.key, value: String(describing: $0.value)) }
                }
                if let __built_\(flag) = __components_\(flag)?.url?.absoluteString {
                    \(storeIn) = __built_\(flag)
                    \(flag) = true
                }
            }
            """

        case .parseJSONResponse:
            guard let storeIn = store() else { return "let \(flag) = false" }
            let path = paramValue(block, "path") ?? ""
            // Navigate the dot-path (data.user.name, items.0.id) through the
            // most recent HTTP response — the block that made "Parse JSON" a
            // stub before this.
            let keys = path.split(separator: ".").map(String.init)
            let keyArray = "[" + keys.map { swiftString($0) }.joined(separator: ", ") + "]"
            return """
            var \(flag) = false
            if let __obj_\(flag) = try? JSONSerialization.jsonObject(with: __lastResponseData) {
                var __cursor_\(flag): Any? = __obj_\(flag)
                for __key_\(flag) in \(keyArray) as [String] {
                    if let __dict_\(flag) = __cursor_\(flag) as? [String: Any] {
                        __cursor_\(flag) = __dict_\(flag)[__key_\(flag)]
                    } else if let __arr_\(flag) = __cursor_\(flag) as? [Any], let __idx_\(flag) = Int(__key_\(flag)), __arr_\(flag).indices.contains(__idx_\(flag)) {
                        __cursor_\(flag) = __arr_\(flag)[__idx_\(flag)]
                    } else {
                        __cursor_\(flag) = nil
                    }
                }
                if let __value_\(flag) = __cursor_\(flag) {
                    \(storeIn) = String(describing: __value_\(flag))
                    \(flag) = true
                }
            }
            """


        case .handleAPIError:
            return """
            var \(flag) = (200..<300).contains(__lastStatusCode)
            """

        // MARK: Commerce & Push
        case .purchaseProduct:
            let productId = swiftStringParam(block, "productId", variableTypes: variableTypes)
            let storeIn = store()
            return """
            var \(flag) = false
            if let __txId_\(flag) = await StoreService.shared.purchase(productId: \(productId)) {
                \(storeIn.map { "\($0) = __txId_\(flag)" } ?? "_ = __txId_\(flag)")
                \(flag) = true
            }
            """

        case .restorePurchases:
            return """
            let \(flag) = await StoreService.shared.restore()
            """

        case .registerForPush:
            let storeIn = store()
            return """
            var \(flag) = false
            #if os(iOS)
            let __token_\(flag) = await PushService.shared.register()
            \(storeIn.map { "if let __t_\(flag) = __token_\(flag) { \($0) = __t_\(flag) }" } ?? "")
            \(flag) = (__token_\(flag) != nil)
            #endif
            """

        case .jsonParse:
            guard let storeIn = store() else { return "let \(flag) = false" }
            let input = swiftStringParam(block, "input", variableTypes: variableTypes)
            return """
            var \(flag) = false
            if let __data_\(flag) = (\(input)).data(using: .utf8), (try? JSONSerialization.jsonObject(with: __data_\(flag))) != nil {
                \(storeIn) = \(input)
                \(flag) = true
            }
            """

        // MARK: Firebase Auth
        case .firebaseLogin:
            let email = fieldValue("email")
            let password = fieldValue("password")
            return """
            var \(flag) = false
            #if canImport(FirebaseAuth)
            do {
                _ = try await Auth.auth().signIn(withEmail: \(email), password: \(password))
                \(flag) = true
            } catch {
                print("Firebase Login failed: \\(error.localizedDescription)")
            }
            #else
            print("Firebase Login: add the Firebase SPM package (FirebaseAuth) to enable this.")
            #endif
            """

        case .firebaseRegister:
            let email = fieldValue("email")
            let password = fieldValue("password")
            return """
            var \(flag) = false
            #if canImport(FirebaseAuth)
            do {
                _ = try await Auth.auth().createUser(withEmail: \(email), password: \(password))
                \(flag) = true
            } catch {
                print("Firebase Register failed: \\(error.localizedDescription)")
            }
            #else
            print("Firebase Register: add the Firebase SPM package (FirebaseAuth) to enable this.")
            #endif
            """

        case .firebaseLogout:
            return """
            var \(flag) = false
            #if canImport(FirebaseAuth)
            do {
                try Auth.auth().signOut()
                \(flag) = true
            } catch {
                print("Firebase Logout failed: \\(error.localizedDescription)")
            }
            #else
            print("Firebase Logout: add the Firebase SPM package (FirebaseAuth) to enable this.")
            #endif
            """

        case .firebaseGetCurrentUser, .firebaseAuthStateChanged:
            let storeIn = store()
            // A "Store In" variable named for an identity (currentUserId, uid,
            // ownerId) must receive the UID, not the email. Storing the email
            // there used to overwrite state.currentUserId — which is what
            // {{uid}} resolves to — so every document was keyed by email and
            // every owner-scoped rule then denied the read. Any other name
            // still gets the friendlier email.
            let storeName = (variableReference(block, key: "variable")
                ?? block.parameters.first { $0.key == "variable" }?.value ?? "").lowercased()
            let wantsIdentity = storeName.contains("uid") || storeName.hasSuffix("id") || storeName.hasSuffix("userid")
            let storeLine = storeIn.flatMap { target -> String? in
                // Already assigned two lines up — assigning again (with the
                // email) would clobber it.
                guard target != "state.currentUserId" else { return nil }
                return wantsIdentity
                    ? "\n    \(target) = __user_\(flag).uid"
                    : "\n    \(target) = __user_\(flag).email ?? __user_\(flag).uid"
            }
            return """
            var \(flag) = false
            #if canImport(FirebaseAuth)
            if let __user_\(flag) = Auth.auth().currentUser {
                state.currentUserEmail = __user_\(flag).email ?? ""
                state.currentUserId = __user_\(flag).uid\(storeLine ?? "")
                \(flag) = true
            }
            #else
            print("\(swiftEscaped(block.label)): add the Firebase SPM package (FirebaseAuth) to enable this.")
            #endif
            """

        case .firebaseResetPassword:
            let email = fieldValue("email")
            return """
            var \(flag) = false
            #if canImport(FirebaseAuth)
            do {
                try await Auth.auth().sendPasswordReset(withEmail: \(email))
                \(flag) = true
            } catch {
                print("Reset Password failed: \\(error.localizedDescription)")
            }
            #else
            print("Reset Password: add the Firebase SPM package (FirebaseAuth) to enable this.")
            #endif
            """

        case .firebaseDeleteAccount:
            return """
            var \(flag) = false
            #if canImport(FirebaseAuth)
            do {
                try await Auth.auth().currentUser?.delete()
                \(flag) = true
            } catch {
                print("Delete Account failed: \\(error.localizedDescription)")
            }
            #else
            print("Delete Account: add the Firebase SPM package (FirebaseAuth) to enable this.")
            #endif
            """

        case .firebaseUpdateProfile:
            let name = paramValue(block, "displayName").map { swiftInterpolatedString($0, variableTypes: variableTypes) }
            let photo = paramValue(block, "photoURL").map { swiftInterpolatedString($0, variableTypes: variableTypes) }
            return """
            var \(flag) = false
            #if canImport(FirebaseAuth)
            do {
                let __change_\(flag) = Auth.auth().currentUser?.createProfileChangeRequest()
            \(name.map { "    __change_\(flag)?.displayName = \($0)\n" } ?? "")\(photo.map { "    __change_\(flag)?.photoURL = URL(string: \($0))\n" } ?? "")    try await __change_\(flag)?.commitChanges()
                \(flag) = true
            } catch {
                print("Update Profile failed: \\(error.localizedDescription)")
            }
            #else
            print("Update Profile: add the Firebase SPM package (FirebaseAuth) to enable this.")
            #endif
            """

        // MARK: Firestore
        case .firestoreAddDocument, .firestoreSetDocument:
            let collection = swiftStringParam(block, "collection", variableTypes: variableTypes)
            let data = keyValueLiteral(block, "data", variableTypes: variableTypes)
            let docId = paramValue(block, "documentId").map { swiftInterpolatedString($0, variableTypes: variableTypes) }
            let addOrSet = (block.type == .firestoreAddDocument || docId == nil)
                ? "try await Firestore.firestore().collection(\(collection)).addDocument(data: \(data))"
                : "try await Firestore.firestore().collection(\(collection)).document(\(docId!)).setData(\(data))"
            return """
            var \(flag) = false
            #if canImport(FirebaseFirestore)
            do {
                _ = \(addOrSet)
                \(flag) = true
            } catch {
                print("\(swiftEscaped(block.label)) failed: \\(error.localizedDescription)")
            }
            #else
            print("\(swiftEscaped(block.label)): add the Firebase SPM package (FirebaseFirestore) to enable this.")
            #endif
            """

        case .firestoreGetDocument:
            let path = swiftStringParam(block, "path", variableTypes: variableTypes)
            let storeIn = store()
            return """
            var \(flag) = false
            #if canImport(FirebaseFirestore)
            do {
                let __doc_\(flag) = try await Firestore.firestore().document(\(path)).getDocument()
            \(storeIn.map { "    \($0) = GeneratedJSON.encode(__doc_\(flag).data() ?? [:])\n" } ?? "")    \(flag) = __doc_\(flag).exists
            } catch {
                print("Get Document failed: \\(error.localizedDescription)")
            }
            #else
            print("Get Document: add the Firebase SPM package (FirebaseFirestore) to enable this.")
            #endif
            """

        case .firestoreUpdateDocument:
            let path = swiftStringParam(block, "path", variableTypes: variableTypes)
            let data = keyValueLiteral(block, "data", variableTypes: variableTypes)
            return """
            var \(flag) = false
            #if canImport(FirebaseFirestore)
            do {
                try await Firestore.firestore().document(\(path)).updateData(\(data))
                \(flag) = true
            } catch {
                print("Update Document failed: \\(error.localizedDescription)")
            }
            #else
            print("Update Document: add the Firebase SPM package (FirebaseFirestore) to enable this.")
            #endif
            """

        case .firestoreDeleteDocument:
            let path = swiftStringParam(block, "path", variableTypes: variableTypes)
            return """
            var \(flag) = false
            #if canImport(FirebaseFirestore)
            do {
                try await Firestore.firestore().document(\(path)).delete()
                \(flag) = true
            } catch {
                print("Delete Document failed: \\(error.localizedDescription)")
            }
            #else
            print("Delete Document: add the Firebase SPM package (FirebaseFirestore) to enable this.")
            #endif
            """

        case .firestoreQuery:
            let collection = swiftStringParam(block, "collection", variableTypes: variableTypes)
            let limit = paramValue(block, "limit")
            let storeIn = store()
            // The where/orderBy parameters used to be DROPPED, which is not a
            // missing optimisation: the generated rules only allow reading
            // documents that carry your uid, and Firestore evaluates rules
            // against the QUERY, not the results. An unfiltered query is
            // therefore denied at runtime — every list came back empty.
            let constraints = firestoreQueryConstraints(block, flag: flag, variableTypes: variableTypes)
            return """
            var \(flag) = false
            #if canImport(FirebaseFirestore)
            do {
                var __query_\(flag): Query = Firestore.firestore().collection(\(collection))
            \(constraints)\(limit.map { "    __query_\(flag) = __query_\(flag).limit(to: \($0))\n" } ?? "")    let __snapshot_\(flag) = try await __query_\(flag).getDocuments()
            \(storeIn.map { "    \($0) = GeneratedJSON.encode(__snapshot_\(flag).documents.map { __d -> [String: Any] in var __m = __d.data(); __m[\"_id\"] = __d.documentID; return __m })\n" } ?? "")    \(flag) = true
            } catch {
                print("Query Collection failed: \\(error.localizedDescription)")
            }
            #else
            print("Query Collection: add the Firebase SPM package (FirebaseFirestore) to enable this.")
            #endif
            """

        case .firestoreListenDocument, .firestoreListenQuery:
            // A LISTENER that isn't implemented must not claim success — the
            // preview's mock really listens, so `flag = true` here shipped
            // apps whose "live" screens silently never updated. Do the honest
            // useful thing instead: one real read now (so the screen shows
            // current data), and the error branch until real listening lands.
            let path = block.type == .firestoreListenDocument
                ? swiftStringParam(block, "path", variableTypes: variableTypes)
                : swiftStringParam(block, "collection", variableTypes: variableTypes)
            let storeIn = store()
            if block.type == .firestoreListenDocument {
                return """
                var \(flag) = false
                #if canImport(FirebaseFirestore)
                do {
                    // One-shot read standing in for a listener (native
                    // addSnapshotListener codegen is not implemented yet).
                    let __doc_\(flag) = try await Firestore.firestore().document(\(path)).getDocument()
                \(storeIn.map { "    \($0) = GeneratedJSON.encode(__doc_\(flag).data() ?? [:])\n" } ?? "")    \(flag) = __doc_\(flag).exists
                } catch {
                    print("\(swiftEscaped(block.label)) failed: \\(error.localizedDescription)")
                }
                #else
                print("\(swiftEscaped(block.label)): add the Firebase SPM package (FirebaseFirestore) to enable this.")
                #endif
                """
            }
            return """
            var \(flag) = false
            #if canImport(FirebaseFirestore)
            do {
                // One-shot query standing in for a listener (native
                // addSnapshotListener codegen is not implemented yet).
                let __snapshot_\(flag) = try await Firestore.firestore().collection(\(path)).getDocuments()
            \(storeIn.map { "    \($0) = GeneratedJSON.encode(__snapshot_\(flag).documents.map { __d -> [String: Any] in var __m = __d.data(); __m[\"_id\"] = __d.documentID; return __m })\n" } ?? "")    \(flag) = true
            } catch {
                print("\(swiftEscaped(block.label)) failed: \\(error.localizedDescription)")
            }
            #else
            print("\(swiftEscaped(block.label)): add the Firebase SPM package (FirebaseFirestore) to enable this.")
            #endif
            """

        case .firestoreBatchWrite:
            // No real batch semantics yet — claiming success was a lie that
            // sent data flows down the happy path with nothing written.
            return """
            let \(flag) = false
            print("\(swiftEscaped(block.label)): batch writes are not implemented in native export yet — taking the Error branch. Use individual Save/Update blocks instead.")
            """

        // MARK: Supabase
        case .supabaseInsert, .supabaseUpdate, .supabaseDelete, .supabaseQuery:
            return supabaseSetup(block, flag: flag, variableTypes: variableTypes, project: project)

        // MARK: Supabase auth
        // These shipped with a simulator implementation and a web
        // implementation but NO native codegen, so they fell through to the
        // `flag = false` default — and because they branch on success/error,
        // the exported app's Sign In button always ran the ERROR chain. A
        // login that can never succeed is worse than one that is missing.
        case .supabaseSignUp, .supabaseSignIn, .supabaseSignOut, .supabaseCurrentUser:
            guard let config = project.supabaseConfig, config.isConfigured else {
                return "let \(flag) = false // Supabase is not configured for this project"
            }
            let baseURL = swiftString(config.projectURL)
            let anonKey = swiftString(config.anonKey)
            let sessionVariable = variableReference(block, key: "sessionVariable")
                .map { "state.\(swiftIdentifier($0, fallback: "session"))" }

            if block.type == .supabaseSignOut {
                return """
                var \(flag) = true
                \(sessionVariable.map { "\($0) = \"\"" } ?? "")
                AuthService.shared.signOut()
                """
            }

            if block.type == .supabaseCurrentUser {
                let storeIn = variableReference(block, key: "userVariable")
                    .map { "state.\(swiftIdentifier($0, fallback: "user"))" }
                let token = sessionVariable ?? "\"\""
                return """
                var \(flag) = false
                do {
                    guard let __url_\(flag) = URL(string: \(baseURL) + "/auth/v1/user") else { throw URLError(.badURL) }
                    var __request_\(flag) = URLRequest(url: __url_\(flag))
                    __request_\(flag).setValue(\(anonKey), forHTTPHeaderField: "apikey")
                    __request_\(flag).setValue("Bearer \\(\(token))", forHTTPHeaderField: "Authorization")
                    let (__data_\(flag), __response_\(flag)) = try await URLSession.shared.data(for: __request_\(flag))
                    let __status_\(flag) = (__response_\(flag) as? HTTPURLResponse)?.statusCode ?? 0
                    \(flag) = (200..<300).contains(__status_\(flag))
                    \(storeIn.map { "if \(flag) { \($0) = String(data: __data_\(flag), encoding: .utf8) ?? \"\" }" } ?? "")
                } catch {
                    \(flag) = false
                }
                """
            }

            // Sign up / sign in.
            let path = block.type == .supabaseSignUp
                ? "/auth/v1/signup"
                : "/auth/v1/token?grant_type=password"
            let email = swiftStringParam(block, "email", variableTypes: variableTypes)
            let password = swiftStringParam(block, "password", variableTypes: variableTypes)
            return """
            var \(flag) = false
            do {
                guard let __url_\(flag) = URL(string: \(baseURL) + \(swiftString(path))) else { throw URLError(.badURL) }
                var __request_\(flag) = URLRequest(url: __url_\(flag))
                __request_\(flag).httpMethod = "POST"
                __request_\(flag).setValue(\(anonKey), forHTTPHeaderField: "apikey")
                __request_\(flag).setValue("application/json", forHTTPHeaderField: "Content-Type")
                __request_\(flag).httpBody = try? JSONSerialization.data(
                    withJSONObject: ["email": \(email), "password": \(password)]
                )
                let (__data_\(flag), __response_\(flag)) = try await URLSession.shared.data(for: __request_\(flag))
                let __status_\(flag) = (__response_\(flag) as? HTTPURLResponse)?.statusCode ?? 0
                let __json_\(flag) = (try? JSONSerialization.jsonObject(with: __data_\(flag))) as? [String: Any]
                if (200..<300).contains(__status_\(flag)), let __token_\(flag) = __json_\(flag)?["access_token"] as? String {
                    \(sessionVariable.map { "\($0) = __token_\(flag)" } ?? "")
                    let __user_\(flag) = __json_\(flag)?["user"] as? [String: Any]
                    state.currentUserId = (__user_\(flag)?["id"] as? String) ?? ""
                    AuthService.shared.didSignIn(
                        userId: state.currentUserId,
                        email: \(email),
                        verified: (__user_\(flag)?["email_confirmed_at"] as? String) != nil
                    )
                    \(flag) = true
                }
            } catch {
                \(flag) = false
            }
            """

        // MARK: SQLite
        case .sqliteQuery:
            let sql = swiftStringParam(block, "sql", variableTypes: variableTypes)
            let storeIn = store()
            return """
            var \(flag) = false
            let __rows_\(flag) = GeneratedSQLite.query(\(sql))
            \(storeIn.map { "\($0) = GeneratedJSON.encode(__rows_\(flag))\n" } ?? "")\(flag) = __rows_\(flag) != nil
            """

        case .sqliteExecute:
            let sql = swiftStringParam(block, "sql", variableTypes: variableTypes)
            return "let \(flag) = GeneratedSQLite.execute(\(sql))"

        // MARK: Algolia
        case .algoliaSearch:
            let appId = swiftStringParam(block, "appId", variableTypes: variableTypes)
            let apiKey = swiftStringParam(block, "apiKey", variableTypes: variableTypes)
            let index = swiftStringParam(block, "index", variableTypes: variableTypes)
            let query = swiftStringParam(block, "query", variableTypes: variableTypes)
            let storeIn = store()
            return """
            var \(flag) = false
            do {
                var request = URLRequest(url: URL(string: "https://\\(\(appId))-dsn.algolia.net/1/indexes/\\(\(index))/query")!)
                request.httpMethod = "POST"
                request.setValue(\(appId), forHTTPHeaderField: "X-Algolia-Application-Id")
                request.setValue(\(apiKey), forHTTPHeaderField: "X-Algolia-API-Key")
                request.httpBody = try JSONSerialization.data(withJSONObject: ["params": "query=\\(\(query))"])
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            \(storeIn.map { "    \($0) = String(data: data, encoding: .utf8) ?? \"\"\n" } ?? "")    \(flag) = (200..<300).contains(status)
            } catch {
                print("Algolia Search failed: \\(error.localizedDescription)")
            }
            """

        // MARK: Native async actions
        case .downloadFile:
            let url = swiftStringParam(block, "url", variableTypes: variableTypes)
            let storeIn = store()
            return """
            var \(flag) = false
            do {
                guard let __url_\(flag) = URL(string: \(url)) else { throw URLError(.badURL) }
                let (__tempURL_\(flag), _) = try await URLSession.shared.download(from: __url_\(flag))
            \(storeIn.map { "    \($0) = __tempURL_\(flag).path\n" } ?? "")    \(flag) = true
            } catch {
                print("Download File failed: \\(error.localizedDescription)")
            }
            """

        case .biometricAuth:
            let reason = swiftStringParam(block, "reason", variableTypes: variableTypes)
            return """
            var \(flag) = false
            #if canImport(LocalAuthentication)
            let __context_\(flag) = LAContext()
            if __context_\(flag).canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) {
                \(flag) = (try? await __context_\(flag).evaluatePolicy(.deviceOwnerAuthentication, localizedReason: \(reason))) ?? false
            }
            #endif
            """

        case .requestPermission:
            return permissionSetup(block, flag: flag)

        case .confirmDialog:
            // Presented via GeneratedConfirmDialog.ask, backed by an
            // AppState-level pending-confirmation slot RootView renders as
            // a real confirmationDialog and resumes when the user answers.
            let title = swiftStringParam(block, "title", variableTypes: variableTypes)
            let message = swiftStringParam(block, "message", variableTypes: variableTypes)
            let confirmLabel = swiftStringParam(block, "confirmLabel", variableTypes: variableTypes)
            let cancelLabel = swiftStringParam(block, "cancelLabel", variableTypes: variableTypes)
            return "let \(flag) = await state.confirm(title: \(title), message: \(message), confirmLabel: \(confirmLabel), cancelLabel: \(cancelLabel))"

        case .validateForm:
            guard let nodeId = nodeReference(block, key: "element"),
                  let node = findNode(id: nodeId, in: screens)
            else { return "let \(flag) = false" }
            // Reads the field's live typed value via its existing text/value
            // binding (the same one TextField uses) — Validate Field can
            // only see what the field is actually bound to.
            let textExpr: String
            if let binding = node.logicBindings?.first(where: { $0.kind == .value || $0.kind == .text }) {
                textExpr = "String(describing: state.\(swiftIdentifier(binding.variableName, fallback: "value")))"
            } else {
                textExpr = swiftString(node.text ?? "")
            }
            let rule = paramValue(block, "rule") ?? "notEmpty"
            let argument = swiftStringParam(block, "argument", variableTypes: variableTypes)
            let expr: String
            switch rule {
            case "email": expr = "(\(textExpr)).range(of: \"^\\\\S+@\\\\S+\\\\.\\\\S+$\", options: .regularExpression) != nil"
            case "minLength": expr = "(\(textExpr)).count >= (Int(\(argument)) ?? 0)"
            case "matchesRegex": expr = "(\(textExpr)).range(of: \(argument), options: .regularExpression) != nil"
            default: expr = "!(\(textExpr)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty"
            }
            return "let \(flag) = \(expr)"

        default:
            return "let \(flag) = false // \(swiftEscaped(block.label)) has no export codegen yet"
        }
    }

    private static func supabaseSetup(_ block: LogicBlock, flag: String, variableTypes: [String: VariableType], project: DesignProject) -> String {
        guard let config = project.supabaseConfig, config.isConfigured else {
            return "let \(flag) = false // Configure Supabase (project URL + anon key) to enable \(swiftEscaped(block.label))"
        }
        let baseURL = swiftString(config.projectURL)
        let anonKey = swiftString(config.anonKey)
        let table = swiftStringParam(block, "table", variableTypes: variableTypes)
        let filter = paramValue(block, "filter").map { swiftInterpolatedString($0, variableTypes: variableTypes) }
        let storeIn = variableReference(block, key: "variable").map { "state.\(swiftIdentifier($0, fallback: "value"))" }

        let method: String
        let bodyLine: String
        switch block.type {
        case .supabaseInsert:
            method = "POST"
            bodyLine = "request.httpBody = try? JSONSerialization.data(withJSONObject: \(keyValueLiteral(block, "data", variableTypes: variableTypes)))"
        case .supabaseUpdate:
            method = "PATCH"
            bodyLine = "request.httpBody = try? JSONSerialization.data(withJSONObject: \(keyValueLiteral(block, "data", variableTypes: variableTypes)))"
        case .supabaseDelete:
            method = "DELETE"
            bodyLine = "// no body"
        default:
            method = "GET"
            bodyLine = "// no body"
        }

        return """
        var \(flag) = false
        do {
            var __components_\(flag) = URLComponents(string: \(baseURL) + "/rest/v1/" + \(table))!
        \(filter.map { "    __components_\(flag).query = \($0)\n" } ?? "")    var request = URLRequest(url: __components_\(flag).url!)
            request.httpMethod = \(swiftString(method))
            request.setValue(\(anonKey), forHTTPHeaderField: "apikey")
            request.setValue("Bearer " + \(anonKey), forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            \(bodyLine)
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        \(storeIn.map { "    \($0) = String(data: data, encoding: .utf8) ?? \"\"\n" } ?? "")    \(flag) = (200..<300).contains(status)
        } catch {
            print("\(swiftEscaped(block.label)) failed: \\(error.localizedDescription)")
        }
        """
    }

    private static func findNode(id: UUID, in nodes: [DesignNode]) -> DesignNode? {
        for node in nodes {
            if node.id == id { return node }
            if let found = findNode(id: id, in: node.children) { return found }
        }
        return nil
    }

    // setText/clearField need to write wherever the node's value actually
    // comes from at render time: an Input already bound to a variable
    // (two-way, via logicBindings — the SAME variable its TextField reads)
    // takes priority, since writing anywhere else would be invisible. Only
    // string-shaped variables are safe to assign a plain String into; a
    // number/boolean-bound field falls back to the dynamic channel instead
    // of risking a type mismatch.
    private static func writableTextTarget(nodeId: UUID, screens: [DesignNode], dynamic: [UUID: Set<DynamicNodeProperty>], variableTypes: [String: VariableType] = [:]) -> String? {
        if let node = findNode(id: nodeId, in: screens),
           let binding = node.logicBindings?.first(where: { $0.kind == .value || $0.kind == .text }) {
            switch variableTypes[binding.variableName] ?? .string {
            case .string, .json, .optional:
                return "state.\(swiftIdentifier(binding.variableName, fallback: "value"))"
            default:
                break
            }
        }
        guard dynamic[nodeId]?.contains(.text) == true else { return nil }
        return "state.\(dynamicVarName(nodeId, .text))"
    }

    private static func permissionSetup(_ block: LogicBlock, flag: String) -> String {
        switch paramValue(block, "kind") ?? "camera" {
        case "camera":
            return """
            var \(flag) = false
            #if os(iOS)
            \(flag) = await AVCaptureDevice.requestAccess(for: .video)
            #endif
            """
        case "microphone":
            return """
            var \(flag) = false
            #if os(iOS)
            \(flag) = await AVCaptureDevice.requestAccess(for: .audio)
            #endif
            """
        case "photoLibrary":
            return """
            var \(flag) = false
            #if canImport(Photos)
            let __status_\(flag) = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
            \(flag) = (__status_\(flag) == .authorized || __status_\(flag) == .limited)
            #endif
            """
        case "location":
            return """
            // Location permission needs a CLLocationManagerDelegate; request it once at launch.
            // This block reports the CURRENT authorization status rather than presenting the prompt itself.
            var \(flag) = false
            #if canImport(CoreLocation)
            \(flag) = [.authorizedWhenInUse, .authorizedAlways].contains(CLLocationManager().authorizationStatus)
            #endif
            """
        default:
            return """
            var \(flag) = false
            #if canImport(UserNotifications)
            \(flag) = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            #endif
            """
        }
    }

    private static func swiftStatement(_ block: LogicBlock, screens: [DesignNode], variableTypes: [String: VariableType], dynamic: [UUID: Set<DynamicNodeProperty>] = [:], project: DesignProject? = nil, imageAssets: [String: String] = [:]) -> String? {
        switch block.type {
        case .navigate:
            return nodeReference(block, key: "screen").flatMap { id in screens.first { $0.id == id } }.map { "state.navigate(to: \(swiftString(screenKey($0))))" }
        case .presentSheet:
            return nodeReference(block, key: "screen").flatMap { id in screens.first { $0.id == id } }.map { "state.presentedSheet = \(swiftString(screenKey($0)))" }
        case .dismissSheet:
            return "state.presentedSheet = nil"
        case .presentBottomSheet:
            return nodeReference(block, key: "screen").flatMap { id in screens.first { $0.id == id } }.map { "state.presentedBottomSheet = \(swiftString(screenKey($0)))" }
        case .dismissBottomSheet:
            return "state.presentedBottomSheet = nil"
        case .goBack:
            return "state.goBack()"
        case .showAlert:
            return "state.alertTitle = \(swiftStringParam(block, "title", variableTypes: variableTypes))\nstate.alertMessage = \(swiftStringParam(block, "message", variableTypes: variableTypes))"
        case .showToast:
            return "state.toastMessage = \(swiftStringParam(block, "message", variableTypes: variableTypes))"
        case .setVariable:
            guard let variable = variableReference(block, key: "variable") else { return nil }
            return "state.\(swiftIdentifier(variable, fallback: "value")) = \(swiftLiteral(paramValue(block, "value") ?? "", type: variableTypes[variable] ?? .string, variableTypes: variableTypes))"
        case .toggleVariable:
            guard let variable = variableReference(block, key: "variable") else { return nil }
            return "state.\(swiftIdentifier(variable, fallback: "value")).toggle()"
        case .incrementVariable, .decrementVariable:
            guard let variable = variableReference(block, key: "variable") else { return nil }
            let amount = paramValue(block, "amount") ?? "1"
            return "state.\(swiftIdentifier(variable, fallback: "value")) \(block.type == .incrementVariable ? "+=" : "-=") \(amount)"
        case .appendToArray:
            guard let array = variableReference(block, key: "array") else { return nil }
            let item = swiftStringParam(block, "value", variableTypes: variableTypes)
            return "state.\(swiftIdentifier(array, fallback: "value")).append(\(item))"
        case .removeFromArray:
            guard let array = variableReference(block, key: "array") else { return nil }
            let item = swiftStringParam(block, "value", variableTypes: variableTypes)
            return "state.\(swiftIdentifier(array, fallback: "value")).removeAll { $0 == \(item) }"
        case .getVariable:
            return nil // read-only; nothing to execute
        case .appendJsonItem:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let item = swiftStringParam(block, "item", variableTypes: variableTypes)
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = GeneratedJSONList.appending(state.\(swiftIdentifier(storeIn, fallback: "value")), item: \(item))"
        case .replaceInVariable:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let find = swiftStringParam(block, "find", variableTypes: variableTypes)
            let repl = swiftStringParam(block, "replaceWith", variableTypes: variableTypes)
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = state.\(swiftIdentifier(storeIn, fallback: "value")).replacingOccurrences(of: \(find), with: \(repl))"
        case .loadValue:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let key = swiftStringParam(block, "key", variableTypes: variableTypes)
            let fallback = swiftStringParam(block, "default", variableTypes: variableTypes)
            let sensitive = paramValue(block, "key").map(looksSensitive) ?? false
            let raw = sensitive
                ? "(GeneratedKeychain.get(forKey: \(key)) ?? \(fallback))"
                : "(UserDefaults.standard.string(forKey: \(key)) ?? \(fallback))"
            let target = "state.\(swiftIdentifier(storeIn, fallback: "value"))"
            if variableTypes[storeIn] == .number {
                return "\(target) = Double(\(raw)) ?? 0"
            } else if variableTypes[storeIn] == .boolean {
                return "\(target) = (\(raw) == \"true\")"
            }
            return "\(target) = \(raw)"
        case .getCurrentTime:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            return """
            { let __c = Calendar.current.dateComponents([.hour, .minute], from: Date()); state.\(swiftIdentifier(storeIn, fallback: "value")) = "\\(__c.hour ?? 0):" + String(format: "%02d", __c.minute ?? 0) }()
            """.trimmingCharacters(in: .whitespacesAndNewlines)
        case .randomNumber:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let lo = swiftNumberParam(block, "min", default: "1", variableTypes: variableTypes)
            let hi = swiftNumberParam(block, "max", default: "10", variableTypes: variableTypes)
            let rollExpr = "Int.random(in: Int(min(\(lo), \(hi)))...Int(max(\(lo), \(hi))))"
            let targetIsNumber = variableTypes[storeIn] == .number
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = \(targetIsNumber ? "Double(\(rollExpr))" : "String(\(rollExpr))")"
        case .mathOperation:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let left = swiftNumberParam(block, "left", default: "0", variableTypes: variableTypes)
            let right = swiftNumberParam(block, "right", default: "0", variableTypes: variableTypes)
            let op = paramValue(block, "operator") ?? "+"
            let swiftOp: String
            switch op {
            case "-": swiftOp = "-"
            case "×": swiftOp = "*"
            case "÷": swiftOp = "/"
            case "%": swiftOp = "truncatingRemainder(dividingBy:)"
            default: swiftOp = "+"
            }
            let expr = op == "%" ? "(\(left)).truncatingRemainder(dividingBy: \(right))" : "(\(left)) \(swiftOp) (\(right))"
            let targetIsNumber = variableTypes[storeIn] == .number
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = \(targetIsNumber ? expr : "String(\(expr))")"
        case .stringOperation:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let input = swiftStringParam(block, "input", variableTypes: variableTypes)
            let argument = swiftStringParam(block, "argument", variableTypes: variableTypes)
            let op = paramValue(block, "operation") ?? "concat"
            let expr: String
            switch op {
            case "uppercase": expr = "(\(input)).uppercased()"
            case "lowercase": expr = "(\(input)).lowercased()"
            case "trim": expr = "(\(input)).trimmingCharacters(in: .whitespacesAndNewlines)"
            case "replace": expr = "(\(input)).replacingOccurrences(of: \(argument), with: \"\")"
            case "substring": expr = "String((\(input)).prefix(Int(\(argument)) ?? (\(input)).count))"
            default: expr = "(\(input)) + (\(argument))"
            }
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = \(expr)"
        case .arrayOperation:
            guard let array = variableReference(block, key: "array") else { return nil }
            let name = "state.\(swiftIdentifier(array, fallback: "value"))"
            let argument = swiftStringParam(block, "argument", variableTypes: variableTypes)
            switch paramValue(block, "operation") ?? "push" {
            case "pop": return "if !\(name).isEmpty { \(name).removeLast() }"
            case "filter": return "\(name) = \(name).filter { $0.contains(\(argument)) }"
            default: return "\(name).append(\(argument))"
            }
        case .jsonBuild:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let fields = keyValueLiteral(block, "fields", variableTypes: variableTypes)
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = GeneratedJSON.encode(\(fields))"
        case .formatDate:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let input = swiftStringParam(block, "input", variableTypes: variableTypes)
            let format = swiftStringParam(block, "format", variableTypes: variableTypes)
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = GeneratedDateFormat.format(\(input), pattern: \(format))"
        case .generateId:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = UUID().uuidString"
        case .hapticFeedback:
            return "GeneratedHaptics.play()"
        case .log:
            return "print(\(swiftStringParam(block, "message", variableTypes: variableTypes)))"
        case .openURL:
            return openExternal(swiftStringParam(block, "url", variableTypes: variableTypes))
        case .copyToClipboard:
            return "GeneratedClipboard.copy(\(swiftStringParam(block, "text", variableTypes: variableTypes)))"
        case .delay:
            return "try? await Task.sleep(nanoseconds: UInt64((\(swiftNumberParam(block, "seconds", default: "1", variableTypes: variableTypes))) * 1_000_000_000))"
        case .startTimer:
            let name = swiftStringParam(block, "name", variableTypes: variableTypes)
            let seconds = swiftNumberParam(block, "seconds", default: "1", variableTypes: variableTypes)
            // The timer's tick re-enters via runCustomEvent so any Custom
            // Event flow with the timer's name fires each interval. weak
            // state keeps the long-lived task from retaining the app state
            // in a cycle (state → task → closure → state).
            return """
            let __timerState = state
            state.scheduleGeneratedTimer(id: "named:" + \(name), seconds: \(seconds), repeats: true) { [weak __timerState] in
                guard let __timerState else { return }
                await GeneratedActions(state: __timerState).runCustomEvent(named: \(name))
            }
            """
        case .stopTimer:
            let name = swiftStringParam(block, "name", variableTypes: variableTypes)
            return "state.cancelGeneratedTimer(id: \"named:\" + \(name))"
        case .saveValue:
            let key = swiftStringParam(block, "key", variableTypes: variableTypes)
            let value = swiftStringParam(block, "value", variableTypes: variableTypes)
            // A key that NAMES a secret goes to the Keychain, not to a plist
            // on disk — "authToken" in UserDefaults is one backup away from
            // leaking. Same policy the persisted-state snapshot applies.
            if let literalKey = paramValue(block, "key"), looksSensitive(literalKey) {
                return "GeneratedKeychain.set(\(value), forKey: \(key))"
            }
            return "UserDefaults.standard.set(\(value), forKey: \(key))"
        case .customAction:
            return "// Custom action hook: \(swiftEscaped(paramValue(block, "name") ?? "customAction"))"
        case .shareContent:
            let text = swiftStringParam(block, "text", variableTypes: variableTypes)
            let url = swiftStringParam(block, "url", variableTypes: variableTypes)
            return "GeneratedShare.present(text: \(text), urlString: \(url))"
        case .sendEmail:
            let to = swiftStringParam(block, "to", variableTypes: variableTypes)
            let subject = swiftStringParam(block, "subject", variableTypes: variableTypes)
            let body = swiftStringParam(block, "body", variableTypes: variableTypes)
            return "GeneratedShare.sendEmail(to: \(to), subject: \(subject), body: \(body))"
        case .callNumber:
            return openExternal("\"tel:\\(\(swiftStringParam(block, "number", variableTypes: variableTypes)))\"")
        case .sendSMS:
            let number = swiftStringParam(block, "number", variableTypes: variableTypes)
            let body = swiftStringParam(block, "body", variableTypes: variableTypes)
            return "GeneratedShare.sendSMS(number: \(number), body: \(body))"
        case .launchMaps:
            let query = swiftStringParam(block, "query", variableTypes: variableTypes)
            return "GeneratedShare.launchMaps(query: \(query))"
        case .scheduleLocalNotification:
            let title = swiftStringParam(block, "title", variableTypes: variableTypes)
            let body = swiftStringParam(block, "body", variableTypes: variableTypes)
            let seconds = swiftNumberParam(block, "seconds", default: "5", variableTypes: variableTypes)
            return "GeneratedNotifications.schedule(title: \(title), body: \(body), seconds: \(seconds))"
        case .scheduleNotificationAt:
            let title = swiftStringParam(block, "title", variableTypes: variableTypes)
            let body = swiftStringParam(block, "body", variableTypes: variableTypes)
            let hour = swiftStringParam(block, "hour", variableTypes: variableTypes)
            let minute = swiftStringParam(block, "minute", variableTypes: variableTypes)
            return "GeneratedNotifications.scheduleAt(title: \(title), body: \(body), hour: \(hour), minute: \(minute))"
        case .setBadgeCount:
            return "GeneratedNotifications.setBadge(\(Int(paramValue(block, "count") ?? "0") ?? 0))"
        case .gameSpawn:
            let t = swiftStringParam(block, "template", variableTypes: variableTypes)
            let gx = swiftNumberParam(block, "x", default: "100", variableTypes: variableTypes)
            let gy = swiftNumberParam(block, "y", default: "100", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.spawn(template: \(t), x: CGFloat(\(gx)), y: CGFloat(\(gy))))"
        case .gameRemove:
            return "GameSceneRegistry.broadcast(.remove(target: \(swiftStringParam(block, "target", variableTypes: variableTypes))))"
        case .gameImpulse:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let dx = swiftNumberParam(block, "dx", default: "0", variableTypes: variableTypes)
            let dy = swiftNumberParam(block, "dy", default: "0", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.impulse(entity: \(ent), dx: CGFloat(\(dx)), dy: CGFloat(\(dy))))"
        case .gameMove:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let mx = swiftNumberParam(block, "x", default: "0", variableTypes: variableTypes)
            let my = swiftNumberParam(block, "y", default: "0", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.move(entity: \(ent), x: CGFloat(\(mx)), y: CGFloat(\(my))))"
        case .gameSetGravity:
            let gvx = swiftNumberParam(block, "gravityX", default: "0", variableTypes: variableTypes)
            let gvy = swiftNumberParam(block, "gravity", default: "-18", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.setGravityVector(dx: CGFloat(\(gvx)), dy: CGFloat(\(gvy))))"
        case .gameAddScore:
            return "GameSceneRegistry.broadcast(.addScore(Int(\(swiftNumberParam(block, "points", default: "1", variableTypes: variableTypes)))))"
        case .gameEnd:
            return "GameSceneRegistry.broadcast(.end(win: \((paramValue(block, "result") ?? "gameOver") == "win")))"
        case .gamePause:
            return "GameSceneRegistry.broadcast(.pause(\((paramValue(block, "mode") ?? "pause") == "pause")))"
        case .gameSetVelocity:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let vx = swiftNumberParam(block, "vx", default: "0", variableTypes: variableTypes)
            let vy = swiftNumberParam(block, "vy", default: "0", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.setVelocity(entity: \(ent), vx: CGFloat(\(vx)), vy: CGFloat(\(vy))))"
        case .gameSetProperty:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let prop = swiftString(paramValue(block, "property") ?? "color")
            let v = swiftStringParam(block, "value", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.setProperty(entity: \(ent), property: \(prop), value: \(v)))"
        case .gameAnimate:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let ax = swiftNumberParam(block, "x", default: "100", variableTypes: variableTypes)
            let ay = swiftNumberParam(block, "y", default: "100", variableTypes: variableTypes)
            let dur = swiftNumberParam(block, "duration", default: "0.6", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.animate(entity: \(ent), x: CGFloat(\(ax)), y: CGFloat(\(ay)), duration: CGFloat(\(dur))))"
        case .gameAddBehavior:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let bjson = swiftStringParam(block, "behavior", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.addBehavior(entity: \(ent), behaviorJSON: \(bjson)))"
        case .gameRemoveBehavior:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let btype = swiftStringParam(block, "behaviorType", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.removeBehavior(entity: \(ent), type: \(btype)))"
        case .gameSetHealth:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.setHealth(entity: \(ent), health: Int(\(swiftNumberParam(block, "health", default: "3", variableTypes: variableTypes)))))"
        case .gameShake:
            return "GameSceneRegistry.broadcast(.shake(CGFloat(\(swiftNumberParam(block, "intensity", default: "10", variableTypes: variableTypes)))))"
        case .gameParticles:
            let kind = swiftString(paramValue(block, "kind") ?? "confetti")
            let px = swiftNumberParam(block, "x", default: "195", variableTypes: variableTypes)
            let py = swiftNumberParam(block, "y", default: "300", variableTypes: variableTypes)
            let burst = swiftNumberParam(block, "burst", default: "40", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.particles(kind: \(kind), x: CGFloat(\(px)), y: CGFloat(\(py)), burst: Int(\(burst))))"
        case .gameSetTimeScale:
            return "GameSceneRegistry.broadcast(.setTimeScale(CGFloat(\(swiftNumberParam(block, "scale", default: "1", variableTypes: variableTypes)))))"
        case .gameSetSpawnRate:
            return "GameSceneRegistry.broadcast(.setSpawnInterval(CGFloat(\(swiftNumberParam(block, "interval", default: "1", variableTypes: variableTypes)))))"
        case .gameSetLives:
            return "GameSceneRegistry.broadcast(.setLives(Int(\(swiftNumberParam(block, "lives", default: "3", variableTypes: variableTypes)))))"
        case .gameRestart:
            return "GameSceneRegistry.broadcast(.restart)"
        case .gameMotor:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let thr = swiftNumberParam(block, "throttle", default: "1", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.motor(entity: \(ent), throttle: CGFloat(\(thr))))"
        case .gameTorque:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let amt = swiftNumberParam(block, "amount", default: "40", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.torque(entity: \(ent), amount: CGFloat(\(amt))))"
        case .gameLoadSlingshot:
            return "GameSceneRegistry.broadcast(.loadSlingshot(entity: \(swiftStringParam(block, "entity", variableTypes: variableTypes))))"
        case .gameDamage:
            let dent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.damageEntity(entity: \(dent), amount: Int(\(swiftNumberParam(block, "amount", default: "1", variableTypes: variableTypes)))))"
        case .gameLaunch:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let ang = swiftNumberParam(block, "angle", default: "60", variableTypes: variableTypes)
            let str = swiftNumberParam(block, "strength", default: "40", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.launch(entity: \(ent), angle: CGFloat(\(ang)), strength: CGFloat(\(str))))"
        case .gameSetPhysics:
            let ent = swiftStringParam(block, "entity", variableTypes: variableTypes)
            let prop = swiftString(paramValue(block, "property") ?? "bounciness")
            let v = swiftStringParam(block, "value", variableTypes: variableTypes)
            return "GameSceneRegistry.broadcast(.setPhysics(entity: \(ent), property: \(prop), value: \(v)))"
        case .gameQuery:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            let what = swiftString(paramValue(block, "what") ?? "score")
            let target = swiftStringParam(block, "target", variableTypes: variableTypes)
            let dest = "state.\(swiftIdentifier(storeIn, fallback: "value"))"
            if variableTypes[storeIn] == .number {
                return "\(dest) = Double(GameSceneRegistry.query(\(what), \(target))) ?? 0"
            }
            return "\(dest) = GameSceneRegistry.query(\(what), \(target))"
        case .ringAlarm:
            let ringStyle = swiftStringParam(block, "style", variableTypes: variableTypes)
            let autoStop = swiftNumberParam(block, "duration", default: "0", variableTypes: variableTypes)
            return "GeneratedSound.startRinging(\(ringStyle), autoStop: \(autoStop))"
        case .playSound:
            return "GeneratedSound.play(\(swiftStringParam(block, "file", variableTypes: variableTypes)))"
        case .stopSound:
            return "GeneratedSound.stop()"
        case .clearField:
            guard let nodeId = nodeReference(block, key: "element"),
                  let target = writableTextTarget(nodeId: nodeId, screens: screens, dynamic: dynamic, variableTypes: variableTypes)
            else { return nil }
            return "\(target) = \"\""
        case .executeCustomCode:
            return paramValue(block, "code") ?? "// (empty custom code block)"
        case .setDarkModeOverride:
            switch paramValue(block, "mode") ?? "system" {
            case "light": return "state.colorSchemeOverride = .light"
            case "dark": return "state.colorSchemeOverride = .dark"
            default: return "state.colorSchemeOverride = nil"
            }
        case .presentDatePicker:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            return "state.\(swiftIdentifier(storeIn, fallback: "value")) = ISO8601DateFormatter().string(from: Date()) // TODO: present a real DatePicker sheet bound to this variable"
        case .presentColorPicker:
            guard let storeIn = variableReference(block, key: "variable") else { return nil }
            return "// TODO: present a real ColorPicker sheet that writes a hex string into state.\(swiftIdentifier(storeIn, fallback: "value"))"
        // UI updates — write to the per-node dynamic state nodeViews() reads from.
        case .setText:
            guard let nodeId = nodeReference(block, key: "element"),
                  let target = writableTextTarget(nodeId: nodeId, screens: screens, dynamic: dynamic, variableTypes: variableTypes)
            else { return nil }
            return "\(target) = \(swiftStringParam(block, "text", variableTypes: variableTypes))"
        case .setColor:
            guard let nodeId = nodeReference(block, key: "element") else { return nil }
            let property: DynamicNodeProperty = (paramValue(block, "property") ?? "fill") == "textColor" ? .textColor : .fill
            guard dynamic[nodeId]?.contains(property) == true else { return nil }
            return "state.\(dynamicVarName(nodeId, property)) = \(swiftStringParam(block, "color", variableTypes: variableTypes))"
        case .setVisible:
            guard let nodeId = nodeReference(block, key: "element"), dynamic[nodeId]?.contains(.opacityChannel) == true else { return nil }
            let visible = paramValue(block, "visible") != "false"
            return "withAnimation(.easeInOut(duration: 0.2)) { state.\(dynamicVarName(nodeId, .opacityChannel)) = \(visible ? "1" : "0.08") }"
        case .setEnabled:
            guard let nodeId = nodeReference(block, key: "element"), dynamic[nodeId]?.contains(.opacityChannel) == true else { return nil }
            let enabled = paramValue(block, "enabled") != "false"
            return "state.\(dynamicVarName(nodeId, .opacityChannel)) = \(enabled ? "1" : "0.45")"
        case .setLoading:
            guard let nodeId = nodeReference(block, key: "element"), dynamic[nodeId]?.contains(.opacityChannel) == true else { return nil }
            let loading = paramValue(block, "loading") != "false"
            return "state.\(dynamicVarName(nodeId, .opacityChannel)) = \(loading ? "0.55" : "1")"
        case .setImage:
            guard let nodeId = nodeReference(block, key: "element"), dynamic[nodeId]?.contains(.image) == true else { return nil }
            let rawSource = paramValue(block, "source") ?? ""
            // A source matching an already-copied local asset resolves to
            // its bundled resource name (DynamicRemoteImage looks there
            // too), so swapping between two *local* images — the common
            // case, e.g. a tapped album's art — actually renders instead of
            // silently falling back to a gray placeholder.
            let resolvedSource = imageAssets[rawSource].map(swiftString) ?? swiftStringParam(block, "source", variableTypes: variableTypes)
            return "state.\(dynamicVarName(nodeId, .image)) = \(resolvedSource)"
        case .scrollTo:
            return "// Scroll To: '\(paramValue(block, "axis") ?? "vertical")' scrolling needs a real ScrollView container around this element"
        case .animate:
            return animateStatement(block, variableTypes: variableTypes, dynamic: dynamic)
        case .bindProperty:
            return nil // logicBindings already wires this node's live rendering; nothing to execute here
        case .setNavigationSelection:
            guard let variable = variableReference(block, key: "variable") else { return nil }
            return "state.\(swiftIdentifier(variable, fallback: "value")) = \(swiftStringParam(block, "value", variableTypes: variableTypes))"
        case .logAnalyticsEvent:
            let name = swiftStringParam(block, "name", variableTypes: variableTypes)
            let params = keyValueLiteral(block, "parameters", variableTypes: variableTypes)
            return """
            #if canImport(FirebaseAnalytics)
            Analytics.logEvent(\(name), parameters: \(params))
            #else
            print("Analytics event (add FirebaseAnalytics to enable): \\(\(name))")
            #endif
            """
        default:
            return nil
        }
    }

    // opacity/scale/cornerRadius/x/y/width/height animation — mirrors the
    // in-app simulator's semantics exactly (scale recomputes width/height/x/y
    // around the node's center) so preview and export agree.
    private static func animateStatement(_ block: LogicBlock, variableTypes: [String: VariableType], dynamic: [UUID: Set<DynamicNodeProperty>]) -> String? {
        guard let nodeId = nodeReference(block, key: "element"), let props = dynamic[nodeId] else { return nil }
        let duration = swiftNumberParam(block, "duration", default: "0.3", variableTypes: variableTypes)
        let to = swiftNumberParam(block, "to", default: "0", variableTypes: variableTypes)
        let animation = "withAnimation(.interactiveSpring(response: \(duration), dampingFraction: 0.82))"

        switch paramValue(block, "property") ?? "opacity" {
        case "opacity" where props.contains(.opacityChannel):
            return "\(animation) { state.\(dynamicVarName(nodeId, .opacityChannel)) = min(max(\(to), 0), 1) }"
        case "scale" where [.x, .y, .width, .height].allSatisfy(props.contains):
            let xVar = dynamicVarName(nodeId, .x), yVar = dynamicVarName(nodeId, .y)
            let wVar = dynamicVarName(nodeId, .width), hVar = dynamicVarName(nodeId, .height)
            return """
            \(animation) {
                let scale = max(\(to), 0.05)
                let centerX = state.\(xVar) + state.\(wVar) / 2
                let centerY = state.\(yVar) + state.\(hVar) / 2
                state.\(wVar) = max(1, state.\(wVar) * scale)
                state.\(hVar) = max(1, state.\(hVar) * scale)
                state.\(xVar) = centerX - state.\(wVar) / 2
                state.\(yVar) = centerY - state.\(hVar) / 2
            }
            """
        case "x" where props.contains(.x):
            return "\(animation) { state.\(dynamicVarName(nodeId, .x)) = \(to) }"
        case "y" where props.contains(.y):
            return "\(animation) { state.\(dynamicVarName(nodeId, .y)) = \(to) }"
        case "width" where props.contains(.width):
            return "\(animation) { state.\(dynamicVarName(nodeId, .width)) = max(1, \(to)) }"
        case "height" where props.contains(.height):
            return "\(animation) { state.\(dynamicVarName(nodeId, .height)) = max(1, \(to)) }"
        default:
            return nil
        }
    }

    private static func openExternal(_ urlExpr: String) -> String {
        """
        #if os(iOS)
        if let url = URL(string: \(urlExpr)) { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
        #elseif canImport(AppKit)
        if let url = URL(string: \(urlExpr)) { NSWorkspace.shared.open(url) }
        #endif
        """
    }

    // Turns a Query Collection block's `where` ("userId == {{uid}}", one per
    // line) and `orderBy` ("createdAt desc") into real Firestore query
    // builders. Both are also what makes the query legal under the generated
    // owner-scoped rules.
    private static func firestoreQueryConstraints(
        _ block: LogicBlock,
        flag: String,
        variableTypes: [String: VariableType]
    ) -> String {
        var lines: [String] = []
        let query = "__query_\(flag)"

        for clause in (paramValue(block, "where") ?? "").split(separator: "\n") {
            let text = clause.trimmingCharacters(in: .whitespaces)
            guard !text.isEmpty else { continue }
            // Longest operators first, or "==" would match inside ">=".
            let operators: [(token: String, builder: String)] = [
                ("==", "isEqualTo"), ("!=", "isNotEqualTo"),
                (">=", "isGreaterThanOrEqualTo"), ("<=", "isLessThanOrEqualTo"),
                (">", "isGreaterThan"), ("<", "isLessThan"),
                (" contains ", "arrayContains"), (" in ", "in"),
            ]
            guard let match = operators.first(where: { text.contains($0.token) }),
                  let range = text.range(of: match.token)
            else { continue }
            let field = String(text[text.startIndex..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
            let rawValue = String(text[range.upperBound...]).trimmingCharacters(in: .whitespaces)
            guard !field.isEmpty, !rawValue.isEmpty else { continue }
            // A bare number or bool compares as itself; anything else (a name,
            // a {{uid}}) compares as a string — matching how the writers above
            // store it.
            let value: String
            if let number = Double(rawValue), !rawValue.contains("{{") {
                value = number == number.rounded() ? String(Int(number)) : rawValue
            } else if ["true", "false"].contains(rawValue.lowercased()), !rawValue.contains("{{") {
                value = rawValue.lowercased()
            } else {
                value = swiftInterpolatedString(rawValue, variableTypes: variableTypes)
            }
            lines.append("    \(query) = \(query).whereField(\(swiftString(field)), \(match.builder): \(value))")
        }

        let order = (paramValue(block, "orderBy") ?? "").trimmingCharacters(in: .whitespaces)
        if !order.isEmpty {
            let parts = order.split(separator: " ").map(String.init)
            let field = parts[0]
            let descending = parts.count > 1 && parts[1].lowercased().hasPrefix("desc")
            lines.append("    \(query) = \(query).order(by: \(swiftString(field)), descending: \(descending))")
        }

        return lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
    }

    // Renders a keyValue parameter ("key = value" per line, {{var}} aware)
    // into a Swift [String: String] dictionary literal.
    private static func keyValueLiteral(_ block: LogicBlock, _ key: String, variableTypes: [String: VariableType]) -> String {
        guard let raw = paramValue(block, key), !raw.isEmpty else { return "[:]" }
        let entries = raw.split(separator: "\n").compactMap { line -> String? in
            let parts = line.split(separator: "=", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count == 2 else { return nil }
            return "\(swiftString(parts[0])): \(swiftInterpolatedString(parts[1], variableTypes: variableTypes))"
        }
        return entries.isEmpty ? "[:]" : "[\(entries.joined(separator: ", "))]"
    }

    // ifCondition uses keys leftValue/rightValue; compare uses left/right —
    // same shape, different param names, so this tries both.
    private static func swiftCondition(_ block: LogicBlock, variableTypes: [String: VariableType]) -> String {
        let leftKey = block.parameters.contains { $0.key == "leftValue" } ? "leftValue" : "left"
        let rightKey = block.parameters.contains { $0.key == "rightValue" } ? "rightValue" : "right"
        let leftVariable = variableReference(block, key: leftKey)
        let leftType = leftVariable.flatMap { variableTypes[$0] } ?? .string
        let left = leftVariable.map { "state.\(swiftIdentifier($0, fallback: "value"))" } ?? swiftString(paramValue(block, leftKey) ?? "")
        let op = paramValue(block, "operator") ?? "=="
        let right = swiftLiteral(paramValue(block, rightKey) ?? "", type: leftType, variableTypes: variableTypes)
        switch op {
        case "!=": return "\(left) != \(right)"
        case "<": return "\(left) < \(right)"
        case ">": return "\(left) > \(right)"
        case "<=": return "\(left) <= \(right)"
        case ">=": return "\(left) >= \(right)"
        case "contains": return "\(left).contains(\(right))"
        case "isEmpty": return "\(left).isEmpty"
        default: return "\(left) == \(right)"
        }
    }

    // Resolves any block parameter to a String-typed Swift expression,
    // converting non-string variable types to their string form — so the
    // result is always safe to call .isEmpty/.contains/== "true" on.
    private static func swiftValueExpr(_ block: LogicBlock, key: String, variableTypes: [String: VariableType]) -> String {
        if let variable = variableReference(block, key: key) {
            let name = "state.\(swiftIdentifier(variable, fallback: "value"))"
            switch variableTypes[variable] ?? .string {
            case .string, .json: return name
            case .optional: return "(\(name) ?? \"\")"
            case .number: return "String(\(name))"
            case .boolean: return "(\(name) ? \"true\" : \"false\")"
            case .array: return "\(name).joined(separator: \", \")"
            }
        }
        return swiftInterpolatedString(paramValue(block, key) ?? "", variableTypes: variableTypes)
    }

    // Same resolution as swiftValueExpr, for parameters that are always
    // plain text (title/message/url/sql/...) rather than condition operands.
    private static func swiftStringParam(_ block: LogicBlock, _ key: String, variableTypes: [String: VariableType]) -> String {
        swiftValueExpr(block, key: key, variableTypes: variableTypes)
    }

    private static func swiftNumberParam(_ block: LogicBlock, _ key: String, default defaultLiteral: String, variableTypes: [String: VariableType]) -> String {
        if let variable = variableReference(block, key: key) {
            let name = "state.\(swiftIdentifier(variable, fallback: "value"))"
            switch variableTypes[variable] ?? .string {
            case .number: return name
            default: return "(Double(\(name).description) ?? \(defaultLiteral))"
            }
        }
        let raw = paramValue(block, key) ?? ""
        return raw.isEmpty ? defaultLiteral : raw
    }

    // True when every {{token}} in the text can compile: its root is either a
    // reserved token (uid/now/...) or a declared variable. One unknown root
    // would emit `state.foo` for a property that doesn't exist and fail the
    // whole build — a literal render is the safer failure for those.
    private static func tokensResolve(in text: String, variableTypes: [String: VariableType]) -> Bool {
        var remainder = Substring(text)
        var sawToken = false
        while let open = remainder.range(of: "{{") {
            remainder = remainder[open.upperBound...]
            guard let close = remainder.range(of: "}}") else { return false }
            let token = remainder[remainder.startIndex..<close.lowerBound].trimmingCharacters(in: .whitespaces)
            remainder = remainder[close.upperBound...]
            guard !token.isEmpty else { return false }
            sawToken = true
            let root = token.split(separator: ".").first.map(String.init) ?? token
            let reserved = ["uid", "userid", "currentuserid", "now", "timestamp", "createdat"]
            if reserved.contains(root.lowercased()) { continue }
            if variableTypes[root] == nil, variableTypes[swiftIdentifier(root, fallback: "value")] == nil {
                return false
            }
        }
        return sawToken
    }

    // Turns "Hello {{name}}!" into a real Swift string interpolation
    // ("Hello \(state.name)!") so {{variable}} placeholders in alert copy,
    // log messages, URLs etc. read live state instead of printing literally.
    private static func swiftInterpolatedString(_ raw: String, variableTypes: [String: VariableType]) -> String {
        guard raw.contains("{{") else { return swiftString(raw) }
        var result = ""
        var remainder = Substring(raw)
        while let openRange = remainder.range(of: "{{") {
            result += swiftEscaped(String(remainder[remainder.startIndex..<openRange.lowerBound]))
            remainder = remainder[openRange.upperBound...]
            guard let closeRange = remainder.range(of: "}}") else {
                result += "{{" + swiftEscaped(String(remainder))
                remainder = ""
                break
            }
            let varName = String(remainder[remainder.startIndex..<closeRange.lowerBound]).trimmingCharacters(in: .whitespaces)

            // Reserved tokens. Without these, "{{uid}}" compiled to `state.uid`
            // — a variable nobody declares — so a profile document would be
            // keyed by nothing at all. The signed-in user's UID is the only
            // correct key for users/{id}: an email is mutable and is PII in a
            // document path.
            switch varName.lowercased() {
            case "uid", "userid", "currentuserid":
                result += "\\(state.currentUserId)"
                remainder = remainder[closeRange.upperBound...]
                continue
            case "now", "timestamp", "createdat":
                result += "\\(ISO8601DateFormatter().string(from: Date()))"
                remainder = remainder[closeRange.upperBound...]
                continue
            default:
                break
            }

            // "{{book.title}}" reads a field out of the JSON stored in
            // state.book (repeat-list item context); "{{name}}" stays a
            // plain variable read.
            if let dotIndex = varName.firstIndex(of: ".") {
                let root = String(varName[varName.startIndex..<dotIndex])
                let path = String(varName[varName.index(after: dotIndex)...])
                result += "\\(GeneratedRepeat.resolve(state.\(swiftIdentifier(root, fallback: "value")), \(swiftString(path))))"
            } else if variableTypes[varName] == .array {
                result += "\\(state.\(swiftIdentifier(varName, fallback: "value")).joined(separator: \"\\n\"))"
            } else if variableTypes[varName] == .number {
                // Whole numbers read as "47", not "47.0" — a math problem
                // showing 47.0 × 23.0 gives the answer format away and looks
                // broken. GeneratedNumber.clean lives in GeneratedSupport.
                result += "\\(GeneratedNumber.clean(state.\(swiftIdentifier(varName, fallback: "value"))))"
            } else {
                result += "\\(state.\(swiftIdentifier(varName, fallback: "value")))"
            }
            remainder = remainder[closeRange.upperBound...]
        }
        result += swiftEscaped(String(remainder))
        return "\"\(result)\""
    }

    private static func swiftLiteral(_ raw: String, type: VariableType, variableTypes: [String: VariableType] = [:]) -> String {
        switch type {
        case .number:
            // "{{seconds}}" must become a real numeric read, not literal
            // braces — that compiled as `state.x = {{seconds}}` and broke
            // every exported flow that copies one number variable to another.
            if raw.contains("{{") {
                return "(Double(\(swiftInterpolatedString(raw, variableTypes: variableTypes))) ?? 0)"
            }
            return raw.isEmpty ? "0" : raw
        case .boolean:
            if raw.contains("{{") {
                return "(\(swiftInterpolatedString(raw, variableTypes: variableTypes)) == \"true\")"
            }
            return raw == "true" ? "true" : "false"
        case .array:
            return "[]"
        case .optional:
            return raw.isEmpty ? "nil" : swiftInterpolatedString(raw, variableTypes: variableTypes)
        case .json, .string:
            return swiftInterpolatedString(raw, variableTypes: variableTypes)
        }
    }

    private static func boundText(_ node: DesignNode) -> String? {
        guard let binding = node.logicBindings?.first(where: { $0.kind == .text }) else { return nil }
        return "String(describing: state.\(swiftIdentifier(binding.variableName, fallback: "value")))"
    }

    /// True when a text input should render as a SecureField. Explicit
    /// `isSecure` wins; otherwise a field bound to (or named like) a password is
    /// treated as secure so existing designs stop leaking passwords on screen.
    private static func isSecureInput(_ node: DesignNode) -> Bool {
        if node.isSecure == true { return true }
        let bound = node.logicBindings?.compactMap { $0.variableName } ?? []
        let haystack = ([node.name, node.text] + bound).compactMap { $0 }.joined(separator: " ")
        return looksSensitive(haystack)
    }

    /// A name that names a secret. Used both to hide the field and to keep the
    /// value OUT of on-disk persistence.
    private static func looksSensitive(_ text: String) -> Bool {
        let lower = text.lowercased()
        return ["password", "passcode", "pwd", "secret", "pin", "cvv", "otp", "token"].contains { lower.contains($0) }
            || text.contains("סיסמ")
    }

    private static func binding(for node: DesignNode, variableTypes: [String: VariableType]) -> String? {
        guard let binding = node.logicBindings?.first(where: { $0.kind == .value || $0.kind == .text }) else { return nil }
        let name = swiftIdentifier(binding.variableName, fallback: "value")
        switch variableTypes[binding.variableName] ?? .string {
        case .string, .json:
            return "$state.\(name)"
        case .optional:
            return "Binding(get: { state.\(name) ?? \"\" }, set: { state.\(name) = $0 })"
        case .number:
            return "Binding(get: { String(state.\(name)) }, set: { state.\(name) = Double($0) ?? state.\(name) })"
        case .boolean:
            return "Binding(get: { state.\(name) ? \"true\" : \"false\" }, set: { state.\(name) = ($0 == \"true\") })"
        case .array:
            return "Binding(get: { state.\(name).joined(separator: \", \") }, set: { state.\(name) = $0.split(separator: \",\").map { String($0).trimmingCharacters(in: .whitespaces) } })"
        }
    }

    private static func imageExpression(for node: DesignNode, imageAssets: [String: String]) -> String {
        let source = [node.imageSource, node.imageName].compactMap { $0 }.first ?? ""
        if let fileName = imageAssets[source] {
            return "GeneratedImage(resourceName: \(swiftString(fileName))).scaledToFill()"
        }
        if source.hasPrefix("http://") || source.hasPrefix("https://") {
            return "AsyncImage(url: URL(string: \(swiftString(source)))) { image in image.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.2) }"
        }
        return "Color.gray.opacity(0.2)"
    }

    private static func scrollContentSize(for node: DesignNode) -> CGSize {
        let maxX = node.children.map { $0.x + $0.width }.max() ?? node.width
        let maxY = node.children.map { $0.y + $0.height }.max() ?? node.height
        return CGSize(width: max(node.width, maxX), height: max(node.height, maxY))
    }

    private static func scrollOffset(for behavior: ScrollBehavior) -> CGPoint {
        let initialOffset = behavior.initialOffset ?? 0
        switch behavior.axis {
        case "horizontal":
            return CGPoint(x: -initialOffset, y: 0)
        case "both":
            return CGPoint(x: -initialOffset, y: -initialOffset)
        default:
            return CGPoint(x: 0, y: -initialOffset)
        }
    }

    private static func swiftScrollAxes(_ axis: String) -> String {
        switch axis {
        case "horizontal":
            return ".horizontal"
        case "both":
            return "[.horizontal, .vertical]"
        default:
            return ".vertical"
        }
    }

    private static func shapeStyleExpression(fill: String, gradient: GradientStyle?, width: CGFloat, height: CGFloat) -> String {
        guard let gradient, !gradient.colors.isEmpty else {
            return "Color(hex: \"\(fill)\")"
        }

        let colors = gradient.colors.map { "Color(hex: \(swiftString($0)))" }.joined(separator: ", ")
        if gradient.type == "radial" {
            let radius = Int(max(width, height) / 2)
            return "RadialGradient(gradient: Gradient(colors: [\(colors)]), center: .center, startRadius: 0, endRadius: \(max(radius, 1)))"
        }

        let angle = Int(gradient.angle ?? 180)
        return "LinearGradient(gradient: Gradient(colors: [\(colors)]), startPoint: UnitPoint(x: CGFloat(0.5 - cos(Angle(degrees: Double(\(angle))).radians) / 2), y: CGFloat(0.5 - sin(Angle(degrees: Double(\(angle))).radians) / 2)), endPoint: UnitPoint(x: CGFloat(0.5 + cos(Angle(degrees: Double(\(angle))).radians) / 2), y: CGFloat(0.5 + sin(Angle(degrees: Double(\(angle))).radians) / 2)))"
    }

    private static func preFrameModifiers(for node: DesignNode, dynamic: Set<DynamicNodeProperty>, nodeId: UUID) -> String {
        var modifiers: [String] = []

        switch node.type {
        case .Text, .Button, .Input, .Icon:
            if dynamic.contains(.textColor) {
                modifiers.append(".foregroundColor(Color(hex: state.\(dynamicVarName(nodeId, .textColor))))")
            } else if let textColor = node.style.textColor {
                modifiers.append(".foregroundColor(Color(hex: \"\(textColor)\"))")
            }
            if let fontSize = node.style.fontSize {
                let weight = swiftFontWeight(node.style.fontWeight)
                modifiers.append(".font(.system(size: \(Int(fontSize)), weight: \(weight)))")
            }
            if let letterSpacing = node.style.letterSpacing, letterSpacing != 0 {
                modifiers.append(".tracking(\(Int(letterSpacing)))")
            }
            if let lineHeight = node.style.lineHeight, let fontSize = node.style.fontSize {
                modifiers.append(".lineSpacing(\(max(0, Int(lineHeight - fontSize))))")
            }
            // Match the designer's TextBehavior in the shipped SwiftUI view.
            // Without these modifiers, SwiftUI compresses fixed-height text
            // nodes to one line and adds an ellipsis even when the canvas was
            // explicitly configured for two-line wrapping.
            if node.type == .Text {
                if let maxLines = node.textBehavior?.maxLines {
                    modifiers.append(".lineLimit(\(max(1, maxLines)))")
                }
                if node.textBehavior?.autoHeight == true || node.textBehavior?.wrap == true {
                    modifiers.append(".fixedSize(horizontal: false, vertical: true)")
                } else if node.textBehavior?.truncate == false {
                    modifiers.append(".minimumScaleFactor(0.72)")
                    modifiers.append(".allowsTightening(true)")
                }
            }
        default:
            break
        }

        if let textAlign = node.style.textAlign {
            modifiers.append(".multilineTextAlignment(\(swiftTextAlignment(textAlign)))")
        } else if let text = node.text, text.unicodeScalars.contains(where: { (0x0590...0x05FF).contains($0.value) }) {
            // Hebrew (or any RTL script here) with no explicit alignment:
            // right-align, matching how the text reads. Left-aligned Hebrew
            // is the fastest way for a generated app to look foreign.
            modifiers.append(".multilineTextAlignment(.trailing)")
            modifiers.append(".frame(maxWidth: .infinity, alignment: .trailing)")
        }

        return modifiers.isEmpty ? "" : modifiers.joined(separator: "\n")
    }

    private static func postFrameModifiers(for node: DesignNode, dynamic: Set<DynamicNodeProperty>, nodeId: UUID) -> String {
        var modifiers: [String] = []

        if node.type == .Frame {
            let fill = dynamic.contains(.fill)
                ? "Color(hex: state.\(dynamicVarName(nodeId, .fill)))"
                : shapeStyleExpression(fill: node.style.fill, gradient: node.style.gradient, width: node.width, height: node.height)
            modifiers.append(".background(RoundedRectangle(cornerRadius: \(Int(node.style.cornerRadius))).fill(\(fill)))")
        }

        if node.type == .Button || node.type == .Input {
            let fill = dynamic.contains(.fill)
                ? "Color(hex: state.\(dynamicVarName(nodeId, .fill)))"
                : shapeStyleExpression(fill: node.style.fill, gradient: node.style.gradient, width: node.width, height: node.height)
            modifiers.append(".background(RoundedRectangle(cornerRadius: \(Int(node.style.cornerRadius))).fill(\(fill)))")
            modifiers.append(".clipShape(RoundedRectangle(cornerRadius: \(Int(node.style.cornerRadius))))")
        }

        if node.type == .Image || node.clipContent == true {
            modifiers.append(".clipShape(RoundedRectangle(cornerRadius: \(Int(node.style.cornerRadius))))")
        }

        if let stroke = node.style.stroke, let strokeWidth = node.style.strokeWidth, strokeWidth > 0 {
            modifiers.append(".overlay(RoundedRectangle(cornerRadius: \(Int(node.style.cornerRadius))).stroke(Color(hex: \"\(stroke)\"), lineWidth: \(Int(strokeWidth))))")
        }

        // Skip the static literal when opacity is dynamic — nodeViews already
        // appends a `.opacity(state.___)` modifier seeded with this same
        // value, and SwiftUI's opacity modifiers compose multiplicatively,
        // so emitting both would double-darken the node.
        if node.style.opacity < 1, !dynamic.contains(.opacityChannel) {
            modifiers.append(".opacity(\(node.style.opacity))")
        }

        if let shadow = node.style.shadow, shadow.opacity > 0, shadow.radius > 0 {
            modifiers.append(".shadow(color: Color(hex: \"\(shadow.color)\").opacity(\(shadow.opacity)), radius: \(Int(shadow.radius)), x: \(Int(shadow.x)), y: \(Int(shadow.y)))")
        }

        return modifiers.isEmpty ? "" : modifiers.joined(separator: "\n")
    }

    private static func swiftTextAlignment(_ raw: String) -> String {
        switch raw.lowercased() {
        case "center": return ".center"
        case "right", "trailing": return ".trailing"
        default: return ".leading"
        }
    }

    private static func swiftFrameAlignment(for node: DesignNode) -> String {
        guard node.type == .Text else { return ".center" }
        switch node.style.textAlign?.lowercased() {
        case "center":
            return ".top"
        case "right", "trailing":
            return ".topTrailing"
        default:
            return ".topLeading"
        }
    }

    private static func generatedImageSource(appName: String) -> String {
        """
        // Resolves the resource bundle in both build contexts: the SwiftPM
        // resource bundle when built with `swift build` / Xcode package
        // schemes, or the app bundle itself when the sources are compiled
        // directly into an .app (e.g. the in-app simulator runner).
        enum GeneratedResources {
            static let bundle: Bundle = {
                if let url = Bundle.main.resourceURL?.appendingPathComponent("\(appName)_\(appName).bundle"),
                   let bundle = Bundle(url: url) {
                    return bundle
                }
                return Bundle.main
            }()
        }

        struct GeneratedImage: View {
            let resourceName: String

            var body: some View {
                #if canImport(UIKit)
                if let url = GeneratedResources.bundle.url(forResource: resourceName, withExtension: nil),
                   let image = UIImage(contentsOfFile: url.path) {
                    Image(uiImage: image).resizable()
                } else {
                    Color.gray.opacity(0.2)
                }
                #elseif canImport(AppKit)
                if let url = GeneratedResources.bundle.url(forResource: resourceName, withExtension: nil),
                   let image = NSImage(contentsOf: url) {
                    Image(nsImage: image).resizable()
                } else {
                    Color.gray.opacity(0.2)
                }
                #else
                Color.gray.opacity(0.2)
                #endif
            }
        }
        """
    }

    private static func swiftFontWeight(_ raw: String?) -> String {
        switch raw?.lowercased() {
        case "bold", "700": return ".bold"
        case "semibold", "600": return ".semibold"
        case "medium", "500": return ".medium"
        case "light", "300": return ".light"
        default: return ".regular"
        }
    }

    // flow.name/event.label are free-text — two flows can easily collide
    // (e.g. both left at the default "Flow 24" name with a generic "On Tap"
    // event label), which previously generated two identically-named Swift
    // functions and broke the build with "ambiguous use of ...()". event.id
    // is always unique, so folding a slice of it in guarantees the name
    // never collides — and since every call site (declaration in
    // actionsSource, invocation in eventCalls) derives the name from this
    // same pure function of (flow, event), they always agree with no need
    // to thread a shared naming table through the whole exporter.
    private static func actionFunctionName(flow: LogicFlow, event: LogicBlock) -> String {
        let readable = swiftIdentifier(flow.name + event.label, fallback: "Flow")
        let suffix = event.id.uuidString.split(separator: "-").first ?? ""
        return "run\(readable)_\(suffix)"
    }

    private static func screenKey(_ screen: DesignNode) -> String {
        swiftIdentifier(screen.name, fallback: "Screen")
    }

    private static func variableReference(_ block: LogicBlock, key: String) -> String? {
        block.parameters.first { $0.key == key }?.variableReference
    }

    private static func nodeReference(_ block: LogicBlock, key: String) -> UUID? {
        block.parameters.first { $0.key == key }?.nodeReference
    }

    private static func paramValue(_ block: LogicBlock, _ key: String) -> String? {
        block.parameters.first { $0.key == key }?.value
    }

    private static func swiftIdentifier(_ raw: String, fallback: String) -> String {
        let parts = raw.components(separatedBy: CharacterSet.alphanumerics.inverted).filter { !$0.isEmpty }
        let joined = parts.enumerated().map { index, part in
            index == 0 ? part : part.prefix(1).uppercased() + part.dropFirst()
        }.joined()
        let candidate = joined.isEmpty ? fallback : joined
        return candidate.first?.isNumber == true ? "\(fallback)\(candidate)" : candidate
    }

    private static func swiftType(for type: VariableType) -> String {
        switch type {
        case .number: return "Double"
        case .boolean: return "Bool"
        case .array: return "[String]"
        case .json: return "String"
        case .optional: return "String?"
        case .string: return "String"
        }
    }

    private static func swiftDefault(for variable: LogicVariable) -> String {
        guard let value = variable.defaultValue, !value.isEmpty else {
            switch variable.type {
            case .number: return "0"
            case .boolean: return "false"
            case .array: return "[]"
            case .json: return "\"{}\""
            case .optional: return "nil"
            case .string: return "\"\""
            }
        }
        switch variable.type {
        case .number: return value
        case .boolean: return value == "true" ? "true" : "false"
        case .array: return "[]"
        case .optional: return swiftString(value)
        case .json, .string: return swiftString(value)
        }
    }

    private static func swiftString(_ raw: String) -> String {
        "\"\(swiftEscaped(raw))\""
    }

    private static func swiftEscaped(_ raw: String) -> String {
        raw
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
    }

    private static func indent(_ text: String, spaces: Int) -> String {
        let prefix = String(repeating: " ", count: spaces)
        return text.split(separator: "\n", omittingEmptySubsequences: false).map { prefix + $0 }.joined(separator: "\n")
    }
}
