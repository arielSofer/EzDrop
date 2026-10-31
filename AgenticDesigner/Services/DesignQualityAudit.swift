//
//  DesignQualityAudit.swift
//  AgenticDesigner
//
//  Deterministic design criticism — the practical alternative to a vision
//  critic. A 32B VLM took ~160s per screenshot and still missed obvious
//  overlaps; geometry never misses one and costs nothing.
//
//  The point is ENFORCEMENT, not advice. Telling a model in a system prompt to
//  "use consistent padding" is a suggestion a weak model ignores; returning
//  "this call left 2 elements 8pt from the edge while every other screen uses
//  24" inside the tool result is a fact it has to answer for.
//

import Foundation
import AppKit

struct DesignQualityFinding {
    enum Severity: String { case blocker, warning, info }

    let severity: Severity
    let screen: String
    let message: String
    let fix: String
}

struct DesignQualityReport {
    let findings: [DesignQualityFinding]
    let score: Int

    var blockerCount: Int { findings.filter { $0.severity == .blocker }.count }
    var warningCount: Int { findings.filter { $0.severity == .warning }.count }
    var infoCount: Int { findings.filter { $0.severity == .info }.count }

    var passesReferenceBar: Bool {
        blockerCount == 0 && warningCount == 0 && score >= 90
    }
}

enum DesignQualityAudit {

    /// Apple's minimum comfortable touch target.
    private static let minimumTapTarget: CGFloat = 44
    /// Spacing values a design is allowed to use before it reads as arbitrary.
    private static let spacingScale: Set<Int> = [0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64]

    static func audit(page: DesignPage) -> [DesignQualityFinding] {
        var findings: [DesignQualityFinding] = []
        let screens = page.nodes.filter { $0.type == .Frame }
        guard !screens.isEmpty else { return [] }

        // One screen padding for the whole product: the most common left inset
        // across screens becomes the standard everything else is judged against.
        let insets = screens.flatMap { screen in
            screen.children.filter { isContentNode($0) }.map { Int($0.x.rounded()) }
        }
        let dominantInset = mostCommon(insets)

        for screen in screens {
            findings += auditScreen(screen, dominantInset: dominantInset)
            findings += auditReferenceQuality(screen)
        }

        findings += auditNavigationPromises(screens: screens)
        findings += auditProductConsistency(screens: screens)
        for screen in screens {
            findings += auditOverflow(in: screen, screenName: screen.name)
        }

        // Anything at page level that isn't a screen is floating outside every
        // screen — it renders on the canvas but ships in no view. This was a
        // blind spot: the audit only walked screen children, so the most broken
        // case of all reported "clean".
        for orphan in page.nodes where orphan.type != .Frame {
            findings.append(DesignQualityFinding(
                severity: .blocker,
                screen: "(page root)",
                message: "\(orphan.name) sits outside every screen frame, so it belongs to no exported view.",
                fix: "Re-parent it into a screen (moveNode with the screen's node id as parent), or delete it."
            ))
        }
        return findings
    }

    static func report(page: DesignPage) -> DesignQualityReport {
        report(findings: audit(page: page))
    }

    private static func report(findings: [DesignQualityFinding]) -> DesignQualityReport {
        let blockers = findings.filter { $0.severity == .blocker }.count
        let warnings = findings.filter { $0.severity == .warning }.count
        let infos = findings.filter { $0.severity == .info }.count
        let score = max(0, 100 - blockers * 20 - warnings * 6 - min(infos, 10))
        return DesignQualityReport(findings: findings, score: score)
    }

    private static func auditScreen(_ screen: DesignNode, dominantInset: Int?) -> [DesignQualityFinding] {
        var findings: [DesignQualityFinding] = []
        let content = screen.children.filter { isContentNode($0) }

        for child in content {
            // A full-bleed element — nav bar, hero image, background card —
            // is SUPPOSED to reach both edges. Flagging it produced warnings
            // on correct layouts, which is worse than silence: it pushes an
            // agent to "fix" work that was already right.
            let isFullBleed = child.width >= screen.width - 8
            // Likewise, only the element that STARTS a row can be judged
            // against the screen margin. The second column of a grid and the
            // fourth tab in a bar are meant to sit further in.
            let leadsItsRow = !content.contains { sibling in
                sibling.id != child.id
                    && sibling.x < child.x - 1
                    && sibling.y < child.y + child.height
                    && sibling.y + sibling.height > child.y
            }
            // A compact focal control such as a progress ring is intentionally
            // centred. Judging its x-origin as a broken left margin trained the
            // loop to stretch or misalign correct hero compositions.
            let isCenteredFocal = child.width < screen.width - 48
                && abs((child.x + child.width / 2) - screen.width / 2) <= 3

            // Flush against the edge — the single most common generated-design
            // tell, and the one the padding system prompt rule kept missing.
            if !isFullBleed, child.x < 4 || (screen.width - (child.x + child.width)) < 4 {
                findings.append(DesignQualityFinding(
                    severity: .warning,
                    screen: screen.name,
                    message: "\(child.name) touches the screen edge (x=\(Int(child.x)), right gap=\(Int(screen.width - child.x - child.width))).",
                    fix: "Inset it to the screen padding\(dominantInset.map { " (\($0)pt on this project)" } ?? "")."
                ))
            } else if let dominantInset, leadsItsRow, !isFullBleed, !isCenteredFocal,
                      abs(Int(child.x.rounded()) - dominantInset) > 3 {
                findings.append(DesignQualityFinding(
                    severity: .info,
                    screen: screen.name,
                    message: "\(child.name) starts at x=\(Int(child.x)) while this project's screen padding is \(dominantInset).",
                    fix: "Align it to \(dominantInset)pt so every screen shares one margin."
                ))
            }

            // Off-scale spacing reads as arbitrary even when it looks fine —
            // but only for the row's leading element, for the same reason.
            let rounded = Int(child.x.rounded())
            if leadsItsRow, !isFullBleed, !isCenteredFocal, rounded > 0,
               !spacingScale.contains(rounded), abs(rounded - (dominantInset ?? -1)) > 3 {
                findings.append(DesignQualityFinding(
                    severity: .info,
                    screen: screen.name,
                    message: "\(child.name) uses an off-scale inset (\(rounded)pt).",
                    fix: "Snap to 4/8/12/16/20/24/32."
                ))
            }

            // Tap targets.
            if isInteractive(child), child.height < minimumTapTarget {
                findings.append(DesignQualityFinding(
                    severity: .warning,
                    screen: screen.name,
                    message: "\(child.name) is \(Int(child.height))pt tall — below the 44pt minimum tap target.",
                    fix: "resizeNode it to at least 44pt high."
                ))
            }

            // Contrast: unreadable text is a blocker, not a nitpick.
            if child.type == .Text,
               case let textColor = child.style.textColor ?? child.style.fill,
               let background = nearestBackground(for: child, in: screen),
               let ratio = contrastRatio(textColor, background),
               ratio < 4.5 {
                findings.append(DesignQualityFinding(
                    severity: ratio < 3 ? .blocker : .warning,
                    screen: screen.name,
                    message: "\(child.name) has \(String(format: "%.1f", ratio)):1 contrast against its background — WCAG AA needs 4.5:1.",
                    fix: "Lighten or darken the text colour (updateStyle textColor)."
                ))
            }

            // A text box wider than its words makes every alignment lie.
            if child.type == .Text, let text = child.text, !text.isEmpty {
                let measured = measuredWidth(of: child)
                if measured > 0, child.width - measured > 24 {
                    findings.append(DesignQualityFinding(
                        severity: .info,
                        screen: screen.name,
                        message: "\(child.name)'s box is \(Int(child.width))pt for \(Int(measured))pt of text.",
                        fix: "Hug the text so centring centres the words, not empty space."
                    ))
                }
            }
        }

        // Vertical rhythm: wildly varying gaps between stacked siblings.
        let stacked = content.sorted { $0.y < $1.y }
        var gaps: [Int] = []
        for index in 1..<max(stacked.count, 1) where stacked.count > 1 {
            let previous = stacked[index - 1]
            let gap = Int((stacked[index].y - (previous.y + previous.height)).rounded())
            if gap >= 0 { gaps.append(gap) }
        }
        let offScale = gaps.filter { $0 > 0 && !spacingScale.contains($0) }
        if offScale.count > 2 {
            findings.append(DesignQualityFinding(
                severity: .info,
                screen: screen.name,
                message: "\(offScale.count) vertical gaps are off the spacing scale (\(offScale.prefix(4).map(String.init).joined(separator: ", "))pt).",
                fix: "Use distributeChildren, or snap gaps to 8/12/16/24/32."
            ))
        }

        return findings
    }

    /// Content spilling out of its container, at ANY depth. The audit used to
    /// walk only a screen's direct children, so an image bleeding past a card
    /// two levels down reported "clean" while looking obviously broken.
    private static func auditOverflow(in node: DesignNode, screenName: String) -> [DesignQualityFinding] {
        var findings: [DesignQualityFinding] = []
        for child in node.children {
            let overRight = (child.x + child.width) - node.width
            let overBottom = (child.y + child.height) - node.height
            // 2pt of tolerance: sub-pixel rounding from layout maths is not a
            // design defect, and reporting it trains people to ignore the list.
            let spills = child.x < -2 || child.y < -2 || overRight > 2 || overBottom > 2
            // A clipping container is doing this on purpose (aspect-fill crop).
            if spills, node.clipContent != true {
                let by = max(overRight, overBottom).rounded()
                findings.append(DesignQualityFinding(
                    severity: .warning,
                    screen: screenName,
                    message: "\(child.name) (\(Int(child.width))×\(Int(child.height))) spills out of \(node.name) (\(Int(node.width))×\(Int(node.height))) by \(Int(max(by, 1)))pt.",
                    fix: "Resize the child to fit, or set clipContent on \(node.name) to crop it."
                ))
            }
            findings += auditOverflow(in: child, screenName: screenName)
        }
        return findings
    }

    /// A tab bar with four tabs and one screen behind it is the most common
    /// lie a generated design tells: it photographs like a finished app and
    /// ships as a dead end. Geometry checks can't see it, so this compares
    /// what the navigation PROMISES against the screens that actually exist.
    private static func auditNavigationPromises(screens: [DesignNode]) -> [DesignQualityFinding] {
        var findings: [DesignQualityFinding] = []
        let screenNames = screens.map { normalized($0.name) }

        for screen in screens {
            for bar in screen.children where isNavigationBar(bar) {
                var labels: [String] = []
                collectText(bar, into: &labels)

                let missing = labels.filter { label in
                    let key = normalized(label)
                    guard key.count > 1 else { return false }
                    // A tab matches when a screen name contains it or vice versa
                    // ("Outfits" ↔ "Outfits Screen").
                    return !screenNames.contains { $0.contains(key) || key.contains($0) }
                }
                guard !missing.isEmpty else { continue }
                findings.append(DesignQualityFinding(
                    severity: .warning,
                    screen: screen.name,
                    message: "\(bar.name) offers \(missing.count) destination(s) with no screen behind them: \(missing.joined(separator: ", ")).",
                    fix: "Create those screens, or remove the tabs — navigation that goes nowhere makes a demo look like an app."
                ))
            }
        }

        // A screen nothing links to can only be reached by editing the code.
        if screens.count > 1 {
            var referenced: Set<String> = [normalized(screens[0].name)]
            for screen in screens {
                var labels: [String] = []
                collectText(screen, into: &labels)
                for label in labels {
                    let key = normalized(label)
                    guard key.count > 1 else { continue }
                    for name in screens.map({ normalized($0.name) })
                    where name.contains(key) || key.contains(name) {
                        referenced.insert(name)
                    }
                }
            }
            for screen in screens where !referenced.contains(normalized(screen.name)) {
                findings.append(DesignQualityFinding(
                    severity: .info,
                    screen: screen.name,
                    message: "Nothing anywhere in the design points to \(screen.name).",
                    fix: "Add a control that navigates to it, or it ships unreachable."
                ))
            }
        }
        return findings
    }

    // MARK: - AppShots reference bar

    /// Higher-level production checks distilled from the 1,856-screen corpus.
    /// Geometry catches breakage; these catch the familiar AI-mockup tells:
    /// weak hierarchy, rainbow chrome, filler copy and unfinished assets.
    private static func auditReferenceQuality(_ screen: DesignNode) -> [DesignQualityFinding] {
        var findings: [DesignQualityFinding] = []
        let allNodes = flattenedChildren(of: screen)
        let screenKey = normalized(screen.name)
        let sparseState = ["splash", "loading", "permission", "empty", "error", "success"]
            .contains { screenKey.contains($0) }

        let meaningfulNodes = allNodes.filter { node in
            if (node.zIndex ?? 0) < 0 { return false }
            if node.name.lowercased().contains("background") { return false }
            return true
        }
        if !sparseState, meaningfulNodes.count < 5 {
            findings.append(DesignQualityFinding(
                severity: meaningfulNodes.count < 3 ? .blocker : .warning,
                screen: screen.name,
                message: "The screen has only \(meaningfulNodes.count) meaningful element(s), so it reads as unfinished.",
                fix: "Give it one focal section plus the controls/content required for its real task; do not add decorative filler."
            ))
        }

        let textNodes = allNodes.filter {
            $0.type == .Text && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        let displayRequired = ["home", "today", "feed", "dashboard", "explore", "onboarding", "welcome"]
            .contains { screenKey.contains($0) }
        let maximumType = textNodes.compactMap { $0.style.fontSize }.max() ?? 0
        if displayRequired, textNodes.count >= 2, maximumType < 22 {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "No text establishes a clear hierarchy (largest type is \(Int(maximumType))pt).",
                fix: "Promote the single most important title or metric to 24-34pt and keep supporting copy at 13-17pt."
            ))
        }

        let typeScale = Set(textNodes.compactMap { node -> Int? in
            guard let size = node.style.fontSize else { return nil }
            return Int(size.rounded())
        })
        // Registry components use small, purposeful optical adjustments
        // inside the same role (11/12 captions, 13/14 metadata, 15/16 body).
        // Treating seven such sizes as seven unrelated roles produced false
        // positives and pushed the loop to enlarge fitted list labels. Nine or
        // more distinct sizes is where a screen actually loses a coherent ramp.
        if typeScale.count > 8 {
            findings.append(DesignQualityFinding(
                severity: .info,
                screen: screen.name,
                message: "The screen uses \(typeScale.count) font sizes (\(typeScale.sorted().map(String.init).joined(separator: ", "))pt).",
                fix: "Collapse typography onto 11-13, 15-17, 20-24 and one 28-36 display size."
            ))
        }

        let fillerTerms = [
            "item", "featured", "subtitle", "title", "button", "lorem ipsum",
            "a focused content section", "a beautiful moment", "your content", "sample text"
        ]
        let filler = textNodes.compactMap(\.text).filter { raw in
            fillerTerms.contains(raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
        }
        if !filler.isEmpty {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "Placeholder copy is visible: \(Array(Set(filler)).prefix(4).joined(separator: ", ")).",
                fix: "Replace every placeholder with concise, believable product copy and real-looking values."
            ))
        }

        let normalizedText = Set(textNodes.compactMap(\.text).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        let factoryFallbackTrio: Set<String> = ["recent order", "delivered", "saved for later"]
        if factoryFallbackTrio.isSubset(of: normalizedText) {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "A stock component fallback is visible (Recent order / Delivered / Saved for later).",
                fix: "Pass item1Title/item1Subtitle/item1Amount through item3… using product-specific rows; never ship the component library's demo data."
            ))
        }

        let clippedText = textNodes.filter { node in
            guard let text = node.text, text.count > 3 else { return false }
            let measured = measuredWidth(of: node)
            let fontSize = node.style.fontSize ?? 16
            let visuallySingleLine = node.height < fontSize * 2.1
            let explicitlyWraps = node.textBehavior?.wrap == true && node.textBehavior?.maxLines != 1
            if visuallySingleLine && !explicitlyWraps && measured > node.width + 6 { return true }
            if explicitlyWraps {
                let lineCap = CGFloat(max(1, node.textBehavior?.maxLines ?? 99))
                let allowedHeight = min(node.height, lineCap * fontSize * 1.25)
                return measuredHeight(of: node, constrainedTo: node.width) > allowedHeight + 3
            }
            return false
        }
        if !clippedText.isEmpty {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "\(clippedText.count) label(s) are likely truncated at render time: \(clippedText.prefix(3).compactMap(\.text).joined(separator: ", ")).",
                fix: "Give the label its full row width, fit the font, or explicitly wrap to two lines; an ellipsis in a primary title is not acceptable."
            ))
        }

        let literalEllipses = textNodes.compactMap(\.text).filter {
            $0.contains("…") || $0.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("...")
        }
        if !literalEllipses.isEmpty {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "Visible copy contains ellipsis truncation: \(literalEllipses.prefix(3).joined(separator: ", ")).",
                fix: "Show the full product copy by fitting or wrapping it; do not bake truncation into a finished screen."
            ))
        }

        let machineProgress = textNodes.filter { node in
            guard normalized(node.name).contains("progressvalue"),
                  let raw = node.text?.trimmingCharacters(in: .whitespacesAndNewlines),
                  let numeric = Double(raw)
            else { return false }
            return raw.contains(".") && numeric >= 0 && numeric <= 1
        }
        if !machineProgress.isEmpty {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "A progress ring exposes a raw machine fraction (\(machineProgress.compactMap(\.text).joined(separator: ", "))).",
                fix: "Render a human metric such as 74%, 18.4 / 25 km, or 3.24 km; keep the 0...1 fraction internal."
            ))
        }

        let taskNeedsCTA = ["onboarding", "welcome", "setup", "configure", "live", "active", "checkout", "confirm"]
            .contains { screenKey.contains($0) }
        if taskNeedsCTA, !allNodes.contains(where: { $0.type == .Button }) {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "This task state has no visible action button for its next step.",
                fix: "Add one clear child control (Get Started, Continue, Finish, Confirm) and wire the flow to that control."
            ))
        }

        let unresolvedImages = allNodes.filter { node in
            guard node.type == .Image else { return false }
            let source = (node.imageSource ?? node.imageName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            return source.isEmpty || source.lowercased().contains("placeholder")
        }
        if !unresolvedImages.isEmpty {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "\(unresolvedImages.count) image slot(s) are still placeholders.",
                fix: "Generate or assign each intended asset, then inspect its crop in the rendered screenshot."
            ))
        }

        let chromeColors = Set(allNodes.flatMap { node in
            [node.style.fill, node.style.textColor, node.style.stroke].compactMap { canonicalHex($0) }
        })
        let accentColors = chromeColors.filter { saturation(of: $0) >= 0.28 }
        if accentColors.count > 7 {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: screen.name,
                message: "Interface chrome uses \(accentColors.count) saturated colours; the references use one brand accent plus semantic colours.",
                fix: "Keep one repeated brand accent and reserve extras for real states/data categories. Let imagery carry incidental colour."
            ))
        } else if accentColors.count > 5 {
            findings.append(DesignQualityFinding(
                severity: .info,
                screen: screen.name,
                message: "The palette has \(accentColors.count) saturated interface colours.",
                fix: "Check that every accent has a semantic role and remove decorative one-off colours."
            ))
        }

        let radiusScale = Set(allNodes.compactMap { node -> Int? in
            let radius = node.style.cornerRadius
            guard radius > 0, radius < 900 else { return nil }
            return Int(radius.rounded())
        })
        if radiusScale.count > 6 {
            findings.append(DesignQualityFinding(
                severity: .info,
                screen: screen.name,
                message: "The screen uses \(radiusScale.count) different corner radii.",
                fix: "Use one utility radius, one card radius, one hero radius and a pill token only where appropriate."
            ))
        }

        for nav in screen.children where isNavigationBar(nav) {
            let navRect = CGRect(x: nav.x, y: nav.y, width: nav.width, height: nav.height)
            let collisions = screen.children.filter { child in
                guard child.id != nav.id, !child.name.lowercased().contains("background") else { return false }
                let rect = CGRect(x: child.x, y: child.y, width: child.width, height: child.height)
                return rect.intersects(navRect) && rect.intersection(navRect).height > 4
            }
            if !collisions.isEmpty {
                findings.append(DesignQualityFinding(
                    severity: .warning,
                    screen: screen.name,
                    message: "\(collisions.count) fixed element(s) overlap the bottom navigation region.",
                    fix: "End fixed content above y=\(Int(nav.y)); put long content in a vertical scroll container."
                ))
            }
        }

        let densityRequired = ["home", "today", "setup", "progress", "profile", "settings", "feed", "dashboard", "onboarding", "welcome", "live"]
            .contains { screenKey.contains($0) }
        if densityRequired {
            let navigationTop = screen.children.first(where: isNavigationBar)?.y ?? (screen.height - 24)
            let contentBottom = screen.children
                .filter { !isNavigationBar($0) && !$0.name.lowercased().contains("background") }
                .map { $0.y + $0.height }
                .max() ?? 0
            let unusedBand = navigationTop - contentBottom
            if unusedBand > 160 {
                findings.append(DesignQualityFinding(
                    severity: .warning,
                    screen: screen.name,
                    message: "The screen leaves a \(Int(unusedBand))pt empty band before its bottom region, so it reads as a half-finished mockup.",
                    fix: "Add the next task-relevant section or a richer state, or rebalance component heights; do not fill the gap with decoration."
                ))
            }
        }

        return findings
    }

    private static func auditProductConsistency(screens: [DesignNode]) -> [DesignQualityFinding] {
        guard screens.count > 1 else { return [] }
        var findings: [DesignQualityFinding] = []

        let rootFills = Set(screens.compactMap { canonicalHex($0.style.fill) })
        if rootFills.count > 4 {
            findings.append(DesignQualityFinding(
                severity: .warning,
                screen: "(product system)",
                message: "The product uses \(rootFills.count) screen backgrounds, so the screens do not read as one family.",
                fix: "Choose one primary canvas and at most one intentional alternate surface for entry/media states."
            ))
        }

        let navFrames = screens.flatMap { screen in
            screen.children.filter { isNavigationBar($0) }.map { ($0.y, $0.height) }
        }
        if navFrames.count > 1 {
            let yValues = navFrames.map { Int($0.0.rounded()) }
            let heights = navFrames.map { Int($0.1.rounded()) }
            if (yValues.max() ?? 0) - (yValues.min() ?? 0) > 4 ||
                (heights.max() ?? 0) - (heights.min() ?? 0) > 4 {
                findings.append(DesignQualityFinding(
                    severity: .warning,
                    screen: "(product system)",
                    message: "Bottom navigation shifts size or position between screens.",
                    fix: "Use one shared navigation shell at the same y/height on every core screen."
                ))
            }
        }

        return findings
    }

    private static func isNavigationBar(_ node: DesignNode) -> Bool {
        let name = node.name.lowercased()
        return name.contains("nav") || name.contains("tab") || name.contains("bottom bar")
            || name.contains("bottombar") || name.contains("toolbar")
    }

    private static func collectText(_ node: DesignNode, into out: inout [String]) {
        if node.type == .Text,
           let text = node.text?.trimmingCharacters(in: .whitespacesAndNewlines),
           !text.isEmpty {
            out.append(text)
        }
        node.children.forEach { collectText($0, into: &out) }
    }

    /// Lowercased letters/digits only, so "Add Item" ↔ "AddItemScreen" match.
    private static func normalized(_ raw: String) -> String {
        raw.lowercased().filter { $0.isLetter || $0.isNumber }
    }

    // MARK: - Reporting

    /// One-line-per-issue summary appended to a mutating tool's result, so the
    /// agent sees the consequence of the call it just made.
    static func summary(_ findings: [DesignQualityFinding], limit: Int = 8) -> String {
        summary(report(findings: findings), limit: limit)
    }

    static func summary(_ report: DesignQualityReport, limit: Int = 8) -> String {
        let verdict = report.passesReferenceBar ? "REFERENCE BAR PASS ✓" : "REFERENCE BAR NOT MET"
        guard !report.findings.isEmpty else {
            return "Reference design score: 100/100 — REFERENCE BAR PASS ✓\nDesign check: clean — hierarchy, spacing, contrast, palette and tap targets passed."
        }

        let lines = report.findings
            .sorted { severityRank($0.severity) < severityRank($1.severity) }
            .prefix(limit)
            .map { "  \($0.severity.rawValue.uppercased()) [\($0.screen)] \($0.message) → \($0.fix)" }
        let more = report.findings.count > limit ? "\n  …and \(report.findings.count - limit) more." : ""
        return """
        Reference design score: \(report.score)/100 — \(verdict)
        Design check: \(report.blockerCount) blocker(s), \(report.warningCount) warning(s), \(report.infoCount) note(s).
        \(lines.joined(separator: "\n"))\(more)
        """
    }

    private static func severityRank(_ severity: DesignQualityFinding.Severity) -> Int {
        switch severity {
        case .blocker: return 0
        case .warning: return 1
        case .info: return 2
        }
    }

    // MARK: - Helpers

    private static func flattenedChildren(of node: DesignNode) -> [DesignNode] {
        node.children.flatMap { [$0] + flattenedChildren(of: $0) }
    }

    private static func canonicalHex(_ raw: String?) -> String? {
        guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
              value.hasPrefix("#") else { return nil }
        value.removeFirst()
        if value.count == 8, value.suffix(2) == "00" { return nil }
        if value.count == 8 { value = String(value.prefix(6)) }
        guard value.count == 6, Int(value, radix: 16) != nil else { return nil }
        return "#" + value
    }

    private static func saturation(of hex: String) -> Double {
        var value = hex
        if value.hasPrefix("#") { value.removeFirst() }
        guard let rgb = Int(value, radix: 16) else { return 0 }
        let red = Double((rgb >> 16) & 0xFF) / 255
        let green = Double((rgb >> 8) & 0xFF) / 255
        let blue = Double(rgb & 0xFF) / 255
        let maximum = max(red, green, blue)
        let minimum = min(red, green, blue)
        return maximum == 0 ? 0 : (maximum - minimum) / maximum
    }

    /// Backgrounds and decorative fills aren't "content" for padding purposes.
    private static func isContentNode(_ node: DesignNode) -> Bool {
        if (node.zIndex ?? 0) < 0 { return false }
        if node.name.lowercased().contains("background") { return false }
        // A child that fills the screen is a backdrop, not an inset element.
        return true
    }

    private static func isInteractive(_ node: DesignNode) -> Bool {
        switch node.type {
        case .Button, .Input: return true
        default: return node.name.lowercased().contains("button")
        }
    }

    private static func mostCommon(_ values: [Int]) -> Int? {
        guard !values.isEmpty else { return nil }
        let counts = Dictionary(values.map { ($0, 1) }, uniquingKeysWith: +)
        // Only treat it as the standard if it actually repeats.
        guard let (value, count) = counts.max(by: { $0.value < $1.value }), count > 1 else { return nil }
        return value
    }

    private static func measuredWidth(of node: DesignNode) -> CGFloat {
        guard let text = node.text else { return 0 }
        let font = NSFont.systemFont(ofSize: node.style.fontSize ?? 16)
        return (text as NSString).size(withAttributes: [.font: font]).width
    }

    private static func measuredHeight(of node: DesignNode, constrainedTo width: CGFloat) -> CGFloat {
        guard let text = node.text, width > 0 else { return 0 }
        let font = NSFont.systemFont(ofSize: node.style.fontSize ?? 16)
        let rect = (text as NSString).boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font]
        )
        return ceil(rect.height)
    }

    private static func nearestBackground(for child: DesignNode, in screen: DesignNode) -> String? {
        // A sibling behind this one wins; otherwise the screen's own fill.
        let behind = screen.children.first { sibling in
            sibling.id != child.id
                && (sibling.zIndex ?? 0) <= (child.zIndex ?? 0)
                && CGRect(x: sibling.x, y: sibling.y, width: sibling.width, height: sibling.height)
                    .contains(CGRect(x: child.x, y: child.y, width: child.width, height: child.height))
        }
        return behind?.style.fill ?? screen.style.fill
    }

    /// WCAG relative-luminance contrast ratio.
    static func contrastRatio(_ hexA: String, _ hexB: String) -> Double? {
        guard let a = relativeLuminance(hexA), let b = relativeLuminance(hexB) else { return nil }
        let lighter = max(a, b), darker = min(a, b)
        return (lighter + 0.05) / (darker + 0.05)
    }

    private static func relativeLuminance(_ hex: String) -> Double? {
        var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") { cleaned.removeFirst() }
        guard cleaned.count == 6, let value = Int(cleaned, radix: 16) else { return nil }
        let channels = [
            Double((value >> 16) & 0xFF) / 255.0,
            Double((value >> 8) & 0xFF) / 255.0,
            Double(value & 0xFF) / 255.0
        ].map { channel -> Double in
            channel <= 0.03928 ? channel / 12.92 : pow((channel + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }
}
