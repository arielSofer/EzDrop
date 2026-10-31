//
//  GameTemplateLibrary.swift
//  AgenticDesigner
//
//  Ready-to-play game blueprints. Each returns a complete GameSceneSpec that
//  runs immediately in the live preview and exports as a real game. Sprites
//  default to colored rectangles; callers can swap in generated sprite PNGs
//  (see SpriteGenerator) by setting each entity's `sprite` path.
//

import Foundation
import CoreGraphics

struct GameTemplateInfo: Codable {
    var id: String
    var title: String
    var summary: String
    /// Entity ids whose `sprite` a caller will usually replace with real art.
    var spriteSlots: [String]
}

enum GameTemplateLibrary {

    static let templates: [GameTemplateInfo] = [
        GameTemplateInfo(
            id: "flappy",
            title: "Flappy (tap-to-flap)",
            summary: "A bird that falls under gravity and flaps up on each tap; scrolling pipe gaps to fly through; score per pipe; crash ends the run.",
            spriteSlots: ["bird", "pipe", "ground"]
        ),
        GameTemplateInfo(
            id: "angrybirds",
            title: "Slingshot Smash (Angry-Birds-style)",
            summary: "Drag a bird back on a slingshot and launch it into a stack of physics blocks to knock down the pig. Real rigid-body physics, destructible structure, debris particles.",
            spriteSlots: ["bird", "block", "pig", "ground"]
        ),
        GameTemplateInfo(
            id: "runner",
            title: "Endless Jumper",
            summary: "A character auto-runs while obstacles scroll in; tap to jump; hitting an obstacle ends the run. A minimal side-scroller skeleton.",
            spriteSlots: ["hero", "obstacle", "ground"]
        ),
        GameTemplateInfo(
            id: "blank",
            title: "Blank scene",
            summary: "An empty scene with gravity and a ground — a starting point to add your own entities and behaviors.",
            spriteSlots: ["ground"]
        ),
    ]

    static func spec(for id: String) -> GameSceneSpec? {
        switch id.lowercased() {
        case "flappy":      return flappy()
        case "angrybirds", "slingshot", "smash": return angryBirds()
        case "runner", "jumper": return runner()
        case "blank":       return blank()
        default:            return nil
        }
    }

    // MARK: - Flappy

    static func flappy() -> GameSceneSpec {
        var spec = GameSceneSpec()
        spec.width = 390; spec.height = 844
        spec.backgroundColor = "#8ED0F0"
        spec.gravity = -18
        spec.startPaused = true
        spec.tapToStartText = "Tap to flap"

        var bird = GameEntity(id: "bird", name: "Bird", color: "#FFD23F",
                              x: 96, y: 400, width: 46, height: 40,
                              body: .dynamic, circleBody: true)
        bird.affectedByGravity = true
        bird.restitution = 0
        bird.linearDamping = 0
        bird.category = "bird"
        bird.collidesWith = []                 // pass through pipes; contact ends the run
        bird.contacts = ["pipe", "ground"]
        bird.behaviors = [
            .impulseOnTap(9, key: "space"),
            .onCollision(target: "pipe", action: "gameOver", sound: nil),
            .onCollision(target: "ground", action: "gameOver", sound: nil),
        ]

        var ground = GameEntity(id: "ground", name: "Ground", color: "#DEB841",
                                x: 0, y: 800, width: 390, height: 44,
                                body: .staticBody)
        ground.category = "ground"

        var pipe = GameEntity(id: "pipe", name: "Pipe", color: "#5FB84B",
                              x: 0, y: 0, width: 66, height: 300,
                              body: .kinematic)
        pipe.category = "pipe"
        pipe.isTemplate = true

        // Invisible manager that drives pipe spawning.
        var spawner = GameEntity(id: "spawner", name: "Spawner", color: "#00000000",
                                 x: 0, y: 0, width: 1, height: 1, body: .none)
        spawner.behaviors = [
            .spawner(template: "pipe", interval: 2.0, vx: -155,
                     gapSize: 180, yMin: 320, yMax: 640, firstDelay: 1.1)
        ]

        spec.entities = [ground, pipe, spawner, bird]
        return spec
    }

    // MARK: - Angry Birds (slingshot + destructible stack)

    static func angryBirds() -> GameSceneSpec {
        var spec = GameSceneSpec()
        spec.width = 720; spec.height = 405
        spec.backgroundColor = "#9BD3E8"
        spec.gravity = -14
        spec.startPaused = false
        spec.showScore = true
        spec.winScore = 1

        var ground = GameEntity(id: "ground", name: "Ground", color: "#7BAF55",
                                x: 0, y: 372, width: 720, height: 40, body: .staticBody)
        ground.category = "ground"
        ground.friction = 0.6

        var bird = GameEntity(id: "bird", name: "Bird", color: "#E23D3D",
                              x: 80, y: 250, width: 42, height: 42,
                              body: .dynamic, circleBody: true)
        bird.affectedByGravity = false          // held on the slingshot until launched
        bird.allowsRotation = true
        bird.restitution = 0.35
        bird.friction = 0.4
        bird.mass = 1.4
        bird.category = "bird"
        bird.collidesWith = ["ground", "block", "pig"]
        bird.contacts = ["pig"]
        bird.behaviors = [
            .slingshot(maxPower: 1400, maxDrag: 150),
            .onCollision(target: "pig", action: "removeOther", points: 1, sound: nil, particles: "debris"),
        ]

        // A little destructible tower on the right.
        func block(_ n: Int, x: CGFloat, y: CGFloat, w: CGFloat, h: CGFloat) -> GameEntity {
            var b = GameEntity(id: "block\(n)", name: "Block \(n)", color: "#C69C6D",
                               x: x, y: y, width: w, height: h, body: .dynamic)
            b.category = "block"
            b.collidesWith = ["ground", "block", "bird", "pig"]
            b.restitution = 0.05
            b.friction = 0.6
            b.mass = 0.7
            b.allowsRotation = true
            b.health = 3
            b.behaviors = [.destructible(particles: "debris")]
            return b
        }
        let blocks = [
            block(1, x: 500, y: 300, w: 26, h: 72),
            block(2, x: 580, y: 300, w: 26, h: 72),
            block(3, x: 496, y: 276, w: 114, h: 24),
            block(4, x: 512, y: 210, w: 26, h: 66),
            block(5, x: 566, y: 210, w: 26, h: 66),
            block(6, x: 508, y: 190, w: 90, h: 20),
        ]

        var pig = GameEntity(id: "pig", name: "Pig", color: "#8ACb5B",
                             x: 524, y: 232, width: 44, height: 44,
                             body: .dynamic, circleBody: true)
        pig.category = "pig"
        pig.collidesWith = ["ground", "block", "bird"]
        pig.restitution = 0.2
        pig.mass = 0.8
        pig.health = 1

        spec.entities = [ground, bird] + blocks + [pig]
        return spec
    }

    // MARK: - Endless jumper

    static func runner() -> GameSceneSpec {
        var spec = GameSceneSpec()
        spec.width = 390; spec.height = 600
        spec.backgroundColor = "#2C3E50"
        spec.gravity = -30
        spec.startPaused = true
        spec.tapToStartText = "Tap to jump"

        var ground = GameEntity(id: "ground", name: "Ground", color: "#111827",
                                x: 0, y: 540, width: 390, height: 60, body: .staticBody)
        ground.category = "ground"

        var hero = GameEntity(id: "hero", name: "Hero", color: "#F97316",
                              x: 70, y: 480, width: 44, height: 56, body: .dynamic)
        hero.category = "hero"
        hero.collidesWith = ["ground"]
        hero.contacts = ["obstacle"]
        hero.restitution = 0
        hero.behaviors = [
            .impulseOnTap(13, key: "space"),
            .onCollision(target: "obstacle", action: "gameOver"),
        ]

        var obstacle = GameEntity(id: "obstacle", name: "Obstacle", color: "#EF4444",
                                  x: 0, y: 0, width: 34, height: 52, body: .kinematic)
        obstacle.category = "obstacle"
        obstacle.isTemplate = true

        var spawner = GameEntity(id: "spawner", name: "Spawner", color: "#00000000",
                                 x: 0, y: 0, width: 1, height: 1, body: .none)
        // Obstacles sit on the ground (top of ground ≈ design y 540 → spawn near there).
        spawner.behaviors = [
            .spawner(template: "obstacle", interval: 1.6, vx: -220,
                     yMin: 86, yMax: 86, firstDelay: 1.0)
        ]

        spec.entities = [ground, obstacle, spawner, hero]
        return spec
    }

    // MARK: - Blank

    static func blank() -> GameSceneSpec {
        var spec = GameSceneSpec()
        spec.width = 390; spec.height = 844
        spec.backgroundColor = "#1E293B"
        spec.gravity = -18
        spec.startPaused = false
        spec.showScore = false

        var ground = GameEntity(id: "ground", name: "Ground", color: "#334155",
                                x: 0, y: 804, width: 390, height: 40, body: .staticBody)
        ground.category = "ground"
        spec.entities = [ground]
        return spec
    }
}
