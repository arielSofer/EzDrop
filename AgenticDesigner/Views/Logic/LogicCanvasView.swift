//
//  LogicCanvasView.swift
//  AgenticDesigner
//
//  The block-programming canvas: dotted background, translucent screen
//  reference, Bézier wires, draggable blocks, rubber-band connection
//  dragging, pan/zoom, and palette drop target.
//

import SwiftUI
import UniformTypeIdentifiers

struct LogicCanvasView: View {
    @ObservedObject var logicViewModel: LogicViewModel
    @ObservedObject var designViewModel: ProjectViewModel

    @State private var panStartOffset: CGSize?

    var body: some View {
        GeometryReader { _ in
            ZStack(alignment: .topLeading) {
                dotGridBackground

                canvasContent
                    .scaleEffect(logicViewModel.canvasZoom, anchor: .topLeading)
                    .offset(logicViewModel.canvasOffset)
            }
            .contentShape(Rectangle())
            .gesture(panGesture)
            .simultaneousGesture(zoomGesture)
            .onTapGesture {
                logicViewModel.selectedBlockId = nil
                logicViewModel.selectedConnectionId = nil
            }
            .onDrop(of: [UTType.plainText], isTargeted: nil) { providers, location in
                handlePaletteDrop(providers: providers, dropLocation: location)
            }
        }
        .clipped()
        .background(Color(nsColor: .underPageBackgroundColor))
    }

    // MARK: - Content

    private var canvasContent: some View {
        ZStack(alignment: .topLeading) {
            screenReferenceOverlay

            connectionWires

            temporaryDragWire

            if let flow = logicViewModel.currentFlow {
                ForEach(flow.blocks) { block in
                    LogicBlockView(block: block, logicViewModel: logicViewModel)
                }
            }
        }
        .frame(width: 4000, height: 4000, alignment: .topLeading)
        .coordinateSpace(name: "logicCanvas")
    }

    // MARK: - Screen reference

    // The designed screens shown translucently so blocks can be wired
    // "against" real UI without leaving Logic Mode.
    @ViewBuilder
    private var screenReferenceOverlay: some View {
        let pageIndex = designViewModel.currentPageIndex
        if designViewModel.project.pages.indices.contains(pageIndex) {
            ForEach(designViewModel.project.pages[pageIndex].nodes) { node in
                CanvasNodeView(node: node, parentOffset: .zero, selectedNodeId: nil)
                    .opacity(0.14)
                    .allowsHitTesting(false)
            }
        }
    }

    // MARK: - Wires

    @ViewBuilder
    private var connectionWires: some View {
        if let flow = logicViewModel.currentFlow {
            ForEach(flow.connections) { connection in
                if let source = flow.blocks.first(where: { $0.id == connection.sourceBlockId }),
                   let target = flow.blocks.first(where: { $0.id == connection.targetBlockId }) {
                    let start = BlockGeometry.outputPortPosition(for: source, portIndex: connection.sourcePortIndex)
                    let end = BlockGeometry.inputPortPosition(for: target)
                    let color = Color(hex: BlockCatalog.definition(for: source.type)?.color ?? "#6B7280")

                    ConnectionLineView(
                        startPoint: start,
                        endPoint: end,
                        color: color,
                        isSelected: logicViewModel.selectedConnectionId == connection.id
                    )

                    // Invisible tap target at the wire midpoint for selection.
                    Circle()
                        .fill(Color.clear)
                        .frame(width: 22, height: 22)
                        .contentShape(Circle())
                        .position(ConnectionLineView.midpoint(from: start, to: end))
                        .onTapGesture {
                            logicViewModel.selectedConnectionId = connection.id
                            logicViewModel.selectedBlockId = nil
                        }
                        .contextMenu {
                            Button("Disconnect", role: .destructive) {
                                logicViewModel.disconnectBlocks(connectionId: connection.id)
                            }
                        }
                }
            }
        }
    }

    @ViewBuilder
    private var temporaryDragWire: some View {
        if logicViewModel.isConnecting,
           let start = logicViewModel.connectionDragStart,
           let end = logicViewModel.connectionDragEnd {
            ConnectionLineView(
                startPoint: start,
                endPoint: end,
                color: .accentColor,
                isAnimating: true
            )
            .allowsHitTesting(false)
        }
    }

    // MARK: - Background

    private var dotGridBackground: some View {
        Canvas { context, size in
            let spacing: CGFloat = 24 * logicViewModel.canvasZoom
            guard spacing > 6 else { return }
            let offsetX = logicViewModel.canvasOffset.width.truncatingRemainder(dividingBy: spacing)
            let offsetY = logicViewModel.canvasOffset.height.truncatingRemainder(dividingBy: spacing)

            var x = offsetX
            while x < size.width {
                var y = offsetY
                while y < size.height {
                    context.fill(
                        Path(ellipseIn: CGRect(x: x - 1, y: y - 1, width: 2, height: 2)),
                        with: .color(.primary.opacity(0.08))
                    )
                    y += spacing
                }
                x += spacing
            }
        }
        .allowsHitTesting(false)
    }

    // MARK: - Gestures

    private var panGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                if panStartOffset == nil {
                    panStartOffset = logicViewModel.canvasOffset
                }
                guard let start = panStartOffset else { return }
                logicViewModel.canvasOffset = CGSize(
                    width: start.width + value.translation.width,
                    height: start.height + value.translation.height
                )
            }
            .onEnded { _ in
                panStartOffset = nil
            }
    }

    private var zoomGesture: some Gesture {
        MagnificationGesture()
            .onChanged { value in
                logicViewModel.canvasZoom = min(max(0.4, value), 2.0)
            }
    }

    // MARK: - Palette drop

    private func handlePaletteDrop(providers: [NSItemProvider], dropLocation: CGPoint) -> Bool {
        guard let provider = providers.first else { return false }

        let offset = logicViewModel.canvasOffset
        let zoom = logicViewModel.canvasZoom

        _ = provider.loadObject(ofClass: NSString.self) { object, _ in
            guard let raw = object as? String,
                  let type = LogicBlockType(rawValue: raw)
            else { return }

            let canvasPoint = CGPoint(
                x: (dropLocation.x - offset.width) / zoom - 100,
                y: (dropLocation.y - offset.height) / zoom - 20
            )

            Task { @MainActor in
                logicViewModel.addBlock(type: type, at: canvasPoint)
            }
        }

        return true
    }
}
