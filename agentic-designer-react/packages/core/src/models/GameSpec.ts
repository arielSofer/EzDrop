// Ported 1:1 from AgenticDesigner/Runtime/AgentGameKit.swift (data model only:
// GameSceneSpec, ParallaxLayer, GameBodyType, GameEntity, GameBehavior, GameEvent).
// The SpriteKit runtime (AgentGameScene) is ported separately as the game engine.

import { shortUUID } from './uuid';

// MARK: - Data model (the "scene JSON")

/// A complete 2D game scene. Coordinates use the design convention:
/// origin top-left, +y downward, matching the rest of the designer. The
/// runtime converts to SpriteKit's bottom-left/+y-up space internally.
export interface GameSceneSpec {
  version: number;
  width: number;
  height: number;
  /** Solid background color (hex). Ignored where `backgroundImage` is set. */
  backgroundColor: string;
  /** Optional background image (absolute file path or bundled resource name). */
  backgroundImage?: string;
  /** Scene gravity on the y axis. Negative pulls DOWN (SpriteKit convention).
   * ~ -18 feels like Flappy Bird; -9 is floatier. */
  gravity: number;
  /** Horizontal auto-scroll of the background (points/sec). 0 disables it. */
  scrollSpeed: number;
  entities: GameEntity[];
  /** When true the sim waits for the first tap before physics start (Flappy). */
  startPaused: boolean;
  /** Draw the built-in score HUD. */
  showScore: boolean;
  /** Optional score that triggers a "You Win" state. */
  winScore?: number;
  /** Copy shown on the pre-start / restart overlay. */
  tapToStartText: string;

  // — World & camera (side-scrollers, platformers) —
  /** World size when larger than the visible scene; 0 = same as width/height. */
  worldWidth: number;
  worldHeight: number;
  /** Entity id the camera tracks (smooth-follow, clamped to world bounds). */
  cameraFollow?: string;
  /** Scrolling background layers, back to front; speed 0 = pinned to camera
   * (sky), 1 = moves with the world. Depth via 0.2 / 0.5 / 0.8 layering. */
  parallax: ParallaxLayer[];

  // — Atmosphere & audio —
  /** Ambient weather/particle field: "snow" | "rain" | "bubbles" | "stars" | "leaves". */
  ambient?: string;
  /** Looping background music (bundled resource or absolute file path). */
  music?: string;

  // — Game rules —
  /** Player lives; heart HUD. Collisions with action "loseLife" decrement,
   * with ~1s invulnerability blink; 0 → game over. */
  lives?: number;
  /** Countdown in seconds; at 0 `timeUpAction` runs ("gameOver" or "win" —
   * "win" makes it a survive-the-clock mode). */
  timeLimit?: number;
  timeUpAction: string;
  /** Every 10s all spawner intervals multiply by this (0.9 = 10% faster) —
   * difficulty ramps without any extra wiring. 1.0/absent = constant. */
  difficultyRamp?: number;

  // — Depth & atmosphere (the anti-flat pack) —
  /** Vertical background gradient, top→bottom (overrides backgroundColor). */
  backgroundGradient: string[];
  /** Dynamic 2D lighting: sprites get generated normal maps and real
   * shading — cutout art stops looking like flat stickers. */
  lighting: boolean;
  /** Entity id the light follows (usually the player); undefined = scene center. */
  lightFollow?: string;
  /** Light color (hex) when lighting is on. */
  lightColor: string;
  /** Radial darkening at the edges — instant cinematic framing. */
  vignette: boolean;
}

/** Swift `CodingKeys` order for GameSceneSpec. */
export const GameSceneSpecCodingKeys = [
  'version', 'width', 'height', 'backgroundColor', 'backgroundImage', 'gravity',
  'scrollSpeed', 'entities', 'startPaused', 'showScore', 'winScore', 'tapToStartText',
  'worldWidth', 'worldHeight', 'cameraFollow', 'parallax', 'ambient', 'music',
  'lives', 'timeLimit', 'timeUpAction', 'difficultyRamp',
  'backgroundGradient', 'lighting', 'lightFollow', 'lightColor', 'vignette',
] as const satisfies readonly (keyof GameSceneSpec)[];

/** `GameSceneSpec()` — every default from the Swift declaration. */
export function makeGameSceneSpec(init: Partial<GameSceneSpec> = {}): GameSceneSpec {
  const spec: GameSceneSpec = {
    version: init.version ?? 1,
    width: init.width ?? 390,
    height: init.height ?? 844,
    backgroundColor: init.backgroundColor ?? '#8ED0F0',
    gravity: init.gravity ?? -18,
    scrollSpeed: init.scrollSpeed ?? 0,
    entities: init.entities ?? [],
    startPaused: init.startPaused ?? true,
    showScore: init.showScore ?? true,
    tapToStartText: init.tapToStartText ?? 'Tap to start',
    worldWidth: init.worldWidth ?? 0,
    worldHeight: init.worldHeight ?? 0,
    parallax: init.parallax ?? [],
    timeUpAction: init.timeUpAction ?? 'gameOver',
    backgroundGradient: init.backgroundGradient ?? [],
    lighting: init.lighting ?? false,
    lightColor: init.lightColor ?? '#FFF4D6',
    vignette: init.vignette ?? false,
  };
  const optionalKeys = ['backgroundImage', 'winScore', 'cameraFollow', 'ambient', 'music', 'lives', 'timeLimit', 'difficultyRamp', 'lightFollow'] as const;
  for (const key of optionalKeys) {
    const v = init[key];
    if (v !== undefined) (spec as unknown as Record<string, unknown>)[key] = v;
  }
  return spec;
}

/// One scrolling background layer. `speed` is parallax depth: 0 = glued to
/// the camera (far sky), 1 = fixed in the world (foreground).
export interface ParallaxLayer {
  sprite: string;
  speed: number;
  /** Layer height in points (anchored to the scene bottom); undefined = full height. */
  height?: number;
  /** Vertical offset from the bottom, in points. */
  y: number;
}

export function makeParallaxLayer(init: Partial<ParallaxLayer> & { sprite: string }): ParallaxLayer {
  const layer: ParallaxLayer = { sprite: init.sprite, speed: init.speed ?? 0.4, y: init.y ?? 0 };
  if (init.height !== undefined) layer.height = init.height;
  return layer;
}

export const AllGameBodyType = ['none', 'dynamic', 'staticBody', 'kinematic'] as const;
/**
 * none — no physics body: pure visual, moved only by behaviors;
 * dynamic — full physics: gravity, forces, collisions;
 * staticBody — immovable collider (ground, walls);
 * kinematic — collides & reports contacts, but ignores gravity/forces.
 */
export type GameBodyType = (typeof AllGameBodyType)[number];

/**
 * `GameBodyType.init(from:)` — agents write loose synonyms ("static", "fixed",
 * "rigid"); map them instead of failing the whole spec on an enum mismatch.
 * Non-string input decodes as "none" (Swift: `try?` → nil → "none").
 */
export function decodeGameBodyType(json: unknown): GameBodyType {
  const raw = typeof json === 'string' ? json.toLowerCase().replaceAll('_', '') : 'none';
  switch (raw) {
    case 'dynamic':
    case 'rigid':
    case 'physics':
      return 'dynamic';
    case 'static':
    case 'staticbody':
    case 'fixed':
    case 'immovable':
      return 'staticBody';
    case 'kinematic':
    case 'kinematicbody':
    case 'moving':
      return 'kinematic';
    default:
      return 'none';
  }
}

/// One placed object. A template (isTemplate) is NOT placed at start; a
/// `spawner` behavior clones it at runtime.
export interface GameEntity {
  id: string;
  name: string;
  /** Transparent PNG path/resource. When undefined, a solid `color` rectangle is drawn. */
  sprite?: string;
  /** Sprite ANIMATION: extra frame paths cycled at `frameRate` fps (wing
   * flaps, walk cycles). `sprite` is frame 0 when both are set. */
  frames?: string[];
  frameRate?: number;
  color?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  /** degrees */
  rotation: number;

  body: GameBodyType;
  /** Circular physics body instead of a rectangle (balls, birds). */
  circleBody: boolean;
  affectedByGravity: boolean;
  /** bounciness 0…1 */
  restitution: number;
  mass?: number;
  friction: number;
  linearDamping: number;
  allowsRotation: boolean;

  /** Collision category name; entities sharing a name share a physics category. */
  category?: string;
  /** Categories this body physically bounces off. */
  collidesWith: string[];
  /** Categories this body reports overlap with (drives `onCollision`). */
  contacts: string[];

  isTemplate: boolean;
  /** Destructible health; a `destructible` behavior removes the node at 0. */
  health?: number;
  /** Soft elliptical ground shadow under the entity — the cheapest and
   * strongest depth cue there is. */
  dropShadow: boolean;
  /** Additive glow halo behind the entity (hero highlight, pickups). */
  glow: boolean;
  /** A polyline in DESIGN coords ([[x, y], ...]) that becomes solid ground:
   * rendered as a glowing stroke and given an edge-chain physics body. This
   * is how a level gets hills instead of rectangles. */
  points?: number[][];
  /** Stroke width for a `points` terrain. */
  strokeWidth?: number;
  /** Optional tint for the glow halo, independent of the sprite's own color. */
  glowColor?: string;

  behaviors: GameBehavior[];
}

/** Swift `CodingKeys` order for GameEntity. */
export const GameEntityCodingKeys = [
  'id', 'name', 'sprite', 'frames', 'frameRate', 'color', 'x', 'y', 'width', 'height', 'zIndex', 'rotation',
  'body', 'circleBody', 'affectedByGravity', 'restitution', 'mass', 'friction',
  'linearDamping', 'allowsRotation', 'category', 'collidesWith', 'contacts',
  'isTemplate', 'health', 'dropShadow', 'glow', 'glowColor', 'points', 'strokeWidth', 'behaviors',
] as const satisfies readonly (keyof GameEntity)[];

export type GameEntityInit = Partial<GameEntity> & { id: string; x: number; y: number; width: number; height: number };

/** `GameEntity.init(id:name:sprite:color:x:y:width:height:...)` with every Swift default. */
export function makeGameEntity(init: GameEntityInit): GameEntity {
  const e: GameEntity = {
    id: init.id,
    name: init.name ?? '',
    x: init.x,
    y: init.y,
    width: init.width,
    height: init.height,
    zIndex: init.zIndex ?? 0,
    rotation: init.rotation ?? 0,
    body: init.body ?? 'none',
    circleBody: init.circleBody ?? false,
    affectedByGravity: init.affectedByGravity ?? true,
    restitution: init.restitution ?? 0.2,
    friction: init.friction ?? 0.2,
    linearDamping: init.linearDamping ?? 0.1,
    allowsRotation: init.allowsRotation ?? false,
    collidesWith: init.collidesWith ?? [],
    contacts: init.contacts ?? [],
    isTemplate: init.isTemplate ?? false,
    dropShadow: init.dropShadow ?? false,
    glow: init.glow ?? false,
    behaviors: init.behaviors ?? [],
  };
  const optionalKeys = ['sprite', 'frames', 'frameRate', 'color', 'mass', 'category', 'health', 'points', 'strokeWidth', 'glowColor'] as const;
  for (const key of optionalKeys) {
    const v = init[key];
    if (v !== undefined) (e as unknown as Record<string, unknown>)[key] = v;
  }
  return e;
}

/** Swift's fallback id for an entity JSON without `id`: `"entity-" + UUID().uuidString.prefix(8)` */
export function fallbackGameEntityId(): string {
  return `entity-${shortUUID(8)}`;
}

/// A declarative behavior. `type` selects the rule; the remaining fields are a
/// flat union of every rule's parameters (all optional) — no nested/any coding,
/// so the JSON stays trivially LLM-writable, e.g.
/// `{"type":"impulseOnTap","strength":9}`.
export interface GameBehavior {
  type: string;

  // impulseOnTap / launch
  strength?: number;
  /** optional key (macOS) also triggers it */
  key?: string;

  // moveConstant / spawner velocity
  velocityX?: number;
  velocityY?: number;

  // spawner
  /** seconds between spawns */
  interval?: number;
  /** entity id to clone */
  template?: string;
  spawnYMin?: number;
  spawnYMax?: number;
  /** spawns a top+bottom pair with this opening */
  gapSize?: number;
  firstDelay?: number;
  /** Score 1 point when the player passes a spawned obstacle. Defaults ON
   * for gap pairs, OFF for single spawns — set explicitly to override. */
  scoreOnPass?: boolean;
  /** Spawn edge: "left" (default — obstacles enter from the right moving
   * left) or "down" (enter from the top falling down; velocityY = speed). */
  direction?: string;

  // destroyOffscreen
  margin?: number;

  // onCollision
  /** category to react to (also: followEntity target id) */
  target?: string;
  /** gameOver | score | win | removeSelf | removeOther | bounce | damage | loseLife | explode | runFlow */
  action?: string;
  points?: number;
  /** for runFlow (host-handled) */
  flowId?: string;
  soundName?: string;
  /** camera shake on this collision */
  shake?: boolean;

  // slingshot
  maxPower?: number;
  maxDrag?: number;

  // slingshot auto-reload: re-park the next shot once the last one settles.
  // OPT-IN — projects that manage reloads/ammo with their own logic (a shot
  // budget, timed reloads) must leave this off or the two systems fight.
  autoReload?: boolean;

  // bike: a chassis carried by two motorised wheels on pin joints
  wheelRadius?: number;
  /** horizontal distance between the wheels */
  wheelBase?: number;
  /** how far below the chassis centre they sit */
  wheelDrop?: number;
  /** radians/sec at full throttle */
  motorSpeed?: number;
  motorForce?: number;

  // destructible / trail / explode
  /** "debris" | "spark" | "smoke" | "fire" | "confetti" */
  particles?: string;
}

/** Every GameBehavior key in Swift declaration order (type first). */
export const GameBehaviorKeys = [
  'type', 'strength', 'key', 'velocityX', 'velocityY', 'interval', 'template', 'spawnYMin', 'spawnYMax',
  'gapSize', 'firstDelay', 'scoreOnPass', 'direction', 'margin', 'target', 'action', 'points', 'flowId',
  'soundName', 'shake', 'maxPower', 'maxDrag', 'autoReload', 'wheelRadius', 'wheelBase', 'wheelDrop',
  'motorSpeed', 'motorForce', 'particles',
] as const satisfies readonly (keyof GameBehavior)[];

/** `GameBehavior(type:)` plus optional fields (undefined ones are dropped). */
export function makeGameBehavior(init: Partial<GameBehavior> & { type: string }): GameBehavior {
  const b: GameBehavior = { type: init.type };
  for (const key of GameBehaviorKeys) {
    if (key === 'type') continue;
    const v = init[key];
    if (v !== undefined) (b as unknown as Record<string, unknown>)[key] = v;
  }
  return b;
}

/** Convenience builders (`GameBehavior.impulseOnTap(...)` etc.) keep template code readable. */
export const GameBehavior = {
  gravityBody(): GameBehavior {
    return makeGameBehavior({ type: 'gravityBody' });
  },
  impulseOnTap(strength: number, key?: string): GameBehavior {
    return makeGameBehavior({ type: 'impulseOnTap', strength, key });
  },
  moveConstant(vx: number, vy = 0): GameBehavior {
    return makeGameBehavior({ type: 'moveConstant', velocityX: vx, velocityY: vy });
  },
  destroyOffscreen(margin = 120): GameBehavior {
    return makeGameBehavior({ type: 'destroyOffscreen', margin });
  },
  spawner(args: {
    template: string;
    interval: number;
    vx: number;
    gapSize?: number;
    yMin?: number;
    yMax?: number;
    firstDelay?: number;
  }): GameBehavior {
    return makeGameBehavior({
      type: 'spawner',
      template: args.template,
      interval: args.interval,
      velocityX: args.vx,
      gapSize: args.gapSize,
      spawnYMin: args.yMin,
      spawnYMax: args.yMax,
      firstDelay: args.firstDelay,
    });
  },
  onCollision(args: { target: string; action: string; points?: number; sound?: string; particles?: string }): GameBehavior {
    return makeGameBehavior({
      type: 'onCollision',
      target: args.target,
      action: args.action,
      points: args.points,
      soundName: args.sound,
      particles: args.particles,
    });
  },
  slingshot(maxPower = 1800, maxDrag = 120): GameBehavior {
    return makeGameBehavior({ type: 'slingshot', maxPower, maxDrag });
  },
  destructible(particles = 'debris'): GameBehavior {
    return makeGameBehavior({ type: 'destructible', particles });
  },
  wrapVertical(): GameBehavior {
    return makeGameBehavior({ type: 'wrapVertical' });
  },
} as const;

/// Events the scene emits to its host (score/lose/win/start). Optional — the
/// scene is fully self-contained (own HUD + overlays) without a listener.
export type GameEvent =
  | { kind: 'started' }
  | { kind: 'scoreChanged'; score: number }
  | { kind: 'gameOver'; score: number }
  | { kind: 'won'; score: number }
  | { kind: 'runFlow'; flowId: string }
  /** Two categories touched — lets the LOGIC EDITOR react to gameplay
   * ("On Game Collision" event block) without editing the game spec.
   * (categoryA, categoryB, entityIdA, entityIdB) */
  | { kind: 'collision'; categoryA: string; categoryB: string; entityA: string; entityB: string }
  /** Player tapped the scene (design coords, top-left origin). */
  | { kind: 'tap'; x: number; y: number }
  /** Player drag — phase is "start" | "move" | "end" (design coords). */
  | { kind: 'drag'; phase: string; x: number; y: number }
  /** An entity was destroyed (removeOther / explode / health reached 0). */
  | { kind: 'entityDestroyed'; category: string }
  /** The player lost a life; payload = lives remaining. */
  | { kind: 'lifeLost'; remaining: number }
  /** An entity was spawned (spawner / logic); payload = category or id. */
  | { kind: 'spawned'; category: string }
  /** Two categories touched with a physical force (collisionImpulse), plus
   * the two entity IDS — so logic can scale damage by how HARD something
   * hit AND apply it to the exact node that was hit. */
  | { kind: 'impact'; categoryA: string; categoryB: string; force: number; entityA: string; entityB: string }
  /** A slingshot entity was released (id); the shot is in the air. */
  | { kind: 'launched'; entityId: string };
