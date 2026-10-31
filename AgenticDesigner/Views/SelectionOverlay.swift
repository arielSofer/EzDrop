//
//  SelectionOverlay.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import SwiftUI

// נקודות אחיזה לשינוי גודל סביב האובייקט הנבחר
enum ResizeHandle {
    case topLeft
    case top
    case topRight
    case left
    case right
    case bottom
    case bottomLeft
    case bottomRight

    // Geometry a resize needs: which axes the handle drives, which way a drag
    // grows the box, and which edge stays pinned.
    var affectsHorizontally: Bool {
        switch self {
        case .top, .bottom: return false
        default: return true
        }
    }

    var affectsVertically: Bool {
        switch self {
        case .left, .right: return false
        default: return true
        }
    }

    /// +1 when dragging right grows the box, -1 when it shrinks it.
    var horizontalSign: CGFloat {
        switch self {
        case .topLeft, .left, .bottomLeft: return -1
        default: return 1
        }
    }

    var verticalSign: CGFloat {
        switch self {
        case .topLeft, .top, .topRight: return -1
        default: return 1
        }
    }

    /// Dragging a left handle keeps the right edge fixed (and vice versa).
    var anchorsRight: Bool {
        switch self {
        case .topLeft, .left, .bottomLeft: return true
        default: return false
        }
    }

    var anchorsBottom: Bool {
        switch self {
        case .topLeft, .top, .topRight: return true
        default: return false
        }
    }
}

struct SelectionOverlay: View {
    let rect: CGRect
    
    let onResizeChanged: (ResizeHandle, CGSize) -> Void
    let onResizeEnded: () -> Void
    
    private let visualHandleSize: CGFloat = 8
    private let hitAreaSize: CGFloat = 24
    
    var body: some View {
        ZStack(alignment: .topLeading) {
            // מסגרת הבחירה סביב האובייקט
            Rectangle()
                .stroke(Color.blue, lineWidth: 1.5)
                .frame(width: rect.width, height: rect.height)
                .position(
                    x: rect.midX,
                    y: rect.midY
                )
                .allowsHitTesting(false)
            
            resizeHandle(.topLeft)
                .position(x: rect.minX, y: rect.minY)
            
            resizeHandle(.top)
                .position(x: rect.midX, y: rect.minY)
            
            resizeHandle(.topRight)
                .position(x: rect.maxX, y: rect.minY)
            
            resizeHandle(.right)
                .position(x: rect.maxX, y: rect.midY)
            
            resizeHandle(.bottomRight)
                .position(x: rect.maxX, y: rect.maxY)
            
            resizeHandle(.bottom)
                .position(x: rect.midX, y: rect.maxY)
            
            resizeHandle(.bottomLeft)
                .position(x: rect.minX, y: rect.maxY)
            
            resizeHandle(.left)
                .position(x: rect.minX, y: rect.midY)
        }
        .zIndex(1000)
        .transaction { transaction in
            // מונע אנימציות בזמן resize
            transaction.animation = nil
        }
    }
    
    // יוצר Handle קטן עם שטח לחיצה גדול יותר
    private func resizeHandle(_ handle: ResizeHandle) -> some View {
        ZStack {
            Rectangle()
                .fill(Color.clear)
                .frame(width: hitAreaSize, height: hitAreaSize)
            
            Rectangle()
                .fill(Color.white)
                .frame(width: visualHandleSize, height: visualHandleSize)
                .overlay(
                    Rectangle()
                        .stroke(Color.blue, lineWidth: 1.5)
                )
        }
        .contentShape(Rectangle())
        .gesture(
            DragGesture(
                minimumDistance: 0,
                coordinateSpace: .named(CanvasCoordinateSpace.name)
            )
            .onChanged { value in
                onResizeChanged(handle, value.translation)
            }
            .onEnded { _ in
                onResizeEnded()
            }
        )
    }
}
