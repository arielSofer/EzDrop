//
//  GradientStyle.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 05/07/2026.
//

import Foundation
import CoreGraphics

/// Describes a gradient fill for design nodes.
/// Supports linear and radial gradients with configurable colors, angle, and stops.
struct GradientStyle: Codable {
    /// "linear" or "radial"
    let type: String
    /// Array of hex color strings, e.g. ["#071B4D", "#126BFF"]
    let colors: [String]
    /// Degrees for linear gradient direction (0 = top-to-bottom, 90 = left-to-right, etc.)
    let angle: CGFloat?
    /// Stop positions between 0.0 and 1.0, must match colors count
    let stops: [CGFloat]?
    
    init(type: String = "linear", colors: [String], angle: CGFloat? = nil, stops: [CGFloat]? = nil) {
        self.type = type
        self.colors = colors
        self.angle = angle
        self.stops = stops
    }
    
    init(from decoder: Decoder) throws {
        let singleValue = try decoder.singleValueContainer()
        
        if let colors = try? singleValue.decode([String].self) {
            self.init(colors: colors)
            return
        }
        
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedType = try container.decodeIfPresent(String.self, forKey: .type) ?? "linear"
        let decodedColors = try container.decodeIfPresent([String].self, forKey: .colors) ?? []
        let decodedAngle = try container.decodeIfPresent(CGFloat.self, forKey: .angle)
        let decodedStops = try container.decodeIfPresent([CGFloat].self, forKey: .stops)
        
        self.init(
            type: decodedType,
            colors: decodedColors,
            angle: decodedAngle,
            stops: decodedStops
        )
    }
    
    private enum CodingKeys: String, CodingKey {
        case type
        case colors
        case angle
        case stops
    }
}
