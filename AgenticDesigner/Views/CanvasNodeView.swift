//
//  CanvasNodeView.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import SwiftUI

struct CanvasNodeView: View {
    let node: DesignNode
    let parentOffset: CGPoint
    let selectedNodeId: UUID?
    
    /// A game frame shows its entity children only while being edited
    /// (itself or a descendant selected); otherwise the live scene plays.
    private var suppressChildren: Bool {
        guard node.gameScene != nil, node.hasEntityChildren else { return false }
        guard let selectedNodeId else { return true }
        return !Self.contains(node, id: selectedNodeId)
    }

    private static func contains(_ node: DesignNode, id: UUID) -> Bool {
        if node.id == id { return true }
        return node.children.contains { contains($0, id: id) }
    }

    var body: some View {
        let globalX = parentOffset.x + node.x
        let globalY = parentOffset.y + node.y
        let sortedChildren = node.children.enumerated()
            .sorted { lhs, rhs in
                if (lhs.element.zIndex ?? 0) == (rhs.element.zIndex ?? 0) {
                    return lhs.offset < rhs.offset
                }
                return (lhs.element.zIndex ?? 0) < (rhs.element.zIndex ?? 0)
            }
            .map(\.element)
        
        ZStack(alignment: .topLeading) {
            NodeView(
                node: node,
                isSelected: selectedNodeId == node.id
            )
            .position(
                x: globalX + node.width / 2,
                y: globalY + node.height / 2
            )
            
            if suppressChildren {
                EmptyView()
            } else if let scrollBehavior = node.scrollBehavior {
                scrollContainer(
                    children: sortedChildren,
                    behavior: scrollBehavior
                )
                .frame(width: node.width, height: node.height, alignment: .topLeading)
                .clipShape(node.outlineShape)
                .position(x: globalX + node.width / 2, y: globalY + node.height / 2)
            } else if node.clipContent == true {
                clippedChildren(sortedChildren)
                    .position(
                        x: globalX + node.width / 2,
                        y: globalY + node.height / 2
                    )
            } else {
                ForEach(sortedChildren) { child in
                    CanvasNodeView(
                        node: child,
                        parentOffset: CGPoint(x: globalX, y: globalY),
                        selectedNodeId: selectedNodeId
                    )
                    .zIndex(child.zIndex ?? 0)
                }
            }
        }
        .zIndex(node.zIndex ?? 0)
    }

    private func clippedChildren(_ children: [DesignNode]) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(children) { child in
                CanvasNodeView(
                    node: child,
                    parentOffset: .zero,
                    selectedNodeId: selectedNodeId
                )
                .zIndex(child.zIndex ?? 0)
            }
        }
        .frame(width: node.width, height: node.height, alignment: .topLeading)
        .clipShape(node.outlineShape)
    }

    private func scrollContainer(
        children: [DesignNode],
        behavior: ScrollBehavior
    ) -> some View {
        let axes = scrollAxes(for: behavior.axis)
        let contentSize = scrollContentSize(children: children)
        let initialOffset = behavior.initialOffset ?? 0

        return ScrollView(axes, showsIndicators: behavior.showsIndicators ?? true) {
            ZStack(alignment: .topLeading) {
                ForEach(children) { child in
                    CanvasNodeView(
                        node: child,
                        parentOffset: .zero,
                        selectedNodeId: selectedNodeId
                    )
                    .zIndex(child.zIndex ?? 0)
                }
            }
            .frame(width: contentSize.width, height: contentSize.height, alignment: .topLeading)
            .offset(
                x: behavior.axis == "horizontal" ? -initialOffset : 0,
                y: behavior.axis == "vertical" ? -initialOffset : 0
            )
        }
        .background(Color.clear)
    }

    private func scrollAxes(for axis: String) -> Axis.Set {
        switch axis {
        case "horizontal": return .horizontal
        case "both": return [.horizontal, .vertical]
        default: return .vertical
        }
    }

    private func scrollContentSize(children: [DesignNode]) -> CGSize {
        let maxX = children.map { $0.x + $0.width }.max() ?? node.width
        let maxY = children.map { $0.y + $0.height }.max() ?? node.height
        return CGSize(
            width: max(node.width, maxX),
            height: max(node.height, maxY)
        )
    }
}
