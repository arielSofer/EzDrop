// Ported 1:1 from AgenticDesigner/Agent/AgentToolLoop.swift
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
// The Swift class is an @MainActor ObservableObject; the port is framework
// free: the same published fields are plain properties and
// `subscribe(listener)` replaces `objectWillChange`.

import { getPlatform } from '../platform';
import { storageGetJSON } from '../platform/Storage';
import { newUUID } from '../models/uuid';
import type { JSONObject, JSONValue } from '../models/JSON';
import type { DesignPage, DesignProject } from '../models/DesignProject';
import type { MCPToolDefinition } from '../mcp/types';
import { AppShotsDesignKnowledge } from '../designIntelligence/AppShotsDesignKnowledge';
import { AIProviderError } from './AIProvider';
import { ModelProviderCatalog, routeResolvedKey } from './ModelProviderCatalog';
import {
  OpenRouterProvider,
  makeOpenRouterMessage,
  type AgentToolTurnResult,
  type AgentToolUsage,
  type OpenRouterMessage,
  type OpenRouterMessageToolCall,
} from './OpenRouterProvider';
import { DesignAgentService } from './DesignAgentService';
import { SkillLibrary } from './SkillLibrary';
import { BriefIntake } from './BriefIntake';
import {
  NullAgentCheckpointStore,
  type AgentCheckpointStore,
  type AgentDesignHost,
  type AgentLogicHost,
  type AgentQualityAuditor,
  type AgentToolHost,
} from './hosts';

// MARK: - Observable state

export interface PlanItem {
  id: number;
  title: string;
  /** "pending" | "doing" | "done" */
  status: string;
}

export const AllTranscriptEntryKind = ['info', 'tool', 'result', 'error', 'steer', 'done'] as const;
export type TranscriptEntryKind = (typeof AllTranscriptEntryKind)[number];

export interface TranscriptEntry {
  id: string;
  kind: TranscriptEntryKind;
  title: string;
  detail: string;
}

/**
 * A clarifying question the model asked mid-run (ask_user tool). The loop
 * is blocked until answer()/skipQuestion() — or the timeout picks the
 * recommended option so an unattended run still finishes.
 */
export interface PendingQuestion {
  id: string;
  question: string;
  /** Recommended option first. May be empty (free-text only). */
  options: string[];
}

/** The one `OpenRouterProvider` member the loop calls. */
export interface AgentToolLoopProvider {
  generateToolTurn(messages: OpenRouterMessage[], toolSchemas: JSONObject[]): Promise<AgentToolTurnResult>;
}

export class AgentLoopCancellationError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'AgentLoopCancellationError';
  }
}

export interface AgentToolLoopDependencies {
  mcp?: AgentToolHost;
  design?: AgentDesignHost;
  logic?: AgentLogicHost;
  checkpoints?: AgentCheckpointStore;
  /** `DesignQualityAudit` — the finish gate skips its checks when absent. */
  quality?: AgentQualityAuditor;
  /** Defaults to `OpenRouterProvider(apiKey:model:temperature:)`. */
  makeProvider?: (apiKey: string, model: string, temperature: number) => AgentToolLoopProvider;
}

// MARK: - Hooks (deterministic guardrails around the loop)

class Hooks {
  private mutationsSinceCheckpoint = 0;

  constructor(private readonly design: AgentDesignHost, private readonly checkpoints: AgentCheckpointStore) {}

  static readonly mutatingTools: ReadonlySet<string> = new Set([
    'compose_reference_app', 'apply_design_actions', 'apply_canvas_studio_edits', 'wire_interactions',
    'apply_logic_actions', 'create_from_template', 'add_logic_template',
    'set_brand', 'apply_theme', 'create_game_scene', 'update_game_scene',
  ]);

  /** Pre-run: the whole run is one-click reversible. */
  preRun(goal: string): void {
    if (!this.design.project.pages.every((page) => page.nodes.length === 0)) {
      this.checkpoints.save(this.design.project, `before agent: ${prefixString(goal, 40)}`);
    }
  }

  /**
   * Post-tool: auto-checkpoint every few mutations so a force-quit or
   * crash mid-run never loses the work.
   */
  afterTool(name: string): string | undefined {
    if (!Hooks.mutatingTools.has(name)) return undefined;
    this.mutationsSinceCheckpoint += 1;
    if (this.mutationsSinceCheckpoint < 3) return undefined;
    this.mutationsSinceCheckpoint = 0;
    this.checkpoints.save(this.design.project, 'auto: agent mid-run');
    return '(auto-checkpoint saved)';
  }
}

type ToolPhase = 'design' | 'logic' | 'verify';

function prefixString(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

function charCount(text: string): number {
  return Array.from(text).length;
}

function suffixString(text: string, count: number): string {
  const characters = Array.from(text);
  return characters.slice(Math.max(0, characters.length - count)).join('');
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class AgentToolLoop {
  // MARK: - Observable state (rendered by AgentPanel)

  transcript: TranscriptEntry[] = [];
  plan: PlanItem[] = [];
  isRunning = false;
  isPaused = false;
  statusLine = '';
  finalSummary: string | undefined;
  runCostUSD = 0;
  runPromptTokens = 0;
  runCompletionTokens = 0;
  usedModelIds: string[] = [];
  costApprovalRequired = false;
  costApprovalIncrementUSD = 0.10;
  pendingQuestion: PendingQuestion | undefined;

  /**
   * How long ask_user waits before falling back to the recommended option.
   * UI-launched runs get long leash (someone is watching); run_agent_loop
   * sets this short because its caller is usually another machine.
   */
  questionTimeoutSeconds = 600;
  /** Product decisions the caller already collected (run_agent_loop's `answers`). */
  presetAnswers: string | undefined;
  /** Optional provenance lock used by automated validation. */
  requiredProviderId: string | undefined;
  /** Stronger provenance lock: stay on this exact model id. */
  requiredModelId: string | undefined;

  mcp: AgentToolHost | undefined;
  design: AgentDesignHost | undefined;
  logic: AgentLogicHost | undefined;

  private readonly checkpoints: AgentCheckpointStore;
  private readonly quality: AgentQualityAuditor | undefined;
  private readonly makeProvider: (apiKey: string, model: string, temperature: number) => AgentToolLoopProvider;

  private questionResolver: ((answer: string) => void) | undefined;
  private cancelWaiters: (() => void)[] = [];

  private cancelRequested = false;
  private steerQueue: string[] = [];
  private finishedViaTool = false;
  // Finish-gate state: builds that created UI but wired no logic get finish
  // rejected (once) — mockups don't pass. See the "finish" dispatch case.
  private mutatingCallCount = 0;
  // ask_user budget — an interview is 2-4 questions, not a questionnaire.
  private askedQuestionCount = 0;
  // One free redirect from a prose question to the ask_user tool.
  private textQuestionRedirected = false;
  private finishGateTripped = false;
  // Build verification is a hard finish gate for app-building runs.
  private requiresBuildVerification = false;
  private typecheckPassed = false;
  private simulatorRunPassed = false;
  private baselineProject: DesignProject | undefined;
  private nextCostApprovalThresholdUSD = 0.10;
  private deliveredImageMessageCount = 0;
  private visualRevision = 0;
  private capturedVisualRevision: number | undefined;
  private capturedFullCanvasRevision: number | undefined;
  private inspectedScreenIds = new Set<string>();
  private qualityCheckedVisualRevision: number | undefined;
  private minimumReferenceScreens = 1;
  // One loop at a time app-wide — a second concurrent loop would interleave
  // canvas mutations unpredictably.
  private static anyLoopRunning = false;

  private listeners = new Set<() => void>();

  constructor(dependencies: AgentToolLoopDependencies = {}) {
    this.mcp = dependencies.mcp;
    this.design = dependencies.design;
    this.logic = dependencies.logic;
    this.checkpoints = dependencies.checkpoints ?? NullAgentCheckpointStore;
    this.quality = dependencies.quality;
    this.makeProvider = dependencies.makeProvider
      ?? ((apiKey, model, temperature) => new OpenRouterProvider(apiKey, model, temperature));
  }

  /** `objectWillChange` replacement: returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(): void {
    for (const listener of [...this.listeners]) listener();
  }

  // MARK: - User controls

  cancel(): void {
    if (!this.isRunning) return;
    this.cancelRequested = true;
    this.isPaused = false;
    // Abort the in-flight model request too — never wait out a slow turn.
    const waiters = this.cancelWaiters;
    this.cancelWaiters = [];
    for (const waiter of waiters) waiter();
    this.log('steer', 'Cancel requested', 'Stopping now.');
  }

  /**
   * Pause between steps: the conversation and plan stay intact, the canvas
   * is yours — switch views, edit, run previews — then resume() continues
   * from exactly the same point.
   */
  pause(): void {
    if (!this.isRunning || this.isPaused) return;
    this.isPaused = true;
    this.log('steer', 'Paused', 'Resumes from this exact point — the app is all yours meanwhile.');
  }

  resume(): void {
    if (!this.isPaused) return;
    if (this.costApprovalRequired) {
      // Approve the next cost band. If one unusually expensive turn
      // already crossed several bands, jump to the first threshold
      // above the amount already spent instead of pausing repeatedly.
      const nextBand = (Math.floor(this.runCostUSD / this.costApprovalIncrementUSD) + 1) * this.costApprovalIncrementUSD;
      this.nextCostApprovalThresholdUSD = Math.max(
        this.nextCostApprovalThresholdUSD + this.costApprovalIncrementUSD,
        nextBand,
      );
      this.costApprovalRequired = false;
      this.log('steer', 'Cost approved', `Continue up to $${this.nextCostApprovalThresholdUSD.toFixed(2)}`);
    }
    this.isPaused = false;
    this.log('steer', 'Resumed', '');
  }

  /** Blocks the loop while paused (checked at step and tool boundaries). */
  private async waitWhilePaused(): Promise<void> {
    while (this.isPaused && !this.cancelRequested) {
      if (this.costApprovalRequired) {
        this.statusLine = `Cost $${this.runCostUSD.toFixed(3)} reached the $${this.nextCostApprovalThresholdUSD.toFixed(2)} approval band — press play to continue`;
      } else {
        this.statusLine = 'Paused — press play to resume';
      }
      this.publish();
      await getPlatform().clock.sleep(400);
    }
  }

  /** Answers the pending ask_user question and unblocks the loop. */
  answer(text: string): void {
    const trimmed = text.trim();
    if (this.pendingQuestion === undefined || trimmed.length === 0) return;
    this.pendingQuestion = undefined;
    this.log('steer', 'Answered', trimmed);
    this.resolveQuestion(trimmed);
  }

  /**
   * Dismisses the question without an opinion — the model gets its own
   * recommended option back, exactly like the timeout path.
   */
  skipQuestion(): void {
    const pending = this.pendingQuestion;
    if (!pending) return;
    this.pendingQuestion = undefined;
    const fallback = pending.options[0] ?? 'Your call — pick the professional default.';
    this.log('steer', 'Skipped', `Proceeding with: ${fallback}`);
    this.resolveQuestion(fallback);
  }

  private resolveQuestion(answer: string): void {
    const resolver = this.questionResolver;
    this.questionResolver = undefined;
    resolver?.(answer);
    this.publish();
  }

  /**
   * Blocks until the user answers, the timeout elapses (recommended option
   * wins), or the run is cancelled.
   */
  private async awaitAnswer(question: PendingQuestion): Promise<string> {
    this.pendingQuestion = question;
    this.statusLine = 'Waiting for your answer…';
    this.publish();
    const clock = getPlatform().clock;
    const deadline = clock.now() + this.questionTimeoutSeconds * 1000;

    // Watchdog: resolves the pending promise if nobody answers. Runs beside
    // it rather than racing it — answer()/skipQuestion() clear
    // pendingQuestion, which is the "already handled" signal.
    const watchdog = (async () => {
      while (this.pendingQuestion?.id === question.id && !this.cancelRequested) {
        if (clock.now() >= deadline) {
          const fallback = question.options[0] ?? 'Your call — pick the professional default.';
          this.pendingQuestion = undefined;
          this.log('steer', 'No answer in time', `Proceeding with: ${fallback}`);
          this.resolveQuestion(fallback);
          return;
        }
        await clock.sleep(500);
      }
      // Cancelled mid-question: unblock with something honest.
      if (this.pendingQuestion?.id === question.id && this.cancelRequested) {
        this.pendingQuestion = undefined;
        this.resolveQuestion('(run cancelled — stop asking and wrap up)');
      }
    })();

    const answer = await new Promise<string>((resolve) => {
      this.questionResolver = resolve;
    });
    void watchdog;
    return answer;
  }

  /** Mid-run guidance — injected as a user message before the next model call. */
  steer(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    this.steerQueue.push(trimmed);
    this.log('steer', 'Steering', trimmed);
  }

  // MARK: - The loop

  /** Runs the agentic loop for `goal`. Returns the final summary text. */
  async run(goal: string): Promise<string> {
    if (this.isRunning || AgentToolLoop.anyLoopRunning) {
      return 'An agent loop is already running — one at a time.';
    }
    const mcp = this.mcp;
    const design = this.design;
    if (!mcp || !design) {
      const msg = 'Agent loop unavailable: designer not attached.';
      this.log('error', 'Unavailable', msg);
      return msg;
    }

    const settings = DesignAgentService.Settings.current();
    const selectedRoute = ModelProviderCatalog.route(settings.model);
    const apiKey = routeResolvedKey(selectedRoute) ?? DesignAgentService.resolvedAPIKey(settings);
    if (!apiKey) {
      const msg = AIProviderError.missingAPIKey().errorDescription;
      this.log('error', 'No API key', msg);
      return msg;
    }
    if (!settings.model.startsWith('local/') && apiKey.length < 20) {
      const msg = AIProviderError.needsCloudKey(settings.model).errorDescription;
      this.log('error', 'Needs key', msg);
      return msg;
    }

    // Reset run state.
    AgentToolLoop.anyLoopRunning = true;
    this.isRunning = true;
    this.isPaused = false;
    this.cancelRequested = false;
    this.finishedViaTool = false;
    this.mutatingCallCount = 0;
    this.askedQuestionCount = 0;
    this.textQuestionRedirected = false;
    this.pendingQuestion = undefined;
    this.finishGateTripped = false;
    this.runCostUSD = 0;
    this.runPromptTokens = 0;
    this.runCompletionTokens = 0;
    this.usedModelIds = [];
    this.costApprovalRequired = false;
    const storedApprovalIncrement = storedCostApprovalIncrement();
    // $0.10 meant ~20 interruptions on a $2 run, which is what a long build
    // actually costs. The guard exists to catch a runaway loop, not to
    // narrate every dime — so the default step is bigger, and the field in
    // the Agent panel still tightens it for anyone who wants a short leash.
    this.costApprovalIncrementUSD = Math.max(0.01, storedApprovalIncrement ?? 0.50);
    this.nextCostApprovalThresholdUSD = this.costApprovalIncrementUSD;
    this.deliveredImageMessageCount = 0;
    this.visualRevision = 0;
    this.capturedVisualRevision = undefined;
    this.capturedFullCanvasRevision = undefined;
    this.inspectedScreenIds = new Set();
    this.qualityCheckedVisualRevision = undefined;
    OpenRouterProvider.resetLearnedTokenCeilings();
    const lowerGoal = goal.toLowerCase();
    // Hebrew keywords included — a Hebrew "תבנה לי אפליקציה" is exactly as
    // much a build goal as the English.
    this.requiresBuildVerification = ['build', 'app', 'ship', 'export', 'run', 'implement', 'fix',
      'בנה', 'תבנה', 'אפליקצי', 'אפליקציה', 'ייצא', 'יצוא', 'תריץ', 'הרץ', 'תתקן', 'תקן']
      .some((needle) => lowerGoal.includes(needle));
    const explicitlySingleScreen = ['single screen', 'one screen', 'מסך אחד', 'רק מסך']
      .some((needle) => lowerGoal.includes(needle));
    const isWholeAppGoal = ['app', 'application', 'אפליקצי', 'build a product', 'בנה מוצר']
      .some((needle) => lowerGoal.includes(needle));
    this.minimumReferenceScreens = isWholeAppGoal && !explicitlySingleScreen ? 5 : 1;
    this.typecheckPassed = false;
    this.simulatorRunPassed = false;
    this.baselineProject = design.project;
    this.transcript = [];
    this.plan = [];
    this.finalSummary = undefined;
    this.publish();

    try {
      const hooks = new Hooks(design, this.checkpoints);
      hooks.preRun(goal);

      // Tool belt: curated MCP tools + the loop's own tools.
      const mcpTools = mcp.listTools().filter((tool) => AgentToolLoop.toolAllowlist.has(tool.name));
      const toolsByName = new Map<string, MCPToolDefinition>(mcpTools.map((tool) => [tool.name, tool]));

      // One provider running out of quota should cost a retry, not the run.
      let providerChain = ModelProviderCatalog.fallbackChain(settings.model);
      if (this.requiredModelId !== undefined) {
        const required = this.requiredModelId;
        providerChain = providerChain.filter((model) => model === required);
      } else if (this.requiredProviderId !== undefined) {
        const required = this.requiredProviderId;
        providerChain = providerChain.filter((model) => ModelProviderCatalog.route(model).id === required);
      }
      if (providerChain.length === 0) providerChain = [settings.model];
      let providerIndex = 0;
      let provider = this.makeProvider(apiKey, providerChain[0]!, 0.25);
      this.usedModelIds.push(providerChain[0]!);
      if (providerChain.length > 1) {
        this.log('info', 'Provider chain', providerChain.join(' → '));
      }
      const messages: OpenRouterMessage[] = [
        makeOpenRouterMessage('system', this.systemPrompt(goal, design)),
        makeOpenRouterMessage('user', await this.firstUserMessage(goal, toolsByName)),
      ];

      this.log('info', 'Goal', goal);

      // Chosen ONCE per run: re-picking the belt every step moves the head of
      // the request, which invalidates the provider's prompt cache.
      const runToolNames = new Set<string>([
        ...AgentToolLoop.toolNames(this.toolPhase(goal), goal),
        ...AgentToolLoop.toolNames('verify', goal),
      ]);
      const runTools = mcpTools.filter((tool) => runToolNames.has(tool.name));
      const toolSchemas = [...runTools.map(AgentToolLoop.schema), ...AgentToolLoop.localToolSchemas];
      this.log('info', 'Tool belt', `${runTools.length} tools, fixed for this run: ${runTools.map((tool) => tool.name).join(', ')}`);

      // Stuck-loop detection state (see the guard after each tool result).
      let lastCallSignature = '';
      let repeatedCallCount = 0;

      let step = 0;
      while (!this.cancelRequested) {
        step += 1;
        await this.waitWhilePaused();
        if (this.cancelRequested) break;

        // Drain steering into the conversation.
        while (this.steerQueue.length > 0) {
          const steer = this.steerQueue.shift()!;
          messages.push(makeOpenRouterMessage(
            'user',
            `STEERING (mid-run user guidance — takes priority): ${steer}`,
          ));
        }

        const imageMessageCount = messages.reduce(
          (total, message) => total + ((message.imageDataURLs ?? []).length === 0 ? 0 : 1),
          0,
        );
        const hasNewScreenshot = imageMessageCount > this.deliveredImageMessageCount;

        this.setStatusLine(`Step ${step} — thinking…`);
        let turnResult: AgentToolTurnResult | undefined;
        // Escalates only when the provider rejects a turn for prompt size.
        let compactionPressure = 0;
        let modelErrorAttempts = 0;
        let rateLimitWaits = 0;
        // A rejected-for-size turn costs nothing and isn't a provider
        // fault, so it must not consume the model-error budget.
        for (let attempt = 0; attempt < 8; attempt++) {
          if (this.cancelRequested || modelErrorAttempts >= 3) break;

          const budget = AgentToolLoop.promptTokenBudget();
          const estimated = AgentToolLoop.approximateTokenCount(messages);
          const requestMessages = AgentToolLoop.trimmedForContext(messages, {
            keepRecentToolTurns: compactionPressure >= 2 ? 1 : 2,
            includeLatestImage: hasNewScreenshot && compactionPressure === 0,
            compactHistory: compactionPressure > 0 || estimated > budget,
            toolResultCharLimit: compactionPressure >= 2 ? 1_200 : (compactionPressure === 1 ? 3_000 : 5_600),
          });
          // Below a certain ceiling the fixed overhead — system prompt
          // plus tool schemas — is itself most of the budget. Shed schemas too.
          const turnToolSchemas = compactionPressure >= 3
            ? [
                ...runTools.filter((tool) => AgentToolLoop.essentialToolNames.has(tool.name)).map(AgentToolLoop.schema),
                ...AgentToolLoop.localToolSchemas,
              ]
            : toolSchemas;

          try {
            turnResult = await this.raceWithCancel(provider.generateToolTurn(requestMessages, turnToolSchemas));
            break;
          } catch (error) {
            if (error instanceof AgentLoopCancellationError) break;
            if (AIProviderError.is(error)) {
              // Provider unavailable — spent quota, or congestion on a
              // shared free model. Either way the answer is the same
              // while the chain has anything left: SWITCH.
              const errorCase = error.errorCase;
              const unavailable = errorCase.kind === 'quotaExceeded' || errorCase.kind === 'rateLimited'
                || errorCase.kind === 'providerUnavailable'
                ? errorCase.provider
                : undefined;
              if (unavailable !== undefined) {
                if (providerIndex + 1 < providerChain.length) {
                  providerIndex += 1;
                  const next = providerChain[providerIndex]!;
                  OpenRouterProvider.resetLearnedTokenCeilings();
                  provider = this.makeProvider(apiKey, next, 0.25);
                  if (this.usedModelIds[this.usedModelIds.length - 1] !== next) this.usedModelIds.push(next);
                  this.log('info', 'Provider unavailable', `${unavailable}: ${prefixString(error.errorDescription, 80)} — continuing on ${next}.`);
                  this.setStatusLine(`Step ${step} — switching to ${next}…`);
                  continue;
                }
                // Nothing left to switch to: congestion is worth waiting
                // out, an exhausted quota is not.
                if (errorCase.kind === 'rateLimited' && rateLimitWaits < 3) {
                  rateLimitWaits += 1;
                  this.log('info', 'All providers busy', `Waiting ${rateLimitWaits * 15}s before retrying ${unavailable}.`);
                  this.setStatusLine(`Step ${step} — every provider is busy, waiting…`);
                  await getPlatform().clock.sleep(rateLimitWaits * 15 * 1000);
                  continue;
                }
                this.finalSummary = 'Stopped: every configured provider is out of quota or rate-limited. Add a key for another free provider (Cerebras, Groq, NVIDIA) in the Agent panel, or retry later. Progress so far is on the canvas.';
                this.log('done', 'No provider available', this.finalSummary);
                return this.finalSummary;
              }
              // Prompt too big for this account: compact the conversation
              // and go straight back in.
              if (errorCase.kind === 'promptTooLarge') {
                compactionPressure += 1;
                // Before shredding the context any further, try a provider
                // whose quota is untouched.
                if (compactionPressure >= 2 && providerIndex + 1 < providerChain.length) {
                  providerIndex += 1;
                  const next = providerChain[providerIndex]!;
                  OpenRouterProvider.resetLearnedTokenCeilings();
                  provider = this.makeProvider(apiKey, next, 0.25);
                  if (this.usedModelIds[this.usedModelIds.length - 1] !== next) this.usedModelIds.push(next);
                  compactionPressure = 1;
                  this.log('info', 'Switching provider', `${errorCase.limit}-token ceiling hit — falling through to ${next}.`);
                  this.setStatusLine(`Step ${step} — switching to ${next}…`);
                  continue;
                }
                if (compactionPressure > 4) {
                  // Nothing left to shed: this is a credits problem.
                  this.log('error', 'Prompt ceiling too low', `This account allows only ${errorCase.limit} prompt tokens; the system prompt and tool schemas alone exceed it. Add credits at openrouter.ai/settings/credits, or switch the Agent panel to a local/ model (no ceiling).`);
                  break;
                }
                this.log('info', 'Prompt over budget', `${errorCase.actual} > ${errorCase.limit} tokens — compacting (level ${compactionPressure}) and retrying.`);
                this.setStatusLine(`Step ${step} — compacting context…`);
                continue;
              }
            }
            modelErrorAttempts += 1;
            this.log('error', `Model error (attempt ${modelErrorAttempts}/3)`, (error as Error)?.message ?? String(error));
            if (modelErrorAttempts < 3 && !this.cancelRequested) {
              this.setStatusLine(`Step ${step} — model hiccup, retrying…`);
              await getPlatform().clock.sleep(15_000);
            }
          }
        }
        if (this.cancelRequested) break;
        if (turnResult === undefined) {
          this.finalSummary = 'Stopped after 3 failed model attempts. Progress so far is on the canvas (checkpoints saved) — run again to continue.';
          this.log('done', 'Stopped', this.finalSummary);
          return this.finalSummary;
        }

        this.deliveredImageMessageCount = imageMessageCount;
        this.recordUsage(turnResult.usage);
        if (this.costApprovalRequired) {
          await this.waitWhilePaused();
          if (this.cancelRequested) break;
        }

        const turn = turnResult.turn;
        if (turn.kind === 'text') {
          const text = turn.text;
          // A question typed as plain text must not END the run — that
          // would punish exactly the behavior the interview protocol
          // asks for. Redirect it to ask_user once.
          const looksLikeQuestion = text.includes('?') || text.includes('؟');
          if (looksLikeQuestion && this.mutatingCallCount === 0 && !this.textQuestionRedirected) {
            this.textQuestionRedirected = true;
            this.log('info', 'Question in prose', 'Redirecting to ask_user so the run can wait for an answer.');
            messages.push(makeOpenRouterMessage('assistant', text));
            messages.push(makeOpenRouterMessage(
              'user',
              'Don\'t ask in prose — the run would end before anyone could answer. Call the ask_user tool (one question per call, with 2-4 options, recommended first). If you were not asking anything, call finish with your summary.',
            ));
            continue;
          }
          // No tool calls = the model is done (or lost). Accept as final.
          this.finalSummary = text;
          this.log('done', 'Done', text);
          return text;
        }

        const calls = turn.toolCalls;
        const assistantText = turn.assistantText;
        for (const call of calls) {
          getPlatform().logger.info(`🤖 [loop] step ${step} → ${call.name} args: ${prefixString(call.arguments, 2000)}`);
        }
        if (assistantText !== undefined && assistantText.trim().length > 0) {
          this.log('info', 'Agent', assistantText);
        }
        messages.push(makeOpenRouterMessage('assistant', assistantText ?? '', { toolCalls: calls }));

        for (const call of calls) {
          await this.waitWhilePaused();
          if (this.cancelRequested) {
            messages.push(makeOpenRouterMessage('tool', 'Cancelled by the user before this call ran.', { toolCallId: call.id }));
            continue;
          }
          this.setStatusLine(`Step ${step} — ${call.name}…`);
          const [resultText, imageDataURLs] = await this.dispatch(call, toolsByName, design, hooks);
          messages.push(makeOpenRouterMessage('tool', resultText, { toolCallId: call.id }));

          // Stuck-loop guard. A small model that gets a tool's argument
          // SHAPE wrong will happily resend the identical malformed call
          // forever. Escalate: name the repetition, then stop.
          const signature = `${call.name}|${call.arguments}|${prefixString(resultText, 120)}`;
          if (signature === lastCallSignature) {
            repeatedCallCount += 1;
          } else {
            lastCallSignature = signature;
            repeatedCallCount = 0;
          }
          if (repeatedCallCount === 2) {
            this.log('error', 'Repeating itself', `${call.name} called identically 3× with the same result — telling the agent to change approach.`);
            messages.push(makeOpenRouterMessage(
              'user',
              `STOP. You have now called ${call.name} three times with byte-identical arguments and received the same result each time. Repeating it again will not change anything. Re-read the error text, fix the ARGUMENT SHAPE (arrays must be real JSON arrays, not strings), or use a different tool. If you cannot make progress, call finish and say honestly what blocked you.`,
            ));
          }
          if (repeatedCallCount >= 5) {
            this.finalSummary = `Stopped: ${call.name} repeated the same failing call 6 times without progress. Last result: ${prefixString(resultText, 200)}`;
            this.log('done', 'Stopped — stuck', this.finalSummary);
            return this.finalSummary;
          }
          // Tool messages are text-only on the wire; screenshots ride
          // in a follow-up user message the vision model can see.
          if (imageDataURLs.length > 0) {
            messages.push(makeOpenRouterMessage('user', `Screenshot returned by ${call.name}:`, { imageDataURLs }));
          }
          if (this.finishedViaTool) break;
        }

        if (this.finishedViaTool) {
          this.log('done', 'Done', this.finalSummary ?? '');
          return this.finalSummary ?? 'Done.';
        }
      }

      if (this.cancelRequested) {
        this.finalSummary = 'Cancelled by the user. Progress so far is on the canvas (checkpoints saved).';
        this.log('done', 'Cancelled', this.finalSummary);
      }
      return this.finalSummary ?? '';
    } finally {
      this.isRunning = false;
      this.isPaused = false;
      AgentToolLoop.anyLoopRunning = false;
      this.statusLine = '';
      this.publish();
    }
  }

  private raceWithCancel<T>(promise: Promise<T>): Promise<T> {
    if (this.cancelRequested) return Promise.reject(new AgentLoopCancellationError());
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const onCancel = () => {
        if (settled) return;
        settled = true;
        reject(new AgentLoopCancellationError());
      };
      this.cancelWaiters.push(onCancel);
      promise.then(
        (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        },
        (error: unknown) => {
          if (settled) return;
          settled = true;
          reject(error as Error);
        },
      );
    });
  }

  // MARK: - Tool dispatch

  /**
   * Runs one tool call — the loop's own tools first, then the MCP belt.
   * Returns the text for the tool message plus any screenshot data URLs.
   */
  private async dispatch(
    call: OpenRouterMessageToolCall,
    toolsByName: Map<string, MCPToolDefinition>,
    design: AgentDesignHost,
    hooks: Hooks,
  ): Promise<[string, string[]]> {
    let args: JSONObject;
    if (call.arguments.trim().length === 0) {
      args = {};
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(call.arguments);
      } catch {
        parsed = undefined;
      }
      if (isPlainObject(parsed)) {
        args = parsed as JSONObject;
      } else {
        const msg = `Could not parse the arguments as a JSON object. You sent: ${prefixString(call.arguments, 300)}`;
        this.log('error', call.name, msg);
        return [msg, []];
      }
    }

    // Loop-local tools.
    switch (call.name) {
      case 'ask_user': {
        const question = (typeof args.question === 'string' ? args.question : '').trim();
        if (question.length === 0) {
          return ['ask_user needs a non-empty \'question\'.', []];
        }
        if (this.presetAnswers !== undefined && this.presetAnswers.length > 0) {
          const reply = `The caller already supplied product decisions. Resolve this question from them and do not pause:\n${this.presetAnswers}`;
          this.log('steer', 'Answered from preset decisions', question);
          return [reply, []];
        }
        if (this.askedQuestionCount >= 4) {
          return ['Question budget exhausted (4 per run) — make the professional call yourself and record it in the summary.', []];
        }
        // An interview after the build started is an interrogation.
        if (this.mutatingCallCount !== 0) {
          return ['Too late to ask — the build already started. Proceed with the professional default and note the assumption in your summary.', []];
        }
        this.askedQuestionCount += 1;
        const options = (Array.isArray(args.options) ? args.options : [])
          .filter((option): option is string => typeof option === 'string')
          .filter((option) => option.length > 0);
        this.log('steer', `❓ ${question}`, options.length === 0 ? '(free answer)' : options.join(' | '));
        const reply = await this.awaitAnswer({ id: newUUID(), question, options: options.slice(0, 4) });
        return [`USER ANSWER: ${reply}`, []];
      }

      case 'update_plan':
        return [this.handleUpdatePlan(args), []];
      case 'load_skill': {
        const id = typeof args.id === 'string' ? args.id : '';
        const skill = SkillLibrary.skill(id);
        if (skill) {
          this.log('tool', 'load_skill', skill.title);
          return [skill.instructions, []];
        }
        return [`Unknown skill '${id}'. Available:\n${SkillLibrary.catalogSummary}`, []];
      }
      case 'update_design_memo': {
        const memo = typeof args.memo === 'string' ? args.memo : '';
        design.mutateProject((project) => {
          if (memo.length === 0) delete project.agentMemo;
          else project.agentMemo = memo;
        });
        this.log('tool', 'update_design_memo', `${charCount(memo)} chars`);
        return [`Design memo saved (${charCount(memo)} chars). Future agent runs will read it.`, []];
      }
      case 'show_diff':
        return [this.projectDiff(design), []];
      case 'finish': {
        // The finish-gate (a hook, not a hope): a run that mutated the
        // canvas but wired zero logic flows is a mockup — reject once with
        // instructions. A pure-read or pure-sprite run passes untouched.
        const flowCount = this.meaningfulInteractionFlowCount(design);
        if (this.mutatingCallCount > 0 && flowCount === 0) {
          this.finishGateTripped = true;
          const msg = 'REJECTED: you built UI but wired ZERO logic flows — this is a mockup, not an app. Wire the logic now with apply_logic_actions (navigation, button handlers, state variables), confirm with get_logic_flows, then call finish again.';
          this.log('error', 'finish gate', 'blocked — no logic flows wired yet');
          return [msg, []];
        }
        if (this.mutatingCallCount > 0 && this.minimumReferenceScreens > 1) {
          const screenCount = this.designProjectScreenCount(design);
          if (screenCount < this.minimumReferenceScreens) {
            const msg = `REJECTED: this whole-app goal has only ${screenCount} screen(s). The AppShots reference flows need at least ${this.minimumReferenceScreens} purposeful screens covering entry, discovery, decision, action and feedback. Compose or add the missing journey states, wire them, then verify again.`;
            this.log('error', 'reference flow gate', msg);
            return [msg, []];
          }
          const requiredFlows = Math.max(1, screenCount - 1);
          if (flowCount < requiredFlows) {
            const msg = `REJECTED: only ${flowCount} of at least ${requiredFlows} meaningful interaction flows are wired. A qualifying flow needs a real event on a child control (not the whole screen), a connected action, and a screen owner. Wire the primary journey across the screens, verify it with get_logic_flows and preview_tap, then finish again.`;
            this.log('error', 'reference flow gate', msg);
            return [msg, []];
          }
        }
        if (this.mutatingCallCount > 0 && this.capturedVisualRevision !== this.visualRevision) {
          const msg = 'REJECTED: the latest visual revision has not been inspected. Call get_screenshot now, examine the rendered result, repair anything visibly weak, then call check_design_quality.';
          this.log('error', 'visual inspection gate', msg);
          return [msg, []];
        }
        if (this.mutatingCallCount > 0 && this.minimumReferenceScreens > 1) {
          const screenIds = new Set(
            design.currentPage.nodes.filter((node) => node.type === 'Frame').map((node) => node.id.toUpperCase()),
          );
          const missing = [...screenIds].filter((id) => !this.inspectedScreenIds.has(id));
          if (missing.length > 0) {
            const msg = `REJECTED: only ${screenIds.size - missing.length} of ${screenIds.size} screens were inspected at readable resolution. Call get_screenshot once per missing screenNodeId from get_project_overview, repair any weak screen, then re-run check_design_quality. Missing: ${missing.sort().join(', ')}.`;
            this.log('error', 'per-screen visual gate', msg);
            return [msg, []];
          }
        }
        if (this.mutatingCallCount > 0 && this.quality) {
          const report = this.quality.report(design.currentPage);
          if (!report.passesReferenceBar) {
            const msg = `REJECTED: the design is below the learned AppShots reference bar. Repair every blocker/warning, capture the updated screenshot and re-run check_design_quality.\n\n${this.quality.summary(report, 40)}`;
            this.log('error', 'reference quality gate', `score ${report.score}/100`);
            return [msg, []];
          }
          if (this.qualityCheckedVisualRevision !== this.visualRevision) {
            const msg = 'REJECTED: quality has not been certified for the latest visual revision. Call check_design_quality; finish is allowed only when it reports REFERENCE BAR PASS.';
            this.log('error', 'quality certification gate', msg);
            return [msg, []];
          }
        }
        if (this.requiresBuildVerification && this.mutatingCallCount > 0
          && (!this.typecheckPassed || !this.simulatorRunPassed)) {
          const missing = [
            this.typecheckPassed ? undefined : 'typecheck_generated',
            this.simulatorRunPassed ? undefined : 'run_in_simulator',
          ].filter((name): name is string => name !== undefined).join(' and ');
          const msg = `REJECTED: the app is not verified yet. Run ${missing}, read every diagnostic, repair the generated code/design, then rerun verification. Call show_diff before finish.`;
          this.log('error', 'verification gate', msg);
          return [msg, []];
        }
        const summary = typeof args.summary === 'string' ? args.summary : 'Done.';
        this.finishedViaTool = true;
        this.finalSummary = summary;
        this.log('tool', 'finish', prefixString(summary, 180));
        return ['Finished.', []];
      }
      default:
        break;
    }

    // MCP belt.
    const tool = toolsByName.get(call.name);
    if (!tool) {
      const msg = `Unknown tool '${call.name}'. Use only the provided tools.`;
      this.log('error', call.name, msg);
      return [msg, []];
    }

    const requestedScreenId = typeof args.screenNodeId === 'string' ? args.screenNodeId.toUpperCase() : undefined;
    const repeatsExistingCapture = requestedScreenId !== undefined
      ? this.inspectedScreenIds.has(requestedScreenId)
      : this.capturedFullCanvasRevision === this.visualRevision;
    if (AgentToolLoop.screenshotTools.has(call.name)
      && this.capturedVisualRevision === this.visualRevision
      && repeatsExistingCapture) {
      const msg = 'Screenshot skipped: the visual state has not changed since the last capture. Use the existing observation, or mutate/tap the UI before capturing again.';
      this.log('result', call.name, 'skipped unchanged visual state');
      return [msg, []];
    }

    // JSON-string params (see stringFlattened) become structure again.
    const normalizedArgs = AgentToolLoop.reparsingJSONStrings(args, tool.inputSchema);

    // Degenerate-payload guard: empty/typeless actions never reach the
    // handler — the model gets a concrete example to copy instead of a
    // vague decode error it retries verbatim.
    if (['apply_design_actions', 'apply_logic_actions'].includes(call.name)) {
      const actions = normalizedArgs.actions;
      if (Array.isArray(actions) && actions.length > 0 && actions.every((action) => isPlainObject(action) && action.type === undefined)) {
        const msg = `REJECTED: every action object needs at least a "type" — you sent ${actions.length} without one. Copy this shape (as ONE JSON string in the actions parameter): [{"type":"createFrame","nodeReference":"screen","name":"Home","x":0,"y":0,"width":390,"height":844,"fill":"#0E1E33"},{"type":"createText","parentReference":"screen","text":"Hello","x":24,"y":80,"width":220,"height":34,"fontSize":26,"textColor":"#FFFFFF"},{"type":"createButton","parentReference":"screen","nodeReference":"cta","text":"Start","x":95,"y":700,"width":200,"height":56,"fill":"#3B82F6","cornerRadius":28}] Resend the complete call now with real actions.`;
        this.log('error', call.name, `blocked degenerate payload (${actions.length} typeless action(s))`);
        return [msg, []];
      }
    }

    this.log('tool', call.name, AgentToolLoop.compactArguments(normalizedArgs));
    try {
      const result = await this.mcp!.callTool(call.name, normalizedArgs);
      const textParts: string[] = [];
      const images: string[] = [];
      for (const item of result.content) {
        if (item.type === 'text') textParts.push(item.text);
        else images.push(`data:${item.mimeType};base64,${item.data}`);
      }
      if (images.length > 0) {
        textParts.push(`[${images.length} screenshot(s) attached in the next message — inspect them.]`);
      }
      let text = AgentToolLoop.truncated(textParts.join('\n'));
      if (!result.isError) {
        if (call.name === 'typecheck_generated' && containsCaseInsensitive(text, 'Build OK')) {
          this.typecheckPassed = true;
        }
        if (call.name === 'run_in_simulator' && containsCaseInsensitive(text, 'Running on')) {
          this.simulatorRunPassed = true;
        }
      }
      if (Hooks.mutatingTools.has(call.name) && !result.isError) {
        this.mutatingCallCount += 1;
      }
      if (AgentToolLoop.visualMutationTools.has(call.name) && !result.isError) {
        this.visualRevision += 1;
        this.qualityCheckedVisualRevision = undefined;
        this.capturedFullCanvasRevision = undefined;
        this.inspectedScreenIds = new Set();
      }
      if (AgentToolLoop.screenshotTools.has(call.name) && !result.isError && images.length > 0) {
        this.capturedVisualRevision = this.visualRevision;
        if (call.name === 'get_screenshot' && requestedScreenId !== undefined) {
          this.inspectedScreenIds.add(requestedScreenId);
        } else {
          this.capturedFullCanvasRevision = this.visualRevision;
        }
      }
      if (call.name === 'check_design_quality' && !result.isError
        && containsCaseInsensitive(text, 'REFERENCE BAR PASS')) {
        this.qualityCheckedVisualRevision = this.visualRevision;
      }
      const note = hooks.afterTool(call.name);
      if (note !== undefined) text += `\n${note}`;
      this.log(result.isError ? 'error' : 'result', call.name, prefixString(text, 220));
      return [text.length === 0 ? '(empty result)' : text, images];
    } catch (error) {
      const msg = `Tool error: ${(error as Error)?.message ?? String(error)}`;
      this.log('error', call.name, msg);
      return [msg, []];
    }
  }

  private projectDiff(design: AgentDesignHost): string {
    const before = this.baselineProject;
    const beforeScreens = before?.pages.flatMap((page) => page.nodes.filter((node) => node.type === 'Frame')).length ?? 0;
    const afterScreens = this.designProjectScreenCount(design);
    const beforeNodes = before?.pages.flatMap((page) => page.nodes).length ?? 0;
    const afterNodes = this.designProjectNodeCount(design);
    const beforeFlows = before?.pages.flatMap((page) => page.logicFlows).length ?? 0;
    const afterFlows = design.project.pages.flatMap((page) => page.logicFlows).length;
    return `DIFF FROM RUN START
Screens: ${beforeScreens} → ${afterScreens} (Δ ${afterScreens - beforeScreens})
Root nodes: ${beforeNodes} → ${afterNodes} (Δ ${afterNodes - beforeNodes})
Logic flows: ${beforeFlows} → ${afterFlows} (Δ ${afterFlows - beforeFlows})
Verification: typecheck=${this.typecheckPassed ? 'PASS' : 'PENDING'}, simulator=${this.simulatorRunPassed ? 'PASS' : 'PENDING'}`;
  }

  private designProjectScreenCount(design: AgentDesignHost): number {
    return design.project.pages.flatMap((page) => page.nodes.filter((node) => node.type === 'Frame')).length;
  }

  private designProjectNodeCount(design: AgentDesignHost): number {
    return design.project.pages.flatMap((page) => page.nodes).length;
  }

  private handleUpdatePlan(args: JSONObject): string {
    const rawItems = args.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      return 'update_plan needs items: [{title, status}] with status pending|doing|done.';
    }
    this.plan = rawItems.map((raw, index) => ({
      id: index,
      title: isPlainObject(raw) && typeof raw.title === 'string' ? raw.title : `Step ${index + 1}`,
      status: isPlainObject(raw) && typeof raw.status === 'string' ? raw.status : 'pending',
    }));
    const doneCount = this.plan.filter((item) => item.status === 'done').length;
    this.log('tool', 'update_plan', `${doneCount}/${this.plan.length} done`);
    return `Plan updated: ${this.plan.length} step(s), ${doneCount} done.`;
  }

  // MARK: - Prompts

  private systemPrompt(goal: string, design: AgentDesignHost): string {
    const memo = design.project.agentMemo?.trim();
    const matchedSkills = SkillLibrary.matching(goal);
    const skillSection = matchedSkills.length === 0
      ? '(none auto-loaded — pull one with load_skill if a playbook fits)'
      : matchedSkills.map((skill) => skill.instructions).join('\n\n');

    return `You are the AgenticDesigner agent: you operate a visual app-design tool through TOOLS, in a loop — call tools, read their results, and decide the next move. You build real, working apps: designed screens, wired logic, generated imagery, playable games.

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
- NO OFF-THE-SHELF APP TEMPLATES. You tailor every screen and author every game spec to this request. compose_reference_app is the preferred deterministic design SYSTEM, not a template: you still decide the product flow, components and copy. For create_game_scene always pass a full custom \`spec\`.
- Phone screens are root frames ~390x844; multiple screens sit side by side (x spaced ~450). Your x/y land exactly as sent.
- If a tool errors, read the message, fix your input, and try a different way — at most 2 retries per problem, then adapt the plan.
- Record durable design decisions (palette, typography, structure, tone) with update_design_memo — future runs build on it instead of re-deriving.
- Game goals: generate_sprite for the art, then a custom create_game_scene spec using those sprite paths; wrap the game with real screens (menu, game over) wired by logic flows.
- Stay inside the provided tools; never invent tool names or parameters.

${AppShotsDesignKnowledge.agentLoopGuide(goal)}

PROJECT MEMO (decisions from past runs — honor them):
${memo !== undefined && memo.length > 0 ? memo : '(none yet)'}

SKILL CATALOG (load with load_skill):
${SkillLibrary.catalogSummary}

ACTIVE PLAYBOOKS:
${skillSection}`;
  }

  /** Seeds the loop with the project state so step 1 isn't spent asking. */
  private async firstUserMessage(goal: string, toolsByName: Map<string, MCPToolDefinition>): Promise<string> {
    let overview = '';
    if (toolsByName.has('get_project_overview')) {
      try {
        const result = await this.mcp!.callTool('get_project_overview', {});
        overview = AgentToolLoop.truncated(
          result.content
            .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
            .map((item) => item.text)
            .join('\n'),
        );
      } catch {
        /* `try?` in Swift */
      }
    }
    // Preset answers count as part of the brief: a decision the caller
    // already collected must neither be re-asked nor re-decided.
    const effectiveBrief = [goal, this.presetAnswers].filter((part): part is string => part !== undefined).join('\n');
    const intake = BriefIntake.promptSection(effectiveBrief, this.design?.project);
    const decisions = this.presetAnswers !== undefined
      ? `\nPRODUCT DECISIONS (already answered — honor them, never re-ask):\n${this.presetAnswers}\n`
      : '';
    return `GOAL: ${goal}
${decisions}
${intake}

CURRENT PROJECT STATE:
${overview.length === 0 ? '(empty project)' : overview}`;
  }

  // MARK: - Tool belt definition

  /**
   * The currently "doing" plan item selects a small, purpose-built tool
   * belt. This avoids resending every schema on every turn while still
   * giving the model an explicit transition tool into the next phase.
   */
  private toolPhase(goal: string): ToolPhase {
    const activeWork = (this.plan.find((item) => item.status === 'doing')?.title ?? goal).toLowerCase();

    if (AgentToolLoop.containsAny(activeWork, ['verify', 'typecheck', 'simulator', 'readiness', 'export', 'build check'])) {
      return 'verify';
    }
    if (AgentToolLoop.containsAny(activeWork, ['design', 'screen', 'canvas', 'layout', 'visual', 'style', 'theme', 'ui', 'sprite', 'game scene'])) {
      return 'design';
    }
    if (AgentToolLoop.containsAny(activeWork, ['logic', 'wire', 'navigation', 'interaction', 'state', 'flow', 'preview', 'tap'])) {
      return 'logic';
    }
    if (activeWork.includes('test')) {
      return 'verify';
    }
    return 'design';
  }

  static toolNames(phase: ToolPhase, goal: string): Set<string> {
    const lowerGoal = goal.toLowerCase();
    switch (phase) {
      case 'design':
        if (AgentToolLoop.containsAny(lowerGoal, ['game', 'sprite', 'platformer', 'runner', 'flappy'])) {
          return new Set([
            'get_project_overview', 'get_design_tree', 'get_screenshot',
            'generate_sprite', 'create_game_scene', 'get_game_scene',
            'update_game_scene', 'apply_logic_actions',
          ]);
        }
        return new Set([
          'get_project_overview', 'get_design_tree', 'get_screenshot',
          'compose_reference_app', 'apply_design_actions', 'apply_canvas_studio_edits',
          'set_brand', 'apply_theme', 'apply_logic_actions',
          'check_design_quality',
        ]);

      case 'logic':
        return new Set([
          'get_design_tree', 'apply_logic_actions', 'get_logic_flows',
          'wire_interactions', 'wire_backend', 'preview_app', 'preview_tap',
          'preview_type', 'preview_choose_branch',
          'preview_screenshot', 'check_export_readiness',
        ]);

      case 'verify': {
        // preview_type/preview_choose_branch let the loop walk ITS OWN
        // signup: fill the form, submit, take the success branch, and see
        // the app land on Home.
        const tools = new Set([
          'check_design_quality', 'check_export_readiness', 'typecheck_generated', 'run_in_simulator',
          'simulator_screenshot', 'get_project_overview', 'get_design_tree', 'get_screenshot',
          'compose_reference_app', 'apply_design_actions', 'apply_canvas_studio_edits',
          'set_brand', 'apply_theme',
          'apply_logic_actions', 'get_logic_flows',
          'preview_app', 'preview_tap', 'preview_type', 'preview_choose_branch', 'preview_screenshot',
        ]);
        if (AgentToolLoop.containsAny(lowerGoal, ['export', 'xcode project', 'ship'])) {
          tools.delete('get_design_tree');
          tools.add('export_xcode_project');
        }
        return tools;
      }
    }
  }

  private static containsAny(text: string, needles: string[]): boolean {
    return needles.some((needle) => text.includes(needle));
  }

  /**
   * The curated slice of the MCP registry the inside agent may use — the
   * design/logic/preview/game surface. Deliberately excludes: pdf_* (other
   * product), checkpoints (hooks own those), the recursive entry points
   * (run_design_agent, build_full_app, run_agent_loop), and ALL template
   * tools — the inside agent authors every screen and game spec itself.
   */
  static readonly toolAllowlist: ReadonlySet<string> = new Set([
    'get_project_overview', 'get_design_tree', 'get_screenshot',
    'compose_reference_app', 'apply_design_actions', 'get_canvas_studio_capabilities', 'apply_canvas_studio_edits',
    'wire_interactions', 'set_brand', 'apply_theme',
    'apply_logic_actions', 'get_logic_flows', 'wire_backend',
    'preview_app', 'preview_tap', 'preview_type', 'preview_choose_branch', 'preview_screenshot',
    'check_design_quality', 'check_export_readiness', 'assert_ready', 'typecheck_generated', 'run_in_simulator', 'simulator_screenshot', 'simulator_tap', 'export_xcode_project', 'get_generated_code', 'select_page',
    'generate_sprite', 'create_game_scene',
    'get_game_scene', 'update_game_scene',
  ]);

  static readonly screenshotTools: ReadonlySet<string> = new Set([
    'get_screenshot', 'preview_screenshot', 'simulator_screenshot',
  ]);

  static readonly visualMutationTools: ReadonlySet<string> = new Set([
    'compose_reference_app', 'apply_design_actions', 'apply_canvas_studio_edits', 'set_brand', 'apply_theme',
    'create_game_scene', 'update_game_scene',
  ]);

  /**
   * The workhorse tools keep their FULL descriptions — truncating them cuts
   * exactly the field docs and examples a local model needs to author valid
   * payloads.
   */
  static readonly fullDescriptionTools: ReadonlySet<string> = new Set([
    'compose_reference_app', 'apply_design_actions', 'apply_logic_actions', 'check_design_quality', 'create_game_scene', 'update_game_scene', 'export_xcode_project', 'run_in_simulator', 'typecheck_generated',
  ]);

  static schema(tool: MCPToolDefinition): JSONObject {
    const cap = AgentToolLoop.fullDescriptionTools.has(tool.name) ? 3000 : 700;
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: prefixString(tool.description, cap),
        parameters: AgentToolLoop.stringFlattened(tool.inputSchema) as JSONValue,
      },
    };
  }

  /**
   * Local models emit structured nested arrays-of-objects unreliably, but
   * write the same payload fine as a JSON STRING. The belt advertises deep
   * params as strings; dispatch re-parses them.
   */
  static stringFlattened(schema: JSONObject): JSONObject {
    const result: JSONObject = { ...schema };
    const props = result.properties;
    if (!isPlainObject(props)) return result;
    const nextProps: Record<string, JSONValue> = { ...(props as Record<string, JSONValue>) };
    for (const [key, raw] of Object.entries(props)) {
      if (!isPlainObject(raw)) continue;
      const type = raw.type;
      if (type !== 'array' && type !== 'object') continue;
      const description = typeof raw.description === 'string' ? raw.description : '';
      nextProps[key] = {
        type: 'string',
        description: `${description} — PROVIDE AS ONE JSON STRING (a JSON-encoded ${type}).`,
      };
    }
    result.properties = nextProps;
    return result;
  }

  /**
   * Undo the flattening on the way in: any string arg whose original schema
   * expects an array/object is parsed back to structure.
   */
  static reparsingJSONStrings(args: JSONObject, original: JSONObject): JSONObject {
    const props = original.properties;
    if (!isPlainObject(props)) return args;
    const out: JSONObject = { ...args };
    for (const [key, value] of Object.entries(args)) {
      if (typeof value !== 'string') continue;
      const prop = (props as Record<string, unknown>)[key];
      if (!isPlainObject(prop)) continue;
      const type = prop.type;
      if (type !== 'array' && type !== 'object') continue;
      try {
        out[key] = JSON.parse(value) as JSONValue;
      } catch {
        /* leave the string as-is, exactly like Swift's `try?` */
      }
    }
    return out;
  }

  static readonly localToolSchemas: JSONObject[] = [
    {
      type: 'function',
      function: {
        name: 'ask_user',
        description: 'Ask the user ONE clarifying question and wait for the answer. Use ONLY before the build starts (it is rejected after the first mutating call), only for product-shaping decisions the brief leaves open (see BRIEF ANALYSIS in your first message), and at most 4 per run. Always pass 2-4 options with your RECOMMENDED one first — if the user doesn\'t answer in time, that first option is returned. Never ask about spacing, copy, component choice, or anything the brief already states.',
        parameters: {
          type: 'object',
          properties: {
            question: { type: 'string', description: 'One specific question, in the user\'s language.' },
            options: {
              type: 'array',
              items: { type: 'string' },
              description: '2-4 answer choices, recommended first. The user can also type a free answer.',
            },
          },
          required: ['question'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_plan',
        description: 'Create or update your working plan (shown live to the user). Call this FIRST with 3-6 steps, then keep statuses current: exactly one step \'doing\', mark verified steps \'done\'.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'doing', 'done'] },
                },
                required: ['title', 'status'],
              },
            },
          },
          required: ['items'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'load_skill',
        description: 'Load a playbook from the skill catalog by id (see the catalog in your system prompt).',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'update_design_memo',
        description: 'Persist durable design decisions for this project (palette, typography, structure, tone). Replaces the whole memo — include everything still true. Future agent runs read it.',
        parameters: {
          type: 'object',
          properties: { memo: { type: 'string' } },
          required: ['memo'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'show_diff',
        description: 'Show a concise human-readable diff from the project state at the start of this run: screens, nodes, logic flows, and verification status. Call immediately before finish.',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'finish',
        description: 'End the run. Call only after verification. summary = what you built AND what you verified (screenshots looked at, flows tapped through, readiness checked).',
        parameters: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
      },
    },
  ];

  // MARK: - Small helpers

  private recordUsage(usage: AgentToolUsage | undefined): void {
    if (!usage) return;
    this.runPromptTokens += usage.promptTokens;
    this.runCompletionTokens += usage.completionTokens;

    if (usage.costUSD !== undefined && usage.costUSD > 0) {
      this.runCostUSD += usage.costUSD;
    }

    const costText = usage.costUSD !== undefined ? `$${usage.costUSD.toFixed(4)}` : 'cost unavailable';
    this.log(
      'info',
      'Turn usage',
      `${usage.promptTokens} input · ${usage.completionTokens} output · ${costText} · run $${this.runCostUSD.toFixed(4)}`,
    );

    if (!(this.runCostUSD + 0.000_000_1 >= this.nextCostApprovalThresholdUSD)) return;
    this.costApprovalRequired = true;
    this.isPaused = true;
    this.log(
      'steer',
      'Cost approval required',
      `Run reached $${this.runCostUSD.toFixed(3)}. Press play to approve the next $${this.costApprovalIncrementUSD.toFixed(2)} band, or stop.`,
    );
  }

  /**
   * Live logic-flow count: the logic view model when attached (source of
   * truth while editing), else the flows persisted on the pages.
   */
  private currentFlowCount(design: AgentDesignHost): number {
    const live = this.logic?.flows.length ?? 0;
    if (live > 0) return live;
    return design.project.pages.reduce((total, page) => total + page.logicFlows.length, 0);
  }

  /**
   * Counts flows that represent actual user interactions rather than empty
   * default flows or an On Tap attached to the entire 390×844 screen.
   */
  private meaningfulInteractionFlowCount(design: AgentDesignHost): number {
    const liveFlows = this.logic?.flows ?? [];
    const flows = liveFlows.length === 0 ? design.project.pages.flatMap((page) => page.logicFlows) : liveFlows;
    return flows.filter((flow) => {
      const screenId = flow.screenNodeId;
      if (screenId === undefined || flow.blocks.length < 2 || flow.connections.length === 0) return false;
      return flow.blocks.some((block) => {
        if (block.category !== 'Events') return false;
        return block.parameters.some((parameter) =>
          parameter.nodeReference === undefined ? false : parameter.nodeReference !== screenId);
      });
    }).length;
  }

  private setStatusLine(line: string): void {
    this.statusLine = line;
    this.publish();
  }

  private log(kind: TranscriptEntryKind, title: string, detail: string): void {
    this.transcript.push({ id: newUUID(), kind, title, detail });
    if (this.transcript.length > 240) this.transcript.splice(0, this.transcript.length - 240);
    // Mirror everything to the host log (Swift: os.Logger + print).
    const line = `[loop:${kind}] ${title}${detail.length === 0 ? '' : ` — ${detail}`}`;
    const logger = getPlatform().logger;
    if (kind === 'error') logger.error(line);
    else logger.info(line);
    this.publish();
  }

  private static compactArguments(args: JSONObject): string {
    if (Object.keys(args).length === 0) return '';
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(args);
    } catch {
      serialized = undefined;
    }
    if (serialized === undefined) return '';
    return prefixString(serialized, 220);
  }

  /** Bounds a tool result for the conversation: head + tail, with a marker. */
  static truncated(text: string, limit = 6000): string {
    if (charCount(text) <= limit) return text;
    const head = prefixString(text, 4200);
    const tail = suffixString(text, 1400);
    return `${head}\n… [truncated ${charCount(text) - 5600} chars — ask for a narrower slice if you need the middle] …\n${tail}`;
  }

  /**
   * How large the conversation may get before it is compacted. Once
   * OpenRouter has told us this account's hard prompt ceiling we stay well
   * under it; otherwise a conservative default.
   */
  static promptTokenBudget(): number {
    const ceiling = OpenRouterProvider.learnedPromptTokenCeiling;
    if (ceiling === undefined) return 12_000;
    return Math.max(2_000, Math.trunc(ceiling * 0.55));
  }

  /**
   * Rough token estimate (≈4 chars/token, plus a flat cost per image) used
   * to decide WHEN compaction is worth breaking the cacheable prefix for.
   */
  static approximateTokenCount(messages: OpenRouterMessage[]): number {
    return messages.reduce(
      (total, message) => total + Math.trunc(charCount(message.content) / 4) + ((message.imageDataURLs ?? []).length === 0 ? 0 : 900),
      0,
    );
  }

  /**
   * The few tools a run cannot proceed without. Used only when the prompt
   * ceiling is so low that the schemas themselves don't fit.
   */
  static readonly essentialToolNames: ReadonlySet<string> = new Set([
    'get_project_overview', 'get_design_tree', 'compose_reference_app', 'apply_design_actions',
    'apply_logic_actions', 'get_screenshot', 'check_design_quality',
  ]);

  /**
   * Context management for the per-turn request. Keeps the system prompt,
   * goal, and two newest tool turns at full fidelity. Everything older is
   * replaced by a short outcome summary.
   */
  static trimmedForContext(
    messages: OpenRouterMessage[],
    options: {
      keepRecentToolTurns?: number;
      includeLatestImage?: boolean;
      compactHistory?: boolean;
      toolResultCharLimit?: number;
    } = {},
  ): OpenRouterMessage[] {
    const keepRecentToolTurns = options.keepRecentToolTurns ?? 2;
    const includeLatestImage = options.includeLatestImage ?? true;
    const compactHistory = options.compactHistory ?? true;
    const toolResultCharLimit = options.toolResultCharLimit ?? 5_600;

    const working = messages.map((message) => ({ ...message }));

    // Under pressure the RETAINED turns are the problem: one raw
    // get_design_tree result can be bigger than the whole budget.
    if (toolResultCharLimit < 5_600) {
      for (let i = 0; i < working.length; i++) {
        const message = working[i]!;
        if (message.role !== 'tool') continue;
        if (charCount(message.content) <= toolResultCharLimit) continue;
        working[i] = makeOpenRouterMessage(
          message.role,
          `${prefixString(message.content, toolResultCharLimit)}\n… [truncated to fit this account's prompt limit — re-query for a narrower slice]`,
          {
            ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
            ...(message.toolCalls !== undefined ? { toolCalls: message.toolCalls } : {}),
          },
        );
      }
    }

    // A new screenshot is delivered once. Later turns receive a tiny note
    // and can explicitly capture again after another visual mutation.
    let retainedImageIndex = -1;
    if (includeLatestImage) {
      for (let i = working.length - 1; i >= 0; i--) {
        if ((working[i]!.imageDataURLs ?? []).length > 0) { retainedImageIndex = i; break; }
      }
    }
    for (let i = 0; i < working.length; i++) {
      const message = working[i]!;
      if ((message.imageDataURLs ?? []).length === 0) continue;
      if (i === retainedImageIndex) continue;
      working[i] = makeOpenRouterMessage(
        message.role,
        `${message.content} (screenshot omitted from this turn — capture again only after a visual change)`,
        {
          ...(message.toolCallId !== undefined ? { toolCallId: message.toolCallId } : {}),
          ...(message.toolCalls !== undefined ? { toolCalls: message.toolCalls } : {}),
        },
      );
    }

    // Images are handled above regardless; the summarising pass below only
    // runs once the transcript is big enough to be worth the cache break.
    if (!compactHistory) return working;

    const toolTurnStarts: number[] = [];
    for (let i = 0; i < working.length; i++) {
      const message = working[i]!;
      if (message.role === 'assistant' && (message.toolCalls ?? []).length > 0) toolTurnStarts.push(i);
    }
    let tailStart: number;
    if (toolTurnStarts.length > keepRecentToolTurns) {
      tailStart = toolTurnStarts[toolTurnStarts.length - keepRecentToolTurns]!;
    } else if (working.length > 10) {
      tailStart = Math.max(2, working.length - 6);
    } else {
      return working;
    }

    // Never start the retained tail in the middle of an assistant
    // tool-call ↔ tool-result group; providers reject orphan tool messages.
    while (tailStart > 2) {
      const message = working[tailStart]!;
      if (message.role === 'tool'
        || (message.role === 'user' && containsCaseInsensitive(message.content, 'screenshot returned'))) {
        tailStart -= 1;
        continue;
      }
      break;
    }
    if (!(tailStart > 2)) return working;

    const olderMessages = working.slice(2, tailStart);
    const toolNamesById = new Map<string, string>();
    for (const message of olderMessages) {
      for (const call of message.toolCalls ?? []) toolNamesById.set(call.id, call.name);
    }

    const summaryLines: string[] = [];
    for (const message of olderMessages) {
      const calls = message.toolCalls ?? [];
      if (calls.length > 0) {
        summaryLines.push(`Agent called: ${calls.map((call) => call.name).join(', ')}`);
        continue;
      }

      const compact = compactHistoryText(message.content, 220);
      if (compact.length === 0) continue;
      if (message.role === 'tool') {
        const name = (message.toolCallId !== undefined ? toolNamesById.get(message.toolCallId) : undefined) ?? 'tool';
        summaryLines.push(`${name}: ${compact}`);
      } else if (message.role === 'assistant') {
        summaryLines.push(`Agent: ${compact}`);
      } else if (message.role === 'user' && containsCaseInsensitive(compact, 'screenshot returned')) {
        summaryLines.push('Screenshot was inspected; image bytes were discarded.');
      } else {
        summaryLines.push(`${capitalized(message.role)}: ${compact}`);
      }
    }

    let summary = summaryLines.join('\n');
    const summaryLimit = 2_400;
    if (charCount(summary) > summaryLimit) {
      summary = '… earlier details dropped; current project state can be re-read with a tool …\n'
        + suffixString(summary, summaryLimit);
    }
    const summaryMessage = makeOpenRouterMessage(
      'user',
      `EARLIER RUN SUMMARY (tool arguments and image bytes intentionally discarded):
${summary.length === 0 ? 'No durable earlier outcome.' : summary}`,
    );

    return [...working.slice(0, 2), summaryMessage, ...working.slice(tailStart)];
  }
}

function compactHistoryText(text: string, limit: number): string {
  const oneLine = text
    .replaceAll('\n', ' ')
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .join(' ');
  if (charCount(oneLine) <= limit) return oneLine;
  return `${prefixString(oneLine, limit)}…`;
}

/** Swift's `String.capitalized` for a single lowercase role word. */
function capitalized(text: string): string {
  return text.length === 0 ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** `UserDefaults.standard.object(forKey: "agentLoopCostApprovalUSD") as? Double` */
function storedCostApprovalIncrement(): number | undefined {
  const storage = getPlatform().storage;
  const raw = storage.get('agentLoopCostApprovalUSD');
  if (raw === null) return undefined;
  const value = typeof raw === 'string' ? Number(raw) : Number(storageGetJSON<number>(storage, 'agentLoopCostApprovalUSD', Number.NaN));
  return Number.isFinite(value) ? value : undefined;
}

/** Re-exported so hosts can type a page without importing models directly. */
export type { DesignPage };
