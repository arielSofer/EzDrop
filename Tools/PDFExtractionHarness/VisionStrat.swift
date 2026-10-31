import PDFKit
import Vision
import AppKit
import Foundation

/// Strategy D: get line geometry from Vision's TEXT RECOGNITION instead of the
/// PDF content stream. Vision reads the rendered page the way an eye does, so
/// an inline formula does not inflate a line box the way PDFKit's does — the
/// exact failure that made every geometric grouping rewrite lose.
///
/// `VNDetectDocumentSegmentationRequest` was evaluated first and is useless
/// here: it returns ONE box covering the whole page (0.99 x 0.98). It finds a
/// document inside a photo; it does not decompose layout.
enum VisionStrategy {

    static func lines(_ page: PDFPage) -> [Line] {
        let box = page.bounds(for: .mediaBox)
        let scale: CGFloat = 2
        let image = NSImage(size: NSSize(width: box.width * scale, height: box.height * scale))
        image.lockFocus()
        NSColor.white.setFill(); NSRect(origin: .zero, size: image.size).fill()
        if let ctx = NSGraphicsContext.current?.cgContext {
            ctx.scaleBy(x: scale, y: scale)
            page.draw(with: .mediaBox, to: ctx)
        }
        image.unlockFocus()
        guard let tiff = image.tiffRepresentation,
              let bitmap = NSBitmapImageRep(data: tiff),
              let cg = bitmap.cgImage else { return [] }

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false   // never "fix" a formula
        try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])

        return (request.results ?? []).compactMap { observation in
            guard let text = observation.topCandidates(1).first?.string,
                  !text.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            // Normalised (0-1, origin bottom-left) → PDF points.
            let b = observation.boundingBox
            let rect = CGRect(x: b.minX * box.width, y: b.minY * box.height,
                              width: b.width * box.width, height: b.height * box.height)
            return Line(text: text, box: rect, height: rect.height)
        }.sorted { $0.box.minY > $1.box.minY }
    }

    static func blocks(_ page: PDFPage) -> [Block] {
        let ls = lines(page)
        guard !ls.isEmpty else { return [] }
        let heights = ls.map(\.height).sorted()
        let bodyHeight = heights[heights.count / 2]
        var lefts: [CGFloat: Int] = [:]
        for l in ls { lefts[(l.box.minX / 6).rounded() * 6, default: 0] += 1 }
        let bodyLeft = lefts.max { $0.value < $1.value }?.key ?? ls[0].box.minX
        let rightEdge = ls.map(\.box.maxX).max() ?? 0

        func breaks(_ p: Line, _ l: Line) -> Bool {
            let step = p.box.minY - l.box.minY
            if step > bodyHeight * 2.4 { return true }
            if step < -1 { return true }
            if abs(l.box.minX - p.box.minX) > bodyHeight * 4,
               l.box.minX > bodyLeft + bodyHeight * 3 { return true }
            if l.box.minX > bodyLeft + bodyHeight * 0.9,
               p.box.maxX > rightEdge - bodyHeight * 2 { return true }
            let ratio = p.height / max(0.1, l.height)
            if ratio < 0.7 || ratio > 1.4 { return true }
            return false
        }

        var groups: [[Line]] = []
        var current: [Line] = [ls[0]]
        for l in ls.dropFirst() {
            if breaks(current[current.count - 1], l) { groups.append(current); current = [l] }
            else { current.append(l) }
        }
        groups.append(current)

        return groups.map { g in
            var text = ""
            for l in g {
                if text.isEmpty { text = l.text }
                else if text.hasSuffix("-") { text.removeLast(); text += l.text }
                else { text += " " + l.text }
            }
            let bb = g.dropFirst().reduce(g[0].box) { $0.union($1.box) }
            let hs = g.map(\.height).sorted()
            return Block(text: text.trimmingCharacters(in: .whitespaces),
                         box: bb, lineHeight: hs[hs.count/2], lineCount: g.count)
        }
    }
}
