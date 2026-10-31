//
//  TemplateGalleryView.swift
//  AgenticDesigner
//
//  "Start from a template" — the instant-gratification entry point. Cards
//  show live-rendered thumbnails (each template is briefly instantiated on a
//  scratch view model and snapshotted, so previews always match reality).
//

import SwiftUI
import AppKit

struct TemplateGalleryView: View {
    @ObservedObject var viewModel: ProjectViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var thumbnails: [String: NSImage] = [:]
    @State private var applyingId: String?

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: 16)]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Start from a Template")
                    .font(.title2.bold())
                Spacer()
                Button("Close") { dismiss() }
            }

            Text("Instant multi-screen starters built from the component library — customize with the canvas or the agent afterwards.")
                .font(.callout)
                .foregroundStyle(.secondary)

            ScrollView {
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(TemplateFactory.all) { template in
                        templateCard(template)
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .padding(20)
        .frame(width: 780, height: 560)
        .task { renderThumbnails() }
    }

    private func templateCard(_ template: AppTemplate) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(nsColor: .quaternarySystemFill))
                if let thumb = thumbnails[template.id] {
                    Image(nsImage: thumb)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                } else {
                    ProgressView()
                }
            }
            .frame(height: 150)

            Text(template.name).font(.headline)
            Text("\(template.subtitle) · \(template.screens.count) screens")
                .font(.caption)
                .foregroundStyle(.secondary)

            Button {
                apply(template)
            } label: {
                if applyingId == template.id {
                    Text("Creating…").frame(maxWidth: .infinity)
                } else {
                    Text("Use Template").frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(applyingId != nil)
        }
        .padding(10)
        .background(RoundedRectangle(cornerRadius: 12).fill(Color(nsColor: .windowBackgroundColor)))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color(nsColor: .separatorColor)))
    }

    private func apply(_ template: AppTemplate) {
        applyingId = template.id
        defer { applyingId = nil }
        CheckpointStore.save(viewModel.project, label: "before template: \(template.name)")
        // Templates replace the page — a starter on top of leftover content
        // (like the default sample screen) reads as a bug.
        viewModel.project.pages[viewModel.currentPageIndex].nodes = []
        viewModel.project.pages[viewModel.currentPageIndex].logicFlows = []
        if let actions = try? TemplateFactory.actions(for: template) {
            _ = viewModel.applyDesignActions(actions)
            dismiss()
        }
    }

    // Thumbnails: instantiate each template on a scratch view model and
    // snapshot the produced nodes — previews can never drift from reality.
    private func renderThumbnails() {
        for template in TemplateFactory.all where thumbnails[template.id] == nil {
            let scratch = ProjectViewModel()
            guard let actions = try? TemplateFactory.actions(for: template) else { continue }
            _ = scratch.applyDesignActions(actions)
            let nodes = scratch.project.pages[scratch.currentPageIndex].nodes
            if let dataURL = CanvasSnapshotRenderer.jpegDataURL(for: nodes, maxDimension: 640),
               let comma = dataURL.firstIndex(of: ","),
               let data = Data(base64Encoded: String(dataURL[dataURL.index(after: comma)...])),
               let image = NSImage(data: data) {
                thumbnails[template.id] = image
            }
        }
    }
}
