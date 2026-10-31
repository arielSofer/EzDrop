//
//  TranslationMemory.swift
//  AgenticDesigner
//
//  Two things a textbook needs that a per-paragraph translator cannot give:
//
//  CONSISTENCY. "eigenvalue" must be the same Hebrew word on page 40 and on
//  page 380. A model asked 200 times independently will not do that — not
//  because it is wrong each time, but because it is free each time.
//
//  REPETITION. A structured book is full of identical short strings —
//  "Definition", "Example", "Remark", "Theorem", "Proof". Translating them
//  again per occurrence costs time and invites variation.
//
//  The cache answers the second and reinforces the first: an exact source
//  string always yields the exact translation it yielded before. The glossary
//  answers the first outright, by removing chosen terms from the model's reach
//  entirely — the same masking trick PDFMathGuard uses for formulas, which is
//  already proven on this document.
//

import Foundation
import Combine

struct GlossaryEntry: Codable, Identifiable, Hashable {
    var source: String
    var translation: String
    var id: String { source.lowercased() }
}

@MainActor
final class TranslationMemory: ObservableObject {

    @Published private(set) var glossary: [GlossaryEntry] = []
    @Published private(set) var hits = 0
    @Published private(set) var misses = 0

    private var cache: [String: String] = [:]
    private let language: String

    init(language: String) {
        self.language = TranslationMemory.normalizedLanguage(language)
        load()
    }

    static func normalizedLanguage(_ raw: String) -> String {
        raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    // MARK: - Cache

    /// Exact-match only. A fuzzy cache would "helpfully" reuse a translation
    /// for text that differs by a digit or a variable name, which in a maths
    /// book is a wrong sentence rather than a near-miss.
    func cached(_ source: String) -> String? {
        let key = Self.key(for: source)
        if let value = cache[key] {
            hits += 1
            return value
        }
        misses += 1
        return nil
    }

    func store(source: String, translation: String) {
        let key = Self.key(for: source)
        guard !key.isEmpty, !translation.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        cache[key] = translation
    }

    /// Collapses insignificant whitespace so the same sentence re-flowed across
    /// a different line break still hits.
    private static func key(for source: String) -> String {
        source
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    var hitRate: Double {
        let total = hits + misses
        return total > 0 ? Double(hits) / Double(total) : 0
    }

    // MARK: - Glossary

    func setTerm(_ source: String, _ translation: String) {
        let trimmed = source.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        glossary.removeAll { $0.id == trimmed.lowercased() }
        glossary.append(GlossaryEntry(source: trimmed, translation: translation))
        // Longest first: "eigenvalue decomposition" must win over "eigenvalue".
        glossary.sort { $0.source.count > $1.source.count }
        save()
    }

    func removeTerm(_ source: String) {
        glossary.removeAll { $0.id == source.lowercased() }
        save()
    }

    /// Replaces glossary terms with sentinels BEFORE translation and puts the
    /// fixed wording back after — so the model never sees the term and cannot
    /// paraphrase it. Sentinels continue PDFMathGuard's numbering space so the
    /// two maskers can be applied to the same string without collision.
    func maskTerms(in text: String, startingAt index: Int) -> (masked: String, restorations: [String: String]) {
        guard !glossary.isEmpty else { return (text, [:]) }
        var masked = text
        var restorations: [String: String] = [:]
        var next = index

        for entry in glossary {
            guard !entry.translation.isEmpty else { continue }
            // Whole words only, case-insensitive: "rank" must not match inside
            // "ranking", and a sentence-initial "Rank" is the same term.
            let pattern = "\\b" + NSRegularExpression.escapedPattern(for: entry.source) + "\\b"
            guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { continue }
            let range = NSRange(masked.startIndex..., in: masked)
            guard regex.firstMatch(in: masked, range: range) != nil else { continue }

            let token = "[[\(next)]]"
            next += 1
            masked = regex.stringByReplacingMatches(in: masked, range: range, withTemplate: token)
            restorations[token] = entry.translation
        }
        return (masked, restorations)
    }

    // MARK: - Persistence

    private var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("AgenticDesigner/Translation", isDirectory: true)
    }
    private var cacheURL: URL { directory.appendingPathComponent("cache-\(language).json") }
    private var glossaryURL: URL { directory.appendingPathComponent("glossary-\(language).json") }

    private func load() {
        let decoder = JSONDecoder()
        if let data = try? Data(contentsOf: cacheURL),
           let stored = try? decoder.decode([String: String].self, from: data) {
            cache = stored
        }
        if let data = try? Data(contentsOf: glossaryURL),
           let stored = try? decoder.decode([GlossaryEntry].self, from: data) {
            glossary = stored.sorted { $0.source.count > $1.source.count }
        }
    }

    func save() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(cache) { try? data.write(to: cacheURL, options: [.atomic]) }
        if let data = try? encoder.encode(glossary) { try? data.write(to: glossaryURL, options: [.atomic]) }
    }
}
