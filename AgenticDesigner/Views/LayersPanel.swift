//
//  LAyersPanel.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//
import SwiftUI
import UniformTypeIdentifiers

struct LayersPanel: View {
    @ObservedObject var viewModel: ProjectViewModel
    @State private var draggedNodeId: UUID?
    @State private var activeDropTargetId: UUID?
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Page tabs
            pageTabs
            
            Divider()
            
            Text("Layers")
                .font(.headline)
                .padding(.top, 12)
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
            
            Divider()
            
            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(viewModel.currentPage.nodes) { node in
                        LayerTreeRow(
                            node: node,
                            depth: 0,
                            selectedNodeId: viewModel.selectedNodeId,
                            draggedNodeId: draggedNodeId,
                            activeDropTargetId: $activeDropTargetId,
                            onSelect: { id in
                                viewModel.selectAndRevealNode(id)
                            },
                            onDragStart: { id in
                                draggedNodeId = id
                                viewModel.selectNode(id)
                            },
                            onDropOnNode: { draggedId, targetId in
                                viewModel.reparentNode(draggedId, toParent: targetId)
                                draggedNodeId = nil
                                activeDropTargetId = nil
                            },
                            canDropOnNode: { draggedId, targetId in
                                viewModel.canReparentNode(draggedId, toParent: targetId)
                            },
                            onAlignChildren: { parentId, alignment in
                                viewModel.alignChildren(of: parentId, to: alignment)
                            },
                            onDistributeChildren: { parentId, axis in
                                viewModel.distributeChildren(of: parentId, axis: axis)
                            },
                            onFitText: { nodeId in
                                viewModel.fitTextNodeToContent(id: nodeId)
                            },
                            onFitTextInside: { parentId in
                                _ = viewModel.fitTextNodesToContent(under: parentId)
                            }
                        )
                    }
                }
                .padding(.vertical, 4)
            }
            
            Spacer()
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
    
    // MARK: – Page tabs
    private var pageTabs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(viewModel.project.pages.enumerated()), id: \.offset) { index, page in
                    Button {
                        viewModel.selectPage(index: index)
                    } label: {
                        Text(page.name)
                            .font(.caption)
                            .lineLimit(1)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(
                                viewModel.currentPageIndex == index
                                    ? Color.blue.opacity(0.18)
                                    : Color.clear
                            )
                            .foregroundColor(
                                viewModel.currentPageIndex == index
                                    ? .blue
                                    : .primary
                            )
                            .cornerRadius(6)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(
                                        viewModel.currentPageIndex == index
                                            ? Color.blue.opacity(0.5)
                                            : Color.gray.opacity(0.25),
                                        lineWidth: 1
                                    )
                            )
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button("Delete Page") {
                            viewModel.deletePage(at: index)
                        }
                        .disabled(viewModel.project.pages.count <= 1)
                    }
                }
                
                // כפתור הוספת עמוד
                Button {
                    viewModel.addPage()
                } label: {
                    Image(systemName: "plus")
                        .font(.caption)
                        .frame(width: 24, height: 24)
                        .background(Color.gray.opacity(0.1))
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
                .help("Add Page")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .frame(height: 44)
        .background(Color(nsColor: .controlBackgroundColor))
    }
}

// שורת Layer רקורסיבית שמציגה גם children
struct LayerTreeRow: View {
    let node: DesignNode
    let depth: Int
    let selectedNodeId: UUID?
    let draggedNodeId: UUID?
    @Binding var activeDropTargetId: UUID?
    let onSelect: (UUID) -> Void
    let onDragStart: (UUID) -> Void
    let onDropOnNode: (UUID, UUID) -> Void
    let canDropOnNode: (UUID, UUID) -> Bool
    let onAlignChildren: (UUID, CanvasStudioAlignment) -> Void
    let onDistributeChildren: (UUID, CanvasStudioDistributionAxis) -> Void
    let onFitText: (UUID) -> Void
    let onFitTextInside: (UUID) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button {
                onSelect(node.id)
            } label: {
                HStack {
                    Image(systemName: iconName(for: node.type))
                        .frame(width: 18)
                    
                    Text(node.name)
                        .lineLimit(1)
                    
                    Spacer()
                }
                .padding(.leading, CGFloat(depth) * 16)
                .padding(.horizontal, 8)
                .padding(.vertical, 7)
                .background(
                    activeDropTargetId == node.id
                    ? Color.blue.opacity(0.24)
                    : selectedNodeId == node.id
                    ? Color.blue.opacity(0.18)
                    : Color.clear
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(
                            activeDropTargetId == node.id ? Color.blue : Color.clear,
                            lineWidth: 1.5
                        )
                )
                .cornerRadius(8)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
            // Aligning a container's children needs the CONTAINER selected,
            // which is the awkward part on canvas — clicking lands on a child.
            // The tree already shows the hierarchy, so the parent is one
            // right-click away here.
            .contextMenu {
                if node.type == .Text {
                    Button("Fit Box to Text") { onFitText(node.id) }
                }
                if !node.children.isEmpty {
                    Button("Fit All Text Inside") { onFitTextInside(node.id) }
                    Section("Align \(node.children.count) children") {
                        Button("Left")   { onAlignChildren(node.id, .left) }
                        Button("Center") { onAlignChildren(node.id, .center) }
                        Button("Right")  { onAlignChildren(node.id, .right) }
                        Divider()
                        Button("Top")    { onAlignChildren(node.id, .top) }
                        Button("Middle") { onAlignChildren(node.id, .middle) }
                        Button("Bottom") { onAlignChildren(node.id, .bottom) }
                    }
                    if node.children.count > 1 {
                        Section("Distribute") {
                            Button("Horizontally") { onDistributeChildren(node.id, .horizontal) }
                            Button("Vertically")   { onDistributeChildren(node.id, .vertical) }
                        }
                    }
                } else {
                    Text("No children to align")
                }
            }
            .onDrag {
                onDragStart(node.id)
                return NSItemProvider(object: node.id.uuidString as NSString)
            }
            .onDrop(
                of: [UTType.text],
                delegate: LayerDropDelegate(
                    targetNodeId: node.id,
                    draggedNodeId: draggedNodeId,
                    activeDropTargetId: $activeDropTargetId,
                    onDropOnNode: onDropOnNode,
                    canDropOnNode: canDropOnNode
                )
            )
            
            ForEach(node.children) { child in
                LayerTreeRow(
                    node: child,
                    depth: depth + 1,
                    selectedNodeId: selectedNodeId,
                    draggedNodeId: draggedNodeId,
                    activeDropTargetId: $activeDropTargetId,
                    onSelect: onSelect,
                    onDragStart: onDragStart,
                    onDropOnNode: onDropOnNode,
                    canDropOnNode: canDropOnNode,
                    onAlignChildren: onAlignChildren,
                    onDistributeChildren: onDistributeChildren,
                    onFitText: onFitText,
                    onFitTextInside: onFitTextInside
                )
            }
        }
    }
    
    // אייקון לפי סוג האובייקט
    private func iconName(for type: NodeType) -> String {
        switch type {
        case .Frame:     return "rectangle"
        case .Text:      return "textformat"
        case .Rectangle: return "square"
        case .Button:    return "capsule"
        case .Input:     return "text.rectangle"
        case .Image:     return "photo.fill"
        case .Icon:      return "star.fill"
        }
    }
}

private struct LayerDropDelegate: DropDelegate {
    let targetNodeId: UUID
    let draggedNodeId: UUID?
    @Binding var activeDropTargetId: UUID?
    let onDropOnNode: (UUID, UUID) -> Void
    let canDropOnNode: (UUID, UUID) -> Bool
    
    func validateDrop(info: DropInfo) -> Bool {
        guard let draggedNodeId else { return true }
        return canDropOnNode(draggedNodeId, targetNodeId)
    }
    
    func dropEntered(info: DropInfo) {
        guard let draggedNodeId,
              canDropOnNode(draggedNodeId, targetNodeId)
        else {
            return
        }
        
        activeDropTargetId = targetNodeId
    }
    
    func dropExited(info: DropInfo) {
        if activeDropTargetId == targetNodeId {
            activeDropTargetId = nil
        }
    }
    
    func performDrop(info: DropInfo) -> Bool {
        activeDropTargetId = nil
        
        guard let provider = info.itemProviders(for: [UTType.text]).first else {
            return false
        }
        
        provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let string = object as? String,
                  let draggedId = UUID(uuidString: string),
                  canDropOnNode(draggedId, targetNodeId)
            else {
                return
            }
            
            DispatchQueue.main.async {
                onDropOnNode(draggedId, targetNodeId)
            }
        }
        
        return true
    }
}
