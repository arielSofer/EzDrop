// Ported 1:1 from AgenticDesigner/Runtime/AgentGameKit.swift (`enum GameSceneLoader`, :566-575)
// plus the DesignNode entry point the designer preview uses
// (Views/NodeView.swift:142 — `node.gameScene != nil, let gameScene = node.effectiveGameSpec`).
//
// Swift loads a bundled `GameScene_<uuid>.json` resource out of `Bundle.main`.
// The browser has no bundle, so resources are registered by name (the exporter
// writes the same names into iOS/Resources) or resolved through an injected
// provider — a fetch/filesystem bridge, for instance. Everything else is the
// Swift behaviour verbatim: an unknown/undecodable resource yields a default
// `GameSceneSpec()` rather than throwing.

import { decodeGameSceneSpec } from '../models/codec';
import type { DesignNode } from '../models/DesignNode';
import { makeGameSceneSpec, type GameSceneSpec } from '../models/GameSpec';
import { nodeEffectiveGameSpec } from '../helpers/GameSceneComposer';

/** Stand-in for `Bundle.main.url(forResource:withExtension:"json")`. */
export interface GameSceneResourceProvider {
  /** The raw JSON text for a resource name, or undefined when absent. */
  load(resourceName: string): string | undefined;
}

let provider: GameSceneResourceProvider | undefined;
const registered = new Map<string, string>();

/**
 * `LogicExporter.gameSceneResourceName(for:)` — the bundled resource name for a
 * game node ("GameScene_" + the node id with its dashes stripped).
 */
export function gameSceneResourceName(node: Pick<DesignNode, 'id'>): string {
  return `GameScene_${node.id.replace(/-/g, '')}`;
}

/**
 * `GameSceneLoader` — loads a GameSceneSpec by bundled resource name. Exported
 * screens call `AgentGameView(spec: GameSceneLoader.load("GameScene_…"))`.
 */
export const GameSceneLoader = {
  /** Installs the resource provider that stands in for `Bundle.main`. */
  setResourceProvider(next: GameSceneResourceProvider | undefined): void {
    provider = next;
  },

  /** Registers one resource's JSON text under its resource name. */
  register(resourceName: string, json: string): void {
    registered.set(resourceName, json);
  },

  /** Forgets every registered resource and the installed provider. */
  reset(): void {
    registered.clear();
    provider = undefined;
  },

  /** `GameSceneLoader.load(_:)` — never throws; missing/bad JSON → `GameSceneSpec()`. */
  load(resourceName: string): GameSceneSpec {
    const json = registered.get(resourceName) ?? provider?.load(resourceName);
    if (json === undefined) return makeGameSceneSpec();
    return GameSceneLoader.decode(json);
  },

  /** Decodes spec JSON with the tolerant decoder; anything unparsable → default spec. */
  decode(json: string): GameSceneSpec {
    try {
      return decodeGameSceneSpec(JSON.parse(json) as unknown);
    } catch {
      return makeGameSceneSpec();
    }
  },

  /**
   * The spec a design node should play: scene settings from `node.gameScene`
   * with entities composed from the node's entity children
   * (`GameSceneComposer.nodeEffectiveGameSpec`). undefined when the node hosts
   * no game.
   */
  loadFromNode(node: DesignNode): GameSceneSpec | undefined {
    return nodeEffectiveGameSpec(node);
  },
};
