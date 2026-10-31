// Ported 1:1 from AgenticDesigner/Helpers/GameSceneComposer.swift
//
// Games as first-class design: entities live as CHILD NODES of the game
// frame (draggable, resizable, recolorable on the canvas like any element),
// and the runtime GameSceneSpec is COMPOSED from them — node geometry/fill/
// image override the entity config. Legacy games whose spec still embeds
// entities keep working untouched.
//
// The Swift `extension DesignNode` members become free functions here.

import { makeDesignNode, type DesignNode } from '../models/DesignNode';
import type { GameEntity, GameSceneSpec } from '../models/GameSpec';

/** `DesignNode.hasEntityChildren` — true when this game node's entities are modeled as child nodes. */
export function nodeHasEntityChildren(node: DesignNode): boolean {
  return node.children.some((child) => child.gameEntity !== undefined);
}

/**
 * `DesignNode.effectiveGameSpec` — the spec the runtime should play: scene
 * settings from `gameScene`, entities composed from child nodes when present
 * (canvas-edited games), else the embedded entities (legacy).
 */
export function nodeEffectiveGameSpec(node: DesignNode): GameSceneSpec | undefined {
  if (node.gameScene === undefined) return undefined;
  const spec: GameSceneSpec = { ...node.gameScene };
  const composed: GameEntity[] = [];
  for (const child of node.children) {
    if (child.gameEntity === undefined) continue;
    const entity: GameEntity = { ...child.gameEntity };
    entity.x = child.x;
    entity.y = child.y;
    entity.width = child.width;
    entity.height = child.height;
    const source = child.imageSource ?? child.imageName;
    if (source !== undefined && source.length > 0) {
      entity.sprite = source;
    } else if (entity.sprite === undefined) {
      entity.color = child.style.fill;
    }
    if (entity.id.length === 0) entity.id = child.name;
    composed.push(entity);
  }
  if (composed.length > 0) spec.entities = composed;
  return spec;
}

/**
 * `DesignNode.entityChildren(for:)` — converts an embedded-entities game into
 * canvas-editable children. Returns the children to attach; the caller clears
 * spec.entities.
 */
export function entityChildren(spec: GameSceneSpec): DesignNode[] {
  return spec.entities.map((entity) => {
    const config: GameEntity = { ...entity };
    const node = makeDesignNode({
      type: entity.sprite !== undefined ? 'Image' : 'Rectangle',
      name: entity.name.length === 0 ? entity.id : entity.name,
      x: entity.x,
      y: entity.y,
      width: entity.width,
      height: entity.height,
      style: {
        fill: entity.color ?? '#3B82F6',
        cornerRadius: entity.circleBody ? Math.min(entity.width, entity.height) / 2 : 4,
        opacity: 1.0,
      },
    });
    if (entity.sprite !== undefined) node.imageSource = entity.sprite;
    // Geometry/look now live on the node; keep ids/physics/behaviors.
    delete config.sprite;
    node.gameEntity = config;
    return node;
  });
}
