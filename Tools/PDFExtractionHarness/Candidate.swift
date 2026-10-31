import PDFKit
import Foundation

/// Strategy B: rebuild lines from glyph geometry, but with the two properties
/// the first attempt lacked — an ADAPTIVE tolerance taken from the line being
/// built (not a page-wide median that tiny margin text drags down), and
/// explicit removal of rotated/vertical runs before any statistic is computed.
enum Candidate {

    struct Glyph { let ch: Character; let box: CGRect }

    static func glyphs(_ page: PDFPage) -> [Glyph] {
        let n = page.numberOfCharacters
        guard n > 0, let text = page.string else { return [] }
        let chars = Array(text)
        var out: [Glyph] = []
        out.reserveCapacity(n)
        for i in 0..<min(n, chars.count) {
            let b = page.characterBounds(at: i)
            guard b.width > 0.01, b.height > 0.01, !chars[i].isNewline else { continue }
            out.append(Glyph(ch: chars[i], box: b))
        }
        return out
    }

    static func lines(_ page: PDFPage) -> [Line] {
        let all = glyphs(page)
        guard !all.isEmpty else { return [] }

        // TWO PASSES, not one greedy sweep. A single pass that updates the
        // running baseline as it consumes glyphs DRIFTS: by the end of a long
        // line the window has moved a couple of points and the last two or
        // three characters fall out of it, which is why lines came back as
        // "…to quantify the co" / "i- dence we have…". Discovering the
        // baselines first and then assigning to the nearest one is stable.
        let typical: CGFloat = {
            let hs = all.map(\.box.height).sorted()
            return hs[hs.count / 2]
        }()

        // Pass 1: cluster the distinct baselines.
        let baselineValues = all.map(\.box.minY).sorted(by: >)
        var baselines: [CGFloat] = []
        var cluster: [CGFloat] = [baselineValues[0]]
        for value in baselineValues.dropFirst() {
            if abs(value - cluster[cluster.count - 1]) <= max(1.2, typical * 0.45) {
                cluster.append(value)
            } else {
                baselines.append(cluster[cluster.count / 2])
                cluster = [value]
            }
        }
        baselines.append(cluster[cluster.count / 2])

        // Pass 2: every glyph joins its nearest baseline.
        var buckets: [Int: [Glyph]] = [:]
        for glyph in all {
            var bestIndex = 0
            var bestDistance = CGFloat.greatestFiniteMagnitude
            for (index, baseline) in baselines.enumerated() {
                let distance = abs(glyph.box.minY - baseline)
                if distance < bestDistance { bestDistance = distance; bestIndex = index }
            }
            buckets[bestIndex, default: []].append(glyph)
        }
        let rows: [[Glyph]] = baselines.indices.compactMap { buckets[$0] }

        return rows.compactMap { row -> Line? in
            let ordered = row.sorted { $0.box.minX < $1.box.minX }
            guard let first = ordered.first else { return nil }
            let box = ordered.dropFirst().reduce(first.box) { $0.union($1.box) }
            let heights = ordered.map(\.box.height).sorted()
            let lineHeight = heights[heights.count / 2]

            // Rotated / vertical runs: many glyphs stacked in a column no
            // wider than a single character. These are the spine watermark and
            // margin notes; letting them into the statistics is what poisoned
            // the first attempt's tolerance.
            if ordered.count > 3, box.width < lineHeight * 2 { return nil }

            let widths = ordered.map(\.box.width).sorted()
            let spaceThreshold = max(0.8, widths[widths.count / 2] * 0.45)
            var text = String(first.ch)
            var previous = first.box
            for glyph in ordered.dropFirst() {
                if glyph.box.minX - previous.maxX > spaceThreshold,
                   !glyph.ch.isWhitespace, text.last?.isWhitespace == false {
                    text.append(" ")
                }
                if !glyph.ch.isWhitespace || text.last?.isWhitespace == false { text.append(glyph.ch) }
                previous = glyph.box
            }
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return nil }
            return Line(text: trimmed, box: box, height: lineHeight)
        }
    }

    static func blocks(_ page: PDFPage) -> [Block] {
        let ls = lines(page)
        guard !ls.isEmpty else { return [] }

        // Body statistics come from lines that look like body: computed AFTER
        // rotated text is gone.
        let bodyHeights = ls.map(\.height).sorted()
        let bodyHeight = bodyHeights[bodyHeights.count / 2]
        var lefts: [CGFloat: Int] = [:]
        for l in ls { lefts[(l.box.minX / 6).rounded() * 6, default: 0] += 1 }
        let bodyLeft = lefts.max { $0.value < $1.value }?.key ?? ls[0].box.minX
        let rightEdge = ls.map(\.box.maxX).max() ?? 0

        func breaks(_ p: Line, _ l: Line) -> Bool {
            let gap = p.box.minY - l.box.maxY
            if gap > bodyHeight * 1.2 { return true }          // blank line
            if l.box.maxY > p.box.maxY + bodyHeight { return true }  // new column/region
            let ratio = p.height / max(0.1, l.height)
            if ratio < 0.78 || ratio > 1.28 { return true }    // different type size
            // Indent starts a paragraph, but only after a line that reached the
            // right margin (otherwise it is just a short last line).
            if l.box.minX > bodyLeft + bodyHeight * 0.7,
               p.box.maxX > rightEdge - bodyHeight { return true }
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
