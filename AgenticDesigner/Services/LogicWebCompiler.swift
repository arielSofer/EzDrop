//
//  LogicWebCompiler.swift
//  AgenticDesigner
//
//  Compiles the visual logic graph into JavaScript so an exported web page
//  is a REAL app, not a picture of one: taps run flows, navigation switches
//  screens, variables drive bindings, toasts appear. Blocks are walked into
//  a small JSON program that a fixed runtime interprets — unsupported blocks
//  (native-only: haptics, biometrics, push) become no-ops instead of
//  breaking the chain.
//

import Foundation

enum LogicWebCompiler {

    static func compile(
        screens: [DesignNode],
        flows: [LogicFlow],
        globals: [LogicVariable],
        supabase: SupabaseConfig? = nil
    ) -> Compiled {
        var state: [String: Any] = [:]
        for variable in globals + flows.flatMap(\.variables) {
            state[variable.name] = jsonValue(for: variable)
        }

        // nodeId -> program (tap handlers); screenId -> program (on load)
        var taps: [String: Any] = [:]
        var screenLoads: [String: Any] = [:]

        for flow in flows {
            for block in flow.blocks {
                switch block.type {
                case .onTap, .onDoubleTap, .onLongPress, .onSubmit, .onChange:
                    guard let nodeId = block.connectedDesignNodeId
                        ?? nodeReference(block, key: "element")
                    else { continue }
                    // Accumulate: a node may carry more than one trigger flow
                    // (all reduce to a click on the web). Overwriting silently
                    // dropped every flow but the last — the graph showed two
                    // behaviours, the page ran one.
                    let key = nodeId.uuidString
                    taps[key] = ((taps[key] as? [[String: Any]]) ?? []) + program(from: block, in: flow)
                case .onScreenLoad, .onScreenOpened, .onAppLaunch:
                    let screenId = flow.screenNodeId ?? screens.first?.id
                    if let screenId {
                        let key = screenId.uuidString
                        screenLoads[key] = ((screenLoads[key] as? [[String: Any]]) ?? []) + program(from: block, in: flow)
                    }
                default:
                    continue
                }
            }
        }

        let bindings = collectBindings(screens)

        var payload: [String: Any] = [
            "state": state,
            "taps": taps,
            "screenLoads": screenLoads,
            "bindings": bindings,
            "firstScreen": screens.first?.id.uuidString ?? "",
        ]
        // The exported app talks to the real backend. The anon key is a public,
        // row-level-security-gated key — the same one a shipped web client
        // carries — so embedding it is correct, not a leak.
        if let supabase, supabase.isConfigured {
            payload["supabase"] = ["url": supabase.projectURL, "key": supabase.anonKey]
        }
        let json = (try? JSONSerialization.data(withJSONObject: payload))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "{}"

        // The data lives in a JSON <script> the runtime parses. Escape the
        // sequence that would end that block early — the one XSS vector left
        // once the payload is no longer executable JS.
        let safeJSON = json.replacingOccurrences(of: "</", with: "<\\/")
        return Compiled(
            dataBlock: "<script id=\"app-data\" type=\"application/json\">\(safeJSON)</script>",
            runtimeScript: "<script>\n\(runtime())\n</script>"
        )
    }

    struct Compiled {
        let dataBlock: String      // <script type="application/json">…</script>
        let runtimeScript: String  // <script>…interpreter…</script>
    }

    // MARK: - Graph walk

    /// Follows connections from a trigger into a linear program, branching at
    /// conditionals. Cycles are cut so a looped graph can't hang the page.
    private static func program(from trigger: LogicBlock, in flow: LogicFlow) -> [[String: Any]] {
        var visited: Set<UUID> = [trigger.id]
        return steps(after: trigger, in: flow, visited: &visited)
    }

    private static func steps(after block: LogicBlock, in flow: LogicFlow, visited: inout Set<UUID>) -> [[String: Any]] {
        var out: [[String: Any]] = []
        var current = next(after: block, port: 0, in: flow)

        while let node = current, !visited.contains(node.id) {
            visited.insert(node.id)

            if node.type == .ifCondition {
                var thenVisited = visited
                var elseVisited = visited
                let thenBranch = next(after: node, port: 0, in: flow).map { branch -> [[String: Any]] in
                    thenVisited.insert(branch.id)
                    return [step(for: branch)].compactMap { $0 } + steps(after: branch, in: flow, visited: &thenVisited)
                } ?? []
                let elseBranch = next(after: node, port: 1, in: flow).map { branch -> [[String: Any]] in
                    elseVisited.insert(branch.id)
                    return [step(for: branch)].compactMap { $0 } + steps(after: branch, in: flow, visited: &elseVisited)
                } ?? []
                // The real parameter keys are leftValue/operator/rightValue
                // (see BlockDefinitions). Reading "left"/"operation" meant the
                // condition was ALWAYS empty and every If took the else branch.
                out.append([
                    "t": "if",
                    "left": variableRef(node, "leftValue") ?? value(node, "leftValue") ?? "",
                    "op": webOperator(value(node, "operator") ?? "=="),
                    "right": value(node, "rightValue") ?? variableRef(node, "rightValue") ?? "",
                    "then": thenBranch,
                    "else": elseBranch,
                ])
                return out
            }

            if let compiled = step(for: node) { out.append(compiled) }
            current = next(after: node, port: 0, in: flow)
        }
        return out
    }

    private static func next(after block: LogicBlock, port: Int, in flow: LogicFlow) -> LogicBlock? {
        guard let connection = flow.connections.first(where: {
            $0.sourceBlockId == block.id && $0.sourcePortIndex == port
        }) else { return nil }
        return flow.blocks.first { $0.id == connection.targetBlockId }
    }

    // MARK: - Block → step

    private static func step(for block: LogicBlock) -> [String: Any]? {
        switch block.type {
        case .navigate, .presentSheet:
            guard let screen = nodeReference(block, key: "screen") else { return nil }
            return ["t": "nav", "screen": screen.uuidString]
        case .goBack, .dismissSheet:
            return ["t": "back"]
        case .setVariable, .saveValue:
            guard let name = variableRef(block, "variable") ?? value(block, "variable") else { return nil }
            return ["t": "set", "var": name, "value": value(block, "value") ?? ""]
        case .toggleVariable:
            guard let name = variableRef(block, "variable") ?? value(block, "variable") else { return nil }
            return ["t": "toggle", "var": name]
        case .incrementVariable:
            guard let name = variableRef(block, "variable") ?? value(block, "variable") else { return nil }
            return ["t": "add", "var": name, "by": Double(value(block, "amount") ?? "1") ?? 1]
        case .decrementVariable:
            guard let name = variableRef(block, "variable") ?? value(block, "variable") else { return nil }
            return ["t": "add", "var": name, "by": -(Double(value(block, "amount") ?? "1") ?? 1)]
        case .showToast:
            return ["t": "toast", "msg": value(block, "message") ?? block.label]
        case .showAlert, .confirmDialog:
            return ["t": "alert", "msg": value(block, "message") ?? value(block, "title") ?? block.label]
        case .openURL:
            return ["t": "open", "url": value(block, "url") ?? ""]
        case .copyToClipboard:
            return ["t": "copy", "text": value(block, "text") ?? ""]
        case .delay:
            return ["t": "delay", "ms": (Double(value(block, "seconds") ?? "0.3") ?? 0.3) * 1000]
        case .log:
            return ["t": "log", "msg": value(block, "message") ?? block.label]
        case .clearField:
            guard let node = nodeReference(block, key: "element") else { return nil }
            return ["t": "clear", "node": node.uuidString]

        // Real backend calls — the exported web app fetches and writes live data.
        case .supabaseSignUp, .supabaseSignIn:
            return [
                "t": "auth",
                "mode": block.type == .supabaseSignUp ? "signup" : "signin",
                "email": value(block, "email") ?? "",
                "password": value(block, "password") ?? "",
                "session": variableRef(block, "sessionVariable") ?? "session",
            ]
        case .supabaseSignOut:
            return ["t": "signout", "session": variableRef(block, "sessionVariable") ?? "session"]
        case .supabaseCurrentUser:
            return [
                "t": "currentUser",
                "session": variableRef(block, "sessionVariable") ?? "session",
                "into": variableRef(block, "userVariable") ?? "user",
            ]
        case .supabaseQuery:
            return [
                "t": "db", "method": "GET",
                "table": value(block, "table") ?? "",
                "filter": value(block, "filter") ?? "",
                "limit": value(block, "limit") ?? "",
                "into": variableRef(block, "variable") ?? "rows",
            ]
        case .supabaseInsert:
            return [
                "t": "db", "method": "POST",
                "table": value(block, "table") ?? "",
                "data": keyValue(block, "data"),
                "into": variableRef(block, "variable") ?? "",
            ]
        case .supabaseUpdate:
            return [
                "t": "db", "method": "PATCH",
                "table": value(block, "table") ?? "",
                "filter": value(block, "filter") ?? "",
                "data": keyValue(block, "data"),
                "into": variableRef(block, "variable") ?? "",
            ]
        case .supabaseDelete:
            return [
                "t": "db", "method": "DELETE",
                "table": value(block, "table") ?? "",
                "filter": value(block, "filter") ?? "",
                "into": "",
            ]
        case .httpRequest:
            return [
                "t": "http",
                "url": value(block, "url") ?? "",
                "method": value(block, "method") ?? "GET",
                "body": value(block, "body") ?? "",
                "into": variableRef(block, "variable") ?? "response",
            ]

        default:
            // Native-only blocks (haptics, biometrics, push) are no-ops on the
            // web — the rest of the chain still runs.
            return nil
        }
    }

    // MARK: - Bindings

    private static func collectBindings(_ nodes: [DesignNode]) -> [[String: Any]] {
        var out: [[String: Any]] = []
        func walk(_ node: DesignNode, parent: DesignNode?) {
            for binding in node.logicBindings ?? [] {
                var entry: [String: Any] = [
                    "node": node.id.uuidString,
                    "kind": binding.kind.rawValue,
                    "var": binding.variableName,
                ]
                if let condition = binding.condition {
                    entry["cond"] = [
                        "left": condition.left,
                        "op": condition.operation.rawValue,
                        "right": condition.right ?? "",
                    ]
                }
                // A toggle knob's slide distance must be baked in: measuring it
                // in the browser returns 0 whenever the knob sits on a screen
                // that isn't currently shown (display:none has no layout).
                if binding.kind == .isOn, let parent {
                    entry["travel"] = max(0, parent.width - node.width - node.x * 2)
                }
                out.append(entry)
            }
            for child in node.children { walk(child, parent: node) }
        }
        for node in nodes { walk(node, parent: nil) }
        return out
    }

    // MARK: - Parameter access

    private static func value(_ block: LogicBlock, _ key: String) -> String? {
        block.parameters.first { $0.key == key }?.value
    }

    private static func variableRef(_ block: LogicBlock, _ key: String) -> String? {
        block.parameters.first { $0.key == key }?.variableReference
    }

    /// The block stores operators as symbols (`==`, `contains`); the JS runtime
    /// switches on words. Without this translation even a correctly-keyed
    /// condition fell through to the default and returned false.
    private static func webOperator(_ raw: String) -> String {
        switch raw {
        case "==": return "equals"
        case "!=": return "notEquals"
        case ">": return "greaterThan"
        case "<": return "lessThan"
        case ">=": return "greaterOrEqual"
        case "<=": return "lessOrEqual"
        case "contains": return "contains"
        case "isEmpty": return "isEmpty"
        default: return "equals"
        }
    }

    /// keyValue parameters serialize as "a=1\nb=2" (or JSON) — normalize to a
    /// dictionary the runtime can post directly.
    private static func keyValue(_ block: LogicBlock, _ key: String) -> [String: String] {
        guard let raw = value(block, key), !raw.isEmpty else { return [:] }
        if let data = raw.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return parsed.mapValues { String(describing: $0) }
        }
        var out: [String: String] = [:]
        for line in raw.split(whereSeparator: { $0 == "\n" || $0 == "," }) {
            let parts = line.split(separator: "=", maxSplits: 1)
            guard parts.count == 2 else { continue }
            out[parts[0].trimmingCharacters(in: .whitespaces)] = parts[1].trimmingCharacters(in: .whitespaces)
        }
        return out
    }

    private static func nodeReference(_ block: LogicBlock, key: String) -> UUID? {
        block.parameters.first { $0.key == key }?.nodeReference
    }

    private static func jsonValue(for variable: LogicVariable) -> Any {
        let raw = variable.defaultValue ?? ""
        switch variable.type {
        case .number: return Double(raw) ?? 0
        case .boolean: return raw.lowercased() == "true"
        case .json, .array:
            if let data = raw.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) {
                return parsed
            }
            return variable.type == .array ? [] : [:]
        default: return raw
        }
    }

    // MARK: - Runtime

    private static func runtime() -> String {
        """
        (function () {
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
        })();
        """
    }
}
