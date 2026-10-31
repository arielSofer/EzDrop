# Embedded MCP Server for AgenticDesigner — Implementation Spec

Goal: the APP is an MCP SERVER. External agents (Claude Code, Claude Desktop,
any MCP client) connect to the running app over Streamable HTTP and drive it:
inspect the design tree, apply design actions, grab canvas screenshots, and
read logic flows. The app becomes a tool another model can use.

## Architecture
1. **MCPServer.swift** (`Services/`): minimal HTTP/1.1 server on
   `Network.framework` (NWListener, loopback only) implementing the MCP
   Streamable HTTP transport:
   - `POST /mcp` — JSON-RPC 2.0: `initialize`, `ping`, `tools/list`,
     `tools/call`; notifications get `202 Accepted`.
   - Stateless (no session ids required), responds `application/json`.
   - `GET /mcp` → 405 (no server-initiated streams in v1).
   - Origin-header validation + 127.0.0.1 binding (anti DNS-rebinding).
2. **MCPServerController.swift** (`Services/`): `@MainActor ObservableObject`.
   Owns the server lifecycle (port, on/off, @AppStorage persistence), defines
   the tool registry, and bridges tool calls onto ProjectViewModel /
   LogicViewModel. Publishes a call log for the UI.
3. **Tools (v1)**:
   - `get_project_overview` — project name, pages, screens, node counts.
   - `get_design_tree` — full node JSON for a page (ids usable in actions).
   - `get_screenshot` — rendered canvas as MCP image content (JPEG).
   - `apply_design_actions` — the app's native DesignAction JSON vocabulary
     (createFrame/createText/updateStyle/moveNode/…); returns reference map.
   - `select_page` — switch the active page.
   - `get_logic_flows` — logic blocks/connections JSON for the current page.
4. **Entitlement**: `com.apple.security.network.server` (sandboxed app must
   accept incoming loopback connections).

## UI
- Top toolbar: "MCP" button with live status dot → sheet: on/off toggle, port
  field, endpoint URL, copyable `claude mcp add` command, tool list, call log.
- Console prints: "🔌 MCP: <method> <tool> (…ms)".

## Connecting a client
```
claude mcp add --transport http agenticdesigner http://127.0.0.1:8765/mcp
```

## Verify plan
Build → toggle server on → `curl -X POST http://127.0.0.1:8765/mcp` with an
`initialize` JSON-RPC body → `tools/list` shows the registry → `tools/call`
`apply_design_actions` creates nodes on the canvas → `get_screenshot` returns
image content.
