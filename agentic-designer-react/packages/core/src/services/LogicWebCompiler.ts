// Ported 1:1 from AgenticDesigner/Services/LogicWebCompiler.swift
//
// Compiles the visual logic graph into JavaScript so an exported web page
// is a REAL app, not a picture of one: taps run flows, navigation switches
// screens, variables drive bindings, toasts appear. Blocks are walked into
// a small JSON program that a fixed runtime interprets — unsupported blocks
// (native-only: haptics, biometrics, push) become no-ops instead of
// breaking the chain.

import { swiftDouble } from '../agent/DesignAction';
import type { DesignNode } from '../models/DesignNode';
import type { JSONObject, JSONValue } from '../models/JSON';
import type { LogicBlock, LogicFlow, LogicVariable } from '../models/LogicModels';
import type { SupabaseConfig } from '../models/SupabaseConfig';
import { supabaseConfigIsConfigured } from '../models/SupabaseConfig';

export interface Compiled {
  /** `<script type="application/json">…</script>` */
  dataBlock: string;
  /** `<script>…interpreter…</script>` */
  runtimeScript: string;
}

export interface CompileOptions {
  screens: DesignNode[];
  flows: LogicFlow[];
  globals: LogicVariable[];
  supabase?: SupabaseConfig;
}

export const LogicWebCompiler = {
  /** `LogicWebCompiler.compile(screens:flows:globals:supabase:)` */
  compile({ screens, flows, globals, supabase }: CompileOptions): Compiled {
    const state: JSONObject = {};
    for (const variable of [...globals, ...flows.flatMap((f) => f.variables)]) {
      state[variable.name] = jsonValue(variable);
    }

    // nodeId -> program (tap handlers); screenId -> program (on load)
    const taps: Record<string, JSONObject[]> = {};
    const screenLoads: Record<string, JSONObject[]> = {};

    for (const flow of flows) {
      for (const block of flow.blocks) {
        switch (block.type) {
          case 'onTap':
          case 'onDoubleTap':
          case 'onLongPress':
          case 'onSubmit':
          case 'onChange': {
            const nodeId = block.connectedDesignNodeId ?? nodeReference(block, 'element');
            if (nodeId === undefined) continue;
            // Accumulate: a node may carry more than one trigger flow
            // (all reduce to a click on the web). Overwriting silently
            // dropped every flow but the last — the graph showed two
            // behaviours, the page ran one.
            const key = nodeId;
            taps[key] = [...(taps[key] ?? []), ...program(block, flow)];
            break;
          }
          case 'onScreenLoad':
          case 'onScreenOpened':
          case 'onAppLaunch': {
            const screenId = flow.screenNodeId ?? screens[0]?.id;
            if (screenId !== undefined) {
              const key = screenId;
              screenLoads[key] = [...(screenLoads[key] ?? []), ...program(block, flow)];
            }
            break;
          }
          default:
            continue;
        }
      }
    }

    const bindings = collectBindings(screens);

    const payload: JSONObject = {
      state,
      taps: taps as unknown as JSONValue,
      screenLoads: screenLoads as unknown as JSONValue,
      bindings: bindings as unknown as JSONValue,
      firstScreen: screens[0]?.id ?? '',
    };
    // The exported app talks to the real backend. The anon key is a public,
    // row-level-security-gated key — the same one a shipped web client
    // carries — so embedding it is correct, not a leak.
    if (supabase && supabaseConfigIsConfigured(supabase)) {
      payload['supabase'] = { url: supabase.projectURL, key: supabase.anonKey };
    }
    const json = JSON.stringify(payload) ?? '{}';

    // The data lives in a JSON <script> the runtime parses. Escape the
    // sequence that would end that block early — the one XSS vector left
    // once the payload is no longer executable JS.
    const safeJSON = json.split('</').join('<\\/');
    return {
      dataBlock: `<script id="app-data" type="application/json">${safeJSON}</script>`,
      runtimeScript: `<script>\n${runtime()}\n</script>`,
    };
  },
} as const;

// MARK: - Graph walk

/** Follows connections from a trigger into a linear program, branching at
 * conditionals. Cycles are cut so a looped graph can't hang the page. */
function program(trigger: LogicBlock, flow: LogicFlow): JSONObject[] {
  const visited = new Set<string>([trigger.id]);
  return steps(trigger, flow, visited);
}

function steps(block: LogicBlock, flow: LogicFlow, visited: Set<string>): JSONObject[] {
  const out: JSONObject[] = [];
  let current = next(block, 0, flow);

  while (current !== undefined && !visited.has(current.id)) {
    const node = current;
    visited.add(node.id);

    if (node.type === 'ifCondition') {
      const thenVisited = new Set(visited);
      const elseVisited = new Set(visited);
      const thenSource = next(node, 0, flow);
      const elseSource = next(node, 1, flow);
      const thenBranch: JSONObject[] = thenSource
        ? (() => {
            thenVisited.add(thenSource.id);
            const head = step(thenSource);
            return [...(head ? [head] : []), ...steps(thenSource, flow, thenVisited)];
          })()
        : [];
      const elseBranch: JSONObject[] = elseSource
        ? (() => {
            elseVisited.add(elseSource.id);
            const head = step(elseSource);
            return [...(head ? [head] : []), ...steps(elseSource, flow, elseVisited)];
          })()
        : [];
      // The real parameter keys are leftValue/operator/rightValue
      // (see BlockDefinitions). Reading "left"/"operation" meant the
      // condition was ALWAYS empty and every If took the else branch.
      out.push({
        t: 'if',
        left: variableRef(node, 'leftValue') ?? value(node, 'leftValue') ?? '',
        op: webOperator(value(node, 'operator') ?? '=='),
        right: value(node, 'rightValue') ?? variableRef(node, 'rightValue') ?? '',
        then: thenBranch as unknown as JSONValue,
        else: elseBranch as unknown as JSONValue,
      });
      return out;
    }

    const compiled = step(node);
    if (compiled) out.push(compiled);
    current = next(node, 0, flow);
  }
  return out;
}

function next(block: LogicBlock, port: number, flow: LogicFlow): LogicBlock | undefined {
  const connection = flow.connections.find((c) => c.sourceBlockId === block.id && c.sourcePortIndex === port);
  if (!connection) return undefined;
  return flow.blocks.find((b) => b.id === connection.targetBlockId);
}

// MARK: - Block → step

function step(block: LogicBlock): JSONObject | undefined {
  switch (block.type) {
    case 'navigate':
    case 'presentSheet': {
      const screen = nodeReference(block, 'screen');
      if (screen === undefined) return undefined;
      return { t: 'nav', screen };
    }
    case 'goBack':
    case 'dismissSheet':
      return { t: 'back' };
    case 'setVariable':
    case 'saveValue': {
      const name = variableRef(block, 'variable') ?? value(block, 'variable');
      if (name === undefined) return undefined;
      return { t: 'set', var: name, value: value(block, 'value') ?? '' };
    }
    case 'toggleVariable': {
      const name = variableRef(block, 'variable') ?? value(block, 'variable');
      if (name === undefined) return undefined;
      return { t: 'toggle', var: name };
    }
    case 'incrementVariable': {
      const name = variableRef(block, 'variable') ?? value(block, 'variable');
      if (name === undefined) return undefined;
      return { t: 'add', var: name, by: swiftDouble(value(block, 'amount') ?? '1') ?? 1 };
    }
    case 'decrementVariable': {
      const name = variableRef(block, 'variable') ?? value(block, 'variable');
      if (name === undefined) return undefined;
      return { t: 'add', var: name, by: -(swiftDouble(value(block, 'amount') ?? '1') ?? 1) };
    }
    case 'showToast':
      return { t: 'toast', msg: value(block, 'message') ?? block.label };
    case 'showAlert':
    case 'confirmDialog':
      return { t: 'alert', msg: value(block, 'message') ?? value(block, 'title') ?? block.label };
    case 'openURL':
      return { t: 'open', url: value(block, 'url') ?? '' };
    case 'copyToClipboard':
      return { t: 'copy', text: value(block, 'text') ?? '' };
    case 'delay':
      return { t: 'delay', ms: (swiftDouble(value(block, 'seconds') ?? '0.3') ?? 0.3) * 1000 };
    case 'log':
      return { t: 'log', msg: value(block, 'message') ?? block.label };
    case 'clearField': {
      const node = nodeReference(block, 'element');
      if (node === undefined) return undefined;
      return { t: 'clear', node };
    }

    // Real backend calls — the exported web app fetches and writes live data.
    case 'supabaseSignUp':
    case 'supabaseSignIn':
      return {
        t: 'auth',
        mode: block.type === 'supabaseSignUp' ? 'signup' : 'signin',
        email: value(block, 'email') ?? '',
        password: value(block, 'password') ?? '',
        session: variableRef(block, 'sessionVariable') ?? 'session',
      };
    case 'supabaseSignOut':
      return { t: 'signout', session: variableRef(block, 'sessionVariable') ?? 'session' };
    case 'supabaseCurrentUser':
      return {
        t: 'currentUser',
        session: variableRef(block, 'sessionVariable') ?? 'session',
        into: variableRef(block, 'userVariable') ?? 'user',
      };
    case 'supabaseQuery':
      return {
        t: 'db',
        method: 'GET',
        table: value(block, 'table') ?? '',
        filter: value(block, 'filter') ?? '',
        limit: value(block, 'limit') ?? '',
        into: variableRef(block, 'variable') ?? 'rows',
      };
    case 'supabaseInsert':
      return {
        t: 'db',
        method: 'POST',
        table: value(block, 'table') ?? '',
        data: keyValue(block, 'data'),
        into: variableRef(block, 'variable') ?? '',
      };
    case 'supabaseUpdate':
      return {
        t: 'db',
        method: 'PATCH',
        table: value(block, 'table') ?? '',
        filter: value(block, 'filter') ?? '',
        data: keyValue(block, 'data'),
        into: variableRef(block, 'variable') ?? '',
      };
    case 'supabaseDelete':
      return {
        t: 'db',
        method: 'DELETE',
        table: value(block, 'table') ?? '',
        filter: value(block, 'filter') ?? '',
        into: '',
      };
    case 'httpRequest':
      return {
        t: 'http',
        url: value(block, 'url') ?? '',
        method: value(block, 'method') ?? 'GET',
        body: value(block, 'body') ?? '',
        into: variableRef(block, 'variable') ?? 'response',
      };

    default:
      // Native-only blocks (haptics, biometrics, push) are no-ops on the
      // web — the rest of the chain still runs.
      return undefined;
  }
}

// MARK: - Bindings

function collectBindings(nodes: DesignNode[]): JSONObject[] {
  const out: JSONObject[] = [];
  const walk = (node: DesignNode, parent: DesignNode | undefined): void => {
    for (const binding of node.logicBindings ?? []) {
      const entry: JSONObject = {
        node: node.id,
        kind: binding.kind,
        var: binding.variableName,
      };
      const condition = binding.condition;
      if (condition) {
        entry['cond'] = {
          left: condition.left,
          op: condition.operation,
          right: condition.right ?? '',
        };
      }
      // A toggle knob's slide distance must be baked in: measuring it
      // in the browser returns 0 whenever the knob sits on a screen
      // that isn't currently shown (display:none has no layout).
      if (binding.kind === 'isOn' && parent) {
        entry['travel'] = Math.max(0, parent.width - node.width - node.x * 2);
      }
      out.push(entry);
    }
    for (const child of node.children) walk(child, node);
  };
  for (const node of nodes) walk(node, undefined);
  return out;
}

// MARK: - Parameter access

function value(block: LogicBlock, key: string): string | undefined {
  return block.parameters.find((p) => p.key === key)?.value;
}

function variableRef(block: LogicBlock, key: string): string | undefined {
  return block.parameters.find((p) => p.key === key)?.variableReference;
}

/** The block stores operators as symbols (`==`, `contains`); the JS runtime
 * switches on words. Without this translation even a correctly-keyed
 * condition fell through to the default and returned false. */
function webOperator(raw: string): string {
  switch (raw) {
    case '==':
      return 'equals';
    case '!=':
      return 'notEquals';
    case '>':
      return 'greaterThan';
    case '<':
      return 'lessThan';
    case '>=':
      return 'greaterOrEqual';
    case '<=':
      return 'lessOrEqual';
    case 'contains':
      return 'contains';
    case 'isEmpty':
      return 'isEmpty';
    default:
      return 'equals';
  }
}

/** keyValue parameters serialize as "a=1\nb=2" (or JSON) — normalize to a
 * dictionary the runtime can post directly. */
function keyValue(block: LogicBlock, key: string): JSONObject {
  const raw = value(block, key);
  if (raw === undefined || raw === '') return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const mapped: JSONObject = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        mapped[k] = describing(v);
      }
      return mapped;
    }
  } catch {
    /* not JSON — fall through to the key=value form */
  }
  const out: JSONObject = {};
  for (const line of raw.split(/[\n,]/)) {
    if (line === '') continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    out[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return out;
}

/** `String(describing:)` of a JSONSerialization value. */
function describing(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value === null) return '<null>';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value) ?? '';
}

function nodeReference(block: LogicBlock, key: string): string | undefined {
  return block.parameters.find((p) => p.key === key)?.nodeReference;
}

function jsonValue(variable: LogicVariable): JSONValue {
  const raw = variable.defaultValue ?? '';
  switch (variable.type) {
    case 'number':
      return swiftDouble(raw) ?? 0;
    case 'boolean':
      return raw.toLowerCase() === 'true';
    case 'json':
    case 'array': {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object') return parsed as JSONValue;
      } catch {
        /* JSONSerialization throws → fall back to the empty container */
      }
      return variable.type === 'array' ? [] : {};
    }
    default:
      return raw;
  }
}

// MARK: - Runtime

/** The interpreter embedded in every interactive web export — verbatim. */
export function runtime(): string {
  return `(function () {
  // The program is read from a JSON <script> block, not spliced into
  // executable JS. A toast/variable/table value containing
  // "</script><img onerror=...>" (LLM-authored from a user prompt)
  // would otherwise close the script tag and run as HTML — with the
  // Supabase anon key sitting in the same object.
  const APP = JSON.parse(document.getElementById('app-data').textContent);
  const state = Object.assign({}, APP.state);
  const history = [];
  let current = APP.firstScreen;

  const $screens = () => document.querySelectorAll('.screen');
  const byNode = (id) => document.querySelector('[data-node-id="' + id + '"]');

  function truthy(v) { return !(v === undefined || v === null || v === false || v === 0 || v === '' || v === 'false'); }

  function resolve(token) {
    if (token === undefined || token === null) return '';
    if (typeof token === 'string' && Object.prototype.hasOwnProperty.call(state, token)) return state[token];
    return token;
  }

  function compare(left, op, right) {
    const l = resolve(left), r = resolve(right);
    switch (op) {
      case 'equals': return String(l) === String(r);
      case 'notEquals': return String(l) !== String(r);
      case 'greaterThan': return parseFloat(l) > parseFloat(r);
      case 'lessThan': return parseFloat(l) < parseFloat(r);
      case 'greaterOrEqual': return parseFloat(l) >= parseFloat(r);
      case 'lessOrEqual': return parseFloat(l) <= parseFloat(r);
      case 'contains': return String(l).includes(String(r));
      case 'isEmpty': return !truthy(l);
      case 'isNotEmpty': return truthy(l);
      case 'isFalse': return !truthy(l);
      default: return truthy(l);
    }
  }

  function showScreen(id) {
    if (!id) return;
    current = id;
    $screens().forEach(el => el.classList.toggle('hidden', el.dataset.screenId !== id));
    document.querySelectorAll('.screen-nav button').forEach(b =>
      b.classList.toggle('active', b.dataset.goto === id));
    render();
    const load = APP.screenLoads[id];
    if (load) run(load);
  }

  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 1800);
  }

  // --- backend -------------------------------------------------
  const SB = APP.supabase;

  function sbHeaders(auth) {
    const h = { 'apikey': SB.key, 'Content-Type': 'application/json' };
    h['Authorization'] = 'Bearer ' + (auth || SB.key);
    return h;
  }

  // A field's live text beats a static parameter: "email" usually means
  // "whatever the user just typed", not a literal.
  function fieldOr(token) {
    const v = resolve(token);
    if (typeof v === 'string' && v.startsWith('#')) {
      const el = document.querySelector('[data-node-id="' + v.slice(1) + '"]');
      if (el && 'value' in el) return el.value;
    }
    return v;
  }

  async function backend(s) {
    if (!SB) { toast('Backend not configured'); return; }
    try {
      if (s.t === 'auth') {
        const path = s.mode === 'signup' ? '/auth/v1/signup' : '/auth/v1/token?grant_type=password';
        const res = await fetch(SB.url + path, {
          method: 'POST', headers: sbHeaders(),
          body: JSON.stringify({ email: fieldOr(s.email), password: fieldOr(s.password) })
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.access_token) {
          state[s.session] = json.access_token;
          toast(s.mode === 'signup' ? 'Account created' : 'Signed in');
        } else {
          toast(json.error_description || json.msg || 'Auth failed');
        }
        render();
      } else if (s.t === 'signout') {
        state[s.session] = '';
        toast('Signed out');
        render();
      } else if (s.t === 'currentUser') {
        const res = await fetch(SB.url + '/auth/v1/user', { headers: sbHeaders(state[s.session]) });
        state[s.into] = await res.json().catch(() => ({}));
        render();
      } else if (s.t === 'db') {
        let url = SB.url + '/rest/v1/' + s.table;
        const params = [];
        if (s.filter) params.push(s.filter);
        if (s.limit) params.push('limit=' + s.limit);
        if (params.length) url += '?' + params.join('&');
        const init = { method: s.method, headers: sbHeaders(state.session) };
        if (s.method !== 'GET' && s.method !== 'DELETE') {
          init.headers['Prefer'] = 'return=representation';
          const body = {};
          for (const k of Object.keys(s.data || {})) body[k] = fieldOr(s.data[k]);
          init.body = JSON.stringify(body);
        }
        const res = await fetch(url, init);
        const json = await res.json().catch(() => null);
        if (s.into) state[s.into] = json;
        if (!res.ok) toast('Request failed (' + res.status + ')');
        render();
      } else if (s.t === 'http') {
        const init = { method: s.method || 'GET' };
        if (s.body) { init.headers = { 'Content-Type': 'application/json' }; init.body = s.body; }
        const res = await fetch(String(resolve(s.url)), init);
        state[s.into] = await res.json().catch(() => null);
        render();
      }
    } catch (e) {
      console.error(e);
      toast('Network error');
    }
  }

  async function run(steps) {
    for (const s of steps || []) {
      switch (s.t) {
        case 'auth': case 'signout': case 'currentUser':
        case 'db': case 'http': await backend(s); break;
        case 'nav': history.push(current); showScreen(s.screen); break;
        case 'back': showScreen(history.pop() || APP.firstScreen); break;
        case 'set': state[s.var] = resolve(s.value); render(); break;
        case 'toggle': state[s.var] = !truthy(state[s.var]); render(); break;
        case 'add': state[s.var] = (parseFloat(state[s.var]) || 0) + s.by; render(); break;
        case 'toast': toast(String(resolve(s.msg))); break;
        case 'alert': alert(String(resolve(s.msg))); break;
        case 'open': if (s.url) window.open(s.url, '_blank'); break;
        case 'copy': navigator.clipboard && navigator.clipboard.writeText(String(resolve(s.text))); break;
        case 'delay': await new Promise(r => setTimeout(r, s.ms)); break;
        case 'log': console.log(resolve(s.msg)); break;
        case 'clear': { const el = byNode(s.node); if (el) el.value = ''; break; }
        case 'if': await run(compare(s.left, s.op, s.right) ? s.then : s.else); break;
      }
    }
  }

  function render() {
    for (const b of APP.bindings) {
      const el = byNode(b.node);
      if (!el) continue;
      const value = state[b.var];
      const on = b.cond ? compare(b.cond.left, b.cond.op, b.cond.right) : truthy(value);
      switch (b.kind) {
        case 'text': if (value !== undefined) el.textContent = String(value); break;
        case 'value': if (value !== undefined) el.value = String(value); break;
        case 'visibility': el.style.display = on ? '' : 'none'; break;
        case 'enabled': el.disabled = !on; el.style.opacity = on ? '' : '0.5'; break;
        case 'isOn': {
          // A toggle knob should physically slide and its track tint —
          // fading it would read as "disabled", not "off". Travel is
          // baked in at export (hidden screens measure as 0 wide).
          el.dataset.on = on ? '1' : '0';
          const travel = (typeof b.travel === 'number' && b.travel > 0) ? b.travel : 24;
          el.style.transition = 'transform .18s ease';
          el.style.transform = on ? 'translateX(' + travel + 'px)' : 'translateX(0px)';
          const track = el.parentElement;
          if (track) {
            track.style.transition = 'background-color .18s ease';
            track.style.backgroundColor = on ? '#34D399' : '#D8DCE3';
          }
          break;
        }
      }
    }
  }

  function wire() {
    for (const nodeId of Object.keys(APP.taps)) {
      const el = byNode(nodeId);
      if (!el) continue;
      el.setAttribute('data-tap', '1');
      el.addEventListener('click', (e) => { e.preventDefault(); run(APP.taps[nodeId]); });
    }
    document.querySelectorAll('.screen-nav button').forEach(b =>
      b.addEventListener('click', () => showScreen(b.dataset.goto)));
  }

  document.addEventListener('DOMContentLoaded', () => { wire(); showScreen(APP.firstScreen); });
  if (document.readyState !== 'loading') { wire(); showScreen(APP.firstScreen); }
})();`;
}
