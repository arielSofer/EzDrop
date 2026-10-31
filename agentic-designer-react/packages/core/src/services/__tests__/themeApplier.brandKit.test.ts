// ThemeApplier + BrandKit colour maths on a small fixture. Every expected hex
// is computed from the Swift: ThemeApplier maps background/surface/accent/
// textPrimary/textSecondary onto the preset's ColorTokens and every stroke to
// borderSubtle; BrandKit recolours "vivid" (saturation ≥ 0.35, brightness
// ≥ 0.45) button/small-element fills and text colours, and retints gradients
// to [accent, shade(accent, -0.18)].

import { describe, expect, it } from 'vitest';
import { DesignTokenLibrary } from '../../designIntelligence/DesignTokenLibrary';
import { makeDesignNode, makeNodeStyle, type DesignNode } from '../../models/DesignNode';
import { makeDesignPage, makeDesignProject, type DesignProject } from '../../models/DesignProject';
import { makeGradientStyle } from '../../models/GradientStyle';
import { newUUID } from '../../models/uuid';
import { BrandKit, shade } from '../BrandKit';
import { ThemeApplier } from '../ThemeApplier';
import type { ThemeHost } from '../themeHosts';

class FakeThemeHost implements ThemeHost {
  constructor(public project: DesignProject) {}
  replaceProject(project: DesignProject): void {
    this.project = project;
  }
}

function node(init: Partial<DesignNode> & { name: string; type: DesignNode['type']; width: number; height: number }) {
  return makeDesignNode({
    id: newUUID(),
    x: init.x ?? 0,
    y: init.y ?? 0,
    ...init,
    style: init.style ?? makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
  });
}

function fixture(): DesignProject {
  const title = node({
    name: 'Title', type: 'Text', width: 200, height: 30,
    text: 'Balance',
    style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1, fontSize: 24, textColor: '#111111' }),
  });
  const amount = node({
    name: 'Amount', type: 'Text', width: 200, height: 30,
    text: '$1,240.00',
    style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1, fontSize: 32, textColor: '#111111' }),
  });
  const caption = node({
    name: 'Caption', type: 'Text', width: 200, height: 18,
    text: 'Updated today',
    style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1, fontSize: 13, textColor: '#8A8A8E' }),
  });
  const card = node({
    name: 'Card', type: 'Frame', width: 300, height: 200,
    style: makeNodeStyle({ fill: '#F2F2F7', cornerRadius: 16, opacity: 1, stroke: '#DDDDDD', strokeWidth: 1 }),
    children: [title, amount, caption],
  });
  const cta = node({
    name: 'Pay Button', type: 'Button', width: 200, height: 50,
    text: 'Pay',
    style: makeNodeStyle({ fill: '#0A84FF', cornerRadius: 12, opacity: 1, textColor: '#FFFFFF' }),
  });
  const screen = node({
    name: 'Home', type: 'Frame', width: 390, height: 844,
    style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 40, opacity: 1 }),
    children: [card, cta],
  });
  return makeDesignProject({
    name: 'Fixture',
    pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [screen] })],
  });
}

function find(project: DesignProject, name: string): DesignNode {
  const walk = (nodes: DesignNode[]): DesignNode | undefined => {
    for (const n of nodes) {
      if (n.name === name) return n;
      const found = walk(n.children);
      if (found) return found;
    }
    return undefined;
  };
  const found = walk(project.pages[0]!.nodes);
  if (found === undefined) throw new Error(`no node named ${name}`);
  return found;
}

describe('ThemeApplier', () => {
  it('remaps background / surface / accent / text roles onto the preset tokens', () => {
    const host = new FakeThemeHost(fixture());
    const colors = DesignTokenLibrary.tokens('minimalEditorial').colors;
    // The tokens the Swift preset carries.
    expect(colors.backgroundPrimary).toBe('#F8E1CC');
    expect(colors.surfacePrimary).toBe('#FFFFFF');
    expect(colors.accentPrimary).toBe('#111111');
    expect(colors.textPrimary).toBe('#111111');
    expect(colors.textSecondary).toBe('#7A7A7A');
    expect(colors.borderSubtle).toBe('#E8E3DD');

    const changed = ThemeApplier.apply('minimalEditorial', host);

    // Home (largest area) → backgroundPrimary, Card (second) → surfacePrimary,
    // the button's saturated fill → accentPrimary, its stroke → borderSubtle.
    expect(find(host.project, 'Home').style.fill).toBe('#F8E1CC');
    expect(find(host.project, 'Card').style.fill).toBe('#FFFFFF');
    expect(find(host.project, 'Card').style.stroke).toBe('#E8E3DD');
    expect(find(host.project, 'Pay Button').style.fill).toBe('#111111');
    // Most-used text colour → textPrimary, the runner-up → textSecondary.
    expect(find(host.project, 'Title').style.textColor).toBe('#111111');
    expect(find(host.project, 'Amount').style.textColor).toBe('#111111');
    expect(find(host.project, 'Caption').style.textColor).toBe('#7A7A7A');
    // The button's white label has no anchor of its own and resolves to the
    // nearest text anchor (#8A8A8E → textSecondary), exactly as the Swift does.
    expect(find(host.project, 'Pay Button').style.textColor).toBe('#7A7A7A');
    // Home, Card, Pay Button, Title, Amount, Caption.
    expect(changed).toBe(6);
  });

  it('leaves Image fills alone', () => {
    const project = fixture();
    project.pages[0]!.nodes[0]!.children.push(
      node({
        name: 'Photo', type: 'Image', width: 300, height: 180,
        style: makeNodeStyle({ fill: '#F2F2F7', cornerRadius: 12, opacity: 1 }),
      }),
    );
    const host = new FakeThemeHost(project);
    ThemeApplier.apply('minimalEditorial', host);
    expect(find(host.project, 'Photo').style.fill).toBe('#F2F2F7');
  });
});

describe('BrandKit', () => {
  it('shades a hex the way the Swift does', () => {
    // 0xF0 * 0.82 = 196.8 → 196 (Int truncation) = 0xC4, and so on.
    expect(shade('#F0653C', -0.18)).toBe('#C45231');
    expect(shade('#000000', 0.5)).toBe('#7F7F7F');
    expect(shade('not-a-hex', -0.2)).toBe('not-a-hex');
  });

  it('recolours vivid accents, small badges, accent text and accent gradients', () => {
    const project = fixture();
    const screen = project.pages[0]!.nodes[0]!;
    screen.children.push(
      node({
        name: 'Badge', type: 'Rectangle', width: 40, height: 24,
        style: makeNodeStyle({ fill: '#FF3B30', cornerRadius: 12, opacity: 1 }),
      }),
      node({
        name: 'Link', type: 'Text', width: 120, height: 18, text: 'See all',
        style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1, textColor: '#0A84FF' }),
      }),
      node({
        name: 'Hero', type: 'Frame', width: 300, height: 160,
        style: makeNodeStyle({
          fill: '#FFFFFF', cornerRadius: 20, opacity: 1,
          gradient: makeGradientStyle({ colors: ['#0A84FF', '#0066CC'], angle: 90 }),
        }),
      }),
      node({
        name: 'Heading', type: 'Text', width: 200, height: 24, text: 'Cards',
        // Dark navy: saturated but not bright — must NOT become the accent.
        style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1, textColor: '#0F172A' }),
      }),
    );

    const host = new FakeThemeHost(project);
    const changed = BrandKit.apply({ accent: '#F0653C', name: 'Aroma' }, host);

    expect(find(host.project, 'Pay Button').style.fill).toBe('#F0653C');
    expect(find(host.project, 'Badge').style.fill).toBe('#F0653C');
    expect(find(host.project, 'Link').style.textColor).toBe('#F0653C');
    expect(find(host.project, 'Hero').style.gradient).toEqual({
      type: 'linear',
      colors: ['#F0653C', '#C45231'],
      angle: 90,
    });
    expect(find(host.project, 'Heading').style.textColor).toBe('#0F172A');
    expect(host.project.brand).toEqual({ accent: '#F0653C', name: 'Aroma' });
    expect(changed).toBe(4);
  });

  it('persists the brand even when nothing vivid is on the canvas, and reapplies it', () => {
    const project = fixture();
    // Strip the only vivid colour.
    project.pages[0]!.nodes[0]!.children[1]!.style.fill = '#EFEFEF';
    const host = new FakeThemeHost(project);
    expect(BrandKit.apply({ accent: '#F0653C' }, host)).toBe(0);
    expect(host.project.brand).toEqual({ accent: '#F0653C' });
    // reapplyIfSet is a no-op for an unset brand and re-runs apply otherwise.
    expect(BrandKit.reapplyIfSet(host)).toBe(0);
    expect(BrandKit.apply({ accent: '' }, host)).toBe(0);
  });
});
