// Ported 1:1 from AgenticDesigner/Services/WebExporter.swift
//
// Turns the DesignNode tree into a real, self-contained web page — the
// foundation of the Lovable-style loop: the same HTML drives the live
// in-app web preview AND the deployable artifact. No build toolchain: one
// responsive .html file that runs anywhere (WKWebView, any browser, any
// static host). Children are positioned relative to their parent (matching
// the canvas), so the web render mirrors the design.

import type { DesignNode, NodeStyle } from '../models/DesignNode';
import type { GradientStyle } from '../models/GradientStyle';
import type { LogicFlow, LogicVariable } from '../models/LogicModels';
import type { SupabaseConfig } from '../models/SupabaseConfig';
import type { GeneratedFileTree } from './GeneratedFileTree';
import { LogicWebCompiler, type Compiled } from './LogicWebCompiler';

export interface WebExportOptions {
  screens: DesignNode[];
  appName: string;
  flows?: LogicFlow[];
  globalVariables?: LogicVariable[];
  supabase?: SupabaseConfig;
  interactive?: boolean;
}

export const WebExporter = {
  /**
   * `WebExporter.html(for:appName:flows:globalVariables:supabase:interactive:)`
   *
   * A complete, standalone HTML document. With `flows`, the page is a REAL
   * interactive app: taps run the logic (navigation, state, toasts) and
   * node bindings re-render — the same behavior as the in-app preview.
   * Without flows it degrades to a faithful static gallery.
   */
  html({ screens, appName, flows = [], globalVariables = [], supabase, interactive = true }: WebExportOptions): string {
    const runtime: Compiled | undefined =
      interactive && flows.length > 0
        ? LogicWebCompiler.compile({ screens, flows, globals: globalVariables, supabase })
        : undefined;

    const mockups = screens
      .map((screen, index) => {
        const inner = childrenHTML(screen.children);
        const frameStyle = style(screen, true);
        // Interactive: one device at a time, JS swaps screens.
        const hidden = runtime !== undefined && index > 0 ? ' hidden' : '';
        return `<div class="screen${hidden}" data-screen-id="${screen.id}">
  <div class="device" style="${frameStyle}">${inner}</div>
  <div class="screen-label">${escape(screen.name)}</div>
</div>`;
      })
      .join('\n');

    const navBar =
      runtime === undefined
        ? ''
        : `<div class="screen-nav">
  ${screens.map((s) => `<button data-goto="${s.id}">${escape(s.name)}</button>`).join('\n')}
</div>`;

    // The program is a parsed JSON block + a separate runtime script —
    // never user text spliced into executable JS (see the XSS note in the
    // compiler).
    const script = runtime ? `${runtime.dataBlock}\n${runtime.runtimeScript}` : '';

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(appName)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    background: #EDF0F4;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
    padding: 32px 40px 48px;
    display: flex; flex-wrap: wrap; gap: 48px;
    align-items: flex-start; justify-content: center;
  }
  .screen { display: flex; flex-direction: column; align-items: center; gap: 12px; }
  .screen.hidden { display: none; }
  .device { position: relative; overflow: hidden; flex: none;
            box-shadow: 0 24px 60px rgba(20,28,45,0.18); }
  .screen-label { font-size: 13px; color: #6B7280; font-weight: 500; }
  .node { position: absolute; }
  .btn { border: none; cursor: pointer; display: flex;
         align-items: center; justify-content: center; }
  input.node { outline: none; }
  .img-ph { display: flex; align-items: center; justify-content: center;
            color: #9AA3AF; font-size: 12px; background: #E7EBF0; }
  [data-tap] { cursor: pointer; transition: transform .08s ease, filter .12s ease; }
  [data-tap]:active { transform: scale(0.97); filter: brightness(0.94); }
  .screen-nav { width: 100%; display: flex; gap: 8px; justify-content: center;
                flex-wrap: wrap; margin-bottom: 4px; }
  .screen-nav button { border: none; background: #FFFFFF; color: #4B5563;
                       padding: 7px 14px; border-radius: 999px; cursor: pointer;
                       font-size: 12px; font-weight: 600;
                       box-shadow: 0 1px 3px rgba(20,28,45,0.10); }
  .screen-nav button.active { background: #111827; color: #FFFFFF; }
  #toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
           background: rgba(17,24,39,0.94); color: #fff; padding: 12px 20px;
           border-radius: 12px; font-size: 14px; opacity: 0; pointer-events: none;
           transition: opacity .2s ease, transform .2s ease; z-index: 99; }
  #toast.show { opacity: 1; transform: translateX(-50%) translateY(-6px); }
  @media (prefers-color-scheme: dark) { body { background: #0F1115; } }
</style>
</head>
<body>
${navBar}
${mockups}
<div id="toast"></div>
${script}
</body>
</html>`;
  },

  /**
   * The same document as a file tree. `WebPreviewView.saveHTML()` names the
   * file `<project name with spaces replaced by ->.html`
   * (`Views/WebPreviewView.swift:54-60`).
   */
  files(options: WebExportOptions): GeneratedFileTree {
    const fileName = `${options.appName.split(' ').join('-')}.html`;
    return { [fileName]: WebExporter.html(options) };
  },
} as const;

// MARK: - Node rendering

function childrenHTML(children: DesignNode[]): string {
  return [...children]
    .sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))
    .map(nodeHTML)
    .join('\n');
}

function nodeHTML(node: DesignNode): string {
  const s = style(node, false);
  // The runtime finds nodes by id to run taps and apply bindings.
  const id = ` data-node-id="${node.id}"`;
  switch (node.type) {
    case 'Text':
      return `<div class="node"${id} style="${s}">${escape(node.text ?? '')}</div>`;
    case 'Button':
      return `<button class="node btn"${id} style="${s}">${escape(node.text ?? '')}</button>`;
    case 'Input': {
      const placeholder = escape(node.text ?? '');
      return `<input class="node"${id} placeholder="${placeholder}" style="${s}">`;
    }
    case 'Image': {
      const src = node.imageSource ?? node.imageName;
      if (src !== undefined && isRenderableSource(src)) {
        return `<img class="node"${id} src="${escape(src)}" style="${s}object-fit:cover;">`;
      }
      return `<div class="node img-ph"${id} style="${s}">${escape(node.text ?? 'image')}</div>`;
    }
    case 'Icon': {
      const glyph = iconGlyph(node.iconName);
      return `<div class="node"${id} style="${s}display:flex;align-items:center;justify-content:center;font-size:${Math.trunc(
        Math.min(node.width, node.height) * 0.7,
      )}px;">${glyph}</div>`;
    }
    case 'Rectangle':
    case 'Frame':
      return `<div class="node"${id} style="${s}">${childrenHTML(node.children)}</div>`;
  }
}

// MARK: - Style

function style(node: DesignNode, isScreenRoot: boolean): string {
  const css: string[] = [];
  const st: NodeStyle = node.style;

  if (!isScreenRoot) {
    css.push(`left:${px(node.x)}`);
    css.push(`top:${px(node.y)}`);
  }
  css.push(`width:${px(node.width)}`);
  css.push(`height:${px(node.height)}`);

  // Background: gradient wins over flat fill.
  if (st.gradient && st.gradient.colors.length >= 2) {
    css.push(`background:${cssGradient(st.gradient)}`);
  } else if (isRenderableColor(st.fill)) {
    css.push(`background:${st.fill}`);
  }

  if (st.stroke !== undefined && isRenderableColor(st.stroke) && (st.strokeWidth ?? 0) > 0) {
    css.push(`border:${px(st.strokeWidth ?? 1)} solid ${st.stroke}`);
  }
  css.push(`border-radius:${px(st.cornerRadius)}`);
  if (st.opacity < 1) css.push(`opacity:${swiftNumber(st.opacity)}`);
  if (st.blur !== undefined && st.blur > 0) css.push(`backdrop-filter:blur(${px(st.blur)})`);

  if (st.shadow && st.shadow.opacity > 0) {
    css.push(
      `box-shadow:${px(st.shadow.x)} ${px(st.shadow.y)} ${px(st.shadow.radius)} ${rgba(
        st.shadow.color,
        st.shadow.opacity,
      )}`,
    );
  }

  // Text styling (applies to Text/Button/Input).
  if (st.fontSize !== undefined) css.push(`font-size:${px(st.fontSize)}`);
  if (st.fontWeight !== undefined) css.push(`font-weight:${cssWeight(st.fontWeight)}`);
  if (st.textColor !== undefined && isRenderableColor(st.textColor)) css.push(`color:${st.textColor}`);
  if (st.textAlign !== undefined) css.push(`text-align:${st.textAlign}`);
  if (st.letterSpacing !== undefined) css.push(`letter-spacing:${px(st.letterSpacing)}`);
  if (node.type === 'Text') {
    css.push('display:flex');
    css.push('align-items:center');
    if (st.textAlign === 'center') css.push('justify-content:center');
    css.push('overflow:hidden');
  }

  // Padding.
  const pt = st.paddingTop ?? 0;
  const pr = st.paddingRight ?? 0;
  const pb = st.paddingBottom ?? 0;
  const pl = st.paddingLeft ?? 0;
  if (pt + pr + pb + pl > 0) {
    css.push(`padding:${px(pt)} ${px(pr)} ${px(pb)} ${px(pl)}`);
  }

  // Flex layout when the node declares a stack direction.
  if (st.layout !== undefined) {
    const layout = st.layout.toLowerCase();
    const isRow = ['row', 'horizontal', 'hstack'].includes(layout);
    css.push('display:flex');
    css.push(`flex-direction:${isRow ? 'row' : 'column'}`);
    if (st.spacing !== undefined) css.push(`gap:${px(st.spacing)}`);
  }

  return `${css.join(';')};`;
}

// MARK: - Helpers

function px(v: number): string {
  return `${Math.trunc(swiftRounded(v))}px`;
}

/** Swift `.rounded()` — half away from zero. */
function swiftRounded(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Swift string interpolation of a Double (`"\(0.5)"` → "0.5", `"\(1.0)"` → "1.0"). */
function swiftNumber(value: number): string {
  return Number.isInteger(value) ? `${value}.0` : String(value);
}

function cssWeight(weight: string): string {
  switch (weight.toLowerCase()) {
    case 'bold':
      return '700';
    case 'semibold':
      return '600';
    case 'medium':
      return '500';
    case 'light':
      return '300';
    case 'heavy':
    case 'black':
      return '800';
    default:
      return /^[0-9]+$/.test(weight) ? weight : '400';
  }
}

function cssGradient(g: GradientStyle): string {
  // SwiftUI angle: 0 = top→bottom, 90 = left→right. CSS: 180 = to bottom.
  const cssAngle = 180 - (g.angle ?? 0);
  let stops: string[];
  const positions = g.stops;
  if (positions !== undefined && positions.length === g.colors.length) {
    stops = g.colors.map((color, i) => `${color} ${Math.trunc(positions[i]! * 100)}%`);
  } else {
    stops = g.colors;
  }
  if (g.type.toLowerCase() === 'radial') {
    return `radial-gradient(circle, ${stops.join(', ')})`;
  }
  return `linear-gradient(${Math.trunc(cssAngle)}deg, ${stops.join(', ')})`;
}

function rgba(hex: string, opacity: number): string {
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const value = /^[0-9a-fA-F]{6}$/.test(clean) ? parseInt(clean, 16) : undefined;
  if (clean.length !== 6 || value === undefined) {
    return `rgba(0,0,0,${swiftNumber(opacity)})`;
  }
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r},${g},${b},${swiftNumber(opacity)})`;
}

function isRenderableColor(hex: string | undefined): boolean {
  if (hex === undefined || !hex.startsWith('#')) return false;
  return hex.length === 7 || hex.length === 9 || hex.length === 4;
}

function isRenderableSource(src: string): boolean {
  return src.startsWith('http') || src.startsWith('data:') || src.startsWith('/');
}

// A pragmatic SF-Symbol → emoji map for the web preview (icons are
// decorative in these designs; exact glyphs aren't load-bearing).
function iconGlyph(name: string | undefined): string {
  if (name === undefined) return '•';
  const lower = name.toLowerCase();
  const map: Record<string, string> = {
    house: '🏠',
    'house.fill': '🏠',
    magnifyingglass: '🔍',
    heart: '♡',
    'heart.fill': '♥',
    person: '👤',
    'person.fill': '👤',
    'person.crop.circle': '👤',
    bell: '🔔',
    'bell.fill': '🔔',
    gear: '⚙',
    gearshape: '⚙',
    plus: '＋',
    star: '★',
    'star.fill': '★',
    'chart.bar': '📊',
    'chart.bar.fill': '📊',
    cart: '🛒',
    'cart.fill': '🛒',
    bag: '🛍',
    creditcard: '💳',
    calendar: '📅',
    clock: '🕐',
    map: '🗺',
    location: '📍',
    message: '💬',
    paperplane: '➤',
    bookmark: '🔖',
    flame: '🔥',
    bolt: '⚡',
    checkmark: '✓',
    'chevron.right': '›',
    'chevron.left': '‹',
    'arrow.left': '←',
    xmark: '✕',
  };
  return map[lower] ?? '•';
}

function escape(text: string): string {
  return text
    .split('&')
    .join('&amp;')
    .split('<')
    .join('&lt;')
    .split('>')
    .join('&gt;')
    .split('"')
    .join('&quot;');
}
