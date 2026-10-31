// Ported 1:1 from AgenticDesigner/Runtime/AgentGameKit.swift (`enum GameSceneRegistry`, :476-504).
//
// Live scenes register here so logic blocks can reach them — the same
// mechanism serves the designer preview and exported apps.
//
// Swift holds WEAK references to `AgentGameScene` so a dead scene drops out of
// the list by itself. JavaScript has no weak object graph that can be walked,
// so a scene must `unregister` when it is torn down (AgentGameView does this on
// unmount); registering the same nodeId twice replaces the older entry, exactly
// like Swift's `scenes.removeAll { $0.scene === scene }` before `append`.

import type { GameCommand } from '../models/GameCommand';

/**
 * What ONE live scene offers the logic layer: the command sink half of the
 * game↔logic bridge (`AgentGameScene.handleCommand` / `.queryState`).
 * `GameSceneRegistry` itself implements the registry-wide
 * `GameCommandSink` (services/hosts.ts) on top of these.
 */
export interface GameSceneCommandSink {
  /** Logic-block commands — the logic editor's remote control over the scene. */
  send(command: GameCommand): void;
  /** Synchronous state read for logic queries (Game Query block). */
  queryState(what: string, target: string): string;
}

interface RegisteredScene {
  /** The DesignNode id hosting the scene ("" when the host has no node id). */
  nodeId: string;
  scene: GameSceneCommandSink;
}

let scenes: RegisteredScene[] = [];

/**
 * `GameSceneRegistry` — the registry of live scenes, keyed by the node id of
 * the design node hosting each scene (Swift keys only by identity; the port
 * adds the node id so the LogicSimulator can address ONE scene when several
 * game nodes are on screen).
 */
export const GameSceneRegistry = {
  /** `GameSceneRegistry.register(_:)` */
  register(scene: GameSceneCommandSink, nodeId = ''): void {
    scenes = scenes.filter((holder) => holder.scene !== scene && (nodeId === '' || holder.nodeId !== nodeId));
    scenes.push({ nodeId, scene });
  },

  /** Removes a scene (Swift relies on the weak reference going nil). */
  unregister(scene: GameSceneCommandSink): void {
    scenes = scenes.filter((holder) => holder.scene !== scene);
  },

  /** `GameSceneRegistry.sceneCount` */
  get sceneCount(): number {
    return scenes.length;
  },

  /** Node ids of every registered scene, in registration order. */
  get nodeIds(): string[] {
    return scenes.map((holder) => holder.nodeId);
  },

  /** `GameSceneRegistry.broadcast(_:)` — every live scene handles the command. */
  broadcast(command: GameCommand): void {
    for (const holder of [...scenes]) holder.scene.send(command);
  },

  /**
   * Sends a command to the scene hosted by `nodeId` only (returns false when no
   * scene is registered for it). Not in the Swift — the Swift app only ever has
   * one interactive scene, the port can host several previews at once.
   */
  send(nodeId: string, command: GameCommand): boolean {
    const holder = scenes.find((h) => h.nodeId === nodeId);
    if (holder === undefined) return false;
    holder.scene.send(command);
    return true;
  },

  /** The sink registered for a node id, if any. */
  scene(nodeId: string): GameSceneCommandSink | undefined {
    return scenes.find((holder) => holder.nodeId === nodeId)?.scene;
  },

  /** The scene that answers `query` (Swift: `scenes.first`). */
  get firstScene(): GameSceneCommandSink | undefined {
    return scenes[0]?.scene;
  },

  /**
   * `GameSceneRegistry.query(_:_:)` — synchronous state read for logic queries
   * (first live scene answers): what = positionX|positionY|health|count|score|
   * lives|timeLeft|velocityX|velocityY|rotation.
   */
  query(what: string, target: string): string {
    const scene = scenes[0]?.scene;
    if (scene === undefined) return '';
    return scene.queryState(what, target);
  },

  /** Test/teardown helper — drops every registration. */
  reset(): void {
    scenes = [];
  },
};
