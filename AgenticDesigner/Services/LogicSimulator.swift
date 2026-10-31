//
//  LogicSimulator.swift
//  AgenticDesigner
//
//  In-app flow simulator: walks a LogicFlow block by block, highlighting
//  each block as it "executes". HTTP requests really fire, conditions and
//  data operations really evaluate, UI-update blocks really mutate the
//  designed screen, and Firebase blocks pause for a Success/Error choice.
//

import Foundation
import SwiftUI
import AppKit
import Combine

@MainActor
final class LogicSimulator: ObservableObject {

    struct SimLogEntry: Identifiable {
        let id = UUID()
        let icon: String
        let message: String
        var isError: Bool = false
    }

    struct BranchChoice {
        let blockLabel: String
        let labels: [String]
    }

    @Published var isRunning = false
    @Published var log: [SimLogEntry] = []
    // Any assignment here — from any block, in any flow — does two things:
    // (1) persists non-flow-local names into `persistentState` immediately
    // (not just at run end, so even an interrupted/stopped flow keeps what
    // it already set), and (2) re-pushes bound node properties (see
    // bindProperty/logicBindings), so a Text bound to "likeCount" updates
    // the instant incrementVariable changes it — no explicit setText needed.
    @Published var variables: [String: String] = [:] {
        didSet {
            for (name, currentValue) in variables where !currentFlowLocalNames.contains(name) {
                persistentState[name] = currentValue
            }
            refreshAllBindings()
        }
    }
    @Published var awaitingChoice: BranchChoice?
    @Published var speed: Double = 0.14
    @Published var hasUIChanges = false
    // The screen shown in the interactive preview. Lives here (not in the
    // view) so MCP tools can navigate and observe the running app.
    @Published var previewScreenId: UUID?
    // Screens navigated FROM, so goBack can pop like the exported app does.
    private var navigationHistory: [UUID] = []
    @Published var previewPlatform: AppPlatform = .iPhone
    // Toast currently visible in the preview window; auto-dismisses.
    @Published var toastMessage: String?
    private var toastTask: Task<Void, Never>?

    weak var logicViewModel: LogicViewModel?
    weak var designViewModel: ProjectViewModel?

    // Interactive preview: navigate blocks switch the displayed screen.
    var onNavigate: ((UUID) -> Void)?

    // Fires the flow whose tap event is bound to this node (interactive
    // preview). `itemContext` carries a repeat-list clone's item data
    // ("book" → item JSON, "book.title" → field values) into the run, so a
    // tapped row's flow sees WHICH row was tapped.
    func runTap(on nodeId: UUID, itemContext: [String: String] = [:]) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            if let event = flow.blocks.first(where: { block in
                (block.type == .onTap || block.type == .onDoubleTap || block.type == .onLongPress) &&
                block.parameters.contains { $0.key == "element" && $0.nodeReference == nodeId }
            }) {
                logicViewModel?.currentFlowId = flow.id
                logicViewModel?.selectedBlockId = event.id
                pendingItemContext = itemContext
                run()
                return
            }
        }
        append("hand.tap", "No flow bound to this element")
    }

    // Fires the On Swipe flow bound to this node whose direction filter
    // matches the actual swipe (a flow with no/empty direction matches any).
    func runSwipe(on nodeId: UUID, direction: String, itemContext: [String: String] = [:]) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            if let event = flow.blocks.first(where: { block in
                guard block.type == .onSwipe,
                      block.parameters.contains(where: { $0.key == "element" && $0.nodeReference == nodeId })
                else { return false }
                let wanted = block.parameters.first { $0.key == "direction" }?.value ?? ""
                return wanted.isEmpty || wanted == direction
            }) {
                logicViewModel?.currentFlowId = flow.id
                logicViewModel?.selectedBlockId = event.id
                pendingItemContext = itemContext
                append("hand.draw", "Swipe \(direction)")
                run()
                return
            }
        }
    }

    // Loads global (and screen-scoped) variable defaults into `variables` up
    // front, so data-bound repeat lists render on the very first paint and an
    // item tap resolves its context on the first tap — without waiting for
    // some flow to run first. Mirrors how the exported AppState seeds its
    // @Published defaults immediately. Safe to call repeatedly.
    func primeVariables() {
        var seeded = variables
        for variable in designViewModel?.project.globalVariables ?? [] where seeded[variable.name] == nil {
            seeded[variable.name] = variable.defaultValue ?? defaultValue(for: variable.type)
        }
        for flow in logicViewModel?.flows ?? [] {
            for variable in flow.variables where variable.scope != .flow && seeded[variable.name] == nil {
                seeded[variable.name] = variable.defaultValue ?? defaultValue(for: variable.type)
            }
        }
        if seeded != variables { variables = seeded }
    }

    func runEvent(_ types: Set<LogicBlockType>, nodeId: UUID? = nil) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            if let event = flow.blocks.first(where: { block in
                guard types.contains(block.type) else { return false }
                if let nodeId {
                    return block.parameters.contains { $0.nodeReference == nodeId }
                }
                return true
            }) {
                logicViewModel?.currentFlowId = flow.id
                logicViewModel?.selectedBlockId = event.id
                run()
                return
            }
        }
    }

    private var runTask: Task<Void, Never>?
    private var choiceContinuation: CheckedContinuation<Int, Never>?
    private var savedNodes: [DesignNode]?

    // Variables that outlive a single flow run, for the length of this
    // preview session — global variables everywhere, screen variables
    // wherever they're declared. Without this, every tap wiped ALL
    // variables back to their defaults, so counters/toggles/likes/anything
    // "remembered" could never actually accumulate: run() reseeded fresh
    // every time. Only .flow-scoped variables (explicit scratch-per-run
    // semantics) still reset on every run. Cleared by resetUI().
    private var persistentState: [String: String] = [:]
    // Names scoped .flow in the currently running flow — excluded from
    // persistentState so they reset to their default on every run, as their
    // "local to this flow" scope promises.
    private var currentFlowLocalNames: Set<String> = []
    // Item data from a tapped repeat-list clone, consumed by the next run()
    // — seeded AFTER defaults so the tapped row's values win.
    private var pendingItemContext: [String: String] = [:]
    // Named timers created by Start Timer blocks; each tick fires Custom
    // Event flows whose name matches the timer's.
    private var namedTimerTasks: [String: Task<Void, Never>] = [:]
    // Self-scheduling On Timer event flows for the currently shown preview
    // screen; rebuilt on every screen change.
    private var screenTimerTasks: [Task<Void, Never>] = []
    // In-memory Firestore stand-in: document path → document JSON. Lets
    // Firestore flows run unattended in the preview (write → read → query
    // round-trips really work) without a Firebase project.
    private var firestoreMock: [String: String] = [:]

    // MARK: - Control

    func run() {
        guard let flow = logicViewModel?.currentFlow else { return }
        stop()

        if savedNodes == nil {
            savedNodes = designViewModel?.snapshotNodesForSimulation()
        }

        log = []

        // Start from whatever persisted, then seed defaults only for names
        // never seen before — an already-persisted value must win over a
        // fresh default, or persistence would be pointless.
        var seeded = persistentState
        for variable in designViewModel?.project.globalVariables ?? [] where seeded[variable.name] == nil {
            seeded[variable.name] = variable.defaultValue ?? defaultValue(for: variable.type)
        }
        var flowLocalNames: Set<String> = []
        for variable in flow.variables {
            if variable.scope == .flow {
                // Explicit scratch semantics: always fresh, every run.
                flowLocalNames.insert(variable.name)
                seeded[variable.name] = variable.defaultValue ?? defaultValue(for: variable.type)
            } else if seeded[variable.name] == nil {
                seeded[variable.name] = variable.defaultValue ?? defaultValue(for: variable.type)
            }
        }
        // Tapped repeat-row item data lands last so it beats any defaults —
        // the flow reads THIS row's "book"/"book.title"/… values.
        for (name, itemValue) in pendingItemContext {
            seeded[name] = itemValue
        }
        pendingItemContext = [:]
        variables = seeded
        currentFlowLocalNames = flowLocalNames

        let events = flow.blocks.filter {
            BlockCatalog.definition(for: $0.type)?.inputPortCount == 0
        }
        let selected = logicViewModel?.selectedBlockId
        guard let event = events.first(where: { $0.id == selected }) ?? events.first else {
            append("exclamationmark.triangle", "No event block to start from — add an On Tap / On Screen Load first.", isError: true)
            return
        }

        isRunning = true
        append("play.fill", "▶ Running '\(flow.name)' from '\(event.label)'")

        runTask = Task { [weak self] in
            await self?.execute(block: event, in: flow)
            await MainActor.run {
                guard let self else { return }
                self.append("flag.checkered", "Flow finished")
                self.isRunning = false
                self.logicViewModel?.simActiveBlockId = nil
            }
        }
    }

    func stop() {
        runTask?.cancel()
        runTask = nil
        choiceContinuation?.resume(returning: 0)
        choiceContinuation = nil
        awaitingChoice = nil
        isRunning = false
        logicViewModel?.simActiveBlockId = nil
    }

    // Restores the design screen to its pre-simulation state.
    func resetUI() {
        stop()
        stopAllTimers()
        if let savedNodes {
            designViewModel?.restoreNodesFromSimulation(savedNodes)
        }
        savedNodes = nil
        hasUIChanges = false
        persistentState = [:]
        firestoreMock = [:]
        navigationHistory = []
        append("arrow.uturn.backward", "UI restored to pre-run state")
    }

    // MARK: - Timers

    // Cancels every running timer (named + screen-scheduled). Called when
    // the preview closes or resets — deliberately NOT from stop(), which
    // run() calls at the start of every flow (timers must survive that).
    func stopAllTimers() {
        for task in namedTimerTasks.values { task.cancel() }
        namedTimerTasks = [:]
        for task in screenTimerTasks { task.cancel() }
        screenTimerTasks = []
    }

    // (Re)arms every On Timer event flow scoped to this screen (or unscoped):
    // each fires after its `seconds`, repeating if `repeats` is true, until
    // the preview navigates away.
    func scheduleScreenTimers(for screenId: UUID) {
        for task in screenTimerTasks { task.cancel() }
        screenTimerTasks = []
        guard let flows = logicViewModel?.flows else { return }

        for flow in flows where flow.screenNodeId == nil || flow.screenNodeId == screenId {
            for event in flow.blocks where event.type == .onTimer {
                let seconds = max(Double(event.parameters.first { $0.key == "seconds" }?.value ?? "1") ?? 1, 0.05)
                let repeats = event.parameters.first { $0.key == "repeats" }?.value == "true"
                let flowId = flow.id
                let eventId = event.id
                let task = Task { [weak self] in
                    repeat {
                        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                        guard !Task.isCancelled, let self else { return }
                        self.fireFlow(flowId: flowId, eventId: eventId, sourceLabel: "⏱ Timer")
                    } while repeats && !Task.isCancelled
                }
                screenTimerTasks.append(task)
            }
        }
    }

    private func startNamedTimer(name: String, seconds: Double) {
        namedTimerTasks[name]?.cancel()
        namedTimerTasks[name] = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0.05) * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                self.fireCustomEvent(named: name, sourceLabel: "⏱ Timer '\(name)'")
            }
        }
    }

    private func stopNamedTimer(name: String) {
        namedTimerTasks[name]?.cancel()
        namedTimerTasks[name] = nil
    }

    // Runs the Custom Event flow whose Action Name matches — how a named
    // timer's ticks (or future generated hooks) enter the flow graph.
    private func fireCustomEvent(named name: String, sourceLabel: String) {
        guard let flows = logicViewModel?.flows else { return }
        for flow in flows {
            if let event = flow.blocks.first(where: { block in
                block.type == .customEvent &&
                (block.parameters.first { $0.key == "name" }?.value ?? "") == name
            }) {
                fireFlow(flowId: flow.id, eventId: event.id, sourceLabel: sourceLabel)
                return
            }
        }
    }

    // Timer-safe flow trigger: skips the tick (instead of queueing) if a
    // flow is already mid-run, so ticks never interleave two flows.
    private func fireFlow(flowId: UUID, eventId: UUID, sourceLabel: String) {
        guard !isRunning else { return }
        logicViewModel?.currentFlowId = flowId
        logicViewModel?.selectedBlockId = eventId
        append("timer", "\(sourceLabel) fired")
        run()
    }

    // MARK: - Game bridge

    // Live game scenes (AgentGameView) report into the logic layer here: the
    // score/lifecycle land in variables (so any bound Text/visibility reacts
    // instantly via refreshAllBindings), and onCollision runFlow behaviors can
    // fire real logic flows by name or id.
    func handleGameEvent(_ event: GameEvent) {
        switch event {
        case .started:
            variables["gameOver"] = "false"
            variables["gameWon"] = "false"
            runEvent([.onGameStart])
        case .scoreChanged(let score):
            variables["gameScore"] = "\(score)"
            runEvent([.onGameScore])
        case .gameOver(let score):
            variables["gameScore"] = "\(score)"
            variables["gameOver"] = "true"
            runEvent([.onGameOver])
            triggerGameFlow(named: "onGameOver")
        case .won(let score):
            variables["gameScore"] = "\(score)"
            variables["gameWon"] = "true"
            runEvent([.onGameWin])
            triggerGameFlow(named: "onGameWin")
        case .runFlow(let reference):
            triggerGameFlow(named: reference)
        case .collision(let a, let b, let idA, let idB):
            fireGameCollisionFlow(a, b, idA, idB)
        case .tap(let x, let y):
            variables["gameTapX"] = String(Int(x))
            variables["gameTapY"] = String(Int(y))
            runEvent([.onGameTap])
        case .drag(let phase, let x, let y):
            variables["gameDragPhase"] = phase
            variables["gameDragX"] = String(Int(x))
            variables["gameDragY"] = String(Int(y))
            fireGameDragFlow(phase)
        case .entityDestroyed(let category):
            variables["gameDestroyed"] = category
            fireGameDestroyedFlow(category)
        case .lifeLost(let remaining):
            variables["gameLives"] = "\(remaining)"
            runEvent([.onGameLifeLost])
        case .spawned(let category):
            variables["gameSpawned"] = category
            fireGameSpawnedFlow(category)
        case .impact(let a, let b, let force, let idA, let idB):
            variables["gameImpactForce"] = String(Int(force))
            fireGameImpactFlow(a, b, force, idA, idB)
        case .launched(let entityId):
            variables["gameLaunched"] = entityId
            runEvent([.onGameLaunched])
        }
    }

    /// Runs the first On Impact flow whose category filters match the pair AND
    /// whose minForce threshold the hit cleared (light grazes stay silent).
    private func fireGameImpactFlow(_ a: String, _ b: String, _ force: CGFloat,
                                    _ idA: String, _ idB: String) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            guard let event = flow.blocks.first(where: { $0.type == .onGameImpact }) else { continue }
            let fa = event.parameters.first { $0.key == "categoryA" }?.value ?? ""
            let fb = event.parameters.first { $0.key == "categoryB" }?.value ?? ""
            let minForce = Double(event.parameters.first { $0.key == "minForce" }?.value ?? "0") ?? 0
            guard Double(force) >= minForce else { continue }
            // Normalize to the FILTER's order: if you filter A=pig, B=bird then
            // gameImpactEntityA is always the pig — otherwise every flow would
            // need to guess which side of the contact it got.
            let swap = (!fa.isEmpty && fa == b) || (!fb.isEmpty && fb == a)
            let (ca, cb) = swap ? (b, a) : (a, b)
            let (ea, eb) = swap ? (idB, idA) : (idA, idB)
            let match = (fa.isEmpty || fa == ca) && (fb.isEmpty || fb == cb)
            if match {
                variables["gameImpactA"] = ca
                variables["gameImpactB"] = cb
                variables["gameImpactEntityA"] = ea
                variables["gameImpactEntityB"] = eb
                fireFlow(flowId: flow.id, eventId: event.id, sourceLabel: "impact \(ca)×\(cb) @\(Int(force))")
                return
            }
        }
    }

    private func fireGameSpawnedFlow(_ category: String) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            guard let event = flow.blocks.first(where: { $0.type == .onGameSpawned }) else { continue }
            let wanted = event.parameters.first { $0.key == "category" }?.value ?? ""
            if wanted.isEmpty || wanted == category {
                fireFlow(flowId: flow.id, eventId: event.id, sourceLabel: "spawned \(category)")
                return
            }
        }
    }

    private func fireGameDragFlow(_ phase: String) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            guard let event = flow.blocks.first(where: { $0.type == .onGameDrag }) else { continue }
            let wanted = event.parameters.first { $0.key == "phase" }?.value ?? "move"
            if wanted == "any" || wanted == phase {
                fireFlow(flowId: flow.id, eventId: event.id, sourceLabel: "game drag \(phase)")
                return
            }
        }
    }

    private func fireGameDestroyedFlow(_ category: String) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            guard let event = flow.blocks.first(where: { $0.type == .onGameEntityDestroyed }) else { continue }
            let wanted = event.parameters.first { $0.key == "category" }?.value ?? ""
            if wanted.isEmpty || wanted == category {
                fireFlow(flowId: flow.id, eventId: event.id, sourceLabel: "destroyed \(category)")
                return
            }
        }
    }

    /// Runs the first On Game Collision flow whose category filters match the
    /// touching pair (either order; an empty filter matches anything).
    private func fireGameCollisionFlow(_ a: String, _ b: String, _ idA: String, _ idB: String) {
        guard !isRunning, let flows = logicViewModel?.flows else { return }
        for flow in flows {
            guard let event = flow.blocks.first(where: { $0.type == .onGameCollision }) else { continue }
            let fa = event.parameters.first { $0.key == "categoryA" }?.value ?? ""
            let fb = event.parameters.first { $0.key == "categoryB" }?.value ?? ""
            let match = (fa.isEmpty || fa == a || fa == b) && (fb.isEmpty || fb == a || fb == b)
            if match {
                // Same normalization as impacts: entityA is always the
                // categoryA thing, so a flow can remove exactly what it hit.
                let swap = (!fa.isEmpty && fa == b) || (!fb.isEmpty && fb == a)
                variables["gameCollisionEntityA"] = swap ? idB : idA
                variables["gameCollisionEntityB"] = swap ? idA : idB
                fireFlow(flowId: flow.id, eventId: event.id, sourceLabel: "game collision \(a)×\(b)")
                return
            }
        }
    }

    /// Fires a flow by id or (fuzzy) name — used by game events. Silently a
    /// no-op when no such flow exists, so games without wired flows just play.
    private func triggerGameFlow(named reference: String) {
        guard let flows = logicViewModel?.flows else { return }
        let flow = flows.first { $0.id.uuidString.caseInsensitiveCompare(reference) == .orderedSame }
            ?? flows.first { $0.name.caseInsensitiveCompare(reference) == .orderedSame }
            ?? flows.first { $0.name.localizedCaseInsensitiveContains(reference) }
        guard let flow,
              let event = flow.blocks.first(where: { $0.category == .event }) ?? flow.blocks.first
        else { return }
        fireFlow(flowId: flow.id, eventId: event.id, sourceLabel: "game → \(flow.name)")
    }

    // MARK: - Reactive bindings

    // Re-pushes every logicBindings-bound node's property from the current
    // variables — called on every variables mutation (see didSet above) so
    // bound UI always reflects the latest value, not just the value at the
    // moment bindProperty first ran.
    private func refreshAllBindings() {
        guard let design = designViewModel,
              design.project.pages.indices.contains(design.currentPageIndex)
        else { return }
        refreshBindings(in: design.project.pages[design.currentPageIndex].nodes)
    }

    private func refreshBindings(in nodes: [DesignNode]) {
        for node in nodes {
            for binding in node.logicBindings ?? [] {
                guard let newValue = variables[binding.variableName] else { continue }

                switch binding.kind {
                case .text, .value:
                    guard node.text != newValue else { continue }
                    designViewModel?.simulateUpdateNode(id: node.id) { $0.text = newValue }
                    hasUIChanges = true
                case .visibility:
                    let targetOpacity: Double = newValue == "false" ? 0.08 : 1
                    guard node.style.opacity != targetOpacity else { continue }
                    designViewModel?.simulateUpdateNode(id: node.id) { $0.style.opacity = targetOpacity }
                    hasUIChanges = true
                case .enabled:
                    let targetOpacity: Double = newValue == "false" ? 0.45 : 1
                    guard node.style.opacity != targetOpacity else { continue }
                    designViewModel?.simulateUpdateNode(id: node.id) { $0.style.opacity = targetOpacity }
                    hasUIChanges = true
                case .isOn, .selectedIndex:
                    // No generic visual stand-in in the preview yet; the
                    // exporter reads these directly at code-gen time.
                    break
                }
            }

            if !node.children.isEmpty {
                refreshBindings(in: node.children)
            }
        }
    }

    func choose(_ index: Int) {
        awaitingChoice = nil
        choiceContinuation?.resume(returning: index)
        choiceContinuation = nil
    }

    // MARK: - Execution

    private func execute(block: LogicBlock, in flow: LogicFlow) async {
        guard !Task.isCancelled else { return }

        logicViewModel?.simActiveBlockId = block.id
        let port = await perform(block)

        if block.category != .event {
            try? await Task.sleep(nanoseconds: UInt64(speed * 1_000_000_000))
        }
        guard !Task.isCancelled else { return }

        let next = flow.connections.filter {
            $0.sourceBlockId == block.id && $0.sourcePortIndex == port
        }
        for connection in next {
            if let target = flow.blocks.first(where: { $0.id == connection.targetBlockId }) {
                await execute(block: target, in: flow)
            }
        }
    }

    /// Device sensors. A Mac can't read an iPhone's gyroscope or a Watch's
    /// heart rate, so the preview returns plausible sample readings and says
    /// so — the flow is still exercised end to end, and the exported app reads
    /// the real hardware.
    private func performSensor(_ block: LogicBlock) -> Int {
        func store(_ key: String, _ value: String) {
            guard let name = block.parameters.first(where: { $0.key == key })?.variableReference else { return }
            variables[name] = value
        }

        switch block.type {
        case .getLocation:
            store("latitudeVariable", "32.0853")
            store("longitudeVariable", "34.7818")
            append("location.fill", "Location → 32.0853, 34.7818 (sample — real GPS on device)")
        case .readMotion:
            store("xVariable", "0.02")
            store("yVariable", "-0.98")
            store("zVariable", "0.11")
            append("gyroscope", "Motion → x 0.02, y −0.98, z 0.11 (sample)")
        case .readHeartRate:
            store("variable", "72")
            append("heart.fill", "Heart rate → 72 bpm (sample — HealthKit on Apple Watch)")
        case .readStepCount:
            store("variable", "8432")
            append("figure.walk", "Steps today → 8,432 (sample — pedometer/HealthKit)")
        case .readBatteryLevel:
            store("variable", "87")
            append("battery.75", "Battery → 87% (sample)")
        default:
            append("sensor", "\(block.label) (sample)")
        }
        return 0
    }

    // Executes one block and returns which output port the flow continues on.
    private func perform(_ block: LogicBlock) async -> Int {
        let def = BlockCatalog.definition(for: block.type)

        switch block.category {
        case .event:
            append("bolt.fill", "Event: \(block.label)")
            return 0

        case .action:
            return await performAction(block)

        case .condition:
            let result = evaluateCondition(block)
            append("arrow.triangle.branch", "\(block.label) → \(result == 0 ? "then/true" : "else/false")")
            return result

        case .device:
            return performSensor(block)

        case .api:
            return await performAPI(block)

        case .firebase:
            // Firestore data blocks run for real against an in-memory mock
            // store (writes land, reads/queries return them), so data flows
            // are testable unattended. Auth blocks keep the manual
            // Success/Error choice — there's no meaningful way to fake them.
            switch block.type {
            case .firestoreAddDocument, .firestoreSetDocument, .firestoreGetDocument,
                 .firestoreUpdateDocument, .firestoreDeleteDocument, .firestoreQuery,
                 .firestoreListenDocument, .firestoreListenQuery, .firestoreBatchWrite:
                return performFirestoreMock(block)
            default:
                break
            }
            let labels = def?.outputPortLabels ?? ["Success", "Error"]

            // "Is someone signed in?" needs no human: the preview session
            // itself knows. A fresh preview has no session → Signed Out, which
            // is exactly what a cold launch of the real app does. Asking here
            // paused every preview on its first frame (the launch auth gate)
            // before anything could be tapped.
            if block.type == .firebaseGetCurrentUser || block.type == .firebaseAuthStateChanged {
                let uid = variables["currentUserId"] ?? ""
                let signedIn = !uid.isEmpty
                if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference
                    ?? block.parameters.first(where: { $0.key == "variable" })?.value,
                   !storeIn.isEmpty {
                    variables[storeIn] = signedIn ? uid : ""
                }
                append(signedIn ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.questionmark",
                       "\(block.label) → \(signedIn ? "Signed In (\(uid))" : "Signed Out — no preview session yet")")
                return signedIn ? 0 : 1
            }

            append("flame.fill", "\(block.label) — waiting for your choice…")
            let choice = await awaitBranchChoice(block: block, labels: labels)
            if block.type == .firebaseLogin, choice == 0 {
                variables["currentUserEmail"] = value(block, "email") ?? "user@example.com"
                variables["currentUserId"] = "sim-user-001"
            }
            if block.type == .firebaseRegister, choice == 0 {
                variables["currentUserEmail"] = value(block, "email") ?? "user@example.com"
                variables["currentUserId"] = "sim-user-001"
            }
            if block.type == .firebaseLogout, choice == 0 {
                // Otherwise the next auth gate still reports a signed-in user
                // and the preview can never get back to the login screen.
                variables["currentUserId"] = ""
                variables["currentUserEmail"] = ""
            }
            append(choice == 0 ? "checkmark.circle.fill" : "xmark.circle.fill",
                   "\(block.label) → \(labels.indices.contains(choice) ? labels[choice] : "port \(choice)")",
                   isError: choice != 0)
            return choice

        case .variable:
            return performDataOperation(block)

        case .storage:
            return await performStorage(block)

        case .ui:
            performUIUpdate(block)
            return 0
        }
    }

    // MARK: - Data & Backends

    // Supabase/Algolia are plain REST APIs, so the simulator hits them for
    // real (same as an HTTP Request block). SQLite needs a linked C library
    // the host app doesn't carry, so it falls back to a manual Success/Error
    // choice — same convention as the Firebase blocks above.
    private func performStorage(_ block: LogicBlock) async -> Int {
        switch block.type {
        // Device sensors. The Mac preview can't read an iPhone's gyroscope or a
        // Watch's heart rate, so those return plausible sample values and say
        // so — the flow is still exercised end to end, and the exported app
        // reads the real hardware.
        case .supabaseSignUp, .supabaseSignIn, .supabaseSignOut, .supabaseCurrentUser:
            guard let config = designViewModel?.project.supabaseConfig, config.isConfigured else {
                append("person.crop.circle.badge.xmark", "Supabase isn't configured — skipping auth call", isError: true)
                return 1
            }
            let session = block.parameters.first { $0.key == "sessionVariable" }?.variableReference

            if block.type == .supabaseSignOut {
                if let session { variables[session] = "" }
                append("rectangle.portrait.and.arrow.right", "Signed out")
                return 0
            }

            let path: String
            var method = "POST"
            var body: Data?
            switch block.type {
            case .supabaseSignUp: path = "/auth/v1/signup"
            case .supabaseSignIn: path = "/auth/v1/token?grant_type=password"
            default:
                path = "/auth/v1/user"
                method = "GET"
            }
            if method == "POST" {
                let email = substitute(value(block, "email") ?? "")
                let password = substitute(value(block, "password") ?? "")
                guard !email.isEmpty, !password.isEmpty else {
                    append("xmark.circle.fill", "Email and password are required", isError: true)
                    return 1
                }
                body = try? JSONSerialization.data(withJSONObject: ["email": email, "password": password])
            }
            guard let url = URL(string: config.projectURL + path) else {
                append("network.slash", "Invalid Supabase project URL", isError: true)
                return 1
            }
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            // Reading the current user needs the signed-in user's token, not
            // the anon key.
            let token = session.flatMap { variables[$0] as? String }
            request.setValue("Bearer \(token?.isEmpty == false ? token! : config.anonKey)",
                             forHTTPHeaderField: "Authorization")
            request.httpBody = body
            append("person.crop.circle", "\(block.label)…")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let ok = (200..<300).contains(status)
                let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                if ok, let accessToken = parsed?["access_token"] as? String, let session {
                    variables[session] = accessToken
                }
                if let userVariable = block.parameters.first(where: { $0.key == "userVariable" })?.variableReference {
                    variables[userVariable] = String(data: data.prefix(4000), encoding: .utf8) ?? ""
                }
                append(ok ? "checkmark.circle.fill" : "xmark.circle.fill",
                       "Supabase auth → HTTP \(status)", isError: !ok)
                return ok ? 0 : 1
            } catch {
                append("xmark.circle.fill", "Supabase auth failed: \(error.localizedDescription)", isError: true)
                return 1
            }

        case .supabaseInsert, .supabaseUpdate, .supabaseDelete, .supabaseQuery:
            guard let config = designViewModel?.project.supabaseConfig, config.isConfigured else {
                append("tray.and.arrow.down", "Supabase isn't configured — skipping real call", isError: true)
                return 1
            }
            let table = value(block, "table") ?? ""
            var components = URLComponents(string: "\(config.projectURL)/rest/v1/\(table)")
            var method = "GET"
            var body: Data?
            switch block.type {
            case .supabaseInsert:
                method = "POST"
                body = keyValueJSON(block, "data")
            case .supabaseUpdate:
                method = "PATCH"
                body = keyValueJSON(block, "data")
                components?.queryItems = filterQueryItems(value(block, "filter"))
            case .supabaseDelete:
                method = "DELETE"
                components?.queryItems = filterQueryItems(value(block, "filter"))
            default:
                var queryItems = filterQueryItems(value(block, "filter"))
                if let limit = value(block, "limit") {
                    queryItems.append(URLQueryItem(name: "limit", value: limit))
                }
                components?.queryItems = queryItems
            }
            guard let url = components?.url else {
                append("network.slash", "Invalid Supabase table/filter", isError: true)
                return 1
            }
            var request = URLRequest(url: url)
            request.httpMethod = method
            request.setValue(config.anonKey, forHTTPHeaderField: "apikey")
            request.setValue("Bearer \(config.anonKey)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if method != "GET" { request.setValue("return=representation", forHTTPHeaderField: "Prefer") }
            request.httpBody = body
            append("tray.and.arrow.down", "\(method) \(url.absoluteString)…")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let ok = (200..<300).contains(status)
                if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                    variables[storeIn] = String(data: data.prefix(6000), encoding: .utf8) ?? ""
                }
                append(ok ? "checkmark.circle.fill" : "xmark.circle.fill", "Supabase → HTTP \(status)", isError: !ok)
                return ok ? 0 : 1
            } catch {
                append("xmark.circle.fill", "Supabase request failed: \(error.localizedDescription)", isError: true)
                return 1
            }

        case .algoliaSearch:
            let appId = value(block, "appId") ?? ""
            let apiKey = value(block, "apiKey") ?? ""
            let index = value(block, "index") ?? ""
            let query = substitute(value(block, "query") ?? "")
            guard !appId.isEmpty, !apiKey.isEmpty, !index.isEmpty,
                  let url = URL(string: "https://\(appId)-dsn.algolia.net/1/indexes/\(index)/query") else {
                append("magnifyingglass", "Algolia needs Application ID, API Key and Index", isError: true)
                return 1
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue(appId, forHTTPHeaderField: "X-Algolia-Application-Id")
            request.setValue(apiKey, forHTTPHeaderField: "X-Algolia-API-Key")
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["params": "query=\(query)"])
            append("magnifyingglass", "Algolia search '\(query)' in \(index)…")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let ok = (200..<300).contains(status)
                if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                    variables[storeIn] = String(data: data.prefix(6000), encoding: .utf8) ?? ""
                }
                append(ok ? "checkmark.circle.fill" : "xmark.circle.fill", "Algolia → HTTP \(status)", isError: !ok)
                return ok ? 0 : 1
            } catch {
                append("xmark.circle.fill", "Algolia request failed: \(error.localizedDescription)", isError: true)
                return 1
            }

        case .logAnalyticsEvent:
            append("chart.bar.xaxis", "Analytics event: \(value(block, "name") ?? "?") (simulated)")
            return 0

        case .sqliteQuery, .sqliteExecute:
            append("cylinder.split.1x2", "\(block.label) — waiting for your choice (no local DB in preview)…")
            let choice = await awaitBranchChoice(block: block, labels: BlockCatalog.definition(for: block.type)?.outputPortLabels ?? ["Success", "Error"])
            append(choice == 0 ? "checkmark.circle.fill" : "xmark.circle.fill", "\(block.label) → \(choice == 0 ? "Success" : "Error")", isError: choice != 0)
            return choice

        default:
            append("questionmark.square.dashed", block.label)
            return 0
        }
    }

    // MARK: - Firestore mock

    // In-memory Firestore: writes store JSON under "collection/docId", reads
    // and queries fetch it back. Deterministic, offline, reset by resetUI().
    private func performFirestoreMock(_ block: LogicBlock) -> Int {
        func dataJSON() -> String {
            guard let data = keyValueJSON(block, "data"),
                  let json = String(data: data, encoding: .utf8) else { return "{}" }
            return json
        }

        switch block.type {
        case .firestoreAddDocument:
            let collection = substitute(value(block, "collection") ?? "items")
            let docId = String(UUID().uuidString.prefix(8)).lowercased()
            firestoreMock["\(collection)/\(docId)"] = dataJSON()
            append("plus.rectangle.on.folder", "Mock Firestore: added \(collection)/\(docId)")
            return 0

        case .firestoreSetDocument:
            let collection = substitute(value(block, "collection") ?? "items")
            let docId = substitute(value(block, "documentId") ?? "").isEmpty
                ? String(UUID().uuidString.prefix(8)).lowercased()
                : substitute(value(block, "documentId") ?? "")
            firestoreMock["\(collection)/\(docId)"] = dataJSON()
            append("tray.and.arrow.down", "Mock Firestore: saved \(collection)/\(docId)")
            return 0

        case .firestoreGetDocument:
            let path = substitute(value(block, "path") ?? "")
            guard let doc = firestoreMock[path] else {
                append("tray.and.arrow.up", "Mock Firestore: no document at '\(path)'", isError: true)
                return 1
            }
            if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                variables[storeIn] = doc
            }
            append("tray.and.arrow.up", "Mock Firestore: read \(path)")
            return 0

        case .firestoreUpdateDocument:
            let path = substitute(value(block, "path") ?? "")
            guard let existing = firestoreMock[path] else {
                append("square.and.pencil", "Mock Firestore: no document at '\(path)' to update", isError: true)
                return 1
            }
            var merged = (try? JSONSerialization.jsonObject(with: Data(existing.utf8))) as? [String: Any] ?? [:]
            if let data = keyValueJSON(block, "data"),
               let updates = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                for (key, val) in updates { merged[key] = val }
            }
            if let data = try? JSONSerialization.data(withJSONObject: merged) {
                firestoreMock[path] = String(data: data, encoding: .utf8) ?? existing
            }
            append("square.and.pencil", "Mock Firestore: updated \(path)")
            return 0

        case .firestoreDeleteDocument:
            let path = substitute(value(block, "path") ?? "")
            firestoreMock[path] = nil
            append("trash", "Mock Firestore: deleted \(path)")
            return 0

        case .firestoreQuery, .firestoreListenQuery:
            let collection = substitute(value(block, "collection") ?? "")
            let prefix = collection + "/"
            var docs: [[String: Any]] = []
            for (path, json) in firestoreMock.sorted(by: { $0.key < $1.key }) where path.hasPrefix(prefix) {
                if var doc = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] {
                    let documentId = String(path.dropFirst(prefix.count))
                    doc["id"] = documentId
                    // Same key the native exporter merges, so a delete/detail
                    // flow built against {{item._id}} behaves identically in
                    // the preview and in the shipped app.
                    doc["_id"] = documentId
                    docs.append(doc)
                }
            }
            if let limit = Int(value(block, "limit") ?? ""), limit > 0 {
                docs = Array(docs.prefix(limit))
            }
            if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference,
               let data = try? JSONSerialization.data(withJSONObject: docs) {
                variables[storeIn] = String(data: data, encoding: .utf8) ?? "[]"
            }
            let suffix = block.type == .firestoreListenQuery ? " (listener simulated as one-time read)" : ""
            append("line.3.horizontal.decrease.circle", "Mock Firestore: \(collection) → \(docs.count) document(s)\(suffix)")
            return 0

        case .firestoreListenDocument:
            let path = substitute(value(block, "path") ?? "")
            if let doc = firestoreMock[path],
               let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                variables[storeIn] = doc
            }
            append("dot.radiowaves.left.and.right", "Mock Firestore: listening to \(path) (simulated as one-time read)")
            return 0

        case .firestoreBatchWrite:
            append("square.stack.3d.up", "Mock Firestore: batch write applied")
            return 0

        default:
            return 0
        }
    }

    private func keyValueJSON(_ block: LogicBlock, _ key: String) -> Data? {
        guard let param = block.parameters.first(where: { $0.key == key }), let raw = param.value, !raw.isEmpty else { return nil }
        var fields: [String: String] = [:]
        for line in raw.split(separator: "\n") {
            let parts = line.split(separator: "=", maxSplits: 1).map(String.init)
            guard parts.count == 2 else { continue }
            fields[parts[0].trimmingCharacters(in: .whitespaces)] = substitute(parts[1].trimmingCharacters(in: .whitespaces))
        }
        return try? JSONSerialization.data(withJSONObject: fields)
    }

    private func filterQueryItems(_ filter: String?) -> [URLQueryItem] {
        guard let filter, !filter.isEmpty else { return [] }
        return filter.split(separator: "&").compactMap { pair in
            let parts = pair.split(separator: "=", maxSplits: 1)
            guard parts.count == 2 else { return nil }
            return URLQueryItem(name: String(parts[0]), value: String(parts[1]))
        }
    }

    // MARK: - Actions

    private func performAction(_ block: LogicBlock) async -> Int {
        switch block.type {
        case .confirmDialog:
            let confirmLabel = value(block, "confirmLabel") ?? "Confirm"
            let cancelLabel = value(block, "cancelLabel") ?? "Cancel"
            append("questionmark.bubble", "\(block.label) — waiting for your choice…")
            let choice = await awaitBranchChoice(block: block, labels: [confirmLabel, cancelLabel])
            append(choice == 0 ? "checkmark.circle.fill" : "xmark.circle", "\(block.label) → \(choice == 0 ? confirmLabel : cancelLabel)", isError: choice != 0)
            return choice
        case .shareContent:
            let text = value(block, "text") ?? ""
            let url = value(block, "url") ?? ""
            append("square.and.arrow.up", "Would share: \([text, url].filter { !$0.isEmpty }.joined(separator: " "))")
        case .sendEmail:
            openOnMac(scheme: "mailto", target: value(block, "to") ?? "", label: "email to")
        case .callNumber:
            openOnMac(scheme: "tel", target: value(block, "number") ?? "", label: "call")
        case .sendSMS:
            openOnMac(scheme: "sms", target: value(block, "number") ?? "", label: "SMS to")
        case .launchMaps:
            let query = substitute(value(block, "query") ?? "")
            if let url = URL(string: "https://maps.apple.com/?q=\(query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") {
                NSWorkspace.shared.open(url)
            }
            append("map", "Opened Maps for '\(query)'")
        case .requestPermission:
            let kind = value(block, "kind") ?? "camera"
            append("checkmark.shield", "\(block.label) (\(kind)) — waiting for your choice…")
            let choice = await awaitBranchChoice(block: block, labels: ["Granted", "Denied"])
            append(choice == 0 ? "checkmark.circle.fill" : "xmark.circle", "\(kind) → \(choice == 0 ? "Granted" : "Denied")", isError: choice != 0)
            return choice
        case .biometricAuth:
            append("faceid", "\(block.label) — waiting for your choice…")
            let choice = await awaitBranchChoice(block: block, labels: ["Success", "Failed"])
            append(choice == 0 ? "checkmark.circle.fill" : "xmark.circle", "Biometric auth → \(choice == 0 ? "Success" : "Failed")", isError: choice != 0)
            return choice
        case .scheduleLocalNotification:
            append("bell.badge", "Would schedule notification '\(value(block, "title") ?? "")' in \(value(block, "seconds") ?? "5")s (simulated)")
        case .setBadgeCount:
            let count = Int(value(block, "count") ?? "0") ?? 0
            NSApp.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
            append("app.badge", "Dock badge → \(count)")
        case .playSound:
            let file = value(block, "file") ?? ""
            if let sound = NSSound(named: NSSound.Name(file)) ?? NSSound(contentsOfFile: file, byReference: false) {
                sound.play()
                append("speaker.wave.2", "Playing '\(file)'")
            } else {
                append("speaker.wave.2", "Sound '\(file)' not found in preview — will look in the exported app's Resources", isError: true)
            }
        case .stopSound:
            append("speaker.slash", "Stopped sound")
        case .validateForm:
            guard let nodeId = nodeReference(block, key: "element") else {
                append("checkmark.rectangle", "\(block.label): no field linked", isError: true)
                return 1
            }
            let text = designViewModel?.nodeForSimulation(id: nodeId)?.text ?? ""
            let valid = validate(text, rule: value(block, "rule") ?? "notEmpty", argument: value(block, "argument") ?? "")
            append(valid ? "checkmark.circle.fill" : "xmark.circle", "\(block.label) → \(valid ? "Valid" : "Invalid")", isError: !valid)
            return valid ? 0 : 1
        case .clearField:
            if let nodeId = nodeReference(block, key: "element") {
                let name = logicViewModel?.designNodeName(for: nodeId) ?? "field"
                designViewModel?.simulateUpdateNode(id: nodeId) { node in
                    node.text = ""
                    for binding in node.logicBindings ?? [] where binding.kind == .value || binding.kind == .text {
                        variables[binding.variableName] = ""
                    }
                }
                append("xmark.rectangle", "Cleared '\(name)'")
            }
        case .executeCustomCode:
            append("chevron.left.forwardslash.chevron.right", "Custom code only runs in the exported app: \((value(block, "code") ?? "").prefix(80))")
        case .setDarkModeOverride:
            append("circle.lefthalf.filled", "Would set color scheme → \(value(block, "mode") ?? "system") (simulated)")
        case .downloadFile:
            guard let urlString = value(block, "url"), let url = URL(string: substitute(urlString)) else {
                append("arrow.down.circle", "Invalid download URL", isError: true)
                return 1
            }
            append("arrow.down.circle", "Downloading \(url.absoluteString)…")
            do {
                let (tempURL, _) = try await URLSession.shared.download(from: url)
                if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                    variables[storeIn] = tempURL.path
                }
                append("checkmark.circle.fill", "Downloaded to \(tempURL.lastPathComponent)")
                return 0
            } catch {
                append("xmark.circle.fill", "Download failed: \(error.localizedDescription)", isError: true)
                return 1
            }
        case .navigate, .presentSheet:
            let screen = resolvedNodeName(block, key: "screen") ?? value(block, "screen") ?? "?"
            append("arrow.right.circle.fill", "\(block.label) → \(screen)")
            if let screenId = nodeReference(block, key: "screen") {
                // Remember where we came from, so Go Back can actually pop —
                // the exported app pops for real, and a preview that only
                // logged "Go Back" while staying put lied about navigation.
                if let current = previewScreenId, current != screenId {
                    navigationHistory.append(current)
                }
                previewScreenId = screenId
                if let onNavigate {
                    onNavigate(screenId)
                } else {
                    designViewModel?.selectNode(screenId)
                }
            }
        case .goBack, .dismissSheet:
            append("arrow.left.circle", block.label)
            if let previous = navigationHistory.popLast() {
                previewScreenId = previous
                if let onNavigate {
                    onNavigate(previous)
                } else {
                    designViewModel?.selectNode(previous)
                }
                append("arrow.uturn.backward.circle", "→ \(logicViewModel?.designNodeName(for: previous) ?? "previous screen")")
            }
        case .showAlert:
            let title = value(block, "title") ?? "Alert"
            let message = value(block, "message") ?? ""
            append("exclamationmark.bubble.fill", "ALERT: \(title)\(message.isEmpty ? "" : " — \(message)")")
            presentToast("⚠️ \(title)\(message.isEmpty ? "" : " — \(message)")")
        case .showToast:
            let message = value(block, "message") ?? ""
            append("text.bubble", "TOAST: \(message)")
            presentToast(message)
        case .openURL:
            append("safari", "Would open: \(value(block, "url") ?? "?")")
        case .copyToClipboard:
            let text = value(block, "text") ?? ""
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(text, forType: .string)
            append("doc.on.doc", "Copied to clipboard: \(text)")
        case .hapticFeedback:
            append("iphone.radiowaves.left.and.right", "HAPTIC: \(value(block, "style") ?? "light")")
            NSHapticFeedbackManager.defaultPerformer.perform(.generic, performanceTime: .now)
        case .log:
            append("terminal", "LOG: \(value(block, "message") ?? "")")
        case .delay:
            let seconds = max(Double(value(block, "seconds") ?? "1") ?? 1, 0)
            append("hourglass", "Waiting \(formattedNumber(seconds))s…")
            try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        case .startTimer:
            let name = value(block, "name") ?? "mainTimer"
            let seconds = max(Double(value(block, "seconds") ?? "1") ?? 1, 0.05)
            startNamedTimer(name: name, seconds: seconds)
            append("timer.circle", "Started timer '\(name)' every \(formattedNumber(seconds))s — each tick fires the Custom Event named '\(name)'")
        case .stopTimer:
            let name = value(block, "name") ?? "mainTimer"
            stopNamedTimer(name: name)
            append("timer.circle.fill", "Stopped timer '\(name)'")
        case .saveValue:
            let key = value(block, "key") ?? ""
            let savedValue = substitute(value(block, "value") ?? "")
            UserDefaults.standard.set(savedValue, forKey: "AgenticDesignerPreview.\(key)")
            append("externaldrive.badge.checkmark", "Saved \(key)")
        case .customAction:
            append("function", "CUSTOM: \(value(block, "name") ?? "customAction")")
        case .gameSpawn, .gameRemove, .gameImpulse, .gameMove, .gameSetGravity,
             .gameAddScore, .gameEnd, .gamePause, .gameSetVelocity, .gameSetProperty,
             .gameAnimate, .gameAddBehavior, .gameRemoveBehavior, .gameSetHealth,
             .gameShake, .gameParticles, .gameSetTimeScale, .gameSetSpawnRate,
             .gameSetLives, .gameRestart, .gameLaunch, .gameSetPhysics,
             .gameLoadSlingshot, .gameDamage, .gameMotor, .gameTorque:
            // Game commands live with the data ops (they broadcast into the
            // running scene); route them there instead of the log-only default.
            return performDataOperation(block)
        default:
            append("circle", block.label)
        }
        return 0
    }

    // MARK: - Conditions

    private func evaluateCondition(_ block: LogicBlock) -> Int {
        switch block.type {
        case .ifCondition, .compare:
            let left = value(block, "leftValue") ?? value(block, "left") ?? ""
            let op = value(block, "operator") ?? "=="
            let right = value(block, "rightValue") ?? value(block, "right") ?? ""
            return compare(left, op, right) ? 0 : 1
        case .isEmpty:
            return (value(block, "value") ?? "").isEmpty ? 0 : 1
        case .contains:
            let haystack = value(block, "value") ?? ""
            let needle = value(block, "substring") ?? ""
            return haystack.contains(needle) ? 0 : 1
        case .logicalNot:
            return (value(block, "value") == "true") ? 1 : 0
        case .logicalAnd:
            return (value(block, "a") == "true" && value(block, "b") == "true") ? 0 : 1
        case .logicalOr:
            return (value(block, "a") == "true" || value(block, "b") == "true") ? 0 : 1
        case .platformCondition:
            return (value(block, "platform") == previewPlatform.rawValue) ? 0 : 1
        default:
            return 0
        }
    }

    private func compare(_ left: String, _ op: String, _ right: String) -> Bool {
        if let l = Double(left), let r = Double(right) {
            switch op {
            case "==": return l == r
            case "!=": return l != r
            case "<": return l < r
            case ">": return l > r
            case "<=": return l <= r
            case ">=": return l >= r
            default: break
            }
        }
        switch op {
        case "==": return left == right
        case "!=": return left != right
        case "contains": return left.contains(right)
        case "isEmpty": return left.isEmpty
        default: return false
        }
    }

    // MARK: - API

    private func performAPI(_ block: LogicBlock) async -> Int {
        switch block.type {
        case .httpRequest:
            guard let urlString = value(block, "url"),
                  let url = URL(string: substitute(urlString)) else {
                append("network.slash", "Invalid URL", isError: true)
                return 1
            }
            var request = URLRequest(url: url)
            request.httpMethod = value(block, "method") ?? "GET"
            if let body = value(block, "body"), request.httpMethod != "GET" {
                request.httpBody = Data(substitute(body).utf8)
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            }
            append("network", "\(request.httpMethod ?? "GET") \(url.absoluteString)…")
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                variables["statusCode"] = String(status)
                variables["responseBody"] = String(data: data.prefix(6000), encoding: .utf8) ?? ""
                let ok = (200..<300).contains(status)
                append(ok ? "checkmark.circle.fill" : "xmark.circle.fill", "HTTP \(status) (\(data.count) bytes)", isError: !ok)
                return ok ? 0 : 1
            } catch {
                append("xmark.circle.fill", "Request failed: \(error.localizedDescription)", isError: true)
                return 1
            }

        case .parseJSONResponse:
            let path = value(block, "path") ?? ""
            let source = variables["responseBody"] ?? ""
            if let extracted = extractJSONPath(path, from: source) {
                if let variableName = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                    variables[variableName] = extracted
                }
                append("curlybraces", "\(path) = \(extracted.prefix(80))")
                return 0
            }
            append("curlybraces", "Path '\(path)' not found in response", isError: true)
            return 0

        default:
            append("network", block.label)
            return 0
        }
    }

    private func extractJSONPath(_ path: String, from json: String) -> String? {
        guard let data = json.data(using: .utf8),
              var current = try? JSONSerialization.jsonObject(with: data) else { return nil }

        for component in path.split(separator: ".") {
            let key = String(component)
            if let dict = current as? [String: Any], let next = dict[key] {
                current = next
            } else if let array = current as? [Any], let index = Int(key.trimmingCharacters(in: CharacterSet(charactersIn: "[]"))), array.indices.contains(index) {
                current = array[index]
            } else {
                return nil
            }
        }

        if let string = current as? String { return string }
        if let number = current as? NSNumber { return number.stringValue }
        if let data = try? JSONSerialization.data(withJSONObject: current) {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }

    // MARK: - Data operations

    private func performDataOperation(_ block: LogicBlock) -> Int {
        let storeIn = block.parameters.first { $0.key == "variable" }?.variableReference

        switch block.type {
        case .setVariable:
            if let storeIn { variables[storeIn] = substitute(value(block, "value") ?? "") }
            append("arrow.down.doc", "\(storeIn ?? "?") = \(variables[storeIn ?? ""] ?? "")")
        case .toggleVariable:
            if let storeIn {
                let next = variables[storeIn] != "true"
                variables[storeIn] = next ? "true" : "false"
                append("switch.2", "\(storeIn) = \(variables[storeIn] ?? "")")
            }
        case .incrementVariable, .decrementVariable:
            if let storeIn {
                let current = Double(variables[storeIn] ?? "0") ?? 0
                let amount = Double(value(block, "amount") ?? "1") ?? 1
                let next = block.type == .incrementVariable ? current + amount : current - amount
                variables[storeIn] = formattedNumber(next)
                append(block.type == .incrementVariable ? "plus.circle" : "minus.circle", "\(storeIn) = \(variables[storeIn] ?? "")")
            }
        case .appendToArray:
            if let arrayName = block.parameters.first(where: { $0.key == "array" })?.variableReference {
                let item = substitute(value(block, "value") ?? "")
                var parts = variables[arrayName]?.split(separator: "\n").map(String.init) ?? []
                parts.append(item)
                variables[arrayName] = parts.joined(separator: "\n")
                append("text.badge.plus", "Appended to \(arrayName)")
            }
        case .removeFromArray:
            if let arrayName = block.parameters.first(where: { $0.key == "array" })?.variableReference {
                let item = substitute(value(block, "value") ?? "")
                let parts = variables[arrayName]?.split(separator: "\n").map(String.init).filter { $0 != item } ?? []
                variables[arrayName] = parts.joined(separator: "\n")
                append("text.badge.minus", "Removed from \(arrayName)")
            }
        case .getVariable:
            append("arrow.up.doc", "\(storeIn ?? "?") = \(variables[storeIn ?? ""] ?? "(unset)")")
        case .appendJsonItem:
            if let storeIn {
                let item = substitute(value(block, "item") ?? "{}").trimmingCharacters(in: .whitespacesAndNewlines)
                var list = (variables[storeIn] ?? "[]").trimmingCharacters(in: .whitespacesAndNewlines)
                if !list.hasPrefix("[") { list = "[]" }
                list = list == "[]" ? "[\(item)]" : String(list.dropLast()) + ",\(item)]"
                variables[storeIn] = list
                append("text.badge.plus", "Appended item to \(storeIn)")
            }
        case .replaceInVariable:
            if let storeIn {
                let find = substitute(value(block, "find") ?? "")
                let repl = substitute(value(block, "replaceWith") ?? "")
                variables[storeIn] = (variables[storeIn] ?? "").replacingOccurrences(of: find, with: repl)
                append("arrow.2.squarepath", "Replaced in \(storeIn)")
            }
        case .loadValue:
            let key = value(block, "key") ?? ""
            let fallback = substitute(value(block, "default") ?? "")
            let loaded = UserDefaults.standard.string(forKey: "AgenticDesignerPreview.\(key)") ?? fallback
            if let storeIn {
                variables[storeIn] = loaded
                append("externaldrive.badge.plus", "\(storeIn) = \(loaded.isEmpty ? "(nothing saved)" : loaded) (loaded '\(key)')")
            }
        case .getCurrentTime:
            let comps = Calendar.current.dateComponents([.hour, .minute], from: Date())
            let formatted = "\(comps.hour ?? 0):" + String(format: "%02d", comps.minute ?? 0)
            if let storeIn {
                variables[storeIn] = formatted
                append("clock", "\(storeIn) = \(formatted)")
            }
        case .gameSpawn:
            let template = substitute(value(block, "template") ?? "")
            let x = CGFloat(Double(substitute(value(block, "x") ?? "100")) ?? 100)
            let y = CGFloat(Double(substitute(value(block, "y") ?? "100")) ?? 100)
            GameSceneRegistry.broadcast(.spawn(template: template, x: x, y: y))
            append("plus.viewfinder", "Game spawn \(template)")
        case .gameRemove:
            GameSceneRegistry.broadcast(.remove(target: substitute(value(block, "target") ?? "")))
        case .gameImpulse:
            let dx = CGFloat(Double(substitute(value(block, "dx") ?? "0")) ?? 0)
            let dy = CGFloat(Double(substitute(value(block, "dy") ?? "0")) ?? 0)
            GameSceneRegistry.broadcast(.impulse(entity: substitute(value(block, "entity") ?? ""), dx: dx, dy: dy))
        case .gameMove:
            let x = CGFloat(Double(substitute(value(block, "x") ?? "0")) ?? 0)
            let y = CGFloat(Double(substitute(value(block, "y") ?? "0")) ?? 0)
            GameSceneRegistry.broadcast(.move(entity: substitute(value(block, "entity") ?? ""), x: x, y: y))
        case .gameSetGravity:
            GameSceneRegistry.broadcast(.setGravityVector(
                dx: CGFloat(Double(substitute(value(block, "gravityX") ?? "0")) ?? 0),
                dy: CGFloat(Double(substitute(value(block, "gravity") ?? "-18")) ?? -18)
            ))
        case .gameAddScore:
            GameSceneRegistry.broadcast(.addScore(Int(Double(substitute(value(block, "points") ?? "1")) ?? 1)))
        case .gameEnd:
            GameSceneRegistry.broadcast(.end(win: (value(block, "result") ?? "gameOver") == "win"))
        case .gamePause:
            GameSceneRegistry.broadcast(.pause((value(block, "mode") ?? "pause") == "pause"))
        case .gameSetVelocity:
            let vx = CGFloat(Double(substitute(value(block, "vx") ?? "0")) ?? 0)
            let vy = CGFloat(Double(substitute(value(block, "vy") ?? "0")) ?? 0)
            GameSceneRegistry.broadcast(.setVelocity(entity: substitute(value(block, "entity") ?? ""), vx: vx, vy: vy))
        case .gameSetProperty:
            GameSceneRegistry.broadcast(.setProperty(
                entity: substitute(value(block, "entity") ?? ""),
                property: value(block, "property") ?? "color",
                value: substitute(value(block, "value") ?? "")
            ))
        case .gameAnimate:
            GameSceneRegistry.broadcast(.animate(
                entity: substitute(value(block, "entity") ?? ""),
                x: CGFloat(Double(substitute(value(block, "x") ?? "0")) ?? 0),
                y: CGFloat(Double(substitute(value(block, "y") ?? "0")) ?? 0),
                duration: CGFloat(Double(substitute(value(block, "duration") ?? "0.6")) ?? 0.6)
            ))
        case .gameAddBehavior:
            GameSceneRegistry.broadcast(.addBehavior(
                entity: substitute(value(block, "entity") ?? ""),
                behaviorJSON: substitute(value(block, "behavior") ?? "")
            ))
            append("puzzlepiece.extension", "Behavior added")
        case .gameRemoveBehavior:
            GameSceneRegistry.broadcast(.removeBehavior(
                entity: substitute(value(block, "entity") ?? ""),
                type: substitute(value(block, "behaviorType") ?? "")
            ))
        case .gameSetHealth:
            GameSceneRegistry.broadcast(.setHealth(
                entity: substitute(value(block, "entity") ?? ""),
                health: Int(Double(substitute(value(block, "health") ?? "3")) ?? 3)
            ))
        case .gameShake:
            GameSceneRegistry.broadcast(.shake(CGFloat(Double(substitute(value(block, "intensity") ?? "10")) ?? 10)))
        case .gameParticles:
            GameSceneRegistry.broadcast(.particles(
                kind: value(block, "kind") ?? "confetti",
                x: CGFloat(Double(substitute(value(block, "x") ?? "195")) ?? 195),
                y: CGFloat(Double(substitute(value(block, "y") ?? "300")) ?? 300),
                burst: Int(Double(substitute(value(block, "burst") ?? "40")) ?? 40)
            ))
        case .gameSetTimeScale:
            GameSceneRegistry.broadcast(.setTimeScale(CGFloat(Double(substitute(value(block, "scale") ?? "1")) ?? 1)))
        case .gameSetSpawnRate:
            GameSceneRegistry.broadcast(.setSpawnInterval(CGFloat(Double(substitute(value(block, "interval") ?? "1")) ?? 1)))
        case .gameSetLives:
            GameSceneRegistry.broadcast(.setLives(Int(Double(substitute(value(block, "lives") ?? "3")) ?? 3)))
        case .gameRestart:
            GameSceneRegistry.broadcast(.restart)
            append("arrow.counterclockwise.circle", "Game restarted")
        case .gameMotor:
            GameSceneRegistry.broadcast(.motor(
                entity: substitute(value(block, "entity") ?? ""),
                throttle: CGFloat(Double(substitute(value(block, "throttle") ?? "1")) ?? 1)
            ))
        case .gameTorque:
            GameSceneRegistry.broadcast(.torque(
                entity: substitute(value(block, "entity") ?? ""),
                amount: CGFloat(Double(substitute(value(block, "amount") ?? "40")) ?? 40)
            ))
        case .gameLoadSlingshot:
            GameSceneRegistry.broadcast(.loadSlingshot(entity: substitute(value(block, "entity") ?? "")))
            append("arrow.uturn.backward.circle", "Slingshot reloaded")
        case .gameDamage:
            GameSceneRegistry.broadcast(.damageEntity(
                entity: substitute(value(block, "entity") ?? ""),
                amount: Int(Double(substitute(value(block, "amount") ?? "1")) ?? 1)
            ))
        case .gameLaunch:
            GameSceneRegistry.broadcast(.launch(
                entity: substitute(value(block, "entity") ?? ""),
                angle: CGFloat(Double(substitute(value(block, "angle") ?? "60")) ?? 60),
                strength: CGFloat(Double(substitute(value(block, "strength") ?? "40")) ?? 40)
            ))
        case .gameSetPhysics:
            GameSceneRegistry.broadcast(.setPhysics(
                entity: substitute(value(block, "entity") ?? ""),
                property: value(block, "property") ?? "bounciness",
                value: substitute(value(block, "value") ?? "")
            ))
        case .gameQuery:
            let what = value(block, "what") ?? "score"
            let target = substitute(value(block, "target") ?? "")
            let result = GameSceneRegistry.query(what, target)
            if let storeIn {
                variables[storeIn] = result
                append("eye", "\(storeIn) = \(result) (game \(what))")
            }
        case .ringAlarm:
            let style = substitute(value(block, "style") ?? "classic")
            NSSound(named: "Sosumi")?.play()
            presentToast("🔔 Ringing — \(style)")
            append("bell.and.waves.left.and.right", "Alarm ringing (\(style))")
        case .scheduleNotificationAt:
            let h = substitute(value(block, "hour") ?? "6")
            let m = substitute(value(block, "minute") ?? "30")
            presentToast("⏰ Alarm notification scheduled for \(h):\(m.count == 1 ? "0" + m : m)")
            append("alarm", "Daily notification scheduled at \(h):\(m)")
        case .randomNumber:
            let lo = Int(Double(value(block, "min") ?? "") ?? 1)
            let hi = Int(Double(value(block, "max") ?? "") ?? 10)
            let rolled = Int.random(in: min(lo, hi)...max(lo, hi))
            if let storeIn {
                variables[storeIn] = String(rolled)
                append("die.face.5", "\(storeIn) = \(rolled) (random \(lo)–\(hi))")
            }
        case .mathOperation:
            let l = Double(value(block, "left") ?? "") ?? 0
            let r = Double(value(block, "right") ?? "") ?? 0
            let op = value(block, "operator") ?? "+"
            let result: Double
            switch op {
            case "-": result = l - r
            case "×": result = l * r
            case "÷": result = r == 0 ? 0 : l / r
            case "%": result = r == 0 ? 0 : l.truncatingRemainder(dividingBy: r)
            default: result = l + r
            }
            // Whole results store as "42", not "42.0" — string comparisons
            // against typed answers must not fail on a phantom decimal.
            if let storeIn {
                variables[storeIn] = result.truncatingRemainder(dividingBy: 1) == 0
                    ? String(Int(result)) : String(result)
            }
            append("plus.forwardslash.minus", "\(l) \(op) \(r) = \(result)")
        case .stringOperation:
            let input = substitute(value(block, "input") ?? "")
            let argument = substitute(value(block, "argument") ?? "")
            let op = value(block, "operation") ?? "concat"
            let result: String
            switch op {
            case "uppercase": result = input.uppercased()
            case "lowercase": result = input.lowercased()
            case "trim": result = input.trimmingCharacters(in: .whitespacesAndNewlines)
            case "replace": result = input.replacingOccurrences(of: argument, with: "")
            default: result = input + argument
            }
            if let storeIn { variables[storeIn] = result }
            append("textformat.abc", "\(op) → \(result.prefix(60))")
        case .generateId:
            if let storeIn { variables[storeIn] = UUID().uuidString }
            append("number.square", "Generated ID")
        case .jsonParse:
            let input = substitute(value(block, "input") ?? "")
            let valid = (try? JSONSerialization.jsonObject(with: Data(input.utf8))) != nil
            if let storeIn, valid { variables[storeIn] = input }
            append("doc.badge.gearshape", valid ? "JSON parsed" : "Invalid JSON", isError: !valid)
            return valid ? 0 : 1
        default:
            append("number", block.label)
        }
        return 0
    }

    // MARK: - UI updates (really mutate the designed screen)

    private func performUIUpdate(_ block: LogicBlock) {
        switch block.type {
        case .presentBottomSheet:
            let screen = resolvedNodeName(block, key: "screen") ?? value(block, "screen") ?? "?"
            append("rectangle.bottomthird.inset.filled", "Bottom sheet → \(screen)")
            if let screenId = nodeReference(block, key: "screen") {
                previewScreenId = screenId
                if let onNavigate {
                    onNavigate(screenId)
                } else {
                    designViewModel?.selectNode(screenId)
                }
            }
            return
        case .dismissBottomSheet:
            append("rectangle.bottomthird.inset.filled", "Dismissed bottom sheet")
            return
        case .presentDatePicker:
            if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                variables[storeIn] = ISO8601DateFormatter().string(from: Date())
                append("calendar.badge.clock", "\(storeIn) = \(variables[storeIn] ?? "") (simulated — real picker appears in the exported app)")
            }
            return
        case .presentColorPicker:
            if let storeIn = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                variables[storeIn] = "#3B82F6"
                append("eyedropper", "\(storeIn) = #3B82F6 (simulated — real picker appears in the exported app)")
            }
            return
        default:
            break
        }

        guard let nodeId = nodeReference(block, key: "element") else {
            append("eye.slash", "\(block.label): no element linked", isError: true)
            return
        }
        let name = logicViewModel?.designNodeName(for: nodeId) ?? "element"
        hasUIChanges = true

        switch block.type {
        case .setText:
            let text = substitute(value(block, "text") ?? "")
            designViewModel?.simulateUpdateNode(id: nodeId) { $0.text = text }
            append("textformat", "'\(name)' text → \(text)")
        case .setColor:
            let color = value(block, "color") ?? "#3B82F6"
            let property = value(block, "property") ?? "fill"
            designViewModel?.simulateUpdateNode(id: nodeId) { node in
                switch property {
                case "textColor": node.style.textColor = color
                case "stroke": node.style.stroke = color
                default: node.style.fill = color
                }
            }
            append("paintbrush.fill", "'\(name)' \(property) → \(color)")
        case .setVisible:
            let visible = value(block, "visible") != "false"
            designViewModel?.simulateUpdateNode(id: nodeId) { $0.style.opacity = visible ? 1 : 0.08 }
            append("eye", "'\(name)' \(visible ? "shown" : "hidden")")
        case .setEnabled:
            let enabled = value(block, "enabled") != "false"
            designViewModel?.simulateUpdateNode(id: nodeId) { $0.style.opacity = enabled ? 1 : 0.45 }
            append("hand.raised.slash", "'\(name)' \(enabled ? "enabled" : "disabled")")
        case .setLoading:
            let loading = value(block, "loading") != "false"
            designViewModel?.simulateUpdateNode(id: nodeId) { $0.style.opacity = loading ? 0.55 : 1 }
            append("arrow.triangle.2.circlepath", "'\(name)' loading: \(loading)")
        case .setImage:
            if let source = value(block, "source") {
                designViewModel?.simulateUpdateNode(id: nodeId) { $0.imageSource = source }
                append("photo", "'\(name)' image updated")
            }
        case .scrollTo:
            let offset = Double(value(block, "offset") ?? "") ?? 0
            let axis = value(block, "axis") ?? "vertical"
            let duration = max(0.05, Double(value(block, "duration") ?? "") ?? 0.3)
            withAnimation(.easeInOut(duration: duration)) {
                designViewModel?.simulateUpdateNode(id: nodeId) { node in
                    var behavior = node.scrollBehavior ?? ScrollBehavior(axis: axis)
                    behavior.axis = axis
                    behavior.initialOffset = CGFloat(max(0, offset))
                    node.scrollBehavior = behavior
                    node.clipContent = true
                }
            }
            append("arrow.down.to.line", "'\(name)' scroll \(axis) → \(Int(offset))")
        case .animate:
            let property = value(block, "property") ?? "opacity"
            let target = value(block, "to") ?? ""
            let number = CGFloat(Double(target) ?? 0)
            let duration = max(0.05, Double(value(block, "duration") ?? "") ?? 0.3)
            withAnimation(.interactiveSpring(response: duration, dampingFraction: 0.82)) {
                designViewModel?.simulateUpdateNode(id: nodeId) { node in
                    switch property {
                    case "opacity":
                        node.style.opacity = min(max(Double(number), 0), 1)
                    case "scale":
                        let scale = max(number, 0.05)
                        let centerX = node.x + node.width / 2
                        let centerY = node.y + node.height / 2
                        node.width = max(1, node.width * scale)
                        node.height = max(1, node.height * scale)
                        node.x = centerX - node.width / 2
                        node.y = centerY - node.height / 2
                    case "x":
                        node.x = number
                    case "y":
                        node.y = number
                    case "width":
                        node.width = max(1, number)
                    case "height":
                        node.height = max(1, number)
                    case "cornerRadius":
                        node.style.cornerRadius = max(0, number)
                    default:
                        node.style.opacity = min(max(Double(number), 0), 1)
                    }
                }
            }
            append("wand.and.rays", "'\(name)' \(property) → \(target)")
        case .bindProperty:
            guard let variableName = block.parameters.first(where: { $0.key == "variable" })?.variableReference else {
                append("link.circle", "Binding needs a variable", isError: true)
                return
            }
            let property = value(block, "property") ?? "text"
            designViewModel?.simulateUpdateNode(id: nodeId) { node in
                let kind = NodeLogicBindingKind(rawValue: property) ?? .text
                var bindings = node.logicBindings ?? []
                bindings.removeAll { $0.kind == kind }
                bindings.append(NodeLogicBinding(kind: kind, variableName: variableName))
                node.logicBindings = bindings
                if kind == .text || kind == .value {
                    node.text = variables[variableName] ?? node.text
                }
                if kind == .visibility {
                    node.style.opacity = variables[variableName] == "false" ? 0.08 : 1
                }
            }
            append("link.circle", "'\(name)' \(property) bound to \(variableName)")
        case .setNavigationSelection:
            if let variableName = block.parameters.first(where: { $0.key == "variable" })?.variableReference {
                variables[variableName] = substitute(value(block, "value") ?? "")
                append("sidebar.left", "Navigation selection = \(variables[variableName] ?? "")")
            }
        default:
            append("wand.and.rays", "\(block.label) on '\(name)'")
        }
    }

    // MARK: - Parameter resolution

    // Resolution order: linked design node's text → variable → literal value,
    // with {{variable}} substitution applied to literals.
    private func value(_ block: LogicBlock, _ key: String) -> String? {
        guard let param = block.parameters.first(where: { $0.key == key }) else { return nil }

        if let nodeId = param.nodeReference, param.type == .nodeReference {
            let node = designViewModel?.nodeForSimulation(id: nodeId)
            return node?.text ?? node?.name
        }
        if let variableName = param.variableReference, !variableName.isEmpty {
            return variables[variableName] ?? ""
        }
        if let literal = param.value { return substitute(literal) }
        return nil
    }

    private func nodeReference(_ block: LogicBlock, key: String) -> UUID? {
        block.parameters.first { $0.key == key }?.nodeReference
    }

    private func resolvedNodeName(_ block: LogicBlock, key: String) -> String? {
        logicViewModel?.designNodeName(for: nodeReference(block, key: key))
    }

    private func substitute(_ text: String) -> String {
        var result = text
        for (name, val) in variables {
            result = result.replacingOccurrences(of: "{{\(name)}}", with: val)
        }
        // The same reserved tokens the exporters resolve. Without them the
        // preview wrote documents to literal "users/{{uid}}" while the exported
        // app wrote "users/<real uid>" — the preview then "worked" in a way the
        // shipped app never would.
        guard result.contains("{{") else { return result }
        let uid = variables["currentUserId"] ?? "sim-user-001"
        for token in ["uid", "userId", "userid", "currentUserId"] {
            result = result.replacingOccurrences(of: "{{\(token)}}", with: uid)
        }
        let now = ISO8601DateFormatter().string(from: Date())
        for token in ["now", "timestamp", "createdAt", "createdat"] {
            result = result.replacingOccurrences(of: "{{\(token)}}", with: now)
        }
        return result
    }

    // Opens the Mac equivalent of an iOS URL-scheme action (mailto:/tel:/sms:)
    // so Share/Email/Call/SMS blocks do something real in the live preview.
    private func openOnMac(scheme: String, target: String, label: String) {
        let encoded = target.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? target
        guard !target.isEmpty, let url = URL(string: "\(scheme):\(encoded)") else {
            append("questionmark.circle", "\(label) needs a value", isError: true)
            return
        }
        NSWorkspace.shared.open(url)
        append("paperplane", "Would \(label) \(target)")
    }

    private func validate(_ text: String, rule: String, argument: String) -> Bool {
        switch rule {
        case "email":
            return text.range(of: #"^\S+@\S+\.\S+$"#, options: .regularExpression) != nil
        case "minLength":
            return text.count >= (Int(argument) ?? 0)
        case "matchesRegex":
            return text.range(of: argument, options: .regularExpression) != nil
        default:
            return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    func setInputValue(nodeId: UUID, text: String) {
        designViewModel?.simulateUpdateNode(id: nodeId) { node in
            node.text = text
            for binding in node.logicBindings ?? [] where binding.kind == .value || binding.kind == .text {
                variables[binding.variableName] = text
            }
        }
        runEvent([.onChange], nodeId: nodeId)
    }

    private func awaitBranchChoice(block: LogicBlock, labels: [String]) async -> Int {
        awaitingChoice = BranchChoice(blockLabel: block.label, labels: labels)
        return await withCheckedContinuation { continuation in
            choiceContinuation = continuation
        }
    }

    private func append(_ icon: String, _ message: String, isError: Bool = false) {
        log.append(SimLogEntry(icon: icon, message: message, isError: isError))
    }

    private func defaultValue(for type: VariableType) -> String {
        switch type {
        case .number: return "0"
        case .boolean: return "false"
        case .array: return ""
        case .json: return "{}"
        case .optional: return ""
        case .string: return ""
        }
    }

    private func formattedNumber(_ value: Double) -> String {
        value.rounded() == value ? String(Int(value)) : String(value)
    }

    // Shows a toast bubble in the preview window, replacing any current one.
    private func presentToast(_ message: String) {
        toastTask?.cancel()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) {
            toastMessage = message
        }
        toastTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 2_400_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: 0.25)) {
                self?.toastMessage = nil
            }
        }
    }
}
