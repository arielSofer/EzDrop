//
//  ThemeApplier.swift
//  AgenticDesigner
//
//  Live re-theming: re-skins an existing project into any VisualStylePreset.
//  Works on real canvases (agent-generated or hand-built) by classifying the
//  colors already in use into semantic roles — background, surface, accent,
//  text — using area, frequency, luminance and saturation, then remapping
//  every role to the target preset's tokens. Deterministic and instant; the
//  caller checkpoints first so a theme change is one click to revert.
//

import Foundation
import CoreGraphics

@MainActor
enum ThemeApplier {

    // MARK: - Public

    /// Re-themes every page of the project. Returns the number of node
    /// styles rewritten.
    @discardableResult
    static func apply(_ preset: VisualStylePreset, to viewModel: ProjectViewModel) -> Int {
        let tokens = DesignTokenLibrary.tokens(for: preset)
        var stats = ColorStats()
        for page in viewModel.project.pages {
            for node in page.nodes { collect(node, into: &stats) }
        }
        let mapping = roleMapping(from: stats, to: tokens.colors)
        guard !mapping.fills.isEmpty || !mapping.texts.isEmpty else { return 0 }

        var changed = 0
        var project = viewModel.project
        for pageIndex in project.pages.indices {
            for nodeIndex in project.pages[pageIndex].nodes.indices {
                rewrite(&project.pages[pageIndex].nodes[nodeIndex], mapping: mapping, changed: &changed)
            }
        }
        viewModel.replaceProject(project)
        return changed
    }

    // MARK: - Usage statistics

    private struct ColorStats {
        var fillArea: [String: CGFloat] = [:]       // normalized hex -> covered area
        var buttonFills: Set<String> = []
        var textUse: [String: Int] = [:]            // normalized hex -> count
        var strokes: Set<String> = []
    }

    private static func collect(_ node: DesignNode, into stats: inout ColorStats) {
        if let hex = normalize(node.style.fill) {
            stats.fillArea[hex, default: 0] += max(1, node.width * node.height)
            if node.type == .Button { stats.buttonFills.insert(hex) }
        }
        if let stroke = node.style.stroke, let hex = normalize(stroke) {
            stats.strokes.insert(hex)
        }
        if let text = node.style.textColor, let hex = normalize(text) {
            stats.textUse[hex, default: 0] += 1
        }
        for child in node.children { collect(child, into: &stats) }
    }

    // MARK: - Role classification

    /// Separate maps: a color used both as a fill and as a text color (white,
    /// typically) must resolve to a fill role and a text role independently.
    private struct RoleMapping {
        var fills: [String: String] = [:]
        var texts: [String: String] = [:]
    }

    private static func roleMapping(from stats: ColorStats, to colors: ColorTokens) -> RoleMapping {
        var mapping = RoleMapping()

        let fillsByArea = stats.fillArea.sorted { $0.value > $1.value }.map(\.key)
        let background = fillsByArea.first
        let surface = fillsByArea.dropFirst().first

        // Accent: the most saturated color used on a button, else the most
        // saturated fill that isn't background/surface. A canvas with no
        // genuinely saturated color has no accent to remap — promoting a
        // pale decorative tint to accent paints random blobs in brand color.
        let accentCandidates = stats.buttonFills.isEmpty
            ? Set(fillsByArea.dropFirst(2))
            : stats.buttonFills
        let accent = accentCandidates
            .filter { saturation($0) >= 0.25 }
            .max { saturation($0) < saturation($1) }

        let textsByUse = stats.textUse.sorted { $0.value > $1.value }.map(\.key)
        let textPrimary = textsByUse.first
        let textSecondary = textsByUse.dropFirst().first

        // Fill colors may only become fill roles and text colors text roles —
        // a pale header tint must never turn into a text-gray block.
        var fillAnchors: [String: String] = [:]
        if let background { fillAnchors[background] = colors.backgroundPrimary }
        if let surface { fillAnchors[surface] = colors.surfacePrimary }
        if let accent { fillAnchors[accent] = colors.accentPrimary }

        var textAnchors: [String: String] = [:]
        if let textPrimary { textAnchors[textPrimary] = colors.textPrimary }
        if let textSecondary { textAnchors[textSecondary] = colors.textSecondary }

        let totalArea = max(1, stats.fillArea.values.reduce(0, +))
        for (hex, area) in stats.fillArea where fillAnchors[hex] == nil {
            // Large or washed-out fills are surfaces, never accents.
            let accentEligible = saturation(hex) >= 0.25 && area / totalArea < 0.03
            let candidates = fillAnchors.keys.filter { candidate in
                accentEligible || fillAnchors[candidate] != colors.accentPrimary
            }
            if let nearest = candidates.min(by: { distance(hex, $0) < distance(hex, $1) }) {
                mapping.fills[hex] = fillAnchors[nearest]
            }
        }
        for hex in stats.textUse.keys where textAnchors[hex] == nil {
            if let nearest = textAnchors.keys.min(by: { distance(hex, $0) < distance(hex, $1) }) {
                mapping.texts[hex] = textAnchors[nearest]
            }
        }
        for (hex, new) in fillAnchors { mapping.fills[hex] = new }
        for (hex, new) in textAnchors { mapping.texts[hex] = new }
        for stroke in stats.strokes where mapping.fills[stroke] == nil {
            mapping.fills[stroke] = colors.borderSubtle
        }
        return mapping
    }

    // MARK: - Rewrite

    private static func rewrite(_ node: inout DesignNode, mapping: RoleMapping, changed: inout Int) {
        var touched = false
        // Image placeholders keep their fill — recoloring them reads as a bug.
        if node.type != .Image,
           let hex = normalize(node.style.fill), let new = mapping.fills[hex], new != node.style.fill {
            node.style.fill = new
            touched = true
        }
        if let stroke = node.style.stroke, let hex = normalize(stroke), let new = mapping.fills[hex] {
            node.style.stroke = new
            touched = true
        }
        if let text = node.style.textColor, let hex = normalize(text), let new = mapping.texts[hex] {
            node.style.textColor = new
            touched = true
        }
        if touched { changed += 1 }
        for index in node.children.indices {
            rewrite(&node.children[index], mapping: mapping, changed: &changed)
        }
    }

    // MARK: - Color math

    private static func normalize(_ raw: String) -> String? {
        var hex = raw.trimmingCharacters(in: .whitespaces).uppercased()
        guard hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        if hex.count == 8 { hex = String(hex.prefix(6)) } // drop alpha
        guard hex.count == 6, hex.allSatisfy({ $0.isHexDigit }) else { return nil }
        return "#" + hex
    }

    private static func rgb(_ hex: String) -> (r: CGFloat, g: CGFloat, b: CGFloat) {
        var value: UInt64 = 0
        Scanner(string: String(hex.dropFirst())).scanHexInt64(&value)
        return (
            CGFloat((value >> 16) & 0xFF) / 255,
            CGFloat((value >> 8) & 0xFF) / 255,
            CGFloat(value & 0xFF) / 255
        )
    }

    private static func saturation(_ hex: String) -> CGFloat {
        let c = rgb(hex)
        let maxC = max(c.r, c.g, c.b), minC = min(c.r, c.g, c.b)
        return maxC == 0 ? 0 : (maxC - minC) / maxC
    }

    private static func distance(_ a: String, _ b: String) -> CGFloat {
        let ca = rgb(a), cb = rgb(b)
        return pow(ca.r - cb.r, 2) + pow(ca.g - cb.g, 2) + pow(ca.b - cb.b, 2)
    }
}
