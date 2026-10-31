//
//  ColorHex.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import SwiftUI
#if os(macOS)
import AppKit
#endif

extension Color {
    init(hex: String) {
        let source = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        
        if let rgba = Self.parseRGBColor(source) {
            self.init(
                .sRGB,
                red: rgba.red,
                green: rgba.green,
                blue: rgba.blue,
                opacity: rgba.alpha
            )
            return
        }
        
        switch source.lowercased() {
        case "transparent", "clear":
            self.init(.sRGB, red: 0, green: 0, blue: 0, opacity: 0)
            return
        case "white":
            self.init(.sRGB, red: 1, green: 1, blue: 1, opacity: 1)
            return
        case "black":
            self.init(.sRGB, red: 0, green: 0, blue: 0, opacity: 1)
            return
        default:
            break
        }
        
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        
        let r, g, b, a: UInt64
        
        switch hex.count {
        case 8:
            r = (int >> 24) & 0xFF
            g = (int >> 16) & 0xFF
            b = (int >> 8) & 0xFF
            a = int & 0xFF
        case 6:
            r = (int >> 16) & 0xFF
            g = (int >> 8) & 0xFF
            b = int & 0xFF
            a = 0xFF
        default:
            r = 0
            g = 0
            b = 0
            a = 0xFF
        }
        
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
    
    private static func parseRGBColor(_ source: String) -> (red: Double, green: Double, blue: Double, alpha: Double)? {
        let normalized = source
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        
        guard normalized.hasPrefix("rgb"),
              let open = normalized.firstIndex(of: "("),
              let close = normalized.lastIndex(of: ")"),
              open < close
        else {
            return nil
        }
        
        let body = normalized[normalized.index(after: open)..<close]
        let parts = body
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        
        guard parts.count == 3 || parts.count == 4,
              let red = parseColorChannel(parts[0]),
              let green = parseColorChannel(parts[1]),
              let blue = parseColorChannel(parts[2])
        else {
            return nil
        }
        
        let alpha = parts.count == 4 ? (parseAlphaChannel(parts[3]) ?? 1) : 1
        
        return (
            red: min(max(red, 0), 1),
            green: min(max(green, 0), 1),
            blue: min(max(blue, 0), 1),
            alpha: min(max(alpha, 0), 1)
        )
    }
    
    private static func parseColorChannel(_ value: String) -> Double? {
        if value.hasSuffix("%"),
           let number = Double(value.dropLast()) {
            return number / 100
        }
        
        guard let number = Double(value) else { return nil }
        return number > 1 ? number / 255 : number
    }
    
    private static func parseAlphaChannel(_ value: String) -> Double? {
        if value.hasSuffix("%"),
           let number = Double(value.dropLast()) {
            return number / 100
        }
        
        return Double(value)
    }
    
    var hexString: String {
        #if os(macOS)
        let color = NSColor(self).usingColorSpace(.sRGB) ?? .black
        let red = Int((color.redComponent * 255).rounded())
        let green = Int((color.greenComponent * 255).rounded())
        let blue = Int((color.blueComponent * 255).rounded())
        
        return String(format: "#%02X%02X%02X", red, green, blue)
        #else
        return "#000000"
        #endif
    }
}
