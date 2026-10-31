import PDFKit
import Foundation

// Shared types + metrics for comparing text-extraction strategies.
struct Line { let text: String; let box: CGRect; let height: CGFloat }
struct Block { let text: String; let box: CGRect; let lineHeight: CGFloat; let lineCount: Int }

enum Metrics {
    /// Words present in the page's own text stream, as ground truth.
    static func referenceWords(_ page: PDFPage) -> [String] {
        (page.string ?? "")
            .replacingOccurrences(of: "-\n", with: "")
            .split(whereSeparator: { $0.isWhitespace || $0.isNewline })
            .map { $0.trimmingCharacters(in: .punctuationCharacters) }
            .filter { $0.count >= 3 && $0.allSatisfy { c in c.isLetter } }
    }

    /// The decisive quality signal: does the reconstruction preserve whole
    /// words? An extractor that splits "published" into "blished" scores low
    /// here even while producing beautiful-looking paragraph counts.
    static func wordIntegrity(blocks: [Block], page: PDFPage) -> Double {
        let reference = Set(referenceWords(page).map { $0.lowercased() })
        guard !reference.isEmpty else { return 1 }
        let produced = Set(blocks.flatMap { $0.text
            .split(whereSeparator: { $0.isWhitespace })
            .map { $0.trimmingCharacters(in: .punctuationCharacters).lowercased() } })
        return Double(reference.intersection(produced).count) / Double(reference.count)
    }

    /// Share of substantial blocks that end like a real sentence — the gate
    /// the translation filter actually applies downstream.
    static func sentenceComplete(blocks: [Block]) -> (usable: Int, total: Int) {
        let substantial = blocks.filter { $0.text.split(separator: " ").count >= 6 }
        let usable = substantial.filter {
            let t = $0.text.trimmingCharacters(in: .whitespaces)
            return t.hasSuffix(".") || t.hasSuffix(":") || t.hasSuffix("?") || t.hasSuffix("!")
        }
        return (usable.count, substantial.count)
    }

    static func report(_ name: String, blocks: [Block], page: PDFPage) -> (Double, Int, Int, Int) {
        let integrity = wordIntegrity(blocks: blocks, page: page)
        let (usable, total) = sentenceComplete(blocks: blocks)
        return (integrity, usable, total, blocks.count)
    }
}

// ---- Strategy A: the CURRENT production path (selectionsByLine + splits) ----
enum Baseline {
    static func blocks(_ page: PDFPage) -> [Block] {
        guard let all = page.selection(for: page.bounds(for: .mediaBox)) else { return [] }
        let ls: [Line] = all.selectionsByLine().compactMap {
            guard let s = $0.string, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
            let b = $0.bounds(for: page)
            return Line(text: s, box: b, height: b.height) }
        guard !ls.isEmpty else { return [] }
        func splits(_ u: Line, _ l: Line) -> Bool {
            let gap = u.box.minY - l.box.maxY, ref = min(u.box.height, l.box.height)
            if gap >= ref * 0.9 { return true }
            if (min(u.box.maxX,l.box.maxX) - max(u.box.minX,l.box.minX)) <= ref { return true }
            let sr = u.box.height / max(1,l.box.height); if sr <= 0.7 || sr >= 1.4 { return true }
            if l.box.minX > u.box.minX + 6 { return true }
            if u.box.minX > l.box.minX + 24 { return true }
            return false }
        var groups: [[Line]] = []; var cur = [ls[0]]
        for i in 1..<ls.count { if splits(ls[i-1], ls[i]) { groups.append(cur); cur=[ls[i]] } else { cur.append(ls[i]) } }
        groups.append(cur)
        return groups.map { g in
            let box = g.dropFirst().reduce(g[0].box) { $0.union($1.box) }
            let hs = g.map(\.height).sorted()
            return Block(text: g.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespaces),
                         box: box, lineHeight: hs[hs.count/2], lineCount: g.count) }
    }
}
