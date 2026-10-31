I could not write the file — this agent runs in strict read-only mode (no Write/Edit tools, no shell redirects), so `FEATURE_INVENTORY.md` was not created. The complete inventory follows; paste it to that path verbatim.

---

# FEATURE_INVENTORY.md — AgenticDesigner (Swift → React 1:1 port acceptance checklist)

Root: `/Users/ariel/Documents/XcodeApps/AgenticDesigner/AgenticDesigner/` (120 Swift files). All line refs are `file:line`.

---

## 1. Editor modes and panel composition

- `EditorView.EditorMode` enum, 5 cases with raw values: `design="Design"`, `studio="Studio"`, `logic="Logic"`, `code="Code"`, `pdf="PDF Editor"` — `Views/EditorView.swift:95-101`
- Root layout: `VStack(spacing:0)` = `topToolbar` above an `HStack(spacing:0)` of left / Divider / center / Divider / right-column — `Views/EditorView.swift:104-201`
- Window minimum size `minWidth: 1100, minHeight: 700` — `Views/EditorView.swift:203`
- LEFT panel fixed width **240** for every mode — `Views/EditorView.swift:121`
  - logic → `BlockPaletteView(logicViewModel:)` — `EditorView.swift:112`
  - studio → `CanvasStudioAssetsPanel(viewModel:)` — `EditorView.swift:114`
  - pdf → `PDFPageThumbnailsPanel(viewModel: pdfViewModel)` — `EditorView.swift:116`
  - design & code → `LayersPanel(viewModel:)` — `EditorView.swift:118`
- CENTER `.frame(maxWidth:.infinity, maxHeight:.infinity)` — `EditorView.swift:149`
  - logic → `LogicEditorView(logicViewModel:designViewModel:simulator:)` — `EditorView.swift:128-132`
  - code → `CodeModeView(viewModel:logicViewModel:)` — `EditorView.swift:136`
  - pdf → `PDFCanvasView(viewModel: pdfViewModel)` — `EditorView.swift:138`
  - design & studio → `CanvasView(viewModel:zoomScale:$canvasZoom)` with a bottom overlay `SelectionEditBubble(viewModel:)` padded `.bottom, 14` — `EditorView.swift:140-146`
- RIGHT column fixed width **300**, a `VStack` of inspector (`maxHeight:.infinity`) + Divider + bottom panel — `EditorView.swift:153-200`
  - Inspector slot: logic → `BlockInspectorPanel`; studio → `CanvasStudioInspectorPanel`; pdf → `PDFInspectorPanel`; else `InspectorPanel` — `EditorView.swift:156-167`
  - BOTTOM slot: pdf → `PDFStatusPanel` `.frame(height:180)`; logic → `AgentPanel(..., isLogicMode:true, ...)` `.frame(height:180)`; else `DesignChatPanel(...)` `.frame(minHeight:300)` — `EditorView.swift:173-198`
- Sheets presented from EditorView: `MCPServerPanel` (`showMCPPanel`), `TemplateGalleryView` (`showTemplateGallery`), `WebPreviewView` (`showWebPreview`), `AppPreviewView` (bound to `logicViewModel.showAppPreview`) — `EditorView.swift:208-223`
- `.onAppear` → `installKeyboardMonitor()` + `mcpController.attach(design:logic:simulator:pdf:)` — `EditorView.swift:204-207`
- `.onChange(of: editorMode)`: entering `.logic` → `logicViewModel.attach(to: viewModel)`; leaving → `logicViewModel.persist()` — `EditorView.swift:227-233`
- State owned above the mode switch so it survives mode changes: `DesignChatSession`, `AgentPipelineCoordinator`, `AgentToolLoop`, `MCPServerController`, `LogicSimulator`, `PDFEditorViewModel`, `LogicViewModel`, `ProjectViewModel` — `EditorView.swift:13-24`

---

## 2. Toolbars, menus, pickers (label / SF Symbol / action / enabled rule)

### Top toolbar (`EditorView.topToolbar`, `EditorView.swift:436-542`)
- Mode `Picker` — `.pickerStyle(.segmented)`, `.labelsHidden()`, `.frame(width: 440)`; entries: Design/`paintbrush`, Studio/`photo.artframe`, Logic/`bolt`, Code/`chevron.left.forwardslash.chevron.right`, PDF Editor/`doc.richtext` — `EditorView.swift:439-448`
- Always-present group — `EditorView.swift:452-487`:
  - "Open" / `folder` → `openProject()`
  - "Save" / `square.and.arrow.down` → `saveProject()`
  - "Save As" / `square.and.arrow.down.on.square` → `saveProjectAs()`
  - "Templates" / `square.grid.2x2` → `showTemplateGallery = true`
  - "Web" / `globe` → `showWebPreview = true`
  - "Git" menu / `arrow.triangle.branch` (48×48 label). If `GitSyncService.isEnabled(projectName:)`: "Commit Now" → `gitCommitNow()`; "Push to GitHub" → `gitPush()`; "Open Repo in Finder" → `NSWorkspace.activateFileViewerSelecting(GitSyncService.repoDirectory)`; Divider; "Disable Auto-Commit" → `GitSyncService.disable`. Else single item "Enable Git Sync" → `gitEnable()`
- Mode-conditional group: `pdfToolbarButtons` when `editorMode == .pdf`, else `designToolbarButtons` — `EditorView.swift:491-495`
- `Spacer()`, then `zoomControls` only when `editorMode != .pdf` — `EditorView.swift:497-501`
- MCP button: green/gray 7pt dot + "MCP" text; dot green iff `mcpController.isRunning`; action `showMCPPanel = true`; help text "MCP Server — let external agents (Claude Code, Claude Desktop) control the designer" — `EditorView.swift:505-520`
- `documentMessage` text: red when it starts with "Save failed"/"Open failed", else secondary; `lineLimit(1)`, `maxWidth: 220, alignment: .trailing` — `EditorView.swift:524-530`
- Project name caption, always last — `EditorView.swift:532-534`
- Toolbar chrome: `padding(.horizontal,12) .padding(.vertical,6)`, `windowBackgroundColor`, bottom Divider overlay — `EditorView.swift:536-541`

### Design toolbar (`designToolbarButtons`, `EditorView.swift:546-632`)
- "Device" menu / `iphone` — one Button per `DevicePresetLibrary.all` → `viewModel.addDeviceFrame(preset)` — `EditorView.swift:550-567`
- "Text" / `textformat` → `addTextNode()` — `:569`
- "Button" / `capsule` → `addButtonNode()` — `:570`
- "Frame" / `rectangle` → `addFrameNode()` — `:571`
- "Brand" menu / `paintbrush.pointed` — 8 swatches then Divider then "Pick Custom Colour…". Each swatch: `CheckpointStore.save(label: "before brand: <name>")` then `BrandKit.apply(BrandIdentity(accent: hex, accentSecondary: nil, name:), to:)` — `EditorView.swift:575-593`
  - `brandSwatches` = Coral `#F0653C`, Indigo `#4F46E5`, Emerald `#10B981`, Amber `#F59E0B`, Rose `#E11D48`, Teal `#0F766E`, Violet `#7C3AED`, Slate `#334155` — `EditorView.swift:32-36`
  - "Pick Custom Colour…" → `pickBrandColor()` opens `NSColorPanel.shared` (`showsAlpha=false`, modeless), reads sRGB colour on `willCloseNotification`, formats `#%02X%02X%02X`, checkpoints "before brand: <hex>", applies brand named "Custom" — `EditorView.swift:38-57`
- "Theme" menu / `paintpalette` — one Button per `VisualStylePreset.allCases`: checkpoint "before theme: <preset>", `ThemeApplier.apply(preset, to:)`, then `BrandKit.reapplyIfSet(to:)` — `EditorView.swift:598-615`
- Divider, media group: "Image" / `photo` → `addImageNode()`; "Icon" / `star.circle` → `addIconNode()` — `EditorView.swift:621-624`
- Divider, "Delete" / `trash` → `viewModel.deleteSelectedNode()`; **disabled when `viewModel.selectedNodeId == nil`**; foreground red when enabled, secondary when disabled — `EditorView.swift:629-631`

### PDF toolbar (`pdfToolbarButtons`, `EditorView.swift:634-668`)
- "New" / `doc.badge.plus` → `pdfViewModel.newDocument()`
- "Prev" / `chevron.left` → `currentPageIndex = max(0, currentPageIndex-1)`; **disabled when `currentPageIndex <= 0`**
- Page counter `"\(pageCount==0 ? 0 : currentPageIndex+1) / \(pageCount)"`, monospaced 11pt, `minWidth: 44`
- "Next" / `chevron.right` → `currentPageIndex = min(pageCount-1, currentPageIndex+1)`; **disabled when `currentPageIndex >= pageCount-1`**
- Divider; current `toolMode.rawValue` label (accent colour unless `.select`); a "Done" button shown only when `toolMode != .select` → sets `toolMode = .select`

### Zoom controls (`zoomControls`, `EditorView.swift:692-725`)
- `minus.magnifyingglass` → `zoomOut()` (`/1.2`); **disabled when `canvasZoom <= 0.25`**
- Percentage button `"\(Int((canvasZoom*100).rounded()))%"` monospaced, 54×28 → `resetZoom()` (`1.0`)
- `plus.magnifyingglass` → `zoomIn()` (`*1.2`); **disabled when `canvasZoom >= 3.0`**
- `setZoom` clamps to `0.25…3.0` — `EditorView.swift:739-741`
- Generic `toolbarButton` shape: VStack(icon 14pt, title 10pt), frame 48×40, `.buttonStyle(.plain)`, `.help(title)` — `EditorView.swift:677-690`. Menus use a 48×48 VStack label with `.menuStyle(.borderlessButton)`.

### Logic-mode toolbar (`LogicEditorView.flowToolbar`, `Views/Logic/LogicEditorView.swift:74-243`)
- `bolt.fill` (yellow) glyph — `:76`
- Flow `Picker` bound to `currentFlowId`, `labelsHidden`, `frame(width:160)`; on set also calls `validate()` — `:80-89`
- `plus.circle` "New Flow" → `createFlow(name: "Flow \(count+1)")` — `:91-97`
- `minus.circle` "Delete Current Flow" → `deleteFlow(id: currentFlowId)` — `:99-107`
- `issuesBadge`: when no issues → Label "Valid"/`checkmark.circle` green; else Button `"N issue(s)"`/`exclamationmark.triangle` red if any `.error` else orange, opens a 320pt popover listing issues; tapping an issue selects `issue.blockId` and closes — `:245-283`
- "Preview" / `iphone` (blue) → `logicViewModel.showAppPreview = true` — `:116-124`
- "Run" / `play.fill` (green) → `showSimulatorPanel = true; simulator.run()`; **disabled while `simulator.isRunning`** — `:127-137`
- "Stop" / `stop.fill` (red) → `simulator.stop()`; shown only while `simulator.isRunning` — `:139-148`
- "Reset UI" / `arrow.uturn.backward` → `simulator.resetUI()`; shown only when `simulator.hasUIChanges` — `:150-159`
- `chevron.down.square` "Hide simulator console" → `showSimulatorPanel = false`; shown when panel visible and not running — `:161-170`
- Spacer, then "Templates" menu / `square.stack.3d.up` — one item per `FlowTemplateLibrary.all` (Label(template.name, systemImage: template.icon), `.help(template.description)`) → `insertTemplate` — `:174-189`
- "Firebase" / `flame` → `showFirebaseConfig = true` — `:191-197`
- "API" / `network` → `showAPIManager = true` — `:199-205`
- Divider; "Export" / `square.and.arrow.up` → `exportBlueprint()` = `LogicExporter.exportWithSavePanel(...)`, message cleared after 4s — `:209-215`, `:287-297`
- "Run" target Menu / `play.fill` (label becomes "Building…" while running) with `RunTarget` cases iPhone/`iphone`, iPad/`ipad`, Apple Watch/`applewatch`, Mac/`macbook`; **disabled while `isRunningInSimulator`** — `:217-232`, `:27-42`
  - iPhone/iPad → export SwiftUI source to `tmp/AgenticDesignerSimulatorRun`, `SimulatorRunner.buildAndLaunch` — `:303-353`
  - Apple Watch → auto-enables `.appleWatch` platform (with `snapshot()`), exports Xcode project to `tmp/AgenticDesignerAppleWatchRun`, `SimulatorRunner.buildAndLaunchWatch` — `:355-403`
  - Mac → "Mac target export is not available yet" — `:408-411`
- Trailing `exportMessage` caption — `:234-238`

### Studio assets panel (`CanvasStudioAssetsPanel`, `Views/CanvasStudioPanel.swift:10-440`)
- Header "Studio"; sections: Artboards / Create / AI Image / Sprites / Pages
- Artboards: W and H number inputs (`customWidth` 100, `customHeight` 180 defaults); "Create Custom"/`plus.rectangle` → `addArtboard(name:"Custom Artboard", …)`; 2-col grid of tiles (icon, title, detail): Post/`square`/"1080" (1080×1080), Story/`rectangle.portrait`/"1080x1920", Banner/`rectangle`/"1600x900", A4/`doc`/"print" (794×1123), Mizmor/`text.book.closed`/"100x180cm" → `addMizmorLetodahArtboard()`, Mizmor Shape/`album`/"100x180cm" → `addMizmorShapeArtboard()` — `:40-79`
- Create: Text/`textformat`→`addStudioText()`; Photo/`photo`→`chooseImage()` (NSOpenPanel .image); Frame/`rectangle.on.rectangle`→`addFrameNode()`; Rect/`rectangle`→`addStudioShape("Rectangle","#D1D5DB",0)`; Round/`square.roundedbottom`→`addStudioShape("Rounded Shape","#111827",28)`; Icon/`sparkles`→`addIconNode()` — `:81-96`
- AI Image: multiline prompt field (default "editorial product photo, clean studio lighting"), "Generate Image"/`wand.and.stars` borderedProminent; **disabled while generating or prompt empty**; error text in red — `:98-127`, `generateAIImage()` `:276-313` (adds placeholder image node immediately, then `OpenRouterProvider.generateImageAsset`, then `setGeneratedImage`)
- Sprites: prompt field (default "glowing power-up orb, clean game sprite, side view"); Facing menu picker (Right ▶ / ◀ Left / Front / Back / Top → tags right/left/front/back/up); `Stepper("Frames: n", in: 1...8)`; checkbox "Match existing game art" **disabled when `gameArtRefCount == 0`**; button "Design Sprite" or "Design N-Frame Sprite" / `sparkles.rectangle.stack`, **disabled while generating or prompt empty**; library grid (3 cols) of `SpriteGenerator.librarySprites()` — click adds image node, top-trailing `arrow.left.arrow.right` flips via `SpriteGenerator.flipHorizontal` — `:129-235`, `generateSprite()` `:342-374`
- Pages: one button per project page (checkmark.circle.fill / circle + name + node count) → `selectPage(index:)`; "New Page"/`plus` → `addPage(name:"Studio Page")` then select it — `:237-262`

### Studio inspector export menu (`CanvasStudioInspectorPanel`, `Views/CanvasStudioPanel.swift:442-974`)
- Header "Canvas Studio" + `square.and.arrow.up` menu: "Export PDF"/`doc.richtext`, "Export JPEG"/`photo` — `:455-471`
- Full field list in §8.

### MCP server panel (`Views/MCPServerPanel.swift`)
- Header Label "MCP Server"/`point.3.connected.trianglepath.dotted`; "Done" button with `.keyboardShortcut(.defaultAction)` — `:49-59`
- Running toggle (`.switch`) bound to `controller.isRunning` → `setEnabled` + status dot (green/gray) and "Running"/"Stopped"; Port TextField (placeholder "8765", width 70) **disabled while running**, applied on submit/change only if `Int` in `1024...65535` — `:61-89`, `:199-202`
- Connect instructions shown only while running: copy rows "Endpoint" (`controller.endpointURL`) and "Claude Code" (`controller.claudeCodeCommand`); copy button toggles to a checkmark for 1.5s — `:92-139`
- "Exposed tools" list — one row per `controller.makeTools()` with `wrench.and.screwdriver` icon — `:141-156`
- "Activity" call log (timestamp + message, monospaced 10pt, auto-scrolls to last) — `:158-197`
- Sheet frame `520 × 560` — `:43`

### Agent panel (`Views/AgentPanel.swift`) controls
- SecureField "OpenRouter API Key" ↔ `@AppStorage("openRouterAPIKey")` — `:46`
- ChatGPT subscription row: status dot, and one of "Install…" (copies `brew install codex`) / "Sign in with ChatGPT" / "Run goal on subscription", plus a "↻" refresh; buttons disabled while `chatGPT.isBusy` — `:226-297`
- DisclosureGroup "Free provider keys (N configured)" with rows for Google AI Studio/`gemini`, Cerebras, Groq, NVIDIA NIM — each: green/gray dot, SecureField, and either "Get key" (opens `ModelProviderCatalog.signupURL`) when empty or "Test" (fetches model list) when filled; Test **disabled while another test runs** — `:54-66`, `:299-354`
- "Model" Picker (`.menu`) over `OpenRouterConfiguration.availableModels`, plus a fallback tag for an unknown stored id — `:68-77`
- "Build" Picker (`.menu`): "Same as Model" tag `""` plus all models; help "Model for Stage 2 (JSON generation)…" — `:79-86`
- Toggle (checkbox) "Auto review & polish after generation" ↔ `autoCriticEnabled` — `:88-90`
- "Mode" segmented Picker Agent Loop/`loop` vs Pipeline/`pipeline` — shown only when `mcpController != nil` — `:92-98`
- Cost approval field "$" `agentLoopCostApprovalUSD` (2 fraction digits, width 58) — shown only in loop mode — `:100-117`
- Prompt TextField, placeholder "Describe the logic to create..." in logic mode else "Ask Agent..." — `:120`
- "Run Agent"/`sparkles` (label becomes `pipeline.state.rawValue` or `loop.statusLine` while running); **disabled when pipeline or loop running, or prompt blank** — `:124-144`
- "Critic & Fix"/`eye` → `runCriticAgent()`; **disabled when pipeline or loop running** — `:146-153`
- "Build App"/`hammer.fill` borderedProminent (label shows current `buildStage`); design mode only; **disabled when pipeline running, a build is in flight, or prompt blank** — `:163-174`
- "History"/`clock.arrow.circlepath` menu of the newest 15 `CheckpointStore.list(projectName:)` entries (`date — label`) → `restoreCheckpoint` — `:176-189`
- Footer "OpenRouter · <model>"; red `pipeline.errorMessage` — `:192-202`

### Design chat panel (`Views/DesignChatPanel.swift`)
- Header Label "Agent"/`bubble.left.and.text.bubble.right`; trash button clears conversation (shown only when messages exist) — `:76-93`
- Message bubbles: user (accent 14% background, plus "Revert this"/`arrow.uturn.backward` when a checkpoint exists), agent (`sparkles` + spinner + stage text while running), system (italic caption2) — `:107-152`
- Composer: `cpu` + model Picker; route-matched SecureField with green/orange dot and a "Get key" button when unconfigured, plus `route.freeTierNote`; engine segmented Picker "Agent Loop"(only when MCP available)/"Build"/"Edit"; cost-approval field when loop; message TextField (1…4 lines, submit on Enter) + `arrow.up.circle.fill` send; **send disabled while `session.isRunning` or input blank** — `:176-268`
- `AgentLoopActivityView` shown when loop mode and (running or plan non-empty); `MCPDelegatedLoopMirror` always when MCP present — `:59-67`
- Engine routing in `send()`: `loop` → `AgentToolLoop.run(goal:)`; `build` → `AppBuildOrchestrator.buildApp`; `edit` → `DesignAgentService.runFullPipeline` — `:282-312`

### Agent loop activity view (`Views/AgentLoopActivityView.swift`)
- Plan checklist: `checkmark.circle.fill` green (done) / `arrow.triangle.2.circlepath.circle.fill` blue (doing) / `circle` (pending); done items struck through — `:38-58`
- Transcript scroller (`minHeight 80, maxHeight 200`) with kind icons: info=`text.bubble`, tool=`wrench.and.screwdriver`, result=`arrow.turn.down.right`, error=`exclamationmark.triangle`, steer=`person.wave.2`, done=`checkmark.seal.fill`; colours error=orange, done=green, steer=purple, tool=blue, else secondary — `:60-94`, `:219-237`
- Pending question card: `questionmark.bubble.fill`, vertical option buttons (first marked with a yellow `star.fill`), free-text field + "Answer" + "Skip" — `:99-144`
- Cost line `dollarsign.circle` "Run N in · M out · $X.XXXX" (+ orange "approval needed") — `:147-161`
- Controls while running: steer TextField + "Send", pause/play toggle (`pause.circle.fill` orange / `play.circle.fill` green), stop (`stop.circle.fill` red) — `:163-205`

### Template gallery (`Views/TemplateGalleryView.swift`)
- Title "Start from a Template", "Close" button, adaptive grid (min 220, spacing 16), card = 150pt live thumbnail + name + "<subtitle> · N screens" + "Use Template" borderedProminent button (label "Creating…" while applying, **disabled while any template is applying**) — `:21-85`
- `apply` checkpoints "before template: <name>", CLEARS the current page's `nodes` and `logicFlows`, then `applyDesignActions(TemplateFactory.actions(for:))`, then dismisses — `:87-99`
- Thumbnails rendered by instantiating each template on a scratch `ProjectViewModel` and snapshotting at `maxDimension: 640` — `:103-116`
- Sheet frame `780 × 560` — `:44`

### PDF status panel (`Views/PDF/PDFStatusPanel.swift`)
- Header `doc.richtext` + "PDF Editor"; `statusMessage` caption (2 lines)
- Undo `arrow.uturn.backward` / Redo `arrow.uturn.forward` (bordered, small); orange dot + "Unsaved" when `isDirty` — `:38-56`
- Batch translate: while running shows spinner + `batchProgress` + "Cancel"; otherwise "Translate Pages…"/`globe` **disabled when `document == nil`**, opens a sheet with From/To page fields (defaults current page → current+5) and "Translate"(`.defaultAction`, disabled unless both parse as Int) → `viewModel.translatePages(from:to:)` — `:60-85`, `:136-174`
- "GOOGLE TRANSLATION" section: progress + Cancel while running; "Translate Full PDF…"/`globe` **disabled when no document or already running** → `runGooglePDFTranslation()` — `:89-118`
- "Flatten & Export…"/`square.and.arrow.up.on.square` → NSSavePanel defaulting to `<name>-flattened.pdf` → `exportFlattened(to:)` — `:120-127`, `:176-184`

### PDF thumbnails panel (`Views/PDF/PDFPageThumbnailsPanel.swift`)
- Header "Pages" + count + `plus.rectangle` "Add page after the current one" — `:46-63`
- Per page: thumbnail (200pt max dimension via `PDFPage.thumbnail`), page-number badge, accent border/tint when selected, tap selects, drag reorders (`PageDropDelegate`, destination = `source < target ? target+1 : target`) — `:65-104`, `:136-150`
- Row buttons: `rotate.left` (−90), `rotate.right` (+90), `plus.square.on.square` (duplicate), `trash` red (remove) **disabled when `pageCount <= 1`** — `:93-99`
- Context menu: Duplicate Page / Rotate Left / Rotate Right / Add Page After / Delete Page (destructive, disabled at 1 page) — `:124-133`

---

## 3. Keyboard shortcuts and mode-aware routing

Hidden SwiftUI shortcut buttons (`EditorView.swift:234-256`):
- `⌘Z` → `undoForCurrentMode()`
- `⇧⌘Z` → `redoForCurrentMode()`
- `Delete` (`\u{7F}`) and `.delete` (forward delete) → `deleteForCurrentMode()`
- `⌘S` → `saveProject()`
- `⇧⌘S` → `saveProjectAs()`
- `⌘O` → `openProject()`

`NSEvent.addLocalMonitorForEvents(.keyDown)` (`EditorView.swift:360-413`):
- `⌘Z` / `⌃Z` (with `⇧` for redo) in `.code` mode → `performCodeEditorUndo(redo:)` against the focused `NSTextView.undoManager`; handled BEFORE the text-focus bail-out; swallows the event only if it actually undid/redid — `:373-375`, `:282-298`
- All remaining handling is skipped while a text field/view is first responder (`isTextInputFocused`, `:424-434`)
- `⌘Z` / `⌃Z` (+`⇧`) → undo/redo for current mode — `:381-388`
- `⌘+` / `⌘=` (or `⌃`) → `zoomIn()`; `⌘-` → `zoomOut()`; `⌘0` → `resetZoom()` — `:390-403`
- keyCode 51 (Delete) or 117 (Forward Delete) → `deleteForCurrentMode()` — `:405-408`
- Monitor removed on `.onDisappear` — `EditorView.swift:224-226`, `:415-422`

Mode routing:
- `undoForCurrentMode` — code → code-editor undo (returns early); pdf → `pdfViewModel.undo()`; logic → `logicViewModel.undo()`; else `viewModel.undo()` — `:261-269`
- `redoForCurrentMode` — same shape — `:271-276`
- `deleteForCurrentMode` — pdf → `pdfViewModel.removeAnnotation(selectedAnnotation)` if any; logic → `logicViewModel.deleteSelected()`; else `viewModel.safeDeleteSelectedNode()` — `:300-308`
- `saveProject` / `saveProjectAs` — pdf → `pdfViewModel.save()` / `.saveAs()` and mirrors `pdfViewModel.statusMessage`; else `logicViewModel.persist()` then `ProjectDocumentService.save(project:to:)` — `:310-338`
- `openProject` — pdf → `pdfViewModel.openWithPanel()`; else persist logic, `ProjectDocumentService.open()`, `viewModel.replaceProject`, re-`attach` logic — `:340-358`

Other shortcuts:
- MCP panel "Done" = `.defaultAction` — `MCPServerPanel.swift:57`
- Code Mode "Apply Edit" = `⌘↩` — `CodeModeView.swift:204`
- PDF translate sheet "Translate" = `.defaultAction` — `PDFStatusPanel.swift:168`
- Canvas modifier keys (not shortcuts): `⇧` = toggle selection / axis-constrained drag / uniform group resize; `⌘` or `⌥` = deepest hit test — `CanvasView.swift:248-273`, `:390-398`, `:549`

---

## 4. View models / controllers — public API

### `ProjectViewModel` (`ViewModels/ProjectViewModel.swift`, `ObservableObject`, not `@MainActor`)
@Published:
- `project: DesignProject` `:12` — the whole design document
- `selectedNodeId: UUID?` `:13` — primary selection; `didSet` keeps `selectedNodeIds` consistent
- `selectedNodeIds: Set<UUID>` `:28` — multi-selection set (always contains the primary)
- `canvasFocusRequest: CanvasFocusRequest?` (private(set)) `:31` — "reveal this layer on canvas" request with a fresh `requestId`
- `currentPageIndex: Int` `:32`
- `undoStack: [DesignProject]` `:33`, `redoStack: [DesignProject]` `:34`

Public computed: `currentPage` `:44`; `selectedNode` `:218`; `selectedContainerNodeId` (Frame only) `:224`; `agentContainerNodeId` `:236`; `selectedNodeGlobalRect` `:378`; `selectionGlobalRect` (union of all selected) `:385`; `selectedNodeBinding` `:392`; static `screensPerRow = 6` `:2320`; static `autoHugTextBoxes` (UserDefaults `autoHugTextBoxes`, default true) `:4474`.

Public methods (name — one-line purpose):
- `selectPage(index:)` `:49` — switch page and clear selection
- `snapshot()` `:57` — push project onto the undo stack (cap 50) and clear redo
- `undo()` `:63` / `redo()` `:70` — swap project between stacks, clear selection
- `replaceProject(_:)` `:77` — load a project, re-hug text, heal clipping, reset stacks
- `safeDeleteSelectedNode()` `:99` — delete unless a text field is focused
- `makeAgentContext(userPrompt:)` `:251` — build the full `AgentContext` (intent, recipes, tokens, layout issues, container hints)
- `selectNode(_:)` `:404` — single-select
- `selectAndRevealNode(_:)` `:409` — select and emit a canvas focus request
- `toggleNodeInSelection(_:)` `:416` — shift-click add/remove
- `clearSelection()` `:428`
- `selectNodes(in:extending:)` `:432` — marquee selection over the rect
- `shouldBeginMarqueeSelection(fromHitNode:)` `:465` — true for screen roots / pass-through backgrounds
- `moveNode(id:toX:y:)` `:472` — move any node, drop constraints, mark manually positioned
- `node(id:)` `:485` — find a node by id
- `studioExportNodes()` `:489` — nodes the Studio print export should render
- `parentOfNode(_:)` `:509`; `isRootNode(_:)` `:513`; `globalRect(for:)` `:517`
- `reparentNode(_:toParent:)` `:673` — move a node into another parent, preserving screen position, clamped
- `canReparentNode(_:toParent:)` `:708`
- `clampedPositionForMove(nodeId:proposedX:proposedY:)` `:713`
- `hitTestChain(at:)` `:741` — outermost→innermost stack under a point
- `hitTestNodeId(at:mode:)` `:875` — `.smart` (drill-in) or `.deepest`
- `groupResizeStart()` `:1030` — frames + union bounds captured at drag start
- `applyGroupResize(handle:translation:startFrames:startBounds:uniform:)` `:1045` — scale the selection as one object
- `rootScreen(containing:)` `:1125`
- `updateSelectedNode(_:)` `:1251` / `updateSelectedNodeAndRelayout(_:)` `:1261` — single-target edit
- `updateSelectedNodes(_:)` `:1272` / `updateSelectedNodesAndRelayout(_:)` `:1279` — broadcast to the whole selection
- `deleteSelectedNode()` `:1303` — delete every selected node (with snapshot)
- `addTextNode()` `:1320`, `addButtonNode()` `:1349`, `addDeviceFrame(_:)` `:1390`, `addFrameNode()` `:1416`, `addArtboard(name:width:height:fill:)` `:1442`, `addMizmorLetodahArtboard()` `:1471`, `addMizmorShapeArtboard()` `:1561`, `addStudioText()` `:1608`, `addStudioShape(name:fill:cornerRadius:)` `:1638`, `addImageNode()` `:4362`, `addImageNode(source:name:)` `:4382`, `addIconNode()` `:4402`
- `moveSelectedNode(toX:y:)` `:1374`; `resizeSelectedNode(x:y:width:height:)` `:1663`
- `nodesExcluding(_:)` `:1676` — snapping targets
- `applyDesignActions(_:) -> [String: UUID]` `:1685` — apply agent actions and run every normalization pass
- `applyDesignActionsExactly(_:) -> [String: UUID]` `:1765` — apply with exact coordinates (MCP path); only text hugging runs
- `nodeForSimulation(id:)` `:1842`; `simulateUpdateNode(id:_:)` `:1861`; `snapshotNodesForSimulation()` `:1876`; `restoreNodesFromSimulation(_:)` `:1880`
- `repeatTemplateForOrAncestorOf(_:)` `:1849` — which repeat template a node belongs to
- `setLogicBinding(nodeId:kind:variableName:)` `:1865`
- `currentArtReferenceImagePaths(limit:)` `:1888` — existing art paths for style-matched sprite generation
- `setGeneratedImage(nodeId:imagePath:)` `:1911`
- `addPage(name:)` `:4340`, `deletePage(at:)` `:4346` (blocked at 1 page), `renamePage(at:name:)` `:4355`
- `duplicateSelection()` `:4423` (+24/+24 offset, fresh ids, name " Copy"), `bringSelectionToFront()` `:4443`, `sendSelectionToBack()` `:4447`
- `fitTextNodeToContent(id:) -> Bool` `:4460`; `hugTextBoxIfEnabled(id:)` `:4520`; `fitTextNodesToContent(under:) -> Int` `:4622`
- `clipRoundedContainers(in:)` `:4484` — auto-clip rounded containers with oversized media, un-clip intentional protrusions
- `saveSelectionAsComponent(name:category:)` `:4647`; `insertComponent(_:at:) -> UUID` `:4655`
- `alignChildren(of:to:)` `:4671`; `distributeChildren(of:axis:)` `:4679`
- `alignSelection(_:)` `:4694` — 1 node aligns within its parent; ≥2 align to each other
- `distributeSelection(axis:)` `:4761` — requires ≥3
- `setSelectedImageSource(_:)` `:4803`
- Enums: `CanvasHitMode {smart, deepest}` `:729`; `CanvasStudioAlignment {left,center,right,top,middle,bottom}` `:4854`; `CanvasStudioDistributionAxis {horizontal,vertical}` `:4860`

### `LogicViewModel` (`ViewModels/LogicViewModel.swift`, `@MainActor`)
@Published: `flows` `:19`, `currentFlowId` `:20`, `selectedBlockId` `:21`, `selectedConnectionId` `:22`, `validationIssues` `:23`, `isConnecting` `:26`, `connectionDragStart` `:27`, `connectionDragEnd` `:28`, `canvasOffset` `:33`, `canvasZoom` `:34`, `showFirebaseConfig` `:37`, `showAPIManager` `:38`, `showAppPreview` `:41`, `simActiveBlockId` `:44`. Non-published: `connectionSourceBlockId` `:29`, `connectionSourcePortIndex` `:30`, `designViewModel` (weak) `:46`.
Methods: `attach(to:)` `:55` (load page flows, create "Flow 1" if empty, validate); `persist()` `:74`; `createFlow(name:screenId:)` `:91`; `deleteFlow(id:)` `:99`; `renameFlow(id:to:)` `:112`; `applyGenerated(flows:)` `:120`; `insertTemplate(_:)` `:135` (unique-names the flow); `addBlock(type:at:)` `:160`; `deleteBlock(id:)` `:173`; `deleteSelected()` `:183`; `duplicateBlock(id:)` `:192` (+32/+32, fresh param ids); `moveBlock(id:to:)` `:212`; `commitBlockMove()` `:221`; `toggleCollapsed(id:)` `:225`; `updateComment(blockId:comment:)` `:233`; `updateLabel(blockId:label:)` `:242`; `updateParameter(blockId:paramKey:value:)` `:252`; `linkParameterToNode(...)` `:258`; `linkParameterToVariable(...)` `:264`; `validateConnection(from:to:targetPort:)` `:297`; `connectBlocks(from:port:to:targetPort:)` `:326`; `disconnectBlocks(connectionId:)` `:343`; `beginConnectionDrag(from:port:at:)` `:353`; `updateConnectionDrag(to:)` `:361`; `endConnectionDrag(at:)` `:366`; `addVariable(name:type:scope:defaultValue:)` `:401`; `setPlatform(_:enabled:)` `:413`; `setDefaultPreviewPlatform(_:)` `:431`; `deleteVariable(id:)` `:440`; `snapshot()/undo()/redo()` `:486/:494/:502` (cap 60); `validate()` `:512`; `hasIssue(blockId:)` `:559`. Computed: `currentFlow` `:83`, `selectedBlock` `:154`, `allVariables` `:395`, `designNodesFlat` `:453`, `designScreens` `:469`, `designNodeName(for:)` `:479`.
`BlockGeometry` — `headerHeight 34`, `paramRowHeight 26`, `footerHeight 22`; `height(for:)`, `inputPortPosition` (top-centre), `outputPortPosition(portIndex:)` (bottom, evenly divided) — `:566-588`

### `PDFEditorViewModel` (`ViewModels/PDFEditorViewModel.swift`, `@MainActor`)
@Published: `document` `:21`, `fileURL` `:22`, `currentPageIndex` `:23`, `toolMode` `:24`, `selectedAnnotation` `:25`, `isDirty` `:26`, `annotationStyle` `:27`, `statusMessage` `:28`, `zoomScale` `:29`, `metadata` `:30`, `externalPDFTranslationProgress` `:33`, `isExternalPDFTranslationRunning` `:34`, `revision` (private(set)) `:42`, `batchProgress` `:818`. Non-published: `translator: LocalModelTranslator` `:32`.
Computed: `pageCount` `:44`, `pages: [PDFPageSummary]` `:46`, `currentPage` `:55`, `isBatchTranslating` `:820`.
Methods: `runGooglePDFTranslation()` `:62`; `cancelGooglePDFTranslation()` `:145`; `newDocument(pageSize:)` `:155` (default 612×792); `open(url:)` `:172`; `openWithPanel()` `:189`; `save()` `:204`; `saveAs()` `:210`; `exportFlattened(to:)` `:240`; `withSingleUndoStep(_:)` `:296`; `undo()` `:315` / `redo()` `:324` (data snapshots, cap 40); `addPage(after:size:)` `:343`; `removePage(at:)` `:355`; `duplicatePage(at:)` `:367`; `reorderPage(from:to:)` `:447`; `rotatePage(at:by:)` `:463`; `cropPage(at:to:)` `:472`; `addAnnotation(type:bounds:page:…)` `:483`; `addFreeText(bounds:page:text:)` `:508`; `addInkDrawing(strokes:page:color:lineWidth:)` `:521`; `addSignature(strokes:page:)` `:559`; `addSignatureImage(_:bounds:page:)` `:564`; `addFormField(kind:bounds:page:name:)` `:576`; `removeAnnotation(_:)` `:601`; `moveAnnotation(_:to:recordUndo:)` `:610`; `editText(bounds:page:newText:backgroundColor:alignment:fitToBounds:verticalLift:)` `:634`; `revertOverlayEdits(on:) -> Int` `:725`; `replaceImage(bounds:page:newImage:backgroundColor:)` `:755`; `translationMemory(for:)` `:810`; `translatePage(at:targetLanguage:minWords:concurrency:includeHeadings:)` `:830`; `translatePages(from:to:concurrency:)` `:1134`; `cancelBatchTranslation()` `:1159`; `paragraph(at:on:)` `:1172`; `paragraphs(on:)` `:1216`; `rewritePage(at:targetLanguage:concurrency:)` `:1424`; `buildTranslatedPage(at:targetLanguage:concurrency:)` `:1759`; `text(at:on:)` `:1964`; `pageText(at:)` `:1971`.

### `MCPServerController` (`Services/MCPServerController.swift`, `@MainActor`)
@Published: `isRunning` (private(set)) `:37`, `lastError` `:38`, `callLog` (private(set), capped 200) `:39`, `activeAgentLoop: AgentToolLoop?` `:43`, `port: UInt16` (persists to `mcpServerPort`) `:44`.
Weak refs: `designViewModel`, `logicViewModel`, `previewSimulator`, `pdfViewModel` `:48-51`.
Methods: `attach(design:logic:simulator:pdf:)` `:79` (auto-starts when `mcpServerEnabled` or `AGENTIC_MCP_PORT` present); `setEnabled(_:)` `:94`; `start()` `:103`; `stop()` `:190`; `makeTools() -> [MCPToolDefinition]` `:568`; static `makePrompts()`; `endpointURL` `:72`; `claudeCodeCommand` `:74`. Private: bind retry loop (`maxBindRetries = 30`, 2s interval) `:177-188`; `appendLog` `:196`.

### `LogicSimulator` (`Services/LogicSimulator.swift`, `ObservableObject`)
@Published: `isRunning` `:31`, `log: [SimLogEntry]` `:32`, `variables: [String:String]` `:39`, `awaitingChoice: BranchChoice?` `:47`, `speed = 0.14` `:48`, `hasUIChanges` `:49`, `previewScreenId` `:52`, `previewPlatform = .iPhone` `:55`, `toastMessage` `:57`. Weak: `logicViewModel`, `designViewModel` `:60-61`. Callback `onNavigate: ((UUID)->Void)?` `:64`.
Methods: `runTap(on:itemContext:)` `:70`; `runSwipe(on:direction:itemContext:)` `:89`; `primeVariables()` `:114`; `runEvent(_:nodeId:)` `:127`; `run()` `:177`; `stop()` `:236`; `resetUI()` `:247`; `stopAllTimers()` `:266`; `scheduleScreenTimers(for:)` `:276`; `handleGameEvent(_:)` `:346`; `choose(_:)` `:541`; `setInputValue(nodeId:text:)` `:1776`. `BranchChoice { blockLabel, labels }` `:26`. Preview variables persist under `AgenticDesignerPreview.<key>` `:1158`.

### `DesignChatSession` (`Services/DesignChatSession.swift`, `@MainActor`)
@Published: `messages` (private(set)) `:37`, `isRunning` (private(set)) `:38`. `Role {user, agent, system}` `:18`; `Message {id, role, text, date, checkpoint, stage, isRunning, summary}` `:24-35`.
Methods: `appendUser(_:checkpoint:) -> UUID` `:42` (also appends a running agent placeholder); `updateStage(_:_:)` `:50`; `finish(_:summary:)` `:55`; `fail(_:error:)` `:63`; `appendSystem(_:)` `:71`; `revert(to:design:)` `:77` (loads the checkpoint, checkpoints current, truncates the thread); `clear()` `:88`.

### `AgentPipelineCoordinator` (`Agent/AgentPipelineCoordinator.swift`, `@MainActor`)
@Published: `state: PipelineState` `:16`, `errorMessage: String?` (logs on set) `:17`, `isRunning` `:24`.
`PipelineState` raw values: `idle=""`, `planning="Planning Strategy & Design System..."`, `generating="Generating Architecture & Components..."`, `generatingAssets="Generating Visual Assets..."`, `reviewing="Reviewing & Polishing..."`, `applying="Applying to Canvas..."` — `:5-12`
Methods: `runPipeline(userPrompt:context:provider:generationProvider:screenshotDataURL:onComplete:)` `:26` — Stage 1 strategy (text, screenshot attached) → Stage 2 generation (JSON actions) → `onComplete`; `runCriticPass(provider:context:pageNodes:screenshotDataURL:)` `:105`; `stageOneInstructions(for:)` per intent `:131`.

### `AgentToolLoop` (`Agent/AgentToolLoop.swift`, `@MainActor`)
@Published (all private(set) unless noted): `transcript` `:55`, `plan` `:56`, `isRunning` `:57`, `isPaused` `:58`, `statusLine` `:59`, `finalSummary` `:60`, `runCostUSD` `:61`, `runPromptTokens` `:62`, `runCompletionTokens` `:63`, `usedModelIds` `:64`, `costApprovalRequired` `:65`, `costApprovalIncrementUSD` `:66`, `pendingQuestion` `:77`.
Public vars: `questionTimeoutSeconds = 600` `:81`, `presetAnswers` `:85`, `requiredProviderId` `:90`, `requiredModelId` `:93`, `mcp` (weak) `:96`.
Methods: `cancel()` `:135`; `pause()` `:148`; `resume()` `:154` (approves the next cost band); `answer(_:)` `:189`; `skipQuestion()` `:200`; `steer(_:)` `:246`; `run(goal:) -> String` `:257`. Static: `toolAllowlist` `:1138`, `screenshotTools` `:1149`, `visualMutationTools` `:1153`, `fullDescriptionTools` `:1161`, `essentialToolNames` `:1412`, `localToolSchemas` `:1214`, `schema(for:)` `:1165`, `stringFlattened(_:)` `:1181`, `reparsingJSONStrings(in:original:)` `:1200`, `truncated(_:limit:)` `:1380`, `promptTokenBudget()` `:1397`, `approximateTokenCount(_:)` `:1404`, `trimmedForContext(...)` `:1417`. Logger subsystem `com.agenticdesigner.agent`, category `loop` `:37`.

---

## 5. MCP tools, schemas, transport

### Transport (`Services/MCPServer.swift`, `Services/MCPServerController.swift`)
- Streamable HTTP, JSON-RPC 2.0, **stateless** (no session ids), one message per POST, `application/json` responses — `MCPServer.swift:5-13`
- Binds `127.0.0.1` only via `NWParameters.requiredLocalEndpoint`; default port fallback `8765` — `MCPServer.swift:115-121`
- Path `/mcp` (also accepts `/`); anything else → 404 with body "Not found — MCP endpoint is /mcp" — `MCPServer.swift:86`, `:289-292`
- **Origin check**: any `Origin` header whose host is not `127.0.0.1`, `localhost`, or `::1` → `403 Forbidden origin` (anti DNS-rebinding) — `MCPServer.swift:283-287`
- Methods: `POST` → JSON-RPC; `OPTIONS` → 204; `GET`/`DELETE` → 405 with `Allow: POST`; anything else → 405 — `MCPServer.swift:294-305`
- Max body 20 MB (`maxBodyBytes`), header block cap 64 KB, keep-alive supported — `MCPServer.swift:100`, `:178-181`, `:232-275`
- Protocol versions negotiated: `2024-11-05`, `2025-03-26`, `2025-06-18` (falls back to the last) — `MCPServer.swift:99`, `:359-363`
- RPC methods: `initialize`, `ping`, `prompts/list`, `prompts/get`, `tools/list`, `tools/call`; notifications (no id) → HTTP 202 with empty body — `MCPServer.swift:344-461`
- `serverInfo` = name "AgenticDesigner", title "Agentic Designer", version "1.0.0" — `MCPServer.swift:87-88`, `:372-376`
- Port resolution: `AGENTIC_MCP_PORT` env (must be 1024…65535) beats UserDefaults `mcpServerPort`, which defaults to 8765 — `MCPServerController.swift:60-69`
- `AGENTIC_MCP_PORT` being set ALSO forces the server on at attach, regardless of `mcpServerEnabled` — `MCPServerController.swift:85-91`
- `endpointURL = "http://127.0.0.1:<port>/mcp"`; `claudeCodeCommand = "claude mcp add --transport http agenticdesigner <endpointURL>"` — `:72-76`
- Bind failure → up to 30 retries, 2s apart, while enabled — `:174-188`
- Prompt registered: `build_production_app` with args `app_name`, `bundle_id`, `platforms`, `backend`, `brand`, `sensors`, `screens` (all optional) — `MCPServerController.swift:307-316`

### Tool registry (`Services/MCPServerController.makeTools()`, `:568`+)
Format: `name` — required/optional input keys — one-line description.

Orientation / read
1. `get_build_methodology` — {} — returns the four-layer product-truth discipline + 11-phase plan — `:571`
2. `get_project_overview` — {} — pages, screens, node/flow counts, active page — `:578`
3. `get_design_tree` — `pageIndex?`, `screenNodeId?` — JSON node tree for a page or one screen subtree — `:592`
4. `get_screenshot` — `pageIndex?`, `screenNodeId?` — rendered JPEG of the canvas or one screen — `:637`

Design
5. `compose_reference_app` — schema = `ComposedAppGenerator.responseSchema` (`appName`, `style`, `screens[5-7]{name,bottomBar,components[3-5]{type,props}}`) — deterministic 5-7 reference-grade screens — `:683`
6. `apply_design_actions` — required `actions[]`; optional `generateImages` (default true), `normalize` (default false) — apply the DesignAction JSON vocabulary — `:744`
7. `get_canvas_studio_capabilities` — {} — the Studio capability map for external agents — `:1265`
8. `apply_canvas_studio_edits` — required `operations[]`; optional `generateImages`, `normalize` — Canva/Photoshop-style canvas operations — `:1279`
9. `edit_selection` — required `nodeId`, `prompt` — targeted AI edit of one node (no images, no critic) — `:1633`
10. `set_brand` — required `accent`; optional `accentSecondary`, `name` — set + apply the brand colour project-wide — `:2075`
11. `apply_theme` — required `preset` — re-theme the whole project into a `VisualStylePreset` — `:2103`
12. `import_from_screenshot` — required `imagePath`; optional `notes` — turn a screenshot into editable component-rendered screens — `:2889`
13. `check_design_quality` — {} — deterministic AppShots reference-bar scoring — `:3010`

Agent delegation
14. `run_agent_loop` — required `goal`; optional `model`, `strictProvider`, `strictModel`, `answers` — delegate a goal to the in-app agent loop — `:881`
15. `run_design_agent` — required `prompt`; optional `waitForCompletion` — run the strategy→generate→critic pipeline — `:2165`
16. `analyze_brief` — required `prompt` — which product decisions the brief leaves open — `:1391`
17. `build_full_app` — required `prompt`; optional `model`, `mode`, `backend` — one prompt → working app with accounts — `:1429`
18. `wire_interactions` — optional `prompt`, `autoOnly` — auto-wire tab bars/back buttons + semantic interactions — `:1582`
19. `wire_backend` — optional `prompt`, `category` — deterministic accounts + persistence wiring — `:2013`

Games / sprites
20. `list_game_templates` — {} — built-in 2D game blueprints — `:949`
21. `generate_sprite` — required `prompt`; optional `frames`, `size`, `removeBackground`, `matchProjectArt`, `facing` — AI sprite with background removed — `:968`
22. `flip_sprite` — required `path` — mirror a sprite left↔right into a new PNG — `:1023`
23. `create_game_scene` — optional `template`, `spec`, `name`, `x`, `y`, `width`, `height`, `spritePrompts`, `generateSprites`, `pageIndex` — add a playable SpriteKit scene node — `:1048`
24. `get_game_scene` — optional `nodeId` — return a node's `GameSceneSpec` JSON — `:1198`
25. `update_game_scene` — required `spec`; optional `nodeId` — full-replace a game node's spec — `:1226`

Templates
26. `list_templates` — {} — built-in starter app templates — `:1505`
27. `create_from_template` — required `templateId` — instantiate a starter template — `:1517`
28. `list_logic_templates` — {} — ready-made logic features — `:1541`
29. `add_logic_template` — required `name` — insert a ready-made flow — `:1551`

Backends
30. `set_supabase_config` — optional `projectURL`, `anonKey`, `enabled` — point the project at Supabase — `:1669`
31. `set_firebase_config` — optional `projectId`, `apiKey`, `appId`, `messagingSenderId`, `storageBucket`, `authDomain`, `providers[]`, `publicReadCollections[]`, `enabled` — point the project at Firebase — `:1697`
32. `provision_firebase` — optional `projectId`, `displayName` — create a real Firebase backend via the CLI — `:1794`
33. `deploy_firestore_rules` — required `path` — `firebase deploy --only firestore:rules` in the export dir — `:1856`

Export / build / ship
34. `export_web` — {} — self-contained deployable HTML for the current page — `:1613`
35. `export_ios_source` — required `path` — full SwiftUI/SwiftPM source export — `:2738`
36. `export_xcode_project` — required `path` — real signable `.xcodeproj` (+ embedded watchOS target) — `:2814`
37. `set_product_identity` — required `name`; optional `bundleIdentifier`, `developmentTeam` — product name/bundle/team — `:2783`
38. `set_platforms` — required `platforms[]`; optional `orientation` (portrait|landscape|all) — target platforms — `:2698`
39. `run_in_simulator` — optional `pageIndex` — export + swiftc-compile + launch on a simulator — `:3067`
40. `run_xcode_project_in_simulator` — required `path` — xcodebuild the exported project and launch it — `:1895`
41. `archive_ipa` — required `path`; optional `method` — `xcodebuild archive` + `-exportArchive` — `:1946`
42. `simulator_screenshot` — {} — screenshot the real booted simulator — `:3133`
43. `simulator_tap` — required `x`, `y` (normalized 0…1) — synthetic tap on the real simulator — `:3151`
44. `simulator_type` — required `text` — type into the real simulator's focused field — `:3184`
45. `simulator_set_appearance` — required `mode` — `simctl ui … appearance dark|light` — `:1993`
46. `check_export_readiness` — {} — the truth check (canvas promises vs binary) — `:3044`
47. `assert_ready` — {} — certification gate; ERRORS if any blocker remains — `:3023`
48. `typecheck_generated` — {} — real iOS-simulator swiftc `-typecheck` over the generated tree — `:3416`
49. `get_generated_code` — optional `file` — Code Mode over MCP — `:3310`
50. `set_source_override` — required `file`, `content` — store a hand-edit that wins over generation — `:3347`
51. `clear_source_override` — optional `file` — revert one or all overrides — `:3389`

Project / checkpoints / components / git
52. `select_page` — required `pageIndex` — switch the active page — `:2246`
53. `save_project` — optional `path` — save the `.agenticdesign` JSON — `:2269`
54. `load_project` — required `path` — load a `.agenticdesign`/JSON project — `:2297`
55. `list_checkpoints` — {} — saved checkpoints, newest first — `:2126`
56. `restore_checkpoint` — optional `index` (0 = newest) — restore, itself checkpointed — `:2142`
57. `save_component` — required `nodeId`, `name`; optional `category` — save to the reusable component library — `:2939`
58. `list_components` — {} — saved components — `:2967`
59. `insert_component` — required `componentId`; optional `x`, `y` — instantiate with fresh ids — `:2983`
60. `enable_git_sync` — optional `enabled` — turn per-project git sync on/off — `:3240`
61. `git_status` — {} — repo path, branch, commit count, dirty count, remote, last 5 commits — `:3264`
62. `git_commit` — optional `message` — commit current state now — `:3274`
63. `push_to_github` — optional `repo_name`, `private` — push or create via `gh` and push — `:3288`
64. `set_provider_key` — required `provider`, `key` — store a provider key inside the app — `:2857`
65. `get_logic_flows` — optional `pageIndex` — JSON of the logic flows — `:3209`
66. `apply_logic_actions` — required `actions[]`; optional `pageIndex` — apply logic-block actions — `:2637`

Interactive preview
67. `preview_app` — optional `screenNodeId` — open the interactive preview — `:2328`
68. `preview_tap` — required `nodeId`; optional `itemIndex` — tap an element in the preview — `:2383`
69. `preview_type` — required `nodeId`, `text` — type into a preview text field — `:2461`
70. `preview_choose_branch` — optional `outcome`, `portIndex` — answer a paused branch question — `:2505`
71. `preview_game_gesture` — required `fromX`, `fromY`, `toX`, `toY` — drag inside the running SpriteKit scene — `:2569`
72. `preview_screenshot` — {} — screenshot the running preview screen — `:2600`

PDF (27 tools)
73. `pdf_open` — required `path` — `:3451`
74. `pdf_new` — optional `width`, `height` (US Letter default) — `:3471`
75. `get_pdf_info` — {} — page count/sizes/rotation/metadata/path/dirty — `:3490`
76. `get_pdf_page_text` — required `pageIndex` — `:3500`
77. `get_pdf_page_image` — required `pageIndex`; optional `maxDimension` — `:3517`
78. `list_pdf_annotations` — required `pageIndex` — `:3550`
79. `pdf_add_page` — optional `afterPageIndex` — `:3580`
80. `pdf_remove_page` — required `pageIndex` — `:3595`
81. `pdf_duplicate_page` — required `pageIndex` — `:3613`
82. `pdf_reorder_page` — required `pageIndex`, `destinationIndex` — `:3630`
83. `pdf_rotate_page` — required `pageIndex`, `degrees` — `:3651`
84. `pdf_crop_page` — required `pageIndex`, `x`, `y`, `width`, `height` (PDF points, bottom-left origin) — `:3672`
85. `pdf_find_text` — required `text`; optional `pageIndex` — `:3696`
86. `pdf_edit_text` — required `newText`; optional `find`, `paragraph`, `occurrence`, `pageIndex`, `x`, `y`, `width`, `height`, `fontSize`, `backgroundColorHex`, `fitToBounds` — `:3727`
87. `pdf_translate_text` — required `find`; optional `pageIndex`, `occurrence`, `paragraph`, `targetLanguage`, `model`, `apply` — `:3800`
88. `pdf_translate_page` — required `pageIndex`; optional `targetLanguage`, `model`, `minWords`, `concurrency`, `includeHeadings` — `:3870`
89. `pdf_rewrite_page` — required `pageIndex`; optional `targetLanguage`, `model`, `concurrency` — v2 full-coverage engine — `:3936`
90. `pdf_revert_page_edits` — required `pageIndex` — `:3977`
91. `pdf_replace_image` — required `pageIndex`, `x`, `y`, `width`, `height`, `imagePath` — `:3995`
92. `pdf_add_annotation` — required `pageIndex`, `kind`, `x`, `y`, `width`, `height`; optional `text`, `colorHex` — `:4024`
93. `pdf_add_drawing` — required `pageIndex`, `strokes[[[x,y]]]`; optional `isSignature`, `colorHex` — `:4079`
94. `pdf_add_signature_image` — required `pageIndex`, `x`, `y`, `width`, `height`, `imagePath` — `:4116`
95. `pdf_add_form_field` — required `pageIndex`, `kind`, `name`, `x`, `y`, `width`, `height` — `:4143`
96. `pdf_remove_annotation` — required `pageIndex`, `annotationIndex` — `:4171`
97. `get_pdf_metadata` — {} — `:4198`
98. `set_pdf_metadata` — optional `title`, `author`, `subject`, `keywords` — `:4212`
99. `pdf_save` — required `path` — `:4234`
100. `pdf_export_flattened` — required `path` — `:4252`

---

## 6. `DesignAction` — cases and fields

`DesignActionType` (24 cases, `Agent/DesignAction.swift:60-85`), in order:
`createFrame, createText, createButton, createInput, createRectangle, createImage, createIcon, createPage, updateText, updateStyle, moveNode, resizeNode, scaleNode, setAutoLayout, pinNode, bringToFront, sendToBack, setZIndex, alignChildren, distributeChildren, positionRelativeTo, deleteNode, createOnboardingScreen, createComponent, createPresentationShot`
Custom decoder accepts normalized aliases (lowercased, `_`/`-` stripped) — e.g. `frame`, `text`, `button`, `inputField`, `shape`, `page/addPage/newPage`, `scale/enlarge/shrink`, `autolayout/layoutNode/setLayout`, `pin/setConstraints/constraints`, `front/moveFront`, `back/moveBack`, `zindex/setLayerOrder`, `alignItems/align`, `distributeItems/distribute/spaceEvenly/splitEvenly`, `positionRelative/placeRelative`, `removeNode/delete/remove`, `onboardingScreen`, `component`, `presentationShot/createShowcase/showcase` — `:96-146`

`DesignAction` fields (`:162-276`):
- Identity: `id`, `type`, `component: ComponentType?`, `rawComponentName`, `props: [String:String]?`
- Targeting: `nodeId`, `nodeReference` (var), `parentId`, `parentReference`
- General: `name`, `text`, `pageName`
- Geometry: `x`, `y`, `width`, `height`, `scale`, `axis`, `alignment`, `relativeToNodeId`, `relativeToReference`, `anchor`, `offsetX`, `offsetY`
- Style: `fill`, `stroke`, `strokeWidth`, `gradient`, `cornerRadius`, `opacity`, `fontSize`, `textColor`, `textAlign`, `letterSpacing`, `lineHeight`, `constraints`, `clipContent`, `zIndex`, `textBehavior`
- Scroll/recycler: `scrollAxis`, `scrollOffset`, `recycleItemSpacing`, `recycleItemCount`
- Repeat binding: `repeatSourceVariable`, `repeatItemAlias`, `repeatAxis`, `repeatMaxItems`, `repeatScrollable`, `repeatFilterVariable`, `repeatCategoryVariable`
- Time picker: `timePickerHourVariable`, `timePickerMinuteVariable`
- Effects: `shadow`, `overlayColor`, `overlayOpacity`, `blur`, `backgroundBlur`
- Spacing: `padding`, `paddingH`, `paddingV`, `paddingTop/Right/Bottom/Left`; `margin`, `marginH`, `marginV`, `marginTop/Right/Bottom/Left`
- Auto layout: `layout`, `spacing`, `layoutAlign`
- Media: `imageName`, `imageSource`, `imagePrompt` (var), `assetKind`, `aspectRatio`, `resolution`, `size`, `contentMode`, `iconName`
- Macro: `title`, `descriptionText` (JSON key `description`), `primaryCTA`, `secondaryCTA`, `stylePreset`, `fontWeight`, `fontFamily`
- Alias keys accepted by the decoder: `parent`/`parentRef`/`parentNodeReference`; `backgroundColor`/`fillColor`; `borderColor`; `borderWidth`; `color`/`foregroundColor`; `pin`; `scrollBehavior`; `assetPrompt`; `symbol`/`systemName`/`sfSymbol`/`icon`; `gap`; `size` as a fontSize fallback — `:547-652`, `:654-795`
- Lossy array decoding: one bad action is skipped, the array survives; empty-after-decode with non-empty input throws — `:34-47`, `:51-57`
- Shadow shorthand strings: `soft|sm`, `medium|md`, `large|lg|floating` — `:1112-1121`

---

## 7. `LogicBlockType` — every case, grouped, in source order

`Models/LogicModels.swift:130-344`. Categories (`LogicBlockCategory`, `:116-126`): `event="Events"`, `action="Actions"`, `condition="Conditions"`, `api="API"`, `firebase="Firebase"`, `storage="Data & Backends"`, `variable="Variables"`, `ui="UI Updates"`, `device="Device & Sensors"`. Palette colours per category: event `#10B981`, action `#3B82F6`, condition `#F59E0B`, api `#8B5CF6`, firebase `#F97316`, variable `#6B7280`, ui `#14B8A6`, storage `#0EA5E9`, device `#EC4899` — `Models/BlockDefinitions.swift:35-47`.

Events — `onTap, onDoubleTap, onLongPress, onSwipe, onScreenLoad, onScreenDisappear, onAppLaunch, onScreenOpened, onChange, onSubmit, onTimer, onWatchAction, customEvent`

Actions — `navigate, goBack, presentSheet, dismissSheet, showAlert, showToast, openURL, copyToClipboard, hapticFeedback, delay, log, startTimer, stopTimer, saveValue, loadValue, customAction, confirmDialog, shareContent, sendEmail, callNumber, sendSMS, launchMaps, requestPermission, biometricAuth, scheduleLocalNotification, setBadgeCount, playSound, stopSound, validateForm, clearField, executeCustomCode, setDarkModeOverride, downloadFile`

Conditions — `ifCondition, switchCase, compare, logicalAnd, logicalOr, logicalNot, isEmpty, contains, platformCondition`

API — `httpRequest, setRequestHeader, setRequestBody, parseJSONResponse, handleAPIError, buildURL`

Commerce & Push — `purchaseProduct, restorePurchases, registerForPush`

Firebase Auth — `firebaseLogin, firebaseRegister, firebaseLogout, firebaseGetCurrentUser, firebaseResetPassword, firebaseDeleteAccount, firebaseUpdateProfile, firebaseAuthStateChanged`

Firebase Firestore — `firestoreAddDocument, firestoreSetDocument, firestoreGetDocument, firestoreUpdateDocument, firestoreDeleteDocument, firestoreQuery, firestoreListenDocument, firestoreListenQuery, firestoreBatchWrite`

Device & Sensors — `startTracking, stopTracking, getLocation, readMotion, readHeartRate, readStepCount, readBatteryLevel, onShake, onLocationChanged`

Apple Watch — `onDigitalCrown, onWatchTap, onWatchLongPress, watchHaptic, startWatchWorkout, pauseWatchWorkout, endWatchWorkout`

Data & Backends — `supabaseSignUp, supabaseSignIn, supabaseSignOut, supabaseCurrentUser, supabaseInsert, supabaseQuery, supabaseUpdate, supabaseDelete, sqliteQuery, sqliteExecute, algoliaSearch, logAnalyticsEvent`

Variables & Data — `setVariable, toggleVariable, incrementVariable, decrementVariable, appendToArray, removeFromArray, getVariable, mathOperation, randomNumber, getCurrentTime, scheduleNotificationAt, ringAlarm, appendJsonItem, replaceInVariable`

Game events (declared inside the Variables block) — `onGameOver, onGameWin, onGameScore, onGameCollision, onGameTap, onGameDrag, onGameEntityDestroyed, onGameStart, onGameLifeLost, onGameSpawned, onGameImpact, onGameLaunched`

Game commands — `gameSpawn, gameRemove, gameImpulse, gameMove, gameSetGravity, gameAddScore, gameEnd, gamePause, gameSetVelocity, gameSetProperty, gameAnimate, gameAddBehavior, gameRemoveBehavior, gameSetHealth, gameShake, gameParticles, gameSetTimeScale, gameSetSpawnRate, gameSetLives, gameRestart, gameQuery, gameLaunch, gameSetPhysics, gameLoadSlingshot, gameDamage, gameMotor, gameTorque`

Data transforms — `stringOperation, arrayOperation, jsonBuild, jsonParse, formatDate, generateId`

UI Updates — `setText, setColor, setVisible, setEnabled, setImage, scrollTo, setLoading, animate, bindProperty, setNavigationSelection, presentBottomSheet, dismissBottomSheet, presentDatePicker, presentColorPicker`

Supporting enums: `ParameterType {string, number, boolean, url, nodeReference, variable, jsonPath, dropdown, firebasePath, httpMethod, keyValue, color, screenReference}` `:64-78`; `VariableType {string, number, boolean, json, array, optional}` `:90-92`; `VariableScope {flow, screen, global}` `:94-98`; `LogicIssueSeverity {error, warning}` `:109-112`.

---

## 8. Inspector fields per panel

### `InspectorPanel` (design mode) — `Views/InspectorPanel.swift`
- Header "Inspector"; "No selection" empty state; content forced to rebuild via `.id(node.id)` — `:16-43`
- Identity section: node name (title3 bold); `labelRow("Type")` = `"Game"` when `node.gameScene != nil` else `node.type.rawValue`; `labelRow("Device")` = preset name when `devicePresetId` resolves — `:52-60`
- "Game" section (only when `node.gameScene != nil`) → embeds `GameInspectorSection` — `:63-68`
- Position: `numRow("X")` → `node.x`, `numRow("Y")` → `node.y` — **single-target (`multi:false`)** — `:74-78`
- Size: `numRow("Width")` → `max(1, width)`, `numRow("Height")` → `max(1, height)` — single-target; plus for `.Text` a "Fit Box to Text"/`arrow.down.right.and.arrow.up.left` button → `fitTextNodeToContent(id:)` — `:82-98`
- "Align Children" (only when `!node.children.isEmpty`): 6 icon buttons `align.horizontal.left/center/right`, `align.vertical.top/center/bottom` → `alignChildren(of:to:)`; "Distribute H"/`distribute.horizontal` and "Distribute V"/`distribute.vertical` → `distributeChildren(of:axis:)`, **disabled when `children.count < 2`** — `:103-122`
- Style (broadcast to whole selection): `clrRow("Fill")` → `style.fill`; `numRow("Radius")` → `max(0, cornerRadius)`; `numRow("Opacity")` → `clamp(0…1)` — `:130-134`
- Text section, only for `.Text/.Button/.Input/.Icon`: `clrRow("Color")` → `style.textColor` (default `#FFFFFF`); for non-Icon also `txtRow("Content")` → `node.text` (followed by `hugTextBoxIfEnabled`) and `numRow("Font Size")` → `max(1, fontSize)` — `:137-151`
- Image section (`.Image`): `imagePickerView` = TextField "URL or file path" + "Choose…" NSOpenPanel(.image) + 80pt preview (AsyncImage for `http`, `NSImage(contentsOfFile:)` otherwise), writes `imageName` — `:154-161`, `:406-449`
- Icon section (`.Icon`): `txtRow("SF Symbol")` → `iconName` (default "star") — `:164-169`
- "Repeat (List)": `txtRow("Data Variable")` → `repeatBinding.sourceVariable` (empty clears the binding); when set → `txtRow("Item Alias")` (defaults "item"), segmented `Picker("Direction")` Vertical/Horizontal → `repeatBinding.axis`, checkbox `Toggle("Scrollable")` → `repeatBinding.isScrollable`, plus explanatory caption — `:176-213`
- Padding: 4 `miniField`s Top/Right/Bottom/Left → `style.paddingTop/Right/Bottom/Left` — `:217-228`
- Margin: same 4 fields → `style.marginTop/Right/Bottom/Left` — `:232-243`
- Control builders: `numRow` (TextField `.number`, width 80, `multi` default true), `clrRow` (TextField width 95 + `ColorPicker` width 32, `supportsOpacity:false`), `txtRow` (label + TextField), `miniField` (centred TextField + 10pt caption) — `:304-404`

### `CanvasStudioInspectorPanel` (studio mode) — `Views/CanvasStudioPanel.swift:442-974`
- Identity: TextField "Layer name" → `node.name`; icon row Duplicate/`plus.square.on.square`, Front/`square.3.layers.3d.top.filled`, Back/`square.3.layers.3d.down.right`, Delete/`trash` (red) — `:511-525`
- Transform: X/Y then W/H number fields — **single-target** (`updateNumber(multi:false)`) — `:528-537`
- Align: 6 alignment icon buttons (**each disabled when `selectedNodeIds.count < 2`**) → `alignSelection`; Distribute H/V (**disabled when `selectedNodeIds.count < 3`**) → `distributeSelection` — `:540-558`, `:862-867`
- Style: `colorRow("Fill")`, `colorRow("Stroke")` (default `#000000`), number pair Stroke width / Radius (**multi:true**), `sliderRow("Opacity", 0…1)` → `style.opacity` — `:561-571`
- Typography (for `.Text/.Button/.Input`): `textRow("Text")` → `node.text`; `colorRow("Color")` → `style.textColor`; number pair Size / Line (line default `fontSize*1.2`, multi:true); `Picker("Weight")` menu Regular/Medium/Semibold/Bold/Black → `style.fontWeight`; `Picker("Align")` segmented Left/Center/Right → `style.textAlign` — `:573-604`
- Image: `textRow("Source")` → writes BOTH `imageSource` and `imageName`; `Picker("Crop")` segmented Fill/Fit → `contentMode`; "Replace Image"/`photo.on.rectangle` → NSOpenPanel then `setSelectedImageSource` — `:606-631`
- Icon: `textRow("SF Symbol")` → `iconName`; `colorRow("Color")` → `style.textColor` — `:633-639`
- Repeat (List): identical to InspectorPanel's — `:645-683`
- Print Export: W cm / H cm double inputs, DPI input, live `"WxH px"` readout; "PDF"/`doc.richtext` borderedProminent → `exportPDF()`, "JPEG"/`photo` bordered → `exportJPEG()` — `:685-717`
  - Pixel size = `cm/2.54*dpi`, min 1; rejects non-positive sizes and any dimension > 14 000 px; NSSavePanel default names `<page>-<W>x<H>cm-<DPI>dpi.jpg` / `<page>-<W>x<H>cm.pdf` — `:758-835`
- Effects: number pair Blur → `style.blur` and Shadow → `style.shadow.radius` (creates a default `ShadowStyle(#000000, 0.18, r, 0, 12)` if absent); `sliderRow("Overlay", 0…1)` → `style.overlayOpacity` (sets `overlayColor` to `#000000` when nil) — `:719-737`

### `GameInspectorSection` — `Views/GameInspectorSection.swift`
- Scene sliders: "Fall speed (gravity)" (`-spec.gravity`, 2…45) — `:31-36`
- Dynamic behaviour knobs derived from the entity behaviours: "Flap strength — X" (3…22), "Jump strength — X" (5…28), "Spawn every (s)" (0.6…6), "Obstacle speed" (40…420), "Gap size" (90…400), "Launch power — X" (300…2600), "Speed — X" (−400…400) — `:538-608`
- Rules: `Stepper("Lives")` 0…9 (0 → nil); `Stepper("Time limit")` ±15s up to 600 ("off" at 0); when a time limit exists `Picker("When time runs out")` → `timeUpAction` win/gameOver; TextField "Win at score" → `winScore`; slider "Difficulty ramp" 0.7…1.0 (≥0.995 → nil) — `:47-92`
- Presentation: checkbox "Wait for first tap" → `startPaused`; checkbox "Show score" → `showScore`; `Picker("Atmosphere")` None/Snow/Rain/Bubbles/Stars/Leaves → `ambient`; TextField "Start overlay text" → `tapToStartText` — `:97-116`
- Entities & Rules: add-entity Menu (Ball dynamic+circle `#E23D3D`; Box obstacle kinematic `#5FB84B`; Wall/ground static `#8B7355`; Invisible spawner body none, size 1, `#00000000`); per entity a DisclosureGroup with colour dot, name, "template" badge, trash — `:133-179`, `:390-401`
- Entity editor: `Picker("Body")` None/Dynamic/Static/Kinematic; checkboxes "Round body"/`circleBody`, "Gravity"/`affectedByGravity`, "Spawned only"/`isTemplate`; slider "Bounciness" 0…1 (dynamic only) → `restitution`; text rows "Category", "Touches (contacts)" (CSV), "Bounces off" (CSV) — `:182-218`
- Behaviour menu (18 entries, label → type): "When touching … → rule"/`onCollision`, "Tap = flap up"/`impulseOnTap`, "Tap = jump (grounded)"/`jumpOnTap`, "Tap = shoot projectile"/`shootOnTap`, "Steer left/right"/`controlHorizontal`, "Drag & launch (slingshot)"/`slingshot`, "Spawn entities over time"/`spawner`, "Move constantly"/`moveConstant`, "Patrol back & forth"/`patrol`, "Chase another entity"/`followEntity`, "Tilt with movement"/`rotateWithVelocity`, "Spin"/`spin`, "Bob up & down"/`bob`, "Pulse size"/`pulse`, "Particle trail"/`trail`, "Breakable (uses health)"/`destructible`, "Remove when off-screen"/`destroyOffscreen`, "Wrap top↔bottom"/`wrapVertical` — `:365-384`
- Per-behaviour editors — `onCollision`: category picker "When touching", "Then" picker (Game over/Score points/Win/Lose a life/Remove the other/Explode the other/Damage the other/Remove self/Bounce/Run a logic flow), "Points" int for score/removeOther/explode/damage, "Flow name" text for runFlow, "Shake" checkbox, FX particles picker (None/Debris/Spark/Smoke/Fire/Confetti/Hearts). `spawner`: "Spawns" entity picker, "Every s"/"Speed ←"/"Gap" numbers, "Score when passed" checkbox. `impulseOnTap`/`jumpOnTap`: "Strength". `spin`/`bob`/`pulse`: "Amount" + "Period". `moveConstant`/`patrol`: "Speed x"/"Speed y" (+"Leg s" for patrol). `followEntity`: "Follows" picker + "Speed". `shootOnTap`: "Projectile" picker + "Speed" + "Cooldown". `trail`/`destructible`: FX picker. `slingshot`: "Power" + "Drag". `destroyOffscreen`: "Margin". Others render no parameters — `:243-357`
- New-behaviour defaults: impulseOnTap 9; jumpOnTap 13; shootOnTap strength 500 / interval 0.4; onCollision action gameOver; spawner interval 2 / velocityX −150; moveConstant −120; patrol vx 60 / interval 2; followEntity 80; spin 90; bob 12/1.6; pulse 0.12/1; trail particles "spark"; destructible particles "debris"; slingshot maxPower 900 / maxDrag 140; destroyOffscreen margin 120; controlHorizontal 240 — `:403-427`

### `BlockInspectorPanel` (logic mode) — `Views/Logic/BlockInspectorPanel.swift`
- Empty state `cube.transparent` "Select a block to configure it" — `:47-58`
- Block info: category-coloured 28×28 icon tile, editable `TextField("Label")` → `updateLabel`, category capsule, definition description — `:62-98`
- Parameters, editor per `ParameterType` — `:120-176`:
  - `.nodeReference` → Picker over `designNodesFlat` ("None" + "name · type") → `linkParameterToNode`
  - `.screenReference` → Picker over `designScreens` → `linkParameterToNode`
  - `.variable` → Picker over `allVariables` ("name (type)") → `linkParameterToVariable`
  - `.dropdown`, `.httpMethod` → Picker over `param.options`
  - `.boolean` → mini `.switch` Toggle showing On/Off → value "true"/"false"
  - `.keyValue` → TextField with "Comma-separated key: value pairs" hint
  - default (string/number/url/jsonPath/firebasePath/color) → TextField, monospaced for `jsonPath`/`firebasePath`
  - Required parameters get a red `*`
- Comment: multiline TextField (2…4 lines) "Optional note..." → `updateComment` — `:226-240`
- Quick actions: "Duplicate"/`plus.square.on.square`, "Delete"/`trash` (destructive) — `:244-260`
- Platforms: one checkbox per `AppPlatform.allCases` → `setPlatform`; `Picker("Preview")` over enabled platforms → `setDefaultPreviewPlatform` — `:264-291`
- Variables: list rows (`number.square`, name, type, scope capsule, `xmark.circle.fill` delete); "New variable name" TextField + `plus.circle.fill`; Type Picker (`VariableType.allCases`) + Scope Picker (`VariableScope.allCases`); "Default value" TextField — `:293-372`

### `PDFInspectorPanel` — `Views/PDF/PDFInspectorPanel.swift`
- Tool grid: adaptive 68pt buttons, one per `PDFToolMode.allCases` (64×44, accent 18% background when active) — `:42-56`, `:139-156`
- Per-tool hint text (shown when not `.select`) — `:192-202`: editText "Click a paragraph to rewrite it, or drag a box over a region."; translate "Click a paragraph to translate it with your local model."; replaceImage "Drag a box over an image, then choose a replacement."; draw/signature "Drag to draw freehand."; comment "Click to drop a comment."; crop "Drag a box to crop the page to."; default "Drag to place on the page."
- Style controls, shown for shapeRect/shapeCircle/shapeLine/draw/highlight/underline/strikeOut/freeText/editText — `:158-190`: `ColorPicker("Color")` → `annotationStyle.color`; for freeText/editText also `ColorPicker("Text Color")` → `annotationStyle.textColor` and `Stepper("Font Size", 6...96)`; otherwise `Stepper("Stroke", 1...20)` → `strokeWidth`
- Translate controls (only when `toolMode == .translate`) — `:70-137`: "LOCAL MODEL" header with spinner while translating and `arrow.clockwise` refresh; error/`No models found — is Ollama running?` when the list is empty; `Picker("Model")` over `translator.availableModels`; `Picker("Translate to")` over `LocalModelTranslator.commonLanguages`; Helsinki-specific notes; `TextField("http://127.0.0.1:11434")` → `translator.endpoint` (hidden for the Helsinki model)
- Selected annotation section — `:206-251`: type name ("Image" for stamps, "Text Field"/"Checkbox" for widgets, else `annotation.type`); "Contents" TextField for text widgets/FreeText; X/Y and W/H number fields (min 4) → `moveAnnotation`; "Delete"/`trash` destructive
- Metadata: Title / Author / Subject / Keywords TextFields ↔ `viewModel.metadata` — `:273-290`
- Document info rows: Page Size (`W × H pt`), Rotation (`°`), Annotations count, Pages count, File name — `:294-308`

---

## 9. Canvas interactions (design/studio) — `Views/CanvasView.swift`

- Canvas size 4000×4000, zoom clamped `0.25…3.0`, `.scaleEffect(zoomScale, anchor: .topLeading)`, `ScrollView([.horizontal,.vertical])` with visible indicators — `:53-56`, `:69`, `:154-161`
- Coordinate space named `"canvas"` (`CanvasCoordinateSpace.name`) — `:9-11`, `:155`
- Nodes drawn in z-order: sorted by `zIndex ?? 0` then original index; each `CanvasNodeView` has `.allowsHitTesting(false)` (all input goes through the background drag gesture) — `:58-93`
- Background `Color.gray.opacity(0.08)` carries a `DragGesture(minimumDistance: 0, coordinateSpace: .named("canvas"))` — `:71-82`
- **Hit testing**: `hitTestNodeId(at:mode:)`; mode `.deepest` when `⌘` or `⌥` held, else `.smart` — `CanvasView.swift:248-253`. `.smart` = if the currently selected node is in the chain, return the next one deeper (staying put at the leaf); otherwise `chain[1]` (first element inside the screen) or `chain[0]` — `ProjectViewModel.swift:875-894`. Chain rules: topmost sibling wins by draw order; a small leaf (`area < winner.area * 0.5`, no children) beats a much larger sibling; an already-selected node under the cursor always wins — `ProjectViewModel.swift:744-786`
- **Text hit area**: `.Text` nodes use measured glyph bounds (font/kern/lineHeight/textAlign aware) inset by `-4/-3`, intersected with the full box — everything else uses its full frame — `ProjectViewModel.swift:793-873`
- **Marquee**: starts when the drag hits nothing, or hits a "pass-through" node (screen root, or `zIndex < 0`, or a name containing "background") that isn't selected. Drawn as accent 10% fill + dashed stroke (1.25pt, dash [5,4]), zIndex 950 — `CanvasView.swift:255-267`, `:101-115`, `ProjectViewModel.swift:465-468`, `:1021-1024`
  - On release: if the band moved >4pt in either axis → `selectNodes(in:extending: shiftHeld)`; if it never moved and no shift → select the pass-through node it started on, else `clearSelection()` — `CanvasView.swift:281-300`
  - Marquee only picks direct children of screen roots plus loose page-level elements; pass-through nodes are excluded — `ProjectViewModel.swift:985-1015`
- **Shift-click**: shift + mousedown on a node registers a pending toggle; it becomes a real drag once the pointer travels >4pt, otherwise it toggles selection on release — `CanvasView.swift:241-245`, `:269-272`, `:302-306`
- **Drag**: `beginDrag(on:alreadyTranslatedBy:)` compensates for pre-recognition travel; dragging a member of a multi-selection moves the whole group by one delta and makes the grabbed node primary — `:341-368`, `:411-436`
  - `snapshot()` is taken once, on the first actual movement (>0.1pt) — `:404-407`
  - Shift while dragging = axis lock (dominant axis wins) + parent-centre snap (threshold 8pt), which draws a centre guide; the axis lock beats sibling snapping on root nodes — `:390-398`, `:441-475`, `:492-528`
  - Child nodes are clamped inside their parent (`clampedPositionForMove`); root nodes run through `SnapEngine` — `:457-486`
- **SnapEngine**: threshold 6pt, anchors are left/centerX/right and top/centerY/bottom of the dragged node against every other root node; emits `SnapGuides(verticalX:horizontalY:)` — `Helpers/SnapEngine.swift:15-103`
- **Guides**: `GuidesOverlay` draws a 1pt blue vertical/horizontal line spanning the canvas at the guide coordinate, `allowsHitTesting(false)`, zIndex 900 — `Views/GuidesOverlay.swift`, `CanvasView.swift:96-99`
- **Selection chrome**: non-primary selected nodes get a 1.5pt accent stroke rectangle at zIndex 999; the primary/group box is `SelectionOverlay` at zIndex 1000 — `:117-152`
- **Resize handles**: 8 handles (topLeft, top, topRight, right, bottomRight, bottom, bottomLeft, left); 8pt white square with a 1.5pt blue stroke inside a 24pt invisible hit area; blue 1.5pt selection frame; animations disabled during resize — `Views/SelectionOverlay.swift:68-148`
  - Single-node resize: min size 24pt, opposite edge stays pinned when the box would go under the minimum — `CanvasView.swift:553-684`
  - Group resize: `groupResizeStart()` captures every frame + the union; nodes scale about the group box; `⇧` = uniform (aspect-locked, dominant drag direction chooses the factor); snapshot once — `CanvasView.swift:534-551`, `ProjectViewModel.swift:1030-1113`
- **Zoom**: `MagnificationGesture` as a `simultaneousGesture`, `gestureStartZoom * value` clamped to 0.25…3.0 — `:199-212`; toolbar/keyboard zoom described in §2/§3
- **Pan**: native `ScrollView` scrolling (no custom pan gesture on the design canvas)
- **Layer reveal**: `viewModel.canvasFocusRequest` → a zero-size marker positioned with padding in already-zoomed coordinates, `.id("canvas-focus-target-<uuid>")`, `scrollProxy.scrollTo(anchor:.center)` after one run-loop tick, plus a pulsing accent ring (2.5pt, `padding(-4)`) that fades over 1.1s after a 0.2s delay — `:49-51`, `:169-198`, `:214-227`
- **Double-click text editing on the design canvas: NOT IMPLEMENTED.** The only `onTapGesture(count: 2)` in the app is the logic block palette (`Views/Logic/BlockPaletteView.swift:164`). Inline text editing is done through the Inspector's "Content"/"Text" field. Verified by grep across `Views/`.
- **Context menus on the design canvas: NONE.** Layer context menus live in `LayersPanel` (§ below); logic canvas menus in §10; PDF thumbnails in §2.
- **Layers panel interactions** — `Views/LayersPanel.swift`: page tabs (click selects, context menu "Delete Page" disabled at 1 page, `plus` adds a page) `:78-138`; recursive rows indented 16pt per depth with type icons (Frame `rectangle`, Text `textformat`, Rectangle `square`, Button `capsule`, Input `text.rectangle`, Image `photo.fill`, Icon `star.fill`) `:257-267`; click → `selectAndRevealNode`; drag row onto another row → `reparentNode` (validated by `canReparentNode`, blue drop highlight) `:221-234`, `:270-320`; row context menu → "Fit Box to Text" (Text only), "Fit All Text Inside" (has children), Section "Align N children" (Left/Center/Right / Top/Middle/Bottom), Section "Distribute" (Horizontally/Vertically, only when >1 child), else "No children to align" `:196-220`
- **Node rendering** (`Views/NodeView.swift`): gradient (linear with angle→UnitPoint math, or radial) beats flat fill `:46-65`; `archTopRadius` produces an `UnevenRoundedRectangle` arch outline shared by fill/stroke/clip `:15-25`; opacity, blur, shadow, colour overlay applied as modifiers `:249-267`; time-picker nodes render live hour/minute wheels in preview and a static "06 : 30" mock on canvas `:105-141`; game nodes render a poster in snapshots, an "edit mode" background when selected with entity children, else a live `AgentGameView` gated by `allowsHitTesting(isSelected || gameEventHandler != nil)` with a "select to play" badge `:142-192`; image nodes resolve http → `AsyncImage`, asset name, file path, else a semantic gradient placeholder `:288-364`; fonts map `rounded/serif/monospaced/system` families plus custom names `:390-424`
- **Container behaviour** (`Views/CanvasNodeView.swift`): children ordered by zIndex; `scrollBehavior` wraps children in a `ScrollView` sized to content with an initial offset; `clipContent == true` clips to the node's outline shape; game frames suppress entity children unless the frame or a descendant is selected — `:17-138`

---

## 10. Logic canvas interactions

- Canvas 4000×4000 in coordinate space `"logicCanvas"`, dotted background (24pt × zoom spacing, 2pt dots at 8% primary), `underPageBackgroundColor`, `.clipped()` — `Views/Logic/LogicCanvasView.swift:19-41`, `:59-60`, `:135-156`
- **Pan**: `DragGesture(minimumDistance: 8)` on the canvas background → `canvasOffset` — `:160-175`
- **Zoom**: `MagnificationGesture` clamped `0.4…2.0` → `canvasZoom` (simultaneous) — `:177-182`
- Tap on empty canvas clears both `selectedBlockId` and `selectedConnectionId` — `:31-34`
- **Screen reference overlay**: the design page's nodes rendered at 14% opacity, non-interactive — `:67-77`
- **Palette drag & drop**: palette items are `.onDrag(NSItemProvider(type.rawValue))`; the canvas `.onDrop(of: [.plainText])` converts the drop point with `(point - offset)/zoom - (100, 20)` and calls `addBlock(type:at:)` — `:35-37`, `:186-208`, `BlockPaletteView.swift:161-163`
- **Palette double-click** adds a block at a computed canvas centre `((420 - offset.w)/zoom, (280 - offset.h)/zoom)` — `BlockPaletteView.swift:164-166`, `:174-180`
- Palette: search field filters by label/description; categories collapsible (`event`, `firebase`, `api` expanded by default; search forces all open); Firebase items dim to 55% with an orange warning triangle when Firebase isn't configured — `:14-15`, `:61-122`, `:127-159`, `:170-172`
- **Block drag**: `DragGesture(minimumDistance: 2, coordinateSpace: .named("logicCanvas"))` — captures the origin, selects the block, calls `moveBlock` while dragging, `commitBlockMove()` on end — `LogicBlockView.swift:226-243`
- **Connection drawing**: drag from an output port circle (`minimumDistance: 3`) → `beginConnectionDrag(from:port:at:)` at `BlockGeometry.outputPortPosition`, `updateConnectionDrag(to:)` while moving, `endConnectionDrag(at:)` on release — `LogicBlockView.swift:245-257`
  - Snapping: the drop point picks the nearest input port within **28pt**, then `connectBlocks(from:port:to:targetPort: 0)` — `LogicViewModel.swift:366-391`
  - Temporary wire drawn in accent colour with `isAnimating: true`, non-interactive — `LogicCanvasView.swift:118-131`
- **Port rules** (`validateConnection`, `LogicViewModel.swift:297-323`): no self-connection; the target must exist and have `inputPortCount > 0` (so events cannot receive); an input port already occupied is rejected; cycles are rejected via a reachability walk from target back to source
- Ports rendered as 12pt circles filled when connected, stroked in the category colour, hit area scaled 2.2× — `LogicBlockView.swift:185-212`
- **Connections**: rendered as Bézier `ConnectionLineView` in the SOURCE block's category colour, highlighted when selected; a 22pt invisible circle at the wire midpoint takes taps (selects the connection) and carries a context menu "Disconnect" (destructive) — `LogicCanvasView.swift:81-116`
- **Block visuals**: header 34pt in the category colour with the definition icon + editable label + `text.bubble` when a comment exists + `exclamationmark.circle.fill` when the block has an error; parameter rows 26pt showing `◇ <node name>` / `{variable}` / value / "required" / "—"; output labels footer 22pt; corner radius 10; border 2.5pt when selected or executing else 1pt; border colour green (executing) > red (error) > category (selected) > 12% primary; green glow shadow while executing — `LogicBlockView.swift:34-121`, `:125-181`, `:84-89`
- **Collapse**: `block.isCollapsed` hides parameters and footer, height = header only — `LogicBlockView.swift:38-46`, `BlockGeometry.height`
- **Block context menu**: "Duplicate" → `duplicateBlock`, "Expand"/"Collapse" → `toggleCollapsed`, Divider, "Delete" (destructive) → `deleteBlock` — `LogicBlockView.swift:68-73`
- **Comments**: edited in the Block Inspector's "Comment" field; presence shown by the header bubble icon
- **Delete**: `⌫`/`⌦` in logic mode → `logicViewModel.deleteSelected()` (block first, else selected connection) — `LogicViewModel.swift:183-190`
- **Validation issues** (`validate()`, `LogicViewModel.swift:512-557`): for every required parameter with no value/nodeReference/variableReference → **error** `"<label>: '<param>' is required"`; a block with `inputPortCount == 0` (an event) and no outgoing connection → **warning** `"<label>: event is not connected to anything"`; any other block with no incoming connection → **warning** `"<label>: unreachable — no incoming connection"`. Re-run on add/delete/connect/disconnect/parameter change/flow switch/undo/redo.
- **Flow simulator panel** (`Views/Logic/FlowSimulatorPanel.swift`): fixed height 150; left = execution log (icon per entry, red when `isError`, monospaced 10pt, selectable, auto-scrolls); right = 220pt "Variables" list (`key = value`, blue monospaced keys, values truncated to 40 chars); a top overlay bar appears when `simulator.awaitingChoice` is set: `pause.circle.fill` + block label + one borderedProminent button per branch label (first tinted green, the rest red) → `simulator.choose(index)`
- **App preview sheet** (`Views/Logic/AppPreviewView.swift`): frame `470 × 760`; header Label "App Preview"/`iphone`, running spinner, "Reset" (only when `hasUIChanges`), platform Picker over enabled platforms, "Done"; the current screen renders at `scale = min(380/width, 600/height)` inside a 34pt-radius rounded rect with an 8pt black 75% border
  - On appear: wires simulator refs, sets `previewPlatform` from project settings, defaults `previewScreenId`, `primeVariables()`, `runEvent([.onAppLaunch])`, then `runEvent([.onScreenLoad, .onScreenOpened])` + `scheduleScreenTimers` for the current screen; the same screen events fire on `previewScreenId` change; `stopAllTimers()` on disappear — `:94-116`
  - Repeat-list templates are expanded live per `simulator.variables` via `RepeatBindingExpander.expandWithContext`, so every clone is individually tappable at its real position and carries its item's variables into the flow — `:210-215`, `:289-335`
  - Hit areas: transparent rectangles over `.Input` nodes and any node id referenced by an `onTap/onDoubleTap/onLongPress/onSwipe` event; tap → `simulator.runTap(on:itemContext:)`; `DragGesture(minimumDistance: 24)` → `simulator.runSwipe(on:direction:)` with direction left/right/up/down; inputs become a real `TextField` on tap, committing with `setInputValue` + `runEvent([.onSubmit])` — `:222-287`
  - Environment injections: `gameEventHandler` → `simulator.handleGameEvent`; `previewVariableBinding` → read/write `simulator.variables` (drives time pickers) — `:158-168`
  - Branch overlay at the bottom (block label + green/red buttons); toast overlay (black 85% capsule, 56pt from the bottom, non-interactive) — `:177-196`, `:339-354`
  - Screen switcher: capsule buttons for every screen filtered by `supportedPlatforms` — `:37-44`, `:358-376`
- **Logic sheets**: `FirebaseConfigView` — "Enable Firebase for this project" toggle, Project Credentials text fields, Authentication Methods toggles (Email/Password, Google Sign-In, Apple Sign-In, Anonymous Auth), Firestore Collections editor (per-collection name, per-field name/type/required, add/remove), Cancel/Save — `Views/Logic/FirebaseConfigView.swift:32-190`. `APIEndpointManagerView` — endpoint list with add/delete (context menu), fields Name, Base URL (`https://api.example.com`), Path (`/users/{userId}`), Method picker, Authentication picker, Body template, Headers key/value rows with add/remove, and a test section — `Views/Logic/APIEndpointManagerView.swift:27-230`

---

## 11. Exporters and generators — emitted files and directory conventions

### `LogicExporter` — `Services/LogicExporter.swift`
- `exportWithSavePanel(project:flows:currentPageId:)` `:64` — NSOpenPanel (directories only) → `exportSwiftUISource`
- `exportSwiftUISource(project:flows:currentPageId:to:) -> URL` `:84`. Root: `<dir>/<AppName>SwiftUIExport/` (deleted first if present). Layout:
  - `Package.swift`, `README.md`, `Info.plist`
  - `Sources/<AppName>/RootView.swift`, `Sources/<AppName>/<AppName>App.swift`
  - `Sources/<AppName>/Shared/`: `AppState.swift`, `GeneratedActions.swift`, `GeneratedSupport.swift`, `SensorServices.swift`, `StateStore.swift`, `AuthService.swift`, `Permissions.swift`, `StoreService.swift`, `PushService.swift`, and `AgentGameKit.swift` when the page has game scenes (`exportGameScenes`, `:1008-1014`)
  - `Sources/<AppName>/Screens/<ScreenName>View.swift` per screen
  - `Sources/<AppName>/Watch/WatchRootView.swift` + `WatchWorkoutService.swift` when Apple Watch is enabled
  - `Sources/<AppName>/Resources/` — copied image assets + game scene JSON/sprites
  - `firestore.rules`, `firebase.json`, `.firebaserc` when Firestore collections exist (`.firebaserc` only with a projectId)
  - `<AppName>UITests/<AppName>UITests.swift`
  - `Base.lproj/Localizable.strings` and `he.lproj/Localizable.strings`
  - Finally `applySourceOverrides(project:root:)` rewrites any generated `.swift` whose FILE NAME matches `project.sourceOverrides` — `:214-227`
- `exportXcodeProject(project:flows:currentPageId:to:) -> URL` `:281`. Root `<dir>/<AppName>Xcode/`:
  - `Shared/` — AppState.swift, GeneratedActions.swift, GeneratedSupport.swift, SensorServices.swift, StateStore.swift, AuthService.swift, Permissions.swift, StoreService.swift, PushService.swift (+ AgentGameKit.swift for games)
  - `iOS/` — App.swift, RootView.swift, `<ScreenName>View.swift` per screen, `Resources/`, `PrivacyInfo.xcprivacy`, `GoogleService-Info.plist` (when Firebase creds are complete), `Assets.xcassets/AppIcon.appiconset/{Contents.json, icon-1024.png}`
  - `Watch/` — WatchApp.swift, WatchRootView.swift, WatchWorkoutService.swift, PrivacyInfo.xcprivacy (Apple Watch enabled only)
  - Root — `Info.plist` (partial), `<AppName>.entitlements`, `firestore.rules`, `firebase.json`, `.firebaserc`, `Products.storekit` (StoreKit blocks), `README.md`
  - `<AppName>.xcodeproj/project.pbxproj` (objectVersion 77, Xcode 16 synchronized folder groups Shared/iOS/Watch) and `<AppName>.xcodeproj/xcshareddata/xcschemes/<AppName>.xcscheme`
- `exportAppName(project:)` `:487` — Swift identifier from the project name, fallback `ExportedApp`
- `blocksWithoutNativeCodegen` and `bindingKindsWithoutNativeSupport` are the source of truth `ExportReadiness` consults
- Generated runtime constants: `StateStore` writes `app-state.json` in Application Support `:4308`; `AuthService` uses UserDefaults `auth.mode` / `auth.guestId` `:3928-3929`; SQLite blocks use `Documents/app.sqlite3` `:4905`

### `WebExporter` — `Services/WebExporter.swift`
- `html(for:appName:flows:globalVariables:supabase:interactive:) -> String` `:22` — ONE self-contained HTML document (no files written). Emits inline `<style>` (device/screen/node/btn/img-ph/screen-nav/#toast rules, dark-mode media query), one `.screen > .device` block per root Frame (only the first visible when interactive), a screen-nav button bar, `<div id="toast">`, and `LogicWebCompiler`'s `dataBlock` + `runtimeScript`. Node markup: Text→`div`, Button→`button.btn`, Input→`input`, Image→`img` (or `.img-ph` placeholder), Icon→`div` with an emoji glyph, Rectangle/Frame→nested `div`. Every node carries `data-node-id`. Icon→emoji map covers ~30 SF Symbols `:264-278`. Saved by `WebPreviewView` as `<ProjectName with - >.html` via NSSavePanel `Views/WebPreviewView.swift:54-60`.

### `LogicWebCompiler` — `Services/LogicWebCompiler.swift`
- `compile(screens:flows:globals:supabase:) -> Compiled` `:17` — walks the block graph into a JSON program (`dataBlock`) interpreted by a fixed `runtimeScript`; indexes `taps` by node UUID (accumulating multiple flows per node) and `screenLoads` by screen UUID for `onScreenLoad/onScreenOpened/onAppLaunch`; unsupported native-only blocks become no-ops. Emits no files — consumed by `WebExporter`.

### `ComposedAppGenerator` — `Services/ComposedAppGenerator.swift`
- `responseSchema` `:116` — `{appName, style, screens[5..7]{name, bottomBar, components[3..5]{type, props}}}` (also the MCP `compose_reference_app` input schema)
- `systemPrompt()` `:157`; `generate(prompt:provider:viewModel:)`; `applyComposition(jsonObject:viewModel:) -> Result{screenCount, actionCount, style}`; `fillImages(appPrompt:viewModel:provider:) -> Int`. Emits DesignActions onto the canvas — no files. Screen size 390×844 `:200`.

### `ComposedLogicGenerator` — `Services/ComposedLogicGenerator.swift`
- `generate(prompt:provider:design:logic:) -> Result{flowCount, wiredElements, autoWired}` `:44` — deterministically auto-wires bottom tab bars and back buttons, then (if a provider exists) asks the model only for `Intents{interactions[{element, screen, action, target, message, variable, value}]}` with actions `navigate|back|toast|toggle|set`, and builds the blocks/parameters/connections itself. Calls `logic.attach(to:)` first so flows persist. No files.

### `BackendWiringGenerator` — `Services/BackendWiringGenerator.swift`
- `wire(prompt:design:logic:blueprint:) -> Result{configured, createdScreens, flowNames, collections, boundInputs, notes}` `:53` — enables Firebase, declares the Firestore schema from `BackendBlueprint`, creates Log In / Sign Up screens (with real `.Input` nodes) when the design lacks them, wires launch gate / log in / sign up + profile doc / log out / password reset, plus per-user create+load for the primary entity. Fixed variable names: `authEmail`, `authPassword`, `authPasswordConfirm`, `authDisplayName`, `currentUserId`, `profile` — `:31-36`. No files.

### `BackendBlueprint` — `Services/BackendBlueprint.swift`
- `infer(prompt:)` `:60` / `blueprint(for: AppCategory)` `:64` → `{category, primary Entity, secondary [Entity], profileFields, publicReadCollections}`; `collections` always puts `users` first `:45-56`. Per-category schemas (finance/banking → transactions/accounts/budgets; trading/crypto → holdings/watchlist/orders with public-read `markets`; fitness → …). `promptOptsOut(prompt)` used by `AppBuildOrchestrator` to skip backend wiring. Profile fields: displayName (optional), email, photoURL (optional), createdAt. No files.

### `UITestGenerator` — `Services/UITestGenerator.swift`
- `source(appName:screens:flows:) -> String` `:30` — emits one file `<AppName>UITests/<AppName>UITests.swift` containing `testLaunchesAndShowsFirstScreen()` (up to 4 assertions over named Text/Button/Input on the first screen) plus one `testNavigationN_<Button>To<Screen>()` per `NavigationCase` derived from `onTap → navigate` flows whose destination has an assertable anchor. Uses `LogicExporter.accessibilityIdentifier(for:)`. Emits an explanatory comment when no navigation flow exists.

### `GeneratedSourcePreview` — `Services/GeneratedSourcePreview.swift`
- `generate(project:flows:currentPageId:) -> [GeneratedSourceFile]` `:35` — runs the real exporter into `tmp/AgenticDesigner-CodeMode-<uuid>/`, reads back every file with extension `swift, plist, entitlements, storekit, rules, md, xcprivacy, json`, deletes the temp dir, sorts Swift-first then by path, flags files whose name matches a `sourceOverrides` key
- `defaultSelection(in:pageName:)` `:79` — page-name match → any `/Screens/` file → `RootView.swift` → first non-Package Swift file → first file
- `typecheck(project:flows:currentPageId:) -> TypecheckResult{success, diagnostics, checkedFileCount}` `:120` — exports into `tmp/AgenticDesigner-Typecheck-<uuid>/`, runs `xcrun -sdk iphonesimulator swiftc -typecheck -target <arch>-apple-ios17.0-simulator -parse-as-library <files>`, parses `file:line:col: error|warning: msg`
- `SwiftCodeHighlighter` — regex passes for numbers, type names, keywords, strings, comments; 150 000-char limit; `NSCache` keyed by path+isSwift+hash — `:227-299`

### `ExportReadiness` — `Services/ExportReadiness.swift`
- `audit(project:flows:) -> [ReadinessFinding]` `:40` — 10 checks: (1) flows the exporter will DROP (blocker; self-triggering game/app-launch/custom events are exempt); (2) blocks with no native codegen (blocker); (3) Firebase/Supabase used but unconfigured or with incomplete creds (blocker); (4) sensor blocks (info); (5) screens with hardcoded `$`/`km`/`bpm` data and no binding (warning); (6) Apple Watch → use `export_xcode_project` (info); (7) sign-up with no profile write (warning); (8) more than one launch-time permission prompt (warning); (9) `selectedIndex` bindings unsupported natively (warning); (10) project still named "Untitled" (warning)
- `summary(_:)` `:253` verdicts: "READY — …", "RUNS, WITH CAVEATS — …", "NOT A WORKING APP — N blocker(s). …", followed by `[SEVERITY] title` + detail per finding

### `DesignQualityAudit` — `Services/DesignQualityAudit.swift`
- `audit(page:) -> [DesignQualityFinding]` `:47`; `report(page:) -> DesignQualityReport` `:85`
- Score = `max(0, 100 - blockers*20 - warnings*6 - min(infos,10))` `:93`; `passesReferenceBar` = zero blockers, zero warnings, score ≥ 90 `:35-37`
- Constants: `minimumTapTarget = 44`; allowed spacing scale `{0,4,8,12,16,20,24,32,40,48,56,64}` `:42-44`
- Sub-audits: `auditScreen` (dominant screen inset consistency) `:97`, `auditOverflow` `:216`, `auditNavigationPromises` `:243`, `auditReferenceQuality` `:301`, `auditProductConsistency` `:533`, plus a page-root blocker for any non-Frame node sitting outside every screen `:73-80`
- `summary(_:limit:)` prints `Reference design score: N/100 — REFERENCE BAR PASS ✓ | REFERENCE BAR NOT MET` `:591-611`

### `ThemeApplier` — `Services/ThemeApplier.swift`
- `apply(_ preset: VisualStylePreset, to:) -> Int` `:24` — classifies existing colours by area/frequency/luminance/saturation into background / surface / accent / textPrimary / textSecondary, maps each to the preset's `ColorTokens`, rewrites fills, strokes (→ `borderSubtle`) and text colours, then `replaceProject`. Image nodes keep their fill. Accent candidates require saturation ≥ 0.25 and < 3% of total area. No files.

### `BrandKit` — `Services/BrandKit.swift`
- `apply(_:to:) -> Int` `:32` — finds "vivid" colours (saturation ≥ 0.35 AND brightness ≥ 0.45) used on Buttons or small elements (`w*h < 42 000`) or as text colour, recolours them to `brand.accent`, retints gradients that ride the accent (`[accent, accentSecondary ?? shade(accent, -0.18)]`), persists `project.brand`
- `reapplyIfSet(to:) -> Int` `:94`; `shade(_:by:)` `:145`. `BrandIdentity {accent, accentSecondary?, name?}`, `isSet` requires a `#` prefix and ≥7 chars `:17-24`

### `ComponentLibrary` — `Services/ComponentLibrary.swift`
- Directory: `Application Support/AgenticDesigner/Components/` `:36-39`; one file per component `<uuid>.json` `:84-86`
- `save(node:name:category:) -> SavedComponent` `:44` — strips `logicBindings`, zeroes x/y; `all()` `:68` (newest first); `delete(_:)` `:80`; `instantiate(_:at:) -> DesignNode` `:92` (fresh ids throughout)

### `CheckpointStore` — `Services/CheckpointStore.swift`
- Directory: `Application Support/AgenticDesigner/Checkpoints/<sanitized project name>/` `:25-34`
- File name: `<ISO8601 with ':' → '-'>__<label truncated to 60, '/'→'-'>.json` `:47-52`
- `save(_:label:) -> ProjectCheckpoint?` `:39` (also fires `GitSyncService.recordCheckpoint`), `list(projectName:)` `:67` (newest first by mtime), `load(_:)` `:84`, prune to `maxCheckpointsPerProject = 40` `:23`, `:91-103`

### `GitSyncService` — `Services/GitSyncService.swift`
- Repo: `Application Support/AgenticDesigner/GitRepos/<sanitized project name>/` `:39-53`
  - `project.agenticdesign` — pretty-printed + sorted keys JSON `:259-266`
  - `Exports/Xcode/`, `Exports/SwiftPM/` — mirrored exports `:143-168`
  - `.gitignore` (`.DS_Store`, `xcuserdata/`, `DerivedData/`, `build/`) and `README.md` on enable `:92-109`
- `enable(project:)` `:75` (`git init -b main`, local identity `AgenticDesigner <agenticdesigner@localhost>` only if none is configured, initial commit "Enable git sync"); `disable(projectName:)` `:117`; `recordCheckpoint(project:label:)` `:125` (background, commit message `checkpoint: <label>`); `syncExport(projectName:kind:from:) -> String?` `:143` (commit `export: <kind>`); `commitNow(project:message:)` `:173`; `status(projectName:)` `:188`; `remoteURL(projectName:)` `:211`; `push(project:repoName:isPrivate:)` `:220`
- Binaries: `/usr/bin/git` `:32`; `gh` probed at `/opt/homebrew/bin/gh`, `/usr/local/bin/gh`, `/usr/bin/gh` `:278-281`. `gh repo create <name> --private|--public --source <repo> --push` `:247-252`
- Enabled flag key: `gitSync.enabled.<sanitized name>` `:55-57`

### `ProjectDocumentService` — `Services/ProjectDocumentService.swift`
- Extension `agenticdesign` `:13`; JSON pretty-printed + sorted keys, ISO8601 dates, atomic write `:42-54`
- Default save location: `Application Support/AgenticDesigner/SavedProjects/<name>.agenticdesign` `:88-99`
- `save(project:to:)` `:15`, `save(project:path:)` `:20`, `load(from:)` (path or URL) `:30/:35`, `open()` NSOpenPanel `:56`. `ProjectDocumentError.cancelled` — `:118-127`

### `FirebaseProvisioner` — `Services/FirebaseProvisioner.swift`
- CLI probed at `/opt/homebrew/bin/firebase`, `/usr/local/bin/firebase`, `~/.local/bin/firebase` `:41-48`
- `loginProblem()` `:51` (`firebase login:list`); `provision(projectId:displayName:bundleId:) -> ProvisionResult` `:68` running `projects:create`, `apps:create IOS`, `apps:sdkconfig IOS` (parsed as a plist for API_KEY / GCM_SENDER_ID / STORAGE_BUCKET / GOOGLE_APP_ID), `firestore:databases:create (default) --location nam5` — all `--non-interactive`; `deployRules(exportDir:projectId:)` `:154` runs `deploy --only firestore:rules` in the export directory. PATH prefixed with `/opt/homebrew/bin:/usr/local/bin` `:189`.

### `SimulatorRunner` — `Services/SimulatorRunner.swift`
- `buildAndLaunch(exportRoot:appName:target:progress:)` `:45` — compiles into `<exportRoot>/SimulatorBuild/<AppName>.app` with `xcrun -sdk iphonesimulator swiftc -target <arch>-apple-ios17.0-simulator -parse-as-library`, writes an Info.plist (bundle id `com.agenticdesigner.generated.<AppName>`, MinimumOSVersion 17.0, UIDeviceFamily [1,2]), copies `Sources/<AppName>/Resources/*`, boots a device, `open -a Simulator`, `simctl bootstatus -b`, `simctl install`, `simctl launch --terminate-running-process` — `:45-70`, `:120-215`
- `buildAndLaunchWatch(projectRoot:appName:progress:)` `:76` — `xcodebuild -target <AppName>Watch -sdk watchsimulator -configuration Debug SYMROOT=<projectRoot>/WatchSimulatorBuild CODE_SIGNING_ALLOWED=NO build`, then boots an Apple Watch simulator and installs `Debug-watchsimulator/<AppName>Watch.app`
- `buildAndLaunchXcodeProject(projectRoot:appName:bundleId:progress:) -> XcodeProjectLaunchResult` `:363` — `xcodebuild -project … -scheme <AppName> -sdk iphonesimulator -destination "generic/platform=iOS Simulator" SYMROOT=<projectRoot>/SimulatorBuild CODE_SIGNING_ALLOWED=NO build`, installs `Debug-iphonesimulator/<AppName>.app`, launches, sleeps 4s and checks `simctl spawn <udid> launchctl list` for `aliveAfterLaunch`
- `archiveIPA(projectRoot:appName:teamId:method:progress:) -> ArchiveResult` `:430` — `xcodebuild archive -archivePath <projectRoot>/<AppName>.xcarchive` (+`DEVELOPMENT_TEAM` and `-allowProvisioningUpdates` when a team is set), writes `<projectRoot>/ExportOptions.plist`, then `-exportArchive -exportPath <projectRoot>/IPA`; on export failure returns the archive path with `ipaPath: nil`
- `setAppearance(_:)` `:490` — `simctl ui <booted udid> appearance <mode>`
- Device selection prefers a booted device, newest iOS runtime first, name prefix `iPhone`/`iPad` `:219-247`; watch devices match "Apple Watch" `:249-267`
- Failure logs written to `tmp/AgenticDesignerSimulatorRun/last-run-error.log` `:504-516`; developer dir via `xcode-select -p` with `/Applications/Xcode.app/Contents/Developer` fallback `:279-292`

### `SimulatorControl` — `Services/SimulatorControl.swift`
- `screenshotPNG()` `:54` — `simctl io <udid> screenshot <tmp>`
- `tap(normX:normY:)` `:118` — requires Accessibility (`AXIsProcessTrustedWithOptions` with prompt), maps normalized coords onto the aspect-fit device rect inside the Simulator window (title bar assumed 28pt), activates Simulator, posts `leftMouseDown`/`leftMouseUp` with 40 ms between
- `typeText(_:)` `:140` — per-character `keyboardSetUnicodeString` key down/up with 16 ms spacing
- `bootedUDID()` `:35`, `developerDir()` `:25`, `deviceScreenRect(deviceAspect:)` `:69` (largest on-screen window owned by "Simulator")

### `SpriteGenerator` — `Services/SpriteGenerator.swift`
- Output: `Application Support/AgenticDesigner/GeneratedAssets/sprite-<uuid>.png` `:203-219`, `:239-247`
- `generateSprite(prompt:frames:size:removeBackground:assetKind:styleReferencePaths:facing:provider:) -> SpriteGenerationResult{framePaths, cutout}` `:89` — frames clamped 1…12, default size `768x768`, assetKind `sprite`; per-frame prompt suffix for multi-frame runs; background removed by `cutoutSubject`
- `cutoutSubject(fromImageAt:)` `:138` — `VNGenerateForegroundInstanceMaskRequest` + `generateMaskedImage(croppedToInstancesExtent: true)` → transparent PNG
- `flipHorizontal(pathToImage:)` `:171` — mirrored copy as a NEW PNG
- `dominantPalette(fromImagePaths:maxColors:)` `:50` (24×24 downsample, 32-step quantization, alpha > 140); `styleDirective(fromImagePaths:)` `:81`; `facingDirective(_:)` `:192` (right/left/front/back/up); `librarySprites()` `:227` (PNGs newest first); `assetsDirectoryURL` `:224`

### `AppBuildOrchestrator` — `Services/AppBuildOrchestrator.swift`
- `buildApp(prompt:mode:modelOverride:backend:onStage:) -> BuildSummary` `:83`
- Stages (raw values): `checkpoint="Saving checkpoint"`, `designing="Designing screens"`, `imaging="Generating images"`, `wiring="Wiring logic"`, `backend="Connecting backend"`, `previewing="Opening preview"` `:28-35`
- Modes `composed` / `detailed`; a strong cloud model (non-`local/`, non-`:free`, not `openrouter/free`) is auto-routed from composed → detailed `:110-116`; preflight throws `needsCloudKey` when a cloud model has a key shorter than 20 chars `:99-103`
- Apple Watch detection from the prompt OR from a screen NAMED "…watch…"; strips fake platform tags (`stripPlatformTag`, `:67-77`); appends `ComponentFactory.watchRunnerScreen()` named "Watch Runner" if absent `:158-178`
- Backend default `.firebase` unless `BackendBlueprint.promptOptsOut(prompt)` `:199-205`
- Ends by setting `logic.showAppPreview = true` `:211`
- `restore(_ checkpoint:)` `:272` — checkpoints current, then `replaceProject`
- `BuildSummary {designActionCount, generatedImageCount, flowCount, enabledAppleWatch, screens, checkpoint, backend}` `:17-26`

### `CanvasSnapshotRenderer` — `Helpers/CanvasSnapshotRenderer.swift`
- `jpegDataURL(for:maxDimension:)` `:23` — 24pt padding, `#ECEFF3` backdrop, scale `min(2, max(0.4, maxDimension/max(w,h)))`, JPEG quality **0.45**, default `maxDimension = 900`; returns `data:image/jpeg;base64,…`; sets `isCanvasSnapshot` so games render as posters
- `jpegData(for:pixelWidth:pixelHeight:physicalWidthCM:physicalHeightCM:compression:)` `:65` — sets the bitmap's physical size (`cm/2.54*72`) so DPI is embedded; default compression 0.9
- `pdfData(for:physicalWidthCM:physicalHeightCM:dpi:)` `:98` — real CGPDF page at `cm/2.54*72` points with the raster drawn to fill; default dpi 150
- `renderedImage` `:137` — white background, nodes laid out at natural size then `scaleEffect` to the exact pixel target

### `TranslationMemory` — `Services/TranslationMemory.swift`
- Directory `Application Support/AgenticDesigner/Translation/`; files `cache-<lang>.json` and `glossary-<lang>.json` `:132-136`
- `normalizedLanguage(_:)` `:46`, `cached(_:)` `:55`, `store(source:translation:)` `:65`, `setTerm/removeTerm` `:87/:97`, `maskTerms(in:startingAt:)` `:106`, `save()` `:150`

---

## 12. AI providers and routing

### `ModelProviderCatalog` — `Agent/ModelProviderCatalog.swift`
`ModelProviderRoute {id, name, chatEndpoint, environmentVariable?, defaultsKey?, freeTierNote}`; `modelsEndpoint` = chat endpoint with `chat/completions` → `models`; `requiresKey` = has an env var; `resolvedKey()` = UserDefaults key first, then env, else `"local"` for keyless routes — `:21-62`

Routes (`:69-121`), in order:
| id | name | base URL | env var | @AppStorage key | free-tier note |
|---|---|---|---|---|---|
| `local` | Local (Ollama / LM Studio) | `http://127.0.0.1:11434/v1/chat/completions` | — | — | "Unlimited — runs on this Mac, no key, no ceiling." |
| `cerebras` | Cerebras | `https://api.cerebras.ai/v1/chat/completions` | `CEREBRAS_API_KEY` | `cerebrasAPIKey` | "~1M tokens/day. Fastest inference; text only." |
| `groq` | Groq | `https://api.groq.com/openai/v1/chat/completions` | `GROQ_API_KEY` | `groqAPIKey` | "Generous daily request + token limits." |
| `gemini` | Google AI Studio | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `GEMINI_API_KEY` | `geminiAPIKey` | "Daily request quota. Accepts images — usable as the vision critic." |
| `nim` | NVIDIA NIM | `https://integrate.api.nvidia.com/v1/chat/completions` | `NVIDIA_API_KEY` | `nvidiaAPIKey` | "Free credits across 100+ hosted models." |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `OPENROUTER_API_KEY` | `openRouterAPIKey` | "Aggregator: paid models plus :free variants. Credit balance also caps PROMPT size." |

- Prefix routing `route(for:)` `:123` — an id ending in `:free` is ALWAYS OpenRouter; otherwise the first `/`-segment must match a route id; anything else is OpenRouter
- `upstreamModelName(for:)` `:140` — strips the route prefix except for OpenRouter, which wants the full `vendor/model`
- `freeModels` `:148-161`: `cerebras/qwen-3-235b-a22b-instruct`, `cerebras/gpt-oss-120b`, `groq/llama-3.3-70b-versatile`, `gemini/gemini-flash-latest`, `gemini/gemini-pro-latest`, `nim/nvidia/llama-3.1-nemotron-ultra-253b-v1`
- `openRouterFreeFallbacks` `:165-169`: `google/gemma-4-31b-it:free`, `nvidia/nemotron-nano-12b-v2-vl:free`, `meta-llama/llama-3.3-70b-instruct:free`
- **Fallback chain** `fallbackChain(startingWith:)` `:175`: [chosen model] → (if the route is `gemini`) its sibling Gemini free models → every OTHER configured route's free models → (if not already OpenRouter and OpenRouter is configured) the three OpenRouter `:free` fallbacks → UserDefaults `localFallbackModel` when set and the start route isn't local
- `configuredRoutes` `:213`; `fetchModels(for:)` `:223` (`GET <modelsEndpoint>` with `Bearer <key>`, 30s timeout, surfaces the provider's own error body); cache key `discoveredModels.<routeId>` `:252-262`
- `signupURL(for:)` `:265`: cerebras `https://cloud.cerebras.ai/`, groq `https://console.groq.com/keys`, gemini `https://aistudio.google.com/apikey`, nim `https://build.nvidia.com/`, openrouter `https://openrouter.ai/settings/keys`

### `OpenRouterConfiguration` — `Agent/OpenRouterConfiguration.swift`
- Default chat model `google/gemini-2.5-pro` `:11`; image model `bytedance-seed/seedream-4.5` `:12`
- `availableModels` `:16-34` (id → label): `google/gemini-2.5-pro` "Gemini 2.5 Pro — best balance"; `anthropic/claude-sonnet-4.5`; `openai/gpt-5.6-sol-pro`; `moonshotai/kimi-k3`; `x-ai/grok-4.5`; `google/gemini-2.5-flash`; `openai/gpt-5-nano`; `local/qwen3-vl:32b`; `local/gemma4:26b-mlx`; `openrouter/free`; `nvidia/nemotron-3-ultra-550b-a55b:free`; `meta-llama/llama-3.3-70b-instruct:free`; `google/gemma-4-31b-it:free`; `google/gemma-4-26b-a4b-it:free`; `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`; `nvidia/nemotron-nano-12b-v2-vl:free`; `mistralai/mistral-small-3.1-24b-instruct:free` — **plus** `ModelProviderCatalog.freeModels` appended
- `apiKey(userProvidedKey:)` `:40` — trimmed user key, else `OPENROUTER_API_KEY` env, else nil

### `OpenRouterProvider` — `Agent/OpenRouterProvider.swift`
- `init(apiKey:model:temperature:)` (default temperature 0.35) `:46`
- Endpoint = `route.chatEndpoint`; key = `route.resolvedKey() ?? apiKey` (so an OpenRouter key is never sent to Cerebras) `:36-43`; image endpoint fixed at `https://openrouter.ai/api/v1/images` `:44`
- `generateActions(systemPrompt:userPrompt:)` `:52` / `generateActions(messages:)` `:62` — 1 generation + 1 self-repair round-trip; JSON candidate extraction, brace-balancing, common-mistake repair, scoring
- `generateConstrainedJSON(messages:schema:maxTokens:)` `:129` — local models only: Ollama native `POST http://127.0.0.1:11434/api/chat` with `format: <JSON Schema>`, `keep_alive: "10m"`, 1800s timeouts; images passed as bare base64; logs a loud warning when an MLX build ignores the schema
- `generateRawChat(messages:jsonMode:retryCount:maxTokens:)` `:201` — default `maxTokens 24576` (nil for local models); headers `Authorization: Bearer`, `Content-Type`, `X-OpenRouter-Title: AgenticDesigner`; 600s request / 900s resource timeouts; 401/403 (or 400 mentioning "api key") → `providerUnavailable`; 402 → halve `maxTokens` / `promptTooLarge`; 429/502/503 → up to 3 retries at `(n+1)*8`s
- `generateToolTurn(messages:toolSchemas:)` `:340` — function-calling turn; 402 → `promptTooLarge` / token reduction; 429 → `quotaExceeded` when `isQuotaExhausted(message)` else `rateLimited`; returns `AgentToolTurnResult{turn, usage{promptTokens, completionTokens, costUSD?}}`
- `generateImageAsset(prompt:assetKind:aspectRatio:resolution:size:)` `:529` — **local first**: `generateLocalImage` posts to `http://127.0.0.1:7860/sdapi/v1/txt2img` (A1111/Draw Things/MFLUX-compatible) with `{prompt, width, height, steps: 8}`, sizes clamped to 1536, 300s timeout `:825-854`. `ensureImageBridge()` spawns the bundled `mflux_bridge.py` with `/opt/homebrew/bin/python3` or `/usr/bin/python3` if port 7860 isn't open, then polls 12× at 500 ms `:796-823`. Cloud fallback = OpenRouter `/images` with `OpenRouterConfiguration.imageModel`
- Per-assetKind prompt enrichment JSON briefs for `icon|appicon|symbol`, `product|productcutout|cutout|object`, `sprite|gamesprite|character|gameasset`, `poster|cover|thumbnail|avatar`, and a default hero brief `:600-781`; framing block appended when aspectRatio/size is present `:600-620`
- Generated assets saved to `Application Support/AgenticDesigner/GeneratedAssets/<uuid>.<ext>` `:856-879`
- Statics: `resetLearnedTokenCeilings()` `:1099`, `learnedPromptTokenCeiling`, `isQuotaExhausted(_:)` `:1108`, `parsePromptTokenLimit(from:)` `:1121`, `affordableTokens(from:)` `:785`, `markingCacheBreakpoints(_:)` `:1142`

### `AIProvider` / `AIProviderError` — `Agent/AIProvider.swift`
- Protocol `AIProvider.generateActions(systemPrompt:userPrompt:) async throws -> [DesignAction]` `:10-15`
- Errors `:17-38`: `missingAPIKey`, `needsCloudKey(model:)`, `invalidResponse`, `httpError(statusCode:message:)`, `emptyContent`, `invalidJSON(String)`, `promptTooLarge(actual:limit:)`, `quotaExceeded(provider:detail:)`, `providerUnavailable(provider:detail:)`, `rateLimited(provider:detail:)` — each with an exact user-facing `errorDescription` `:40-63`

### `DesignAgentService` — `Services/DesignAgentService.swift`
- `Settings.current()` `:33` reads UserDefaults `openRouterAPIKey`, `openRouterModel` (default `OpenRouterConfiguration.model`), `openRouterGenerationModel` (default `google/gemma-4-31b-it:free`), `autoCriticEnabled` (default true); `resolvedAPIKey()` `:45` = explicit key → `OPENROUTER_API_KEY` env → `"local"` for `local/` models
- `runFullPipeline(prompt:quickEdit:onApplied:) -> RunSummary` `:82` — key preflight (cloud model + key < 20 chars → `needsCloudKey`), checkpoint "before: <prompt prefix 40>", `makeAgentContext`, temperature 0.75 for `createNewDesign` else 0.18, screenshot attached only when NOT creating a new design (and scoped to the single screen for `editSelection`), then pipeline → apply actions → (unless `quickEdit`) parallel image generation and patching → auto-critic when enabled and intent isn't `editSelection`
- `RunSummary {appliedActionCount, createdReferences, requestedImageCount, generatedImageCount, criticRan}` `:51-57`
- `generateAndPatchImages(...)` `:215` — task group, one retry without explicit size, failures keep the placeholder
- `addingRequiredGeneratedImageIfNeeded` `:296` (forces one hero image on new designs: 24/132/342×220, `#E5E7EB`, radius 28, clip, zIndex −1, assetKind "hero", 16:9, fill); `synthesizingPromptsForPlaceholderImages` `:338`; `ensuringImageReferences` `:385` (`generatedImage<i>`); `generatedAssetPrompt(for:)` `:400` (also accepts a `generate:` prefix in imageSource/imageName); `fittedAspectRatio` `:438` (21:9, 16:9, 3:2, 4:3, 1:1, 3:4, 2:3, 9:16); `fittedPixelSize` `:462` (max dimension 1536, rounded to multiples of 32, min 256)

### `ChatGPTSubscriptionService` — `Services/ChatGPTSubscriptionService.swift`
- Explicitly does NOT do a ChatGPT OAuth; it drives OpenAI's own Codex CLI — `:1-19`
- Codex probed at `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`, `/usr/bin/codex` `:42-50`
- `Status {notInstalled, signedOut, ready(account:)}` `:27-33`; @Published `status`, `isBusy`, `transcript` `:35-37`
- `refreshStatus()` `:58` (`codex login status`, 20s); `signIn()` `:75` (`codex login`, 300s); `ensureMCPServerRegistered(port:)` `:88` (`codex mcp list`, then `codex mcp add agenticdesigner --url http://127.0.0.1:<port>/mcp`); `run(goal:workingDirectory:)` `:107` (`codex exec --sandbox danger-full-access --skip-git-repo-check -C <dir> <goal>`, streamed line-by-line); `cancel()` `:159`
- PATH prefixed `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:` for every invocation `:123`, `:174`

### `LocalModelTranslator` — `Services/LocalModelTranslator.swift`
- @Published `endpoint` (default `http://127.0.0.1:11434`, key `localTranslatorEndpoint`), `selectedModel` (key `localTranslatorModel`), `targetLanguage` (default "Hebrew", key `localTranslatorLanguage`), `availableModels`, `activeTranslations`, `lastError` `:21-33`, `:50-57`
- `commonLanguages` = Hebrew, English, Arabic, French, German, Spanish, Russian, Chinese, Japanese `:39`
- `helsinkiModel = "Helsinki-NLP/opus-mt-en-he"` `:19` — English→Hebrew only; runs the bundled `helsinki_translation_server.py` on `http://127.0.0.1:17841` (`/health`, `/translate`), Python probed at UserDefaults `helsinkiTranslatorPython` → `/Users/ariel/.agenticdesigner/pdf-translate-venv/bin/python` → `/opt/homebrew/bin/python3` → `/usr/bin/python3`, 40×100 ms startup poll `:169-227`
- `refreshModels()` `:66` — Ollama `/api/tags` first, then OpenAI-style `/v1/models`; always adds the Helsinki model
- `translate(_:to:model:)` `:109` — `POST <endpoint>/v1/chat/completions`, `stream:false`, `max_tokens:1600`, `temperature:0.2`, 600s idle timeout; system prompt preserves math notation and `⟦n⟧` placeholder tokens verbatim; strips `<think>…</think>` reasoning `:231-234`
- `isRightToLeft(_:)` `:238` — any scalar in U+0590…U+08FF
- `LocalTranslatorError {noModel, badEndpoint, serverError, badResponse, unsupportedLanguage, helsinkiWorker}` `:245-262`
- Shared URLSession: 600s request / 1200s resource `:43-48`

### `FakeDesignAgent` — `Helpers/FakeDesignAgent.swift` (179 lines)
- Offline `AIProvider` stub returning canned `DesignAction`s (no network); used for development/tests

---

## 13. Agent loop — tools, skills, hooks, memo, steer, stop conditions

### Tool belt
- `toolAllowlist` (curated MCP slice the inside agent may use) — `AgentToolLoop.swift:1138-1147`: `get_project_overview, get_design_tree, get_screenshot, compose_reference_app, apply_design_actions, get_canvas_studio_capabilities, apply_canvas_studio_edits, wire_interactions, set_brand, apply_theme, apply_logic_actions, get_logic_flows, wire_backend, preview_app, preview_tap, preview_type, preview_choose_branch, preview_screenshot, check_design_quality, check_export_readiness, assert_ready, typecheck_generated, run_in_simulator, simulator_screenshot, simulator_tap, export_xcode_project, get_generated_code, select_page, generate_sprite, create_game_scene, get_game_scene, update_game_scene`. Deliberately excluded: all `pdf_*`, checkpoints, and the recursive entry points `run_design_agent` / `build_full_app` / `run_agent_loop`, and every template tool.
- Phases (`ToolPhase {design, logic, verify}`, `:1044-1048`), chosen from the currently-"doing" plan item's keywords, else the goal `:1053-1079`:
  - `.design` (game goals): `get_project_overview, get_design_tree, get_screenshot, generate_sprite, create_game_scene, get_game_scene, update_game_scene, apply_logic_actions` `:1085-1091`
  - `.design` (default): `get_project_overview, get_design_tree, get_screenshot, compose_reference_app, apply_design_actions, apply_canvas_studio_edits, set_brand, apply_theme, apply_logic_actions, check_design_quality` `:1092-1097`
  - `.logic`: `get_design_tree, apply_logic_actions, get_logic_flows, wire_interactions, wire_backend, preview_app, preview_tap, preview_type, preview_choose_branch, preview_screenshot, check_export_readiness` `:1100-1105`
  - `.verify`: quality/readiness/typecheck/simulator + the design and logic tools + preview tools; when the goal mentions export/xcode project/ship it drops `get_design_tree` and adds `export_xcode_project` `:1112-1124`
- The belt is chosen ONCE per run (phase ∪ verify) to preserve prompt caching `:374-378`
- `schema(for:)` truncates descriptions to 700 chars, except `fullDescriptionTools` (`compose_reference_app, apply_design_actions, apply_logic_actions, check_design_quality, create_game_scene, update_game_scene, export_xcode_project, run_in_simulator, typecheck_generated`) which get 3000 `:1161-1175`
- `stringFlattened` advertises array/object params as JSON STRINGS ("— PROVIDE AS ONE JSON STRING…"); `reparsingJSONStrings` parses them back on dispatch `:1181-1212`
- `essentialToolNames` used only when the prompt ceiling is so low that schemas alone don't fit `:1412-1415`

### Loop-local tools (`localToolSchemas`, `:1214-1302`)
- `ask_user` — `question` (required), `options[]` (2–4, recommended first)
- `update_plan` — `items[{title, status: pending|doing|done}]`
- `load_skill` — `id`
- `update_design_memo` — `memo` (full replacement)
- `show_diff` — no params
- `finish` — `summary`

### Skills (`Agent/SkillLibrary.swift`)
`AgentSkill {id, title, triggers, instructions}` `:15-22`. `matching(goal:limit:2)` auto-injects up to 2 by keyword; `skill(withId:)` powers `load_skill`; `catalogSummary` lists all — `:26-40`. Six skills `:42-143`:
- `app-shell` "Multi-screen app shell (navigation-first)" — triggers app, clone, product, mvp
- `auth-flow` "Login / signup / auth flow" — login, sign in, signup, sign up, auth, register, password
- `commerce` "E-commerce / shop / checkout" — shop, store, commerce, cart, checkout, product, buy, marketplace
- `2d-game` "2D game (built from scratch: custom spec + logic)" — game, flappy, angry birds, slingshot, runner, jump, arcade, platformer
- `dashboard` "Dashboard / analytics / tracker" — dashboard, analytics, tracker, stats, habit, fitness, health, budget, finance
- `onboarding` "Onboarding / walkthrough" — onboarding, walkthrough, welcome, intro, tutorial, first run

### Hooks (`AgentToolLoop.Hooks`, `:1008-1040`)
- `mutatingTools` = `compose_reference_app, apply_design_actions, apply_canvas_studio_edits, wire_interactions, apply_logic_actions, create_from_template, add_logic_template, set_brand, apply_theme, create_game_scene, update_game_scene` `:1017-1021`
- `preRun(goal:)` — checkpoint "before agent: <goal prefix 40>" unless every page is empty `:1024-1028`
- `afterTool(named:)` — auto-checkpoint "auto: agent mid-run" every 3 mutating calls, appending "(auto-checkpoint saved)" to the tool result `:1032-1039`

### Memo
- `DesignProject.agentMemo` (persisted, `Models/DesignProject.swift:30`) is injected into the system prompt under "PROJECT MEMO (decisions from past runs — honor them)" `:965-966`; written by the `update_design_memo` tool `:717-721`

### Steering / pausing / questions
- `steer(_:)` queues text; drained at the start of each step as `"STEERING (mid-run user guidance — takes priority): …"` `:246-251`, `:391-397`
- `pause()`/`resume()` take effect at the next step or tool boundary; `waitWhilePaused()` polls at 400 ms `:148-186`
- Cost approval: `agentLoopCostApprovalUSD` UserDefaults, default **0.50** inside the loop (`max(0.01, stored ?? 0.50)`) even though the UI fields default to 0.10; crossing a band sets `costApprovalRequired` + `isPaused` `:296-302`, `:1322-1329`; resume jumps to the first band above the amount already spent `:156-167`
- `ask_user` budget: 4 per run, ONLY before the first mutating call, answered from `presetAnswers` when supplied; timeout `questionTimeoutSeconds` (600 default; run_agent_loop shortens it) resolves to the first (recommended) option `:684-706`, `:211-243`
- One free redirect from a prose question to `ask_user` (`textQuestionRedirected`) `:558-568`

### Stop conditions
- Model returns text with no tool calls → accepted as final `:569-572`
- `finish` tool called and every gate passes `:724-789`
- Cancel requested `:653-656`
- 3 consecutive failed model attempts → "Stopped after 3 failed model attempts…" `:539-543`
- Same tool + args + result repeated: at 3× a STOP message is injected; at 6× the run ends "Stopped: … repeated the same failing call 6 times without progress." `:605-633`
- Every provider out of quota / rate-limited with nothing left in the chain (after up to 3 waits of 15/30/45 s) `:478-489`
- Prompt ceiling unusable after 4 compaction levels `:511-517`
- Only one loop app-wide (`anyLoopRunning`) `:127`, `:258-260`

### Finish gates (`dispatch` case `"finish"`, `:724-789`)
1. Mutated but zero meaningful interaction flows → "REJECTED: you built UI but wired ZERO logic flows…" (`meaningfulInteractionFlowCount` requires a screen owner, ≥2 blocks, ≥1 connection, and an event bound to a node other than the screen itself, `:1343-1357`)
2. Whole-app goals (`minimumReferenceScreens = 5`): fewer than 5 screens → rejected; fewer than `screenCount - 1` meaningful flows → rejected
3. Latest visual revision not screenshotted → rejected
4. Whole-app goals: any screen not individually inspected by `screenNodeId` → rejected (lists the missing ids)
5. `DesignQualityAudit.report(page:).passesReferenceBar == false` → rejected with the summary; quality not certified for the current `visualRevision` → rejected
6. Build-verification goals (`requiresBuildVerification`, keyed on EN+HE build words `build, app, ship, export, run, implement, fix, בנה, תבנה, אפליקצי, אפליקציה, ייצא, יצוא, תריץ, הרץ, תתקן, תקן`, `:314-316`) require `typecheck_generated` → "Build OK" AND `run_in_simulator` → "Running on"

### Activity view states (`Views/AgentLoopActivityView.swift`)
- Plan checklist (pending/doing/done) — always when `plan` non-empty
- Transcript with kinds `info, tool, result, error, steer, done` (`TranscriptEntry.Kind`, `AgentToolLoop.swift:48`), capped at 240 entries `:1361`
- Pending-question card (blocking)
- Cost line (`runPromptTokens`/`runCompletionTokens`/`runCostUSD`, "approval needed")
- Status line + steer field + pause/resume + cancel — only while `isRunning`
- `MCPDelegatedLoopMirror` shows `mcpController.activeAgentLoop` the same way

### Context management
- Screenshots: only the newest image is sent; older ones become "(screenshot omitted from this turn…)" `:1443-1455`
- Compaction escalates per turn: level 1 → tool-result cap 3000 chars, level 2 → 1200 chars + keep 1 tool turn (and try switching provider), level 3 → shed non-essential tool schemas, >4 → give up with a credits message `:410-521`, `:1417-1532`
- Budget = `learnedPromptTokenCeiling * 0.55` (min 2000) or 12 000 when unknown `:1397-1400`; rough count ≈ chars/4 + 900 per image `:1404-1408`
- Tool results truncated head 4200 / tail 1400 with a marker `:1380-1385`
- Degenerate-payload guard rejects `apply_design_actions`/`apply_logic_actions` arrays where every action lacks `type`, returning a copy-paste example `:818-831`
- Screenshot skipping: a capture is refused when the visual revision hasn't changed since the last capture of that target `:801-810`

---

## 14. Game engine

### `GameSceneSpec` — `Runtime/AgentGameKit.swift:36-145`
`version=1`, `width=390`, `height=844`, `backgroundColor="#8ED0F0"`, `backgroundImage?`, `gravity=-18`, `scrollSpeed=0`, `entities: [GameEntity]`, `startPaused=true`, `showScore=true`, `winScore: Int?`, `tapToStartText="Tap to start"`, `worldWidth=0`, `worldHeight=0`, `cameraFollow: String?`, `parallax: [ParallaxLayer]`, `ambient: String?`, `music: String?`, `lives: Int?`, `timeLimit: CGFloat?`, `timeUpAction="gameOver"`, `difficultyRamp: CGFloat?`, `backgroundGradient: [String]`, `lighting=false`, `lightFollow: String?`, `lightColor="#FFF4D6"`, `vignette=false`.
`ParallaxLayer {sprite, speed=0.4, height?, y=0}` `:147-165`.

### `GameEntity` — `:191-260`
`id`, `name=""`, `sprite?`, `frames: [String]?`, `frameRate?`, `color?`, `x`, `y`, `width`, `height`, `zIndex=0`, `rotation=0` (degrees), `body: GameBodyType = .none`, `circleBody=false`, `affectedByGravity=true`, `restitution=0.2`, `mass?`, `friction=0.2`, `linearDamping=0.1`, `allowsRotation=false`, `category?`, `collidesWith: [String]`, `contacts: [String]`, `isTemplate=false`, `health: Int?`, `dropShadow=false`, `glow=false`, `points: [[CGFloat]]?`, `strokeWidth?`, `glowColor?`, `behaviors: [GameBehavior]`.
`GameBodyType {none, dynamic, staticBody, kinematic}` with lenient decoding (`rigid/physics`→dynamic, `static/fixed/immovable`→staticBody, `kinematicbody/moving`→kinematic) `:169-189`.

### `GameBehavior` — `:314-402`
`type` plus optional `strength`, `key`, `velocityX`, `velocityY`, `interval`, `template`, `spawnYMin`, `spawnYMax`, `gapSize`, `firstDelay`, `scoreOnPass`, `direction`, `margin`, `target`, `action`, `points`, `flowId`, `soundName`, `shake`, `maxPower`, `maxDrag`, `autoReload`, `wheelRadius`, `wheelBase`, `wheelDrop`, `motorSpeed`, `motorForce`, `particles`.
`action` vocabulary: `gameOver | score | win | removeSelf | removeOther | bounce | damage | loseLife | explode | runFlow` `:345`. Particles: `debris | spark | smoke | fire | confetti` (+ `hearts` in the inspector picker) `:368`, `GameInspectorSection.swift:474`.
Behaviour types in use: `impulseOnTap, jumpOnTap, shootOnTap, controlHorizontal, slingshot, spawner, moveConstant, patrol, followEntity, rotateWithVelocity, spin, bob, pulse, trail, destructible, destroyOffscreen, wrapVertical, onCollision`, plus (from the 2d-game skill) `cameraFollow`/`worldWidth` scene-level options — `GameInspectorSection.swift:365-384`, `SkillLibrary.swift:102-110`.

### `GameEvent` (scene → host) — `:408-434`
`started`, `scoreChanged(Int)`, `gameOver(score:)`, `won(score:)`, `runFlow(String)`, `collision(String,String,String,String)`, `tap(CGFloat,CGFloat)`, `drag(String,CGFloat,CGFloat)`, `entityDestroyed(String)`, `lifeLost(Int)`, `spawned(String)`, `impact(String,String,CGFloat,String,String)`, `launched(String)`

### `GameCommand` (host → scene) — `:437-468`
`spawn(template:x:y:)`, `remove(target:)`, `impulse(entity:dx:dy:)`, `move(entity:x:y:)`, `setGravity`, `addScore`, `end(win:)`, `pause(Bool)`, `setVelocity(entity:vx:vy:)`, `setProperty(entity:property:value:)`, `animate(entity:x:y:duration:)`, `addBehavior(entity:behaviorJSON:)`, `removeBehavior(entity:type:)`, `setHealth(entity:health:)`, `shake(CGFloat)`, `particles(kind:x:y:burst:)`, `setTimeScale`, `setSpawnInterval`, `setLives`, `restart`, `launch(entity:angle:strength:)`, `loadSlingshot(entity:)`, `motor(entity:throttle:)`, `gesture(fromX:fromY:toX:toY:)`, `torque(entity:amount:)`, `damageEntity(entity:amount:)`, `setGravityVector(dx:dy:)`, `setPhysics(entity:property:value:)`

### Block → runtime mapping
Every `GameCommand` has a matching `LogicBlockType` (§7 "Game commands"): `gameSpawn→spawn`, `gameRemove→remove`, `gameImpulse→impulse`, `gameMove→move`, `gameSetGravity→setGravity`, `gameAddScore→addScore`, `gameEnd→end`, `gamePause→pause`, `gameSetVelocity`, `gameSetProperty`, `gameAnimate`, `gameAddBehavior`, `gameRemoveBehavior`, `gameSetHealth`, `gameShake`, `gameParticles`, `gameSetTimeScale`, `gameSetSpawnRate→setSpawnInterval`, `gameSetLives`, `gameRestart`, `gameLaunch`, `gameLoadSlingshot`, `gameMotor`, `gameTorque`, `gameDamage`, `gameSetPhysics`, `gameQuery`. Every `GameEvent` has a matching event block: `onGameStart/onGameScore/onGameOver/onGameWin/onGameCollision/onGameTap/onGameDrag/onGameEntityDestroyed/onGameLifeLost/onGameSpawned/onGameImpact/onGameLaunched`. Events are routed through `LogicSimulator.handleGameEvent(_:)` (`Services/LogicSimulator.swift:346`), injected into the preview via `EnvironmentValues.gameEventHandler` (`AppPreviewView.swift:158-160`). In the preview, `gameScore` / `gameOver` / `gameWon` variables auto-sync. `onCollision` with `action: "runFlow"` and `flowId: "<flow name>"` fires a real logic flow.

### Templates — `Models/GameTemplateLibrary.swift`
Four blueprints (`id` / summary): `flappy` (bird, gravity fall, tap to flap, scrolling pipe gaps, score per pipe, crash ends), `angrybirds` (slingshot drag-and-launch into a destructible block stack with a pig, real rigid-body physics, debris particles), `runner` (auto-run, tap to jump, scrolling obstacles), `blank` (gravity + ground only). Entities are pre-built with concrete ids and colours: flappy `bird #FFD23F`, `ground #DEB841`, `pipe #5FB84B`, `spawner #00000000`; angrybirds `ground #7BAF55`, `bird #E23D3D`, `block1..n #C69C6D`, `pig #8ACb5B`; runner `ground #111827`, `hero #F97316`, `obstacle #EF4444`, `spawner`; blank `ground #334155`. `GameTemplate {id, name, summary, …}` `:17-46`.

### Poster view — `Views/GameScenePosterView.swift`
`SpriteView` is Metal-backed and `ImageRenderer` refuses it, so every offscreen path (`get_screenshot`, the vision critic, template thumbnails, print/PDF export) sets `EnvironmentValues.isCanvasSnapshot = true` and `NodeView` substitutes `GameScenePosterView(spec:nodeWidth:nodeHeight:)`, which draws the same entities as plain SwiftUI shapes/images at their design positions `:1-27`, `NodeView.swift:145-147`.

### Sprite generation
See §11 `SpriteGenerator`. In the app it is reachable from Studio ("Design Sprite", facing, frames 1…8, match-existing-art) and over MCP (`generate_sprite`, `flip_sprite`). The 2d-game skill instructs: generate sprites first, then author a full custom `spec` for `create_game_scene`, then wrap it with menu/game-over screens wired by logic flows.

---

## 15. PDF editor

### Tool modes (`PDFToolMode`, `Models/PDFEditorModels.swift:23-73`)
| case | label | icon | behaviour |
|---|---|---|---|
| `select` | Select | `cursorarrow` | native PDFView selection/scroll/zoom; mouse events pass through to `super` |
| `editText` | Edit Text | `character.cursor.ibeam` | click (<4pt drag) → detect the paragraph, prefill a multiline NSAlert, patch the replacement at `min(72, max(6, lineHeight*0.72))`; drag a box → prompt for text to place over the region |
| `translate` | Translate | `globe` | click a paragraph → local-model translate → confirm/edit in an alert → patch (RTL gets right alignment + a Hebrew font) |
| `replaceImage` | Replace Image | `photo` | drag a box → NSOpenPanel(.image) → opaque patch + stamp |
| `shapeRect` | Rectangle | `rectangle` | drag → `.square` annotation |
| `shapeCircle` | Circle | `circle` | drag → `.circle` annotation |
| `shapeLine` | Line | `line.diagonal` | drag → `.line` with start/end at the box's vertical midpoint |
| `draw` | Draw | `pencil.tip` | freehand drag → `addInkDrawing(strokes:)` |
| `highlight` | Highlight | `highlighter` | drag → `.highlight`, systemYellow |
| `underline` | Underline | `underline` | drag → `.underline`, systemBlue |
| `strikeOut` | Strikeout | `strikethrough` | drag → `.strikeOut`, systemRed |
| `comment` | Comment | `text.bubble` | **click-to-place**: 20×20 `.text` annotation "New comment" |
| `freeText` | Text Box | `textbox` | drag → `addFreeText(text: "Text")` |
| `signature` | Signature | `signature` | **click-to-place flag set, but implemented as freehand drag** → `addSignature(strokes:)` |
| `formTextField` | Text Field | `character.textbox` | drag → AcroForm text field named `field_<epoch>` |
| `formCheckbox` | Checkbox | `checklist` | drag → AcroForm checkbox named `checkbox_<epoch>` |
| `crop` | Crop | `crop` | drag → `cropPage(at:to:)` |
`isClickToPlace` is true only for `.comment` and `.signature` `:67-72`.

### Canvas behaviour (`Views/PDF/PDFCanvasView.swift`)
- `PDFEditorNSView: PDFView`, `autoScales = true`, `displayMode = .singlePageContinuous`, `backgroundColor = .underPageBackgroundColor` `:57-64`
- Notifications observed: `.PDFViewSelectionChanged`, `.PDFViewPageChanged` (syncs `currentPageIndex`) `:66-77`, `:101-114`
- Hover feedback for `editText`/`translate`: a solid accent frame (1.5pt, 10% fill, 4pt radius, inset −4/−3) around the paragraph under the cursor; a dashed frame (2pt, dash [6,4]) around the paragraph being edited/translated `:159-188`, `:432-454`, `:469-479`
- Live rubber-band rectangle (accent 15% fill + 1.5pt stroke) while dragging any non-draw tool `:481-497`
- Empty state: `doc.richtext` + "No PDF open" + "New PDF" / "Open…" `:33-45`

### Translation pipeline
- Model/endpoint: `LocalModelTranslator` (Ollama default `http://127.0.0.1:11434`, `/v1/chat/completions`) or the bundled Helsinki-NLP worker on `:17841`; model list from `/api/tags` then `/v1/models`; target language from the Translate tool settings — §12
- Single-paragraph (`translateParagraph`): detect paragraph → translate → confirmation alert → `annotationStyle.fontSize = min(72, max(6, lineHeight*0.72))`, textColor black → `editText(bounds: paragraph.bounds.insetBy(-2,-1), …)` — `PDFCanvasView.swift:288-320`
- Page batch (`translatePage(at:targetLanguage:minWords:concurrency:includeHeadings:)`, `PDFEditorViewModel.swift:830`): default `minWords = 6`, `concurrency = 3` (bounded `1…6`, `:1009`), `includeHeadings = true`
  - Skips: whole TOC pages (≥5 numbered blocks AND ≥half the blocks), TOC-shaped blocks, already-patched regions (custom key OR filled borderless Square, ≥30% overlap), equation-bearing blocks (any `=` or hard-math glyph: ℝℕℤℚℂ𝟙↑↓⇑⇓↖↗↘↙↦→⇒⇐⇔∈∉∀∃, U+1D400–1D7FF, U+2070–209F), already-RTL text, vertical stacks, header strips (top 10%), figure labels, sentence fragments (starts lowercase / doesn't end a sentence / starts with a bare number), overlapping claims, and blocks vertically adjacent to a skipped equation
  - Column detection: modal left edge of prose-sized blocks (8pt buckets); body must be column-aligned (±14pt) or centred and ≥55% of the column width; `effectiveMinWords` falls back to the page's median word count when the page is short-block dominated
  - **Math masking**: `PDFMathGuard.mask` replaces LaTeX (`$$…$$`, `\[…\]`, `\(…\)`, `$…$`, `\command{}`), chemical formulae, Eq/Fig/Ref/Table/Thm/Lemma citations, `[1,2]` refs, and numbers-with-units/exponents with `[[n]]` sentinels; `isMostlyFormula` blocks are never sent; `restore` REJECTS the translation (`.corrupted`) if a sentinel came back mangled — `Services/PDFMathGuard.swift:33-60`, `PDFEditorViewModel.swift:1030-1060`
  - **Glossary masking**: `TranslationMemory.maskTerms(in:startingAt: fragments.count+1)` continues the same sentinel numbering; a lost term rejects the result
  - **Translation memory**: identical source text is served from `cache-<lang>.json`, results stored back
  - Post-checks: a translation that introduces math glyphs the source never had is discarded; `separateHebrewLatinScripts` cleans mixed scripts; heading line heights capped at `pageMedianLineHeight * 1.4`, body at `pageMedianLineHeight`; source font size = `min(72, max(6, cappedLineHeight * 0.72))`
  - **Refit strategy** (`PDFTextFitter.plan`, `Services/PDFTextFitter.swift:54`): (1) `unchanged` if it already fits within 1.5pt tolerance; (2) `grewIntoSlack` — grow downward into genuinely empty space below (`verticalSlack`, hairline 2pt, only horizontally-overlapping neighbours count); (3) binary search (12 iterations, stop at 0.05) for the largest fitting size between `sourceFontSize * 0.62` (`hardFloor`) and the source size → `shrunk` (scale ≥ 0.86 `comfortableFloor`) or `shrunkHard`; (4) `overflowed` when even the floor doesn't fit. There is deliberately NO letter-spacing lever (`PDFAnnotation` freeText carries only `.font`) `:30-41`
  - Reporting: `BatchPageResult {translated, skipped, failed, fitOutcomes}` with `typographyPreserved = (unchanged + grewIntoSlack) / total` `:788-804`
  - Applied inside ONE `withSingleUndoStep` per page `:1074-1128`
- `translatePages(from:to:concurrency:3)` `:1134` — runs `rewritePage(at:concurrency: max(concurrency,4))` per page, live progress `"Translating page N (i/total) to <lang>…"`, cancellable between pages, final message kept for 10 s then cleared. **No autosave** — no `write(to:)` is invoked during batch translation; saving is explicit (`⌘S` / `pdf_save`).
- `rewritePage` (v2 engine, `:1424`) — merges math-split line fragments by baseline (gap < 40pt), keeps TOC/table pages entirely, classifies paragraphs vs headings vs equations, then applies overlay patches. `RewritePageResult {translated, keptOriginal, failed}`
- `buildTranslatedPage(at:concurrency:5)` (`:1759`) — builds a NEW page: translated paragraphs typeset with CoreText (real RTL justification, bidi, font fallback) plus every non-prose band (equations, figures, tables) embedded verbatim as a vector clip in flow order (`EditionItem { slice(CGRect) | paragraph(String, CGFloat, Bool) }`)
- Google pipeline (`runGooglePDFTranslation`, `:62`) — `/bin/zsh -lc "<venv python> <mml_translate_to_hebrew.py> && <venv python> <mml_export_readable_hebrew_pdf.py>"` with env `MML_TRANSLATOR=google`, `MML_PDF_PATH`, `MML_OUT_DIR`; python `/Users/ariel/.agenticdesigner/pdf-translate-venv/bin/python`, scripts in `/Users/ariel/Downloads/`; output dir `<pdf dir>/<pdf name>-hebrew-translation/`, result `<pdf name>-hebrew-readable.pdf`, revealed in Finder on success

### Overlay edit model
- `editText` `:634` — writes an opaque `.square` patch (fill+colour = backgroundColor, zero border width, custom key `AgenticDesignerTextPatch`) then a `.freeText` replacement (clear background, RTL→right / LTR→left alignment when `.natural`)
  - `fitToBounds

`fitToBounds: true` (batch path): bounds inset `dx: 0, dy: -2` (only glyphs draw; the patch is the opaque layer), shrink loop `size *= 0.93` while wrapped height > `bounds.height + 2`, floor 5pt; `verticalLift` (headings) raises origin.y clamped to the page box — `PDFEditorViewModel.swift:662-676`
  - `fitToBounds: false` (interactive path): a single-line region (`bounds.height < singleLineHeight * 2.2`) WIDENS to `singleLine.width + 8` and re-centres vertically; a paragraph region keeps its column width and grows DOWNWARD (`neededHeight = wrappedHeight + 6`); the box is pulled back inside the page's right edge — `:677-696`
  - If the replacement outgrew the original region, the patch expands to `bounds.union(replacementBounds.insetBy(-2,-2))` so the new text never sits over neighbouring content — `:701-703`
  - Heading vertical lift = `min(9, max(4, lineHeight * 0.35))` — `:630-632`
  - Font selection: `ArialHebrew` when `LocalModelTranslator.isRightToLeft(text)`, else `annotationStyle.fontName` (default "Helvetica"), falling back to the system font — `:623-628`
- `replaceImage` `:755` — opaque `.square` patch + a `PDFImageStampAnnotation` (custom `draw(with:in:)` subclass; the image data is carried under the annotation key `AgenticDesignerStampImageData`, `:2003`/`:2013`)
- `revertOverlayEdits(on:) -> Int` `:725` — removes anything carrying the custom patch key, any borderless filled light `Square` (the post-save/reload form of a patch), and EVERY `FreeText` on the page; snapshots first, returns the count, message "Reverted N overlay edit(s)"

### Paragraph detection
- `paragraph(at:on:)` `:1172` — finds the clicked line, then walks up and down while `continuous`: vertical gap < `min(height) * 0.9`, horizontal overlap > that reference, size ratio in `0.7…1.4`; stops at an indented line (`minX > previous.minX + 6`, a new paragraph's first line) and at a centred-heading break (`minX > other.minX + 24`). Returns `PDFParagraph {text, bounds (union), lineHeight (median)}`
- `paragraphs(on:)` `:1216` — the same rules applied sequentially to split the whole page into blocks
- `cachedTextLines(on:)` `:1254` — cached per `(pageID, revision)` — `:1170`

### Extraction / thumbnails / status
- `Services/PDFTextExtractor.swift` (198 lines) — line/word extraction with bounds used by the paragraph clustering
- Thumbnails: `PDFPage.thumbnail(of:for: .mediaBox)` at a 200pt max dimension, aspect ratio flipped when `rotation % 180 != 0` (fallback 0.77) — `Views/PDF/PDFPageThumbnailsPanel.swift:106-111`, `:154-171`
- Status panel: see §2 (undo/redo, unsaved dot, batch progress + cancel, Translate Pages… sheet, Google translation section, Flatten & Export…)
- `revision` is bumped on every mutation because PDFKit types are reference types Combine cannot observe — `:42`, `:337-339`

### Metadata / save / saveAs / flatten
- `PDFDocumentMetadata {title, author, subject, keywords}` reads/writes `PDFDocumentAttribute.titleAttribute/authorAttribute/subjectAttribute/keywordsAttribute` (keywords split on commas, trimmed, empties dropped) — `Models/PDFEditorModels.swift:133-162`
- `save()` `:204` — writes to `fileURL`, or falls through to `saveAs()` when there is none
- `saveAs()` `:210` — NSSavePanel (.pdf), default name `fileURL?.lastPathComponent ?? "Untitled.pdf"`, forces a `.pdf` extension, updates `fileURL` on success
- `write(to:)` `:223` — applies metadata, `document.write(to:)`, clears `isDirty`, status "Saved <name>" / "Save failed"
- `exportFlattened(to:)` `:240` — rebuilds a NEW `PDFDocument` where every page is rasterized through `CGContext` + `PDFPage.draw(with: .mediaBox, to:)` (baking patches and replacements into the pixels), applies metadata, writes; the live document is untouched. Default file name `<name>-flattened.pdf`
- `newDocument(pageSize:)` `:155` — default US Letter 612×792, one white blank page, resets stacks/dirty/metadata
- Undo/redo: full `document.dataRepresentation()` snapshots, cap 40, `withSingleUndoStep` suppresses per-edit snapshots for batch operations — `:296-331`

---

## 16. Templates and galleries (names only)

### `TemplateFactory.all` — `DesignIntelligence/TemplateFactory.swift:36-192`
- `finance-dashboard` "Finance Dashboard" — "Balance, quick actions, transactions" — screens: Home, Analytics, Profile
- `fitness-tracker` "Fitness Tracker" — "Workouts, progress rings, streaks" — Today, Workout, Stats
- `ecommerce-shop` "E-commerce Shop" — "Storefront, product page, cart" — Shop, Product, Cart
- `travel-explorer` "Travel Explorer" — "Destinations, trip details" — Explore, Trip, Saved
- `ai-chat` "AI Chat Assistant" — "Conversation, history" — Chat, History
- `wellness` "Wellness & Meditation" — "Calm home, session player" — Today, Session
- `saas-onboarding` "SaaS Onboarding" — "Welcome, login, paywall" — Welcome, Login, Paywall

### `DesignRecipeLibrary` recipes — `DesignIntelligence/DesignRecipeLibrary.swift:56-366`
`financeHome`, `financeDashboard`, `fitnessHome`, `mentalHealthHome`, `travelExplore`, `ecommerceHome`, `aiChatHome`, `premiumOnboarding`, `premiumLogin`, `genericPremiumMobile`.
Routing `recipe(category:screenType:)` `:13-54`: (finance|banking, home|generic) → financeHome; (finance|trading, dashboard|generic|home) → financeDashboard; (fitness|health, home|generic|dashboard) → fitnessHome; (mentalHealth, home|generic) → mentalHealthHome; (travel, home|search|generic) → travelExplore; (ecommerce, home|generic) → ecommerceHome; (aiChat, home|generic) → aiChatHome; (_, onboarding) → premiumOnboarding; (_, login) → premiumLogin; default → genericPremiumMobile.

### `FlowTemplateLibrary.all` — `Models/FlowTemplateLibrary.swift:25-126`
`Sign Up (Firebase)` · `Log In (Firebase)` · `Log Out (with confirmation)` · `Forgot Password` · `Fetch List (REST API)` · `Save Item (Supabase)` · `Sign Up + Profile (Supabase)` · `Log In (Supabase)` · `Ask Notification Permission` · `Daily Reminder` · `Find My Location` · `Live Location Tracking` · `Fitness Stats (Watch)` · `Shake to Refresh` · `Motion / Tilt Reader` · `Battery Saver Check`
(icons in order: `person.badge.plus`, `person.badge.key`, `rectangle.portrait.and.arrow.right`, `key.horizontal`, `network`, `tray.and.arrow.down`, `person.crop.circle.badge.plus`, `person.badge.key.fill`, `bell.badge`, `bell.and.waves.left.and.right`, `location.fill`, `location.circle.fill`, `heart.text.square`, `iphone.gen3.radiowaves.left.and.right`, `gyroscope`, `battery.25`)

### `GameTemplateLibrary.all` — `Models/GameTemplateLibrary.swift:26-47`
`flappy` · `angrybirds` · `runner` · `blank`

### Supporting vocabularies
- `ComponentType` (~100 cases) — `DesignIntelligence/ComponentRegistry.swift:11-104`: avatarGreetingHeader, balanceHeroCard, quickActionRow, transactionRow, transactionList, currencyCard, currencyCardGrid, bottomNavBar, primaryButton, secondaryButton, textField, metricCard, chartCard, onboardingScreen, editorialIllustrationBlock, progressRing, workoutCard, statCard, primaryCTA, moodCheckInCard, journalPromptCard, softPrimaryButton, progressCard, searchBar, destinationHeroCard, categoryChips, destinationCard, bookingCTA, header, heroCard, contentCard, largeIconTile, iconFeatureGrid, productCard, chatMessage, chatInput, skipLink, editorialHeadline, lineArtIllustration, bodyCopy, pillPrimaryButton, pillSecondaryButton, headerIcon, inputField, textLink, socialButton, imageHero, imageCard, backgroundImage, maskedImage, productImage, galleryStrip, travelHeroScreen, travelDiscoverScreen, travelDetailScreen, travelHeroCard, propertySearchScreen, propertyHeroCard, propertyDetailCard, apartmentCard, amenityRow, beverageHeroScreen, flavorVariationStrip, beverageProductCard, productHeroScreen, ecommerceHeroProduct, productHeroCard, productGrid, productDetailPanel, addToCartCTA, sidebar, splitView, cardGrid, mediaCard, bookCard, meditationHeroScreen, meditationHeroImage, audioPlayerCard, playerControl, meditationTrackList, audioTrackList, moodTabBar, instructorCard, creditCardPreview, toggleRow, progressBar, categoryRow, budgetGauge, controlButton, insightCard, securitySettingRow. A `normalize` switch maps ~35 alias spellings onto these (`:128-184`).
- `VisualStylePreset` (23) — `DesignIntelligence/DesignTokenLibrary.swift:14-58`: softFintech, minimalEditorial, premiumDark, energeticFitness, immersiveTravelNature, glassRealEstate, darkBeverageEditorial, softProductCommerce, immersiveWellnessAudio, premiumAudioDark, premiumArtDirection, socialContent, messagingUtility, cinematicMedia, commerceUtility, healthMetrics, mindfulIllustrated, appleCalm, luxuryTravel, cleanSaaS, softWellness, playfulEcommerce, focusedProductivity
- `AppCategory` (19) — `DesignIntelligence/AppCategory.swift:12-30`: finance, banking, trading, fitness, health, mentalHealth, travel, ecommerce, foodDelivery, education, productivity, aiChat, social, realEstate, music, crypto, calendar, habitTracker, generic
- `ScreenType` (14) — `DesignIntelligence/ScreenType.swift:12-25`: onboarding, login, home, dashboard, details, profile, settings, checkout, search, feed, analytics, emptyState, paywall, generic
- `DevicePresetLibrary` (5) — `DesignSystem/DevicePreset.swift:31-90`: `iphone_15_pro` "iPhone 15 Pro", `iphone_se` "iPhone SE", `ipad_pro_11` "iPad Pro 11", `apple_watch_45` "Apple Watch 45mm", `macbook_pro_14` "MacBook Pro 14"

---

## 17. Persisted keys and Application Support paths

### `@AppStorage` (all confirmed by grep across the whole app)
| key | type / default | declared in |
|---|---|---|
| `openRouterAPIKey` | String `""` | AgentPanel.swift:28, DesignChatPanel.swift:27 |
| `cerebrasAPIKey` | String `""` | AgentPanel.swift:29, DesignChatPanel.swift:28 |
| `groqAPIKey` | String `""` | AgentPanel.swift:30, DesignChatPanel.swift:29 |
| `geminiAPIKey` | String `""` | AgentPanel.swift:31, DesignChatPanel.swift:30 |
| `nvidiaAPIKey` | String `""` | AgentPanel.swift:32, DesignChatPanel.swift:31 |
| `openRouterModel` | String, default `OpenRouterConfiguration.model` (`google/gemini-2.5-pro`) | AgentPanel.swift:33, DesignChatPanel.swift:26 |
| `openRouterGenerationModel` | String `google/gemma-4-31b-it:free` | AgentPanel.swift:34 |
| `autoCriticEnabled` | Bool `true` | AgentPanel.swift:35 |
| `agentLoopCostApprovalUSD` | Double `0.10` (loop itself defaults to `0.50` when unset) | AgentPanel.swift:36, DesignChatPanel.swift:32, AgentToolLoop.swift:296-301 |
| `agentRunMode` | String `"loop"` (`loop` \| `pipeline`) | AgentPanel.swift:39 |
| `designChatEngine` | String `"loop"` (`loop` \| `build` \| `edit`) | DesignChatPanel.swift:25 |

### Plain `UserDefaults` keys
| key | purpose | site |
|---|---|---|
| `mcpServerPort` | MCP port (1024…65535, default 8765) | MCPServerController.swift:56, :45, :67-68 |
| `mcpServerEnabled` | MCP auto-start flag | MCPServerController.swift:57, :89-95 |
| `autoHugTextBoxes` | Bool, default true — auto-hug generated text boxes | ProjectViewModel.swift:4474-4476 |
| `localFallbackModel` | last-resort local model id in the fallback chain | ModelProviderCatalog.swift:204 |
| `discoveredModels.<routeId>` | cached model list per provider | ModelProviderCatalog.swift:252-262 |
| `localTranslatorEndpoint` | default `http://127.0.0.1:11434` | LocalModelTranslator.swift:50, :55 |
| `localTranslatorModel` | selected translation model | LocalModelTranslator.swift:51, :56 |
| `localTranslatorLanguage` | default `"Hebrew"` | LocalModelTranslator.swift:52, :57 |
| `helsinkiTranslatorPython` | override python path for the Helsinki worker | LocalModelTranslator.swift:201 |
| `gitSync.enabled.<sanitized project name>` | per-project git sync flag | GitSyncService.swift:55-57, :64, :113, :118 |
| `AgenticDesignerPreview.<variableName>` | interactive-preview variable persistence | LogicSimulator.swift:1158 |
| `AgenticDesignerStampImageData` | PDF image-stamp payload (annotation key, not a defaults key) | PDFEditorViewModel.swift:2003, :2013 |
| `auth.mode`, `auth.guestId` | keys written by GENERATED apps (AuthService.swift) | LogicExporter.swift:3928-3981 |
| `autoFire` | key inside the generated AgentGameKit runtime | Runtime/AgentGameKit.swift:722 |

### Env vars read
- `AGENTIC_MCP_PORT` — MCPServerController.swift:63, :88
- `OPENROUTER_API_KEY` — OpenRouterConfiguration.swift:47, ModelProviderCatalog.swift:118
- `CEREBRAS_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY` — ModelProviderCatalog.swift:82/90/98/110
- Env vars WRITTEN for child processes: `DEVELOPER_DIR` (SimulatorRunner.swift:301, SimulatorControl.swift:172, GeneratedSourcePreview.swift:204), `PATH` (GitSyncService.swift:311, ChatGPTSubscriptionService.swift:123/174, FirebaseProvisioner.swift:190), `MML_TRANSLATOR` / `MML_PDF_PATH` / `MML_OUT_DIR` (PDFEditorViewModel.swift:101-103)

### Files under `~/Library/Application Support/AgenticDesigner/`
| path | contents |
|---|---|
| `Checkpoints/<project>/<ISO8601>__<label>.json` | project checkpoints, pruned to 40 (CheckpointStore.swift:25-52, :100) |
| `Components/<uuid>.json` | saved reusable components (ComponentLibrary.swift:36-39, :84-86) |
| `GeneratedAssets/<uuid>.<ext>` | AI-generated images (OpenRouterProvider.swift:864-877) |
| `GeneratedAssets/sprite-<uuid>.png` | generated/flipped sprites (SpriteGenerator.swift:203-219, :239-247) |
| `GitRepos/<project>/project.agenticdesign` | git-synced design document (GitSyncService.swift:39-53, :259-266) |
| `GitRepos/<project>/Exports/Xcode/`, `…/Exports/SwiftPM/` | mirrored exports (GitSyncService.swift:143-168) |
| `GitRepos/<project>/{.gitignore, README.md}` | repo scaffolding (GitSyncService.swift:92-109) |
| `SavedProjects/<name>.agenticdesign` | default project save location (ProjectDocumentService.swift:88-99) |
| `Translation/cache-<lang>.json`, `Translation/glossary-<lang>.json` | translation memory + glossary (TranslationMemory.swift:132-136) |

### Temp directories
- `tmp/AgenticDesignerSimulatorRun/` (+`last-run-error.log`) — LogicEditorView.swift:319-321, SimulatorRunner.swift:506-510
- `tmp/AgenticDesignerAppleWatchRun/` — LogicEditorView.swift:370-371
- `tmp/AgenticDesigner<Target>Run/` — LogicEditorView.swift:415-416
- `tmp/AgenticDesigner-CodeMode-<uuid>/` — GeneratedSourcePreview.swift:36-38
- `tmp/AgenticDesigner-Typecheck-<uuid>/` — GeneratedSourcePreview.swift:121-123
- `tmp/emberSimShot-<uuid>.png` — SimulatorControl.swift:57-60

### Bundled resources referenced
- `mflux_bridge.py` (Bundle `Resources/` or root) — OpenRouterProvider.swift:802-803
- `helsinki_translation_server.py` (Bundle `Resources/` or root) — LocalModelTranslator.swift:197-198
- `Assets/Studio/mizmor-background-100x180cm-150dpi.png` — ProjectViewModel.swift:1483-1484, :1594-1606
- SwiftData `ModelContainer` for `Item.self`, on disk — AgenticDesignerApp.swift:12-24 (vestigial; `ContentView` renders only `EditorView`)

---

## 18. External processes and URLs

### Processes spawned
| binary | arguments | site |
|---|---|---|
| `/usr/bin/git` | `-C <repo> init -b main`, `config user.name/user.email`, `add -A`, `status --porcelain`, `commit -m`, `rev-parse --abbrev-ref HEAD`, `rev-list --count HEAD`, `remote get-url origin`, `log --oneline -5`, `push -u origin HEAD` | GitSyncService.swift:32, :83-89, :193-235, :271-274, :296-298 |
| `gh` (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`) | `repo create <name> --private\|--public --source <repo> --push` | GitSyncService.swift:239-252, :278-281 |
| `firebase` (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`) | `login:list`, `projects:create <id> --display-name <n> --non-interactive`, `projects:list`, `apps:create IOS <n> --bundle-id <b> --project <p> --non-interactive`, `apps:list IOS --project <p>`, `apps:sdkconfig IOS <appId> --project <p> --non-interactive`, `firestore:databases:create (default) --location nam5 --project <p> --non-interactive`, `deploy --only firestore:rules --project <p> --non-interactive` | FirebaseProvisioner.swift:41-48, :55, :79-163 |
| `codex` (`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`) | `login status`, `login`, `mcp list`, `mcp add agenticdesigner --url http://127.0.0.1:<port>/mcp`, `exec --sandbox danger-full-access --skip-git-repo-check -C <dir> <goal>` | ChatGPTSubscriptionService.swift:42-46, :63-121 |
| `/usr/bin/xcode-select` | `-p` | SimulatorRunner.swift:281, SimulatorControl.swift:26, GeneratedSourcePreview.swift:190 |
| `/usr/bin/xcrun` | `-sdk iphonesimulator swiftc [-typecheck] -target <arch>-apple-ios17.0-simulator -parse-as-library …`; `simctl boot`, `simctl bootstatus -b`, `simctl install`, `simctl launch --terminate-running-process`, `simctl list devices [available\|booted] --json`, `simctl io <udid> screenshot <path>`, `simctl spawn <udid> launchctl list`, `simctl ui <udid> appearance <mode>` | SimulatorRunner.swift:59-67, :86-114, :147-155, :220, :250, :398-410, :492-500; SimulatorControl.swift:37, :59; GeneratedSourcePreview.swift:146-151 |
| `/usr/bin/xcodebuild` | `-project … -target <App>Watch -sdk watchsimulator -configuration Debug SYMROOT=… CODE_SIGNING_ALLOWED=NO build`; `-project … -scheme <App> -sdk iphonesimulator -configuration Debug -destination "generic/platform=iOS Simulator" SYMROOT=… CODE_SIGNING_ALLOWED=NO build`; `-project … -scheme <App> -destination "generic/platform=iOS" -archivePath … archive [DEVELOPMENT_TEAM=… -allowProvisioningUpdates]`; `-exportArchive -archivePath … -exportPath … -exportOptionsPlist … -allowProvisioningUpdates` | SimulatorRunner.swift:86-94, :377-386, :443-477 |
| `/usr/bin/open` | `-a Simulator` | SimulatorRunner.swift:61, :108, :400 |
| `/opt/homebrew/bin/python3` or `/usr/bin/python3` | `<bundle>/mflux_bridge.py` | OpenRouterProvider.swift:804-809 |
| `<venv>/bin/python` (probed: UserDefaults `helsinkiTranslatorPython`, `/Users/ariel/.agenticdesigner/pdf-translate-venv/bin/python`, `/opt/homebrew/bin/python3`, `/usr/bin/python3`) | `<bundle>/helsinki_translation_server.py` | LocalModelTranslator.swift:197-218 |
| `/bin/zsh` | `-lc "<venv python> /Users/ariel/Downloads/mml_translate_to_hebrew.py && <venv python> /Users/ariel/Downloads/mml_export_readable_hebrew_pdf.py"` | PDFEditorViewModel.swift:93-98 |
| `NSWorkspace.shared.open` | opens the exported `.xcodeproj` in Xcode; opens provider signup URLs | LogicEditorView.swift:424; AgentPanel.swift:317; DesignChatPanel.swift:207 |
| `NSWorkspace.shared.activateFileViewerSelecting` | reveals the git repo dir; reveals the Hebrew-readable PDF | EditorView.swift:465-467; PDFEditorViewModel.swift:125 |
| `NSWorkspace.shared.runningApplications … activate` | focuses the Simulator app before synthetic input | SimulatorControl.swift:157-162 |

### Network endpoints contacted
| URL | purpose | site |
|---|---|---|
| `http://127.0.0.1:11434/v1/chat/completions` | local model chat (Ollama/LM Studio, OpenAI-compatible) | ModelProviderCatalog.swift:73 |
| `http://127.0.0.1:11434/api/chat` | Ollama native schema-constrained generation | OpenRouterProvider.swift:158 |
| `http://<translator endpoint>/api/tags`, `/v1/models`, `/v1/chat/completions` | translator model discovery + translation | LocalModelTranslator.swift:88, :98, :126 |
| `http://127.0.0.1:17841/health`, `/translate` | bundled Helsinki-NLP worker | LocalModelTranslator.swift:171, :193 |
| `http://127.0.0.1:7860/` and `/sdapi/v1/txt2img` | MFLUX / Draw Things / A1111 local image generation (auto-started) | OpenRouterProvider.swift:800, :818, :834 |
| `http://127.0.0.1:<port>/mcp` | the app's own MCP endpoint (registered with Codex) | MCPServerController.swift:72; ChatGPTSubscriptionService.swift:90-93 |
| `https://openrouter.ai/api/v1/chat/completions` | OpenRouter chat | ModelProviderCatalog.swift:116 |
| `https://openrouter.ai/api/v1/images` | OpenRouter image generation | OpenRouterProvider.swift:44 |
| `https://api.cerebras.ai/v1/chat/completions` (+ `/v1/models`) | Cerebras | ModelProviderCatalog.swift:81, :38-42 |
| `https://api.groq.com/openai/v1/chat/completions` (+ `/models`) | Groq | ModelProviderCatalog.swift:89 |
| `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` (+ `/models`) | Google AI Studio | ModelProviderCatalog.swift:97 |
| `https://integrate.api.nvidia.com/v1/chat/completions` (+ `/models`) | NVIDIA NIM | ModelProviderCatalog.swift:108 |
| `https://cloud.cerebras.ai/`, `https://console.groq.com/keys`, `https://aistudio.google.com/apikey`, `https://build.nvidia.com/`, `https://openrouter.ai/settings/keys` | "Get key" signup links | ModelProviderCatalog.swift:266-273 |
| `https://github.com/firebase/firebase-ios-sdk` | SPM dependency written into generated `Package.swift` / pbxproj | LogicExporter.swift |
| `https://maps.apple.com/` | emitted by the generated `launchMaps` block | LogicExporter.swift |
| Arbitrary `http(s)` image URLs | `AsyncImage` in NodeView / InspectorPanel, and downloading OpenRouter image results | NodeView.swift:293-311; InspectorPanel.swift:431-438; OpenRouterProvider.swift:591-594 |
| User-configured Firebase / Supabase / REST endpoints | runtime calls from the simulator, web export, and generated apps | LogicSimulator, LogicWebCompiler, LogicExporter |

Placeholder/example strings that are NOT real endpoints: `https://abcd1234.supabase.co`, `https://api.example.com`, `https://api.example.com/users`, `https://example.com/file.pdf`, `http://www.apple.com/DTDs/PropertyList-1.0.dtd` (plist DOCTYPE).

---

## Notes for the porter

- The design canvas has **no** double-click-to-edit-text and **no** canvas context menu; both exist only in adjacent surfaces (Layers panel context menu, Logic canvas block/wire context menus, PDF thumbnail context menu). Don't invent them, and don't drop the Layers-panel menu that substitutes for them.
- `applyDesignActions` (in-app agent) and `applyDesignActionsExactly` (MCP) are two DIFFERENT pipelines: the first runs 13 normalization passes that restack layouts; the second respects coordinates verbatim and runs only text hugging. The `normalize` flag on `apply_design_actions` selects between them.
- Inspector `multi` semantics are load-bearing: Position/Size/Transform are single-target; every style/content row broadcasts to the whole selection.
- Cost-approval default differs between the UI (`0.10`) and the loop's own fallback (`0.50`) — reproduce both.
- `Item.swift` + the SwiftData `ModelContainer` are vestigial scaffolding; `ContentView` renders only `EditorView`.