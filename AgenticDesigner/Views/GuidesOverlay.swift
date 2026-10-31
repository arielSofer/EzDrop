
//
//  GuidesOverlay.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import SwiftUI

struct GuidesOverlay: View {
    let guides: SnapGuides
    
    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .topLeading) {
                
                // קו עזר אנכי
                if let verticalX = guides.verticalX {
                    Rectangle()
                        .fill(Color.blue)
                        .frame(width: 1, height: proxy.size.height)
                        .position(x: verticalX, y: proxy.size.height / 2)
                }
                
                // קו עזר אופקי
                if let horizontalY = guides.horizontalY {
                    Rectangle()
                        .fill(Color.blue)
                        .frame(width: proxy.size.width, height: 1)
                        .position(x: proxy.size.width / 2, y: horizontalY)
                }
            }
        }
        .allowsHitTesting(false)
    }
}
