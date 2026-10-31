// WebExporter: the emitted file set, the document skeleton, per-node markup
// and the CSS translation rules from Services/WebExporter.swift.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDesignProject } from '../../models/codec';
import { makeDesignNode, makeNodeStyle } from '../../models/DesignNode';
import { makeLogicFlow, type LogicFlow } from '../../models/LogicModels';
import { BlockCatalog } from '../../models/BlockDefinitions';
import { makeBlockConnection } from '../../models/LogicModels';
import { WebExporter } from '../WebExporter';
import { isBinaryEntry } from '../GeneratedFileTree';

const ROOT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner';

function screenFixture() {
  const text = makeDesignNode({
    type: 'Text',
    name: 'Title',
    x: 24,
    y: 60,
    width: 200,
    height: 30,
    text: 'Hello & "world" <b>',
    style: makeNodeStyle({
      fill: '#00000000',
      cornerRadius: 0,
      opacity: 1,
      fontSize: 22,
      fontWeight: 'bold',
      textColor: '#111827',
      textAlign: 'center',
    }),
  });
  const button = makeDesignNode({
    type: 'Button',
    name: 'Continue',
    x: 20,
    y: 700,
    width: 350,
    height: 52,
    text: 'Continue',
    style: makeNodeStyle({ fill: '#111827', cornerRadius: 12, opacity: 0.5 }),
    zIndex: 2,
  });
  const input = makeDesignNode({
    type: 'Input',
    name: 'Email',
    x: 20,
    y: 300,
    width: 350,
    height: 44,
    text: 'you@example.com',
    style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 8, opacity: 1, stroke: '#E5E7EB', strokeWidth: 1 }),
    zIndex: 1,
  });
  const image = makeDesignNode({
    type: 'Image',
    name: 'Hero',
    x: 0,
    y: 0,
    width: 390,
    height: 240,
    imageSource: 'https://example.com/hero.png',
    style: makeNodeStyle({ fill: '#EEEEEE', cornerRadius: 0, opacity: 1 }),
  });
  const placeholder = makeDesignNode({
    type: 'Image',
    name: 'Missing',
    x: 0,
    y: 250,
    width: 100,
    height: 100,
    text: 'photo',
    imageSource: 'assets/local.png',
    style: makeNodeStyle({ fill: '#EEEEEE', cornerRadius: 0, opacity: 1 }),
  });
  const icon = makeDesignNode({
    type: 'Icon',
    name: 'Home',
    x: 10,
    y: 800,
    width: 24,
    height: 24,
    iconName: 'house.fill',
    style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1 }),
  });
  const gradientCard = makeDesignNode({
    type: 'Rectangle',
    name: 'Card',
    x: 20,
    y: 400,
    width: 350,
    height: 120,
    style: makeNodeStyle({
      fill: '#FFFFFF',
      cornerRadius: 16,
      opacity: 1,
      gradient: { type: 'linear', colors: ['#071B4D', '#126BFF'], angle: 90, stops: [0, 1] },
      shadow: { color: '#000000', opacity: 0.2, radius: 12, x: 0, y: 6 },
      layout: 'row',
      spacing: 8,
      paddingTop: 8,
      paddingRight: 12,
      paddingBottom: 8,
      paddingLeft: 12,
    }),
  });
  return makeDesignNode({
    type: 'Frame',
    name: 'Home',
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
    children: [button, input, text, image, placeholder, icon, gradientCard],
  });
}

function tapFlow(nodeId: string): LogicFlow {
  const tap = BlockCatalog.makeBlock('onTap', { x: 0, y: 0 })!;
  tap.parameters.find((p) => p.key === 'element')!.nodeReference = nodeId;
  const toast = BlockCatalog.makeBlock('showToast', { x: 0, y: 120 })!;
  toast.parameters.find((p) => p.key === 'message')!.value = 'Tapped';
  return makeLogicFlow({
    name: 'Tap',
    blocks: [tap, toast],
    connections: [
      makeBlockConnection({ sourceBlockId: tap.id, sourcePortIndex: 0, targetBlockId: toast.id, targetPortIndex: 0 }),
    ],
  });
}

describe('WebExporter.files', () => {
  it('emits exactly one HTML file, named like the Swift save panel', () => {
    const screen = screenFixture();
    const tree = WebExporter.files({ screens: [screen], appName: 'Aster Reader' });
    expect(Object.keys(tree)).toEqual(['Aster-Reader.html']);
    const entry = tree['Aster-Reader.html']!;
    expect(isBinaryEntry(entry)).toBe(false);
    expect(entry).toBe(WebExporter.html({ screens: [screen], appName: 'Aster Reader' }));
  });
});

describe('WebExporter.html', () => {
  const screen = screenFixture();

  it('renders the document skeleton with the escaped app name', () => {
    const html = WebExporter.html({ screens: [screen], appName: 'A & B' });
    expect(html.startsWith('<!doctype html>\n<html lang="en">')).toBe(true);
    expect(html).toContain('<title>A &amp; B</title>');
    expect(html).toContain('<div id="toast"></div>');
    expect(html.trimEnd().endsWith('</html>')).toBe(true);
    // Static gallery: no nav bar and no script when there are no flows.
    expect(html).not.toContain('class="screen-nav"');
    expect(html).not.toContain('app-data');
  });

  it('renders one .screen per root Frame and marks every node with its id', () => {
    const html = WebExporter.html({ screens: [screen], appName: 'Demo' });
    expect(html).toContain(`<div class="screen" data-screen-id="${screen.id}">`);
    expect(html).toContain('<div class="screen-label">Home</div>');
    for (const child of screen.children) {
      expect(html).toContain(`data-node-id="${child.id}"`);
    }
  });

  it('maps node types onto the Swift tags and escapes text', () => {
    const html = WebExporter.html({ screens: [screen], appName: 'Demo' });
    expect(html).toContain('<div class="node"'); // Text
    expect(html).toContain('<button class="node btn"'); // Button
    expect(html).toContain('<input class="node"'); // Input
    expect(html).toContain('placeholder="you@example.com"');
    expect(html).toContain('<img class="node"');
    expect(html).toContain('src="https://example.com/hero.png"');
    expect(html).toContain('object-fit:cover;');
    expect(html).toContain('class="node img-ph"'); // non-renderable source
    expect(html).toContain('🏠'); // house.fill
    expect(html).toContain('Hello &amp; &quot;world&quot; &lt;b&gt;');
  });

  it('translates styles: px rounding, gradients, shadows, opacity, padding and flex', () => {
    const html = WebExporter.html({ screens: [screen], appName: 'Demo' });
    expect(html).toContain('left:20px;top:700px;width:350px;height:52px');
    expect(html).toContain('background:#111827');
    expect(html).toContain('border-radius:12px;opacity:0.5;');
    expect(html).toContain('border:1px solid #E5E7EB');
    expect(html).toContain('font-size:22px;font-weight:700;color:#111827;text-align:center');
    expect(html).toContain('display:flex;align-items:center;justify-content:center;overflow:hidden');
    // SwiftUI 90° → CSS 90deg (180 - 90), stops as percentages.
    expect(html).toContain('background:linear-gradient(90deg, #071B4D 0%, #126BFF 100%)');
    expect(html).toContain('box-shadow:0px 6px 12px rgba(0,0,0,0.2)');
    expect(html).toContain('padding:8px 12px 8px 12px');
    expect(html).toContain('display:flex;flex-direction:row;gap:8px');
    // Children are sorted by zIndex: the Input (1) precedes the Button (2).
    const inputIndex = html.indexOf('<input class="node"');
    const buttonIndex = html.indexOf('<button class="node btn"');
    expect(inputIndex).toBeGreaterThan(-1);
    expect(inputIndex).toBeLessThan(buttonIndex);
  });

  it('with flows: hides every screen but the first and embeds the nav bar + runtime', () => {
    const second = makeDesignNode({
      type: 'Frame',
      name: 'Detail',
      x: 400,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
    });
    const html = WebExporter.html({
      screens: [screen, second],
      appName: 'Demo',
      flows: [tapFlow(screen.children[0]!.id)],
    });
    expect(html).toContain(`<div class="screen" data-screen-id="${screen.id}">`);
    expect(html).toContain(`<div class="screen hidden" data-screen-id="${second.id}">`);
    expect(html).toContain(`<button data-goto="${screen.id}">Home</button>`);
    expect(html).toContain('<script id="app-data" type="application/json">');
    expect(html).toContain('const APP = JSON.parse(document.getElementById(\'app-data\').textContent);');
  });

  it('interactive: false degrades to the static gallery', () => {
    const html = WebExporter.html({
      screens: [screen],
      appName: 'Demo',
      flows: [tapFlow(screen.children[0]!.id)],
      interactive: false,
    });
    expect(html).not.toContain('app-data');
    expect(html).not.toContain('class="screen-nav"');
  });
});

describe('WebExporter over the sample projects', () => {
  for (const relative of ['PaceGuard.agenticdesign', 'Looply.agenticdesign', 'SavedProjects/AsterReader-BookApp-FullLogic.agenticdesign']) {
    it(`exports ${relative} to a single self-contained page`, () => {
      const project = parseDesignProject(readFileSync(`${ROOT}/${relative}`, 'utf8'));
      const page = project.pages[0]!;
      const screens = page.nodes.filter((n) => n.type === 'Frame');
      const tree = WebExporter.files({
        screens,
        appName: project.name,
        flows: page.logicFlows,
        globalVariables: project.globalVariables,
        supabase: project.supabaseConfig,
      });
      const [name] = Object.keys(tree);
      expect(name).toBe(`${project.name.split(' ').join('-')}.html`);
      const html = tree[name!] as string;
      expect(html.startsWith('<!doctype html>')).toBe(true);
      // Every screen is present, and only the first is visible.
      for (const s of screens) expect(html).toContain(`data-screen-id="${s.id}"`);
      expect((html.match(/class="screen hidden"/g) ?? []).length).toBe(Math.max(0, screens.length - 1));
      // No external resources: one file, no <link> or src="./".
      expect(html).not.toContain('<link');
      expect(html).not.toContain('src="./');
    });
  }
});
