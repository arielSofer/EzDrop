// Ported 1:1 from AgenticDesigner/Services/ComponentLibrary.swift
//
// Save any node — a card, a nav bar, a whole header — as a reusable
// component, then drop it into other screens.
//
// This is the structural answer to a problem the system prompt kept failing
// to solve by instruction: consistency ACROSS screens. Telling a model "use
// the same card everywhere" is a wish; giving it one component to instantiate
// makes divergence impossible. The 91 built-in ComponentFactory types are the
// vendor's vocabulary — this is the user's own.
//
// Components live outside any project (Application Support), so one built for
// a fitness app is available in the next project too.

import { decodeDesignNode, encodeDesignNode } from '../models/codec';
import type { DesignNode } from '../models/DesignNode';
import type { Point } from '../models/Geometry';
import { isPlainObject } from '../models/codec';
import { stringifySorted } from '../models/JSON';
import { newUUID } from '../models/uuid';
import type { FileSystem } from '../platform/FileSystem';
import { getPlatform } from '../platform/platform';

export interface SavedComponent {
  id: string;
  name: string;
  category: string;
  /** The node tree, stored exactly as designed. */
  node: DesignNode;
  /** ms since the Unix epoch (Swift `Date`, persisted as ISO8601). */
  createdAt: number;
}

/** `SavedComponent.width` */
export function savedComponentWidth(component: SavedComponent): number {
  return component.node.width;
}
/** `SavedComponent.height` */
export function savedComponentHeight(component: SavedComponent): number {
  return component.node.height;
}
/** `SavedComponent.childCount` */
export function savedComponentChildCount(component: SavedComponent): number {
  return component.node.children.length;
}

function fileSystem(fs?: FileSystem): FileSystem {
  return fs ?? getPlatform().fileSystem;
}

/** `ComponentLibrary.root` — Application Support/AgenticDesigner/Components. */
export function rootDirectory(fs?: FileSystem): string {
  const system = fileSystem(fs);
  return system.join(system.applicationSupportDirectory(), 'Components');
}

function url(component: SavedComponent, fs?: FileSystem): string {
  const system = fileSystem(fs);
  return system.join(rootDirectory(system), `${component.id}.json`);
}

// MARK: - Save / list / delete

/** `ComponentLibrary.save(node:name:category:)` */
export async function save(
  node: DesignNode,
  name: string,
  category: string = 'General',
  fs?: FileSystem,
): Promise<SavedComponent> {
  const system = fileSystem(fs);
  await system.mkdirp(rootDirectory(system));

  // A component is a template, not an instance: strip the identities and
  // absolute placement so instantiating it twice can't collide, and so it
  // lands wherever it's dropped rather than where it was designed.
  const template = normalizedForStorage(node);
  template.x = 0;
  template.y = 0;

  const component: SavedComponent = {
    id: newUUID(),
    name: name.trim(),
    category,
    node: template,
    createdAt: getPlatform().clock.now(),
  };
  await system.writeText(url(component, system), encodeSavedComponent(component));
  return component;
}

/** `ComponentLibrary.all()` — newest first. */
export async function all(fs?: FileSystem): Promise<SavedComponent[]> {
  const system = fileSystem(fs);
  let names: string[];
  try {
    names = await system.readdir(rootDirectory(system));
  } catch {
    return [];
  }
  const components: SavedComponent[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const text = await system.readText(system.join(rootDirectory(system), name));
      components.push(decodeSavedComponent(JSON.parse(text)));
    } catch {
      // `compactMap { try? decoder.decode(...) }` — a corrupt file is skipped.
    }
  }
  return components.sort((a, b) => b.createdAt - a.createdAt);
}

/** `ComponentLibrary.delete(_:)` */
export async function remove(component: SavedComponent, fs?: FileSystem): Promise<void> {
  const system = fileSystem(fs);
  try {
    await system.remove(url(component, system));
  } catch {
    // `try?`
  }
}

// MARK: - Instantiate

/**
 * `ComponentLibrary.instantiate(_:at:)` — a fresh copy with new ids
 * throughout: two instances of one component must never share a node id,
 * or selecting one would select both.
 */
export function instantiate(component: SavedComponent, at: Point): DesignNode {
  const copy = withFreshIdentities(component.node);
  copy.x = at.x;
  copy.y = at.y;
  return copy;
}

function withFreshIdentities(node: DesignNode): DesignNode {
  return { ...node, id: newUUID(), style: { ...node.style }, children: node.children.map(withFreshIdentities) };
}

/**
 * Logic flows reference node ids, and those ids don't survive the copy —
 * carrying stale bindings into a new project would silently point at
 * nothing, so they're dropped at save time and re-wired per instance.
 */
function normalizedForStorage(node: DesignNode): DesignNode {
  const copy: DesignNode = { ...node, style: { ...node.style }, children: node.children.map(normalizedForStorage) };
  delete copy.logicBindings;
  return copy;
}

// MARK: - Codable

/** `JSONEncoder(.prettyPrinted, .sortedKeys, .iso8601)` over `SavedComponent`. */
export function encodeSavedComponent(component: SavedComponent): string {
  return stringifySorted(
    {
      id: component.id,
      name: component.name,
      category: component.category,
      node: encodeDesignNode(component.node),
      createdAt: iso8601String(component.createdAt),
    },
    2,
  );
}

export function decodeSavedComponent(json: unknown): SavedComponent {
  if (!isPlainObject(json)) throw new Error('SavedComponent must be an object');
  const id = json['id'];
  const name = json['name'];
  const category = json['category'];
  const createdAt = json['createdAt'];
  if (typeof id !== 'string' || typeof name !== 'string' || typeof category !== 'string') {
    throw new Error('SavedComponent is missing id/name/category');
  }
  if (typeof createdAt !== 'string') throw new Error('SavedComponent is missing createdAt');
  const parsed = Date.parse(createdAt);
  if (Number.isNaN(parsed)) throw new Error('SavedComponent createdAt is not an ISO8601 date');
  return {
    id,
    name,
    category,
    node: decodeDesignNode(json['node']),
    createdAt: parsed,
  };
}

/** Foundation's `.iso8601` date strategy (internet date-time, UTC, no fractional seconds). */
export function iso8601String(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Static members of the Swift `ComponentLibrary` enum. */
export const ComponentLibrary = {
  save,
  all,
  delete: remove,
  instantiate,
  rootDirectory,
} as const;
