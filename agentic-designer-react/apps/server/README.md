# @agentic/server

The OS-bound half of AgenticDesigner, ported 1:1 from the Swift macOS app to
Node 26 + TypeScript. The editor (React, `apps/web`) owns the live project
state; this process owns everything that needs the machine: the MCP server
external agents connect to, the filesystem (projects / checkpoints / exports /
git repos / components), `xcrun simctl` + `xcodebuild` + `swiftc`, the
`firebase` and `codex` CLIs, and the local model workers (mflux, Helsinki).

## Run

```sh
npm install                      # at the workspace root
npm run dev -w apps/server       # tsx watch src/index.ts
npm run start -w apps/server     # tsx src/index.ts
npm run typecheck -w apps/server # tsc --noEmit
npm test -w apps/server          # vitest run
```

Console lines mirror the Swift app (`🔌 MCP: server listening on 127.0.0.1:8765`,
`🔌 MCP: called <tool> (12ms)`, …) plus one bridge line
(`🌉 Bridge: listening on ws://127.0.0.1:8766 (POST /proxy, GET /health)`).

## Ports & environment

| What | Default | Env |
| --- | --- | --- |
| MCP Streamable HTTP (`POST /mcp`) | `127.0.0.1:8765` | `AGENTIC_MCP_PORT` (also forces the server ON, like the Swift app) |
| Bridge WebSocket + `POST /proxy` + `GET /health` | `127.0.0.1:8766` | `AGENTIC_BRIDGE_PORT` |
| Settings file (`UserDefaults` twin) | `~/.agenticdesigner/settings.json` | `AGENTIC_SETTINGS_PATH`, `AGENTIC_DOT_DIR` |
| Application Support root | `~/Library/Application Support` | `AGENTIC_APP_SUPPORT_DIR` (tests) |
| Xcode toolchain | `xcode-select -p` → `/Applications/Xcode.app/Contents/Developer` | `DEVELOPER_DIR` is set per spawned process, as in Swift |

The MCP server starts only when `mcpServerEnabled` is true in settings.json or
`AGENTIC_MCP_PORT` is set — exactly `MCPServerController.attach()`. The editor
toggles it with the `mcp.setEnabled` / `mcp.setPort` bridge requests; the port
is persisted under `mcpServerPort`. Bind failures retry every 2 s, 30 times.

Connect a client: `claude mcp add --transport http agenticdesigner http://127.0.0.1:8765/mcp`.

## Layout

```
src/index.ts                     start everything, all bridge request handlers
src/mcp/MCPServer.ts             MCPServer.swift — transport, JSON-RPC, types
src/mcp/MCPServerController.ts   lifecycle half of MCPServerController.swift
src/mcp/toolRelay.ts             tools/list + tools/call relayed to the editor
src/mcp/toolNames.ts             the 100 tool names of the Swift registry
src/mcp/prompts.ts               build_production_app prompt + server instructions
src/bridge/protocol.ts           envelope + request catalogue (copy into apps/web)
src/bridge/BridgeServer.ts       ws server, POST /proxy, GET /health
src/services/*.ts                GitSyncService, CheckpointStore, ProjectDocumentService,
                                 ComponentLibrary, SimulatorRunner, SimulatorControl,
                                 GeneratedSourcePreview (typecheck), AppBuildOrchestrator,
                                 FirebaseProvisioner, ChatGPTSubscriptionService,
                                 LocalBridges (mflux / Helsinki / PDF pipeline),
                                 SpriteGenerator, ExportWriter, Settings
src/platform/*.ts                Paths, ProcessRunner, Foundation-style JSON
resources/                       mflux_bridge.py, helsinki_translation_server.py,
                                 document_structure.py (unchanged from the app bundle),
                                 SimulatorControl.jxa.js (CGEvent / window list via osascript),
                                 SpriteTools.swift (Vision subject lift, compiled on demand)
```

## Bridge protocol (summary)

WebSocket `ws://127.0.0.1:8766`. One envelope in both directions:

```jsonc
{ "id": "c1", "type": "request",  "name": "git.status", "args": { "projectName": "Demo" } }
{ "id": "c1", "type": "response", "ok": true,  "result": { "text": "Git sync: ON — …" } }
{ "id": "c1", "type": "response", "ok": false, "error": "Git sync is not enabled for this project — enable it first." }
{ "type": "event", "name": "mcp.log", "payload": { "id": "…", "date": 1725000000000, "message": "🔌 MCP: called get_screenshot (41ms)" } }
```

1. The web app connects and sends `editor.register { tools: [{name, description, inputSchema}…] }`
   — the full registry from its port of `MCPServerController.makeTools()`,
   verbatim. The response reports `accepted`, `unknown` (names not in the Swift
   list) and `missing` (Swift tools not registered), plus the MCP status.
2. MCP `tools/list` serves that registry (cached in
   `~/.agenticdesigner/mcp-tools-cache.json` so it survives a closed tab).
   MCP `tools/call` sends the editor `mcp.callTool { name, arguments }` and
   returns its `MCPToolResult` `{ content: [{type:'text',text}|{type:'image',data,mimeType}], isError }`.
   With no editor connected the call yields `Error: Designer is not available.`
   (`isError: true`) — the Swift controller's unattached message.
3. The editor calls the server for OS work. Every request name, with arg and
   result shapes, is typed in `src/bridge/protocol.ts` (`ServerRequests`), and
   `src/index.ts` refuses to start if any catalogued name lacks a handler.
4. Events pushed to every client: `mcp.log`, `mcp.status`, `bridge.editor`,
   `codex.transcript`, `codex.status`, `simulator.progress`, `pdf.translationProgress`.

### `POST /proxy`

For provider calls the browser cannot make (CORS): Ollama, Cerebras, Groq,
Gemini, NVIDIA, OpenRouter, the Helsinki worker, mflux.

```
POST http://127.0.0.1:8766/proxy
Content-Type: application/json
{ "url": "http://127.0.0.1:11434/api/chat", "method": "POST",
  "headers": { "Content-Type": "application/json" }, "body": { …provider body… } }
```

The response status, headers and body stream back unchanged (the server adds
nothing to the upstream request). Raw mode for binary bodies: send the upstream
body as-is with headers `X-Agentic-Proxy-Url`, optional `X-Agentic-Proxy-Method`
and `X-Agentic-Proxy-Headers` (JSON). Loopback-only; `Origin` must be
`127.0.0.1` / `localhost` / `::1`, like `/mcp`.

## Where things run

| Swift | Browser (apps/web) | Server (this package) |
| --- | --- | --- |
| MCPServerController tool handlers, prompts text | tool handlers against live stores (registry sent on connect) | transport, lifecycle, relay, prompts/list + prompts/get, call log |
| LogicExporter / WebExporter | generate files (`@agentic/core`) | `export.write` puts them on disk, `os.open*` opens Finder / Xcode |
| CheckpointStore / GitSyncService / ComponentLibrary / ProjectDocumentService | panels, `instantiate` (fresh ids), `replaceProject` | every disk + git operation, same paths and messages |
| SimulatorRunner / SimulatorControl / GeneratedSourcePreview.typecheck | builds tool-result text | `xcrun simctl`, `xcodebuild`, `swiftc`, screenshots, tap/type |
| FirebaseProvisioner / ChatGPTSubscriptionService | UI + result text | `firebase` / `codex` CLIs with the exact flags |
| OpenRouterProvider.ensureImageBridge / LocalModelTranslator worker | HTTP calls via `/proxy` | launches `mflux_bridge.py` / `helsinki_translation_server.py`, health polls |
| SpriteGenerator | prompt building, provider round trip | Vision cut-out, flip, palette (compiled Swift helper), GeneratedAssets dir |
