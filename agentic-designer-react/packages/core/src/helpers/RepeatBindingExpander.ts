// Ported 1:1 from AgenticDesigner/Helpers/RepeatBindingExpander.swift
//
// Turns a node tree containing repeatBinding templates into a tree with
// those templates cloned once per item of their bound array variable,
// fields substituted in — a pure transform consumed by the interactive
// preview so CanvasNodeView/NodeView never need to know repeats exist.

import type { DesignNode, RepeatBinding } from '../models/DesignNode';
import { newUUID } from '../models/uuid';
import { swiftInt } from '../agent/DesignAction';

// What a cloned row remembers about where it came from: which template
// node it was cloned from (so a tap on the clone can find the flow wired
// to the template) and which array item produced it (so that flow can
// run with this item's data seeded as variables).
export interface CloneContext {
  templateId: string;
  itemAlias: string;
  itemJSON: string;
  // "alias" → whole item, "alias.field.subfield" → leaf values, ready
  // to merge straight into the simulator's flat variables dictionary.
  variables: Record<string, string>;
}

/** The simulator's flat variables dictionary (`[String: String]`). */
export type RepeatVariables = Record<string, string>;

function lookup(variables: RepeatVariables, name: string): string | undefined {
  return Object.hasOwn(variables, name) ? variables[name] : undefined;
}

/** `String.trimmingCharacters(in: .whitespaces)` — spaces and tabs only, not newlines. */
function trimWhitespaces(text: string): string {
  return text.replace(/^[\p{Zs}\t]+/u, '').replace(/[\p{Zs}\t]+$/u, '');
}

export const RepeatBindingExpander = {
  expand(nodes: DesignNode[], variables: RepeatVariables): DesignNode[] {
    const contexts = new Map<string, CloneContext>();
    return expand(nodes, variables, contexts);
  },

  // Same expansion, but also reports every clone root's CloneContext keyed
  // by the clone's (fresh) node id — the preview's hit-testing uses this to
  // make each cloned row individually tappable with its own item data.
  expandWithContext(nodes: DesignNode[], variables: RepeatVariables): [DesignNode[], Map<string, CloneContext>] {
    const contexts = new Map<string, CloneContext>();
    const expanded = expand(nodes, variables, contexts);
    return [expanded, contexts];
  },

  // The variables a tap on item N of this template should seed — how the
  // MCP preview_tap simulates "tap the Nth row" without a real pointer.
  itemContext(binding: RepeatBinding, variables: RepeatVariables, itemIndex: number): Record<string, string> | undefined {
    const raw = lookup(variables, binding.sourceVariable);
    if (raw === undefined) return undefined;
    const items = parseItems(raw);
    if (items === undefined) return undefined;
    if (!(Number.isInteger(itemIndex) && itemIndex >= 0 && itemIndex < items.length)) return undefined;
    return flattenedVariables(binding.itemAlias, items[itemIndex]);
  },
};

// Recursively expands every repeatBinding template found anywhere in
// `nodes`, reading array data out of `variables`. Nodes without any
// repeat template in their subtree pass through unchanged. A node whose
// DIRECT child is a scrollable repeat template automatically becomes a
// scroll container along that template's axis (unless it already has
// its own explicit scrollBehavior) — that's the "recycler view": one
// cell template + a data source + a direction, wrapped in a viewport.
function expand(nodes: DesignNode[], variables: RepeatVariables, contexts: Map<string, CloneContext>): DesignNode[] {
  return nodes.flatMap((node): DesignNode[] => {
    const binding = node.repeatBinding;
    const raw = binding ? lookup(variables, binding.sourceVariable) : undefined;
    const items = raw !== undefined ? parseItems(raw) : undefined;
    if (!binding || raw === undefined || items === undefined) {
      const updated: DesignNode = { ...node };
      updated.children = expand(node.children, variables, contexts);
      if (updated.scrollBehavior === undefined) {
        const scrollableBinding = node.children.find((child) => child.repeatBinding?.isScrollable === true)?.repeatBinding;
        if (scrollableBinding) {
          updated.scrollBehavior = { axis: scrollableBinding.axis, showsIndicators: true };
        }
      }
      return [updated];
    }

    // Live filters: keep only items matching BOTH the search filter and
    // the category filter (each empty = match all). Category chips and a
    // search box thus filter independently and combine.
    const needle = (name: string | undefined): string | undefined => {
      if (name === undefined) return undefined;
      const value = lookup(variables, name);
      if (value === undefined) return undefined;
      const trimmed = trimWhitespaces(value);
      if (trimmed.length === 0) return undefined;
      return trimmed.toLowerCase();
    };
    const searchNeedle = needle(binding.filterVariable);
    const categoryNeedle = needle(binding.categoryVariable);
    const filtered = items.filter((item) => {
      if (searchNeedle !== undefined && !itemMatches(item, searchNeedle)) return false;
      if (categoryNeedle !== undefined && !itemMatches(item, categoryNeedle)) return false;
      return true;
    });

    const cap = Math.min(binding.maxItems ?? 50, 50);
    const spacing = node.style.spacing ?? 8;
    let cursor = binding.axis === 'horizontal' ? node.x : node.y;

    return filtered.slice(0, Math.max(0, cap)).map((item) => {
      const clone: DesignNode = { ...node };
      clone.id = newUUID();
      delete clone.repeatBinding;
      switch (binding.axis) {
        case 'horizontal':
          clone.x = cursor;
          cursor += node.width + spacing;
          break;
        case 'vertical':
          clone.y = cursor;
          cursor += node.height + spacing;
          break;
      }

      if (node.text !== undefined) clone.text = substituting(node.text, binding.itemAlias, item);
      if (node.imageSource !== undefined) clone.imageSource = substituting(node.imageSource, binding.itemAlias, item);
      if (node.imageName !== undefined) clone.imageName = substituting(node.imageName, binding.itemAlias, item);
      clone.children = substitutingTree(node.children, binding.itemAlias, item);
      contexts.set(clone.id, {
        templateId: node.id,
        itemAlias: binding.itemAlias,
        itemJSON: stringify(item),
        variables: flattenedVariables(binding.itemAlias, item),
      });
      return clone;
    });
  });
}

// "alias" → whole item (JSON for objects, raw value for scalars), plus
// one flat entry per nested leaf: {"title": "X", "author": {"name": "Y"}}
// under alias "book" becomes ["book": …, "book.title": "X",
// "book.author.name": "Y"] — matching the {{book.title}} tokens the
// simulator's substitute() replaces by plain variable-name lookup.
function flattenedVariables(alias: string, item: unknown): Record<string, string> {
  const result: Record<string, string> = { [alias]: stringify(item) };
  flatten(item, alias, result);
  return result;
}

function isDictionary(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flatten(value: unknown, prefix: string, result: Record<string, string>): void {
  if (isDictionary(value)) {
    for (const [key, nested] of Object.entries(value)) {
      const path = `${prefix}.${key}`;
      result[path] = stringify(nested);
      flatten(nested, path, result);
    }
  } else if (Array.isArray(value)) {
    value.forEach((nested, index) => {
      const path = `${prefix}.${index}`;
      result[path] = stringify(nested);
      flatten(nested, path, result);
    });
  }
}

// True if any stringified value inside the item contains `needle`.
function itemMatches(item: unknown, needle: string): boolean {
  if (isDictionary(item)) {
    return Object.values(item).some((value) => itemMatches(value, needle));
  }
  if (Array.isArray(item)) {
    return item.some((value) => itemMatches(value, needle));
  }
  return stringify(item).toLowerCase().includes(needle);
}

// MARK: - Array parsing

// JSON array of objects/scalars (the shape parseJSONResponse/
// firestoreQuery/etc. already produce) with a fallback to the
// newline-separated plain list appendToArray produces, so both of the
// simulator's two "array" representations work as a repeat source.
function parseItems(raw: string): unknown[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // not JSON — fall through to the plain-list form
  }

  // Swift's `split(separator: "\n")` compares Characters, so a "\r\n"
  // grapheme cluster is NOT a separator; empty subsequences are omitted.
  const lines = raw.split(/(?<!\r)\n/).filter((line) => line.length > 0);
  return lines.length === 0 ? undefined : lines;
}

// MARK: - Per-item substitution

function substitutingTree(nodes: DesignNode[], alias: string, item: unknown): DesignNode[] {
  return nodes.map((node) => {
    const updated: DesignNode = { ...node };
    if (node.text !== undefined) updated.text = substituting(node.text, alias, item);
    if (node.imageSource !== undefined) updated.imageSource = substituting(node.imageSource, alias, item);
    if (node.imageName !== undefined) updated.imageName = substituting(node.imageName, alias, item);
    updated.children = substitutingTree(node.children, alias, item);
    return updated;
  });
}

/** `NSRegularExpression.escapedPattern(for:)` */
function escapedPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

// Replaces every {{alias}} or {{alias.path.to.field}} token in `text`
// with the resolved value from `item`.
function substituting(text: string, alias: string, item: unknown): string {
  if (!text.includes('{{')) return text;

  const pattern = '\\{\\{\\s*' + escapedPattern(alias) + '((?:\\.[A-Za-z0-9_]+)*)\\s*\\}\\}';
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, 'g');
  } catch {
    return text;
  }

  return text.replace(regex, (_match: string, group: string | undefined) => {
    let path = '';
    if (group !== undefined) {
      path = group;
      if (path.startsWith('.')) path = path.slice(1);
    }
    return resolve(path, item);
  });
}

function resolve(path: string, item: unknown): string {
  if (path.length === 0) return stringify(item);

  let current: unknown = item;
  for (const component of path.split('.').filter((part) => part.length > 0)) {
    const key = component;
    if (isDictionary(current) && Object.hasOwn(current, key)) {
      current = current[key];
    } else if (Array.isArray(current)) {
      const index = swiftInt(key);
      if (index !== null && index >= 0 && index < current.length) {
        current = current[index];
      } else {
        return '';
      }
    } else {
      return '';
    }
  }
  return stringify(current);
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  // JSON booleans deserialize as NSNumber (CFBoolean) — check Bool
  // first so they print "true"/"false", not "1"/"0".
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value === null || value === undefined) return '<null>'; // "\(NSNull())"
  if (isDictionary(value) || Array.isArray(value)) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
