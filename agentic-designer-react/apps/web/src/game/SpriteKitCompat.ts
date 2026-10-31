// Support kernel for the AgentGameKit port — the small slice of SpriteKit that
// Runtime/AgentGameKit.swift actually uses (SKNode/SKSpriteNode/SKShapeNode/
// SKLabelNode/SKEmitterNode/SKCameraNode, SKAction, SKPhysicsBody/World,
// SKColor, SKTexture), reimplemented on a 2D <canvas> + matter-js so
// AgentGameScene.ts can stay a line-by-line port of the Swift scene.
//
// ─────────────────────────────────────────────────────────────────────────
// COORDINATE SYSTEMS (the one place they are defined)
// ─────────────────────────────────────────────────────────────────────────
//  DESIGN space  — what a GameSceneSpec is authored in and what GameEvent /
//                  GameCommand payloads carry: origin TOP-LEFT, +y DOWN.
//  SCENE space   — SpriteKit's space, used by every internal computation and
//                  by matter-js here: origin BOTTOM-LEFT of the world, +y UP,
//                  1 unit = 1 point. design→scene and scene→design are the
//                  same involution:  { x, worldHeight - y }  (the Swift's
//                  `designPoint(_:)` / `worldSize.height - e.y - e.height/2`).
//  CANVAS space  — device pixels on the <canvas>: origin TOP-LEFT, +y DOWN,
//                  produced from SCENE space by the camera transform
//                  (see `sceneToCanvas`). Rotation is drawn as -zRotation so a
//                  positive zRotation still reads counter-clockwise on screen.
//  MATTER space  — identical to SCENE space. matter-js never sees a screen, so
//                  feeding it a +y-up frame is only a relabelling: no vertex
//                  data is mirrored, therefore polygon winding (and with it
//                  every collision normal) stays correct.
//
// PHYSICS UNITS. SpriteKit measures distance in points but simulates in
// metres at 150 points/metre, so `physicsWorld.gravity = (0, spec.gravity)`
// accelerates at `spec.gravity * 150` points/s² (verified twice in the app:
// see the game-engine notes). Velocities are points/second, and an impulse
// changes velocity by `impulse / mass` points/second (this is why the Swift
// slingshot switched from applyImpulse to setting velocity). matter-js
// integrates in pixels-per-timestep, so the adapter below converts:
//     velocity_matter = velocity_points_per_second / 60
//     force = mass * acceleration_points_per_second² / 1e6   (at a 1/60 step)
// Default mass follows SpriteKit: area in points² / 150² × density 1.0.

import Matter from 'matter-js';
import type { Point, Size } from '@agentic/core';

export const POINTS_PER_METRE = 150;
/** SpriteKit's fixed simulation rate; the runtime steps at exactly this. */
export const FIXED_TIMESTEP = 1 / 60;

export interface Vector { dx: number; dy: number }
export const vectorZero = (): Vector => ({ dx: 0, dy: 0 });
export const pointZero = (): Point => ({ x: 0, y: 0 });

/** design ⇄ scene (both directions — the conversion is its own inverse). */
export function flipY(p: Point, worldHeight: number): Point {
  return { x: p.x, y: worldHeight - p.y };
}

// MARK: - Color helper (SKColor is NSColor on macOS, UIColor on iOS)

export interface SKColor { r: number; g: number; b: number; a: number }

export function rgba(r: number, g: number, b: number, a = 1): SKColor {
  return { r, g, b, a };
}

/** SKColor palette used by the Swift runtime (system colors resolved as AppKit does). */
export const SKColors = {
  clear: rgba(0, 0, 0, 0),
  white: rgba(1, 1, 1, 1),
  black: rgba(0, 0, 0, 1),
  gray: rgba(0.5, 0.5, 0.5, 1),
  cyan: rgba(0, 1, 1, 1),
  yellow: rgba(1, 1, 0, 1),
  orange: rgba(1, 0.5, 0, 1),
  brown: rgba(0.6, 0.4, 0.2, 1),
  systemBlue: rgba(0, 0.478, 1, 1),
  systemGreen: rgba(0.204, 0.78, 0.349, 1),
  systemOrange: rgba(1, 0.584, 0, 1),
  systemRed: rgba(1, 0.231, 0.188, 1),
  systemPink: rgba(1, 0.176, 0.333, 1),
} as const;

/** `private func skColor(_ hex: String?, fallback: SKColor = .gray) -> SKColor` */
export function skColor(hex: string | undefined | null, fallback: SKColor = SKColors.gray): SKColor {
  let s = (hex ?? '').trim();
  if (s.length === 0) return fallback;
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3) s = s.split('').map((c) => `${c}${c}`).join('');
  if (!/^[0-9a-fA-F]+$/.test(s)) return fallback;
  const v = Number.parseInt(s, 16);
  if (!Number.isFinite(v)) return fallback;
  const hasAlpha = s.length === 8;
  if (hasAlpha) {
    return rgba(((v >>> 24) & 0xff) / 255, ((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255);
  }
  return rgba(((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255, 1);
}

/** `SKColor.withAlphaComponent(_:)` */
export function withAlphaComponent(color: SKColor, alpha: number): SKColor {
  return rgba(color.r, color.g, color.b, alpha);
}

export function cssColor(color: SKColor, alphaScale = 1): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${c(color.r)}, ${c(color.g)}, ${c(color.b)}, ${Math.max(0, Math.min(1, color.a * alphaScale))})`;
}

// MARK: - Textures

/** `SKTexture` — a loaded (or still-loading) image plus its natural size. */
export interface SKTexture {
  /** The reference the spec used (absolute path, URL or resource name). */
  ref: string;
  image: CanvasImageSource | null;
  width: number;
  height: number;
  /** True when this is a placeholder drawn for an SF-symbol-style name. */
  isSymbolPlaceholder: boolean;
  symbolName?: string;
}

export function textureSize(texture: SKTexture): Size {
  return { width: texture.width, height: texture.height };
}

/** Pluggable stand-in for the Swift `loadTexture(_:)` bundle/file lookup. */
export interface TextureLoader {
  load(ref: string): SKTexture | undefined;
}

const SPRITE_EXTENSIONS = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i;

/**
 * `private func loadTexture(_ ref: String?) -> SKTexture?`
 *
 * Swift tries (1) an absolute file path, (2) a bundled resource, (3) a named
 * asset. In the browser every one of those is a URL: an absolute path is served
 * by the local bridge, a bare resource name resolves against `assetBaseURL`.
 * A reference that is neither a path nor an image file name (e.g. "bolt.fill")
 * is treated as an SF Symbol and rendered as the placeholder badge the
 * SFSymbol component draws for unmapped names.
 */
export class BrowserTextureLoader implements TextureLoader {
  private readonly cache = new Map<string, SKTexture>();

  constructor(private readonly assetBaseURL = '') {}

  load(ref: string): SKTexture | undefined {
    if (ref.length === 0) return undefined;
    const cached = this.cache.get(ref);
    if (cached !== undefined) return cached;

    const looksLikeFile = ref.includes('/') || SPRITE_EXTENSIONS.test(ref);
    if (!looksLikeFile) {
      const placeholder: SKTexture = {
        ref, image: null, width: 64, height: 64, isSymbolPlaceholder: true, symbolName: ref,
      };
      this.cache.set(ref, placeholder);
      return placeholder;
    }

    const texture: SKTexture = { ref, image: null, width: 1, height: 1, isSymbolPlaceholder: false };
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.onload = () => {
        texture.image = img;
        texture.width = img.naturalWidth || img.width;
        texture.height = img.naturalHeight || img.height;
      };
      img.onerror = () => { texture.image = null; };
      img.src = ref.startsWith('/') || /^[a-z]+:/i.test(ref) ? ref : `${this.assetBaseURL}${ref}`;
    }
    this.cache.set(ref, texture);
    return texture;
  }
}

// MARK: - SKAction

export type TimingMode = 'linear' | 'easeIn' | 'easeOut' | 'easeInEaseOut';

export type SKAction =
  | { kind: 'wait'; duration: number }
  | { kind: 'run'; block: () => void }
  | { kind: 'custom'; duration: number; block: (node: SKNode, elapsed: number) => void }
  | { kind: 'moveBy'; dx: number; dy: number; duration: number; timing: TimingMode }
  | { kind: 'moveTo'; x: number; y: number; duration: number; timing: TimingMode }
  | { kind: 'rotateBy'; angle: number; duration: number; timing: TimingMode }
  | { kind: 'scaleTo'; scale: number; duration: number; timing: TimingMode }
  | { kind: 'fadeAlpha'; alpha: number; duration: number; timing: TimingMode }
  | { kind: 'animate'; textures: SKTexture[]; timePerFrame: number }
  | { kind: 'removeFromParent' }
  | { kind: 'playSound'; fileName: string }
  | { kind: 'sequence'; actions: SKAction[] }
  | { kind: 'group'; actions: SKAction[] }
  | { kind: 'repeat'; action: SKAction; count: number };

/** `SKAction.…` factories, with the Swift's own defaults. */
export const Action = {
  wait: (duration: number): SKAction => ({ kind: 'wait', duration }),
  run: (block: () => void): SKAction => ({ kind: 'run', block }),
  custom: (duration: number, block: (node: SKNode, elapsed: number) => void): SKAction =>
    ({ kind: 'custom', duration, block }),
  moveBy: (dx: number, dy: number, duration: number, timing: TimingMode = 'linear'): SKAction =>
    ({ kind: 'moveBy', dx, dy, duration, timing }),
  moveTo: (x: number, y: number, duration: number, timing: TimingMode = 'linear'): SKAction =>
    ({ kind: 'moveTo', x, y, duration, timing }),
  rotateBy: (angle: number, duration: number, timing: TimingMode = 'linear'): SKAction =>
    ({ kind: 'rotateBy', angle, duration, timing }),
  scaleTo: (scale: number, duration: number, timing: TimingMode = 'linear'): SKAction =>
    ({ kind: 'scaleTo', scale, duration, timing }),
  fadeAlpha: (alpha: number, duration: number, timing: TimingMode = 'linear'): SKAction =>
    ({ kind: 'fadeAlpha', alpha, duration, timing }),
  animate: (textures: SKTexture[], timePerFrame: number): SKAction =>
    ({ kind: 'animate', textures, timePerFrame }),
  removeFromParent: (): SKAction => ({ kind: 'removeFromParent' }),
  playSound: (fileName: string): SKAction => ({ kind: 'playSound', fileName }),
  sequence: (actions: SKAction[]): SKAction => ({ kind: 'sequence', actions }),
  group: (actions: SKAction[]): SKAction => ({ kind: 'group', actions }),
  repeat: (action: SKAction, count: number): SKAction => ({ kind: 'repeat', action, count }),
  repeatForever: (action: SKAction): SKAction => ({ kind: 'repeat', action, count: Number.POSITIVE_INFINITY }),
  /** `SKAction.reversed()` — only ever used on moveBy in the Swift (patrol). */
  reversed(action: SKAction): SKAction {
    if (action.kind === 'moveBy') return { ...action, dx: -action.dx, dy: -action.dy };
    if (action.kind === 'sequence') return { kind: 'sequence', actions: [...action.actions].reverse().map(Action.reversed) };
    return action;
  },
  timed(action: SKAction, timing: TimingMode): SKAction {
    return 'timing' in action ? { ...action, timing } : action;
  },
};

function easedProgress(t: number, timing: TimingMode): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (timing) {
    case 'easeInEaseOut': return clamped * clamped * (3 - 2 * clamped);
    case 'easeIn': return clamped * clamped;
    case 'easeOut': return clamped * (2 - clamped);
    default: return clamped;
  }
}

/** Play head for one running SKAction. */
class ActionRunner {
  private elapsed = 0;
  private started = false;
  private startValue = 0;
  private startPoint: Point = { x: 0, y: 0 };
  private iterations = 0;
  private child: ActionRunner | undefined;
  private index = 0;
  private groupChildren: ActionRunner[] = [];

  constructor(readonly action: SKAction, readonly node: SKNode) {}

  /** Advances by dt; returns true when the action has completed. */
  update(dt: number): boolean {
    const a = this.action;
    switch (a.kind) {
      case 'wait':
        this.elapsed += dt;
        return this.elapsed >= a.duration;
      case 'run':
        a.block();
        return true;
      case 'playSound':
        playSoundFileNamed(a.fileName);
        return true;
      case 'removeFromParent':
        this.node.removeFromParent();
        return true;
      case 'custom': {
        this.elapsed += dt;
        a.block(this.node, this.elapsed);
        return this.elapsed >= a.duration;
      }
      case 'moveBy':
      case 'moveTo': {
        if (!this.started) { this.started = true; this.startPoint = { ...this.node.position }; }
        this.elapsed += dt;
        const p = a.duration <= 0 ? 1 : easedProgress(this.elapsed / a.duration, a.timing);
        const targetX = a.kind === 'moveBy' ? this.startPoint.x + a.dx : a.x;
        const targetY = a.kind === 'moveBy' ? this.startPoint.y + a.dy : a.y;
        this.node.position.x = this.startPoint.x + (targetX - this.startPoint.x) * p;
        this.node.position.y = this.startPoint.y + (targetY - this.startPoint.y) * p;
        this.node.syncBodyToPosition();
        return a.duration <= 0 || this.elapsed >= a.duration;
      }
      case 'rotateBy': {
        if (!this.started) { this.started = true; this.startValue = this.node.zRotation; }
        this.elapsed += dt;
        const p = a.duration <= 0 ? 1 : easedProgress(this.elapsed / a.duration, a.timing);
        this.node.zRotation = this.startValue + a.angle * p;
        return a.duration <= 0 || this.elapsed >= a.duration;
      }
      case 'scaleTo': {
        if (!this.started) { this.started = true; this.startValue = this.node.xScale; }
        this.elapsed += dt;
        const p = a.duration <= 0 ? 1 : easedProgress(this.elapsed / a.duration, a.timing);
        const value = this.startValue + (a.scale - this.startValue) * p;
        this.node.xScale = value; this.node.yScale = value;
        return a.duration <= 0 || this.elapsed >= a.duration;
      }
      case 'fadeAlpha': {
        if (!this.started) { this.started = true; this.startValue = this.node.alpha; }
        this.elapsed += dt;
        const p = a.duration <= 0 ? 1 : easedProgress(this.elapsed / a.duration, a.timing);
        this.node.alpha = this.startValue + (a.alpha - this.startValue) * p;
        return a.duration <= 0 || this.elapsed >= a.duration;
      }
      case 'animate': {
        this.elapsed += dt;
        if (a.textures.length === 0 || a.timePerFrame <= 0) return true;
        const frame = Math.floor(this.elapsed / a.timePerFrame) % a.textures.length;
        const texture = a.textures[frame];
        if (texture !== undefined && this.node instanceof SKSpriteNode) this.node.texture = texture;
        return this.elapsed >= a.timePerFrame * a.textures.length;
      }
      case 'sequence': {
        let remaining = dt;
        // Zero-duration members (.run) must not swallow a whole frame.
        for (let guard = 0; guard < 64; guard += 1) {
          if (this.index >= a.actions.length) return true;
          const current = a.actions[this.index];
          if (current === undefined) return true;
          if (this.child === undefined) this.child = new ActionRunner(current, this.node);
          const done = this.child.update(remaining);
          if (!done) return false;
          this.child = undefined;
          this.index += 1;
          remaining = 0;
          if (this.index >= a.actions.length) return true;
        }
        return false;
      }
      case 'group': {
        if (this.groupChildren.length === 0) {
          this.groupChildren = a.actions.map((child) => new ActionRunner(child, this.node));
        }
        this.groupChildren = this.groupChildren.filter((child) => !child.update(dt));
        return this.groupChildren.length === 0;
      }
      case 'repeat': {
        if (this.child === undefined) this.child = new ActionRunner(a.action, this.node);
        if (this.child.update(dt)) {
          this.child = undefined;
          this.iterations += 1;
          if (this.iterations >= a.count) return true;
        }
        return false;
      }
      default:
        return true;
    }
  }
}

/** `SKAction.playSoundFileNamed(_:waitForCompletion:)` — best effort in a browser. */
export function playSoundFileNamed(fileName: string): void {
  if (typeof Audio === 'undefined') return;
  try {
    const audio = new Audio(fileName);
    audio.volume = 0.7;
    void audio.play().catch(() => undefined);
  } catch {
    /* autoplay policies / missing file — the Swift ignores failures too */
  }
}

// MARK: - Physics (SKPhysicsBody / SKPhysicsWorld on matter-js)

export type PhysicsShape =
  | { kind: 'rectangle'; size: Size }
  | { kind: 'circle'; radius: number }
  | { kind: 'edgeChain'; points: Point[] };

let nextBodyId = 1;

/** `SKPhysicsBody` — SpriteKit semantics on top of a matter-js body. */
export class SKPhysicsBody {
  readonly id = nextBodyId++;
  node: SKNode | undefined;
  world: SKPhysicsWorld | undefined;
  readonly body: Matter.Body;
  readonly shape: PhysicsShape;

  /** Edge-chain (terrain) bodies are built at absolute scene coords and must
   *  never be re-positioned from their (0,0) container node. */
  readonly usesAbsoluteVertices: boolean;

  categoryBitMask = 0xffffffff;
  collisionBitMask = 0xffffffff;
  contactTestBitMask = 0;
  affectedByGravity = true;
  private _isDynamic = true;
  private _allowsRotation = true;
  /** SpriteKit's `linearDamping` (per second); matter's frictionAir is per step. */
  private _linearDamping = 0.1;

  constructor(shape: PhysicsShape) {
    this.shape = shape;
    this.usesAbsoluteVertices = shape.kind === 'edgeChain';
    switch (shape.kind) {
      case 'circle':
        this.body = Matter.Bodies.circle(0, 0, Math.max(shape.radius, 0.5));
        break;
      case 'edgeChain': {
        const parts: Matter.Body[] = [];
        for (let i = 0; i + 1 < shape.points.length; i += 1) {
          const a = shape.points[i]!, b = shape.points[i + 1]!;
          const dx = b.x - a.x, dy = b.y - a.y;
          const length = Math.hypot(dx, dy);
          if (length < 0.01) continue;
          const part = Matter.Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, length, 4, {
            angle: Math.atan2(dy, dx),
          });
          parts.push(part);
        }
        this.body = parts.length > 0
          ? Matter.Body.create({ parts, isStatic: true })
          : Matter.Bodies.rectangle(0, 0, 1, 1, { isStatic: true });
        break;
      }
      default:
        this.body = Matter.Bodies.rectangle(0, 0, Math.max(shape.size.width, 0.5), Math.max(shape.size.height, 0.5));
        break;
    }
    // SpriteKit's default density is 1.0 with area measured in METRES.
    Matter.Body.setMass(this.body, Math.max(this.spriteKitDefaultMass(), 0.0001));
    this.body.frictionAir = this._linearDamping / 60;
    this.body.friction = 0.2;
    this.body.frictionStatic = 0.5;
    this.body.restitution = 0.2;
    this.body.slop = 0.05;
    (this.body as unknown as { skBody?: SKPhysicsBody }).skBody = this;
  }

  private spriteKitDefaultMass(): number {
    const scale = POINTS_PER_METRE * POINTS_PER_METRE;
    switch (this.shape.kind) {
      case 'circle': return (Math.PI * this.shape.radius * this.shape.radius) / scale;
      case 'edgeChain': return 1;
      default: return (this.shape.size.width * this.shape.size.height) / scale;
    }
  }

  get isDynamic(): boolean { return this._isDynamic; }
  set isDynamic(value: boolean) {
    if (this._isDynamic === value) return;
    this._isDynamic = value;
    const mass = this.body.mass;
    Matter.Body.setStatic(this.body, !value);
    if (value) {
      Matter.Body.setMass(this.body, mass);
      this.allowsRotation = this._allowsRotation;
    }
  }

  get allowsRotation(): boolean { return this._allowsRotation; }
  set allowsRotation(value: boolean) {
    this._allowsRotation = value;
    if (!this._isDynamic) return;
    if (value) {
      // Restore the shape's own inertia (matter derives it from the vertices).
      Matter.Body.setInertia(this.body, this.naturalInertia());
    } else {
      Matter.Body.setInertia(this.body, Number.POSITIVE_INFINITY);
    }
  }

  private naturalInertia(): number {
    // matter's own formula: mass * (moment of area) — recomputed from the parts.
    const parts = this.body.parts.length > 1 ? this.body.parts.slice(1) : this.body.parts;
    let total = 0;
    for (const part of parts) {
      total += Matter.Vertices.inertia(part.vertices, part.mass);
    }
    return (total || this.body.mass * 100) * 4;
  }

  get mass(): number { return this.body.mass; }
  set mass(value: number) { Matter.Body.setMass(this.body, Math.max(value, 0.0001)); }

  get restitution(): number { return this.body.restitution; }
  set restitution(value: number) { this.body.restitution = value; }

  get friction(): number { return this.body.friction; }
  set friction(value: number) { this.body.friction = value; }

  get linearDamping(): number { return this._linearDamping; }
  set linearDamping(value: number) {
    this._linearDamping = value;
    this.body.frictionAir = value / 60;
  }

  /** points/second, SCENE space (+y up) — SpriteKit's `velocity`. */
  get velocity(): Vector {
    const v = Matter.Body.getVelocity(this.body);
    return { dx: v.x * 60, dy: v.y * 60 };
  }
  set velocity(value: Vector) {
    Matter.Body.setVelocity(this.body, { x: value.dx / 60, y: value.dy / 60 });
  }

  /** radians/second. */
  get angularVelocity(): number { return Matter.Body.getAngularVelocity(this.body) * 60; }
  set angularVelocity(value: number) { Matter.Body.setAngularVelocity(this.body, value / 60); }

  /** SpriteKit puts settled bodies to sleep; every motion command wakes them. */
  get isResting(): boolean { return this.body.isSleeping; }
  set isResting(value: boolean) { Matter.Sleeping.set(this.body, value); }

  /** Δv = impulse / mass, in points/second (see the units note at the top). */
  applyImpulse(impulse: Vector): void {
    const v = this.velocity;
    this.velocity = { dx: v.dx + impulse.dx / this.mass, dy: v.dy + impulse.dy / this.mass };
  }

  /** Δω = impulse / moment of inertia (converted out of matter's point² units). */
  applyAngularImpulse(impulse: number): void {
    const inertia = Number.isFinite(this.body.inertia) && this.body.inertia > 0
      ? this.body.inertia / (POINTS_PER_METRE * POINTS_PER_METRE)
      : this.mass;
    this.angularVelocity += impulse / Math.max(inertia, 0.0001);
  }
}

/** `SKPhysicsJointPin.joint(withBodyA:bodyB:anchor:)` */
export interface SKPhysicsJointPin {
  bodyA: SKPhysicsBody;
  bodyB: SKPhysicsBody;
  anchor: Point;
  frictionTorque: number;
  constraint: Matter.Constraint;
}

export interface PhysicsContact {
  bodyA: SKPhysicsBody;
  bodyB: SKPhysicsBody;
  /** Magnitude of the impulse applied to resolve the hit (SpriteKit units). */
  collisionImpulse: number;
  contactPoint: Point;
}

/** `SKPhysicsWorld` — gravity, the step loop, joints, and contact reporting. */
export class SKPhysicsWorld {
  readonly engine: Matter.Engine;
  /** SpriteKit units (metres/s²); acceleration = gravity × 150 points/s². */
  gravity: Vector = { dx: 0, dy: -9.8 };
  speed = 1;
  contactDelegate: ((contact: PhysicsContact) => void) | undefined;

  private bodies: SKPhysicsBody[] = [];
  private joints: SKPhysicsJointPin[] = [];
  private touching = new Set<string>();
  /** Bodies added this step: overlaps they are BORN with never fire didBegin
   *  (the documented SpriteKit behaviour — a collectible spawned on top of the
   *  player scores nothing). */
  private pendingSeed: SKPhysicsBody[] = [];

  constructor() {
    this.engine = Matter.Engine.create({ enableSleeping: false });
    this.engine.gravity.scale = 0;
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 0;
  }

  add(body: SKPhysicsBody): void {
    if (this.bodies.includes(body)) return;
    body.world = this;
    this.bodies.push(body);
    this.pendingSeed.push(body);
    Matter.Composite.add(this.engine.world, body.body);
  }

  remove(body: SKPhysicsBody): void {
    const index = this.bodies.indexOf(body);
    if (index < 0) return;
    this.bodies.splice(index, 1);
    Matter.Composite.remove(this.engine.world, body.body);
    for (const key of [...this.touching]) {
      if (key.startsWith(`${body.id}:`) || key.endsWith(`:${body.id}`)) this.touching.delete(key);
    }
    this.joints = this.joints.filter((joint) => {
      if (joint.bodyA !== body && joint.bodyB !== body) return true;
      Matter.Composite.remove(this.engine.world, joint.constraint);
      return false;
    });
  }

  addJoint(joint: SKPhysicsJointPin): void {
    this.joints.push(joint);
    Matter.Composite.add(this.engine.world, joint.constraint);
  }

  /** `physicsWorld.removeAllJoints()` — joints live on the WORLD, not the tree. */
  removeAllJoints(): void {
    for (const joint of this.joints) Matter.Composite.remove(this.engine.world, joint.constraint);
    this.joints = [];
  }

  removeAllBodies(): void {
    for (const body of this.bodies) Matter.Composite.remove(this.engine.world, body.body);
    this.bodies = [];
    this.touching.clear();
    this.pendingSeed = [];
  }

  makePinJoint(bodyA: SKPhysicsBody, bodyB: SKPhysicsBody, anchor: Point): SKPhysicsJointPin {
    const constraint = Matter.Constraint.create({
      bodyA: bodyA.body,
      bodyB: bodyB.body,
      pointA: { x: anchor.x - bodyA.body.position.x, y: anchor.y - bodyA.body.position.y },
      pointB: { x: anchor.x - bodyB.body.position.x, y: anchor.y - bodyB.body.position.y },
      length: 0,
      stiffness: 1,
      damping: 0.1,
    });
    return { bodyA, bodyB, anchor, frictionTorque: 0, constraint };
  }

  step(dt: number): void {
    const scaled = dt * this.speed;
    if (scaled <= 0) return;
    for (const body of this.bodies) {
      if (!body.isDynamic || !body.affectedByGravity) continue;
      // force = mass × acceleration / 1e6 reproduces a points/s² acceleration
      // at matter's millisecond-squared integration (see the units note).
      body.body.force.x += (body.body.mass * this.gravity.dx * POINTS_PER_METRE) / 1e6;
      body.body.force.y += (body.body.mass * this.gravity.dy * POINTS_PER_METRE) / 1e6;
    }
    Matter.Engine.update(this.engine, (scaled * 1000));
    this.reportContacts();
  }

  /**
   * SpriteKit reports a contact when the two bodies' contactTestBitMasks match
   * and they begin to overlap — independent of whether they physically collide
   * (a Flappy bird passes THROUGH a pipe yet still reports the touch). matter's
   * collision filter can't express that, so overlap is tested directly.
   */
  private reportContacts(): void {
    const seed = this.pendingSeed;
    this.pendingSeed = [];
    const current = new Set<string>();
    for (let i = 0; i < this.bodies.length; i += 1) {
      const a = this.bodies[i]!;
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        const b = this.bodies[j]!;
        const testsAB = ((a.contactTestBitMask & b.categoryBitMask) >>> 0) !== 0;
        const testsBA = ((b.contactTestBitMask & a.categoryBitMask) >>> 0) !== 0;
        if (!testsAB && !testsBA) continue;
        if (!Matter.Bounds.overlaps(a.body.bounds, b.body.bounds)) continue;
        if (!overlaps(a.body, b.body)) continue;
        const key = `${a.id}:${b.id}`;
        current.add(key);
        if (this.touching.has(key)) continue;
        if (seed.includes(a) || seed.includes(b)) continue; // born overlapping
        const va = a.velocity, vb = b.velocity;
        const reduced = (a.mass * b.mass) / Math.max(a.mass + b.mass, 0.0001);
        const relative = Math.hypot(va.dx - vb.dx, va.dy - vb.dy);
        this.contactDelegate?.({
          bodyA: a,
          bodyB: b,
          collisionImpulse: relative * reduced,
          contactPoint: {
            x: (a.body.position.x + b.body.position.x) / 2,
            y: (a.body.position.y + b.body.position.y) / 2,
          },
        });
      }
    }
    for (const key of current) this.touching.add(key);
    for (const key of [...this.touching]) if (!current.has(key)) this.touching.delete(key);
  }
}

function partsOf(body: Matter.Body): Matter.Body[] {
  return body.parts.length > 1 ? body.parts.slice(1) : body.parts;
}

function overlaps(a: Matter.Body, b: Matter.Body): boolean {
  for (const partA of partsOf(a)) {
    for (const partB of partsOf(b)) {
      if (!Matter.Bounds.overlaps(partA.bounds, partB.bounds)) continue;
      const collision = Matter.Collision.collides(partA, partB, null as unknown as Matter.Pairs);
      if (collision !== null && collision !== undefined) return true;
    }
  }
  return false;
}

/** Applies the SpriteKit collision bitmasks to matter's (symmetric) filter. */
export function applyCollisionFilter(body: SKPhysicsBody): void {
  for (const part of body.body.parts) {
    part.collisionFilter.category = body.categoryBitMask >>> 0;
    part.collisionFilter.mask = body.collisionBitMask >>> 0;
  }
}

// MARK: - Node tree

export interface Rect { x: number; y: number; width: number; height: number }

export type BlendMode = 'alpha' | 'add';

/** `SKNode` — position/rotation/alpha, children, actions and an optional body. */
export class SKNode {
  name: string | undefined;
  position: Point = { x: 0, y: 0 };
  zPosition = 0;
  zRotation = 0;
  alpha = 1;
  xScale = 1;
  yScale = 1;
  isHidden = false;
  speed = 1;
  userData: Record<string, unknown> | undefined;
  children: SKNode[] = [];
  parent: SKNode | undefined;
  physicsBody: SKPhysicsBody | undefined;
  blendMode: BlendMode = 'alpha';

  private actions = new Map<string, ActionRunner>();
  private autoKey = 0;

  addChild(node: SKNode): void {
    node.removeFromParent();
    node.parent = this;
    this.children.push(node);
    const scene = this.scene();
    if (scene !== undefined) scene.attachBodies(node);
  }

  removeFromParent(): void {
    const parent = this.parent;
    if (parent === undefined) return;
    const scene = this.scene();
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parent = undefined;
    if (scene !== undefined) scene.detachBodies(this);
  }

  removeAllChildren(): void {
    for (const child of [...this.children]) child.removeFromParent();
  }

  /** `childNode(withName:)` — direct children only, which is all the Swift uses. */
  childNode(withName: string): SKNode | undefined {
    return this.children.find((child) => child.name === withName);
  }

  run(action: SKAction, withKey?: string): void {
    const key = withKey ?? `__auto${this.autoKey++}`;
    this.actions.set(key, new ActionRunner(action, this));
  }

  removeAction(forKey: string): void { this.actions.delete(forKey); }
  removeAllActions(): void { this.actions.clear(); }
  hasActions(): boolean { return this.actions.size > 0; }
  action(forKey: string): boolean { return this.actions.has(forKey); }

  updateActions(dt: number): void {
    const scaled = dt * this.speed;
    for (const [key, runner] of [...this.actions]) {
      if (runner.update(scaled)) this.actions.delete(key);
    }
    for (const child of [...this.children]) child.updateActions(scaled);
  }

  /** The scene at the root of this branch, if the node is in one. */
  scene(): SKSceneRoot | undefined {
    let node: SKNode | undefined = this;
    while (node !== undefined) {
      if (isSceneRoot(node)) return node;
      node = node.parent;
    }
    return undefined;
  }

  /** SpriteKit's accumulated frame, used by the slingshot hit test. */
  frame(): Rect {
    const size = this instanceof SKSpriteNode
      ? { width: this.size.width * Math.abs(this.xScale), height: this.size.height * Math.abs(this.yScale) }
      : { width: 0, height: 0 };
    let rect: Rect = {
      x: this.position.x - size.width / 2,
      y: this.position.y - size.height / 2,
      width: size.width,
      height: size.height,
    };
    for (const child of this.children) {
      const childFrame = child.frame();
      if (childFrame.width === 0 && childFrame.height === 0) continue;
      const cf: Rect = {
        x: this.position.x + childFrame.x,
        y: this.position.y + childFrame.y,
        width: childFrame.width,
        height: childFrame.height,
      };
      if (rect.width === 0 && rect.height === 0) { rect = cf; continue; }
      const minX = Math.min(rect.x, cf.x), minY = Math.min(rect.y, cf.y);
      const maxX = Math.max(rect.x + rect.width, cf.x + cf.width);
      const maxY = Math.max(rect.y + rect.height, cf.y + cf.height);
      rect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }
    return rect;
  }

  /** Pushes a position/rotation set from script into the physics body. */
  syncBodyToPosition(): void {
    const body = this.physicsBody;
    if (body === undefined || body.usesAbsoluteVertices) return;
    Matter.Body.setPosition(body.body, { x: this.position.x, y: this.position.y });
    Matter.Body.setAngle(body.body, this.zRotation);
  }

  /** Pulls the simulated transform back onto the node. */
  syncPositionFromBody(): void {
    const body = this.physicsBody;
    if (body === undefined || !body.isDynamic || body.usesAbsoluteVertices) return;
    this.position.x = body.body.position.x;
    this.position.y = body.body.position.y;
    this.zRotation = body.body.angle;
  }

  /** Depth-first walk (self first). */
  forEachNode(visit: (node: SKNode) => void): void {
    visit(this);
    for (const child of [...this.children]) child.forEachNode(visit);
  }
}

/** Marker the node tree uses to find its owning scene without importing it. */
export interface SKSceneRoot extends SKNode {
  readonly isSceneRoot: true;
  attachBodies(node: SKNode): void;
  detachBodies(node: SKNode): void;
}

function isSceneRoot(node: SKNode): node is SKSceneRoot {
  return (node as Partial<SKSceneRoot>).isSceneRoot === true;
}

export class SKSpriteNode extends SKNode {
  texture: SKTexture | undefined;
  color: SKColor = SKColors.clear;
  colorBlendFactor = 0;
  size: Size;
  anchorPoint: Point = { x: 0.5, y: 0.5 };
  /** Set for the tiled pipe segments: children are clipped to this node's box. */
  cropsChildren = false;
  /** Rounded-rect radius used when the entity is drawn as a plain fill. */
  cornerRadius = 0;
  /** Drawn as an ellipse (circleBody entities read as balls, like the poster). */
  drawsAsEllipse = false;
  /**
   * Stands in for the CGGradient textures the Swift bakes for
   * `setupGradient()` / `setupVignette()`: the renderer paints the gradient
   * straight onto the canvas, so no offscreen bitmap (and no CGContext) is
   * needed — which also keeps the scene headless-testable.
   */
  gradient: { kind: 'linear' | 'radial'; colors: SKColor[]; locations?: number[] } | undefined;

  constructor(options: { texture?: SKTexture; color?: SKColor; size: Size }) {
    super();
    this.texture = options.texture;
    if (options.color !== undefined) {
      this.color = options.color;
      this.colorBlendFactor = options.texture === undefined ? 1 : 0;
    }
    this.size = { ...options.size };
  }
}

export type ShapeDescriptor =
  | { kind: 'circle'; radius: number }
  | { kind: 'rect'; size: Size; cornerRadius: number }
  | { kind: 'ellipse'; size: Size }
  | { kind: 'path'; points: Point[]; closed: boolean };

export class SKShapeNode extends SKNode {
  shape: ShapeDescriptor;
  fillColor: SKColor = SKColors.clear;
  strokeColor: SKColor = SKColors.white;
  lineWidth = 1;
  lineCap: 'butt' | 'round' | 'square' = 'butt';
  lineJoin: 'miter' | 'round' | 'bevel' = 'miter';
  glowWidth = 0;

  constructor(shape: ShapeDescriptor) {
    super();
    this.shape = shape;
  }

  static circleOfRadius(radius: number): SKShapeNode {
    return new SKShapeNode({ kind: 'circle', radius });
  }
  static rectOf(size: Size, cornerRadius = 0): SKShapeNode {
    return new SKShapeNode({ kind: 'rect', size, cornerRadius });
  }
  static rect(rect: Rect): SKShapeNode {
    const node = new SKShapeNode({ kind: 'rect', size: { width: rect.width, height: rect.height }, cornerRadius: 0 });
    node.position = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    return node;
  }
  static ellipseOf(size: Size): SKShapeNode {
    return new SKShapeNode({ kind: 'ellipse', size });
  }
  static path(points: Point[], closed = false): SKShapeNode {
    return new SKShapeNode({ kind: 'path', points, closed });
  }
}

export type HorizontalAlignment = 'left' | 'center' | 'right';

export class SKLabelNode extends SKNode {
  text = '';
  fontName: string;
  fontSize = 32;
  fontColor: SKColor = SKColors.white;
  horizontalAlignmentMode: HorizontalAlignment = 'center';

  constructor(fontNamed = 'Menlo') {
    super();
    this.fontName = fontNamed;
  }
}

export class SKCameraNode extends SKNode {}

/**
 * `SKLightNode` — SpriteKit lights sprites through generated normal maps,
 * which a 2D canvas cannot do. The port keeps the same light model (color,
 * ambient, falloff, position, follow) and renders it as an ambient darkening
 * pass with a radial light pool, so `lighting: true` still changes the look
 * and `lightFollow` still moves the light.
 */
export class SKLightNode extends SKNode {
  categoryBitMask = 1;
  lightColor: SKColor = SKColors.white;
  ambientColor: SKColor = rgba(0.35, 0.35, 0.35, 1);
  falloff = 1;
}

// MARK: - SKEmitterNode (procedural — the Swift builds every emitter in code)

interface Particle {
  x: number; y: number; vx: number; vy: number;
  age: number; lifetime: number;
  alpha: number; alphaSpeed: number;
  scale: number; scaleSpeed: number;
  rotation: number; rotationSpeed: number;
  color: SKColor;
}

export class SKEmitterNode extends SKNode {
  particleBirthRate = 0;
  particleLifetime = 1;
  numParticlesToEmit = 0;
  particleSpeed = 0;
  particleSpeedRange = 0;
  emissionAngle = 0;
  emissionAngleRange = 0;
  particleAlpha = 1;
  particleAlphaSpeed = 0;
  particleScale = 1;
  particleScaleRange = 0;
  particleScaleSpeed = 0;
  particleRotationSpeed = 0;
  particleColor: SKColor = SKColors.white;
  particleColorBlendFactor = 0;
  particleColorRedRange = 0;
  particleColorGreenRange = 0;
  particleColorBlueRange = 0;
  particleSize: Size = { width: 4, height: 4 };
  particlePositionRange: Vector = { dx: 0, dy: 0 };
  yAcceleration = 0;
  /** `emitter.targetNode = self` — particles live in the target's space. */
  targetNode: SKNode | undefined;
  /** Scene-space origin used when `targetNode` is set (trail emitters). */
  originProvider: (() => Point) | undefined;

  particles: Particle[] = [];
  private emitted = 0;
  private carry = 0;
  private random: () => number = Math.random;

  setRandom(random: () => number): void { this.random = random; }

  private spawn(): void {
    const angle = this.emissionAngle + (this.random() - 0.5) * this.emissionAngleRange;
    const speed = this.particleSpeed + (this.random() - 0.5) * 2 * this.particleSpeedRange;
    const scale = this.particleScale + (this.random() - 0.5) * 2 * this.particleScaleRange;
    const color = rgba(
      Math.max(0, Math.min(1, this.particleColor.r + (this.random() - 0.5) * this.particleColorRedRange)),
      Math.max(0, Math.min(1, this.particleColor.g + (this.random() - 0.5) * this.particleColorGreenRange)),
      Math.max(0, Math.min(1, this.particleColor.b + (this.random() - 0.5) * this.particleColorBlueRange)),
      this.particleColor.a,
    );
    const origin = this.targetNode !== undefined && this.originProvider !== undefined
      ? this.originProvider()
      : { x: 0, y: 0 };
    this.particles.push({
      x: origin.x + (this.random() - 0.5) * this.particlePositionRange.dx,
      y: origin.y + (this.random() - 0.5) * this.particlePositionRange.dy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      age: 0,
      lifetime: this.particleLifetime,
      alpha: this.particleAlpha,
      alphaSpeed: this.particleAlphaSpeed,
      scale,
      scaleSpeed: this.particleScaleSpeed,
      rotation: 0,
      rotationSpeed: this.particleRotationSpeed,
      color,
    });
    this.emitted += 1;
  }

  updateParticles(dt: number): void {
    if (this.numParticlesToEmit === 0 || this.emitted < this.numParticlesToEmit) {
      this.carry += this.particleBirthRate * dt;
      while (this.carry >= 1) {
        this.carry -= 1;
        if (this.numParticlesToEmit !== 0 && this.emitted >= this.numParticlesToEmit) break;
        this.spawn();
      }
    }
    for (const p of this.particles) {
      p.age += dt;
      p.vy += this.yAcceleration * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.alpha += p.alphaSpeed * dt;
      p.scale += p.scaleSpeed * dt;
      p.rotation += p.rotationSpeed * dt;
    }
    this.particles = this.particles.filter((p) => p.age < p.lifetime && p.alpha > 0.01 && p.scale > 0.01);
  }

  /** `emitter.advanceSimulationTime(_:)` — pre-fill so it doesn't start empty. */
  advanceSimulationTime(seconds: number): void {
    const step = 1 / 30;
    for (let t = 0; t < seconds; t += step) this.updateParticles(step);
  }
}

/** `SKAudioNode(url:)` with `autoplayLooped` — an <audio> element in the port. */
export class SKAudioNode extends SKNode {
  readonly element: HTMLAudioElement | undefined;

  constructor(url: string) {
    super();
    if (typeof Audio === 'undefined') return;
    try {
      const element = new Audio(url);
      element.loop = true;
      element.volume = 0.5;
      void element.play().catch(() => undefined);
      this.element = element;
    } catch {
      this.element = undefined;
    }
  }

  stop(): void {
    this.element?.pause();
  }
}
