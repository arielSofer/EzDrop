// Ported 1:1 from AgenticDesigner/Services/ComponentLibrary.swift (disk half)
//
// Save any node — a card, a nav bar, a whole header — as a reusable component.
// Components live outside any project (Application Support/AgenticDesigner/
// Components/<UUID>.json). `instantiate` (fresh ids) runs in the editor.
import fs from 'node:fs';
import path from 'node:path';
import { agenticSupportDirectory, ensureDirectory, pathExtension, uuidString, writeFileAtomic } from '../platform/Paths.js';
import { prettySortedJSON } from '../platform/json.js';

export type DesignNodeJSON = Record<string, unknown> & {
  x?: number;
  y?: number;
  children?: DesignNodeJSON[];
  logicBindings?: unknown;
};

export interface SavedComponent {
  id: string;
  name: string;
  category: string;
  /// The node tree, stored exactly as designed.
  node: DesignNodeJSON;
  /// ISO-8601 (JSONEncoder.dateEncodingStrategy = .iso8601)
  createdAt: string;
}

export function componentWidth(component: SavedComponent): number {
  return typeof component.node.width === 'number' ? component.node.width : 0;
}
export function componentHeight(component: SavedComponent): number {
  return typeof component.node.height === 'number' ? component.node.height : 0;
}
export function componentChildCount(component: SavedComponent): number {
  return Array.isArray(component.node.children) ? component.node.children.length : 0;
}

export const ComponentLibrary = {
  root(): string {
    return agenticSupportDirectory('Components');
  },

  // MARK: - Save / list / delete

  save(node: DesignNodeJSON, name: string, category: string = 'General'): SavedComponent {
    ensureDirectory(ComponentLibrary.root());

    // A component is a template, not an instance: strip the identities and
    // absolute placement so instantiating it twice can't collide, and so it
    // lands wherever it's dropped rather than where it was designed.
    const template = normalizedForStorage(node);
    template.x = 0;
    template.y = 0;

    const component: SavedComponent = {
      id: uuidString(),
      name: name.trim(),
      category,
      node: template,
      createdAt: iso8601Now(),
    };
    writeFileAtomic(urlFor(component), prettySortedJSON(component));
    return component;
  },

  all(): SavedComponent[] {
    let names: string[];
    try {
      names = fs.readdirSync(ComponentLibrary.root());
    } catch {
      return [];
    }
    const components: SavedComponent[] = [];
    for (const fileName of names) {
      if (pathExtension(fileName) !== 'json') continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(ComponentLibrary.root(), fileName), 'utf8'));
        if (parsed && typeof parsed.id === 'string' && typeof parsed.name === 'string' && parsed.node && typeof parsed.node === 'object') {
          components.push({
            id: parsed.id,
            name: parsed.name,
            category: typeof parsed.category === 'string' ? parsed.category : 'General',
            node: parsed.node,
            createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
          });
        }
      } catch {
        // Undecodable files are skipped, like `try? decoder.decode`.
      }
    }
    return components.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  },

  delete(component: Pick<SavedComponent, 'id'>): boolean {
    try {
      fs.rmSync(urlFor(component));
      return true;
    } catch {
      return false;
    }
  },
};

function urlFor(component: Pick<SavedComponent, 'id'>): string {
  return path.join(ComponentLibrary.root(), `${component.id}.json`);
}

/// Logic flows reference node ids, and those ids don't survive the copy —
/// carrying stale bindings into a new project would silently point at
/// nothing, so they're dropped at save time and re-wired per instance.
function normalizedForStorage(node: DesignNodeJSON): DesignNodeJSON {
  const copy: DesignNodeJSON = { ...node };
  delete copy.logicBindings;
  copy.children = Array.isArray(node.children) ? node.children.map(normalizedForStorage) : [];
  return copy;
}

/// ISO8601DateFormatter / .iso8601 encoding: whole seconds, Z suffix.
function iso8601Now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
