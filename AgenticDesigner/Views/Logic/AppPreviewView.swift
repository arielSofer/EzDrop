//
//  AppPreviewView.swift
//  AgenticDesigner
//
//  Interactive app preview, iOS-Simulator style: renders the designed
//  screen full size, buttons fire their wired logic flows on tap, inputs
//  are typeable, and navigate blocks switch screens.
//

import SwiftUI

private struct PreviewHitArea: Identifiable {
    let id = UUID()
    // The node id logic flows are wired to. For a cloned repeat-list row this
    // is the TEMPLATE's id (the id the flow's On Tap references), while `rect`
    // is the clone's own on-screen position — that's what makes every row of
    // a data-bound list tappable, not just the template.
    let flowNodeId: UUID
    let type: NodeType
    let text: String?
    let rect: CGRect
    let hasSwipeFlow: Bool
    // Item data seeded into the flow run when this hit area belongs to a
    // repeat-list clone ("book" → item JSON, "book.title" → field values).
    let itemVariables: [String: String]
}

struct AppPreviewView: View {
    @ObservedObject var logicViewModel: LogicViewModel
    @ObservedObject var designViewModel: ProjectViewModel
    @ObservedObject var simulator: LogicSimulator
    @Environment(\.dismiss) private var dismiss

    @State private var editingNodeId: UUID?
    @State private var editingText: String = ""

    private var screens: [DesignNode] {
        guard designViewModel.project.pages.indices.contains(designViewModel.currentPageIndex) else { return [] }
        return designViewModel.project.pages[designViewModel.currentPageIndex].nodes
            .filter { $0.type == .Frame }
            .filter { screen in
                screen.supportedPlatforms?.contains(simulator.previewPlatform) ?? true
            }
    }

    private var currentScreen: DesignNode? {
        screens.first { $0.id == simulator.previewScreenId } ?? screens.first
    }

    private var tappableNodeIds: Set<UUID> {
        var ids = Set<UUID>()
        for flow in logicViewModel.flows {
            for block in flow.blocks where block.type == .onTap || block.type == .onDoubleTap || block.type == .onLongPress || block.type == .onSwipe {
                for parameter in block.parameters where parameter.key == "element" {
                    if let nodeId = parameter.nodeReference {
                        ids.insert(nodeId)
                    }
                }
            }
        }
        return ids
    }

    private var swipeNodeIds: Set<UUID> {
        var ids = Set<UUID>()
        for flow in logicViewModel.flows {
            for block in flow.blocks where block.type == .onSwipe {
                for parameter in block.parameters where parameter.key == "element" {
                    if let nodeId = parameter.nodeReference {
                        ids.insert(nodeId)
                    }
                }
            }
        }
        return ids
    }

    var body: some View {
        VStack(spacing: 10) {
            header

            if let screen = currentScreen {
                phoneBody(screen)
            } else {
                Text("No screens to preview — design a screen first.")
                    .foregroundStyle(.secondary)
                    .padding(40)
            }

            screenSwitcher
        }
        .padding(16)
        .frame(width: 470, height: 760)
        .onAppear {
            simulator.logicViewModel = logicViewModel
            simulator.designViewModel = designViewModel
            simulator.previewPlatform = designViewModel.project.platformSettings.defaultPreviewPlatform
            if simulator.previewScreenId == nil {
                simulator.previewScreenId = screens.first?.id
            }
            simulator.primeVariables()
            simulator.runEvent([.onAppLaunch])
            if let screenId = simulator.previewScreenId {
                simulator.runEvent([.onScreenLoad, .onScreenOpened], nodeId: screenId)
                simulator.scheduleScreenTimers(for: screenId)
            }
        }
        .onChange(of: simulator.previewScreenId) { newValue in
            if let newValue {
                simulator.runEvent([.onScreenLoad, .onScreenOpened], nodeId: newValue)
                simulator.scheduleScreenTimers(for: newValue)
            }
        }
        .onDisappear {
            simulator.stopAllTimers()
        }
    }

    private var header: some View {
        HStack {
            Label("App Preview", systemImage: "iphone")
                .font(.headline)
            if simulator.isRunning {
                ProgressView().controlSize(.small)
            }
            Spacer()
            if simulator.hasUIChanges {
                Button("Reset") { simulator.resetUI() }
            }
            Picker("Platform", selection: $simulator.previewPlatform) {
                ForEach(designViewModel.project.platformSettings.enabledPlatforms) { platform in
                    Text(platform.displayName).tag(platform)
                }
            }
            .labelsHidden()
            .frame(width: 130)
            Button("Done") { dismiss() }
        }
    }

    // MARK: - Phone

    private func phoneBody(_ screen: DesignNode) -> some View {
        let scale = min(380 / max(screen.width, 1), 600 / max(screen.height, 1))
        // One expansion pass serves both rendering AND hit-testing, so every
        // cloned repeat-list row is individually tappable at its real
        // position, carrying its own item's data into the flow it triggers.
        let (expandedScreen, cloneContexts) = expandingRepeats(offsetToOrigin(screen))

        return ZStack(alignment: .topLeading) {
            CanvasNodeView(
                node: expandedScreen,
                parentOffset: .zero,
                selectedNodeId: nil
            )
            // Game nodes on this screen report score/game-over/win/runFlow
            // into the simulator — bound Texts update live, flows can fire.
            .environment(\.gameEventHandler, { [weak simulator] event in
                simulator?.handleGameEvent(event)
            })
            // Interactive controls (time pickers) read/write simulator
            // variables directly — turning the wheel updates the app state.
            .environment(\.previewVariableBinding, { [weak simulator] name, defaultValue in
                Binding(
                    get: { simulator?.variables[name] ?? defaultValue },
                    set: { simulator?.variables[name] = $0 }
                )
            })

            interactiveOverlays(for: expandedScreen, tappableNodeIds: tappableNodeIds, cloneContexts: cloneContexts)
        }
        .frame(width: screen.width, height: screen.height, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: 34))
        .overlay(RoundedRectangle(cornerRadius: 34).stroke(Color.black.opacity(0.75), lineWidth: 8))
        .scaleEffect(scale, anchor: .top)
        .frame(width: screen.width * scale, height: screen.height * scale, alignment: .top)
        .overlay(alignment: .bottom) {
            if let choice = simulator.awaitingChoice {
                choiceOverlay(choice)
            }
        }
        .overlay(alignment: .bottom) {
            if let toast = simulator.toastMessage {
                Text(toast)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.85))
                    .clipShape(Capsule())
                    .shadow(color: .black.opacity(0.35), radius: 10, y: 4)
                    .padding(.bottom, 56)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
    }

    private func offsetToOrigin(_ screen: DesignNode) -> DesignNode {
        var copy = screen
        copy.x = 0
        copy.y = 0
        return copy
    }

    // Live-expands any repeatBinding template on this screen into one
    // clone per item of its bound array variable. Recomputed on every body
    // evaluation, so it reacts to simulator.variables changing (e.g. after
    // an httpRequest/firestoreQuery lands) with no extra plumbing.
    private func expandingRepeats(_ screen: DesignNode) -> (DesignNode, [UUID: RepeatBindingExpander.CloneContext]) {
        var expanded = screen
        let (children, contexts) = RepeatBindingExpander.expandWithContext(screen.children, variables: simulator.variables)
        expanded.children = children
        return (expanded, contexts)
    }

    // MARK: - Interaction

    // Transparent hit areas over tappable elements and editable inputs,
    // computed over the repeat-EXPANDED tree so cloned list rows each get
    // their own hit area (at their real position, with their item's data).
    private func interactiveOverlays(
        for screen: DesignNode,
        tappableNodeIds: Set<UUID>,
        cloneContexts: [UUID: RepeatBindingExpander.CloneContext]
    ) -> some View {
        let hitAreas = interactiveHitAreas(
            in: screen.children,
            offset: .zero,
            tappableNodeIds: tappableNodeIds,
            cloneContexts: cloneContexts,
            inheritedItemVariables: [:]
        )

        return ForEach(hitAreas) { entry in
            Group {
                if entry.type == .Input {
                    inputOverlay(entry)
                } else {
                    Rectangle()
                        .fill(Color.clear)
                        .contentShape(Rectangle())
                        .onTapGesture { simulator.runTap(on: entry.flowNodeId, itemContext: entry.itemVariables) }
                        .simultaneousGesture(swipeGesture(for: entry))
                }
            }
            .frame(width: entry.rect.width, height: entry.rect.height)
            .position(x: entry.rect.midX, y: entry.rect.midY)
        }
    }

    // Recognizes a directional swipe over a node with an On Swipe flow and
    // fires it, passing the actual direction so the flow's direction filter
    // can match.
    private func swipeGesture(for entry: PreviewHitArea) -> some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                guard entry.hasSwipeFlow else { return }
                let horizontal = abs(value.translation.width) > abs(value.translation.height)
                let direction = horizontal
                    ? (value.translation.width < 0 ? "left" : "right")
                    : (value.translation.height < 0 ? "up" : "down")
                simulator.runSwipe(on: entry.flowNodeId, direction: direction, itemContext: entry.itemVariables)
            }
    }

    private func inputOverlay(_ entry: PreviewHitArea) -> some View {
        Group {
            if editingNodeId == entry.flowNodeId {
                TextField("", text: $editingText, onCommit: {
                    simulator.setInputValue(nodeId: entry.flowNodeId, text: editingText)
                    simulator.runEvent([.onSubmit], nodeId: entry.flowNodeId)
                    editingNodeId = nil
                })
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 14))
            } else {
                Rectangle()
                    .fill(Color.clear)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        editingText = entry.text ?? ""
                        editingNodeId = entry.flowNodeId
                    }
            }
        }
    }

    private func interactiveHitAreas(
        in nodes: [DesignNode],
        offset: CGPoint,
        tappableNodeIds: Set<UUID>,
        cloneContexts: [UUID: RepeatBindingExpander.CloneContext],
        inheritedItemVariables: [String: String]
    ) -> [PreviewHitArea] {
        var result: [PreviewHitArea] = []
        result.reserveCapacity(min(nodes.count, tappableNodeIds.count + 4))

        for node in nodes {
            let rect = CGRect(
                x: offset.x + node.x,
                y: offset.y + node.y,
                width: node.width,
                height: node.height
            )

            // A clone root maps taps back to its template's flow and carries
            // its item's data down to every descendant hit area (a button
            // INSIDE a list row knows which row it lives in).
            let cloneContext = cloneContexts[node.id]
            let flowNodeId = cloneContext?.templateId ?? node.id
            let itemVariables = cloneContext?.variables ?? inheritedItemVariables

            if node.type == .Input || tappableNodeIds.contains(flowNodeId) {
                result.append(PreviewHitArea(
                    flowNodeId: flowNodeId,
                    type: node.type,
                    text: node.text,
                    rect: rect,
                    hasSwipeFlow: swipeNodeIds.contains(flowNodeId),
                    itemVariables: itemVariables
                ))
            }

            result.append(contentsOf: interactiveHitAreas(
                in: node.children,
                offset: CGPoint(x: rect.minX, y: rect.minY),
                tappableNodeIds: tappableNodeIds,
                cloneContexts: cloneContexts,
                inheritedItemVariables: itemVariables
            ))
        }

        return result
    }

    // MARK: - Branch choice (Firebase etc.)

    private func choiceOverlay(_ choice: LogicSimulator.BranchChoice) -> some View {
        HStack(spacing: 8) {
            Text(choice.blockLabel)
                .font(.system(size: 11, weight: .semibold))
            ForEach(choice.labels.indices, id: \.self) { index in
                Button(choice.labels[index]) { simulator.choose(index) }
                    .buttonStyle(.borderedProminent)
                    .tint(index == 0 ? .green : .red)
                    .controlSize(.small)
            }
        }
        .padding(10)
        .background(.thinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .padding(.bottom, 20)
    }

    // MARK: - Screen switcher

    private var screenSwitcher: some View {
        HStack(spacing: 6) {
            ForEach(screens) { screen in
                Button {
                    simulator.previewScreenId = screen.id
                } label: {
                    Text(screen.name)
                        .font(.system(size: 10, weight: .medium))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            (currentScreen?.id == screen.id ? Color.accentColor.opacity(0.2) : Color(nsColor: .controlBackgroundColor))
                        )
                        .clipShape(Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }
}
