//
//  CodeModeView.swift
//  AgenticDesigner
//
//  Code Mode — the anti-black-box panel. Shows the exact Swift the exporter
//  will produce for the current design + logic, live — and lets you EDIT it:
//  an edited file is stored as a source override (project.sourceOverrides),
//  wins over generation in every export path, and Recompile runs the real
//  iOS-simulator swiftc over the whole generated tree to prove it still builds.
//

import SwiftUI
import AppKit
import Combine

struct CodeModeView: View {
    @ObservedObject var viewModel: ProjectViewModel
    @ObservedObject var logicViewModel: LogicViewModel

    @State private var files: [GeneratedSourceFile] = []
    @State private var selectedFileId: String?
    @State private var lastSelectedFileId: String?
    @State private var errorMessage: String?
    @State private var isGenerating = false
    @State private var lastGenerated: Date?
    @State private var pendingRefresh: Task<Void, Never>?

    // Editing
    @State private var dirtyText: String?
    @State private var resetToken = UUID()

    // Recompile
    @State private var diagnostics: [CodeDiagnostic] = []
    @State private var buildStatus: String?
    @State private var buildSucceeded = false
    @State private var isCompiling = false
    @State private var jumpToken: UUID?
    @State private var jumpLine = 0

    private var selectedFile: GeneratedSourceFile? {
        files.first { $0.id == selectedFileId } ?? files.first
    }

    private var groupedFiles: [(directory: String, files: [GeneratedSourceFile])] {
        let groups = Dictionary(grouping: files, by: \.directory)
        return groups.keys.sorted { a, b in
            let aSwift = groups[a]!.contains { $0.fileName.hasSuffix(".swift") }
            let bSwift = groups[b]!.contains { $0.fileName.hasSuffix(".swift") }
            if aSwift != bSwift { return aSwift }
            return a < b
        }.map { ($0, groups[$0]!) }
    }

    var body: some View {
        HSplitView {
            fileList
                .frame(minWidth: 220, idealWidth: 260, maxWidth: 340)
            codePane
                .frame(minWidth: 400, maxWidth: .infinity, maxHeight: .infinity)
        }
        .onAppear { regenerate() }
        // Any design/logic mutation (agent, inspector, MCP) re-renders this view;
        // debounce so a burst of edits becomes one regeneration.
        .onReceive(viewModel.objectWillChange) { _ in scheduleRefresh() }
        .onReceive(logicViewModel.objectWillChange) { _ in scheduleRefresh() }
        .onChange(of: selectedFileId) { newId in
            // Leaving a file with an unsaved edit auto-applies it — a hand edit
            // must never silently evaporate on a sidebar click.
            if let dirtyText,
               let previous = files.first(where: { $0.id == lastSelectedFileId }),
               previous.id != newId {
                saveOverride(fileName: previous.fileName, content: dirtyText)
            }
            dirtyText = nil
            lastSelectedFileId = newId
        }
    }

    // MARK: - File list

    private var fileList: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Generated Source")
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
                if isGenerating {
                    ProgressView().controlSize(.small)
                } else {
                    Button {
                        regenerate()
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .buttonStyle(.borderless)
                    .help("Regenerate from the current design")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)

            Divider()

            List(selection: $selectedFileId) {
                ForEach(groupedFiles, id: \.directory) { group in
                    Section(group.directory) {
                        ForEach(group.files) { file in
                            HStack(spacing: 6) {
                                Image(systemName: iconName(for: file))
                                    .foregroundStyle(file.fileName.hasSuffix(".swift") ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
                                    .font(.system(size: 11))
                                Text(file.fileName)
                                    .font(.system(size: 12))
                                    .lineLimit(1)
                                if file.isOverridden {
                                    Circle()
                                        .fill(.orange)
                                        .frame(width: 5, height: 5)
                                        .help("Hand-edited — overrides generation")
                                }
                                Spacer()
                                Text("\(file.lineCount)")
                                    .font(.system(size: 10))
                                    .foregroundStyle(.tertiary)
                            }
                            .tag(file.id)
                        }
                    }
                }
            }
            .listStyle(.sidebar)

            Divider()

            HStack {
                Text(footerText)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
        }
    }

    private var footerText: String {
        if let errorMessage { return errorMessage }
        guard let lastGenerated else { return "Generating…" }
        let formatter = DateFormatter()
        formatter.timeStyle = .medium
        formatter.dateStyle = .none
        let total = files.reduce(0) { $0 + $1.lineCount }
        let edited = files.filter(\.isOverridden).count
        let editedNote = edited > 0 ? " · \(edited) edited" : ""
        return "\(files.count) files · \(total) lines\(editedNote) · \(formatter.string(from: lastGenerated))"
    }

    private func iconName(for file: GeneratedSourceFile) -> String {
        switch (file.fileName as NSString).pathExtension.lowercased() {
        case "swift": return "swift"
        case "plist", "entitlements", "xcprivacy": return "doc.badge.gearshape"
        case "storekit", "json": return "curlybraces"
        case "rules": return "lock.shield"
        default: return "doc.text"
        }
    }

    // MARK: - Code pane

    private var codePane: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if !diagnostics.isEmpty || buildStatus != nil {
                diagnosticsStrip
                Divider()
            }
            editor
        }
    }

    private var header: some View {
        HStack(spacing: 8) {
            Text(selectedFile?.relativePath ?? "No file")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(Color(nsColor: CodeTheme.plainText).opacity(0.7))
                .lineLimit(1)
                .truncationMode(.head)
            if selectedFile?.isOverridden == true {
                Text("EDITED")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(Capsule().stroke(.orange.opacity(0.6), lineWidth: 1))
            }
            Spacer()

            if dirtyText != nil {
                Button("Apply Edit") { applyCurrentEdit() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .keyboardShortcut(.return, modifiers: .command)
                    .help("Save this edit as a source override (⌘↩). Exports and simulator runs will use it.")
                Button("Discard") {
                    dirtyText = nil
                    resetToken = UUID()
                }
                .controlSize(.small)
            } else if selectedFile?.isOverridden == true {
                Button("Revert to Generated") { revertCurrentOverride() }
                    .controlSize(.small)
                    .help("Delete the hand-edit and go back to pure generation")
            }

            Button {
                recompile()
            } label: {
                if isCompiling {
                    HStack(spacing: 4) {
                        ProgressView().controlSize(.small)
                        Text("Compiling…").font(.system(size: 11))
                    }
                } else {
                    Label("Recompile", systemImage: "hammer")
                        .font(.system(size: 11))
                        .foregroundStyle(Color(nsColor: CodeTheme.plainText).opacity(0.85))
                }
            }
            .buttonStyle(.borderless)
            .disabled(isCompiling)
            .help("Typecheck the whole generated project (including your edits) with the real iOS compiler")

            Button {
                if let content = dirtyText ?? selectedFile?.content {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(content, forType: .string)
                }
            } label: {
                Label("Copy", systemImage: "doc.on.doc")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(nsColor: CodeTheme.plainText).opacity(0.85))
            }
            .buttonStyle(.borderless)
            .disabled(selectedFile == nil)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color(nsColor: CodeTheme.gutterBackground))
    }

    private var diagnosticsStrip: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                if let buildStatus {
                    Label(buildStatus, systemImage: buildSucceeded ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(buildSucceeded ? .green : .red)
                }
                Spacer()
                Button {
                    diagnostics = []
                    buildStatus = nil
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9))
                }
                .buttonStyle(.borderless)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)

            if !diagnostics.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(diagnostics) { diagnostic in
                            Button {
                                jump(to: diagnostic)
                            } label: {
                                HStack(spacing: 6) {
                                    Image(systemName: diagnostic.severity == "error" ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                                        .foregroundStyle(diagnostic.severity == "error" ? .red : .yellow)
                                        .font(.system(size: 10))
                                    Text("\(diagnostic.fileName):\(diagnostic.line)")
                                        .font(.system(size: 11, design: .monospaced))
                                        .foregroundStyle(Color(nsColor: CodeTheme.plainText).opacity(0.9))
                                    Text(diagnostic.message)
                                        .font(.system(size: 11))
                                        .foregroundStyle(Color(nsColor: CodeTheme.plainText).opacity(0.65))
                                        .lineLimit(1)
                                    Spacer(minLength: 0)
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 6)
                }
                .frame(maxHeight: 110)
            }
        }
        .background(Color(nsColor: CodeTheme.gutterBackground))
    }

    @ViewBuilder
    private var editor: some View {
        if let file = selectedFile {
            CodeTextView(
                fileId: file.id,
                text: SwiftCodeHighlighter.attributedCode(
                    file.content,
                    isSwift: file.fileName.hasSuffix(".swift"),
                    cacheKey: file.relativePath
                ),
                isEditable: file.fileName.hasSuffix(".swift"),
                resetToken: resetToken,
                jumpToken: jumpToken,
                jumpLine: jumpLine,
                onTextChange: { newText in
                    dirtyText = (newText == file.content) ? nil : newText
                }
            )
        } else {
            VStack(spacing: 10) {
                if let errorMessage {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 28))
                        .foregroundStyle(.orange)
                    Text(errorMessage)
                        .font(.system(size: 12))
                        .foregroundStyle(Color(nsColor: CodeTheme.plainText).opacity(0.7))
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 420)
                } else {
                    ProgressView()
                    Text("Generating source from the current design…")
                        .font(.system(size: 12))
                        .foregroundStyle(Color(nsColor: CodeTheme.plainText).opacity(0.7))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(nsColor: CodeTheme.background))
        }
    }

    // MARK: - Editing

    private func applyCurrentEdit() {
        guard let file = selectedFile, let dirtyText else { return }
        saveOverride(fileName: file.fileName, content: dirtyText)
        self.dirtyText = nil
    }

    private func saveOverride(fileName: String, content: String) {
        CheckpointStore.save(viewModel.project, label: "before code edit: \(fileName)")
        var overrides = viewModel.project.sourceOverrides ?? [:]
        overrides[fileName] = content
        viewModel.project.sourceOverrides = overrides
    }

    private func revertCurrentOverride() {
        guard let file = selectedFile else { return }
        CheckpointStore.save(viewModel.project, label: "before code revert: \(file.fileName)")
        viewModel.project.sourceOverrides?[file.fileName] = nil
        if viewModel.project.sourceOverrides?.isEmpty == true {
            viewModel.project.sourceOverrides = nil
        }
        dirtyText = nil
        resetToken = UUID()
    }

    // MARK: - Recompile

    private func recompile() {
        guard !isCompiling else { return }
        // What compiles must be what you see: pending edit is applied first.
        applyCurrentEdit()
        isCompiling = true
        buildStatus = nil
        diagnostics = []

        let project = viewModel.project
        let combined = logicViewModel.flows + project.pages.flatMap(\.logicFlows)
        var seen: Set<UUID> = []
        let flows = combined.filter { seen.insert($0.id).inserted }
        let pageIndex = viewModel.currentPageIndex
        let pageId = project.pages.indices.contains(pageIndex) ? project.pages[pageIndex].id : nil

        // swiftc takes seconds — keep it off the UI thread.
        Task.detached(priority: .userInitiated) {
            var status: String
            var succeeded = false
            var found: [CodeDiagnostic] = []
            do {
                let result = try GeneratedSourcePreview.typecheck(
                    project: project, flows: flows, currentPageId: pageId
                )
                succeeded = result.success
                found = result.diagnostics
                let errors = result.diagnostics.filter { $0.severity == "error" }.count
                let warnings = result.diagnostics.filter { $0.severity == "warning" }.count
                status = succeeded
                    ? "Build OK — \(result.checkedFileCount) files typechecked\(warnings > 0 ? ", \(warnings) warning(s)" : "")"
                    : "\(errors) error(s), \(warnings) warning(s)"
            } catch {
                status = "Compile failed: \(error.localizedDescription)"
            }
            await MainActor.run {
                buildStatus = status
                buildSucceeded = succeeded
                diagnostics = found
                isCompiling = false
            }
        }
    }

    private func jump(to diagnostic: CodeDiagnostic) {
        if let target = files.first(where: { $0.fileName == diagnostic.fileName }) {
            selectedFileId = target.id
        }
        jumpLine = diagnostic.line
        jumpToken = UUID()
    }

    // MARK: - Generation

    private func scheduleRefresh() {
        pendingRefresh?.cancel()
        pendingRefresh = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 800_000_000)
            guard !Task.isCancelled else { return }
            regenerate()
        }
    }

    private func regenerate() {
        guard !isGenerating else { scheduleRefresh(); return }
        isGenerating = true
        // No attach() here — it publishes and would loop the refresh. Mode
        // switching already persists Logic-mode edits into the project; combine
        // live flows with every page's flows (live first, so unsaved edits win).
        let project = viewModel.project
        let combined = logicViewModel.flows + project.pages.flatMap(\.logicFlows)
        var seen: Set<UUID> = []
        let flows = combined.filter { seen.insert($0.id).inserted }
        let pageIndex = viewModel.currentPageIndex
        let pageId = project.pages.indices.contains(pageIndex) ? project.pages[pageIndex].id : nil
        let pageName = project.pages.indices.contains(pageIndex) ? project.pages[pageIndex].name : ""
        let previousSelection = selectedFileId

        Task { @MainActor in
            do {
                let generated = try GeneratedSourcePreview.generate(
                    project: project, flows: flows, currentPageId: pageId
                )
                files = generated
                errorMessage = nil
                lastGenerated = Date()
                isGenerating = false
                if let previousSelection, generated.contains(where: { $0.id == previousSelection }) {
                    selectedFileId = previousSelection
                } else {
                    selectedFileId = GeneratedSourcePreview
                        .defaultSelection(in: generated, pageName: pageName)?.id
                }
                if lastSelectedFileId == nil { lastSelectedFileId = selectedFileId }
            } catch {
                errorMessage = "Generation failed: \(error.localizedDescription)"
                isGenerating = false
            }
        }
    }
}
