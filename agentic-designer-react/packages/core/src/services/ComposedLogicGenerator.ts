// Ported 1:1 from AgenticDesigner/Services/ComposedLogicGenerator.swift
//
// Reliable interactivity. The free-form logic agent (model authors a whole
// block graph) fails often — on small models it returns empty flows, so
// "generated" apps aren't actually clickable. This takes the same approach
// that fixed design quality: the model only DECIDES intent as a tiny JSON
// ("Continue on Detail → go to Favorites"), and a deterministic engine
// builds correct blocks, parameters and connections.
//
// It also AUTO-WIRES what needs no model at all: bottom tab bars and back
// buttons. Every app gets working navigation even if the model contributes
// nothing.

import { BlockCatalog } from '../models/BlockDefinitions';
import type { DesignNode } from '../models/DesignNode';
import {
  makeBlockConnection,
  makeLogicFlow,
  makeLogicVariable,
  type BlockConnection,
  type LogicBlock,
  type LogicBlockType,
  type LogicFlow,
} from '../models/LogicModels';
import { newUUID } from '../models/uuid';
import type { LogicViewModel } from '../viewModels/LogicViewModel';
import type { DesignHostForLogic, RawChatProvider } from './hosts';

// MARK: - Decoded model output

export interface Interaction {
  /** the element's visible label/name */
  element: string;
  /** which screen it lives on (disambiguates) */
  screen?: string;
  /** navigate | back | toast | toggle | set */
  action: string;
  /** screen name for navigate */
  target?: string;
  /** toast text */
  message?: string;
  /** for toggle/set */
  variable?: string;
  /** for set */
  value?: string;
}

export interface Intents {
  interactions: Interaction[];
}

export interface ComposedLogicResult {
  flowCount: number;
  wiredElements: number;
  autoWired: number;
}

interface ScreenRef {
  id: string;
  name: string;
}

interface BlockChain {
  blocks: LogicBlock[];
  connections: BlockConnection[];
}

export const ComposedLogicGenerator = {
  // MARK: - Entry point

  /** `ComposedLogicGenerator.generate(prompt:provider:design:logic:)` */
  async generate(
    prompt: string,
    provider: RawChatProvider | undefined,
    design: DesignHostForLogic,
    logic: LogicViewModel,
  ): Promise<ComposedLogicResult> {
    const result: ComposedLogicResult = { flowCount: 0, wiredElements: 0, autoWired: 0 };
    const screens = screenList(design);
    if (screens.length === 0) return result;

    // Without this the view model has no back-reference to the project and
    // persist() silently no-ops — flows land in memory and never reach the
    // page, so the app looks wired but exports/previews see nothing.
    logic.attach(design);

    const flows: LogicFlow[] = [];

    // 1. Deterministic auto-wiring — no model, never fails.
    const auto = autoWireFlows(design, screens);
    flows.push(...auto.flows);
    result.autoWired = auto.count;

    // 2. Model-decided interactions (best effort — the app is already
    //    navigable without them).
    if (provider) {
      try {
        const intents = await requestIntents(prompt, provider, design, screens);
        const built = buildFlows(intents, design, screens);
        flows.push(...built.flows);
        result.wiredElements = built.count;
      } catch {
        /* `try?` in the Swift source */
      }
    }

    if (flows.length === 0) return result;
    logic.applyGenerated(flows);
    result.flowCount = flows.length;
    return result;
  },
} as const;

// MARK: - Deterministic auto-wiring

/**
 * Two unambiguous cases need no model:
 *  - a bottom tab bar: tab N goes to screen N (POSITIONAL — real tab
 *    labels like "Home/Discover" rarely match screen names, and matching
 *    them by text wires decorative labels by accident);
 *  - a Back/Close button: goes back.
 * Self-navigation (a tab pointing at the screen it's already on) is
 * skipped — that's the active tab.
 */
function autoWireFlows(design: DesignHostForLogic, screens: ScreenRef[]): { flows: LogicFlow[]; count: number } {
  const flows: LogicFlow[] = [];
  let count = 0;
  // Toggle knobs need an isOn binding on the design node, applied after
  // the walk so we never mutate the tree we're reading.
  const bindings: { nodeId: string; variable: string }[] = [];
  const toggleVariables = new Set<string>();

  for (const screen of screens) {
    const screenNode = findNode(screen.id, design);
    if (!screenNode) continue;
    const blocks: LogicBlock[] = [];
    const connections: BlockConnection[] = [];
    const state = { y: 40 };

    const add = (pair: BlockChain | undefined): void => {
      if (!pair) return;
      blocks.push(...pair.blocks);
      connections.push(...pair.connections);
      count += 1;
      state.y += 120;
    };

    // Tab bar → positional mapping.
    const navBar = navigationBar(screenNode);
    if (navBar) {
      const items = tabItems(navBar);
      // Match each tab to the screen its LABEL names — never by array
      // index. Indexing into screens[] sent "Favorites" to whatever screen
      // happened to sit at that position (often the Cart), because the page
      // also holds Splash/Login/Detail that are not tabs at all.
      for (const item of items) {
        const label = (item.text ?? item.name).trim();
        if (label === '') continue;
        const target = bestScreenMatch(label, screens, screen.id);
        if (!target) continue;
        add(chain(item.id, 'navigate', { screenTarget: target.id, at: state.y }));
      }
    }

    // Back / close buttons (real Buttons only — never stray text).
    for (const element of buttons(screenNode)) {
      const label = (element.text ?? element.name).trim().toLowerCase();
      if (['back', 'close', 'cancel', '←', '‹', 'dismiss'].includes(label)) {
        add(chain(element.id, 'goBack', { at: state.y }));
      }
    }

    // Toggles: tapping the track flips a variable named after the row,
    // and the knob binds to it — so settings screens actually work.
    for (const { track, row } of toggleTracks(screenNode)) {
      const variable = variableName(row);
      add(chain(track.id, 'toggleVariable', { variable, at: state.y }));
      const knob = descendant(track, 'Toggle Knob');
      if (knob) {
        bindings.push({ nodeId: knob.id, variable });
      }
      toggleVariables.add(variable);
    }

    if (blocks.length > 0) {
      flows.push(
        makeLogicFlow({
          name: `${screen.name} Navigation`,
          blocks,
          connections,
          screenNodeId: screen.id,
        }),
      );
    }
  }

  // Toggle state: declare the variables and bind each knob to its own,
  // so the knob visibly reflects the state everywhere it renders.
  if (toggleVariables.size > 0) {
    for (const name of toggleVariables) {
      if (!design.project.globalVariables.some((v) => v.name === name)) {
        design.mutateProject((project) => {
          project.globalVariables.push(
            makeLogicVariable({ name, type: 'boolean', defaultValue: 'false', scope: 'global' }),
          );
        });
      }
    }
    for (const binding of bindings) {
      applyBinding(binding.nodeId, binding.variable, design);
    }
  }
  return { flows, count };
}

// MARK: - Toggle helpers

/**
 * Detect toggles by their inner "Toggle Track" node, not the container's
 * name — applyDesignActions renames component roots, so the row name is
 * unreliable. Returns each track (the tap target) with its row (which
 * holds the Title used to name the variable).
 */
function toggleTracks(screen: DesignNode): { track: DesignNode; row: DesignNode }[] {
  const out: { track: DesignNode; row: DesignNode }[] = [];
  const walk = (node: DesignNode): void => {
    for (const child of node.children) {
      if (child.name === 'Toggle Track') out.push({ track: child, row: node });
      walk(child);
    }
  };
  walk(screen);
  return out;
}

function descendant(node: DesignNode, name: string): DesignNode | undefined {
  for (const child of node.children) {
    if (child.name === name) return child;
    const found = descendant(child, name);
    if (found) return found;
  }
  return undefined;
}

/** "Dark Mode" row -> darkModeEnabled */
function variableName(toggle: DesignNode): string {
  const title = descendant(toggle, 'Title')?.text ?? toggle.name;
  const words = title.split(/[^0-9A-Za-z]+/).filter((w) => w !== '');
  const first = words[0]?.toLowerCase();
  if (first === undefined) return 'toggleEnabled';
  const rest = words.slice(1).map(capitalized).join('');
  return `${first}${rest}Enabled`;
}

/** Swift `String.capitalized` — upper-cases the first letter of each word. */
function capitalized(text: string): string {
  return text.replace(/(^|\s)(\S)(\S*)/g, (_m, lead: string, head: string, tail: string) => {
    return `${lead}${head.toUpperCase()}${tail.toLowerCase()}`;
  });
}

function applyBinding(nodeId: string, variable: string, design: DesignHostForLogic): void {
  const pageIndex = design.currentPageIndex;
  if (!design.project.pages[pageIndex]) return;
  design.mutateProject((project) => {
    const walk = (nodes: DesignNode[]): boolean => {
      for (const node of nodes) {
        if (node.id === nodeId) {
          const existing = node.logicBindings ?? [];
          if (existing.some((b) => b.kind === 'isOn' && b.variableName === variable)) return true;
          existing.push({ id: newUUID(), kind: 'isOn', variableName: variable });
          node.logicBindings = existing;
          return true;
        }
        if (walk(node.children)) return true;
      }
      return false;
    };
    const page = project.pages[pageIndex];
    if (page) walk(page.nodes);
  });
}

/** The bottom tab container (ComponentFactory names it "Bottom Navigation";
 * fall back to any wide, bottom-anchored frame named like a nav/tab bar). */
function navigationBar(screen: DesignNode): DesignNode | undefined {
  let found: DesignNode | undefined;
  const walk = (node: DesignNode): void => {
    const name = node.name.toLowerCase();
    if (node.type === 'Frame' && (name.includes('nav') || name.includes('tab bar') || name.includes('tabbar'))) {
      found = found ?? node;
    }
    node.children.forEach(walk);
  };
  screen.children.forEach(walk);
  return found;
}

/** One tappable per tab, left-to-right. Prefer the label texts; if the bar
 * only has icons, use those. */
function tabItems(navBar: DesignNode): DesignNode[] {
  const labels: DesignNode[] = [];
  const icons: DesignNode[] = [];
  const walk = (node: DesignNode): void => {
    if (node.type === 'Text' && node.text !== undefined && node.text !== '') labels.push(node);
    if (node.type === 'Icon') icons.push(node);
    node.children.forEach(walk);
  };
  navBar.children.forEach(walk);
  const items = labels.length === 0 ? icons : labels;
  return [...items].sort((a, b) => a.x - b.x);
}

function buttons(screen: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  const walk = (node: DesignNode): void => {
    if (node.type === 'Button') out.push(node);
    node.children.forEach(walk);
  };
  screen.children.forEach(walk);
  return out;
}

// MARK: - Model-decided interactions

async function requestIntents(
  prompt: string,
  provider: RawChatProvider,
  design: DesignHostForLogic,
  screens: ScreenRef[],
): Promise<Intents> {
  const screenLines = screens
    .map((screen) => {
      const node = findNode(screen.id, design);
      const elements = node ? tappableDescendants(node) : [];
      const labels = elements
        .map((e) => (e.text ?? e.name).trim())
        .filter((l) => l !== '')
        .slice(0, 12);
      return `- ${screen.name}: [${labels.join(', ')}]`;
    })
    .join('\n');

  const system = `You wire interactions for a mobile app. Respond with ONE JSON object only:
{"interactions":[{"element":"<button label>","screen":"<screen it is on>","action":"navigate|back|toast|toggle","target":"<screen name for navigate>","message":"<text for toast>","variable":"<name for toggle>"}]}

Rules:
- Use ONLY the exact element labels and screen names given.
- Wire the primary call-to-action on each screen so a user can tap through the app.
- Prefer "navigate" between screens; use "toast" for confirmations (e.g. Save, Add).
- Do not invent elements that were not listed.`;
  const user = `App: ${prompt}

SCREENS AND THEIR TAPPABLE ELEMENTS:
${screenLines}

Return the JSON object only.`;

  const content = await provider.generateRawChat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    true,
  );
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end < 0) {
    // `AIProviderError.invalidJSON` — the provider layer's error type; the
    // caller swallows it either way (`try?`).
    throw new Error('No JSON object in interaction response.');
  }
  return JSON.parse(content.slice(start, end + 1)) as Intents;
}

function buildFlows(
  intents: Intents,
  design: DesignHostForLogic,
  screens: ScreenRef[],
): { flows: LogicFlow[]; count: number } {
  const byScreen = new Map<string, { blocks: LogicBlock[]; connections: BlockConnection[]; y: number }>();
  let count = 0;

  for (const interaction of intents.interactions) {
    // Resolve the element inside its screen (label match, fuzzy).
    const resolved = resolveElement(interaction.element, interaction.screen, design, screens);
    if (!resolved) continue;
    const { screenId, elementId } = resolved;

    let action: LogicBlockType;
    let screenTarget: string | undefined;
    let message: string | undefined;
    let variable: string | undefined;

    switch (interaction.action.toLowerCase()) {
      case 'navigate': {
        const targetName = interaction.target;
        const target = targetName !== undefined ? screens.find((s) => fuzzyEqual(s.name, targetName)) : undefined;
        if (targetName === undefined || !target) continue;
        action = 'navigate';
        screenTarget = target.id;
        break;
      }
      case 'back':
        action = 'goBack';
        break;
      case 'toast':
        action = 'showToast';
        message = interaction.message ?? 'Done';
        break;
      case 'toggle': {
        const name = interaction.variable;
        if (name === undefined) continue;
        action = 'toggleVariable';
        variable = name;
        break;
      }
      default:
        continue;
    }

    const entry = byScreen.get(screenId) ?? { blocks: [], connections: [], y: 40 };
    const pair = chain(elementId, action, { screenTarget, message, variable, at: entry.y });
    if (!pair) continue;
    entry.blocks.push(...pair.blocks);
    entry.connections.push(...pair.connections);
    entry.y += 120;
    byScreen.set(screenId, entry);
    count += 1;
  }

  const flows: LogicFlow[] = [];
  for (const [screenId, entry] of byScreen) {
    if (entry.blocks.length === 0) continue;
    const name = screens.find((s) => s.id === screenId)?.name ?? 'Screen';
    flows.push(
      makeLogicFlow({
        name: `${name} Interactions`,
        blocks: entry.blocks,
        connections: entry.connections,
        screenNodeId: screenId,
      }),
    );
  }
  return { flows, count };
}

// MARK: - Block construction

/** onTap(element) → action. Built from the real catalog so parameters and
 * ports always match what the editor/exporters expect. */
function chain(
  elementId: string,
  action: LogicBlockType,
  options: { screenTarget?: string; message?: string; variable?: string; at: number },
): BlockChain | undefined {
  const tap = BlockCatalog.makeBlock('onTap', { x: 40, y: options.at });
  const act = BlockCatalog.makeBlock(action, { x: 320, y: options.at });
  if (!tap || !act) return undefined;

  tap.connectedDesignNodeId = elementId;
  const index = tap.parameters.findIndex((p) => p.key === 'element');
  if (index >= 0) {
    tap.parameters[index]!.nodeReference = elementId;
  }

  for (const parameter of act.parameters) {
    switch (parameter.key) {
      case 'screen':
        if (options.screenTarget !== undefined) parameter.nodeReference = options.screenTarget;
        continue;
      case 'message':
      case 'title':
        if (options.message !== undefined) parameter.value = options.message;
        continue;
      case 'variable':
        if (options.variable !== undefined) parameter.variableReference = options.variable;
        continue;
      default:
        continue;
    }
  }

  const connection = makeBlockConnection({
    sourceBlockId: tap.id,
    sourcePortIndex: 0,
    targetBlockId: act.id,
    targetPortIndex: 0,
  });
  return { blocks: [tap, act], connections: [connection] };
}

// MARK: - Resolution helpers

function screenList(design: DesignHostForLogic): ScreenRef[] {
  const page = design.project.pages[design.currentPageIndex];
  if (!page) return [];
  return page.nodes.filter((n) => n.type === 'Frame').map((n) => ({ id: n.id, name: n.name }));
}

function findNode(id: string, design: DesignHostForLogic): DesignNode | undefined {
  const search = (nodes: DesignNode[]): DesignNode | undefined => {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = search(node.children);
      if (found) return found;
    }
    return undefined;
  };
  const page = design.project.pages[design.currentPageIndex];
  if (!page) return undefined;
  return search(page.nodes);
}

/** Candidates the model may wire: real Buttons plus tab-bar items. Stray
 * Text is deliberately excluded — a card subtitle that happens to read
 * "Today" is not a control, and wiring it produces phantom taps. */
function tappableDescendants(node: DesignNode): DesignNode[] {
  const out: DesignNode[] = buttons(node);
  const navBar = navigationBar(node);
  if (navBar) {
    out.push(...tabItems(navBar));
  }
  return out;
}

function resolveElement(
  label: string,
  screenName: string | undefined,
  design: DesignHostForLogic,
  screens: ScreenRef[],
): { screenId: string; elementId: string } | undefined {
  const filtered = screenName !== undefined ? screens.filter((s) => fuzzyEqual(s.name, screenName)) : screens;
  const candidateScreens = filtered.length === 0 ? screens : filtered;

  for (const screen of candidateScreens) {
    const screenNode = findNode(screen.id, design);
    if (!screenNode) continue;
    const elements = tappableDescendants(screenNode);
    // Prefer real buttons over text labels on ties.
    const match =
      elements.find((e) => e.type === 'Button' && fuzzyEqual(e.text ?? e.name, label)) ??
      elements.find((e) => fuzzyEqual(e.text ?? e.name, label));
    if (match) {
      return { screenId: screen.id, elementId: match.id };
    }
  }
  return undefined;
}

/**
 * The screen a tab labelled `label` should go to. Prefers an exact
 * (normalized) name match; a common tab like "Home" that has no matching
 * screen returns nil rather than being wired to an arbitrary one.
 */
function bestScreenMatch(label: string, screens: ScreenRef[], current: string): ScreenRef | undefined {
  const candidates = screens.filter((s) => s.id !== current);
  const norm = (s: string): string => s.toLowerCase().split(/[^0-9a-z]+/i).join('');
  const target = norm(label);
  if (target === '') return undefined;
  const exact = candidates.find((c) => norm(c.name) === target);
  if (exact) return exact;
  // "Home"/"Main" is unambiguous: it always means the first screen. This
  // is the one positional mapping that is never wrong, and it keeps the
  // primary tab working when a template's tab labels don't match screen
  // names (Shop/Product/Cart vs Home/Discover/…).
  if (['home', 'main'].includes(target)) {
    const first = screens[0];
    if (first && first.id !== current) return first;
  }
  // Only accept a containment match when it's unambiguous — one screen
  // name contains the whole label (so "Profile" → "Profile Settings",
  // but "Home" won't grab "HomeDetail" unless it's the only candidate).
  const contained = candidates.filter((c) => norm(c.name).includes(target) || target.includes(norm(c.name)));
  return contained.length === 1 ? contained[0] : undefined;
}

function fuzzyEqual(a: string, b: string): boolean {
  const normalize = (s: string): string => s.toLowerCase().split(/[^0-9a-z]+/i).join('');
  const na = normalize(a);
  const nb = normalize(b);
  if (na === '' || nb === '') return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
