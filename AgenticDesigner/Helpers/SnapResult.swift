//
//  SnapResult.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation
import CoreGraphics

// קווי עזר שמופיעים בזמן Snap
struct SnapGuides {
    var verticalX: CGFloat?
    var horizontalY: CGFloat?
}

// תוצאה של חישוב Snap
struct SnapResult {
    var x: CGFloat
    var y: CGFloat
    var guides: SnapGuides
}
