//
//  ComposedAppGenerator.swift
//  AgenticDesigner
//
//  Quality-first generation: the model DECIDES (screens, registry
//  components, copy, style) as a compact JSON; the component factory RENDERS
//  those decisions with the same deterministic assembly the template gallery
//  uses. Layout polish comes from code, content from the model — so even a
//  small local model produces clean screens, in seconds, reliably.
//

import Foundation
import CoreGraphics

@MainActor
enum ComposedAppGenerator {

    /// Wraps a Decodable so one malformed element in an array doesn't reject
    /// the whole array — the value is simply nil and gets filtered out.
    private struct Failable<T: Decodable>: Decodable {
        let value: T?
        init(from decoder: Decoder) throws { value = try? T(from: decoder) }
    }

    struct ComposedApp: Decodable {
        let appName: String?
        let style: String?
        let screens: [ComposedScreen]

        private enum CodingKeys: String, CodingKey { case appName, style, screens }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            appName = try? c.decode(String.self, forKey: .appName)
            style = try? c.decode(String.self, forKey: .style)
            // Skip any screen the model malformed rather than losing the app.
            let raw = (try? c.decode([Failable<ComposedScreen>].self, forKey: .screens)) ?? []
            screens = raw.compactMap(\.value)
        }
    }

    struct ComposedScreen: Decodable {
        let name: String
        let components: [ComposedComponent]
        let bottomBar: Bool?

        private enum CodingKeys: String, CodingKey { case name, components, bottomBar }
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            // A missing name shouldn't cost a whole screen of real components.
            name = (try? c.decode(String.self, forKey: .name)) ?? "Screen"
            let raw = (try? c.decode([Failable<ComposedComponent>].self, forKey: .components)) ?? []
            components = raw.compactMap(\.value)
            // bottomBar may arrive as a bool or the string "true".
            if let b = try? c.decode(Bool.self, forKey: .bottomBar) { bottomBar = b }
            else if let s = try? c.decode(String.self, forKey: .bottomBar) { bottomBar = (s.lowercased() == "true") }
            else { bottomBar = nil }
        }
    }

    struct ComposedComponent: Decodable {
        let type: String
        let props: [String: String]?

        init(type: String, props: [String: String]?) {
            self.type = type
            self.props = props
        }

        private enum CodingKeys: String, CodingKey { case type, props }
        private struct DynamicKey: CodingKey {
            var stringValue: String
            var intValue: Int? { nil }
            init(stringValue: String) { self.stringValue = stringValue }
            init?(intValue: Int) { nil }
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            type = try container.decode(String.self, forKey: .type)
            // Small local models routinely emit numbers or bools inside props
            // ("progress": 0.85, "count": 12). A strict [String: String] decode
            // rejects the ENTIRE app for one such value — the exact cause of
            // "Composer returned no screens". Coerce each value to a string
            // (which is what the component factory reads anyway).
            if let nested = try? container.nestedContainer(keyedBy: DynamicKey.self, forKey: .props) {
                var dict: [String: String] = [:]
                for key in nested.allKeys {
                    if let s = try? nested.decode(String.self, forKey: key) {
                        dict[key.stringValue] = s
                    } else if let b = try? nested.decode(Bool.self, forKey: key) {
                        dict[key.stringValue] = b ? "true" : "false"
                    } else if let d = try? nested.decode(Double.self, forKey: key) {
                        dict[key.stringValue] = d == d.rounded() ? String(Int(d)) : String(d)
                    }
                }
                props = dict
            } else {
                props = nil
            }
        }
    }

    struct Result {
        var screenCount = 0
        var actionCount = 0
        var style: VisualStylePreset = .softFintech
    }

    // MARK: - Prompting

    /// The shape `generate` demands back. Passed to Ollama's `format` so the
    /// decoder cannot leave it — every field is required so a weak model can't
    /// silently omit `screens` and produce "Composer returned no screens".
    /// `props` is intentionally loose (string values) because that is what
    /// ComposedComponent already coerces.
    static var responseSchema: [String: Any] {
        [
            "type": "object",
            "required": ["appName", "style", "screens"],
            "properties": [
                "appName": ["type": "string"],
                "style": ["type": "string"],
                "screens": [
                    "type": "array",
                    "minItems": 5,
                    "maxItems": 7,
                    "items": [
                        "type": "object",
                        "required": ["name", "bottomBar", "components"],
                        "properties": [
                            "name": ["type": "string", "description": "Specific screen name, for example Today or Run Setup. Use name, never title, at screen level."],
                            "bottomBar": ["type": "boolean", "description": "False for onboarding/entry/modal steps; true for core destinations."],
                            "components": [
                                "type": "array",
                                "minItems": 3,
                                "maxItems": 5,
                                "items": [
                                    "type": "object",
                                    "required": ["type", "props"],
                                    "properties": [
                                        "type": ["type": "string", "description": "A ComponentType raw value supported by the deterministic component factory."],
                                        "props": [
                                            "type": "object",
                                            "description": "Put every piece of product copy and data INSIDE props. Never flatten title, subtitle, label, items or values beside props.",
                                            "additionalProperties": ["type": "string"]
                                        ]
                                    ]
                                ]
                            ]
                        ]
                    ]
                ]
            ]
        ]
    }

    static func systemPrompt() -> String {
        let componentList = ComponentType.allCases.map(\.rawValue).joined(separator: ", ")
        let styleList = VisualStylePreset.allCases.map(\.rawValue).joined(separator: ", ")
        return """
        You are a senior mobile product designer. Compose a REAL, complete app from a component \
        library. Respond with ONE JSON object only, no prose, no markdown fences:
        {"appName": "...", "style": "<one of: \(styleList)>", "screens": [{"name": "...", \
        "bottomBar": true, "components": [{"type": "<one of: \(componentList)>", \
        "props": {"...": "..."}}]}]}

        Quality rules:
        - 5 to 7 purposeful screens; 3 to 5 components each, top-to-bottom order.
        - The screens must form one continuous task journey. Entry screens do not use a bottom bar; core product screens do.
        - Fill EVERY prop with specific, real, on-brand copy for THIS product — actual names, real \
        prices, real numbers. Never generic filler ("Featured", "A beautiful moment", "Item").
        - Pick components that FIT the product: a store uses product/content cards; fitness uses \
        progressRing/workoutCard/statCard; finance uses balanceHeroCard/transactionList. Do NOT put \
        finance/stock components in a store.
        - Multi-item components (quickActionRow, categoryChips) take a comma list in "items" \
        (e.g. "items": "Running, Training, Lifestyle").
        - For progressRing, put the human-readable metric in "value" ("18.4 / 25 km") and \
        the completion fraction in "progress" ("0.74"). For workoutCard include duration, \
        distance, intensity and status.
        - Every onboarding, setup, checkout, confirmation or live-task screen needs a visible \
        primaryButton/secondaryButton for its next action; never rely only on invisible flow wiring.
        - Keys: title, subtitle, value, amount, price, greeting, name, items, description, text, cta.

        \(AppShotsDesignKnowledge.composerGuide)

        GOLD EXAMPLE (match this specificity, adapt to the user's product):
        {"appName":"Aroma","style":"minimalEditorial","screens":[
          {"name":"Menu","bottomBar":true,"components":[
            {"type":"avatarGreetingHeader","props":{"greeting":"Good morning","name":"Noa"}},
            {"type":"heroCard","props":{"title":"Ethiopia Yirgacheffe","subtitle":"Bright, floral single-origin","cta":"Order now"}},
            {"type":"quickActionRow","props":{"items":"Espresso, Filter, Cold Brew, Beans"}},
            {"type":"contentCard","props":{"title":"Oat Flat White","subtitle":"Creamy, low-acidity — $4.80"}}
          ]}
        ]}
        """
    }

    // MARK: - Assembly (mirrors TemplateFactory's stack layout)

    private static let screenSize = CGSize(width: 390, height: 844)
    private static let margin: CGFloat = 20
    private static let gap: CGFloat = 16
    private static let topInset: CGFloat = 64

    /// Estimated stack height per component family — layout is code's job,
    /// so the model never supplies coordinates.
    private static func height(for type: String, props: [String: String]?) -> CGFloat {
        switch ComponentType(rawValue: type) {
        case .avatarGreetingHeader: return 64
        case .header: return 56
        case .searchBar, .textField: return 54
        case .categoryChips: return 48
        case .balanceHeroCard: return 180
        case .heroCard: return 210
        case .imageHero, .imageCard, .maskedImage, .productImage: return 220
        case .progressRing: return 200
        case .workoutCard: return 140
        case .chartCard: return 240
        case .metricCard, .statCard, .currencyCard: return 110
        case .transactionList: return 260
        case .productGrid: return 300
        case .quickActionRow: return 92
        case .chatMessage: return max(70, CGFloat((props?["text"] ?? "").count) * 0.6 + 60)
        case .primaryButton, .secondaryButton: return 58
        case .contentCard: return 130
        case .toggleRow, .controlButton: return 64
        case .progressBar: return 72
        case .insightCard, .progressCard: return 130
        case .largeIconTile: return 120
        case .iconFeatureGrid: return 170
        default: return 120
        }
    }

    static func generate(
        prompt: String,
        provider: OpenRouterProvider,
        viewModel: ProjectViewModel,
        /// Reference screenshots to design FROM. The composer emits the same
        /// decision-JSON either way, so an imported screen goes through the
        /// exact deterministic ComponentFactory path as a prompted one — the
        /// import inherits the quality floor instead of needing its own.
        referenceImageDataURLs: [String] = []
    ) async throws -> Result {
        var messages = [
            OpenRouterMessage(role: "system", content: systemPrompt()),
            OpenRouterMessage(role: "user", content: prompt, imageDataURLs: referenceImageDataURLs),
        ]

        var composed: ComposedApp?
        for _ in 1...2 {
            // Local models get grammar-constrained decoding: the schema below
            // makes a stringified array or a broken quote structurally
            // impossible, which is where every weak-model failure came from.
            let content = try await provider.generateConstrainedJSON(
                messages: messages,
                schema: responseSchema
            )
            if let parsed = decode(content) {
                composed = parsed
                break
            }
            messages.append(OpenRouterMessage(role: "assistant", content: content))
            messages.append(OpenRouterMessage(role: "user", content: "That was not valid JSON matching the schema. Return the corrected JSON object only."))
        }
        guard let composed, !composed.screens.isEmpty else {
            throw AIProviderError.invalidJSON("Composer returned no screens.")
        }

        return try apply(composed: composed, viewModel: viewModel)
    }

    /// The same deterministic renderer used by the AI composer, exposed to the
    /// Agent Loop as a small structured tool.  Weak models only decide product
    /// intent and copy; code owns every coordinate, token and navigation rail.
    static func applyComposition(
        jsonObject: [String: Any],
        viewModel: ProjectViewModel
    ) throws -> Result {
        guard JSONSerialization.isValidJSONObject(jsonObject) else {
            throw AIProviderError.invalidJSON("Composition is not a valid JSON object.")
        }
        let data = try JSONSerialization.data(withJSONObject: jsonObject)
        let composed = try JSONDecoder().decode(ComposedApp.self, from: data)
        guard !composed.screens.isEmpty else {
            throw AIProviderError.invalidJSON("Composition needs at least one screen.")
        }
        return try apply(composed: composed, viewModel: viewModel)
    }

    private static func apply(composed: ComposedApp, viewModel: ProjectViewModel) throws -> Result {
        let style = composed.style.flatMap(VisualStylePreset.init(rawValue:))
            ?? AppShotsDesignKnowledge.recommendedStyle(for: composed.appName ?? "")
        let tokens = DesignTokenLibrary.tokens(for: style)

        // Navigation is derived from real screen names, never invented as
        // Home/Discover/Favorites/Profile when those destinations do not exist.
        let coreScreens = composed.screens.filter { $0.bottomBar ?? false }
        let navigationScreens = navigationDestinations(from: coreScreens.isEmpty ? composed.screens : coreScreens)
        let navigationProps = bottomNavigationProps(for: navigationScreens)

        var actionDicts: [[String: Any]] = []
        for (index, screen) in composed.screens.enumerated() {
            let screenRef = "screen_\(index)"
            let originX = 100 + CGFloat(index) * (screenSize.width + 60)
            actionDicts.append([
                "type": "createFrame",
                "name": screen.name,
                "nodeReference": screenRef,
                "x": originX, "y": 100,
                "width": screenSize.width, "height": screenSize.height,
                "fill": tokens.colors.backgroundPrimary,
                "cornerRadius": 40,
            ])
            var cursorY = topInset
            let renderComponents = augmentedComponents(for: screen)
            for (componentIndex, component) in renderComponents.enumerated() {
                let componentHeight = height(for: component.type, props: component.props)
                actionDicts.append([
                    "type": "createComponent",
                    "component": component.type,
                    "props": component.props ?? [:],
                    "parentReference": screenRef,
                    "nodeReference": "\(screenRef)_c\(componentIndex)",
                    "stylePreset": style.rawValue,
                    "x": margin, "y": cursorY,
                    "width": screenSize.width - margin * 2, "height": componentHeight,
                ])
                cursorY += componentHeight + gap
            }
            if screen.bottomBar ?? false {
                var screenNavigationProps = navigationProps
                screenNavigationProps["activeIndex"] = String(navigationActiveIndex(for: screen, destinations: navigationScreens) + 1)
                actionDicts.append([
                    "type": "createComponent",
                    "component": "bottomNavBar",
                    "props": screenNavigationProps,
                    "parentReference": screenRef,
                    "nodeReference": "\(screenRef)_nav",
                    "stylePreset": style.rawValue,
                    "x": 0, "y": screenSize.height - 88,
                    "width": screenSize.width, "height": 88,
                ])
            }
        }

        let payload: [String: Any] = ["plan": [], "actions": actionDicts]
        let data = try JSONSerialization.data(withJSONObject: payload)
        let actions = try JSONDecoder().decode(DesignAgentResponse.self, from: data).actions
        // Replace the page only now that we have a valid, decoded app — never
        // before, or a generation failure would destroy the existing design.
        viewModel.project.pages[viewModel.currentPageIndex].nodes = []
        viewModel.project.pages[viewModel.currentPageIndex].logicFlows = []
        _ = viewModel.applyDesignActions(actions)
        enforceScreenHierarchy(viewModel: viewModel)
        if let appName = composed.appName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !appName.isEmpty {
            viewModel.project.name = appName
        }

        var result = Result()
        result.screenCount = composed.screens.count
        result.actionCount = actions.count
        result.style = style
        return result
    }

    /// Guarantee that task states visibly expose their next action. A flow
    /// attached to a card or root frame may technically navigate, but it is not
    /// a legible product UI and would not survive an AppShots-quality review.
    private static func augmentedComponents(for screen: ComposedScreen) -> [ComposedComponent] {
        var components = Array(screen.components.prefix(5))
        let hasCTA = components.contains {
            $0.type == ComponentType.primaryButton.rawValue || $0.type == ComponentType.secondaryButton.rawValue
        }
        guard !hasCTA, let label = requiredCTALabel(for: screen.name) else { return components }

        let button = ComposedComponent(type: ComponentType.primaryButton.rawValue, props: ["label": label])
        if components.count < 5 {
            components.append(button)
        } else {
            components[components.count - 1] = button
        }
        return components
    }

    private static func requiredCTALabel(for screenName: String) -> String? {
        let key = screenName.lowercased()
        if key.contains("onboarding") || key.contains("welcome") { return "Get Started" }
        if key.contains("setup") || key.contains("configure") { return "Continue" }
        if key.contains("live") || key.contains("active") { return "Finish & Save" }
        if key.contains("checkout") || key.contains("cart") { return "Continue to Checkout" }
        if key.contains("confirm") || key.contains("success") { return "Done" }
        return nil
    }

    /// AppShots' strongest recurring hierarchy rule is one unmistakable focal
    /// title or metric per screen. Component combinations such as
    /// avatarGreetingHeader + workoutCard can otherwise top out at 20pt even
    /// when the model made good content decisions. Promote the first largest
    /// text deterministically so every composed screen has a 26pt anchor.
    private static func enforceScreenHierarchy(viewModel: ProjectViewModel) {
        let pageIndex = viewModel.currentPageIndex
        guard viewModel.project.pages.indices.contains(pageIndex) else { return }
        for rootIndex in viewModel.project.pages[pageIndex].nodes.indices {
            var root = viewModel.project.pages[pageIndex].nodes[rootIndex]
            let largest = largestTextSize(in: root)
            if largest < 24 {
                _ = promoteFirstText(in: &root, matching: largest)
            }
            viewModel.project.pages[pageIndex].nodes[rootIndex] = root
        }
    }

    private static func largestTextSize(in node: DesignNode) -> CGFloat {
        let own = node.type == .Text ? (node.style.fontSize ?? 0) : 0
        return node.children.reduce(own) { max($0, largestTextSize(in: $1)) }
    }

    @discardableResult
    private static func promoteFirstText(in node: inout DesignNode, matching size: CGFloat) -> Bool {
        if node.type == .Text,
           abs((node.style.fontSize ?? 0) - size) < 0.1,
           !(node.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            node.style.fontSize = 26
            node.style.fontWeight = "bold"
            node.height = max(node.height, 34)
            if node.textBehavior?.wrap == true {
                var behavior = node.textBehavior ?? TextBehavior()
                behavior.wrap = true
                behavior.autoHeight = true
                behavior.maxLines = max(2, behavior.maxLines ?? 2)
                behavior.truncate = false
                node.textBehavior = behavior
                node.height = max(node.height, 60)
            }
            return true
        }
        for index in node.children.indices {
            if promoteFirstText(in: &node.children[index], matching: size) { return true }
        }
        return false
    }

    private static func bottomNavigationProps(for screens: [ComposedScreen]) -> [String: String] {
        var candidates = screens.map { screen -> (String, String) in
            let trimmed = screen.name.trimmingCharacters(in: .whitespacesAndNewlines)
            let label = trimmed.split(separator: " ").first.map(String.init) ?? "Home"
            return (label, navigationIcon(for: label))
        }
        let fallbacks = [("Home", "house.fill"), ("Explore", "magnifyingglass"), ("Saved", "heart.fill"), ("Profile", "person.fill")]
        for fallback in fallbacks where candidates.count < 4 && !candidates.contains(where: { $0.0 == fallback.0 }) {
            candidates.append(fallback)
        }
        return Dictionary(uniqueKeysWithValues: candidates.prefix(4).enumerated().flatMap { index, item in
            [("label\(index + 1)", item.0), ("icon\(index + 1)", item.1)]
        })
    }

    /// Choose stable app-level destinations instead of blindly taking the
    /// first four flow steps. A Run Setup and Live Run may both exist, but the
    /// bottom bar should still read Today / Run / Progress / Profile.
    private static func navigationDestinations(from screens: [ComposedScreen]) -> [ComposedScreen] {
        let preferenceGroups = [
            ["home", "today", "feed"],
            ["run", "workout", "session", "explore", "search"],
            ["progress", "analytics", "history", "saved"],
            ["profile", "settings", "account"]
        ]
        var selected: [ComposedScreen] = []
        for group in preferenceGroups {
            if let match = screens.first(where: { screen in
                let key = screen.name.lowercased()
                return group.contains { key.contains($0) }
            }), !selected.contains(where: { $0.name == match.name }) {
                selected.append(match)
            }
        }
        for screen in screens where selected.count < 4 && !selected.contains(where: { $0.name == screen.name }) {
            selected.append(screen)
        }
        return Array(selected.prefix(4))
    }

    private static func navigationActiveIndex(for screen: ComposedScreen, destinations: [ComposedScreen]) -> Int {
        let key = screen.name.lowercased()
        if let exact = destinations.firstIndex(where: { $0.name.caseInsensitiveCompare(screen.name) == .orderedSame }) {
            return exact
        }
        if key.contains("run") || key.contains("workout") || key.contains("session") {
            if let match = destinations.firstIndex(where: {
                let candidate = $0.name.lowercased()
                return candidate.contains("run") || candidate.contains("workout") || candidate.contains("session")
            }) { return match }
        }
        if key.contains("profile") || key.contains("setting") || key.contains("account") {
            if let match = destinations.firstIndex(where: {
                let candidate = $0.name.lowercased()
                return candidate.contains("profile") || candidate.contains("setting") || candidate.contains("account")
            }) { return match }
        }
        return 0
    }

    private static func navigationIcon(for label: String) -> String {
        let value = label.lowercased()
        let mappings: [(String, String)] = [
            ("home", "house.fill"), ("today", "house.fill"), ("feed", "rectangle.stack.fill"),
            ("explore", "safari.fill"), ("discover", "safari.fill"), ("search", "magnifyingglass"),
            ("shop", "bag.fill"), ("catalog", "square.grid.2x2.fill"), ("order", "shippingbox.fill"),
            ("cart", "cart.fill"), ("chat", "bubble.left.and.bubble.right.fill"), ("message", "message.fill"),
            ("history", "clock.fill"), ("analytics", "chart.bar.fill"), ("progress", "chart.line.uptrend.xyaxis"),
            ("saved", "heart.fill"), ("favorite", "heart.fill"), ("profile", "person.fill"),
            ("setting", "gearshape.fill"), ("community", "person.3.fill")
        ]
        return mappings.first(where: { value.contains($0.0) })?.1 ?? "circle.grid.2x2.fill"
    }

    // MARK: - Image slots

    /// Generates a real image for each image slot the composed app produced and
    /// patches it in. Sequential (FLUX on MLX is heavy) and capped so a build
    /// stays minutes, not tens of minutes. Any failure (no backend) is skipped,
    /// leaving the placeholder — a build never fails for lack of images.
    static func fillImages(
        appPrompt: String,
        viewModel: ProjectViewModel,
        provider: OpenRouterProvider,
        maxImages: Int = 4
    ) async -> Int {
        let pageIndex = viewModel.currentPageIndex
        guard viewModel.project.pages.indices.contains(pageIndex) else { return 0 }
        let screens = viewModel.project.pages[pageIndex].nodes.filter { $0.type == .Frame }

        // Collect image slots with a subject drawn from the enclosing card's
        // title (so a product card's image is OF that product).
        var targets: [(id: UUID, prompt: String)] = []
        func collect(_ node: DesignNode, subject: String?) {
            let cardTitle = node.type == .Frame
                ? node.children.first(where: { $0.type == .Text && !($0.text ?? "").trimmingCharacters(in: .whitespaces).isEmpty })?.text
                : nil
            let context = cardTitle ?? subject
            if node.type == .Image {
                targets.append((node.id, imageSlotPrompt(subject: context ?? node.name, app: appPrompt)))
            }
            for child in node.children { collect(child, subject: context) }
        }
        for screen in screens { collect(screen, subject: screen.name) }
        guard !targets.isEmpty else { return 0 }

        var count = 0
        for target in targets.prefix(maxImages) {
            if let path = try? await provider.generateImageAsset(
                prompt: target.prompt, assetKind: "hero",
                aspectRatio: nil, resolution: nil, size: "512x512"
            ) {
                viewModel.setGeneratedImage(nodeId: target.id, imagePath: path)
                count += 1
            }
        }
        return count
    }

    private static func imageSlotPrompt(subject: String, app: String) -> String {
        "\(subject), professional product photography, clean minimal studio background, soft lighting, high detail — for a \(app)"
    }

    private static func decode(_ content: String) -> ComposedApp? {
        // Models wrap JSON in fences or prose — find the outermost object.
        guard let start = content.firstIndex(of: "{") else { return nil }
        if let end = content.lastIndex(of: "}") {
            let json = String(content[start...end])
            if let app = try? JSONDecoder().decode(ComposedApp.self, from: Data(json.utf8)),
               !app.screens.isEmpty {
                return app
            }
        }
        // A longer, richer response can get truncated mid-array — salvage the
        // complete screen objects rather than losing the whole build.
        return salvageTruncated(String(content[start...]))
    }

    /// Extracts every fully-closed screen object from a (possibly truncated)
    /// "screens":[ … array and rebuilds a minimal valid ComposedApp.
    private static func salvageTruncated(_ raw: String) -> ComposedApp? {
        guard let keyRange = raw.range(of: "\"screens\""),
              let bracket = raw[keyRange.upperBound...].firstIndex(of: "[") else { return nil }
        var objects: [String] = []
        var buf = ""
        var depth = 0, inString = false, escaped = false
        for ch in raw[raw.index(after: bracket)...] {
            if depth > 0 { buf.append(ch) }
            if escaped { escaped = false; continue }
            if ch == "\\" { escaped = true; continue }
            if ch == "\"" { inString.toggle(); continue }
            if inString { continue }
            if ch == "{" {
                if depth == 0 { buf = "{" }
                depth += 1
            } else if ch == "}" {
                depth -= 1
                if depth == 0 { objects.append(buf) }
            } else if ch == "]" && depth == 0 {
                break
            }
        }
        guard !objects.isEmpty else { return nil }
        let rebuilt = "{\"screens\":[" + objects.joined(separator: ",") + "]}"
        let app = try? JSONDecoder().decode(ComposedApp.self, from: Data(rebuilt.utf8))
        return (app?.screens.isEmpty == false) ? app : nil
    }
}
