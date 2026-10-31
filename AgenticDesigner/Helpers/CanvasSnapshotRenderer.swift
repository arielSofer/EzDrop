//
//  CanvasSnapshotRenderer.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 05/07/2026.
//

import SwiftUI
import AppKit
import CoreGraphics

// מרנדר את הקנבס לתמונה עבור ה-Vision Critic —
// כך הסוכן שופט את התוצאה המרונדרת בפועל ולא רק קואורדינטות JSON.
@MainActor
enum CanvasSnapshotRenderer {

    // Renders the given root nodes to a JPEG data URL suitable for a
    // multimodal chat message. Returns nil when there is nothing to render.
    // maxDimension 900 + 0.45 JPEG quality keeps the base64 payload small.
    // Some providers (xAI/Grok via OpenRouter) bill a data: URL by its byte
    // length, so a 1400px 0.8-quality shot became ~35-70k input tokens; this
    // brings it to a few thousand while staying readable for a layout critique.
    static func jpegDataURL(for nodes: [DesignNode], maxDimension: CGFloat = 900) -> String? {
        guard !nodes.isEmpty else { return nil }

        let padding: CGFloat = 24
        let minX = nodes.map(\.x).min() ?? 0
        let minY = nodes.map(\.y).min() ?? 0
        let maxX = nodes.map { $0.x + $0.width }.max() ?? 0
        let maxY = nodes.map { $0.y + $0.height }.max() ?? 0

        let width = maxX - minX + padding * 2
        let height = maxY - minY + padding * 2
        guard width > 1, height > 1 else { return nil }

        let content = ZStack(alignment: .topLeading) {
            Color(hex: "#ECEFF3")

            ForEach(nodes) { node in
                CanvasNodeView(
                    node: node,
                    parentOffset: CGPoint(x: -minX + padding, y: -minY + padding),
                    selectedNodeId: nil
                )
            }
        }
        .frame(width: width, height: height, alignment: .topLeading)
        // Game nodes render as static posters — ImageRenderer can't draw SpriteView.
        .environment(\.isCanvasSnapshot, true)

        let renderer = ImageRenderer(content: content)
        renderer.scale = min(2, max(0.4, maxDimension / max(width, height)))

        guard let nsImage = renderer.nsImage,
              let tiff = nsImage.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let jpegData = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.45])
        else {
            return nil
        }

        return "data:image/jpeg;base64," + jpegData.base64EncodedString()
    }

    static func jpegData(
        for nodes: [DesignNode],
        pixelWidth: Int,
        pixelHeight: Int,
        physicalWidthCM: CGFloat? = nil,
        physicalHeightCM: CGFloat? = nil,
        compression: CGFloat = 0.9
    ) -> Data? {
        guard let nsImage = renderedImage(for: nodes, pixelWidth: pixelWidth, pixelHeight: pixelHeight),
              let tiff = nsImage.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff)
        else {
            return nil
        }

        if let physicalWidthCM, let physicalHeightCM {
            bitmap.size = NSSize(
                width: physicalWidthCM / 2.54 * 72,
                height: physicalHeightCM / 2.54 * 72
            )
        }

        return bitmap.representation(
            using: .jpeg,
            properties: [.compressionFactor: compression]
        )
    }

    // Builds a real, correctly-sized PDF page with the rendered artwork
    // filling it. Renders through ImageRenderer (like jpegData) rather than
    // NSHostingView.dataWithPDF(inside:) — a hosting view that was never
    // attached to a window frequently rasterizes as a blank page, since
    // SwiftUI has no live display cycle to draw into off-screen.
    static func pdfData(
        for nodes: [DesignNode],
        physicalWidthCM: CGFloat,
        physicalHeightCM: CGFloat,
        dpi: CGFloat = 150
    ) -> Data? {
        guard physicalWidthCM > 0, physicalHeightCM > 0, dpi > 0 else { return nil }

        let pixelWidth = max(1, Int((physicalWidthCM / 2.54 * dpi).rounded()))
        let pixelHeight = max(1, Int((physicalHeightCM / 2.54 * dpi).rounded()))

        guard let nsImage = renderedImage(for: nodes, pixelWidth: pixelWidth, pixelHeight: pixelHeight),
              let cgImage = nsImage.cgImage(forProposedRect: nil, context: nil, hints: nil)
        else {
            return nil
        }

        let pageWidthPoints = physicalWidthCM / 2.54 * 72
        let pageHeightPoints = physicalHeightCM / 2.54 * 72
        var mediaBox = CGRect(x: 0, y: 0, width: pageWidthPoints, height: pageHeightPoints)

        let pdfData = NSMutableData()
        guard let consumer = CGDataConsumer(data: pdfData as CFMutableData),
              let pdfContext = CGContext(consumer: consumer, mediaBox: &mediaBox, nil)
        else {
            return nil
        }

        pdfContext.beginPDFPage(nil)
        pdfContext.draw(cgImage, in: mediaBox)
        pdfContext.endPDFPage()
        pdfContext.closePDF()

        return pdfData as Data
    }

    // Shared offscreen renderer for the print-export paths: lays the nodes
    // out at their natural size, then scales the whole scene to the exact
    // pixel dimensions requested so raster export always matches print size.
    private static func renderedImage(for nodes: [DesignNode], pixelWidth: Int, pixelHeight: Int) -> NSImage? {
        guard !nodes.isEmpty, pixelWidth > 1, pixelHeight > 1 else { return nil }

        let minX = nodes.map(\.x).min() ?? 0
        let minY = nodes.map(\.y).min() ?? 0
        let maxX = nodes.map { $0.x + $0.width }.max() ?? 0
        let maxY = nodes.map { $0.y + $0.height }.max() ?? 0

        let sourceWidth = max(1, maxX - minX)
        let sourceHeight = max(1, maxY - minY)
        let outputWidth = CGFloat(pixelWidth)
        let outputHeight = CGFloat(pixelHeight)
        let scaleX = outputWidth / sourceWidth
        let scaleY = outputHeight / sourceHeight

        let content = ZStack(alignment: .topLeading) {
            Color(hex: "#FFFFFF")

            ZStack(alignment: .topLeading) {
                ForEach(nodes) { node in
                    CanvasNodeView(
                        node: node,
                        parentOffset: CGPoint(x: -minX, y: -minY),
                        selectedNodeId: nil
                    )
                }
            }
            .frame(width: sourceWidth, height: sourceHeight, alignment: .topLeading)
            .scaleEffect(x: scaleX, y: scaleY, anchor: .topLeading)
        }
        .frame(width: outputWidth, height: outputHeight, alignment: .topLeading)
        .environment(\.isCanvasSnapshot, true)

        let renderer = ImageRenderer(content: content)
        renderer.scale = 1
        return renderer.nsImage
    }
}
