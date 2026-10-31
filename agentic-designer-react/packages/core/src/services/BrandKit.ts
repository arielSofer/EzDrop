// Ported 1:1 from AgenticDesigner/Services/BrandKit.swift
//
// Turns a generic generated app into *your* product: a brand accent (and
// optional neutrals) applied across every screen, and persisted with the
// project so future agent runs, templates and theme switches keep the
// identity instead of reverting to stock palettes.
//
// Themes decide the mood (light/dark/warm); the brand decides the colour of
// the things that carry identity — CTAs, active states, highlights.
//
// (`BrandIdentity` itself lives in models/BrandIdentity.ts — import it.)

import { brandIdentityIsSet, type BrandIdentity } from '../models/BrandIdentity';
import type { DesignNode } from '../models/DesignNode';
import type { DesignProject } from '../models/DesignProject';
import { makeGradientStyle } from '../models/GradientStyle';
import type { ThemeHost } from './themeHosts';

/**
 * `BrandKit.apply(_:to:)` — re-colors every accent-role element to the brand
 * accent. Returns the number of node styles changed.
 */
export function apply(brand: BrandIdentity, viewModel: ThemeHost): number {
  if (!brandIdentityIsSet(brand)) return 0;

  // The accent in use today = the most saturated colour on buttons (the
  // same rule ThemeApplier uses), so we recolor exactly what reads as
  // "the brand colour" rather than repainting every surface.
  const accentColors = new Set<string>();
  const project: DesignProject = cloneProject(viewModel.project);

  function collect(node: DesignNode): void {
    const fillHex = normalize(node.style.fill);
    if (fillHex !== undefined && isVivid(fillHex)) {
      if (node.type === 'Button' || isAccentSized(node)) accentColors.add(fillHex);
    }
    const textHex = normalize(node.style.textColor);
    if (textHex !== undefined && isVivid(textHex)) accentColors.add(textHex);
    node.children.forEach(collect);
  }
  for (const page of project.pages) page.nodes.forEach(collect);
  if (accentColors.size === 0) {
    project.brand = brand;
    viewModel.replaceProject(project);
    return 0;
  }

  let changed = 0;
  function recolor(node: DesignNode): void {
    const fillHex = normalize(node.style.fill);
    if (fillHex !== undefined && accentColors.has(fillHex)) {
      node.style.fill = brand.accent;
      changed += 1;
    }
    const textHex = normalize(node.style.textColor);
    if (textHex !== undefined && accentColors.has(textHex)) {
      node.style.textColor = brand.accent;
      changed += 1;
    }
    // Gradients that ride on the accent get retinted end-to-end.
    const gradient = node.style.gradient;
    if (
      gradient !== undefined &&
      gradient.colors.some((color) => {
        const hex = normalize(color);
        return hex === undefined ? false : accentColors.has(hex);
      })
    ) {
      node.style.gradient = makeGradientStyle({
        type: gradient.type,
        colors: [brand.accent, brand.accentSecondary ?? shade(brand.accent, -0.18)],
        angle: gradient.angle,
        stops: gradient.stops,
      });
      changed += 1;
    }
    for (const child of node.children) recolor(child);
  }
  for (const page of project.pages) {
    for (const node of page.nodes) recolor(node);
  }

  project.brand = brand;
  viewModel.replaceProject(project);
  return changed;
}

/**
 * `BrandKit.reapplyIfSet(to:)` — a theme change repaints with stock tokens,
 * so re-stamp the brand after it and identity survives re-theming.
 */
export function reapplyIfSet(viewModel: ThemeHost): number {
  const brand = viewModel.project.brand;
  if (brand === undefined || !brandIdentityIsSet(brand)) return 0;
  return apply(brand, viewModel);
}

// MARK: - Colour helpers

/**
 * Small, strongly-coloured elements read as accents (badges, pills, dots)
 * even when they aren't Buttons.
 */
function isAccentSized(node: DesignNode): boolean {
  return node.width * node.height < 42_000;
}

function normalize(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let hex = raw.trim().toUpperCase();
  if (!hex.startsWith('#')) return undefined;
  hex = hex.slice(1);
  if (hex.length === 8) hex = hex.slice(0, 6);
  if (hex.length !== 6 || !/^[0-9A-F]{6}$/.test(hex)) return undefined;
  return '#' + hex;
}

function rgb(hex: string): [number, number, number] {
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

function brightness(hex: string): number {
  const c = rgb(hex);
  return Math.max(c[0], c[1], c[2]);
}

/**
 * A colour that reads as "the brand colour" to a human. Saturation alone
 * is not enough: dark navy text (#0F172A) is highly saturated but reads
 * as near-black — recolouring it turns every heading into the accent.
 */
function isVivid(hex: string): boolean {
  return saturation(hex) >= 0.35 && brightness(hex) >= 0.45;
}

/** Swift's private `Double.clamped(_:_:)` extension. */
function clamped(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/** `BrandKit.shade(_:by:)` — darker (negative) or lighter (positive) variant. */
export function shade(hex: string, amount: number): string {
  const clean = normalize(hex);
  if (clean === undefined) return hex;
  const c = rgb(clean);
  const adjust = (v: number): number =>
    Math.trunc(clamped(amount < 0 ? v * (1 + amount) : v + (1 - v) * amount, 0, 1) * 255);
  return `#${hex2(adjust(c[0]))}${hex2(adjust(c[1]))}${hex2(adjust(c[2]))}`;
}

/** `String(format: "%02X", value)` */
function hex2(value: number): string {
  return (value < 0 ? 0 : value).toString(16).toUpperCase().padStart(2, '0');
}

function cloneProject(project: DesignProject): DesignProject {
  return {
    ...project,
    pages: project.pages.map((page) => ({ ...page, nodes: page.nodes.map(cloneNode) })),
  };
}

function cloneNode(node: DesignNode): DesignNode {
  return { ...node, style: { ...node.style }, children: node.children.map(cloneNode) };
}

/** Static members of the Swift `BrandKit` enum. */
export const BrandKit = { apply, reapplyIfSet, shade } as const;
