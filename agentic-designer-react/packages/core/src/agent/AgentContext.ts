// Ported 1:1 from AgenticDesigner/Agent/AgentContext.swift

import type { DesignNode, EdgeConstraints } from '../models/DesignNode';
import { DevicePresetLibrary } from '../designSystem/DevicePreset';
import type { DesignTokens } from '../designSystem/DesignTokens';
import type { DeviceDesignRules } from '../designSystem/DeviceDesignRules';
import type { MobileDesignPattern } from '../designSystem/MobileDesignPatterns';
import type { AppCategory } from '../designIntelligence/AppCategory';
import type { ScreenType } from '../designIntelligence/ScreenType';
import type { DesignRecipe } from '../designIntelligence/DesignRecipe';
import type { PresentationMode, VisualProductCategory, VisualRecipe } from '../designIntelligence/VisualArtDirection';

export const AllAgentRequestIntent = ['createNewDesign', 'editSelection', 'improveExistingCanvas'] as const;
export type AgentRequestIntent = (typeof AllAgentRequestIntent)[number];

export const AgentRequestIntentClassifier = {
  classify(prompt: string, hasSelection: boolean, hasCanvasNodes: boolean): AgentRequestIntent {
    const text = prompt.toLowerCase();
    // `CharacterSet.alphanumerics.inverted` — Unicode letters/digits, so
    // Hebrew tokens survive exactly as in Swift.
    const tokens = new Set(text.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0));

    // Whole-canvas review requests win over everything when there is a canvas.
    const improvePhrases = [
      'review and fix', 'current design', 'whole canvas', 'entire canvas',
      'existing design', 'existing canvas', 'העיצוב הנוכחי', 'כל הקנבס',
    ];
    if (hasCanvasNodes && improvePhrases.some((phrase) => text.includes(phrase))) {
      return 'improveExistingCanvas';
    }

    // Creation verbs win over edit words so "build a better travel app"
    // creates a design instead of silently editing the canvas.
    const createPhrases = [
      'create', 'build', 'make a new', 'new screen', 'new app',
      'generate', 'design me', 'design a', 'design an', 'from scratch', 'clone',
      'another screen', 'another page', 'add a screen', 'add a page',
      'add screen', 'add page', 'more screens', 'second screen', 'next screen',
      'תיצור', 'צור', 'תבנה', 'בנה', 'תעצב', 'עצב',
      'מסך חדש', 'אפליקציה חדשה', 'מאפס', 'עוד מסך', 'עוד עמוד', 'מסך נוסף',
    ];
    if (createPhrases.some((phrase) => text.includes(phrase))) {
      return 'createNewDesign';
    }

    // Word-boundary matching so short edit words don't fire inside
    // unrelated words ("moving" ≠ "move on canvas", "exchange" ≠ "change").
    const editTokens = new Set([
      'redesign', 'improve', 'fix', 'adjust', 'align', 'distribute',
      'split', 'evenly', 'center', 'resize', 'bigger', 'smaller',
      'increase', 'decrease', 'padding', 'spacing', 'recolor', 'change',
      'move', 'place', 'arrange', 'tidy', 'polish', 'better',
      'תקן', 'תתקן', 'שפר', 'תשפר', 'יישר', 'מרכז',
      'רווח', 'הזז', 'שנה', 'סדר',
    ]);
    const editPhrases = ['make bigger', 'make smaller', 'יותר טוב'];
    const intersects = [...tokens].some((token) => editTokens.has(token));
    if (hasCanvasNodes && (intersects || editPhrases.some((phrase) => text.includes(phrase)))) {
      return hasSelection ? 'editSelection' : 'improveExistingCanvas';
    }

    return hasSelection ? 'editSelection' : 'createNewDesign';
  },
} as const;

// Context שה-Agent מקבל על המצב הנוכחי של העורך
export interface AgentContext {
  requestIntent: AgentRequestIntent;
  selectedNode?: AgentNodeSummary;
  selectedParent?: AgentNodeSummary;
  selectedSiblings: AgentNodeSummary[];
  selectedContainerId?: string;
  canvasSummary: AgentNodeSummary[];
  layoutIssues: AgentLayoutIssue[];
  creativeDirection: AgentCreativeDirection;

  // Layout hints — עוזרים ל-Agent לדעת איפה להניח אלמנטים
  /** רוחב הContainer הנבחר */
  containerWidth?: number;
  /** גובה הContainer הנבחר */
  containerHeight?: number;
  /** ה-Y הפנוי הבא בתוך הContainer */
  suggestedNextY?: number;
  /** margin צדדי מומלץ מכל צד */
  horizontalMargin: number;
  /** רוחב מומלץ לאלמנט חדש */
  suggestedElementWidth?: number;
  /** כמה ילדים כבר יש בContainer */
  existingChildrenCount: number;

  mobileDesignPattern?: MobileDesignPattern;

  // Design Intelligence Layer
  appCategory: AppCategory;
  screenType: ScreenType;
  designRecipe: DesignRecipe;
  designTokens: DesignTokens;

  // Visual Art Direction Layer
  visualProductCategory: VisualProductCategory;
  presentationMode: PresentationMode;
  visualRecipe: VisualRecipe;

  deviceRules?: DeviceDesignRules;
}

// סיכום קצר של Node בשביל AI
export interface AgentBoxEdges {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** `AgentBoxEdges.from(top:right:bottom:left:)` */
export function agentBoxEdgesFrom(
  top: number | undefined,
  right: number | undefined,
  bottom: number | undefined,
  left: number | undefined,
): AgentBoxEdges | undefined {
  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return undefined;
  }
  const edges: AgentBoxEdges = {};
  if (top !== undefined) edges.top = top;
  if (right !== undefined) edges.right = right;
  if (bottom !== undefined) edges.bottom = bottom;
  if (left !== undefined) edges.left = left;
  return edges;
}

export interface AgentNodeSummary {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  aspectRatio?: number;
  text?: string;
  fill?: string;
  textColor?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
  imageSource?: string;
  contentMode?: string;
  layout?: string;
  spacing?: number;
  layoutAlign?: string;
  padding?: AgentBoxEdges;
  margin?: AgentBoxEdges;
  constraints?: EdgeConstraints;
  clipContent?: boolean;
  zIndex?: number;
  devicePresetId?: string;
  platform?: string;
  children: AgentNodeSummary[];
}

export interface AgentCreativeDirection {
  conceptHook: string;
  layoutRhythm: string;
  visualMotif: string;
  imageStrategy: string;
  spatialRule: string;
}

export interface AgentLayoutIssue {
  severity: string;
  nodeId: string;
  relatedNodeId?: string;
  issue: string;
  suggestedAction: string;
}

/** Swift's `.rounded()` — half away from zero (JS rounds half up). */
function swiftRounded(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * `AgentNodeSummary.init(node:maxDepth:)` — converts a DesignNode to a compact
 * summary for the AI. Coordinates are rounded and the child tree is
 * depth-capped to keep the context JSON small.
 */
export function makeAgentNodeSummary(node: DesignNode, maxDepth = 4): AgentNodeSummary {
  const summary: AgentNodeSummary = {
    id: node.id,
    name: node.name,
    type: node.type,
    x: swiftRounded(node.x),
    y: swiftRounded(node.y),
    right: swiftRounded(node.x + node.width),
    bottom: swiftRounded(node.y + node.height),
    centerX: swiftRounded(node.x + node.width / 2),
    centerY: swiftRounded(node.y + node.height / 2),
    width: swiftRounded(node.width),
    height: swiftRounded(node.height),
    children: maxDepth > 1 ? node.children.map((child) => makeAgentNodeSummary(child, maxDepth - 1)) : [],
  };

  if (node.height > 0) summary.aspectRatio = swiftRounded((node.width / node.height) * 100) / 100;
  if (node.text !== undefined) {
    const characters = Array.from(node.text);
    summary.text = characters.length > 120 ? `${characters.slice(0, 117).join('')}...` : node.text;
  }
  const style = node.style;
  if (style.fill !== undefined) summary.fill = style.fill;
  if (style.textColor !== undefined) summary.textColor = style.textColor;
  if (style.stroke !== undefined) summary.stroke = style.stroke;
  if (style.strokeWidth !== undefined) summary.strokeWidth = style.strokeWidth;
  if (style.cornerRadius !== undefined) summary.cornerRadius = style.cornerRadius;
  if (style.fontSize !== undefined) summary.fontSize = style.fontSize;
  if (style.fontWeight !== undefined) summary.fontWeight = style.fontWeight;
  if (style.fontFamily !== undefined) summary.fontFamily = style.fontFamily;
  const imageSource = node.imageSource ?? node.imageName;
  if (imageSource !== undefined) summary.imageSource = imageSource;
  if (node.contentMode !== undefined) summary.contentMode = node.contentMode;
  if (style.layout !== undefined) summary.layout = style.layout;
  if (style.spacing !== undefined) summary.spacing = style.spacing;
  if (style.layoutAlign !== undefined) summary.layoutAlign = style.layoutAlign;
  const padding = agentBoxEdgesFrom(style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft);
  if (padding) summary.padding = padding;
  const margin = agentBoxEdgesFrom(style.marginTop, style.marginRight, style.marginBottom, style.marginLeft);
  if (margin) summary.margin = margin;
  if (node.constraints !== undefined) summary.constraints = node.constraints;
  if (node.clipContent !== undefined) summary.clipContent = node.clipContent;
  if (node.zIndex !== undefined) summary.zIndex = node.zIndex;

  if (node.devicePresetId !== undefined) {
    summary.devicePresetId = node.devicePresetId;
    const preset = DevicePresetLibrary.preset(node.devicePresetId);
    if (preset) summary.platform = preset.platform;
  }

  return summary;
}

export const AgentCreativeDirectionLibrary = (() => {
  // Axes are sampled independently, so runs draw from hundreds of
  // combinations instead of three fixed templates.
  const conceptHooks = [
    'Design around one memorable hero moment that explains the product instantly.',
    'Make the screen feel like a premium product shot, not an admin template.',
    'Create a distinctive app personality from the domain language, not generic mobile UI.',
    "Lead with the user's single most important task and let everything else recede.",
    "Treat the screen like an editorial magazine spread about the product's promise.",
    'Build the identity around one bold, ownable color-and-shape gesture.',
  ];

  const layoutRhythms = [
    'Use a strong hero, then compact supporting groups with alternating density.',
    'Use fewer, larger sections with generous negative space and one compressed data area.',
    'Mix one tall dramatic section with two shorter functional sections.',
    'Stack a full-bleed opening moment above a calm, evenly-spaced utility zone.',
    'Alternate wide full-width surfaces with a two-column cluster for contrast.',
    'Anchor the composition with a dominant center object and orbit small controls around it.',
  ];

  const visualMotifs = [
    'Large soft object shapes, oversized icon moments, and one confident accent color.',
    'Floating cards, glassy surfaces, big icon badges, and subtle depth.',
    'Icon-led modules, expressive typography, and tactile rounded controls.',
    'Thin elegant strokes, pill borders, and quiet monochrome surfaces with one warm accent.',
    'Oversized numerals and display type as graphic elements, minimal ornamentation.',
    'Layered rounded masks with overlapping imagery and soft believable shadows.',
  ];

  const imageStrategies = [
    'Use one large immersive image/visual surface when the category can benefit from imagery.',
    'Prefer a dominant visual card or masked image over many small placeholders.',
    'If photos are not useful, create a large symbolic icon/illustration area instead.',
    'Use a full-bleed background photo with a gradient overlay and high-contrast text.',
    'Feature one product-cutout object floating over a calm card with a grounded shadow.',
  ];

  const spatialRules = [
    'Keep every group aligned to a clear column, but offset one feature card for editorial energy.',
    'Establish a 24pt outer grid and align centers intentionally across related elements.',
    'Group related icon + label pairs into equal columns with text centered below icons.',
    'Hold a strict left-aligned text axis and let only imagery break the grid.',
    'Use one intentional overlap (image behind text or card over hero) and keep the rest orthogonal.',
  ];

  function randomElement(values: string[]): string {
    return values[Math.floor(Math.random() * values.length)] ?? values[0]!;
  }

  return {
    conceptHooks,
    layoutRhythms,
    visualMotifs,
    imageStrategies,
    spatialRules,
    /** `direction(for:)` — the prompt is unused in Swift too. */
    direction(_prompt: string): AgentCreativeDirection {
      return {
        conceptHook: randomElement(conceptHooks),
        layoutRhythm: randomElement(layoutRhythms),
        visualMotif: randomElement(visualMotifs),
        imageStrategy: randomElement(imageStrategies),
        spatialRule: randomElement(spatialRules),
      };
    },
  };
})();
