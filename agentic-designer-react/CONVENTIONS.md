# AgenticDesigner → React port: conventions (READ BEFORE WRITING ANY FILE)

Goal: a 1:1 functional port of the Swift/macOS app in `../AgenticDesigner/` to
TypeScript + React. The Swift code is the spec and must NOT be modified.
Every feature, every enum case, every tool, every generated-code path must
exist in the port. Do not simplify, stub, or "leave for later" unless the
underlying platform API truly cannot exist in a browser/Node — and then wire
it through the server or a clearly named platform adapter, never a silent no-op.

## Layout (npm workspaces, ESM, TypeScript strict)
- `packages/core`  — `@agentic/core`. Pure TypeScript: NO DOM, NO Node APIs.
  Models, DesignAction, BlockCatalog, DesignIntelligence, DesignSystem,
  exporters (they still emit SWIFT/SwiftUI source — that is the product),
  logic simulator engine, agent prompt builders + providers (use global fetch),
  helpers. Anything that needs the OS goes through an injected adapter interface
  declared in `packages/core/src/platform/`.
- `apps/web`       — Vite + React 18 + TypeScript + zustand (+ immer). All Views.
- `apps/server`    — Node 26 (tsx). MCP Streamable-HTTP server, filesystem
  (projects/checkpoints/exports/git), `xcrun simctl`, firebase CLI, Ollama /
  mflux / Codex-CLI bridges. Talks to the web app over WebSocket
  (`ws://127.0.0.1:8766`) with a request/response envelope so MCP tool calls
  are executed against the LIVE state in the browser.

## File & identifier mapping
- Mirror Swift file names: `Services/LogicExporter.swift` →
  `packages/core/src/services/LogicExporter.ts`; `Views/CanvasView.swift` →
  `apps/web/src/views/CanvasView.tsx`; `ViewModels/ProjectViewModel.swift` →
  `apps/web/src/stores/projectStore.ts` (zustand) whose actions carry the
  SAME method names as the Swift view model.
- Keep every Swift identifier verbatim (types, functions, enum cases, parameter
  keys, string literals, MCP tool names, JSON keys). Header each file with
  `// Ported 1:1 from AgenticDesigner/<relative path>.swift`.
- Swift `struct` → `interface` (+ a `makeX(partial)` factory that applies the
  Swift default values). `enum: String, Codable` → string-literal union type +
  `export const AllX = [...] as const` when `CaseIterable` + helper functions
  for computed properties (`displayName(x)`), or a `const X = { a: 'a', ... }`
  object when call sites use dot access. Enums with associated values →
  discriminated unions `{ kind: 'case'; ... }`.
- `UUID` → `string` (`crypto.randomUUID()`, UPPERCASE when generating, to match
  Swift's JSON). `CGFloat/Double/Int` → `number`. `CGPoint/CGSize/CGRect` →
  `{x,y}`, `{width,height}`, `{x,y,width,height}` from `models/Geometry.ts`.
  `Date` → `number` (ms) internally; when serialising to Swift-compatible JSON
  use the same encoding Swift would (seconds since 2001-01-01 reference date)
  ONLY where the Swift code persists dates (check the Swift file).
- `[String: Any]` / `Any` JSON → `JSONValue` type from `models/JSON.ts`.

## JSON compatibility (non-negotiable)
`.agenticdesign` files written by the Swift app must open in the port, and
files saved by the port must open in the Swift app. Swift's synthesized Codable
omits nil optionals and writes enums as rawValue. Custom `init(from:)` decoders
with `decodeIfPresent(...) ?? default` become `decodeX(json): X` normalisers in
`packages/core/src/models/codec.ts`. `GradientStyle` accepts a bare string
array. `DesignAction` decoding is lossy + flexible (FlexibleStringValue etc.) —
port those exactly.

## Platform adapters (packages/core/src/platform/)
- `Clock`, `Logger`, `FileSystem`, `ProcessRunner`, `Clipboard`, `Renderer`
  (canvas snapshot to JPEG), `Storage` (UserDefaults/@AppStorage → key-value).
  Web implements Storage with localStorage, Renderer with html-to-image;
  server implements FileSystem/ProcessRunner with node:fs / child_process.
- `@AppStorage("key")` keys must keep the SAME key strings.

## UI
- SF Symbols → `<SFSymbol name="paintbrush" />` component in
  `apps/web/src/components/SFSymbol.tsx` mapping to lucide-react icons (add
  to the map when you use a new symbol; fallback renders the name initials).
- Layout, panel widths (240 / 300 / 180 / minHeight 300 ...), labels,
  tooltips (`.help(...)` → `title=`), keyboard shortcuts (⌘Z, ⇧⌘Z, ⌘S, ⇧⌘S,
  ⌘O, ⌘+/-/0, Delete/Backspace, mode-aware routing) all identical.
- Sheets → modal dialogs; Menus → dropdown menus; Pickers → segmented control /
  select; NSColorPanel → `<input type="color">`; NSOpenPanel/NSSavePanel →
  File System Access API when available, fallback `<input type=file>` /
  download, AND server-side path save when the server is connected.

## Testing / verification
- `vitest` in every package. Every ported service that produces text (exporters,
  prompt builders, compilers) gets at least a smoke test that runs on the real
  sample projects in `../SavedProjects/*.agenticdesign` and `../*.agenticdesign`.
- `npm run typecheck` (tsc --noEmit for all workspaces) must pass before you
  report done. `npm run build` for web must pass.

## Absolutely not
- Do not touch anything under `../AgenticDesigner/` or `../AgenticDesigner.xcodeproj`.
- Do not drop enum cases, block types, tools, prompt text, or template data
  "to save space". Copy the data verbatim.
- Do not invent new feature names; use the Swift ones.

## Reference: things that must keep their exact names / values
- @AppStorage / UserDefaults keys (web: localStorage via `Storage` adapter; server: `~/.agenticdesigner/settings.json`):
  agentLoopCostApprovalUSD, agentRunMode, autoCriticEnabled, autoHugTextBoxes,
  cerebrasAPIKey, designChatEngine, geminiAPIKey, groqAPIKey,
  helsinkiTranslatorPython, localFallbackModel, nvidiaAPIKey, openRouterAPIKey,
  openRouterGenerationModel, openRouterModel, "AgenticDesignerPreview.<key>".
- Env vars: AGENTIC_MCP_PORT (default 8765), OPENROUTER_API_KEY, DEVELOPER_DIR,
  MML_OUT_DIR, MML_PDF_PATH, MML_TRANSLATOR, PATH.
- External processes (server only; resolve like the Swift code does, same
  candidate paths): git, gh, xcrun, xcodebuild, open, firebase, codex, python3, zsh.
- Endpoints: OpenRouter https://openrouter.ai/api/v1/chat/completions and /images,
  Cerebras https://api.cerebras.ai/v1/chat/completions, Groq
  https://api.groq.com/openai/v1/chat/completions, Gemini
  https://generativelanguage.googleapis.com/v1beta/openai/chat/completions,
  NVIDIA https://integrate.api.nvidia.com/v1/chat/completions, Ollama
  http://127.0.0.1:11434 (/api/chat, /v1/chat/completions), Helsinki translator
  http://127.0.0.1:17841 (/health, /translate), mflux http://127.0.0.1:7860/sdapi/v1/txt2img.
- Application Support layout (server: `~/Library/Application Support/AgenticDesigner/`):
  Checkpoints/, Components/, GitRepos/, Translation/, SavedProjects/, Exports/, Assets/Studio/.
- Browser → server bridge: the web app calls `bridge.call(name, args)`; when the
  server is not running, features needing it show the Swift app's error text
  (never crash). Provider HTTP calls that fail CORS in the browser go through
  the server proxy `POST /proxy` (same request body, server adds nothing).

## Ready-made shared UI pieces (do not re-create)
- `apps/web/src/components/SFSymbol.tsx` + `sfSymbolMap.ts` — every SF Symbol
  used anywhere in the Swift app (236 names, all verified against the installed
  lucide-react) maps to a real lucide icon; unknown names render an initials
  badge so gaps are visible. Use `<SFSymbol name="paintbrush" size={14} />`
  with the VERBATIM Swift symbol string; add new names to the map, never rename
  the key.
- DOM ids the canvas view MUST render (CanvasSnapshotRenderer and get_screenshot
  depend on them): the scrollable canvas root gets `id="agentic-design-canvas"`,
  and each rendered node gets `id="canvas-node-<uuid>"` (uppercase uuid, as
  stored on the node).
- `installWebPlatform()` (apps/web/src/platform/webPlatform.ts) must be called
  once from `main.tsx` before any store is used — it registers the Storage /
  FileSystem / ProcessRunner / Renderer / TextMeasurer adapters.
