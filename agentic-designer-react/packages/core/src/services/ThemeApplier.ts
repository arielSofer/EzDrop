// Ported 1:1 from AgenticDesigner/Services/ThemeApplier.swift
//
// Live re-theming: re-skins an existing project into any VisualStylePreset.
// Works on real canvases (agent-generated or hand-built) by classifying the
// colors already in use into semantic roles — background, surface, accent,
// text — using area, frequency, luminance and saturation, then remapping
// every role to the target preset's tokens. Deterministic and instant; the
// caller checkpoints first so a theme change is one click to revert.

import type { ColorTokens } from '../designSystem/DesignTokens';
import { DesignTokenLibrary } from '../designIntelligence/DesignTokenLibrary';
import type { DesignNode } from '../models/DesignNode';
import type { DesignProject } from '../models/DesignProject';
import type { VisualStylePreset } from '../models/VisualStylePreset';
import type { ThemeHost } from './themeHosts';

// MARK: - Public

/**
 * `ThemeApplier.apply(_:to:)` — re-themes every page of the project.
 * Returns the number of node styles rewritten.
 */
export function apply(preset: VisualStylePreset, viewModel: ThemeHost): number {
  const tokens = DesignTokenLibrary.tokens(preset);
  const stats = makeColorStats();
  for (const page of viewModel.project.pages) {
    for (const node of page.nodes) collect(node, stats);
  }
  const mapping = roleMapping(stats, tokens.colors);
  if (mapping.fills.size === 0 && mapping.texts.size === 0) return 0;

  const changed = { count: 0 };
  const project: DesignProject = cloneProject(viewModel.project);
  for (const page of project.pages) {
    for (const node of page.nodes) rewrite(node, mapping, changed);
  }
  viewModel.replaceProject(project);
  return changed.count;
}

/** Swift's value semantics: the view model gets a fresh document, not aliases. */
function cloneProject(project: DesignProject): DesignProject {
  return {
    ...project,
    pages: project.pages.map((page) => ({ ...page, nodes: page.nodes.map(cloneNode) })),
  };
}

function cloneNode(node: DesignNode): DesignNode {
  return { ...node, style: { ...node.style }, children: node.children.map(cloneNode) };
}

// MARK: - Usage statistics

interface ColorStats {
  /** normalized hex -> covered area */
  fillArea: Map<string, number>;
  buttonFills: Set<string>;
  /** normalized hex -> count */
  textUse: Map<string, number>;
  strokes: Set<string>;
}

function makeColorStats(): ColorStats {
  return { fillArea: new Map(), buttonFills: new Set(), textUse: new Map(), strokes: new Set() };
}

function collect(node: DesignNode, stats: ColorStats): void {
  const fillHex = normalize(node.style.fill);
  if (fillHex !== undefined) {
    stats.fillArea.set(fillHex, (stats.fillArea.get(fillHex) ?? 0) + Math.max(1, node.width * node.height));
    if (node.type === 'Button') stats.buttonFills.add(fillHex);
  }
  if (node.style.stroke !== undefined) {
    const strokeHex = normalize(node.style.stroke);
    if (strokeHex !== undefined) stats.strokes.add(strokeHex);
  }
  if (node.style.textColor !== undefined) {
    const textHex = normalize(node.style.textColor);
    if (textHex !== undefined) stats.textUse.set(textHex, (stats.textUse.get(textHex) ?? 0) + 1);
  }
  for (const child of node.children) collect(child, stats);
}

// MARK: - Role classification

/**
 * Separate maps: a color used both as a fill and as a text color (white,
 * typically) must resolve to a fill role and a text role independently.
 */
interface RoleMapping {
  fills: Map<string, string>;
  texts: Map<string, string>;
}

function roleMapping(stats: ColorStats, colors: ColorTokens): RoleMapping {
  const mapping: RoleMapping = { fills: new Map(), texts: new Map() };

  const fillsByArea = stableSorted([...stats.fillArea], (a, b) => b[1] - a[1]).map((entry) => entry[0]);
  const background = fillsByArea[0];
  const surface = fillsByArea[1];

  // Accent: the most saturated color used on a button, else the most
  // saturated fill that isn't background/surface. A canvas with no
  // genuinely saturated color has no accent to remap — promoting a
  // pale decorative tint to accent paints random blobs in brand color.
  const accentCandidates =
    stats.buttonFills.size === 0 ? [...new Set(fillsByArea.slice(2))] : [...stats.buttonFills];
  const accent = maxBy(
    accentCandidates.filter((hex) => saturation(hex) >= 0.25),
    (a, b) => saturation(a) < saturation(b),
  );

  const textsByUse = stableSorted([...stats.textUse], (a, b) => b[1] - a[1]).map((entry) => entry[0]);
  const textPrimary = textsByUse[0];
  const textSecondary = textsByUse[1];

  // Fill colors may only become fill roles and text colors text roles —
  // a pale header tint must never turn into a text-gray block.
  const fillAnchors = new Map<string, string>();
  if (background !== undefined) fillAnchors.set(background, colors.backgroundPrimary);
  if (surface !== undefined) fillAnchors.set(surface, colors.surfacePrimary);
  if (accent !== undefined) fillAnchors.set(accent, colors.accentPrimary);

  const textAnchors = new Map<string, string>();
  if (textPrimary !== undefined) textAnchors.set(textPrimary, colors.textPrimary);
  if (textSecondary !== undefined) textAnchors.set(textSecondary, colors.textSecondary);

  const totalArea = Math.max(1, [...stats.fillArea.values()].reduce((sum, value) => sum + value, 0));
  for (const [hex, area] of stats.fillArea) {
    if (fillAnchors.get(hex) !== undefined) continue;
    // Large or washed-out fills are surfaces, never accents.
    const accentEligible = saturation(hex) >= 0.25 && area / totalArea < 0.03;
    const candidates = [...fillAnchors.keys()].filter(
      (candidate) => accentEligible || fillAnchors.get(candidate) !== colors.accentPrimary,
    );
    const nearest = minBy(candidates, (a, b) => distance(hex, a) < distance(hex, b));
    if (nearest !== undefined) mapping.fills.set(hex, fillAnchors.get(nearest)!);
  }
  for (const hex of stats.textUse.keys()) {
    if (textAnchors.get(hex) !== undefined) continue;
    const nearest = minBy([...textAnchors.keys()], (a, b) => distance(hex, a) < distance(hex, b));
    if (nearest !== undefined) mapping.texts.set(hex, textAnchors.get(nearest)!);
  }
  for (const [hex, next] of fillAnchors) mapping.fills.set(hex, next);
  for (const [hex, next] of textAnchors) mapping.texts.set(hex, next);
  for (const stroke of stats.strokes) {
    if (mapping.fills.get(stroke) === undefined) mapping.fills.set(stroke, colors.borderSubtle);
  }
  return mapping;
}

// MARK: - Rewrite

function rewrite(node: DesignNode, mapping: RoleMapping, changed: { count: number }): void {
  let touched = false;
  // Image placeholders keep their fill — recoloring them reads as a bug.
  if (node.type !== 'Image') {
    const hex = normalize(node.style.fill);
    const next = hex === undefined ? undefined : mapping.fills.get(hex);
    if (next !== undefined && next !== node.style.fill) {
      node.style.fill = next;
      touched = true;
    }
  }
  if (node.style.stroke !== undefined) {
    const hex = normalize(node.style.stroke);
    const next = hex === undefined ? undefined : mapping.fills.get(hex);
    if (next !== undefined) {
      node.style.stroke = next;
      touched = true;
    }
  }
  if (node.style.textColor !== undefined) {
    const hex = normalize(node.style.textColor);
    const next = hex === undefined ? undefined : mapping.texts.get(hex);
    if (next !== undefined) {
      node.style.textColor = next;
      touched = true;
    }
  }
  if (touched) changed.count += 1;
  for (const child of node.children) rewrite(child, mapping, changed);
}

// MARK: - Color math

function normalize(raw: string): string | undefined {
  let hex = raw.trim().toUpperCase();
  if (!hex.startsWith('#')) return undefined;
  hex = hex.slice(1);
  if (hex.length === 8) hex = hex.slice(0, 6); // drop alpha
  if (hex.length !== 6 || !/^[0-9A-F]{6}$/.test(hex)) return undefined;
  return '#' + hex;
}

function rgb(hex: string): [number, number, number] {
  // Scanner.scanHexInt64 stops at the first non-hex character and yields 0
  // when there is none — parseInt has the same prefix semantics.
  const parsed = parseInt(hex.slice(1), 16);
  const value = Number.isNaN(parsed) ? 0 : parsed;
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function saturation(hex: string): number {
  const c = rgb(hex);
  const maxC = Math.max(c[0], c[1], c[2]);
  const minC = Math.min(c[0], c[1], c[2]);
  return maxC === 0 ? 0 : (maxC - minC) / maxC;
}

function distance(a: string, b: string): number {
  const ca = rgb(a);
  const cb = rgb(b);
  return Math.pow(ca[0] - cb[0], 2) + Math.pow(ca[1] - cb[1], 2) + Math.pow(ca[2] - cb[2], 2);
}

// Swift `max(by:)` / `min(by:)` keep the FIRST of equal elements.
function maxBy<T>(items: T[], isLess: (a: T, b: T) => boolean): T | undefined {
  if (items.length === 0) return undefined;
  let result: T = items[0] as T;
  for (const item of items.slice(1)) if (isLess(result, item)) result = item;
  return result;
}

function minBy<T>(items: T[], isLess: (a: T, b: T) => boolean): T | undefined {
  if (items.length === 0) return undefined;
  let result: T = items[0] as T;
  for (const item of items.slice(1)) if (isLess(item, result)) result = item;
  return result;
}

function stableSorted<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((value, index) => ({ value, index }))
    .sort((a, b) => compare(a.value, b.value) || a.index - b.index)
    .map((entry) => entry.value);
}

/** Static members of the Swift `ThemeApplier` enum. */
export const ThemeApplier = { apply } as const;
