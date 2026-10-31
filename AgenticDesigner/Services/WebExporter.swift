//
//  WebExporter.swift
//  AgenticDesigner
//
//  Turns the DesignNode tree into a real, self-contained web page — the
//  foundation of the Lovable-style loop: the same HTML drives the live
//  in-app web preview AND the deployable artifact. No build toolchain: one
//  responsive .html file that runs anywhere (WKWebView, any browser, any
//  static host). Children are positioned relative to their parent (matching
//  the canvas), so the web render mirrors the design.
//

import Foundation
import CoreGraphics

enum WebExporter {

    /// A complete, standalone HTML document. With `flows`, the page is a REAL
    /// interactive app: taps run the logic (navigation, state, toasts) and
    /// node bindings re-render — the same behavior as the in-app preview.
    /// Without flows it degrades to a faithful static gallery.
    static func html(
        for screens: [DesignNode],
        appName: String,
        flows: [LogicFlow] = [],
        globalVariables: [LogicVariable] = [],
        supabase: SupabaseConfig? = nil,
        interactive: Bool = true
    ) -> String {
        let runtime = interactive && !flows.isEmpty
            ? LogicWebCompiler.compile(
                screens: screens, flows: flows, globals: globalVariables, supabase: supabase
              )
            : nil

        let mockups = screens.enumerated().map { index, screen in
            let inner = childrenHTML(screen.children)
            let frameStyle = style(for: screen, isScreenRoot: true)
            // Interactive: one device at a time, JS swaps screens.
            let hidden = runtime != nil && index > 0 ? " hidden" : ""
            return """
            <div class="screen\(hidden)" data-screen-id="\(screen.id.uuidString)">
              <div class="device" style="\(frameStyle)">\(inner)</div>
              <div class="screen-label">\(escape(screen.name))</div>
            </div>
            """
        }.joined(separator: "\n")

        let navBar = runtime == nil ? "" : """
        <div class="screen-nav">
          \(screens.map { "<button data-goto=\"\($0.id.uuidString)\">\(escape($0.name))</button>" }.joined(separator: "\n"))
        </div>
        """

        // The program is a parsed JSON block + a separate runtime script —
        // never user text spliced into executable JS (see the XSS note in the
        // compiler).
        let script = runtime.map { "\($0.dataBlock)\n\($0.runtimeScript)" } ?? ""

        return """
        <!doctype html>
        <html lang="en">
        <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>\(escape(appName))</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          html, body { min-height: 100%; }
          body {
            background: #EDF0F4;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            -webkit-font-smoothing: antialiased;
            padding: 32px 40px 48px;
            display: flex; flex-wrap: wrap; gap: 48px;
            align-items: flex-start; justify-content: center;
          }
          .screen { display: flex; flex-direction: column; align-items: center; gap: 12px; }
          .screen.hidden { display: none; }
          .device { position: relative; overflow: hidden; flex: none;
                    box-shadow: 0 24px 60px rgba(20,28,45,0.18); }
          .screen-label { font-size: 13px; color: #6B7280; font-weight: 500; }
          .node { position: absolute; }
          .btn { border: none; cursor: pointer; display: flex;
                 align-items: center; justify-content: center; }
          input.node { outline: none; }
          .img-ph { display: flex; align-items: center; justify-content: center;
                    color: #9AA3AF; font-size: 12px; background: #E7EBF0; }
          [data-tap] { cursor: pointer; transition: transform .08s ease, filter .12s ease; }
          [data-tap]:active { transform: scale(0.97); filter: brightness(0.94); }
          .screen-nav { width: 100%; display: flex; gap: 8px; justify-content: center;
                        flex-wrap: wrap; margin-bottom: 4px; }
          .screen-nav button { border: none; background: #FFFFFF; color: #4B5563;
                               padding: 7px 14px; border-radius: 999px; cursor: pointer;
                               font-size: 12px; font-weight: 600;
                               box-shadow: 0 1px 3px rgba(20,28,45,0.10); }
          .screen-nav button.active { background: #111827; color: #FFFFFF; }
          #toast { position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
                   background: rgba(17,24,39,0.94); color: #fff; padding: 12px 20px;
                   border-radius: 12px; font-size: 14px; opacity: 0; pointer-events: none;
                   transition: opacity .2s ease, transform .2s ease; z-index: 99; }
          #toast.show { opacity: 1; transform: translateX(-50%) translateY(-6px); }
          @media (prefers-color-scheme: dark) { body { background: #0F1115; } }
        </style>
        </head>
        <body>
        \(navBar)
        \(mockups)
        <div id="toast"></div>
        \(script)
        </body>
        </html>
        """
    }

    // MARK: - Node rendering

    private static func childrenHTML(_ children: [DesignNode]) -> String {
        children
            .sorted { ($0.zIndex ?? 0) < ($1.zIndex ?? 0) }
            .map(nodeHTML)
            .joined(separator: "\n")
    }

    private static func nodeHTML(_ node: DesignNode) -> String {
        let s = style(for: node, isScreenRoot: false)
        // The runtime finds nodes by id to run taps and apply bindings.
        let id = " data-node-id=\"\(node.id.uuidString)\""
        switch node.type {
        case .Text:
            return "<div class=\"node\"\(id) style=\"\(s)\">\(escape(node.text ?? ""))</div>"
        case .Button:
            return "<button class=\"node btn\"\(id) style=\"\(s)\">\(escape(node.text ?? ""))</button>"
        case .Input:
            let placeholder = escape(node.text ?? "")
            return "<input class=\"node\"\(id) placeholder=\"\(placeholder)\" style=\"\(s)\">"
        case .Image:
            if let src = node.imageSource ?? node.imageName, isRenderableSource(src) {
                return "<img class=\"node\"\(id) src=\"\(escape(src))\" style=\"\(s)object-fit:cover;\">"
            }
            return "<div class=\"node img-ph\"\(id) style=\"\(s)\">\(escape(node.text ?? "image"))</div>"
        case .Icon:
            let glyph = iconGlyph(node.iconName)
            return "<div class=\"node\"\(id) style=\"\(s)display:flex;align-items:center;justify-content:center;font-size:\(Int(min(node.width, node.height) * 0.7))px;\">\(glyph)</div>"
        case .Rectangle, .Frame:
            return "<div class=\"node\"\(id) style=\"\(s)\">\(childrenHTML(node.children))</div>"
        }
    }

    // MARK: - Style

    private static func style(for node: DesignNode, isScreenRoot: Bool) -> String {
        var css: [String] = []
        let st = node.style

        if !isScreenRoot {
            css.append("left:\(px(node.x))")
            css.append("top:\(px(node.y))")
        }
        css.append("width:\(px(node.width))")
        css.append("height:\(px(node.height))")

        // Background: gradient wins over flat fill.
        if let gradient = st.gradient, gradient.colors.count >= 2 {
            css.append("background:\(cssGradient(gradient))")
        } else if isRenderableColor(st.fill) {
            css.append("background:\(st.fill)")
        }

        if let stroke = st.stroke, isRenderableColor(stroke), (st.strokeWidth ?? 0) > 0 {
            css.append("border:\(px(st.strokeWidth ?? 1)) solid \(stroke)")
        }
        css.append("border-radius:\(px(st.cornerRadius))")
        if st.opacity < 1 { css.append("opacity:\(st.opacity)") }
        if let blur = st.blur, blur > 0 { css.append("backdrop-filter:blur(\(px(blur)))") }

        if let shadow = st.shadow, shadow.opacity > 0 {
            css.append("box-shadow:\(px(shadow.x)) \(px(shadow.y)) \(px(shadow.radius)) \(rgba(shadow.color, shadow.opacity))")
        }

        // Text styling (applies to Text/Button/Input).
        if let size = st.fontSize { css.append("font-size:\(px(size))") }
        if let weight = st.fontWeight { css.append("font-weight:\(cssWeight(weight))") }
        if let color = st.textColor, isRenderableColor(color) { css.append("color:\(color)") }
        if let align = st.textAlign { css.append("text-align:\(align)") }
        if let ls = st.letterSpacing { css.append("letter-spacing:\(px(ls))") }
        if node.type == .Text {
            css.append("display:flex")
            css.append("align-items:center")
            if st.textAlign == "center" { css.append("justify-content:center") }
            css.append("overflow:hidden")
        }

        // Padding.
        let pt = st.paddingTop ?? 0, pr = st.paddingRight ?? 0
        let pb = st.paddingBottom ?? 0, pl = st.paddingLeft ?? 0
        if pt + pr + pb + pl > 0 {
            css.append("padding:\(px(pt)) \(px(pr)) \(px(pb)) \(px(pl))")
        }

        // Flex layout when the node declares a stack direction.
        if let layout = st.layout?.lowercased() {
            let isRow = ["row", "horizontal", "hstack"].contains(layout)
            css.append("display:flex")
            css.append("flex-direction:\(isRow ? "row" : "column")")
            if let spacing = st.spacing { css.append("gap:\(px(spacing))") }
        }

        return css.joined(separator: ";") + ";"
    }

    // MARK: - Helpers

    private static func px(_ v: CGFloat) -> String {
        "\(Int(v.rounded()))px"
    }

    private static func cssWeight(_ weight: String) -> String {
        switch weight.lowercased() {
        case "bold": return "700"
        case "semibold": return "600"
        case "medium": return "500"
        case "light": return "300"
        case "heavy", "black": return "800"
        default: return weight.allSatisfy(\.isNumber) ? weight : "400"
        }
    }

    private static func cssGradient(_ g: GradientStyle) -> String {
        // SwiftUI angle: 0 = top→bottom, 90 = left→right. CSS: 180 = to bottom.
        let cssAngle = 180 - (g.angle ?? 0)
        let stops: [String]
        if let positions = g.stops, positions.count == g.colors.count {
            stops = zip(g.colors, positions).map { "\($0.0) \(Int($0.1 * 100))%" }
        } else {
            stops = g.colors
        }
        if g.type.lowercased() == "radial" {
            return "radial-gradient(circle, \(stops.joined(separator: ", ")))"
        }
        return "linear-gradient(\(Int(cssAngle))deg, \(stops.joined(separator: ", ")))"
    }

    private static func rgba(_ hex: String, _ opacity: Double) -> String {
        let clean = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard clean.count == 6, let value = UInt64(clean, radix: 16) else {
            return "rgba(0,0,0,\(opacity))"
        }
        let r = (value >> 16) & 0xFF, g = (value >> 8) & 0xFF, b = value & 0xFF
        return "rgba(\(r),\(g),\(b),\(opacity))"
    }

    private static func isRenderableColor(_ hex: String?) -> Bool {
        guard let hex, hex.hasPrefix("#") else { return false }
        return hex.count == 7 || hex.count == 9 || hex.count == 4
    }

    private static func isRenderableSource(_ src: String) -> Bool {
        src.hasPrefix("http") || src.hasPrefix("data:") || src.hasPrefix("/")
    }

    // A pragmatic SF-Symbol → emoji map for the web preview (icons are
    // decorative in these designs; exact glyphs aren't load-bearing).
    private static func iconGlyph(_ name: String?) -> String {
        guard let name = name?.lowercased() else { return "•" }
        let map: [String: String] = [
            "house": "🏠", "house.fill": "🏠", "magnifyingglass": "🔍",
            "heart": "♡", "heart.fill": "♥", "person": "👤", "person.fill": "👤",
            "person.crop.circle": "👤", "bell": "🔔", "bell.fill": "🔔",
            "gear": "⚙", "gearshape": "⚙", "plus": "＋", "star": "★", "star.fill": "★",
            "chart.bar": "📊", "chart.bar.fill": "📊", "cart": "🛒", "cart.fill": "🛒",
            "bag": "🛍", "creditcard": "💳", "calendar": "📅", "clock": "🕐",
            "map": "🗺", "location": "📍", "message": "💬", "paperplane": "➤",
            "bookmark": "🔖", "flame": "🔥", "bolt": "⚡", "checkmark": "✓",
            "chevron.right": "›", "chevron.left": "‹", "arrow.left": "←", "xmark": "✕",
        ]
        return map[name] ?? "•"
    }

    private static func escape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}
