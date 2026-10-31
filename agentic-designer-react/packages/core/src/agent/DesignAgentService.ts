// Ported 1:1 from AgenticDesigner/Services/DesignAgentService.swift
//
// The full design-agent pipeline (strategy → generation → apply → AI image
// assets → critic polish) as a reusable service. The Agent panel and the
// embedded MCP server both run designs through here, so an external agent
// connected over MCP gets exactly the same pipeline as the in-app button —
// including real image generation and the critic pass.
//
// Settings (API key, models, auto-critic) are read from the same
// UserDefaults / Storage keys the Agent panel's @AppStorage fields persist to.

import type { DesignNode } from '../models/DesignNode';
import { makeDesignAction, type DesignAction } from './DesignAction';
import type { AgentContext } from './AgentContext';
import { AIProviderError } from './AIProvider';
import { OpenRouterConfiguration } from './OpenRouterConfiguration';
import { OpenRouterProvider } from './OpenRouterProvider';
import { PipelineState, type AgentPipelineCoordinator } from './AgentPipelineCoordinator';
import type { DesignAgentDesignHost } from './hosts';
import { getPlatform } from '../platform/platform';
import { storageGetBool, storageGetString } from '../platform/Storage';
import { CheckpointStore } from '../services/CheckpointStore';

export class DesignAgentServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DesignAgentServiceError';
  }
}

export interface DesignAgentSettings {
  apiKey: string;
  model: string;
  generationModel: string;
  autoCriticEnabled: boolean;
}

export interface DesignAgentRunSummary {
  appliedActionCount: number;
  createdReferences: Record<string, string>;
  requestedImageCount: number;
  generatedImageCount: number;
  criticRan: boolean;
}

interface GeneratedImageRequest {
  nodeId: string;
  prompt: string;
  assetKind?: string;
  aspectRatio?: string;
  resolution?: string;
  size?: string;
}

export class DesignAgentService {
  static readonly Settings = {
    current(): DesignAgentSettings {
      const storage = getPlatform().storage;
      return {
        apiKey: storageGetString(storage, 'openRouterAPIKey', ''),
        model: storageGetString(storage, 'openRouterModel', OpenRouterConfiguration.model),
        generationModel: storageGetString(storage, 'openRouterGenerationModel', 'google/gemma-4-31b-it:free'),
        autoCriticEnabled: storageGetBool(storage, 'autoCriticEnabled', true),
      };
    },
    resolvedAPIKey(settings: DesignAgentSettings): string | undefined {
      return (
        OpenRouterConfiguration.apiKey(settings.apiKey) ??
        (settings.model.startsWith('local/') ? 'local' : undefined)
      );
    },
  };

  /** Helper for resolvedAPIKey directly on DesignAgentService */
  static resolvedAPIKey(settings: DesignAgentSettings): string | undefined {
    return DesignAgentService.Settings.resolvedAPIKey(settings);
  }

  readonly viewModel: DesignAgentDesignHost;
  readonly pipeline: AgentPipelineCoordinator;

  constructor(viewModel: DesignAgentDesignHost, pipeline: AgentPipelineCoordinator) {
    this.viewModel = viewModel;
    this.pipeline = pipeline;
  }

  // MARK: - Full pipeline

  async runFullPipeline(
    userPromptText: string,
    quickEdit = false,
    onApplied?: () => void,
  ): Promise<DesignAgentRunSummary> {
    const settings = DesignAgentService.Settings.current();

    const apiKey = DesignAgentService.resolvedAPIKey(settings);
    if (!apiKey) {
      throw AIProviderError.missingAPIKey();
    }

    if (!settings.model.startsWith('local/') && apiKey.length < 20) {
      throw AIProviderError.needsCloudKey(settings.model);
    }

    // Every generation is reversible: snapshot the project before the
    // agent touches it (History menu / restore_checkpoint).
    if (!this.viewModel.project.pages.every((p) => p.nodes.length === 0)) {
      CheckpointStore.save(this.viewModel.project, `before: ${userPromptText.slice(0, 40)}`);
    }

    const context = this.viewModel.makeAgentContext(userPromptText);

    // JSON mode keeps the output parseable, so creation can run hot for
    // more varied art direction; edits stay conservative.
    const temperature = context.requestIntent === 'createNewDesign' ? 0.75 : 0.18;
    const provider = new OpenRouterProvider(apiKey, settings.model, temperature);
    const generationProvider = settings.generationModel.length === 0
      ? undefined
      : new OpenRouterProvider(apiKey, settings.generationModel, temperature);

    // Attach the canvas screenshot only when editing existing UI. On a
    // createNewDesign the current canvas is being REPLACED, so its
    // screenshot teaches the model nothing and just burns image tokens.
    const pageNodes = this.viewModel.currentPage.nodes;
    let screenshotNodes: DesignNode[];
    if (context.requestIntent === 'editSelection' && this.viewModel.selectedNodeId) {
      const screen = this.viewModel.rootScreen(this.viewModel.selectedNodeId);
      screenshotNodes = screen ? [screen] : pageNodes;
    } else {
      screenshotNodes = pageNodes;
    }

    let canvasScreenshot: string | undefined;
    if (screenshotNodes.length > 0 && context.requestIntent !== 'createNewDesign') {
      try {
        const renderer = getPlatform().renderer;
        const res = await renderer.snapshot({ nodeIds: screenshotNodes.map((n) => n.id) });
        canvasScreenshot = res?.dataURL;
      } catch {
        // renderer not supported
      }
    }

    const summary: DesignAgentRunSummary = {
      appliedActionCount: 0,
      createdReferences: {},
      requestedImageCount: 0,
      generatedImageCount: 0,
      criticRan: false,
    };

    await this.pipeline.runPipeline({
      userPrompt: userPromptText,
      context,
      provider,
      generationProvider,
      screenshotDataURL: canvasScreenshot,
      onComplete: async (actions: DesignAction[]) => {
        const preparedActions = DesignAgentService.ensuringImageReferences(
          DesignAgentService.synthesizingPromptsForPlaceholderImages(
            DesignAgentService.addingRequiredGeneratedImageIfNeeded(actions, userPromptText, context),
            userPromptText,
            context,
          ),
        );

        // Apply immediately with placeholders — the design must never
        // be lost because a single image request failed.
        this.pipeline.state = PipelineState.applying;
        const referenceMap = this.viewModel.applyDesignActions(preparedActions);
        summary.appliedActionCount = preparedActions.length;
        summary.createdReferences = referenceMap;
        onApplied?.();

        if (!quickEdit) {
          this.pipeline.state = PipelineState.generatingAssets;
          const imageOutcome = await DesignAgentService.generateAndPatchImages(
            preparedActions,
            referenceMap,
            this.viewModel,
            provider,
          );
          summary.requestedImageCount = imageOutcome.requested;
          summary.generatedImageCount = imageOutcome.generated;
        }

        if (settings.autoCriticEnabled && context.requestIntent !== 'editSelection') {
          summary.criticRan = await this.runAutoCritic(apiKey, settings.model);
        }
      },
    });

    if (this.pipeline.errorMessage) {
      throw new DesignAgentServiceError(this.pipeline.errorMessage);
    }

    return summary;
  }

  private async runAutoCritic(apiKey: string, model: string): Promise<boolean> {
    this.pipeline.state = PipelineState.reviewing;

    const pageNodes = this.viewModel.currentPage.nodes;
    let screenshot: string | undefined;
    try {
      const renderer = getPlatform().renderer;
      const res = await renderer.snapshot({ nodeIds: pageNodes.map((n) => n.id) });
      screenshot = res?.dataURL;
    } catch {
      // renderer not supported
    }

    const criticContext = this.viewModel.makeAgentContext('Review and fix the current design.');
    const criticProvider = new OpenRouterProvider(apiKey, model, 0.18);

    try {
      const fixes = await this.pipeline.runCriticPass({
        provider: criticProvider,
        context: criticContext,
        pageNodes,
        screenshotDataURL: screenshot,
      });
      this.viewModel.applyDesignActions(fixes);
      return true;
    } catch (error) {
      getPlatform().logger.warn(
        `⚠️ Auto-critic pass failed (design kept as generated): ${(error as Error).message}`,
      );
      return false;
    }
  }

  // MARK: - Image asset generation

  static async generateAndPatchImages(
    actions: DesignAction[],
    referenceMap: Record<string, string>,
    viewModel: DesignAgentDesignHost,
    provider: OpenRouterProvider,
  ): Promise<{ requested: number; generated: number }> {
    const requests: GeneratedImageRequest[] = [];

    for (const action of actions) {
      if (action.type !== 'createImage') continue;
      const imagePrompt = DesignAgentService.generatedAssetPrompt(action);
      if (!imagePrompt) continue;
      const reference = action.nodeReference;
      if (!reference) continue;
      const nodeId = referenceMap[reference];
      if (!nodeId) continue;

      requests.push({
        nodeId,
        prompt: imagePrompt,
        assetKind: action.assetKind,
        aspectRatio: DesignAgentService.fittedAspectRatio(action) ?? action.aspectRatio,
        resolution: action.resolution,
        size: action.size ?? DesignAgentService.fittedPixelSize(action),
      });
    }

    if (requests.length === 0) return { requested: 0, generated: 0 };

    let generatedCount = 0;

    await Promise.all(
      requests.map(async (request) => {
        try {
          const path = await provider.generateImageAsset(
            request.prompt,
            request.assetKind,
            request.aspectRatio,
            request.resolution,
            request.size,
          );
          viewModel.setGeneratedImage(request.nodeId, path);
          generatedCount += 1;
        } catch (error) {
          if (request.size) {
            try {
              const path = await provider.generateImageAsset(
                request.prompt,
                request.assetKind,
                request.aspectRatio,
                undefined,
                undefined,
              );
              viewModel.setGeneratedImage(request.nodeId, path);
              generatedCount += 1;
              return;
            } catch (retryErr) {
              getPlatform().logger.warn(
                `⚠️ Image generation failed for node ${request.nodeId}: ${(retryErr as Error).message}`,
              );
              return;
            }
          }
          getPlatform().logger.warn(
            `⚠️ Image generation failed for node ${request.nodeId}: ${(error as Error).message}`,
          );
        }
      }),
    );

    return { requested: requests.length, generated: generatedCount };
  }

  // MARK: - Action preparation

  static addingRequiredGeneratedImageIfNeeded(
    actions: DesignAction[],
    userPrompt: string,
    context: AgentContext,
  ): DesignAction[] {
    if (
      context.requestIntent !== 'createNewDesign' ||
      actions.some((a) => a.type === 'createImage' && DesignAgentService.generatedAssetPrompt(a) !== undefined)
    ) {
      return actions;
    }

    const rootReference = actions.find((a) => a.type === 'createFrame')?.nodeReference;
    const imageAction = makeDesignAction({
      type: 'createImage',
      parentReference: rootReference,
      name: 'Generated Hero Image',
      x: 24,
      y: 132,
      width: 342,
      height: 220,
      fill: '#E5E7EB',
      cornerRadius: 28,
      clipContent: true,
      zIndex: -1,
      imagePrompt: DesignAgentService.fallbackImagePrompt(userPrompt, context),
      assetKind: 'hero',
      aspectRatio: '16:9',
      contentMode: 'fill',
    });

    const firstFrameIndex = actions.findIndex((a) => a.type === 'createFrame');
    if (firstFrameIndex < 0) {
      return [imageAction, ...actions];
    }

    const updatedActions = [...actions];
    updatedActions.splice(firstFrameIndex + 1, 0, imageAction);
    return updatedActions;
  }

  static synthesizingPromptsForPlaceholderImages(
    actions: DesignAction[],
    userPrompt: string,
    context: AgentContext,
  ): DesignAction[] {
    if (context.requestIntent !== 'createNewDesign') return actions;

    const updatedActions = actions.map((a) => ({ ...a }));

    for (let index = 0; index < updatedActions.length; index++) {
      const action = updatedActions[index]!;
      if (action.type !== 'createImage' || DesignAgentService.generatedAssetPrompt(action) !== undefined) {
        continue;
      }

      const source = (action.imageSource ?? action.imageName ?? '').trim();
      const isPlaceholderToken =
        source.length === 0 ||
        (!source.includes('/') && !source.toLowerCase().startsWith('http') && source.length < 48);

      if (!isPlaceholderToken) continue;

      const subjectHint = [action.name, source.replaceAll('_', ' ')]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join(', ');

      const categoryStr = typeof context.appCategory === 'string' ? context.appCategory : 'general';
      updatedActions[index]!.imagePrompt = `{
  "subject": "${subjectHint.replaceAll('"', '\\"')} — supporting visual for: ${userPrompt.replaceAll('"', '\\"')}",
  "appCategory": "${categoryStr}",
  "composition": "one clear subject with calm negative space, sized for its card in a mobile app screen",
  "style": "premium editorial product design image, modern, polished, not a UI screenshot",
  "lighting": "soft controlled lighting, subtle depth",
  "palette": "cohesive with a modern app UI, tasteful, high contrast",
  "mood": "professional, distinctive",
  "constraints": ["no readable text", "no app interface", "no buttons", "no phone mockup", "no watermarks"],
  "negativePrompt": "text, letters, numbers, watermark, app screenshot, phone mockup, buttons, clutter, low quality"
}`;
    }

    return updatedActions;
  }

  static ensuringImageReferences(actions: DesignAction[]): DesignAction[] {
    const updatedActions = actions.map((a) => ({ ...a }));

    for (let index = 0; index < updatedActions.length; index++) {
      if (
        updatedActions[index]!.type === 'createImage' &&
        DesignAgentService.generatedAssetPrompt(updatedActions[index]!) !== undefined &&
        updatedActions[index]!.nodeReference === undefined
      ) {
        updatedActions[index]!.nodeReference = `generatedImage${index}`;
      }
    }

    return updatedActions;
  }

  static generatedAssetPrompt(action: DesignAction): string | undefined {
    const imagePrompt = action.imagePrompt?.trim();
    if (imagePrompt && imagePrompt.length > 0) {
      return imagePrompt;
    }

    const source = (action.imageSource ?? action.imageName ?? '').trim();
    if (!source.toLowerCase().startsWith('generate:')) {
      return undefined;
    }

    const prompt = source.slice('generate:'.length).trim();
    return prompt.length === 0 ? undefined : prompt;
  }

  private static fallbackImagePrompt(userPrompt: string, context: AgentContext): string {
    const categoryStr = typeof context.appCategory === 'string' ? context.appCategory : 'general';
    return `{
  "subject": "premium visual hero artwork for ${userPrompt.replaceAll('"', '\\"')}",
  "appCategory": "${categoryStr}",
  "composition": "one strong cinematic subject with clean negative space, designed to sit inside a rounded mobile hero card",
  "style": "premium editorial product design image, modern, polished, not a UI screenshot",
  "lighting": "soft studio lighting, controlled highlights, subtle depth",
  "palette": "cohesive, tasteful, high-contrast enough for app UI, no muddy dark-on-dark colors",
  "mood": "professional, distinctive, aspirational",
  "uiUsage": "hero image inside a 390x844 mobile app screen",
  "constraints": ["no readable text", "no app interface", "no buttons", "no phone mockup", "no watermarks"],
  "negativePrompt": "text, letters, numbers, watermark, app screenshot, phone mockup, buttons, input fields, clutter, distorted objects, low quality"
}`;
  }

  private static fittedAspectRatio(action: DesignAction): string | undefined {
    const { width, height } = action;
    if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined;

    const ratio = width / height;
    const supported: [string, number][] = [
      ['21:9', 21.0 / 9.0],
      ['16:9', 16.0 / 9.0],
      ['3:2', 3.0 / 2.0],
      ['4:3', 4.0 / 3.0],
      ['1:1', 1.0],
      ['3:4', 3.0 / 4.0],
      ['2:3', 2.0 / 3.0],
      ['9:16', 9.0 / 16.0],
    ];

    let bestName = supported[0]![0];
    let bestDiff = Math.abs(supported[0]![1] - ratio);
    for (let i = 1; i < supported.length; i++) {
      const diff = Math.abs(supported[i]![1] - ratio);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestName = supported[i]![0];
      }
    }
    return bestName;
  }

  private static fittedPixelSize(action: DesignAction): string | undefined {
    const { width, height } = action;
    if (width === undefined || height === undefined || width <= 0 || height <= 0) return undefined;

    const maxDimension = 1536;
    const scale = maxDimension / Math.max(width, height);

    function rounded(value: number): number {
      return Math.max(256, Math.round((value * scale) / 32) * 32);
    }

    return `${rounded(width)}x${rounded(height)}`;
  }
}
