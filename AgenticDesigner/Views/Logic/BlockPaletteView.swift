//
//  BlockPaletteView.swift
//  AgenticDesigner
//
//  Left sidebar in Logic Mode: draggable block templates grouped by
//  category. Drag onto the canvas, or double-click to add at the center.
//

import SwiftUI
import UniformTypeIdentifiers

struct BlockPaletteView: View {
    @ObservedObject var logicViewModel: LogicViewModel
    @State private var searchText: String = ""
    @State private var expandedCategories: Set<LogicBlockCategory> = [.event, .firebase, .api]

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(spacing: 4) {
                    ForEach(LogicBlockCategory.allCases, id: \.self) { category in
                        categorySection(category)
                    }
                }
                .padding(8)
            }
        }
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private var header: some View {
        VStack(spacing: 8) {
            HStack {
                Image(systemName: "square.grid.2x2")
                    .foregroundStyle(.secondary)
                Text("Blocks")
                    .font(.headline)
                Spacer()
            }

            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                TextField("Search blocks...", text: $searchText)
                    .textFieldStyle(.plain)
                    .font(.system(size: 12))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(Color(nsColor: .controlBackgroundColor))
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .padding(10)
    }

    // MARK: - Category section

    @ViewBuilder
    private func categorySection(_ category: LogicBlockCategory) -> some View {
        let definitions = filteredDefinitions(in: category)

        if !definitions.isEmpty {
            VStack(spacing: 2) {
                Button {
                    if expandedCategories.contains(category) {
                        expandedCategories.remove(category)
                    } else {
                        expandedCategories.insert(category)
                    }
                } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(Color(hex: BlockCatalog.color(for: category)))
                            .frame(width: 8, height: 8)

                        Text(category.rawValue)
                            .font(.system(size: 11, weight: .semibold))

                        Text("\(definitions.count)")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Color(nsColor: .controlBackgroundColor))
                            .clipShape(Capsule())

                        Spacer()

                        Image(systemName: isExpanded(category) ? "chevron.down" : "chevron.right")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)

                if isExpanded(category) {
                    ForEach(definitions, id: \.type) { definition in
                        paletteItem(definition)
                    }
                }
            }
        }
    }

    private func isExpanded(_ category: LogicBlockCategory) -> Bool {
        expandedCategories.contains(category) || !searchText.isEmpty
    }

    private func filteredDefinitions(in category: LogicBlockCategory) -> [BlockDefinition] {
        let all = BlockCatalog.definitions(in: category)
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !query.isEmpty else { return all }
        return all.filter {
            $0.label.lowercased().contains(query) || $0.description.lowercased().contains(query)
        }
    }

    // MARK: - Palette item

    private func paletteItem(_ definition: BlockDefinition) -> some View {
        let firebaseUnavailable = definition.category == .firebase && !isFirebaseConfigured

        return HStack(spacing: 8) {
            Image(systemName: definition.icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white)
                .frame(width: 24, height: 24)
                .background(Color(hex: definition.color))
                .clipShape(RoundedRectangle(cornerRadius: 6))

            VStack(alignment: .leading, spacing: 1) {
                Text(definition.label)
                    .font(.system(size: 11, weight: .medium))
                    .lineLimit(1)
                Text(definition.description)
                    .font(.system(size: 9))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if firebaseUnavailable {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(.orange)
                    .help("Configure Firebase first")
            }
        }
        .padding(6)
        .background(Color(nsColor: .controlBackgroundColor).opacity(0.6))
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .opacity(firebaseUnavailable ? 0.55 : 1)
        .contentShape(Rectangle())
        .onDrag {
            NSItemProvider(object: definition.type.rawValue as NSString)
        }
        .onTapGesture(count: 2) {
            addAtCanvasCenter(definition.type)
        }
        .help(definition.description + " — drag to canvas or double-click to add")
    }

    private var isFirebaseConfigured: Bool {
        logicViewModel.designViewModel?.project.firebaseConfig?.isConfigured ?? false
    }

    private func addAtCanvasCenter(_ type: LogicBlockType) {
        let center = CGPoint(
            x: (420 - logicViewModel.canvasOffset.width) / logicViewModel.canvasZoom,
            y: (280 - logicViewModel.canvasOffset.height) / logicViewModel.canvasZoom
        )
        logicViewModel.addBlock(type: type, at: center)
    }
}
