// Ported 1:1 from AgenticDesigner/Agent/AgentPipelineCoordinator.swift
//
// The Swift type is an ObservableObject; the port is framework-free: the same
// published fields are plain properties and `subscribe(listener)` replaces
// `objectWillChange` (the web app wraps it with useSyncExternalStore).

import { getPlatform } from '../platform';
import type { DesignNode } from '../models/DesignNode';
import type { DesignAction } from './DesignAction';
import type { AgentContext, AgentRequestIntent } from './AgentContext';
import { AgentPromptBuilder } from './AgentPromptBuilder';
import { CriticPromptBuilder } from './CriticPromptBuilder';
import { makeOpenRouterMessage, type OpenRouterMessage } from './OpenRouterProvider';

export const PipelineState = {
  idle: '',
  planning: 'Planning Strategy & Design System...',
  generating: 'Generating Architecture & Components...',
  generatingAssets: 'Generating Visual Assets...',
  reviewing: 'Reviewing & Polishing...',
  applying: 'Applying to Canvas...',
} as const;
export type PipelineState = (typeof PipelineState)[keyof typeof PipelineState];

/** The `OpenRouterProvider` members the coordinator uses. */
export interface AgentPipelineProvider {
  readonly model: string;
  generateRawChat(messages: OpenRouterMessage[], jsonMode?: boolean): Promise<string>;
  generateActions(messages: OpenRouterMessage[]): Promise<DesignAction[]>;
}

export class AgentPipelineCoordinator {
  state: PipelineState = PipelineState.idle;
  isRunning = false;

  private errorMessageStorage: string | undefined;

  private listeners = new Set<() => void>();

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

  get errorMessage(): string | undefined {
    return this.errorMessageStorage;
  }

  set errorMessage(value: string | undefined) {
    this.errorMessageStorage = value;
    if (value !== undefined) {
      getPlatform().logger.info(`🔴 AI Chat Error: ${value}`);
    }
    this.publish();
  }

  private setState(state: PipelineState): void {
    this.state = state;
    this.publish();
  }

  private setRunning(isRunning: boolean): void {
    this.isRunning = isRunning;
    this.publish();
  }

  async runPipeline(options: {
    userPrompt: string;
    context: AgentContext;
    provider: AgentPipelineProvider;
    generationProvider?: AgentPipelineProvider;
    screenshotDataURL?: string;
    onComplete: (actions: DesignAction[]) => Promise<void>;
  }): Promise<void> {
    const { userPrompt, context, provider, generationProvider, screenshotDataURL, onComplete } = options;
    const logger = getPlatform().logger;

    this.setRunning(true);
    this.errorMessage = undefined;
    const screenshotAttachments = screenshotDataURL !== undefined ? [screenshotDataURL] : [];

    try {
      this.setState(PipelineState.planning);
      const strategyMessages: OpenRouterMessage[] = [
        makeOpenRouterMessage('system', AgentPromptBuilder.buildStrategySystemPrompt()),
      ];

      const strategyBasePrompt = AgentPromptBuilder.buildStrategyUserPrompt(
        userPrompt,
        context,
        screenshotDataURL !== undefined,
      );

      const stage1Prompt = `${strategyBasePrompt}

PHASE 1 (STRATEGY & DESIGN SYSTEM):
Analyze the user's request using the Product Designer methodology.
${stageOneInstructions(context.requestIntent)}

Do NOT output any JSON yet. Just outline your strategy clearly as text.`;

      strategyMessages.push(makeOpenRouterMessage('user', stage1Prompt, { imageDataURLs: screenshotAttachments }));

      logger.info(`===== PIPELINE STAGE 1: STRATEGY (screenshot: ${screenshotDataURL !== undefined}) =====`);
      const strategyContent = await provider.generateRawChat(strategyMessages, false);
      logger.info(strategyContent);

      this.setState(PipelineState.generating);
      const actionBasePrompt = AgentPromptBuilder.buildUserPrompt(
        userPrompt,
        context,
        screenshotDataURL !== undefined,
      );
      const actionMessages: OpenRouterMessage[] = [
        makeOpenRouterMessage('system', AgentPromptBuilder.buildSystemPrompt(context)),
        makeOpenRouterMessage('user', actionBasePrompt, { imageDataURLs: screenshotAttachments }),
        makeOpenRouterMessage('assistant', strategyContent),
      ];
      const stage2Prompt = `PHASE 2 (GENERATION & PRESENTATION):
Execute your approved strategy above EXACTLY — same concept, palette direction, screens, and image plan.
Follow the intent, screen-contract, layout, and imagery rules from the system prompt.
Return only the final DesignAgentResponse JSON.`;
      actionMessages.push(makeOpenRouterMessage('user', stage2Prompt));

      const generator = generationProvider ?? provider;
      logger.info(`===== PIPELINE STAGE 2: GENERATION (model: ${generator.model}) =====`);
      const actions = await generator.generateActions(actionMessages);

      this.setState(PipelineState.generatingAssets);
      await onComplete(actions);
      this.setState(PipelineState.idle);
    } catch (error) {
      this.errorMessage = (error as Error)?.message ?? String(error);
      this.setState(PipelineState.idle);
    }
    this.setRunning(false);
  }

  // מריץ מעבר Critic אחד — משותף לכפתור הידני וללולאה האוטומטית.
  // When a screenshot is provided the critic judges the rendered result
  // visually instead of guessing from raw coordinates.
  async runCriticPass(options: {
    provider: AgentPipelineProvider;
    context: AgentContext;
    pageNodes: DesignNode[];
    screenshotDataURL?: string;
  }): Promise<DesignAction[]> {
    const { provider, context, pageNodes, screenshotDataURL } = options;
    const systemPrompt = CriticPromptBuilder.buildSystemPrompt();
    const userPrompt = CriticPromptBuilder.buildUserPrompt(pageNodes, context, screenshotDataURL !== undefined);

    const messages: OpenRouterMessage[] = [
      makeOpenRouterMessage('system', systemPrompt),
      makeOpenRouterMessage('user', userPrompt, {
        imageDataURLs: screenshotDataURL !== undefined ? [screenshotDataURL] : [],
      }),
    ];

    getPlatform().logger.info(`===== CRITIC PASS (screenshot: ${screenshotDataURL !== undefined}) =====`);
    return provider.generateActions(messages);
  }
}

function stageOneInstructions(intent: AgentRequestIntent): string {
  switch (intent) {
    case 'createNewDesign':
      return `1. Define the App Concept and Target Audience.
2. Propose 3 visually distinct art-direction concepts with different hierarchy, rhythm, motif, and hero treatment.
3. Select the strongest concept and explain why it best fits the product.
4. Choose the exact Visual Style Direction and ComponentTypes from our registry for the selected concept.
5. Choose an image integration pattern: full-bleed hero, product cutout, masked photo card, poster/cover rail, thumbnail gallery, avatar/media cluster, or abstract background.
6. Define typography roles: display headline, section title, metadata/body, CTA. Choose fontFamily/fontWeight roles.
7. Define outline/contour language: strokes, pill borders, separators, circular callouts, or masked card edges.
8. Decide whether this request should be one focused mobile screen or a full app flow. For app/full app/clone/product requests, plan 2-5 core screens such as Home, Discover/Search, Detail, Player/Cart/Chat, and Profile/Settings when relevant. PresentationShot is only for showcase composition, not the only way to create multiple screens.
9. Decide which generated visual assets are needed. Use them for dominant hero/artwork/product/background images and small supporting thumbnails/icons only when they improve the UI.`;
    case 'editSelection':
      return `1. Identify the selected node and the user's requested change.
2. Decide which existing child nodes need alignment, distribution, resizing, or style updates.
3. Use the selected node bounds, padding, and sibling positions from context.
4. Do not plan a new screen, presentation shot, frame, or component.`;
    case 'improveExistingCanvas':
      return `1. Identify the existing screen structure and visible layout problems.
2. Prioritize layoutIssues from context, then hierarchy, spacing, contrast, and alignment.
3. Plan updates to existing nodes before considering any local child additions.
4. Do not plan a new root screen or presentation shot.`;
  }
}
