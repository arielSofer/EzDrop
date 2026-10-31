//
//  ConnectionLineView.swift
//  AgenticDesigner
//
//  Renders a single Bézier wire between an output port and an input port.
//

import SwiftUI

struct ConnectionLineView: View {
    let startPoint: CGPoint
    let endPoint: CGPoint
    let color: Color
    var isSelected: Bool = false
    var isAnimating: Bool = false

    var body: some View {
        wirePath
            .stroke(color, style: StrokeStyle(
                lineWidth: isSelected ? 3 : 2,
                lineCap: .round,
                dash: isAnimating ? [8, 4] : []
            ))
            .shadow(color: isSelected ? color.opacity(0.5) : .clear, radius: 4)
    }

    private var wirePath: Path {
        Path { path in
            path.move(to: startPoint)
            let controlOffset = max(24, abs(endPoint.y - startPoint.y) * 0.5)
            path.addCurve(
                to: endPoint,
                control1: CGPoint(x: startPoint.x, y: startPoint.y + controlOffset),
                control2: CGPoint(x: endPoint.x, y: endPoint.y - controlOffset)
            )
        }
    }

    // Used for hit-testing wire selection from the canvas.
    static func midpoint(from start: CGPoint, to end: CGPoint) -> CGPoint {
        CGPoint(x: (start.x + end.x) / 2, y: (start.y + end.y) / 2)
    }
}
