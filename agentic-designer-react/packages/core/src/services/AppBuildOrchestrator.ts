// Ported 1:1 from AgenticDesigner/Services/AppBuildOrchestrator.swift
//
// One prompt → a working app. Chains the two agent paths that previously
// required separate manual runs — the design pipeline (screens, components,
// images, critic) and the logic agent (flows, navigation, variables) — then
// opens the interactive in-app preview. A checkpoint is saved before any
// action so the whole build is one-click reversible.

import { ComponentFactory } from '../designIntelligence/ComponentFactory';
import type { LogicViewModel } from '../viewModels/LogicViewModel';
import { getPlatform } from '../platform/platform';
import type { FileSystem } from '../platform/FileSystem';
import { promptOptsOut } from './BackendBlueprint';
import { wire as wireBackend, type BackendWiringResult } from './BackendWiringGenerator';
import { save as saveCheckpoint, load as loadCheckpoint, type ProjectCheckpoint } from './CheckpointStore';
import { ComposedAppGenerator } from './ComposedAppGenerator';
import { ComposedLogicGenerator } from './ComposedLogicGenerator';
import type {
  AgentProviderFactory,
  DetailedDesignPipeline,
  GitSyncHook,
  OrchestratorDesignHost,
} from './themeHosts';

export interface BuildSummary {
  designActionCount: number;
  generatedImageCount: number;
  flowCount: number;
  enabledAppleWatch: boolean;
  screens: string[];
  checkpoint?: ProjectCheckpoint;
  /** What the backend pass added: accounts + persistence. */
  backend?: BackendWiringResult;
}

export function makeBuildSummary(): BuildSummary {
  return {
    designActionCount: 0,
    generatedImageCount: 0,
    flowCount: 0,
    enabledAppleWatch: false,
    screens: [],
  };
}

/** `AppBuildOrchestrator.Stage` — raw values are the progress labels. */
export const Stage = {
  checkpoint: 'Saving checkpoint',
  designing: 'Designing screens',
  imaging: 'Generating images',
  wiring: 'Wiring logic',
  backend: 'Connecting backend',
  previewing: 'Opening preview',
} as const;
export type StageCase = keyof typeof Stage;
export type Stage = (typeof Stage)[StageCase];
export const AllStage = [
  'Saving checkpoint', 'Designing screens', 'Generating images',
  'Wiring logic', 'Connecting backend', 'Opening preview',
] as const satisfies readonly Stage[];

/**
 * `AppBuildOrchestrator.BackendChoice` — which backend a build should wire
 * up. Firebase by default: "build me a habit tracker" means an app you can
 * sign into and whose data survives reinstalling, and no prompt should have
 * to spell that out.
 */
export const AllBackendChoice = ['firebase', 'none'] as const;
export type BackendChoice = (typeof AllBackendChoice)[number];

/**
 * `AppBuildOrchestrator.GenerationMode`
 * - composed: the model decides screens/components/copy; the component
 *   factory renders them — fast, polished, reliable even on small local models.
 * - detailed: the classic free-form pipeline (raw nodes, AI images, critic) —
 *   more creative freedom, needs a strong model.
 */
export const AllGenerationMode = ['composed', 'detailed'] as const;
export type GenerationMode = (typeof AllGenerationMode)[number];

export interface BuildAppOptions {
  prompt: string;
  mode?: GenerationMode;
  /**
   * Switches the agent model for this and future runs (same effect as
   * picking it in the Agent panel) — pass a "local/…" id to build fully
   * on-device.
   */
  modelOverride?: string;
  backend?: BackendChoice;
  onStage?: (stage: Stage) => void;
}

export interface AppBuildOrchestratorDeps {
  /** `DesignAgentService.Settings.current()` + `OpenRouterProvider(...)`. */
  settings: AgentProviderFactory;
  /** `DesignAgentService(viewModel:pipeline:).runFullPipeline(prompt:)`. */
  detailedPipeline: DetailedDesignPipeline;
  git?: GitSyncHook;
  fs?: FileSystem;
}

export class AppBuildOrchestrator {
  readonly design: OrchestratorDesignHost;
  readonly logic: LogicViewModel;
  private readonly deps: AppBuildOrchestratorDeps;

  constructor(design: OrchestratorDesignHost, logic: LogicViewModel, deps: AppBuildOrchestratorDeps) {
    this.design = design;
    this.logic = logic;
    this.deps = deps;
  }

  /**
   * `AppBuildOrchestrator.stripPlatformTag(_:)` — removes a fake platform tag
   * the model bakes into a screen name ("Live Run — Apple Watch" → "Live Run"),
   * which otherwise reads as a watch app that isn't one.
   */
  static stripPlatformTag(name: string): string {
    for (const separator of [' — ', ' – ', ' - ']) {
      const index = name.lastIndexOf(separator);
      if (index >= 0) {
        const tail = name.slice(index + separator.length).trim().toLowerCase();
        if (['iphone', 'ipad', 'apple watch', 'applewatch', 'watchos', 'watch', 'phone'].includes(tail)) {
          return name.slice(0, index).trim();
        }
      }
    }
    return name;
  }

  /** The Lovable loop: prompt in, interactive app out. */
  async buildApp(options: BuildAppOptions): Promise<BuildSummary> {
    const { prompt, modelOverride, backend, onStage } = options;
    const storage = getPlatform().storage;
    if (modelOverride !== undefined && modelOverride.length > 0) {
      storage.set('openRouterModel', modelOverride);
      storage.set('openRouterGenerationModel', '');
    }

    // Fail FAST with a clear, actionable message when a cloud model is
    // selected but no real key is set — a real OpenRouter key is long
    // (sk-or-v1-…); the "z" placeholder and empty are both rejected with a
    // cryptic 401 downstream. Catch it here instead.
    const preflight = this.deps.settings.current();
    if (!preflight.model.startsWith('local/') && (preflight.resolvedAPIKey()?.length ?? 0) < 20) {
      // `AIProviderError.needsCloudKey(model:)`
      throw new Error(
        `“${preflight.model}” is a cloud model and needs a valid OpenRouter API key — paste one in the key field, or pick a local model (Gemma / Qwen) which runs on-device with no key.`,
      );
    }

    // A capable cloud model DESIGNS best in the free-form pipeline, where it
    // lays out screens itself (colours, hierarchy, layout) — the same agency
    // it has over MCP. The composed path only lets it pick components from a
    // fixed factory, so a strong model's design talent is wasted and every
    // app looks like the same wireframe. Auto-route strong models to detailed.
    let mode: GenerationMode = options.mode ?? 'composed';
    if (
      mode === 'composed' &&
      !preflight.model.startsWith('local/') &&
      !preflight.model.includes(':free') &&
      preflight.model !== 'openrouter/free'
    ) {
      mode = 'detailed';
    }

    const summary = makeBuildSummary();

    onStage?.(Stage.checkpoint);
    const checkpointOptions: { fs?: FileSystem; git?: GitSyncHook } = {};
    if (this.deps.fs !== undefined) checkpointOptions.fs = this.deps.fs;
    if (this.deps.git !== undefined) checkpointOptions.git = this.deps.git;
    summary.checkpoint = await saveCheckpoint(
      this.design.project,
      `before: ${[...prompt].slice(0, 40).join('')}`,
      checkpointOptions,
    );

    // Stage 1 — design.
    onStage?.(Stage.designing);
    if (mode === 'composed') {
      const settings = this.deps.settings.current();
      const apiKey = settings.resolvedAPIKey();
      if (apiKey === undefined) throw new Error('Missing OpenRouter API key.'); // AIProviderError.missingAPIKey
      const provider = this.deps.settings.makeProvider(apiKey, settings.model, 0.6);
      // The generator clears the page itself, but only AFTER it has a
      // valid result — clearing here meant a failed generation (e.g. the
      // local model returning no screens) left the user with a blank
      // project and no error-free way back.
      const composed = await ComposedAppGenerator.generate(prompt, provider, this.design);
      summary.designActionCount = composed.actionCount;
      // Fill the composed app's image slots with real AI images — the
      // local FLUX bridge on :7860 if it's running, otherwise the cloud
      // image model. Degrades cleanly to placeholders when neither is
      // reachable, so a build never fails for lack of an image backend.
      onStage?.(Stage.imaging);
      summary.generatedImageCount = await ComposedAppGenerator.fillImages(prompt, this.design, provider);
    } else {
      const designSummary = await this.deps.detailedPipeline.runFullPipeline(prompt);
      summary.designActionCount = designSummary.appliedActionCount;
    }

    // Apple Watch handling, run AFTER generation and driven by CODE (not by
    // the model), so it works for ANY AI. Watch intent is detected two ways:
    // from the prompt, OR from a screen the model NAMED "…watch…" (models
    // routinely fake a watch by naming a phone screen "Live Run — Apple
    // Watch" instead of building one). We then strip the fake platform tag
    // the model bakes into names and add a REAL watch-sized runner screen.
    const page = this.design.currentPageIndex;
    const promptWatch = ['watch', 'wearable', 'watchos'].some((k) => prompt.toLowerCase().includes(k));
    const nameWatch = (this.design.project.pages[page]?.nodes ?? []).some(
      (n) => n.type === 'Frame' && n.name.toLowerCase().includes('watch'),
    );
    this.design.mutateProject((project) => {
      const nodes = project.pages[page]?.nodes ?? [];
      for (const node of nodes) {
        if (node.type === 'Frame') node.name = AppBuildOrchestrator.stripPlatformTag(node.name);
      }
    });
    if (promptWatch || nameWatch) {
      this.design.mutateProject((project) => {
        if (!project.platformSettings.enabledPlatforms.includes('appleWatch')) {
          project.platformSettings.enabledPlatforms.push('appleWatch');
        }
      });
      summary.enabledAppleWatch = true;
      const frames = (this.design.project.pages[page]?.nodes ?? []).filter((n) => n.type === 'Frame');
      if (!frames.some((f) => f.name === 'Watch Runner')) {
        const watch = ComponentFactory.watchRunnerScreen();
        watch.x = 100 + frames.length * 450;
        watch.y = 100;
        this.design.mutateProject((project) => {
          project.pages[page]?.nodes.push(watch);
        });
      }
    }

    // Stage 2 — wire interactions. Composed wiring auto-wires tab bars
    // and back buttons deterministically (never fails), then lets the
    // model add semantic interactions. The old free-form logic agent
    // routinely returned EMPTY flows on small models, shipping apps that
    // looked generated but weren't clickable.
    onStage?.(Stage.wiring);
    const settings = this.deps.settings.current();
    const logicKey = settings.resolvedAPIKey();
    const logicProvider =
      logicKey === undefined ? undefined : this.deps.settings.makeProvider(logicKey, settings.model, 0.3);
    const wiring = await ComposedLogicGenerator.generate(prompt, logicProvider, this.design, this.logic);
    summary.flowCount = wiring.flowCount;

    // Stage 2.5 — accounts and real persistence. Deterministic and last,
    // so it can see the finished design: it only creates a Log In / Sign
    // Up screen the model didn't draw, and wires whatever CTAs exist. An
    // explicit "no login / local only" in the brief opts out.
    const resolvedBackend: BackendChoice = backend ?? (promptOptsOut(prompt) ? 'none' : 'firebase');
    if (resolvedBackend === 'firebase') {
      onStage?.(Stage.backend);
      const result = wireBackend(prompt, this.design, this.logic);
      summary.backend = result;
      summary.flowCount += result.flowNames.length;
    }

    summary.screens = this.logic.designScreens.map((s) => s.name);

    // Stage 3 — show it running.
    onStage?.(Stage.previewing);
    this.logic.showAppPreview = true;
    return summary;
  }

  // MARK: - Checkpoint restore

  /**
   * `AppBuildOrchestrator.restore(_:)` — replaces the live project with a
   * checkpoint (the current state is snapshotted first, so a restore is
   * itself undoable).
   */
  async restore(checkpoint: ProjectCheckpoint): Promise<void> {
    const checkpointOptions: { fs?: FileSystem; git?: GitSyncHook } = {};
    if (this.deps.fs !== undefined) checkpointOptions.fs = this.deps.fs;
    if (this.deps.git !== undefined) checkpointOptions.git = this.deps.git;
    const restored = await loadCheckpoint(checkpoint, this.deps.fs);
    await saveCheckpoint(this.design.project, 'before restore', checkpointOptions);
    this.design.replaceProject(restored);
  }
}
