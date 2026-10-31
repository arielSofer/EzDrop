//
//  LogicBlockView.swift
//  AgenticDesigner
//
//  Visual representation of a single logic block on the canvas:
//  colored header, parameter rows, input/output ports, selection glow,
//  drag-to-move and drag-from-port to connect.
//

import SwiftUI

struct LogicBlockView: View {
    let block: LogicBlock
    @ObservedObject var logicViewModel: LogicViewModel

    @State private var dragStartOrigin: CGPoint?

    private var definition: BlockDefinition? {
        BlockCatalog.definition(for: block.type)
    }

    private var categoryColor: Color {
        Color(hex: definition?.color ?? "#6B7280")
    }

    private var isSelected: Bool {
        logicViewModel.selectedBlockId == block.id
    }

    private var hasError: Bool {
        logicViewModel.hasIssue(blockId: block.id)
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if !block.isCollapsed {
                parameterRows

                if let labels = definition?.outputPortLabels {
                    outputLabelsRow(labels)
                } else {
                    Spacer(minLength: 10)
                }
            }
        }
        .frame(width: block.width, height: BlockGeometry.height(for: block))
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(borderColor, lineWidth: (isSelected || isExecuting) ? 2.5 : 1)
        )
        .shadow(
            color: isExecuting ? .green.opacity(0.6) : .black.opacity(isSelected ? 0.25 : 0.12),
            radius: isExecuting ? 12 : (isSelected ? 10 : 5),
            y: 3
        )
        .overlay(alignment: .top) { inputPort }
        .overlay(alignment: .bottom) { outputPorts }
        .contentShape(Rectangle())
        .onTapGesture {
            logicViewModel.selectedBlockId = block.id
            logicViewModel.selectedConnectionId = nil
        }
        .gesture(moveGesture)
        .contextMenu {
            Button("Duplicate") { logicViewModel.duplicateBlock(id: block.id) }
            Button(block.isCollapsed ? "Expand" : "Collapse") { logicViewModel.toggleCollapsed(id: block.id) }
            Divider()
            Button("Delete", role: .destructive) { logicViewModel.deleteBlock(id: block.id) }
        }
        .position(
            x: block.x + block.width / 2,
            y: block.y + BlockGeometry.height(for: block) / 2
        )
    }

    private var isExecuting: Bool {
        logicViewModel.simActiveBlockId == block.id
    }

    private var borderColor: Color {
        if isExecuting { return .green }
        if hasError { return .red }
        if isSelected { return categoryColor }
        return Color.primary.opacity(0.12)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: definition?.icon ?? "square")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)

            Text(block.label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)

            Spacer(minLength: 0)

            if block.comment != nil {
                Image(systemName: "text.bubble")
                    .font(.system(size: 10))
                    .foregroundStyle(.white.opacity(0.7))
            }

            if hasError {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 11))
                    .foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: BlockGeometry.headerHeight)
        .background(categoryColor)
    }

    // MARK: - Parameters

    private var parameterRows: some View {
        VStack(spacing: 0) {
            ForEach(block.parameters) { param in
                HStack(spacing: 6) {
                    Text(param.label + ":")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)

                    Spacer(minLength: 2)

                    Text(parameterSummary(param))
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(parameterIsSet(param) ? .primary : .tertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 10)
                .frame(height: BlockGeometry.paramRowHeight)
            }
        }
    }

    private func parameterIsSet(_ param: BlockParameter) -> Bool {
        !(param.value ?? "").isEmpty ||
        param.nodeReference != nil ||
        !(param.variableReference ?? "").isEmpty
    }

    private func parameterSummary(_ param: BlockParameter) -> String {
        if let nodeId = param.nodeReference,
           let name = logicViewModel.designNodeName(for: nodeId) {
            return "◇ \(name)"
        }
        if let variable = param.variableReference, !variable.isEmpty {
            return "{\(variable)}"
        }
        if let value = param.value, !value.isEmpty {
            return value
        }
        return param.isRequired ? "required" : "—"
    }

    // MARK: - Output labels

    private func outputLabelsRow(_ labels: [String]) -> some View {
        HStack {
            ForEach(labels.indices, id: \.self) { index in
                Text(labels[index])
                    .font(.system(size: 9, weight: .medium))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
            }
        }
        .frame(height: BlockGeometry.footerHeight)
        .padding(.horizontal, 4)
    }

    // MARK: - Ports

    @ViewBuilder
    private var inputPort: some View {
        if (definition?.inputPortCount ?? 0) > 0 {
            portCircle(filled: hasIncomingConnection)
                .offset(y: -6)
        }
    }

    private var outputPorts: some View {
        let count = max(1, definition?.outputPortCount ?? 1)
        return HStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { portIndex in
                portCircle(filled: hasOutgoingConnection(port: portIndex))
                    .frame(maxWidth: .infinity)
                    .gesture(connectionGesture(port: portIndex))
            }
        }
        .padding(.horizontal, block.width / CGFloat(count + 1) - 12)
        .offset(y: 6)
    }

    private func portCircle(filled: Bool) -> some View {
        Circle()
            .fill(filled ? categoryColor : Color(nsColor: .controlBackgroundColor))
            .frame(width: 12, height: 12)
            .overlay(Circle().stroke(categoryColor, lineWidth: 2))
            .contentShape(Circle().scale(2.2))
    }

    private var hasIncomingConnection: Bool {
        logicViewModel.currentFlow?.connections.contains { $0.targetBlockId == block.id } ?? false
    }

    private func hasOutgoingConnection(port: Int) -> Bool {
        logicViewModel.currentFlow?.connections.contains {
            $0.sourceBlockId == block.id && $0.sourcePortIndex == port
        } ?? false
    }

    // MARK: - Gestures

    private var moveGesture: some Gesture {
        DragGesture(minimumDistance: 2, coordinateSpace: .named("logicCanvas"))
            .onChanged { value in
                if dragStartOrigin == nil {
                    dragStartOrigin = CGPoint(x: block.x, y: block.y)
                    logicViewModel.selectedBlockId = block.id
                }
                guard let origin = dragStartOrigin else { return }
                logicViewModel.moveBlock(id: block.id, to: CGPoint(
                    x: origin.x + value.translation.width,
                    y: origin.y + value.translation.height
                ))
            }
            .onEnded { _ in
                dragStartOrigin = nil
                logicViewModel.commitBlockMove()
            }
    }

    private func connectionGesture(port: Int) -> some Gesture {
        DragGesture(minimumDistance: 3, coordinateSpace: .named("logicCanvas"))
            .onChanged { value in
                if !logicViewModel.isConnecting {
                    let start = BlockGeometry.outputPortPosition(for: block, portIndex: port)
                    logicViewModel.beginConnectionDrag(from: block.id, port: port, at: start)
                }
                logicViewModel.updateConnectionDrag(to: value.location)
            }
            .onEnded { value in
                logicViewModel.endConnectionDrag(at: value.location)
            }
    }
}
