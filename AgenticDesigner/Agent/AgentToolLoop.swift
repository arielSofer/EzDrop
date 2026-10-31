//
//  AgentToolLoop.swift
//  AgenticDesigner
//
//  The agentic runtime for the in-app agent — the structural upgrade from
//  "pipeline" to "loop" (the Grok Build / Claude Code harness pattern):
//
//    • The model gets a TOOL BELT and iterates: act → observe → decide next.
//      The belt is the app's own MCP tool registry (dogfooded), curated to the
//      design/logic/preview/game surface — one tool vocabulary for both the
//      inside agent and external MCP clients.
//    • VERIFICATION is a loop step, not a hope: the protocol demands
//      get_screenshot after design edits, get_logic_flows + preview_tap after
//      wiring, check_export_readiness before declaring a build done.
//    • The model OWNS ITS PLAN via an update_plan tool, rendered live in the
//      Agent panel as a checklist.
//    • HOOKS wrap every mutating tool call: checkpoint before the run, and an
//      auto-checkpoint every few mutations (users quit mid-run; work must
//      survive).
//    • SKILLS (SkillLibrary) inject task playbooks; the project MEMO
//      (DesignProject.agentMemo) carries design decisions across runs.
//    • STEERING and CANCEL work mid-run, between steps.
//

import Foundation
import SwiftUI
import Combine
import os

@MainActor
final class AgentToolLoop: ObservableObject {

    /// Full-fidelity diagnostics, visible in Xcode's console and Console.app
    /// (subsystem com.agenticdesigner.agent). The panel transcript truncates
    /// for readability; THIS stream carries the raw model arguments — the
    /// first place to look when a run misbehaves.
    static let diag = Logger(subsystem: "com.agenticdesigner.agent", category: "loop")

    // MARK: - Observable state (rendered by AgentPanel)

    struct PlanItem: Identifiable {
        let id: Int
        var title: String
        var status: String   // "pending" | "doing" | "done"
    }

    struct TranscriptEntry: Identifiable {
        enum Kind { case info, tool, result, error, steer, done }
        let id = UUID()
        let kind: Kind
        let title: String
        let detail: String
    }

    @Published private(set) var transcript: [TranscriptEntry] = []
    @Published private(set) var plan: [PlanItem] = []
    @Published private(set) var isRunning = false
    @Published private(set) var isPaused = false
    @Published private(set) var statusLine = ""
    @Published private(set) var finalSummary: String?
    @Published private(set) var runCostUSD: Double = 0
    @Published private(set) var runPromptTokens: Int = 0
    @Published private(set) var runCompletionTokens: Int = 0
    @Published private(set) var usedModelIds: [String] = []
    @Published private(set) var costApprovalRequired = false
    @Published private(set) var costApprovalIncrementUSD: Double = 0.10

    /// A clarifying question the model asked mid-run (ask_user tool). The loop
    /// is blocked until answer()/skipQuestion() — or the timeout picks the
    /// recommended option so an unattended run still finishes.
    struct PendingQuestion: Identifiable {
        let id = UUID()
        let question: String
        /// Recommended option first. May be empty (free-text only).
        let options: [String]
    }
    @Published private(set) var pendingQuestion: PendingQuestion?
    /// How long ask_user waits before falling back to the recommended option.
    /// UI-launched runs get long leash (someone is watching); run_agent_loop
    /// sets this short because its caller is usually another machine.
    var questionTimeoutSeconds: TimeInterval = 600
    /// Product decisions the caller already collected (run_agent_loop's
    /// `answers`): folded into the intake so the loop doesn't re-ask what an
    /// outer agent's user has already answered.
    var presetAnswers: String?
    /// Optional provenance lock used by automated validation. When set, every
    /// fallback must stay on this provider route (for example `gemini`), so a
    /// successful run cannot be misreported as Gemini after silently switching
    /// to a different vendor.
    var requiredProviderId: String?
    /// Stronger provenance lock: stay on this exact model id and do not use a
    /// sibling model from the same provider.
    var requiredModelId: String?
    private var questionContinuation: CheckedContinuation<String, Never>?

    weak var mcp: MCPServerController?

    private var cancelRequested = false
    private var steerQueue: [String] = []
    private var finishedViaTool = false
    // The in-flight model request — cancel() aborts it immediately instead of
    // waiting out a slow local turn (URLSession honors task cancellation).
    private var turnTask: Task<AgentToolTurnResult, Error>?
    // Finish-gate state: builds that created UI but wired no logic get finish
    // rejected (once) — mockups don't pass. See the "finish" dispatch case.
    private var mutatingCallCount = 0
    // ask_user budget — an interview is 2-4 questions, not a questionnaire.
    private var askedQuestionCount = 0
    // One free redirect from a prose question to the ask_user tool.
    private var textQuestionRedirected = false
    private var finishGateTripped = false
    // Build verification is a hard finish gate for app-building runs.
    private var requiresBuildVerification = false
    private var typecheckPassed = false
    private var simulatorRunPassed = false
    private var baselineProject: DesignProject?
    private var nextCostApprovalThresholdUSD: Double = 0.10
    private var deliveredImageMessageCount = 0
    private var visualRevision = 0
    private var capturedVisualRevision: Int?
    private var capturedFullCanvasRevision: Int?
    private var inspectedScreenIds: Set<String> = []
    private var qualityCheckedVisualRevision: Int?
    private var minimumReferenceScreens = 1
    // One loop at a time app-wide — a second concurrent loop would interleave
    // canvas mutations unpredictably.
    private static var anyLoopRunning = false

    init(mcp: MCPServerController? = nil) {
        self.mcp = mcp
    }

    // MARK: - User controls

    func cancel() {
        guard isRunning else { return }
        cancelRequested = true
        isPaused = false
        // Abort the in-flight model request too — never wait out a slow turn.
        turnTask?.cancel()
        log(.steer, "Cancel requested", "Stopping now.")
    }

    /// Pause between steps: the conversation and plan stay intact, the canvas
    /// is yours — switch views, edit, run previews — then resume() continues
    /// from exactly the same point. (The current model turn/tool finishes
    /// first; pausing takes effect at the next step boundary.)
    func pause() {
        guard isRunning, !isPaused else { return }
        isPaused = true
        log(.steer, "Paused", "Resumes from this exact point — the app is all yours meanwhile.")
    }

    func resume() {
        guard isPaused else { return }
        if costApprovalRequired {
            // Approve the next cost band. If one unusually expensive turn
            // already crossed several bands, jump to the first threshold
            // above the amount already spent instead of pausing repeatedly.
            let nextBand = (floor(runCostUSD / costApprovalIncrementUSD) + 1) * costApprovalIncrementUSD
            nextCostApprovalThresholdUSD = max(
                nextCostApprovalThresholdUSD + costApprovalIncrementUSD,
                nextBand
            )
            costApprovalRequired = false
            log(.steer, "Cost approved", String(format: "Continue up to $%.2f", nextCostApprovalThresholdUSD))
        }
        isPaused = false
        log(.steer, "Resumed", "")
    }

    /// Blocks the loop while paused (checked at step and tool boundaries).
    private func waitWhilePaused() async {
        while isPaused && !cancelRequested {
            if costApprovalRequired {
                statusLine = String(
                    format: "Cost $%.3f reached the $%.2f approval band — press play to continue",
                    runCostUSD,
                    nextCostApprovalThresholdUSD
                )
            } else {
                statusLine = "Paused — press play to resume"
            }
            try? await Task.sleep(nanoseconds: 400_000_000)
        }
    }

    /// Answers the pending ask_user question and unblocks the loop.
    func answer(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard pendingQuestion != nil, !trimmed.isEmpty else { return }
        pendingQuestion = nil
        log(.steer, "Answered", trimmed)
        questionContinuation?.resume(returning: trimmed)
        questionContinuation = nil
    }

    /// Dismisses the question without an opinion — the model gets its own
    /// recommended option back, exactly like the timeout path.
    func skipQuestion() {
        guard let pending = pendingQuestion else { return }
        pendingQuestion = nil
        let fallback = pending.options.first ?? "Your call — pick the professional default."
        log(.steer, "Skipped", "Proceeding with: \(fallback)")
        questionContinuation?.resume(returning: fallback)
        questionContinuation = nil
    }

    /// Blocks until the user answers, the timeout elapses (recommended option
    /// wins), or the run is cancelled.
    private func awaitAnswer(to question: PendingQuestion) async -> String {
        pendingQuestion = question
        statusLine = "Waiting for your answer…"
        let deadline = Date().addingTimeInterval(questionTimeoutSeconds)

        // Watchdog: resolves the continuation if nobody answers. Runs beside
        // the continuation rather than racing it — answer()/skipQuestion()
        // clear pendingQuestion, which is the "already handled" signal.
        let watchdog = Task { [weak self] in
            while let self, self.pendingQuestion?.id == question.id, !self.cancelRequested {
                if Date() >= deadline {
                    let fallback = question.options.first ?? "Your call — pick the professional default."
                    self.pendingQuestion = nil
                    self.log(.steer, "No answer in time", "Proceeding with: \(fallback)")
                    self.questionContinuation?.resume(returning: fallback)
                    self.questionContinuation = nil
                    return
                }
                try? await Task.sleep(nanoseconds: 500_000_000)
            }
            // Cancelled mid-question: unblock with something honest.
            if let self, self.pendingQuestion?.id == question.id, self.cancelRequested {
                self.pendingQuestion = nil
                self.questionContinuation?.resume(returning: "(run cancelled — stop asking and wrap up)")
                self.questionContinuation = nil
            }
        }
        let answer = await withCheckedContinuation { continuation in
            questionContinuation = continuation
        }
        watchdog.cancel()
        return answer
    }

    /// Mid-run guidance — injected as a user message before the next model call.
    func steer(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        steerQueue.append(trimmed)
        log(.steer, "Steering", trimmed)
    }

    // MARK: - The loop

    /// Runs the agentic loop for `goal`. Returns the final summary text.
    @discardableResult
    func run(goal: String) async -> String {
        guard !isRunning, !Self.anyLoopRunning else {
            return "An agent loop is already running — one at a time."
        }
        guard let mcp, let design = mcp.designViewModel else {
            let msg = "Agent loop unavailable: designer not attached."
            log(.error, "Unavailable", msg)
            return msg
        }

        let settings = DesignAgentService.Settings.current()
        let selectedRoute = ModelProviderCatalog.route(for: settings.model)
        guard let apiKey = selectedRoute.resolvedKey() ?? settings.resolvedAPIKey() else {
            let msg = AIProviderError.missingAPIKey.localizedDescription
            log(.error, "No API key", msg)
            return msg
        }
        if !settings.model.hasPrefix("local/"), apiKey.count < 20 {
            let msg = AIProviderError.needsCloudKey(model: settings.model).localizedDescription
            log(.error, "Needs key", msg)
            return msg
        }

        // Reset run state.
        Self.anyLoopRunning = true
        isRunning = true
        isPaused = false
        cancelRequested = false
        finishedViaTool = false
        mutatingCallCount = 0
        askedQuestionCount = 0
        textQuestionRedirected = false
        pendingQuestion = nil
        finishGateTripped = false
        runCostUSD = 0
        runPromptTokens = 0
        runCompletionTokens = 0
        usedModelIds = []
        costApprovalRequired = false
        let storedApprovalIncrement = UserDefaults.standard.object(forKey: "agentLoopCostApprovalUSD") as? Double
        // $0.10 meant ~20 interruptions on a $2 run, which is what a long build
        // actually costs. The guard exists to catch a runaway loop, not to
        // narrate every dime — so the default step is bigger, and the field in
        // the Agent panel still tightens it for anyone who wants a short leash.
        costApprovalIncrementUSD = max(0.01, storedApprovalIncrement ?? 0.50)
        nextCostApprovalThresholdUSD = costApprovalIncrementUSD
        deliveredImageMessageCount = 0
        visualRevision = 0
        capturedVisualRevision = nil
        capturedFullCanvasRevision = nil
        inspectedScreenIds = []
        qualityCheckedVisualRevision = nil
        OpenRouterProvider.resetLearnedTokenCeilings()
        let lowerGoal = goal.lowercased()
        // Hebrew keywords included — a Hebrew "תבנה לי אפליקציה" is exactly as
        // much a build goal as the English, and keying the gate on English
        // alone silently disabled build verification for a core audience.
        requiresBuildVerification = ["build", "app", "ship", "export", "run", "implement", "fix",
                                     "בנה", "תבנה", "אפליקצי", "אפליקציה", "ייצא", "יצוא", "תריץ", "הרץ", "תתקן", "תקן"]
            .contains { lowerGoal.contains($0) }
        let explicitlySingleScreen = ["single screen", "one screen", "מסך אחד", "רק מסך"]
            .contains { lowerGoal.contains($0) }
        let isWholeAppGoal = ["app", "application", "אפליקצי", "build a product", "בנה מוצר"]
            .contains { lowerGoal.contains($0) }
        minimumReferenceScreens = isWholeAppGoal && !explicitlySingleScreen ? 5 : 1
        typecheckPassed = false
        simulatorRunPassed = false
        baselineProject = design.project
        transcript = []
        plan = []
        finalSummary = nil
        defer {
            isRunning = false
            isPaused = false
            Self.anyLoopRunning = false
            statusLine = ""
        }

        let hooks = Hooks(design: design)
        hooks.preRun(goal: goal)

        // Tool belt: curated MCP tools + the loop's own tools.
        let mcpTools = mcp.makeTools().filter { Self.toolAllowlist.contains($0.name) }
        let toolsByName = Dictionary(uniqueKeysWithValues: mcpTools.map { ($0.name, $0) })

        // One provider running out of quota should cost a retry, not the run.
        // The chain is the chosen model first, then every OTHER configured
        // free tier (their quotas are independent), ending at a local model
        // that can never run out.
        var providerChain = ModelProviderCatalog.fallbackChain(startingWith: settings.model)
        if let requiredModelId {
            providerChain = providerChain.filter { $0 == requiredModelId }
        } else if let requiredProviderId {
            providerChain = providerChain.filter {
                ModelProviderCatalog.route(for: $0).id == requiredProviderId
            }
        }
        if providerChain.isEmpty { providerChain = [settings.model] }
        var providerIndex = 0
        var provider = OpenRouterProvider(apiKey: apiKey, model: providerChain[0], temperature: 0.25)
        usedModelIds.append(providerChain[0])
        if providerChain.count > 1 {
            log(.info, "Provider chain", providerChain.joined(separator: " → "))
        }
        var messages: [OpenRouterMessage] = [
            OpenRouterMessage(role: "system", content: systemPrompt(goal: goal, design: design)),
            OpenRouterMessage(role: "user", content: await firstUserMessage(goal: goal, toolsByName: toolsByName))
        ]

        log(.info, "Goal", goal)

        // Chosen ONCE per run. Re-picking the belt every step saved a few
        // hundred schema tokens but moved the head of the request each time,
        // which invalidates the provider's prompt cache (and a local model's
        // KV cache) and forces a full re-read of the entire prefix — far more
        // expensive than the schemas it saved. Verify tools are always folded
        // in so the model can typecheck, assert and finish from any phase.
        let runToolNames = Self.toolNames(for: toolPhase(for: goal), goal: goal)
            .union(Self.toolNames(for: .verify, goal: goal))
        let runTools = mcpTools.filter { runToolNames.contains($0.name) }
        let toolSchemas = runTools.map(Self.schema(for:)) + Self.localToolSchemas
        log(.info, "Tool belt", "\(runTools.count) tools, fixed for this run: \(runTools.map(\.name).joined(separator: ", "))")

        // Stuck-loop detection state (see the guard after each tool result).
        var lastCallSignature = ""
        var repeatedCallCount = 0

        var step = 0
        while !cancelRequested {
            step += 1
            await waitWhilePaused()
            if cancelRequested { break }

            // Drain steering into the conversation.
            while !steerQueue.isEmpty {
                let steer = steerQueue.removeFirst()
                messages.append(OpenRouterMessage(
                    role: "user",
                    content: "STEERING (mid-run user guidance — takes priority): \(steer)"
                ))
            }

            let imageMessageCount = messages.reduce(0) { $0 + ($1.imageDataURLs.isEmpty ? 0 : 1) }
            let hasNewScreenshot = imageMessageCount > deliveredImageMessageCount

            statusLine = "Step \(step) — thinking…"
            var turnResult: AgentToolTurnResult?
            // Escalates only when the provider rejects a turn for prompt size.
            var compactionPressure = 0
            var modelErrorAttempts = 0
            var rateLimitWaits = 0
            // A rejected-for-size turn costs nothing and isn't a provider
            // fault, so it must not consume the model-error budget.
            for _ in 1...8 {
                if cancelRequested || modelErrorAttempts >= 3 { break }

                // Stale screenshots are always dropped (an image costs ~1k
                // tokens and is worthless once the canvas moved on). The TEXT
                // history is compacted once it approaches the budget: rewriting
                // the middle of the transcript changes the cacheable prefix, so
                // it is worth doing late — but a low-credit account has a hard
                // prompt ceiling, and blowing through it fails the whole run.
                let budget = Self.promptTokenBudget()
                let estimated = Self.approximateTokenCount(messages)
                let requestMessages = Self.trimmedForContext(
                    messages,
                    keepRecentToolTurns: compactionPressure >= 2 ? 1 : 2,
                    includeLatestImage: hasNewScreenshot && compactionPressure == 0,
                    compactHistory: compactionPressure > 0 || estimated > budget,
                    toolResultCharLimit: compactionPressure >= 2 ? 1_200 : (compactionPressure == 1 ? 3_000 : 5_600)
                )
                // Below a certain ceiling the fixed overhead — system prompt
                // plus tool schemas — is itself most of the budget, and no
                // amount of history trimming can fit. Shed schemas too.
                let turnToolSchemas = compactionPressure >= 3
                    ? (runTools.filter { Self.essentialToolNames.contains($0.name) }.map(Self.schema(for:)) + Self.localToolSchemas)
                    : toolSchemas

                do {
                    // Trimmed view: full history stays local; the request keeps
                    // the goal + recent steps intact and compresses the middle.
                    // Without this, long runs overflow a local model's context
                    // window and Ollama silently drops the SYSTEM PROMPT first —
                    // the model then degrades into empty/garbage tool calls.
                    let request = Task {
                        try await provider.generateToolTurn(
                            messages: requestMessages,
                            toolSchemas: turnToolSchemas
                        )
                    }
                    turnTask = request
                    turnResult = try await request.value
                    turnTask = nil
                    break
                } catch is CancellationError {
                    turnTask = nil
                    break
                } catch let error as AIProviderError {
                    turnTask = nil
                    // Provider unavailable — spent quota, or congestion on a
                    // shared free model. Either way the answer is the same
                    // while the chain has anything left: SWITCH. A different
                    // provider responds now; the same congested one probably
                    // won't for a while, and waiting burns the run's attempts.
                    let unavailable: String? = {
                        if case let .quotaExceeded(name, _) = error { return name }
                        if case let .rateLimited(name, _) = error { return name }
                        if case let .providerUnavailable(name, _) = error { return name }
                        return nil
                    }()
                    if let providerName = unavailable {
                        if providerIndex + 1 < providerChain.count {
                            providerIndex += 1
                            let next = providerChain[providerIndex]
                            OpenRouterProvider.resetLearnedTokenCeilings()
                            provider = OpenRouterProvider(apiKey: apiKey, model: next, temperature: 0.25)
                            if usedModelIds.last != next { usedModelIds.append(next) }
                            log(.info, "Provider unavailable", "\(providerName): \(error.localizedDescription.prefix(80)) — continuing on \(next).")
                            statusLine = "Step \(step) — switching to \(next)…"
                            continue
                        }
                        // Nothing left to switch to: congestion is worth waiting
                        // out, an exhausted quota is not.
                        if case .rateLimited = error, rateLimitWaits < 3 {
                            rateLimitWaits += 1
                            log(.info, "All providers busy", "Waiting \(rateLimitWaits * 15)s before retrying \(providerName).")
                            statusLine = "Step \(step) — every provider is busy, waiting…"
                            try? await Task.sleep(nanoseconds: UInt64(rateLimitWaits * 15) * 1_000_000_000)
                            continue
                        }
                        finalSummary = "Stopped: every configured provider is out of quota or rate-limited. Add a key for another free provider (Cerebras, Groq, NVIDIA) in the Agent panel, or retry later. Progress so far is on the canvas."
                        log(.done, "No provider available", finalSummary ?? "")
                        return finalSummary ?? ""
                    }
                    // Prompt too big for this account: shrinking the output
                    // reservation can't help, so compact the conversation and
                    // go straight back in — no 15s backoff, nothing is wrong
                    // with the provider.
                    if case let .promptTooLarge(actual, limit) = error {
                        compactionPressure += 1
                        // Before shredding the context any further, try a
                        // provider whose quota is untouched — a smaller prompt
                        // is a worse answer, a different free tier is not.
                        if compactionPressure >= 2, providerIndex + 1 < providerChain.count {
                            providerIndex += 1
                            let next = providerChain[providerIndex]
                            OpenRouterProvider.resetLearnedTokenCeilings()
                            provider = OpenRouterProvider(apiKey: apiKey, model: next, temperature: 0.25)
                            if usedModelIds.last != next { usedModelIds.append(next) }
                            compactionPressure = 1
                            log(.info, "Switching provider", "\(limit)-token ceiling hit — falling through to \(next).")
                            statusLine = "Step \(step) — switching to \(next)…"
                            continue
                        }
                        if compactionPressure > 4 {
                            // Nothing left to shed: even a minimal belt with one
                            // turn of history doesn't fit. Say so plainly rather
                            // than looping — this is a credits problem.
                            log(.error, "Prompt ceiling too low", "This account allows only \(limit) prompt tokens; the system prompt and tool schemas alone exceed it. Add credits at openrouter.ai/settings/credits, or switch the Agent panel to a local/ model (no ceiling).")
                            break
                        }
                        log(.info, "Prompt over budget", "\(actual) > \(limit) tokens — compacting (level \(compactionPressure)) and retrying.")
                        statusLine = "Step \(step) — compacting context…"
                        continue
                    }
                    modelErrorAttempts += 1
                    log(.error, "Model error (attempt \(modelErrorAttempts)/3)", error.localizedDescription)
                    if modelErrorAttempts < 3, !cancelRequested {
                        statusLine = "Step \(step) — model hiccup, retrying…"
                        try? await Task.sleep(nanoseconds: 15_000_000_000)
                    }
                } catch {
                    turnTask = nil
                    modelErrorAttempts += 1
                    log(.error, "Model error (attempt \(modelErrorAttempts)/3)", error.localizedDescription)
                    if modelErrorAttempts < 3, !cancelRequested {
                        statusLine = "Step \(step) — model hiccup, retrying…"
                        try? await Task.sleep(nanoseconds: 15_000_000_000)
                    }
                }
            }
            if cancelRequested { break }
            guard let turn = turnResult else {
                finalSummary = "Stopped after 3 failed model attempts. Progress so far is on the canvas (checkpoints saved) — run again to continue."
                log(.done, "Stopped", finalSummary ?? "")
                return finalSummary ?? ""
            }

            deliveredImageMessageCount = imageMessageCount
            recordUsage(turn.usage)
            if costApprovalRequired {
                await waitWhilePaused()
                if cancelRequested { break }
            }

            switch turn.turn {
            case .text(let text):
                // A question typed as plain text must not END the run — that
                // would punish exactly the behavior the interview protocol
                // asks for. Redirect it to ask_user once; a second free-text
                // reply is accepted as final so a chatty model can't loop.
                let looksLikeQuestion = text.contains("?") || text.contains("؟")
                if looksLikeQuestion, mutatingCallCount == 0, !textQuestionRedirected {
                    textQuestionRedirected = true
                    log(.info, "Question in prose", "Redirecting to ask_user so the run can wait for an answer.")
                    messages.append(OpenRouterMessage(role: "assistant", content: text))
                    messages.append(OpenRouterMessage(
                        role: "user",
                        content: "Don't ask in prose — the run would end before anyone could answer. Call the ask_user tool (one question per call, with 2-4 options, recommended first). If you were not asking anything, call finish with your summary."
                    ))
                    continue
                }
                // No tool calls = the model is done (or lost). Accept as final.
                finalSummary = text
                log(.done, "Done", text)
                return text

            case .toolCalls(let calls, let assistantText):
                for call in calls {
                    Self.diag.info("step \(step) → \(call.name, privacy: .public) RAW ARGS: \(call.arguments, privacy: .public)")
                    print("🤖 [loop] step \(step) → \(call.name) args: \(call.arguments.prefix(2000))")
                }
                if let assistantText, !assistantText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    log(.info, "Agent", assistantText)
                }
                messages.append(OpenRouterMessage(
                    role: "assistant",
                    content: assistantText ?? "",
                    toolCalls: calls
                ))

                for call in calls {
                    await waitWhilePaused()
                    if cancelRequested {
                        messages.append(OpenRouterMessage(
                            role: "tool", content: "Cancelled by the user before this call ran.",
                            toolCallId: call.id
                        ))
                        continue
                    }
                    statusLine = "Step \(step) — \(call.name)…"
                    let (resultText, imageDataURLs) = await dispatch(
                        call: call, toolsByName: toolsByName, design: design, hooks: hooks
                    )
                    messages.append(OpenRouterMessage(
                        role: "tool", content: resultText, toolCallId: call.id
                    ))

                    // Stuck-loop guard. A small model that gets a tool's
                    // argument SHAPE wrong will happily resend the identical
                    // malformed call forever — the transcript grows, the plan
                    // doesn't. Escalate: name the repetition, then stop.
                    let signature = "\(call.name)|\(call.arguments)|\(resultText.prefix(120))"
                    if signature == lastCallSignature {
                        repeatedCallCount += 1
                    } else {
                        lastCallSignature = signature
                        repeatedCallCount = 0
                    }
                    if repeatedCallCount == 2 {
                        log(.error, "Repeating itself", "\(call.name) called identically 3× with the same result — telling the agent to change approach.")
                        messages.append(OpenRouterMessage(
                            role: "user",
                            content: """
                            STOP. You have now called \(call.name) three times with byte-identical \
                            arguments and received the same result each time. Repeating it again will \
                            not change anything. Re-read the error text, fix the ARGUMENT SHAPE (arrays \
                            must be real JSON arrays, not strings), or use a different tool. If you \
                            cannot make progress, call finish and say honestly what blocked you.
                            """
                        ))
                    }
                    if repeatedCallCount >= 5 {
                        finalSummary = "Stopped: \(call.name) repeated the same failing call 6 times without progress. Last result: \(resultText.prefix(200))"
                        log(.done, "Stopped — stuck", finalSummary ?? "")
                        return finalSummary ?? ""
                    }
                    // Tool messages are text-only on the wire; screenshots ride
                    // in a follow-up user message the vision model can see.
                    if !imageDataURLs.isEmpty {
                        messages.append(OpenRouterMessage(
                            role: "user",
                            content: "Screenshot returned by \(call.name):",
                            imageDataURLs: imageDataURLs
                        ))
                    }
                    if finishedViaTool { break }
                }

                if finishedViaTool {
                    log(.done, "Done", finalSummary ?? "")
                    return finalSummary ?? "Done."
                }
            }
        }

        if cancelRequested {
            finalSummary = "Cancelled by the user. Progress so far is on the canvas (checkpoints saved)."
            log(.done, "Cancelled", finalSummary ?? "")
        }
        return finalSummary ?? ""
    }

    // MARK: - Tool dispatch

    /// Runs one tool call — the loop's own tools first, then the MCP belt.
    /// Returns the text for the tool message plus any screenshot data URLs.
    private func dispatch(
        call: OpenRouterMessageToolCall,
        toolsByName: [String: MCPToolDefinition],
        design: ProjectViewModel,
        hooks: Hooks
    ) async -> (String, [String]) {
        let args: [String: Any]
        if call.arguments.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args = [:]
        } else if let data = call.arguments.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            args = parsed
        } else {
            let msg = "Could not parse the arguments as a JSON object. You sent: \(call.arguments.prefix(300))"
            log(.error, call.name, msg)
            return (msg, [])
        }

        // Loop-local tools.
        switch call.name {
        case "ask_user":
            let question = ((args["question"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !question.isEmpty else {
                return ("ask_user needs a non-empty 'question'.", [])
            }
            if let presetAnswers, !presetAnswers.isEmpty {
                let reply = "The caller already supplied product decisions. Resolve this question from them and do not pause:\n\(presetAnswers)"
                log(.steer, "Answered from preset decisions", question)
                return (reply, [])
            }
            guard askedQuestionCount < 4 else {
                return ("Question budget exhausted (4 per run) — make the professional call yourself and record it in the summary.", [])
            }
            // An interview after the build started is an interrogation: by
            // then reverting costs more than the answer is worth. Ask first.
            guard mutatingCallCount == 0 else {
                return ("Too late to ask — the build already started. Proceed with the professional default and note the assumption in your summary.", [])
            }
            askedQuestionCount += 1
            let options = ((args["options"] as? [Any]) ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty }
            log(.steer, "❓ \(question)", options.isEmpty ? "(free answer)" : options.joined(separator: " | "))
            let reply = await awaitAnswer(to: PendingQuestion(question: question, options: Array(options.prefix(4))))
            return ("USER ANSWER: \(reply)", [])

        case "update_plan":
            return (handleUpdatePlan(args), [])
        case "load_skill":
            let id = (args["id"] as? String) ?? ""
            if let skill = SkillLibrary.skill(withId: id) {
                log(.tool, "load_skill", skill.title)
                return (skill.instructions, [])
            }
            return ("Unknown skill '\(id)'. Available:\n\(SkillLibrary.catalogSummary)", [])
        case "update_design_memo":
            let memo = (args["memo"] as? String) ?? ""
            design.project.agentMemo = memo.isEmpty ? nil : memo
            log(.tool, "update_design_memo", "\(memo.count) chars")
            return ("Design memo saved (\(memo.count) chars). Future agent runs will read it.", [])
        case "show_diff":
            return (projectDiff(design: design), [])
        case "finish":
            // The finish-gate (a hook, not a hope): a run that mutated the
            // canvas but wired zero logic flows is a mockup — reject once with
            // instructions. A pure-read or pure-sprite run passes untouched.
            let flowCount = meaningfulInteractionFlowCount(design: design)
            if mutatingCallCount > 0, flowCount == 0 {
                finishGateTripped = true
                let msg = "REJECTED: you built UI but wired ZERO logic flows — this is a mockup, not an app. Wire the logic now with apply_logic_actions (navigation, button handlers, state variables), confirm with get_logic_flows, then call finish again."
                log(.error, "finish gate", "blocked — no logic flows wired yet")
                return (msg, [])
            }
            if mutatingCallCount > 0, minimumReferenceScreens > 1 {
                let screenCount = designProjectScreenCount(design)
                if screenCount < minimumReferenceScreens {
                    let msg = "REJECTED: this whole-app goal has only \(screenCount) screen(s). The AppShots reference flows need at least \(minimumReferenceScreens) purposeful screens covering entry, discovery, decision, action and feedback. Compose or add the missing journey states, wire them, then verify again."
                    log(.error, "reference flow gate", msg)
                    return (msg, [])
                }
                let requiredFlows = max(1, screenCount - 1)
                if flowCount < requiredFlows {
                    let msg = "REJECTED: only \(flowCount) of at least \(requiredFlows) meaningful interaction flows are wired. A qualifying flow needs a real event on a child control (not the whole screen), a connected action, and a screen owner. Wire the primary journey across the screens, verify it with get_logic_flows and preview_tap, then finish again."
                    log(.error, "reference flow gate", msg)
                    return (msg, [])
                }
            }
            if mutatingCallCount > 0, capturedVisualRevision != visualRevision {
                let msg = "REJECTED: the latest visual revision has not been inspected. Call get_screenshot now, examine the rendered result, repair anything visibly weak, then call check_design_quality."
                log(.error, "visual inspection gate", msg)
                return (msg, [])
            }
            if mutatingCallCount > 0, minimumReferenceScreens > 1 {
                let screenIds = Set(design.currentPage.nodes.filter { $0.type == .Frame }.map { $0.id.uuidString.uppercased() })
                let missing = screenIds.subtracting(inspectedScreenIds)
                if !missing.isEmpty {
                    let msg = "REJECTED: only \(screenIds.count - missing.count) of \(screenIds.count) screens were inspected at readable resolution. Call get_screenshot once per missing screenNodeId from get_project_overview, repair any weak screen, then re-run check_design_quality. Missing: \(missing.sorted().joined(separator: ", "))."
                    log(.error, "per-screen visual gate", msg)
                    return (msg, [])
                }
            }
            if mutatingCallCount > 0 {
                let quality = DesignQualityAudit.report(page: design.currentPage)
                if !quality.passesReferenceBar {
                    let msg = "REJECTED: the design is below the learned AppShots reference bar. Repair every blocker/warning, capture the updated screenshot and re-run check_design_quality.\n\n\(DesignQualityAudit.summary(quality, limit: 40))"
                    log(.error, "reference quality gate", "score \(quality.score)/100")
                    return (msg, [])
                }
                if qualityCheckedVisualRevision != visualRevision {
                    let msg = "REJECTED: quality has not been certified for the latest visual revision. Call check_design_quality; finish is allowed only when it reports REFERENCE BAR PASS."
                    log(.error, "quality certification gate", msg)
                    return (msg, [])
                }
            }
            if requiresBuildVerification && mutatingCallCount > 0 && (!typecheckPassed || !simulatorRunPassed) {
                let missing = [
                    typecheckPassed ? nil : "typecheck_generated",
                    simulatorRunPassed ? nil : "run_in_simulator"
                ].compactMap { $0 }.joined(separator: " and ")
                let msg = "REJECTED: the app is not verified yet. Run \(missing), read every diagnostic, repair the generated code/design, then rerun verification. Call show_diff before finish."
                log(.error, "verification gate", msg)
                return (msg, [])
            }
            let summary = (args["summary"] as? String) ?? "Done."
            finishedViaTool = true
            finalSummary = summary
            log(.tool, "finish", String(summary.prefix(180)))
            return ("Finished.", [])
        default:
            break
        }

        // MCP belt.
        guard let tool = toolsByName[call.name] else {
            let msg = "Unknown tool '\(call.name)'. Use only the provided tools."
            log(.error, call.name, msg)
            return (msg, [])
        }

        let requestedScreenId = (args["screenNodeId"] as? String)?.uppercased()
        let repeatsExistingCapture = requestedScreenId.map { inspectedScreenIds.contains($0) }
            ?? (capturedFullCanvasRevision == visualRevision)
        if Self.screenshotTools.contains(call.name),
           capturedVisualRevision == visualRevision,
           repeatsExistingCapture {
            let msg = "Screenshot skipped: the visual state has not changed since the last capture. Use the existing observation, or mutate/tap the UI before capturing again."
            log(.result, call.name, "skipped unchanged visual state")
            return (msg, [])
        }

        // JSON-string params (see stringFlattened) become structure again.
        let normalizedArgs = Self.reparsingJSONStrings(in: args, original: tool.inputSchema)

        // Degenerate-payload guard: empty/typeless actions never reach the
        // handler — the model gets a concrete example to copy instead of a
        // vague decode error it retries verbatim.
        if ["apply_design_actions", "apply_logic_actions"].contains(call.name),
           let actions = normalizedArgs["actions"] as? [[String: Any]],
           actions.allSatisfy({ $0["type"] == nil }) {
            let msg = """
            REJECTED: every action object needs at least a "type" — you sent \(actions.count) without one. \
            Copy this shape (as ONE JSON string in the actions parameter): \
            [{"type":"createFrame","nodeReference":"screen","name":"Home","x":0,"y":0,"width":390,"height":844,"fill":"#0E1E33"},\
            {"type":"createText","parentReference":"screen","text":"Hello","x":24,"y":80,"width":220,"height":34,"fontSize":26,"textColor":"#FFFFFF"},\
            {"type":"createButton","parentReference":"screen","nodeReference":"cta","text":"Start","x":95,"y":700,"width":200,"height":56,"fill":"#3B82F6","cornerRadius":28}] \
            Resend the complete call now with real actions.
            """
            log(.error, call.name, "blocked degenerate payload (\(actions.count) typeless action(s))")
            return (msg, [])
        }

        log(.tool, call.name, Self.compactArguments(normalizedArgs))
        do {
            let result = try await tool.handler(normalizedArgs)
            var textParts: [String] = []
            var images: [String] = []
            for item in result.content {
                switch item {
                case .text(let t): textParts.append(t)
                case .image(let base64, let mime): images.append("data:\(mime);base64,\(base64)")
                }
            }
            if !images.isEmpty {
                textParts.append("[\(images.count) screenshot(s) attached in the next message — inspect them.]")
            }
            var text = Self.truncated(textParts.joined(separator: "\n"))
            if !result.isError {
                if call.name == "typecheck_generated" && text.localizedCaseInsensitiveContains("Build OK") {
                    typecheckPassed = true
                }
                if call.name == "run_in_simulator" && text.localizedCaseInsensitiveContains("Running on") {
                    simulatorRunPassed = true
                }
            }
            if Hooks.mutatingTools.contains(call.name), !result.isError {
                mutatingCallCount += 1
            }
            if Self.visualMutationTools.contains(call.name), !result.isError {
                visualRevision += 1
                qualityCheckedVisualRevision = nil
                capturedFullCanvasRevision = nil
                inspectedScreenIds = []
            }
            if Self.screenshotTools.contains(call.name), !result.isError, !images.isEmpty {
                capturedVisualRevision = visualRevision
                if call.name == "get_screenshot", let requestedScreenId {
                    inspectedScreenIds.insert(requestedScreenId)
                } else {
                    capturedFullCanvasRevision = visualRevision
                }
            }
            if call.name == "check_design_quality", !result.isError,
               text.localizedCaseInsensitiveContains("REFERENCE BAR PASS") {
                qualityCheckedVisualRevision = visualRevision
            }
            if let note = hooks.afterTool(named: call.name) {
                text += "\n\(note)"
            }
            log(result.isError ? .error : .result, call.name, String(text.prefix(220)))
            return (text.isEmpty ? "(empty result)" : text, images)
        } catch {
            let msg = "Tool error: \(error.localizedDescription)"
            log(.error, call.name, msg)
            return (msg, [])
        }
    }

    private func projectDiff(design: ProjectViewModel) -> String {
        let before = baselineProject
        let beforeScreens = before?.pages.flatMap { $0.nodes.filter { $0.type == .Frame } }.count ?? 0
        let afterScreens = designProjectScreenCount(design)
        let beforeNodes = before?.pages.flatMap { $0.nodes }.count ?? 0
        let afterNodes = designProjectNodeCount(design)
        let beforeFlows = before?.pages.flatMap(\.logicFlows).count ?? 0
        let afterFlows = design.project.pages.flatMap(\.logicFlows).count
        return """
        DIFF FROM RUN START
        Screens: \(beforeScreens) → \(afterScreens) (Δ \(afterScreens - beforeScreens))
        Root nodes: \(beforeNodes) → \(afterNodes) (Δ \(afterNodes - beforeNodes))
        Logic flows: \(beforeFlows) → \(afterFlows) (Δ \(afterFlows - beforeFlows))
        Verification: typecheck=\(typecheckPassed ? "PASS" : "PENDING"), simulator=\(simulatorRunPassed ? "PASS" : "PENDING")
        """
    }

    private func designProjectScreenCount(_ design: ProjectViewModel) -> Int {
        design.project.pages.flatMap { $0.nodes.filter { $0.type == .Frame } }.count
    }

    private func designProjectNodeCount(_ design: ProjectViewModel) -> Int {
        design.project.pages.flatMap { $0.nodes }.count
    }

    private func handleUpdatePlan(_ args: [String: Any]) -> String {
        guard let rawItems = args["items"] as? [[String: Any]], !rawItems.isEmpty else {
            return "update_plan needs items: [{title, status}] with status pending|doing|done."
        }
        plan = rawItems.enumerated().map { index, raw in
            PlanItem(
                id: index,
                title: (raw["title"] as? String) ?? "Step \(index + 1)",
                status: (raw["status"] as? String) ?? "pending"
            )
        }
        let doneCount = plan.filter { $0.status == "done" }.count
        log(.tool, "update_plan", "\(doneCount)/\(plan.count) done")
        return "Plan updated: \(plan.count) step(s), \(doneCount) done."
    }

    // MARK: - Prompts

    private func systemPrompt(goal: String, design: ProjectViewModel) -> String {
        let memo = design.project.agentMemo?.trimmingCharacters(in: .whitespacesAndNewlines)
        let matchedSkills = SkillLibrary.matching(goal: goal)
        let skillSection = matchedSkills.isEmpty
            ? "(none auto-loaded — pull one with load_skill if a playbook fits)"
            : matchedSkills.map(\.instructions).joined(separator: "\n\n")

        return """
        You are the AgenticDesigner agent: you operate a visual app-design tool through TOOLS, in a loop — call tools, read their results, and decide the next move. You build real, working apps: designed screens, wired logic, generated imagery, playable games.

        PROTOCOL
        0. CLARIFY FIRST, BUILD ONCE. Your first message includes a BRIEF ANALYSIS. If it lists open decisions, ask each with ask_user (one call per question, options included, recommended first) BEFORE any mutating tool call — ask_user is rejected once the build starts. If it says the brief is complete, do NOT ask anything. Never ask about details the pipeline decides well (spacing, copy, component choice, exact hexes).
        1. FIRST call update_plan with 3–6 concrete steps for the goal. Keep it current: exactly one step "doing" at a time; mark steps "done" as you verify them.
        2. The available tool belt follows the current "doing" plan item (design → logic → verify). Update the plan when changing phases; unavailable tools will appear automatically in their relevant phase.
        3. Work in small batches — one screen or one concern per apply_* call. Never dump the whole app in one giant call.
        4. SPACING IS A DESIGN DECISION, NOT A LEFTOVER. Pick ONE horizontal screen padding (16, 20 or 24) and use the SAME value on every screen — nothing sits flush against a screen edge. Give containers real padding + spacing (cards 12–20 inside, list rows 12–16, section gaps 20–32) instead of nudging children pixel by pixel; a card whose content touches its own border reads as broken. Set padding/paddingH/paddingV/spacing on the CONTAINER so the layout survives a resize, and keep the values on a consistent scale (4/8/12/16/20/24/32) rather than arbitrary numbers.
        5. LOGIC IS NOT OPTIONAL. Screens without wired logic are mockups, and mockups fail this job. Every build includes an apply_logic_actions pass: navigation between screens, button handlers, and state variables. finish is BLOCKED until get_logic_flows shows real flows.
        6. VERIFY, don't assume. After a VISUAL change in a multi-screen app, call get_project_overview, then get_screenshot with each root screenNodeId and inspect every screen at readable resolution; use one whole-canvas capture only to compare consistency. Do not capture the same unchanged screen repeatedly. After logic changes: get_logic_flows to confirm wiring, then preview_tap to walk the primary path. For an app with accounts, walk the WHOLE signup once: preview_type into each field, preview_tap the submit button, preview_choose_branch success at the auth pause, and confirm the app lands past the login wall.
        7. VISUAL QUALITY IS A GATE. Run check_design_quality after inspecting the latest screenshot. Repair and repeat until it prints REFERENCE BAR PASS; finish rejects the latest visual revision otherwise.
        8. For build-an-app goals, run check_export_readiness before finishing and resolve code-level blockers it reports.
        9. For build/export/run goals, execute this repair loop before finish: typecheck_generated (or run_in_simulator), read every diagnostic, repair the design/logic/source, run the check again, then run_in_simulator and inspect simulator_screenshot. Repeat until the check passes. Never stop at the first build error.
        10. Call show_diff immediately before finish. Finish ONLY by calling finish with a short honest summary that includes the verification result and the diff. Never claim unverified work.

        RULES
        - NO OFF-THE-SHELF APP TEMPLATES. You tailor every screen and author every game spec to this request. compose_reference_app is the preferred deterministic design SYSTEM, not a template: you still decide the product flow, components and copy. For create_game_scene always pass a full custom `spec`.
        - Phone screens are root frames ~390x844; multiple screens sit side by side (x spaced ~450). Your x/y land exactly as sent.
        - If a tool errors, read the message, fix your input, and try a different way — at most 2 retries per problem, then adapt the plan.
        - Record durable design decisions (palette, typography, structure, tone) with update_design_memo — future runs build on it instead of re-deriving.
        - Game goals: generate_sprite for the art, then a custom create_game_scene spec using those sprite paths; wrap the game with real screens (menu, game over) wired by logic flows.
        - Stay inside the provided tools; never invent tool names or parameters.

        \(AppShotsDesignKnowledge.agentLoopGuide(for: goal))

        PROJECT MEMO (decisions from past runs — honor them):
        \(memo?.isEmpty == false ? memo! : "(none yet)")

        SKILL CATALOG (load with load_skill):
        \(SkillLibrary.catalogSummary)

        ACTIVE PLAYBOOKS:
        \(skillSection)
        """
    }

    /// Seeds the loop with the project state so step 1 isn't spent asking.
    private func firstUserMessage(goal: String, toolsByName: [String: MCPToolDefinition]) async -> String {
        var overview = ""
        if let tool = toolsByName["get_project_overview"],
           let result = try? await tool.handler([:]) {
            overview = Self.truncated(result.content.compactMap { item -> String? in
                if case .text(let t) = item { return t }
                return nil
            }.joined(separator: "\n"))
        }
        // Preset answers count as part of the brief: a decision the caller
        // already collected must neither be re-asked nor re-decided.
        let effectiveBrief = [goal, presetAnswers].compactMap { $0 }.joined(separator: "\n")
        let intake = BriefIntake.promptSection(
            prompt: effectiveBrief,
            project: mcp?.designViewModel?.project
        )
        let decisions = presetAnswers.map {
            "\nPRODUCT DECISIONS (already answered — honor them, never re-ask):\n\($0)\n"
        } ?? ""
        return """
        GOAL: \(goal)
        \(decisions)
        \(intake)

        CURRENT PROJECT STATE:
        \(overview.isEmpty ? "(empty project)" : overview)
        """
    }

    // MARK: - Hooks (deterministic guardrails around the loop)

    @MainActor
    private final class Hooks {
        let design: ProjectViewModel
        private var mutationsSinceCheckpoint = 0

        init(design: ProjectViewModel) {
            self.design = design
        }

        static let mutatingTools: Set<String> = [
            "compose_reference_app", "apply_design_actions", "apply_canvas_studio_edits", "wire_interactions",
            "apply_logic_actions", "create_from_template", "add_logic_template",
            "set_brand", "apply_theme", "create_game_scene", "update_game_scene",
        ]

        /// Pre-run: the whole run is one-click reversible.
        func preRun(goal: String) {
            if !design.project.pages.allSatisfy({ $0.nodes.isEmpty }) {
                CheckpointStore.save(design.project, label: "before agent: \(goal.prefix(40))")
            }
        }

        /// Post-tool: auto-checkpoint every few mutations so a force-quit or
        /// crash mid-run never loses the work.
        func afterTool(named name: String) -> String? {
            guard Self.mutatingTools.contains(name) else { return nil }
            mutationsSinceCheckpoint += 1
            guard mutationsSinceCheckpoint >= 3 else { return nil }
            mutationsSinceCheckpoint = 0
            CheckpointStore.save(design.project, label: "auto: agent mid-run")
            return "(auto-checkpoint saved)"
        }
    }

    // MARK: - Tool belt definition

    private enum ToolPhase: String {
        case design
        case logic
        case verify
    }

    /// The currently "doing" plan item selects a small, purpose-built tool
    /// belt. This avoids resending every schema on every turn while still
    /// giving the model an explicit transition tool into the next phase.
    private func toolPhase(for goal: String) -> ToolPhase {
        let activeWork = plan.first(where: { $0.status == "doing" })?.title.lowercased()
            ?? goal.lowercased()

        if Self.containsAny(
            activeWork,
            ["verify", "typecheck", "simulator", "readiness", "export", "build check"]
        ) {
            return .verify
        }
        if Self.containsAny(
            activeWork,
            ["design", "screen", "canvas", "layout", "visual", "style", "theme", "ui", "sprite", "game scene"]
        ) {
            return .design
        }
        if Self.containsAny(
            activeWork,
            ["logic", "wire", "navigation", "interaction", "state", "flow", "preview", "tap"]
        ) {
            return .logic
        }
        if activeWork.contains("test") {
            return .verify
        }
        return .design
    }

    private static func toolNames(for phase: ToolPhase, goal: String) -> Set<String> {
        let lowerGoal = goal.lowercased()
        switch phase {
        case .design:
            if containsAny(lowerGoal, ["game", "sprite", "platformer", "runner", "flappy"]) {
                return [
                    "get_project_overview", "get_design_tree", "get_screenshot",
                    "generate_sprite", "create_game_scene", "get_game_scene",
                    "update_game_scene", "apply_logic_actions",
                ]
            }
            return [
                "get_project_overview", "get_design_tree", "get_screenshot",
                "compose_reference_app", "apply_design_actions", "apply_canvas_studio_edits",
                "set_brand", "apply_theme", "apply_logic_actions",
                "check_design_quality",
            ]

        case .logic:
            return [
                "get_design_tree", "apply_logic_actions", "get_logic_flows",
                "wire_interactions", "wire_backend", "preview_app", "preview_tap",
                "preview_type", "preview_choose_branch",
                "preview_screenshot", "check_export_readiness",
            ]

        case .verify:
            // preview_type/preview_choose_branch let the loop walk ITS OWN
            // signup: fill the form, submit, take the success branch, and see
            // the app land on Home — the one flow every account-backed app
            // must survive, and previously unverifiable without a human.
            var tools: Set<String> = [
                "check_design_quality", "check_export_readiness", "typecheck_generated", "run_in_simulator",
                "simulator_screenshot", "get_project_overview", "get_design_tree", "get_screenshot",
                "compose_reference_app", "apply_design_actions", "apply_canvas_studio_edits",
                "set_brand", "apply_theme",
                "apply_logic_actions", "get_logic_flows",
                "preview_app", "preview_tap", "preview_type", "preview_choose_branch", "preview_screenshot",
            ]
            if containsAny(lowerGoal, ["export", "xcode project", "ship"]) {
                tools.remove("get_design_tree")
                tools.insert("export_xcode_project")
            }
            return tools
        }
    }

    private static func containsAny(_ text: String, _ needles: [String]) -> Bool {
        needles.contains { text.contains($0) }
    }

    /// The curated slice of the MCP registry the inside agent may use — the
    /// design/logic/preview/game surface. Deliberately excludes: pdf_* (other
    /// product), export/simulator (heavyweight side effects), checkpoints
    /// (hooks own those), the recursive entry points (run_design_agent,
    /// build_full_app, run_agent_loop), and ALL template tools — the inside
    /// agent authors every screen and game spec itself, from scratch.
    static let toolAllowlist: Set<String> = [
        "get_project_overview", "get_design_tree", "get_screenshot",
        "compose_reference_app", "apply_design_actions", "get_canvas_studio_capabilities", "apply_canvas_studio_edits",
        "wire_interactions", "set_brand", "apply_theme",
        "apply_logic_actions", "get_logic_flows", "wire_backend",
        "preview_app", "preview_tap", "preview_type", "preview_choose_branch", "preview_screenshot",
        "check_design_quality", "check_export_readiness", "assert_ready", "typecheck_generated", "run_in_simulator", "simulator_screenshot", "simulator_tap", "export_xcode_project", "get_generated_code", "select_page",
        "generate_sprite", "create_game_scene",
        "get_game_scene", "update_game_scene",
    ]

    static let screenshotTools: Set<String> = [
        "get_screenshot", "preview_screenshot", "simulator_screenshot",
    ]

    static let visualMutationTools: Set<String> = [
        "compose_reference_app", "apply_design_actions", "apply_canvas_studio_edits", "set_brand", "apply_theme",
        "create_game_scene", "update_game_scene",
    ]

    /// The workhorse tools keep their FULL descriptions — truncating them cuts
    /// exactly the field docs and examples a local model needs to author valid
    /// payloads (the cause of "{\"actions\":[{}]}" degenerate calls).
    static let fullDescriptionTools: Set<String> = [
        "compose_reference_app", "apply_design_actions", "apply_logic_actions", "check_design_quality", "create_game_scene", "update_game_scene", "export_xcode_project", "run_in_simulator", "typecheck_generated",
    ]

    static func schema(for tool: MCPToolDefinition) -> [String: Any] {
        let cap = fullDescriptionTools.contains(tool.name) ? 3000 : 700
        return [
            "type": "function",
            "function": [
                "name": tool.name,
                "description": String(tool.description.prefix(cap)),
                "parameters": Self.stringFlattened(tool.inputSchema),
            ],
        ]
    }

    /// Local models emit structured nested arrays-of-objects unreliably, but
    /// write the same payload fine as a JSON STRING. The belt advertises deep
    /// params as strings; dispatch re-parses them (and still accepts real
    /// arrays/objects from models that send those).
    static func stringFlattened(_ schema: [String: Any]) -> [String: Any] {
        var result = schema
        guard var props = result["properties"] as? [String: Any] else { return result }
        for (key, raw) in props {
            guard let prop = raw as? [String: Any],
                  let type = prop["type"] as? String,
                  type == "array" || type == "object" else { continue }
            let description = (prop["description"] as? String) ?? ""
            props[key] = [
                "type": "string",
                "description": description + " — PROVIDE AS ONE JSON STRING (a JSON-encoded \(type)).",
            ]
        }
        result["properties"] = props
        return result
    }

    /// Undo the flattening on the way in: any string arg whose original schema
    /// expects an array/object is parsed back to structure.
    static func reparsingJSONStrings(in args: [String: Any], original: [String: Any]) -> [String: Any] {
        guard let props = original["properties"] as? [String: Any] else { return args }
        var out = args
        for (key, value) in args {
            guard let text = value as? String,
                  let prop = props[key] as? [String: Any],
                  let type = prop["type"] as? String, type == "array" || type == "object",
                  let data = text.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data) else { continue }
            out[key] = parsed
        }
        return out
    }

    static let localToolSchemas: [[String: Any]] = [
        [
            "type": "function",
            "function": [
                "name": "ask_user",
                "description": "Ask the user ONE clarifying question and wait for the answer. Use ONLY before the build starts (it is rejected after the first mutating call), only for product-shaping decisions the brief leaves open (see BRIEF ANALYSIS in your first message), and at most 4 per run. Always pass 2-4 options with your RECOMMENDED one first — if the user doesn't answer in time, that first option is returned. Never ask about spacing, copy, component choice, or anything the brief already states.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "question": ["type": "string", "description": "One specific question, in the user's language."],
                        "options": [
                            "type": "array",
                            "items": ["type": "string"],
                            "description": "2-4 answer choices, recommended first. The user can also type a free answer.",
                        ],
                    ],
                    "required": ["question"],
                ],
            ],
        ],
        [
            "type": "function",
            "function": [
                "name": "update_plan",
                "description": "Create or update your working plan (shown live to the user). Call this FIRST with 3-6 steps, then keep statuses current: exactly one step 'doing', mark verified steps 'done'.",
                "parameters": [
                    "type": "object",
                    "properties": [
                        "items": [
                            "type": "array",
                            "items": [
                                "type": "object",
                                "properties": [
                                    "title": ["type": "string"],
                                    "status": ["type": "string", "enum": ["pending", "doing", "done"]],
                                ],
                                "required": ["title", "status"],
                            ],
                        ],
                    ],
                    "required": ["items"],
                ],
            ],
        ],
        [
            "type": "function",
            "function": [
                "name": "load_skill",
                "description": "Load a playbook from the skill catalog by id (see the catalog in your system prompt).",
                "parameters": [
                    "type": "object",
                    "properties": ["id": ["type": "string"]],
                    "required": ["id"],
                ],
            ],
        ],
        [
            "type": "function",
            "function": [
                "name": "update_design_memo",
                "description": "Persist durable design decisions for this project (palette, typography, structure, tone). Replaces the whole memo — include everything still true. Future agent runs read it.",
                "parameters": [
                    "type": "object",
                    "properties": ["memo": ["type": "string"]],
                    "required": ["memo"],
                ],
            ],
        ],
        [
            "type": "function",
            "function": [
                "name": "show_diff",
                "description": "Show a concise human-readable diff from the project state at the start of this run: screens, nodes, logic flows, and verification status. Call immediately before finish.",
                "parameters": ["type": "object", "properties": [:]],
            ],
        ],
        [
            "type": "function",
            "function": [
                "name": "finish",
                "description": "End the run. Call only after verification. summary = what you built AND what you verified (screenshots looked at, flows tapped through, readiness checked).",
                "parameters": [
                    "type": "object",
                    "properties": ["summary": ["type": "string"]],
                    "required": ["summary"],
                ],
            ],
        ],
    ]

    // MARK: - Small helpers

    private func recordUsage(_ usage: AgentToolUsage?) {
        guard let usage else { return }
        runPromptTokens += usage.promptTokens
        runCompletionTokens += usage.completionTokens

        if let cost = usage.costUSD, cost > 0 {
            runCostUSD += cost
        }

        let costText = usage.costUSD.map { String(format: "$%.4f", $0) } ?? "cost unavailable"
        log(
            .info,
            "Turn usage",
            "\(usage.promptTokens) input · \(usage.completionTokens) output · \(costText) · run \(String(format: "$%.4f", runCostUSD))"
        )

        guard runCostUSD + 0.000_000_1 >= nextCostApprovalThresholdUSD else { return }
        costApprovalRequired = true
        isPaused = true
        log(
            .steer,
            "Cost approval required",
            String(format: "Run reached $%.3f. Press play to approve the next $%.2f band, or stop.", runCostUSD, costApprovalIncrementUSD)
        )
    }

    /// Live logic-flow count: the logic view model when attached (source of
    /// truth while editing), else the flows persisted on the pages.
    private func currentFlowCount(design: ProjectViewModel) -> Int {
        if let live = mcp?.logicViewModel?.flows.count, live > 0 { return live }
        return design.project.pages.reduce(0) { $0 + $1.logicFlows.count }
    }

    /// Counts flows that represent actual user interactions rather than empty
    /// default flows or an On Tap attached to the entire 390×844 screen. The
    /// latter technically contains blocks but cannot prove that a real CTA,
    /// card or navigation item was wired.
    private func meaningfulInteractionFlowCount(design: ProjectViewModel) -> Int {
        let liveFlows = mcp?.logicViewModel?.flows ?? []
        let flows = liveFlows.isEmpty ? design.project.pages.flatMap(\.logicFlows) : liveFlows
        return flows.filter { flow in
            guard let screenId = flow.screenNodeId,
                  flow.blocks.count >= 2,
                  !flow.connections.isEmpty else { return false }
            return flow.blocks.contains { block in
                guard block.category == .event else { return false }
                return block.parameters.contains { parameter in
                    parameter.nodeReference.map { $0 != screenId } ?? false
                }
            }
        }.count
    }

    private func log(_ kind: TranscriptEntry.Kind, _ title: String, _ detail: String) {
        transcript.append(TranscriptEntry(kind: kind, title: title, detail: detail))
        if transcript.count > 240 { transcript.removeFirst(transcript.count - 240) }
        // Mirror everything to Xcode/Console.app (and stdout when run from Xcode).
        let line = "[loop:\(kind)] \(title)\(detail.isEmpty ? "" : " — \(detail)")"
        if kind == .error {
            Self.diag.error("\(line, privacy: .public)")
        } else {
            Self.diag.info("\(line, privacy: .public)")
        }
        print("🤖 \(line.prefix(1200))")
    }

    private static func compactArguments(_ args: [String: Any]) -> String {
        guard !args.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: args),
              let s = String(data: data, encoding: .utf8) else { return "" }
        return String(s.prefix(220))
    }

    /// Bounds a tool result for the conversation: head + tail, with a marker.
    static func truncated(_ text: String, limit: Int = 6000) -> String {
        guard text.count > limit else { return text }
        let head = text.prefix(4200)
        let tail = text.suffix(1400)
        return "\(head)\n… [truncated \(text.count - 5600) chars — ask for a narrower slice if you need the middle] …\n\(tail)"
    }

    /// Context management for the per-turn request. Keeps the system prompt,
    /// goal, and two newest tool turns at full fidelity. Everything older is
    /// replaced by a short outcome summary, so large historical tool-call JSON
    /// arguments disappear instead of being silently resent forever.
    /// How large the conversation may get before it is compacted. Once
    /// OpenRouter has told us this account's hard prompt ceiling we stay well
    /// under it (the estimate is approximate, and the system prompt + tool
    /// schemas sit on top of it); otherwise a conservative default, since
    /// overshooting costs a failed round-trip and undershooting costs a little
    /// cache efficiency.
    static func promptTokenBudget() -> Int {
        guard let ceiling = OpenRouterProvider.learnedPromptTokenCeiling else { return 12_000 }
        return max(2_000, Int(Double(ceiling) * 0.55))
    }

    /// Rough token estimate (≈4 chars/token, plus a flat cost per image) used
    /// to decide WHEN compaction is worth breaking the cacheable prefix for.
    static func approximateTokenCount(_ messages: [OpenRouterMessage]) -> Int {
        messages.reduce(0) { total, message in
            total + message.content.count / 4 + (message.imageDataURLs.isEmpty ? 0 : 900)
        }
    }

    /// The few tools a run cannot proceed without. Used only when the prompt
    /// ceiling is so low that the schemas themselves don't fit.
    static let essentialToolNames: Set<String> = [
        "get_project_overview", "get_design_tree", "compose_reference_app", "apply_design_actions",
        "apply_logic_actions", "get_screenshot", "check_design_quality"
    ]

    static func trimmedForContext(
        _ messages: [OpenRouterMessage],
        keepRecentToolTurns: Int = 2,
        includeLatestImage: Bool = true,
        compactHistory: Bool = true,
        toolResultCharLimit: Int = 5_600
    ) -> [OpenRouterMessage] {
        var working = messages

        // Under pressure the RETAINED turns are the problem: one raw
        // get_design_tree result can be bigger than the whole budget.
        if toolResultCharLimit < 5_600 {
            for i in working.indices where working[i].role == "tool" {
                guard working[i].content.count > toolResultCharLimit else { continue }
                working[i] = OpenRouterMessage(
                    role: working[i].role,
                    content: String(working[i].content.prefix(toolResultCharLimit))
                        + "\n… [truncated to fit this account's prompt limit — re-query for a narrower slice]",
                    toolCallId: working[i].toolCallId,
                    toolCalls: working[i].toolCalls
                )
            }
        }

        // A new screenshot is delivered once. Later turns receive a tiny note
        // and can explicitly capture again after another visual mutation.
        let retainedImageIndex = includeLatestImage
            ? working.lastIndex(where: { !$0.imageDataURLs.isEmpty })
            : nil
        for i in working.indices where !working[i].imageDataURLs.isEmpty {
            if i != retainedImageIndex {
                working[i] = OpenRouterMessage(
                    role: working[i].role,
                    content: working[i].content + " (screenshot omitted from this turn — capture again only after a visual change)",
                    toolCallId: working[i].toolCallId,
                    toolCalls: working[i].toolCalls
                )
            }
        }

        // Images are handled above regardless; the summarising pass below only
        // runs once the transcript is big enough to be worth the cache break.
        guard compactHistory else { return working }

        let toolTurnStarts = working.indices.filter {
            working[$0].role == "assistant" && !(working[$0].toolCalls ?? []).isEmpty
        }
        var tailStart: Int
        if toolTurnStarts.count > keepRecentToolTurns {
            tailStart = toolTurnStarts[toolTurnStarts.count - keepRecentToolTurns]
        } else if working.count > 10 {
            tailStart = max(2, working.count - 6)
        } else {
            return working
        }

        // Never start the retained tail in the middle of an assistant
        // tool-call ↔ tool-result group; providers reject orphan tool messages.
        while tailStart > 2 {
            let message = working[tailStart]
            if message.role == "tool"
                || (message.role == "user"
                    && message.content.localizedCaseInsensitiveContains("screenshot returned")) {
                tailStart -= 1
                continue
            }
            break
        }
        guard tailStart > 2 else { return working }

        let olderMessages = Array(working[2..<tailStart])
        var toolNamesById: [String: String] = [:]
        for message in olderMessages {
            for call in message.toolCalls ?? [] {
                toolNamesById[call.id] = call.name
            }
        }

        var summaryLines: [String] = []
        for message in olderMessages {
            if let calls = message.toolCalls, !calls.isEmpty {
                summaryLines.append("Agent called: \(calls.map(\.name).joined(separator: ", "))")
                continue
            }

            let compact = compactHistoryText(message.content, limit: 220)
            guard !compact.isEmpty else { continue }
            switch message.role {
            case "tool":
                let name = message.toolCallId.flatMap { toolNamesById[$0] } ?? "tool"
                summaryLines.append("\(name): \(compact)")
            case "assistant":
                summaryLines.append("Agent: \(compact)")
            case "user" where compact.localizedCaseInsensitiveContains("screenshot returned"):
                summaryLines.append("Screenshot was inspected; image bytes were discarded.")
            default:
                summaryLines.append("\(message.role.capitalized): \(compact)")
            }
        }

        var summary = summaryLines.joined(separator: "\n")
        let summaryLimit = 2_400
        if summary.count > summaryLimit {
            summary = "… earlier details dropped; current project state can be re-read with a tool …\n"
                + String(summary.suffix(summaryLimit))
        }
        let summaryMessage = OpenRouterMessage(
            role: "user",
            content: """
            EARLIER RUN SUMMARY (tool arguments and image bytes intentionally discarded):
            \(summary.isEmpty ? "No durable earlier outcome." : summary)
            """
        )

        return Array(working.prefix(2)) + [summaryMessage] + Array(working[tailStart...])
    }

    private static func compactHistoryText(_ text: String, limit: Int) -> String {
        let oneLine = text
            .replacingOccurrences(of: "\n", with: " ")
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        guard oneLine.count > limit else { return oneLine }
        return String(oneLine.prefix(limit)) + "…"
    }
}
