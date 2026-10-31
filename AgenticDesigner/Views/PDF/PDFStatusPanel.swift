//
//  PDFStatusPanel.swift
//  AgenticDesigner
//
//  Bottom-right panel in PDF Editor mode — occupies the space the AI Agent
//  panel uses in Design/Logic mode. Shows document status and quick actions
//  (flatten + export, undo/redo) since there's no design-agent equivalent
//  for PDF editing.
//

import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct PDFStatusPanel: View {
    @ObservedObject var viewModel: PDFEditorViewModel
    @State private var showTranslateSheet = false
    @State private var fromPageText = ""
    @State private var toPageText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: "doc.richtext")
                    .foregroundStyle(.secondary)
                Text("PDF Editor")
                    .font(.headline)
                Spacer()
            }

            if let message = viewModel.statusMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }

            HStack(spacing: 8) {
                Button {
                    viewModel.undo()
                } label: {
                    Image(systemName: "arrow.uturn.backward")
                }
                Button {
                    viewModel.redo()
                } label: {
                    Image(systemName: "arrow.uturn.forward")
                }
                Spacer()
                if viewModel.isDirty {
                    Circle().fill(Color.orange).frame(width: 6, height: 6)
                    Text("Unsaved").font(.caption2).foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.small)

            Divider()

            if let progress = viewModel.batchProgress {
                HStack(spacing: 6) {
                    if viewModel.isBatchTranslating {
                        ProgressView().controlSize(.small)
                    }
                    Text(progress)
                        .font(.caption2)
                        .lineLimit(2)
                    Spacer()
                    if viewModel.isBatchTranslating {
                        Button("Cancel") { viewModel.cancelBatchTranslation() }
                            .controlSize(.small)
                    }
                }
            } else {
                Button {
                    fromPageText = "\(viewModel.currentPageIndex + 1)"
                    toPageText = "\(min(viewModel.pageCount, viewModel.currentPageIndex + 5))"
                    showTranslateSheet = true
                } label: {
                    Label("Translate Pages…", systemImage: "globe")
                        .frame(maxWidth: .infinity)
                }
                .disabled(viewModel.document == nil)
                .help("Translate every prose paragraph in a page range with your local model — figures, labels and equations stay untouched.")
            }

            Divider()

            VStack(alignment: .leading, spacing: 6) {
                Text("GOOGLE TRANSLATION")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary)

                if let progress = viewModel.externalPDFTranslationProgress {
                    HStack(spacing: 6) {
                        if viewModel.isExternalPDFTranslationRunning {
                            ProgressView().controlSize(.small)
                        }
                        Text(progress)
                            .font(.caption2)
                            .lineLimit(2)
                        Spacer()
                        if viewModel.isExternalPDFTranslationRunning {
                            Button("Cancel") { viewModel.cancelGooglePDFTranslation() }
                                .controlSize(.small)
                        }
                    }
                }

                Button {
                    viewModel.runGooglePDFTranslation()
                } label: {
                    Label("Translate Full PDF…", systemImage: "globe")
                        .frame(maxWidth: .infinity)
                }
                .disabled(viewModel.document == nil || viewModel.isExternalPDFTranslationRunning)
                .help("Uses the Google translation pipeline and creates a readable Hebrew PDF next to the opened file.")
            }

            Button {
                exportFlattened()
            } label: {
                Label("Flatten & Export…", systemImage: "square.and.arrow.up.on.square")
                    .frame(maxWidth: .infinity)
            }
            .help("Bakes every edit into the page pixels and saves a copy — use this to share a PDF that looks right in any viewer.")

            Spacer()
        }
        .padding(12)
        .sheet(isPresented: $showTranslateSheet) {
            translateSheet
        }
    }

    private var translateSheet: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label("Translate Pages", systemImage: "globe")
                .font(.headline)
            Text("Every prose paragraph is translated to \(viewModel.translator.targetLanguage) with \(viewModel.translator.selectedModel) (local, 3 in parallel). Figures, labels and equations are left in place. Change language/model in the Translate tool settings.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 10) {
                Text("From page")
                TextField("1", text: $fromPageText)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 56)
                Text("to")
                TextField("\(viewModel.pageCount)", text: $toPageText)
                    .textFieldStyle(.roundedBorder)
                    .frame(width: 56)
                Text("of \(viewModel.pageCount)")
                    .foregroundStyle(.secondary)
            }
            .font(.callout)

            HStack {
                Spacer()
                Button("Cancel") { showTranslateSheet = false }
                Button("Translate") {
                    let from = (Int(fromPageText) ?? 1) - 1
                    let to = (Int(toPageText) ?? viewModel.pageCount) - 1
                    showTranslateSheet = false
                    viewModel.translatePages(from: from, to: to)
                }
                .keyboardShortcut(.defaultAction)
                .disabled(Int(fromPageText) == nil || Int(toPageText) == nil)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func exportFlattened() {
        let panel = NSSavePanel()
        panel.title = "Export Flattened PDF"
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = (viewModel.fileURL?.deletingPathExtension().lastPathComponent ?? "Untitled") + "-flattened.pdf"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let destination = url.pathExtension.lowercased() == "pdf" ? url : url.appendingPathExtension("pdf")
        viewModel.exportFlattened(to: destination)
    }
}
