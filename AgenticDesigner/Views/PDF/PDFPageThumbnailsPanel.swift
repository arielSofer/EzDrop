//
//  PDFPageThumbnailsPanel.swift
//  AgenticDesigner
//
//  Left panel in PDF Editor mode: page thumbnails with add/remove/duplicate/
//  rotate/reorder (drag to reorder) — the page-management surface of the
//  PDF Editor goal.
//

import SwiftUI
import PDFKit
import AppKit
import UniformTypeIdentifiers

struct PDFPageThumbnailsPanel: View {
    @ObservedObject var viewModel: PDFEditorViewModel
    @State private var draggingIndex: Int?

    var body: some View {
        VStack(spacing: 0) {
            header

            Divider()

            ScrollView {
                LazyVStack(spacing: 10) {
                    ForEach(viewModel.pages) { summary in
                        thumbnail(for: summary)
                            .onDrag {
                                draggingIndex = summary.id
                                return NSItemProvider(object: String(summary.id) as NSString)
                            }
                            .onDrop(of: [.text], delegate: PageDropDelegate(
                                targetIndex: summary.id,
                                draggingIndex: $draggingIndex,
                                onDrop: { from, to in viewModel.reorderPage(from: from, to: to) }
                            ))
                    }
                }
                .padding(10)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        HStack {
            Text("Pages")
                .font(.headline)
            Spacer()
            Text("\(viewModel.pageCount)")
                .font(.caption)
                .foregroundStyle(.secondary)
            Button {
                viewModel.addPage(after: viewModel.currentPageIndex)
            } label: {
                Image(systemName: "plus.rectangle")
            }
            .buttonStyle(.plain)
            .help("Add page after the current one")
        }
        .padding(12)
    }

    private func thumbnail(for summary: PDFPageSummary) -> some View {
        let isSelected = summary.id == viewModel.currentPageIndex
        let page = viewModel.document?.page(at: summary.id)

        return VStack(spacing: 6) {
            ZStack(alignment: .topLeading) {
                if let page {
                    PDFPageThumbnailImage(page: page)
                        .aspectRatio(aspectRatio(for: summary), contentMode: .fit)
                        .background(Color.white)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4)
                                .stroke(isSelected ? Color.accentColor : Color.secondary.opacity(0.3), lineWidth: isSelected ? 2 : 1)
                        )
                }
                Text("\(summary.id + 1)")
                    .font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(.black.opacity(0.6))
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
                    .padding(4)
            }
            .contentShape(Rectangle())
            .onTapGesture { viewModel.currentPageIndex = summary.id }
            .contextMenu { contextMenu(for: summary.id) }

            HStack(spacing: 8) {
                iconButton("rotate.left") { viewModel.rotatePage(at: summary.id, by: -90) }
                iconButton("rotate.right") { viewModel.rotatePage(at: summary.id, by: 90) }
                iconButton("plus.square.on.square") { viewModel.duplicatePage(at: summary.id) }
                iconButton("trash", tint: .red) { viewModel.removePage(at: summary.id) }
                    .disabled(viewModel.pageCount <= 1)
            }
        }
        .padding(6)
        .background(isSelected ? Color.accentColor.opacity(0.08) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func aspectRatio(for summary: PDFPageSummary) -> CGFloat {
        let rotated = summary.rotation % 180 != 0
        let size = rotated ? CGSize(width: summary.size.height, height: summary.size.width) : summary.size
        guard size.height > 0 else { return 0.77 }
        return size.width / size.height
    }

    private func iconButton(_ systemImage: String, tint: Color = .primary, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 11))
                .foregroundStyle(tint)
                .frame(width: 20, height: 20)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func contextMenu(for index: Int) -> some View {
        Button("Duplicate Page") { viewModel.duplicatePage(at: index) }
        Button("Rotate Left") { viewModel.rotatePage(at: index, by: -90) }
        Button("Rotate Right") { viewModel.rotatePage(at: index, by: 90) }
        Divider()
        Button("Add Page After") { viewModel.addPage(after: index) }
        Divider()
        Button("Delete Page", role: .destructive) { viewModel.removePage(at: index) }
            .disabled(viewModel.pageCount <= 1)
    }
}

private struct PageDropDelegate: DropDelegate {
    let targetIndex: Int
    @Binding var draggingIndex: Int?
    let onDrop: (Int, Int) -> Void

    func performDrop(info: DropInfo) -> Bool {
        guard let source = draggingIndex else { return false }
        defer { draggingIndex = nil }
        let destination = source < targetIndex ? targetIndex + 1 : targetIndex
        onDrop(source, destination)
        return true
    }

    func dropEntered(info: DropInfo) {}
}

// Renders one PDFPage into an Image via PDFKit's thumbnail API — cheap
// enough to call per-row since PDFKit caches internally.
private struct PDFPageThumbnailImage: View {
    let page: PDFPage

    var body: some View {
        let size = thumbnailSize(for: page)
        let nsImage = page.thumbnail(of: size, for: .mediaBox)
        Image(nsImage: nsImage)
            .resizable()
    }

    private func thumbnailSize(for page: PDFPage) -> CGSize {
        let bounds = page.bounds(for: .mediaBox)
        let maxDimension: CGFloat = 200
        guard bounds.width > 0, bounds.height > 0 else { return CGSize(width: maxDimension, height: maxDimension * 1.3) }
        let scale = maxDimension / max(bounds.width, bounds.height)
        return CGSize(width: bounds.width * scale, height: bounds.height * scale)
    }
}
