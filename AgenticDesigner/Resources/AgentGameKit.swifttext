//
//  AgentGameKit.swift
//  AgenticDesigner
//
//  The 2D game runtime. A single, cross-platform SpriteKit engine that:
//    • powers the LIVE, playable preview inside the designer (macOS), and
//    • is copied VERBATIM into exported iOS/macOS projects.
//
//  Because SpriteKit ships on both macOS and iOS, one runtime serves both —
//  we avoid the interpret-here / codegen-there split the logic system uses.
//  A game is a `GameSceneSpec` (pure data): a list of entities, each carrying
//  declarative behaviors (gravity, impulseOnTap, spawner, onCollision, …).
//  `AgentGameScene` plays that data at 60fps: physics, collisions, spawning,
//  scoring, win/lose, and restart are all handled here.
//
//  IMPORTANT: this file is bundled as a resource (see GameExportTemplates) and
//  emitted into exported projects unchanged. Keep it dependency-free (only
//  Foundation / SpriteKit / SwiftUI) and cross-platform (#if for input).
//

import Foundation
import SpriteKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit)
import AppKit
#endif

// MARK: - Data model (the "scene JSON")

/// A complete 2D game scene. Coordinates use the design convention:
/// origin top-left, +y downward, matching the rest of the designer. The
/// runtime converts to SpriteKit's bottom-left/+y-up space internally.
struct GameSceneSpec: Codable, Equatable {
    var version: Int = 1
    var width: CGFloat = 390
    var height: CGFloat = 844
    /// Solid background color (hex). Ignored where `backgroundImage` is set.
    var backgroundColor: String = "#8ED0F0"
    /// Optional background image (absolute file path or bundled resource name).
    var backgroundImage: String? = nil
    /// Scene gravity on the y axis. Negative pulls DOWN (SpriteKit convention).
    /// ~ -18 feels like Flappy Bird; -9 is floatier.
    var gravity: CGFloat = -18
    /// Horizontal auto-scroll of the background (points/sec). 0 disables it.
    var scrollSpeed: CGFloat = 0
    var entities: [GameEntity] = []
    /// When true the sim waits for the first tap before physics start (Flappy).
    var startPaused: Bool = true
    /// Draw the built-in score HUD.
    var showScore: Bool = true
    /// Optional score that triggers a "You Win" state.
    var winScore: Int? = nil
    /// Copy shown on the pre-start / restart overlay.
    var tapToStartText: String = "Tap to start"

    // — World & camera (side-scrollers, platformers) —
    /// World size when larger than the visible scene; 0 = same as width/height.
    var worldWidth: CGFloat = 0
    var worldHeight: CGFloat = 0
    /// Entity id the camera tracks (smooth-follow, clamped to world bounds).
    var cameraFollow: String? = nil
    /// Scrolling background layers, back to front; speed 0 = pinned to camera
    /// (sky), 1 = moves with the world. Depth via 0.2 / 0.5 / 0.8 layering.
    var parallax: [ParallaxLayer] = []

    // — Atmosphere & audio —
    /// Ambient weather/particle field: "snow" | "rain" | "bubbles" | "stars" | "leaves".
    var ambient: String? = nil
    /// Looping background music (bundled resource or absolute file path).
    var music: String? = nil

    // — Game rules —
    /// Player lives; heart HUD. Collisions with action "loseLife" decrement,
    /// with ~1s invulnerability blink; 0 → game over.
    var lives: Int? = nil
    /// Countdown in seconds; at 0 `timeUpAction` runs ("gameOver" or "win" —
    /// "win" makes it a survive-the-clock mode).
    var timeLimit: CGFloat? = nil
    var timeUpAction: String = "gameOver"
    /// Every 10s all spawner intervals multiply by this (0.9 = 10% faster) —
    /// difficulty ramps without any extra wiring. 1.0/absent = constant.
    var difficultyRamp: CGFloat? = nil

    // — Depth & atmosphere (the anti-flat pack) —
    /// Vertical background gradient, top→bottom (overrides backgroundColor).
    var backgroundGradient: [String] = []
    /// Dynamic 2D lighting: sprites get generated normal maps and real
    /// shading — cutout art stops looking like flat stickers.
    var lighting: Bool = false
    /// Entity id the light follows (usually the player); nil = scene center.
    var lightFollow: String? = nil
    /// Light color (hex) when lighting is on.
    var lightColor: String = "#FFF4D6"
    /// Radial darkening at the edges — instant cinematic framing.
    var vignette: Bool = false

    init() {}

    private enum CodingKeys: String, CodingKey {
        case version, width, height, backgroundColor, backgroundImage, gravity,
             scrollSpeed, entities, startPaused, showScore, winScore, tapToStartText,
             worldWidth, worldHeight, cameraFollow, parallax, ambient, music,
             lives, timeLimit, timeUpAction, difficultyRamp,
             backgroundGradient, lighting, lightFollow, lightColor, vignette
    }

    // Tolerant decoding: agents author specs by hand, so every missing key
    // falls back to its default instead of failing the whole spec.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        version = try c.decodeIfPresent(Int.self, forKey: .version) ?? 1
        width = try c.decodeIfPresent(CGFloat.self, forKey: .width) ?? 390
        height = try c.decodeIfPresent(CGFloat.self, forKey: .height) ?? 844
        backgroundColor = try c.decodeIfPresent(String.self, forKey: .backgroundColor) ?? "#8ED0F0"
        backgroundImage = try c.decodeIfPresent(String.self, forKey: .backgroundImage)
        gravity = try c.decodeIfPresent(CGFloat.self, forKey: .gravity) ?? -18
        scrollSpeed = try c.decodeIfPresent(CGFloat.self, forKey: .scrollSpeed) ?? 0
        entities = try c.decodeIfPresent([GameEntity].self, forKey: .entities) ?? []
        startPaused = try c.decodeIfPresent(Bool.self, forKey: .startPaused) ?? true
        showScore = try c.decodeIfPresent(Bool.self, forKey: .showScore) ?? true
        winScore = try c.decodeIfPresent(Int.self, forKey: .winScore)
        tapToStartText = try c.decodeIfPresent(String.self, forKey: .tapToStartText) ?? "Tap to start"
        worldWidth = try c.decodeIfPresent(CGFloat.self, forKey: .worldWidth) ?? 0
        worldHeight = try c.decodeIfPresent(CGFloat.self, forKey: .worldHeight) ?? 0
        cameraFollow = try c.decodeIfPresent(String.self, forKey: .cameraFollow)
        parallax = try c.decodeIfPresent([ParallaxLayer].self, forKey: .parallax) ?? []
        ambient = try c.decodeIfPresent(String.self, forKey: .ambient)
        music = try c.decodeIfPresent(String.self, forKey: .music)
        lives = try c.decodeIfPresent(Int.self, forKey: .lives)
        timeLimit = try c.decodeIfPresent(CGFloat.self, forKey: .timeLimit)
        timeUpAction = try c.decodeIfPresent(String.self, forKey: .timeUpAction) ?? "gameOver"
        difficultyRamp = try c.decodeIfPresent(CGFloat.self, forKey: .difficultyRamp)
        backgroundGradient = try c.decodeIfPresent([String].self, forKey: .backgroundGradient) ?? []
        lighting = try c.decodeIfPresent(Bool.self, forKey: .lighting) ?? false
        lightFollow = try c.decodeIfPresent(String.self, forKey: .lightFollow)
        lightColor = try c.decodeIfPresent(String.self, forKey: .lightColor) ?? "#FFF4D6"
        vignette = try c.decodeIfPresent(Bool.self, forKey: .vignette) ?? false
    }
}

/// One scrolling background layer. `speed` is parallax depth: 0 = glued to
/// the camera (far sky), 1 = fixed in the world (foreground).
struct ParallaxLayer: Codable, Equatable {
    var sprite: String
    var speed: CGFloat = 0.4
    /// Layer height in points (anchored to the scene bottom); nil = full height.
    var height: CGFloat? = nil
    /// Vertical offset from the bottom, in points.
    var y: CGFloat = 0

    init(sprite: String, speed: CGFloat = 0.4, height: CGFloat? = nil, y: CGFloat = 0) {
        self.sprite = sprite; self.speed = speed; self.height = height; self.y = y
    }

    private enum CodingKeys: String, CodingKey { case sprite, speed, height, y }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sprite = try c.decodeIfPresent(String.self, forKey: .sprite) ?? ""
        speed = try c.decodeIfPresent(CGFloat.self, forKey: .speed) ?? 0.4
        height = try c.decodeIfPresent(CGFloat.self, forKey: .height)
        y = try c.decodeIfPresent(CGFloat.self, forKey: .y) ?? 0
    }
}

enum GameBodyType: String, Codable {
    case none        // no physics body — pure visual, moved only by behaviors
    case dynamic     // full physics: gravity, forces, collisions
    case staticBody  // immovable collider (ground, walls)
    case kinematic   // collides & reports contacts, but ignores gravity/forces

    // Agents write loose synonyms ("static", "fixed", "rigid") — map them
    // instead of failing the whole spec on an enum mismatch.
    init(from decoder: Decoder) throws {
        let raw = (try? decoder.singleValueContainer().decode(String.self))?
            .lowercased().replacingOccurrences(of: "_", with: "") ?? "none"
        switch raw {
        case "dynamic", "rigid", "physics": self = .dynamic
        case "static", "staticbody", "fixed", "immovable": self = .staticBody
        case "kinematic", "kinematicbody", "moving": self = .kinematic
        default: self = .none
        }
    }
}

/// One placed object. A template (isTemplate) is NOT placed at start; a
/// `spawner` behavior clones it at runtime.
struct GameEntity: Codable, Equatable, Identifiable {
    var id: String
    var name: String = ""
    /// Transparent PNG path/resource. When nil, a solid `color` rectangle is drawn.
    var sprite: String? = nil
    /// Sprite ANIMATION: extra frame paths cycled at `frameRate` fps (wing
    /// flaps, walk cycles). `sprite` is frame 0 when both are set.
    var frames: [String]? = nil
    var frameRate: CGFloat? = nil
    var color: String? = nil
    var x: CGFloat
    var y: CGFloat
    var width: CGFloat
    var height: CGFloat
    var zIndex: CGFloat = 0
    var rotation: CGFloat = 0        // degrees

    var body: GameBodyType = .none
    /// Circular physics body instead of a rectangle (balls, birds).
    var circleBody: Bool = false
    var affectedByGravity: Bool = true
    var restitution: CGFloat = 0.2   // bounciness 0…1
    var mass: CGFloat? = nil
    var friction: CGFloat = 0.2
    var linearDamping: CGFloat = 0.1
    var allowsRotation: Bool = false

    /// Collision category name; entities sharing a name share a physics category.
    var category: String? = nil
    /// Categories this body physically bounces off.
    var collidesWith: [String] = []
    /// Categories this body reports overlap with (drives `onCollision`).
    var contacts: [String] = []

    var isTemplate: Bool = false
    /// Destructible health; a `destructible` behavior removes the node at 0.
    var health: Int? = nil
    /// Soft elliptical ground shadow under the entity — the cheapest and
    /// strongest depth cue there is.
    var dropShadow: Bool = false
    /// Additive glow halo behind the entity (hero highlight, pickups).
    var glow: Bool = false
    /// A polyline in DESIGN coords ([[x, y], ...]) that becomes solid ground:
    /// rendered as a glowing stroke and given an edge-chain physics body. This
    /// is how a level gets hills instead of rectangles.
    var points: [[CGFloat]]? = nil
    /// Stroke width for a `points` terrain.
    var strokeWidth: CGFloat? = nil
    /// Optional tint for the glow halo, independent of the sprite's own color.
    var glowColor: String? = nil

    var behaviors: [GameBehavior] = []

    init(id: String, name: String = "", sprite: String? = nil, color: String? = nil,
         x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, zIndex: CGFloat = 0,
         rotation: CGFloat = 0, body: GameBodyType = .none, circleBody: Bool = false,
         affectedByGravity: Bool = true, restitution: CGFloat = 0.2, mass: CGFloat? = nil,
         friction: CGFloat = 0.2, linearDamping: CGFloat = 0.1, allowsRotation: Bool = false,
         category: String? = nil, collidesWith: [String] = [], contacts: [String] = [],
         isTemplate: Bool = false, health: Int? = nil, behaviors: [GameBehavior] = []) {
        self.id = id; self.name = name; self.sprite = sprite; self.color = color
        self.x = x; self.y = y; self.width = width; self.height = height
        self.zIndex = zIndex; self.rotation = rotation; self.body = body
        self.circleBody = circleBody; self.affectedByGravity = affectedByGravity
        self.restitution = restitution; self.mass = mass; self.friction = friction
        self.linearDamping = linearDamping; self.allowsRotation = allowsRotation
        self.category = category; self.collidesWith = collidesWith; self.contacts = contacts
        self.isTemplate = isTemplate; self.health = health; self.behaviors = behaviors
    }

    private enum CodingKeys: String, CodingKey {
        case id, name, sprite, frames, frameRate, color, x, y, width, height, zIndex, rotation,
             body, circleBody, affectedByGravity, restitution, mass, friction,
             linearDamping, allowsRotation, category, collidesWith, contacts,
             isTemplate, health, dropShadow, glow, glowColor, points, strokeWidth, behaviors
    }

    // Tolerant decoding: hand-authored entity JSON only needs x/y/width/height
    // (and usually color or sprite) — everything else defaults sensibly. Even a
    // missing id gets one derived from name/category so one sloppy entity
    // can't sink the whole spec.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
            ?? c.decodeIfPresent(String.self, forKey: .name).flatMap { $0.isEmpty ? nil : $0 }
            ?? c.decodeIfPresent(String.self, forKey: .category).flatMap { $0.isEmpty ? nil : $0 }
            ?? "entity-\(UUID().uuidString.prefix(8))"
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        sprite = try c.decodeIfPresent(String.self, forKey: .sprite)
        frames = try c.decodeIfPresent([String].self, forKey: .frames)
        frameRate = try c.decodeIfPresent(CGFloat.self, forKey: .frameRate)
        color = try c.decodeIfPresent(String.self, forKey: .color)
        x = try c.decodeIfPresent(CGFloat.self, forKey: .x) ?? 0
        y = try c.decodeIfPresent(CGFloat.self, forKey: .y) ?? 0
        width = try c.decodeIfPresent(CGFloat.self, forKey: .width) ?? 40
        height = try c.decodeIfPresent(CGFloat.self, forKey: .height) ?? 40
        zIndex = try c.decodeIfPresent(CGFloat.self, forKey: .zIndex) ?? 0
        rotation = try c.decodeIfPresent(CGFloat.self, forKey: .rotation) ?? 0
        body = try c.decodeIfPresent(GameBodyType.self, forKey: .body) ?? .none
        circleBody = try c.decodeIfPresent(Bool.self, forKey: .circleBody) ?? false
        affectedByGravity = try c.decodeIfPresent(Bool.self, forKey: .affectedByGravity) ?? true
        restitution = try c.decodeIfPresent(CGFloat.self, forKey: .restitution) ?? 0.2
        mass = try c.decodeIfPresent(CGFloat.self, forKey: .mass)
        friction = try c.decodeIfPresent(CGFloat.self, forKey: .friction) ?? 0.2
        linearDamping = try c.decodeIfPresent(CGFloat.self, forKey: .linearDamping) ?? 0.1
        allowsRotation = try c.decodeIfPresent(Bool.self, forKey: .allowsRotation) ?? false
        category = try c.decodeIfPresent(String.self, forKey: .category)
        collidesWith = try c.decodeIfPresent([String].self, forKey: .collidesWith) ?? []
        contacts = try c.decodeIfPresent([String].self, forKey: .contacts) ?? []
        isTemplate = try c.decodeIfPresent(Bool.self, forKey: .isTemplate) ?? false
        health = try c.decodeIfPresent(Int.self, forKey: .health)
        dropShadow = try c.decodeIfPresent(Bool.self, forKey: .dropShadow) ?? false
        glow = try c.decodeIfPresent(Bool.self, forKey: .glow) ?? false
        glowColor = try c.decodeIfPresent(String.self, forKey: .glowColor)
        points = try c.decodeIfPresent([[CGFloat]].self, forKey: .points)
        strokeWidth = try c.decodeIfPresent(CGFloat.self, forKey: .strokeWidth)
        behaviors = try c.decodeIfPresent([GameBehavior].self, forKey: .behaviors) ?? []
    }
}

/// A declarative behavior. `type` selects the rule; the remaining fields are a
/// flat union of every rule's parameters (all optional) — no nested/any coding,
/// so the JSON stays trivially LLM-writable, e.g.
/// `{"type":"impulseOnTap","strength":9}`.
struct GameBehavior: Codable, Equatable {
    var type: String

    // impulseOnTap / launch
    var strength: CGFloat? = nil
    var key: String? = nil            // optional key (macOS) also triggers it

    // moveConstant / spawner velocity
    var velocityX: CGFloat? = nil
    var velocityY: CGFloat? = nil

    // spawner
    var interval: CGFloat? = nil      // seconds between spawns
    var template: String? = nil       // entity id to clone
    var spawnYMin: CGFloat? = nil
    var spawnYMax: CGFloat? = nil
    var gapSize: CGFloat? = nil       // spawns a top+bottom pair with this opening
    var firstDelay: CGFloat? = nil
    /// Score 1 point when the player passes a spawned obstacle. Defaults ON
    /// for gap pairs, OFF for single spawns — set explicitly to override.
    var scoreOnPass: Bool? = nil
    /// Spawn edge: "left" (default — obstacles enter from the right moving
    /// left) or "down" (enter from the top falling down; velocityY = speed).
    var direction: String? = nil

    // destroyOffscreen
    var margin: CGFloat? = nil

    // onCollision
    var target: String? = nil         // category to react to (also: followEntity target id)
    var action: String? = nil         // gameOver | score | win | removeSelf | removeOther | bounce | damage | loseLife | explode | runFlow
    var points: Int? = nil
    var flowId: String? = nil         // for runFlow (host-handled)
    var soundName: String? = nil
    var shake: Bool? = nil            // camera shake on this collision

    // slingshot
    var maxPower: CGFloat? = nil
    var maxDrag: CGFloat? = nil

    // slingshot auto-reload: re-park the next shot once the last one settles.
    // OPT-IN — projects that manage reloads/ammo with their own logic (a shot
    // budget, timed reloads) must leave this off or the two systems fight.
    var autoReload: Bool? = nil

    // bike: a chassis carried by two motorised wheels on pin joints
    var wheelRadius: CGFloat? = nil
    var wheelBase: CGFloat? = nil     // horizontal distance between the wheels
    var wheelDrop: CGFloat? = nil     // how far below the chassis centre they sit
    var motorSpeed: CGFloat? = nil    // radians/sec at full throttle
    var motorForce: CGFloat? = nil

    // destructible / trail / explode
    var particles: String? = nil      // "debris" | "spark" | "smoke" | "fire" | "confetti"

    init(type: String) { self.type = type }

    // Convenience builders keep template code readable.
    static func gravityBody() -> GameBehavior { GameBehavior(type: "gravityBody") }
    static func impulseOnTap(_ strength: CGFloat, key: String? = nil) -> GameBehavior {
        var b = GameBehavior(type: "impulseOnTap"); b.strength = strength; b.key = key; return b
    }
    static func moveConstant(vx: CGFloat, vy: CGFloat = 0) -> GameBehavior {
        var b = GameBehavior(type: "moveConstant"); b.velocityX = vx; b.velocityY = vy; return b
    }
    static func destroyOffscreen(margin: CGFloat = 120) -> GameBehavior {
        var b = GameBehavior(type: "destroyOffscreen"); b.margin = margin; return b
    }
    static func spawner(template: String, interval: CGFloat, vx: CGFloat,
                        gapSize: CGFloat? = nil, yMin: CGFloat? = nil, yMax: CGFloat? = nil,
                        firstDelay: CGFloat? = nil) -> GameBehavior {
        var b = GameBehavior(type: "spawner")
        b.template = template; b.interval = interval; b.velocityX = vx
        b.gapSize = gapSize; b.spawnYMin = yMin; b.spawnYMax = yMax; b.firstDelay = firstDelay
        return b
    }
    static func onCollision(target: String, action: String, points: Int? = nil,
                            sound: String? = nil, particles: String? = nil) -> GameBehavior {
        var b = GameBehavior(type: "onCollision")
        b.target = target; b.action = action; b.points = points; b.soundName = sound; b.particles = particles
        return b
    }
    static func slingshot(maxPower: CGFloat = 1800, maxDrag: CGFloat = 120) -> GameBehavior {
        var b = GameBehavior(type: "slingshot"); b.maxPower = maxPower; b.maxDrag = maxDrag; return b
    }
    static func destructible(particles: String = "debris") -> GameBehavior {
        var b = GameBehavior(type: "destructible"); b.particles = particles; return b
    }
    static func wrapVertical() -> GameBehavior { GameBehavior(type: "wrapVertical") }
}

/// Events the scene emits to its host (score/lose/win/start). Optional — the
/// scene is fully self-contained (own HUD + overlays) without a listener.
enum GameEvent: Equatable {
    case started
    case scoreChanged(Int)
    case gameOver(score: Int)
    case won(score: Int)
    case runFlow(String)
    /// Two categories touched — lets the LOGIC EDITOR react to gameplay
    /// ("On Game Collision" event block) without editing the game spec.
    case collision(String, String, String, String)
    /// Player tapped the scene (design coords, top-left origin).
    case tap(CGFloat, CGFloat)
    /// Player drag — phase is "start" | "move" | "end" (design coords).
    case drag(String, CGFloat, CGFloat)
    /// An entity was destroyed (removeOther / explode / health reached 0).
    case entityDestroyed(String)
    /// The player lost a life; payload = lives remaining.
    case lifeLost(Int)
    /// An entity was spawned (spawner / logic); payload = category or id.
    case spawned(String)
    /// Two categories touched with a physical force (collisionImpulse), plus
    /// the two entity IDS — so logic can scale damage by how HARD something
    /// hit AND apply it to the exact node that was hit.
    case impact(String, String, CGFloat, String, String)
    /// A slingshot entity was released (id); the shot is in the air.
    case launched(String)
}

/// Commands the LOGIC layer sends INTO a running scene — the other half of
/// the game↔logic bridge. Logic blocks broadcast these via GameSceneRegistry.
enum GameCommand {
    case spawn(template: String, x: CGFloat, y: CGFloat)
    case remove(target: String)                    // entity id or category
    case impulse(entity: String, dx: CGFloat, dy: CGFloat)
    case move(entity: String, x: CGFloat, y: CGFloat)
    case setGravity(CGFloat)
    case addScore(Int)
    case end(win: Bool)
    case pause(Bool)
    case setVelocity(entity: String, vx: CGFloat, vy: CGFloat)
    case setProperty(entity: String, property: String, value: String)
    case animate(entity: String, x: CGFloat, y: CGFloat, duration: CGFloat)
    case addBehavior(entity: String, behaviorJSON: String)
    case removeBehavior(entity: String, type: String)
    case setHealth(entity: String, health: Int)
    case shake(CGFloat)
    case particles(kind: String, x: CGFloat, y: CGFloat, burst: Int)
    case setTimeScale(CGFloat)
    case setSpawnInterval(CGFloat)
    case setLives(Int)
    case restart
    case launch(entity: String, angle: CGFloat, strength: CGFloat)
    case loadSlingshot(entity: String)
    case motor(entity: String, throttle: CGFloat)
    /// Injects a drag from one DESIGN point to another — begin, move, release —
    /// so a slingshot pull (and any drag control) can be exercised without a
    /// real finger. This is what lets MCP fire the sling; taps alone can't.
    case gesture(fromX: CGFloat, fromY: CGFloat, toX: CGFloat, toY: CGFloat)
    case torque(entity: String, amount: CGFloat)
    case damageEntity(entity: String, amount: Int)
    case setGravityVector(dx: CGFloat, dy: CGFloat)
    case setPhysics(entity: String, property: String, value: String)
}

/// Live scenes register here so logic blocks can reach them — the same
/// mechanism serves the designer preview and exported apps.
@MainActor
enum GameSceneRegistry {
    private final class WeakScene { weak var scene: AgentGameScene?; init(_ s: AgentGameScene) { scene = s } }
    private static var scenes: [WeakScene] = []

    static func register(_ scene: AgentGameScene) {
        scenes.removeAll { $0.scene == nil || $0.scene === scene }
        scenes.append(WeakScene(scene))
    }

    static var sceneCount: Int {
        scenes.removeAll { $0.scene == nil }
        return scenes.count
    }

    static func broadcast(_ command: GameCommand) {
        scenes.removeAll { $0.scene == nil }
        for holder in scenes { holder.scene?.handleCommand(command) }
    }

    /// Synchronous state read for logic queries (first live scene answers):
    /// what = positionX|positionY|health|count|score|lives|timeLeft.
    static func query(_ what: String, _ target: String) -> String {
        scenes.removeAll { $0.scene == nil }
        guard let scene = scenes.first?.scene else { return "" }
        return scene.queryState(what, target)
    }
}

// MARK: - Color helper (SKColor is NSColor on macOS, UIColor on iOS)

private func skColor(_ hex: String?, fallback: SKColor = .gray) -> SKColor {
    guard var s = hex?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return fallback }
    if s.hasPrefix("#") { s.removeFirst() }
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard let v = UInt64(s, radix: 16) else { return fallback }
    let hasAlpha = s.count == 8
    let r, g, b, a: CGFloat
    if hasAlpha {
        r = CGFloat((v >> 24) & 0xFF) / 255; g = CGFloat((v >> 16) & 0xFF) / 255
        b = CGFloat((v >> 8) & 0xFF) / 255;  a = CGFloat(v & 0xFF) / 255
    } else {
        r = CGFloat((v >> 16) & 0xFF) / 255; g = CGFloat((v >> 8) & 0xFF) / 255
        b = CGFloat(v & 0xFF) / 255;         a = 1
    }
    return SKColor(red: r, green: g, blue: b, alpha: a)
}

/// Loads a sprite texture from (1) an absolute file path — how the designer
/// preview references generated sprites, or (2) a bundled resource — how
/// exported apps reference the same art copied into their Resources.
private func loadTexture(_ ref: String?) -> SKTexture? {
    guard let ref, !ref.isEmpty else { return nil }

    // 1. Direct file path (designer preview / absolute GeneratedAssets path).
    if FileManager.default.fileExists(atPath: ref) {
        #if canImport(AppKit)
        if let img = NSImage(contentsOfFile: ref) { return SKTexture(image: img) }
        #elseif canImport(UIKit)
        if let img = UIImage(contentsOfFile: ref) { return SKTexture(image: img) }
        #endif
    }

    let name = (ref as NSString).lastPathComponent
    let base = (name as NSString).deletingPathExtension
    let ext = (name as NSString).pathExtension.isEmpty ? "png" : (name as NSString).pathExtension

    // 2. Bundled resource by name (exported apps: sprite copied into Resources).
    if let url = Bundle.main.url(forResource: base, withExtension: ext)
        ?? Bundle.main.url(forResource: base, withExtension: nil) {
        #if canImport(AppKit)
        if let img = NSImage(contentsOfFile: url.path) { return SKTexture(image: img) }
        #elseif canImport(UIKit)
        if let img = UIImage(contentsOfFile: url.path) { return SKTexture(image: img) }
        #endif
    }

    // 3. Named image (asset catalog).
    #if canImport(AppKit)
    if let img = NSImage(named: base) { return SKTexture(image: img) }
    #elseif canImport(UIKit)
    if let img = UIImage(named: base) { return SKTexture(image: img) }
    #endif
    let tex = SKTexture(imageNamed: base)
    return tex.size().width > 1 ? tex : nil
}

/// Loads a bundled GameSceneSpec JSON by resource name. Exported screens call
/// `AgentGameView(spec: GameSceneLoader.load("GameScene_…"))`.
enum GameSceneLoader {
    static func load(_ resourceName: String) -> GameSceneSpec {
        if let url = Bundle.main.url(forResource: resourceName, withExtension: "json"),
           let data = try? Data(contentsOf: url),
           let spec = try? JSONDecoder().decode(GameSceneSpec.self, from: data) {
            return spec
        }
        return GameSceneSpec()
    }
}

// MARK: - The runtime scene

final class AgentGameScene: SKScene, SKPhysicsContactDelegate {

    private var spec: GameSceneSpec
    var onEvent: ((GameEvent) -> Void)?

    private var categoryBits: [String: UInt32] = [:]
    private var nextBit: UInt32 = 1
    private var score = 0
    private enum Phase { case waiting, playing, over, won }
    private var phase: Phase = .waiting
    private var lastUpdate: TimeInterval = 0

    // Slingshot drag state.
    private weak var slingEntityNode: SKNode?
    private var slingAnchor: CGPoint = .zero
    private var bikeWheels: [String: [SKNode]] = [:]
    private var bikeMotorSpeed: [String: CGFloat] = [:]
    private var bikeThrottle: [String: CGFloat] = [:]
    private var bikeMotorForce: [String: CGFloat] = [:]
    private var bikeWheelRadius: [String: CGFloat] = [:]

    private func wheelRadiusFor(_ id: String) -> CGFloat { bikeWheelRadius[id] ?? 16 }
    private var spawnCounter = 0
    private var shakeUntil: CFTimeInterval = 0
    private var slingActive = false
    /// Where each slingshot entity sits when loaded — so the NEXT bird can be
    /// placed on the sling by a logic block (gameLoadSlingshot).
    private var slingHome: [String: CGPoint] = [:]
    /// Frames a launched slingshot shot has been (nearly) still — once it
    /// settles or leaves the world, the next shot auto-loads.
    private var slingSettle: [String: Int] = [:]
    private var slingMaxPower: CGFloat = 900
    private var slingMaxDrag: CGFloat = 140
    private var aimLine: SKNode?

    private let hud = SKLabelNode(fontNamed: "Menlo-Bold")
    private let overlay = SKNode()

    // — Engine v2 state —
    private var gameCamera: SKCameraNode?
    private var worldSize: CGSize { CGSize(width: max(spec.worldWidth, spec.width),
                                           height: max(spec.worldHeight, spec.height)) }
    // Update-driven spawners (so difficultyRamp can retune intervals live).
    private struct SpawnerState { var behavior: GameBehavior; var interval: CGFloat; var countdown: CGFloat }
    private var spawnerStates: [SpawnerState] = []
    private var elapsedPlaytime: TimeInterval = 0
    private var lastRampAt: TimeInterval = 0
    private var livesLeft = 0
    private var invulnerableUntil: TimeInterval = 0
    private var timeRemaining: CGFloat = 0
    private let livesHUD = SKLabelNode(fontNamed: "Menlo-Bold")
    private let timerHUD = SKLabelNode(fontNamed: "Menlo-Bold")
    private var parallaxNodes: [(node: SKNode, speed: CGFloat, tileWidth: CGFloat)] = []
    // controlHorizontal input: -1 / 0 / +1 (keys) or a drag-target x.
    private var steerDirection: CGFloat = 0
    private var steerTargetX: CGFloat?
    private var lastShotAt: [String: TimeInterval] = [:]

    init(spec: GameSceneSpec, size: CGSize) {
        self.spec = spec
        super.init(size: size)
        // Scene is authored at spec.width×height; SpriteView scales it to fill
        // the hosting node while preserving the game's coordinate space.
        scaleMode = .aspectFill
        anchorPoint = .zero
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unavailable") }

    // MARK: Lifecycle

    override func didMove(to view: SKView) {
        physicsWorld.contactDelegate = self
        GameSceneRegistry.register(self)
        buildScene()
    }

    /// Logic-block commands (see GameCommand) — the logic editor's remote
    /// control over the running scene.
    func handleCommand(_ command: GameCommand) {
        switch command {
        case .spawn(let templateId, let x, let y):
            guard let template = spec.entities.first(where: { $0.id == templateId }) else { return }
            var e = template
            e.isTemplate = false
            let node = makeNode(from: e)
            node.name = nextSpawnName(template.id)
            node.position = CGPoint(x: x + e.width / 2, y: worldSize.height - y - e.height / 2)
            addChild(node)
        case .remove(let target):
            for child in children where child.name == target
                || templateId(ofNodeNamed: child.name ?? "") == target {
                child.removeFromParent()
            }
            for e in spec.entities where e.category == target {
                childNode(named: e.id)?.removeFromParent()
            }
        case .impulse(let entityId, let dx, let dy):
            // A body resting on the ground is ASLEEP; SpriteKit ignores forces
            // and velocity writes until it is woken, so a second shot at a
            // settled projectile silently did nothing.
            if let body = childNode(named: entityId)?.physicsBody {
                body.isResting = false
                body.applyImpulse(CGVector(dx: dx, dy: -dy))
            }
        case .move(let entityId, let x, let y):
            guard let node = childNode(named: entityId) else { return }
            let e = spec.entities.first { $0.id == entityId }
            node.position = CGPoint(x: x + (e?.width ?? 0) / 2, y: worldSize.height - y - (e?.height ?? 0) / 2)
        case .setGravity(let g):
            spec.gravity = g
            if phase == .playing { physicsWorld.gravity = CGVector(dx: 0, dy: g) }
        case .addScore(let points):
            addScore(points)
        case .end(let win):
            win ? winGame() : triggerGameOver()
        case .pause(let paused):
            isPaused = paused
        case .setVelocity(let entityId, let vx, let vy):
            // Design coords: positive vy = down.
            if let body = childNode(named: entityId)?.physicsBody {
                body.isResting = false
                body.velocity = CGVector(dx: vx, dy: -vy)
            }
        case .setProperty(let entityId, let property, let value):
            applyProperty(property, value: value, to: entityId)
        case .animate(let entityId, let x, let y, let duration):
            guard let node = childNode(named: entityId) else { return }
            let e = spec.entities.first { $0.id == entityId }
            let target = CGPoint(x: x + (e?.width ?? 0) / 2, y: worldSize.height - y - (e?.height ?? 0) / 2)
            let move = SKAction.move(to: target, duration: TimeInterval(max(duration, 0.01)))
            move.timingMode = .easeInEaseOut
            node.run(move, withKey: "logicAnimate")
        case .addBehavior(let entityId, let behaviorJSON):
            guard let data = behaviorJSON.data(using: .utf8),
                  let behavior = try? JSONDecoder().decode(GameBehavior.self, from: data),
                  let index = spec.entities.firstIndex(where: { $0.id == entityId }) else { return }
            spec.entities[index].behaviors.append(behavior)
            if let node = childNode(named: entityId) {
                startBehaviors(for: {
                    var e = spec.entities[index]; e.behaviors = [behavior]; return e
                }(), on: node)
            }
        case .removeBehavior(let entityId, let type):
            guard let index = spec.entities.firstIndex(where: { $0.id == entityId }) else { return }
            spec.entities[index].behaviors.removeAll { $0.type == type }
            childNode(named: entityId)?.removeAction(forKey: type)
            if type == "spawner" { spawnerStates.removeAll() }
            if type == "autoFire" { childNode(named: entityId)?.removeAction(forKey: "autoFire") }
        case .setHealth(let entityId, let health):
            guard let node = childNode(named: entityId) else { return }
            node.userData = (node.userData ?? NSMutableDictionary())
            node.userData?["health"] = health
        case .shake(let intensity):
            shakeScreen(intensity: intensity)
        case .particles(let kind, let x, let y, let burst):
            emitParticles(kind, at: CGPoint(x: x, y: worldSize.height - y), burst: burst)
        case .setTimeScale(let scale):
            let clamped = max(0.1, min(scale, 3))
            physicsWorld.speed = clamped
            speed = clamped
        case .setSpawnInterval(let interval):
            for i in spawnerStates.indices {
                spawnerStates[i].interval = max(0.15, interval)
                spawnerStates[i].countdown = min(spawnerStates[i].countdown, interval)
            }
        case .setLives(let n):
            livesLeft = max(0, n)
            refreshLivesHUD()
        case .restart:
            buildScene()
        case .gesture(let fromX, let fromY, let toX, let toY):
            // Design coords → scene points (designPoint is its own inverse).
            let start = CGPoint(x: fromX, y: worldSize.height - fromY)
            let end = CGPoint(x: toX, y: worldSize.height - toY)
            handleTapDown(at: start)
            // A few interpolated moves so drag-driven behaviours (sling pull,
            // aim line, steering) see a real path, not a teleport.
            for i in 1...6 {
                let t = CGFloat(i) / 6
                handleDragMove(at: CGPoint(x: start.x + (end.x - start.x) * t,
                                           y: start.y + (end.y - start.y) * t))
            }
            handleTapUp(at: end)
        case .launch(let entityId, let angle, let strength):
            // Design-friendly polar launch: 0° = right, 90° = up, 180° = left.
            // Sets VELOCITY so `strength` reads as launch speed in points/sec —
            // an impulse would be divided by mass, making heavy projectiles
            // barely move for the same number.
            let rad = angle * .pi / 180
            guard let body = childNode(named: entityId)?.physicsBody else { return }
            body.isDynamic = true
            body.isResting = false
            body.velocity = CGVector(dx: cos(rad) * strength, dy: sin(rad) * strength)
        case .setGravityVector(let dx, let dy):
            spec.gravity = dy
            if phase == .playing { physicsWorld.gravity = CGVector(dx: dx, dy: dy) }
        case .loadSlingshot(let entityId):
            loadSlingshot(entityId)
        case .motor(let entityId, let throttle):
            bikeThrottle[entityId] = max(-1, min(throttle, 1))
        case .torque(let entityId, let amount):
            // Mid-air lean: spin the chassis so the player can land level or
            // keep a flip going.
            if let body = childNode(named: entityId)?.physicsBody {
                body.isResting = false
                body.applyAngularImpulse(amount * 0.02)
            }
        case .damageEntity(let entityId, let amount):
            guard let node = childNode(named: entityId) else { return }
            damage(node, amount: amount, particles: "debris")
        case .setPhysics(let entityId, let property, let value):
            guard let body = childNode(named: entityId)?.physicsBody else { return }
            let on = value == "true" || value == "1" || value == "yes"
            switch property.lowercased() {
            case "bounciness": if let v = Double(value) { body.restitution = CGFloat(max(0, min(v, 1))) }
            case "friction":   if let v = Double(value) { body.friction = CGFloat(max(0, v)) }
            case "damping":    if let v = Double(value) { body.linearDamping = CGFloat(max(0, v)) }
            case "mass":       if let v = Double(value), v > 0 { body.mass = CGFloat(v) }
            case "rotation":   body.allowsRotation = on
            case "gravity":    body.affectedByGravity = on
            case "bodytype":
                switch value.lowercased() {
                case "static", "staticbody": body.isDynamic = false; body.affectedByGravity = false
                case "kinematic":            body.isDynamic = false; body.affectedByGravity = false
                default:                     body.isDynamic = true
                }
            default: break
            }
        }
    }

    private func applyProperty(_ property: String, value: String, to entityId: String) {
        guard let node = childNode(named: entityId) as? SKSpriteNode else { return }
        switch property.lowercased() {
        case "sprite":
            if let tex = loadTexture(value) {
                node.texture = tex
                if spec.lighting {
                    node.normalTexture = tex.generatingNormalMap(withSmoothness: 0.4, contrast: 1.2)
                }
            }
        case "color":
            node.color = skColor(value)
            node.colorBlendFactor = node.texture == nil ? 1 : 0.6
        case "width":
            if let w = Double(value) { node.size.width = CGFloat(w) }
        case "height":
            if let h = Double(value) { node.size.height = CGFloat(h) }
        case "rotation":
            if let deg = Double(value) { node.zRotation = CGFloat(deg) * .pi / 180 }
        case "opacity":
            if let a = Double(value) { node.alpha = CGFloat(a) }
        default:
            break
        }
    }

    /// Synchronous reads for the logic layer's Game Query block.
    func queryState(_ what: String, _ target: String) -> String {
        switch what.lowercased() {
        case "positionx":
            guard let node = childNode(named: target) else { return "" }
            let e = spec.entities.first { $0.id == target }
            return String(Int(node.position.x - (e?.width ?? 0) / 2))
        case "positiony":
            guard let node = childNode(named: target) else { return "" }
            let e = spec.entities.first { $0.id == target }
            return String(Int(worldSize.height - node.position.y - (e?.height ?? 0) / 2))
        case "health":
            return String((childNode(named: target)?.userData?["health"] as? Int) ?? 0)
        case "count":
            let ids = Set(spec.entities.filter { $0.category == target || $0.id == target }.map(\.id))
            let placed = children.filter { child in
                guard let name = child.name else { return false }
                let bare = templateId(ofNodeNamed: name)
                return ids.contains(bare)
            }
            return String(placed.count)
        case "velocityx":
            return String(Int(childNode(named: target)?.physicsBody?.velocity.dx ?? 0))
        case "velocityy":
            // Design coords: positive = downward.
            return String(Int(-(childNode(named: target)?.physicsBody?.velocity.dy ?? 0)))
        case "rotation":
            return String(Int((childNode(named: target)?.zRotation ?? 0) * 180 / .pi))
        case "score": return String(score)
        case "lives": return String(livesLeft)
        case "timeleft": return String(Int(max(0, timeRemaining)))
        default: return ""
        }
    }

    /// Design-coordinate conversion for outgoing events (top-left origin).
    private func designPoint(_ p: CGPoint) -> CGPoint {
        CGPoint(x: p.x, y: worldSize.height - p.y)
    }

    private func categoryBit(for name: String) -> UInt32 {
        if let b = categoryBits[name] { return b }
        let b = nextBit
        categoryBits[name] = b
        nextBit = nextBit == 0 ? 0 : nextBit << 1   // up to 32 categories
        return b
    }

    private func buildScene() {
        removeAllChildren()
        // Joints live on the physics WORLD, not the node tree, so removing the
        // nodes leaves them behind pointing at dead bodies. After a restart the
        // rebuilt vehicle was wired to corpses and vanished from the level.
        physicsWorld.removeAllJoints()
        bikeWheels.removeAll()
        bikeMotorSpeed.removeAll()
        bikeThrottle.removeAll()
        bikeMotorForce.removeAll()
        bikeWheelRadius.removeAll()
        removeAllActions()
        score = 0
        spawnerStates = []
        parallaxNodes = []
        elapsedPlaytime = 0
        lastRampAt = 0
        steerDirection = 0
        steerTargetX = nil
        lastShotAt = [:]
        livesLeft = spec.lives ?? 0
        timeRemaining = spec.timeLimit ?? 0
        invulnerableUntil = 0
        phase = spec.startPaused ? .waiting : .playing
        physicsWorld.gravity = CGVector(dx: 0, dy: spec.startPaused ? 0 : spec.gravity)
        backgroundColor = skColor(spec.backgroundColor, fallback: .init(red: 0.56, green: 0.82, blue: 0.94, alpha: 1))

        // Always run through a camera: follow/world scenes need it, and fixed
        // scenes get working screen-shake for free (animating a scene's own
        // position is a SpriteKit no-op — shake MUST move a camera).
        let cam = SKCameraNode()
        cam.position = CGPoint(x: min(size.width, worldSize.width) / 2,
                               y: min(size.height, worldSize.height) / 2)
        addChild(cam)
        camera = cam
        gameCamera = cam

        if let bg = spec.backgroundImage, let tex = loadTexture(bg) {
            addBackground(tex)
        }
        setupGradient()
        setupParallax()
        setupAmbient()
        setupLighting()
        setupVignette()
        if let music = spec.music { setupMusic(music) }

        // Placed (non-template) entities.
        for entity in spec.entities where !entity.isTemplate {
            let node = makeNode(from: entity)
            addChild(node)
        }
        // Behaviors that schedule work (spawners, motion, FX) start here.
        for entity in spec.entities where !entity.isTemplate {
            if let node = childNode(named: entity.id) { startBehaviors(for: entity, on: node) }
        }

        if spec.showScore { setupHUD() }
        setupLivesAndTimerHUD()
        if phase == .waiting { showOverlay(title: spec.tapToStartText, subtitle: nil) }
        onEvent?(.scoreChanged(0))
        // A scene with startPaused == false goes straight to .playing and never
        // passes through startPlaying(), so `started` never fired — every
        // On Game Start flow (counter resets, difficulty setup) silently never
        // ran, leaving stale values from the previous round.
        if phase == .playing { onEvent?(.started) }
    }

    /// HUD/overlay parent: the camera when one exists (so UI stays glued to
    /// the screen while the world scrolls), else the scene itself.
    private var uiParent: SKNode { gameCamera ?? self }

    /// Converts a screen-space point (origin bottom-left of the VISIBLE area)
    /// to the ui parent's coordinate space.
    private func uiPoint(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        gameCamera != nil
            ? CGPoint(x: x - size.width / 2, y: y - size.height / 2)  // camera space is centered
            : CGPoint(x: x, y: y)
    }

    // MARK: Parallax / ambient / music

    private func setupParallax() {
        for (index, layer) in spec.parallax.enumerated() {
            guard let tex = loadTexture(layer.sprite) else { continue }
            let layerHeight = layer.height ?? size.height
            let ratio = layerHeight / tex.size().height
            let tileWidth = tex.size().width * ratio
            let holder = SKNode()
            holder.zPosition = -900 + CGFloat(index)
            // Three tiles wrap seamlessly for any camera x.
            for i in -1...1 {
                let tile = SKSpriteNode(texture: tex)
                tile.size = CGSize(width: tileWidth, height: layerHeight)
                tile.anchorPoint = CGPoint(x: 0, y: 0)
                tile.position = CGPoint(x: CGFloat(i) * tileWidth, y: layer.y)
                holder.addChild(tile)
            }
            addChild(holder)
            parallaxNodes.append((holder, layer.speed, tileWidth))
        }
    }

    private func setupAmbient() {
        guard let kind = spec.ambient?.lowercased(), !kind.isEmpty else { return }
        let emitter = SKEmitterNode()
        emitter.particleBirthRate = 24
        emitter.particleLifetime = 12
        emitter.particlePositionRange = CGVector(dx: worldSize.width * 1.2, dy: 0)
        emitter.position = CGPoint(x: worldSize.width / 2, y: worldSize.height + 20)
        emitter.zPosition = -100
        emitter.particleColorBlendFactor = 1
        switch kind {
        case "rain":
            emitter.particleColor = SKColor(red: 0.6, green: 0.7, blue: 0.95, alpha: 0.7)
            emitter.particleSize = CGSize(width: 2, height: 14)
            emitter.particleSpeed = 450; emitter.emissionAngle = -.pi / 2
            emitter.particleBirthRate = 80; emitter.particleLifetime = 4
        case "bubbles":
            emitter.particleColor = SKColor(white: 1, alpha: 0.5)
            emitter.particleSize = CGSize(width: 9, height: 9)
            emitter.particleSpeed = 60; emitter.emissionAngle = .pi / 2
            emitter.position.y = -20
        case "stars":
            emitter.particleColor = .white
            emitter.particleSize = CGSize(width: 3, height: 3)
            emitter.particleSpeed = 4; emitter.particleAlphaSpeed = -0.08
            emitter.particlePositionRange = CGVector(dx: worldSize.width * 1.2, dy: worldSize.height)
            emitter.position = CGPoint(x: worldSize.width / 2, y: worldSize.height / 2)
        case "leaves":
            emitter.particleColor = SKColor(red: 0.8, green: 0.55, blue: 0.25, alpha: 0.9)
            emitter.particleSize = CGSize(width: 8, height: 6)
            emitter.particleSpeed = 60; emitter.emissionAngle = -.pi / 2
            emitter.particleRotationSpeed = 2; emitter.emissionAngleRange = 0.7
        default: // snow
            emitter.particleColor = .white
            emitter.particleSize = CGSize(width: 5, height: 5)
            emitter.particleSpeed = 50; emitter.emissionAngle = -.pi / 2
            emitter.emissionAngleRange = 0.4
        }
        addChild(emitter)
        emitter.advanceSimulationTime(8) // pre-fill so it doesn't start empty
    }

    private func setupMusic(_ ref: String) {
        let url: URL?
        if FileManager.default.fileExists(atPath: ref) {
            url = URL(fileURLWithPath: ref)
        } else {
            let base = ((ref as NSString).lastPathComponent as NSString).deletingPathExtension
            let ext = (ref as NSString).pathExtension.isEmpty ? "mp3" : (ref as NSString).pathExtension
            url = Bundle.main.url(forResource: base, withExtension: ext)
        }
        guard let url else { return }
        let audio = SKAudioNode(url: url)
        audio.autoplayLooped = true
        addChild(audio)
    }

    private func addBackground(_ tex: SKTexture) {
        let ratio = max(size.width / tex.size().width, size.height / tex.size().height)
        let w = tex.size().width * ratio, h = tex.size().height * ratio
        for i in 0..<2 {
            let bg = SKSpriteNode(texture: tex)
            bg.size = CGSize(width: w, height: h)
            bg.anchorPoint = CGPoint(x: 0, y: 0.5)
            bg.position = CGPoint(x: CGFloat(i) * w, y: size.height / 2)
            bg.zPosition = -1000
            bg.name = "__bg"
            addChild(bg)
            if spec.scrollSpeed > 0 {
                let move = SKAction.moveBy(x: -w, y: 0, duration: TimeInterval(w / spec.scrollSpeed))
                let reset = SKAction.moveBy(x: w, y: 0, duration: 0)
                bg.run(.repeatForever(.sequence([move, reset])))
            }
        }
    }

    // MARK: Depth & atmosphere (v3)

    private func setupGradient() {
        guard spec.backgroundGradient.count >= 2 else { return }
        let colors = spec.backgroundGradient.map { skColor($0) }
        let size = CGSize(width: 8, height: 256)
        #if canImport(UIKit)
        UIGraphicsBeginImageContext(size)
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        drawGradient(in: ctx, size: size, colors: colors.map { $0.cgColor })
        let image = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        guard let cg = image?.cgImage else { return }
        #else
        guard let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height),
                                  bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        drawGradient(in: ctx, size: size, colors: colors.map { $0.cgColor })
        guard let cg = ctx.makeImage() else { return }
        #endif
        let node = SKSpriteNode(texture: SKTexture(cgImage: cg))
        node.size = worldSize
        node.anchorPoint = .zero
        node.position = .zero
        node.zPosition = -950
        node.name = "__gradient"
        addChild(node)
    }

    private func drawGradient(in ctx: CGContext, size: CGSize, colors: [CGColor]) {
        let space = CGColorSpaceCreateDeviceRGB()
        let locations: [CGFloat] = colors.enumerated().map { CGFloat($0.offset) / CGFloat(max(colors.count - 1, 1)) }
        guard let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: locations) else { return }
        // Top color first: draw from top (y=size.height) to bottom.
        ctx.drawLinearGradient(gradient,
                               start: CGPoint(x: 0, y: size.height),
                               end: CGPoint(x: 0, y: 0),
                               options: [])
    }

    private var lightNode: SKLightNode?

    private func setupLighting() {
        guard spec.lighting else { return }
        let light = SKLightNode()
        light.categoryBitMask = 1
        light.lightColor = skColor(spec.lightColor, fallback: .white)
        light.ambientColor = SKColor(white: 0.35, alpha: 1)
        light.falloff = 1.2
        light.position = CGPoint(x: worldSize.width / 2, y: worldSize.height * 0.65)
        light.zPosition = 900
        addChild(light)
        lightNode = light
    }

    private func setupVignette() {
        guard spec.vignette else { return }
        let size = CGSize(width: 128, height: 128)
        #if canImport(UIKit)
        UIGraphicsBeginImageContext(size)
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        drawVignette(in: ctx, size: size)
        let image = UIGraphicsGetImageFromCurrentImageContext()
        UIGraphicsEndImageContext()
        guard let cg = image?.cgImage else { return }
        #else
        guard let ctx = CGContext(data: nil, width: Int(size.width), height: Int(size.height),
                                  bitsPerComponent: 8, bytesPerRow: 0,
                                  space: CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return }
        drawVignette(in: ctx, size: size)
        guard let cg = ctx.makeImage() else { return }
        #endif
        let node = SKSpriteNode(texture: SKTexture(cgImage: cg))
        node.size = CGSize(width: size2().width * 1.05, height: size2().height * 1.05)
        node.position = gameCamera != nil ? .zero : CGPoint(x: self.size.width / 2, y: self.size.height / 2)
        node.zPosition = 1500
        node.name = "__vignette"
        (gameCamera ?? self).addChild(node)
    }

    private func size2() -> CGSize { self.size }

    private func drawVignette(in ctx: CGContext, size: CGSize) {
        let space = CGColorSpaceCreateDeviceRGB()
        let colors = [SKColor.clear.cgColor, SKColor(white: 0, alpha: 0.55).cgColor]
        guard let gradient = CGGradient(colorsSpace: space, colors: colors as CFArray, locations: [0.55, 1.0]) else { return }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        ctx.drawRadialGradient(gradient, startCenter: center, startRadius: 0,
                               endCenter: center, endRadius: size.width * 0.72, options: [])
    }

    // MARK: Node construction

    /// Every spawned instance gets its OWN name ("__spawn_wall#7"). Sharing one
    /// name across all copies made it impossible for logic to remove the single
    /// orb the player actually touched.
    private func nextSpawnName(_ templateId: String) -> String {
        spawnCounter += 1
        return "__spawn_\(templateId)#\(spawnCounter)"
    }

    /// The template id behind a node name, for both plain and spawned nodes.
    private func templateId(ofNodeNamed name: String) -> String {
        guard name.hasPrefix("__spawn_") else { return name }
        let body = String(name.dropFirst("__spawn_".count))
        return body.split(separator: "#").first.map(String.init) ?? body
    }

    private func childNode(named id: String) -> SKNode? {
        childNode(withName: id) ?? children.first { $0.name == id }
    }

    /// Ground built from a POLYLINE instead of a rectangle: a glowing stroke
    /// with a matching edge-chain physics body. Rectangles can't make hills,
    /// and a hilly track is the whole point of a physics bike game.
    private func makeTerrainNode(from e: GameEntity, points: [[CGFloat]]) -> SKNode {
        let pts = points.compactMap { pair -> CGPoint? in
            guard pair.count >= 2 else { return nil }
            return CGPoint(x: pair[0], y: worldSize.height - pair[1])
        }
        let container = SKNode()
        container.name = e.id
        container.zPosition = e.zIndex
        guard pts.count > 1 else { return container }

        let path = CGMutablePath()
        path.move(to: pts[0])
        for p in pts.dropFirst() { path.addLine(to: p) }

        let stroke = SKShapeNode(path: path)
        stroke.strokeColor = skColor(e.color, fallback: .cyan)
        stroke.lineWidth = e.strokeWidth ?? 5
        stroke.lineCap = .round
        stroke.lineJoin = .round
        container.addChild(stroke)

        if e.glow {
            let halo = SKShapeNode(path: path)
            halo.strokeColor = skColor(e.glowColor ?? e.color, fallback: .cyan).withAlphaComponent(0.35)
            halo.lineWidth = (e.strokeWidth ?? 5) * 3.5
            halo.lineCap = .round
            halo.blendMode = .add
            halo.zPosition = -1
            container.addChild(halo)
        }

        // Fill below the line so the track reads as solid ground.
        if let fillColor = e.glowColor ?? e.color {
            let fillPath = CGMutablePath()
            fillPath.move(to: CGPoint(x: pts[0].x, y: -200))
            for p in pts { fillPath.addLine(to: p) }
            fillPath.addLine(to: CGPoint(x: pts[pts.count - 1].x, y: -200))
            fillPath.closeSubpath()
            let fill = SKShapeNode(path: fillPath)
            fill.fillColor = skColor(fillColor, fallback: .cyan).withAlphaComponent(0.16)
            fill.strokeColor = .clear
            fill.zPosition = -2
            container.addChild(fill)
        }

        let body = SKPhysicsBody(edgeChainFrom: path)
        body.isDynamic = false
        body.friction = e.friction
        body.restitution = e.restitution
        if let cat = e.category { body.categoryBitMask = categoryBit(for: cat) }
        body.collisionBitMask = e.collidesWith.reduce(UInt32(0)) { $0 | categoryBit(for: $1) }
        body.contactTestBitMask = e.contacts.reduce(UInt32(0)) { $0 | categoryBit(for: $1) }
        container.physicsBody = body
        return container
    }

    private func makeNode(from e: GameEntity) -> SKNode {
        if let pts = e.points { return makeTerrainNode(from: e, points: pts) }
        let node: SKSpriteNode
        if let tex = loadTexture(e.sprite) {
            node = SKSpriteNode(texture: tex, size: CGSize(width: e.width, height: e.height))
            if spec.lighting {
                // Generated normal map = real 2D lighting: the cutout stops
                // being a flat sticker and takes shading from the light.
                node.normalTexture = tex.generatingNormalMap(withSmoothness: 0.4, contrast: 1.2)
                node.lightingBitMask = 1
                node.shadowedBitMask = 1
            }
        } else {
            node = SKSpriteNode(color: skColor(e.color, fallback: .systemBlue),
                                size: CGSize(width: e.width, height: e.height))
            if spec.lighting { node.lightingBitMask = 1 }
        }
        if e.glow {
            // Bloom that follows the SHAPE of the sprite. A circle sized to the
            // longest side drew a fat disc around anything wide or tall, which
            // read as a bug rather than a light source.
            let halo = SKShapeNode(ellipseOf: CGSize(width: e.width * 1.45, height: e.height * 1.45))
            let glowColor = e.glowColor ?? e.color
            halo.fillColor = skColor(glowColor, fallback: .white)
                .withAlphaComponent(glowColor == nil ? 0.22 : 0.3)
            halo.strokeColor = .clear
            halo.blendMode = .add
            halo.zPosition = -1
            node.addChild(halo)
        }
        if e.dropShadow {
            let shadow = SKShapeNode(ellipseOf: CGSize(width: e.width * 0.85, height: e.height * 0.22))
            shadow.fillColor = SKColor(white: 0, alpha: 0.32)
            shadow.strokeColor = .clear
            shadow.position = CGPoint(x: 0, y: -e.height * 0.55)
            shadow.zPosition = -2
            node.addChild(shadow)
        }
        node.name = e.id
        node.zPosition = e.zIndex
        node.zRotation = e.rotation * .pi / 180
        // Convert top-left/+y-down design coords to SpriteKit centers.
        // (World coords when the world is larger than the screen.)
        node.position = CGPoint(x: e.x + e.width / 2, y: worldSize.height - e.y - e.height / 2)

        // Sprite frame ANIMATION: sprite + frames cycle at frameRate fps.
        if let framePaths = e.frames, !framePaths.isEmpty {
            var textures = [node.texture].compactMap { $0 }
            textures.append(contentsOf: framePaths.compactMap(loadTexture))
            if textures.count > 1 {
                let perFrame = 1.0 / Double(max(e.frameRate ?? 8, 1))
                node.run(.repeatForever(.animate(with: textures, timePerFrame: perFrame)), withKey: "frames")
            }
        }

        attachPhysics(to: node, from: e)
        if let hp = e.health {
            node.userData = (node.userData ?? NSMutableDictionary())
            node.userData?["health"] = hp
            if hp > 1 {
                // Health bar: background + green fill that damage() shrinks.
                let barWidth = e.width * 0.9
                let barBg = SKShapeNode(rectOf: CGSize(width: barWidth, height: 5), cornerRadius: 2.5)
                barBg.fillColor = SKColor(white: 0, alpha: 0.5); barBg.strokeColor = .clear
                barBg.position = CGPoint(x: 0, y: e.height / 2 + 8)
                barBg.zPosition = 10
                barBg.name = "__hpbg"
                let bar = SKShapeNode(rectOf: CGSize(width: barWidth, height: 5), cornerRadius: 2.5)
                bar.fillColor = .systemGreen; bar.strokeColor = .clear
                bar.position = .zero
                bar.name = "__hp"
                bar.userData = NSMutableDictionary(dictionary: ["max": hp, "w": barWidth])
                barBg.addChild(bar)
                node.addChild(barBg)
            }
        }
        return node
    }

    private func attachPhysics(to node: SKSpriteNode, from e: GameEntity) {
        guard e.body != .none else { return }
        let body: SKPhysicsBody = e.circleBody
            ? SKPhysicsBody(circleOfRadius: min(e.width, e.height) / 2)
            : SKPhysicsBody(rectangleOf: node.size)
        switch e.body {
        case .dynamic:    body.isDynamic = true;  body.affectedByGravity = e.affectedByGravity
        case .staticBody: body.isDynamic = false; body.affectedByGravity = false
        case .kinematic:  body.isDynamic = false; body.affectedByGravity = false
        case .none:       break
        }
        body.restitution = e.restitution
        body.friction = e.friction
        body.linearDamping = e.linearDamping
        body.allowsRotation = e.allowsRotation
        if let m = e.mass { body.mass = m }

        if let cat = e.category { body.categoryBitMask = categoryBit(for: cat) }
        body.collisionBitMask = e.collidesWith.reduce(UInt32(0)) { $0 | categoryBit(for: $1) }
        body.contactTestBitMask = e.contacts.reduce(UInt32(0)) { $0 | categoryBit(for: $1) }
        node.physicsBody = body
    }

    // MARK: Behaviors

    private func startBehaviors(for e: GameEntity, on node: SKNode) {
        for b in e.behaviors {
            switch b.type {
            case "moveConstant":
                // velocityY uses DESIGN coords: positive moves DOWN.
                let vx = b.velocityX ?? 0, vy = -(b.velocityY ?? 0)
                node.run(.repeatForever(.sequence([
                    .customAction(withDuration: 1/60) { [weak self] n, _ in
                        guard let self, self.phase == .playing else { return }
                        n.position.x += vx / 60
                        n.position.y += vy / 60
                    }
                ])), withKey: "moveConstant")
            case "spawner":
                // Update-driven so difficultyRamp can retune intervals live.
                let interval = max(0.2, b.interval ?? 2)
                spawnerStates.append(SpawnerState(
                    behavior: b, interval: interval,
                    countdown: b.firstDelay ?? interval
                ))
            case "bike":
                buildBike(for: e, chassis: node, behavior: b)
            case "slingshot":
                slingMaxPower = b.maxPower ?? slingMaxPower
                slingMaxDrag = b.maxDrag ?? slingMaxDrag
                slingHome[e.id] = node.position
                // Park the projectile ON the sling. Without this it is a live
                // dynamic body from frame one, so it drops off the slingshot
                // and rolls away before the player can even aim.
                node.physicsBody?.isDynamic = false
                node.userData = (node.userData ?? NSMutableDictionary())
                node.userData?["launched"] = false
            case "spin":
                let degPerSec = b.strength ?? 90
                node.run(.repeatForever(.rotate(byAngle: .pi * 2 * (degPerSec / 360), duration: 1)), withKey: "spin")
            case "bob":
                let amplitude = b.strength ?? 12
                let period = TimeInterval(max(b.interval ?? 1.6, 0.2))
                let up = SKAction.moveBy(x: 0, y: amplitude, duration: period / 2)
                up.timingMode = .easeInEaseOut
                let down = SKAction.moveBy(x: 0, y: -amplitude, duration: period / 2)
                down.timingMode = .easeInEaseOut
                node.run(.repeatForever(.sequence([up, down])), withKey: "bob")
            case "pulse":
                let scaleDelta = b.strength ?? 0.12
                let period = TimeInterval(max(b.interval ?? 1.0, 0.2))
                node.run(.repeatForever(.sequence([
                    .scale(to: 1 + scaleDelta, duration: period / 2),
                    .scale(to: 1, duration: period / 2),
                ])), withKey: "pulse")
            case "patrol":
                let dx = (b.velocityX ?? 60), dy = -(b.velocityY ?? 0)
                let legTime = TimeInterval(max(b.interval ?? 2, 0.2))
                let go = SKAction.moveBy(x: dx * legTime, y: dy * legTime, duration: legTime)
                go.timingMode = .easeInEaseOut
                node.run(.repeatForever(.sequence([go, go.reversed()])), withKey: "patrol")
            case "autoFire":
                // Continuous fire (classic shooter): spawns the projectile
                // template from this entity every `interval`, flying `direction`
                // ("up" default / "down"), at `strength` pt/s.
                guard let templateId = b.template else { break }
                let fireInterval = TimeInterval(max(b.interval ?? 0.35, 0.08))
                let speed = b.strength ?? 620
                let dirDown = b.direction?.lowercased() == "down"
                let entityId = e.id
                node.run(.repeatForever(.sequence([
                    .wait(forDuration: fireInterval),
                    .run { [weak self] in
                        guard let self, self.phase == .playing,
                              let shooter = self.childNode(named: entityId),
                              let template = self.spec.entities.first(where: { $0.id == templateId }) else { return }
                        var proj = template
                        proj.isTemplate = false
                        let p = self.makeNode(from: proj)
                        p.name = nextSpawnName(template.id)
                        p.position = CGPoint(x: shooter.position.x,
                                             y: shooter.position.y + (dirDown ? -1 : 1) * (template.height / 2 + 18))
                        self.addChild(p)
                        if let body = p.physicsBody {
                            body.velocity = CGVector(dx: 0, dy: (dirDown ? -1 : 1) * speed)
                        } else {
                            p.run(.sequence([.moveBy(x: 0, y: (dirDown ? -1 : 1) * speed * 4, duration: 4), .removeFromParent()]))
                        }
                        p.run(.sequence([.wait(forDuration: 4), .removeFromParent()]))
                    }
                ])), withKey: "autoFire")
            case "trail":
                let emitter = makeTrailEmitter(kind: b.particles ?? "spark")
                emitter.targetNode = self  // particles stay in world space
                node.addChild(emitter)
            default:
                break
            }
        }
    }

    /// Left/right edges of the VISIBLE area in world coords (camera-aware).
    private var viewRightEdge: CGFloat { (gameCamera?.position.x ?? size.width / 2) + size.width / 2 }
    private var viewLeftEdge: CGFloat { (gameCamera?.position.x ?? size.width / 2) - size.width / 2 }

    private func spawnFromTemplate(_ template: GameEntity, behavior b: GameBehavior, vx: CGFloat) {
        if b.direction?.lowercased() == "down" {
            // Top spawner (shooters, falling-object games): random x across
            // the view, entering above the top edge, falling at velocityY.
            let margin = template.width / 2 + 4
            let x = CGFloat.random(in: margin...(max(worldSize.width - margin, margin + 1)))
            let speed = abs(b.velocityY ?? 160)
            let node = makeNode(from: {
                var e = template; e.isTemplate = false; e.x = 0; e.y = 0; return e
            }())
            node.name = nextSpawnName(template.id)
            node.position = CGPoint(x: x, y: worldSize.height + template.height)
            addChild(node)
            node.run(.repeatForever(.customAction(withDuration: 1/60) { [weak self] n, _ in
                guard let self, self.phase == .playing else { return }
                n.position.y -= speed / 60
                if n.position.y < -template.height * 2 { n.removeFromParent() }
            }), withKey: "drift")
            onEvent?(.spawned(template.category ?? template.id))
            return
        }
        let startX = viewRightEdge + template.width
        if let gap = b.gapSize {
            // Gap pair: a top and bottom segment with an opening between them.
            // Gap center is randomized between yMin…yMax.
            let yMin = b.spawnYMin ?? gap
            let yMax = b.spawnYMax ?? (size.height - gap)
            let center = CGFloat.random(in: min(yMin, yMax)...max(yMin, yMax))
            let topH = size.height - (center + gap / 2)
            let botH = center - gap / 2
            if topH > 4 { addSpawned(template, x: startX, centerY: center + gap/2 + topH/2, height: topH, vx: vx, gapEdge: .down) }
            if botH > 4 { addSpawned(template, x: startX, centerY: botH/2, height: botH, vx: vx, gapEdge: .up) }
            if b.scoreOnPass != false {
                addScoreSensor(x: startX, centerY: center, width: 6, height: gap, vx: vx)
            }
        } else {
            let yMin = b.spawnYMin ?? template.height
            let yMax = b.spawnYMax ?? (size.height - template.height)
            let cy = CGFloat.random(in: min(yMin, yMax)...max(yMin, yMax))
            addSpawned(template, x: startX, centerY: cy, height: template.height, vx: vx, gapEdge: nil)
            if b.scoreOnPass == true {
                addScoreSensor(x: startX, centerY: size.height / 2, width: 6, height: size.height, vx: vx)
            }
        }
    }

    /// Which side of a spawned segment faces the gap — its "clean" edge.
    private enum GapEdge { case up, down }

    private func addSpawned(_ template: GameEntity, x: CGFloat, centerY: CGFloat, height: CGFloat, vx: CGFloat, gapEdge: GapEdge?) {
        var e = template
        e.isTemplate = false
        e.y = 0; e.x = 0; e.height = height

        let node: SKSpriteNode
        if let tex = loadTexture(template.sprite) {
            // Never STRETCH a sprite to an arbitrary segment height (mangled
            // pipes) — TILE it at natural aspect inside a crop, first tile
            // anchored at the gap edge. Top segments flip vertically so the
            // sprite's cap faces the gap, like a classic pipe pair.
            node = SKSpriteNode(color: .clear, size: CGSize(width: e.width, height: height))
            let natural = tex.size()
            let tileHeight = max(natural.height * (e.width / max(natural.width, 1)), 8)
            let crop = SKCropNode()
            crop.maskNode = SKSpriteNode(color: .white, size: node.size)
            let tiles = max(Int(ceil(height / tileHeight)), 1)
            for i in 0..<tiles {
                let tile = SKSpriteNode(texture: tex, size: CGSize(width: e.width, height: tileHeight))
                switch gapEdge {
                case .down:
                    tile.position = CGPoint(x: 0, y: -height / 2 + tileHeight / 2 + CGFloat(i) * tileHeight)
                    tile.yScale = -1
                case .up, nil:
                    tile.position = CGPoint(x: 0, y: height / 2 - tileHeight / 2 - CGFloat(i) * tileHeight)
                }
                crop.addChild(tile)
            }
            node.addChild(crop)
            node.zPosition = e.zIndex
            attachPhysics(to: node, from: e)
        } else {
            node = makeNode(from: e) as! SKSpriteNode
        }
        node.position = CGPoint(x: x, y: centerY)
        node.name = nextSpawnName(template.id)
        addChild(node)
        node.run(.repeatForever(.customAction(withDuration: 1/60) { [weak self] n, _ in
            guard let self, self.phase == .playing else { return }
            n.position.x += vx / 60
            if n.position.x < self.viewLeftEdge - template.width * 2 { n.removeFromParent() }
        }), withKey: "drift")
    }

    private func addScoreSensor(x: CGFloat, centerY: CGFloat, width: CGFloat, height: CGFloat, vx: CGFloat) {
        let sensor = SKNode()
        sensor.position = CGPoint(x: x, y: centerY)
        sensor.name = "__score_sensor"
        let body = SKPhysicsBody(rectangleOf: CGSize(width: width, height: height))
        body.isDynamic = false
        body.categoryBitMask = categoryBit(for: "__score")
        body.contactTestBitMask = 0
        body.collisionBitMask = 0
        sensor.physicsBody = body
        addChild(sensor)
        sensor.run(.repeatForever(.customAction(withDuration: 1/60) { [weak self] n, _ in
            guard let self, self.phase == .playing else { return }
            n.position.x += vx / 60
            if n.position.x < self.viewLeftEdge - 40 { n.removeFromParent() }
        }))
    }

    // MARK: Per-frame update

    override func update(_ currentTime: TimeInterval) {
        let dt = lastUpdate == 0 ? 0 : min(currentTime - lastUpdate, 0.1)
        lastUpdate = currentTime
        guard phase == .playing else { return }
        elapsedPlaytime += dt

        // Spawners (update-driven, retunable).
        for i in spawnerStates.indices {
            spawnerStates[i].countdown -= CGFloat(dt)
            if spawnerStates[i].countdown <= 0 {
                spawnerStates[i].countdown = spawnerStates[i].interval
                let b = spawnerStates[i].behavior
                if let templateId = b.template,
                   let template = spec.entities.first(where: { $0.id == templateId }) {
                    spawnFromTemplate(template, behavior: b, vx: b.velocityX ?? -140)
                }
            }
        }
        // Difficulty ramp: every 10s tighten every spawner interval.
        if let ramp = spec.difficultyRamp, ramp > 0, ramp != 1,
           elapsedPlaytime - lastRampAt >= 10 {
            lastRampAt = elapsedPlaytime
            for i in spawnerStates.indices {
                spawnerStates[i].interval = max(0.25, spawnerStates[i].interval * ramp)
            }
        }

        // Countdown mode.
        if spec.timeLimit != nil {
            timeRemaining -= CGFloat(dt)
            timerHUD.text = "⏱ \(max(0, Int(timeRemaining.rounded(.up))))"
            if timeRemaining <= 0 {
                spec.timeUpAction.lowercased() == "win" ? winGame() : triggerGameOver()
            }
        }

        // Player passing a score sensor (Flappy scoring).
        for sensor in children where sensor.name == "__score_sensor" {
            if let player = players().first, sensor.position.x < player.position.x,
               (sensor.userData?["counted"] as? Bool) != true {
                sensor.userData = (sensor.userData ?? NSMutableDictionary())
                sensor.userData?["counted"] = true
                addScore(1)
            }
        }

        // Drive the CHASSIS along its own forward axis and let the wheels roll
        // from ground friction. Spinning the wheels with angular impulses just
        // made them slip — the bike crawled 14pt in a second and a half.
        for (bikeId, wheels) in bikeWheels {
            let throttle = bikeThrottle[bikeId] ?? 0
            guard let chassis = childNode(named: bikeId), let body = chassis.physicsBody else { continue }
            let maxSpeed = (bikeMotorSpeed[bikeId] ?? 30) * 20
            if throttle != 0 {
                body.isResting = false
                // Throttle drives along the WORLD x axis, not the chassis's own
                // heading. Following the heading meant that the moment the bike
                // tipped or flipped, "forward" pointed backwards and full
                // throttle drove it in reverse (measured velocity -83).
                let along = body.velocity.dx
                let target = maxSpeed * throttle
                if abs(along) < abs(target) || (along < 0) != (throttle < 0) {
                    let step = (bikeMotorForce[bikeId] ?? 11) * throttle
                    body.velocity = CGVector(dx: along + step, dy: body.velocity.dy)
                }
                // Spin the wheels to match ground speed so they look driven.
                for wheel in wheels {
                    wheel.physicsBody?.isResting = false
                    wheel.physicsBody?.angularVelocity = -body.velocity.dx / max(wheelRadiusFor(bikeId), 1)
                }
            } else {
                for wheel in wheels { wheel.physicsBody?.angularVelocity *= 0.99 }
            }
        }

        // Slingshot auto-reload: a real sling game gives you the NEXT shot once
        // the last one settles. Without this the projectile just rolls on the
        // floor forever and the level can never be finished.
        if slingActive == false {
            for e in spec.entities where e.behaviors.contains(where: { $0.type == "slingshot" && $0.autoReload == true }) {
                guard let node = childNode(named: e.id), let body = node.physicsBody,
                      (node.userData?["launched"] as? Bool) == true else { continue }
                let offWorld = node.position.x < -120 || node.position.x > worldSize.width + 120
                    || node.position.y < -120 || node.position.y > worldSize.height + 200
                let speed = hypot(body.velocity.dx, body.velocity.dy)
                if offWorld {
                    slingSettle[e.id] = 999
                } else if speed < 34 {
                    slingSettle[e.id, default: 0] += 1
                } else {
                    slingSettle[e.id] = 0
                }
                // ~0.75s still, or gone off-screen → reload the next shot.
                if (slingSettle[e.id] ?? 0) >= 45 {
                    slingSettle[e.id] = 0
                    loadSlingshot(e.id)
                    onEvent?(.spawned(e.category ?? e.id))
                }
            }
        }

        // Per-entity update behaviors.
        for e in spec.entities where !e.isTemplate {
            guard let node = childNode(named: e.id) else { continue }
            for b in e.behaviors {
                switch b.type {
                case "wrapVertical":
                    if node.position.y < 0 { node.position.y += worldSize.height }
                    if node.position.y > worldSize.height { node.position.y -= worldSize.height }
                case "destroyOffscreen":
                    let m = b.margin ?? 120
                    if node.position.x < -m || node.position.x > worldSize.width + m ||
                        node.position.y < -m || node.position.y > worldSize.height + m {
                        node.removeFromParent()
                    }
                case "rotateWithVelocity":
                    // Flappy-style tilt: nose follows vertical velocity.
                    if let body = node.physicsBody {
                        let target = max(-0.9, min(0.6, body.velocity.dy * 0.0022))
                        node.zRotation += (target - node.zRotation) * 0.2
                    }
                case "followEntity":
                    // Homing: drift toward the target entity at `strength` pt/s.
                    if let targetId = b.target, let targetNode = childNode(named: targetId) {
                        let speed = b.strength ?? 80
                        let dx = targetNode.position.x - node.position.x
                        let dy = targetNode.position.y - node.position.y
                        let dist = max(hypot(dx, dy), 1)
                        node.position.x += dx / dist * speed * CGFloat(dt)
                        node.position.y += dy / dist * speed * CGFloat(dt)
                    }
                case "controlHorizontal":
                    // Player steering: arrow keys / drag set the direction.
                    let speed = b.strength ?? 240
                    if let target = steerTargetX {
                        let dx = target - node.position.x
                        node.position.x += max(-speed * CGFloat(dt), min(speed * CGFloat(dt), dx))
                        if abs(dx) < 2 { steerTargetX = nil }
                    } else if steerDirection != 0 {
                        node.position.x += steerDirection * speed * CGFloat(dt)
                    }
                    node.position.x = max(e.width / 2, min(worldSize.width - e.width / 2, node.position.x))
                default:
                    break
                }
            }
        }

        if let light = lightNode {
            if let followId = spec.lightFollow, let target = childNode(named: followId) {
                light.position = CGPoint(x: target.position.x, y: target.position.y + 40)
            } else if let cam = gameCamera, spec.cameraFollow != nil {
                light.position = CGPoint(x: cam.position.x, y: cam.position.y + size.height * 0.2)
            }
        }
        updateCameraAndParallax()
    }

    private func updateCameraAndParallax() {
        if let cam = gameCamera {
            if let followId = spec.cameraFollow, let target = childNode(named: followId) {
                // Smooth follow, clamped so the view never leaves the world.
                let halfW = size.width / 2, halfH = size.height / 2
                let goalX = max(halfW, min(worldSize.width - halfW, target.position.x))
                let goalY = max(halfH, min(worldSize.height - halfH, target.position.y))
                cam.position.x += (goalX - cam.position.x) * 0.12
                cam.position.y += (goalY - cam.position.y) * 0.12
            }
            for layer in parallaxNodes {
                // speed 0 = pinned to camera (far sky), 1 = fixed in the world.
                let base = cam.position.x * (1 - layer.speed)
                layer.node.position.x = base - (base.truncatingRemainder(dividingBy: layer.tileWidth))
            }
        } else if spec.scrollSpeed > 0 {
            for layer in parallaxNodes {
                layer.node.position.x -= spec.scrollSpeed * layer.speed / 60
                if layer.node.position.x < -layer.tileWidth {
                    layer.node.position.x += layer.tileWidth
                }
            }
        }
    }

    private func players() -> [SKNode] {
        spec.entities.filter { e in e.behaviors.contains { $0.type == "impulseOnTap" || $0.type == "slingshot" } }
            .compactMap { childNode(named: $0.id) }
    }

    // MARK: Scoring & state

    private func addScore(_ n: Int) {
        score += n
        hud.text = "\(score)"
        onEvent?(.scoreChanged(score))
        if let win = spec.winScore, score >= win { winGame() }
    }

    private func triggerGameOver() {
        guard phase == .playing else { return }
        phase = .over
        physicsWorld.gravity = CGVector(dx: 0, dy: spec.gravity) // let bodies settle
        showOverlay(title: "Game Over", subtitle: "Score \(score) · tap to retry")
        onEvent?(.gameOver(score: score))
    }

    private func winGame() {
        guard phase == .playing else { return }
        phase = .won
        // Celebration burst.
        let center = gameCamera?.position ?? CGPoint(x: size.width / 2, y: size.height / 2)
        emitParticles("confetti", at: CGPoint(x: center.x, y: center.y + size.height * 0.3), burst: 120)
        showOverlay(title: "You Win!", subtitle: "Score \(score) · tap to play again")
        onEvent?(.won(score: score))
    }

    private func startPlaying() {
        guard phase == .waiting else { return }
        phase = .playing
        physicsWorld.gravity = CGVector(dx: 0, dy: spec.gravity)
        hideOverlay()
        onEvent?(.started)
    }

    // MARK: Contacts

    func didBegin(_ contact: SKPhysicsContact) {
        guard phase == .playing else { return }
        // Physical force of the hit — the difference between a bird grazing a
        // wall and one demolishing it. Logic scales damage off this.
        // Stacked blocks resting on each other re-trigger contacts forever as
        // the solver jitters them. Reporting those as "impacts" made the screen
        // shake permanently and drained health from a structure nobody hit, so
        // an impact must involve something actually MOVING.
        let speedA = hypot(contact.bodyA.velocity.dx, contact.bodyA.velocity.dy)
        let speedB = hypot(contact.bodyB.velocity.dx, contact.bodyB.velocity.dy)
        if max(speedA, speedB) > 60,
           let catA = categoryBits.first(where: { $0.value == contact.bodyA.categoryBitMask })?.key,
           let catB = categoryBits.first(where: { $0.value == contact.bodyB.categoryBitMask })?.key,
           !catA.hasPrefix("__"), !catB.hasPrefix("__") {
            onEvent?(.impact(catA, catB, contact.collisionImpulse,
                             contact.bodyA.node?.name ?? "", contact.bodyB.node?.name ?? ""))
        }
        handleContact(contact.bodyA, contact.bodyB)
        handleContact(contact.bodyB, contact.bodyA)
    }

    private func handleContact(_ a: SKPhysicsBody, _ b: SKPhysicsBody) {
        // Surface every category pair to the host once per contact — the
        // logic editor's On Game Collision flows hook in here.
        if let catA = categoryBits.first(where: { $0.value == a.categoryBitMask })?.key,
           let catB = categoryBits.first(where: { $0.value == b.categoryBitMask })?.key,
           !catA.hasPrefix("__"), !catB.hasPrefix("__") {
            onEvent?(.collision(catA, catB, a.node?.name ?? "", b.node?.name ?? ""))
        }
        guard let nodeA = a.node, let idA = nodeA.name else { return }
        let entityA = spec.entities.first { $0.id == templateId(ofNodeNamed: idA) }
        guard let entity = entityA else { return }
        // Which category is the other body?
        let otherCat = categoryBits.first { $0.value == b.categoryBitMask }?.key
        for beh in entity.behaviors where beh.type == "onCollision" {
            guard let target = beh.target, target == otherCat else { continue }
            applyCollisionAction(beh, selfNode: nodeA, otherNode: b.node)
        }
    }

    private func applyCollisionAction(_ beh: GameBehavior, selfNode: SKNode, otherNode: SKNode?) {
        if let sound = beh.soundName { run(.playSoundFileNamed(sound, waitForCompletion: false)) }
        if let fx = beh.particles, let n = otherNode { emitParticles(fx, at: n.position) }
        if beh.shake == true { shakeScreen() }
        switch beh.action ?? "" {
        case "gameOver": triggerGameOver()
        case "win":      winGame()
        case "score":    addScore(beh.points ?? 1)
        case "removeSelf":
            selfNode.removeFromParent()
            emitDestroyed(selfNode)
        case "removeOther":
            if let n = otherNode { emitDestroyed(n) }
            otherNode?.removeFromParent(); if let p = beh.points { addScore(p) }
        case "damage":
            if let n = otherNode { damage(n, amount: beh.points ?? 1, particles: beh.particles) }
        case "bounce":
            selfNode.physicsBody?.applyImpulse(CGVector(dx: 0, dy: (beh.strength ?? 6)))
        case "loseLife":
            loseLife(node: selfNode)
        case "explode":
            if let n = otherNode {
                emitParticles(beh.particles ?? "fire", at: n.position, burst: 60)
                shakeScreen()
                emitDestroyed(n)
                n.removeFromParent()
                if let p = beh.points { addScore(p) }
            }
        case "runFlow":
            if let f = beh.flowId { onEvent?(.runFlow(f)) }
        default: break
        }
    }

    /// Multi-life games: decrement, blink invulnerable for ~1.2s, game over at 0.
    private func loseLife(node: SKNode) {
        guard spec.lives != nil else { triggerGameOver(); return }
        guard elapsedPlaytime >= invulnerableUntil else { return }
        livesLeft -= 1
        refreshLivesHUD()
        onEvent?(.lifeLost(livesLeft))
        if livesLeft <= 0 { triggerGameOver(); return }
        invulnerableUntil = elapsedPlaytime + 1.2
        shakeScreen(intensity: 6)
        node.run(.repeat(.sequence([
            .fadeAlpha(to: 0.25, duration: 0.12),
            .fadeAlpha(to: 1.0, duration: 0.12),
        ]), count: 5), withKey: "invulnerable")
    }

    /// Reports a destroyed entity's category (falls back to its id) so the
    /// logic editor's On Entity Destroyed flows can react.
    private func emitDestroyed(_ node: SKNode) {
        guard let name = node.name else { return }
        let bareId = templateId(ofNodeNamed: name)
        let category = spec.entities.first { $0.id == bareId }?.category ?? bareId
        onEvent?(.entityDestroyed(category))
    }

    /// Quick camera shake — impact feedback. Ends back at the exact origin so
    /// fixed (non-follow) cameras never drift.
    private func shakeScreen(intensity: CGFloat = 10) {
        // One shake at a time. Contacts arrive in bursts (a bird rolling along
        // the ground fires many), and stacking shake actions turned the whole
        // screen into a permanent rattle that never settled.
        guard shakeUntil < CACurrentMediaTime() else { return }
        shakeUntil = CACurrentMediaTime() + 0.35

        guard let target = gameCamera else { return }

        // How far the camera can travel before it shows what is OUTSIDE the
        // world. When the level is exactly screen-sized this is zero, and the
        // old unconditional translation dragged the empty edges into view on
        // every hit — which read as the whole picture breaking apart.
        let slackX = max(0, (worldSize.width - size.width) / 2)
        let slackY = max(0, (worldSize.height - size.height) / 2)
        let amp = min(intensity * 0.35, 6)
        let offsetX = min(amp, slackX)
        let offsetY = min(amp, slackY)

        // Always readable, never destructive: a very short zoom pulse. Scaling
        // IN cannot expose anything beyond the level, so impact still lands
        // even when there is no room to translate.
        let punch = SKAction.sequence([
            SKAction.scale(to: 1 - min(intensity, 20) * 0.0012, duration: 0.05),
            SKAction.scale(to: 1, duration: 0.12)
        ])
        punch.timingMode = .easeOut
        target.run(punch, withKey: "shakePunch")

        // Only add movement when the world genuinely has room to spare.
        guard offsetX > 0.5 || offsetY > 0.5 else { return }
        let origin = target.position
        let steps = (0..<4).map { i -> SKAction in
            let decay = 1 - CGFloat(i) / 4
            return SKAction.moveBy(
                x: CGFloat.random(in: -offsetX...offsetX) * decay,
                y: CGFloat.random(in: -offsetY...offsetY) * decay,
                duration: 0.04
            )
        }
        target.run(.sequence(steps + [.move(to: origin, duration: 0.06)]), withKey: "shake")
    }

    private func damage(_ node: SKNode, amount: Int, particles: String?) {
        // An entity with NO health is not destructible — it is scenery or a
        // projectile, not a target. Treating "no health" as 0 meant a single
        // stray damage call deleted it outright: the bird vanished the instant
        // it struck the tower, because a concurrent flow aimed damage at it.
        // Destructible things declare health; everything else shrugs damage off.
        guard let current = node.userData?["health"] as? Int else { return }
        let remaining = current - amount
        if remaining <= 0 {
            if let fx = particles { emitParticles(fx, at: node.position) }
            emitDestroyed(node)
            node.removeFromParent()
        } else {
            node.userData?["health"] = remaining
            node.run(.sequence([.fadeAlpha(to: 0.4, duration: 0.05), .fadeAlpha(to: 1, duration: 0.05)]))
            if let bar = node.childNode(withName: "__hpbg")?.childNode(withName: "__hp") as? SKShapeNode,
               let maxHp = bar.userData?["max"] as? Int, let w = bar.userData?["w"] as? CGFloat, maxHp > 0 {
                let ratio = CGFloat(remaining) / CGFloat(maxHp)
                bar.xScale = max(ratio, 0.02)
                bar.position.x = -w * (1 - ratio) / 2
                bar.fillColor = ratio > 0.5 ? .systemGreen : (ratio > 0.25 ? .systemOrange : .systemRed)
            }
        }
    }

    // MARK: Particles (built procedurally so no .sks assets are needed)

    private func emitParticles(_ kind: String, at point: CGPoint, burst: Int = 18) {
        let emitter = SKEmitterNode()
        emitter.position = point
        emitter.zPosition = 500
        emitter.particleLifetime = 0.6
        emitter.numParticlesToEmit = burst
        emitter.particleBirthRate = 600
        emitter.particleSpeed = 120
        emitter.particleSpeedRange = 80
        emitter.emissionAngleRange = .pi * 2
        emitter.particleAlpha = 0.9
        emitter.particleAlphaSpeed = -1.5
        emitter.particleScale = 0.4
        emitter.particleScaleRange = 0.3
        style(emitter, as: kind)
        emitter.particleColorBlendFactor = 1
        addChild(emitter)
        emitter.run(.sequence([.wait(forDuration: 1.2), .removeFromParent()]))
    }

    private func style(_ emitter: SKEmitterNode, as kind: String) {
        switch kind {
        case "spark":
            emitter.particleColor = .yellow; emitter.particleSize = CGSize(width: 4, height: 4)
        case "smoke":
            emitter.particleColor = .gray; emitter.particleSize = CGSize(width: 10, height: 10)
            emitter.particleAlphaSpeed = -1.0; emitter.particleSpeed = 40
        case "fire":
            emitter.particleColor = .orange; emitter.particleSize = CGSize(width: 8, height: 8)
            emitter.particleColorBlendFactor = 1
            emitter.particleSpeed = 160; emitter.particleLifetime = 0.5
        case "confetti":
            emitter.particleColor = .systemPink; emitter.particleSize = CGSize(width: 6, height: 4)
            emitter.particleColorRedRange = 1; emitter.particleColorGreenRange = 1; emitter.particleColorBlueRange = 1
            emitter.particleRotationSpeed = 6; emitter.particleLifetime = 1.4
            emitter.yAcceleration = -280
        case "hearts":
            emitter.particleColor = .systemRed; emitter.particleSize = CGSize(width: 7, height: 7)
            emitter.particleSpeed = 60; emitter.emissionAngle = .pi / 2
        default: // debris
            emitter.particleColor = .brown; emitter.particleSize = CGSize(width: 6, height: 6)
        }
    }

    /// Continuous trail attached to a moving entity (rocket exhaust, sparkles).
    private func makeTrailEmitter(kind: String) -> SKEmitterNode {
        let emitter = SKEmitterNode()
        emitter.particleBirthRate = 40
        emitter.particleLifetime = 0.5
        emitter.particleSpeed = 20
        emitter.particleSpeedRange = 12
        emitter.emissionAngleRange = .pi / 3
        emitter.emissionAngle = .pi   // trails behind a rightward-facing entity
        emitter.particleAlpha = 0.8
        emitter.particleAlphaSpeed = -1.6
        emitter.particleScale = 0.35
        emitter.particleScaleSpeed = -0.5
        emitter.zPosition = -1
        style(emitter, as: kind)
        emitter.particleColorBlendFactor = 1
        return emitter
    }

    // MARK: Input (cross-platform)

    private func handleTapDown(at p: CGPoint) {
        let dp = designPoint(p)
        onEvent?(.tap(dp.x, dp.y))
        onEvent?(.drag("start", dp.x, dp.y))
        switch phase {
        case .waiting: startPlaying(); fallthrough
        case .playing:
            applyTapImpulses()
            applyJumps()
            applyShots(toward: p)
            beginSlingIfPossible(at: p)
            // Steering is DRAG/keys only — a tap is an action (shoot/flap),
            // and must not also yank the player toward the tap point.
        case .over, .won:
            buildScene() // restart
        }
    }

    /// jumpOnTap: platformer jump — only fires when (approximately) grounded,
    /// so holding the tap can't fly.
    private func applyJumps() {
        for e in spec.entities {
            guard let jump = e.behaviors.first(where: { $0.type == "jumpOnTap" }),
                  let node = childNode(named: e.id), let body = node.physicsBody else { continue }
            if abs(body.velocity.dy) < 24 {
                body.velocity = CGVector(dx: body.velocity.dx, dy: 0)
                body.applyImpulse(CGVector(dx: 0, dy: jump.strength ?? 12))
            }
        }
    }

    /// shootOnTap: spawn the projectile template from the shooter, flying
    /// toward the tap point at `strength` pt/s, with an `interval` cooldown.
    private func applyShots(toward p: CGPoint) {
        for e in spec.entities {
            guard let shoot = e.behaviors.first(where: { $0.type == "shootOnTap" }),
                  let templateId = shoot.template,
                  let template = spec.entities.first(where: { $0.id == templateId }),
                  let shooter = childNode(named: e.id) else { continue }
            let cooldown = TimeInterval(shoot.interval ?? 0.3)
            if let last = lastShotAt[e.id], elapsedPlaytime - last < cooldown { continue }
            lastShotAt[e.id] = elapsedPlaytime

            var proj = template
            proj.isTemplate = false
            let node = makeNode(from: proj)
            node.name = nextSpawnName(template.id)
            node.position = shooter.position
            addChild(node)
            var dx = p.x - shooter.position.x, dy = p.y - shooter.position.y
            if shoot.direction?.lowercased() == "up" { dx = 0; dy = 1 }
            if shoot.direction?.lowercased() == "down" { dx = 0; dy = -1 }
            let dist = max(hypot(dx, dy), 1)
            let speed = shoot.strength ?? 500
            if let body = node.physicsBody {
                body.velocity = CGVector(dx: dx / dist * speed, dy: dy / dist * speed)
            } else {
                node.run(.move(by: CGVector(dx: dx / dist * speed * 4, dy: dy / dist * speed * 4), duration: 4))
            }
            node.run(.sequence([.wait(forDuration: 5), .removeFromParent()]))
        }
    }

    private func handleDragMove(at p: CGPoint) {
        let dp = designPoint(p)
        onEvent?(.drag("move", dp.x, dp.y))
        guard slingActive, let node = slingEntityNode else { return }
        var delta = CGVector(dx: p.x - slingAnchor.x, dy: p.y - slingAnchor.y)
        let dist = hypot(delta.dx, delta.dy)
        if dist > slingMaxDrag { let k = slingMaxDrag / dist; delta.dx *= k; delta.dy *= k }
        // Keep the pull INSIDE the playfield. The sling sits near the left wall,
        // so a long pull used to drag the projectile off-screen — where the
        // release touch is no longer over the view at all.
        var target = CGPoint(x: slingAnchor.x + delta.dx, y: slingAnchor.y + delta.dy)
        let halfW = (node as? SKSpriteNode)?.size.width ?? 40
        let halfH = (node as? SKSpriteNode)?.size.height ?? 40
        target.x = min(max(target.x, halfW / 2), worldSize.width - halfW / 2)
        target.y = min(max(target.y, halfH / 2), worldSize.height - halfH / 2)
        node.position = target
        node.physicsBody?.velocity = .zero
        drawAimLine(from: node.position, pullFrom: slingAnchor)
    }

    /// Puts an aiming projectile back on the sling when the gesture was lost
    /// without a usable release point.
    private func releaseStuckSling() {
        guard slingActive, let node = slingEntityNode else { return }
        slingActive = false
        aimLine?.removeFromParent(); aimLine = nil
        node.position = slingAnchor
        node.physicsBody?.velocity = .zero
        node.physicsBody?.isDynamic = false
        node.userData?["launched"] = false
        slingEntityNode = nil
    }

    private func handleTapUp(at p: CGPoint) {
        let dpUp = designPoint(p)
        onEvent?(.drag("end", dpUp.x, dpUp.y))
        guard slingActive, let node = slingEntityNode else { return }
        slingActive = false
        aimLine?.removeFromParent(); aimLine = nil
        let pull = CGVector(dx: slingAnchor.x - node.position.x, dy: slingAnchor.y - node.position.y)
        let dist = hypot(pull.dx, pull.dy)

        // A pull too small to aim shouldn't burn a shot — put the bird back.
        guard dist > 6 else {
            node.position = slingAnchor
            node.userData?["launched"] = false
            node.physicsBody?.isDynamic = false
            slingEntityNode = nil
            return
        }

        node.physicsBody?.affectedByGravity = true
        node.physicsBody?.isResting = false
        // Set VELOCITY, not an impulse. An impulse is divided by the body's
        // mass, so a heavier bird launched with the same pull barely moved —
        // it just dropped off the sling. maxPower now means, readably, "launch
        // speed in points/sec at a full-strength pull".
        let ratio = min(dist / max(slingMaxDrag, 1), 1)
        let speed = slingMaxPower * ratio
        node.physicsBody?.velocity = CGVector(dx: pull.dx / dist * speed,
                                              dy: pull.dy / dist * speed)
        onEvent?(.launched(node.name ?? ""))
        slingEntityNode = nil
    }

    /// Where a shot released right now would actually travel: same launch
    /// velocity the release uses, integrated against real gravity. SpriteKit
    /// applies world gravity at 150 points per metre, so the preview has to use
    /// that scale or the drawn arc is not the arc the bird flies.
    private func predictedLaunch(from: CGPoint, anchor: CGPoint) -> (v: CGVector, a: CGVector)? {
        let pull = CGVector(dx: anchor.x - from.x, dy: anchor.y - from.y)
        let dist = hypot(pull.dx, pull.dy)
        guard dist > 6 else { return nil }
        let speed = slingMaxPower * min(dist / max(slingMaxDrag, 1), 1)
        let v = CGVector(dx: pull.dx / dist * speed, dy: pull.dy / dist * speed)
        let a = CGVector(dx: physicsWorld.gravity.dx * 150, dy: physicsWorld.gravity.dy * 150)
        return (v, a)
    }

    private func applyTapImpulses() {
        for e in spec.entities {
            guard e.behaviors.contains(where: { $0.type == "impulseOnTap" }),
                  let node = childNode(named: e.id), let body = node.physicsBody else { continue }
            let strength = e.behaviors.first { $0.type == "impulseOnTap" }?.strength ?? 8
            body.velocity = CGVector(dx: body.velocity.dx, dy: 0)
            body.applyImpulse(CGVector(dx: 0, dy: strength))
        }
    }

    /// Puts a bird back on the slingshot: recreates it if the last shot flew
    /// away, parks it at the sling anchor and re-arms it for dragging. This is
    /// what turns a one-shot sling into a real level with several birds.
    private func loadSlingshot(_ entityId: String) {
        guard let e = spec.entities.first(where: { $0.id == entityId }) else { return }
        let node: SKNode
        if let existing = childNode(named: entityId) {
            node = existing
        } else {
            var fresh = e
            fresh.isTemplate = false
            node = makeNode(from: fresh)
            node.name = e.id
            addChild(node)
            startBehaviors(for: fresh, on: node)
        }
        let home = slingHome[entityId]
            ?? CGPoint(x: e.x + e.width / 2, y: worldSize.height - e.y - e.height / 2)
        slingHome[entityId] = home
        node.position = home
        node.zRotation = 0
        node.physicsBody?.velocity = .zero
        node.physicsBody?.angularVelocity = 0
        node.physicsBody?.isDynamic = false
        node.userData = (node.userData ?? NSMutableDictionary())
        node.userData?["launched"] = false
        node.alpha = 1
    }

    /// Two motorised wheels pinned under a chassis — a real vehicle rather than
    /// a sliding box. Pin joints let the wheels spin (drive) while the chassis
    /// rotates freely for mid-air leaning and flips.
    private func buildBike(for e: GameEntity, chassis: SKNode, behavior b: GameBehavior) {
        guard let chassisBody = chassis.physicsBody else { return }
        chassisBody.allowsRotation = true

        let radius = b.wheelRadius ?? max(e.height * 0.42, 10)
        let base = b.wheelBase ?? (e.width * 0.62)
        let drop = b.wheelDrop ?? (e.height * 0.42)
        let offsets: [CGFloat] = [-base / 2, base / 2]
        var made: [SKNode] = []

        for (index, dx) in offsets.enumerated() {
            let wheel = SKShapeNode(circleOfRadius: radius)
            wheel.name = "\(e.id)__wheel\(index)"
            wheel.strokeColor = skColor(e.glowColor ?? e.color, fallback: .cyan)
            wheel.lineWidth = 3
            wheel.fillColor = skColor(e.glowColor ?? e.color, fallback: .cyan).withAlphaComponent(0.18)
            wheel.glowWidth = 4
            wheel.zPosition = e.zIndex - 0.1
            wheel.position = CGPoint(x: chassis.position.x + dx, y: chassis.position.y - drop)

            let body = SKPhysicsBody(circleOfRadius: radius)
            body.isDynamic = true
            body.friction = 0.85
            body.restitution = 0.05
            body.linearDamping = 0.02
            body.mass = 0.5
            body.allowsRotation = true
            body.categoryBitMask = categoryBit(for: "__wheel")
            // Wheels roll on whatever the chassis collides with, but report no
            // contacts — only the BODY touching the ground counts as a crash.
            body.collisionBitMask = e.collidesWith.reduce(UInt32(0)) { $0 | categoryBit(for: $1) }
            body.contactTestBitMask = 0
            wheel.physicsBody = body
            addChild(wheel)
            made.append(wheel)

            let joint = SKPhysicsJointPin.joint(withBodyA: chassisBody, bodyB: body,
                                                anchor: wheel.position)
            joint.shouldEnableLimits = false
            joint.frictionTorque = 0.02
            physicsWorld.add(joint)
        }
        bikeWheels[e.id] = made
        bikeMotorSpeed[e.id] = b.motorSpeed ?? 30
        bikeMotorForce[e.id] = b.motorForce ?? 11
        bikeWheelRadius[e.id] = radius
    }

    private func beginSlingIfPossible(at p: CGPoint) {
        for e in spec.entities where e.behaviors.contains(where: { $0.type == "slingshot" }) {
            guard let node = childNode(named: e.id) else { continue }
            if node.frame.insetBy(dx: -30, dy: -30).contains(p) && (node.userData?["launched"] as? Bool) != true {
                slingEntityNode = node
                slingAnchor = node.position
                slingActive = true
                node.userData = (node.userData ?? NSMutableDictionary())
                node.userData?["launched"] = true
                // Become dynamic HERE, not at release. Flipping isDynamic and
                // assigning velocity in the same frame let SpriteKit reset the
                // body's state, so the shot left the sling with almost no speed
                // and simply dropped. Gravity stays off while aiming.
                node.physicsBody?.isDynamic = true
                node.physicsBody?.affectedByGravity = false
                node.physicsBody?.velocity = .zero
                node.physicsBody?.angularVelocity = 0
                return
            }
        }
    }

    private func drawAimLine(from: CGPoint, pullFrom anchor: CGPoint) {
        aimLine?.removeFromParent()
        let guideNode = SKNode()
        guideNode.zPosition = 400

        // The stretched elastic, fork -> projectile.
        let bandPath = CGMutablePath()
        bandPath.move(to: anchor)
        bandPath.addLine(to: from)
        let band = SKShapeNode(path: bandPath)
        band.strokeColor = SKColor(red: 0.36, green: 0.22, blue: 0.12, alpha: 0.95)
        band.lineWidth = 5
        band.lineCap = .round
        guideNode.addChild(band)

        // Dotted flight path — the ACTUAL parabola, not a straight ray. The old
        // guide drew a line three times the pull length, which pointed the right
        // way but promised a trajectory the bird never flew.
        if let (v, a) = predictedLaunch(from: from, anchor: anchor) {
            let step = 0.038
            for i in 1...26 {
                let t = CGFloat(i) * CGFloat(step)
                let x = from.x + v.dx * t + 0.5 * a.dx * t * t
                let y = from.y + v.dy * t + 0.5 * a.dy * t * t
                guard y > -40, x < worldSize.width + 80 else { break }
                let dot = SKShapeNode(circleOfRadius: 3.5 - CGFloat(i) * 0.07)
                dot.position = CGPoint(x: x, y: y)
                dot.fillColor = .white
                dot.strokeColor = .clear
                dot.alpha = max(0.14, 0.85 - CGFloat(i) * 0.03)
                guideNode.addChild(dot)
            }
        }

        addChild(guideNode)
        aimLine = guideNode
    }

    // MARK: HUD & overlay

    private func setupHUD() {
        hud.text = "\(score)"
        hud.fontSize = 34
        hud.fontColor = .white
        hud.position = uiPoint(size.width / 2, size.height - 70)
        hud.zPosition = 1000
        hud.horizontalAlignmentMode = .center
        hud.removeFromParent()
        uiParent.addChild(hud)
    }

    private func setupLivesAndTimerHUD() {
        if spec.lives != nil {
            refreshLivesHUD()
            livesHUD.fontSize = 20
            livesHUD.fontColor = .white
            livesHUD.horizontalAlignmentMode = .left
            livesHUD.position = uiPoint(16, size.height - 44)
            livesHUD.zPosition = 1000
            livesHUD.removeFromParent()
            uiParent.addChild(livesHUD)
        }
        if let limit = spec.timeLimit {
            timerHUD.text = "⏱ \(Int(limit))"
            timerHUD.fontSize = 20
            timerHUD.fontColor = .white
            timerHUD.horizontalAlignmentMode = .right
            timerHUD.position = uiPoint(size.width - 16, size.height - 44)
            timerHUD.zPosition = 1000
            timerHUD.removeFromParent()
            uiParent.addChild(timerHUD)
        }
    }

    private func refreshLivesHUD() {
        livesHUD.text = String(repeating: "♥", count: max(0, livesLeft))
            + String(repeating: "♡", count: max(0, (spec.lives ?? 0) - livesLeft))
    }

    private func showOverlay(title: String, subtitle: String?) {
        overlay.removeAllChildren()
        overlay.removeFromParent()
        overlay.zPosition = 2000
        let dimOrigin = uiPoint(0, 0)
        let dim = SKShapeNode(rect: CGRect(origin: dimOrigin, size: size))
        dim.fillColor = SKColor(white: 0, alpha: 0.35); dim.strokeColor = .clear
        overlay.addChild(dim)
        let t = SKLabelNode(fontNamed: "Menlo-Bold")
        t.text = title; t.fontSize = 40; t.fontColor = .white
        t.position = uiPoint(size.width / 2, size.height / 2 + 12)
        t.horizontalAlignmentMode = .center
        overlay.addChild(t)
        if let subtitle {
            let s = SKLabelNode(fontNamed: "Menlo")
            s.text = subtitle; s.fontSize = 18; s.fontColor = .white
            s.position = uiPoint(size.width / 2, size.height / 2 - 28)
            s.horizontalAlignmentMode = .center
            overlay.addChild(s)
        }
        uiParent.addChild(overlay)
    }

    private func hideOverlay() {
        overlay.removeAllChildren()
        overlay.removeFromParent()
    }

    // MARK: Platform input entry points

    #if os(macOS)
    override func mouseDown(with event: NSEvent) { handleTapDown(at: event.location(in: self)) }
    override func mouseDragged(with event: NSEvent) {
        handleDragMove(at: event.location(in: self))
        if phase == .playing { steerTargetX = event.location(in: self).x }
    }
    override func mouseUp(with event: NSEvent) { handleTapUp(at: event.location(in: self)) }
    override func keyDown(with event: NSEvent) {
        switch event.keyCode {
        case 123: steerDirection = -1; return   // ←
        case 124: steerDirection = 1; return    // →
        default: break
        }
        // Space/any other key triggers tap-style controls.
        if phase == .waiting { startPlaying() }
        if phase == .playing { applyTapImpulses(); applyJumps() }
        if phase == .over || phase == .won { buildScene() }
    }
    override func keyUp(with event: NSEvent) {
        if event.keyCode == 123 || event.keyCode == 124 { steerDirection = 0 }
    }
    #elseif os(watchOS)
    // watchOS SpriteKit has no responder-chain touches; scenes render and
    // run physics but take no direct input (host UI drives them if needed).
    #else
    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTapDown(at: t.location(in: self)) }
    }
    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleDragMove(at: t.location(in: self)) }
    }
    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTapUp(at: t.location(in: self)) }
    }
    /// A drag that leaves the view (or is interrupted by a system gesture)
    /// delivers CANCELLED, not ENDED. Without this the projectile stayed
    /// frozen in mid-air with gravity off — pulled back and never fired.
    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
        if let t = touches.first { handleTapUp(at: t.location(in: self)) }
        else { releaseStuckSling() }
    }
    #endif
}

// MARK: - SwiftUI wrapper (works in the designer preview AND exported apps)

struct AgentGameView: View {
    let spec: GameSceneSpec
    var onEvent: ((GameEvent) -> Void)? = nil

    var body: some View {
        AgentGameViewHost(spec: spec, onEvent: onEvent)
    }
}

/// Holds the SKScene in @State so it survives SwiftUI re-renders — otherwise the
/// game would reset every time the hosting view redraws (e.g. canvas selection).
private struct AgentGameViewHost: View {
    let spec: GameSceneSpec
    var onEvent: ((GameEvent) -> Void)?
    @State private var scene: AgentGameScene

    init(spec: GameSceneSpec, onEvent: ((GameEvent) -> Void)?) {
        self.spec = spec
        self.onEvent = onEvent
        let built = AgentGameScene(spec: spec, size: CGSize(width: spec.width, height: spec.height))
        built.onEvent = onEvent
        _scene = State(initialValue: built)
    }

    var body: some View {
        SpriteView(scene: scene)
            .ignoresSafeArea()
            // A CHANGED spec (game-inspector sliders, update_game_scene)
            // rebuilds the scene instantly — tuning is play-as-you-drag.
            .onChange(of: spec) { _, newSpec in
                let rebuilt = AgentGameScene(spec: newSpec, size: CGSize(width: newSpec.width, height: newSpec.height))
                rebuilt.onEvent = onEvent
                scene = rebuilt
            }
    }
}
