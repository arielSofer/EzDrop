//
//  NodeGeometry.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//
import Foundation
import CoreGraphics

// כלי עזר לחישובי מיקום וגודל של DesignNode
struct NodeGeometry {
    let node: DesignNode
    
    // הקצה השמאלי של האובייקט
    var left: CGFloat {
        node.x
    }
    
    // הקצה העליון של האובייקט
    var top: CGFloat {
        node.y
    }
    
    // הקצה הימני של האובייקט
    var right: CGFloat {
        node.x + node.width
    }
    
    // הקצה התחתון של האובייקט
    var bottom: CGFloat {
        node.y + node.height
    }
    
    // מרכז האובייקט בציר X
    var centerX: CGFloat {
        node.x + node.width / 2
    }
    
    // מרכז האובייקט בציר Y
    var centerY: CGFloat {
        node.y + node.height / 2
    }
    
    // נקודת המרכז של האובייקט
    var center: CGPoint {
        CGPoint(x: centerX, y: centerY)
    }
    
    // המסגרת המלאה של האובייקט כ־CGRect
    var rect: CGRect {
        CGRect(
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height
        )
    }
}

extension DesignNode {
    // מחזיר כלי עזר גיאומטרי עבור ה־Node
    var geometry: NodeGeometry {
        NodeGeometry(node: self)
    }
}
