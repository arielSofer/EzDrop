//
//  EditorView.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//
import SwiftUI
#if os(macOS)
import AppKit
#endif

struct EditorView: View {
    @StateObject private var viewModel = ProjectViewModel()
    @StateObject private var logicViewModel = LogicViewModel()
    @StateObject private var mcpController = MCPServerController()
    @StateObject private var previewSimulator = LogicSimulator()
    @StateObject private var pdfViewModel = PDFEditorViewModel()
    // Agent state lives HERE, above the mode switch, so the chat history and a
    // running agent loop survive moving between Design / Studio / Logic / Code.
    // Both panels share one loop — only one may run app-wide anyway, so this
    // also means the same run stays visible whichever panel you're looking at.
    @StateObject private var agentSession = DesignChatSession()
    @StateObject private var agentPipeline = AgentPipelineCoordinator()
    @StateObject private var agentLoop = AgentToolLoop()
    @State private var editorMode: EditorMode = .design
    @State private var canvasZoom: CGFloat = 1.0
    @State private var showMCPPanel = false
    @State private var showTemplateGallery = false
    @State private var showWebPreview = false

    // Ready-made brand accents; "Pick Custom Colour…" opens the system picker.
    static let brandSwatches: [(name: String, hex: String)] = [
        ("Coral", "#F0653C"), ("Indigo", "#4F46E5"), ("Emerald", "#10B981"),
        ("Amber", "#F59E0B"), ("Rose", "#E11D48"), ("Teal", "#0F766E"),
        ("Violet", "#7C3AED"), ("Slate", "#334155"),
    ]

    private func pickBrandColor() {
        let panel = NSColorPanel.shared
        panel.setTarget(nil)
        panel.showsAlpha = false
        panel.makeKeyAndOrderFront(nil)
        // The picker is modeless; read the chosen colour when it closes.
        NotificationCenter.default.addObserver(
            forName: NSColorPanel.willCloseNotification, object: panel, queue: .main
        ) { _ in
            guard let rgb = panel.color.usingColorSpace(.sRGB) else { return }
            let hex = String(
                format: "#%02X%02X%02X",
                Int(rgb.redComponent * 255), Int(rgb.greenComponent * 255), Int(rgb.blueComponent * 255)
            )
            Task { @MainActor in
                CheckpointStore.save(viewModel.project, label: "before brand: \(hex)")
                BrandKit.apply(BrandIdentity(accent: hex, accentSecondary: nil, name: "Custom"), to: viewModel)
            }
        }
    }

    private func gitEnable() {
        do {
            let repo = try GitSyncService.enable(project: viewModel.project)
            documentMessage = "Git sync ON — every checkpoint now commits to \(repo.path)"
        } catch {
            documentMessage = "Git: \(error.localizedDescription)"
        }
    }

    private func gitCommitNow() {
        do {
            documentMessage = "Git: \(try GitSyncService.commitNow(project: viewModel.project, message: nil))"
        } catch {
            documentMessage = "Git: \(error.localizedDescription)"
        }
    }

    private func gitPush() {
        documentMessage = "Git: pushing…"
        let project = viewModel.project
        Task.detached {
            let message: String
            do {
                message = try GitSyncService.push(project: project, repoName: nil, isPrivate: true)
            } catch {
                message = "Push failed: \(error.localizedDescription)"
            }
            await MainActor.run { documentMessage = "Git: \(message)" }
        }
    }
    @State private var currentProjectURL: URL?
    @State private var documentMessage: String?
    #if os(macOS)
    @State private var keyDownMonitor: Any?
    #endif

    enum EditorMode: String, CaseIterable {
        case design = "Design"
        case studio = "Studio"
        case logic = "Logic"
        case code = "Code"
        case pdf = "PDF Editor"
    }

    var body: some View {
        VStack(spacing: 0) {
            topToolbar

            HStack(spacing: 0) {
                // Left panel: Layers in design mode, Studio assets in studio
                // mode, Block Palette in logic mode, page thumbnails in PDF mode
                Group {
                    if editorMode == .logic {
                        BlockPaletteView(logicViewModel: logicViewModel)
                    } else if editorMode == .studio {
                        CanvasStudioAssetsPanel(viewModel: viewModel)
                    } else if editorMode == .pdf {
                        PDFPageThumbnailsPanel(viewModel: pdfViewModel)
                    } else {
                        LayersPanel(viewModel: viewModel)
                    }
                }
                .frame(width: 240)

                Divider()

                // Center: visual canvas, logic canvas, or PDF canvas
                Group {
                    if editorMode == .logic {
                        LogicEditorView(
                            logicViewModel: logicViewModel,
                            designViewModel: viewModel,
                            simulator: previewSimulator
                        )
                    } else if editorMode == .code {
                        // Code Mode: the Swift the exporter will actually emit,
                        // regenerated live from the design — read-only proof.
                        CodeModeView(viewModel: viewModel, logicViewModel: logicViewModel)
                    } else if editorMode == .pdf {
                        PDFCanvasView(viewModel: pdfViewModel)
                    } else {
                        CanvasView(viewModel: viewModel, zoomScale: $canvasZoom)
                            .overlay(alignment: .bottom) {
                                // The Lovable edit loop: select anything,
                                // say anything, only that element changes.
                                SelectionEditBubble(viewModel: viewModel)
                                    .padding(.bottom, 14)
                            }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                Divider()

                VStack(spacing: 0) {
                    // Right panel: Inspector, Block Inspector, or PDF Inspector
                    Group {
                        if editorMode == .logic {
                            BlockInspectorPanel(
                                logicViewModel: logicViewModel,
                                designViewModel: viewModel
                            )
                        } else if editorMode == .studio {
                            CanvasStudioInspectorPanel(viewModel: viewModel)
                        } else if editorMode == .pdf {
                            PDFInspectorPanel(viewModel: pdfViewModel)
                        } else {
                            InspectorPanel(viewModel: viewModel)
                        }
                    }
                    .frame(maxHeight: .infinity)

                    Divider()

                    if editorMode == .pdf {
                        PDFStatusPanel(viewModel: pdfViewModel)
                            .frame(height: 180)
                    } else if editorMode == .logic {
                        AgentPanel(
                            viewModel: viewModel,
                            logicViewModel: logicViewModel,
                            isLogicMode: true,
                            mcpController: mcpController,
                            pipeline: agentPipeline,
                            loop: agentLoop
                        )
                        .frame(height: 180)
                    } else {
                        // Design mode gets the conversation: history, live stage
                        // narration, and per-message revert.
                        DesignChatPanel(
                            viewModel: viewModel,
                            logicViewModel: logicViewModel,
                            mcpController: mcpController,
                            session: agentSession,
                            pipeline: agentPipeline,
                            loop: agentLoop
                        )
                        .frame(minHeight: 300)
                    }
                }
                .frame(width: 300)
            }
        }
        .frame(minWidth: 1100, minHeight: 700)
        .onAppear {
            installKeyboardMonitor()
            mcpController.attach(design: viewModel, logic: logicViewModel, simulator: previewSimulator, pdf: pdfViewModel)
        }
        .sheet(isPresented: $showMCPPanel) {
            MCPServerPanel(controller: mcpController)
        }
        .sheet(isPresented: $showTemplateGallery) {
            TemplateGalleryView(viewModel: viewModel)
        }
        .sheet(isPresented: $showWebPreview) {
            WebPreviewView(viewModel: viewModel)
        }
        .sheet(isPresented: $logicViewModel.showAppPreview) {
            AppPreviewView(
                logicViewModel: logicViewModel,
                designViewModel: viewModel,
                simulator: previewSimulator
            )
        }
        .onDisappear {
            removeKeyboardMonitor()
        }
        .onChange(of: editorMode) { newMode in
            if newMode == .logic {
                logicViewModel.attach(to: viewModel)
            } else {
                logicViewModel.persist()
            }
        }
        .background {
            // Hidden buttons for global keyboard shortcuts
            Button("") { undoForCurrentMode() }
                .keyboardShortcut("z", modifiers: .command)

            Button("") { redoForCurrentMode() }
                .keyboardShortcut("z", modifiers: [.command, .shift])

            Button("") { deleteForCurrentMode() }
                .keyboardShortcut(KeyEquivalent("\u{7F}"), modifiers: [])

            Button("") { deleteForCurrentMode() }
                .keyboardShortcut(.delete, modifiers: [])

            Button("") { saveProject() }
                .keyboardShortcut("s", modifiers: .command)

            Button("") { saveProjectAs() }
                .keyboardShortcut("s", modifiers: [.command, .shift])

            Button("") { openProject() }
                .keyboardShortcut("o", modifiers: .command)
        }
    }

    // MARK: - Mode-aware shortcut routing

    private func undoForCurrentMode() {
        // Code Mode has its own text undo stack. Without this branch ⌘Z fell
        // through to the design canvas — silently reverting a design change
        // the user can't even see from this tab while they were typing code.
        if editorMode == .code { performCodeEditorUndo(redo: false); return }
        if editorMode == .pdf { pdfViewModel.undo() }
        else if editorMode == .logic { logicViewModel.undo() }
        else { viewModel.undo() }
    }

    private func redoForCurrentMode() {
        if editorMode == .code { performCodeEditorUndo(redo: true); return }
        if editorMode == .pdf { pdfViewModel.redo() }
        else if editorMode == .logic { logicViewModel.redo() }
        else { viewModel.redo() }
    }

    /// Undo/redo inside the Code Mode source editor, driven by the focused
    /// text view's own undo manager (⌘Z / ⇧⌘Z, and ⌃Z for muscle memory from
    /// other editors). Returns false when the editor isn't focused, so the
    /// caller can decide — and so it never touches the design by accident.
    @discardableResult
    private func performCodeEditorUndo(redo: Bool) -> Bool {
        #if os(macOS)
        guard let textView = NSApplication.shared.keyWindow?.firstResponder as? NSTextView,
              let undoManager = textView.undoManager else { return false }
        if redo {
            guard undoManager.canRedo else { return false }
            undoManager.redo()
        } else {
            guard undoManager.canUndo else { return false }
            undoManager.undo()
        }
        return true
        #else
        return false
        #endif
    }

    private func deleteForCurrentMode() {
        if editorMode == .pdf {
            if let annotation = pdfViewModel.selectedAnnotation { pdfViewModel.removeAnnotation(annotation) }
        } else if editorMode == .logic {
            logicViewModel.deleteSelected()
        } else {
            viewModel.safeDeleteSelectedNode()
        }
    }

    private func saveProject() {
        if editorMode == .pdf {
            _ = pdfViewModel.save()
            documentMessage = pdfViewModel.statusMessage
            return
        }
        saveProject(to: currentProjectURL)
    }

    private func saveProjectAs() {
        if editorMode == .pdf {
            _ = pdfViewModel.saveAs()
            documentMessage = pdfViewModel.statusMessage
            return
        }
        saveProject(to: nil)
    }

    private func saveProject(to url: URL?) {
        logicViewModel.persist()
        do {
            currentProjectURL = try ProjectDocumentService.save(project: viewModel.project, to: url)
            documentMessage = "Saved \(currentProjectURL?.lastPathComponent ?? viewModel.project.name)"
        } catch ProjectDocumentError.cancelled {
            documentMessage = nil
        } catch {
            documentMessage = "Save failed: \(error.localizedDescription)"
        }
    }

    private func openProject() {
        if editorMode == .pdf {
            pdfViewModel.openWithPanel()
            documentMessage = pdfViewModel.statusMessage
            return
        }
        logicViewModel.persist()
        do {
            let opened = try ProjectDocumentService.open()
            viewModel.replaceProject(opened.project)
            currentProjectURL = opened.url
            logicViewModel.attach(to: viewModel)
            documentMessage = "Opened \(opened.url.lastPathComponent)"
        } catch ProjectDocumentError.cancelled {
            documentMessage = nil
        } catch {
            documentMessage = "Open failed: \(error.localizedDescription)"
        }
    }
    
    private func installKeyboardMonitor() {
        #if os(macOS)
        guard keyDownMonitor == nil else { return }
        
        keyDownMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
            let modifiers = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            let usesUndoModifier = modifiers.contains(.command) || modifiers.contains(.control)

            // Handled before the text-focus bail-out below: the code editor is
            // an NSTextView, so it would otherwise never see ⌃Z at all (AppKit
            // only wires ⌘Z natively), and ⌘Z would be stolen by the hidden
            // shortcut button and land on the design canvas.
            if usesUndoModifier && key == "z" && editorMode == .code {
                if performCodeEditorUndo(redo: modifiers.contains(.shift)) { return nil }
            }

            guard !isTextInputFocused else {
                return event
            }

            if usesUndoModifier && key == "z" {
                if modifiers.contains(.shift) {
                    redoForCurrentMode()
                } else {
                    undoForCurrentMode()
                }
                return nil
            }
            
            if usesUndoModifier && (key == "+" || key == "=") {
                zoomIn()
                return nil
            }
            
            if usesUndoModifier && key == "-" {
                zoomOut()
                return nil
            }
            
            if usesUndoModifier && key == "0" {
                resetZoom()
                return nil
            }
            
            if event.keyCode == 51 || event.keyCode == 117 {
                deleteForCurrentMode()
                return nil
            }
            
            return event
        }
        #endif
    }
    
    private func removeKeyboardMonitor() {
        #if os(macOS)
        if let keyDownMonitor {
            NSEvent.removeMonitor(keyDownMonitor)
            self.keyDownMonitor = nil
        }
        #endif
    }
    
    private var isTextInputFocused: Bool {
        #if os(macOS)
        guard let responder = NSApplication.shared.keyWindow?.firstResponder else {
            return false
        }
        
        return responder is NSTextView || responder is NSTextField
        #else
        return false
        #endif
    }
    
    private var topToolbar: some View {
        HStack(spacing: 4) {
            // Design ↔ Studio ↔ Logic ↔ PDF Editor mode toggle
            Picker("Mode", selection: $editorMode) {
                Label("Design", systemImage: "paintbrush").tag(EditorMode.design)
                Label("Studio", systemImage: "photo.artframe").tag(EditorMode.studio)
                Label("Logic", systemImage: "bolt").tag(EditorMode.logic)
                Label("Code", systemImage: "chevron.left.forwardslash.chevron.right").tag(EditorMode.code)
                Label("PDF Editor", systemImage: "doc.richtext").tag(EditorMode.pdf)
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 440)

            Divider().frame(height: 20)

            toolbarGroup {
                toolbarButton("Open", "folder") { openProject() }
                toolbarButton("Save", "square.and.arrow.down") { saveProject() }
                toolbarButton("Save As", "square.and.arrow.down.on.square") { saveProjectAs() }
                toolbarButton("Templates", "square.grid.2x2") { showTemplateGallery = true }
                toolbarButton("Web", "globe") { showWebPreview = true }

                // Git sync: checkpoints become commits; push publishes to GitHub.
                Menu {
                    if GitSyncService.isEnabled(projectName: viewModel.project.name) {
                        Button("Commit Now") { gitCommitNow() }
                        Button("Push to GitHub") { gitPush() }
                        Button("Open Repo in Finder") {
                            NSWorkspace.shared.activateFileViewerSelecting(
                                [GitSyncService.repoDirectory(projectName: viewModel.project.name)]
                            )
                        }
                        Divider()
                        Button("Disable Auto-Commit") {
                            GitSyncService.disable(projectName: viewModel.project.name)
                            documentMessage = "Git sync disabled — repo and history kept."
                        }
                    } else {
                        Button("Enable Git Sync") { gitEnable() }
                    }
                } label: {
                    VStack(spacing: 2) {
                        Image(systemName: "arrow.triangle.branch")
                            .font(.system(size: 14))
                        Text("Git")
                            .font(.system(size: 10))
                    }
                    .frame(width: 48, height: 48)
                }
                .menuStyle(.borderlessButton)
            }

            Divider().frame(height: 20)

            if editorMode == .pdf {
                pdfToolbarButtons
            } else {
                designToolbarButtons
            }

            Spacer()

            if editorMode != .pdf {
                zoomControls
            }

            Divider().frame(height: 20)

            Button {
                showMCPPanel = true
            } label: {
                HStack(spacing: 5) {
                    Circle()
                        .fill(mcpController.isRunning ? Color.green : Color.gray.opacity(0.6))
                        .frame(width: 7, height: 7)
                    Text("MCP")
                        .font(.system(size: 11, weight: .semibold))
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("MCP Server — let external agents (Claude Code, Claude Desktop) control the designer")

            Divider().frame(height: 20)

            if let documentMessage {
                Text(documentMessage)
                    .foregroundStyle(documentMessage.hasPrefix("Save failed") || documentMessage.hasPrefix("Open failed") ? Color.red : Color.secondary)
                    .font(.caption)
                    .lineLimit(1)
                    .frame(maxWidth: 220, alignment: .trailing)
            }

            Text(viewModel.project.name)
                .foregroundStyle(.secondary)
                .font(.caption)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay(alignment: .bottom) {
            Divider()
        }
    }
    
    // MARK: – Toolbar helpers

    @ViewBuilder
    private var designToolbarButtons: some View {
        // אלמנטים בסיסיים
        toolbarGroup {
            Menu {
                ForEach(DevicePresetLibrary.all) { preset in
                    Button {
                        viewModel.addDeviceFrame(preset)
                    } label: {
                        Text(preset.name)
                    }
                }
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: "iphone")
                        .font(.system(size: 14))
                    Text("Device")
                        .font(.system(size: 10))
                }
                .frame(width: 48, height: 48)
            }
            .menuStyle(.borderlessButton)

            toolbarButton("Text", "textformat")   { viewModel.addTextNode()    }
            toolbarButton("Button", "capsule")    { viewModel.addButtonNode()  }
            toolbarButton("Frame", "rectangle")   { viewModel.addFrameNode()   }

            // Brand: one colour that carries the product's identity across every
            // screen, and survives theme switches.
            Menu {
                ForEach(Self.brandSwatches, id: \.hex) { swatch in
                    Button("\(swatch.name)  \(swatch.hex)") {
                        CheckpointStore.save(viewModel.project, label: "before brand: \(swatch.name)")
                        BrandKit.apply(BrandIdentity(accent: swatch.hex, accentSecondary: nil, name: swatch.name), to: viewModel)
                    }
                }
                Divider()
                Button("Pick Custom Colour…") { pickBrandColor() }
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: "paintbrush.pointed")
                        .font(.system(size: 14))
                    Text("Brand")
                        .font(.system(size: 10))
                }
                .frame(width: 48, height: 48)
            }
            .menuStyle(.borderlessButton)

            // Live re-theme: reclassifies the canvas's colors into roles and
            // remaps them to the chosen preset (checkpointed, one-click undo).
            // The brand is re-stamped afterwards so identity is never lost.
            Menu {
                ForEach(VisualStylePreset.allCases, id: \.self) { preset in
                    Button(preset.rawValue) {
                        CheckpointStore.save(viewModel.project, label: "before theme: \(preset.rawValue)")
                        ThemeApplier.apply(preset, to: viewModel)
                        BrandKit.reapplyIfSet(to: viewModel)
                    }
                }
            } label: {
                VStack(spacing: 2) {
                    Image(systemName: "paintpalette")
                        .font(.system(size: 14))
                    Text("Theme")
                        .font(.system(size: 10))
                }
                .frame(width: 48, height: 48)
            }
            .menuStyle(.borderlessButton)
        }

        Divider().frame(height: 20)

        // מדיה
        toolbarGroup {
            toolbarButton("Image", "photo")       { viewModel.addImageNode()   }
            toolbarButton("Icon", "star.circle")  { viewModel.addIconNode()    }
        }

        Divider().frame(height: 20)

        // מחיקה
        toolbarButton("Delete", "trash") { viewModel.deleteSelectedNode() }
            .disabled(viewModel.selectedNodeId == nil)
            .foregroundStyle(viewModel.selectedNodeId == nil ? Color.secondary : Color.red)
    }

    @ViewBuilder
    private var pdfToolbarButtons: some View {
        toolbarGroup {
            toolbarButton("New", "doc.badge.plus") { pdfViewModel.newDocument() }

            toolbarButton("Prev", "chevron.left") {
                pdfViewModel.currentPageIndex = max(0, pdfViewModel.currentPageIndex - 1)
            }
            .disabled(pdfViewModel.currentPageIndex <= 0)

            Text("\(pdfViewModel.pageCount == 0 ? 0 : pdfViewModel.currentPageIndex + 1) / \(pdfViewModel.pageCount)")
                .font(.system(size: 11, design: .monospaced))
                .frame(minWidth: 44)

            toolbarButton("Next", "chevron.right") {
                pdfViewModel.currentPageIndex = min(pdfViewModel.pageCount - 1, pdfViewModel.currentPageIndex + 1)
            }
            .disabled(pdfViewModel.currentPageIndex >= pdfViewModel.pageCount - 1)
        }

        Divider().frame(height: 20)

        toolbarGroup {
            Text(pdfViewModel.toolMode.rawValue)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(pdfViewModel.toolMode == .select ? .secondary : Color.accentColor)
                .padding(.horizontal, 8)
            if pdfViewModel.toolMode != .select {
                Button("Done") { pdfViewModel.toolMode = .select }
                    .font(.system(size: 11))
                    .buttonStyle(.plain)
                    .foregroundStyle(.blue)
            }
        }
    }

    @ViewBuilder
    private func toolbarGroup<C: View>(@ViewBuilder content: () -> C) -> some View {
        HStack(spacing: 2) {
            content()
        }
    }
    
    private func toolbarButton(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: icon)
                    .font(.system(size: 14))
                Text(title)
                    .font(.system(size: 10))
            }
            .frame(width: 48, height: 40)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
    }
    
    private var zoomControls: some View {
        HStack(spacing: 6) {
            Button(action: zoomOut) {
                Image(systemName: "minus.magnifyingglass")
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .help("Zoom Out")
            .disabled(canvasZoom <= 0.25)
            
            Button(action: resetZoom) {
                Text("\(Int((canvasZoom * 100).rounded()))%")
                    .font(.system(size: 12, weight: .medium, design: .monospaced))
                    .frame(width: 54, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Reset Zoom")
            
            Button(action: zoomIn) {
                Image(systemName: "plus.magnifyingglass")
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(.plain)
            .help("Zoom In")
            .disabled(canvasZoom >= 3.0)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
    
    private func zoomIn() {
        setZoom(canvasZoom * 1.2)
    }
    
    private func zoomOut() {
        setZoom(canvasZoom / 1.2)
    }
    
    private func resetZoom() {
        setZoom(1.0)
    }
    
    private func setZoom(_ value: CGFloat) {
        canvasZoom = min(max(value, 0.25), 3.0)
    }
}
