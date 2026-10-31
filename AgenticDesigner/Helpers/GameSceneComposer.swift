//
//  GameSceneComposer.swift
//  AgenticDesigner
//
//  Games as first-class design: entities live as CHILD NODES of the game
//  frame (draggable, resizable, recolorable on the canvas like any element),
//  and the runtime GameSceneSpec is COMPOSED from them — node geometry/fill/
//  image override the entity config. Legacy games whose spec still embeds
//  entities keep working untouched.
//

import Foundation
import CoreGraphics

extension DesignNode {
    /// True when this game node's entities are modeled as child nodes.
    var hasEntityChildren: Bool {
        children.contains { $0.gameEntity != nil }
    }

    /// The spec the runtime should play: scene settings from `gameScene`,
    /// entities composed from child nodes when present (canvas-edited games),
    /// else the embedded entities (legacy).
    var effectiveGameSpec: GameSceneSpec? {
        guard var spec = gameScene else { return nil }
        let composed = children.compactMap { child -> GameEntity? in
            guard var entity = child.gameEntity else { return nil }
            entity.x = child.x
            entity.y = child.y
            entity.width = child.width
            entity.height = child.height
            if let source = child.imageSource ?? child.imageName, !source.isEmpty {
                entity.sprite = source
            } else if entity.sprite == nil {
                entity.color = child.style.fill
            }
            if entity.id.isEmpty { entity.id = child.name }
            return entity
        }
        if !composed.isEmpty { spec.entities = composed }
        return spec
    }

    /// Converts an embedded-entities game into canvas-editable children.
    /// Returns the children to attach; the caller clears spec.entities.
    static func entityChildren(for spec: GameSceneSpec) -> [DesignNode] {
        spec.entities.map { entity in
            var config = entity
            var node = DesignNode(
                type: entity.sprite != nil ? .Image : .Rectangle,
                name: entity.name.isEmpty ? entity.id : entity.name,
                x: entity.x, y: entity.y,
                width: entity.width, height: entity.height,
                style: NodeStyle(
                    fill: entity.color ?? "#3B82F6",
                    cornerRadius: entity.circleBody ? min(entity.width, entity.height) / 2 : 4,
                    opacity: 1.0,
                    fontSize: nil
                )
            )
            node.imageSource = entity.sprite
            // Geometry/look now live on the node; keep ids/physics/behaviors.
            config.sprite = nil
            node.gameEntity = config
            return node
        }
    }
}
