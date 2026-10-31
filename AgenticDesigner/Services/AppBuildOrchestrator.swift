//
//  AppBuildOrchestrator.swift
//  AgenticDesigner
//
//  One prompt → a working app. Chains the two agent paths that previously
//  required separate manual runs — the design pipeline (screens, components,
//  images, critic) and the logic agent (flows, navigation, variables) — then
//  opens the interactive in-app preview. A checkpoint is saved before any
//  action so the whole build is one-click reversible.
//

import Foundation

@MainActor
final class AppBuildOrchestrator {

    struct BuildSummary {
        var designActionCount = 0
        var generatedImageCount = 0
        var flowCount = 0
        var enabledAppleWatch = false
        var screens: [String] = []
        var checkpoint: ProjectCheckpoint?
        /// What the backend pass added: accounts + persistence.
        var backend: BackendWiringGenerator.Result?
    }

    enum Stage: String {
        case checkpoint = "Saving checkpoint"
        case designing = "Designing screens"
        case imaging = "Generating images"
        case wiring = "Wiring logic"
        case backend = "Connecting backend"
        case previewing = "Opening preview"
    }

    /// Which backend a build should wire up. Firebase by default: "build me a
    /// habit tracker" means an app you can sign into and whose data survives
    /// reinstalling, and no prompt should have to spell that out.
    enum BackendChoice: String {
        case firebase
        case none
    }

    let design: ProjectViewModel
    let logic: LogicViewModel
    let pipeline: AgentPipelineCoordinator

    init(design: ProjectViewModel, logic: LogicViewModel, pipeline: AgentPipelineCoordinator) {
        self.design = design
        self.logic = logic
        self.pipeline = pipeline
    }

    enum GenerationMode: String {
        /// The model decides screens/components/copy; the component factory
        /// renders them — fast, polished, reliable even on small local models.
        case composed
        /// The classic free-form pipeline (raw nodes, AI images, critic) —
        /// more creative freedom, needs a strong model.
        case detailed
    }

    /// Removes a fake platform tag the model bakes into a screen name
    /// ("Live Run — Apple Watch" → "Live Run"), which otherwise reads as a
    /// watch app that isn't one.
    static func stripPlatformTag(_ name: String) -> String {
        for separator in [" — ", " – ", " - "] {
            if let range = name.range(of: separator, options: .backwards) {
                let tail = name[range.upperBound...].trimmingCharacters(in: .whitespaces).lowercased()
                if ["iphone", "ipad", "apple watch", "applewatch", "watchos", "watch", "phone"].contains(tail) {
                    return String(name[..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
                }
            }
        }
        return name
    }

    /// The Lovable loop: prompt in, interactive app out.
    /// `modelOverride` switches the agent model for this and future runs
    /// (same effect as picking it in the Agent panel) — pass a "local/…" id
    /// to build fully on-device.
    func buildApp(
        prompt: String,
        mode: GenerationMode = .composed,
        modelOverride: String? = nil,
        backend: BackendChoice? = nil,
        onStage: ((Stage) -> Void)? = nil
    ) async throws -> BuildSummary {
        if let modelOverride, !modelOverride.isEmpty {
            UserDefaults.standard.set(modelOverride, forKey: "openRouterModel")
            UserDefaults.standard.set("", forKey: "openRouterGenerationModel")
        }

        // Fail FAST with a clear, actionable message when a cloud model is
        // selected but no real key is set — a real OpenRouter key is long
        // (sk-or-v1-…); the "z" placeholder and empty are both rejected with a
        // cryptic 401 downstream. Catch it here instead.
        let preflight = DesignAgentService.Settings.current()
        if !preflight.model.hasPrefix("local/"),
           (preflight.resolvedAPIKey()?.count ?? 0) < 20 {
            throw AIProviderError.needsCloudKey(model: preflight.model)
        }

        // A capable cloud model DESIGNS best in the free-form pipeline, where it
        // lays out screens itself (colours, hierarchy, layout) — the same agency
        // it has over MCP. The composed path only lets it pick components from a
        // fixed factory, so a strong model's design talent is wasted and every
        // app looks like the same wireframe. Auto-route strong models to detailed.
        var mode = mode
        if mode == .composed,
           !preflight.model.hasPrefix("local/"),
           !preflight.model.contains(":free"),
           preflight.model != "openrouter/free" {
            mode = .detailed
        }

        var summary = BuildSummary()

        onStage?(.checkpoint)
        summary.checkpoint = CheckpointStore.save(design.project, label: "before: \(prompt.prefix(40))")

        // Stage 1 — design.
        onStage?(.designing)
        switch mode {
        case .composed:
            let settings = DesignAgentService.Settings.current()
            guard let apiKey = settings.resolvedAPIKey() else { throw AIProviderError.missingAPIKey }
            let provider = OpenRouterProvider(apiKey: apiKey, model: settings.model, temperature: 0.6)
            // The generator clears the page itself, but only AFTER it has a
            // valid result — clearing here meant a failed generation (e.g. the
            // local model returning no screens) left the user with a blank
            // project and no error-free way back.
            let composed = try await ComposedAppGenerator.generate(
                prompt: prompt, provider: provider, viewModel: design
            )
            summary.designActionCount = composed.actionCount
            // Fill the composed app's image slots with real AI images — the
            // local FLUX bridge on :7860 if it's running, otherwise the cloud
            // image model. Degrades cleanly to placeholders when neither is
            // reachable, so a build never fails for lack of an image backend.
            onStage?(.imaging)
            summary.generatedImageCount = await ComposedAppGenerator.fillImages(
                appPrompt: prompt, viewModel: design, provider: provider
            )
        case .detailed:
            let designService = DesignAgentService(viewModel: design, pipeline: pipeline)
            let designSummary = try await designService.runFullPipeline(prompt: prompt)
            summary.designActionCount = designSummary.appliedActionCount
        }

        // Apple Watch handling, run AFTER generation and driven by CODE (not by
        // the model), so it works for ANY AI. Watch intent is detected two ways:
        // from the prompt, OR from a screen the model NAMED "…watch…" (models
        // routinely fake a watch by naming a phone screen "Live Run — Apple
        // Watch" instead of building one). We then strip the fake platform tag
        // the model bakes into names and add a REAL watch-sized runner screen.
        let page = design.currentPageIndex
        let promptWatch = ["watch", "wearable", "watchos"].contains { prompt.lowercased().contains($0) }
        let nameWatch = design.project.pages[page].nodes.contains {
            $0.type == .Frame && ($0.name.lowercased().contains("watch"))
        }
        for i in design.project.pages[page].nodes.indices where design.project.pages[page].nodes[i].type == .Frame {
            design.project.pages[page].nodes[i].name = Self.stripPlatformTag(design.project.pages[page].nodes[i].name)
        }
        if promptWatch || nameWatch {
            if !design.project.platformSettings.enabledPlatforms.contains(.appleWatch) {
                design.project.platformSettings.enabledPlatforms.append(.appleWatch)
            }
            summary.enabledAppleWatch = true
            let frames = design.project.pages[page].nodes.filter { $0.type == .Frame }
            if !frames.contains(where: { $0.name == "Watch Runner" }) {
                var watch = ComponentFactory.watchRunnerScreen()
                watch.x = 100 + CGFloat(frames.count) * 450
                watch.y = 100
                design.project.pages[page].nodes.append(watch)
            }
        }

        // Stage 2 — wire interactions. Composed wiring auto-wires tab bars
        // and back buttons deterministically (never fails), then lets the
        // model add semantic interactions. The old free-form logic agent
        // routinely returned EMPTY flows on small models, shipping apps that
        // looked generated but weren't clickable.
        onStage?(.wiring)
        let settings = DesignAgentService.Settings.current()
        let logicProvider = settings.resolvedAPIKey().map {
            OpenRouterProvider(apiKey: $0, model: settings.model, temperature: 0.3)
        }
        let wiring = await ComposedLogicGenerator.generate(
            prompt: prompt, provider: logicProvider, design: design, logic: logic
        )
        summary.flowCount = wiring.flowCount

        // Stage 2.5 — accounts and real persistence. Deterministic and last,
        // so it can see the finished design: it only creates a Log In / Sign
        // Up screen the model didn't draw, and wires whatever CTAs exist. An
        // explicit "no login / local only" in the brief opts out.
        let resolvedBackend = backend ?? (BackendBlueprint.promptOptsOut(prompt) ? .none : .firebase)
        if resolvedBackend == .firebase {
            onStage?(.backend)
            let result = BackendWiringGenerator.wire(prompt: prompt, design: design, logic: logic)
            summary.backend = result
            summary.flowCount += result.flowNames.count
        }

        summary.screens = logic.designScreens.map(\.name)

        // Stage 3 — show it running.
        onStage?(.previewing)
        logic.showAppPreview = true
        return summary
    }

    // MARK: - Logic stage

    private func generateLogic(for userPrompt: String) async throws -> [LogicFlow] {
        let settings = DesignAgentService.Settings.current()
        guard let apiKey = settings.resolvedAPIKey() else { throw AIProviderError.missingAPIKey }

        let elements = logic.designNodesFlat
        let screens = logic.designScreens
        let request = """
        Make this freshly generated app fully interactive. Original app brief: "\(userPrompt)".
        Wire EVERY primary button and tappable card: navigation between the screens, \
        back actions, screen-load effects, and simple state updates (toggles, counters, \
        selected items) with variables where they make the app feel real. Prefer flows \
        that let someone tap through the whole app.
        """

        let systemPrompt = LogicAgentPromptBuilder.buildSystemPrompt()
        let userPromptText = LogicAgentPromptBuilder.buildUserPrompt(
            request: request,
            elements: elements,
            screens: screens,
            variables: logic.allVariables,
            existingFlowNames: logic.flows.map(\.name),
            firebaseConfigured: design.project.firebaseConfig?.isConfigured ?? false
        )

        let provider = OpenRouterProvider(apiKey: apiKey, model: settings.model, temperature: 0.3)
        var messages = [
            OpenRouterMessage(role: "system", content: systemPrompt),
            OpenRouterMessage(role: "user", content: userPromptText),
        ]

        // One generation attempt plus one self-repair round trip.
        var response: LogicAgentResponse?
        for _ in 1...2 {
            let content = try await provider.generateRawChat(messages: messages, jsonMode: true)
            do {
                response = try LogicAgentTranslator.decodeResponse(from: content)
                break
            } catch {
                messages.append(OpenRouterMessage(role: "assistant", content: content))
                messages.append(OpenRouterMessage(
                    role: "user",
                    content: "Your response could not be parsed (\(error.localizedDescription)). Return the complete corrected JSON object only."
                ))
            }
        }
        guard let response else {
            throw AIProviderError.invalidJSON("Logic agent returned unparseable JSON twice.")
        }
        return LogicAgentTranslator.makeFlows(from: response, elements: elements, screens: screens)
    }

    // MARK: - Checkpoint restore

    /// Replaces the live project with a checkpoint (the current state is
    /// snapshotted first, so a restore is itself undoable).
    func restore(_ checkpoint: ProjectCheckpoint) throws {
        let restored = try CheckpointStore.load(checkpoint)
        CheckpointStore.save(design.project, label: "before restore")
        design.replaceProject(restored)
    }
}
