//
//  MCPServerController.swift
//  AgenticDesigner
//
//  Lifecycle + tool registry for the embedded MCP server. Owns the port and
//  on/off state (persisted in UserDefaults), defines the tools external
//  agents can call, and bridges each call onto the design/logic view models
//  on the main actor.
//

import Foundation
import SwiftUI
import AppKit
import PDFKit
import Combine

struct MCPCallLogEntry: Identifiable {
    let id = UUID()
    let date: Date
    let message: String
}

private enum MCPLogicActionType: String {
    case createFlow
    case createBlock
    case connectBlocks
    case updateParameter
    case createVariable
    case updateVariable
    case deleteBlock
    case deleteFlow
}

@MainActor
final class MCPServerController: ObservableObject {

    @Published private(set) var isRunning = false
    @Published var lastError: String?
    @Published private(set) var callLog: [MCPCallLogEntry] = []
    // The inside-agent loop currently running via the run_agent_loop MCP tool,
    // published so the chat panel can mirror its live plan/transcript — an
    // externally-delegated run must be as visible as one started in the panel.
    @Published var activeAgentLoop: AgentToolLoop?
    @Published var port: UInt16 {
        didSet { UserDefaults.standard.set(Int(port), forKey: Self.portKey) }
    }

    weak var designViewModel: ProjectViewModel?
    weak var logicViewModel: LogicViewModel?
    weak var previewSimulator: LogicSimulator?
    weak var pdfViewModel: PDFEditorViewModel?

    private var server: MCPServer?
    // Serializes run_design_agent calls — one pipeline run at a time.
    private var isAgentPipelineRunning = false
    private static let portKey = "mcpServerPort"
    private static let enabledKey = "mcpServerEnabled"

    init() {
        // AGENTIC_MCP_PORT lets a second app instance run its own server
        // (parallel automation across two documents) — env beats the stored
        // setting because UserDefaults is shared between instances.
        if let envPort = ProcessInfo.processInfo.environment["AGENTIC_MCP_PORT"].flatMap(Int.init),
           (1024...65535).contains(envPort) {
            port = UInt16(envPort)
        } else {
            let storedPort = UserDefaults.standard.integer(forKey: Self.portKey)
            port = (1024...65535).contains(storedPort) ? UInt16(storedPort) : 8765
        }
    }

    var endpointURL: String { "http://127.0.0.1:\(port)/mcp" }

    var claudeCodeCommand: String {
        "claude mcp add --transport http agenticdesigner \(endpointURL)"
    }

    // Re-enables the server on launch when it was on last session.
    func attach(design: ProjectViewModel, logic: LogicViewModel, simulator: LogicSimulator? = nil, pdf: PDFEditorViewModel? = nil) {
        designViewModel = design
        logicViewModel = logic
        previewSimulator = simulator
        pdfViewModel = pdf

        // An explicit AGENTIC_MCP_PORT is itself the request to serve —
        // automation must not depend on a stored flag that a force-killed
        // session may never have flushed.
        let forcedByEnvironment = ProcessInfo.processInfo.environment["AGENTIC_MCP_PORT"] != nil
        if UserDefaults.standard.bool(forKey: Self.enabledKey) || forcedByEnvironment, !isRunning, server == nil {
            start()
        }
    }

    func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: Self.enabledKey)
        if enabled {
            start()
        } else {
            stop()
        }
    }

    func start() {
        guard server == nil else { return }
        lastError = nil

        let server = MCPServer(
            configuration: MCPServer.Configuration(
                port: port,
                instructions: """
                AgenticDesigner is a macOS visual app-design tool with a logic block editor AND a \
                real iOS/watchOS exporter.

                DESIGN: get_project_overview → get_design_tree (node ids) → apply_design_actions \
                (applies your x/y exactly; createImage with an imagePrompt generates real AI \
                images). Or delegate: run_design_agent / build_full_app runs the full pipeline from \
                a brief. Call get_screenshot after changes.

                ACCOUNTS + DATA: build_full_app already wires a real backend (Firebase Auth sign-up \
                / log-in / launch gate, a users/{uid} profile document, and per-user Firestore \
                read+write of the app's main entity, with matching security rules). On a design that \
                doesn't have it yet, call wire_backend — deterministic, no AI call. Then \
                set_firebase_config with the Firebase console's projectId / apiKey / appId / \
                messagingSenderId: that is what lets export_xcode_project generate a working \
                GoogleService-Info.plist. Without those four the exported app builds and then traps \
                on launch, so treat them as part of the build, not an afterthought.

                PRODUCT-TRUTH DISCIPLINE — how work is judged here: a screen that LOOKS like an app \
                is NOT an app. Every capability must pass four layers: (1) UI exists, (2) UI is \
                bound to state + logic, (3) logic exports to native code, (4) the exported project \
                builds and runs. Never declare done from a mockup, a preview, or an "Applied \
                successfully" message. After changes, verify: read flows/bindings back, run \
                check_export_readiness (the truth check — resolve every code-level blocker, never \
                hide one), export with export_xcode_project, then build and launch. Always separate \
                what is: implemented / compiled / simulator-verified / needs a device or credentials.

                For the full production build method, invoke the `build_production_app` prompt or \
                call the get_build_methodology tool.
                """
            ),
            tools: makeTools(),
            prompts: Self.makePrompts(),
            log: { [weak self] message in
                Task { @MainActor in
                    self?.appendLog(message)
                }
            }
        )

        do {
            try server.start { [weak self] running, error in
                Task { @MainActor in
                    guard let self else { return }
                    self.isRunning = running
                    if running {
                        self.bindRetriesRemaining = Self.maxBindRetries
                    }
                    if let error {
                        self.lastError = error
                        self.server = nil
                        self.retryStartIfNeeded()
                    }
                }
            }
            self.server = server
        } catch {
            lastError = error.localizedDescription
            appendLog("🔌 MCP: could not start — \(error.localizedDescription)")
            retryStartIfNeeded()
        }
    }

    // A bind failure at launch is usually a previous app instance still
    // holding the port. Without retries, that stale instance quitting later
    // leaves THIS instance's MCP off until the user manually toggles it —
    // so keep retrying for a while as long as the server should be on.
    private var bindRetriesRemaining = MCPServerController.maxBindRetries
    private static let maxBindRetries = 30

    private func retryStartIfNeeded() {
        guard UserDefaults.standard.bool(forKey: Self.enabledKey), bindRetriesRemaining > 0 else { return }
        bindRetriesRemaining -= 1
        appendLog("🔌 MCP: retrying start in 2s (\(bindRetriesRemaining) attempts left)")
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            guard let self, self.server == nil, UserDefaults.standard.bool(forKey: Self.enabledKey) else { return }
            self.start()
        }
    }

    func stop() {
        server?.stop()
        server = nil
        isRunning = false
    }

    private func appendLog(_ message: String) {
        print(message)
        callLog.append(MCPCallLogEntry(date: Date(), message: message))
        if callLog.count > 200 {
            callLog.removeFirst(callLog.count - 200)
        }
    }

    // MARK: - Tool registry

    // MARK: - Production build methodology
    // The discipline that makes an app REAL rather than a mockup, offered to
    // every connecting model three ways: server `instructions` (always seen),
    // the `build_production_app` MCP prompt (client-surfaced template), and the
    // get_build_methodology tool (self-serve fallback / mid-task reference).

    static func buildMethodology(appName: String = "[APP_NAME]",
                                 bundleId: String = "[BUNDLE_ID]",
                                 platforms: String = "iPhone, appleWatch",
                                 backend: String = "[Firebase / Supabase]",
                                 brand: String = "[BRAND / ACCENT]",
                                 sensors: String = "[location, speed, distance, heart rate]",
                                 screens: String = "[LIST]") -> String {
        """
        You are building a PRODUCTION-oriented app using AgenticDesigner via MCP.

        CORE PRINCIPLE: a screen that LOOKS like an app is not an app. Every capability must pass
        four layers, and you must prove each: (1) UI exists → (2) UI is bound to state + logic →
        (3) logic exports to native code → (4) the exported project builds and runs.

        HARD CONSTRAINTS
        1. Make all product/design/logic changes ONLY through AgenticDesigner MCP tools.
        2. Do NOT hand-edit generated Swift, JSON, pbxproj, Info.plist or exported source.
        3. Shell tools are for READ-ONLY inspection, build, install, launch, simulator verification.
        4. Never declare success from a mockup, preview, or an "Applied successfully" message.
        5. Preserve the existing design unless a change is required for functionality.
        6. Never hide a blocker. Always separate: implemented logic / compiled functionality /
           simulator-verified / physical-device-only / missing external credentials.

        PRODUCT INPUTS
        App name: \(appName)   Bundle id: \(bundleId)   Platforms: \(platforms)
        Brand: \(brand)   Backend: \(backend)   Sensors: \(sensors)   Screens: \(screens)

        PHASE 1 — ORIENT: load newest project; get_project_overview; read design tree, flows,
        variables, platforms; DISCOVER the current MCP tool list (don't trust an older schema);
        checkpoint before destructive changes. Identify fake data, hardcoded metrics, unbound
        inputs, unbound triggers, missing permissions, missing platform routing, backend calls
        with no user identity.

        PHASE 2 — STATE MODEL: explicit variables for auth fields, current-user UID, sensor
        readings, derived metrics, alert thresholds, alert-dedup flags, query results. Every input
        field gets a two-way binding; every output text reads the right variable; sensitive
        variables are detected and EXCLUDED from persistence.

        PHASE 3 — AUTH + PERSISTENCE: call wire_backend first — one deterministic pass gives you the
        launch gate, log in, sign up + users/{uid} profile write, log out, password reset, and
        per-user Firestore read/write of the main entity (it creates Log In / Sign Up screens only if
        the design lacks them). Then set_firebase_config with projectId + apiKey + appId +
        messagingSenderId so the export can write GoogleService-Info.plist. Extend by hand from
        there (email/password validation before the call, confirm-password, provider buttons). VERIFY
        the generated backend calls read state variables, not empty literals or unresolved node
        references (a common trap), and that the UID — not the email — keys every document.

        PHASE 4 — SENSORS: Start → request permission → start NATIVE continuous tracking →
        distanceMeters/speedKmh. Derive km, pace, average. Delete fake timer/GPS math. Finish →
        stop → summarize → save users/{uid}/runs → Summary.

        PHASE 5 — ALERTS: per alert = threshold variable + condition + a boolean that blocks repeat
        firing each tick + reset at session start + in-app alert/haptic/notification.

        PHASE 6 — APPLE WATCH: enable appleWatch; on launch route watchOS to the Watch screen via a
        Platform condition (both targets otherwise start on the same screen). Workout = Health +
        Location permission → native GPS → HKWorkoutSession → heart rate → sync via
        WatchConnectivity → end + save. A responsive iPhone screen is NOT a watch app; require a
        real embedded watchOS target in the Xcode export.

        PHASE 7 — SECURITY: password/passcode/PIN/token inputs export as SecureField; sensitive
        variables absent from persisted snapshots; UID captured before Firestore writes; Firestore
        paths user-scoped; permissions progressive; no fake private/history data; security rules
        generated (and need deployment).

        PHASE 8 — IDENTITY: via MCP set product name, bundle id, platforms; preserve brand; generate
        AppIcon assets.

        PHASE 9 — TRUTH CHECK: run check_export_readiness; resolve every code-level blocker via MCP;
        do NOT suppress or reinterpret blockers. GoogleService-Info.plist is NOT an external blocker
        any more — it is generated from set_firebase_config, so missing credentials are yours to fix.
        Expected EXTERNAL blockers: signing team, console-side sign-in methods + rules deployment,
        push server, billing, physical-device sensor testing.

        PHASE 10 — EXPORT & BUILD: use export_xcode_project (not only SwiftPM). Verify the .xcodeproj,
        iOS target, embedded watchOS target, bundle ids, AppIcon, and Firebase deps/bootstrap when
        enabled. Run a clean xcodebuild WITHOUT disabling AppIcon requirements. Do not patch
        generated source to make the build pass.

        PHASE 11 — RUNTIME: install + launch iPhone app in an iOS simulator and the Watch app in a
        watchOS simulator; verify each starts on the intended screen; screenshot; check for crashes.

        FINAL REPORT (separate, honest): 1) implemented via MCP, 2) cleanly compiled, 3) launched,
        4) verified only by artifact inspection, 5) needs credentials/devices, 6) exact paths to the
        .agenticdesign project and the .xcodeproj. Never call the app production-ready while a real
        blocker remains.

        THE ONE SENTENCE: don't prove the screen looks right; prove the action travels from UI,
        through state and logic, to native code, to a running binary.
        """
    }

    static func makePrompts() -> [MCPPromptDefinition] {
        [
            MCPPromptDefinition(
                name: "build_production_app",
                description: "The AgenticDesigner method for building a REAL, verified app (not a mockup): four-layer product-truth discipline + an 11-phase plan (orient, state, auth, sensors, alerts, watch, security, identity, truth-check, export/build, runtime).",
                arguments: [
                    MCPPromptArgument(name: "app_name", description: "Product name, e.g. PaceGuard.", required: false),
                    MCPPromptArgument(name: "bundle_id", description: "Reverse-DNS bundle id, e.g. com.acme.paceguard.", required: false),
                    MCPPromptArgument(name: "platforms", description: "e.g. iPhone, appleWatch.", required: false),
                    MCPPromptArgument(name: "backend", description: "Firebase or Supabase.", required: false),
                    MCPPromptArgument(name: "brand", description: "Brand name / accent hex.", required: false),
                    MCPPromptArgument(name: "sensors", description: "e.g. location, speed, distance, heart rate.", required: false),
                    MCPPromptArgument(name: "screens", description: "Required screens, comma-separated.", required: false)
                ],
                build: { args in
                    buildMethodology(
                        appName: args["app_name"] ?? "[APP_NAME]",
                        bundleId: args["bundle_id"] ?? "[BUNDLE_ID]",
                        platforms: args["platforms"] ?? "iPhone, appleWatch",
                        backend: args["backend"] ?? "[Firebase / Supabase]",
                        brand: args["brand"] ?? "[BRAND / ACCENT]",
                        sensors: args["sensors"] ?? "[location, speed, distance, heart rate]",
                        screens: args["screens"] ?? "[LIST]"
                    )
                }
            )
        ]
    }

    /// Small local models get the SHAPE of a tool argument wrong far more often
    /// than the content: an array arrives as a JSON string, or a single object
    /// arrives unwrapped. Rejecting those outright makes the agent loop retry
    /// the identical malformed call forever, so accept anything that can be
    /// read as "a list of objects" — the same leniency ComposedAppGenerator
    /// already needed for the same reason.
    static func coercedObjectArray(_ value: Any?) -> [Any]? {
        switch value {
        case let array as [Any]:
            return array
        case let single as [String: Any]:
            // One action sent unwrapped.
            return [single]
        case let text as String:
            // The whole array serialized as a string. Models that do this also
            // tend to mis-quote inside it — observed in real runs:
            //   "y:670"        instead of "y":670
            //   "x:140,        instead of "x":140,
            //   "fontSize:24,  instead of "fontSize":24,
            // and sometimes the string is simply cut off mid-object. Each of
            // those used to cost a whole wasted step, so repair then salvage.
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if let data = trimmed.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) {
                return coercedObjectArray(parsed)
            }
            let repaired = repairedJSONText(trimmed)
            if let data = repaired.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) {
                return coercedObjectArray(parsed)
            }
            // Last resort: keep the objects that ARE complete and drop the
            // truncated tail, so a cut-off response still lands most of its work.
            return salvagedObjects(from: repaired)
        default:
            return nil
        }
    }

    /// Normalizes the two shapes real tool-calling models commonly emit for
    /// composition: the documented `{type, props:{...}}` shape and a flattened
    /// `{type, title, subtitle, ...}` shape. Gemini Flash also sometimes calls a
    /// screen `title` instead of `name`, or emits chip/action arrays rather than
    /// comma-separated strings. Accept all of those without losing the model's
    /// actual product copy — falling back to ComponentFactory defaults is what
    /// made an otherwise thoughtful composition render as generic placeholders.
    static func normalizedCompositionArguments(_ args: [String: Any]) -> [String: Any]? {
        guard let rawScreens = coercedObjectArray(args["screens"]), !rawScreens.isEmpty else { return nil }
        var normalizedScreens: [[String: Any]] = []

        for (screenIndex, rawScreen) in rawScreens.enumerated() {
            guard var screen = rawScreen as? [String: Any] else { continue }
            let suppliedName = looseString(screen["name"])
                ?? looseString(screen["title"])
                ?? looseString(screen["id"])
            let name = suppliedName?.trimmingCharacters(in: .whitespacesAndNewlines)
            screen["name"] = (name?.isEmpty == false ? name : nil) ?? "Screen \(screenIndex + 1)"

            let rawComponents = coercedObjectArray(screen["components"]) ?? []
            var normalizedComponents: [[String: Any]] = []
            for rawComponent in rawComponents {
                guard let component = rawComponent as? [String: Any],
                      let type = looseString(component["type"]), !type.isEmpty else { continue }

                var props: [String: String] = [:]
                var rawNestedProps: [String: Any] = [:]
                if let nested = component["props"] as? [String: Any] {
                    rawNestedProps = nested
                    for (key, value) in nested {
                        if let string = looseString(value) { props[key] = string }
                    }
                } else if let nested = component["props"] as? [String: String] {
                    props.merge(nested) { _, new in new }
                }
                for (key, value) in component where !["type", "props"].contains(key) {
                    if let string = looseString(value) { props[key] = string }
                }

                // Preserve structured list payloads instead of collapsing them
                // to titles. TransactionList consumes itemNTitle/subtitle/
                // amount/icon; quick actions consume the first/second labels.
                let collection = component["items"] ?? component["actions"]
                    ?? rawNestedProps["items"] ?? rawNestedProps["actions"]
                if let values = collection as? [Any] {
                    let ordinals = ["first", "second", "third", "fourth"]
                    for (itemIndex, value) in values.prefix(4).enumerated() {
                        let number = itemIndex + 1
                        if let item = value as? [String: Any] {
                            let title = looseString(item["title"]) ?? looseString(item["label"])
                                ?? looseString(item["name"]) ?? looseString(item["value"])
                            if let title {
                                props["item\(number)Title"] = title
                                props[ordinals[itemIndex]] = title
                            }
                            if let subtitle = looseString(item["subtitle"] ?? item["description"] ?? item["meta"]) {
                                props["item\(number)Subtitle"] = subtitle
                            }
                            if let amount = looseString(item["amount"] ?? item["value"] ?? item["metric"]) {
                                props["item\(number)Amount"] = amount
                            }
                            if let icon = looseString(item["icon"] ?? item["iconName"]) {
                                props["item\(number)Icon"] = icon
                            }
                        } else if let title = looseString(value) {
                            props["item\(number)Title"] = title
                            props[ordinals[itemIndex]] = title
                        }
                    }
                }

                if props["items"] == nil {
                    props["items"] = props["options"] ?? props["actions"] ?? props["categories"]
                }
                if props["subtitle"] == nil {
                    props["subtitle"] = props["body"] ?? props["description"]
                }
                if props["description"] == nil { props["description"] = props["body"] }
                if props["label"] == nil { props["label"] = props["buttonText"] ?? props["cta"] }
                if props["cta"] == nil { props["cta"] = props["buttonText"] ?? props["label"] }
                if props["image"] == nil { props["image"] = props["imageSource"] ?? props["avatarUrl"] }
                if props["progress"] == nil {
                    props["progress"] = props["value"]
                    if props["progress"] == nil,
                       let current = props["current"].flatMap(Double.init),
                       let target = props["target"].flatMap(Double.init), target > 0 {
                        props["progress"] = "\(Int((current / target * 100).rounded()))%"
                    }
                }

                // Workout-like components often arrive as several semantic
                // facts instead of one subtitle. Preserve all of them in the
                // compact secondary line the component actually renders.
                if props["subtitle"] == nil {
                    let facts = [props["duration"], props["distance"], props["intensity"], props["change"]]
                        .compactMap { $0 }.filter { !$0.isEmpty }
                    if !facts.isEmpty { props["subtitle"] = facts.joined(separator: " • ") }
                }
                normalizedComponents.append(["type": type, "props": props])
            }
            screen["components"] = normalizedComponents
            normalizedScreens.append(screen)
        }

        var normalized = args
        normalized["screens"] = normalizedScreens
        return normalized
    }

    private static func looseString(_ value: Any?) -> String? {
        switch value {
        case let string as String:
            return string
        case let bool as Bool:
            return bool ? "true" : "false"
        case let number as NSNumber:
            return number.stringValue
        case let array as [Any]:
            let values = array.compactMap { item -> String? in
                if let dictionary = item as? [String: Any] {
                    return looseString(dictionary["label"])
                        ?? looseString(dictionary["title"])
                        ?? looseString(dictionary["name"])
                        ?? looseString(dictionary["value"])
                }
                return looseString(item)
            }
            return values.isEmpty ? nil : values.joined(separator: ", ")
        default:
            return nil
        }
    }

    /// Fixes the mis-quoting patterns small models produce inside a stringified
    /// JSON array. Deliberately narrow: only key positions are rewritten, so it
    /// can't corrupt a legitimate string value that happens to contain a colon.
    static func repairedJSONText(_ raw: String) -> String {
        var repaired = raw
        // ORDER MATTERS. The whole-pair rule must run first: otherwise the
        // general rule below rewrites "y:670" into "y":670" and leaves a stray
        // quote, turning a repairable payload into an unrepairable one.
        // "key:123"  →  "key":123     (whole pair wrapped as one string)
        repaired = repaired.replacingOccurrences(
            of: #""([A-Za-z_][A-Za-z0-9_]*):\s*(-?[0-9]+(?:\.[0-9]+)?)""#,
            with: #""$1":$2"#,
            options: .regularExpression
        )
        // "key:value  →  "key":value   (unterminated key, numeric/next value)
        repaired = repaired.replacingOccurrences(
            of: #""([A-Za-z_][A-Za-z0-9_]*):(?=\s*[-0-9tfn\[{])"#,
            with: #""$1":"#,
            options: .regularExpression
        )
        // Trailing commas before a closing container.
        repaired = repaired.replacingOccurrences(
            of: #",\s*([\]\}])"#,
            with: "$1",
            options: .regularExpression
        )
        return repaired
    }

    /// Brace-counting extractor: returns every complete top-level object in a
    /// possibly-truncated array. Mirrors the salvage ComposedAppGenerator uses
    /// for cut-off model output.
    static func salvagedObjects(from text: String) -> [Any]? {
        var objects: [Any] = []
        var depth = 0
        var start: String.Index?
        var inString = false
        var escaped = false

        for index in text.indices {
            let character = text[index]
            if escaped { escaped = false; continue }
            if character == "\\" { escaped = true; continue }
            if character == "\"" { inString.toggle(); continue }
            guard !inString else { continue }

            if character == "{" {
                if depth == 0 { start = index }
                depth += 1
            } else if character == "}" {
                depth -= 1
                if depth == 0, let start {
                    let fragment = String(text[start...index])
                    if let data = fragment.data(using: .utf8),
                       let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        objects.append(object)
                    }
                }
            }
        }
        return objects.isEmpty ? nil : objects
    }

    func makeTools() -> [MCPToolDefinition] {
        [
            MCPToolDefinition(
                name: "get_build_methodology",
                description: "Returns the AgenticDesigner production-build methodology: the four-layer product-truth discipline (a screen that looks like an app is not an app) and the 11-phase plan. Call this to self-orient before building a real app, or mid-task to re-check the standard. Same content as the build_production_app prompt.",
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { _ in .text(Self.buildMethodology()) }
            ),

            MCPToolDefinition(
                name: "get_project_overview",
                description: """
                Overview of the open design project: pages, screens (root frames), node \
                and logic-flow counts, and the active page. Call this first to orient \
                yourself before reading trees or applying actions.
                """,
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { [weak self] _ in
                    guard let viewModel = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    return .text(Self.projectOverviewJSON(viewModel))
                }
            ),

            MCPToolDefinition(
                name: "get_design_tree",
                description: """
                JSON of the design node tree for a page (default: the active page). For a \
                multi-screen app, pass screenNodeId to return one readable subtree instead \
                of a truncated whole-app tree. \
                Node ids from this tree are the nodeId values that update/move/resize/delete \
                actions in apply_design_actions target. Children coordinates are relative \
                to their parent.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": [
                            "type": "integer",
                            "description": "Zero-based page index. Omit for the active page."
                        ],
                        "screenNodeId": [
                            "type": "string",
                            "description": "Optional root screen UUID. Returns only this screen and all descendants, including real CTA/control ids for logic wiring."
                        ]
                    ]
                ],
                handler: { [weak self] args in
                    guard let viewModel = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let page = try Self.page(in: viewModel, at: args["pageIndex"] as? Int)
                    let nodes: [DesignNode]
                    if let rawId = (args["screenNodeId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !rawId.isEmpty {
                        guard let id = UUID(uuidString: rawId),
                              let screen = page.nodes.first(where: { $0.id == id }) else {
                            return .failure("screenNodeId was not a root screen on page \"\(page.name)\". Call get_project_overview for valid ids.")
                        }
                        nodes = [screen]
                    } else {
                        nodes = page.nodes
                    }

                    let encoder = JSONEncoder()
                    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                    let json = String(data: try encoder.encode(nodes), encoding: .utf8) ?? "[]"
                    return .text("Page \"\(page.name)\" — \(nodes.count) returned root node(s):\n\(json)")
                }
            ),

            MCPToolDefinition(
                name: "get_screenshot",
                description: """
                Rendered screenshot of a page's canvas (default: the active page) as a JPEG \
                image. For a multi-screen app, pass each root screen's node id separately so \
                the model can inspect typography, copy and spacing at readable resolution; a \
                zoomed-out whole-canvas mosaic is useful for consistency but is not sufficient \
                visual verification.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": [
                            "type": "integer",
                            "description": "Zero-based page index. Omit for the active page."
                        ],
                        "screenNodeId": [
                            "type": "string",
                            "description": "Optional root screen UUID. When present, render only that screen at full readable resolution. Get ids from get_project_overview."
                        ]
                    ]
                ],
                handler: { [weak self] args in
                    guard let viewModel = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let page = try Self.page(in: viewModel, at: args["pageIndex"] as? Int)
                    let nodes: [DesignNode]
                    if let rawId = (args["screenNodeId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !rawId.isEmpty {
                        guard let id = UUID(uuidString: rawId),
                              let screen = page.nodes.first(where: { $0.id == id }) else {
                            return .failure("screenNodeId was not a root screen on page \"\(page.name)\". Call get_project_overview and use one of its screen node ids.")
                        }
                        nodes = [screen]
                    } else {
                        nodes = page.nodes
                    }

                    guard let dataURL = CanvasSnapshotRenderer.jpegDataURL(for: nodes) else {
                        return .text("The canvas on page \"\(page.name)\" is empty — nothing to render.")
                    }

                    let base64 = dataURL.replacingOccurrences(of: "data:image/jpeg;base64,", with: "")
                    return MCPToolResult(content: [.image(base64: base64, mimeType: "image/jpeg")])
                }
            ),

            MCPToolDefinition(
                name: "compose_reference_app",
                description: """
                PREFERRED NEW-APP DESIGN TOOL. Compose 5-7 production-grade mobile screens through \
                the deterministic component system learned from the local AppShots corpus. The model \
                decides screen purpose, component choice and real product copy; code owns coordinates, \
                spacing, typography, palette tokens and a navigation bar whose labels map to real screens. \
                This is more reliable than hand-authoring hundreds of x/y values and works across weak and \
                strong models. Use one coherent style and one continuous flow. Entry/onboarding screens set \
                bottomBar:false; core destinations set bottomBar:true. Component types include header, \
                avatarGreetingHeader, heroCard, imageHero, searchBar, categoryChips, quickActionRow, \
                contentCard, productGrid, progressRing, workoutCard, statCard, chartCard, transactionList, \
                chatMessage, chatInput, primaryButton and secondaryButton. Follow with get_screenshot, then \
                use apply_design_actions only for targeted differentiation and polish.
                """,
                inputSchema: ComposedAppGenerator.responseSchema,
                handler: { [weak self] args in
                    guard let design = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let normalizedArgs = Self.normalizedCompositionArguments(args),
                          let screens = Self.coercedObjectArray(normalizedArgs["screens"]), screens.count >= 5 else {
                        return .failure("compose_reference_app needs 5-7 purposeful screens in one flow. Provide screens as a real JSON array, not a quoted string.")
                    }
                    guard screens.count <= 8 else {
                        return .failure("Keep the first composition focused: at most 8 screens. Add secondary flows in a later pass.")
                    }
                    for (index, rawScreen) in screens.enumerated() {
                        guard let screen = rawScreen as? [String: Any] else {
                            return .failure("Screen #\(index + 1) must be a JSON object.")
                        }
                        let name = (screen["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                        guard !name.isEmpty else {
                            return .failure("Screen #\(index + 1) needs a specific name.")
                        }
                        let components = Self.coercedObjectArray(screen["components"]) ?? []
                        let hasBottomBar = (screen["bottomBar"] as? Bool)
                            ?? ((screen["bottomBar"] as? String)?.lowercased() == "true")
                        let minimumComponents = hasBottomBar ? 4 : 3
                        guard (minimumComponents...5).contains(components.count) else {
                            return .failure("Screen '\(name)' needs \(minimumComponents)-5 substantial components; received \(components.count). Core destinations need enough content to fill the useful area above navigation.")
                        }
                        let key = name.lowercased()
                        let isCoreDestination = ["home", "today", "progress", "profile", "settings", "feed", "catalog"]
                            .contains { key.contains($0) }
                        if isCoreDestination, !hasBottomBar {
                            return .failure("Screen '\(name)' is a core destination and must set bottomBar:true so global navigation stays consistent.")
                        }
                    }

                    CheckpointStore.save(design.project, label: "before reference composition")
                    let result = try ComposedAppGenerator.applyComposition(jsonObject: normalizedArgs, viewModel: design)
                    let quality = DesignQualityAudit.report(page: design.currentPage)
                    return .text("""
                    Composed \(result.screenCount) reference-grade screen(s) with \(result.actionCount) deterministic action(s) in the \(result.style.rawValue) system.

                    \(DesignQualityAudit.summary(quality))

                    \(Self.projectOverviewJSON(design))
                    """)
                }
            ),

            MCPToolDefinition(
                name: "apply_design_actions",
                description: """
                Apply an array of design actions to the canvas — the same JSON vocabulary the \
                in-app AI agent uses. Action types: createFrame, createText, createButton, \
                createInput, createRectangle, createImage, createIcon (SF Symbol via iconName), \
                createComponent (deterministic registry component via component + props + stylePreset), \
                createPage, updateText, updateStyle, moveNode, resizeNode, scaleNode, \
                setAutoLayout, pinNode, bringToFront, sendToBack, setZIndex, alignChildren, \
                distributeChildren, positionRelativeTo, deleteNode. \
                Creating: give each new node a nodeReference (your own string id) and use \
                parentReference to nest; x/y are relative to the parent. A phone screen is a \
                root createFrame around 390x844. Style fields include fill, stroke, cornerRadius, \
                opacity, fontSize, textColor, fontWeight, textAlign, shadow, gradient, \
                layout ("verticalStack"/"horizontalStack"), spacing, padding. Scroll/recycler \
                containers: set scrollAxis:"vertical"|"horizontal"|"both" on a Frame, plus \
                optional scrollOffset, recycleItemSpacing, recycleItemCount; children remain \
                real nodes and the frame clips/scrolls them. \
                Data-bound repeat lists: set repeatSourceVariable (a logic variable holding a \
                JSON array), repeatItemAlias (default "item"), repeatAxis \
                "vertical"|"horizontal", optional repeatMaxItems and repeatScrollable on a \
                node (createFrame or updateStyle) to clone it once per array item — \
                {{alias.field}} tokens in descendant text resolve per item, every clone is \
                tappable, and a tapped clone stores its item JSON in the alias variable so \
                the wired flow (and the next screen) knows which item was chosen. \
                Updating: target existing nodes via nodeId (UUIDs from get_design_tree). \
                Positioning: by default your x/y/width/height are applied EXACTLY as sent \
                (absolute coordinates, overlaps allowed — design the whole layout yourself \
                and verify with get_screenshot). Pass normalize:true to instead run the \
                app's mobile-layout repair passes, which restack screen children vertically \
                and fix overlaps — useful for rough drafts, destructive for precise layouts. \
                Time picker: createFrame with timePickerHourVariable + timePickerMinuteVariable \
                (string variables) renders native hour:minute wheels bound to those \
                variables — live in preview and exports (crown-driven on watchOS). \
                Image assets: createImage with an imagePrompt (rich text or JSON brief) \
                generates a real AI image and patches it into the node — set assetKind \
                ("hero"/"icon"/"product"/"poster") to steer the art direction; pass \
                generateImages:false to keep gray placeholders instead. \
                Example: {"actions":[{"type":"createFrame","nodeReference":"screen","name":"Home",\
                "x":0,"y":0,"width":390,"height":844,"fill":"#FFFFFF"},{"type":"createText",\
                "parentReference":"screen","text":"Hello","x":24,"y":80,"width":220,"height":34,\
                "fontSize":26,"fontWeight":"bold","textColor":"#111111"},{"type":"createImage",\
                "parentReference":"screen","name":"Hero","x":24,"y":140,"width":342,"height":220,\
                "cornerRadius":24,"imagePrompt":"sunrise mountain trail, editorial","assetKind":"hero"}]}
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "actions": [
                            "type": "array",
                            "description": "DesignAction objects, applied in order.",
                            "items": ["type": "object", "additionalProperties": true]
                        ],
                        "generateImages": [
                            "type": "boolean",
                            "description": "Default true: generate real AI images for createImage actions that carry an imagePrompt. Image generation adds seconds to the call."
                        ],
                        "normalize": [
                            "type": "boolean",
                            "description": "Default false: x/y are respected exactly. True runs the app's layout repair passes (vertical restacking, overlap resolution, text repair) on the whole page after applying."
                        ]
                    ],
                    "required": ["actions"]
                ],
                handler: { [weak self] args in
                    guard let viewModel = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let rawActions = Self.coercedObjectArray(args["actions"]), !rawActions.isEmpty else {
                        return .failure("""
                        'actions' must be a JSON ARRAY, not a string containing JSON, and not empty. \
                        Send it directly: "actions": [{"type":"createText","parentReference":"screenHome","text":"Hello","x":24,"y":80,"width":200,"height":32}]. \
                        If you did send a string, the quoting inside it was broken — the usual mistake is "x:140 instead of "x":140. \
                        Send FEWER actions per call so the JSON stays valid.
                        """)
                    }

                    let data = try JSONSerialization.data(withJSONObject: rawActions)
                    let lossy = try JSONDecoder().decode([LossyDesignAction].self, from: data)
                    let actions = DesignAgentService.ensuringImageReferences(in: lossy.compactMap(\.action))

                    guard !actions.isEmpty else {
                        return .failure("None of the \(rawActions.count) action(s) could be decoded — check the 'type' field and value types.")
                    }

                    let normalize = args["normalize"] as? Bool ?? false
                    let referenceMap = normalize
                        ? viewModel.applyDesignActions(actions)
                        : viewModel.applyDesignActionsExactly(actions)

                    var summary = "Applied \(actions.count) of \(rawActions.count) action(s)\(normalize ? " (with layout normalization)" : " (exact positions)")."
                    if actions.count < rawActions.count {
                        summary += " \(rawActions.count - actions.count) action(s) were skipped as undecodable."
                    }
                    if !referenceMap.isEmpty {
                        let mappings = referenceMap
                            .sorted { $0.key < $1.key }
                            .map { "  \($0.key) → \($0.value.uuidString)" }
                            .joined(separator: "\n")
                        summary += "\nCreated node ids by reference:\n\(mappings)"
                    }

                    // Same asset pipeline the in-app agent runs: every action
                    // with an image prompt becomes a real generated image.
                    let imageActionCount = actions.filter {
                        $0.type == .createImage && DesignAgentService.generatedAssetPrompt(for: $0) != nil
                    }.count

                    if imageActionCount > 0 {
                        let settings = DesignAgentService.Settings.current()

                        if args["generateImages"] as? Bool == false {
                            summary += "\nLeft \(imageActionCount) image node(s) as placeholders (generateImages was false)."
                        } else if let apiKey = settings.resolvedAPIKey() {
                            let provider = OpenRouterProvider(apiKey: apiKey, model: settings.model)
                            let outcome = await DesignAgentService.generateAndPatchImages(
                                for: actions,
                                referenceMap: referenceMap,
                                viewModel: viewModel,
                                provider: provider
                            )
                            summary += "\nGenerated \(outcome.generated) of \(outcome.requested) image asset(s)."
                        } else {
                            summary += "\nSkipped \(imageActionCount) image request(s): no OpenRouter API key is configured in the app's Agent panel."
                        }
                    }

                    // Deterministic criticism, returned with the result of the
                    // very call that caused it. Costs no tokens and no model
                    // round-trip, and unlike a system-prompt rule the agent
                    // cannot quietly ignore it.
                    summary += "\n\n" + DesignQualityAudit.summary(
                        DesignQualityAudit.audit(page: viewModel.currentPage)
                    )
                    summary += "\n\n" + Self.projectOverviewJSON(viewModel)
                    return .text(summary)
                }
            ),

            MCPToolDefinition(
                name: "run_agent_loop",
                description: """
                Delegate a goal to the app's INSIDE agent loop: the in-app model works the \
                design/logic/preview/game tools iteratively (plan → act → screenshot/verify → \
                fix) until done or explicitly cancelled, with checkpoints saved along the way. \
                To prevent runaway spend, cloud runs pause for user approval at each configured \
                cost band (default $0.10). \
                Uses the model configured in the app's Agent panel. Returns the agent's final \
                summary plus its plan state. One loop runs at a time. Prefer driving the \
                granular tools yourself; use this to hand off a whole sub-task.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "goal": ["type": "string", "description": "What to build or change, in product terms."],
                        "model": ["type": "string", "description": "Optional model override (e.g. local/qwen3-vl:32b) — persists as the app's agent model, same as picking it in the panel."],
                        "strictProvider": ["type": "boolean", "description": "When true, fallback may use sibling models from the selected provider but can never switch vendors. Use this for provenance-sensitive validation such as proving a Gemini run."],
                        "strictModel": ["type": "boolean", "description": "When true, use only the exact selected model and disable every fallback, including sibling models from the same provider."],
                        "answers": ["type": "string", "description": "Product decisions you already collected from YOUR user (run analyze_brief to learn which to ask), e.g. 'name: PaceFit; accounts: email sign-in; style: dark premium'. The inner loop honors these instead of asking its own clarifying questions."]
                    ],
                    "required": ["goal"]
                ],
                handler: { [weak self] args in
                    guard let self, self.designViewModel != nil else { throw MCPToolError("Designer is not available.") }
                    guard let goal = (args["goal"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !goal.isEmpty else {
                        return .failure("'goal' is required.")
                    }
                    if let model = args["model"] as? String, !model.isEmpty {
                        UserDefaults.standard.set(model, forKey: "openRouterModel")
                        UserDefaults.standard.set("", forKey: "openRouterGenerationModel")
                    }
                    let loop = AgentToolLoop(mcp: self)
                    let selectedModel = DesignAgentService.Settings.current().model
                    if args["strictModel"] as? Bool == true {
                        loop.requiredModelId = selectedModel
                    } else if args["strictProvider"] as? Bool == true {
                        loop.requiredProviderId = ModelProviderCatalog.route(for: selectedModel).id
                    }
                    // Delegated runs usually have no human at the app window,
                    // so an unanswered clarifying question falls back to its
                    // recommended option quickly instead of hanging this call.
                    // Answer them for real by passing `answers`, or in the
                    // app's Agent panel mirror if someone IS watching.
                    loop.questionTimeoutSeconds = 90
                    if let answers = args["answers"] as? String, !answers.isEmpty {
                        loop.presetAnswers = answers
                    }
                    self.activeAgentLoop = loop
                    let summary = await loop.run(goal: goal)
                    let planState = loop.plan.isEmpty ? "(no plan recorded)" : loop.plan
                        .map { "[\($0.status)] \($0.title)" }
                        .joined(separator: "\n")
                    let toolCallCount = loop.transcript.filter { $0.kind == .tool }.count
                    return .text("""
                    AGENT LOOP RESULT (\(toolCallCount) tool call(s)):
                    \(summary)

                    USAGE: \(loop.runPromptTokens) input token(s), \(loop.runCompletionTokens) output token(s), $\(String(format: "%.4f", loop.runCostUSD))

                    MODEL PROVENANCE: \(loop.usedModelIds.isEmpty ? "(no model response)" : loop.usedModelIds.joined(separator: " → "))

                    PLAN STATE:
                    \(planState)
                    """)
                }
            ),

            MCPToolDefinition(
                name: "list_game_templates",
                description: """
                List the built-in 2D game blueprints you can instantiate with create_game_scene: \
                flappy (tap-to-flap), angrybirds (slingshot + destructible physics stack), \
                runner (endless jumper), and blank. Returns each template's id, title, a short \
                description of the gameplay, and the entity ids whose sprite art you'd usually \
                replace with generate_sprite output.
                """,
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { _ in
                    let encoder = JSONEncoder()
                    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                    let data = try encoder.encode(GameTemplateLibrary.templates)
                    let json = String(data: data, encoding: .utf8) ?? "[]"
                    return .text("2D game templates:\n\(json)\n\nGame model: a scene is a GameSceneSpec — entities (sprite/color, size, physics body) each carrying declarative behaviors: gravityBody, impulseOnTap, moveConstant, spawner, destroyOffscreen, onCollision, slingshot, destructible, wrapVertical. Create one with create_game_scene, inspect with get_game_scene, edit with update_game_scene.")
                }
            ),

            MCPToolDefinition(
                name: "generate_sprite",
                description: """
                Generate a game-ready SPRITE: an AI image with its background removed to \
                transparency (on-device Vision subject-lift), so it composites cleanly into a \
                game scene or any UI. Local-first (mflux) with cloud fallback, same as the image \
                pipeline. Set frames>1 for a simple animation strip (returns one transparent PNG \
                per frame). Returns the absolute file path(s); pass them as an entity's `sprite` \
                in create_game_scene/update_game_scene, or as imageSource in a design action.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "prompt": ["type": "string", "description": "What to draw, e.g. 'chubby round bluebird game character, side view'. Art direction for a single, centered, background-free subject is added automatically."],
                        "frames": ["type": "integer", "description": "Number of animation frames (1–12). Default 1."],
                        "size": ["type": "string", "description": "Pixel size like '768x768'. Default 768x768."],
                        "removeBackground": ["type": "boolean", "description": "Default true: cut the subject out to a transparent PNG. False keeps the raw opaque image."],
                        "matchProjectArt": ["type": "boolean", "description": "Default true: sample the palette and style of the current page's existing game sprites/images and steer the new sprite to match them, for a consistent look. Set false to ignore existing art."],
                        "facing": ["type": "string", "description": "Which way the sprite faces: right (default), left, front, back, up. For a GUARANTEED left/right use flip_sprite on the result — models often ignore the facing hint."]
                    ],
                    "required": ["prompt"]
                ],
                handler: { [weak self] args in
                    guard let design = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let prompt = (args["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !prompt.isEmpty else {
                        return .failure("'prompt' is required.")
                    }
                    let settings = DesignAgentService.Settings.current()
                    let provider = OpenRouterProvider(apiKey: settings.resolvedAPIKey() ?? "", model: settings.model)
                    let frames = args["frames"] as? Int ?? 1
                    let size = args["size"] as? String ?? "768x768"
                    let removeBG = args["removeBackground"] as? Bool ?? true
                    let matchArt = args["matchProjectArt"] as? Bool ?? true
                    let references = matchArt ? design.currentArtReferenceImagePaths() : []
                    let facing = args["facing"] as? String
                    do {
                        let result = try await SpriteGenerator.generateSprite(
                            prompt: prompt, frames: frames, size: size,
                            removeBackground: removeBG, styleReferencePaths: references,
                            facing: facing, provider: provider
                        )
                        let list = result.framePaths.enumerated()
                            .map { "  frame \($0.offset + 1): \($0.element)" }
                            .joined(separator: "\n")
                        let note = result.cutout
                            ? "Background removed (transparent PNG)."
                            : "Kept opaque (no subject mask found, or removeBackground was false)."
                        let styleNote = references.isEmpty ? "" : " Matched the palette of \(references.count) existing image(s)."
                        return .text("Generated \(result.framePaths.count) sprite frame(s). \(note)\(styleNote)\n\(list)")
                    } catch {
                        return .failure("Sprite generation failed: \(error.localizedDescription)")
                    }
                }
            ),

            MCPToolDefinition(
                name: "flip_sprite",
                description: """
                Mirror a sprite left↔right and return a NEW transparent PNG path — the exact,                 reliable way to set a sprite's facing direction (image models routinely ignore                 "facing left"). Pass a path returned by generate_sprite or any GeneratedAssets                 sprite; use the result as an entity's `sprite`.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "path": ["type": "string", "description": "Absolute path of the sprite PNG to flip."]
                    ],
                    "required": ["path"]
                ],
                handler: { args in
                    guard let path = (args["path"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty else {
                        return .failure("'path' is required.")
                    }
                    do {
                        let flipped = try SpriteGenerator.flipHorizontal(pathToImage: path)
                        return .text("Flipped sprite:\n  \(flipped)")
                    } catch {
                        return .failure("Flip failed: \(error.localizedDescription)")
                    }
                }
            ),

            MCPToolDefinition(
                name: "create_game_scene",
                description: """
                Add a live, playable 2D game to the active page. Give a `template` \
                (flappy | angrybirds | runner | blank) OR author a full `spec` (a GameSceneSpec \
                JSON — partial specs are fine, missing fields default sensibly). The game \
                renders as a real SpriteKit scene on the canvas and ships verbatim in exported \
                iOS/macOS projects. Optionally auto-generate transparent sprite art: pass \
                `spritePrompts` (map of entity id → art prompt). \
                SCENE: {width,height, gravity(negative=down), backgroundColor, backgroundImage, \
                startPaused, showScore, winScore, tapToStartText, \
                worldWidth/worldHeight (world larger than screen), cameraFollow:"entityId" \
                (smooth camera, clamped to world), parallax:[{sprite,speed 0..1,height,y}] \
                (scrolling depth layers), ambient:"snow|rain|bubbles|stars|leaves", \
                music:"file", lives:3 (heart HUD + loseLife collisions + invulnerability), \
                timeLimit:60 + timeUpAction:"win"|"gameOver" (countdown/survival mode), \
                difficultyRamp:0.9 (spawners 10% faster every 10s), \
                backgroundGradient:["#top","#bottom"], vignette:true, \
                lighting:true + lightFollow:"entityId" (normal-mapped dynamic 2D light — \
                sprites take real shading), lightColor}. \
                ENTITY EXTRAS: dropShadow:true (ground shadow), glow:true (additive halo). \
                GENRES this engine does from scratch (no template): flappy (gravity+impulseOnTap+gap spawner), \
                platformer/runner (jumpOnTap+cameraFollow+worldWidth+patrol), breakout (gravity:0, \
                restitution:1 ball + controlHorizontal paddle + static brick grid + removeOther scoring), \
                shooter (shootOnTap projectiles + spawner enemies + followEntity homing), \
                slingshot/physics-smash (slingshot+destructible+health), survival (timeLimit+timeUpAction win). \
                ENTITY: {id, sprite, frames:[paths]+frameRate (sprite animation), color, \
                x,y,width,height (top-left origin, +y down), zIndex, rotation, \
                body:none|dynamic|staticBody|kinematic, circleBody, affectedByGravity, \
                restitution, mass, friction, allowsRotation, category, collidesWith:[], \
                contacts:[], isTemplate, health, behaviors:[...]}. \
                BEHAVIORS: impulseOnTap(strength) flap; jumpOnTap(strength) grounded platformer \
                jump; shootOnTap(template,strength=speed,interval=cooldown) fire projectiles at \
                the tap point; controlHorizontal(strength=speed) steer with drag/arrow keys; \
                slingshot(maxPower,maxDrag) drag-and-launch; moveConstant(velocityX/Y); \
                patrol(velocityX/Y,interval) back-and-forth; followEntity(target,strength) \
                homing; spawner(template,interval,velocityX,gapSize,spawnYMin/Max,firstDelay,scoreOnPass,direction:"left"|"down" (top spawner for shooters; velocityY=fall speed) \
                — sprites TILE at natural aspect in gap segments, top segment flipped); \
                destroyOffscreen(margin); wrapVertical; rotateWithVelocity (nose follows \
                arc, Flappy tilt); spin(strength=deg/s); bob(strength=amplitude,interval); \
                pulse(strength,interval); trail(particles); destructible(particles); \
                onCollision(target, action: gameOver|score|win|removeSelf|removeOther|damage| \
                loseLife|explode|bounce|runFlow, points, particles, soundName, shake:true, \
                flowId). VFX particle kinds: debris|spark|smoke|fire|confetti|hearts. \
                In the interactive preview, game events sync logic variables gameScore/gameOver/ \
                gameWon automatically, and onCollision runFlow fires the logic flow named in \
                flowId — bind Texts to gameScore for live score UI outside the game. \
                EVERYTHING is also programmable from Logic Mode blocks (apply_logic_actions): \
                events onGameStart/onGameTap/onGameDrag/onGameCollision/onGameEntityDestroyed/ \
                onGameSpawned/onGameLifeLost/onGameScore/onGameOver/onGameWin; actions gameSpawn/ \
                gameRemove/gameImpulse/gameLaunch(angle 0=right 90=up + strength — Angry-Birds throw)/ \
                gameMove/gameSetVelocity/gameSetProperty(sprite|color|width|height|rotation|opacity)/ \
                gameSetPhysics(bounciness|friction|damping|mass|rotation|gravity|bodyType — live)/ \
                gameAnimate/gameAddBehavior(behavior JSON)/gameRemoveBehavior/gameSetHealth/gameSetLives/ \
                gameSetGravity(vertical + sideways gravityX; 0/0 = zero-G top-down)/gameSetTimeScale(slow-mo)/ \
                gameSetSpawnRate/gameShake/gameParticles/gameAddScore/gameEnd/gamePause/gameRestart; and \
                gameQuery reads live state (positionX/positionY/velocityX/velocityY/rotation/health/count/ \
                score/lives/timeLeft) into a variable — so the whole game can be programmed with blocks alone.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "template": ["type": "string", "description": "flappy | angrybirds | runner | blank. Ignored when `spec` is given."],
                        "spec": ["type": "object", "description": "A full GameSceneSpec JSON. Overrides `template`.", "additionalProperties": true],
                        "name": ["type": "string", "description": "Node name. Default 'Game'."],
                        "x": ["type": "number", "description": "Canvas x. Default 60."],
                        "y": ["type": "number", "description": "Canvas y. Default 60."],
                        "width": ["type": "number", "description": "Node width. Default = scene width."],
                        "height": ["type": "number", "description": "Node height. Default = scene height."],
                        "spritePrompts": ["type": "object", "description": "Map of entity id → sprite art prompt; each becomes a generated transparent sprite.", "additionalProperties": true],
                        "generateSprites": ["type": "boolean", "description": "Default false. True auto-generates art for the primary character(s) when no spritePrompts are given."],
                        "pageIndex": ["type": "integer", "description": "Target page. Default active page."]
                    ]
                ],
                handler: { [weak self] args in
                    guard let self, let viewModel = self.designViewModel else { throw MCPToolError("Designer is not available.") }

                    // Resolve the scene spec from an explicit spec or a template.
                    var spec: GameSceneSpec
                    if let specObj = args["spec"] as? [String: Any] {
                        let data = try JSONSerialization.data(withJSONObject: specObj)
                        do { spec = try JSONDecoder().decode(GameSceneSpec.self, from: data) }
                        catch { return .failure("Could not decode `spec` as a GameSceneSpec: \(Self.specDecodeMessage(error))") }
                    } else {
                        let templateId = (args["template"] as? String) ?? "flappy"
                        guard let s = GameTemplateLibrary.spec(for: templateId) else {
                            let ids = GameTemplateLibrary.templates.map(\.id).joined(separator: ", ")
                            return .failure("Unknown template '\(templateId)'. Available: \(ids).")
                        }
                        spec = s
                    }

                    // Optional sprite generation.
                    var promptMap: [String: String] = [:]
                    if let raw = args["spritePrompts"] as? [String: Any] {
                        for (k, v) in raw { if let s = v as? String { promptMap[k] = s } }
                    }
                    if promptMap.isEmpty, args["generateSprites"] as? Bool == true {
                        for e in spec.entities where e.behaviors.contains(where: { $0.type == "impulseOnTap" || $0.type == "slingshot" }) {
                            promptMap[e.id] = e.name.isEmpty ? "\(e.id) game character sprite" : "\(e.name) game character sprite"
                        }
                    }
                    var spriteNote = ""
                    if !promptMap.isEmpty {
                        let settings = DesignAgentService.Settings.current()
                        let provider = OpenRouterProvider(apiKey: settings.resolvedAPIKey() ?? "", model: settings.model)
                        var made = 0
                        for (entityId, prompt) in promptMap {
                            guard spec.entities.contains(where: { $0.id == entityId }) else { continue }
                            if let result = try? await SpriteGenerator.generateSprite(prompt: prompt, frames: 1, size: "768x768", removeBackground: true, provider: provider),
                               let path = result.framePaths.first {
                                for i in spec.entities.indices where spec.entities[i].id == entityId {
                                    spec.entities[i].sprite = path
                                }
                                made += 1
                            }
                        }
                        spriteNote = "\nGenerated \(made) of \(promptMap.count) requested sprite(s)."
                    }

                    // Build the host node (a plain Frame carrying the game spec).
                    let name = (args["name"] as? String) ?? "Game"
                    let x = (args["x"] as? Double).map { CGFloat($0) } ?? 60
                    let y = (args["y"] as? Double).map { CGFloat($0) } ?? 60
                    let w = (args["width"] as? Double).map { CGFloat($0) } ?? spec.width
                    let h = (args["height"] as? Double).map { CGFloat($0) } ?? spec.height

                    // Entities become CHILD NODES — editable on the canvas
                    // like any element; the runtime composes the spec back.
                    let entityChildren = DesignNode.entityChildren(for: spec)
                    var sceneOnly = spec
                    sceneOnly.entities = []
                    let node = DesignNode(
                        type: .Frame,
                        name: name,
                        x: x, y: y, width: w, height: h,
                        style: NodeStyle(fill: spec.backgroundColor, cornerRadius: 24, opacity: 1.0, fontSize: nil),
                        clipContent: true,
                        gameScene: sceneOnly,
                        children: entityChildren
                    )

                    let pageIndex = min(max(args["pageIndex"] as? Int ?? viewModel.currentPageIndex, 0), viewModel.project.pages.count - 1)
                    viewModel.project.pages[pageIndex].nodes.append(node)
                    viewModel.selectNode(node.id)

                    return .text("Created game '\(name)' on page \(pageIndex) — node id \(node.id.uuidString). \(spec.entities.count) entit(y/ies), \(w == spec.width ? "" : "resized ")\(Int(spec.width))×\(Int(spec.height)) scene.\(spriteNote)\n\nThe game is live on the canvas (tap/click to play). Use get_game_scene / update_game_scene to edit it, and export_xcode_project to ship it.")
                }
            ),

            MCPToolDefinition(
                name: "get_game_scene",
                description: "Return the GameSceneSpec JSON for a game node (by nodeId, or the first game node on the active page). Use it to inspect entities and behaviors before editing with update_game_scene.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "nodeId": ["type": "string", "description": "UUID of the game node. Omit to use the first game node on the active page."]
                    ]
                ],
                handler: { [weak self] args in
                    guard let self, let viewModel = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let nodes = viewModel.project.pages[viewModel.currentPageIndex].nodes
                    let target: DesignNode?
                    if let idStr = args["nodeId"] as? String, let uuid = UUID(uuidString: idStr) {
                        target = nodes.first { $0.id == uuid }
                    } else {
                        target = nodes.first { $0.gameScene != nil }
                    }
                    guard let node = target, let spec = node.effectiveGameSpec else {
                        return .failure("No game node found. Create one with create_game_scene, or pass a valid game nodeId.")
                    }
                    let encoder = JSONEncoder()
                    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                    let json = String(data: try encoder.encode(spec), encoding: .utf8) ?? "{}"
                    return .text("Game node \(node.id.uuidString) (\"\(node.name)\"):\n\(json)")
                }
            ),

            MCPToolDefinition(
                name: "update_game_scene",
                description: "Replace the GameSceneSpec of an existing game node with a new `spec` JSON (full replacement). Target by nodeId, or the first game node on the active page. The live preview updates immediately.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "spec": ["type": "object", "description": "The new full GameSceneSpec JSON.", "additionalProperties": true],
                        "nodeId": ["type": "string", "description": "UUID of the game node. Omit to use the first game node on the active page."]
                    ],
                    "required": ["spec"]
                ],
                handler: { [weak self] args in
                    guard let self, let viewModel = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let specObj = args["spec"] as? [String: Any] else { return .failure("'spec' object is required.") }
                    let data = try JSONSerialization.data(withJSONObject: specObj)
                    let spec: GameSceneSpec
                    do { spec = try JSONDecoder().decode(GameSceneSpec.self, from: data) }
                    catch { return .failure("Could not decode `spec` as a GameSceneSpec: \(Self.specDecodeMessage(error))") }

                    let pageIndex = viewModel.currentPageIndex
                    let nodes = viewModel.project.pages[pageIndex].nodes
                    let targetIndex: Int?
                    if let idStr = args["nodeId"] as? String, let uuid = UUID(uuidString: idStr) {
                        targetIndex = nodes.firstIndex { $0.id == uuid }
                    } else {
                        targetIndex = nodes.firstIndex { $0.gameScene != nil }
                    }
                    guard let idx = targetIndex else {
                        return .failure("No game node found to update on the active page.")
                    }
                    var sceneOnly = spec
                    sceneOnly.entities = []
                    viewModel.project.pages[pageIndex].nodes[idx].gameScene = sceneOnly
                    viewModel.project.pages[pageIndex].nodes[idx].children = DesignNode.entityChildren(for: spec)
                    viewModel.project.pages[pageIndex].nodes[idx].style.fill = spec.backgroundColor
                    return .text("Updated game node \(viewModel.project.pages[pageIndex].nodes[idx].id.uuidString): \(spec.entities.count) entit(y/ies). Live preview refreshed.")
                }
            ),

            MCPToolDefinition(
                name: "get_canvas_studio_capabilities",
                description: """
                Returns the Canva/Photoshop-style Studio capability map for external MCP \
                agents: artboards, text, photos, AI images, shapes, icons, transforms, \
                typography, effects, crop/mask, layer ordering, alignment, distribution, \
                export, and the exact JSON fields each operation can use.
                """,
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { _ in
                    .text(Self.canvasStudioCapabilitiesJSON())
                }
            ),

            MCPToolDefinition(
                name: "apply_canvas_studio_edits",
                description: """
                Apply Canva/Photoshop-style canvas operations. This is a friendlier wrapper \
                around the exact design-action engine, so x/y/width/height land exactly as \
                requested. Operations: createArtboard, addText, addShape, addPhoto, \
                addAIImage, addIcon, transform, style, typography, image, crop, effects, \
                arrange, alignChildren, distributeChildren, delete, createPage. \
                Professional fields include parentId/parentReference, nodeId/nodeReference, \
                x/y/width/height/scale, fill/stroke/strokeWidth/cornerRadius/opacity, \
                gradient, shadow, blur, overlayColor/overlayOpacity, contentMode fill|fit, \
                clipContent, fontSize/fontWeight/fontFamily/textColor/textAlign/lineHeight, \
                padding, layout, spacing, zIndex, imageSource/path/url, imagePrompt, \
                assetKind, iconName, axis, alignment. For generated imagery use addAIImage \
                with imagePrompt and leave generateImages true.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "operations": [
                            "type": "array",
                            "description": "Studio operation objects, applied in order.",
                            "items": ["type": "object", "additionalProperties": true]
                        ],
                        "generateImages": [
                            "type": "boolean",
                            "description": "Default true: addAIImage/create imagePrompt layers generate real assets when an OpenRouter key is configured."
                        ],
                        "normalize": [
                            "type": "boolean",
                            "description": "Default false: preserve exact coordinates. True runs mobile layout repair passes after applying."
                        ]
                    ],
                    "required": ["operations"]
                ],
                handler: { [weak self] args in
                    guard let viewModel = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let rawOperations = Self.coercedObjectArray(args["operations"]), !rawOperations.isEmpty else {
                        return .failure("'operations' must be a non-empty array of Studio operation objects.")
                    }

                    var payloads: [[String: Any]] = []
                    var skipped: [String] = []
                    for (index, rawOperation) in rawOperations.enumerated() {
                        do {
                            payloads.append(contentsOf: try Self.designActionPayloads(fromStudioOperation: rawOperation))
                        } catch {
                            skipped.append("#\(index + 1): \(error.localizedDescription)")
                        }
                    }

                    guard !payloads.isEmpty else {
                        return .failure("No Studio operation could be translated.\n" + skipped.joined(separator: "\n"))
                    }

                    let data = try JSONSerialization.data(withJSONObject: payloads)
                    let lossy = try JSONDecoder().decode([LossyDesignAction].self, from: data)
                    let actions = DesignAgentService.ensuringImageReferences(in: lossy.compactMap(\.action))

                    guard !actions.isEmpty else {
                        return .failure("Translated \(payloads.count) operation(s), but none decoded into valid design actions.")
                    }

                    let normalize = args["normalize"] as? Bool ?? false
                    let referenceMap = normalize
                        ? viewModel.applyDesignActions(actions)
                        : viewModel.applyDesignActionsExactly(actions)

                    var summary = "Applied \(actions.count) Studio action(s) from \(rawOperations.count) operation(s)\(normalize ? " with normalization" : " exactly")."
                    if !skipped.isEmpty {
                        summary += "\nSkipped operations:\n" + skipped.map { "  \($0)" }.joined(separator: "\n")
                    }
                    if !referenceMap.isEmpty {
                        summary += "\nCreated node ids by reference:\n" + referenceMap
                            .sorted { $0.key < $1.key }
                            .map { "  \($0.key) → \($0.value.uuidString)" }
                            .joined(separator: "\n")
                    }

                    let imageActionCount = actions.filter {
                        $0.type == .createImage && DesignAgentService.generatedAssetPrompt(for: $0) != nil
                    }.count
                    if imageActionCount > 0 {
                        let settings = DesignAgentService.Settings.current()
                        if args["generateImages"] as? Bool == false {
                            summary += "\nLeft \(imageActionCount) AI image layer(s) as prompt placeholders."
                        } else if let apiKey = settings.resolvedAPIKey() {
                            let provider = OpenRouterProvider(apiKey: apiKey, model: settings.model)
                            let outcome = await DesignAgentService.generateAndPatchImages(
                                for: actions,
                                referenceMap: referenceMap,
                                viewModel: viewModel,
                                provider: provider
                            )
                            summary += "\nGenerated \(outcome.generated) of \(outcome.requested) image asset(s)."
                        } else {
                            summary += "\nSkipped \(imageActionCount) AI image request(s): no OpenRouter API key is configured in the app's Agent panel."
                        }
                    }

                    // Deterministic criticism, returned with the result of the
                    // very call that caused it. Costs no tokens and no model
                    // round-trip, and unlike a system-prompt rule the agent
                    // cannot quietly ignore it.
                    summary += "\n\n" + DesignQualityAudit.summary(
                        DesignQualityAudit.audit(page: viewModel.currentPage)
                    )
                    summary += "\n\n" + Self.projectOverviewJSON(viewModel)
                    return .text(summary)
                }
            ),

            MCPToolDefinition(
                name: "analyze_brief",
                description: """
                The professional intake, as data: which product-shaping decisions does this \
                brief leave open? Returns 0-4 ready-to-ask questions (recommended option \
                first), each mapped to the pipeline knob that consumes the answer. Call this \
                BEFORE build_full_app / run_agent_loop, ask YOUR user the returned questions, \
                then pass the answers into the build prompt (or run_agent_loop's `answers`). \
                An empty list means the brief is complete — build without interviewing. \
                Instant, deterministic, no AI call.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "prompt": ["type": "string", "description": "The user's app brief, verbatim (Hebrew works)."]
                    ],
                    "required": ["prompt"]
                ],
                handler: { [weak self] args in
                    guard let prompt = (args["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !prompt.isEmpty else {
                        return .failure("'prompt' (non-empty string) is required.")
                    }
                    let questions = BriefIntake.analyze(prompt: prompt, project: self?.designViewModel?.project)
                    guard !questions.isEmpty else {
                        return .text("Brief is complete enough — no clarifying questions needed. Build.")
                    }
                    let payload: [[String: Any]] = questions.map {
                        ["id": $0.id, "question": $0.question, "options": $0.options, "consumedBy": $0.consumedBy]
                    }
                    let data = (try? JSONSerialization.data(withJSONObject: ["questions": payload], options: [.prettyPrinted, .sortedKeys])) ?? Data()
                    return .text("""
                    \(questions.count) decision(s) open — ask these, then build with the answers folded into the prompt:
                    \(String(data: data, encoding: .utf8) ?? "")
                    """)
                }
            ),

            MCPToolDefinition(
                name: "build_full_app",
                description: """
                One prompt → a WORKING app WITH AN ACCOUNT: runs the full design pipeline \
                (screens, components, AI images, critic), then the logic agent to wire \
                navigation and interactions, then the deterministic backend pass — \
                Firebase Auth sign-up/log-in (creating the Log In / Sign Up screens if the \
                design lacks them), a users/{uid} profile document, and Firestore \
                read/write of the app's main entity scoped to the signed-in user, with \
                matching security rules — then opens the interactive in-app preview. A \
                project checkpoint is saved first so the whole build is reversible via \
                restore_checkpoint. This is the highest-level tool — use it for "build me \
                a <kind of> app" requests; use run_design_agent for design-only work. \
                Takes several minutes.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "prompt": ["type": "string", "description": "The app brief, e.g. 'Build a habit tracker with streaks and a paywall'."],
                        "model": ["type": "string", "description": "Optional agent model override (an OpenRouter id, or 'local/<ollama-model>' to run fully on-device). Persists as the app's selected model."],
                        "mode": ["type": "string", "description": "'composed' (default: model decides screens/components/copy, the component factory renders — fast, polished, great on local models) or 'detailed' (free-form pipeline with AI images + critic — needs a strong model)."],
                        "backend": ["type": "string", "description": "'firebase' (default: accounts + Firestore persistence wired automatically) or 'none' for a local-only app. A brief that says 'no login'/'local only' selects 'none' by itself."]
                    ],
                    "required": ["prompt"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    guard let prompt = (args["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !prompt.isEmpty else {
                        return .failure("'prompt' (non-empty string) is required.")
                    }
                    guard !self.isAgentPipelineRunning else {
                        return .failure("An agent run is already in progress — wait for it to finish.")
                    }
                    let modelOverride = args["model"] as? String
                    if modelOverride == nil, DesignAgentService.Settings.current().resolvedAPIKey() == nil {
                        return .failure("No OpenRouter API key configured and the selected model is not local.")
                    }
                    self.isAgentPipelineRunning = true
                    defer { self.isAgentPipelineRunning = false }
                    let mode = AppBuildOrchestrator.GenerationMode(rawValue: args["mode"] as? String ?? "composed") ?? .composed
                    let backend = (args["backend"] as? String).flatMap(AppBuildOrchestrator.BackendChoice.init(rawValue:))
                    let orchestrator = AppBuildOrchestrator(design: design, logic: logic, pipeline: AgentPipelineCoordinator())
                    let summary = try await orchestrator.buildApp(
                        prompt: prompt, mode: mode, modelOverride: modelOverride, backend: backend
                    )
                    let backendLine: String
                    if let result = summary.backend, !result.isEmpty {
                        backendLine = """

                        BACKEND (Firebase, wired deterministically): flows — \(result.flowNames.joined(separator: ", ")).\
                        \(result.createdScreens.isEmpty ? "" : " Screens created: \(result.createdScreens.joined(separator: ", ")).")\
                        \(result.boundInputs > 0 ? " \(result.boundInputs) input(s) bound to session variables." : "") \
                        Collections: \(result.collections.joined(separator: ", ")). \
                        Credentials are NOT set yet — call set_firebase_config with the Firebase project's \
                        values (or the user's GoogleService-Info values) so the export ships a working \
                        GoogleService-Info.plist.\(result.notes.isEmpty ? "" : " Notes: \(result.notes.joined(separator: " "))")
                        """
                    } else {
                        backendLine = "\n\nBACKEND: none wired (local-only app). Call wire_backend to add accounts + Firestore persistence."
                    }
                    return .text("""
                    App built: \(summary.designActionCount) design action(s), \(summary.generatedImageCount) image(s), \(summary.flowCount) logic flow(s), \
                    screens: \(summary.screens.joined(separator: ", ")).\(summary.enabledAppleWatch ? " Apple Watch platform ENABLED — export_xcode_project will emit the embedded watchOS app target." : "") Interactive preview is open — \
                    drive it with preview_tap/preview_screenshot. Checkpoint saved (restore_checkpoint to undo).
                    \(backendLine)

                    NEXT: this is an interactive PREVIEW, not the compiled app. To make it real, run \
                    check_export_readiness, wire any unbound triggers/inputs, then export_xcode_project \
                    and build/launch. A preview that looks right is not a working app.
                    """)
                }
            ),

            MCPToolDefinition(
                name: "list_templates",
                description: "List the built-in starter app templates (instant, deterministic, no AI call) — id, name, style, screen count.",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { _ in
                    let lines = TemplateFactory.all.map { template in
                        "\(template.id): \(template.name) — \(template.subtitle) (\(template.screens.count) screens, \(template.style.rawValue))"
                    }
                    return .text(lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "create_from_template",
                description: "Instantiate a starter app template onto the current page (instant, no AI call). A checkpoint is saved first. Use list_templates for available ids; follow with get_screenshot to see the result.",
                inputSchema: [
                    "type": "object",
                    "properties": ["templateId": ["type": "string", "description": "Template id from list_templates, e.g. 'fitness-tracker'."]],
                    "required": ["templateId"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let id = args["templateId"] as? String, let template = TemplateFactory.template(id: id) else {
                        return .failure("Unknown templateId — see list_templates.")
                    }
                    CheckpointStore.save(design.project, label: "before template: \(template.name)")
                    // Templates replace the page — a starter on top of leftover
                    // content (like the default sample screen) reads as a bug.
                    design.project.pages[design.currentPageIndex].nodes = []
                    design.project.pages[design.currentPageIndex].logicFlows = []
                    let actions = try TemplateFactory.actions(for: template)
                    _ = design.applyDesignActions(actions)
                    return .text("Created '\(template.name)': \(template.screens.count) screen(s), \(actions.count) actions applied. get_screenshot to view.")
                }
            ),

            MCPToolDefinition(
                name: "list_logic_templates",
                description: "List ready-made logic features that can be dropped into the app — auth (Firebase/Supabase sign-up with a users profile document), notifications, and device sensors (location, motion, heart rate, steps, battery, shake).",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { _ in
                    let lines = FlowTemplateLibrary.all.map { "\($0.name) — \($0.description)" }
                    return .text(lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "add_logic_template",
                description: "Insert a ready-made logic feature (see list_logic_templates) into the current page's logic. The flow arrives with its trigger element/screen unbound — wire it to a button with apply_logic_actions or the block inspector. Checkpointed first.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string", "description": "Template name from list_logic_templates, e.g. 'Sign Up + Profile (Supabase)'."]
                    ],
                    "required": ["name"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    guard let name = args["name"] as? String else {
                        return .failure("'name' is required — see list_logic_templates.")
                    }
                    let normalized = name.lowercased()
                    guard let template = FlowTemplateLibrary.all.first(where: {
                        $0.name.lowercased() == normalized || $0.name.lowercased().contains(normalized)
                    }) else {
                        return .failure("Unknown template '\(name)' — see list_logic_templates.")
                    }
                    CheckpointStore.save(design.project, label: "before logic template: \(template.name)")
                    logic.attach(to: design)
                    logic.insertTemplate(template)
                    let flow = template.build()
                    return .text("Added '\(template.name)': \(flow.blocks.count) block(s). Bind its trigger to an element, then run preview_app.")
                }
            ),

            MCPToolDefinition(
                name: "wire_interactions",
                description: "Make the current app interactive: deterministically auto-wires tab bars and back buttons, then (if a model is available) adds semantic interactions (primary CTA → screen, confirmations). Far more reliable than free-form logic generation. Follow with preview_app or export_web to drive it.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "prompt": ["type": "string", "description": "Optional app context to guide semantic wiring, e.g. 'recipe app'."],
                        "autoOnly": ["type": "boolean", "description": "true = skip the model entirely; only auto-wire tab bars and back buttons (instant)."]
                    ],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    CheckpointStore.save(design.project, label: "before wiring interactions")
                    let settings = DesignAgentService.Settings.current()
                    let autoOnly = args["autoOnly"] as? Bool ?? false
                    let provider = autoOnly ? nil : settings.resolvedAPIKey().map {
                        OpenRouterProvider(apiKey: $0, model: settings.model, temperature: 0.3)
                    }
                    let result = await ComposedLogicGenerator.generate(
                        prompt: args["prompt"] as? String ?? "this app",
                        provider: provider,
                        design: design,
                        logic: logic
                    )
                    return .text("Wired \(result.flowCount) flow(s): \(result.autoWired) auto (tabs/back) + \(result.wiredElements) model-decided interaction(s).")
                }
            ),

            MCPToolDefinition(
                name: "export_web",
                description: "Export the current page as a self-contained, deployable web page (HTML+CSS, no build step). Returns the full HTML. The same output drives the in-app Web Preview. Use this to ship the design as a real web app / shareable file.",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { [weak self] _ in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let page = design.project.pages[design.currentPageIndex]
                    let screens = page.nodes.filter { $0.type == .Frame }
                    guard !screens.isEmpty else { return .failure("No screen frames on the current page to export.") }
                    let html = WebExporter.html(
                        for: screens,
                        appName: design.project.name,
                        flows: page.logicFlows,
                        globalVariables: design.project.globalVariables,
                        supabase: design.project.supabaseConfig
                    )
                    return .text(html)
                }
            ),

            MCPToolDefinition(
                name: "edit_selection",
                description: "Targeted AI edit of ONE design node: selects it and runs the agent scoped to that element only (fast path — no image generation, no critic). Use for 'make this button coral', 'bigger title here'. Node ids come from get_design_tree. Checkpointed first.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "nodeId": ["type": "string", "description": "UUID of the node to edit."],
                        "prompt": ["type": "string", "description": "The edit instruction, e.g. 'make this a coral gradient card with bolder title'."]
                    ],
                    "required": ["nodeId", "prompt"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let raw = args["nodeId"] as? String, let nodeId = UUID(uuidString: raw) else {
                        return .failure("'nodeId' must be a node UUID from get_design_tree.")
                    }
                    guard let prompt = (args["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !prompt.isEmpty else {
                        return .failure("'prompt' (non-empty string) is required.")
                    }
                    guard !self.isAgentPipelineRunning else {
                        return .failure("An agent run is already in progress — wait for it to finish.")
                    }
                    guard DesignAgentService.Settings.current().resolvedAPIKey() != nil else {
                        return .failure("No OpenRouter API key configured and the selected model is not local.")
                    }
                    self.isAgentPipelineRunning = true
                    defer { self.isAgentPipelineRunning = false }
                    CheckpointStore.save(design.project, label: "before edit: \(prompt.prefix(40))")
                    design.selectedNodeId = nodeId
                    let service = DesignAgentService(viewModel: design, pipeline: AgentPipelineCoordinator())
                    let summary = try await service.runFullPipeline(prompt: prompt, quickEdit: true)
                    return .text("Selection edit applied: \(summary.appliedActionCount) action(s). get_screenshot to view; restore_checkpoint to undo.")
                }
            ),

            MCPToolDefinition(
                name: "set_supabase_config",
                description: "Point the project at a real Supabase backend. Once set, Supabase auth/data blocks make live REST calls in the in-app preview AND in the exported web app (the anon key is the public, RLS-gated key a web client is meant to carry). Pass enabled:false to disconnect.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "projectURL": ["type": "string", "description": "e.g. https://abcd1234.supabase.co (no trailing slash)."],
                        "anonKey": ["type": "string", "description": "The project's public anon key."],
                        "enabled": ["type": "boolean", "description": "Default true."]
                    ],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    var config = design.project.supabaseConfig ?? SupabaseConfig()
                    if let url = args["projectURL"] as? String {
                        config.projectURL = url.hasSuffix("/") ? String(url.dropLast()) : url
                    }
                    if let key = args["anonKey"] as? String { config.anonKey = key }
                    config.isEnabled = args["enabled"] as? Bool ?? true
                    design.project.supabaseConfig = config
                    guard config.isConfigured else {
                        return .text("Supabase disconnected (or incomplete — needs both projectURL and anonKey).")
                    }
                    return .text("Supabase connected: \(config.projectURL). Auth and data blocks now make live calls in the preview and in export_web.")
                }
            ),

            MCPToolDefinition(
                name: "set_firebase_config",
                description: """
                Point the project at a real Firebase project. Firebase blocks (auth, \
                Firestore) then compile against live credentials: export_xcode_project \
                writes a GoogleService-Info.plist from these values and adds the \
                firebase-ios-sdk package, so the exported app signs users in for real \
                with no manual setup. Values come from the Firebase console (Project \
                settings ▸ your iOS app) or from an existing GoogleService-Info.plist. \
                Pass enabled:false to disconnect. Instant, no AI call.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "projectId": ["type": "string", "description": "PROJECT_ID, e.g. 'paceguard-1a2b3'."],
                        "apiKey": ["type": "string", "description": "API_KEY (the iOS client key — public, ships in the app)."],
                        "appId": ["type": "string", "description": "GOOGLE_APP_ID, e.g. '1:1234567890:ios:abcdef'."],
                        "messagingSenderId": ["type": "string", "description": "GCM_SENDER_ID (the project number)."],
                        "storageBucket": ["type": "string", "description": "STORAGE_BUCKET, e.g. 'paceguard-1a2b3.appspot.com'. Defaults to <projectId>.appspot.com."],
                        "authDomain": ["type": "string", "description": "Auth domain, e.g. 'paceguard-1a2b3.firebaseapp.com'. Defaults to <projectId>.firebaseapp.com."],
                        "providers": [
                            "type": "array", "items": ["type": "string"],
                            "description": "Sign-in methods to enable: email, google, apple, anonymous. Defaults to ['email']."
                        ],
                        "publicReadCollections": [
                            "type": "array", "items": ["type": "string"],
                            "description": "Collections any signed-in user may read but only the owner may write (a catalog, a social feed). Everything else stays owner-only."
                        ],
                        "enabled": ["type": "boolean", "description": "Default true."]
                    ],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    var config = design.project.firebaseConfig ?? FirebaseConfig()
                    if let value = args["projectId"] as? String { config.projectId = value.trimmingCharacters(in: .whitespacesAndNewlines) }
                    if let value = args["apiKey"] as? String { config.apiKey = value.trimmingCharacters(in: .whitespacesAndNewlines) }
                    if let value = args["appId"] as? String { config.appId = value.trimmingCharacters(in: .whitespacesAndNewlines) }
                    if let value = args["messagingSenderId"] as? String { config.messagingSenderId = value.trimmingCharacters(in: .whitespacesAndNewlines) }
                    if let value = args["storageBucket"] as? String { config.storageBucket = value }
                    if let value = args["authDomain"] as? String { config.authDomain = value }
                    // Both are mechanically derivable from the project id, and a
                    // missing bucket/domain breaks Storage and password-reset
                    // links at runtime rather than at build time.
                    if config.storageBucket.isEmpty, !config.projectId.isEmpty {
                        config.storageBucket = "\(config.projectId).appspot.com"
                    }
                    if config.authDomain.isEmpty, !config.projectId.isEmpty {
                        config.authDomain = "\(config.projectId).firebaseapp.com"
                    }
                    if let providers = args["providers"] as? [String] {
                        let wanted = Set(providers.map { $0.lowercased() })
                        config.enableEmailAuth = wanted.contains("email") || wanted.isEmpty
                        config.enableGoogleAuth = wanted.contains("google")
                        config.enableAppleAuth = wanted.contains("apple")
                        config.enableAnonymousAuth = wanted.contains("anonymous") || wanted.contains("guest")
                    }
                    if let publicRead = args["publicReadCollections"] as? [String] {
                        config.publicReadCollections = publicRead
                    }
                    config.isEnabled = args["enabled"] as? Bool ?? true
                    design.project.firebaseConfig = config

                    guard config.isEnabled else {
                        return .text("Firebase disconnected. Firebase blocks now take their Error branch in the export.")
                    }
                    let missing = [
                        config.projectId.isEmpty ? "projectId" : nil,
                        config.apiKey.isEmpty ? "apiKey" : nil,
                        config.appId.isEmpty ? "appId" : nil,
                        config.messagingSenderId.isEmpty ? "messagingSenderId" : nil,
                    ].compactMap { $0 }
                    guard missing.isEmpty else {
                        return .text("""
                        Firebase enabled for '\(config.projectId.isEmpty ? "(no project id)" : config.projectId)' but INCOMPLETE — \
                        still missing: \(missing.joined(separator: ", ")). Without all four, export_xcode_project cannot \
                        write a GoogleService-Info.plist and the exported app will not connect.
                        """)
                    }
                    // A malformed API key is not a runtime warning — Firebase
                    // Installations throws an uncaught exception at
                    // configure(), so the app dies on launch. Cheap to catch
                    // here, expensive to debug from a crash log.
                    let keyWarning = config.apiKey.count == 39 && config.apiKey.hasPrefix("AIza")
                        ? ""
                        : " ⚠️ apiKey looks wrong (expected 39 characters starting with 'AIza') — Firebase throws an uncaught exception at launch if it is malformed. Copy it from the console's GoogleService-Info.plist (API_KEY)."
                    return .text("""
                    Firebase connected: \(config.projectId).\(keyWarning) Sign-in: \
                    \([config.enableEmailAuth ? "email" : nil, config.enableGoogleAuth ? "google" : nil,
                       config.enableAppleAuth ? "apple" : nil, config.enableAnonymousAuth ? "anonymous" : nil]
                        .compactMap { $0 }.joined(separator: ", ")). \
                    export_xcode_project will now emit GoogleService-Info.plist + firestore.rules. \
                    Remember to enable the same sign-in methods in the Firebase console and deploy the rules.
                    """)
                }
            ),

            MCPToolDefinition(
                name: "provision_firebase",
                description: """
                Create a REAL Firebase backend for this project by driving the installed \
                firebase CLI: creates the Firebase project, registers the iOS app (using \
                the project's bundle id), pulls the client config, creates the Firestore \
                database, and stores everything via the same path as set_firebase_config — \
                so the next export_xcode_project ships a working GoogleService-Info.plist \
                with ZERO console visits. Requires `firebase login` to have been run once \
                in Terminal (the tool tells you if not). Sign-in methods still need one \
                console toggle (no CLI exists for that). Takes ~30-90s.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "projectId": ["type": "string", "description": "Globally-unique Firebase project id, e.g. 'pacefit-a1b2c3'. Lowercase letters, digits, hyphens. Defaults to a slug of the app name plus a random suffix."],
                        "displayName": ["type": "string", "description": "Human name in the Firebase console. Defaults to the app name."]
                    ],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    if let problem = FirebaseProvisioner.loginProblem() {
                        return .failure(problem)
                    }
                    let appName = LogicExporter.exportAppName(project: design.project)
                    let displayName = (args["displayName"] as? String) ?? design.project.name
                    let bundleId = design.project.bundleIdentifier ?? "com.agentic.\(appName.lowercased())"
                    let slug = appName.lowercased().filter { $0.isLetter || $0.isNumber }
                    let projectId = (args["projectId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                        ?? "\(slug.prefix(20))-\(String(UUID().uuidString.prefix(6)).lowercased())"

                    let result: FirebaseProvisioner.ProvisionResult
                    do {
                        result = try await Task.detached(priority: .userInitiated) {
                            try FirebaseProvisioner.provision(projectId: projectId, displayName: displayName, bundleId: bundleId)
                        }.value
                    } catch {
                        return .failure("Provisioning failed: \(error.localizedDescription)")
                    }

                    var config = design.project.firebaseConfig ?? FirebaseConfig()
                    config.projectId = result.projectId
                    config.apiKey = result.apiKey
                    config.appId = result.appId
                    config.messagingSenderId = result.messagingSenderId
                    config.storageBucket = result.storageBucket.isEmpty ? "\(result.projectId).appspot.com" : result.storageBucket
                    config.authDomain = "\(result.projectId).firebaseapp.com"
                    config.isEnabled = true
                    config.enableEmailAuth = true
                    design.project.firebaseConfig = config

                    return .text("""
                    Firebase provisioned: \(result.projectId).
                    \(result.steps.map { "✓ \($0)" }.joined(separator: "\n"))
                    \(result.warnings.isEmpty ? "" : result.warnings.map { "⚠️ \($0)" }.joined(separator: "\n") + "\n")\
                    Credentials stored — export_xcode_project now emits GoogleService-Info.plist for this project. \
                    NEXT: export, then deploy_firestore_rules on the export directory.
                    """)
                }
            ),

            MCPToolDefinition(
                name: "deploy_firestore_rules",
                description: """
                Deploy the export's generated firestore.rules to the live Firebase project \
                via the firebase CLI. Exports ship firebase.json + .firebaserc, so this is \
                one command run in the export directory. Without deployed rules the \
                database rejects everything (deny-by-default) or, worse, ships open.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "path": ["type": "string", "description": "The export directory that contains firebase.json and firestore.rules (the folder export_xcode_project returned)."]
                    ],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let path = args["path"] as? String, !path.isEmpty else {
                        return .failure("'path' (the export directory) is required.")
                    }
                    if let problem = FirebaseProvisioner.loginProblem() {
                        return .failure(problem)
                    }
                    guard let projectId = design.project.firebaseConfig?.projectId, !projectId.isEmpty else {
                        return .failure("No Firebase project configured — run provision_firebase or set_firebase_config first.")
                    }
                    let directory = URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
                    do {
                        let output = try await Task.detached(priority: .userInitiated) {
                            try FirebaseProvisioner.deployRules(exportDir: directory, projectId: projectId)
                        }.value
                        let tail = output.split(separator: "\n").suffix(6).joined(separator: "\n")
                        return .text("Rules deployed to '\(projectId)'.\n\(tail)")
                    } catch {
                        return .failure("Deploy failed: \(error.localizedDescription.prefix(800))")
                    }
                }
            ),

            MCPToolDefinition(
                name: "run_xcode_project_in_simulator",
                description: """
                Build the EXPORTED .xcodeproj with xcodebuild (resolving the real \
                firebase-ios-sdk dependency — unlike run_in_simulator, whose quick build \
                stubs Firebase out), install it in the iOS Simulator, launch it, and verify \
                the process is STILL ALIVE a few seconds later — the check that catches a \
                trap in FirebaseApp.configure() that a bare "launched OK" misses. This is \
                the real-backend runtime proof. First build downloads Firebase: several \
                minutes; later builds are fast. Follow with simulator_screenshot / \
                simulator_tap to drive it.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "path": ["type": "string", "description": "The export directory containing <App>.xcodeproj (what export_xcode_project returned)."]
                    ],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let path = args["path"] as? String, !path.isEmpty else {
                        return .failure("'path' (the export directory) is required.")
                    }
                    let appName = LogicExporter.exportAppName(project: design.project)
                    let bundleId = design.project.bundleIdentifier ?? "com.agentic.\(appName.lowercased())"
                    let root = URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
                    do {
                        let launch = try await Task.detached(priority: .userInitiated) {
                            try SimulatorRunner.buildAndLaunchXcodeProject(
                                projectRoot: root, appName: appName, bundleId: bundleId, progress: { _ in }
                            )
                        }.value
                        if launch.aliveAfterLaunch {
                            return .text("""
                            \(appName) is RUNNING on \(launch.deviceName) with the real Firebase SDK linked \
                            (bundle \(launch.bundleIdentifier), still alive 4s after launch). \
                            simulator_screenshot to see it; simulator_tap/simulator_type to drive it.
                            """)
                        }
                        return .failure("""
                        \(appName) launched on \(launch.deviceName) but DIED within seconds. Most common cause: \
                        malformed Firebase credentials (apiKey must be the 39-char console value) — check \
                        `xcrun simctl spawn booted log show --last 2m --predicate 'process == "\(appName)"'` for the exception.
                        """)
                    } catch {
                        return .failure("Build/launch failed: \(error.localizedDescription.prefix(900))")
                    }
                }
            ),

            MCPToolDefinition(
                name: "archive_ipa",
                description: """
                Archive the exported Xcode project for TestFlight/App Store: xcodebuild \
                archive + IPA export. Needs a signing team — set it via set_product_identity \
                (developmentTeam) — and Apple distribution credentials on this Mac. On a \
                Mac without them, the archive step reports exactly which signing \
                prerequisite is missing. Upload the resulting .ipa with Transporter or \
                `xcrun altool`, or open the .xcarchive in Xcode's Organizer.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "path": ["type": "string", "description": "The export directory containing <App>.xcodeproj."],
                        "method": ["type": "string", "description": "'app-store-connect' (default), 'release-testing' or 'debugging'."]
                    ],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let path = args["path"] as? String, !path.isEmpty else {
                        return .failure("'path' (the export directory) is required.")
                    }
                    let appName = LogicExporter.exportAppName(project: design.project)
                    let team = design.project.developmentTeam
                    let method = (args["method"] as? String) ?? "app-store-connect"
                    let root = URL(fileURLWithPath: (path as NSString).expandingTildeInPath, isDirectory: true)
                    do {
                        let result = try await Task.detached(priority: .userInitiated) {
                            try SimulatorRunner.archiveIPA(
                                projectRoot: root, appName: appName, teamId: team, method: method, progress: { _ in }
                            )
                        }.value
                        if let ipa = result.ipaPath {
                            return .text("Archived AND exported: \(ipa). Upload with Transporter or `xcrun altool --upload-app`.")
                        }
                        return .text("""
                        Archive created at \(result.archivePath), but the headless IPA export needs more signing \
                        setup — open the .xcarchive in Xcode ▸ Organizer to distribute, or add a distribution \
                        certificate/profile and re-run.
                        """)
                    } catch {
                        return .failure("Archive failed: \(error.localizedDescription.prefix(900))\(team == nil ? "\nNo developmentTeam set — set_product_identity with your Team id first." : "")")
                    }
                }
            ),

            MCPToolDefinition(
                name: "simulator_set_appearance",
                description: "Switch the booted iOS Simulator to dark or light appearance (simctl ui). Screenshot both modes to verify the app under each — no human needed.",
                inputSchema: [
                    "type": "object",
                    "properties": ["mode": ["type": "string", "description": "'dark' or 'light'."]],
                    "required": ["mode"]
                ],
                handler: { args in
                    let mode = ((args["mode"] as? String) ?? "dark").lowercased()
                    guard ["dark", "light"].contains(mode) else { return .failure("'mode' must be 'dark' or 'light'.") }
                    do {
                        let device = try await Task.detached { try SimulatorRunner.setAppearance(mode) }.value
                        return .text("\(device) is now in \(mode) appearance. simulator_screenshot to verify.")
                    } catch {
                        return .failure(error.localizedDescription)
                    }
                }
            ),

            MCPToolDefinition(
                name: "wire_backend",
                description: """
                Give the CURRENT design a real account and real persistence, in one \
                deterministic pass (no AI call, never fails on a small model). Creates Log \
                In / Sign Up screens only if the design has none, with real text inputs \
                bound to session variables; wires the launch gate (already signed in → \
                straight into the app), log in, sign up + users/{uid} profile write, log \
                out, password reset; then wires the app's main entity: save-on-tap and \
                load-on-appear, both scoped to the signed-in user, plus a repeat binding so \
                saved documents actually render. Declares the Firestore schema for the app \
                category, which export_xcode_project turns into matching security rules. \
                Use after build_full_app/run_design_agent, or on any hand-made design. \
                Credentials still come from set_firebase_config.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "prompt": ["type": "string", "description": "The app brief — decides the data model (a habit tracker gets habits+checkins, a shop gets orders+cart). Defaults to the project name."],
                        "category": ["type": "string", "description": "Optional explicit category override: finance, banking, trading, fitness, health, mentalHealth, travel, ecommerce, foodDelivery, education, productivity, aiChat, social, realEstate, music, crypto, calendar, habitTracker, generic."]
                    ],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    // With no brief, classify from the design itself: the screen
                    // names ("Shop", "Cart", "Workout", "Chat") carry far more
                    // signal than a project still called "Untitled Project",
                    // which would silently get the generic items/ schema.
                    let screenNames = design.project.pages[design.currentPageIndex].nodes
                        .filter { $0.type == .Frame }
                        .map(\.name)
                    let prompt = (args["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
                        ?? ([design.project.name] + screenNames).joined(separator: " ")
                    let blueprint = (args["category"] as? String)
                        .flatMap(AppCategory.init(rawValue:))
                        .map(BackendBlueprint.blueprint(for:))
                    CheckpointStore.save(design.project, label: "before wire_backend")
                    let result = BackendWiringGenerator.wire(
                        prompt: prompt, design: design, logic: logic, blueprint: blueprint
                    )
                    guard !result.isEmpty else {
                        return .failure("""
                        Nothing could be wired: no screens on the current page. Generate or open a design first \
                        (build_full_app / create_from_template / run_design_agent).
                        """)
                    }
                    return .text("""
                    Backend wired. Flows: \(result.flowNames.joined(separator: ", ")).\
                    \(result.createdScreens.isEmpty ? "" : " Screens created: \(result.createdScreens.joined(separator: ", ")).")\
                    \(result.boundInputs > 0 ? " \(result.boundInputs) input(s) bound." : "") \
                    Collections declared: \(result.collections.joined(separator: ", ")).\
                    \(result.notes.isEmpty ? "" : " " + result.notes.joined(separator: " "))

                    NEXT: set_firebase_config (credentials) → preview_app to click through sign-up → \
                    check_export_readiness → export_xcode_project. Deploy firestore.rules before shipping.
                    """)
                }
            ),

            MCPToolDefinition(
                name: "set_brand",
                description: "Set the product's brand colour and apply it across every screen (CTAs, active states, highlights, accent gradients). Persists with the project, so themes, templates and later agent runs keep the identity. Instant, no AI call. Checkpointed first.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "accent": ["type": "string", "description": "Brand hex colour, e.g. '#F0653C'."],
                        "accentSecondary": ["type": "string", "description": "Optional second hex for accent gradients."],
                        "name": ["type": "string", "description": "Optional brand name."]
                    ],
                    "required": ["accent"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let accent = args["accent"] as? String, accent.hasPrefix("#"), accent.count >= 7 else {
                        return .failure("'accent' must be a hex colour like '#F0653C'.")
                    }
                    CheckpointStore.save(design.project, label: "before brand: \(accent)")
                    let brand = BrandIdentity(
                        accent: accent.uppercased(),
                        accentSecondary: (args["accentSecondary"] as? String)?.uppercased(),
                        name: args["name"] as? String
                    )
                    let changed = BrandKit.apply(brand, to: design)
                    return .text("Brand \(brand.accent) applied: \(changed) element(s) re-coloured. get_screenshot to view.")
                }
            ),

            MCPToolDefinition(
                name: "apply_theme",
                description: "Re-theme the WHOLE project into a visual style preset (instant, no AI call): the canvas's existing colors are classified into roles (background/surface/accent/text) and remapped to the preset's tokens. Checkpointed first. Presets: \(VisualStylePreset.allCases.map(\.rawValue).joined(separator: ", ")).",
                inputSchema: [
                    "type": "object",
                    "properties": ["preset": ["type": "string", "description": "VisualStylePreset raw value, e.g. 'premiumDark'."]],
                    "required": ["preset"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let raw = args["preset"] as? String, let preset = VisualStylePreset(rawValue: raw) else {
                        return .failure("Unknown preset — valid: \(VisualStylePreset.allCases.map(\.rawValue).joined(separator: ", "))")
                    }
                    CheckpointStore.save(design.project, label: "before theme: \(preset.rawValue)")
                    let changed = ThemeApplier.apply(preset, to: design)
                    // A theme repaints with stock tokens — restore the brand on
                    // top so switching mood never costs the product its identity.
                    let rebranded = BrandKit.reapplyIfSet(to: design)
                    let brandNote = rebranded > 0 ? " Brand re-applied to \(rebranded) element(s)." : ""
                    return .text("Re-themed to \(preset.rawValue): \(changed) node style(s) updated.\(brandNote) get_screenshot to view.")
                }
            ),

            MCPToolDefinition(
                name: "list_checkpoints",
                description: "List saved project checkpoints (auto-created before every agent run and app build), newest first.",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { [weak self] _ in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let checkpoints = CheckpointStore.list(projectName: design.project.name)
                    guard !checkpoints.isEmpty else { return .text("No checkpoints yet.") }
                    let formatter = ISO8601DateFormatter()
                    let lines = checkpoints.prefix(25).enumerated().map { index, checkpoint in
                        "\(index): \(formatter.string(from: checkpoint.date)) — \(checkpoint.label)"
                    }
                    return .text(lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "restore_checkpoint",
                description: "Restore the project to a saved checkpoint by index (from list_checkpoints, 0 = newest). The current state is checkpointed first, so a restore is itself reversible.",
                inputSchema: [
                    "type": "object",
                    "properties": ["index": ["type": "integer", "description": "Checkpoint index from list_checkpoints (default 0 = newest)."]],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    let checkpoints = CheckpointStore.list(projectName: design.project.name)
                    let index = args["index"] as? Int ?? 0
                    guard checkpoints.indices.contains(index) else {
                        return .failure("No checkpoint at index \(index) — list_checkpoints shows \(checkpoints.count).")
                    }
                    let orchestrator = AppBuildOrchestrator(design: design, logic: logic, pipeline: AgentPipelineCoordinator())
                    try orchestrator.restore(checkpoints[index])
                    return .text("Restored checkpoint \(index): \(checkpoints[index].label)")
                }
            ),

            MCPToolDefinition(
                name: "run_design_agent",
                description: """
                Delegate a whole design job to the app's built-in AI pipeline: strategy → \
                JSON generation → apply to canvas → AI image assets → critic polish pass, \
                using the OpenRouter models configured in the app. Give it a product brief \
                ("design a meditation app home screen with an onboarding flow") and it handles \
                everything; use apply_design_actions instead when you want to control every \
                node yourself. Returns a summary plus a screenshot of the result. Runs take \
                one to several minutes depending on the configured models — set \
                waitForCompletion:false to start it in the background and poll \
                get_project_overview / get_screenshot.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "prompt": [
                            "type": "string",
                            "description": "The design brief, e.g. 'Design a running-tracker app home screen'."
                        ],
                        "waitForCompletion": [
                            "type": "boolean",
                            "description": "Default true. When false, the pipeline runs in the background and this returns immediately."
                        ]
                    ],
                    "required": ["prompt"]
                ],
                handler: { [weak self] args in
                    guard let self, let viewModel = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let prompt = (args["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !prompt.isEmpty else {
                        return .failure("'prompt' (non-empty string) is required.")
                    }
                    guard !self.isAgentPipelineRunning else {
                        return .failure("A design-agent run is already in progress — wait for it to finish, then check get_screenshot.")
                    }
                    guard DesignAgentService.Settings.current().resolvedAPIKey() != nil else {
                        return .failure("No OpenRouter API key is configured in the app's Agent panel, and the selected model is not local — run_design_agent needs one of the two.")
                    }

                    let service = DesignAgentService(viewModel: viewModel, pipeline: AgentPipelineCoordinator())
                    self.isAgentPipelineRunning = true

                    guard args["waitForCompletion"] as? Bool != false else {
                        Task { @MainActor in
                            defer { self.isAgentPipelineRunning = false }
                            do {
                                let summary = try await service.runFullPipeline(prompt: prompt)
                                self.appendLog("🔌 MCP: background design-agent run finished (\(summary.appliedActionCount) actions, \(summary.generatedImageCount) images)")
                            } catch {
                                self.appendLog("🔌 MCP: background design-agent run failed — \(error.localizedDescription)")
                            }
                        }
                        return .text("Design-agent pipeline started in the background. Poll get_project_overview and get_screenshot to watch the design land.")
                    }

                    defer { self.isAgentPipelineRunning = false }
                    do {
                        let summary = try await service.runFullPipeline(prompt: prompt)

                        var text = "Design agent finished: applied \(summary.appliedActionCount) action(s)"
                        if summary.requestedImageCount > 0 {
                            text += ", generated \(summary.generatedImageCount) of \(summary.requestedImageCount) image asset(s)"
                        }
                        text += summary.criticRan ? ", critic polish applied." : "."

                        var content: [MCPContentItem] = [.text(text)]
                        let nodes = viewModel.project.pages[viewModel.currentPageIndex].nodes
                        if let dataURL = CanvasSnapshotRenderer.jpegDataURL(for: nodes) {
                            content.append(.image(
                                base64: dataURL.replacingOccurrences(of: "data:image/jpeg;base64,", with: ""),
                                mimeType: "image/jpeg"
                            ))
                        }
                        return MCPToolResult(content: content)
                    } catch {
                        return .failure("Design agent failed: \(error.localizedDescription)")
                    }
                }
            ),

            MCPToolDefinition(
                name: "select_page",
                description: "Switch the active page shown in the editor (zero-based index).",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer", "description": "Zero-based page index."]
                    ],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let viewModel = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let index = args["pageIndex"] as? Int else {
                        return .failure("'pageIndex' (integer) is required.")
                    }
                    guard viewModel.project.pages.indices.contains(index) else {
                        return .failure("Page index \(index) is out of range — the project has \(viewModel.project.pages.count) page(s).")
                    }
                    viewModel.selectPage(index: index)
                    return .text("Active page is now \(index): \"\(viewModel.project.pages[index].name)\".")
                }
            ),

            MCPToolDefinition(
                name: "save_project",
                description: """
                Save the full current AgenticDesigner project as JSON, including pages, \
                design nodes, generated asset paths, Firebase/API config, variables, and \
                logic flows. Pass an optional absolute or ~/ path; without one it saves to \
                Application Support/AgenticDesigner/SavedProjects using the project name.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "path": [
                            "type": "string",
                            "description": "Optional destination path, usually ending in .agenticdesign."
                        ]
                    ]
                ],
                handler: { [weak self] args in
                    guard let design = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    self?.logicViewModel?.persist()
                    let url = try ProjectDocumentService.save(
                        project: design.project,
                        path: args["path"] as? String
                    )
                    return .text("Saved project to \(url.path)")
                }
            ),

            MCPToolDefinition(
                name: "load_project",
                description: """
                Load a full AgenticDesigner project from a .agenticdesign or JSON file path, \
                replacing the current in-memory project.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "path": [
                            "type": "string",
                            "description": "Project file path to load."
                        ]
                    ],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let self,
                          let design = self.designViewModel,
                          let logic = self.logicViewModel
                    else { throw MCPToolError("Designer is not available.") }
                    guard let path = args["path"] as? String, !path.isEmpty else {
                        return .failure("'path' is required.")
                    }
                    let loaded = try ProjectDocumentService.load(from: path)
                    design.replaceProject(loaded.project)
                    logic.attach(to: design)
                    return .text("Loaded project from \(loaded.url.path)")
                }
            ),

            MCPToolDefinition(
                name: "preview_app",
                description: """
                RUN the app: opens the interactive preview window (iOS-simulator style) on \
                the user's screen, showing the designed app live. Wired logic flows execute \
                on taps, navigate blocks switch screens, UI-update blocks mutate the screen. \
                Returns the current screen plus every tappable element (id + name) so you \
                can drive the app with preview_tap. Optional screenNodeId picks the start \
                screen.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "screenNodeId": [
                            "type": "string",
                            "description": "UUID of the screen (root frame) to show first. Defaults to the first screen."
                        ]
                    ]
                ],
                handler: { [weak self] args in
                    guard let self else { throw MCPToolError("Designer is not available.") }
                    let (design, logic, simulator) = try self.previewContext()

                    let screens = design.project.pages[design.currentPageIndex].nodes.filter { $0.type == .Frame }
                    guard !screens.isEmpty else {
                        return .failure("No screens to run — create a screen with apply_design_actions first.")
                    }

                    var target = screens[0]
                    if let raw = args["screenNodeId"] as? String {
                        guard let id = UUID(uuidString: raw),
                              let match = screens.first(where: { $0.id == id }) else {
                            return .failure("screenNodeId does not match any screen on the active page.")
                        }
                        target = match
                    }

                    simulator.previewScreenId = target.id
                    logic.showAppPreview = true
                    simulator.primeVariables()
                    NSApp.activate(ignoringOtherApps: true)

                    var lines = ["App preview is running. Showing screen \"\(target.name)\"."]
                    lines.append("Screens: " + screens.map { "\($0.name) (\($0.id.uuidString))" }.joined(separator: ", "))
                    let tappables = Self.tappableElements(logic: logic)
                    if tappables.isEmpty {
                        lines.append("No elements have tap flows yet — wire some with apply_logic_actions.")
                    } else {
                        lines.append("Tappable elements (use preview_tap):")
                        lines.append(contentsOf: tappables.map { "  \($0.name) → \($0.id.uuidString)" })
                    }
                    return .text(lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "preview_tap",
                description: """
                Tap an element in the running app preview (open it with preview_app first). \
                Executes the logic flow bound to that element — navigation, toasts, UI \
                changes — exactly like a user tap, and returns the executed steps and the \
                screen now showing. Follow with preview_screenshot to see the result.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "nodeId": [
                            "type": "string",
                            "description": "UUID of the design node to tap (from preview_app's tappable list or get_design_tree)."
                        ],
                        "itemIndex": [
                            "type": "integer",
                            "description": "For a repeat-list template node: which item's clone to tap (0-based, default 0). The flow runs with that item's data seeded, exactly like tapping that row in the preview."
                        ]
                    ],
                    "required": ["nodeId"]
                ],
                handler: { [weak self] args in
                    guard let self else { throw MCPToolError("Designer is not available.") }
                    let (design, logic, simulator) = try self.previewContext()

                    guard let raw = args["nodeId"] as? String, let nodeId = UUID(uuidString: raw) else {
                        return .failure("'nodeId' must be a node UUID.")
                    }

                    logic.showAppPreview = true
                    simulator.primeVariables()
                    // Owning the clear makes "everything now in the log came
                    // from this tap" true both when run() wipes it and when
                    // runTap appends its no-flow message without running.
                    simulator.log = []
                    let tappedName = logic.designNodeName(for: nodeId) ?? "element"

                    // Tapping a repeat-list template simulates tapping one of
                    // its clones: seed that item's data so the flow knows
                    // which row was "tapped".
                    // The repeat template is the tapped node itself OR its
                    // nearest ancestor — so buttons INSIDE a list cell (Redeem,
                    // Add, …) get the row's data too, matching how a real tap
                    // on a clone's descendant inherits item context.
                    var itemContext: [String: String] = [:]
                    if let template = design.repeatTemplateForOrAncestorOf(nodeId), let binding = template.repeatBinding {
                        let index = Int(truncating: (args["itemIndex"] as? NSNumber) ?? 0)
                        if let context = RepeatBindingExpander.itemContext(binding: binding, variables: simulator.variables, itemIndex: index) {
                            itemContext = context
                        }
                    }
                    simulator.runTap(on: nodeId, itemContext: itemContext)

                    // Flows run async with per-block pacing — wait for the run
                    // to settle (or a Firebase-style branch to ask for input).
                    var waitedMs = 0
                    while simulator.isRunning && simulator.awaitingChoice == nil && waitedMs < 15_000 {
                        try await Task.sleep(nanoseconds: 50_000_000)
                        waitedMs += 50
                    }

                    let steps = simulator.log.map { "  \($0.isError ? "✗" : "•") \($0.message)" }
                    var lines = ["Tapped \"\(tappedName)\"."]
                    lines.append(contentsOf: steps.isEmpty ? ["  (no flow bound to this element)"] : steps)

                    if let pending = simulator.awaitingChoice {
                        lines.append("⏸ Flow is PAUSED on '\(pending.blockLabel)' (an auth call the preview can't fake): call preview_choose_branch with outcome:'success' (or 'error') to continue — \(pending.labels.joined(separator: " / ")).")
                    }

                    let screens = design.project.pages[design.currentPageIndex].nodes.filter { $0.type == .Frame }
                    if let current = screens.first(where: { $0.id == simulator.previewScreenId }) ?? screens.first {
                        lines.append("Now showing: \"\(current.name)\"")
                    }
                    return .text(lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "preview_type",
                description: """
                Type into a text field in the running app preview — the only way for an agent \
                to fill a form it just generated (email, password, a new item's title). Writes \
                the value into the field AND into the variable the field is bound to, then fires \
                any On Change flow, exactly like a user typing. Without this, a login screen \
                could be tapped but never filled, so every auth/save flow ran on empty strings. \
                Find field ids with get_design_tree (type "Input").
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "nodeId": ["type": "string", "description": "UUID of the Input node to type into."],
                        "text": ["type": "string", "description": "The text to enter. Replaces the field's current value."]
                    ],
                    "required": ["nodeId", "text"]
                ],
                handler: { [weak self] args in
                    guard let self else { throw MCPToolError("Designer is not available.") }
                    let (_, logic, simulator) = try self.previewContext()
                    guard let raw = args["nodeId"] as? String, let nodeId = UUID(uuidString: raw) else {
                        return .failure("'nodeId' must be a node UUID.")
                    }
                    guard let text = args["text"] as? String else {
                        return .failure("'text' (string) is required.")
                    }
                    guard let node = self.designViewModel?.nodeForSimulation(id: nodeId) else {
                        return .failure("No node with that id on the current page.")
                    }
                    guard node.type == .Input else {
                        return .failure("'\(node.name)' is a \(node.type.rawValue), not a text Input — only an Input can be typed into.")
                    }
                    logic.showAppPreview = true
                    simulator.primeVariables()
                    simulator.log = []
                    simulator.setInputValue(nodeId: nodeId, text: text)
                    let bound = node.logicBindings?.first { $0.kind == .value || $0.kind == .text }?.variableName
                    var lines = ["Typed into \"\(node.name)\"\(bound.map { " → variable '\($0)'" } ?? " (no variable binding — the value is visible but no flow can read it)")."]
                    lines.append(contentsOf: simulator.log.map { "  \($0.isError ? "✗" : "•") \($0.message)" })
                    return .text(lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "preview_choose_branch",
                description: """
                Answer the Success/Error question the interactive preview asks when a flow \
                reaches an auth block (Firebase/Supabase sign-in, register, logout — there is \
                no way to fake a real credential check in a preview). Until this is answered \
                the flow stays PAUSED, so an agent clicking through its own app with \
                preview_tap cannot get past the login screen without it. Pass outcome:'success' \
                to continue down the success branch (the normal path: it also seeds a simulated \
                signed-in user), or 'error' to exercise the failure copy. Follow with \
                preview_screenshot to see where the flow landed.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "outcome": ["type": "string", "description": "'success' (default) or 'error'."],
                        "portIndex": ["type": "integer", "description": "Explicit output port index, for blocks with more than two branches. Overrides 'outcome'."]
                    ],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let simulator = self.previewSimulator else {
                        throw MCPToolError("Preview simulator is not available.")
                    }
                    guard let pending = simulator.awaitingChoice else {
                        return .failure("""
                        The preview is not waiting on a branch choice. Either the flow already \
                        finished, or nothing has been tapped yet — run preview_app then preview_tap.
                        """)
                    }
                    let index: Int
                    if let explicit = (args["portIndex"] as? NSNumber).map({ Int(truncating: $0) }) {
                        index = explicit
                    } else {
                        index = (args["outcome"] as? String)?.lowercased().hasPrefix("err") == true ? 1 : 0
                    }
                    guard pending.labels.indices.contains(index) else {
                        return .failure("portIndex \(index) is out of range — '\(pending.blockLabel)' has \(pending.labels.count) branch(es): \(pending.labels.joined(separator: ", ")).")
                    }
                    let label = pending.labels[index]
                    simulator.choose(index)

                    // Let the rest of the chain run before reporting, or the log
                    // would be read back before the branch had done anything.
                    var waitedMs = 0
                    while simulator.isRunning && simulator.awaitingChoice == nil && waitedMs < 15_000 {
                        try await Task.sleep(nanoseconds: 50_000_000)
                        waitedMs += 50
                    }
                    var lines = ["'\(pending.blockLabel)' → \(label)."]
                    lines.append(contentsOf: simulator.log.map { "  \($0.isError ? "✗" : "•") \($0.message)" })
                    if simulator.awaitingChoice != nil {
                        lines.append("⏸ Paused again on '\(simulator.awaitingChoice?.blockLabel ?? "")' — call preview_choose_branch again.")
                    }
                    if let design = self.designViewModel {
                        let screens = design.project.pages[design.currentPageIndex].nodes.filter { $0.type == .Frame }
                        if let current = screens.first(where: { $0.id == simulator.previewScreenId }) ?? screens.first {
                            lines.append("Now showing: \"\(current.name)\"")
                        }
                    }
                    return .text(lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "preview_game_gesture",
                description: """
                Perform a DRAG on the game running in the preview — begin, move, release —                 in DESIGN coordinates (top-left origin, same as get_game_scene). This is the                 only way to exercise a slingshot pull, drag-steering, or a bike lean through                 MCP; preview_tap fires logic flows but cannot drag inside the SpriteKit scene.                 To fire a slingshot: set from = the projectile's position, and to = where you                 pull it (opposite the launch direction, e.g. pull down-left to fire up-right).                 Follow with preview_screenshot or a gameQuery flow to see the result.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "fromX": ["type": "number", "description": "Drag start X (design coords)."],
                        "fromY": ["type": "number", "description": "Drag start Y (design coords)."],
                        "toX": ["type": "number", "description": "Drag end X (design coords)."],
                        "toY": ["type": "number", "description": "Drag end Y (design coords)."]
                    ],
                    "required": ["fromX", "fromY", "toX", "toY"]
                ],
                handler: { [weak self] args in
                    guard let self else { throw MCPToolError("Designer is not available.") }
                    _ = try self.previewContext()
                    func num(_ k: String) -> CGFloat? { (args[k] as? NSNumber).map { CGFloat(truncating: $0) } }
                    guard let fx = num("fromX"), let fy = num("fromY"),
                          let tx = num("toX"), let ty = num("toY") else {
                        return .failure("fromX/fromY/toX/toY must all be numbers (design coords).")
                    }
                    guard GameSceneRegistry.sceneCount > 0 else {
                        return .failure("No live game scene. Open it with preview_app and make sure a game screen is showing.")
                    }
                    GameSceneRegistry.broadcast(.gesture(fromX: fx, fromY: fy, toX: tx, toY: ty))
                    return .text("Dragged (\(Int(fx)), \(Int(fy))) → (\(Int(tx)), \(Int(ty))) in the game. Read the result with a gameQuery flow or preview_screenshot.")
                }
            ),

            MCPToolDefinition(
                name: "preview_screenshot",
                description: """
                Screenshot of the screen currently showing in the running app preview, \
                including live UI changes made by logic flows (setText/setColor/…). \
                Toasts and haptics appear in the preview_tap step log, not the image.
                """,
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { [weak self] _ in
                    guard let self else { throw MCPToolError("Designer is not available.") }
                    let (design, _, simulator) = try self.previewContext()
                    simulator.primeVariables()

                    let screens = design.project.pages[design.currentPageIndex].nodes.filter { $0.type == .Frame }
                    guard let current = screens.first(where: { $0.id == simulator.previewScreenId }) ?? screens.first else {
                        return .failure("No screens to render.")
                    }
                    // Render what the preview window actually shows: repeat
                    // templates expanded into one clone per bound-array item.
                    var display = current
                    display.children = RepeatBindingExpander.expand(current.children, variables: simulator.variables)
                    guard let dataURL = CanvasSnapshotRenderer.jpegDataURL(for: [display]) else {
                        return .failure("Could not render screen \"\(current.name)\".")
                    }

                    let base64 = dataURL.replacingOccurrences(of: "data:image/jpeg;base64,", with: "")
                    var caption = "Running app — screen \"\(current.name)\""
                    if let toast = simulator.toastMessage {
                        caption += " (toast on screen: \"\(toast)\")"
                    }
                    return MCPToolResult(content: [
                        .text(caption + ":"),
                        .image(base64: base64, mimeType: "image/jpeg")
                    ])
                }
            ),

            MCPToolDefinition(
                name: "apply_logic_actions",
                description: """
                Apply logic-block actions to the current page's Logic Mode canvas. Use this to \
                wire interactions such as onTap → hapticFeedback → navigate, showToast, \
                screen-load effects, and simple UI updates. \
                createVariable: {type,name,varType?("string"|"number"|"boolean"|"json"|"array"),\
                scope?("global"|"screen"|"flow", default global),defaultValue?,flowId?/flowReference? \
                (required for non-global scopes)} — declare variables flows read/write; a \
                JSON-array variable can drive a repeat list (see apply_design_actions). \
                Actions: createFlow, createBlock, updateVariable ({type,name,defaultValue} updates a global variable, e.g. a data list), \
                connectBlocks, updateParameter, deleteBlock, deleteFlow. \
                createFlow: {type,name,flowReference?,screenNodeId?}. \
                createBlock: {type,flowId?/flowReference?,blockType,nodeReference?,x,y,label?,\
                connectedDesignNodeId?,parameters:{key:{value?,nodeId?,variableName?}}}. \
                IMPORTANT: tap/gesture events fire ONLY via their "element" PARAMETER — \
                always set parameters:{element:{nodeId:"<button uuid>"}} on onTap/onSwipe \
                blocks (connectedDesignNodeId alone is just a visual link). \
                connectBlocks: {type,flowId?/flowReference?,sourceBlockId?/sourceReference,\
                sourcePort?,targetBlockId?/targetReference,targetPort?}. \
                updateParameter: {type,flowId?/flowReference?,blockId?/blockReference,key,\
                value?,nodeId?,variableName?}. Node ids are UUIDs from get_design_tree; screen \
                references use nodeId in the parameter as well.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "actions": [
                            "type": "array",
                            "description": "Logic action objects, applied in order.",
                            "items": ["type": "object", "additionalProperties": true]
                        ],
                        "pageIndex": [
                            "type": "integer",
                            "description": "Zero-based page index. Defaults to the active page."
                        ]
                    ],
                    "required": ["actions"]
                ],
                handler: { [weak self] args in
                    guard let self else { throw MCPToolError("Designer is not available.") }
                    guard let design = self.designViewModel,
                          let logic = self.logicViewModel
                    else { throw MCPToolError("Designer is not available.") }
                    guard let rawActions = args["actions"] as? [[String: Any]], !rawActions.isEmpty else {
                        return .failure("'actions' must be a non-empty array of action objects.")
                    }

                    if let pageIndex = args["pageIndex"] as? Int {
                        guard design.project.pages.indices.contains(pageIndex) else {
                            return .failure("Page index \(pageIndex) is out of range — the project has \(design.project.pages.count) page(s).")
                        }
                        design.selectPage(index: pageIndex)
                    }
                    logic.attach(to: design)

                    let result = Self.applyLogicActions(rawActions, logic: logic)
                    return .text(result)
                }
            ),

            MCPToolDefinition(
                name: "set_platforms",
                description: "Choose which platforms the app targets: iPhone, iPad, appleWatch. Enabling appleWatch makes the export emit the real watch workout session (HKWorkoutSession + live heart rate) and phone/watch sync.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "platforms": [
                            "type": "array",
                            "items": ["type": "string"],
                            "description": "Any of: iPhone, iPad, appleWatch."
                        ],
                        "orientation": [
                            "type": "string",
                            "description": "portrait | landscape | all. Landscape locks the exported app to landscape — required for side-scrolling / slingshot games, which are unplayable letterboxed into portrait."
                        ]
                    ],
                    "required": ["platforms"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let raw = args["platforms"] as? [String], !raw.isEmpty else {
                        return .failure("'platforms' must be a non-empty array (iPhone, iPad, appleWatch).")
                    }
                    let platforms = raw.compactMap { AppPlatform(rawValue: $0) }
                    guard !platforms.isEmpty else {
                        return .failure("No valid platform. Use: \(AppPlatform.allCases.map(\.rawValue).joined(separator: ", ")).")
                    }
                    design.project.platformSettings.enabledPlatforms = platforms
                    var note = ""
                    if let rawOrientation = args["orientation"] as? String {
                        guard let orientation = AppOrientation(rawValue: rawOrientation.lowercased()) else {
                            return .failure("'orientation' must be one of: \(AppOrientation.allCases.map(\.rawValue).joined(separator: ", ")).")
                        }
                        design.project.platformSettings.orientation = orientation
                        note = " Orientation: \(orientation.rawValue)."
                    }
                    return .text("Platforms: \(platforms.map(\.rawValue).joined(separator: ", ")).\(note)")
                }
            ),

            MCPToolDefinition(
                name: "export_ios_source",
                description: "Export the full SwiftUI/iOS source (screens, flows, SensorServices, StateStore, watch workout session, Package.swift, Info.plist) to a directory you keep — so the generated code can be inspected, compiled and shipped. Returns the path plus the readiness verdict and any flows that were DROPPED for having no trigger.",
                inputSchema: [
                    "type": "object",
                    "properties": ["path": ["type": "string", "description": "Destination directory, e.g. /tmp/my-app-export."]],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    guard let path = args["path"] as? String, !path.isEmpty else {
                        return .failure("'path' is required.")
                    }
                    logic.attach(to: design)
                    let directory = URL(fileURLWithPath: path)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    let root = try LogicExporter.exportSwiftUISource(
                        project: design.project,
                        flows: logic.flows,
                        currentPageId: design.project.pages[design.currentPageIndex].id,
                        to: directory
                    )
                    let dropped = LogicExporter.lastDroppedFlowNames
                    let findings = ExportReadiness.audit(project: design.project, flows: logic.flows)
                    let droppedNote = dropped.isEmpty
                        ? "No flows were dropped — every flow has a trigger."
                        : "DROPPED (absent from the binary): \(dropped.joined(separator: ", "))"
                    let gitNote = GitSyncService.syncExport(
                        projectName: design.project.name, kind: "SwiftPM", from: root
                    ).map { "\n\($0)" } ?? ""
                    return .text("""
                    Exported to \(root.path)\(gitNote)
                    \(droppedNote)

                    \(ExportReadiness.summary(findings))

                    NEXT: this SwiftPM source compiles but cannot produce a signable app bundle or a \
                    watch app. For a shippable build use export_xcode_project, then install/launch in \
                    a simulator and run assert_ready — a build is not a running app.
                    """)
                }
            ),

            MCPToolDefinition(
                name: "set_product_identity",
                description: "Set the product NAME and (optionally) the bundle identifier for the exported app, replacing the 'Untitled Project' / auto-derived com.agentic.* defaults so it's ready to sign and ship. Persists with the project. Checkpointed first.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "name": ["type": "string", "description": "Product display name, e.g. 'PaceGuard'."],
                        "bundleIdentifier": ["type": "string", "description": "Optional reverse-DNS bundle id, e.g. 'com.acme.paceguard'. Defaults to com.agentic.<name>."],
                        "developmentTeam": ["type": "string", "description": "Optional Apple Developer Team id (10 chars, e.g. 'AB12CD34EF') — exports then emit DEVELOPMENT_TEAM so the project runs on device/archives with no Xcode visit. Find it with: security find-identity -v -p codesigning."]
                    ],
                    "required": ["name"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let name = (args["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
                        return .failure("'name' is required.")
                    }
                    CheckpointStore.save(design.project, label: "before identity: \(name)")
                    design.project.name = name
                    if let bid = (args["bundleIdentifier"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !bid.isEmpty {
                        design.project.bundleIdentifier = bid
                    }
                    if let team = (args["developmentTeam"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !team.isEmpty {
                        design.project.developmentTeam = team
                    }
                    let appName = LogicExporter.exportAppName(project: design.project)
                    let effectiveBundle = design.project.bundleIdentifier ?? "com.agentic.\(appName.lowercased())"
                    return .text("Product identity set — name: \(name), bundle id: \(effectiveBundle).")
                }
            ),

            MCPToolDefinition(
                name: "export_xcode_project",
                description: "Export a real, signable Xcode project (.xcodeproj) — NOT a Swift package. This is the one that can actually ship: it builds an app BUNDLE you can archive and submit to the App Store, and when Apple Watch is enabled it adds a watchOS app target embedded into the iOS app. Uses Xcode 16 synchronized folder groups (Shared/iOS/Watch). Returns the path plus the readiness verdict.",
                inputSchema: [
                    "type": "object",
                    "properties": ["path": ["type": "string", "description": "Destination directory, e.g. /tmp/my-app-xcode."]],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    guard let path = args["path"] as? String, !path.isEmpty else {
                        return .failure("'path' is required.")
                    }
                    logic.attach(to: design)
                    let directory = URL(fileURLWithPath: path)
                    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                    let root = try LogicExporter.exportXcodeProject(
                        project: design.project,
                        flows: logic.flows,
                        currentPageId: design.project.pages[design.currentPageIndex].id,
                        to: directory
                    )
                    let appName = LogicExporter.exportAppName(project: design.project)
                    let findings = ExportReadiness.audit(project: design.project, flows: logic.flows)
                    let gitNote = GitSyncService.syncExport(
                        projectName: design.project.name, kind: "Xcode", from: root
                    ).map { "\n\($0)" } ?? ""
                    return .text("""
                    Exported Xcode project to \(root.path)\(gitNote)
                    Open \(appName).xcodeproj, set your signing Team, then Run or Product ▸ Archive.

                    \(ExportReadiness.summary(findings))

                    NEXT (don't stop here — layer 4 of the truth check): a successful build is NOT a \
                    running app. Install and launch it in the iOS simulator (and the watchOS \
                    simulator if Apple Watch is enabled), screenshot each, and confirm no crashes — \
                    then run assert_ready before calling this done.
                    """)
                }
            ),

            MCPToolDefinition(
                name: "set_provider_key",
                description: "Store an API key for one model provider (cerebras, groq, gemini, nim, openrouter). Runs INSIDE the app, which is the only way that works — this app's bundle id makes `defaults write` from a shell land in the wrong domain. Never echoes the key back.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "provider": ["type": "string", "description": "Route id: cerebras | groq | gemini | nim | openrouter."],
                        "key": ["type": "string", "description": "The API key."]
                    ],
                    "required": ["provider", "key"]
                ],
                handler: { args in
                    guard let provider = (args["provider"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
                          let route = ModelProviderCatalog.routes.first(where: { $0.id == provider }),
                          let defaultsKey = route.defaultsKey else {
                        return .failure("'provider' must be one of: \(ModelProviderCatalog.routes.compactMap { $0.defaultsKey == nil ? nil : $0.id }.joined(separator: ", ")).")
                    }
                    guard let key = (args["key"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty else {
                        return .failure("'key' is required.")
                    }
                    UserDefaults.standard.set(key, forKey: defaultsKey)
                    // Confirm by USING it, so "saved" never means "saved but wrong".
                    do {
                        let models = try await ModelProviderCatalog.fetchModels(for: route)
                        ModelProviderCatalog.storeModels(models, for: route)
                        return .text("\(route.name) key saved and verified — \(models.count) models available. \(route.freeTierNote)")
                    } catch {
                        return .text("\(route.name) key saved, but the provider rejected it: \(error.localizedDescription)")
                    }
                }
            ),

            MCPToolDefinition(
                name: "import_from_screenshot",
                description: "Turn a screenshot of an app you like into EDITABLE screens on the canvas. Reads the image with the configured vision model, describes it as the composer's component vocabulary, then renders it deterministically through ComponentFactory — so the result is real nodes you can select, restyle and re-theme, not a picture. Requires a vision-capable model (local/qwen3-vl, gemini/*, Claude, GPT); text-only models will fail. Checkpointed first.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "imagePath": ["type": "string", "description": "Absolute path to a PNG/JPEG screenshot."],
                        "notes": ["type": "string", "description": "Optional steer, e.g. 'keep the layout but use our brand colours'."]
                    ],
                    "required": ["imagePath"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let path = (args["imagePath"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty else {
                        return .failure("'imagePath' is required.")
                    }
                    let expanded = NSString(string: path).expandingTildeInPath
                    guard let imageData = FileManager.default.contents(atPath: expanded) else {
                        return .failure("Could not read an image at \(expanded).")
                    }
                    let settings = DesignAgentService.Settings.current()
                    guard let apiKey = settings.resolvedAPIKey() else {
                        return .failure(AIProviderError.missingAPIKey.localizedDescription)
                    }
                    let mime = expanded.lowercased().hasSuffix(".png") ? "image/png" : "image/jpeg"
                    let dataURL = "data:\(mime);base64,\(imageData.base64EncodedString())"

                    CheckpointStore.save(design.project, label: "before screenshot import")
                    let provider = OpenRouterProvider(apiKey: apiKey, model: settings.model)
                    let notes = (args["notes"] as? String).map { "\n\nAdditional direction: \($0)" } ?? ""
                    let result = try await ComposedAppGenerator.generate(
                        prompt: """
                        Recreate the attached screenshot as an editable screen using ONLY the component \
                        vocabulary in your schema. Match its layout order, hierarchy, spacing and colour \
                        mood, and write real copy for every slot based on what the screenshot actually \
                        shows. Do not describe the image — emit the JSON.\(notes)
                        """,
                        provider: provider,
                        viewModel: design,
                        referenceImageDataURLs: [dataURL]
                    )
                    return .text("""
                    Imported the screenshot as \(result.screenCount) editable screen(s) in the \(result.style.rawValue) style (\(result.actionCount) elements).
                    Every element is a real node — select, restyle or re-theme it like anything else.

                    \(DesignQualityAudit.summary(DesignQualityAudit.audit(page: design.currentPage)))
                    """)
                }
            ),

            MCPToolDefinition(
                name: "save_component",
                description: "Save a node (card, nav bar, header — anything) to the reusable component library, so the SAME element can be instantiated on every screen instead of being redrawn slightly differently each time. Components persist across projects. This is how cross-screen consistency is enforced structurally rather than hoped for.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "nodeId": ["type": "string", "description": "Node to save (from get_design_tree)."],
                        "name": ["type": "string", "description": "Component name, e.g. 'Product Card'."],
                        "category": ["type": "string", "description": "Optional grouping, e.g. 'Cards'."]
                    ],
                    "required": ["nodeId", "name"]
                ],
                handler: { [weak self] args in
                    guard let design = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let idString = args["nodeId"] as? String, let id = UUID(uuidString: idString),
                          let node = design.node(id: id) else {
                        return .failure("'nodeId' must be a node id from get_design_tree.")
                    }
                    guard let name = (args["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
                        return .failure("'name' is required.")
                    }
                    let component = try ComponentLibrary.save(
                        node: node, name: name, category: args["category"] as? String ?? "General"
                    )
                    return .text("Saved '\(component.name)' (\(Int(component.width))×\(Int(component.height)), \(component.childCount) child element(s)). Use list_components / insert_component to reuse it on other screens.")
                }
            ),

            MCPToolDefinition(
                name: "list_components",
                description: "List saved reusable components (name, id, size, category). Prefer instantiating one of these over redrawing a similar element by hand — that is what keeps screens consistent.",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { _ in
                    let components = ComponentLibrary.all()
                    guard !components.isEmpty else {
                        return .text("No saved components yet. Build one on the canvas, then call save_component.")
                    }
                    let lines = components.map {
                        "\($0.id.uuidString) — \($0.name) [\($0.category)] \(Int($0.width))×\(Int($0.height)), \($0.childCount) child element(s)"
                    }
                    return .text("Saved components (\(components.count)):\n" + lines.joined(separator: "\n"))
                }
            ),

            MCPToolDefinition(
                name: "insert_component",
                description: "Instantiate a saved component onto the current screen at x/y. Every instance gets fresh node ids, so instances are independent. Checkpointed first.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "componentId": ["type": "string", "description": "Component id from list_components."],
                        "x": ["type": "number", "description": "X inside the target screen (default 24)."],
                        "y": ["type": "number", "description": "Y inside the target screen (default 24)."]
                    ],
                    "required": ["componentId"]
                ],
                handler: { [weak self] args in
                    guard let design = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    guard let idString = args["componentId"] as? String, let id = UUID(uuidString: idString),
                          let component = ComponentLibrary.all().first(where: { $0.id == id }) else {
                        return .failure("No component with that id — call list_components.")
                    }
                    CheckpointStore.save(design.project, label: "before insert component: \(component.name)")
                    let pointX: CGFloat = CGFloat(args["x"] as? Double ?? 24)
                    let pointY: CGFloat = CGFloat(args["y"] as? Double ?? 24)
                    let point = CGPoint(x: pointX, y: pointY)
                    let newId = design.insertComponent(component, at: point)
                    return .text("Inserted '\(component.name)' as node \(newId.uuidString).\n\n" + DesignQualityAudit.summary(DesignQualityAudit.audit(page: design.currentPage)))
                }
            ),

            MCPToolDefinition(
                name: "check_design_quality",
                description: "REFERENCE-BAR GATE. Deterministic scoring against the local AppShots research standard: screen rails, hierarchy, density, palette discipline, radius/type scales, real copy, image completeness, bottom-navigation safety, tap targets, WCAG contrast, overflow and reachable destinations. No model call. Repair until the report says REFERENCE BAR PASS; Agent Loop finish is blocked otherwise.",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { [weak self] _ in
                    guard let design = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    return .text(DesignQualityAudit.summary(
                        DesignQualityAudit.report(page: design.currentPage),
                        limit: 40
                    ))
                }
            ),

            MCPToolDefinition(
                name: "assert_ready",
                description: "CERTIFICATION GATE. Runs the truth check and REFUSES (returns an error) if any code-level BLOCKER remains — so a model cannot declare the app production-ready while a fixable blocker is open. Succeeds only when there are zero blockers; warnings/info are reported but don't fail. Call this as the last step before claiming an app is done.",
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { [weak self] _ in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    logic.attach(to: design)
                    let flows = design.project.pages.flatMap(\.logicFlows) + logic.flows
                    var seen: Set<UUID> = []
                    let unique = flows.filter { seen.insert($0.id).inserted }
                    let findings = ExportReadiness.audit(project: design.project, flows: unique)
                    let blockers = findings.filter { $0.severity == .blocker }
                    if blockers.isEmpty {
                        return .text("READY ✓ — no code-level blockers.\n\n\(ExportReadiness.summary(findings))")
                    }
                    return .failure("NOT READY — \(blockers.count) blocker(s) must be resolved (via MCP) before this app can be called production-ready. Do not certify it done.\n\n\(ExportReadiness.summary(findings))")
                }
            ),

            MCPToolDefinition(
                name: "check_export_readiness",
                description: """
                THE TRUTH CHECK. Audits the gap between what the screens promise and what the \
                compiled app can actually do: flows the exporter will silently DROP (unbound \
                triggers), blocks with no native implementation, backends referenced but not \
                configured, screens showing hardcoded data as if it were real, and packaging \
                defaults. Run this before believing a demo is an app.
                """,
                inputSchema: ["type": "object", "properties": [:]],
                handler: { [weak self] _ in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    logic.attach(to: design)
                    let flows = design.project.pages.flatMap(\.logicFlows) + logic.flows
                    var seen: Set<UUID> = []
                    let unique = flows.filter { seen.insert($0.id).inserted }
                    let findings = ExportReadiness.audit(project: design.project, flows: unique)
                    return .text(ExportReadiness.summary(findings))
                }
            ),

            MCPToolDefinition(
                name: "run_in_simulator",
                description: """
                Exports a page's design + logic into real SwiftUI source code, compiles it \
                with swiftc, and launches it as a real app in the iOS Simulator — the same \
                pipeline the in-app "Run" button in Logic Mode uses. This is the only way to \
                verify generated code actually COMPILES and behaves correctly — the visual \
                preview (preview_app/preview_tap) simulates the design/logic graph directly \
                and can look right even when the exported Swift code has a real compile \
                error. Requires full Xcode (not just Command Line Tools) and an iOS Simulator \
                runtime; can take 10-60+ seconds. Returns the simulator device and bundle id \
                on success, or a build-error excerpt (with a full-log file path) on failure.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": [
                            "type": "integer",
                            "description": "Zero-based page index whose design+logic to export. Defaults to the active page."
                        ]
                    ]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }

                    if let pageIndex = args["pageIndex"] as? Int {
                        guard design.project.pages.indices.contains(pageIndex) else {
                            return .failure("Page index \(pageIndex) is out of range — the project has \(design.project.pages.count) page(s).")
                        }
                        design.selectPage(index: pageIndex)
                    }
                    let page = design.project.pages[design.currentPageIndex]

                    let appName = LogicExporter.exportAppName(project: design.project)
                    let exportRoot: URL
                    do {
                        let workDir = FileManager.default.temporaryDirectory
                            .appendingPathComponent("AgenticDesignerSimulatorRun", isDirectory: true)
                        try FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
                        exportRoot = try LogicExporter.exportSwiftUISource(
                            project: design.project,
                            flows: page.logicFlows,
                            currentPageId: page.id,
                            to: workDir
                        )
                    } catch {
                        return .failure("Export failed: \(error.localizedDescription)")
                    }

                    do {
                        // The compile+install+launch is slow and blocking —
                        // detach it so this MCP call doesn't freeze the app's
                        // main thread for the whole build, matching the
                        // Task.detached the GUI "Run" button already uses.
                        let result = try await Task.detached {
                            try SimulatorRunner.buildAndLaunch(exportRoot: exportRoot, appName: appName) { _ in }
                        }.value
                        return .text("Running on \(result.deviceName) as \(result.bundleIdentifier).")
                    } catch {
                        return .failure("Run failed: \(error.localizedDescription)")
                    }
                }
            ),

            MCPToolDefinition(
                name: "simulator_screenshot",
                description: """
                Screenshot of the REAL iOS Simulator's current screen (the app launched by \
                run_in_simulator), not the in-app preview. Use this to see the actual compiled \
                app running on the simulator. Requires a booted simulator.
                """,
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { _ in
                    do {
                        let png = try SimulatorControl.screenshotPNG()
                        return MCPToolResult(content: [.image(base64: png.base64EncodedString(), mimeType: "image/png")])
                    } catch {
                        return .failure(error.localizedDescription)
                    }
                }
            ),

            MCPToolDefinition(
                name: "simulator_tap",
                description: """
                Tap the REAL iOS Simulator at a normalized position — x and y are fractions \
                from 0.0 (left/top) to 1.0 (right/bottom) of the device screen. Estimate them \
                from a simulator_screenshot (e.g. a bottom tab ~y=0.96; a centered button \
                ~x=0.5). Drives the actual compiled app, not the in-app preview. Requires a \
                booted simulator and Accessibility permission for AgenticDesigner \
                (System Settings ▸ Privacy & Security ▸ Accessibility). Follow with \
                simulator_screenshot to see the result.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "x": ["type": "number", "description": "Normalized X (0.0–1.0)."],
                        "y": ["type": "number", "description": "Normalized Y (0.0–1.0)."]
                    ],
                    "required": ["x", "y"]
                ],
                handler: { args in
                    guard let x = MCPServerController.number(from: args["x"]),
                          let y = MCPServerController.number(from: args["y"]) else {
                        return .failure("'x' and 'y' must be numbers between 0 and 1.")
                    }
                    do {
                        try SimulatorControl.tap(normX: CGFloat(x), normY: CGFloat(y))
                        return .text("Tapped the simulator at (\(String(format: "%.2f", x)), \(String(format: "%.2f", y))). Call simulator_screenshot to see the result.")
                    } catch {
                        return .failure(error.localizedDescription)
                    }
                }
            ),

            MCPToolDefinition(
                name: "simulator_type",
                description: """
                Type text into the REAL iOS Simulator's currently focused field (tap the field \
                first with simulator_tap). Drives the actual compiled app. Requires a booted \
                simulator and Accessibility permission for AgenticDesigner.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": ["text": ["type": "string", "description": "Text to type."]],
                    "required": ["text"]
                ],
                handler: { args in
                    guard let text = args["text"] as? String else {
                        return .failure("'text' is required.")
                    }
                    do {
                        try SimulatorControl.typeText(text)
                        return .text("Typed \"\(text)\" into the simulator.")
                    } catch {
                        return .failure(error.localizedDescription)
                    }
                }
            ),

            MCPToolDefinition(
                name: "get_logic_flows",
                description: """
                JSON of the logic flows (block programs: events, actions, conditions, \
                Firebase/API calls and their connections) attached to a page (default: the \
                active page).
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": [
                            "type": "integer",
                            "description": "Zero-based page index. Omit for the active page."
                        ]
                    ]
                ],
                handler: { [weak self] args in
                    guard let viewModel = self?.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let page = try Self.page(in: viewModel, at: args["pageIndex"] as? Int)

                    guard !page.logicFlows.isEmpty else {
                        return .text("Page \"\(page.name)\" has no logic flows yet.")
                    }

                    let encoder = JSONEncoder()
                    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
                    let json = String(data: try encoder.encode(page.logicFlows), encoding: .utf8) ?? "[]"
                    return .text("Page \"\(page.name)\" — \(page.logicFlows.count) flow(s):\n\(json)")
                }
            ),

            MCPToolDefinition(
                name: "enable_git_sync",
                description: "Turn git sync ON (or off) for this project: a real local git repository (Application Support/AgenticDesigner/GitRepos/<project>) where every checkpoint becomes a commit — the design document diffs line-by-line — and every export_xcode_project / export_ios_source is mirrored and committed under Exports/. Enabling makes the initial commit immediately. Pair with push_to_github to publish.",
                inputSchema: [
                    "type": "object",
                    "properties": ["enabled": ["type": "boolean", "description": "true (default) to enable, false to stop auto-commits (the repo and its history are kept)."]],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let enabled = args["enabled"] as? Bool ?? true
                    if !enabled {
                        GitSyncService.disable(projectName: design.project.name)
                        return .text("Git sync disabled. The repo and its history are kept on disk; enable_git_sync resumes committing.")
                    }
                    let repo = try GitSyncService.enable(project: design.project)
                    return .text("""
                    Git sync ON — repo: \(repo.path)
                    Every checkpoint now auto-commits, and exports are mirrored into Exports/. \
                    git_status shows history; push_to_github publishes the repo.
                    """)
                }
            ),

            MCPToolDefinition(
                name: "git_status",
                description: "Show the project's git sync state: repo path, branch, commit count, uncommitted changes, remote, and the last 5 commits.",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { [weak self] _ in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    return .text(try GitSyncService.status(projectName: design.project.name))
                }
            ),

            MCPToolDefinition(
                name: "git_commit",
                description: "Commit the current project state to the sync repo right now (checkpoints already auto-commit; use this to mark a milestone with a meaningful message).",
                inputSchema: [
                    "type": "object",
                    "properties": ["message": ["type": "string", "description": "Commit message, e.g. 'onboarding flow wired to Firebase auth'."]],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    return .text(try GitSyncService.commitNow(project: design.project, message: args["message"] as? String))
                }
            ),

            MCPToolDefinition(
                name: "push_to_github",
                description: "Publish the sync repo to GitHub. With an existing 'origin' remote it pushes; otherwise it creates the repository via the GitHub CLI (gh, must be installed and authenticated) and pushes. The current project state is committed first so the push is never stale.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "repo_name": ["type": "string", "description": "GitHub repository name (default: derived from the project name)."],
                        "private": ["type": "boolean", "description": "Create as private (default true). Ignored when 'origin' already exists."]
                    ],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let result = try GitSyncService.push(
                        project: design.project,
                        repoName: args["repo_name"] as? String,
                        isPrivate: args["private"] as? Bool ?? true
                    )
                    return .text(result)
                }
            ),

            MCPToolDefinition(
                name: "get_generated_code",
                description: "Code Mode over MCP: the exact Swift source the exporter WILL produce for the current design + logic, generated live without exporting anything to a path you have to manage. No 'file' → list every generated file with line counts. With 'file' → return that file's full content. Same code path as export_ios_source, so what you read here is what ships.",
                inputSchema: [
                    "type": "object",
                    "properties": ["file": ["type": "string", "description": "A file from the list, matched by full relative path, suffix, or bare file name (e.g. 'StateStore.swift')."]],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    logic.attach(to: design)
                    let combined = logic.flows + design.project.pages.flatMap(\.logicFlows)
                    var seen: Set<UUID> = []
                    let flows = combined.filter { seen.insert($0.id).inserted }
                    let pageId = design.project.pages.indices.contains(design.currentPageIndex)
                        ? design.project.pages[design.currentPageIndex].id : nil
                    let files = try GeneratedSourcePreview.generate(
                        project: design.project, flows: flows, currentPageId: pageId
                    )
                    guard let query = (args["file"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !query.isEmpty else {
                        let lines = files.map { "\($0.relativePath) — \($0.lineCount) lines" }
                        return .text("Generated source (\(files.count) files) — pass 'file' to read one:\n" + lines.joined(separator: "\n"))
                    }
                    let match = files.first { $0.relativePath == query }
                        ?? files.first { $0.relativePath.hasSuffix(query) }
                        ?? files.first { $0.fileName == query }
                    guard let match else {
                        return .failure("No generated file matches '\(query)'. Call get_generated_code without arguments to list files.")
                    }
                    let origin = match.isOverridden ? "EDITED (source override — set_source_override to change, clear_source_override to revert)" : "generated live"
                    return .text("// \(match.relativePath) — \(match.lineCount) lines, \(origin)\n\(match.content)")
                }
            ),

            MCPToolDefinition(
                name: "set_source_override",
                description: "EDIT the generated code: store hand-written content for one generated .swift file (matched by file name from get_generated_code). The override wins over generation everywhere — Code Mode, export_ios_source, export_xcode_project, run_in_simulator — until cleared. Checkpointed first. Run typecheck_generated afterwards to prove the edit still compiles.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "file": ["type": "string", "description": "Generated .swift file name, e.g. 'LoginScreenView.swift'."],
                        "content": ["type": "string", "description": "The full replacement source for that file."]
                    ],
                    "required": ["file", "content"]
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    guard let file = (args["file"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                          file.hasSuffix(".swift") else {
                        return .failure("'file' must be a generated .swift file name (see get_generated_code).")
                    }
                    guard let content = args["content"] as? String, !content.isEmpty else {
                        return .failure("'content' is required — the full replacement source.")
                    }
                    logic.attach(to: design)
                    let combined = logic.flows + design.project.pages.flatMap(\.logicFlows)
                    var seen: Set<UUID> = []
                    let flows = combined.filter { seen.insert($0.id).inserted }
                    let pageId = design.project.pages.indices.contains(design.currentPageIndex)
                        ? design.project.pages[design.currentPageIndex].id : nil
                    let files = try GeneratedSourcePreview.generate(
                        project: design.project, flows: flows, currentPageId: pageId
                    )
                    guard files.contains(where: { $0.fileName == file }) else {
                        return .failure("'\(file)' is not part of the generated tree — get_generated_code lists valid names.")
                    }
                    CheckpointStore.save(design.project, label: "before code edit: \(file)")
                    var overrides = design.project.sourceOverrides ?? [:]
                    overrides[file] = content
                    design.project.sourceOverrides = overrides
                    return .text("Source override stored for \(file) (\(content.split(separator: "\n", omittingEmptySubsequences: false).count) lines). It now replaces the generated version in every export. NEXT: typecheck_generated to prove the project still compiles.")
                }
            ),

            MCPToolDefinition(
                name: "clear_source_override",
                description: "Revert hand-edited generated code back to pure generation. With 'file', clears that one override; without, clears ALL overrides. Checkpointed first.",
                inputSchema: [
                    "type": "object",
                    "properties": ["file": ["type": "string", "description": "File name to revert (omit to revert every override)."]],
                    "required": []
                ],
                handler: { [weak self] args in
                    guard let self, let design = self.designViewModel else { throw MCPToolError("Designer is not available.") }
                    let existing = design.project.sourceOverrides ?? [:]
                    guard !existing.isEmpty else { return .text("No source overrides are set.") }
                    if let file = (args["file"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !file.isEmpty {
                        guard existing[file] != nil else {
                            return .failure("No override for '\(file)'. Current overrides: \(existing.keys.sorted().joined(separator: ", "))")
                        }
                        CheckpointStore.save(design.project, label: "before code revert: \(file)")
                        design.project.sourceOverrides?[file] = nil
                        if design.project.sourceOverrides?.isEmpty == true { design.project.sourceOverrides = nil }
                        return .text("Override cleared — \(file) is generated again.")
                    }
                    CheckpointStore.save(design.project, label: "before code revert: all")
                    design.project.sourceOverrides = nil
                    return .text("All \(existing.count) override(s) cleared — the whole tree is generated again.")
                }
            ),

            MCPToolDefinition(
                name: "typecheck_generated",
                description: "RECOMPILE check: exports the current design + logic + source overrides to a temp directory and runs the real iOS-simulator swiftc in typecheck mode over every generated .swift. Returns Build OK or per-file error/warning diagnostics (file:line:column). Run this after set_source_override — an edit that doesn't compile is a lie waiting for export time.",
                inputSchema: ["type": "object", "properties": [:]],
                handler: { [weak self] _ in
                    guard let self, let design = self.designViewModel, let logic = self.logicViewModel else {
                        throw MCPToolError("Designer is not available.")
                    }
                    logic.attach(to: design)
                    let combined = logic.flows + design.project.pages.flatMap(\.logicFlows)
                    var seen: Set<UUID> = []
                    let flows = combined.filter { seen.insert($0.id).inserted }
                    let pageId = design.project.pages.indices.contains(design.currentPageIndex)
                        ? design.project.pages[design.currentPageIndex].id : nil
                    let result = try GeneratedSourcePreview.typecheck(
                        project: design.project, flows: flows, currentPageId: pageId
                    )
                    if result.success && result.diagnostics.isEmpty {
                        return .text("Build OK ✓ — \(result.checkedFileCount) files typechecked, no diagnostics.")
                    }
                    let lines = result.diagnostics.map { "\($0.severity.uppercased()) \($0.fileName):\($0.line):\($0.column) — \($0.message)" }
                    let verdict = result.success ? "Build OK (with warnings)" : "BUILD FAILED"
                    return result.success
                        ? .text("\(verdict) — \(result.checkedFileCount) files.\n" + lines.joined(separator: "\n"))
                        : .failure("\(verdict) — fix these (set_source_override or design/logic changes), then re-run:\n" + lines.joined(separator: "\n"))
                }
            )
        ] + makePDFTools()
    }


    // MARK: - PDF Editor tools

    private func makePDFTools() -> [MCPToolDefinition] {
        [
            MCPToolDefinition(
                name: "pdf_open",
                description: "Open a PDF file at an absolute path into PDF Editor mode, replacing whatever's currently open there.",
                inputSchema: [
                    "type": "object",
                    "properties": ["path": ["type": "string", "description": "Absolute path to a .pdf file"]],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel else { throw MCPToolError("PDF Editor is not available.") }
                    guard let path = args["path"] as? String else { throw MCPToolError("Missing 'path'.") }
                    do {
                        try pdf.open(url: URL(fileURLWithPath: (path as NSString).expandingTildeInPath))
                        return .text("Opened \(path) — \(pdf.pageCount) page(s).")
                    } catch {
                        return .failure(error.localizedDescription)
                    }
                }
            ),

            MCPToolDefinition(
                name: "pdf_new",
                description: "Create a new blank PDF (US Letter by default) in PDF Editor mode.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "width": ["type": "number", "description": "Page width in points. Default 612 (US Letter)."],
                        "height": ["type": "number", "description": "Page height in points. Default 792 (US Letter)."]
                    ]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel else { throw MCPToolError("PDF Editor is not available.") }
                    let width = (args["width"] as? Double).map { CGFloat($0) } ?? 612
                    let height = (args["height"] as? Double).map { CGFloat($0) } ?? 792
                    pdf.newDocument(pageSize: CGSize(width: width, height: height))
                    return .text("Created a new PDF (\(Int(width))×\(Int(height))pt).")
                }
            ),

            MCPToolDefinition(
                name: "get_pdf_info",
                description: "Overview of the open PDF: page count, page sizes/rotation, metadata, file path, unsaved-changes flag. Call this first to orient yourself.",
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { [weak self] _ in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    return .text(Self.pdfInfoJSON(pdf))
                }
            ),

            MCPToolDefinition(
                name: "get_pdf_page_text",
                description: "Extract the plain text of one PDF page.",
                inputSchema: [
                    "type": "object",
                    "properties": ["pageIndex": ["type": "integer", "description": "Zero-based page index."]],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    let text = pdf.pageText(at: index)
                    return .text(text.isEmpty ? "(no extractable text on page \(index + 1) — it may be scanned/image-only)" : text)
                }
            ),

            MCPToolDefinition(
                name: "get_pdf_page_image",
                description: "Rendered image of one PDF page (JPEG) — use to visually verify edits, since text-based tools can't see drawings/images/layout.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer", "description": "Zero-based page index."],
                        "maxDimension": ["type": "integer", "description": "Longest edge in pixels. Default 1000."]
                    ],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }

                    let maxDimension = CGFloat((args["maxDimension"] as? Int) ?? 1000)
                    let bounds = page.bounds(for: .mediaBox)
                    let scale = bounds.width > 0 && bounds.height > 0 ? maxDimension / max(bounds.width, bounds.height) : 1
                    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
                    let thumbnail = page.thumbnail(of: size, for: .mediaBox)

                    guard let tiff = thumbnail.tiffRepresentation,
                          let rep = NSBitmapImageRep(data: tiff),
                          let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: 0.85])
                    else {
                        throw MCPToolError("Couldn't render page \(index + 1).")
                    }
                    return MCPToolResult(content: [.image(base64: jpeg.base64EncodedString(), mimeType: "image/jpeg")])
                }
            ),

            MCPToolDefinition(
                name: "list_pdf_annotations",
                description: "List every annotation (comments, highlights, drawings, signatures, form fields, shapes, text edits) on one page, with type/bounds/contents.",
                inputSchema: [
                    "type": "object",
                    "properties": ["pageIndex": ["type": "integer", "description": "Zero-based page index."]],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                    guard !page.annotations.isEmpty else { return .text("Page \(index + 1) has no annotations.") }

                    let items: [[String: Any]] = page.annotations.enumerated().map { i, annotation in
                        [
                            "index": i,
                            "type": annotation.type ?? "Unknown",
                            "bounds": Self.rectJSON(annotation.bounds),
                            "contents": annotation.contents ?? ""
                        ]
                    }
                    let data = try JSONSerialization.data(withJSONObject: items, options: [.prettyPrinted, .sortedKeys])
                    return .text(String(data: data, encoding: .utf8) ?? "[]")
                }
            ),

            // MARK: Page structure

            MCPToolDefinition(
                name: "pdf_add_page",
                description: "Insert a new blank page after the given index (or at the end if omitted).",
                inputSchema: [
                    "type": "object",
                    "properties": ["afterPageIndex": ["type": "integer", "description": "Zero-based page index to insert after. Omit to append at the end."]]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let after = args["afterPageIndex"] as? Int ?? (pdf.pageCount - 1)
                    pdf.addPage(after: after)
                    return .text("Added a page — now \(pdf.pageCount) page(s).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_remove_page",
                description: "Delete a page (a document must keep at least one page).",
                inputSchema: [
                    "type": "object",
                    "properties": ["pageIndex": ["type": "integer"]],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard pdf.pageCount > 1 else { throw MCPToolError("Can't remove the only page in the document.") }
                    pdf.removePage(at: index)
                    return .text("Removed page \(index + 1) — now \(pdf.pageCount) page(s).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_duplicate_page",
                description: "Duplicate a page (vector content and annotations both copied) and insert the copy right after it.",
                inputSchema: [
                    "type": "object",
                    "properties": ["pageIndex": ["type": "integer"]],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    pdf.duplicatePage(at: index)
                    return .text("Duplicated page \(index + 1).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_reorder_page",
                description: "Move a page to a new position. destinationIndex is where it should land in the FINAL page order.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "destinationIndex": ["type": "integer"]
                    ],
                    "required": ["pageIndex", "destinationIndex"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let from = try Self.requireInt(args, "pageIndex")
                    let to = try Self.requireInt(args, "destinationIndex")
                    try Self.requireValidPage(pdf, from)
                    pdf.reorderPage(from: from, to: to)
                    return .text("Reordered pages.")
                }
            ),

            MCPToolDefinition(
                name: "pdf_rotate_page",
                description: "Rotate a page by a multiple of 90 degrees (can be negative).",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "degrees": ["type": "integer", "description": "e.g. 90, -90, 180"]
                    ],
                    "required": ["pageIndex", "degrees"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    let degrees = try Self.requireInt(args, "degrees")
                    try Self.requireValidPage(pdf, index)
                    pdf.rotatePage(at: index, by: degrees)
                    return .text("Rotated page \(index + 1) by \(degrees)°.")
                }
            ),

            MCPToolDefinition(
                name: "pdf_crop_page",
                description: "Crop a page to a rectangle, in PDF points with origin at the page's bottom-left (PDF coordinate convention).",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "x": ["type": "number"], "y": ["type": "number"],
                        "width": ["type": "number"], "height": ["type": "number"]
                    ],
                    "required": ["pageIndex", "x", "y", "width", "height"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    let rect = try Self.requireRect(args)
                    pdf.cropPage(at: index, to: rect)
                    return .text("Cropped page \(index + 1) to \(Self.rectJSON(rect)).")
                }
            ),

            // MARK: Content editing (overlay-based — see PDFEditorViewModel header)

            MCPToolDefinition(
                name: "pdf_find_text",
                description: "Find occurrences of a string in the open PDF. Returns each match's pageIndex and bounds (PDF points, origin bottom-left) — feed these to pdf_edit_text or annotation tools.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "text": ["type": "string"],
                        "pageIndex": ["type": "integer", "description": "Restrict to one page. Omit to search the whole document."]
                    ],
                    "required": ["text"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    guard let text = args["text"] as? String, !text.isEmpty else { throw MCPToolError("Missing 'text'.") }
                    let pageFilter = args["pageIndex"] as? Int
                    let matches = document.findString(text, withOptions: []).filter { selection in
                        guard let page = selection.pages.first else { return false }
                        return pageFilter.map { document.index(for: page) == $0 } ?? true
                    }
                    guard !matches.isEmpty else { return .text("No matches.") }
                    let items: [[String: Any]] = matches.prefix(25).compactMap { selection in
                        guard let page = selection.pages.first else { return nil }
                        var entry = Self.rectJSON(selection.bounds(for: page))
                        entry["pageIndex"] = document.index(for: page)
                        return entry
                    }
                    let data = try JSONSerialization.data(withJSONObject: ["matchCount": matches.count, "matches": items], options: [.prettyPrinted, .sortedKeys])
                    return .text(String(data: data, encoding: .utf8) ?? "{}")
                }
            ),

            MCPToolDefinition(
                name: "pdf_edit_text",
                description: """
                Replace text on a page. Since PDF text lives in a content stream PDFKit can't \
                rewrite in place, this covers the region with an opaque patch and draws the new \
                text on top — the standard approach consumer PDF editors use. Non-destructive \
                until pdf_export_flattened. Two ways to target the text: pass find (a string \
                that appears in the document — the first match is replaced, font size \
                auto-matched; add pageIndex/occurrence to disambiguate), OR pass explicit \
                x/y/width/height bounds. Add paragraph:true with find to replace the WHOLE \
                paragraph containing the match — the replacement wraps to the paragraph's \
                column width and grows downward if longer.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "find": ["type": "string", "description": "Existing text to locate and replace. Alternative to explicit bounds."],
                        "paragraph": ["type": "boolean", "description": "With find: replace the whole paragraph containing the match instead of just the matched run."],
                        "occurrence": ["type": "integer", "description": "Zero-based match index when find has several hits. Default 0."],
                        "pageIndex": ["type": "integer"],
                        "x": ["type": "number"], "y": ["type": "number"],
                        "width": ["type": "number"], "height": ["type": "number"],
                        "newText": ["type": "string"],
                        "fontSize": ["type": "number", "description": "Omit with find to auto-match the original text's size."],
                        "backgroundColorHex": ["type": "string", "description": "Patch color to match the page background. Default white."],
                        "fitToBounds": ["type": "boolean", "description": "Shrink the replacement font until it fits the target bounds exactly instead of growing the box."]
                    ],
                    "required": ["newText"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    guard let newText = args["newText"] as? String else { throw MCPToolError("Missing 'newText'.") }
                    let background = (args["backgroundColorHex"] as? String).flatMap(Self.color(fromHex:)) ?? .white

                    let page: PDFPage
                    let bounds: CGRect
                    if let find = args["find"] as? String, !find.isEmpty {
                        let pageFilter = args["pageIndex"] as? Int
                        let matches = document.findString(find, withOptions: []).filter { selection in
                            guard let matchPage = selection.pages.first else { return false }
                            return pageFilter.map { document.index(for: matchPage) == $0 } ?? true
                        }
                        let occurrence = args["occurrence"] as? Int ?? 0
                        guard matches.indices.contains(occurrence), let matchPage = matches[occurrence].pages.first else {
                            throw MCPToolError("'\(find)' not found\(pageFilter.map { " on page \($0 + 1)" } ?? "") (\(matches.count) match(es)).")
                        }
                        page = matchPage
                        let matchBounds = matches[occurrence].bounds(for: matchPage)
                        if args["paragraph"] as? Bool == true,
                           let paragraphBlock = pdf.paragraph(at: CGPoint(x: matchBounds.midX, y: matchBounds.midY), on: matchPage) {
                            bounds = paragraphBlock.bounds.insetBy(dx: -2, dy: -1)
                            pdf.annotationStyle.fontSize = (args["fontSize"] as? Double).map { CGFloat($0) }
                                ?? min(72, max(6, paragraphBlock.lineHeight * 0.72))
                        } else {
                            bounds = matchBounds.insetBy(dx: -2, dy: -1)
                            pdf.annotationStyle.fontSize = (args["fontSize"] as? Double).map { CGFloat($0) }
                                ?? min(72, max(6, matchBounds.height * 0.72))
                        }
                    } else {
                        let index = try Self.requireInt(args, "pageIndex")
                        try Self.requireValidPage(pdf, index)
                        guard let boundsPage = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                        page = boundsPage
                        bounds = try Self.requireRect(args)
                        if let fontSize = args["fontSize"] as? Double { pdf.annotationStyle.fontSize = CGFloat(fontSize) }
                    }

                    pdf.annotationStyle.textColor = .black
                    pdf.editText(bounds: bounds, page: page, newText: newText, backgroundColor: background, fitToBounds: args["fitToBounds"] as? Bool ?? false)
                    return .text("Replaced text on page \(document.index(for: page) + 1).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_translate_text",
                description: """
                Translate text in the open PDF using the user's LOCAL models (Ollama/LM \
                Studio — no cloud). Locates the paragraph containing `find` (or just the \
                matched run with paragraph:false), translates it, and patches the \
                translation over the original with RTL-aware alignment. Returns the \
                translation. Set apply:false to only translate without editing the page.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "find": ["type": "string", "description": "Text that appears in the document, identifying what to translate."],
                        "pageIndex": ["type": "integer"],
                        "occurrence": ["type": "integer", "description": "Zero-based match index. Default 0."],
                        "paragraph": ["type": "boolean", "description": "Translate the whole containing paragraph (default true)."],
                        "targetLanguage": ["type": "string", "description": "Defaults to the language picked in the Translate tool settings."],
                        "model": ["type": "string", "description": "Local model name. Defaults to the one picked in the Translate tool settings."],
                        "apply": ["type": "boolean", "description": "Patch the translation over the original (default true)."]
                    ],
                    "required": ["find"]
                ],
                handler: { [weak self] args in
                    guard let self, let pdf = self.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    guard let find = args["find"] as? String, !find.isEmpty else { throw MCPToolError("Missing 'find'.") }

                    let pageFilter = args["pageIndex"] as? Int
                    let matches = document.findString(find, withOptions: []).filter { selection in
                        guard let matchPage = selection.pages.first else { return false }
                        return pageFilter.map { document.index(for: matchPage) == $0 } ?? true
                    }
                    let occurrence = args["occurrence"] as? Int ?? 0
                    guard matches.indices.contains(occurrence), let page = matches[occurrence].pages.first else {
                        throw MCPToolError("'\(find)' not found\(pageFilter.map { " on page \($0 + 1)" } ?? "") (\(matches.count) match(es)).")
                    }

                    let matchBounds = matches[occurrence].bounds(for: page)
                    let sourceText: String
                    let bounds: CGRect
                    let lineHeight: CGFloat
                    if args["paragraph"] as? Bool ?? true,
                       let block = pdf.paragraph(at: CGPoint(x: matchBounds.midX, y: matchBounds.midY), on: page) {
                        sourceText = block.text
                        bounds = block.bounds.insetBy(dx: -2, dy: -1)
                        lineHeight = block.lineHeight
                    } else {
                        sourceText = matches[occurrence].string ?? find
                        bounds = matchBounds.insetBy(dx: -2, dy: -1)
                        lineHeight = matchBounds.height
                    }

                    if let model = args["model"] as? String, !model.isEmpty {
                        if pdf.translator.availableModels.isEmpty { await pdf.translator.refreshModels() }
                        pdf.translator.selectedModel = model
                    } else if pdf.translator.selectedModel.isEmpty {
                        await pdf.translator.refreshModels()
                    }

                    let translated = try await pdf.translator.translate(sourceText, to: args["targetLanguage"] as? String)

                    if args["apply"] as? Bool ?? true {
                        pdf.annotationStyle.fontSize = min(72, max(6, lineHeight * 0.72))
                        pdf.annotationStyle.textColor = .black
                        pdf.editText(bounds: bounds, page: page, newText: translated)
                        return .text("Translated and replaced on page \(document.index(for: page) + 1):\n\(translated)")
                    }
                    return .text(translated)
                }
            ),

            MCPToolDefinition(
                name: "pdf_translate_page",
                description: """
                Translate EVERY prose paragraph AND heading on one page using the user's \
                LOCAL model, patching each translation over its original in place. Figures, \
                images and equations are left untouched: short small-font blocks (figure \
                labels, margin notes), blocks that are mostly symbols/numbers, and \
                already-RTL blocks are skipped. Blocks already patched by an earlier run \
                are skipped too, so re-running a page only fills in what's missing. Runs \
                one local model call per paragraph — expect ~30s each.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "targetLanguage": ["type": "string", "description": "Defaults to the Translate tool's language setting."],
                        "model": ["type": "string", "description": "Local model name. Defaults to the Translate tool's setting."],
                        "minWords": ["type": "integer", "description": "Skip blocks with fewer words (default 6) unless they qualify as headings — filters figure labels and margin notes."],
                        "concurrency": ["type": "integer", "description": "Parallel local-model requests (default 3; Ollama batches them). 1 = sequential."],
                        "includeHeadings": ["type": "boolean", "description": "Also translate short larger-font blocks (chapter/section titles). Default true."]
                    ],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let self, let pdf = self.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }

                    if let model = args["model"] as? String, !model.isEmpty {
                        if pdf.translator.availableModels.isEmpty { await pdf.translator.refreshModels() }
                        pdf.translator.selectedModel = model
                    } else if pdf.translator.selectedModel.isEmpty {
                        await pdf.translator.refreshModels()
                    }
                    let minWords = args["minWords"] as? Int ?? 6
                    let concurrency = max(1, min(args["concurrency"] as? Int ?? 3, 6))
                    _ = page

                    let result = await pdf.translatePage(
                        at: index,
                        targetLanguage: args["targetLanguage"] as? String,
                        minWords: minWords,
                        concurrency: concurrency,
                        includeHeadings: args["includeHeadings"] as? Bool ?? true
                    )
                    // Layout fidelity is reported, not asserted: how each
                    // translated block had to be fitted is the only honest
                    // measure of "the design was preserved".
                    var fitReport = ""
                    if !result.fitOutcomes.isEmpty {
                        let breakdown = result.fitOutcomes
                            .sorted { $0.value > $1.value }
                            .map { "\($0.key.rawValue) \($0.value)" }
                            .joined(separator: ", ")
                        fitReport = "\nFit: \(breakdown) — typography untouched on \(Int(result.typographyPreserved * 100))% of translated blocks."
                    }
                    let memory = pdf.translationMemory(for: args["targetLanguage"] as? String ?? "he")
                    if memory.hits + memory.misses > 0 {
                        fitReport += "\nMemory: \(memory.hits) cache hit(s), \(memory.misses) miss(es) — \(Int(memory.hitRate * 100))% reused; glossary \(memory.glossary.count) term(s)."
                        memory.save()
                    }
                    return .text("Page \(index + 1): translated \(result.translated) paragraph(s) (\(concurrency)-way parallel), skipped \(result.skipped) non-prose block(s)\(result.failed > 0 ? ", \(result.failed) failed" : "").\(fitReport)")
                }
            ),

            MCPToolDefinition(
                name: "pdf_rewrite_page",
                description: """
                FULL-COVERAGE page translation (v2 engine): reconstructs the page's text \
                flow from raw lines — columns, real paragraphs, hyphenation joined — \
                translates complete semantic units with the LOCAL model, and re-typesets \
                each text region from scratch (one clean patch, font size solved to fit). \
                Much higher coverage than pdf_translate_page: margin notes and connective \
                fragments translate too. Equations, figures and structured pages (TOC, \
                tables) stay pinned as-is. Use pdf_revert_page_edits first to redo a page.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "targetLanguage": ["type": "string", "description": "Defaults to the Translate tool's language setting."],
                        "model": ["type": "string", "description": "Local model name. Defaults to the Translate tool's setting."],
                        "concurrency": ["type": "integer", "description": "Parallel local-model requests (default 4)."]
                    ],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let self, let pdf = self.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    if let model = args["model"] as? String, !model.isEmpty {
                        if pdf.translator.availableModels.isEmpty { await pdf.translator.refreshModels() }
                        pdf.translator.selectedModel = model
                    } else if pdf.translator.selectedModel.isEmpty {
                        await pdf.translator.refreshModels()
                    }
                    let concurrency = max(1, min(args["concurrency"] as? Int ?? 4, 6))
                    let result = await pdf.rewritePage(
                        at: index,
                        targetLanguage: args["targetLanguage"] as? String,
                        concurrency: concurrency
                    )
                    return .text("Page \(index + 1): rewrote \(result.translated) paragraph(s), kept \(result.keptOriginal) notation/figure element(s)\(result.failed > 0 ? ", \(result.failed) failed" : "").")
                }
            ),

            MCPToolDefinition(
                name: "pdf_revert_page_edits",
                description: "Remove ALL overlay edits (translation patches and replacement text) from one page, fully restoring its original appearance. Use before re-translating a page whose result was bad.",
                inputSchema: [
                    "type": "object",
                    "properties": ["pageIndex": ["type": "integer"]],
                    "required": ["pageIndex"]
                ],
                handler: { [weak self] args in
                    guard let self, let pdf = self.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                    let removed = pdf.revertOverlayEdits(on: page)
                    return .text("Page \(index + 1): removed \(removed) overlay annotation(s) — original content restored.")
                }
            ),

            MCPToolDefinition(
                name: "pdf_replace_image",
                description: "Replace an image region on a page with a different image (by file path). Covers the original with an opaque patch and stamps the new image on top.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "x": ["type": "number"], "y": ["type": "number"],
                        "width": ["type": "number"], "height": ["type": "number"],
                        "imagePath": ["type": "string", "description": "Absolute path to the replacement image."]
                    ],
                    "required": ["pageIndex", "x", "y", "width", "height", "imagePath"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                    guard let path = args["imagePath"] as? String,
                          let image = NSImage(contentsOfFile: (path as NSString).expandingTildeInPath)
                    else { throw MCPToolError("Couldn't load an image at the given imagePath.") }
                    let bounds = try Self.requireRect(args)
                    pdf.replaceImage(bounds: bounds, page: page, newImage: image)
                    return .text("Replaced image on page \(index + 1).")
                }
            ),

            // MARK: Annotations

            MCPToolDefinition(
                name: "pdf_add_annotation",
                description: """
                Add a comment, highlight, underline, strikeout, text box, or shape (rectangle/\
                circle/line) to a page. kind: comment | highlight | underline | strikeOut | \
                freeText | rectangle | circle | line.
                """,
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "kind": ["type": "string", "enum": ["comment", "highlight", "underline", "strikeOut", "freeText", "rectangle", "circle", "line"]],
                        "x": ["type": "number"], "y": ["type": "number"],
                        "width": ["type": "number"], "height": ["type": "number"],
                        "text": ["type": "string", "description": "Contents for comment/freeText."],
                        "colorHex": ["type": "string"]
                    ],
                    "required": ["pageIndex", "kind", "x", "y", "width", "height"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                    guard let kind = args["kind"] as? String else { throw MCPToolError("Missing 'kind'.") }
                    let bounds = try Self.requireRect(args)
                    let text = args["text"] as? String
                    let color = (args["colorHex"] as? String).flatMap(Self.color(fromHex:))

                    switch kind {
                    case "comment":
                        pdf.addAnnotation(type: .text, bounds: bounds, page: page, contents: text ?? "Comment", color: color)
                    case "highlight":
                        pdf.addAnnotation(type: .highlight, bounds: bounds, page: page, color: color ?? .systemYellow)
                    case "underline":
                        pdf.addAnnotation(type: .underline, bounds: bounds, page: page, color: color ?? .systemBlue)
                    case "strikeOut":
                        pdf.addAnnotation(type: .strikeOut, bounds: bounds, page: page, color: color ?? .systemRed)
                    case "freeText":
                        pdf.addFreeText(bounds: bounds, page: page, text: text ?? "")
                    case "rectangle":
                        pdf.addAnnotation(type: .square, bounds: bounds, page: page, color: color)
                    case "circle":
                        pdf.addAnnotation(type: .circle, bounds: bounds, page: page, color: color)
                    case "line":
                        let line = pdf.addAnnotation(type: .line, bounds: bounds, page: page, color: color)
                        line.startPoint = CGPoint(x: 0, y: bounds.height / 2)
                        line.endPoint = CGPoint(x: bounds.width, y: bounds.height / 2)
                    default:
                        throw MCPToolError("Unknown kind '\(kind)'.")
                    }
                    return .text("Added \(kind) to page \(index + 1).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_add_drawing",
                description: "Add a freehand ink drawing (or a signature — set isSignature) to a page from an array of strokes, each an array of [x,y] points in page coordinates.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "strokes": [
                            "type": "array",
                            "items": ["type": "array", "items": ["type": "array", "items": ["type": "number"], "minItems": 2, "maxItems": 2]]
                        ],
                        "isSignature": ["type": "boolean"],
                        "colorHex": ["type": "string"]
                    ],
                    "required": ["pageIndex", "strokes"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                    guard let rawStrokes = args["strokes"] as? [[[Double]]], !rawStrokes.isEmpty else {
                        throw MCPToolError("'strokes' must be a non-empty array of [[x,y], ...] point lists.")
                    }
                    let strokes: [[CGPoint]] = rawStrokes.map { stroke in
                        stroke.compactMap { pair in pair.count == 2 ? CGPoint(x: pair[0], y: pair[1]) : nil }
                    }
                    if args["isSignature"] as? Bool == true {
                        pdf.addSignature(strokes: strokes, page: page)
                    } else {
                        let color = (args["colorHex"] as? String).flatMap(Self.color(fromHex:))
                        pdf.addInkDrawing(strokes: strokes, page: page, color: color)
                    }
                    return .text("Added drawing to page \(index + 1).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_add_signature_image",
                description: "Stamp a signature image (by file path) onto a page at the given bounds.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "x": ["type": "number"], "y": ["type": "number"],
                        "width": ["type": "number"], "height": ["type": "number"],
                        "imagePath": ["type": "string"]
                    ],
                    "required": ["pageIndex", "x", "y", "width", "height", "imagePath"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                    guard let path = args["imagePath"] as? String,
                          let image = NSImage(contentsOfFile: (path as NSString).expandingTildeInPath)
                    else { throw MCPToolError("Couldn't load an image at the given imagePath.") }
                    let bounds = try Self.requireRect(args)
                    pdf.addSignatureImage(image, bounds: bounds, page: page)
                    return .text("Added signature image to page \(index + 1).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_add_form_field",
                description: "Add an AcroForm field (fillable text field or checkbox) to a page.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "kind": ["type": "string", "enum": ["text", "checkbox"]],
                        "name": ["type": "string", "description": "Field name."],
                        "x": ["type": "number"], "y": ["type": "number"],
                        "width": ["type": "number"], "height": ["type": "number"]
                    ],
                    "required": ["pageIndex", "kind", "name", "x", "y", "width", "height"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let index = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, index)
                    guard let page = document.page(at: index) else { throw MCPToolError("Page \(index + 1) not found.") }
                    guard let kind = args["kind"] as? String, let name = args["name"] as? String else {
                        throw MCPToolError("Missing 'kind' or 'name'.")
                    }
                    let bounds = try Self.requireRect(args)
                    pdf.addFormField(kind: kind == "checkbox" ? .formCheckbox : .formTextField, bounds: bounds, page: page, name: name)
                    return .text("Added \(kind) field '\(name)' to page \(index + 1).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_remove_annotation",
                description: "Remove one annotation by its index in list_pdf_annotations' output for that page.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "pageIndex": ["type": "integer"],
                        "annotationIndex": ["type": "integer"]
                    ],
                    "required": ["pageIndex", "annotationIndex"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, let document = pdf.document else { throw MCPToolError("No PDF is open.") }
                    let pageIndex = try Self.requireInt(args, "pageIndex")
                    try Self.requireValidPage(pdf, pageIndex)
                    guard let page = document.page(at: pageIndex) else { throw MCPToolError("Page \(pageIndex + 1) not found.") }
                    let annotationIndex = try Self.requireInt(args, "annotationIndex")
                    guard page.annotations.indices.contains(annotationIndex) else {
                        throw MCPToolError("Annotation index \(annotationIndex) out of range — page \(pageIndex + 1) has \(page.annotations.count).")
                    }
                    pdf.removeAnnotation(page.annotations[annotationIndex])
                    return .text("Removed annotation \(annotationIndex) from page \(pageIndex + 1).")
                }
            ),

            // MARK: Metadata

            MCPToolDefinition(
                name: "get_pdf_metadata",
                description: "Read the PDF's document metadata (title, author, subject, keywords).",
                inputSchema: ["type": "object", "properties": [String: Any]()],
                handler: { [weak self] _ in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    let m = pdf.metadata
                    let data = try JSONSerialization.data(withJSONObject: [
                        "title": m.title, "author": m.author, "subject": m.subject, "keywords": m.keywords
                    ], options: [.prettyPrinted, .sortedKeys])
                    return .text(String(data: data, encoding: .utf8) ?? "{}")
                }
            ),

            MCPToolDefinition(
                name: "set_pdf_metadata",
                description: "Update the PDF's document metadata. Omitted fields are left unchanged.",
                inputSchema: [
                    "type": "object",
                    "properties": [
                        "title": ["type": "string"], "author": ["type": "string"],
                        "subject": ["type": "string"], "keywords": ["type": "string"]
                    ]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    if let v = args["title"] as? String { pdf.metadata.title = v }
                    if let v = args["author"] as? String { pdf.metadata.author = v }
                    if let v = args["subject"] as? String { pdf.metadata.subject = v }
                    if let v = args["keywords"] as? String { pdf.metadata.keywords = v }
                    return .text("Updated metadata.")
                }
            ),

            // MARK: Save / export

            MCPToolDefinition(
                name: "pdf_save",
                description: "Save the open PDF (in place, preserving annotations non-destructively) to an absolute path. Overwrites if it exists.",
                inputSchema: [
                    "type": "object",
                    "properties": ["path": ["type": "string"]],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    guard let path = args["path"] as? String else { throw MCPToolError("Missing 'path'.") }
                    let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
                    pdf.fileURL = url
                    guard pdf.save() else { throw MCPToolError("Save failed.") }
                    return .text("Saved to \(url.path).")
                }
            ),

            MCPToolDefinition(
                name: "pdf_export_flattened",
                description: "Export the PDF with every overlay edit (text replacements, image replacements) baked permanently into the page pixels — use this for a copy that looks right in ANY PDF viewer, not just this app.",
                inputSchema: [
                    "type": "object",
                    "properties": ["path": ["type": "string"]],
                    "required": ["path"]
                ],
                handler: { [weak self] args in
                    guard let pdf = self?.pdfViewModel, pdf.document != nil else { throw MCPToolError("No PDF is open.") }
                    guard let path = args["path"] as? String else { throw MCPToolError("Missing 'path'.") }
                    let url = URL(fileURLWithPath: (path as NSString).expandingTildeInPath)
                    guard pdf.exportFlattened(to: url) else { throw MCPToolError("Export failed.") }
                    return .text("Exported flattened PDF to \(url.path).")
                }
            )
        ]
    }

    // MARK: - PDF tool helpers

    private static func requireInt(_ args: [String: Any], _ key: String) throws -> Int {
        if let value = args[key] as? Int { return value }
        if let value = args[key] as? Double { return Int(value) }
        throw MCPToolError("Missing or invalid integer '\(key)'.")
    }

    private static func requireRect(_ args: [String: Any]) throws -> CGRect {
        guard let x = args["x"] as? Double ?? (args["x"] as? Int).map(Double.init),
              let y = args["y"] as? Double ?? (args["y"] as? Int).map(Double.init),
              let width = args["width"] as? Double ?? (args["width"] as? Int).map(Double.init),
              let height = args["height"] as? Double ?? (args["height"] as? Int).map(Double.init)
        else { throw MCPToolError("Missing or invalid 'x'/'y'/'width'/'height'.") }
        return CGRect(x: x, y: y, width: max(1, width), height: max(1, height))
    }

    private static func requireValidPage(_ pdf: PDFEditorViewModel, _ index: Int) throws {
        guard (0..<pdf.pageCount).contains(index) else {
            throw MCPToolError("Page index \(index) is out of range — the document has \(pdf.pageCount) page(s).")
        }
    }

    private static func rectJSON(_ rect: CGRect) -> [String: Any] {
        ["x": rect.origin.x, "y": rect.origin.y, "width": rect.width, "height": rect.height]
    }

    private static func color(fromHex hex: String) -> NSColor? {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        guard Scanner(string: cleaned).scanHexInt64(&value), cleaned.count == 6 || cleaned.count == 8 else { return nil }
        let r, g, b, a: UInt64
        if cleaned.count == 8 {
            (r, g, b, a) = ((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
        } else {
            (r, g, b, a) = ((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255)
        }
        return NSColor(red: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: CGFloat(a) / 255)
    }

    private static func pdfInfoJSON(_ pdf: PDFEditorViewModel) -> String {
        let pages: [[String: Any]] = pdf.pages.map { summary in
            ["index": summary.id, "width": summary.size.width, "height": summary.size.height, "rotation": summary.rotation]
        }
        let payload: [String: Any] = [
            "filePath": pdf.fileURL?.path ?? "(unsaved)",
            "pageCount": pdf.pageCount,
            "isDirty": pdf.isDirty,
            "currentPageIndex": pdf.currentPageIndex,
            "metadata": [
                "title": pdf.metadata.title, "author": pdf.metadata.author,
                "subject": pdf.metadata.subject, "keywords": pdf.metadata.keywords
            ],
            "pages": pages
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else { return "{}" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private static func applyLogicActions(_ actions: [[String: Any]], logic: LogicViewModel) -> String {
        var flowRefs: [String: UUID] = [:]
        var blockRefs: [String: UUID] = [:]
        var applied = 0
        var skipped: [String] = []

        for (index, action) in actions.enumerated() {
            guard let rawType = action["type"] as? String,
                  let type = MCPLogicActionType(rawValue: rawType)
            else {
                skipped.append("#\(index + 1): missing or unsupported type")
                continue
            }

            switch type {
            case .createFlow:
                let name = action["name"] as? String ?? "Flow \(logic.flows.count + 1)"
                let screenId = uuid(from: action["screenNodeId"])
                logic.createFlow(name: name, screenId: screenId)
                guard let flowId = logic.currentFlowId else {
                    skipped.append("#\(index + 1): flow could not be created")
                    continue
                }
                if let ref = action["flowReference"] as? String {
                    flowRefs[ref] = flowId
                }
                applied += 1

            case .createBlock:
                guard let rawBlockType = action["blockType"] as? String,
                      let blockType = LogicBlockType(rawValue: rawBlockType)
                else {
                    skipped.append("#\(index + 1): missing or unsupported blockType")
                    continue
                }

                guard selectFlow(for: action, logic: logic, flowRefs: flowRefs) else {
                    skipped.append("#\(index + 1): target flow not found")
                    continue
                }

                let point = CGPoint(
                    x: CGFloat(number(from: action["x"]) ?? 0),
                    y: CGFloat(number(from: action["y"]) ?? 0)
                )
                guard var block = BlockCatalog.makeBlock(type: blockType, at: point),
                      let flowIndex = logic.flows.firstIndex(where: { $0.id == logic.currentFlowId })
                else {
                    skipped.append("#\(index + 1): block could not be created")
                    continue
                }

                if let label = action["label"] as? String {
                    block.label = label
                }
                if let connectedNodeId = uuid(from: action["connectedDesignNodeId"]) {
                    block.connectedDesignNodeId = connectedNodeId
                }
                let unknownKeys = applyParameterMap(action["parameters"] as? [String: Any], to: &block)
                if !unknownKeys.isEmpty {
                    let valid = block.parameters.map(\.key).joined(separator: ", ")
                    skipped.append("#\(index + 1): \(blockType.rawValue) has no parameter(s) \(unknownKeys.sorted().joined(separator: ", ")) — they were IGNORED. Valid keys: \(valid)")
                }

                logic.snapshot()
                logic.flows[flowIndex].blocks.append(block)
                logic.selectedBlockId = block.id
                logic.persist()
                logic.validate()

                // A Bind Property block installs a live node↔variable binding
                // (e.g. a search TextField writing to `searchQuery`). The GUI
                // does this on parameter edits; do it here so MCP-created
                // bindProperty blocks actually bind.
                if blockType == .bindProperty,
                   let elementId = block.parameters.first(where: { $0.key == "element" })?.nodeReference,
                   let property = block.parameters.first(where: { $0.key == "property" })?.value,
                   let kind = NodeLogicBindingKind(rawValue: property) {
                    logic.designViewModel?.setLogicBinding(nodeId: elementId,
                                           kind: kind,
                                           variableName: block.parameters.first(where: { $0.key == "variable" })?.variableReference)
                }

                if let ref = action["blockReference"] as? String ?? action["nodeReference"] as? String {
                    blockRefs[ref] = block.id
                }
                applied += 1

            case .connectBlocks:
                guard selectFlow(for: action, logic: logic, flowRefs: flowRefs) else {
                    skipped.append("#\(index + 1): target flow not found")
                    continue
                }
                guard let sourceId = blockId(from: action, idKey: "sourceBlockId", refKey: "sourceReference", blockRefs: blockRefs),
                      let targetId = blockId(from: action, idKey: "targetBlockId", refKey: "targetReference", blockRefs: blockRefs)
                else {
                    skipped.append("#\(index + 1): source or target block not found")
                    continue
                }
                let sourcePort = Int(number(from: action["sourcePort"]) ?? 0)
                let targetPort = Int(number(from: action["targetPort"]) ?? 0)
                if logic.connectBlocks(from: sourceId, port: sourcePort, to: targetId, targetPort: targetPort) {
                    applied += 1
                } else {
                    skipped.append("#\(index + 1): connection rejected by validation")
                }

            case .createVariable:
                guard let name = action["name"] as? String, !name.isEmpty else {
                    skipped.append("#\(index + 1): createVariable needs a name")
                    continue
                }
                let varType = VariableType(rawValue: action["varType"] as? String ?? "string") ?? .string
                let scope = VariableScope(rawValue: action["scope"] as? String ?? "global") ?? .global
                // Non-global scopes attach to a flow — select it first.
                if scope != .global {
                    guard selectFlow(for: action, logic: logic, flowRefs: flowRefs) else {
                        skipped.append("#\(index + 1): createVariable with scope '\(scope.rawValue)' needs flowId/flowReference")
                        continue
                    }
                }
                logic.addVariable(name: name, type: varType, scope: scope, defaultValue: action["defaultValue"] as? String)
                applied += 1

            case .updateVariable:
                guard let name = action["name"] as? String, !name.isEmpty,
                      let newValue = action["defaultValue"] as? String else {
                    skipped.append("#\(index + 1): updateVariable needs a name and defaultValue")
                    continue
                }
                guard let design = logic.designViewModel,
                      let varIndex = design.project.globalVariables.firstIndex(where: { $0.name == name }) else {
                    skipped.append("#\(index + 1): no global variable named '\(name)'")
                    continue
                }
                design.project.globalVariables[varIndex].defaultValue = newValue
                logic.persist()
                applied += 1

            case .updateParameter:
                guard selectFlow(for: action, logic: logic, flowRefs: flowRefs) else {
                    skipped.append("#\(index + 1): target flow not found")
                    continue
                }
                guard let targetId = blockId(from: action, idKey: "blockId", refKey: "blockReference", blockRefs: blockRefs),
                      let key = action["key"] as? String,
                      let flowIndex = logic.flows.firstIndex(where: { $0.id == logic.currentFlowId }),
                      let blockIndex = logic.flows[flowIndex].blocks.firstIndex(where: { $0.id == targetId }),
                      let paramIndex = logic.flows[flowIndex].blocks[blockIndex].parameters.firstIndex(where: { $0.key == key })
                else {
                    skipped.append("#\(index + 1): parameter target not found")
                    continue
                }

                logic.snapshot()
                setParameter(
                    &logic.flows[flowIndex].blocks[blockIndex].parameters[paramIndex],
                    value: action["value"],
                    nodeId: action["nodeId"],
                    variableName: action["variableName"]
                )
                logic.persist()
                logic.validate()
                applied += 1

            case .deleteBlock:
                guard let targetId = blockId(from: action, idKey: "blockId", refKey: "blockReference", blockRefs: blockRefs) else {
                    skipped.append("#\(index + 1): block not found")
                    continue
                }
                logic.deleteBlock(id: targetId)
                applied += 1

            case .deleteFlow:
                let flowId = flowId(from: action, flowRefs: flowRefs)
                guard let flowId,
                      let flowIndex = logic.flows.firstIndex(where: { $0.id == flowId })
                else {
                    skipped.append("#\(index + 1): flow not found")
                    continue
                }
                logic.snapshot()
                logic.flows.remove(at: flowIndex)
                logic.currentFlowId = logic.flows.first?.id
                logic.persist()
                logic.validate()
                applied += 1
            }
        }

        var summary = "Applied \(applied) of \(actions.count) logic action(s)."
        if !flowRefs.isEmpty {
            summary += "\nCreated flow ids by reference:\n" + flowRefs
                .sorted { $0.key < $1.key }
                .map { "  \($0.key) → \($0.value.uuidString)" }
                .joined(separator: "\n")
        }
        if !blockRefs.isEmpty {
            summary += "\nCreated block ids by reference:\n" + blockRefs
                .sorted { $0.key < $1.key }
                .map { "  \($0.key) → \($0.value.uuidString)" }
                .joined(separator: "\n")
        }
        if !skipped.isEmpty {
            summary += "\nSkipped:\n" + skipped.map { "  \($0)" }.joined(separator: "\n")
        }
        // Proactive product-truth check: surface the exact trap where auth
        // blocks point at UI nodes that carry no value binding, so the exported
        // call ships empty credentials — caught here, at creation, not later.
        let traps = authTrapWarnings(logic: logic)
        if !traps.isEmpty {
            summary += "\n\n⚠️ PRODUCT-TRUTH WARNING — this will export EMPTY credentials:\n"
                + traps.map { "  • \($0)" }.joined(separator: "\n")
        }
        return summary
    }

    /// Auth blocks whose email/password point at an input node that has no
    /// value/text binding: at export the credential resolves to "" and login
    /// silently fails. Bind the input to a state variable first.
    private static func authTrapWarnings(logic: LogicViewModel) -> [String] {
        guard let design = logic.designViewModel else { return [] }
        var boundInputs: Set<UUID> = []
        var nodeNames: [UUID: String] = [:]
        func walk(_ node: DesignNode) {
            nodeNames[node.id] = node.name
            if node.logicBindings?.contains(where: { $0.kind == .value || $0.kind == .text }) == true {
                boundInputs.insert(node.id)
            }
            node.children.forEach(walk)
        }
        for page in design.project.pages { page.nodes.forEach(walk) }

        let credentialBlocks: Set<LogicBlockType> = [
            .firebaseLogin, .firebaseRegister, .firebaseResetPassword,
            .supabaseSignIn, .supabaseSignUp
        ]
        var warnings: [String] = []
        for flow in logic.flows {
            for block in flow.blocks where credentialBlocks.contains(block.type) {
                for param in block.parameters where ["email", "password"].contains(param.key) {
                    guard let ref = param.nodeReference, !boundInputs.contains(ref) else { continue }
                    let name = nodeNames[ref] ?? "input"
                    warnings.append("\(block.label): '\(param.key)' points at input '\(name)' with NO value binding — the exported call sends \"\". Add a bindProperty block (kind=value) tying that input to a state variable, and point the auth block at that variable.")
                }
            }
        }
        return warnings
    }

    private static func selectFlow(
        for action: [String: Any],
        logic: LogicViewModel,
        flowRefs: [String: UUID]
    ) -> Bool {
        guard let flowId = flowId(from: action, flowRefs: flowRefs) else {
            return logic.currentFlowId != nil
        }
        guard logic.flows.contains(where: { $0.id == flowId }) else { return false }
        logic.currentFlowId = flowId
        return true
    }

    private static func flowId(from action: [String: Any], flowRefs: [String: UUID]) -> UUID? {
        if let id = uuid(from: action["flowId"]) { return id }
        if let ref = action["flowReference"] as? String { return flowRefs[ref] }
        return nil
    }

    private static func blockId(
        from action: [String: Any],
        idKey: String,
        refKey: String,
        blockRefs: [String: UUID]
    ) -> UUID? {
        if let id = uuid(from: action[idKey]) { return id }
        if let ref = action[refKey] as? String { return blockRefs[ref] }
        return nil
    }

    /// Applies a {key: value} map to a block, returning the keys that the block
    /// has no parameter for. Those used to be dropped in silence, which is how a
    /// win condition written as {left, right} instead of {leftValue, rightValue}
    /// shipped as `if "" <= ""` — always true — with the tool reporting success.
    @discardableResult
    private static func applyParameterMap(_ raw: [String: Any]?, to block: inout LogicBlock) -> [String] {
        guard let raw else { return [] }
        var unknown: [String] = []
        for (key, value) in raw {
            guard let index = block.parameters.firstIndex(where: { $0.key == key }) else {
                unknown.append(key)
                continue
            }
            if let config = value as? [String: Any] {
                setParameter(
                    &block.parameters[index],
                    value: config["value"],
                    nodeId: config["nodeId"],
                    variableName: config["variableName"]
                )
            } else {
                setParameter(&block.parameters[index], value: value, nodeId: nil, variableName: nil)
            }
        }
        return unknown
    }

    private static func setParameter(
        _ parameter: inout BlockParameter,
        value: Any?,
        nodeId: Any?,
        variableName: Any?
    ) {
        if let nodeId = uuid(from: nodeId) {
            parameter.nodeReference = nodeId
        }
        if let variableName = variableName as? String {
            parameter.variableReference = variableName
        }
        if let value {
            parameter.value = string(from: value)
        }
    }

    private static func uuid(from value: Any?) -> UUID? {
        if let uuid = value as? UUID { return uuid }
        if let string = value as? String { return UUID(uuidString: string) }
        return nil
    }

    private static func number(from value: Any?) -> Double? {
        if let double = value as? Double { return double }
        if let int = value as? Int { return Double(int) }
        if let string = value as? String { return Double(string) }
        return nil
    }

    private static func string(from value: Any) -> String {
        if let string = value as? String { return string }
        if let bool = value as? Bool { return bool ? "true" : "false" }
        if let number = value as? NSNumber { return number.stringValue }
        return "\(value)"
    }

    // MARK: - Helpers

    // Everything the preview tools need, with the simulator wired to the
    // live view models exactly like AppPreviewView.onAppear does.
    private func previewContext() throws -> (ProjectViewModel, LogicViewModel, LogicSimulator) {
        guard let design = designViewModel,
              let logic = logicViewModel,
              let simulator = previewSimulator
        else { throw MCPToolError("Designer is not available.") }

        logic.attach(to: design)
        simulator.logicViewModel = logic
        simulator.designViewModel = design
        return (design, logic, simulator)
    }

    private static func tappableElements(logic: LogicViewModel) -> [(id: UUID, name: String)] {
        var seen = Set<UUID>()
        var result: [(UUID, String)] = []

        for flow in logic.flows {
            for block in flow.blocks
            where block.type == .onTap || block.type == .onDoubleTap || block.type == .onLongPress {
                for parameter in block.parameters where parameter.key == "element" {
                    if let nodeId = parameter.nodeReference, seen.insert(nodeId).inserted {
                        result.append((nodeId, logic.designNodeName(for: nodeId) ?? "element"))
                    }
                }
            }
        }
        return result
    }

    private static func canvasStudioCapabilitiesJSON() -> String {
        let capabilities: [String: Any] = [
            "workspace": "Canvas Studio",
            "purpose": "Canva/Photoshop-like composition for artboards, photos, generated images, typography, shapes, icons, effects, crop/mask, layout, and export.",
            "tools": [
                "get_project_overview",
                "get_design_tree",
                "get_screenshot",
                "apply_canvas_studio_edits",
                "apply_design_actions",
                "run_design_agent",
                "save_project"
            ],
            "operations": [
                "createArtboard": ["name", "width", "height", "fill", "stroke", "cornerRadius", "x", "y", "nodeReference"],
                "addText": ["text", "fontSize", "fontWeight", "fontFamily", "textColor", "textAlign", "lineHeight", "letterSpacing", "x", "y", "width", "height", "parentId", "parentReference"],
                "addShape": ["name", "fill", "stroke", "strokeWidth", "cornerRadius", "opacity", "gradient", "shadow", "x", "y", "width", "height"],
                "addPhoto": ["imageSource", "path", "url", "contentMode", "cornerRadius", "opacity", "shadow", "overlayColor", "overlayOpacity", "x", "y", "width", "height"],
                "addAIImage": ["imagePrompt", "assetKind", "aspectRatio", "resolution", "contentMode", "cornerRadius", "x", "y", "width", "height"],
                "addIcon": ["iconName", "textColor", "fill", "padding", "x", "y", "width", "height"],
                "transform": ["nodeId", "x", "y", "width", "height", "scale"],
                "style": ["nodeId", "fill", "stroke", "strokeWidth", "cornerRadius", "opacity", "gradient", "padding", "clipContent"],
                "typography": ["nodeId", "text", "fontSize", "fontWeight", "fontFamily", "textColor", "textAlign", "lineHeight", "letterSpacing"],
                "image": ["nodeId", "imageSource", "path", "url", "contentMode"],
                "crop": ["nodeId", "contentMode", "cornerRadius", "clipContent"],
                "effects": ["nodeId", "shadow", "blur", "backgroundBlur", "overlayColor", "overlayOpacity", "opacity"],
                "arrange": ["nodeId", "order(front|back)", "zIndex"],
                "alignChildren": ["nodeId", "alignment(left|center|right|top|middle|bottom)"],
                "distributeChildren": ["nodeId", "axis(horizontal|vertical)", "spacing", "padding"],
                "delete": ["nodeId"],
                "createPage": ["pageName"]
            ],
            "imageGeneration": [
                "operation": "addAIImage",
                "required": ["imagePrompt"],
                "optional": ["assetKind", "aspectRatio", "resolution", "generateImages"],
                "note": "Real image generation requires an OpenRouter API key configured in the app."
            ],
            "export": [
                "pageScreenshot": "Call get_screenshot for the active page.",
                "projectFile": "Call save_project."
            ]
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: capabilities, options: [.prettyPrinted, .sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }

    private static func designActionPayloads(fromStudioOperation rawOperation: Any) throws -> [[String: Any]] {
        guard var payload = rawOperation as? [String: Any] else {
            throw MCPToolError("operation must be an object")
        }

        if payload["operation"] == nil, payload["op"] == nil, payload["studioOperation"] == nil,
           payload["type"] is String {
            return [payload]
        }

        let rawName = payload.removeValue(forKey: "operation")
            ?? payload.removeValue(forKey: "op")
            ?? payload.removeValue(forKey: "studioOperation")
        guard let operation = (rawName as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
        else {
            throw MCPToolError("missing operation")
        }

        normalizeStudioImageAliases(in: &payload)

        switch operation {
        case "createartboard", "artboard", "canvas", "pagecanvas":
            payload["type"] = "createFrame"
            payload["name"] = payload["name"] ?? "Artboard"
            payload["width"] = payload["width"] ?? 1080
            payload["height"] = payload["height"] ?? 1080
            payload["fill"] = payload["fill"] ?? "#FFFFFF"
            payload["stroke"] = payload["stroke"] ?? "#D1D5DB"
            payload["clipContent"] = payload["clipContent"] ?? true
            payload["cornerRadius"] = payload["cornerRadius"] ?? 0
            return [payload]

        case "addtext", "text":
            payload["type"] = "createText"
            payload["text"] = payload["text"] ?? "New text"
            payload["fontSize"] = payload["fontSize"] ?? 48
            payload["textColor"] = payload["textColor"] ?? payload["color"] ?? "#111827"
            payload["width"] = payload["width"] ?? 360
            payload["height"] = payload["height"] ?? 72
            return [payload]

        case "addshape", "shape", "rectangle", "addrectangle":
            payload["type"] = "createRectangle"
            payload["name"] = payload["name"] ?? "Shape"
            payload["fill"] = payload["fill"] ?? "#D1D5DB"
            payload["width"] = payload["width"] ?? 220
            payload["height"] = payload["height"] ?? 160
            return [payload]

        case "addphoto", "photo", "addimage", "imageasset":
            payload["type"] = "createImage"
            payload["name"] = payload["name"] ?? "Photo"
            payload["width"] = payload["width"] ?? 360
            payload["height"] = payload["height"] ?? 240
            payload["contentMode"] = payload["contentMode"] ?? payload["crop"] ?? "fill"
            return [payload]

        case "addaiimage", "aiimage", "generateimage", "promptimage":
            payload["type"] = "createImage"
            payload["name"] = payload["name"] ?? "AI Image"
            payload["imagePrompt"] = payload["imagePrompt"] ?? payload["prompt"]
            payload["assetKind"] = payload["assetKind"] ?? "photo"
            payload["width"] = payload["width"] ?? 360
            payload["height"] = payload["height"] ?? 240
            payload["contentMode"] = payload["contentMode"] ?? "fill"
            return [payload]

        case "addicon", "icon":
            payload["type"] = "createIcon"
            payload["iconName"] = payload["iconName"] ?? payload["symbol"] ?? "star"
            payload["width"] = payload["width"] ?? 48
            payload["height"] = payload["height"] ?? 48
            return [payload]

        case "transform", "resize", "move":
            payload["type"] = payload["scale"] == nil ? "resizeNode" : "scaleNode"
            if payload["width"] == nil, payload["height"] == nil, payload["scale"] == nil {
                payload["type"] = "moveNode"
            }
            return [payload]

        case "style", "crop", "mask", "image", "effects":
            if operation == "crop" || operation == "mask" {
                payload["clipContent"] = payload["clipContent"] ?? true
                payload["contentMode"] = payload["contentMode"] ?? payload["crop"] ?? "fill"
            }
            payload["type"] = "updateStyle"
            return [payload]

        case "typography", "type":
            var actions: [[String: Any]] = []
            if payload["text"] != nil {
                var textPayload = payload
                textPayload["type"] = "updateText"
                actions.append(textPayload)
            }
            payload["type"] = "updateStyle"
            actions.append(payload)
            return actions

        case "arrange", "layer", "order":
            if payload["zIndex"] != nil {
                payload["type"] = "setZIndex"
                return [payload]
            }
            let order = (payload["order"] as? String ?? payload["action"] as? String ?? "front")
                .lowercased()
            payload["type"] = order.contains("back") ? "sendToBack" : "bringToFront"
            return [payload]

        case "alignchildren", "align":
            payload["type"] = "alignChildren"
            payload["alignment"] = payload["alignment"] ?? "center"
            return [payload]

        case "distributechildren", "distribute":
            payload["type"] = "distributeChildren"
            payload["axis"] = payload["axis"] ?? "horizontal"
            return [payload]

        case "delete", "remove":
            payload["type"] = "deleteNode"
            return [payload]

        case "createpage", "newpage":
            payload["type"] = "createPage"
            payload["pageName"] = payload["pageName"] ?? payload["name"] ?? "Studio Page"
            return [payload]

        default:
            throw MCPToolError("unsupported Studio operation '\(operation)'")
        }
    }

    private static func normalizeStudioImageAliases(in payload: inout [String: Any]) {
        if payload["imageSource"] == nil {
            payload["imageSource"] = payload["path"] ?? payload["url"] ?? payload["source"]
        }
        if payload["imageName"] == nil {
            payload["imageName"] = payload["imageSource"]
        }
        if payload["contentMode"] == nil {
            payload["contentMode"] = payload["cropMode"]
        }
    }

    /// A DecodingError's localizedDescription is the useless generic "data
    /// couldn't be read" — agents need the KEY PATH and the reason to fix
    /// their spec on the retry instead of resending the same broken JSON.
    private static func specDecodeMessage(_ error: Error) -> String {
        func path(_ context: DecodingError.Context) -> String {
            let p = context.codingPath.map { key in
                key.intValue.map { "[\($0)]" } ?? key.stringValue
            }.joined(separator: ".")
            return p.isEmpty ? "(root)" : p
        }
        switch error as? DecodingError {
        case .keyNotFound(let key, let context):
            return "missing key '\(key.stringValue)' at \(path(context))."
        case .typeMismatch(let type, let context):
            return "wrong type at \(path(context)) — expected \(type). \(context.debugDescription)"
        case .valueNotFound(let type, let context):
            return "null where a \(type) was expected, at \(path(context))."
        case .dataCorrupted(let context):
            return "invalid value at \(path(context)): \(context.debugDescription)"
        default:
            return error.localizedDescription
        }
    }

    private static func page(in viewModel: ProjectViewModel, at index: Int?) throws -> DesignPage {
        let pageIndex = index ?? viewModel.currentPageIndex
        guard viewModel.project.pages.indices.contains(pageIndex) else {
            throw MCPToolError("Page index \(pageIndex) is out of range — the project has \(viewModel.project.pages.count) page(s).")
        }
        return viewModel.project.pages[pageIndex]
    }

    private static func projectOverviewJSON(_ viewModel: ProjectViewModel) -> String {
        let pages: [[String: Any]] = viewModel.project.pages.enumerated().map { index, page in
            let screens: [[String: Any]] = page.nodes
                .filter { $0.type == .Frame }
                .map { frame in
                    [
                        "nodeId": frame.id.uuidString,
                        "name": frame.name,
                        "x": Int(frame.x), "y": Int(frame.y),
                        "width": Int(frame.width), "height": Int(frame.height),
                        "childCount": frame.children.count
                    ]
                }
            return [
                "pageIndex": index,
                "name": page.name,
                "rootNodeCount": page.nodes.count,
                "screens": screens,
                "logicFlowCount": page.logicFlows.count
            ]
        }

        let settings = DesignAgentService.Settings.current()
        let agentAvailable = settings.resolvedAPIKey() != nil

        let overview: [String: Any] = [
            "projectName": viewModel.project.name,
            "activePageIndex": viewModel.currentPageIndex,
            "pages": pages,
            "aiPipeline": [
                // When false, run_design_agent and imagePrompt image generation
                // will refuse — the user must set an API key in the Agent panel.
                "available": agentAvailable,
                "strategyModel": settings.model,
                "generationModel": settings.generationModel.isEmpty ? settings.model : settings.generationModel,
                "autoCritic": settings.autoCriticEnabled
            ]
        ]

        guard let data = try? JSONSerialization.data(withJSONObject: overview, options: [.prettyPrinted, .sortedKeys]),
              let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }
}
