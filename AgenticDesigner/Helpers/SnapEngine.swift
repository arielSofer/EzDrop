//
//  SnapEngine.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation
import CoreGraphics

// מנוע שאחראי לחשב הצמדות בין אובייקטים בקנבס
enum SnapEngine {
    
    // כמה קרוב צריך להיות כדי להידבק
    static let threshold: CGFloat = 6
    
    // מחשב Snap עבור Node שנגרר למיקום חדש
    static func snap(
        draggedNode: DesignNode,
        proposedX: CGFloat,
        proposedY: CGFloat,
        otherNodes: [DesignNode]
    ) -> SnapResult {
        
        // יוצרים עותק של ה־Node עם המיקום החדש שהמשתמש מנסה להגיע אליו
        var movedNode = draggedNode
        movedNode.x = proposedX
        movedNode.y = proposedY
        
        var finalX = proposedX
        var finalY = proposedY
        
        var verticalGuideX: CGFloat?
        var horizontalGuideY: CGFloat?
        
        var bestXDistance = threshold
        var bestYDistance = threshold
        
        let draggedXAnchors = xAnchors(for: movedNode)
        let draggedYAnchors = yAnchors(for: movedNode)
        
        for target in otherNodes {
            let targetXAnchors = xAnchors(for: target)
            let targetYAnchors = yAnchors(for: target)
            
            // בדיקת Snap בציר X
            for draggedAnchor in draggedXAnchors {
                for targetAnchor in targetXAnchors {
                    let distance = abs(draggedAnchor.value - targetAnchor.value)
                    
                    if distance < bestXDistance {
                        bestXDistance = distance
                        
                        // מזיזים את ה־Node כך שהעוגן הנגרר יתיישר לעוגן היעד
                        finalX = proposedX + (targetAnchor.value - draggedAnchor.value)
                        verticalGuideX = targetAnchor.value
                    }
                }
            }
            
            // בדיקת Snap בציר Y
            for draggedAnchor in draggedYAnchors {
                for targetAnchor in targetYAnchors {
                    let distance = abs(draggedAnchor.value - targetAnchor.value)
                    
                    if distance < bestYDistance {
                        bestYDistance = distance
                        
                        // מזיזים את ה־Node כך שהעוגן הנגרר יתיישר לעוגן היעד
                        finalY = proposedY + (targetAnchor.value - draggedAnchor.value)
                        horizontalGuideY = targetAnchor.value
                    }
                }
            }
        }
        
        return SnapResult(
            x: finalX,
            y: finalY,
            guides: SnapGuides(
                verticalX: verticalGuideX,
                horizontalY: horizontalGuideY
            )
        )
    }
    
    // נקודות הצמדה בציר X: שמאל, מרכז, ימין
    private static func xAnchors(for node: DesignNode) -> [SnapAnchor] {
        [
            SnapAnchor(value: node.geometry.left),
            SnapAnchor(value: node.geometry.centerX),
            SnapAnchor(value: node.geometry.right)
        ]
    }
    
    // נקודות הצמדה בציר Y: למעלה, מרכז, למטה
    private static func yAnchors(for node: DesignNode) -> [SnapAnchor] {
        [
            SnapAnchor(value: node.geometry.top),
            SnapAnchor(value: node.geometry.centerY),
            SnapAnchor(value: node.geometry.bottom)
        ]
    }
}

// נקודת הצמדה אחת
private struct SnapAnchor {
    let value: CGFloat
}
