// Ported 1:1 from AgenticDesigner/Views/GameScenePosterView.swift (:17-58) —
// the three `EnvironmentKey`s the game/preview plumbing rides on. SwiftUI
// `@Environment(\.key)` becomes a React context with the same default value;
// the poster view itself lives in GameScenePosterView.tsx.

import { createContext, useContext, type ReactNode } from 'react';
import type { GameEvent } from '@agentic/core';

// MARK: - isCanvasSnapshot

/** `private struct IsCanvasSnapshotKey: EnvironmentKey { static let defaultValue = false }` */
const IsCanvasSnapshotContext = createContext<boolean>(false);

/** `EnvironmentValues.isCanvasSnapshot` — true while rendering inside
 *  CanvasSnapshotRenderer (offscreen). */
export function useIsCanvasSnapshot(): boolean {
  return useContext(IsCanvasSnapshotContext);
}

export function IsCanvasSnapshotProvider(props: { value: boolean; children: ReactNode }) {
  return (
    <IsCanvasSnapshotContext.Provider value={props.value}>
      {props.children}
    </IsCanvasSnapshotContext.Provider>
  );
}

// MARK: - previewVariableBinding

/** SwiftUI's `Binding<String>`: a value plus the setter that writes it back. */
export interface PreviewBinding<T> {
  value: T;
  set: (newValue: T) => void;
}

/** `(variableName, default) -> Binding<String>` */
export type PreviewVariableBinding = (name: string, defaultValue: string) => PreviewBinding<string>;

/** `private struct PreviewVariableBindingKey: EnvironmentKey { static let defaultValue: ((String, String) -> Binding<String>)? = nil }` */
const PreviewVariableBindingContext = createContext<PreviewVariableBinding | undefined>(undefined);

/**
 * `EnvironmentValues.previewVariableBinding` — live variable bindings for
 * interactive controls (time pickers) in the preview: (variableName, default)
 * → Binding into the LogicSimulator. undefined on the plain canvas — controls
 * render statically there.
 */
export function usePreviewVariableBinding(): PreviewVariableBinding | undefined {
  return useContext(PreviewVariableBindingContext);
}

export function PreviewVariableBindingProvider(
  props: { value: PreviewVariableBinding | undefined; children: ReactNode },
) {
  return (
    <PreviewVariableBindingContext.Provider value={props.value}>
      {props.children}
    </PreviewVariableBindingContext.Provider>
  );
}

// MARK: - gameEventHandler

/** `private struct GameEventHandlerKey: EnvironmentKey { static let defaultValue: ((GameEvent) -> Void)? = nil }` */
const GameEventHandlerContext = createContext<((event: GameEvent) => void) | undefined>(undefined);

/**
 * `EnvironmentValues.gameEventHandler` — game → logic bridge: the interactive
 * preview injects a handler that routes GameEvents (score, game over, win,
 * runFlow) into the LogicSimulator. undefined on the plain design canvas —
 * games play standalone.
 */
export function useGameEventHandler(): ((event: GameEvent) => void) | undefined {
  return useContext(GameEventHandlerContext);
}

export function GameEventHandlerProvider(
  props: { value: ((event: GameEvent) => void) | undefined; children: ReactNode },
) {
  return (
    <GameEventHandlerContext.Provider value={props.value}>
      {props.children}
    </GameEventHandlerContext.Provider>
  );
}
