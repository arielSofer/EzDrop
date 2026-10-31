// Ported 1:1 from AgenticDesigner/Runtime/AgentGameKit.swift (`enum GameCommand`, :437-473).
//
// Commands the LOGIC layer sends INTO a running scene — the other half of
// the game↔logic bridge. Logic blocks broadcast these via GameSceneRegistry.
//
// Swift enum-with-associated-values → discriminated union keyed by `kind`,
// whose values are the Swift case names verbatim. Associated values keep the
// Swift argument labels; unlabeled single payloads are called `value`.

/** Commands the LOGIC layer sends INTO a running scene. */
export type GameCommand =
  | { kind: 'spawn'; template: string; x: number; y: number }
  /** entity id or category */
  | { kind: 'remove'; target: string }
  | { kind: 'impulse'; entity: string; dx: number; dy: number }
  | { kind: 'move'; entity: string; x: number; y: number }
  | { kind: 'setGravity'; value: number }
  | { kind: 'addScore'; value: number }
  | { kind: 'end'; win: boolean }
  | { kind: 'pause'; value: boolean }
  | { kind: 'setVelocity'; entity: string; vx: number; vy: number }
  | { kind: 'setProperty'; entity: string; property: string; value: string }
  | { kind: 'animate'; entity: string; x: number; y: number; duration: number }
  | { kind: 'addBehavior'; entity: string; behaviorJSON: string }
  | { kind: 'removeBehavior'; entity: string; type: string }
  | { kind: 'setHealth'; entity: string; health: number }
  | { kind: 'shake'; value: number }
  | { kind: 'particles'; particleKind: string; x: number; y: number; burst: number }
  | { kind: 'setTimeScale'; value: number }
  | { kind: 'setSpawnInterval'; value: number }
  | { kind: 'setLives'; value: number }
  | { kind: 'restart' }
  | { kind: 'launch'; entity: string; angle: number; strength: number }
  | { kind: 'loadSlingshot'; entity: string }
  | { kind: 'motor'; entity: string; throttle: number }
  /**
   * Injects a drag from one DESIGN point to another — begin, move, release —
   * so a slingshot pull (and any drag control) can be exercised without a
   * real finger. This is what lets MCP fire the sling; taps alone can't.
   */
  | { kind: 'gesture'; fromX: number; fromY: number; toX: number; toY: number }
  | { kind: 'torque'; entity: string; amount: number }
  | { kind: 'damageEntity'; entity: string; amount: number }
  | { kind: 'setGravityVector'; dx: number; dy: number }
  | { kind: 'setPhysics'; entity: string; property: string; value: string };

export type GameCommandKind = GameCommand['kind'];

/** Every case of the Swift enum, in declaration order. */
export const AllGameCommandKind = [
  'spawn', 'remove', 'impulse', 'move', 'setGravity', 'addScore', 'end', 'pause',
  'setVelocity', 'setProperty', 'animate', 'addBehavior', 'removeBehavior', 'setHealth',
  'shake', 'particles', 'setTimeScale', 'setSpawnInterval', 'setLives', 'restart',
  'launch', 'loadSlingshot', 'motor', 'gesture', 'torque', 'damageEntity',
  'setGravityVector', 'setPhysics',
] as const satisfies readonly GameCommandKind[];

/**
 * Case constructors mirroring the Swift call sites
 * (`GameSceneRegistry.broadcast(.spawn(template:x:y:))` →
 * `GameSceneRegistry.broadcast(GameCommand.spawn(template, x, y))`).
 */
export const GameCommand = {
  spawn(template: string, x: number, y: number): GameCommand {
    return { kind: 'spawn', template, x, y };
  },
  remove(target: string): GameCommand {
    return { kind: 'remove', target };
  },
  impulse(entity: string, dx: number, dy: number): GameCommand {
    return { kind: 'impulse', entity, dx, dy };
  },
  move(entity: string, x: number, y: number): GameCommand {
    return { kind: 'move', entity, x, y };
  },
  setGravity(value: number): GameCommand {
    return { kind: 'setGravity', value };
  },
  addScore(value: number): GameCommand {
    return { kind: 'addScore', value };
  },
  end(win: boolean): GameCommand {
    return { kind: 'end', win };
  },
  pause(value: boolean): GameCommand {
    return { kind: 'pause', value };
  },
  setVelocity(entity: string, vx: number, vy: number): GameCommand {
    return { kind: 'setVelocity', entity, vx, vy };
  },
  setProperty(entity: string, property: string, value: string): GameCommand {
    return { kind: 'setProperty', entity, property, value };
  },
  animate(entity: string, x: number, y: number, duration: number): GameCommand {
    return { kind: 'animate', entity, x, y, duration };
  },
  addBehavior(entity: string, behaviorJSON: string): GameCommand {
    return { kind: 'addBehavior', entity, behaviorJSON };
  },
  removeBehavior(entity: string, type: string): GameCommand {
    return { kind: 'removeBehavior', entity, type };
  },
  setHealth(entity: string, health: number): GameCommand {
    return { kind: 'setHealth', entity, health };
  },
  shake(value: number): GameCommand {
    return { kind: 'shake', value };
  },
  particles(particleKind: string, x: number, y: number, burst: number): GameCommand {
    return { kind: 'particles', particleKind, x, y, burst };
  },
  setTimeScale(value: number): GameCommand {
    return { kind: 'setTimeScale', value };
  },
  setSpawnInterval(value: number): GameCommand {
    return { kind: 'setSpawnInterval', value };
  },
  setLives(value: number): GameCommand {
    return { kind: 'setLives', value };
  },
  restart(): GameCommand {
    return { kind: 'restart' };
  },
  launch(entity: string, angle: number, strength: number): GameCommand {
    return { kind: 'launch', entity, angle, strength };
  },
  loadSlingshot(entity: string): GameCommand {
    return { kind: 'loadSlingshot', entity };
  },
  motor(entity: string, throttle: number): GameCommand {
    return { kind: 'motor', entity, throttle };
  },
  gesture(fromX: number, fromY: number, toX: number, toY: number): GameCommand {
    return { kind: 'gesture', fromX, fromY, toX, toY };
  },
  torque(entity: string, amount: number): GameCommand {
    return { kind: 'torque', entity, amount };
  },
  damageEntity(entity: string, amount: number): GameCommand {
    return { kind: 'damageEntity', entity, amount };
  },
  setGravityVector(dx: number, dy: number): GameCommand {
    return { kind: 'setGravityVector', dx, dy };
  },
  setPhysics(entity: string, property: string, value: string): GameCommand {
    return { kind: 'setPhysics', entity, property, value };
  },
} as const;
