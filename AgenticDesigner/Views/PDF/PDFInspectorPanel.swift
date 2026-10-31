//
//  PDFInspectorPanel.swift
//  AgenticDesigner
//
//  Right panel in PDF Editor mode: tool picker, selected-annotation
//  properties (color, text, font), and document metadata.
//

import SwiftUI
import PDFKit
import AppKit
import Combine

struct PDFInspectorPanel: View {
    @ObservedObject var viewModel: PDFEditorViewModel
    @ObservedObject private var translator: LocalModelTranslator

    init(viewModel: PDFEditorViewModel) {
        self.viewModel = viewModel
        self.translator = viewModel.translator
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                toolSection
                Divider()
                if let annotation = viewModel.selectedAnnotation {
                    annotationSection(annotation)
                    Divider()
                }
                metadataSection
                Divider()
                documentSection
            }
            .padding(12)
        }
    }

    // MARK: - Tools

    private var toolSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("Tool")
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 68))], spacing: 6) {
                ForEach(PDFToolMode.allCases) { mode in
                    toolButton(mode)
                }
            }

            if viewModel.toolMode != .select {
                Text(hint(for: viewModel.toolMode))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if needsStyleControls(viewModel.toolMode) {
                styleControls
            }

            if viewModel.toolMode == .translate {
                translateControls
            }
        }
    }

    // MARK: - Local translation settings

    private var translateControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("LOCAL MODEL")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)
                Spacer()
                if translator.isTranslating {
                    ProgressView().controlSize(.small)
                }
                Button {
                    Task { await translator.refreshModels() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10))
                }
                .buttonStyle(.plain)
                .help("Refresh the model list from the local server")
            }

            if translator.availableModels.isEmpty {
                Text(translator.lastError ?? "No models found — is Ollama running?")
                    .font(.caption2)
                    .foregroundStyle(.orange)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Picker("Model", selection: $translator.selectedModel) {
                    ForEach(translator.availableModels, id: \.self) { model in
                        Text(model).tag(model)
                    }
                }
                .font(.caption)
            }

            Picker("Translate to", selection: $translator.targetLanguage) {
                ForEach(LocalModelTranslator.commonLanguages, id: \.self) { language in
                    Text(language).tag(language)
                }
            }
            .font(.caption)

            if translator.selectedModel == LocalModelTranslator.helsinkiModel {
                Text("English → Hebrew · local Hugging Face Transformers")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if translator.targetLanguage != "Hebrew" {
                    Text("This model only supports Hebrew output.")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }

            if translator.selectedModel != LocalModelTranslator.helsinkiModel {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Server").font(.caption2).foregroundStyle(.secondary)
                    TextField("http://127.0.0.1:11434", text: $translator.endpoint)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption)
                }
            }
        }
        .padding(.top, 4)
        .task {
            if translator.availableModels.isEmpty {
                await translator.refreshModels()
            }
        }
    }

    private func toolButton(_ mode: PDFToolMode) -> some View {
        Button {
            viewModel.toolMode = mode
        } label: {
            VStack(spacing: 4) {
                Image(systemName: mode.icon)
                    .font(.system(size: 14))
                Text(mode.rawValue)
                    .font(.system(size: 9))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(width: 64, height: 44)
            .background(viewModel.toolMode == mode ? Color.accentColor.opacity(0.18) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    private func needsStyleControls(_ mode: PDFToolMode) -> Bool {
        switch mode {
        case .shapeRect, .shapeCircle, .shapeLine, .draw, .highlight, .underline, .strikeOut, .freeText, .editText:
            return true
        default:
            return false
        }
    }

    private var styleControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            ColorPicker("Color", selection: Binding(
                get: { Color(nsColor: viewModel.annotationStyle.color) },
                set: { viewModel.annotationStyle.color = NSColor($0) }
            ))
            .font(.caption)

            if viewModel.toolMode == .freeText || viewModel.toolMode == .editText {
                ColorPicker("Text Color", selection: Binding(
                    get: { Color(nsColor: viewModel.annotationStyle.textColor) },
                    set: { viewModel.annotationStyle.textColor = NSColor($0) }
                ))
                .font(.caption)

                Stepper("Font Size: \(Int(viewModel.annotationStyle.fontSize))", value: $viewModel.annotationStyle.fontSize, in: 6...96)
                    .font(.caption)
            } else {
                Stepper("Stroke: \(Int(viewModel.annotationStyle.strokeWidth))pt", value: $viewModel.annotationStyle.strokeWidth, in: 1...20)
                    .font(.caption)
            }
        }
        .padding(.top, 4)
    }

    private func hint(for mode: PDFToolMode) -> String {
        switch mode {
        case .editText: return "Click a paragraph to rewrite it, or drag a box over a region."
        case .translate: return "Click a paragraph to translate it with your local model."
        case .replaceImage: return "Drag a box over an image, then choose a replacement."
        case .draw, .signature: return "Drag to draw freehand."
        case .comment: return "Click to drop a comment."
        case .crop: return "Drag a box to crop the page to."
        default: return "Drag to place on the page."
        }
    }

    // MARK: - Selected annotation

    private func annotationSection(_ annotation: PDFAnnotation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("Selected: \(annotationTypeName(annotation))")

            if annotation.widgetFieldType == .text || annotation.type == "FreeText" {
                TextField("Contents", text: Binding(
                    get: { annotation.contents ?? "" },
                    set: { annotation.contents = $0; viewModel.objectWillChange.send() }
                ))
                .textFieldStyle(.roundedBorder)
                .font(.caption)
            }

            HStack {
                Text("X").font(.caption2).foregroundStyle(.secondary)
                numberField(annotation.bounds.origin.x) { newValue in
                    var b = annotation.bounds; b.origin.x = newValue
                    viewModel.moveAnnotation(annotation, to: b)
                }
                Text("Y").font(.caption2).foregroundStyle(.secondary)
                numberField(annotation.bounds.origin.y) { newValue in
                    var b = annotation.bounds; b.origin.y = newValue
                    viewModel.moveAnnotation(annotation, to: b)
                }
            }
            HStack {
                Text("W").font(.caption2).foregroundStyle(.secondary)
                numberField(annotation.bounds.width) { newValue in
                    var b = annotation.bounds; b.size.width = max(4, newValue)
                    viewModel.moveAnnotation(annotation, to: b)
                }
                Text("H").font(.caption2).foregroundStyle(.secondary)
                numberField(annotation.bounds.height) { newValue in
                    var b = annotation.bounds; b.size.height = max(4, newValue)
                    viewModel.moveAnnotation(annotation, to: b)
                }
            }

            Button(role: .destructive) {
                viewModel.removeAnnotation(annotation)
            } label: {
                Label("Delete", systemImage: "trash")
                    .font(.caption)
            }
        }
    }

    private func numberField(_ value: CGFloat, onChange: @escaping (CGFloat) -> Void) -> some View {
        let doubleBinding = Binding<Double>(
            get: { Double(value) },
            set: { onChange(CGFloat($0)) }
        )
        return TextField("", value: doubleBinding, format: .number.precision(.fractionLength(0)))
            .textFieldStyle(.roundedBorder)
            .font(.caption.monospacedDigit())
            .frame(width: 48)
    }

    private func annotationTypeName(_ annotation: PDFAnnotation) -> String {
        if annotation is PDFImageStampAnnotation { return "Image" }
        if annotation.widgetFieldType == .text { return "Text Field" }
        if annotation.widgetFieldType == .button { return "Checkbox" }
        return annotation.type ?? "Annotation"
    }

    // MARK: - Metadata

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionLabel("Metadata")
            labeledField("Title", $viewModel.metadata.title)
            labeledField("Author", $viewModel.metadata.author)
            labeledField("Subject", $viewModel.metadata.subject)
            labeledField("Keywords", $viewModel.metadata.keywords)
        }
    }

    private func labeledField(_ label: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            TextField(label, text: text)
                .textFieldStyle(.roundedBorder)
                .font(.caption)
        }
    }

    // MARK: - Document info

    private var documentSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("Document")
            if let page = viewModel.currentPage {
                let bounds = page.bounds(for: .mediaBox)
                infoRow("Page Size", "\(Int(bounds.width)) × \(Int(bounds.height)) pt")
                infoRow("Rotation", "\(page.rotation)°")
                infoRow("Annotations", "\(page.annotations.count)")
            }
            infoRow("Pages", "\(viewModel.pageCount)")
            if let url = viewModel.fileURL {
                infoRow("File", url.lastPathComponent)
            }
        }
    }

    private func infoRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.caption2)
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
    }
}
