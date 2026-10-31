//
//  DesignChatPanel.swift
//  AgenticDesigner
//
//  The conversational agent: a thread instead of a text field. Shows what the
//  agent is doing while it works, and lets any turn be reverted on its own —
//  the "iterate fearlessly" loop, at the granularity of an idea.
//

import SwiftUI

struct DesignChatPanel: View {
    @ObservedObject var viewModel: ProjectViewModel
    var logicViewModel: LogicViewModel
    var mcpController: MCPServerController? = nil
    // Owned by EditorView so the conversation (and a running loop) survives
    // switching to Code / Studio / Logic and back.
    @ObservedObject var session: DesignChatSession
    @ObservedObject var pipeline: AgentPipelineCoordinator
    @ObservedObject var loop: AgentToolLoop
    @State private var input: String = ""
    @State private var steerText: String = ""
    // "loop" (agentic act→verify), "build" (one-shot orchestrator), "edit"
    // (pipeline edit of the current canvas).
    @AppStorage("designChatEngine") private var engine: String = "loop"
    @AppStorage("openRouterModel") private var openRouterModel: String = OpenRouterConfiguration.model
    @AppStorage("openRouterAPIKey") private var openRouterAPIKey: String = ""
    @AppStorage("cerebrasAPIKey") private var cerebrasAPIKey: String = ""
    @AppStorage("groqAPIKey") private var groqAPIKey: String = ""
    @AppStorage("geminiAPIKey") private var geminiAPIKey: String = ""
    @AppStorage("nvidiaAPIKey") private var nvidiaAPIKey: String = ""
    @AppStorage("agentLoopCostApprovalUSD") private var agentLoopCostApprovalUSD: Double = 0.10

    private var isLocalModel: Bool { openRouterModel.hasPrefix("local/") }
    private var loopAvailable: Bool { mcpController != nil }
    private var usesLoop: Bool { engine == "loop" && loopAvailable }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 10) {
                        if session.messages.isEmpty { emptyState }
                        ForEach(session.messages) { message in
                            bubble(message).id(message.id)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .onChange(of: session.messages.count) {
                    if let last = session.messages.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }

            if usesLoop && (loop.isRunning || !loop.plan.isEmpty) {
                AgentLoopActivityView(loop: loop, steerText: $steerText)
            }

            // A loop delegated from OUTSIDE (the run_agent_loop MCP tool) is
            // mirrored here too — external runs must be just as visible.
            if let mcpController {
                MCPDelegatedLoopMirror(controller: mcpController, steerText: $steerText)
            }

            composer
        }
        .padding(12)
    }

    // MARK: - Pieces

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .foregroundStyle(.tint)
            Text("Agent")
                .font(.headline)
            Spacer()
            if !session.messages.isEmpty {
                Button {
                    session.clear()
                } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.plain)
                .help("Clear the conversation (does not change the design).")
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Describe the app you want.")
                .font(.callout.weight(.medium))
            Text("“A habit tracker with streaks and a paywall.” Build mode designs the screens, wires the navigation and opens the preview. Turn it off to edit what's already on the canvas.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 8)
    }

    private func bubble(_ message: DesignChatSession.Message) -> some View {
        HStack(alignment: .top, spacing: 8) {
            switch message.role {
            case .user:
                VStack(alignment: .leading, spacing: 4) {
                    Text(message.text)
                        .font(.callout)
                        .padding(8)
                        .background(Color.accentColor.opacity(0.14), in: RoundedRectangle(cornerRadius: 10))
                    if message.checkpoint != nil {
                        Button {
                            revert(message)
                        } label: {
                            Label("Revert this", systemImage: "arrow.uturn.backward")
                                .font(.caption2)
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .help("Restore the project to the state before this message.")
                    }
                }
            case .agent:
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "sparkles").foregroundStyle(.tint)
                    if message.isRunning {
                        HStack(spacing: 6) {
                            ProgressView().controlSize(.small)
                            Text(message.stage ?? "Working…")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text(message.text)
                            .font(.caption)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            case .system:
                Text(message.text)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .italic()
            }
            Spacer(minLength: 0)
        }
    }

    /// Which provider the currently-picked model actually talks to.
    private var selectedRoute: ModelProviderRoute? {
        ModelProviderCatalog.route(for: openRouterModel)
    }

    /// Binding for the selected route's key.
    ///
    /// MUST come from @AppStorage, not a hand-rolled Binding over
    /// UserDefaults: SwiftUI does not observe UserDefaults, so a manual
    /// binding renders stale-empty and then the FIRST keystroke overwrites the
    /// stored value with a single character. That silently destroyed a working
    /// 52-character Gemini key and surfaced only as "Please pass a valid API key".
    private func routeKeyBinding(_ route: ModelProviderRoute) -> Binding<String> {
        switch route.id {
        case "cerebras": return $cerebrasAPIKey
        case "groq":     return $groqAPIKey
        case "gemini":   return $geminiAPIKey
        case "nim":      return $nvidiaAPIKey
        default:         return $openRouterAPIKey
        }
    }

    private var composer: some View {
        VStack(spacing: 6) {
            // Model picker (incl. x-ai/grok-4.5). Cloud models need an API key;
            // local/ models run on-device and don't.
            HStack(spacing: 6) {
                Image(systemName: "cpu").font(.caption2).foregroundStyle(.secondary)
                Picker(selection: $openRouterModel) {
                    ForEach(OpenRouterConfiguration.availableModels, id: \.id) { model in
                        Text(model.label).tag(model.id)
                    }
                    if !OpenRouterConfiguration.availableModels.contains(where: { $0.id == openRouterModel }) {
                        Text(openRouterModel).tag(openRouterModel)
                    }
                } label: { EmptyView() }
                .labelsHidden()
                .pickerStyle(.menu)
                .font(.caption)
            }

            // The key field must match the model that's actually SELECTED.
            // Picking "Cerebras Qwen3" and being shown an OpenRouter field is
            // how a user ends up with a key that can never work.
            if let route = selectedRoute, route.requiresKey {
                HStack(spacing: 6) {
                    Circle()
                        .fill(route.isConfigured ? Color.green : Color.orange)
                        .frame(width: 6, height: 6)
                    SecureField("\(route.name) API key", text: routeKeyBinding(route))
                        .textFieldStyle(.roundedBorder)
                        .font(.caption)
                    if !route.isConfigured, let url = ModelProviderCatalog.signupURL(for: route) {
                        Button("Get key") { NSWorkspace.shared.open(url) }
                            .font(.system(size: 10))
                            .buttonStyle(.borderless)
                    }
                }
                Text(route.freeTierNote)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Picker(selection: $engine) {
                if loopAvailable {
                    Text("Agent Loop").tag("loop")
                }
                Text("Build").tag("build")
                Text("Edit").tag("edit")
            } label: { EmptyView() }
            .labelsHidden()
            .pickerStyle(.segmented)
            .font(.caption)
            .help("Agent Loop: works iteratively with tools — designs, wires, screenshots, verifies, fixes (steerable mid-run). Build: the classic one-shot design+wire+preview. Edit: change what's already on the canvas.")

            if usesLoop {
                HStack(spacing: 6) {
                    Text("Pause for approval every")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("$").font(.caption2)
                    TextField(
                        "0.10",
                        value: $agentLoopCostApprovalUSD,
                        format: .number.precision(.fractionLength(2))
                    )
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)
                    .frame(width: 58)
                }
            }

            HStack(spacing: 6) {
                TextField("Message the agent…", text: $input, axis: .vertical)
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(1...4)
                    .onSubmit(send)
                    .disabled(session.isRunning)
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill").font(.title2)
                }
                .buttonStyle(.plain)
                .disabled(session.isRunning || input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }

            if let error = pipeline.errorMessage {
                Text(error)
                    .font(.caption2)
                    .foregroundStyle(.red)
                    .lineLimit(2)
            }
        }
    }

    // MARK: - Actions

    private func send() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !session.isRunning else { return }
        input = ""
        pipeline.errorMessage = nil

        // Snapshot BEFORE the turn so this exact message can be reverted.
        let checkpoint = CheckpointStore.save(viewModel.project, label: "chat: \(text.prefix(40))")
        let turnId = session.appendUser(text, checkpoint: checkpoint)

        Task { @MainActor in
            do {
                if usesLoop, let mcpController {
                    // The agentic engine: the model works the design/logic/game
                    // tools in a loop, verifying as it goes. Steerable below.
                    loop.mcp = mcpController
                    session.updateStage(turnId, "Agent loop running — live log below…")
                    let summary = await loop.run(goal: text)
                    session.finish(turnId, summary: summary)
                } else if engine != "edit" {
                    let orchestrator = AppBuildOrchestrator(
                        design: viewModel, logic: logicViewModel, pipeline: pipeline
                    )
                    let summary = try await orchestrator.buildApp(prompt: text) { stage in
                        session.updateStage(turnId, stage.rawValue + "…")
                    }
                    session.finish(turnId, summary: """
                    Built \(summary.screens.isEmpty ? "the app" : summary.screens.joined(separator: ", ")) — \
                    \(summary.designActionCount) design action(s), \(summary.flowCount) flow(s).\(summary.enabledAppleWatch ? " Apple Watch enabled — export to Xcode for the watch app." : "") Preview is open.
                    """)
                } else {
                    session.updateStage(turnId, "Editing the canvas…")
                    let service = DesignAgentService(viewModel: viewModel, pipeline: pipeline)
                    let summary = try await service.runFullPipeline(prompt: text)
                    session.finish(turnId, summary: "Applied \(summary.appliedActionCount) change(s) to the canvas.")
                }
            } catch {
                session.fail(turnId, error: error.localizedDescription)
            }
        }
    }

    private func revert(_ message: DesignChatSession.Message) {
        do {
            try session.revert(to: message, design: viewModel)
        } catch {
            pipeline.errorMessage = "Revert failed: \(error.localizedDescription)"
        }
    }
}
