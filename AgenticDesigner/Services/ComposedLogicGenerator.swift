//
//  ComposedLogicGenerator.swift
//  AgenticDesigner
//
//  Reliable interactivity. The free-form logic agent (model authors a whole
//  block graph) fails often — on small models it returns empty flows, so
//  "generated" apps aren't actually clickable. This takes the same approach
//  that fixed design quality: the model only DECIDES intent as a tiny JSON
//  ("Continue on Detail → go to Favorites"), and a deterministic engine
//  builds correct blocks, parameters and connections.
//
//  It also AUTO-WIRES what needs no model at all: bottom tab bars and back
//  buttons. Every app gets working navigation even if the model contributes
//  nothing.
//

import Foundation
import CoreGraphics

@MainActor
enum ComposedLogicGenerator {

    struct Intents: Decodable {
        let interactions: [Interaction]
    }

    struct Interaction: Decodable {
        let element: String          // the element's visible label/name
        let screen: String?          // which screen it lives on (disambiguates)
        let action: String           // navigate | back | toast | toggle | set
        let target: String?          // screen name for navigate
        let message: String?         // toast text
        let variable: String?        // for toggle/set
        let value: String?           // for set
    }

    struct Result {
        var flowCount = 0
        var wiredElements = 0
        var autoWired = 0
    }

    // MARK: - Entry point

    static func generate(
        prompt: String,
        provider: OpenRouterProvider?,
        design: ProjectViewModel,
        logic: LogicViewModel
    ) async -> Result {
        var result = Result()
        let screens = screenList(design)
        guard !screens.isEmpty else { return result }

        // Without this the view model has no back-reference to the project and
        // persist() silently no-ops — flows land in memory and never reach the
        // page, so the app looks wired but exports/previews see nothing.
        logic.attach(to: design)

        var flows: [LogicFlow] = []

        // 1. Deterministic auto-wiring — no model, never fails.
        let auto = autoWireFlows(design: design, screens: screens)
        flows.append(contentsOf: auto.flows)
        result.autoWired = auto.count

        // 2. Model-decided interactions (best effort — the app is already
        //    navigable without them).
        if let provider {
            if let intents = try? await requestIntents(prompt: prompt, provider: provider, design: design, screens: screens) {
                let built = buildFlows(from: intents, design: design, screens: screens)
                flows.append(contentsOf: built.flows)
                result.wiredElements = built.count
            }
        }

        guard !flows.isEmpty else { return result }
        logic.applyGenerated(flows: flows)
        result.flowCount = flows.count
        return result
    }

    // MARK: - Deterministic auto-wiring

    /// Two unambiguous cases need no model:
    ///  - a bottom tab bar: tab N goes to screen N (POSITIONAL — real tab
    ///    labels like "Home/Discover" rarely match screen names, and matching
    ///    them by text wires decorative labels by accident);
    ///  - a Back/Close button: goes back.
    /// Self-navigation (a tab pointing at the screen it's already on) is
    /// skipped — that's the active tab.
    private static func autoWireFlows(
        design: ProjectViewModel,
        screens: [(id: UUID, name: String)]
    ) -> (flows: [LogicFlow], count: Int) {
        var flows: [LogicFlow] = []
        var count = 0
        // Toggle knobs need an isOn binding on the design node, applied after
        // the walk so we never mutate the tree we're reading.
        var bindings: [(nodeId: UUID, variable: String)] = []
        var toggleVariables: Set<String> = []

        for screen in screens {
            guard let screenNode = findNode(id: screen.id, in: design) else { continue }
            var blocks: [LogicBlock] = []
            var connections: [BlockConnection] = []
            var y: CGFloat = 40

            func add(_ pair: (blocks: [LogicBlock], connections: [BlockConnection])?) {
                guard let pair else { return }
                blocks.append(contentsOf: pair.blocks)
                connections.append(contentsOf: pair.connections)
                count += 1
                y += 120
            }

            // Tab bar → positional mapping.
            if let navBar = navigationBar(in: screenNode) {
                let items = tabItems(in: navBar)
                // Match each tab to the screen its LABEL names — never by
                // array index. Indexing into screens[] sent "Favorites" to
                // whatever screen happened to sit at that position (often the
                // Cart), because the page also holds Splash/Login/Detail that
                // are not tabs at all.
                for item in items {
                    let label = (item.text ?? item.name).trimmingCharacters(in: .whitespaces)
                    guard !label.isEmpty else { continue }
                    guard let target = bestScreenMatch(for: label, in: screens, excluding: screen.id) else { continue }
                    add(chain(trigger: item.id, action: .navigate, screenTarget: target.id, at: y))
                }
            }

            // Back / close buttons (real Buttons only — never stray text).
            for element in buttons(in: screenNode) {
                let label = (element.text ?? element.name).trimmingCharacters(in: .whitespaces).lowercased()
                if ["back", "close", "cancel", "←", "‹", "dismiss"].contains(label) {
                    add(chain(trigger: element.id, action: .goBack, screenTarget: nil, at: y))
                }
            }

            // Toggles: tapping the track flips a variable named after the row,
            // and the knob binds to it — so settings screens actually work.
            for (track, row) in toggleTracks(in: screenNode) {
                let variable = variableName(for: row)
                add(chain(trigger: track.id, action: .toggleVariable, screenTarget: nil, variable: variable, at: y))
                if let knob = descendant(of: track, named: "Toggle Knob") {
                    bindings.append((nodeId: knob.id, variable: variable))
                }
                toggleVariables.insert(variable)
            }

            if !blocks.isEmpty {
                flows.append(LogicFlow(
                    name: "\(screen.name) Navigation",
                    blocks: blocks,
                    connections: connections,
                    screenNodeId: screen.id
                ))
            }
        }

        // Toggle state: declare the variables and bind each knob to its own,
        // so the knob visibly reflects the state everywhere it renders.
        if !toggleVariables.isEmpty {
            for name in toggleVariables where !design.project.globalVariables.contains(where: { $0.name == name }) {
                design.project.globalVariables.append(
                    LogicVariable(name: name, type: .boolean, defaultValue: "false", scope: .global)
                )
            }
            for binding in bindings {
                applyBinding(nodeId: binding.nodeId, variable: binding.variable, design: design)
            }
        }
        return (flows, count)
    }

    // MARK: - Toggle helpers

    /// Detect toggles by their inner "Toggle Track" node, not the container's
    /// name — applyDesignActions renames component roots, so the row name is
    /// unreliable. Returns each track (the tap target) with its row (which
    /// holds the Title used to name the variable).
    private static func toggleTracks(in screen: DesignNode) -> [(track: DesignNode, row: DesignNode)] {
        var out: [(DesignNode, DesignNode)] = []
        func walk(_ node: DesignNode) {
            for child in node.children {
                if child.name == "Toggle Track" { out.append((child, node)) }
                walk(child)
            }
        }
        walk(screen)
        return out
    }

    private static func descendant(of node: DesignNode, named name: String) -> DesignNode? {
        for child in node.children {
            if child.name == name { return child }
            if let found = descendant(of: child, named: name) { return found }
        }
        return nil
    }

    /// "Dark Mode" row -> darkModeEnabled
    private static func variableName(for toggle: DesignNode) -> String {
        let title = descendant(of: toggle, named: "Title")?.text ?? toggle.name
        let words = title
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
        guard let first = words.first?.lowercased() else { return "toggleEnabled" }
        let rest = words.dropFirst().map { $0.capitalized }.joined()
        return first + rest + "Enabled"
    }

    private static func applyBinding(nodeId: UUID, variable: String, design: ProjectViewModel) {
        func walk(_ nodes: inout [DesignNode]) -> Bool {
            for index in nodes.indices {
                if nodes[index].id == nodeId {
                    var existing = nodes[index].logicBindings ?? []
                    guard !existing.contains(where: { $0.kind == .isOn && $0.variableName == variable }) else { return true }
                    existing.append(NodeLogicBinding(kind: .isOn, variableName: variable))
                    nodes[index].logicBindings = existing
                    return true
                }
                if walk(&nodes[index].children) { return true }
            }
            return false
        }
        let pageIndex = design.currentPageIndex
        guard design.project.pages.indices.contains(pageIndex) else { return }
        _ = walk(&design.project.pages[pageIndex].nodes)
    }

    /// The bottom tab container (ComponentFactory names it "Bottom Navigation";
    /// fall back to any wide, bottom-anchored frame named like a nav/tab bar).
    private static func navigationBar(in screen: DesignNode) -> DesignNode? {
        var found: DesignNode?
        func walk(_ node: DesignNode) {
            let name = node.name.lowercased()
            if node.type == .Frame,
               name.contains("nav") || name.contains("tab bar") || name.contains("tabbar") {
                found = found ?? node
            }
            node.children.forEach(walk)
        }
        screen.children.forEach(walk)
        return found
    }

    /// One tappable per tab, left-to-right. Prefer the label texts; if the bar
    /// only has icons, use those.
    private static func tabItems(in navBar: DesignNode) -> [DesignNode] {
        var labels: [DesignNode] = []
        var icons: [DesignNode] = []
        func walk(_ node: DesignNode) {
            if node.type == .Text, let text = node.text, !text.isEmpty { labels.append(node) }
            if node.type == .Icon { icons.append(node) }
            node.children.forEach(walk)
        }
        navBar.children.forEach(walk)
        let items = labels.isEmpty ? icons : labels
        return items.sorted { $0.x < $1.x }
    }

    private static func buttons(in screen: DesignNode) -> [DesignNode] {
        var out: [DesignNode] = []
        func walk(_ node: DesignNode) {
            if node.type == .Button { out.append(node) }
            node.children.forEach(walk)
        }
        screen.children.forEach(walk)
        return out
    }

    // MARK: - Model-decided interactions

    private static func requestIntents(
        prompt: String,
        provider: OpenRouterProvider,
        design: ProjectViewModel,
        screens: [(id: UUID, name: String)]
    ) async throws -> Intents {
        let screenLines = screens.map { screen -> String in
            let node = findNode(id: screen.id, in: design)
            let elements = node.map { tappableDescendants(of: $0) } ?? []
            let labels = elements
                .compactMap { ($0.text ?? $0.name).trimmingCharacters(in: .whitespaces) }
                .filter { !$0.isEmpty }
                .prefix(12)
            return "- \(screen.name): [\(labels.joined(separator: ", "))]"
        }.joined(separator: "\n")

        let system = """
        You wire interactions for a mobile app. Respond with ONE JSON object only:
        {"interactions":[{"element":"<button label>","screen":"<screen it is on>",\
        "action":"navigate|back|toast|toggle","target":"<screen name for navigate>",\
        "message":"<text for toast>","variable":"<name for toggle>"}]}

        Rules:
        - Use ONLY the exact element labels and screen names given.
        - Wire the primary call-to-action on each screen so a user can tap through the app.
        - Prefer "navigate" between screens; use "toast" for confirmations (e.g. Save, Add).
        - Do not invent elements that were not listed.
        """
        let user = """
        App: \(prompt)

        SCREENS AND THEIR TAPPABLE ELEMENTS:
        \(screenLines)

        Return the JSON object only.
        """

        let content = try await provider.generateRawChat(
            messages: [
                OpenRouterMessage(role: "system", content: system),
                OpenRouterMessage(role: "user", content: user),
            ],
            jsonMode: true
        )
        guard let start = content.firstIndex(of: "{"),
              let end = content.lastIndex(of: "}") else {
            throw AIProviderError.invalidJSON("No JSON object in interaction response.")
        }
        return try JSONDecoder().decode(Intents.self, from: Data(String(content[start...end]).utf8))
    }

    private static func buildFlows(
        from intents: Intents,
        design: ProjectViewModel,
        screens: [(id: UUID, name: String)]
    ) -> (flows: [LogicFlow], count: Int) {
        var byScreen: [UUID: (blocks: [LogicBlock], connections: [BlockConnection], y: CGFloat)] = [:]
        var count = 0

        for interaction in intents.interactions {
            // Resolve the element inside its screen (label match, fuzzy).
            guard let (screenId, elementId) = resolveElement(
                label: interaction.element,
                screenName: interaction.screen,
                design: design,
                screens: screens
            ) else { continue }

            let action: LogicBlockType
            var screenTarget: UUID?
            var message: String?
            var variable: String?

            switch interaction.action.lowercased() {
            case "navigate":
                guard let targetName = interaction.target,
                      let target = screens.first(where: { fuzzyEqual($0.name, targetName) })
                else { continue }
                action = .navigate
                screenTarget = target.id
            case "back":
                action = .goBack
            case "toast":
                action = .showToast
                message = interaction.message ?? "Done"
            case "toggle":
                guard let name = interaction.variable else { continue }
                action = .toggleVariable
                variable = name
            default:
                continue
            }

            var entry = byScreen[screenId] ?? ([], [], 40)
            guard let pair = chain(
                trigger: elementId,
                action: action,
                screenTarget: screenTarget,
                message: message,
                variable: variable,
                at: entry.y
            ) else { continue }
            entry.blocks.append(contentsOf: pair.blocks)
            entry.connections.append(contentsOf: pair.connections)
            entry.y += 120
            byScreen[screenId] = entry
            count += 1
        }

        let flows = byScreen.compactMap { screenId, entry -> LogicFlow? in
            guard !entry.blocks.isEmpty else { return nil }
            let name = screens.first { $0.id == screenId }?.name ?? "Screen"
            return LogicFlow(
                name: "\(name) Interactions",
                blocks: entry.blocks,
                connections: entry.connections,
                screenNodeId: screenId
            )
        }
        return (flows, count)
    }

    // MARK: - Block construction

    /// onTap(element) → action. Built from the real catalog so parameters and
    /// ports always match what the editor/exporters expect.
    private static func chain(
        trigger elementId: UUID,
        action: LogicBlockType,
        screenTarget: UUID? = nil,
        message: String? = nil,
        variable: String? = nil,
        at y: CGFloat
    ) -> (blocks: [LogicBlock], connections: [BlockConnection])? {
        guard var tap = BlockCatalog.makeBlock(type: .onTap, at: CGPoint(x: 40, y: y)),
              var act = BlockCatalog.makeBlock(type: action, at: CGPoint(x: 320, y: y))
        else { return nil }

        tap.connectedDesignNodeId = elementId
        if let index = tap.parameters.firstIndex(where: { $0.key == "element" }) {
            tap.parameters[index].nodeReference = elementId
        }

        for index in act.parameters.indices {
            switch act.parameters[index].key {
            case "screen" where screenTarget != nil:
                act.parameters[index].nodeReference = screenTarget
            case "message" where message != nil, "title" where message != nil:
                act.parameters[index].value = message
            case "variable" where variable != nil:
                act.parameters[index].variableReference = variable
            default:
                continue
            }
        }

        let connection = BlockConnection(
            sourceBlockId: tap.id, sourcePortIndex: 0,
            targetBlockId: act.id, targetPortIndex: 0
        )
        return ([tap, act], [connection])
    }

    // MARK: - Resolution helpers

    private static func screenList(_ design: ProjectViewModel) -> [(id: UUID, name: String)] {
        design.project.pages[design.currentPageIndex].nodes
            .filter { $0.type == .Frame }
            .map { ($0.id, $0.name) }
    }

    private static func findNode(id: UUID, in design: ProjectViewModel) -> DesignNode? {
        func search(_ nodes: [DesignNode]) -> DesignNode? {
            for node in nodes {
                if node.id == id { return node }
                if let found = search(node.children) { return found }
            }
            return nil
        }
        return search(design.project.pages[design.currentPageIndex].nodes)
    }

    /// Candidates the model may wire: real Buttons plus tab-bar items. Stray
    /// Text is deliberately excluded — a card subtitle that happens to read
    /// "Today" is not a control, and wiring it produces phantom taps.
    private static func tappableDescendants(of node: DesignNode) -> [DesignNode] {
        var out: [DesignNode] = buttons(in: node)
        if let navBar = navigationBar(in: node) {
            out.append(contentsOf: tabItems(in: navBar))
        }
        return out
    }

    private static func resolveElement(
        label: String,
        screenName: String?,
        design: ProjectViewModel,
        screens: [(id: UUID, name: String)]
    ) -> (screenId: UUID, elementId: UUID)? {
        let candidateScreens = screenName.flatMap { name in
            screens.filter { fuzzyEqual($0.name, name) }
        } ?? screens

        for screen in candidateScreens.isEmpty ? screens : candidateScreens {
            guard let screenNode = findNode(id: screen.id, in: design) else { continue }
            let elements = tappableDescendants(of: screenNode)
            // Prefer real buttons over text labels on ties.
            if let match = elements.first(where: {
                $0.type == .Button && fuzzyEqual($0.text ?? $0.name, label)
            }) ?? elements.first(where: { fuzzyEqual($0.text ?? $0.name, label) }) {
                return (screen.id, match.id)
            }
        }
        return nil
    }

    /// The screen a tab labelled `label` should go to. Prefers an exact
    /// (normalized) name match; a common tab like "Home" that has no matching
    /// screen returns nil rather than being wired to an arbitrary one.
    private static func bestScreenMatch(
        for label: String, in screens: [(id: UUID, name: String)], excluding current: UUID
    ) -> (id: UUID, name: String)? {
        let candidates = screens.filter { $0.id != current }
        func norm(_ s: String) -> String {
            s.lowercased().components(separatedBy: CharacterSet.alphanumerics.inverted).joined()
        }
        let target = norm(label)
        guard !target.isEmpty else { return nil }
        if let exact = candidates.first(where: { norm($0.name) == target }) { return exact }
        // "Home"/"Main" is unambiguous: it always means the first screen. This
        // is the one positional mapping that is never wrong, and it keeps the
        // primary tab working when a template's tab labels don't match screen
        // names (Shop/Product/Cart vs Home/Discover/…).
        if ["home", "main"].contains(target), let first = screens.first, first.id != current {
            return first
        }
        // Only accept a containment match when it's unambiguous — one screen
        // name contains the whole label (so "Profile" → "Profile Settings",
        // but "Home" won't grab "HomeDetail" unless it's the only candidate).
        let contained = candidates.filter { norm($0.name).contains(target) || target.contains(norm($0.name)) }
        return contained.count == 1 ? contained.first : nil
    }

    private static func fuzzyEqual(_ a: String, _ b: String) -> Bool {
        func normalize(_ s: String) -> String {
            s.lowercased()
                .components(separatedBy: CharacterSet.alphanumerics.inverted)
                .joined()
        }
        let na = normalize(a), nb = normalize(b)
        guard !na.isEmpty, !nb.isEmpty else { return false }
        return na == nb || na.contains(nb) || nb.contains(na)
    }
}
