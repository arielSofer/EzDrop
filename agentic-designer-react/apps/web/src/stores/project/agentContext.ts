// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift —
// `makeAgentContext(userPrompt:)` and the private layout audit that feeds it
// (`auditLayoutIssues`, `collectLayoutIssues`, `auditChildren`,
// `shouldAuditOverlap`, `auditIconLabelQuality`).

import {
  DevicePresetLibrary,
  rectIntersection,
  type DesignNode,
  type Rect,
} from '@agentic/core';
import {
  AgentCreativeDirectionLibrary,
  AgentRequestIntentClassifier,
  makeAgentNodeSummary,
  type AgentContext,
  type AgentLayoutIssue,
  type AgentNodeSummary,
} from '@agentic/core/agent/AgentContext';
import { MobileDesignPatternLibrary } from '@agentic/core/designSystem/MobileDesignPatterns';
import { DeviceDesignRuleLibrary } from '@agentic/core/designSystem/DeviceDesignRules';
import { AppCategoryClassifier } from '@agentic/core/designIntelligence/AppCategory';
import { ScreenTypeClassifier } from '@agentic/core/designIntelligence/ScreenType';
import { DesignRecipeLibrary } from '@agentic/core/designIntelligence/DesignRecipeLibrary';
import { DesignTokenLibrary } from '@agentic/core/designIntelligence/DesignTokenLibrary';
import {
  PresentationModeClassifier,
  VisualProductCategoryClassifier,
  VisualRecipeLibrary,
} from '@agentic/core/designIntelligence/VisualArtDirection';
import { isVisualStylePreset, type VisualStylePreset } from '@agentic/core';
import { baseSemanticName, iconLabelMatchScore, isBottomNavigation } from './layout';
import { findNode, parentNode } from './nodeTree';
import type { AgentRequestIntent, PresentationMode } from './agentIntent';

// MARK: - Layout audit

export function shouldAuditOverlap(lhs: DesignNode, rhs: DesignNode): boolean {
  const allowsLayering =
    lhs.type === 'Icon' ||
    rhs.type === 'Icon' ||
    lhs.name.toLowerCase().includes('background') ||
    rhs.name.toLowerCase().includes('background') ||
    lhs.name.toLowerCase().includes('overlay') ||
    rhs.name.toLowerCase().includes('overlay');

  return !allowsLayering;
}

export function auditIconLabelQuality(parent: DesignNode, issues: AgentLayoutIssue[]): void {
  const iconIndices = parent.children
    .map((_child, index) => index)
    .filter((index) => parent.children[index].type === 'Icon');
  const labelIndices = parent.children
    .map((_child, index) => index)
    .filter((index) => parent.children[index].type === 'Text');

  if (iconIndices.length < 2 || labelIndices.length < 2) return;

  const parentName = parent.name.toLowerCase();
  const likelyIconGroup =
    parentName.includes('nav') ||
    parentName.includes('action') ||
    parentName.includes('tab') ||
    parentName.includes('icon') ||
    parent.height <= 140;

  if (!likelyIconGroup) return;

  const averageIconSize =
    iconIndices
      .map((index) => Math.min(parent.children[index].width, parent.children[index].height))
      .reduce((sum, value) => sum + value, 0) / iconIndices.length;

  if (averageIconSize < 22 && !isBottomNavigation(parent)) {
    issues.push({
      severity: 'medium',
      nodeId: parent.id,
      relatedNodeId: undefined,
      issue: `${parent.name} uses icons that are too small for a premium icon-led UI.`,
      suggestedAction: 'scaleNode icons up or use distributeChildren on the parent.',
    });
  }

  const usedLabels = new Set<number>();
  let checkedPairs = 0;

  for (const iconIndex of iconIndices) {
    const iconName = baseSemanticName(parent.children[iconIndex].name);
    const candidates = labelIndices.filter((index) => !usedLabels.has(index));
    if (candidates.length === 0) continue;
    let labelIndex = candidates[0];
    for (const candidate of candidates.slice(1)) {
      const candidateScore = iconLabelMatchScore(
        iconName,
        parent.children[candidate],
        parent.children[iconIndex],
      );
      const currentScore = iconLabelMatchScore(
        iconName,
        parent.children[labelIndex],
        parent.children[iconIndex],
      );
      if (candidateScore < currentScore) labelIndex = candidate;
    }

    usedLabels.add(labelIndex);
    checkedPairs += 1;

    const iconCenter = parent.children[iconIndex].x + parent.children[iconIndex].width / 2;
    const labelCenter = parent.children[labelIndex].x + parent.children[labelIndex].width / 2;

    if (Math.abs(iconCenter - labelCenter) > 10) {
      issues.push({
        severity: 'medium',
        nodeId: parent.id,
        relatedNodeId: undefined,
        issue: `${parent.name} has icon labels that are not centered under their icons.`,
        suggestedAction: 'distributeChildren with axis horizontal on the parent.',
      });
      return;
    }
  }

  if (checkedPairs < 2) {
    return;
  }
}

export function auditChildren(parent: DesignNode, issues: AgentLayoutIssue[]): void {
  if (parent.children.length === 0) return;

  for (const child of parent.children) {
    if (
      child.x < -0.5 ||
      child.y < -0.5 ||
      child.x + child.width > parent.width + 0.5 ||
      child.y + child.height > parent.height + 0.5
    ) {
      issues.push({
        severity: 'high',
        nodeId: child.id,
        relatedNodeId: parent.id,
        issue: `${child.name} is outside the bounds of ${parent.name}.`,
        suggestedAction: 'moveNode or resizeNode the child so it stays inside the parent.',
      });
    }
  }

  for (let lhsIndex = 0; lhsIndex < parent.children.length; lhsIndex += 1) {
    for (let rhsIndex = lhsIndex + 1; rhsIndex < parent.children.length; rhsIndex += 1) {
      const lhs = parent.children[lhsIndex];
      const rhs = parent.children[rhsIndex];

      if (!shouldAuditOverlap(lhs, rhs)) continue;

      const lhsRect: Rect = { x: lhs.x, y: lhs.y, width: lhs.width, height: lhs.height };
      const rhsRect: Rect = { x: rhs.x, y: rhs.y, width: rhs.width, height: rhs.height };
      const intersection = rectIntersection(lhsRect, rhsRect);

      if (
        intersection.width > 2 &&
        intersection.height > 2 &&
        intersection.width * intersection.height > 80
      ) {
        issues.push({
          severity: 'high',
          nodeId: rhs.id,
          relatedNodeId: lhs.id,
          issue: `${rhs.name} overlaps ${lhs.name} inside ${parent.name}.`,
          suggestedAction: 'moveNode, resizeNode, or distributeChildren within the parent.',
        });
      }
    }
  }

  auditIconLabelQuality(parent, issues);
}

export function collectLayoutIssues(nodes: readonly DesignNode[], issues: AgentLayoutIssue[]): void {
  for (const node of nodes) {
    auditChildren(node, issues);
    if (node.children.length > 0) {
      collectLayoutIssues(node.children, issues);
    }
  }
}

export function auditLayoutIssues(nodes: readonly DesignNode[]): AgentLayoutIssue[] {
  const issues: AgentLayoutIssue[] = [];
  collectLayoutIssues(nodes, issues);
  return issues.slice(0, 24);
}

// MARK: - makeAgentContext

/** The view-model state `makeAgentContext(userPrompt:)` reads and writes. */
export interface AgentContextInputs {
  currentPageNodes: readonly DesignNode[];
  selectedNodeId: string | undefined;
  /** `agentContainerNodeId` */
  agentContainerNodeId: string | undefined;
}

export interface AgentContextResult {
  context: AgentContext;
  /** The private run state the view model records while building the context. */
  currentAgentRequestIntent: AgentRequestIntent;
  currentAgentPresentationMode: PresentationMode;
  currentAgentStylePreset: VisualStylePreset;
}

// בונה Context עבור ה-Agent מתוך מצב הפרויקט הנוכחי
export function makeAgentContext(
  userPrompt: string,
  inputs: AgentContextInputs,
  currentAgentStylePreset: VisualStylePreset,
): AgentContextResult {
  const { currentPageNodes, selectedNodeId } = inputs;
  const selected = selectedNodeId !== undefined ? findNode(selectedNodeId, currentPageNodes) : undefined;
  const selectedSummary = selected ? makeAgentNodeSummary(selected) : undefined;
  const selectedParentNode =
    selectedNodeId !== undefined ? parentNode(selectedNodeId, currentPageNodes) : undefined;
  const selectedParentSummary = selectedParentNode ? makeAgentNodeSummary(selectedParentNode) : undefined;

  let selectedSiblingNodes: DesignNode[];
  if (selectedNodeId !== undefined && selectedParentNode) {
    selectedSiblingNodes = selectedParentNode.children.filter((child) => child.id !== selectedNodeId);
  } else if (selectedNodeId !== undefined) {
    selectedSiblingNodes = currentPageNodes.filter((node) => node.id !== selectedNodeId);
  } else {
    selectedSiblingNodes = [];
  }

  const selectedSiblings: AgentNodeSummary[] = selectedSiblingNodes.map((node) => makeAgentNodeSummary(node));
  const layoutIssues = auditLayoutIssues(currentPageNodes);
  const creativeDirection = AgentCreativeDirectionLibrary.direction(userPrompt);
  const requestIntent = AgentRequestIntentClassifier.classify(
    userPrompt,
    selectedNodeId !== undefined,
    currentPageNodes.length > 0,
  );

  // New designs only need to know what space is occupied.
  const canvasSummaryDepth = requestIntent === 'createNewDesign' ? 1 : 4;
  // A single-element edit only needs the screen it lives on.
  let summaryNodes: readonly DesignNode[];
  const screen =
    requestIntent === 'editSelection' && selectedNodeId !== undefined
      ? currentPageNodes.find((node) => findNode(selectedNodeId, [node]) !== undefined)
      : undefined;
  if (screen) {
    summaryNodes = [screen];
  } else {
    summaryNodes = currentPageNodes;
  }
  const canvasSummary = summaryNodes.map((node) => makeAgentNodeSummary(node, canvasSummaryDepth));

  // A brand-new design must never inherit an old selected frame as its container.
  const containerId = requestIntent === 'createNewDesign' ? undefined : inputs.agentContainerNodeId;
  const container = containerId !== undefined ? findNode(containerId, currentPageNodes) : undefined;

  const containerWidth = container?.width;
  const containerHeight = container?.height;
  const horizontalMargin = 32;

  const suggestedElementWidth = containerWidth !== undefined ? containerWidth - horizontalMargin * 2 : undefined;

  // מחשב את ה-Y הפנוי הבא — הילד הנמוך ביותר + גובהו + gap
  const suggestedNextY = ((): number | undefined => {
    if (!container || container.children.length === 0) {
      return container !== undefined ? 40 : undefined;
    }
    let bottomMost = container.children[0];
    for (const child of container.children.slice(1)) {
      if (bottomMost.y + bottomMost.height < child.y + child.height) bottomMost = child;
    }
    return bottomMost.y + bottomMost.height + 20; // 20pt gap בין אלמנטים
  })();

  const childrenCount = container?.children.length ?? 0;

  const pattern = MobileDesignPatternLibrary.pattern(userPrompt);

  // --- Design Intelligence Layer ---
  const category = AppCategoryClassifier.classify(userPrompt);
  const screenType = ScreenTypeClassifier.classify(userPrompt);
  const recipe = DesignRecipeLibrary.recipe(category, screenType);
  const tokens = DesignTokenLibrary.tokens(recipe.recommendedStyle);
  const visualCategory = VisualProductCategoryClassifier.classify(userPrompt);
  const presentationMode = PresentationModeClassifier.classify(userPrompt);
  const visualRecipe = VisualRecipeLibrary.recipe(visualCategory, presentationMode);
  let resolvedStylePreset: VisualStylePreset;
  if (visualCategory !== 'generic' && isVisualStylePreset(visualRecipe.stylePreset)) {
    resolvedStylePreset = visualRecipe.stylePreset;
  } else {
    resolvedStylePreset = recipe.recommendedStyle;
  }

  let deviceRules: ReturnType<typeof DeviceDesignRuleLibrary.rules> | undefined;
  const devicePresetId = selected?.devicePresetId;
  const preset = devicePresetId !== undefined ? DevicePresetLibrary.preset(devicePresetId) : undefined;
  if (selected && preset) {
    deviceRules = DeviceDesignRuleLibrary.rules(preset.platform);
  } else {
    deviceRules = undefined;
  }
  // ---------------------------------

  const context: AgentContext = {
    requestIntent,
    selectedNode: selectedSummary,
    selectedParent: selectedParentSummary,
    selectedSiblings,
    selectedContainerId: containerId,
    canvasSummary,
    layoutIssues,
    creativeDirection,
    containerWidth,
    containerHeight,
    suggestedNextY,
    horizontalMargin,
    suggestedElementWidth,
    existingChildrenCount: childrenCount,
    mobileDesignPattern: pattern,
    appCategory: category,
    screenType,
    designRecipe: recipe,
    designTokens: tokens,
    visualProductCategory: visualCategory,
    presentationMode,
    visualRecipe,
    deviceRules,
  };

  return {
    context,
    currentAgentRequestIntent: requestIntent,
    currentAgentPresentationMode: presentationMode,
    currentAgentStylePreset: resolvedStylePreset === undefined ? currentAgentStylePreset : resolvedStylePreset,
  };
}
