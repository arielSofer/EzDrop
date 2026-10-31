//
//  CanvasView.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//
import SwiftUI

enum CanvasCoordinateSpace {
    static let name = "canvas"
}

struct CanvasView: View {
    @ObservedObject var viewModel: ProjectViewModel
    @Binding var zoomScale: CGFloat
    
    // שומר את מיקום ה־Node בתחילת גרירה רגילה (לפי ID כדי למנוע stale closure)
    @State private var dragStartPosition: CGPoint?
    @State private var draggingNodeId: UUID?
    @State private var didSnapshotCurrentDrag = false
    // Shift-click toggles selection — the rest of that gesture must not drag.
    @State private var suppressCurrentDrag = false
    // Start positions of every selected node when dragging a multi-selection.
    @State private var groupDragStartPositions: [UUID: CGPoint] = [:]
    // Shift+mousedown on a node: toggles selection on release, but converts
    // into a normal drag once the pointer travels far enough.
    @State private var pendingShiftToggleNodeId: UUID?
    // Empty-canvas drag creates a marquee selection rectangle.
    @State private var marqueeStartLocation: CGPoint?
    @State private var marqueeSelectionRect: CGRect?
    
    // שומר את המסגרת של ה־Node בתחילת Resize
    @State private var resizeStartFrame: CGRect?
    @State private var didSnapshotCurrentResize = false
    // Every selected node's starting frame + their union, captured once when a
    // multi-selection resize begins so the group scales about a fixed box.
    @State private var groupResizeStart: (frames: [UUID: CGRect], bounds: CGRect)?
    // קווי עזר פעילים בזמן Drag
    @State private var activeSnapGuides: SnapGuides?
    @State private var gestureStartZoom: CGFloat?
    /// Drives the fade-out ring drawn around a layer revealed from the Layers panel.
    @State private var focusFlashOpacity: Double = 0
    /// The pass-through node a marquee started on (screen frame / background),
    /// so a click that never moved selects it instead of clearing the selection.
    @State private var marqueePassthroughNodeId: UUID?

    /// Scroll-target identity for the reveal marker, kept in its own namespace
    /// so it can never collide with the implicit ForEach id of a node view.
    private static func focusTargetId(for nodeId: UUID) -> String {
        "canvas-focus-target-\(nodeId.uuidString)"
    }
    
    private let canvasWidth: CGFloat = 4000
    private let canvasHeight: CGFloat = 4000
    private let minZoom: CGFloat = 0.25
    private let maxZoom: CGFloat = 3.0
    
    var body: some View {
        let sortedRootNodes = viewModel.currentPage.nodes.enumerated()
            .sorted { lhs, rhs in
                if (lhs.element.zIndex ?? 0) == (rhs.element.zIndex ?? 0) {
                    return lhs.offset < rhs.offset
                }
                return (lhs.element.zIndex ?? 0) < (rhs.element.zIndex ?? 0)
            }
            .map(\.element)
        
        ScrollViewReader { scrollProxy in
            ScrollView([.horizontal, .vertical], showsIndicators: true) {
                ZStack(alignment: .topLeading) {
                    Color.gray.opacity(0.08)
                        .ignoresSafeArea()
                        .contentShape(Rectangle())
                        .gesture(
                            DragGesture(minimumDistance: 0, coordinateSpace: .named(CanvasCoordinateSpace.name))
                                .onChanged { value in
                                    handleCanvasDragChanged(value)
                                }
                                .onEnded { value in
                                    handleCanvasDragEnded(value)
                                }
                        )

                    // ציור כל האובייקטים בקנבס בצורה רקורסיבית
                    ForEach(sortedRootNodes) { node in
                        CanvasNodeView(
                            node: node,
                            parentOffset: .zero,
                            selectedNodeId: viewModel.selectedNodeId
                        )
                        .allowsHitTesting(false)
                        .zIndex(node.zIndex ?? 0)
                    }
            
            // ציור קווי Snap בזמן גרירה
            if let activeSnapGuides {
                GuidesOverlay(guides: activeSnapGuides)
                    .zIndex(900)
            }

            if let marqueeSelectionRect {
                Rectangle()
                    .fill(Color.accentColor.opacity(0.10))
                    .overlay(
                        Rectangle()
                            .stroke(
                                Color.accentColor.opacity(0.85),
                                style: StrokeStyle(lineWidth: 1.25, dash: [5, 4])
                            )
                    )
                    .frame(width: marqueeSelectionRect.width, height: marqueeSelectionRect.height)
                    .position(x: marqueeSelectionRect.midX, y: marqueeSelectionRect.midY)
                    .allowsHitTesting(false)
                    .zIndex(950)
            }
            
            // מסגרות לבחירה מרובה — כל Node נבחר שאינו הראשי מקבל קו מתאר.
            ForEach(Array(viewModel.selectedNodeIds.filter { $0 != viewModel.selectedNodeId }), id: \.self) { nodeId in
                if let rect = viewModel.globalRect(for: nodeId) {
                    Rectangle()
                        .stroke(Color.accentColor, lineWidth: 1.5)
                        .frame(width: rect.width, height: rect.height)
                        .position(x: rect.midX, y: rect.midY)
                        .allowsHitTesting(false)
                        .zIndex(999)
                }
            }

            // Selection frame + resize handles. With several nodes selected the
            // frame wraps the whole group and resizes it as one object.
            if let selectedRect = viewModel.selectionGlobalRect {
                SelectionOverlay(
                    rect: selectedRect,
                    onResizeChanged: { handle, translation in
                        if viewModel.selectedNodeIds.count > 1 {
                            handleGroupResizeChanged(handle: handle, translation: translation)
                        } else if let selectedNode = viewModel.selectedNode {
                            handleResizeChanged(
                                handle: handle,
                                translation: translation,
                                node: selectedNode
                            )
                        }
                    },
                    onResizeEnded: {
                        resizeStartFrame = nil
                        groupResizeStart = nil
                        didSnapshotCurrentResize = false
                    }
                )
                .zIndex(1000)
            }
                }
                .frame(width: canvasWidth, height: canvasHeight, alignment: .topLeading)
                .coordinateSpace(name: CanvasCoordinateSpace.name)
                .scaleEffect(zoomScale, anchor: .topLeading)
                .frame(
                    width: canvasWidth * zoomScale,
                    height: canvasHeight * zoomScale,
                    alignment: .topLeading
                )
                // The scroll target for "reveal this layer". It lives OUTSIDE
                // the scaled stack, in already-zoomed coordinates, and is
                // positioned with padding rather than .position()/.offset():
                // those are render-time transforms that leave the layout frame
                // covering the whole canvas, so ScrollViewReader used to scroll
                // to the canvas centre instead of the node. Padding gives the
                // marker a real frame at the node's on-screen location.
                .overlay(alignment: .topLeading) {
                    if let focusRequest = viewModel.canvasFocusRequest,
                       let focusRect = viewModel.globalRect(for: focusRequest.nodeId) {
                        Color.clear
                            .frame(
                                width: max(1, focusRect.width * zoomScale),
                                height: max(1, focusRect.height * zoomScale)
                            )
                            // MUST NOT be the bare node id: every node view
                            // already carries that id implicitly via ForEach,
                            // and those views are laid out with .position(), so
                            // their layout frame covers the whole canvas. With
                            // duplicate ids ScrollViewReader resolved to one of
                            // them and scrolled to the canvas centre — landing
                            // on empty space instead of the element.
                            .id(Self.focusTargetId(for: focusRequest.nodeId))
                            .overlay {
                                // A small element on a big canvas is easy to
                                // lose even once it is centred, so the reveal
                                // pulses a ring that fades on its own.
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(Color.accentColor, lineWidth: 2.5)
                                    .padding(-4)
                                    .opacity(focusFlashOpacity)
                            }
                            .padding(.leading, focusRect.minX * zoomScale)
                            .padding(.top, focusRect.minY * zoomScale)
                            .allowsHitTesting(false)
                    }
                }
                .simultaneousGesture(
                    MagnificationGesture()
                        .onChanged { value in
                            if gestureStartZoom == nil {
                                gestureStartZoom = zoomScale
                            }
                            
                            let startZoom = gestureStartZoom ?? zoomScale
                            zoomScale = min(max(startZoom * value, minZoom), maxZoom)
                        }
                        .onEnded { _ in
                            gestureStartZoom = nil
                        }
                )
            }
            .onChange(of: viewModel.canvasFocusRequest) { request in
                guard let request else { return }
                // Wait one run-loop tick so the marker above exists at its new
                // global position before ScrollViewReader resolves the id.
                DispatchQueue.main.async {
                    withAnimation(.easeInOut(duration: 0.25)) {
                        scrollProxy.scrollTo(Self.focusTargetId(for: request.nodeId), anchor: .center)
                    }
                    focusFlashOpacity = 1
                    withAnimation(.easeOut(duration: 1.1).delay(0.2)) {
                        focusFlashOpacity = 0
                    }
                }
            }
        }
    }
    
    private func handleCanvasDragChanged(_ value: DragGesture.Value) {
        guard !suppressCurrentDrag else { return }

        if marqueeStartLocation != nil {
            updateMarqueeSelection(to: value.location)
            return
        }

        // A shift-press is pending: it toggles selection on release, but
        // becomes a real (axis-constrained) drag once the pointer moves.
        if let pendingId = pendingShiftToggleNodeId {
            guard hypot(value.translation.width, value.translation.height) > 4 else { return }
            pendingShiftToggleNodeId = nil
            beginDrag(on: pendingId, alreadyTranslatedBy: value.translation)
        }

        if draggingNodeId == nil {
            let modifiers = NSEvent.modifierFlags
            let shiftHeld = modifiers.contains(.shift)
            // ⌘/⌥-click reaches straight into a leaf; a plain click selects the
            // outermost element and drills in on repeat clicks.
            let mode: ProjectViewModel.CanvasHitMode =
                (modifiers.contains(.command) || modifiers.contains(.option)) ? .deepest : .smart

            guard let hitNodeId = viewModel.hitTestNodeId(at: value.startLocation, mode: mode) else {
                marqueePassthroughNodeId = nil
                beginMarqueeSelection(from: value.startLocation, to: value.location)
                return
            }

            if viewModel.shouldBeginMarqueeSelection(fromHitNode: hitNodeId),
               !viewModel.selectedNodeIds.contains(hitNodeId) {
                // Remembered so a click (no movement) can still select it.
                marqueePassthroughNodeId = hitNodeId
                beginMarqueeSelection(from: value.startLocation, to: value.location)
                return
            }

            if shiftHeld {
                pendingShiftToggleNodeId = hitNodeId
                return
            }

            beginDrag(on: hitNodeId, alreadyTranslatedBy: .zero)
        }

        guard let draggingNodeId else { return }
        handleDragChanged(value, nodeId: draggingNodeId)
    }

    private func handleCanvasDragEnded(_ value: DragGesture.Value) {
        if let marqueeSelectionRect {
            let didDragMarquee = marqueeSelectionRect.width > 4 || marqueeSelectionRect.height > 4
            let shiftHeld = NSEvent.modifierFlags.contains(.shift)

            if didDragMarquee {
                viewModel.selectNodes(in: marqueeSelectionRect, extending: shiftHeld)
            } else if !shiftHeld {
                // A press that never moved is a CLICK, not a rubber band. The
                // screen frame and background layers are marquee pass-throughs
                // so a drag can band across them — but a plain click on one has
                // to select it, or the screen frame is unselectable on canvas
                // (it used to fall through to clearSelection: click, nothing).
                if let clickedId = marqueePassthroughNodeId {
                    viewModel.selectNode(clickedId)
                } else {
                    viewModel.clearSelection()
                }
            }
        }

        // A shift-press that never moved is a click: toggle.
        if let pendingId = pendingShiftToggleNodeId {
            viewModel.toggleNodeInSelection(pendingId)
            pendingShiftToggleNodeId = nil
        }

        dragStartPosition = nil
        draggingNodeId = nil
        didSnapshotCurrentDrag = false
        activeSnapGuides = nil
        suppressCurrentDrag = false
        groupDragStartPositions = [:]
        marqueeStartLocation = nil
        marqueeSelectionRect = nil
        marqueePassthroughNodeId = nil
    }

    private func beginMarqueeSelection(from start: CGPoint, to current: CGPoint) {
        marqueeStartLocation = start
        marqueeSelectionRect = marqueeRect(from: start, to: current)
    }

    private func updateMarqueeSelection(to current: CGPoint) {
        guard let marqueeStartLocation else { return }
        marqueeSelectionRect = marqueeRect(from: marqueeStartLocation, to: current)
    }

    private func marqueeRect(from start: CGPoint, to end: CGPoint) -> CGRect {
        CGRect(
            x: min(start.x, end.x),
            y: min(start.y, end.y),
            width: abs(end.x - start.x),
            height: abs(end.y - start.y)
        )
    }

    // Starts a node (or group) drag. `alreadyTranslatedBy` compensates for
    // pointer travel that happened before the drag was recognized, so the
    // node tracks the cursor from the original mousedown.
    private func beginDrag(on hitNodeId: UUID, alreadyTranslatedBy translation: CGSize) {
        guard let currentNode = viewModel.node(id: hitNodeId) else { return }

        draggingNodeId = hitNodeId
        dragStartPosition = CGPoint(
            x: currentNode.x - translation.width,
            y: currentNode.y - translation.height
        )

        if viewModel.selectedNodeIds.contains(hitNodeId), viewModel.selectedNodeIds.count > 1 {
            // Dragging a member of a multi-selection moves the group:
            // keep the set, make the grabbed node primary, and remember
            // where every selected node started.
            groupDragStartPositions = viewModel.selectedNodeIds.reduce(into: [:]) { positions, id in
                if let node = viewModel.node(id: id) {
                    positions[id] = CGPoint(
                        x: node.x - translation.width,
                        y: node.y - translation.height
                    )
                }
            }
            if viewModel.selectedNodeId != hitNodeId {
                viewModel.selectedNodeId = hitNodeId
            }
        } else if viewModel.selectedNodeId != hitNodeId {
            viewModel.selectNode(hitNodeId)
        }
    }
    
    // מזיז Node בזמן גרירה + מבצע Snap בסיסי
    private func handleDragChanged(_ value: DragGesture.Value, nodeId: UUID) {
        // בחירת ה-node אם עוד לא נבחר (בגרירה קבוצתית הבחירה כבר נקבעה)
        if groupDragStartPositions.isEmpty, viewModel.selectedNodeId != nodeId {
            viewModel.selectNode(nodeId)
        }

        // שומרים את מיקום ה-node הנוכחי מה-viewModel (לא מה-closure)
        // רק בתחילת drag חדש
        if draggingNodeId != nodeId || dragStartPosition == nil {
            draggingNodeId = nodeId
            if let currentNode = viewModel.node(id: nodeId) {
                dragStartPosition = CGPoint(x: currentNode.x, y: currentNode.y)
            }
        }

        guard let start = dragStartPosition else { return }

        // Shift while dragging: constrain to the dominant axis — moving
        // right/left keeps the start Y and only changes X (and vice versa).
        let shiftConstrained = NSEvent.modifierFlags.contains(.shift)
        var translation = value.translation
        if shiftConstrained {
            if abs(translation.width) >= abs(translation.height) {
                translation.height = 0
            } else {
                translation.width = 0
            }
        }

        var proposedX = start.x + translation.width
        var proposedY = start.y + translation.height
        let didMove = abs(value.translation.width) > 0.1 || abs(value.translation.height) > 0.1

        if didMove && !didSnapshotCurrentDrag {
            viewModel.snapshot()
            didSnapshotCurrentDrag = true
        }

        // Group drag: every selected node moves by the same delta. With
        // shift, the grabbed node's parent-centre snap adjusts the delta.
        if !groupDragStartPositions.isEmpty {
            var delta = translation
            var guides: SnapGuides?

            if shiftConstrained, let primaryStart = groupDragStartPositions[nodeId] {
                let snapped = parentCenterSnapped(
                    nodeId: nodeId,
                    proposedX: primaryStart.x + translation.width,
                    proposedY: primaryStart.y + translation.height,
                    movingHorizontally: translation.height == 0
                )
                delta.width = snapped.x - primaryStart.x
                delta.height = snapped.y - primaryStart.y
                guides = snapped.guides
            }

            activeSnapGuides = guides
            for (id, startPosition) in groupDragStartPositions {
                viewModel.moveNode(
                    id: id,
                    toX: startPosition.x + delta.width,
                    y: startPosition.y + delta.height
                )
            }
            return
        }

        guard let draggedNode = viewModel.node(id: nodeId) else {
            return
        }

        // Shift-drag also snaps the node's centre onto the centre line of
        // its parent in the tree.
        var centerGuides: SnapGuides?
        if shiftConstrained {
            let snapped = parentCenterSnapped(
                nodeId: nodeId,
                proposedX: proposedX,
                proposedY: proposedY,
                movingHorizontally: translation.height == 0
            )
            proposedX = snapped.x
            proposedY = snapped.y
            centerGuides = snapped.guides
        }

        guard viewModel.isRootNode(nodeId) else {
            let clampedPosition = viewModel.clampedPositionForMove(
                nodeId: nodeId,
                proposedX: proposedX,
                proposedY: proposedY
            )

            activeSnapGuides = centerGuides
            viewModel.moveSelectedNode(toX: clampedPosition.x, y: clampedPosition.y)
            return
        }

        // Root nodes: with shift, the axis lock wins over sibling snapping —
        // SnapEngine would tug the locked axis toward other screens.
        if shiftConstrained {
            activeSnapGuides = centerGuides
            viewModel.moveSelectedNode(toX: proposedX, y: proposedY)
            return
        }

        let snapResult = SnapEngine.snap(
            draggedNode: draggedNode,
            proposedX: proposedX,
            proposedY: proposedY,
            otherNodes: viewModel.nodesExcluding(nodeId)
        )

        activeSnapGuides = snapResult.guides

        viewModel.moveSelectedNode(toX: snapResult.x, y: snapResult.y)
    }

    // Snaps a proposed position so the node's centre lands on the centre
    // line of its parent (along the axis being moved). Returns guides in
    // canvas coordinates for the overlay when the snap engages.
    private func parentCenterSnapped(
        nodeId: UUID,
        proposedX: CGFloat,
        proposedY: CGFloat,
        movingHorizontally: Bool
    ) -> (x: CGFloat, y: CGFloat, guides: SnapGuides?) {
        let threshold: CGFloat = 8

        guard let node = viewModel.node(id: nodeId),
              let parent = viewModel.parentOfNode(nodeId),
              let parentRect = viewModel.globalRect(for: parent.id)
        else {
            return (proposedX, proposedY, nil)
        }

        if movingHorizontally {
            let parentCenterX = parent.width / 2
            if abs(proposedX + node.width / 2 - parentCenterX) < threshold {
                return (
                    parentCenterX - node.width / 2,
                    proposedY,
                    SnapGuides(verticalX: parentRect.midX, horizontalY: nil)
                )
            }
        } else {
            let parentCenterY = parent.height / 2
            if abs(proposedY + node.height / 2 - parentCenterY) < threshold {
                return (
                    proposedX,
                    parentCenterY - node.height / 2,
                    SnapGuides(verticalX: nil, horizontalY: parentRect.midY)
                )
            }
        }

        return (proposedX, proposedY, nil)
    }
    
    // משנה גודל לפי ה־Handle שהמשתמש גורר
    /// Resizes a multi-selection as a single object. Holding Shift locks the
    /// aspect ratio, so a picture and a frame selected together shrink by the
    /// same factor and keep their proportions to each other.
    private func handleGroupResizeChanged(handle: ResizeHandle, translation: CGSize) {
        if groupResizeStart == nil {
            groupResizeStart = viewModel.groupResizeStart()
            if groupResizeStart != nil, !didSnapshotCurrentResize {
                viewModel.snapshot()
                didSnapshotCurrentResize = true
            }
        }
        guard let start = groupResizeStart else { return }

        viewModel.applyGroupResize(
            handle: handle,
            translation: translation,
            startFrames: start.frames,
            startBounds: start.bounds,
            uniform: NSEvent.modifierFlags.contains(.shift)
        )
    }

    private func handleResizeChanged(
        handle: ResizeHandle,
        translation: CGSize,
        node: DesignNode
    ) {
        if resizeStartFrame == nil {
            resizeStartFrame = CGRect(
                x: node.x,
                y: node.y,
                width: node.width,
                height: node.height
            )
        }
        
        guard let start = resizeStartFrame else { return }
        let didResize = abs(translation.width) > 0.1 || abs(translation.height) > 0.1
        
        if didResize && !didSnapshotCurrentResize {
            viewModel.snapshot()
            didSnapshotCurrentResize = true
        }
        
        let minSize: CGFloat = 24
        
        var newX = start.minX
        var newY = start.minY
        var newWidth = start.width
        var newHeight = start.height
        
        switch handle {
        case .topLeft:
            newWidth = start.width - translation.width
            newHeight = start.height - translation.height
            
            if newWidth >= minSize {
                newX = start.minX + translation.width
            } else {
                newWidth = minSize
                newX = start.maxX - minSize
            }
            
            if newHeight >= minSize {
                newY = start.minY + translation.height
            } else {
                newHeight = minSize
                newY = start.maxY - minSize
            }
            
        case .top:
            newHeight = start.height - translation.height
            
            if newHeight >= minSize {
                newY = start.minY + translation.height
            } else {
                newHeight = minSize
                newY = start.maxY - minSize
            }
            
        case .topRight:
            newWidth = start.width + translation.width
            newHeight = start.height - translation.height
            
            if newWidth < minSize {
                newWidth = minSize
            }
            
            if newHeight >= minSize {
                newY = start.minY + translation.height
            } else {
                newHeight = minSize
                newY = start.maxY - minSize
            }
            
        case .right:
            newWidth = start.width + translation.width
            
            if newWidth < minSize {
                newWidth = minSize
            }
            
        case .bottomRight:
            newWidth = start.width + translation.width
            newHeight = start.height + translation.height
            
            if newWidth < minSize {
                newWidth = minSize
            }
            
            if newHeight < minSize {
                newHeight = minSize
            }
            
        case .bottom:
            newHeight = start.height + translation.height
            
            if newHeight < minSize {
                newHeight = minSize
            }
            
        case .bottomLeft:
            newWidth = start.width - translation.width
            newHeight = start.height + translation.height
            
            if newWidth >= minSize {
                newX = start.minX + translation.width
            } else {
                newWidth = minSize
                newX = start.maxX - minSize
            }
            
            if newHeight < minSize {
                newHeight = minSize
            }
            
        case .left:
            newWidth = start.width - translation.width
            
            if newWidth >= minSize {
                newX = start.minX + translation.width
            } else {
                newWidth = minSize
                newX = start.maxX - minSize
            }
        }
        
        viewModel.resizeSelectedNode(
            x: newX,
            y: newY,
            width: newWidth,
            height: newHeight
        )
    }
}
