//
//  LogicViewModel.swift
//  AgenticDesigner
//
//  State management for Logic Mode: block CRUD, connections, selection,
//  parameter editing, variables, validation, undo/redo and persistence
//  into the design project.
//

import Foundation
import SwiftUI
import Combine

@MainActor
final class LogicViewModel: ObservableObject {

    // MARK: - Published state

    @Published var flows: [LogicFlow] = []
    @Published var currentFlowId: UUID?
    @Published var selectedBlockId: UUID?
    @Published var selectedConnectionId: UUID?
    @Published var validationIssues: [LogicIssue] = []

    // Connection dragging (wire rubber-band)
    @Published var isConnecting: Bool = false
    @Published var connectionDragStart: CGPoint?
    @Published var connectionDragEnd: CGPoint?
    var connectionSourceBlockId: UUID?
    var connectionSourcePortIndex: Int = 0

    // Canvas viewport
    @Published var canvasOffset: CGSize = .zero
    @Published var canvasZoom: CGFloat = 1.0

    // Sheets
    @Published var showFirebaseConfig = false
    @Published var showAPIManager = false
    // Presented from EditorView so the running-app preview can open in any
    // editor mode — including remotely via the MCP preview_app tool.
    @Published var showAppPreview = false

    // Simulator: the block currently executing (drives the canvas highlight)
    @Published var simActiveBlockId: UUID?

    weak var designViewModel: ProjectViewModel?

    private var undoStack: [[LogicFlow]] = []
    private var redoStack: [[LogicFlow]] = []

    // MARK: - Attach / persist

    // Loads flows for the current design page and keeps a back-reference for
    // node pickers, the screen overlay, and persistence.
    func attach(to design: ProjectViewModel) {
        designViewModel = design
        let pageIndex = design.currentPageIndex
        guard design.project.pages.indices.contains(pageIndex) else { return }

        flows = design.project.pages[pageIndex].logicFlows

        if flows.isEmpty {
            let flow = LogicFlow(name: "Flow 1")
            flows = [flow]
        }

        if currentFlowId == nil || !flows.contains(where: { $0.id == currentFlowId }) {
            currentFlowId = flows.first?.id
        }

        validate()
    }

    func persist() {
        guard let design = designViewModel else { return }
        let pageIndex = design.currentPageIndex
        guard design.project.pages.indices.contains(pageIndex) else { return }
        design.project.pages[pageIndex].logicFlows = flows
    }

    // MARK: - Flow management

    var currentFlow: LogicFlow? {
        flows.first { $0.id == currentFlowId }
    }

    private var currentFlowIndex: Int? {
        flows.firstIndex { $0.id == currentFlowId }
    }

    func createFlow(name: String, screenId: UUID? = nil) {
        snapshot()
        let flow = LogicFlow(name: name, screenNodeId: screenId)
        flows.append(flow)
        currentFlowId = flow.id
        persist()
    }

    func deleteFlow(id: UUID) {
        snapshot()
        flows.removeAll { $0.id == id }
        if flows.isEmpty {
            flows = [LogicFlow(name: "Flow 1")]
        }
        if currentFlowId == id {
            currentFlowId = flows.first?.id
        }
        persist()
        validate()
    }

    func renameFlow(id: UUID, to name: String) {
        guard let index = flows.firstIndex(where: { $0.id == id }) else { return }
        flows[index].name = name
        persist()
    }

    // Adds AI-generated flows and focuses the first one. An empty default
    // flow left over from attach() is replaced instead of kept around.
    func applyGenerated(flows generated: [LogicFlow]) {
        guard !generated.isEmpty else { return }
        snapshot()

        flows.removeAll { $0.blocks.isEmpty && $0.connections.isEmpty }
        flows.append(contentsOf: generated)
        currentFlowId = generated.first?.id
        selectedBlockId = nil
        persist()
        validate()
    }

    // Inserts a ready-made flow (see FlowTemplateLibrary). Its event/element
    // references start unbound, same as any block dragged from the palette —
    // the user wires it to real screen elements via the block inspector.
    func insertTemplate(_ template: FlowTemplate) {
        snapshot()
        flows.removeAll { $0.blocks.isEmpty && $0.connections.isEmpty }
        var flow = template.build()
        let existingNames = Set(flows.map(\.name))
        if existingNames.contains(flow.name) {
            var index = 2
            while existingNames.contains("\(flow.name) \(index)") { index += 1 }
            flow.name = "\(flow.name) \(index)"
        }
        flows.append(flow)
        currentFlowId = flow.id
        selectedBlockId = nil
        persist()
        validate()
    }

    // MARK: - Block management

    var selectedBlock: LogicBlock? {
        guard let flow = currentFlow, let selectedBlockId else { return nil }
        return flow.blocks.first { $0.id == selectedBlockId }
    }

    @discardableResult
    func addBlock(type: LogicBlockType, at point: CGPoint) -> LogicBlock? {
        guard let flowIndex = currentFlowIndex,
              let block = BlockCatalog.makeBlock(type: type, at: point)
        else { return nil }

        snapshot()
        flows[flowIndex].blocks.append(block)
        selectedBlockId = block.id
        persist()
        validate()
        return block
    }

    func deleteBlock(id: UUID) {
        guard let flowIndex = currentFlowIndex else { return }
        snapshot()
        flows[flowIndex].blocks.removeAll { $0.id == id }
        flows[flowIndex].connections.removeAll { $0.sourceBlockId == id || $0.targetBlockId == id }
        if selectedBlockId == id { selectedBlockId = nil }
        persist()
        validate()
    }

    func deleteSelected() {
        if let selectedBlockId {
            deleteBlock(id: selectedBlockId)
        } else if let selectedConnectionId {
            disconnectBlocks(connectionId: selectedConnectionId)
            self.selectedConnectionId = nil
        }
    }

    func duplicateBlock(id: UUID) {
        guard let flowIndex = currentFlowIndex,
              let original = flows[flowIndex].blocks.first(where: { $0.id == id })
        else { return }

        snapshot()
        var copy = original
        copy.id = UUID()
        copy.x += 32
        copy.y += 32
        copy.parameters = original.parameters.map { param in
            var newParam = param
            newParam.id = UUID()
            return newParam
        }
        flows[flowIndex].blocks.append(copy)
        selectedBlockId = copy.id
        persist()
    }

    func moveBlock(id: UUID, to point: CGPoint) {
        guard let flowIndex = currentFlowIndex,
              let blockIndex = flows[flowIndex].blocks.firstIndex(where: { $0.id == id })
        else { return }

        flows[flowIndex].blocks[blockIndex].x = point.x
        flows[flowIndex].blocks[blockIndex].y = point.y
    }

    func commitBlockMove() {
        persist()
    }

    func toggleCollapsed(id: UUID) {
        guard let flowIndex = currentFlowIndex,
              let blockIndex = flows[flowIndex].blocks.firstIndex(where: { $0.id == id })
        else { return }
        flows[flowIndex].blocks[blockIndex].isCollapsed.toggle()
        persist()
    }

    func updateComment(blockId: UUID, comment: String?) {
        guard let flowIndex = currentFlowIndex,
              let blockIndex = flows[flowIndex].blocks.firstIndex(where: { $0.id == blockId })
        else { return }
        flows[flowIndex].blocks[blockIndex].comment =
            (comment?.isEmpty == true) ? nil : comment
        persist()
    }

    func updateLabel(blockId: UUID, label: String) {
        guard let flowIndex = currentFlowIndex,
              let blockIndex = flows[flowIndex].blocks.firstIndex(where: { $0.id == blockId })
        else { return }
        flows[flowIndex].blocks[blockIndex].label = label
        persist()
    }

    // MARK: - Parameter editing

    func updateParameter(blockId: UUID, paramKey: String, value: String?) {
        mutateParameter(blockId: blockId, paramKey: paramKey) { param in
            param.value = value
        }
    }

    func linkParameterToNode(blockId: UUID, paramKey: String, nodeId: UUID?) {
        mutateParameter(blockId: blockId, paramKey: paramKey) { param in
            param.nodeReference = nodeId
        }
    }

    func linkParameterToVariable(blockId: UUID, paramKey: String, variableName: String?) {
        mutateParameter(blockId: blockId, paramKey: paramKey) { param in
            param.variableReference = variableName
        }
    }

    private func mutateParameter(blockId: UUID, paramKey: String, _ mutate: (inout BlockParameter) -> Void) {
        guard let flowIndex = currentFlowIndex,
              let blockIndex = flows[flowIndex].blocks.firstIndex(where: { $0.id == blockId }),
              let paramIndex = flows[flowIndex].blocks[blockIndex].parameters.firstIndex(where: { $0.key == paramKey })
        else { return }

        mutate(&flows[flowIndex].blocks[blockIndex].parameters[paramIndex])
        persist()
        syncBindingIfNeeded(block: flows[flowIndex].blocks[blockIndex])
        validate()
    }

    private func syncBindingIfNeeded(block: LogicBlock) {
        guard block.type == .bindProperty,
              let nodeId = block.parameters.first(where: { $0.key == "element" })?.nodeReference,
              let property = block.parameters.first(where: { $0.key == "property" })?.value,
              let kind = NodeLogicBindingKind(rawValue: property)
        else { return }

        let variableName = block.parameters.first(where: { $0.key == "variable" })?.variableReference
        designViewModel?.setLogicBinding(nodeId: nodeId, kind: kind, variableName: variableName)
    }

    // MARK: - Connections

    // Validation rules: no self-connection, no cycles, events can't receive,
    // one connection max per input port.
    func validateConnection(from sourceId: UUID, to targetId: UUID, targetPort: Int) -> Bool {
        guard sourceId != targetId, let flow = currentFlow else { return false }

        guard let target = flow.blocks.first(where: { $0.id == targetId }),
              let targetDef = BlockCatalog.definition(for: target.type),
              targetDef.inputPortCount > 0
        else { return false }

        let inputTaken = flow.connections.contains {
            $0.targetBlockId == targetId && $0.targetPortIndex == targetPort
        }
        if inputTaken { return false }

        // Reject cycles: can the target already reach the source?
        var visited: Set<UUID> = []
        var stack = [targetId]
        while let current = stack.popLast() {
            if current == sourceId { return false }
            guard visited.insert(current).inserted else { continue }
            let next = flow.connections
                .filter { $0.sourceBlockId == current }
                .map(\.targetBlockId)
            stack.append(contentsOf: next)
        }

        return true
    }

    @discardableResult
    func connectBlocks(from sourceId: UUID, port sourcePort: Int, to targetId: UUID, targetPort: Int) -> Bool {
        guard let flowIndex = currentFlowIndex,
              validateConnection(from: sourceId, to: targetId, targetPort: targetPort)
        else { return false }

        snapshot()
        flows[flowIndex].connections.append(BlockConnection(
            sourceBlockId: sourceId,
            sourcePortIndex: sourcePort,
            targetBlockId: targetId,
            targetPortIndex: targetPort
        ))
        persist()
        validate()
        return true
    }

    func disconnectBlocks(connectionId: UUID) {
        guard let flowIndex = currentFlowIndex else { return }
        snapshot()
        flows[flowIndex].connections.removeAll { $0.id == connectionId }
        persist()
        validate()
    }

    // MARK: - Connection dragging

    func beginConnectionDrag(from blockId: UUID, port: Int, at point: CGPoint) {
        connectionSourceBlockId = blockId
        connectionSourcePortIndex = port
        connectionDragStart = point
        connectionDragEnd = point
        isConnecting = true
    }

    func updateConnectionDrag(to point: CGPoint) {
        connectionDragEnd = point
    }

    // Completes the drag: snaps to the nearest input port within reach.
    func endConnectionDrag(at point: CGPoint) {
        defer {
            isConnecting = false
            connectionDragStart = nil
            connectionDragEnd = nil
            connectionSourceBlockId = nil
        }

        guard let sourceId = connectionSourceBlockId, let flow = currentFlow else { return }

        let snapDistance: CGFloat = 28
        var best: (blockId: UUID, distance: CGFloat)?

        for block in flow.blocks {
            guard let def = BlockCatalog.definition(for: block.type), def.inputPortCount > 0 else { continue }
            let portPoint = BlockGeometry.inputPortPosition(for: block)
            let distance = hypot(portPoint.x - point.x, portPoint.y - point.y)
            if distance <= snapDistance, distance < (best?.distance ?? .greatestFiniteMagnitude) {
                best = (block.id, distance)
            }
        }

        if let best {
            connectBlocks(from: sourceId, port: connectionSourcePortIndex, to: best.blockId, targetPort: 0)
        }
    }

    // MARK: - Variables

    var allVariables: [LogicVariable] {
        let flowVars = currentFlow?.variables ?? []
        let globalVars = designViewModel?.project.globalVariables ?? []
        return flowVars + globalVars
    }

    func addVariable(name: String, type: VariableType, scope: VariableScope, defaultValue: String? = nil) {
        let variable = LogicVariable(name: name, type: type, defaultValue: defaultValue, scope: scope)

        if scope == .global {
            designViewModel?.project.globalVariables.append(variable)
        } else if let flowIndex = currentFlowIndex {
            snapshot()
            flows[flowIndex].variables.append(variable)
            persist()
        }
    }

    func setPlatform(_ platform: AppPlatform, enabled: Bool) {
        guard var settings = designViewModel?.project.platformSettings else { return }
        if enabled {
            if !settings.enabledPlatforms.contains(platform) {
                settings.enabledPlatforms.append(platform)
            }
        } else {
            settings.enabledPlatforms.removeAll { $0 == platform }
            if settings.enabledPlatforms.isEmpty {
                settings.enabledPlatforms = [.iPhone]
            }
            if !settings.enabledPlatforms.contains(settings.defaultPreviewPlatform) {
                settings.defaultPreviewPlatform = settings.enabledPlatforms.first ?? .iPhone
            }
        }
        designViewModel?.project.platformSettings = settings
    }

    func setDefaultPreviewPlatform(_ platform: AppPlatform) {
        guard var settings = designViewModel?.project.platformSettings else { return }
        if !settings.enabledPlatforms.contains(platform) {
            settings.enabledPlatforms.append(platform)
        }
        settings.defaultPreviewPlatform = platform
        designViewModel?.project.platformSettings = settings
    }

    func deleteVariable(id: UUID) {
        if let flowIndex = currentFlowIndex,
           flows[flowIndex].variables.contains(where: { $0.id == id }) {
            snapshot()
            flows[flowIndex].variables.removeAll { $0.id == id }
            persist()
            return
        }
        designViewModel?.project.globalVariables.removeAll { $0.id == id }
    }

    // MARK: - Design node access (for pickers + overlay)

    var designNodesFlat: [(id: UUID, name: String, type: String)] {
        guard let design = designViewModel,
              design.project.pages.indices.contains(design.currentPageIndex)
        else { return [] }

        var result: [(UUID, String, String)] = []
        func walk(_ nodes: [DesignNode]) {
            for node in nodes {
                result.append((node.id, node.name, node.type.rawValue))
                walk(node.children)
            }
        }
        walk(design.project.pages[design.currentPageIndex].nodes)
        return result
    }

    var designScreens: [(id: UUID, name: String)] {
        guard let design = designViewModel,
              design.project.pages.indices.contains(design.currentPageIndex)
        else { return [] }

        return design.project.pages[design.currentPageIndex].nodes
            .filter { $0.type == .Frame }
            .map { ($0.id, $0.name) }
    }

    func designNodeName(for id: UUID?) -> String? {
        guard let id else { return nil }
        return designNodesFlat.first { $0.id == id }?.name
    }

    // MARK: - Undo / Redo

    func snapshot() {
        undoStack.append(flows)
        if undoStack.count > 60 {
            undoStack.removeFirst()
        }
        redoStack.removeAll()
    }

    func undo() {
        guard let previous = undoStack.popLast() else { return }
        redoStack.append(flows)
        flows = previous
        persist()
        validate()
    }

    func redo() {
        guard let next = redoStack.popLast() else { return }
        undoStack.append(flows)
        flows = next
        persist()
        validate()
    }

    // MARK: - Validation

    func validate() {
        var issues: [LogicIssue] = []
        guard let flow = currentFlow else {
            validationIssues = []
            return
        }

        for block in flow.blocks {
            guard let def = BlockCatalog.definition(for: block.type) else { continue }

            for param in block.parameters where param.isRequired {
                let hasValue = !(param.value ?? "").isEmpty ||
                    param.nodeReference != nil ||
                    !(param.variableReference ?? "").isEmpty
                if !hasValue {
                    issues.append(LogicIssue(
                        blockId: block.id,
                        message: "\(block.label): '\(param.label)' is required",
                        severity: .error
                    ))
                }
            }

            if def.inputPortCount == 0 {
                let hasOutgoing = flow.connections.contains { $0.sourceBlockId == block.id }
                if !hasOutgoing {
                    issues.append(LogicIssue(
                        blockId: block.id,
                        message: "\(block.label): event is not connected to anything",
                        severity: .warning
                    ))
                }
            } else {
                let hasIncoming = flow.connections.contains { $0.targetBlockId == block.id }
                if !hasIncoming {
                    issues.append(LogicIssue(
                        blockId: block.id,
                        message: "\(block.label): unreachable — no incoming connection",
                        severity: .warning
                    ))
                }
            }
        }

        validationIssues = issues
    }

    func hasIssue(blockId: UUID) -> Bool {
        validationIssues.contains { $0.blockId == blockId && $0.severity == .error }
    }
}

// MARK: - Block geometry (shared by canvas, block view, and wire endpoints)

enum BlockGeometry {
    static let headerHeight: CGFloat = 34
    static let paramRowHeight: CGFloat = 26
    static let footerHeight: CGFloat = 22

    static func height(for block: LogicBlock) -> CGFloat {
        if block.isCollapsed { return headerHeight }
        let def = BlockCatalog.definition(for: block.type)
        let paramsHeight = CGFloat(block.parameters.count) * paramRowHeight
        let footer = (def?.outputPortLabels != nil) ? footerHeight : 10
        return headerHeight + paramsHeight + footer
    }

    static func inputPortPosition(for block: LogicBlock) -> CGPoint {
        CGPoint(x: block.x + block.width / 2, y: block.y)
    }

    static func outputPortPosition(for block: LogicBlock, portIndex: Int) -> CGPoint {
        let count = max(1, BlockCatalog.definition(for: block.type)?.outputPortCount ?? 1)
        let x = block.width * CGFloat(portIndex + 1) / CGFloat(count + 1)
        return CGPoint(x: block.x + x, y: block.y + height(for: block))
    }
}
