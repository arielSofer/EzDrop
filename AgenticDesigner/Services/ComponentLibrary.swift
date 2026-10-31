//
//  ComponentLibrary.swift
//  AgenticDesigner
//
//  Save any node — a card, a nav bar, a whole header — as a reusable
//  component, then drop it into other screens.
//
//  This is the structural answer to a problem the system prompt kept failing
//  to solve by instruction: consistency ACROSS screens. Telling a model "use
//  the same card everywhere" is a wish; giving it one component to instantiate
//  makes divergence impossible. The 91 built-in ComponentFactory types are the
//  vendor's vocabulary — this is the user's own.
//
//  Components live outside any project (Application Support), so one built for
//  a fitness app is available in the next project too.
//

import Foundation
import AppKit

struct SavedComponent: Identifiable, Codable {
    let id: UUID
    var name: String
    var category: String
    /// The node tree, stored exactly as designed.
    var node: DesignNode
    var createdAt: Date

    var width: CGFloat { node.width }
    var height: CGFloat { node.height }
    var childCount: Int { node.children.count }
}

enum ComponentLibrary {

    private static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("AgenticDesigner/Components", isDirectory: true)
    }

    // MARK: - Save / list / delete

    @discardableResult
    static func save(node: DesignNode, name: String, category: String = "General") throws -> SavedComponent {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)

        // A component is a template, not an instance: strip the identities and
        // absolute placement so instantiating it twice can't collide, and so it
        // lands wherever it's dropped rather than where it was designed.
        var template = normalizedForStorage(node)
        template.x = 0
        template.y = 0

        let component = SavedComponent(
            id: UUID(),
            name: name.trimmingCharacters(in: .whitespacesAndNewlines),
            category: category,
            node: template,
            createdAt: Date()
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(component).write(to: url(for: component), options: [.atomic])
        return component
    }

    static func all() -> [SavedComponent] {
        guard let files = try? FileManager.default.contentsOfDirectory(
            at: root, includingPropertiesForKeys: nil
        ) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return files
            .filter { $0.pathExtension == "json" }
            .compactMap { try? decoder.decode(SavedComponent.self, from: Data(contentsOf: $0)) }
            .sorted { $0.createdAt > $1.createdAt }
    }

    static func delete(_ component: SavedComponent) {
        try? FileManager.default.removeItem(at: url(for: component))
    }

    private static func url(for component: SavedComponent) -> URL {
        root.appendingPathComponent("\(component.id.uuidString).json")
    }

    // MARK: - Instantiate

    /// A fresh copy with new ids throughout — two instances of one component
    /// must never share a node id, or selecting one would select both.
    static func instantiate(_ component: SavedComponent, at point: CGPoint) -> DesignNode {
        var copy = withFreshIdentities(component.node)
        copy.x = point.x
        copy.y = point.y
        return copy
    }

    private static func withFreshIdentities(_ node: DesignNode) -> DesignNode {
        var copy = node
        copy.id = UUID()
        copy.children = node.children.map(withFreshIdentities)
        return copy
    }

    /// Logic flows reference node ids, and those ids don't survive the copy —
    /// carrying stale bindings into a new project would silently point at
    /// nothing, so they're dropped at save time and re-wired per instance.
    private static func normalizedForStorage(_ node: DesignNode) -> DesignNode {
        var copy = node
        copy.logicBindings = nil
        copy.children = node.children.map(normalizedForStorage)
        return copy
    }
}
