// Ported 1:1 from AgenticDesigner/Runtime/AgentGameKit.swift
// (`struct AgentGameView: View` / `private struct AgentGameViewHost: View`, :2404-2453).
//
// SwiftUI's SpriteView becomes a <canvas> that an AgentGameScene renders into.
// The Swift keeps the SKScene in @State so it survives re-renders and rebuilds
// it `.onChange(of: spec)`; the port keeps the scene in a ref and rebuilds when
// the spec's serialized value changes (GameSceneSpec is Equatable in Swift), so
// game-inspector sliders and `update_game_scene` still tune the game live.
//
// The scene registers itself in GameSceneRegistry under `nodeId`, which is how
// the LogicSimulator's game blocks reach this exact preview.

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react';
import { encodeGameSceneSpec, type GameCommand, type GameEvent, type GameSceneSpec } from '@agentic/core';
import { AgentGameScene } from './AgentGameScene';
import {
  PreviewVariableBindingProvider,
  useGameEventHandler,
  useIsCanvasSnapshot,
  usePreviewVariableBinding,
  type PreviewVariableBinding,
} from './gameContexts';
import type { TextureLoader } from './SpriteKitCompat';

/** The command sink an owner (or the LogicSimulator) drives the scene through. */
export interface AgentGameViewHandle {
  /** `AgentGameScene.handleCommand(_:)` */
  send(command: GameCommand): void;
  /** `AgentGameScene.queryState(_:_:)` */
  queryState(what: string, target: string): string;
  /** The live scene, for hosts that need more than the sink. */
  readonly scene: AgentGameScene | null;
}

export interface AgentGameViewProps {
  spec: GameSceneSpec;
  /** DesignNode id hosting the game — the registry key for command dispatch. */
  nodeId?: string;
  /** Node size in points; defaults to the spec's own size. */
  width?: number;
  height?: number;
  /** `EnvironmentValues.isCanvasSnapshot` — renders one static frame instead
   *  of running the game (the poster view handles real snapshot paths). */
  isCanvasSnapshot?: boolean;
  /** `EnvironmentValues.previewVariableBinding`, passed down to children. */
  previewVariableBinding?: PreviewVariableBinding;
  /** `EnvironmentValues.gameEventHandler` — the game → logic bridge. */
  onGameEvent?: (event: GameEvent) => void;
  /** SpriteView eats clicks; the canvas is only interactive when this is true
   *  (NodeView: `.allowsHitTesting(isSelected || gameEventHandler != nil)`). */
  interactive?: boolean;
  cornerRadius?: number;
  className?: string;
  style?: CSSProperties;
  textureLoader?: TextureLoader;
  /** Seedable RNG — tests and deterministic replays. */
  random?: () => number;
}

export const AgentGameView = forwardRef<AgentGameViewHandle, AgentGameViewProps>(function AgentGameView(props, ref) {
  const contextSnapshot = useIsCanvasSnapshot();
  const contextHandler = useGameEventHandler();
  const contextBinding = usePreviewVariableBinding();

  const isCanvasSnapshot = props.isCanvasSnapshot ?? contextSnapshot;
  const onGameEvent = props.onGameEvent ?? contextHandler;
  const previewVariableBinding = props.previewVariableBinding ?? contextBinding;

  return (
    <PreviewVariableBindingProvider value={previewVariableBinding}>
      <AgentGameViewHost
        {...props}
        ref={ref}
        isCanvasSnapshot={isCanvasSnapshot}
        onGameEvent={onGameEvent}
      />
    </PreviewVariableBindingProvider>
  );
});

/**
 * Holds the scene in a ref so it survives React re-renders — otherwise the
 * game would reset every time the hosting view redraws (e.g. canvas selection).
 */
const AgentGameViewHost = forwardRef<AgentGameViewHandle, AgentGameViewProps>(function AgentGameViewHost(props, ref) {
  const {
    spec, nodeId = '', width, height, isCanvasSnapshot = false, onGameEvent,
    interactive = true, cornerRadius = 0, className, style, textureLoader, random,
  } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<AgentGameScene | null>(null);
  const eventRef = useRef<((event: GameEvent) => void) | undefined>(onGameEvent);
  eventRef.current = onGameEvent;

  const nodeWidth = width ?? spec.width;
  const nodeHeight = height ?? spec.height;
  // GameSceneSpec is Equatable in Swift; its canonical JSON is the port's
  // equality, so `.onChange(of: spec)` becomes "this string changed".
  const specKey = useMemo(() => JSON.stringify(encodeGameSceneSpec(spec)), [spec]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const scene = new AgentGameScene({
      spec,
      size: { width: spec.width, height: spec.height },
      canvas,
      nodeId,
      onEvent: (event) => eventRef.current?.(event),
      autoRun: !isCanvasSnapshot,
      handlesInput: !isCanvasSnapshot && interactive,
      textureLoader,
      random,
    });
    sceneRef.current = scene;
    scene.didMove();
    if (isCanvasSnapshot) scene.render();
    return () => {
      scene.destroy();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
    // A CHANGED spec (game-inspector sliders, update_game_scene) rebuilds the
    // scene instantly — tuning is play-as-you-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specKey, nodeId, isCanvasSnapshot, interactive, textureLoader, random]);

  // Keep the backing store in step with the node size (and the display DPR).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(nodeWidth * dpr));
    canvas.height = Math.max(1, Math.round(nodeHeight * dpr));
    sceneRef.current?.render();
  }, [nodeWidth, nodeHeight, specKey]);

  useImperativeHandle(ref, (): AgentGameViewHandle => ({
    send(command: GameCommand) { sceneRef.current?.send(command); },
    queryState(what: string, target: string) { return sceneRef.current?.queryState(what, target) ?? ''; },
    get scene() { return sceneRef.current; },
  }), []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: nodeWidth,
        height: nodeHeight,
        display: 'block',
        borderRadius: cornerRadius,
        outline: 'none',
        touchAction: 'none',
        pointerEvents: interactive && !isCanvasSnapshot ? 'auto' : 'none',
        ...style,
      }}
    />
  );
});
