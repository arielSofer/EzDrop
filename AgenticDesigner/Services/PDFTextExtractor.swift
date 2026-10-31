//
//  PDFTextExtractor.swift
//  AgenticDesigner
//
//  Rebuilding lines and paragraphs from CHARACTER geometry.
//
//  `PDFSelection.selectionsByLine()` is the obvious way to read a page and the
//  wrong one for a technical book. Measured on Mathematics for Machine
//  Learning: of the line pairs it emitted, 27 per page were split for "low
//  horizontal overlap" — an inline formula has a taller, offset box, so the
//  run before it and the run after it stop looking like the same line. The
//  paragraph then arrives as fragments, none of which ends in a full stop, and
//  every downstream prose filter correctly rejects them. Coverage died in the
//  extractor, not in the filters.
//
//  Characters carry their own boxes, so lines can be rebuilt from BASELINES
//  instead: a superscript or a √ sits at a different height but shares the
//  line's baseline, and clustering on that keeps the sentence whole.
//

import Foundation
import PDFKit

struct ExtractedLine {
    let text: String
    let bounds: CGRect
    /// Median glyph height on the line — the basis for matching a replacement's
    /// font size, and far more stable than the union box when a formula is in
    /// the middle of it.
    let bodyHeight: CGFloat
    let baseline: CGFloat
}

enum PDFTextExtractor {

    /// Characters whose boxes are this close vertically belong to one line.
    /// Expressed as a fraction of the running body height so it scales with
    /// the page's type size.
    private static let baselineTolerance: CGFloat = 0.55

    // MARK: - Lines

    static func lines(on page: PDFPage) -> [ExtractedLine] {
        let count = page.numberOfCharacters
        guard count > 0, let pageText = page.string, !pageText.isEmpty else { return [] }

        // Character boxes, skipping whitespace (its box is unreliable and it
        // would drag the baseline statistics around).
        let characters = Array(pageText)
        var glyphs: [(character: Character, box: CGRect)] = []
        glyphs.reserveCapacity(count)
        for index in 0..<min(count, characters.count) {
            let box = page.characterBounds(at: index)
            guard box.width > 0, box.height > 0 else { continue }
            let character = characters[index]
            guard !character.isNewline else { continue }
            glyphs.append((character, box))
        }
        guard !glyphs.isEmpty else { return [] }

        // Typical glyph height on this page — the yardstick for "same line".
        let heights = glyphs.map(\.box.height).sorted()
        let bodyHeight = heights[heights.count / 2]
        let tolerance = max(1.5, bodyHeight * baselineTolerance)

        // PDF origin is bottom-left, so lines descend as minY decreases.
        // Cluster on the box BOTTOM: a superscript's top is far above the
        // line's, but its bottom stays near the baseline it hangs from.
        let sorted = glyphs.sorted { lhs, rhs in
            if abs(lhs.box.minY - rhs.box.minY) > tolerance { return lhs.box.minY > rhs.box.minY }
            return lhs.box.minX < rhs.box.minX
        }

        var rows: [[(character: Character, box: CGRect)]] = []
        var current: [(character: Character, box: CGRect)] = [sorted[0]]
        var rowBaseline = sorted[0].box.minY
        for glyph in sorted.dropFirst() {
            if abs(glyph.box.minY - rowBaseline) <= tolerance {
                current.append(glyph)
                // Track the dominant baseline so a tall formula doesn't drag it.
                rowBaseline = current.map(\.box.minY).sorted()[current.count / 2]
            } else {
                rows.append(current)
                current = [glyph]
                rowBaseline = glyph.box.minY
            }
        }
        rows.append(current)

        return rows.compactMap { row -> ExtractedLine? in
            let ordered = row.sorted { $0.box.minX < $1.box.minX }
            guard let first = ordered.first else { return nil }

            // Word breaks come from horizontal gaps, because the raw character
            // stream's spaces are unreliable once a formula is inline.
            let widths = ordered.map(\.box.width).sorted()
            let medianWidth = widths[widths.count / 2]
            let spaceThreshold = max(1.0, medianWidth * 0.42)

            var text = String(first.character)
            var previous = first.box
            for glyph in ordered.dropFirst() {
                let gap = glyph.box.minX - previous.maxX
                if gap > spaceThreshold, !glyph.character.isWhitespace, text.last?.isWhitespace == false {
                    text.append(" ")
                }
                if !glyph.character.isWhitespace || text.last?.isWhitespace == false {
                    text.append(glyph.character)
                }
                previous = glyph.box
            }

            let bounds = ordered.dropFirst().reduce(first.box) { $0.union($1.box) }
            let rowHeights = ordered.map(\.box.height).sorted()
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            guard !trimmed.isEmpty else { return nil }
            return ExtractedLine(
                text: trimmed,
                bounds: bounds,
                bodyHeight: rowHeights[rowHeights.count / 2],
                baseline: ordered.map(\.box.minY).sorted()[ordered.count / 2]
            )
        }
    }

    // MARK: - Paragraphs

    /// Groups lines into paragraphs using column position and line spacing —
    /// deliberately NOT using "does the sentence look finished", because the
    /// character stream of a formula-heavy page rarely provides that evidence.
    static func paragraphs(on page: PDFPage) -> [PDFParagraph] {
        let lines = self.lines(on: page)
        guard !lines.isEmpty else { return [] }

        // The body's left margin: the most common line start, rounded into
        // buckets so justified text with slight variation still agrees.
        var leftFrequency: [CGFloat: Int] = [:]
        for line in lines { leftFrequency[(line.bounds.minX / 6).rounded() * 6, default: 0] += 1 }
        let bodyLeft = leftFrequency.max { $0.value < $1.value }?.key ?? lines[0].bounds.minX

        let bodyHeights = lines.map(\.bodyHeight).sorted()
        let medianBody = bodyHeights[bodyHeights.count / 2]

        func startsNewParagraph(_ previous: ExtractedLine, _ line: ExtractedLine) -> Bool {
            let gap = previous.bounds.minY - line.bounds.maxY
            // A clear vertical break.
            if gap > medianBody * 1.15 { return true }
            // Moving backwards or sideways = a different column or region.
            if line.bounds.maxY > previous.bounds.maxY + medianBody { return true }
            // A first-line indent starts a paragraph, but only when the
            // previous line reached the right margin (i.e. it was full).
            let indented = line.bounds.minX > bodyLeft + medianBody * 0.6
            let previousWasFull = previous.bounds.maxX > lines.map(\.bounds.maxX).max()! - medianBody
            if indented && previousWasFull && line.bounds.minX > previous.bounds.minX + 4 { return true }
            // A heading or caption: markedly different type size.
            let ratio = previous.bodyHeight / max(0.1, line.bodyHeight)
            if ratio < 0.75 || ratio > 1.33 { return true }
            return false
        }

        var groups: [[ExtractedLine]] = []
        var current: [ExtractedLine] = [lines[0]]
        for line in lines.dropFirst() {
            if startsNewParagraph(current[current.count - 1], line) {
                groups.append(current)
                current = [line]
            } else {
                current.append(line)
            }
        }
        groups.append(current)

        return groups.map { group in
            let bounds = group.dropFirst().reduce(group[0].bounds) { $0.union($1.bounds) }
            let heights = group.map(\.bodyHeight).sorted()
            return PDFParagraph(
                text: joinWrapped(group.map(\.text)),
                bounds: bounds,
                lineHeight: heights[heights.count / 2]
            )
        }
    }

    /// Rejoins wrapped lines, healing the hyphenation the typesetter added.
    private static func joinWrapped(_ lines: [String]) -> String {
        var output = ""
        for line in lines {
            if output.isEmpty { output = line; continue }
            if output.hasSuffix("-") {
                output.removeLast()
                output += line
            } else {
                output += " " + line
            }
        }
        return output
    }
}
