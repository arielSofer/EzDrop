//
//  CanvasStudioPanel.swift
//  AgenticDesigner
//

import SwiftUI
import AppKit
import UniformTypeIdentifiers

struct CanvasStudioAssetsPanel: View {
    @ObservedObject var viewModel: ProjectViewModel
    @State private var aiPrompt = "editorial product photo, clean studio lighting"
    @State private var customWidth: Double = 100
    @State private var customHeight: Double = 180
    @State private var isGeneratingAIImage = false
    @State private var aiImageError: String?
    // Sprite design mode: generate transparent sprites and reuse them in design.
    @State private var spritePrompt = "glowing power-up orb, clean game sprite, side view"
    @State private var spriteFrames = 1
    @State private var isGeneratingSprite = false
    @State private var spriteError: String?
    @State private var librarySprites: [URL] = []
    @State private var matchGameArt = true
    @State private var gameArtRefCount = 0
    @State private var spriteFacing = "right"


    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Studio")
                .font(.headline)
                .padding(.top, 16)
                .padding(.horizontal, 16)
                .padding(.bottom, 10)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    panelSection("Artboards") {
                        HStack(spacing: 8) {
                            numberInput("W", value: $customWidth)
                            numberInput("H", value: $customHeight)
                        }

                        Button {
                            viewModel.addArtboard(
                                name: "Custom Artboard",
                                width: CGFloat(max(1, customWidth)),
                                height: CGFloat(max(1, customHeight))
                            )
                        } label: {
                            Label("Create Custom", systemImage: "plus.rectangle")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)

                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            studioTile("Post", "square", "1080") {
                                viewModel.addArtboard(name: "Social Post", width: 1080, height: 1080)
                            }
                            studioTile("Story", "rectangle.portrait", "1080x1920") {
                                viewModel.addArtboard(name: "Story", width: 1080, height: 1920)
                            }
                            studioTile("Banner", "rectangle", "1600x900") {
                                viewModel.addArtboard(name: "Banner", width: 1600, height: 900)
                            }
                            studioTile("A4", "doc", "print") {
                                viewModel.addArtboard(name: "A4 Print", width: 794, height: 1123)
                            }
                            studioTile("Mizmor", "text.book.closed", "100x180cm") {
                                viewModel.addMizmorLetodahArtboard()
                            }
                            studioTile("Mizmor Shape", "album", "100x180cm") {
                                viewModel.addMizmorShapeArtboard()
                            }
                        }
                    }

                    panelSection("Create") {
                        HStack(spacing: 8) {
                            iconCommand("Text", "textformat") { viewModel.addStudioText() }
                            iconCommand("Photo", "photo") { chooseImage() }
                            iconCommand("Frame", "rectangle.on.rectangle") { viewModel.addFrameNode() }
                        }
                        HStack(spacing: 8) {
                            iconCommand("Rect", "rectangle") {
                                viewModel.addStudioShape(name: "Rectangle", fill: "#D1D5DB", cornerRadius: 0)
                            }
                            iconCommand("Round", "square.roundedbottom") {
                                viewModel.addStudioShape(name: "Rounded Shape", fill: "#111827", cornerRadius: 28)
                            }
                            iconCommand("Icon", "sparkles") { viewModel.addIconNode() }
                        }
                    }

                    panelSection("AI Image") {
                        TextField("Image prompt", text: $aiPrompt, axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .lineLimit(3)

                        Button {
                            generateAIImage()
                        } label: {
                            if isGeneratingAIImage {
                                HStack(spacing: 6) {
                                    ProgressView().controlSize(.small)
                                    Text("Generating…")
                                }
                                .frame(maxWidth: .infinity)
                            } else {
                                Label("Generate Image", systemImage: "wand.and.stars")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(isGeneratingAIImage || aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                        if let aiImageError {
                            Text(aiImageError)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }

                    panelSection("Sprites") {
                        Text("Design a transparent sprite, then drop it into any screen or game.")
                            .font(.system(size: 10))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)

                        TextField("Sprite prompt", text: $spritePrompt, axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .lineLimit(3)

                        HStack(spacing: 6) {
                            Text("Facing").font(.caption).foregroundStyle(.secondary)
                            Picker("", selection: $spriteFacing) {
                                Text("Right ▶").tag("right")
                                Text("◀ Left").tag("left")
                                Text("Front").tag("front")
                                Text("Back").tag("back")
                                Text("Top").tag("up")
                            }
                            .labelsHidden()
                            .pickerStyle(.menu)
                            .font(.caption)
                        }

                        Stepper("Frames: \(spriteFrames)", value: $spriteFrames, in: 1...8)
                            .font(.caption)

                        Toggle(isOn: $matchGameArt) {
                            Text("Match existing game art")
                                .font(.caption)
                        }
                        .toggleStyle(.checkbox)
                        .disabled(gameArtRefCount == 0)
                        if matchGameArt && gameArtRefCount > 0 {
                            Text("Sampling \(gameArtRefCount) image\(gameArtRefCount == 1 ? "" : "s") from this design for palette & style.")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        } else if gameArtRefCount == 0 {
                            Text("No game images in this design yet to match.")
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                        }

                        Button {
                            generateSprite()
                        } label: {
                            if isGeneratingSprite {
                                HStack(spacing: 6) {
                                    ProgressView().controlSize(.small)
                                    Text("Designing…")
                                }
                                .frame(maxWidth: .infinity)
                            } else {
                                Label(spriteFrames > 1 ? "Design \(spriteFrames)-Frame Sprite" : "Design Sprite",
                                      systemImage: "sparkles.rectangle.stack")
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(isGeneratingSprite || spritePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                        if let spriteError {
                            Text(spriteError)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        if librarySprites.isEmpty {
                            Text("No sprites yet. Designed sprites appear here to reuse.")
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                                .padding(.top, 2)
                        } else {
                            Text("Library — click to add to the canvas")
                                .font(.system(size: 10))
                                .foregroundStyle(.secondary)
                            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 6) {
                                ForEach(librarySprites, id: \.self) { url in
                                    Button {
                                        viewModel.addImageNode(source: url.path,
                                            name: url.deletingPathExtension().lastPathComponent)
                                    } label: {
                                        spriteThumbnail(url)
                                    }
                                    .buttonStyle(.plain)
                                    .help("Add \(url.lastPathComponent) to the current screen")
                                    .overlay(alignment: .topTrailing) {
                                        Button {
                                            flipSprite(url)
                                        } label: {
                                            Image(systemName: "arrow.left.arrow.right")
                                                .font(.system(size: 8, weight: .bold))
                                                .padding(3)
                                                .background(.thinMaterial, in: Circle())
                                        }
                                        .buttonStyle(.plain)
                                        .help("Flip this sprite left/right")
                                        .padding(2)
                                    }
                                }
                            }
                        }
                    }
                    .onAppear { reloadSprites() }

                    panelSection("Pages") {
                        ForEach(Array(viewModel.project.pages.enumerated()), id: \.element.id) { index, page in
                            Button {
                                viewModel.selectPage(index: index)
                            } label: {
                                HStack {
                                    Image(systemName: index == viewModel.currentPageIndex ? "checkmark.circle.fill" : "circle")
                                    Text(page.name)
                                        .lineLimit(1)
                                    Spacer()
                                    Text("\(page.nodes.count)")
                                        .font(.caption.monospacedDigit())
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.plain)
                        }

                        Button {
                            viewModel.addPage(name: "Studio Page")
                            viewModel.selectPage(index: viewModel.project.pages.count - 1)
                        } label: {
                            Label("New Page", systemImage: "plus")
                        }
                        .buttonStyle(.borderless)
                    }
                }
                .padding(14)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    // Was previously stubbed: it stashed the raw prompt text into imageSource
    // (an invalid path, so the node rendered as an empty box — "does
    // nothing" from the user's side). Now runs the same image pipeline the
    // design agent uses — local Draw Things/MFLUX server first (no API key
    // needed), OpenRouter's hosted endpoint only as a fallback — and patches
    // the result into a placeholder node once it's ready.
    @MainActor
    private func generateAIImage() {
        let prompt = aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }

        aiImageError = nil
        isGeneratingAIImage = true

        // Blank placeholder appears immediately; the real asset patches in
        // once generation finishes, same as the in-app design agent.
        viewModel.addImageNode(source: nil, name: "AI Image")
        guard let nodeId = viewModel.selectedNodeId else {
            isGeneratingAIImage = false
            return
        }

        // The resolved key (if any) is only used if local generation is
        // unavailable and this falls back to OpenRouter's hosted endpoint —
        // an empty string is fine, since local generation needs no key.
        let settings = DesignAgentService.Settings.current()
        let provider = OpenRouterProvider(apiKey: settings.resolvedAPIKey() ?? "", model: settings.model)

        Task {
            do {
                let path = try await provider.generateImageAsset(
                    prompt: prompt,
                    assetKind: nil,
                    aspectRatio: nil,
                    resolution: nil,
                    size: nil
                )
                viewModel.setGeneratedImage(nodeId: nodeId, imagePath: path)
            } catch {
                aiImageError = "Image generation failed: \(error.localizedDescription)"
            }
            isGeneratingAIImage = false
        }
    }

    private func flipSprite(_ url: URL) {
        if let flipped = try? SpriteGenerator.flipHorizontal(pathToImage: url.path) {
            reloadSprites()
            _ = flipped
        }
    }

    private func reloadSprites() {
        librarySprites = SpriteGenerator.librarySprites()
        gameArtRefCount = viewModel.currentArtReferenceImagePaths().count
    }

    private func spriteThumbnail(_ url: URL) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(white: 0.5).opacity(0.12))
            if let img = NSImage(contentsOf: url) {
                Image(nsImage: img)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .padding(4)
            }
        }
        .frame(height: 52)
        .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.secondary.opacity(0.2)))
    }

    private func generateSprite() {
        let prompt = spritePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        spriteError = nil
        isGeneratingSprite = true

        let references = matchGameArt ? viewModel.currentArtReferenceImagePaths() : []
        let facing = spriteFacing

        // Placeholder node appears immediately; the cutout sprite patches in.
        viewModel.addImageNode(source: nil, name: "Sprite")
        let nodeId = viewModel.selectedNodeId

        let settings = DesignAgentService.Settings.current()
        let provider = OpenRouterProvider(apiKey: settings.resolvedAPIKey() ?? "", model: settings.model)

        Task {
            do {
                let result = try await SpriteGenerator.generateSprite(
                    prompt: prompt, frames: spriteFrames,
                    styleReferencePaths: references, facing: facing, provider: provider)
                if let first = result.framePaths.first, let nodeId {
                    // The node previews frame 1; all frames are saved to the
                    // library below for use as an animated game sprite.
                    viewModel.setGeneratedImage(nodeId: nodeId, imagePath: first)
                }
                reloadSprites()
            } catch {
                spriteError = "Sprite design failed: \(error.localizedDescription)"
            }
            isGeneratingSprite = false
        }
    }

    private func chooseImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        if panel.runModal() == .OK, let url = panel.url {
            viewModel.addImageNode(source: url.path, name: url.deletingPathExtension().lastPathComponent)
        }
    }

    private func panelSection<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.caption)
                .textCase(.uppercase)
                .foregroundStyle(.secondary)
            content()
        }
    }

    private func studioTile(_ title: String, _ icon: String, _ detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 18, weight: .medium))
                Text(title)
                    .font(.system(size: 12, weight: .semibold))
                Text(detail)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 76)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }

    private func numberInput(_ label: String, value: Binding<Double>) -> some View {
        HStack(spacing: 4) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 18, alignment: .leading)
            TextField(label, value: value, format: .number)
                .textFieldStyle(.roundedBorder)
        }
    }

    private func iconCommand(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 5) {
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                Text(title)
                    .font(.system(size: 11))
            }
            .frame(maxWidth: .infinity, minHeight: 58)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .help(title)
    }
}

struct CanvasStudioInspectorPanel: View {
    @ObservedObject var viewModel: ProjectViewModel
    @State private var exportMessage: String?
    @State private var exportWidthCM: Double = 100
    @State private var exportHeightCM: Double = 180
    @State private var exportDPI: Double = 150

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Canvas Studio")
                    .font(.headline)
                Spacer()
                Menu {
                    Button {
                        exportPDF()
                    } label: {
                        Label("Export PDF", systemImage: "doc.richtext")
                    }
                    Button {
                        exportJPEG()
                    } label: {
                        Label("Export JPEG", systemImage: "photo")
                    }
                } label: {
                    Image(systemName: "square.and.arrow.up")
                }
                .menuStyle(.borderlessButton)
                .help("Export selected artboard")
            }
            .padding(.top, 16)
            .padding(.horizontal, 16)
            .padding(.bottom, 10)

            Divider()

            if let node = viewModel.selectedNode {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        selectedNodeEditor(node)
                    }
                    .padding(.bottom, 32)
                }
                .id(node.id)
            } else {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "cursorarrow.click.2")
                        .font(.system(size: 28))
                        .foregroundStyle(.secondary)
                    Text("Select a layer")
                        .foregroundStyle(.secondary)
                    if let exportMessage {
                        Text(exportMessage)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    Spacer()
                }
                .frame(maxWidth: .infinity)
                .padding()
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder
    private func selectedNodeEditor(_ node: DesignNode) -> some View {
        section("") {
            TextField("Layer name", text: Binding(
                get: { node.name },
                set: { value in viewModel.updateSelectedNode { $0.name = value } }
            ))
            .textFieldStyle(.roundedBorder)

            HStack(spacing: 8) {
                commandIcon("Duplicate", "plus.square.on.square") { viewModel.duplicateSelection() }
                commandIcon("Front", "square.3.layers.3d.top.filled") { viewModel.bringSelectionToFront() }
                commandIcon("Back", "square.3.layers.3d.down.right") { viewModel.sendSelectionToBack() }
                commandIcon("Delete", "trash") { viewModel.deleteSelectedNode() }
                    .foregroundStyle(.red)
            }
        }

        Divider()
        section("Transform") {
            twoColumnNumbers(
                ("X", node.x, updateNumber { $0.x = $1 }),
                ("Y", node.y, updateNumber { $0.y = $1 })
            )
            twoColumnNumbers(
                ("W", node.width, updateNumber { $0.width = max(1, $1) }),
                ("H", node.height, updateNumber { $0.height = max(1, $1) })
            )
        }

        Divider()
        section("Align") {
            HStack(spacing: 6) {
                alignButton(.left, "align.horizontal.left")
                alignButton(.center, "align.horizontal.center")
                alignButton(.right, "align.horizontal.right")
                alignButton(.top, "align.vertical.top")
                alignButton(.middle, "align.vertical.center")
                alignButton(.bottom, "align.vertical.bottom")
            }
            HStack(spacing: 6) {
                commandIcon("Distribute H", "distribute.horizontal") {
                    viewModel.distributeSelection(axis: .horizontal)
                }
                commandIcon("Distribute V", "distribute.vertical") {
                    viewModel.distributeSelection(axis: .vertical)
                }
            }
            .disabled(viewModel.selectedNodeIds.count < 3)
        }

        Divider()
        section("Style") {
            colorRow("Fill", node.style.fill) { $0.style.fill = $1 }
            colorRow("Stroke", node.style.stroke ?? "#000000") { $0.style.stroke = $1 }
            twoColumnNumbers(
                ("Stroke", node.style.strokeWidth ?? 0, updateNumber(multi: true) { $0.style.strokeWidth = max(0, $1) }),
                ("Radius", node.style.cornerRadius, updateNumber(multi: true) { $0.style.cornerRadius = max(0, $1) })
            )
            sliderRow("Opacity", value: node.style.opacity, range: 0...1) { value in
                viewModel.updateSelectedNodes { $0.style.opacity = value }
            }
        }

        if [NodeType.Text, .Button, .Input].contains(node.type) {
            Divider()
            section("Typography") {
                textRow("Text", node.text ?? "") { $0.text = $1 }
                colorRow("Color", node.style.textColor ?? node.style.fill) { $0.style.textColor = $1 }
                twoColumnNumbers(
                    ("Size", node.style.fontSize ?? 16, updateNumber(multi: true) { $0.style.fontSize = max(1, $1) }),
                    ("Line", node.style.lineHeight ?? ((node.style.fontSize ?? 16) * 1.2), updateNumber(multi: true) { $0.style.lineHeight = max(1, $1) })
                )
                Picker("Weight", selection: Binding(
                    get: { node.style.fontWeight ?? "regular" },
                    set: { value in viewModel.updateSelectedNodes { $0.style.fontWeight = value } }
                )) {
                    Text("Regular").tag("regular")
                    Text("Medium").tag("medium")
                    Text("Semibold").tag("semibold")
                    Text("Bold").tag("bold")
                    Text("Black").tag("black")
                }
                .pickerStyle(.menu)

                Picker("Align", selection: Binding(
                    get: { node.style.textAlign ?? "left" },
                    set: { value in viewModel.updateSelectedNodes { $0.style.textAlign = value } }
                )) {
                    Text("Left").tag("left")
                    Text("Center").tag("center")
                    Text("Right").tag("right")
                }
                .pickerStyle(.segmented)
            }
        }

        if node.type == .Image {
            Divider()
            section("Image") {
                textRow("Source", node.imageSource ?? node.imageName ?? "") {
                    $0.imageSource = $1
                    $0.imageName = $1
                }

                Picker("Crop", selection: Binding(
                    get: { node.contentMode ?? .fill },
                    set: { value in viewModel.updateSelectedNodes { $0.contentMode = value } }
                )) {
                    Text("Fill").tag(ImageContentMode.fill)
                    Text("Fit").tag(ImageContentMode.fit)
                }
                .pickerStyle(.segmented)

                Button {
                    chooseReplacementImage()
                } label: {
                    Label("Replace Image", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
        }

        if node.type == .Icon {
            Divider()
            section("Icon") {
                textRow("SF Symbol", node.iconName ?? "star") { $0.iconName = $1 }
                colorRow("Color", node.style.textColor ?? node.style.fill) { $0.style.textColor = $1 }
            }
        }

        // Repeat / List — clones this node once per item of a bound array
        // variable in the live preview (e.g. from an httpRequest or
        // firestoreQuery). Reference item fields in text/image source as
        // {{item.fieldName}}.
        Divider()
        section("Repeat (List)") {
            textRow("Data Variable", node.repeatBinding?.sourceVariable ?? "") { n, v in
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
                textRow("Item Alias", node.repeatBinding?.itemAlias ?? "item") { n, v in
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

        Divider()
        section("Print Export") {
            twoColumnDoubleInputs(
                ("W cm", $exportWidthCM),
                ("H cm", $exportHeightCM)
            )
            HStack(spacing: 8) {
                doubleInput("DPI", value: $exportDPI)
                Text("\(exportPixelWidth)x\(exportPixelHeight) px")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            HStack(spacing: 8) {
                Button {
                    exportPDF()
                } label: {
                    Label("PDF", systemImage: "doc.richtext")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    exportJPEG()
                } label: {
                    Label("JPEG", systemImage: "photo")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .controlSize(.small)
        }

        Divider()
        section("Effects") {
            twoColumnNumbers(
                ("Blur", node.style.blur ?? 0, updateNumber(multi: true) { $0.style.blur = max(0, $1) }),
                ("Shadow", node.style.shadow?.radius ?? 0, { value in
                    viewModel.updateSelectedNodes { layer in
                        var shadow = layer.style.shadow ?? ShadowStyle(color: "#000000", opacity: 0.18, radius: 0, x: 0, y: 12)
                        shadow.radius = max(0, value)
                        layer.style.shadow = shadow
                    }
                })
            )
            sliderRow("Overlay", value: node.style.overlayOpacity ?? 0, range: 0...1) { value in
                viewModel.updateSelectedNodes { layer in
                    layer.style.overlayColor = layer.style.overlayColor ?? "#000000"
                    layer.style.overlayOpacity = value
                }
            }
        }

        if let exportMessage {
            Text(exportMessage)
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.top, 8)
        }
    }

    private func chooseReplacementImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        if panel.runModal() == .OK, let url = panel.url {
            viewModel.setSelectedImageSource(url.path)
        }
    }

    private func exportJPEG() {
        guard exportWidthCM > 0, exportHeightCM > 0, exportDPI > 0 else {
            exportMessage = "Export size must be positive."
            return
        }

        let maxDimension = max(exportPixelWidth, exportPixelHeight)
        guard maxDimension <= 14_000 else {
            exportMessage = "Lower DPI: \(exportPixelWidth)x\(exportPixelHeight) px is too large for this exporter."
            return
        }

        guard let data = CanvasSnapshotRenderer.jpegData(
            for: viewModel.studioExportNodes(),
            pixelWidth: exportPixelWidth,
            pixelHeight: exportPixelHeight,
            physicalWidthCM: CGFloat(exportWidthCM),
            physicalHeightCM: CGFloat(exportHeightCM)
        ) else {
            exportMessage = "Nothing to export."
            return
        }

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.jpeg]
        panel.nameFieldStringValue = "\(viewModel.currentPage.name)-\(Int(exportWidthCM))x\(Int(exportHeightCM))cm-\(Int(exportDPI))dpi.jpg"
        guard panel.runModal() == .OK, let url = panel.url else { return }

        do {
            try data.write(to: url)
            exportMessage = "Exported \(url.lastPathComponent) at \(Int(exportWidthCM))x\(Int(exportHeightCM))cm, \(Int(exportDPI))DPI."
        } catch {
            exportMessage = "Export failed: \(error.localizedDescription)"
        }
    }

    private func exportPDF() {
        guard exportWidthCM > 0, exportHeightCM > 0, exportDPI > 0 else {
            exportMessage = "Export size must be positive."
            return
        }

        let maxDimension = max(exportPixelWidth, exportPixelHeight)
        guard maxDimension <= 14_000 else {
            exportMessage = "Lower DPI: \(exportPixelWidth)x\(exportPixelHeight) px is too large for this exporter."
            return
        }

        guard let data = CanvasSnapshotRenderer.pdfData(
            for: viewModel.studioExportNodes(),
            physicalWidthCM: CGFloat(exportWidthCM),
            physicalHeightCM: CGFloat(exportHeightCM),
            dpi: CGFloat(exportDPI)
        ) else {
            exportMessage = "Nothing to export."
            return
        }

        let panel = NSSavePanel()
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = "\(viewModel.currentPage.name)-\(Int(exportWidthCM))x\(Int(exportHeightCM))cm.pdf"
        guard panel.runModal() == .OK, let url = panel.url else { return }

        do {
            try data.write(to: url)
            exportMessage = "Exported \(url.lastPathComponent) at \(Int(exportWidthCM))x\(Int(exportHeightCM))cm."
        } catch {
            exportMessage = "PDF export failed: \(error.localizedDescription)"
        }
    }

    private var exportPixelWidth: Int {
        max(1, Int((exportWidthCM / 2.54 * exportDPI).rounded()))
    }

    private var exportPixelHeight: Int {
        max(1, Int((exportHeightCM / 2.54 * exportDPI).rounded()))
    }

    private func section<C: View>(_ title: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if !title.isEmpty {
                Text(title)
                    .font(.caption)
                    .textCase(.uppercase)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
            content()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func commandIcon(_ title: String, _ icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 30, height: 28)
        }
        .buttonStyle(.borderless)
        .help(title)
    }

    private func alignButton(_ alignment: CanvasStudioAlignment, _ icon: String) -> some View {
        commandIcon(alignment.rawValue.capitalized, icon) {
            viewModel.alignSelection(alignment)
        }
        .disabled(viewModel.selectedNodeIds.count < 2)
    }

    private func twoColumnNumbers(
        _ first: (String, CGFloat, (CGFloat) -> Void),
        _ second: (String, CGFloat, (CGFloat) -> Void)
    ) -> some View {
        HStack(spacing: 8) {
            numberField(first.0, first.1, onChange: first.2)
            numberField(second.0, second.1, onChange: second.2)
        }
    }

    private func numberField(_ title: String, _ value: CGFloat, onChange: @escaping (CGFloat) -> Void) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 42, alignment: .leading)
            TextField(title, value: Binding(
                get: { Double(value) },
                set: { onChange(CGFloat($0)) }
            ), format: .number)
            .textFieldStyle(.roundedBorder)
        }
    }

    private func twoColumnDoubleInputs(
        _ first: (String, Binding<Double>),
        _ second: (String, Binding<Double>)
    ) -> some View {
        HStack(spacing: 8) {
            doubleInput(first.0, value: first.1)
            doubleInput(second.0, value: second.1)
        }
    }

    private func doubleInput(_ title: String, value: Binding<Double>) -> some View {
        HStack(spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 42, alignment: .leading)
            TextField(title, value: value, format: .number)
                .textFieldStyle(.roundedBorder)
        }
    }

    private func colorRow(_ title: String, _ value: String, onChange: @escaping (inout DesignNode, String) -> Void) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Spacer()
            TextField(title, text: Binding(
                get: { value },
                set: { newValue in viewModel.updateSelectedNodes { onChange(&$0, newValue) } }
            ))
            .textFieldStyle(.roundedBorder)
            .frame(width: 92)
            ColorPicker("", selection: Binding(
                get: { Color(hex: value) },
                set: { color in viewModel.updateSelectedNodes { onChange(&$0, color.hexString) } }
            ), supportsOpacity: false)
            .labelsHidden()
            .frame(width: 30)
        }
    }

    private func textRow(_ title: String, _ value: String, onChange: @escaping (inout DesignNode, String) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .foregroundStyle(.secondary)
            TextField(title, text: Binding(
                get: { value },
                set: { newValue in viewModel.updateSelectedNodes { onChange(&$0, newValue) } }
            ), axis: .vertical)
            .textFieldStyle(.roundedBorder)
            .lineLimit(3)
        }
    }

    private func sliderRow(_ title: String, value: Double, range: ClosedRange<Double>, onChange: @escaping (Double) -> Void) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(.secondary)
            Slider(value: Binding(get: { value }, set: onChange), in: range)
            Text("\(Int((value * 100).rounded()))")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .frame(width: 34, alignment: .trailing)
        }
    }

    // multi: false (default) targets only the primary selection — used for
    // Transform (X/Y/W/H), where broadcasting an absolute value to every
    // selected node would collapse them onto identical coordinates/size.
    // multi: true targets the whole multi-selection — used for style/content
    // properties (stroke, radius, font size, blur, shadow…) where the same
    // edit is expected to apply to every selected object.
    private func updateNumber(multi: Bool = false, _ change: @escaping (inout DesignNode, CGFloat) -> Void) -> (CGFloat) -> Void {
        { value in
            if multi {
                viewModel.updateSelectedNodesAndRelayout { node in change(&node, value) }
            } else {
                viewModel.updateSelectedNodeAndRelayout { node in change(&node, value) }
            }
        }
    }
}
