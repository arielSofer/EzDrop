//
//  BlockInspectorPanel.swift
//  AgenticDesigner
//
//  Right sidebar in Logic Mode: full-size parameter editors for the
//  selected block, variables manager, and quick actions.
//

import SwiftUI

struct BlockInspectorPanel: View {
    @ObservedObject var logicViewModel: LogicViewModel
    @ObservedObject var designViewModel: ProjectViewModel

    @State private var newVariableName: String = ""
    @State private var newVariableType: VariableType = .string
    @State private var newVariableScope: VariableScope = .flow
    @State private var newVariableDefault: String = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if let block = logicViewModel.selectedBlock {
                    blockInfoSection(block)
                    Divider()
                    parametersSection(block)
                    Divider()
                    commentSection(block)
                    Divider()
                    quickActions(block)
                } else {
                    emptyState
                }

                Divider()
                platformSection
                Divider()
                variablesSection
            }
            .padding(12)
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // MARK: - Empty state

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "cube.transparent")
                .font(.system(size: 28))
                .foregroundStyle(.tertiary)
            Text("Select a block to configure it")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    // MARK: - Block info

    private func blockInfoSection(_ block: LogicBlock) -> some View {
        let definition = BlockCatalog.definition(for: block.type)

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: definition?.icon ?? "square")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Color(hex: definition?.color ?? "#6B7280"))
                    .clipShape(RoundedRectangle(cornerRadius: 7))

                VStack(alignment: .leading, spacing: 2) {
                    TextField("Label", text: Binding(
                        get: { block.label },
                        set: { logicViewModel.updateLabel(blockId: block.id, label: $0) }
                    ))
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .semibold))

                    Text(block.category.rawValue)
                        .font(.system(size: 9, weight: .medium))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Color(hex: definition?.color ?? "#6B7280").opacity(0.18))
                        .clipShape(Capsule())
                }
            }

            if let description = definition?.description {
                Text(description)
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    // MARK: - Parameters

    private func parametersSection(_ block: LogicBlock) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Parameters")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            if block.parameters.isEmpty {
                Text("This block has no parameters.")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }

            ForEach(block.parameters) { param in
                parameterEditor(block: block, param: param)
            }
        }
    }

    @ViewBuilder
    private func parameterEditor(block: LogicBlock, param: BlockParameter) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(param.label)
                    .font(.system(size: 10, weight: .medium))
                if param.isRequired {
                    Text("*").foregroundStyle(.red).font(.system(size: 10))
                }
            }

            switch param.type {
            case .nodeReference:
                nodePicker(block: block, param: param)

            case .screenReference:
                screenPicker(block: block, param: param)

            case .variable:
                variablePicker(block: block, param: param)

            case .dropdown, .httpMethod:
                Picker("", selection: valueBinding(block: block, param: param)) {
                    ForEach(param.options ?? [], id: \.self) { option in
                        Text(option).tag(option)
                    }
                }
                .labelsHidden()

            case .boolean:
                Toggle(isOn: Binding(
                    get: { param.value == "true" },
                    set: { logicViewModel.updateParameter(blockId: block.id, paramKey: param.key, value: $0 ? "true" : "false") }
                )) {
                    Text(param.value == "true" ? "On" : "Off")
                        .font(.system(size: 10))
                }
                .toggleStyle(.switch)
                .controlSize(.mini)

            case .keyValue:
                VStack(alignment: .leading, spacing: 2) {
                    TextField(param.placeholder ?? "key: value, key2: value2", text: valueBinding(block: block, param: param))
                        .textFieldStyle(.roundedBorder)
                        .font(.system(size: 11))
                    Text("Comma-separated key: value pairs")
                        .font(.system(size: 8))
                        .foregroundStyle(.tertiary)
                }

            default:
                TextField(param.placeholder ?? "", text: valueBinding(block: block, param: param))
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 11, design: param.type == .jsonPath || param.type == .firebasePath ? .monospaced : .default))
            }
        }
    }

    private func valueBinding(block: LogicBlock, param: BlockParameter) -> Binding<String> {
        Binding(
            get: { param.value ?? "" },
            set: { logicViewModel.updateParameter(blockId: block.id, paramKey: param.key, value: $0.isEmpty ? nil : $0) }
        )
    }

    private func nodePicker(block: LogicBlock, param: BlockParameter) -> some View {
        Picker("", selection: Binding(
            get: { param.nodeReference },
            set: { logicViewModel.linkParameterToNode(blockId: block.id, paramKey: param.key, nodeId: $0) }
        )) {
            Text("None").tag(Optional<UUID>.none)
            ForEach(logicViewModel.designNodesFlat, id: \.id) { node in
                Text("\(node.name)  ·  \(node.type)").tag(Optional(node.id))
            }
        }
        .labelsHidden()
    }

    private func screenPicker(block: LogicBlock, param: BlockParameter) -> some View {
        Picker("", selection: Binding(
            get: { param.nodeReference },
            set: { logicViewModel.linkParameterToNode(blockId: block.id, paramKey: param.key, nodeId: $0) }
        )) {
            Text("None").tag(Optional<UUID>.none)
            ForEach(logicViewModel.designScreens, id: \.id) { screen in
                Text(screen.name).tag(Optional(screen.id))
            }
        }
        .labelsHidden()
    }

    private func variablePicker(block: LogicBlock, param: BlockParameter) -> some View {
        Picker("", selection: Binding(
            get: { param.variableReference ?? "" },
            set: { logicViewModel.linkParameterToVariable(blockId: block.id, paramKey: param.key, variableName: $0.isEmpty ? nil : $0) }
        )) {
            Text("None").tag("")
            ForEach(logicViewModel.allVariables) { variable in
                Text("\(variable.name) (\(variable.type.rawValue))").tag(variable.name)
            }
        }
        .labelsHidden()
    }

    // MARK: - Comment

    private func commentSection(_ block: LogicBlock) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Comment")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            TextField("Optional note...", text: Binding(
                get: { block.comment ?? "" },
                set: { logicViewModel.updateComment(blockId: block.id, comment: $0) }
            ), axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .font(.system(size: 11))
            .lineLimit(2...4)
        }
    }

    // MARK: - Quick actions

    private func quickActions(_ block: LogicBlock) -> some View {
        HStack(spacing: 8) {
            Button {
                logicViewModel.duplicateBlock(id: block.id)
            } label: {
                Label("Duplicate", systemImage: "plus.square.on.square")
                    .font(.system(size: 10))
            }

            Button(role: .destructive) {
                logicViewModel.deleteBlock(id: block.id)
            } label: {
                Label("Delete", systemImage: "trash")
                    .font(.system(size: 10))
            }
        }
    }

    // MARK: - Variables

    private var platformSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Platforms")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            ForEach(AppPlatform.allCases) { platform in
                Toggle(isOn: Binding(
                    get: { designViewModel.project.platformSettings.enabledPlatforms.contains(platform) },
                    set: { logicViewModel.setPlatform(platform, enabled: $0) }
                )) {
                    Text(platform.displayName)
                        .font(.system(size: 11))
                }
                .toggleStyle(.checkbox)
            }

            Picker("Preview", selection: Binding(
                get: { designViewModel.project.platformSettings.defaultPreviewPlatform },
                set: { logicViewModel.setDefaultPreviewPlatform($0) }
            )) {
                ForEach(designViewModel.project.platformSettings.enabledPlatforms) { platform in
                    Text(platform.displayName).tag(platform)
                }
            }
            .font(.system(size: 11))
        }
    }

    private var variablesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Variables")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            ForEach(logicViewModel.allVariables) { variable in
                HStack(spacing: 6) {
                    Image(systemName: "number.square")
                        .font(.system(size: 10))
                        .foregroundStyle(.secondary)
                    Text(variable.name)
                        .font(.system(size: 11, weight: .medium))
                    Text(variable.type.rawValue)
                        .font(.system(size: 9))
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(variable.scope.rawValue)
                        .font(.system(size: 8))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(Color(nsColor: .controlBackgroundColor))
                        .clipShape(Capsule())
                    Button {
                        logicViewModel.deleteVariable(id: variable.id)
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }

            HStack(spacing: 6) {
                TextField("New variable name", text: $newVariableName)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 11))

                Button {
                    let name = newVariableName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return }
                    let defaultValue = newVariableDefault.trimmingCharacters(in: .whitespacesAndNewlines)
                    logicViewModel.addVariable(
                        name: name,
                        type: newVariableType,
                        scope: newVariableScope,
                        defaultValue: defaultValue.isEmpty ? nil : defaultValue
                    )
                    newVariableName = ""
                    newVariableDefault = ""
                } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .buttonStyle(.plain)
            }

            HStack(spacing: 6) {
                Picker("Type", selection: $newVariableType) {
                    ForEach(VariableType.allCases, id: \.self) { type in
                        Text(type.rawValue).tag(type)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)

                Picker("Scope", selection: $newVariableScope) {
                    ForEach(VariableScope.allCases, id: \.self) { scope in
                        Text(scope.rawValue).tag(scope)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)
            }

            TextField("Default value", text: $newVariableDefault)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 11))
        }
    }
}
