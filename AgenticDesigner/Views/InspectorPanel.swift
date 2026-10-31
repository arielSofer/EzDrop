//
//  InspectorPanel.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//
import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct InspectorPanel: View {
    @ObservedObject var viewModel: ProjectViewModel
    
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Inspector")
                .font(.headline)
                .padding(.top, 16)
                .padding(.horizontal, 16)
                .padding(.bottom, 10)
            
            Divider()
            
            if let node = viewModel.selectedNode {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        nodeContent(node)
                    }
                    .padding(.bottom, 32)
                }
                // ← קריטי: מאלץ SwiftUI לפרק ולבנות מחדש את כל ה-Inspector
                //   כשמשנים selection — בלי זה TextFields שומרים ערכים ישנים
                .id(node.id)

            } else {
                VStack {
                    Spacer()
                    Text("No selection")
                        .foregroundStyle(.secondary)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }
    
    // MARK: – Main content
    @ViewBuilder
    private func nodeContent(_ node: DesignNode) -> some View {
        // Name & Type
        section("") {
            Text(node.name).font(.title3).bold()
            labelRow("Type", node.gameScene != nil ? "Game" : node.type.rawValue)
            
            if let devicePresetId = node.devicePresetId,
               let preset = DevicePresetLibrary.preset(for: devicePresetId) {
                labelRow("Device", preset.name)
            }
        }

        // Gameplay design: gravity/fall speed, flap strength, spawn timing,
        // lives, timers — the game's FEEL, editable like any other property.
        if node.gameScene != nil {
            section("Game") {
                GameInspectorSection(viewModel: viewModel, node: node)
            }
        }
        
        Divider()
        
        // Position — single-target: broadcasting an absolute x/y to every
        // selected node would collapse them onto identical coordinates.
        section("Position") {
            numRow("X", node.x, multi: false)          { n, v in n.x = v }
            numRow("Y", node.y, multi: false)          { n, v in n.y = v }
        }

        Divider()

        // Size — same reasoning as Position.
        section("Size") {
            numRow("Width",  node.width, multi: false)  { n, v in n.width  = max(1, v) }
            numRow("Height", node.height, multi: false) { n, v in n.height = max(1, v) }

            // A text box wider than its words makes every alignment lie: the
            // node centres while the visible text stays off to the side.
            if node.type == .Text {
                Button {
                    viewModel.fitTextNodeToContent(id: node.id)
                } label: {
                    Label("Fit Box to Text", systemImage: "arrow.down.right.and.arrow.up.left")
                        .frame(maxWidth: .infinity)
                }
                .controlSize(.small)
                .help("Shrink this box to hug the text, so centring it actually centres the words")
            }
        }

        if !node.children.isEmpty {
            Divider()

            section("Align Children") {
                Text("Align every direct child inside this parent")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                HStack(spacing: 6) {
                    childAlignmentButton(node.id, .left, "align.horizontal.left")
                    childAlignmentButton(node.id, .center, "align.horizontal.center")
                    childAlignmentButton(node.id, .right, "align.horizontal.right")
                    childAlignmentButton(node.id, .top, "align.vertical.top")
                    childAlignmentButton(node.id, .middle, "align.vertical.center")
                    childAlignmentButton(node.id, .bottom, "align.vertical.bottom")
                }

                HStack(spacing: 8) {
                    childDistributionButton(node.id, .horizontal, "Distribute H", "distribute.horizontal")
                    childDistributionButton(node.id, .vertical, "Distribute V", "distribute.vertical")
                }
                .disabled(node.children.count < 2)
            }
        }

        Divider()

        // Style — applies to every selected node, so "change color" with
        // several layers selected recolors all of them, not just the last-
        // clicked one.
        section("Style") {
            clrRow("Fill", node.style.fill)              { n, v in n.style.fill = v }
            numRow("Radius",  node.style.cornerRadius)   { n, v in n.style.cornerRadius = max(0, v) }
            numRow("Opacity", CGFloat(node.style.opacity)){ n, v in n.style.opacity = Double(min(max(v, 0), 1)) }
        }

        // Text Color — for Text, Button, Input, Icon
        if [NodeType.Text, .Button, .Input, .Icon].contains(node.type) {
            Divider()
            section("Text") {
                clrRow("Color", node.style.textColor ?? "#FFFFFF") { n, v in n.style.textColor = v }

                if node.type != .Icon {
                    txtRow(
                        "Content",
                        node.text ?? "",
                        afterChange: { viewModel.hugTextBoxIfEnabled(id: node.id) }
                    ) { n, v in n.text = v }
                    numRow("Font Size", node.style.fontSize ?? 16) { n, v in n.style.fontSize = max(1, v) }
                }
            }
        }

        // Image source
        if node.type == .Image {
            Divider()
            section("Image") {
                imagePickerView(current: node.imageName ?? "") { path in
                    viewModel.updateSelectedNodesAndRelayout { $0.imageName = path }
                }
            }
        }

        // Icon name
        if node.type == .Icon {
            Divider()
            section("Icon") {
                txtRow("SF Symbol", node.iconName ?? "star") { n, v in n.iconName = v }
            }
        }

        // Repeat / List — clones this node once per item of a bound array
        // variable in the live preview (e.g. from an httpRequest or
        // firestoreQuery). Reference item fields in this node's (or its
        // children's) text/image source as {{item.fieldName}}.
        Divider()
        section("Repeat (List)") {
            txtRow("Data Variable", node.repeatBinding?.sourceVariable ?? "") { n, v in
                let trimmed = v.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.isEmpty {
                    n.repeatBinding = nil
                } else {
                    var binding = n.repeatBinding ?? RepeatBinding(sourceVariable: trimmed)
                    binding.sourceVariable = trimmed
                    n.repeatBinding = binding
                }
            }
            if node.repeatBinding != nil {
                txtRow("Item Alias", node.repeatBinding?.itemAlias ?? "item") { n, v in
                    let trimmed = v.trimmingCharacters(in: .whitespacesAndNewlines)
                    n.repeatBinding?.itemAlias = trimmed.isEmpty ? "item" : trimmed
                }

                Picker("Direction", selection: Binding(
                    get: { node.repeatBinding?.axis ?? .vertical },
                    set: { value in viewModel.updateSelectedNodesAndRelayout { $0.repeatBinding?.axis = value } }
                )) {
                    Text("Vertical").tag(RepeatAxis.vertical)
                    Text("Horizontal").tag(RepeatAxis.horizontal)
                }
                .pickerStyle(.segmented)

                Toggle("Scrollable", isOn: Binding(
                    get: { node.repeatBinding?.isScrollable ?? true },
                    set: { value in viewModel.updateSelectedNodesAndRelayout { $0.repeatBinding?.isScrollable = value } }
                ))
                .toggleStyle(.checkbox)

                Text("Use {{\(node.repeatBinding?.itemAlias ?? "item").fieldName}} in this node's text or image source. This node's parent becomes the scroll viewport.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }

        // Padding
        Divider()
        section("Padding") {
            fourFields(
                t: node.style.paddingTop    ?? 0,
                r: node.style.paddingRight  ?? 0,
                b: node.style.paddingBottom ?? 0,
                l: node.style.paddingLeft   ?? 0,
                onChangeT: { n, v in n.style.paddingTop    = v },
                onChangeR: { n, v in n.style.paddingRight  = v },
                onChangeB: { n, v in n.style.paddingBottom = v },
                onChangeL: { n, v in n.style.paddingLeft   = v }
            )
        }

        // Margin
        Divider()
        section("Margin") {
            fourFields(
                t: node.style.marginTop    ?? 0,
                r: node.style.marginRight  ?? 0,
                b: node.style.marginBottom ?? 0,
                l: node.style.marginLeft   ?? 0,
                onChangeT: { n, v in n.style.marginTop    = v },
                onChangeR: { n, v in n.style.marginRight  = v },
                onChangeB: { n, v in n.style.marginBottom = v },
                onChangeL: { n, v in n.style.marginLeft   = v }
            )
        }
    }
    
    // MARK: – Building blocks
    
    private func section<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !title.isEmpty {
                Text(title)
                    .font(.caption).textCase(.uppercase)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
            content()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
    
    private func labelRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.system(.body, design: .monospaced))
        }
    }

    private func childAlignmentButton(
        _ parentId: UUID,
        _ alignment: CanvasStudioAlignment,
        _ icon: String
    ) -> some View {
        Button {
            viewModel.alignChildren(of: parentId, to: alignment)
        } label: {
            Image(systemName: icon)
                .frame(width: 24, height: 24)
        }
        .buttonStyle(.borderless)
        .help("Align children \(alignment.rawValue)")
    }

    private func childDistributionButton(
        _ parentId: UUID,
        _ axis: CanvasStudioDistributionAxis,
        _ title: String,
        _ icon: String
    ) -> some View {
        Button {
            viewModel.distributeChildren(of: parentId, axis: axis)
        } label: {
            Label(title, systemImage: icon)
                .font(.caption)
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
        .help("Distribute children \(axis.rawValue)")
    }
    
    // multi: true (default) broadcasts the edit to every selected node —
    // Position/Size rows explicitly pass false to keep those single-target.
    private func numRow(
        _ title: String,
        _ value: CGFloat,
        multi: Bool = true,
        onChange: @escaping (inout DesignNode, CGFloat) -> Void
    ) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            TextField(title, value: Binding(
                get: { Double(value) },
                set: { v in
                    if multi {
                        viewModel.updateSelectedNodesAndRelayout { onChange(&$0, CGFloat(v)) }
                    } else {
                        viewModel.updateSelectedNodeAndRelayout { onChange(&$0, CGFloat(v)) }
                    }
                }
            ), format: .number)
            .textFieldStyle(.roundedBorder)
            .frame(width: 80)
        }
    }

    private func clrRow(
        _ title: String,
        _ value: String,
        onChange: @escaping (inout DesignNode, String) -> Void
    ) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            TextField(title, text: Binding(
                get: { value },
                set: { v in viewModel.updateSelectedNodesAndRelayout { onChange(&$0, v) } }
            ))
            .textFieldStyle(.roundedBorder)
            .frame(width: 95)

            ColorPicker("", selection: Binding(
                get: { Color(hex: value) },
                set: { c in viewModel.updateSelectedNodesAndRelayout { onChange(&$0, c.hexString) } }
            ), supportsOpacity: false)
            .labelsHidden()
            .frame(width: 32)
        }
    }

    private func txtRow(
        _ title: String,
        _ value: String,
        afterChange: (() -> Void)? = nil,
        onChange: @escaping (inout DesignNode, String) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).foregroundStyle(.secondary)
            TextField(title, text: Binding(
                get: { value },
                set: { v in
                    viewModel.updateSelectedNodesAndRelayout { onChange(&$0, v) }
                    afterChange?()
                }
            ))
            .textFieldStyle(.roundedBorder)
        }
    }

    private func miniField(
        _ label: String,
        _ value: CGFloat,
        onChange: @escaping (inout DesignNode, CGFloat) -> Void
    ) -> some View {
        VStack(spacing: 2) {
            TextField("", value: Binding(
                get: { Double(value) },
                set: { v in viewModel.updateSelectedNodesAndRelayout { onChange(&$0, CGFloat(v)) } }
            ), format: .number)
            .textFieldStyle(.roundedBorder)
            .multilineTextAlignment(.center)

            Text(label)
                .font(.system(size: 10))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
    
    private func fourFields(
        t: CGFloat, r: CGFloat, b: CGFloat, l: CGFloat,
        onChangeT: @escaping (inout DesignNode, CGFloat) -> Void,
        onChangeR: @escaping (inout DesignNode, CGFloat) -> Void,
        onChangeB: @escaping (inout DesignNode, CGFloat) -> Void,
        onChangeL: @escaping (inout DesignNode, CGFloat) -> Void
    ) -> some View {
        HStack(spacing: 6) {
            miniField("Top",    t, onChange: onChangeT)
            miniField("Right",  r, onChange: onChangeR)
            miniField("Bottom", b, onChange: onChangeB)
            miniField("Left",   l, onChange: onChangeL)
        }
    }
    
    private func imagePickerView(current: String, onChange: @escaping (String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("URL or file path", text: Binding(
                    get: { current },
                    set: { onChange($0) }
                ))
                .textFieldStyle(.roundedBorder)
                
                Button("Choose…") {
                    let panel = NSOpenPanel()
                    panel.allowedContentTypes = [.image]
                    panel.canChooseFiles = true
                    panel.allowsMultipleSelection = false
                    panel.begin { response in
                        if response == .OK, let url = panel.url {
                            onChange(url.path)
                        }
                    }
                }
                .controlSize(.small)
            }
            
            if !current.isEmpty {
                Group {
                    if current.hasPrefix("http"), let url = URL(string: current) {
                        AsyncImage(url: url) { phase in
                            if let img = phase.image {
                                img.resizable().scaledToFill()
                            } else {
                                ProgressView()
                            }
                        }
                    } else if let nsImg = NSImage(contentsOfFile: current) {
                        Image(nsImage: nsImg).resizable().scaledToFill()
                    }
                }
                .frame(height: 80)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .clipped()
            }
        }
    }
}
