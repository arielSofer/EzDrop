//
//  PDFMathGuard.swift
//  AgenticDesigner
//
//  Formula-safe translation for scientific documents.
//
//  A translator handed "the energy E = mc² grows" will happily "translate" the
//  formula too — reordering it under RTL rules, swapping digits, or turning
//  superscripts into arrow junk. The established fix (LaTeXMT, BabelDOC,
//  PDFMathTranslate all converge on it) is MASKING: every non-translatable
//  span is replaced by a sentinel before the text is sent, and restored
//  verbatim afterwards. The model only ever sees prose.
//
//  The second half matters as much as the first: if a sentinel comes back
//  corrupted or missing, the translation is REJECTED rather than shipped with
//  a mangled equation. A wrong formula in a physics book is worse than an
//  untranslated sentence.
//

import Foundation

struct MaskedText {
    let masked: String
    /// Sentinel → original fragment, restored after translation.
    let fragments: [String: String]
    /// True when the source was essentially all formula — such a block should
    /// not be sent to a translator at all.
    let isMostlyFormula: Bool

    var hasFormulas: Bool { !fragments.isEmpty }
}

enum PDFMathGuard {

    /// Sentinels use ASCII digits inside guillemet-free brackets. Tested shape:
    /// models leave «[[3]]»-style tokens alone far more reliably than unicode
    /// private-use characters, which some tokenizers drop entirely.
    private static func sentinel(_ index: Int) -> String { "[[\(index)]]" }

    /// Ordered most-specific first: a LaTeX block must win over the loose
    /// symbol run that would otherwise chop it in half.
    private static let patterns: [String] = [
        // Display and inline LaTeX
        #"\$\$[^$]{1,400}\$\$"#,
        #"\\\[[^\]]{1,400}\\\]"#,
        #"\\\([^)]{1,400}\\\)"#,
        #"\$[^$\n]{1,200}\$"#,
        // LaTeX commands with or without arguments: \alpha, \frac{a}{b}
        #"\\[A-Za-z]+(\{[^}]{0,120}\})*"#,
        // Chemical formulae: H2O, CO2, Na2SO4, C6H12O6. The lookahead demands
        // at least one digit so ordinary capitalised runs ("PDF", "USA") are
        // not mistaken for molecules.
        #"\b(?=[A-Za-z0-9]*\d)[A-Z][a-z]?\d{0,3}(?:[A-Z][a-z]?\d{0,3})+\b"#,
        // Equation / figure / citation references kept verbatim
        #"\((?:Eq|Fig|Ref|Table|Thm|Lemma)\.?\s*\d+[a-z]?\)"#,
        #"\[\d{1,3}(?:[,–-]\s*\d{1,3})*\]"#,
        // Numbers with units or exponents: 9.81 m/s², 10^-9, 25 °C.
        // NOTE: no trailing \b — a superscript is not a word character, so the
        // boundary forced the engine to backtrack and drop the ² off "m/s²".
        #"\b\d+(?:[.,]\d+)?\s*(?:[×x]\s*10[\^⁻⁰-⁹\-]?\d*)?\s*(?:°[CFK]|[a-zA-Zµμ]{1,4}(?:/[a-zA-Z]{1,3})?[²³]?)"#,
        // Standalone superscript/subscript runs
        #"[⁰-⁹⁻⁺ⁿ]{1,6}"#,
        #"[₀-₉₋₊]{1,6}"#
    ]

    private static let compiled: [NSRegularExpression] = patterns.compactMap {
        try? NSRegularExpression(pattern: $0)
    }

    /// Characters that mean "this is notation, not prose".
    static let mathScalars: Set<Unicode.Scalar> = {
        var set = Set<Unicode.Scalar>()
        for scalar in "=≈≠≤≥<>±×÷√∫∑∏∂∇∈∉⊂⊆∪∩→←↔⇒⇔∞°′″^_".unicodeScalars { set.insert(scalar) }
        for scalar in "⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺ⁿ₀₁₂₃₄₅₆₇₈₉₋₊".unicodeScalars { set.insert(scalar) }
        for scalar in "ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρστυφχψω".unicodeScalars { set.insert(scalar) }
        return set
    }()

    // MARK: - Mask

    static func mask(_ text: String) -> MaskedText {
        let ns = text as NSString
        var protectedRanges: [NSRange] = []

        for regex in compiled {
            for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
                let range = match.range
                guard range.length > 0 else { continue }
                // Skip anything already inside a claimed span — first pattern wins.
                if protectedRanges.contains(where: { NSIntersectionRange($0, range).length > 0 }) { continue }
                protectedRanges.append(range)
            }
        }
        // Equations are found by SCANNING, not by one big regex. A pattern that
        // allows letters and spaces around an operator is greedy by nature and
        // swallowed the prose around it ("The kinetic energy is E = mc" came
        // back as one protected span, with the ² orphaned outside). Growing
        // outward from each operator and stopping at the first real word keeps
        // the equation and only the equation.
        for range in equationRanges(in: ns) {
            if protectedRanges.contains(where: { NSIntersectionRange($0, range).length > 0 }) { continue }
            protectedRanges.append(range)
        }
        guard !protectedRanges.isEmpty else {
            return MaskedText(masked: text, fragments: [:], isMostlyFormula: false)
        }

        // Replace back-to-front so earlier ranges stay valid.
        protectedRanges.sort { $0.location > $1.location }
        var working = ns.mutableCopy() as! NSMutableString
        var fragments: [String: String] = [:]
        var protectedLength = 0

        for (offset, range) in protectedRanges.enumerated() {
            let token = sentinel(protectedRanges.count - offset)
            fragments[token] = ns.substring(with: range)
            protectedLength += range.length
            working.replaceCharacters(in: range, with: token)
        }

        // A "paragraph" that is 60%+ notation is a displayed equation. Sending
        // it to a translator can only damage it.
        let ratio = ns.length > 0 ? Double(protectedLength) / Double(ns.length) : 0
        return MaskedText(
            masked: working as String,
            fragments: fragments,
            isMostlyFormula: ratio > 0.6
        )
    }

    // MARK: - Equation scanning

    // Includes the UNICODE minus/multiply/dot variants a typesetter emits —
    // ASCII "-" is not what a real PDF contains.
    private static let operators: Set<Character> = Set("=≈≠≤≥<>±×÷√∫∑∏∂∇∈∉⊂⊆∪∩→←↔⇒⇔−–⋅∙∘⊕⊗≡∝∼")
    private static let mathDecorations: Set<Character> = Set("²³⁰¹⁴⁵⁶⁷⁸⁹⁻⁺ⁿ₀₁₂₃₄₅₆₇₈₉₋₊′″^_")

    /// A whitespace-delimited token that belongs to notation rather than prose.
    /// The decisive rule: a run of 2+ plain letters with no digit, decoration,
    /// Greek letter or operator is a WORD ("is", "whenever", "energy") and ends
    /// the equation. Single letters are variables and are allowed.
    private static func isMathToken(_ token: Substring) -> Bool {
        guard !token.isEmpty else { return false }
        if token.contains(where: { operators.contains($0) || mathDecorations.contains($0) }) { return true }
        if token.contains(where: \.isNumber) { return true }
        let letters = token.filter(\.isLetter)
        if letters.contains(where: { $0.unicodeScalars.allSatisfy { scalar in
            (0x0370...0x03FF).contains(scalar.value)   // Greek
        } }) { return true }
        // A short parenthesised term is function application — F(b), f(x) —
        // not a word. Without this the run broke mid-equation at "F(b)".
        if token.contains(where: { "()[]{}".contains($0) }), letters.count <= 4 { return true }
        // A short term containing a slash is a ratio (h/p, m/s); a long one is
        // a word pair ("and/or") and must stay translatable.
        if token.contains("/"), letters.count <= 3 { return true }
        // Single variable, or pure punctuation like "(" / "," / "/".
        return letters.count <= 1
    }

    /// Maximal runs of adjacent math tokens that contain at least one operator.
    private static func equationRanges(in ns: NSString) -> [NSRange] {
        let text = ns as String
        var ranges: [NSRange] = []
        var runStart: String.Index?
        var runEnd: String.Index?
        var runHasOperator = false
        var previousWasOperator = false

        func closeRun() {
            defer { runStart = nil; runEnd = nil; runHasOperator = false }
            guard runHasOperator, let start = runStart, let end = runEnd else { return }
            let nsRange = NSRange(start..<end, in: text)
            // A single character either side of an operator is not an equation.
            guard nsRange.length >= 3 else { return }
            ranges.append(nsRange)
        }

        var index = text.startIndex
        while index < text.endIndex {
            // Skip whitespace between tokens without breaking the run.
            if text[index].isWhitespace { index = text.index(after: index); continue }
            var tokenEnd = index
            while tokenEnd < text.endIndex, !text[tokenEnd].isWhitespace {
                tokenEnd = text.index(after: tokenEnd)
            }
            let token = text[index..<tokenEnd]

            // "F = ma" and "λ = h/p": the operand is two plain letters, exactly
            // like the word "is". What separates them is POSITION — an operand
            // sits directly against its operator, whereas prose does not. So a
            // short token immediately after an operator is admitted as part of
            // the equation; anything longer, or further away, ends it.
            let isOperandAfterOperator = previousWasOperator && token.filter(\.isLetter).count <= 3

            if isMathToken(token) || isOperandAfterOperator {
                if runStart == nil { runStart = index }
                runEnd = tokenEnd
                let containsOperator = token.contains { operators.contains($0) }
                if containsOperator { runHasOperator = true }
                previousWasOperator = containsOperator
            } else {
                closeRun()
                previousWasOperator = false
            }
            index = tokenEnd
        }
        closeRun()
        return ranges
    }

    // MARK: - Restore

    enum RestoreResult {
        case restored(String)
        /// The model ate or altered a sentinel — the caller must keep the
        /// original text rather than ship a broken formula.
        case corrupted(missing: [String])
    }

    static func restore(_ translated: String, from masked: MaskedText) -> RestoreResult {
        guard masked.hasFormulas else { return .restored(translated) }

        var output = translated
        var missing: [String] = []

        for (token, fragment) in masked.fragments.sorted(by: { $0.key.count > $1.key.count }) {
            if output.contains(token) {
                output = output.replacingOccurrences(of: token, with: fragment)
            } else if let loosened = loosenedMatch(for: token, in: output) {
                // Models sometimes respace a sentinel ("[[ 3 ]]", "[ [3] ]").
                output = output.replacingOccurrences(of: loosened, with: fragment)
            } else {
                missing.append(token)
            }
        }
        return missing.isEmpty ? .restored(output) : .corrupted(missing: missing)
    }

    /// Finds a sentinel the model reformatted but did not destroy.
    private static func loosenedMatch(for token: String, in text: String) -> String? {
        let digits = token.filter(\.isNumber)
        guard !digits.isEmpty else { return nil }
        let pattern = #"\[\s*\[\s*"# + digits + #"\s*\]\s*\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range, in: text) else { return nil }
        return String(text[range])
    }

    /// Guard for the reverse failure: a translation that invents notation the
    /// source never had (the "In" → "⇓ח" class of mangling).
    static func introducesForeignMath(source: String, translated: String) -> Bool {
        let sourceMarkers = Set(source.unicodeScalars.filter { mathScalars.contains($0) })
        return translated.unicodeScalars.contains { mathScalars.contains($0) && !sourceMarkers.contains($0) }
    }
}
