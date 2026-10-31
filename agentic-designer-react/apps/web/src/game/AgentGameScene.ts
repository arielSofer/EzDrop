// Ported 1:1 from AgenticDesigner/Runtime/AgentGameKit.swift
// (`final class AgentGameScene: SKScene, SKPhysicsContactDelegate`, :579-2400).
//
// The 2D game runtime: physics, collisions, spawning, scoring, win/lose and
// restart, driven by a pure-data GameSceneSpec. SpriteKit becomes a 2D
// <canvas> renderer plus matter-js (see SpriteKitCompat.ts for the SKNode /
// SKAction / SKPhysicsBody kernel, the coordinate systems and the physics
// units); every constant, branch and event of the Swift is preserved.
//
// The scene steps at a deterministic fixed 60 Hz — SpriteKit's rate — so a
// headless test can `step()` frames and get the same result every run.

import {
  GameSceneRegistry,
  type GameSceneCommandSink,
} from '@agentic/core/game/GameSceneRegistry';
import {
  decodeGameBehavior,
  makeGameSceneSpec,
  type GameBehavior,
  type GameCommand,
  type GameEntity,
  type GameEvent,
  type GameSceneSpec,
  type Point,
  type Size,
} from '@agentic/core';
import { GameRenderer, canvasToScene, cameraTransform } from './GameRenderer';
import {
  Action,
  BrowserTextureLoader,
  FIXED_TIMESTEP,
  SKAudioNode,
  SKCameraNode,
  SKColors,
  SKEmitterNode,
  SKLabelNode,
  SKLightNode,
  SKNode,
  SKPhysicsBody,
  SKPhysicsWorld,
  SKShapeNode,
  SKSpriteNode,
  applyCollisionFilter,
  playSoundFileNamed,
  rgba,
  skColor,
  withAlphaComponent,
  type PhysicsContact,
  type SKColor,
  type SKSceneRoot,
  type SKTexture,
  type TextureLoader,
  type Vector,
} from './SpriteKitCompat';

type Phase = 'waiting' | 'playing' | 'over' | 'won';
type GapEdge = 'up' | 'down';

interface SpawnerState { behavior: GameBehavior; interval: number; countdown: number }

export interface AgentGameSceneOptions {
  spec: GameSceneSpec;
  size: Size;
  /** The canvas to render into; omitted for headless (test) scenes. */
  canvas?: HTMLCanvasElement | null;
  onEvent?: ((event: GameEvent) => void) | undefined;
  /** DesignNode id, so GameSceneRegistry can address this scene. */
  nodeId?: string;
  textureLoader?: TextureLoader;
  /** Seedable RNG so spawns/shake are reproducible in tests. */
  random?: () => number;
  /** Start the requestAnimationFrame loop on didMove (default: true with a canvas). */
  autoRun?: boolean;
  /** Attach mouse/touch/key listeners (default: true with a canvas). */
  handlesInput?: boolean;
}

export class AgentGameScene extends SKNode implements SKSceneRoot, GameSceneCommandSink {
  readonly isSceneRoot = true as const;

  private spec: GameSceneSpec;
  onEvent: ((event: GameEvent) => void) | undefined;

  /** The authored scene size (spec.width × spec.height) — SpriteKit's `size`. */
  size: Size;
  backgroundColor: SKColor = SKColors.black;
  readonly physicsWorld = new SKPhysicsWorld();
  isPaused = false;

  private categoryBits: Record<string, number> = {};
  private nextBit = 1;
  private score = 0;
  private phase: Phase = 'waiting';
  private lastUpdate = 0;

  // Slingshot drag state.
  private slingEntityNode: SKNode | undefined;
  private slingAnchor: Point = { x: 0, y: 0 };
  private bikeWheels: Record<string, SKNode[]> = {};
  private bikeMotorSpeed: Record<string, number> = {};
  private bikeThrottle: Record<string, number> = {};
  private bikeMotorForce: Record<string, number> = {};
  private bikeWheelRadius: Record<string, number> = {};

  private wheelRadiusFor(id: string): number { return this.bikeWheelRadius[id] ?? 16; }

  private spawnCounter = 0;
  private shakeUntil = 0;
  private slingActive = false;
  /** Where each slingshot entity sits when loaded — so the NEXT bird can be
   *  placed on the sling by a logic block (gameLoadSlingshot). */
  private slingHome: Record<string, Point> = {};
  /** Frames a launched slingshot shot has been (nearly) still — once it
   *  settles or leaves the world, the next shot auto-loads. */
  private slingSettle: Record<string, number> = {};
  private slingMaxPower = 900;
  private slingMaxDrag = 140;
  private aimLine: SKNode | undefined;

  private readonly hud = new SKLabelNode('Menlo-Bold');
  private readonly overlay = new SKNode();

  // — Engine v2 state —
  private gameCamera: SKCameraNode | undefined;
  private get worldSize(): Size {
    return {
      width: Math.max(this.spec.worldWidth, this.spec.width),
      height: Math.max(this.spec.worldHeight, this.spec.height),
    };
  }
  private spawnerStates: SpawnerState[] = [];
  private elapsedPlaytime = 0;
  private lastRampAt = 0;
  private livesLeft = 0;
  private invulnerableUntil = 0;
  private timeRemaining = 0;
  private readonly livesHUD = new SKLabelNode('Menlo-Bold');
  private readonly timerHUD = new SKLabelNode('Menlo-Bold');
  private parallaxNodes: { node: SKNode; speed: number; tileWidth: number }[] = [];
  // controlHorizontal input: -1 / 0 / +1 (keys) or a drag-target x.
  private steerDirection = 0;
  private steerTargetX: number | undefined;
  private lastShotAt: Record<string, number> = {};
  private lightNode: SKLightNode | undefined;
  private musicNode: SKAudioNode | undefined;

  // — Port-only plumbing —
  private readonly nodeId: string;
  private readonly textures: TextureLoader;
  private readonly random: () => number;
  private readonly renderer = new GameRenderer();
  private canvas: HTMLCanvasElement | null;
  private ctx: CanvasRenderingContext2D | null = null;
  private rafHandle: number | undefined;
  private accumulator = 0;
  private lastFrameTime = 0;
  private currentTime = 0;
  private running = false;
  private readonly handlesInput: boolean;
  private readonly autoRun: boolean;
  private disposed = false;
  private dragging = false;

  constructor(options: AgentGameSceneOptions) {
    super();
    this.spec = options.spec;
    this.size = { ...options.size };
    this.onEvent = options.onEvent;
    this.nodeId = options.nodeId ?? '';
    this.textures = options.textureLoader ?? new BrowserTextureLoader();
    this.random = options.random ?? Math.random;
    this.canvas = options.canvas ?? null;
    this.handlesInput = options.handlesInput ?? this.canvas !== null;
    this.autoRun = options.autoRun ?? this.canvas !== null;
    this.physicsWorld.contactDelegate = (contact) => this.didBegin(contact);
  }

  // MARK: Lifecycle

  /** `override func didMove(to view: SKView)` */
  didMove(): void {
    if (this.canvas !== null) {
      this.ctx = this.canvas.getContext('2d');
      if (this.handlesInput) this.attachInput(this.canvas);
    }
    GameSceneRegistry.register(this, this.nodeId);
    this.buildScene();
    if (this.autoRun) this.start();
    else this.render();
  }

  /** Tears the scene down: stops the loop, unregisters, drops listeners. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.musicNode?.stop();
    if (this.canvas !== null && this.handlesInput) this.detachInput(this.canvas);
    GameSceneRegistry.unregister(this);
    this.removeAllChildren();
    this.physicsWorld.removeAllJoints();
    this.physicsWorld.removeAllBodies();
  }

  /** The spec the scene is playing (AgentGameViewHost rebuilds on change). */
  get currentSpec(): GameSceneSpec { return this.spec; }

  // MARK: SKSceneRoot — physics bodies follow the node tree

  attachBodies(node: SKNode): void {
    node.forEachNode((child) => {
      if (child.physicsBody !== undefined) this.physicsWorld.add(child.physicsBody);
    });
  }

  detachBodies(node: SKNode): void {
    node.forEachNode((child) => {
      if (child.physicsBody !== undefined) this.physicsWorld.remove(child.physicsBody);
    });
  }

  // MARK: The frame loop (deterministic fixed 60 Hz, SpriteKit's rate)

  start(): void {
    if (this.running || typeof requestAnimationFrame === 'undefined') return;
    this.running = true;
    this.lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const tick = (time: number) => {
      if (!this.running) return;
      const elapsed = Math.min((time - this.lastFrameTime) / 1000, 0.25);
      this.lastFrameTime = time;
      this.accumulator += elapsed;
      let steps = 0;
      while (this.accumulator >= FIXED_TIMESTEP && steps < 5) {
        this.accumulator -= FIXED_TIMESTEP;
        steps += 1;
        this.step();
      }
      this.render();
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    if (this.rafHandle !== undefined && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = undefined;
  }

  /** One fixed simulation step: update → actions → physics → contacts. */
  step(dt: number = FIXED_TIMESTEP): void {
    if (this.isPaused) return;
    this.currentTime += dt;
    this.update(this.currentTime);
    this.updateActions(dt);
    this.updateEmitters(this, dt * this.speed);
    this.physicsWorld.step(dt * this.speed);
    this.forEachNode((node) => node.syncPositionFromBody());
  }

  private updateEmitters(node: SKNode, dt: number): void {
    if (node instanceof SKEmitterNode) node.updateParticles(dt);
    for (const child of [...node.children]) this.updateEmitters(child, dt);
  }

  /** Draws the current frame (no-op without a 2D context). */
  render(): void {
    const canvas = this.canvas;
    if (canvas === null) return;
    if (this.ctx === null) this.ctx = canvas.getContext('2d');
    const ctx = this.ctx;
    if (ctx === null) return;
    this.renderer.render({
      ctx,
      canvasSize: { width: canvas.width, height: canvas.height },
      sceneSize: this.size,
      backgroundColor: this.backgroundColor,
      root: this,
      camera: this.gameCamera,
      light: this.lightNode,
    });
  }

  // MARK: GameSceneCommandSink

  /** `AgentGameScene.handleCommand(_:)` reached through GameSceneRegistry. */
  send(command: GameCommand): void { this.handleCommand(command); }

  /**
   * Logic-block commands (see GameCommand) — the logic editor's remote
   * control over the running scene.
   */
  handleCommand(command: GameCommand): void {
    switch (command.kind) {
      case 'spawn': {
        const template = this.spec.entities.find((entity) => entity.id === command.template);
        if (template === undefined) return;
        const e: GameEntity = { ...template, isTemplate: false };
        const node = this.makeNode(e);
        node.name = this.nextSpawnName(template.id);
        node.position = { x: command.x + e.width / 2, y: this.worldSize.height - command.y - e.height / 2 };
        this.addChild(node);
        node.syncBodyToPosition();
        return;
      }
      case 'remove': {
        for (const child of [...this.children]) {
          if (child.name === command.target || this.templateId(child.name ?? '') === command.target) {
            child.removeFromParent();
          }
        }
        for (const e of this.spec.entities) {
          if (e.category === command.target) this.childNamed(e.id)?.removeFromParent();
        }
        return;
      }
      case 'impulse': {
        // A body resting on the ground is ASLEEP; SpriteKit ignores forces
        // and velocity writes until it is woken, so a second shot at a
        // settled projectile silently did nothing.
        const body = this.childNamed(command.entity)?.physicsBody;
        if (body !== undefined) {
          body.isResting = false;
          body.applyImpulse({ dx: command.dx, dy: -command.dy });
        }
        return;
      }
      case 'move': {
        const node = this.childNamed(command.entity);
        if (node === undefined) return;
        const e = this.spec.entities.find((entity) => entity.id === command.entity);
        node.position = {
          x: command.x + (e?.width ?? 0) / 2,
          y: this.worldSize.height - command.y - (e?.height ?? 0) / 2,
        };
        node.syncBodyToPosition();
        return;
      }
      case 'setGravity': {
        this.spec.gravity = command.value;
        if (this.phase === 'playing') this.physicsWorld.gravity = { dx: 0, dy: command.value };
        return;
      }
      case 'addScore':
        this.addScore(command.value);
        return;
      case 'end':
        if (command.win) this.winGame(); else this.triggerGameOver();
        return;
      case 'pause':
        this.isPaused = command.value;
        return;
      case 'setVelocity': {
        // Design coords: positive vy = down.
        const body = this.childNamed(command.entity)?.physicsBody;
        if (body !== undefined) {
          body.isResting = false;
          body.velocity = { dx: command.vx, dy: -command.vy };
        }
        return;
      }
      case 'setProperty':
        this.applyProperty(command.property, command.value, command.entity);
        return;
      case 'animate': {
        const node = this.childNamed(command.entity);
        if (node === undefined) return;
        const e = this.spec.entities.find((entity) => entity.id === command.entity);
        const target: Point = {
          x: command.x + (e?.width ?? 0) / 2,
          y: this.worldSize.height - command.y - (e?.height ?? 0) / 2,
        };
        node.run(Action.moveTo(target.x, target.y, Math.max(command.duration, 0.01), 'easeInEaseOut'), 'logicAnimate');
        return;
      }
      case 'addBehavior': {
        let behavior: GameBehavior | undefined;
        try {
          behavior = decodeGameBehavior(JSON.parse(command.behaviorJSON) as unknown);
        } catch {
          behavior = undefined;
        }
        const index = this.spec.entities.findIndex((entity) => entity.id === command.entity);
        if (behavior === undefined || index < 0) return;
        const entity = this.spec.entities[index]!;
        entity.behaviors = [...entity.behaviors, behavior];
        const node = this.childNamed(command.entity);
        if (node !== undefined) this.startBehaviors({ ...entity, behaviors: [behavior] }, node);
        return;
      }
      case 'removeBehavior': {
        const index = this.spec.entities.findIndex((entity) => entity.id === command.entity);
        if (index < 0) return;
        const entity = this.spec.entities[index]!;
        entity.behaviors = entity.behaviors.filter((b) => b.type !== command.type);
        this.childNamed(command.entity)?.removeAction(command.type);
        if (command.type === 'spawner') this.spawnerStates = [];
        if (command.type === 'autoFire') this.childNamed(command.entity)?.removeAction('autoFire');
        return;
      }
      case 'setHealth': {
        const node = this.childNamed(command.entity);
        if (node === undefined) return;
        node.userData = node.userData ?? {};
        node.userData['health'] = command.health;
        return;
      }
      case 'shake':
        this.shakeScreen(command.value);
        return;
      case 'particles':
        this.emitParticles(command.particleKind, { x: command.x, y: this.worldSize.height - command.y }, command.burst);
        return;
      case 'setTimeScale': {
        const clamped = Math.max(0.1, Math.min(command.value, 3));
        this.physicsWorld.speed = clamped;
        this.speed = clamped;
        return;
      }
      case 'setSpawnInterval': {
        for (const state of this.spawnerStates) {
          state.interval = Math.max(0.15, command.value);
          state.countdown = Math.min(state.countdown, command.value);
        }
        return;
      }
      case 'setLives':
        this.livesLeft = Math.max(0, command.value);
        this.refreshLivesHUD();
        return;
      case 'restart':
        this.buildScene();
        return;
      case 'gesture': {
        // Design coords → scene points (designPoint is its own inverse).
        const start: Point = { x: command.fromX, y: this.worldSize.height - command.fromY };
        const end: Point = { x: command.toX, y: this.worldSize.height - command.toY };
        this.handleTapDown(start);
        // A few interpolated moves so drag-driven behaviours (sling pull,
        // aim line, steering) see a real path, not a teleport.
        for (let i = 1; i <= 6; i += 1) {
          const t = i / 6;
          this.handleDragMove({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
        }
        this.handleTapUp(end);
        return;
      }
      case 'launch': {
        // Design-friendly polar launch: 0° = right, 90° = up, 180° = left.
        // Sets VELOCITY so `strength` reads as launch speed in points/sec —
        // an impulse would be divided by mass, making heavy projectiles
        // barely move for the same number.
        const rad = (command.angle * Math.PI) / 180;
        const body = this.childNamed(command.entity)?.physicsBody;
        if (body === undefined) return;
        body.isDynamic = true;
        body.isResting = false;
        body.velocity = { dx: Math.cos(rad) * command.strength, dy: Math.sin(rad) * command.strength };
        return;
      }
      case 'setGravityVector': {
        this.spec.gravity = command.dy;
        if (this.phase === 'playing') this.physicsWorld.gravity = { dx: command.dx, dy: command.dy };
        return;
      }
      case 'loadSlingshot':
        this.loadSlingshot(command.entity);
        return;
      case 'motor':
        this.bikeThrottle[command.entity] = Math.max(-1, Math.min(command.throttle, 1));
        return;
      case 'torque': {
        // Mid-air lean: spin the chassis so the player can land level or
        // keep a flip going.
        const body = this.childNamed(command.entity)?.physicsBody;
        if (body !== undefined) {
          body.isResting = false;
          body.applyAngularImpulse(command.amount * 0.02);
        }
        return;
      }
      case 'damageEntity': {
        const node = this.childNamed(command.entity);
        if (node === undefined) return;
        this.damage(node, command.amount, 'debris');
        return;
      }
      case 'setPhysics': {
        const body = this.childNamed(command.entity)?.physicsBody;
        if (body === undefined) return;
        const value = command.value;
        const on = value === 'true' || value === '1' || value === 'yes';
        switch (command.property.toLowerCase()) {
          case 'bounciness': { const v = Number(value); if (Number.isFinite(v)) body.restitution = Math.max(0, Math.min(v, 1)); break; }
          case 'friction': { const v = Number(value); if (Number.isFinite(v)) body.friction = Math.max(0, v); break; }
          case 'damping': { const v = Number(value); if (Number.isFinite(v)) body.linearDamping = Math.max(0, v); break; }
          case 'mass': { const v = Number(value); if (Number.isFinite(v) && v > 0) body.mass = v; break; }
          case 'rotation': body.allowsRotation = on; break;
          case 'gravity': body.affectedByGravity = on; break;
          case 'bodytype':
            switch (value.toLowerCase()) {
              case 'static': case 'staticbody': body.isDynamic = false; body.affectedByGravity = false; break;
              case 'kinematic': body.isDynamic = false; body.affectedByGravity = false; break;
              default: body.isDynamic = true; break;
            }
            break;
          default: break;
        }
        return;
      }
      default:
        return;
    }
  }

  private applyProperty(property: string, value: string, entityId: string): void {
    const node = this.childNamed(entityId);
    if (!(node instanceof SKSpriteNode)) return;
    switch (property.toLowerCase()) {
      case 'sprite': {
        const tex = this.loadTexture(value);
        if (tex !== undefined) node.texture = tex;
        return;
      }
      case 'color':
        node.color = skColor(value);
        node.colorBlendFactor = node.texture === undefined ? 1 : 0.6;
        return;
      case 'width': { const w = Number(value); if (Number.isFinite(w)) node.size.width = w; return; }
      case 'height': { const h = Number(value); if (Number.isFinite(h)) node.size.height = h; return; }
      case 'rotation': { const deg = Number(value); if (Number.isFinite(deg)) node.zRotation = (deg * Math.PI) / 180; return; }
      case 'opacity': { const a = Number(value); if (Number.isFinite(a)) node.alpha = a; return; }
      default:
        return;
    }
  }

  /** Synchronous reads for the logic layer's Game Query block. */
  queryState(what: string, target: string): string {
    switch (what.toLowerCase()) {
      case 'positionx': {
        const node = this.childNamed(target);
        if (node === undefined) return '';
        const e = this.spec.entities.find((entity) => entity.id === target);
        return String(Math.trunc(node.position.x - (e?.width ?? 0) / 2));
      }
      case 'positiony': {
        const node = this.childNamed(target);
        if (node === undefined) return '';
        const e = this.spec.entities.find((entity) => entity.id === target);
        return String(Math.trunc(this.worldSize.height - node.position.y - (e?.height ?? 0) / 2));
      }
      case 'health':
        return String((this.childNamed(target)?.userData?.['health'] as number | undefined) ?? 0);
      case 'count': {
        const ids = new Set(
          this.spec.entities.filter((e) => e.category === target || e.id === target).map((e) => e.id),
        );
        const placed = this.children.filter((child) => {
          if (child.name === undefined) return false;
          return ids.has(this.templateId(child.name));
        });
        return String(placed.length);
      }
      case 'velocityx':
        return String(Math.trunc(this.childNamed(target)?.physicsBody?.velocity.dx ?? 0));
      case 'velocityy':
        // Design coords: positive = downward.
        return String(Math.trunc(-(this.childNamed(target)?.physicsBody?.velocity.dy ?? 0)));
      case 'rotation':
        return String(Math.trunc(((this.childNamed(target)?.zRotation ?? 0) * 180) / Math.PI));
      case 'score': return String(this.score);
      case 'lives': return String(this.livesLeft);
      case 'timeleft': return String(Math.trunc(Math.max(0, this.timeRemaining)));
      default: return '';
    }
  }

  /** Design-coordinate conversion for outgoing events (top-left origin). */
  private designPoint(p: Point): Point {
    return { x: p.x, y: this.worldSize.height - p.y };
  }

  private categoryBit(name: string): number {
    const existing = this.categoryBits[name];
    if (existing !== undefined) return existing;
    const b = this.nextBit;
    this.categoryBits[name] = b;
    this.nextBit = this.nextBit === 0 ? 0 : (this.nextBit >= 0x80000000 ? 0 : this.nextBit * 2); // up to 32 categories
    return b;
  }

  private categoryName(bit: number): string | undefined {
    return Object.keys(this.categoryBits).find((key) => this.categoryBits[key] === bit);
  }

  private loadTexture(ref: string | undefined): SKTexture | undefined {
    if (ref === undefined || ref.length === 0) return undefined;
    return this.textures.load(ref);
  }

  private randomIn(lower: number, upper: number): number {
    const lo = Math.min(lower, upper), hi = Math.max(lower, upper);
    return lo + this.random() * (hi - lo);
  }

  private buildScene(): void {
    this.removeAllChildren();
    // Joints live on the physics WORLD, not the node tree, so removing the
    // nodes leaves them behind pointing at dead bodies. After a restart the
    // rebuilt vehicle was wired to corpses and vanished from the level.
    this.physicsWorld.removeAllJoints();
    this.physicsWorld.removeAllBodies();
    this.bikeWheels = {};
    this.bikeMotorSpeed = {};
    this.bikeThrottle = {};
    this.bikeMotorForce = {};
    this.bikeWheelRadius = {};
    this.removeAllActions();
    this.score = 0;
    this.spawnerStates = [];
    this.parallaxNodes = [];
    this.elapsedPlaytime = 0;
    this.lastRampAt = 0;
    this.steerDirection = 0;
    this.steerTargetX = undefined;
    this.lastShotAt = {};
    this.livesLeft = this.spec.lives ?? 0;
    this.timeRemaining = this.spec.timeLimit ?? 0;
    this.invulnerableUntil = 0;
    this.slingActive = false;
    this.slingEntityNode = undefined;
    this.aimLine = undefined;
    this.lightNode = undefined;
    this.phase = this.spec.startPaused ? 'waiting' : 'playing';
    this.physicsWorld.gravity = { dx: 0, dy: this.spec.startPaused ? 0 : this.spec.gravity };
    this.backgroundColor = skColor(this.spec.backgroundColor, rgba(0.56, 0.82, 0.94, 1));

    // Always run through a camera: follow/world scenes need it, and fixed
    // scenes get working screen-shake for free (animating a scene's own
    // position is a SpriteKit no-op — shake MUST move a camera).
    const cam = new SKCameraNode();
    cam.position = {
      x: Math.min(this.size.width, this.worldSize.width) / 2,
      y: Math.min(this.size.height, this.worldSize.height) / 2,
    };
    this.addChild(cam);
    this.gameCamera = cam;

    const bg = this.spec.backgroundImage;
    if (bg !== undefined) {
      const tex = this.loadTexture(bg);
      if (tex !== undefined) this.addBackground(tex);
    }
    this.setupGradient();
    this.setupParallax();
    this.setupAmbient();
    this.setupLighting();
    this.setupVignette();
    if (this.spec.music !== undefined) this.setupMusic(this.spec.music);

    // Placed (non-template) entities.
    for (const entity of this.spec.entities) {
      if (entity.isTemplate) continue;
      this.addChild(this.makeNode(entity));
    }
    // Behaviors that schedule work (spawners, motion, FX) start here.
    for (const entity of this.spec.entities) {
      if (entity.isTemplate) continue;
      const node = this.childNamed(entity.id);
      if (node !== undefined) this.startBehaviors(entity, node);
    }

    if (this.spec.showScore) this.setupHUD();
    this.setupLivesAndTimerHUD();
    if (this.phase === 'waiting') this.showOverlay(this.spec.tapToStartText, undefined);
    this.onEvent?.({ kind: 'scoreChanged', score: 0 });
    // A scene with startPaused == false goes straight to .playing and never
    // passes through startPlaying(), so `started` never fired — every
    // On Game Start flow (counter resets, difficulty setup) silently never
    // ran, leaving stale values from the previous round.
    if (this.phase === 'playing') this.onEvent?.({ kind: 'started' });
  }

  /** HUD/overlay parent: the camera when one exists (so UI stays glued to
   *  the screen while the world scrolls), else the scene itself. */
  private get uiParent(): SKNode { return this.gameCamera ?? this; }

  /** Converts a screen-space point (origin bottom-left of the VISIBLE area)
   *  to the ui parent's coordinate space. */
  private uiPoint(x: number, y: number): Point {
    return this.gameCamera !== undefined
      ? { x: x - this.size.width / 2, y: y - this.size.height / 2 } // camera space is centered
      : { x, y };
  }

  // MARK: Parallax / ambient / music

  private setupParallax(): void {
    this.spec.parallax.forEach((layer, index) => {
      const tex = this.loadTexture(layer.sprite);
      if (tex === undefined) return;
      const layerHeight = layer.height ?? this.size.height;
      const ratio = layerHeight / Math.max(tex.height, 1);
      const tileWidth = tex.width * ratio;
      const holder = new SKNode();
      holder.zPosition = -900 + index;
      // Three tiles wrap seamlessly for any camera x.
      for (let i = -1; i <= 1; i += 1) {
        const tile = new SKSpriteNode({ texture: tex, size: { width: tileWidth, height: layerHeight } });
        tile.anchorPoint = { x: 0, y: 0 };
        tile.position = { x: i * tileWidth, y: layer.y };
        holder.addChild(tile);
      }
      this.addChild(holder);
      this.parallaxNodes.push({ node: holder, speed: layer.speed, tileWidth });
    });
  }

  private setupAmbient(): void {
    const kind = this.spec.ambient?.toLowerCase();
    if (kind === undefined || kind.length === 0) return;
    const emitter = new SKEmitterNode();
    emitter.setRandom(this.random);
    emitter.particleBirthRate = 24;
    emitter.particleLifetime = 12;
    emitter.particlePositionRange = { dx: this.worldSize.width * 1.2, dy: 0 };
    emitter.position = { x: this.worldSize.width / 2, y: this.worldSize.height + 20 };
    emitter.zPosition = -100;
    emitter.particleColorBlendFactor = 1;
    switch (kind) {
      case 'rain':
        emitter.particleColor = rgba(0.6, 0.7, 0.95, 0.7);
        emitter.particleSize = { width: 2, height: 14 };
        emitter.particleSpeed = 450; emitter.emissionAngle = -Math.PI / 2;
        emitter.particleBirthRate = 80; emitter.particleLifetime = 4;
        break;
      case 'bubbles':
        emitter.particleColor = rgba(1, 1, 1, 0.5);
        emitter.particleSize = { width: 9, height: 9 };
        emitter.particleSpeed = 60; emitter.emissionAngle = Math.PI / 2;
        emitter.position.y = -20;
        break;
      case 'stars':
        emitter.particleColor = SKColors.white;
        emitter.particleSize = { width: 3, height: 3 };
        emitter.particleSpeed = 4; emitter.particleAlphaSpeed = -0.08;
        emitter.particlePositionRange = { dx: this.worldSize.width * 1.2, dy: this.worldSize.height };
        emitter.position = { x: this.worldSize.width / 2, y: this.worldSize.height / 2 };
        break;
      case 'leaves':
        emitter.particleColor = rgba(0.8, 0.55, 0.25, 0.9);
        emitter.particleSize = { width: 8, height: 6 };
        emitter.particleSpeed = 60; emitter.emissionAngle = -Math.PI / 2;
        emitter.particleRotationSpeed = 2; emitter.emissionAngleRange = 0.7;
        break;
      default: // snow
        emitter.particleColor = SKColors.white;
        emitter.particleSize = { width: 5, height: 5 };
        emitter.particleSpeed = 50; emitter.emissionAngle = -Math.PI / 2;
        emitter.emissionAngleRange = 0.4;
        break;
    }
    this.addChild(emitter);
    emitter.advanceSimulationTime(8); // pre-fill so it doesn't start empty
  }

  private setupMusic(ref: string): void {
    this.musicNode?.stop();
    const audio = new SKAudioNode(ref);
    this.musicNode = audio;
    this.addChild(audio);
  }

  private addBackground(tex: SKTexture): void {
    const ratio = Math.max(this.size.width / Math.max(tex.width, 1), this.size.height / Math.max(tex.height, 1));
    const w = tex.width * ratio, h = tex.height * ratio;
    for (let i = 0; i < 2; i += 1) {
      const bg = new SKSpriteNode({ texture: tex, size: { width: w, height: h } });
      bg.anchorPoint = { x: 0, y: 0.5 };
      bg.position = { x: i * w, y: this.size.height / 2 };
      bg.zPosition = -1000;
      bg.name = '__bg';
      this.addChild(bg);
      if (this.spec.scrollSpeed > 0) {
        const move = Action.moveBy(-w, 0, w / this.spec.scrollSpeed);
        const reset = Action.moveBy(w, 0, 0);
        bg.run(Action.repeatForever(Action.sequence([move, reset])));
      }
    }
  }

  // MARK: Depth & atmosphere (v3)

  private setupGradient(): void {
    if (this.spec.backgroundGradient.length < 2) return;
    const colors = this.spec.backgroundGradient.map((hex) => skColor(hex));
    const node = new SKSpriteNode({ size: this.worldSize });
    node.gradient = { kind: 'linear', colors };
    node.anchorPoint = { x: 0, y: 0 };
    node.position = { x: 0, y: 0 };
    node.zPosition = -950;
    node.name = '__gradient';
    this.addChild(node);
  }

  private setupLighting(): void {
    if (!this.spec.lighting) return;
    const light = new SKLightNode();
    light.categoryBitMask = 1;
    light.lightColor = skColor(this.spec.lightColor, SKColors.white);
    light.ambientColor = rgba(0.35, 0.35, 0.35, 1);
    light.falloff = 1.2;
    light.position = { x: this.worldSize.width / 2, y: this.worldSize.height * 0.65 };
    light.zPosition = 900;
    this.addChild(light);
    this.lightNode = light;
  }

  private setupVignette(): void {
    if (!this.spec.vignette) return;
    const node = new SKSpriteNode({ size: { width: this.size.width * 1.05, height: this.size.height * 1.05 } });
    node.gradient = {
      kind: 'radial',
      colors: [SKColors.clear, rgba(0, 0, 0, 0.55)],
      locations: [0.55, 1.0],
    };
    node.position = this.gameCamera !== undefined
      ? { x: 0, y: 0 }
      : { x: this.size.width / 2, y: this.size.height / 2 };
    node.zPosition = 1500;
    node.name = '__vignette';
    (this.gameCamera ?? this).addChild(node);
  }

  // MARK: Node construction

  /** Every spawned instance gets its OWN name ("__spawn_wall#7"). Sharing one
   *  name across all copies made it impossible for logic to remove the single
   *  orb the player actually touched. */
  private nextSpawnName(templateId: string): string {
    this.spawnCounter += 1;
    return `__spawn_${templateId}#${this.spawnCounter}`;
  }

  /** The template id behind a node name, for both plain and spawned nodes. */
  private templateId(name: string): string {
    if (!name.startsWith('__spawn_')) return name;
    const body = name.slice('__spawn_'.length);
    return body.split('#')[0] ?? body;
  }

  private childNamed(id: string): SKNode | undefined {
    return this.childNode(id) ?? this.children.find((child) => child.name === id);
  }

  /** Ground built from a POLYLINE instead of a rectangle: a glowing stroke
   *  with a matching edge-chain physics body. Rectangles can't make hills,
   *  and a hilly track is the whole point of a physics bike game. */
  private makeTerrainNode(e: GameEntity, points: number[][]): SKNode {
    const pts: Point[] = [];
    for (const pair of points) {
      if (pair.length < 2) continue;
      pts.push({ x: pair[0]!, y: this.worldSize.height - pair[1]! });
    }
    const container = new SKNode();
    container.name = e.id;
    container.zPosition = e.zIndex;
    if (pts.length <= 1) return container;

    const stroke = SKShapeNode.path(pts);
    stroke.strokeColor = skColor(e.color, SKColors.cyan);
    stroke.lineWidth = e.strokeWidth ?? 5;
    stroke.lineCap = 'round';
    stroke.lineJoin = 'round';
    container.addChild(stroke);

    if (e.glow) {
      const halo = SKShapeNode.path(pts);
      halo.strokeColor = withAlphaComponent(skColor(e.glowColor ?? e.color, SKColors.cyan), 0.35);
      halo.lineWidth = (e.strokeWidth ?? 5) * 3.5;
      halo.lineCap = 'round';
      halo.blendMode = 'add';
      halo.zPosition = -1;
      container.addChild(halo);
    }

    // Fill below the line so the track reads as solid ground.
    const fillColor = e.glowColor ?? e.color;
    if (fillColor !== undefined) {
      const fillPoints: Point[] = [{ x: pts[0]!.x, y: -200 }, ...pts, { x: pts[pts.length - 1]!.x, y: -200 }];
      const fill = SKShapeNode.path(fillPoints, true);
      fill.fillColor = withAlphaComponent(skColor(fillColor, SKColors.cyan), 0.16);
      fill.strokeColor = SKColors.clear;
      fill.lineWidth = 0;
      fill.zPosition = -2;
      container.addChild(fill);
    }

    const body = new SKPhysicsBody({ kind: 'edgeChain', points: pts });
    body.isDynamic = false;
    body.friction = e.friction;
    body.restitution = e.restitution;
    if (e.category !== undefined) body.categoryBitMask = this.categoryBit(e.category);
    body.collisionBitMask = e.collidesWith.reduce((acc, cat) => acc | this.categoryBit(cat), 0);
    body.contactTestBitMask = e.contacts.reduce((acc, cat) => acc | this.categoryBit(cat), 0);
    body.node = container;
    container.physicsBody = body;
    applyCollisionFilter(body);
    return container;
  }

  private makeNode(e: GameEntity): SKNode {
    if (e.points !== undefined) return this.makeTerrainNode(e, e.points);
    const tex = this.loadTexture(e.sprite);
    const node = new SKSpriteNode(
      tex !== undefined
        ? { texture: tex, size: { width: e.width, height: e.height } }
        : { color: skColor(e.color, SKColors.systemBlue), size: { width: e.width, height: e.height } },
    );
    node.drawsAsEllipse = e.circleBody;
    if (e.glow) {
      // Bloom that follows the SHAPE of the sprite. A circle sized to the
      // longest side drew a fat disc around anything wide or tall, which
      // read as a bug rather than a light source.
      const halo = SKShapeNode.ellipseOf({ width: e.width * 1.45, height: e.height * 1.45 });
      const glowColor = e.glowColor ?? e.color;
      halo.fillColor = withAlphaComponent(
        skColor(glowColor, SKColors.white),
        glowColor === undefined ? 0.22 : 0.3,
      );
      halo.strokeColor = SKColors.clear;
      halo.lineWidth = 0;
      halo.blendMode = 'add';
      halo.zPosition = -1;
      node.addChild(halo);
    }
    if (e.dropShadow) {
      const shadow = SKShapeNode.ellipseOf({ width: e.width * 0.85, height: e.height * 0.22 });
      shadow.fillColor = rgba(0, 0, 0, 0.32);
      shadow.strokeColor = SKColors.clear;
      shadow.lineWidth = 0;
      shadow.position = { x: 0, y: -e.height * 0.55 };
      shadow.zPosition = -2;
      node.addChild(shadow);
    }
    node.name = e.id;
    node.zPosition = e.zIndex;
    node.zRotation = (e.rotation * Math.PI) / 180;
    // Convert top-left/+y-down design coords to SpriteKit centers.
    // (World coords when the world is larger than the screen.)
    node.position = { x: e.x + e.width / 2, y: this.worldSize.height - e.y - e.height / 2 };

    // Sprite frame ANIMATION: sprite + frames cycle at frameRate fps.
    if (e.frames !== undefined && e.frames.length > 0) {
      const textures: SKTexture[] = [];
      if (node.texture !== undefined) textures.push(node.texture);
      for (const path of e.frames) {
        const frame = this.loadTexture(path);
        if (frame !== undefined) textures.push(frame);
      }
      if (textures.length > 1) {
        const perFrame = 1 / Math.max(e.frameRate ?? 8, 1);
        node.run(Action.repeatForever(Action.animate(textures, perFrame)), 'frames');
      }
    }

    this.attachPhysics(node, e);
    if (e.health !== undefined) {
      const hp = e.health;
      node.userData = node.userData ?? {};
      node.userData['health'] = hp;
      if (hp > 1) {
        // Health bar: background + green fill that damage() shrinks.
        const barWidth = e.width * 0.9;
        const barBg = SKShapeNode.rectOf({ width: barWidth, height: 5 }, 2.5);
        barBg.fillColor = rgba(0, 0, 0, 0.5); barBg.strokeColor = SKColors.clear; barBg.lineWidth = 0;
        barBg.position = { x: 0, y: e.height / 2 + 8 };
        barBg.zPosition = 10;
        barBg.name = '__hpbg';
        const bar = SKShapeNode.rectOf({ width: barWidth, height: 5 }, 2.5);
        bar.fillColor = SKColors.systemGreen; bar.strokeColor = SKColors.clear; bar.lineWidth = 0;
        bar.position = { x: 0, y: 0 };
        bar.name = '__hp';
        bar.userData = { max: hp, w: barWidth };
        barBg.addChild(bar);
        node.addChild(barBg);
      }
    }
    return node;
  }

  private attachPhysics(node: SKSpriteNode, e: GameEntity): void {
    if (e.body === 'none') return;
    const body = e.circleBody
      ? new SKPhysicsBody({ kind: 'circle', radius: Math.min(e.width, e.height) / 2 })
      : new SKPhysicsBody({ kind: 'rectangle', size: node.size });
    switch (e.body) {
      case 'dynamic': body.isDynamic = true; body.affectedByGravity = e.affectedByGravity; break;
      case 'staticBody': body.isDynamic = false; body.affectedByGravity = false; break;
      case 'kinematic': body.isDynamic = false; body.affectedByGravity = false; break;
      default: break;
    }
    body.restitution = e.restitution;
    body.friction = e.friction;
    body.linearDamping = e.linearDamping;
    body.allowsRotation = e.allowsRotation;
    if (e.mass !== undefined) body.mass = e.mass;

    if (e.category !== undefined) body.categoryBitMask = this.categoryBit(e.category);
    body.collisionBitMask = e.collidesWith.reduce((acc, cat) => acc | this.categoryBit(cat), 0);
    body.contactTestBitMask = e.contacts.reduce((acc, cat) => acc | this.categoryBit(cat), 0);
    body.node = node;
    node.physicsBody = body;
    applyCollisionFilter(body);
    node.syncBodyToPosition();
  }

  // MARK: Behaviors

  private startBehaviors(e: GameEntity, node: SKNode): void {
    for (const b of e.behaviors) {
      switch (b.type) {
        case 'moveConstant': {
          // velocityY uses DESIGN coords: positive moves DOWN.
          const vx = b.velocityX ?? 0, vy = -(b.velocityY ?? 0);
          node.run(Action.repeatForever(Action.sequence([
            Action.custom(1 / 60, (n) => {
              if (this.phase !== 'playing') return;
              n.position.x += vx / 60;
              n.position.y += vy / 60;
              n.syncBodyToPosition();
            }),
          ])), 'moveConstant');
          break;
        }
        case 'spawner': {
          // Update-driven so difficultyRamp can retune intervals live.
          const interval = Math.max(0.2, b.interval ?? 2);
          this.spawnerStates.push({ behavior: b, interval, countdown: b.firstDelay ?? interval });
          break;
        }
        case 'bike':
          this.buildBike(e, node, b);
          break;
        case 'slingshot': {
          this.slingMaxPower = b.maxPower ?? this.slingMaxPower;
          this.slingMaxDrag = b.maxDrag ?? this.slingMaxDrag;
          this.slingHome[e.id] = { ...node.position };
          // Park the projectile ON the sling. Without this it is a live
          // dynamic body from frame one, so it drops off the slingshot
          // and rolls away before the player can even aim.
          if (node.physicsBody !== undefined) node.physicsBody.isDynamic = false;
          node.userData = node.userData ?? {};
          node.userData['launched'] = false;
          break;
        }
        case 'spin': {
          const degPerSec = b.strength ?? 90;
          node.run(Action.repeatForever(Action.rotateBy(Math.PI * 2 * (degPerSec / 360), 1)), 'spin');
          break;
        }
        case 'bob': {
          const amplitude = b.strength ?? 12;
          const period = Math.max(b.interval ?? 1.6, 0.2);
          const up = Action.moveBy(0, amplitude, period / 2, 'easeInEaseOut');
          const down = Action.moveBy(0, -amplitude, period / 2, 'easeInEaseOut');
          node.run(Action.repeatForever(Action.sequence([up, down])), 'bob');
          break;
        }
        case 'pulse': {
          const scaleDelta = b.strength ?? 0.12;
          const period = Math.max(b.interval ?? 1.0, 0.2);
          node.run(Action.repeatForever(Action.sequence([
            Action.scaleTo(1 + scaleDelta, period / 2),
            Action.scaleTo(1, period / 2),
          ])), 'pulse');
          break;
        }
        case 'patrol': {
          const dx = b.velocityX ?? 60, dy = -(b.velocityY ?? 0);
          const legTime = Math.max(b.interval ?? 2, 0.2);
          const go = Action.moveBy(dx * legTime, dy * legTime, legTime, 'easeInEaseOut');
          node.run(Action.repeatForever(Action.sequence([go, Action.reversed(go)])), 'patrol');
          break;
        }
        case 'autoFire': {
          // Continuous fire (classic shooter): spawns the projectile
          // template from this entity every `interval`, flying `direction`
          // ("up" default / "down"), at `strength` pt/s.
          const templateId = b.template;
          if (templateId === undefined) break;
          const fireInterval = Math.max(b.interval ?? 0.35, 0.08);
          const speed = b.strength ?? 620;
          const dirDown = b.direction?.toLowerCase() === 'down';
          const entityId = e.id;
          node.run(Action.repeatForever(Action.sequence([
            Action.wait(fireInterval),
            Action.run(() => {
              if (this.phase !== 'playing') return;
              const shooter = this.childNamed(entityId);
              const template = this.spec.entities.find((entity) => entity.id === templateId);
              if (shooter === undefined || template === undefined) return;
              const proj: GameEntity = { ...template, isTemplate: false };
              const p = this.makeNode(proj);
              p.name = this.nextSpawnName(template.id);
              p.position = {
                x: shooter.position.x,
                y: shooter.position.y + (dirDown ? -1 : 1) * (template.height / 2 + 18),
              };
              this.addChild(p);
              p.syncBodyToPosition();
              if (p.physicsBody !== undefined) {
                p.physicsBody.velocity = { dx: 0, dy: (dirDown ? -1 : 1) * speed };
              } else {
                p.run(Action.sequence([
                  Action.moveBy(0, (dirDown ? -1 : 1) * speed * 4, 4),
                  Action.removeFromParent(),
                ]));
              }
              p.run(Action.sequence([Action.wait(4), Action.removeFromParent()]));
            }),
          ])), 'autoFire');
          break;
        }
        case 'trail': {
          const emitter = this.makeTrailEmitter(b.particles ?? 'spark');
          emitter.targetNode = this; // particles stay in world space
          emitter.originProvider = () => ({ x: node.position.x, y: node.position.y });
          node.addChild(emitter);
          break;
        }
        default:
          break;
      }
    }
  }

  /** Left/right edges of the VISIBLE area in world coords (camera-aware). */
  private get viewRightEdge(): number {
    return (this.gameCamera?.position.x ?? this.size.width / 2) + this.size.width / 2;
  }
  private get viewLeftEdge(): number {
    return (this.gameCamera?.position.x ?? this.size.width / 2) - this.size.width / 2;
  }

  private spawnFromTemplate(template: GameEntity, b: GameBehavior, vx: number): void {
    if (b.direction?.toLowerCase() === 'down') {
      // Top spawner (shooters, falling-object games): random x across
      // the view, entering above the top edge, falling at velocityY.
      const margin = template.width / 2 + 4;
      const x = this.randomIn(margin, Math.max(this.worldSize.width - margin, margin + 1));
      const speed = Math.abs(b.velocityY ?? 160);
      const node = this.makeNode({ ...template, isTemplate: false, x: 0, y: 0 });
      node.name = this.nextSpawnName(template.id);
      node.position = { x, y: this.worldSize.height + template.height };
      this.addChild(node);
      node.syncBodyToPosition();
      node.run(Action.repeatForever(Action.custom(1 / 60, (n) => {
        if (this.phase !== 'playing') return;
        n.position.y -= speed / 60;
        n.syncBodyToPosition();
        if (n.position.y < -template.height * 2) n.removeFromParent();
      })), 'drift');
      this.onEvent?.({ kind: 'spawned', category: template.category ?? template.id });
      return;
    }
    const startX = this.viewRightEdge + template.width;
    if (b.gapSize !== undefined) {
      // Gap pair: a top and bottom segment with an opening between them.
      // Gap center is randomized between yMin…yMax.
      const gap = b.gapSize;
      const yMin = b.spawnYMin ?? gap;
      const yMax = b.spawnYMax ?? (this.size.height - gap);
      const center = this.randomIn(Math.min(yMin, yMax), Math.max(yMin, yMax));
      const topH = this.size.height - (center + gap / 2);
      const botH = center - gap / 2;
      if (topH > 4) this.addSpawned(template, startX, center + gap / 2 + topH / 2, topH, vx, 'down');
      if (botH > 4) this.addSpawned(template, startX, botH / 2, botH, vx, 'up');
      if (b.scoreOnPass !== false) {
        this.addScoreSensor(startX, center, 6, gap, vx);
      }
    } else {
      const yMin = b.spawnYMin ?? template.height;
      const yMax = b.spawnYMax ?? (this.size.height - template.height);
      const cy = this.randomIn(Math.min(yMin, yMax), Math.max(yMin, yMax));
      this.addSpawned(template, startX, cy, template.height, vx, undefined);
      if (b.scoreOnPass === true) {
        this.addScoreSensor(startX, this.size.height / 2, 6, this.size.height, vx);
      }
    }
  }

  private addSpawned(
    template: GameEntity, x: number, centerY: number, height: number, vx: number, gapEdge: GapEdge | undefined,
  ): void {
    const e: GameEntity = { ...template, isTemplate: false, y: 0, x: 0, height };

    let node: SKSpriteNode;
    const tex = this.loadTexture(template.sprite);
    if (tex !== undefined) {
      // Never STRETCH a sprite to an arbitrary segment height (mangled
      // pipes) — TILE it at natural aspect inside a crop, first tile
      // anchored at the gap edge. Top segments flip vertically so the
      // sprite's cap faces the gap, like a classic pipe pair.
      node = new SKSpriteNode({ color: SKColors.clear, size: { width: e.width, height } });
      node.cropsChildren = true;
      const tileHeight = Math.max(tex.height * (e.width / Math.max(tex.width, 1)), 8);
      const tiles = Math.max(Math.ceil(height / tileHeight), 1);
      for (let i = 0; i < tiles; i += 1) {
        const tile = new SKSpriteNode({ texture: tex, size: { width: e.width, height: tileHeight } });
        if (gapEdge === 'down') {
          tile.position = { x: 0, y: -height / 2 + tileHeight / 2 + i * tileHeight };
          tile.yScale = -1;
        } else {
          tile.position = { x: 0, y: height / 2 - tileHeight / 2 - i * tileHeight };
        }
        node.addChild(tile);
      }
      node.zPosition = e.zIndex;
      this.attachPhysics(node, e);
    } else {
      node = this.makeNode(e) as SKSpriteNode;
    }
    node.position = { x, y: centerY };
    node.name = this.nextSpawnName(template.id);
    this.addChild(node);
    node.syncBodyToPosition();
    node.run(Action.repeatForever(Action.custom(1 / 60, (n) => {
      if (this.phase !== 'playing') return;
      n.position.x += vx / 60;
      n.syncBodyToPosition();
      if (n.position.x < this.viewLeftEdge - template.width * 2) n.removeFromParent();
    })), 'drift');
  }

  private addScoreSensor(x: number, centerY: number, width: number, height: number, vx: number): void {
    const sensor = new SKNode();
    sensor.position = { x, y: centerY };
    sensor.name = '__score_sensor';
    const body = new SKPhysicsBody({ kind: 'rectangle', size: { width, height } });
    body.isDynamic = false;
    body.categoryBitMask = this.categoryBit('__score');
    body.contactTestBitMask = 0;
    body.collisionBitMask = 0;
    body.node = sensor;
    sensor.physicsBody = body;
    applyCollisionFilter(body);
    this.addChild(sensor);
    sensor.syncBodyToPosition();
    sensor.run(Action.repeatForever(Action.custom(1 / 60, (n) => {
      if (this.phase !== 'playing') return;
      n.position.x += vx / 60;
      n.syncBodyToPosition();
      if (n.position.x < this.viewLeftEdge - 40) n.removeFromParent();
    })));
  }

  // MARK: Per-frame update

  /** `override func update(_ currentTime: TimeInterval)` */
  update(currentTime: number): void {
    const dt = this.lastUpdate === 0 ? 0 : Math.min(currentTime - this.lastUpdate, 0.1);
    this.lastUpdate = currentTime;
    if (this.phase !== 'playing') return;
    this.elapsedPlaytime += dt;

    // Spawners (update-driven, retunable).
    for (const state of this.spawnerStates) {
      state.countdown -= dt;
      if (state.countdown <= 0) {
        state.countdown = state.interval;
        const b = state.behavior;
        const templateId = b.template;
        if (templateId !== undefined) {
          const template = this.spec.entities.find((entity) => entity.id === templateId);
          if (template !== undefined) this.spawnFromTemplate(template, b, b.velocityX ?? -140);
        }
      }
    }
    // Difficulty ramp: every 10s tighten every spawner interval.
    const ramp = this.spec.difficultyRamp;
    if (ramp !== undefined && ramp > 0 && ramp !== 1 && this.elapsedPlaytime - this.lastRampAt >= 10) {
      this.lastRampAt = this.elapsedPlaytime;
      for (const state of this.spawnerStates) {
        state.interval = Math.max(0.25, state.interval * ramp);
      }
    }

    // Countdown mode.
    if (this.spec.timeLimit !== undefined) {
      this.timeRemaining -= dt;
      this.timerHUD.text = `⏱ ${Math.max(0, Math.ceil(this.timeRemaining))}`;
      if (this.timeRemaining <= 0) {
        if (this.spec.timeUpAction.toLowerCase() === 'win') this.winGame(); else this.triggerGameOver();
      }
    }

    // Player passing a score sensor (Flappy scoring).
    for (const sensor of this.children.filter((child) => child.name === '__score_sensor')) {
      const player = this.players()[0];
      if (player !== undefined && sensor.position.x < player.position.x && sensor.userData?.['counted'] !== true) {
        sensor.userData = sensor.userData ?? {};
        sensor.userData['counted'] = true;
        this.addScore(1);
      }
    }

    // Drive the CHASSIS along its own forward axis and let the wheels roll
    // from ground friction. Spinning the wheels with angular impulses just
    // made them slip — the bike crawled 14pt in a second and a half.
    for (const [bikeId, wheels] of Object.entries(this.bikeWheels)) {
      const throttle = this.bikeThrottle[bikeId] ?? 0;
      const chassis = this.childNamed(bikeId);
      const body = chassis?.physicsBody;
      if (chassis === undefined || body === undefined) continue;
      const maxSpeed = (this.bikeMotorSpeed[bikeId] ?? 30) * 20;
      if (throttle !== 0) {
        body.isResting = false;
        // Throttle drives along the WORLD x axis, not the chassis's own
        // heading. Following the heading meant that the moment the bike
        // tipped or flipped, "forward" pointed backwards and full
        // throttle drove it in reverse (measured velocity -83).
        const along = body.velocity.dx;
        const target = maxSpeed * throttle;
        if (Math.abs(along) < Math.abs(target) || (along < 0) !== (throttle < 0)) {
          const step = (this.bikeMotorForce[bikeId] ?? 11) * throttle;
          body.velocity = { dx: along + step, dy: body.velocity.dy };
        }
        // Spin the wheels to match ground speed so they look driven.
        for (const wheel of wheels) {
          if (wheel.physicsBody === undefined) continue;
          wheel.physicsBody.isResting = false;
          wheel.physicsBody.angularVelocity = -body.velocity.dx / Math.max(this.wheelRadiusFor(bikeId), 1);
        }
      } else {
        for (const wheel of wheels) {
          if (wheel.physicsBody === undefined) continue;
          wheel.physicsBody.angularVelocity *= 0.99;
        }
      }
    }

    // Slingshot auto-reload: a real sling game gives you the NEXT shot once
    // the last one settles. Without this the projectile just rolls on the
    // floor forever and the level can never be finished.
    if (this.slingActive === false) {
      for (const e of this.spec.entities) {
        if (!e.behaviors.some((b) => b.type === 'slingshot' && b.autoReload === true)) continue;
        const node = this.childNamed(e.id);
        const body = node?.physicsBody;
        if (node === undefined || body === undefined || node.userData?.['launched'] !== true) continue;
        const offWorld = node.position.x < -120 || node.position.x > this.worldSize.width + 120
          || node.position.y < -120 || node.position.y > this.worldSize.height + 200;
        const speed = Math.hypot(body.velocity.dx, body.velocity.dy);
        if (offWorld) {
          this.slingSettle[e.id] = 999;
        } else if (speed < 34) {
          this.slingSettle[e.id] = (this.slingSettle[e.id] ?? 0) + 1;
        } else {
          this.slingSettle[e.id] = 0;
        }
        // ~0.75s still, or gone off-screen → reload the next shot.
        if ((this.slingSettle[e.id] ?? 0) >= 45) {
          this.slingSettle[e.id] = 0;
          this.loadSlingshot(e.id);
          this.onEvent?.({ kind: 'spawned', category: e.category ?? e.id });
        }
      }
    }

    // Per-entity update behaviors.
    for (const e of this.spec.entities) {
      if (e.isTemplate) continue;
      const node = this.childNamed(e.id);
      if (node === undefined) continue;
      for (const b of e.behaviors) {
        switch (b.type) {
          case 'wrapVertical':
            if (node.position.y < 0) node.position.y += this.worldSize.height;
            if (node.position.y > this.worldSize.height) node.position.y -= this.worldSize.height;
            node.syncBodyToPosition();
            break;
          case 'destroyOffscreen': {
            const m = b.margin ?? 120;
            if (node.position.x < -m || node.position.x > this.worldSize.width + m
              || node.position.y < -m || node.position.y > this.worldSize.height + m) {
              node.removeFromParent();
            }
            break;
          }
          case 'rotateWithVelocity': {
            // Flappy-style tilt: nose follows vertical velocity.
            const body = node.physicsBody;
            if (body !== undefined) {
              const target = Math.max(-0.9, Math.min(0.6, body.velocity.dy * 0.0022));
              node.zRotation += (target - node.zRotation) * 0.2;
            }
            break;
          }
          case 'followEntity': {
            // Homing: drift toward the target entity at `strength` pt/s.
            const targetId = b.target;
            const targetNode = targetId === undefined ? undefined : this.childNamed(targetId);
            if (targetNode !== undefined) {
              const speed = b.strength ?? 80;
              const dx = targetNode.position.x - node.position.x;
              const dy = targetNode.position.y - node.position.y;
              const dist = Math.max(Math.hypot(dx, dy), 1);
              node.position.x += (dx / dist) * speed * dt;
              node.position.y += (dy / dist) * speed * dt;
              node.syncBodyToPosition();
            }
            break;
          }
          case 'controlHorizontal': {
            // Player steering: arrow keys / drag set the direction.
            const speed = b.strength ?? 240;
            if (this.steerTargetX !== undefined) {
              const dx = this.steerTargetX - node.position.x;
              node.position.x += Math.max(-speed * dt, Math.min(speed * dt, dx));
              if (Math.abs(dx) < 2) this.steerTargetX = undefined;
            } else if (this.steerDirection !== 0) {
              node.position.x += this.steerDirection * speed * dt;
            }
            node.position.x = Math.max(e.width / 2, Math.min(this.worldSize.width - e.width / 2, node.position.x));
            node.syncBodyToPosition();
            break;
          }
          default:
            break;
        }
      }
    }

    const light = this.lightNode;
    if (light !== undefined) {
      const followId = this.spec.lightFollow;
      const target = followId === undefined ? undefined : this.childNamed(followId);
      if (target !== undefined) {
        light.position = { x: target.position.x, y: target.position.y + 40 };
      } else if (this.gameCamera !== undefined && this.spec.cameraFollow !== undefined) {
        light.position = { x: this.gameCamera.position.x, y: this.gameCamera.position.y + this.size.height * 0.2 };
      }
    }
    this.updateCameraAndParallax();
  }

  private updateCameraAndParallax(): void {
    const cam = this.gameCamera;
    if (cam !== undefined) {
      const followId = this.spec.cameraFollow;
      const target = followId === undefined ? undefined : this.childNamed(followId);
      if (target !== undefined) {
        // Smooth follow, clamped so the view never leaves the world.
        const halfW = this.size.width / 2, halfH = this.size.height / 2;
        const goalX = Math.max(halfW, Math.min(this.worldSize.width - halfW, target.position.x));
        const goalY = Math.max(halfH, Math.min(this.worldSize.height - halfH, target.position.y));
        cam.position.x += (goalX - cam.position.x) * 0.12;
        cam.position.y += (goalY - cam.position.y) * 0.12;
      }
      for (const layer of this.parallaxNodes) {
        // speed 0 = pinned to camera (far sky), 1 = fixed in the world.
        const base = cam.position.x * (1 - layer.speed);
        layer.node.position.x = base - (base % layer.tileWidth);
      }
    } else if (this.spec.scrollSpeed > 0) {
      for (const layer of this.parallaxNodes) {
        layer.node.position.x -= (this.spec.scrollSpeed * layer.speed) / 60;
        if (layer.node.position.x < -layer.tileWidth) layer.node.position.x += layer.tileWidth;
      }
    }
  }

  private players(): SKNode[] {
    const nodes: SKNode[] = [];
    for (const e of this.spec.entities) {
      if (!e.behaviors.some((b) => b.type === 'impulseOnTap' || b.type === 'slingshot')) continue;
      const node = this.childNamed(e.id);
      if (node !== undefined) nodes.push(node);
    }
    return nodes;
  }

  // MARK: Scoring & state

  private addScore(n: number): void {
    this.score += n;
    this.hud.text = `${this.score}`;
    this.onEvent?.({ kind: 'scoreChanged', score: this.score });
    const win = this.spec.winScore;
    if (win !== undefined && this.score >= win) this.winGame();
  }

  private triggerGameOver(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'over';
    this.physicsWorld.gravity = { dx: 0, dy: this.spec.gravity }; // let bodies settle
    this.showOverlay('Game Over', `Score ${this.score} · tap to retry`);
    this.onEvent?.({ kind: 'gameOver', score: this.score });
  }

  private winGame(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'won';
    // Celebration burst.
    const center = this.gameCamera?.position ?? { x: this.size.width / 2, y: this.size.height / 2 };
    this.emitParticles('confetti', { x: center.x, y: center.y + this.size.height * 0.3 }, 120);
    this.showOverlay('You Win!', `Score ${this.score} · tap to play again`);
    this.onEvent?.({ kind: 'won', score: this.score });
  }

  private startPlaying(): void {
    if (this.phase !== 'waiting') return;
    this.phase = 'playing';
    this.physicsWorld.gravity = { dx: 0, dy: this.spec.gravity };
    this.hideOverlay();
    this.onEvent?.({ kind: 'started' });
  }

  // MARK: Contacts

  /** `func didBegin(_ contact: SKPhysicsContact)` */
  didBegin(contact: PhysicsContact): void {
    if (this.phase !== 'playing') return;
    // Physical force of the hit — the difference between a bird grazing a
    // wall and one demolishing it. Logic scales damage off this.
    // Stacked blocks resting on each other re-trigger contacts forever as
    // the solver jitters them. Reporting those as "impacts" made the screen
    // shake permanently and drained health from a structure nobody hit, so
    // an impact must involve something actually MOVING.
    const speedA = Math.hypot(contact.bodyA.velocity.dx, contact.bodyA.velocity.dy);
    const speedB = Math.hypot(contact.bodyB.velocity.dx, contact.bodyB.velocity.dy);
    const catA = this.categoryName(contact.bodyA.categoryBitMask);
    const catB = this.categoryName(contact.bodyB.categoryBitMask);
    if (Math.max(speedA, speedB) > 60 && catA !== undefined && catB !== undefined
      && !catA.startsWith('__') && !catB.startsWith('__')) {
      this.onEvent?.({
        kind: 'impact',
        categoryA: catA,
        categoryB: catB,
        force: contact.collisionImpulse,
        entityA: contact.bodyA.node?.name ?? '',
        entityB: contact.bodyB.node?.name ?? '',
      });
    }
    this.handleContact(contact.bodyA, contact.bodyB);
    this.handleContact(contact.bodyB, contact.bodyA);
  }

  private handleContact(a: SKPhysicsBody, b: SKPhysicsBody): void {
    // Surface every category pair to the host once per contact — the
    // logic editor's On Game Collision flows hook in here.
    const catA = this.categoryName(a.categoryBitMask);
    const catB = this.categoryName(b.categoryBitMask);
    if (catA !== undefined && catB !== undefined && !catA.startsWith('__') && !catB.startsWith('__')) {
      this.onEvent?.({
        kind: 'collision',
        categoryA: catA,
        categoryB: catB,
        entityA: a.node?.name ?? '',
        entityB: b.node?.name ?? '',
      });
    }
    const nodeA = a.node;
    const idA = nodeA?.name;
    if (nodeA === undefined || idA === undefined) return;
    const entity = this.spec.entities.find((e) => e.id === this.templateId(idA));
    if (entity === undefined) return;
    // Which category is the other body?
    const otherCat = this.categoryName(b.categoryBitMask);
    for (const beh of entity.behaviors) {
      if (beh.type !== 'onCollision') continue;
      if (beh.target === undefined || beh.target !== otherCat) continue;
      this.applyCollisionAction(beh, nodeA, b.node);
    }
  }

  private applyCollisionAction(beh: GameBehavior, selfNode: SKNode, otherNode: SKNode | undefined): void {
    if (beh.soundName !== undefined) playSoundFileNamed(beh.soundName);
    if (beh.particles !== undefined && otherNode !== undefined) this.emitParticles(beh.particles, otherNode.position);
    if (beh.shake === true) this.shakeScreen();
    switch (beh.action ?? '') {
      case 'gameOver': this.triggerGameOver(); break;
      case 'win': this.winGame(); break;
      case 'score': this.addScore(beh.points ?? 1); break;
      case 'removeSelf':
        selfNode.removeFromParent();
        this.emitDestroyed(selfNode);
        break;
      case 'removeOther':
        if (otherNode !== undefined) this.emitDestroyed(otherNode);
        otherNode?.removeFromParent();
        if (beh.points !== undefined) this.addScore(beh.points);
        break;
      case 'damage':
        if (otherNode !== undefined) this.damage(otherNode, beh.points ?? 1, beh.particles);
        break;
      case 'bounce':
        selfNode.physicsBody?.applyImpulse({ dx: 0, dy: beh.strength ?? 6 });
        break;
      case 'loseLife':
        this.loseLife(selfNode);
        break;
      case 'explode':
        if (otherNode !== undefined) {
          this.emitParticles(beh.particles ?? 'fire', otherNode.position, 60);
          this.shakeScreen();
          this.emitDestroyed(otherNode);
          otherNode.removeFromParent();
          if (beh.points !== undefined) this.addScore(beh.points);
        }
        break;
      case 'runFlow':
        if (beh.flowId !== undefined) this.onEvent?.({ kind: 'runFlow', flowId: beh.flowId });
        break;
      default: break;
    }
  }

  /** Multi-life games: decrement, blink invulnerable for ~1.2s, game over at 0. */
  private loseLife(node: SKNode): void {
    if (this.spec.lives === undefined) { this.triggerGameOver(); return; }
    if (this.elapsedPlaytime < this.invulnerableUntil) return;
    this.livesLeft -= 1;
    this.refreshLivesHUD();
    this.onEvent?.({ kind: 'lifeLost', remaining: this.livesLeft });
    if (this.livesLeft <= 0) { this.triggerGameOver(); return; }
    this.invulnerableUntil = this.elapsedPlaytime + 1.2;
    this.shakeScreen(6);
    node.run(Action.repeat(Action.sequence([
      Action.fadeAlpha(0.25, 0.12),
      Action.fadeAlpha(1.0, 0.12),
    ]), 5), 'invulnerable');
  }

  /** Reports a destroyed entity's category (falls back to its id) so the
   *  logic editor's On Entity Destroyed flows can react. */
  private emitDestroyed(node: SKNode): void {
    const name = node.name;
    if (name === undefined) return;
    const bareId = this.templateId(name);
    const category = this.spec.entities.find((e) => e.id === bareId)?.category ?? bareId;
    this.onEvent?.({ kind: 'entityDestroyed', category });
  }

  /** Quick camera shake — impact feedback. Ends back at the exact origin so
   *  fixed (non-follow) cameras never drift. */
  private shakeScreen(intensity = 10): void {
    // One shake at a time. Contacts arrive in bursts (a bird rolling along
    // the ground fires many), and stacking shake actions turned the whole
    // screen into a permanent rattle that never settled.
    if (this.shakeUntil >= this.currentTime) return;
    this.shakeUntil = this.currentTime + 0.35;

    const target = this.gameCamera;
    if (target === undefined) return;

    // How far the camera can travel before it shows what is OUTSIDE the
    // world. When the level is exactly screen-sized this is zero, and the
    // old unconditional translation dragged the empty edges into view on
    // every hit — which read as the whole picture breaking apart.
    const slackX = Math.max(0, (this.worldSize.width - this.size.width) / 2);
    const slackY = Math.max(0, (this.worldSize.height - this.size.height) / 2);
    const amp = Math.min(intensity * 0.35, 6);
    const offsetX = Math.min(amp, slackX);
    const offsetY = Math.min(amp, slackY);

    // Always readable, never destructive: a very short zoom pulse. Scaling
    // IN cannot expose anything beyond the level, so impact still lands
    // even when there is no room to translate.
    target.run(Action.sequence([
      Action.scaleTo(1 - Math.min(intensity, 20) * 0.0012, 0.05, 'easeOut'),
      Action.scaleTo(1, 0.12, 'easeOut'),
    ]), 'shakePunch');

    // Only add movement when the world genuinely has room to spare.
    if (!(offsetX > 0.5 || offsetY > 0.5)) return;
    const origin = { ...target.position };
    const steps: ReturnType<typeof Action.moveBy>[] = [];
    for (let i = 0; i < 4; i += 1) {
      const decay = 1 - i / 4;
      steps.push(Action.moveBy(
        this.randomIn(-offsetX, offsetX) * decay,
        this.randomIn(-offsetY, offsetY) * decay,
        0.04,
      ));
    }
    target.run(Action.sequence([...steps, Action.moveTo(origin.x, origin.y, 0.06)]), 'shake');
  }

  private damage(node: SKNode, amount: number, particles: string | undefined): void {
    // An entity with NO health is not destructible — it is scenery or a
    // projectile, not a target. Treating "no health" as 0 meant a single
    // stray damage call deleted it outright: the bird vanished the instant
    // it struck the tower, because a concurrent flow aimed damage at it.
    // Destructible things declare health; everything else shrugs damage off.
    const current = node.userData?.['health'];
    if (typeof current !== 'number') return;
    const remaining = current - amount;
    if (remaining <= 0) {
      if (particles !== undefined) this.emitParticles(particles, node.position);
      this.emitDestroyed(node);
      node.removeFromParent();
      return;
    }
    node.userData!['health'] = remaining;
    node.run(Action.sequence([Action.fadeAlpha(0.4, 0.05), Action.fadeAlpha(1, 0.05)]));
    const bar = node.childNode('__hpbg')?.childNode('__hp');
    if (bar instanceof SKShapeNode) {
      const maxHp = bar.userData?.['max'];
      const w = bar.userData?.['w'];
      if (typeof maxHp === 'number' && typeof w === 'number' && maxHp > 0) {
        const ratio = remaining / maxHp;
        bar.xScale = Math.max(ratio, 0.02);
        bar.position.x = (-w * (1 - ratio)) / 2;
        bar.fillColor = ratio > 0.5 ? SKColors.systemGreen : (ratio > 0.25 ? SKColors.systemOrange : SKColors.systemRed);
      }
    }
  }

  // MARK: Particles (built procedurally so no .sks assets are needed)

  private emitParticles(kind: string, point: Point, burst = 18): void {
    const emitter = new SKEmitterNode();
    emitter.setRandom(this.random);
    emitter.position = { ...point };
    emitter.zPosition = 500;
    emitter.particleLifetime = 0.6;
    emitter.numParticlesToEmit = burst;
    emitter.particleBirthRate = 600;
    emitter.particleSpeed = 120;
    emitter.particleSpeedRange = 80;
    emitter.emissionAngleRange = Math.PI * 2;
    emitter.particleAlpha = 0.9;
    emitter.particleAlphaSpeed = -1.5;
    emitter.particleScale = 0.4;
    emitter.particleScaleRange = 0.3;
    this.style(emitter, kind);
    emitter.particleColorBlendFactor = 1;
    this.addChild(emitter);
    emitter.run(Action.sequence([Action.wait(1.2), Action.removeFromParent()]));
  }

  private style(emitter: SKEmitterNode, kind: string): void {
    switch (kind) {
      case 'spark':
        emitter.particleColor = SKColors.yellow; emitter.particleSize = { width: 4, height: 4 };
        break;
      case 'smoke':
        emitter.particleColor = SKColors.gray; emitter.particleSize = { width: 10, height: 10 };
        emitter.particleAlphaSpeed = -1.0; emitter.particleSpeed = 40;
        break;
      case 'fire':
        emitter.particleColor = SKColors.orange; emitter.particleSize = { width: 8, height: 8 };
        emitter.particleColorBlendFactor = 1;
        emitter.particleSpeed = 160; emitter.particleLifetime = 0.5;
        break;
      case 'confetti':
        emitter.particleColor = SKColors.systemPink; emitter.particleSize = { width: 6, height: 4 };
        emitter.particleColorRedRange = 1; emitter.particleColorGreenRange = 1; emitter.particleColorBlueRange = 1;
        emitter.particleRotationSpeed = 6; emitter.particleLifetime = 1.4;
        emitter.yAcceleration = -280;
        break;
      case 'hearts':
        emitter.particleColor = SKColors.systemRed; emitter.particleSize = { width: 7, height: 7 };
        emitter.particleSpeed = 60; emitter.emissionAngle = Math.PI / 2;
        break;
      default: // debris
        emitter.particleColor = SKColors.brown; emitter.particleSize = { width: 6, height: 6 };
        break;
    }
  }

  /** Continuous trail attached to a moving entity (rocket exhaust, sparkles). */
  private makeTrailEmitter(kind: string): SKEmitterNode {
    const emitter = new SKEmitterNode();
    emitter.setRandom(this.random);
    emitter.particleBirthRate = 40;
    emitter.particleLifetime = 0.5;
    emitter.particleSpeed = 20;
    emitter.particleSpeedRange = 12;
    emitter.emissionAngleRange = Math.PI / 3;
    emitter.emissionAngle = Math.PI; // trails behind a rightward-facing entity
    emitter.particleAlpha = 0.8;
    emitter.particleAlphaSpeed = -1.6;
    emitter.particleScale = 0.35;
    emitter.particleScaleSpeed = -0.5;
    emitter.zPosition = -1;
    this.style(emitter, kind);
    emitter.particleColorBlendFactor = 1;
    return emitter;
  }

  // MARK: Input (cross-platform)

  handleTapDown(p: Point): void {
    const dp = this.designPoint(p);
    this.onEvent?.({ kind: 'tap', x: dp.x, y: dp.y });
    this.onEvent?.({ kind: 'drag', phase: 'start', x: dp.x, y: dp.y });
    switch (this.phase) {
      case 'waiting':
        this.startPlaying();
      // fallthrough
      case 'playing':
        this.applyTapImpulses();
        this.applyJumps();
        this.applyShots(p);
        this.beginSlingIfPossible(p);
        // Steering is DRAG/keys only — a tap is an action (shoot/flap),
        // and must not also yank the player toward the tap point.
        break;
      case 'over':
      case 'won':
        this.buildScene(); // restart
        break;
      default:
        break;
    }
  }

  /** jumpOnTap: platformer jump — only fires when (approximately) grounded,
   *  so holding the tap can't fly. */
  private applyJumps(): void {
    for (const e of this.spec.entities) {
      const jump = e.behaviors.find((b) => b.type === 'jumpOnTap');
      const node = this.childNamed(e.id);
      const body = node?.physicsBody;
      if (jump === undefined || node === undefined || body === undefined) continue;
      if (Math.abs(body.velocity.dy) < 24) {
        body.velocity = { dx: body.velocity.dx, dy: 0 };
        body.applyImpulse({ dx: 0, dy: jump.strength ?? 12 });
      }
    }
  }

  /** shootOnTap: spawn the projectile template from the shooter, flying
   *  toward the tap point at `strength` pt/s, with an `interval` cooldown. */
  private applyShots(p: Point): void {
    for (const e of this.spec.entities) {
      const shoot = e.behaviors.find((b) => b.type === 'shootOnTap');
      const templateId = shoot?.template;
      if (shoot === undefined || templateId === undefined) continue;
      const template = this.spec.entities.find((entity) => entity.id === templateId);
      const shooter = this.childNamed(e.id);
      if (template === undefined || shooter === undefined) continue;
      const cooldown = shoot.interval ?? 0.3;
      const last = this.lastShotAt[e.id];
      if (last !== undefined && this.elapsedPlaytime - last < cooldown) continue;
      this.lastShotAt[e.id] = this.elapsedPlaytime;

      const proj: GameEntity = { ...template, isTemplate: false };
      const node = this.makeNode(proj);
      node.name = this.nextSpawnName(template.id);
      node.position = { ...shooter.position };
      this.addChild(node);
      node.syncBodyToPosition();
      let dx = p.x - shooter.position.x, dy = p.y - shooter.position.y;
      if (shoot.direction?.toLowerCase() === 'up') { dx = 0; dy = 1; }
      if (shoot.direction?.toLowerCase() === 'down') { dx = 0; dy = -1; }
      const dist = Math.max(Math.hypot(dx, dy), 1);
      const speed = shoot.strength ?? 500;
      if (node.physicsBody !== undefined) {
        node.physicsBody.velocity = { dx: (dx / dist) * speed, dy: (dy / dist) * speed };
      } else {
        node.run(Action.moveBy((dx / dist) * speed * 4, (dy / dist) * speed * 4, 4));
      }
      node.run(Action.sequence([Action.wait(5), Action.removeFromParent()]));
    }
  }

  handleDragMove(p: Point): void {
    const dp = this.designPoint(p);
    this.onEvent?.({ kind: 'drag', phase: 'move', x: dp.x, y: dp.y });
    const node = this.slingEntityNode;
    if (!this.slingActive || node === undefined) return;
    const delta: Vector = { dx: p.x - this.slingAnchor.x, dy: p.y - this.slingAnchor.y };
    const dist = Math.hypot(delta.dx, delta.dy);
    if (dist > this.slingMaxDrag) {
      const k = this.slingMaxDrag / dist;
      delta.dx *= k; delta.dy *= k;
    }
    // Keep the pull INSIDE the playfield. The sling sits near the left wall,
    // so a long pull used to drag the projectile off-screen — where the
    // release touch is no longer over the view at all.
    const target: Point = { x: this.slingAnchor.x + delta.dx, y: this.slingAnchor.y + delta.dy };
    const halfW = node instanceof SKSpriteNode ? node.size.width : 40;
    const halfH = node instanceof SKSpriteNode ? node.size.height : 40;
    target.x = Math.min(Math.max(target.x, halfW / 2), this.worldSize.width - halfW / 2);
    target.y = Math.min(Math.max(target.y, halfH / 2), this.worldSize.height - halfH / 2);
    node.position = target;
    node.syncBodyToPosition();
    if (node.physicsBody !== undefined) node.physicsBody.velocity = { dx: 0, dy: 0 };
    this.drawAimLine(node.position, this.slingAnchor);
  }

  /** Puts an aiming projectile back on the sling when the gesture was lost
   *  without a usable release point. */
  private releaseStuckSling(): void {
    const node = this.slingEntityNode;
    if (!this.slingActive || node === undefined) return;
    this.slingActive = false;
    this.aimLine?.removeFromParent(); this.aimLine = undefined;
    node.position = { ...this.slingAnchor };
    node.syncBodyToPosition();
    if (node.physicsBody !== undefined) {
      node.physicsBody.velocity = { dx: 0, dy: 0 };
      node.physicsBody.isDynamic = false;
    }
    node.userData = node.userData ?? {};
    node.userData['launched'] = false;
    this.slingEntityNode = undefined;
  }

  handleTapUp(p: Point): void {
    const dpUp = this.designPoint(p);
    this.onEvent?.({ kind: 'drag', phase: 'end', x: dpUp.x, y: dpUp.y });
    const node = this.slingEntityNode;
    if (!this.slingActive || node === undefined) return;
    this.slingActive = false;
    this.aimLine?.removeFromParent(); this.aimLine = undefined;
    const pull: Vector = { dx: this.slingAnchor.x - node.position.x, dy: this.slingAnchor.y - node.position.y };
    const dist = Math.hypot(pull.dx, pull.dy);

    // A pull too small to aim shouldn't burn a shot — put the bird back.
    if (!(dist > 6)) {
      node.position = { ...this.slingAnchor };
      node.syncBodyToPosition();
      node.userData = node.userData ?? {};
      node.userData['launched'] = false;
      if (node.physicsBody !== undefined) node.physicsBody.isDynamic = false;
      this.slingEntityNode = undefined;
      return;
    }

    const body = node.physicsBody;
    if (body !== undefined) {
      body.affectedByGravity = true;
      body.isResting = false;
      // Set VELOCITY, not an impulse. An impulse is divided by the body's
      // mass, so a heavier bird launched with the same pull barely moved —
      // it just dropped off the sling. maxPower now means, readably, "launch
      // speed in points/sec at a full-strength pull".
      const ratio = Math.min(dist / Math.max(this.slingMaxDrag, 1), 1);
      const speed = this.slingMaxPower * ratio;
      body.velocity = { dx: (pull.dx / dist) * speed, dy: (pull.dy / dist) * speed };
    }
    this.onEvent?.({ kind: 'launched', entityId: node.name ?? '' });
    this.slingEntityNode = undefined;
  }

  /** Where a shot released right now would actually travel: same launch
   *  velocity the release uses, integrated against real gravity. SpriteKit
   *  applies world gravity at 150 points per metre, so the preview has to use
   *  that scale or the drawn arc is not the arc the bird flies. */
  private predictedLaunch(from: Point, anchor: Point): { v: Vector; a: Vector } | undefined {
    const pull: Vector = { dx: anchor.x - from.x, dy: anchor.y - from.y };
    const dist = Math.hypot(pull.dx, pull.dy);
    if (!(dist > 6)) return undefined;
    const speed = this.slingMaxPower * Math.min(dist / Math.max(this.slingMaxDrag, 1), 1);
    const v: Vector = { dx: (pull.dx / dist) * speed, dy: (pull.dy / dist) * speed };
    const a: Vector = { dx: this.physicsWorld.gravity.dx * 150, dy: this.physicsWorld.gravity.dy * 150 };
    return { v, a };
  }

  private applyTapImpulses(): void {
    for (const e of this.spec.entities) {
      if (!e.behaviors.some((b) => b.type === 'impulseOnTap')) continue;
      const node = this.childNamed(e.id);
      const body = node?.physicsBody;
      if (node === undefined || body === undefined) continue;
      const strength = e.behaviors.find((b) => b.type === 'impulseOnTap')?.strength ?? 8;
      body.velocity = { dx: body.velocity.dx, dy: 0 };
      body.applyImpulse({ dx: 0, dy: strength });
    }
  }

  /** Puts a bird back on the slingshot: recreates it if the last shot flew
   *  away, parks it at the sling anchor and re-arms it for dragging. This is
   *  what turns a one-shot sling into a real level with several birds. */
  private loadSlingshot(entityId: string): void {
    const e = this.spec.entities.find((entity) => entity.id === entityId);
    if (e === undefined) return;
    let node = this.childNamed(entityId);
    if (node === undefined) {
      const fresh: GameEntity = { ...e, isTemplate: false };
      node = this.makeNode(fresh);
      node.name = e.id;
      this.addChild(node);
      node.syncBodyToPosition();
      this.startBehaviors(fresh, node);
    }
    const home = this.slingHome[entityId]
      ?? { x: e.x + e.width / 2, y: this.worldSize.height - e.y - e.height / 2 };
    this.slingHome[entityId] = home;
    node.position = { ...home };
    node.zRotation = 0;
    node.syncBodyToPosition();
    if (node.physicsBody !== undefined) {
      node.physicsBody.velocity = { dx: 0, dy: 0 };
      node.physicsBody.angularVelocity = 0;
      node.physicsBody.isDynamic = false;
    }
    node.userData = node.userData ?? {};
    node.userData['launched'] = false;
    node.alpha = 1;
  }

  /** Two motorised wheels pinned under a chassis — a real vehicle rather than
   *  a sliding box. Pin joints let the wheels spin (drive) while the chassis
   *  rotates freely for mid-air leaning and flips. */
  private buildBike(e: GameEntity, chassis: SKNode, b: GameBehavior): void {
    const chassisBody = chassis.physicsBody;
    if (chassisBody === undefined) return;
    chassisBody.allowsRotation = true;

    const radius = b.wheelRadius ?? Math.max(e.height * 0.42, 10);
    const base = b.wheelBase ?? (e.width * 0.62);
    const drop = b.wheelDrop ?? (e.height * 0.42);
    const offsets = [-base / 2, base / 2];
    const made: SKNode[] = [];

    offsets.forEach((dx, index) => {
      const wheel = SKShapeNode.circleOfRadius(radius);
      wheel.name = `${e.id}__wheel${index}`;
      wheel.strokeColor = skColor(e.glowColor ?? e.color, SKColors.cyan);
      wheel.lineWidth = 3;
      wheel.fillColor = withAlphaComponent(skColor(e.glowColor ?? e.color, SKColors.cyan), 0.18);
      wheel.glowWidth = 4;
      wheel.zPosition = e.zIndex - 0.1;
      wheel.position = { x: chassis.position.x + dx, y: chassis.position.y - drop };

      const body = new SKPhysicsBody({ kind: 'circle', radius });
      body.isDynamic = true;
      body.friction = 0.85;
      body.restitution = 0.05;
      body.linearDamping = 0.02;
      body.mass = 0.5;
      body.allowsRotation = true;
      body.categoryBitMask = this.categoryBit('__wheel');
      // Wheels roll on whatever the chassis collides with, but report no
      // contacts — only the BODY touching the ground counts as a crash.
      body.collisionBitMask = e.collidesWith.reduce((acc, cat) => acc | this.categoryBit(cat), 0);
      body.contactTestBitMask = 0;
      body.node = wheel;
      wheel.physicsBody = body;
      applyCollisionFilter(body);
      this.addChild(wheel);
      wheel.syncBodyToPosition();
      made.push(wheel);

      const joint = this.physicsWorld.makePinJoint(chassisBody, body, wheel.position);
      joint.frictionTorque = 0.02;
      this.physicsWorld.addJoint(joint);
    });
    this.bikeWheels[e.id] = made;
    this.bikeMotorSpeed[e.id] = b.motorSpeed ?? 30;
    this.bikeMotorForce[e.id] = b.motorForce ?? 11;
    this.bikeWheelRadius[e.id] = radius;
  }

  private beginSlingIfPossible(p: Point): void {
    for (const e of this.spec.entities) {
      if (!e.behaviors.some((b) => b.type === 'slingshot')) continue;
      const node = this.childNamed(e.id);
      if (node === undefined) continue;
      const frame = node.frame();
      const inset = { x: frame.x - 30, y: frame.y - 30, width: frame.width + 60, height: frame.height + 60 };
      const contains = p.x >= inset.x && p.x <= inset.x + inset.width && p.y >= inset.y && p.y <= inset.y + inset.height;
      if (contains && node.userData?.['launched'] !== true) {
        this.slingEntityNode = node;
        this.slingAnchor = { ...node.position };
        this.slingActive = true;
        node.userData = node.userData ?? {};
        node.userData['launched'] = true;
        // Become dynamic HERE, not at release. Flipping isDynamic and
        // assigning velocity in the same frame let SpriteKit reset the
        // body's state, so the shot left the sling with almost no speed
        // and simply dropped. Gravity stays off while aiming.
        const body = node.physicsBody;
        if (body !== undefined) {
          body.isDynamic = true;
          body.affectedByGravity = false;
          body.velocity = { dx: 0, dy: 0 };
          body.angularVelocity = 0;
        }
        return;
      }
    }
  }

  private drawAimLine(from: Point, anchor: Point): void {
    this.aimLine?.removeFromParent();
    const guideNode = new SKNode();
    guideNode.zPosition = 400;

    // The stretched elastic, fork -> projectile.
    const band = SKShapeNode.path([{ ...anchor }, { ...from }]);
    band.strokeColor = rgba(0.36, 0.22, 0.12, 0.95);
    band.lineWidth = 5;
    band.lineCap = 'round';
    guideNode.addChild(band);

    // Dotted flight path — the ACTUAL parabola, not a straight ray. The old
    // guide drew a line three times the pull length, which pointed the right
    // way but promised a trajectory the bird never flew.
    const predicted = this.predictedLaunch(from, anchor);
    if (predicted !== undefined) {
      const { v, a } = predicted;
      const step = 0.038;
      for (let i = 1; i <= 26; i += 1) {
        const t = i * step;
        const x = from.x + v.dx * t + 0.5 * a.dx * t * t;
        const y = from.y + v.dy * t + 0.5 * a.dy * t * t;
        if (!(y > -40 && x < this.worldSize.width + 80)) break;
        const dot = SKShapeNode.circleOfRadius(3.5 - i * 0.07);
        dot.position = { x, y };
        dot.fillColor = SKColors.white;
        dot.strokeColor = SKColors.clear;
        dot.lineWidth = 0;
        dot.alpha = Math.max(0.14, 0.85 - i * 0.03);
        guideNode.addChild(dot);
      }
    }

    this.addChild(guideNode);
    this.aimLine = guideNode;
  }

  // MARK: HUD & overlay

  private setupHUD(): void {
    this.hud.text = `${this.score}`;
    this.hud.fontSize = 34;
    this.hud.fontColor = SKColors.white;
    this.hud.position = this.uiPoint(this.size.width / 2, this.size.height - 70);
    this.hud.zPosition = 1000;
    this.hud.horizontalAlignmentMode = 'center';
    this.hud.removeFromParent();
    this.uiParent.addChild(this.hud);
  }

  private setupLivesAndTimerHUD(): void {
    if (this.spec.lives !== undefined) {
      this.refreshLivesHUD();
      this.livesHUD.fontSize = 20;
      this.livesHUD.fontColor = SKColors.white;
      this.livesHUD.horizontalAlignmentMode = 'left';
      this.livesHUD.position = this.uiPoint(16, this.size.height - 44);
      this.livesHUD.zPosition = 1000;
      this.livesHUD.removeFromParent();
      this.uiParent.addChild(this.livesHUD);
    }
    const limit = this.spec.timeLimit;
    if (limit !== undefined) {
      this.timerHUD.text = `⏱ ${Math.trunc(limit)}`;
      this.timerHUD.fontSize = 20;
      this.timerHUD.fontColor = SKColors.white;
      this.timerHUD.horizontalAlignmentMode = 'right';
      this.timerHUD.position = this.uiPoint(this.size.width - 16, this.size.height - 44);
      this.timerHUD.zPosition = 1000;
      this.timerHUD.removeFromParent();
      this.uiParent.addChild(this.timerHUD);
    }
  }

  private refreshLivesHUD(): void {
    this.livesHUD.text = '♥'.repeat(Math.max(0, this.livesLeft))
      + '♡'.repeat(Math.max(0, (this.spec.lives ?? 0) - this.livesLeft));
  }

  private showOverlay(title: string, subtitle: string | undefined): void {
    this.overlay.removeAllChildren();
    this.overlay.removeFromParent();
    this.overlay.zPosition = 2000;
    const dimOrigin = this.uiPoint(0, 0);
    const dim = SKShapeNode.rect({ x: dimOrigin.x, y: dimOrigin.y, width: this.size.width, height: this.size.height });
    dim.fillColor = rgba(0, 0, 0, 0.35); dim.strokeColor = SKColors.clear; dim.lineWidth = 0;
    this.overlay.addChild(dim);
    const t = new SKLabelNode('Menlo-Bold');
    t.text = title; t.fontSize = 40; t.fontColor = SKColors.white;
    t.position = this.uiPoint(this.size.width / 2, this.size.height / 2 + 12);
    t.horizontalAlignmentMode = 'center';
    this.overlay.addChild(t);
    if (subtitle !== undefined) {
      const s = new SKLabelNode('Menlo');
      s.text = subtitle; s.fontSize = 18; s.fontColor = SKColors.white;
      s.position = this.uiPoint(this.size.width / 2, this.size.height / 2 - 28);
      s.horizontalAlignmentMode = 'center';
      this.overlay.addChild(s);
    }
    this.uiParent.addChild(this.overlay);
  }

  private hideOverlay(): void {
    this.overlay.removeAllChildren();
    this.overlay.removeFromParent();
  }

  // MARK: Platform input entry points
  //
  // Swift has `mouseDown/mouseDragged/mouseUp/keyDown/keyUp` on macOS and
  // `touchesBegan/Moved/Ended/Cancelled` on iOS; the browser gets one pointer
  // path that covers both, plus the same key handling (← / → steer, any other
  // key acts as a tap).

  private readonly onPointerDown = (event: PointerEvent): void => {
    const p = this.pointFromEvent(event);
    this.dragging = true;
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    this.handleTapDown(p);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    const p = this.pointFromEvent(event);
    this.handleDragMove(p);
    if (this.phase === 'playing') this.steerTargetX = p.x;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    this.handleTapUp(this.pointFromEvent(event));
  };

  /** A drag that leaves the view (or is interrupted by a system gesture)
   *  delivers CANCELLED, not ENDED. Without this the projectile stayed
   *  frozen in mid-air with gravity off — pulled back and never fired. */
  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.dragging = false;
    if (event.isTrusted) this.handleTapUp(this.pointFromEvent(event));
    else this.releaseStuckSling();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'ArrowLeft': this.steerDirection = -1; return;
      case 'ArrowRight': this.steerDirection = 1; return;
      default: break;
    }
    // Space/any other key triggers tap-style controls.
    if (this.phase === 'waiting') this.startPlaying();
    if (this.phase === 'playing') { this.applyTapImpulses(); this.applyJumps(); }
    if (this.phase === 'over' || this.phase === 'won') this.buildScene();
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') this.steerDirection = 0;
  };

  private pointFromEvent(event: PointerEvent): Point {
    const canvas = this.canvas;
    if (canvas === null) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * canvas.width;
    const py = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * canvas.height;
    return canvasToScene({ x: px, y: py }, cameraTransform(
      { width: canvas.width, height: canvas.height }, this.size, this.gameCamera,
    ));
  }

  private attachInput(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('keydown', this.onKeyDown);
    canvas.addEventListener('keyup', this.onKeyUp);
    canvas.tabIndex = 0;
  }

  private detachInput(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('keydown', this.onKeyDown);
    canvas.removeEventListener('keyup', this.onKeyUp);
  }

  // MARK: Test / host helpers (no Swift counterpart)

  /** The current phase, for tests and the view host. */
  get currentPhase(): 'waiting' | 'playing' | 'over' | 'won' { return this.phase; }
  /** The live score. */
  get currentScore(): number { return this.score; }
  /** Entity nodes currently in the scene (excludes the camera and FX nodes). */
  get entityNodes(): SKNode[] {
    return this.children.filter((child) =>
      child.name !== undefined && !child.name.startsWith('__') && !(child instanceof SKCameraNode));
  }
}

/** Convenience for hosts that only have a spec: `AgentGameScene(spec:size:)`. */
export function makeAgentGameScene(
  spec: GameSceneSpec | undefined,
  options: Omit<AgentGameSceneOptions, 'spec' | 'size'> & { size?: Size } = {},
): AgentGameScene {
  const resolved = spec ?? makeGameSceneSpec();
  const { size, ...rest } = options;
  return new AgentGameScene({
    spec: resolved,
    size: size ?? { width: resolved.width, height: resolved.height },
    ...rest,
  });
}
