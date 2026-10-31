import PDFKit
import Foundation

/// Strategy C: keep PDFKit's line extraction — measured at 99% word integrity,
/// which neither glyph-level attempt came close to — and replace only the
/// PARAGRAPH GROUPING, which is where formula-inflated line boxes do the damage.
///
/// The two production rules that fire most (27 and 15 times per page) are
/// "low horizontal overlap" and "size ratio". Both read the line's BOX, and an
/// inline formula inflates that box to ~2× the body's. Grouping on the text
/// baseline and the left margin instead makes the same lines group correctly.
enum Hybrid {
    static func blocks(_ page: PDFPage) -> [Block] {
        guard let all = page.selection(for: page.bounds(for: .mediaBox)) else { return [] }
        let ls: [Line] = all.selectionsByLine().compactMap {
            guard let s = $0.string, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            let b = $0.bounds(for: page)
            return Line(text: s, box: b, height: b.height) }
        guard !ls.isEmpty else { return [] }

        // Body metrics from the SMALLEST common line height: formula lines are
        // the tall outliers, so the lower quartile represents prose.
        let heights = ls.map(\.height).sorted()
        let bodyHeight = heights[max(0, heights.count / 4)]
        var lefts: [CGFloat: Int] = [:]
        for l in ls { lefts[(l.box.minX / 6).rounded() * 6, default: 0] += 1 }
        let bodyLeft = lefts.max { $0.value < $1.value }?.key ?? ls[0].box.minX
        let rightEdge = ls.map(\.box.maxX).max() ?? 0

        func breaks(_ p: Line, _ l: Line) -> Bool {
            // Baseline-to-baseline distance, immune to box inflation.
            let step = p.box.minY - l.box.minY
            if step > bodyHeight * 2.2 { return true }        // blank line between
            if step < -1 { return true }                      // moved back up: new region
            // A different column.
            if abs(l.box.minX - p.box.minX) > bodyHeight * 3, l.box.minX > bodyLeft + bodyHeight * 3 { return true }
            // First-line indent, only after a line that filled the measure.
            if l.box.minX > bodyLeft + bodyHeight * 0.8,
               p.box.maxX > rightEdge - bodyHeight * 1.5 { return true }
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
            let box = g.dropFirst().reduce(g[0].box) { $0.union($1.box) }
            let hs = g.map(\.height).sorted()
            return Block(text: text.trimmingCharacters(in: .whitespaces),
                         box: box, lineHeight: hs[hs.count/2], lineCount: g.count)
        }
    }
}
