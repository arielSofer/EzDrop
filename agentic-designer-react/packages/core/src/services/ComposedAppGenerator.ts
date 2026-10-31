// Ported 1:1 from AgenticDesigner/Services/ComposedAppGenerator.swift
//
// Quality-first generation: the model DECIDES (screens, registry
// components, copy, style) as a compact JSON; the component factory RENDERS
// those decisions with the same deterministic assembly the template gallery
// uses. Layout polish comes from code, content from the model — so even a
// small local model produces clean screens, in seconds, reliably.

import { decodeDesignAgentResponse, type DesignAction } from '../agent/DesignAction';
import { AppShotsDesignKnowledge } from '../designIntelligence/AppShotsDesignKnowledge';
import { DesignTokenLibrary } from '../designIntelligence/DesignTokenLibrary';
import { AllComponentType, type ComponentType } from '../models/ComponentType';
import { isPlainObject } from '../models/codec';
import type { DesignNode } from '../models/DesignNode';
import type { JSONObject, JSONValue } from '../models/JSON';
import { AllVisualStylePreset, type VisualStylePreset } from '../models/VisualStylePreset';
import type { ComposedDesignHost, ComposerMessage, ComposerProvider } from './themeHosts';

// MARK: - Decoded model output

export interface ComposedApp {
  appName?: string;
  style?: string;
  screens: ComposedScreen[];
}

export interface ComposedScreen {
  name: string;
  components: ComposedComponent[];
  bottomBar?: boolean;
}

export interface ComposedComponent {
  type: string;
  props?: Record<string, string>;
}

export interface ComposedAppResult {
  screenCount: number;
  actionCount: number;
  style: VisualStylePreset;
}

/**
 * `ComposedComponent.init(from:)` — small local models routinely emit numbers
 * or bools inside props ("progress": 0.85, "count": 12). A strict
 * [String: String] decode rejects the ENTIRE app for one such value — the
 * exact cause of "Composer returned no screens". Each value is coerced to a
 * string (which is what the component factory reads anyway).
 * Returns undefined for the `Failable<ComposedComponent>` (`try?`) path.
 */
export function decodeComposedComponent(json: unknown): ComposedComponent | undefined {
  if (!isPlainObject(json)) return undefined;
  const type = json['type'];
  if (typeof type !== 'string') return undefined; // `try container.decode` — the one required field.
  const nested = json['props'];
  if (!isPlainObject(nested)) return { type };
  const dict: Record<string, string> = {};
  for (const key of Object.keys(nested)) {
    const value = nested[key];
    if (typeof value === 'string') dict[key] = value;
    else if (typeof value === 'boolean') dict[key] = value ? 'true' : 'false';
    else if (typeof value === 'number' && Number.isFinite(value)) {
      dict[key] = value === Math.round(value) ? String(Math.trunc(value)) : swiftDoubleDescription(value);
    }
  }
  return { type, props: dict };
}

/** Swift `String(_ value: Double)` — always carries a decimal point. */
function swiftDoubleDescription(value: number): string {
  const text = String(value);
  return text.includes('.') || text.includes('e') || text.includes('E') ? text : `${text}.0`;
}

/** `ComposedScreen.init(from:)` */
export function decodeComposedScreen(json: unknown): ComposedScreen | undefined {
  if (!isPlainObject(json)) return undefined;
  // A missing name shouldn't cost a whole screen of real components.
  const rawName = json['name'];
  const name = typeof rawName === 'string' ? rawName : 'Screen';
  const rawComponents = json['components'];
  const components = Array.isArray(rawComponents)
    ? rawComponents.map(decodeComposedComponent).filter((c): c is ComposedComponent => c !== undefined)
    : [];
  // bottomBar may arrive as a bool or the string "true".
  const rawBottomBar = json['bottomBar'];
  let bottomBar: boolean | undefined;
  if (typeof rawBottomBar === 'boolean') bottomBar = rawBottomBar;
  else if (typeof rawBottomBar === 'string') bottomBar = rawBottomBar.toLowerCase() === 'true';
  const screen: ComposedScreen = { name, components };
  if (bottomBar !== undefined) screen.bottomBar = bottomBar;
  return screen;
}

/** `ComposedApp.init(from:)` — a malformed screen is skipped, never fatal. */
export function decodeComposedApp(json: unknown): ComposedApp {
  if (!isPlainObject(json)) throw new Error('ComposedApp must be a JSON object.');
  const appName = json['appName'];
  const style = json['style'];
  const rawScreens = json['screens'];
  const screens = Array.isArray(rawScreens)
    ? rawScreens.map(decodeComposedScreen).filter((s): s is ComposedScreen => s !== undefined)
    : [];
  const app: ComposedApp = { screens };
  if (typeof appName === 'string') app.appName = appName;
  if (typeof style === 'string') app.style = style;
  return app;
}

// MARK: - Prompting

/**
 * `ComposedAppGenerator.responseSchema` — the shape `generate` demands back.
 * Passed to Ollama's `format` so the decoder cannot leave it; every field is
 * required so a weak model can't silently omit `screens` and produce
 * "Composer returned no screens". `props` is intentionally loose (string
 * values) because that is what ComposedComponent already coerces.
 */
export const responseSchema: JSONObject = {
  type: 'object',
  required: ['appName', 'style', 'screens'],
  properties: {
    appName: { type: 'string' },
    style: { type: 'string' },
    screens: {
      type: 'array',
      minItems: 5,
      maxItems: 7,
      items: {
        type: 'object',
        required: ['name', 'bottomBar', 'components'],
        properties: {
          name: {
            type: 'string',
            description:
              'Specific screen name, for example Today or Run Setup. Use name, never title, at screen level.',
          },
          bottomBar: {
            type: 'boolean',
            description: 'False for onboarding/entry/modal steps; true for core destinations.',
          },
          components: {
            type: 'array',
            minItems: 3,
            maxItems: 5,
            items: {
              type: 'object',
              required: ['type', 'props'],
              properties: {
                type: {
                  type: 'string',
                  description: 'A ComponentType raw value supported by the deterministic component factory.',
                },
                props: {
                  type: 'object',
                  description:
                    'Put every piece of product copy and data INSIDE props. Never flatten title, subtitle, label, items or values beside props.',
                  additionalProperties: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
  },
};

export function systemPrompt(): string {
  const componentList = AllComponentType.join(', ');
  const styleList = AllVisualStylePreset.join(', ');
  return `You are a senior mobile product designer. Compose a REAL, complete app from a component library. Respond with ONE JSON object only, no prose, no markdown fences:
{"appName": "...", "style": "<one of: ${styleList}>", "screens": [{"name": "...", "bottomBar": true, "components": [{"type": "<one of: ${componentList}>", "props": {"...": "..."}}]}]}

Quality rules:
- 5 to 7 purposeful screens; 3 to 5 components each, top-to-bottom order.
- The screens must form one continuous task journey. Entry screens do not use a bottom bar; core product screens do.
- Fill EVERY prop with specific, real, on-brand copy for THIS product — actual names, real prices, real numbers. Never generic filler ("Featured", "A beautiful moment", "Item").
- Pick components that FIT the product: a store uses product/content cards; fitness uses progressRing/workoutCard/statCard; finance uses balanceHeroCard/transactionList. Do NOT put finance/stock components in a store.
- Multi-item components (quickActionRow, categoryChips) take a comma list in "items" (e.g. "items": "Running, Training, Lifestyle").
- For progressRing, put the human-readable metric in "value" ("18.4 / 25 km") and the completion fraction in "progress" ("0.74"). For workoutCard include duration, distance, intensity and status.
- Every onboarding, setup, checkout, confirmation or live-task screen needs a visible primaryButton/secondaryButton for its next action; never rely only on invisible flow wiring.
- Keys: title, subtitle, value, amount, price, greeting, name, items, description, text, cta.

${AppShotsDesignKnowledge.composerGuide}

GOLD EXAMPLE (match this specificity, adapt to the user's product):
{"appName":"Aroma","style":"minimalEditorial","screens":[
  {"name":"Menu","bottomBar":true,"components":[
    {"type":"avatarGreetingHeader","props":{"greeting":"Good morning","name":"Noa"}},
    {"type":"heroCard","props":{"title":"Ethiopia Yirgacheffe","subtitle":"Bright, floral single-origin","cta":"Order now"}},
    {"type":"quickActionRow","props":{"items":"Espresso, Filter, Cold Brew, Beans"}},
    {"type":"contentCard","props":{"title":"Oat Flat White","subtitle":"Creamy, low-acidity — $4.80"}}
  ]}
]}`;
}

// MARK: - Assembly (mirrors TemplateFactory's stack layout)

const screenSize = { width: 390, height: 844 };
const margin = 20;
const gap = 16;
const topInset = 64;

function componentType(raw: string): ComponentType | undefined {
  // `ComponentType(rawValue:)` — the STRICT initializer, not the lenient decoder.
  return (AllComponentType as readonly string[]).includes(raw) ? (raw as ComponentType) : undefined;
}

/**
 * Estimated stack height per component family — layout is code's job,
 * so the model never supplies coordinates.
 */
export function height(type: string, props: Record<string, string> | undefined): number {
  switch (componentType(type)) {
    case 'avatarGreetingHeader': return 64;
    case 'header': return 56;
    case 'searchBar':
    case 'textField': return 54;
    case 'categoryChips': return 48;
    case 'balanceHeroCard': return 180;
    case 'heroCard': return 210;
    case 'imageHero':
    case 'imageCard':
    case 'maskedImage':
    case 'productImage': return 220;
    case 'progressRing': return 200;
    case 'workoutCard': return 140;
    case 'chartCard': return 240;
    case 'metricCard':
    case 'statCard':
    case 'currencyCard': return 110;
    case 'transactionList': return 260;
    case 'productGrid': return 300;
    case 'quickActionRow': return 92;
    case 'chatMessage': return Math.max(70, charCount(props?.['text'] ?? '') * 0.6 + 60);
    case 'primaryButton':
    case 'secondaryButton': return 58;
    case 'contentCard': return 130;
    case 'toggleRow':
    case 'controlButton': return 64;
    case 'progressBar': return 72;
    case 'insightCard':
    case 'progressCard': return 130;
    case 'largeIconTile': return 120;
    case 'iconFeatureGrid': return 170;
    default: return 120;
  }
}

/** `ComposedAppGenerator.generate(prompt:provider:viewModel:referenceImageDataURLs:)` */
export async function generate(
  prompt: string,
  provider: ComposerProvider,
  viewModel: ComposedDesignHost,
  /**
   * Reference screenshots to design FROM. The composer emits the same
   * decision-JSON either way, so an imported screen goes through the
   * exact deterministic ComponentFactory path as a prompted one — the
   * import inherits the quality floor instead of needing its own.
   */
  referenceImageDataURLs: string[] = [],
): Promise<ComposedAppResult> {
  const messages: ComposerMessage[] = [
    { role: 'system', content: systemPrompt() },
    { role: 'user', content: prompt, imageDataURLs: referenceImageDataURLs },
  ];

  let composed: ComposedApp | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Local models get grammar-constrained decoding: the schema below
    // makes a stringified array or a broken quote structurally
    // impossible, which is where every weak-model failure came from.
    const content = await provider.generateConstrainedJSON(messages, responseSchema);
    const parsed = decode(content);
    if (parsed) {
      composed = parsed;
      break;
    }
    messages.push({ role: 'assistant', content });
    messages.push({
      role: 'user',
      content: 'That was not valid JSON matching the schema. Return the corrected JSON object only.',
    });
  }
  if (composed === undefined || composed.screens.length === 0) {
    // `AIProviderError.invalidJSON`
    throw new Error('Composer returned no screens.');
  }

  return applyComposed(composed, viewModel);
}

/**
 * `ComposedAppGenerator.applyComposition(jsonObject:viewModel:)` — the same
 * deterministic renderer used by the AI composer, exposed to the Agent Loop
 * as a small structured tool. Weak models only decide product intent and
 * copy; code owns every coordinate, token and navigation rail.
 */
export function applyComposition(jsonObject: JSONObject, viewModel: ComposedDesignHost): ComposedAppResult {
  if (!isValidJSONObject(jsonObject)) {
    throw new Error('Composition is not a valid JSON object.');
  }
  const composed = decodeComposedApp(jsonObject);
  if (composed.screens.length === 0) {
    throw new Error('Composition needs at least one screen.');
  }
  return applyComposed(composed, viewModel);
}

function isValidJSONObject(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

function applyComposed(composed: ComposedApp, viewModel: ComposedDesignHost): ComposedAppResult {
  const declared = composed.style;
  const style: VisualStylePreset =
    (declared !== undefined && (AllVisualStylePreset as readonly string[]).includes(declared)
      ? (declared as VisualStylePreset)
      : undefined) ?? AppShotsDesignKnowledge.recommendedStyle(composed.appName ?? '');
  const tokens = DesignTokenLibrary.tokens(style);

  // Navigation is derived from real screen names, never invented as
  // Home/Discover/Favorites/Profile when those destinations do not exist.
  const coreScreens = composed.screens.filter((s) => s.bottomBar ?? false);
  const navigationScreens = navigationDestinations(coreScreens.length === 0 ? composed.screens : coreScreens);
  const navigationProps = bottomNavigationProps(navigationScreens);

  const actionDicts: JSONObject[] = [];
  composed.screens.forEach((screen, index) => {
    const screenRef = `screen_${index}`;
    const originX = 100 + index * (screenSize.width + 60);
    actionDicts.push({
      type: 'createFrame',
      name: screen.name,
      nodeReference: screenRef,
      x: originX,
      y: 100,
      width: screenSize.width,
      height: screenSize.height,
      fill: tokens.colors.backgroundPrimary,
      cornerRadius: 40,
    });
    let cursorY = topInset;
    const renderComponents = augmentedComponents(screen);
    renderComponents.forEach((component, componentIndex) => {
      const componentHeight = height(component.type, component.props);
      actionDicts.push({
        type: 'createComponent',
        component: component.type,
        props: (component.props ?? {}) as JSONValue,
        parentReference: screenRef,
        nodeReference: `${screenRef}_c${componentIndex}`,
        stylePreset: style,
        x: margin,
        y: cursorY,
        width: screenSize.width - margin * 2,
        height: componentHeight,
      });
      cursorY += componentHeight + gap;
    });
    if (screen.bottomBar ?? false) {
      const screenNavigationProps: Record<string, string> = { ...navigationProps };
      screenNavigationProps['activeIndex'] = String(navigationActiveIndex(screen, navigationScreens) + 1);
      actionDicts.push({
        type: 'createComponent',
        component: 'bottomNavBar',
        props: screenNavigationProps as JSONValue,
        parentReference: screenRef,
        nodeReference: `${screenRef}_nav`,
        stylePreset: style,
        x: 0,
        y: screenSize.height - 88,
        width: screenSize.width,
        height: 88,
      });
    }
  });

  const payload: JSONObject = { plan: [], actions: actionDicts as unknown as JSONValue };
  const actions: DesignAction[] = decodeDesignAgentResponse(payload).actions;
  // Replace the page only now that we have a valid, decoded app — never
  // before, or a generation failure would destroy the existing design.
  const pageIndex = viewModel.currentPageIndex;
  viewModel.mutateProject((project) => {
    const page = project.pages[pageIndex];
    if (page === undefined) return;
    page.nodes = [];
    page.logicFlows = [];
  });
  viewModel.applyDesignActions(actions);
  enforceScreenHierarchy(viewModel);
  const appName = composed.appName?.trim();
  if (appName !== undefined && appName.length > 0) {
    viewModel.mutateProject((project) => {
      project.name = appName;
    });
  }

  return { screenCount: composed.screens.length, actionCount: actions.length, style };
}

/**
 * Guarantee that task states visibly expose their next action. A flow
 * attached to a card or root frame may technically navigate, but it is not
 * a legible product UI and would not survive an AppShots-quality review.
 */
function augmentedComponents(screen: ComposedScreen): ComposedComponent[] {
  const components = screen.components.slice(0, 5);
  const hasCTA = components.some((c) => c.type === 'primaryButton' || c.type === 'secondaryButton');
  const label = requiredCTALabel(screen.name);
  if (hasCTA || label === undefined) return components;

  const button: ComposedComponent = { type: 'primaryButton', props: { label } };
  if (components.length < 5) {
    components.push(button);
  } else {
    components[components.length - 1] = button;
  }
  return components;
}

function requiredCTALabel(screenName: string): string | undefined {
  const key = screenName.toLowerCase();
  if (key.includes('onboarding') || key.includes('welcome')) return 'Get Started';
  if (key.includes('setup') || key.includes('configure')) return 'Continue';
  if (key.includes('live') || key.includes('active')) return 'Finish & Save';
  if (key.includes('checkout') || key.includes('cart')) return 'Continue to Checkout';
  if (key.includes('confirm') || key.includes('success')) return 'Done';
  return undefined;
}

/**
 * AppShots' strongest recurring hierarchy rule is one unmistakable focal
 * title or metric per screen. Component combinations such as
 * avatarGreetingHeader + workoutCard can otherwise top out at 20pt even
 * when the model made good content decisions. Promote the first largest
 * text deterministically so every composed screen has a 26pt anchor.
 */
function enforceScreenHierarchy(viewModel: ComposedDesignHost): void {
  const pageIndex = viewModel.currentPageIndex;
  viewModel.mutateProject((project) => {
    const page = project.pages[pageIndex];
    if (page === undefined) return;
    for (const root of page.nodes) {
      const largest = largestTextSize(root);
      if (largest < 24) promoteFirstText(root, largest);
    }
  });
}

function largestTextSize(node: DesignNode): number {
  const own = node.type === 'Text' ? node.style.fontSize ?? 0 : 0;
  return node.children.reduce((acc, child) => Math.max(acc, largestTextSize(child)), own);
}

function promoteFirstText(node: DesignNode, size: number): boolean {
  if (
    node.type === 'Text' &&
    Math.abs((node.style.fontSize ?? 0) - size) < 0.1 &&
    (node.text ?? '').trim().length > 0
  ) {
    node.style.fontSize = 26;
    node.style.fontWeight = 'bold';
    node.height = Math.max(node.height, 34);
    if (node.textBehavior?.wrap === true) {
      const behavior = { ...(node.textBehavior ?? {}) };
      behavior.wrap = true;
      behavior.autoHeight = true;
      behavior.maxLines = Math.max(2, behavior.maxLines ?? 2);
      behavior.truncate = false;
      node.textBehavior = behavior;
      node.height = Math.max(node.height, 60);
    }
    return true;
  }
  for (const child of node.children) {
    if (promoteFirstText(child, size)) return true;
  }
  return false;
}

function bottomNavigationProps(screens: ComposedScreen[]): Record<string, string> {
  const candidates: [string, string][] = screens.map((screen) => {
    const trimmed = screen.name.trim();
    const label = trimmed.split(' ').filter((s) => s.length > 0)[0] ?? 'Home';
    return [label, navigationIcon(label)];
  });
  const fallbacks: [string, string][] = [
    ['Home', 'house.fill'],
    ['Explore', 'magnifyingglass'],
    ['Saved', 'heart.fill'],
    ['Profile', 'person.fill'],
  ];
  for (const fallback of fallbacks) {
    if (candidates.length < 4 && !candidates.some((c) => c[0] === fallback[0])) candidates.push(fallback);
  }
  const props: Record<string, string> = {};
  candidates.slice(0, 4).forEach((item, index) => {
    props[`label${index + 1}`] = item[0];
    props[`icon${index + 1}`] = item[1];
  });
  return props;
}

/**
 * Choose stable app-level destinations instead of blindly taking the
 * first four flow steps. A Run Setup and Live Run may both exist, but the
 * bottom bar should still read Today / Run / Progress / Profile.
 */
function navigationDestinations(screens: ComposedScreen[]): ComposedScreen[] {
  const preferenceGroups = [
    ['home', 'today', 'feed'],
    ['run', 'workout', 'session', 'explore', 'search'],
    ['progress', 'analytics', 'history', 'saved'],
    ['profile', 'settings', 'account'],
  ];
  const selected: ComposedScreen[] = [];
  for (const group of preferenceGroups) {
    const match = screens.find((screen) => {
      const key = screen.name.toLowerCase();
      return group.some((g) => key.includes(g));
    });
    if (match && !selected.some((s) => s.name === match.name)) selected.push(match);
  }
  for (const screen of screens) {
    if (selected.length < 4 && !selected.some((s) => s.name === screen.name)) selected.push(screen);
  }
  return selected.slice(0, 4);
}

function navigationActiveIndex(screen: ComposedScreen, destinations: ComposedScreen[]): number {
  const key = screen.name.toLowerCase();
  const exact = destinations.findIndex((d) => d.name.toLowerCase() === screen.name.toLowerCase());
  if (exact >= 0) return exact;
  if (key.includes('run') || key.includes('workout') || key.includes('session')) {
    const match = destinations.findIndex((d) => {
      const candidate = d.name.toLowerCase();
      return candidate.includes('run') || candidate.includes('workout') || candidate.includes('session');
    });
    if (match >= 0) return match;
  }
  if (key.includes('profile') || key.includes('setting') || key.includes('account')) {
    const match = destinations.findIndex((d) => {
      const candidate = d.name.toLowerCase();
      return candidate.includes('profile') || candidate.includes('setting') || candidate.includes('account');
    });
    if (match >= 0) return match;
  }
  return 0;
}

function navigationIcon(label: string): string {
  const value = label.toLowerCase();
  const mappings: [string, string][] = [
    ['home', 'house.fill'], ['today', 'house.fill'], ['feed', 'rectangle.stack.fill'],
    ['explore', 'safari.fill'], ['discover', 'safari.fill'], ['search', 'magnifyingglass'],
    ['shop', 'bag.fill'], ['catalog', 'square.grid.2x2.fill'], ['order', 'shippingbox.fill'],
    ['cart', 'cart.fill'], ['chat', 'bubble.left.and.bubble.right.fill'], ['message', 'message.fill'],
    ['history', 'clock.fill'], ['analytics', 'chart.bar.fill'], ['progress', 'chart.line.uptrend.xyaxis'],
    ['saved', 'heart.fill'], ['favorite', 'heart.fill'], ['profile', 'person.fill'],
    ['setting', 'gearshape.fill'], ['community', 'person.3.fill'],
  ];
  return mappings.find((m) => value.includes(m[0]))?.[1] ?? 'circle.grid.2x2.fill';
}

// MARK: - Image slots

/**
 * `ComposedAppGenerator.fillImages(appPrompt:viewModel:provider:maxImages:)` —
 * generates a real image for each image slot the composed app produced and
 * patches it in. Sequential (FLUX on MLX is heavy) and capped so a build
 * stays minutes, not tens of minutes. Any failure (no backend) is skipped,
 * leaving the placeholder — a build never fails for lack of images.
 */
export async function fillImages(
  appPrompt: string,
  viewModel: ComposedDesignHost,
  provider: ComposerProvider,
  maxImages: number = 4,
): Promise<number> {
  const pageIndex = viewModel.currentPageIndex;
  const page = viewModel.project.pages[pageIndex];
  if (page === undefined) return 0;
  const screens = page.nodes.filter((n) => n.type === 'Frame');

  // Collect image slots with a subject drawn from the enclosing card's
  // title (so a product card's image is OF that product).
  const targets: { id: string; prompt: string }[] = [];
  function collect(node: DesignNode, subject: string | undefined): void {
    const cardTitle =
      node.type === 'Frame'
        ? node.children.find((c) => c.type === 'Text' && (c.text ?? '').trim().length > 0)?.text
        : undefined;
    const context = cardTitle ?? subject;
    if (node.type === 'Image') {
      targets.push({ id: node.id, prompt: imageSlotPrompt(context ?? node.name, appPrompt) });
    }
    for (const child of node.children) collect(child, context);
  }
  for (const screen of screens) collect(screen, screen.name);
  if (targets.length === 0) return 0;

  let count = 0;
  for (const target of targets.slice(0, maxImages)) {
    try {
      const path = await provider.generateImageAsset(target.prompt, 'hero', undefined, undefined, '512x512');
      viewModel.setGeneratedImage(target.id, path);
      count += 1;
    } catch {
      // `try?` — a missing image backend never fails the build.
    }
  }
  return count;
}

function imageSlotPrompt(subject: string, app: string): string {
  return `${subject}, professional product photography, clean minimal studio background, soft lighting, high detail — for a ${app}`;
}

function decode(content: string): ComposedApp | undefined {
  // Models wrap JSON in fences or prose — find the outermost object.
  const start = content.indexOf('{');
  if (start < 0) return undefined;
  const end = content.lastIndexOf('}');
  if (end >= 0) {
    const json = content.slice(start, end + 1);
    try {
      const app = decodeComposedApp(JSON.parse(json));
      if (app.screens.length > 0) return app;
    } catch {
      // fall through to salvage
    }
  }
  // A longer, richer response can get truncated mid-array — salvage the
  // complete screen objects rather than losing the whole build.
  return salvageTruncated(content.slice(start));
}

/**
 * Extracts every fully-closed screen object from a (possibly truncated)
 * "screens":[ … array and rebuilds a minimal valid ComposedApp.
 */
function salvageTruncated(raw: string): ComposedApp | undefined {
  const keyIndex = raw.indexOf('"screens"');
  if (keyIndex < 0) return undefined;
  const bracket = raw.indexOf('[', keyIndex + '"screens"'.length);
  if (bracket < 0) return undefined;
  const objects: string[] = [];
  let buf = '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const ch of raw.slice(bracket + 1)) {
    if (depth > 0) buf += ch;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) buf = '{';
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) objects.push(buf);
    } else if (ch === ']' && depth === 0) {
      break;
    }
  }
  if (objects.length === 0) return undefined;
  const rebuilt = '{"screens":[' + objects.join(',') + ']}';
  try {
    const app = decodeComposedApp(JSON.parse(rebuilt));
    return app.screens.length > 0 ? app : undefined;
  } catch {
    return undefined;
  }
}

/** Swift `String.count` — code points. */
function charCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** Static members of the Swift `ComposedAppGenerator` enum. */
export const ComposedAppGenerator = {
  responseSchema,
  systemPrompt,
  generate,
  applyComposition,
  fillImages,
  height,
} as const;
