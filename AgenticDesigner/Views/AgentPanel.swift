//
//  AgentPanel.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//


import SwiftUI

struct AgentPanel: View {
    @ObservedObject var viewModel: ProjectViewModel
    var logicViewModel: LogicViewModel? = nil
    var isLogicMode: Bool = false
    var mcpController: MCPServerController? = nil
    // Owned by EditorView, not by this panel. As @StateObject they died with
    // the view every time the editor mode changed — taking the transcript and
    // any RUNNING agent loop with them.
    @ObservedObject var pipeline: AgentPipelineCoordinator
    @ObservedObject var loop: AgentToolLoop

    @State private var prompt: String = ""
    @State private var buildStage: String? = nil
    @State private var steerText: String = ""
    @State private var testingProvider: String?
    @State private var providerStatus: [String: String] = [:]
    @StateObject private var chatGPT = ChatGPTSubscriptionService()
    @AppStorage("openRouterAPIKey") private var openRouterAPIKey: String = ""
    @AppStorage("cerebrasAPIKey") private var cerebrasAPIKey: String = ""
    @AppStorage("groqAPIKey") private var groqAPIKey: String = ""
    @AppStorage("geminiAPIKey") private var geminiAPIKey: String = ""
    @AppStorage("nvidiaAPIKey") private var nvidiaAPIKey: String = ""
    @AppStorage("openRouterModel") private var openRouterModel: String = OpenRouterConfiguration.model
    @AppStorage("openRouterGenerationModel") private var generationModel: String = "google/gemma-4-31b-it:free"
    @AppStorage("autoCriticEnabled") private var autoCriticEnabled: Bool = true
    @AppStorage("agentLoopCostApprovalUSD") private var agentLoopCostApprovalUSD: Double = 0.10
    // "loop" = agentic tool loop (act → observe → verify); "pipeline" = the
    // classic fixed strategy→generate→critic run.
    @AppStorage("agentRunMode") private var agentRunMode: String = "loop"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Agent")
                .font(.headline)

            SecureField("OpenRouter API Key", text: $openRouterAPIKey)
                .textFieldStyle(.roundedBorder)

            // Each vendor's free tier has its OWN quota, so a spent OpenRouter
            // balance doesn't touch them — and the loop falls through to
            // whichever ones are configured when a ceiling is hit.
            chatGPTSubscriptionRow

            DisclosureGroup("Free provider keys (\(ModelProviderCatalog.configuredRoutes.count) configured)") {
                VStack(alignment: .leading, spacing: 6) {
                    freeProviderKeyField("Google AI Studio", "gemini", $geminiAPIKey)
                    freeProviderKeyField("Cerebras", "cerebras", $cerebrasAPIKey)
                    freeProviderKeyField("Groq", "groq", $groqAPIKey)
                    freeProviderKeyField("NVIDIA NIM", "nim", $nvidiaAPIKey)
                    Text("Free tiers with published quotas — each uses your own key at the vendor's own endpoint. Gemini first: it's the only one that reads screenshots, which the design critic needs.")
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 4)
            }
            .font(.system(size: 11))

            Picker("Model", selection: $openRouterModel) {
                ForEach(OpenRouterConfiguration.availableModels, id: \.id) { model in
                    Text(model.label).tag(model.id)
                }

                if !OpenRouterConfiguration.availableModels.contains(where: { $0.id == openRouterModel }) {
                    Text(openRouterModel).tag(openRouterModel)
                }
            }
            .pickerStyle(.menu)

            Picker("Build", selection: $generationModel) {
                Text("Same as Model").tag("")
                ForEach(OpenRouterConfiguration.availableModels, id: \.id) { model in
                    Text(model.label).tag(model.id)
                }
            }
            .pickerStyle(.menu)
            .help("Model for Stage 2 (JSON generation). Stage 1 strategy uses the Model above.")

            Toggle("Auto review & polish after generation", isOn: $autoCriticEnabled)
                .toggleStyle(.checkbox)
                .font(.caption)

            if mcpController != nil {
                Picker("Mode", selection: $agentRunMode) {
                    Text("Agent Loop").tag("loop")
                    Text("Pipeline").tag("pipeline")
                }
                .pickerStyle(.segmented)
                .help("Agent Loop: the model works iteratively with tools — designs, wires logic, screenshots, verifies, fixes. Pipeline: the classic one-shot strategy → generate → critic run.")

                if agentRunMode == "loop" {
                    HStack(spacing: 6) {
                        Text("Cost approval every")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text("$")
                            .font(.caption)
                        TextField(
                            "0.10",
                            value: $agentLoopCostApprovalUSD,
                            format: .number.precision(.fractionLength(2))
                        )
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 58)
                    }
                    .help("The loop pauses at each cost band and waits for you to approve continuing. Minimum effective value: $0.01.")
                }
            }

            TextField(isLogicMode ? "Describe the logic to create..." : "Ask Agent...", text: $prompt)
                .textFieldStyle(.roundedBorder)

            HStack {
                Button {
                    Task {
                        if useLoopMode {
                            await runLoop()
                        } else {
                            await runAgent()
                        }
                    }
                } label: {
                    if pipeline.isRunning {
                        Label(pipeline.state.rawValue, systemImage: "sparkles")
                    } else if loop.isRunning {
                        Label(loop.statusLine.isEmpty ? "Working…" : loop.statusLine, systemImage: "sparkles")
                    } else {
                        Label("Run Agent", systemImage: "sparkles")
                    }
                }
                .disabled(
                    pipeline.isRunning || loop.isRunning ||
                    prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )

                Button {
                    Task {
                        await runCriticAgent()
                    }
                } label: {
                    Label("Critic & Fix", systemImage: "eye")
                }
                .disabled(pipeline.isRunning || loop.isRunning)
            }

            if useLoopMode || loop.isRunning || !loop.transcript.isEmpty {
                loopStatusSection
            }

            if !isLogicMode {
                // The Lovable loop: one prompt -> designed screens -> wired
                // logic -> interactive preview, with a checkpoint saved first.
                Button {
                    Task { await runFullBuild() }
                } label: {
                    Label(buildStage ?? "Build App", systemImage: "hammer.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(
                    pipeline.isRunning || buildStage != nil ||
                    prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
                .help("Design the screens, wire the logic, and open the interactive preview — all from this one prompt.")

                Menu {
                    let checkpoints = CheckpointStore.list(projectName: viewModel.project.name)
                    if checkpoints.isEmpty {
                        Text("No checkpoints yet")
                    }
                    ForEach(checkpoints.prefix(15)) { checkpoint in
                        Button("\(checkpoint.date.formatted(date: .abbreviated, time: .shortened)) — \(checkpoint.label)") {
                            restoreCheckpoint(checkpoint)
                        }
                    }
                } label: {
                    Label("History", systemImage: "clock.arrow.circlepath")
                }
                .help("Every agent run snapshots the project first — restore any earlier version.")
            }

            Text("OpenRouter · \(openRouterModel)")
                .font(.caption)
                .foregroundStyle(.secondary)

            if let errorMessage = pipeline.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .lineLimit(nil)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer()
        }
        .padding(12)
    }

    private var useLoopMode: Bool {
        agentRunMode == "loop" && mcpController != nil
    }

    // MARK: - Agent loop UI (shared plan checklist + transcript + steer/cancel)

    @ViewBuilder
    private var loopStatusSection: some View {
        AgentLoopActivityView(loop: loop, steerText: $steerText)
    }

    @MainActor
    /// One free-tier key row. The green dot is the answer to "why didn't it
    /// fall through to Cerebras" — an unconfigured route is skipped silently.
    /// "Connect my ChatGPT subscription". The sign-in itself happens in
    /// OpenAI's own browser flow via their Codex CLI — this app never handles
    /// the credentials, which is the only version of this that is legitimate.
    private var chatGPTSubscriptionRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle()
                    .fill(chatGPT.status.isReady ? Color.green : Color.secondary.opacity(0.35))
                    .frame(width: 6, height: 6)
                Text("ChatGPT subscription")
                    .font(.system(size: 11, weight: .medium))
                Spacer()

                switch chatGPT.status {
                case .notInstalled:
                    Button("Install…") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString("brew install codex", forType: .string)
                        providerStatus["chatgpt"] = "Copied `brew install codex` — run it in Terminal, then press Refresh."
                    }
                    .font(.system(size: 10))
                    .buttonStyle(.borderless)
                case .signedOut:
                    Button("Sign in with ChatGPT") {
                        Task { await chatGPT.signIn() }
                    }
                    .font(.system(size: 10))
                    .buttonStyle(.borderless)
                    .disabled(chatGPT.isBusy)
                case .ready:
                    Button(chatGPT.isBusy ? "Running…" : "Run goal on subscription") {
                        Task {
                            await chatGPT.ensureMCPServerRegistered(port: mcpController?.port ?? 8765)
                            await chatGPT.run(
                                goal: prompt.isEmpty ? "Improve the current screen's spacing and hierarchy." : prompt,
                                workingDirectory: FileManager.default.temporaryDirectory
                            )
                        }
                    }
                    .font(.system(size: 10))
                    .buttonStyle(.borderless)
                    .disabled(chatGPT.isBusy)
                }

                Button("↻") { Task { await chatGPT.refreshStatus() } }
                    .font(.system(size: 10))
                    .buttonStyle(.borderless)
            }

            Text(chatGPTHint)
                .font(.system(size: 9))
                .foregroundStyle(chatGPT.status.isReady ? Color.green : Color.secondary)
                .lineLimit(3)

            if let last = chatGPT.transcript.last {
                Text(last)
                    .font(.system(size: 9, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
        }
        .task { await chatGPT.refreshStatus() }
    }

    private var chatGPTHint: String {
        if let note = providerStatus["chatgpt"], case .notInstalled = chatGPT.status { return note }
        switch chatGPT.status {
        case .notInstalled:
            return "Runs your goal on your ChatGPT plan instead of per-token API billing — no key, no credit ceiling. Needs OpenAI's Codex CLI: \(chatGPT.installHint)"
        case .signedOut:
            return "Codex is installed. Sign in opens OpenAI's own browser flow — this app never sees your password or token."
        case .ready:
            return "Connected. Your goal runs on the ChatGPT plan, driving this app's tools over MCP. Note: Codex runs unsandboxed so it can reach this app — it can read and write files on this Mac."
        }
    }

    private func freeProviderKeyField(
        _ name: String,
        _ routeId: String,
        _ binding: Binding<String>
    ) -> some View {
        let route = ModelProviderCatalog.routes.first { $0.id == routeId }
        return VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Circle()
                    .fill(binding.wrappedValue.isEmpty ? Color.secondary.opacity(0.35) : Color.green)
                    .frame(width: 6, height: 6)
                SecureField("\(name) key", text: binding)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 11))

                if binding.wrappedValue.isEmpty {
                    // Nothing to type or look up: the signup page is one click.
                    if let route, let url = ModelProviderCatalog.signupURL(for: route) {
                        Button("Get key") { NSWorkspace.shared.open(url) }
                            .font(.system(size: 10))
                            .buttonStyle(.borderless)
                    }
                } else {
                    // Verifies the key AND discovers the real model ids, so a
                    // wrong guess can never reach a run.
                    Button(testingProvider == routeId ? "…" : "Test") {
                        if let route { testProvider(route) }
                    }
                    .font(.system(size: 10))
                    .buttonStyle(.borderless)
                    .disabled(testingProvider != nil)
                }
            }
            if let status = providerStatus[routeId] {
                Text(status)
                    .font(.system(size: 9))
                    .foregroundStyle(status.hasPrefix("✓") ? Color.green : Color.red)
                    .lineLimit(2)
            }
        }
    }

    private func testProvider(_ route: ModelProviderRoute) {
        testingProvider = route.id
        providerStatus[route.id] = nil
        Task {
            do {
                let models = try await ModelProviderCatalog.fetchModels(for: route)
                ModelProviderCatalog.storeModels(models, for: route)
                providerStatus[route.id] = "✓ Working — \(models.count) models available"
            } catch {
                providerStatus[route.id] = error.localizedDescription
            }
            testingProvider = nil
        }
    }

    private func runLoop() async {
        guard let mcpController else { return }
        loop.mcp = mcpController
        pipeline.errorMessage = nil
        let goal = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        prompt = ""
        _ = await loop.run(goal: goal)
    }

    // One prompt -> screens + logic + interactive preview (checkpointed).
    @MainActor
    private func runFullBuild() async {
        guard let logicViewModel else {
            pipeline.errorMessage = "Logic engine unavailable."
            return
        }
        let userPromptText = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let orchestrator = AppBuildOrchestrator(
            design: viewModel, logic: logicViewModel, pipeline: pipeline
        )
        pipeline.errorMessage = nil
        do {
            let summary = try await orchestrator.buildApp(prompt: userPromptText) { stage in
                buildStage = stage.rawValue + "…"
            }
            prompt = ""
            pipeline.errorMessage = "Built: \(summary.designActionCount) design actions, \(summary.flowCount) flows. Preview is running — tap through it."
        } catch {
            pipeline.errorMessage = error.localizedDescription
        }
        buildStage = nil
    }

    @MainActor
    private func restoreCheckpoint(_ checkpoint: ProjectCheckpoint) {
        guard let logicViewModel else { return }
        let orchestrator = AppBuildOrchestrator(
            design: viewModel, logic: logicViewModel, pipeline: pipeline
        )
        do {
            try orchestrator.restore(checkpoint)
            pipeline.errorMessage = "Restored: \(checkpoint.label)"
        } catch {
            pipeline.errorMessage = "Restore failed: \(error.localizedDescription)"
        }
    }

    @MainActor
    private func runAgent() async {
        let userPromptText = prompt.trimmingCharacters(in: .whitespacesAndNewlines)

        // In Logic Mode the agent programs the screen instead of designing it.
        if isLogicMode, let logicViewModel {
            await runLogicAgent(request: userPromptText, logicViewModel: logicViewModel)
            return
        }

        // Debug override: If prompt contains JSON payload, skip API and parse directly.
        if userPromptText.hasPrefix("{") && (userPromptText.contains("\"actions\"") || userPromptText.contains("“actions”")) {
            let sanitizedJSON = userPromptText
                .replacingOccurrences(of: "“", with: "\"")
                .replacingOccurrences(of: "”", with: "\"")

            do {
                let data = Data(sanitizedJSON.utf8)
                let response = try JSONDecoder().decode(DesignAgentResponse.self, from: data)
                viewModel.applyDesignActions(response.actions)
                prompt = ""
                pipeline.errorMessage = "JSON injected successfully."
            } catch {
                pipeline.errorMessage = "Invalid JSON override: \(error.localizedDescription)"
            }
            return
        }

        // The shared pipeline service — the same one MCP-connected agents use —
        // handles strategy, generation, apply, image assets, and the critic.
        let service = DesignAgentService(viewModel: viewModel, pipeline: pipeline)

        do {
            _ = try await service.runFullPipeline(prompt: userPromptText) {
                prompt = ""
            }
        } catch {
            pipeline.errorMessage = error.localizedDescription
        }
    }

    // מריץ את הסוכן במצב Logic — יוצר שרשראות בלוקים מחוברות למסך המעוצב.
    @MainActor
    private func runLogicAgent(request: String, logicViewModel: LogicViewModel) async {
        guard let apiKey = OpenRouterConfiguration.apiKey(userProvidedKey: openRouterAPIKey)
            ?? (openRouterModel.hasPrefix("local/") ? "local" : nil) else {
            pipeline.errorMessage = "Missing OpenRouter API key."
            return
        }

        pipeline.isRunning = true
        pipeline.errorMessage = nil
        pipeline.state = .generating

        let elements = logicViewModel.designNodesFlat
        let screens = logicViewModel.designScreens
        let systemPrompt = LogicAgentPromptBuilder.buildSystemPrompt()
        let userPrompt = LogicAgentPromptBuilder.buildUserPrompt(
            request: request,
            elements: elements,
            screens: screens,
            variables: logicViewModel.allVariables,
            existingFlowNames: logicViewModel.flows.map(\.name),
            firebaseConfigured: viewModel.project.firebaseConfig?.isConfigured ?? false
        )

        let provider = OpenRouterProvider(
            apiKey: apiKey,
            model: openRouterModel,
            temperature: 0.3
        )

        var messages = [
            OpenRouterMessage(role: "system", content: systemPrompt),
            OpenRouterMessage(role: "user", content: userPrompt)
        ]

        do {
            var response: LogicAgentResponse?

            // One generation attempt plus one self-repair round trip.
            for attempt in 1...2 {
                let content = try await provider.generateRawChat(messages: messages, jsonMode: true)
                print("===== LOGIC AGENT RESPONSE (attempt \(attempt)) =====")
                print(content)

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

            let flows = LogicAgentTranslator.makeFlows(
                from: response,
                elements: elements,
                screens: screens
            )

            guard !flows.isEmpty else {
                throw AIProviderError.invalidJSON("Logic agent produced no valid flows.")
            }

            logicViewModel.applyGenerated(flows: flows)
            prompt = ""
        } catch {
            pipeline.errorMessage = error.localizedDescription
        }

        pipeline.state = .idle
        pipeline.isRunning = false
    }

    // מפעיל Critic Agent דרך OpenRouter כדי לתקן מסך קיים
    @MainActor
    private func runCriticAgent() async {
        guard let apiKey = OpenRouterConfiguration.apiKey(userProvidedKey: openRouterAPIKey)
            ?? (openRouterModel.hasPrefix("local/") ? "local" : nil) else {
            pipeline.errorMessage = "Missing OpenRouter API key."
            return
        }

        pipeline.isRunning = true
        pipeline.errorMessage = nil
        pipeline.state = .reviewing

        let pageNodes = viewModel.project.pages[viewModel.currentPageIndex].nodes
        let screenshot = CanvasSnapshotRenderer.jpegDataURL(for: pageNodes)
        let context = viewModel.makeAgentContext(userPrompt: "Review and fix the current design.")

        do {
            let provider = OpenRouterProvider(
                apiKey: apiKey,
                model: openRouterModel,
                temperature: 0.18
            )
            let actions = try await pipeline.runCriticPass(
                provider: provider,
                context: context,
                pageNodes: pageNodes,
                screenshotDataURL: screenshot
            )

            viewModel.applyDesignActions(actions)
        } catch {
            pipeline.errorMessage = error.localizedDescription
        }

        pipeline.state = .idle
        pipeline.isRunning = false
    }
}
