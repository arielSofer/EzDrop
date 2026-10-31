//
//  BrandKit.swift
//  AgenticDesigner
//
//  Turns a generic generated app into *your* product: a brand accent (and
//  optional neutrals) applied across every screen, and persisted with the
//  project so future agent runs, templates and theme switches keep the
//  identity instead of reverting to stock palettes.
//
//  Themes decide the mood (light/dark/warm); the brand decides the colour of
//  the things that carry identity — CTAs, active states, highlights.
//

import Foundation
import AppKit

struct BrandIdentity: Codable, Equatable {
    var accent: String                 // hex, e.g. "#F0653C"
    var accentSecondary: String?
    var name: String?

    static let none = BrandIdentity(accent: "", accentSecondary: nil, name: nil)
    var isSet: Bool { accent.hasPrefix("#") && accent.count >= 7 }
}

@MainActor
enum BrandKit {

    /// Re-colors every accent-role element to the brand accent. Returns the
    /// number of node styles changed.
    @discardableResult
    static func apply(_ brand: BrandIdentity, to viewModel: ProjectViewModel) -> Int {
        guard brand.isSet else { return 0 }

        // The accent in use today = the most saturated colour on buttons (the
        // same rule ThemeApplier uses), so we recolor exactly what reads as
        // "the brand colour" rather than repainting every surface.
        var accentColors: Set<String> = []
        var project = viewModel.project

        func collect(_ node: DesignNode) {
            if let hex = normalize(node.style.fill), isVivid(hex) {
                if node.type == .Button || isAccentSized(node) { accentColors.insert(hex) }
            }
            if let text = node.style.textColor, let hex = normalize(text), isVivid(hex) {
                accentColors.insert(hex)
            }
            node.children.forEach(collect)
        }
        for page in project.pages { page.nodes.forEach(collect) }
        guard !accentColors.isEmpty else {
            project.brand = brand
            viewModel.replaceProject(project)
            return 0
        }

        var changed = 0
        func recolor(_ node: inout DesignNode) {
            if let hex = normalize(node.style.fill), accentColors.contains(hex) {
                node.style.fill = brand.accent
                changed += 1
            }
            if let text = node.style.textColor, let hex = normalize(text), accentColors.contains(hex) {
                node.style.textColor = brand.accent
                changed += 1
            }
            // Gradients that ride on the accent get retinted end-to-end.
            if let gradient = node.style.gradient,
               gradient.colors.contains(where: { normalize($0).map { accentColors.contains($0) } ?? false }) {
                node.style.gradient = GradientStyle(
                    type: gradient.type,
                    colors: [brand.accent, brand.accentSecondary ?? shade(brand.accent, by: -0.18)],
                    angle: gradient.angle,
                    stops: gradient.stops
                )
                changed += 1
            }
            for index in node.children.indices { recolor(&node.children[index]) }
        }
        for pageIndex in project.pages.indices {
            for nodeIndex in project.pages[pageIndex].nodes.indices {
                recolor(&project.pages[pageIndex].nodes[nodeIndex])
            }
        }

        project.brand = brand
        viewModel.replaceProject(project)
        return changed
    }

    /// A theme change repaints with stock tokens — re-stamp the brand after it
    /// so identity survives re-theming.
    @discardableResult
    static func reapplyIfSet(to viewModel: ProjectViewModel) -> Int {
        guard let brand = viewModel.project.brand, brand.isSet else { return 0 }
        return apply(brand, to: viewModel)
    }

    // MARK: - Colour helpers

    /// Small, strongly-coloured elements read as accents (badges, pills, dots)
    /// even when they aren't Buttons.
    private static func isAccentSized(_ node: DesignNode) -> Bool {
        node.width * node.height < 42_000
    }

    private static func normalize(_ raw: String?) -> String? {
        guard var hex = raw?.trimmingCharacters(in: .whitespaces).uppercased(),
              hex.hasPrefix("#") else { return nil }
        hex.removeFirst()
        if hex.count == 8 { hex = String(hex.prefix(6)) }
        guard hex.count == 6, hex.allSatisfy({ $0.isHexDigit }) else { return nil }
        return "#" + hex
    }

    private static func rgb(_ hex: String) -> (r: Double, g: Double, b: Double) {
        var value: UInt64 = 0
        Scanner(string: String(hex.dropFirst())).scanHexInt64(&value)
        return (
            Double((value >> 16) & 0xFF) / 255,
            Double((value >> 8) & 0xFF) / 255,
            Double(value & 0xFF) / 255
        )
    }

    private static func saturation(_ hex: String) -> Double {
        let c = rgb(hex)
        let maxC = max(c.r, c.g, c.b), minC = min(c.r, c.g, c.b)
        return maxC == 0 ? 0 : (maxC - minC) / maxC
    }

    private static func brightness(_ hex: String) -> Double {
        let c = rgb(hex)
        return max(c.r, c.g, c.b)
    }

    /// A colour that reads as "the brand colour" to a human. Saturation alone
    /// is not enough: dark navy text (#0F172A) is highly saturated but reads
    /// as near-black — recolouring it turns every heading into the accent.
    private static func isVivid(_ hex: String) -> Bool {
        saturation(hex) >= 0.35 && brightness(hex) >= 0.45
    }

    /// Darker (negative) or lighter (positive) variant — used for gradient ends.
    static func shade(_ hex: String, by amount: Double) -> String {
        guard let clean = normalize(hex) else { return hex }
        let c = rgb(clean)
        func adjust(_ v: Double) -> Int {
            Int((amount < 0 ? v * (1 + amount) : v + (1 - v) * amount).clamped(0, 1) * 255)
        }
        return String(format: "#%02X%02X%02X", adjust(c.r), adjust(c.g), adjust(c.b))
    }
}

private extension Double {
    func clamped(_ low: Double, _ high: Double) -> Double { Swift.min(Swift.max(self, low), high) }
}
