//
//  GameInspectorSection.swift
//  AgenticDesigner
//
//  Design controls for the GAMEPLAY itself — shown in the Inspector when a
//  game node is selected. Until this existed, the game's feel (how fast the
//  player falls, how strong a flap is, how often obstacles spawn) lived only
//  inside the spec JSON, editable by agents but not by the designer. Every
//  change here applies live: the canvas game rebuilds instantly, so tuning
//  is play-test-as-you-drag.
//

import SwiftUI

struct GameInspectorSection: View {
    @ObservedObject var viewModel: ProjectViewModel
    let node: DesignNode

    /// Always reads the freshest spec (the passed `node` is a snapshot).
    private var spec: GameSceneSpec? {
        (viewModel.selectedNode ?? node).effectiveGameSpec
    }

    var body: some View {
        if let spec {
            VStack(alignment: .leading, spacing: 14) {
                Text("Game Design")
                    .font(.subheadline).bold()

                // — The feel: how the world pulls —
                sliderRow(
                    "Fall speed (gravity)",
                    value: Double(-spec.gravity), range: 2...45, format: "%.0f",
                    help: "Higher = the player drops faster (shorter time to fall)."
                ) { scene, v in scene.gravity = CGFloat(-v) }

                // — Player behaviors (flap/jump/slingshot strength) —
                ForEach(behaviorKnobs(in: spec), id: \.id) { knob in
                    sliderRow(knob.label, value: knob.value, range: knob.range, format: knob.format, help: knob.help) { scene, v in
                        knob.apply(&scene, v)
                    }
                }

                Divider()

                // — Rules —
                HStack {
                    Text("Lives").font(.caption)
                    Spacer()
                    Stepper("\(spec.lives ?? 0)", onIncrement: {
                        mutate { $0.lives = min(($0.lives ?? 0) + 1, 9) }
                    }, onDecrement: {
                        mutate { let v = ($0.lives ?? 0) - 1; $0.lives = v <= 0 ? nil : v }
                    })
                    .font(.caption)
                }
                .help("0 = one hit ends the game. With lives, hits cost a heart (with a brief shield) and the game ends at zero.")

                HStack {
                    Text("Time limit").font(.caption)
                    Spacer()
                    Stepper(spec.timeLimit.map { "\(Int($0))s" } ?? "off", onIncrement: {
                        mutate { $0.timeLimit = min(($0.timeLimit ?? 0) + 15, 600) }
                    }, onDecrement: {
                        mutate { let v = ($0.timeLimit ?? 0) - 15; $0.timeLimit = v <= 0 ? nil : v }
                    })
                    .font(.caption)
                }
                if spec.timeLimit != nil {
                    Picker("When time runs out", selection: bind({ $0.timeUpAction }, { $0.timeUpAction = $1 })) {
                        Text("You win (survival)").tag("win")
                        Text("Game over").tag("gameOver")
                    }
                    .font(.caption)
                }

                let winScoreBinding = bind({ $0.winScore.map(String.init) ?? "" }, { scene, text in
                    scene.winScore = Int(text.trimmingCharacters(in: .whitespaces))
                })
                HStack {
                    Text("Win at score").font(.caption)
                    TextField("off", text: winScoreBinding)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 64)
                        .font(.caption)
                }

                sliderRow(
                    "Difficulty ramp",
                    value: Double(spec.difficultyRamp ?? 1.0), range: 0.7...1.0, format: "%.2f",
                    help: "Below 1.0, obstacles spawn faster every 10 seconds (0.9 = 10% faster each step). 1.0 = constant."
                ) { scene, v in scene.difficultyRamp = v >= 0.995 ? nil : CGFloat(v) }

                Divider()

                // — Presentation —
                Toggle("Wait for first tap", isOn: bind({ $0.startPaused }, { $0.startPaused = $1 }))
                    .toggleStyle(.checkbox).font(.caption)
                Toggle("Show score", isOn: bind({ $0.showScore }, { $0.showScore = $1 }))
                    .toggleStyle(.checkbox).font(.caption)

                Picker("Atmosphere", selection: bind({ $0.ambient ?? "none" }, { scene, v in
                    scene.ambient = v == "none" ? nil : v
                })) {
                    Text("None").tag("none")
                    Text("Snow").tag("snow")
                    Text("Rain").tag("rain")
                    Text("Bubbles").tag("bubbles")
                    Text("Stars").tag("stars")
                    Text("Leaves").tag("leaves")
                }
                .font(.caption)

                TextField("Start overlay text", text: bind({ $0.tapToStartText }, { $0.tapToStartText = $1 }))
                    .textFieldStyle(.roundedBorder)
                    .font(.caption)

                Text("Changes apply instantly — click into the game on the canvas to feel them.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)

                Divider()

                // — The game's LOGIC: entities and their rules —
                entitiesSection(spec)
            }
        }
    }

    // MARK: - Entities & rules (the game's logic, designable by hand)

    @ViewBuilder
    private func entitiesSection(_ spec: GameSceneSpec) -> some View {
        HStack {
            Text("Entities & Rules").font(.subheadline).bold()
            Spacer()
            Menu {
                Button("Ball (dynamic, bouncy)") { addEntity(body: .dynamic, circle: true, color: "#E23D3D") }
                Button("Box obstacle (kinematic)") { addEntity(body: .kinematic, circle: false, color: "#5FB84B") }
                Button("Wall / ground (static)") { addEntity(body: .staticBody, circle: false, color: "#8B7355") }
                Button("Invisible spawner") { addEntity(body: .none, circle: false, color: "#00000000", size: 1) }
            } label: {
                Image(systemName: "plus.circle.fill")
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help("Add a new entity to the game.")
        }

        ForEach(Array(spec.entities.enumerated()), id: \.element.id) { index, entity in
            DisclosureGroup {
                entityEditor(index: index, entity: entity, spec: spec)
                    .padding(.leading, 4)
            } label: {
                HStack(spacing: 6) {
                    Circle()
                        .fill(Color(hex: entity.color ?? "#3B82F6"))
                        .frame(width: 8, height: 8)
                    Text(entity.name.isEmpty ? entity.id : entity.name)
                        .font(.caption).bold()
                    if entity.isTemplate {
                        Text("template")
                            .font(.caption2)
                            .padding(.horizontal, 4)
                            .background(Capsule().fill(Color.blue.opacity(0.15)))
                    }
                    Spacer()
                    Button {
                        removeEntity(index)
                    } label: {
                        Image(systemName: "trash").font(.caption2)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                }
            }
            .font(.caption)
        }
    }

    @ViewBuilder
    private func entityEditor(index: Int, entity: GameEntity, spec: GameSceneSpec) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Physics identity.
            Picker("Body", selection: entityBind(index, { $0.body }, { $0.body = $1 })) {
                Text("None (visual)").tag(GameBodyType.none)
                Text("Dynamic (physics)").tag(GameBodyType.dynamic)
                Text("Static (immovable)").tag(GameBodyType.staticBody)
                Text("Kinematic (moving collider)").tag(GameBodyType.kinematic)
            }
            .font(.caption)

            HStack {
                Toggle("Round body", isOn: entityBind(index, { $0.circleBody }, { $0.circleBody = $1 }))
                Toggle("Gravity", isOn: entityBind(index, { $0.affectedByGravity }, { $0.affectedByGravity = $1 }))
                Toggle("Spawned only", isOn: entityBind(index, { $0.isTemplate }, { $0.isTemplate = $1 }))
            }
            .toggleStyle(.checkbox)
            .font(.caption2)

            if entity.body == .dynamic {
                sliderRow("Bounciness", value: Double(entity.restitution), range: 0...1, format: "%.2f",
                          help: "0 = dead stop, 1 = superball.") { [self] _, v in
                    mutateEntity(index) { $0.restitution = CGFloat(v) }
                }
            }

            textRow("Category", entityBind(index, { $0.category ?? "" }, { $0.category = $1.isEmpty ? nil : $1 }),
                    help: "Collision group name — rules target these (e.g. obstacle, ground, coin).")
            textRow("Touches (contacts)", entityBind(index,
                    { $0.contacts.joined(separator: ", ") },
                    { $0.contacts = Self.csv($1) }),
                    help: "Categories this entity REPORTS touching — collision rules fire on these.")
            textRow("Bounces off", entityBind(index,
                    { $0.collidesWith.joined(separator: ", ") },
                    { $0.collidesWith = Self.csv($1) }),
                    help: "Categories this entity physically bounces off.")

            // Rules (behaviors).
            HStack {
                Text("Rules").font(.caption).bold()
                Spacer()
                Menu {
                    ForEach(Self.behaviorMenu, id: \.0) { type, title in
                        Button(title) { addBehavior(type, to: index) }
                    }
                } label: {
                    Image(systemName: "plus.circle")
                }
                .menuStyle(.borderlessButton)
                .fixedSize()
            }

            ForEach(Array(entity.behaviors.enumerated()), id: \.offset) { bIndex, behavior in
                behaviorEditor(entityIndex: index, behaviorIndex: bIndex, behavior: behavior, spec: spec)
            }
        }
        .padding(8)
        .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.04)))
    }

    @ViewBuilder
    private func behaviorEditor(entityIndex: Int, behaviorIndex: Int, behavior: GameBehavior, spec: GameSceneSpec) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(Self.behaviorTitle(behavior.type)).font(.caption2).bold()
                Spacer()
                Button {
                    mutateEntity(entityIndex) { entity in
                        guard entity.behaviors.indices.contains(behaviorIndex) else { return }
                        entity.behaviors.remove(at: behaviorIndex)
                    }
                } label: {
                    Image(systemName: "xmark.circle").font(.caption2)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.secondary)
            }

            switch behavior.type {
            case "onCollision":
                categoryPicker("When touching", entityIndex, behaviorIndex, spec,
                               get: { $0.target }, set: { $0.target = $1 })
                Picker("Then", selection: behaviorBind(entityIndex, behaviorIndex,
                        { $0.action ?? "gameOver" }, { $0.action = $1 })) {
                    Text("Game over").tag("gameOver")
                    Text("Score points").tag("score")
                    Text("Win").tag("win")
                    Text("Lose a life").tag("loseLife")
                    Text("Remove the other").tag("removeOther")
                    Text("Explode the other").tag("explode")
                    Text("Damage the other").tag("damage")
                    Text("Remove self").tag("removeSelf")
                    Text("Bounce").tag("bounce")
                    Text("Run a logic flow").tag("runFlow")
                }
                .font(.caption2)
                if ["score", "removeOther", "explode", "damage"].contains(behavior.action ?? "") {
                    intRow("Points", entityIndex, behaviorIndex, get: { $0.points }, set: { $0.points = $1 })
                }
                if behavior.action == "runFlow" {
                    textRow("Flow name", behaviorBind(entityIndex, behaviorIndex,
                            { $0.flowId ?? "" }, { $0.flowId = $1.isEmpty ? nil : $1 }),
                            help: "Logic flow (by name) to fire in the preview.")
                }
                HStack {
                    Toggle("Shake", isOn: behaviorBind(entityIndex, behaviorIndex,
                            { $0.shake ?? false }, { $0.shake = $1 ? true : nil }))
                        .toggleStyle(.checkbox)
                    particlesPicker(entityIndex, behaviorIndex)
                }
                .font(.caption2)

            case "spawner":
                Picker("Spawns", selection: behaviorBind(entityIndex, behaviorIndex,
                        { $0.template ?? "" }, { $0.template = $1.isEmpty ? nil : $1 })) {
                    Text("—").tag("")
                    ForEach(spec.entities.map(\.id), id: \.self) { Text($0).tag($0) }
                }
                .font(.caption2)
                HStack {
                    numRow("Every s", entityIndex, behaviorIndex, get: { $0.interval }, set: { $0.interval = $1 })
                    numRow("Speed ←", entityIndex, behaviorIndex, get: { $0.velocityX.map(abs) }, set: { $0.velocityX = $1.map { -$0 } })
                    numRow("Gap", entityIndex, behaviorIndex, get: { $0.gapSize }, set: { $0.gapSize = $1 })
                }
                Toggle("Score when passed", isOn: behaviorBind(entityIndex, behaviorIndex,
                        { $0.scoreOnPass ?? ($0.gapSize != nil) }, { $0.scoreOnPass = $1 }))
                    .toggleStyle(.checkbox)
                    .font(.caption2)
                    .help("Award a point when the player gets past a spawned obstacle. On by default for gap pairs.")

            case "impulseOnTap", "jumpOnTap":
                numRow("Strength", entityIndex, behaviorIndex, get: { $0.strength }, set: { $0.strength = $1 })
            case "spin", "bob", "pulse":
                HStack {
                    numRow("Amount", entityIndex, behaviorIndex, get: { $0.strength }, set: { $0.strength = $1 })
                    numRow("Period", entityIndex, behaviorIndex, get: { $0.interval }, set: { $0.interval = $1 })
                }
            case "moveConstant", "patrol":
                HStack {
                    numRow("Speed x", entityIndex, behaviorIndex, get: { $0.velocityX }, set: { $0.velocityX = $1 })
                    numRow("Speed y", entityIndex, behaviorIndex, get: { $0.velocityY }, set: { $0.velocityY = $1 })
                    if behavior.type == "patrol" {
                        numRow("Leg s", entityIndex, behaviorIndex, get: { $0.interval }, set: { $0.interval = $1 })
                    }
                }
            case "followEntity":
                Picker("Follows", selection: behaviorBind(entityIndex, behaviorIndex,
                        { $0.target ?? "" }, { $0.target = $1.isEmpty ? nil : $1 })) {
                    Text("—").tag("")
                    ForEach(spec.entities.map(\.id), id: \.self) { Text($0).tag($0) }
                }
                .font(.caption2)
                numRow("Speed", entityIndex, behaviorIndex, get: { $0.strength }, set: { $0.strength = $1 })
            case "shootOnTap":
                Picker("Projectile", selection: behaviorBind(entityIndex, behaviorIndex,
                        { $0.template ?? "" }, { $0.template = $1.isEmpty ? nil : $1 })) {
                    Text("—").tag("")
                    ForEach(spec.entities.map(\.id), id: \.self) { Text($0).tag($0) }
                }
                .font(.caption2)
                HStack {
                    numRow("Speed", entityIndex, behaviorIndex, get: { $0.strength }, set: { $0.strength = $1 })
                    numRow("Cooldown", entityIndex, behaviorIndex, get: { $0.interval }, set: { $0.interval = $1 })
                }
            case "trail", "destructible":
                particlesPicker(entityIndex, behaviorIndex)
            case "slingshot":
                HStack {
                    numRow("Power", entityIndex, behaviorIndex, get: { $0.maxPower }, set: { $0.maxPower = $1 })
                    numRow("Drag", entityIndex, behaviorIndex, get: { $0.maxDrag }, set: { $0.maxDrag = $1 })
                }
            case "destroyOffscreen":
                numRow("Margin", entityIndex, behaviorIndex, get: { $0.margin }, set: { $0.margin = $1 })
            default:
                EmptyView() // rotateWithVelocity, wrapVertical, controlHorizontal need no params
            }
        }
        .padding(6)
        .background(RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(0.05)))
    }

    // MARK: - Entity/behavior plumbing

    private static let behaviorMenu: [(String, String)] = [
        ("onCollision", "When touching … → rule"),
        ("impulseOnTap", "Tap = flap up"),
        ("jumpOnTap", "Tap = jump (grounded)"),
        ("shootOnTap", "Tap = shoot projectile"),
        ("controlHorizontal", "Steer left/right"),
        ("slingshot", "Drag & launch (slingshot)"),
        ("spawner", "Spawn entities over time"),
        ("moveConstant", "Move constantly"),
        ("patrol", "Patrol back & forth"),
        ("followEntity", "Chase another entity"),
        ("rotateWithVelocity", "Tilt with movement"),
        ("spin", "Spin"),
        ("bob", "Bob up & down"),
        ("pulse", "Pulse size"),
        ("trail", "Particle trail"),
        ("destructible", "Breakable (uses health)"),
        ("destroyOffscreen", "Remove when off-screen"),
        ("wrapVertical", "Wrap top↔bottom"),
    ]

    private static func behaviorTitle(_ type: String) -> String {
        behaviorMenu.first { $0.0 == type }?.1 ?? type
    }

    private func addEntity(body: GameBodyType, circle: Bool, color: String, size: CGFloat = 48) {
        viewModel.updateSelectedNode { node in
            let n = (node.children.filter { $0.gameEntity != nil }.count) + (node.gameScene?.entities.count ?? 0) + 1
            var e = GameEntity(id: "entity\(n)", name: "Entity \(n)", color: color,
                               x: 160, y: 300, width: size, height: size,
                               body: body, circleBody: circle)
            e.affectedByGravity = body == .dynamic
            var single = node.gameScene ?? GameSceneSpec()
            single.entities = [e]
            node.children.append(contentsOf: DesignNode.entityChildren(for: single))
        }
    }

    private func addBehavior(_ type: String, to entityIndex: Int) {
        var b = GameBehavior(type: type)
        do {
            switch type {
            case "impulseOnTap": b.strength = 9
            case "jumpOnTap": b.strength = 13
            case "shootOnTap": b.strength = 500; b.interval = 0.4
            case "onCollision": b.action = "gameOver"
            case "spawner": b.interval = 2; b.velocityX = -150
            case "moveConstant": b.velocityX = -120
            case "patrol": b.velocityX = 60; b.interval = 2
            case "followEntity": b.strength = 80
            case "spin": b.strength = 90
            case "bob": b.strength = 12; b.interval = 1.6
            case "pulse": b.strength = 0.12; b.interval = 1
            case "trail": b.particles = "spark"
            case "destructible": b.particles = "debris"
            case "slingshot": b.maxPower = 900; b.maxDrag = 140
            case "destroyOffscreen": b.margin = 120
            case "controlHorizontal": b.strength = 240
            default: break
            }
        }
        mutateEntity(entityIndex) { $0.behaviors.append(b) }
    }

    private func entityBind<T>(_ index: Int,
                               _ get: @escaping (GameEntity) -> T,
                               _ set: @escaping (inout GameEntity, T) -> Void) -> Binding<T> {
        Binding(
            get: {
                if let e = spec?.entities[safeIndex: index] { return get(e) }
                return get(GameEntity(id: "", x: 0, y: 0, width: 1, height: 1))
            },
            set: { value in mutateEntity(index) { set(&$0, value) } }
        )
    }

    private func behaviorBind<T>(_ entityIndex: Int, _ behaviorIndex: Int,
                                 _ get: @escaping (GameBehavior) -> T,
                                 _ set: @escaping (inout GameBehavior, T) -> Void) -> Binding<T> {
        Binding(
            get: {
                if let b = spec?.entities[safeIndex: entityIndex]?.behaviors[safeIndex: behaviorIndex] { return get(b) }
                return get(GameBehavior(type: ""))
            },
            set: { value in mutateEntity(entityIndex) { entity in
                guard entity.behaviors.indices.contains(behaviorIndex) else { return }
                set(&entity.behaviors[behaviorIndex], value)
            } }
        )
    }

    @ViewBuilder
    private func categoryPicker(_ label: String, _ entityIndex: Int, _ behaviorIndex: Int, _ spec: GameSceneSpec,
                                get: @escaping (GameBehavior) -> String?,
                                set: @escaping (inout GameBehavior, String?) -> Void) -> some View {
        let categories = Array(Set(spec.entities.compactMap(\.category))).sorted()
        Picker(label, selection: behaviorBind(entityIndex, behaviorIndex,
                { get($0) ?? "" }, { b, v in set(&b, v.isEmpty ? nil : v) })) {
            Text("—").tag("")
            ForEach(categories, id: \.self) { Text($0).tag($0) }
        }
        .font(.caption2)
    }

    @ViewBuilder
    private func particlesPicker(_ entityIndex: Int, _ behaviorIndex: Int) -> some View {
        Picker("FX", selection: behaviorBind(entityIndex, behaviorIndex,
                { $0.particles ?? "" }, { $0.particles = $1.isEmpty ? nil : $1 })) {
            Text("None").tag("")
            ForEach(["debris", "spark", "smoke", "fire", "confetti", "hearts"], id: \.self) {
                Text($0.capitalized).tag($0)
            }
        }
        .font(.caption2)
    }

    @ViewBuilder
    private func textRow(_ label: String, _ binding: Binding<String>, help: String = "") -> some View {
        HStack {
            Text(label).font(.caption2).frame(width: 96, alignment: .leading)
            TextField("", text: binding)
                .textFieldStyle(.roundedBorder)
                .font(.caption2)
        }
        .help(help)
    }

    @ViewBuilder
    private func numRow(_ label: String, _ entityIndex: Int, _ behaviorIndex: Int,
                        get: @escaping (GameBehavior) -> CGFloat?,
                        set: @escaping (inout GameBehavior, CGFloat?) -> Void) -> some View {
        HStack(spacing: 3) {
            Text(label).font(.caption2)
            TextField("", text: behaviorBind(entityIndex, behaviorIndex,
                { b in get(b).map { String(format: "%.1f", $0) } ?? "" },
                { b, text in set(&b, Double(text).map { CGFloat($0) }) }))
                .textFieldStyle(.roundedBorder)
                .font(.caption2)
                .frame(width: 52)
        }
    }

    @ViewBuilder
    private func intRow(_ label: String, _ entityIndex: Int, _ behaviorIndex: Int,
                        get: @escaping (GameBehavior) -> Int?,
                        set: @escaping (inout GameBehavior, Int?) -> Void) -> some View {
        HStack(spacing: 3) {
            Text(label).font(.caption2)
            TextField("", text: behaviorBind(entityIndex, behaviorIndex,
                { b in get(b).map(String.init) ?? "" },
                { b, text in set(&b, Int(text)) }))
                .textFieldStyle(.roundedBorder)
                .font(.caption2)
                .frame(width: 44)
        }
    }

    private static func csv(_ text: String) -> [String] {
        text.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    // MARK: - Gameplay knobs discovered from the entities' behaviors

    private struct BehaviorKnob {
        let id: String
        let label: String
        let value: Double
        let range: ClosedRange<Double>
        let format: String
        let help: String
        let apply: (inout GameSceneSpec, Double) -> Void
    }

    private func behaviorKnobs(in spec: GameSceneSpec) -> [BehaviorKnob] {
        var knobs: [BehaviorKnob] = []
        for (entityIndex, entity) in spec.entities.enumerated() {
            let who = entity.name.isEmpty ? entity.id : entity.name
            for (behaviorIndex, behavior) in entity.behaviors.enumerated() {
                func set(_ change: @escaping (inout GameBehavior, Double) -> Void) -> (inout GameSceneSpec, Double) -> Void {
                    { [self] _, v in
                        mutateEntity(entityIndex) { entity in
                            guard entity.behaviors.indices.contains(behaviorIndex) else { return }
                            change(&entity.behaviors[behaviorIndex], v)
                        }
                    }
                }
                let id = "\(entity.id)-\(behaviorIndex)"
                switch behavior.type {
                case "impulseOnTap":
                    knobs.append(BehaviorKnob(
                        id: id, label: "Flap strength — \(who)",
                        value: Double(behavior.strength ?? 8), range: 3...22, format: "%.1f",
                        help: "How much height each tap gives. Pair with gravity to set the rhythm.",
                        apply: set { $0.strength = CGFloat($1) }
                    ))
                case "jumpOnTap":
                    knobs.append(BehaviorKnob(
                        id: id, label: "Jump strength — \(who)",
                        value: Double(behavior.strength ?? 12), range: 5...28, format: "%.1f",
                        help: "Jump height (fires only when standing on ground).",
                        apply: set { $0.strength = CGFloat($1) }
                    ))
                case "spawner":
                    knobs.append(BehaviorKnob(
                        id: id + "-interval", label: "Spawn every (s)",
                        value: Double(behavior.interval ?? 2), range: 0.6...6, format: "%.1f",
                        help: "Seconds between obstacles. Lower = harder.",
                        apply: set { $0.interval = CGFloat($1) }
                    ))
                    knobs.append(BehaviorKnob(
                        id: id + "-speed", label: "Obstacle speed",
                        value: Double(abs(behavior.velocityX ?? 150)), range: 40...420, format: "%.0f",
                        help: "How fast obstacles travel across the screen (points/second).",
                        apply: set { $0.velocityX = -CGFloat($1) }
                    ))
                    if behavior.gapSize != nil {
                        knobs.append(BehaviorKnob(
                            id: id + "-gap", label: "Gap size",
                            value: Double(behavior.gapSize ?? 180), range: 90...400, format: "%.0f",
                            help: "Opening the player flies through. Bigger = easier.",
                            apply: set { $0.gapSize = CGFloat($1) }
                        ))
                    }
                case "slingshot":
                    knobs.append(BehaviorKnob(
                        id: id, label: "Launch power — \(who)",
                        value: Double(behavior.maxPower ?? 900), range: 300...2600, format: "%.0f",
                        help: "Slingshot strength at full draw.",
                        apply: set { $0.maxPower = CGFloat($1) }
                    ))
                case "moveConstant":
                    knobs.append(BehaviorKnob(
                        id: id, label: "Speed — \(who)",
                        value: Double(behavior.velocityX ?? 0), range: -400...400, format: "%.0f",
                        help: "Constant horizontal speed (negative = leftward).",
                        apply: set { $0.velocityX = CGFloat($1) }
                    ))
                default:
                    break
                }
            }
        }
        return knobs
    }

    // MARK: - Plumbing

    private func mutate(_ change: @escaping (inout GameSceneSpec) -> Void) {
        viewModel.updateSelectedNode { node in
            guard var scene = node.gameScene else { return }
            change(&scene)
            node.gameScene = scene
        }
    }

    /// Indices of the child nodes that ARE game entities, in composed order.
    private func entityChildIndices(of node: DesignNode) -> [Int] {
        node.children.enumerated().compactMap { $0.element.gameEntity != nil ? $0.offset : nil }
    }

    /// Mutates entity `index` wherever it lives: a canvas child node (the
    /// editable representation) or the legacy embedded spec.
    private func mutateEntity(_ index: Int, _ change: @escaping (inout GameEntity) -> Void) {
        viewModel.updateSelectedNode { node in
            let kids = node.children.enumerated().compactMap { $0.element.gameEntity != nil ? $0.offset : nil }
            if kids.indices.contains(index), var entity = node.children[kids[index]].gameEntity {
                change(&entity)
                node.children[kids[index]].gameEntity = entity
            } else if node.gameScene?.entities.indices.contains(index) == true {
                change(&node.gameScene!.entities[index])
            }
        }
    }

    private func removeEntity(_ index: Int) {
        viewModel.updateSelectedNode { node in
            let kids = node.children.enumerated().compactMap { $0.element.gameEntity != nil ? $0.offset : nil }
            if kids.indices.contains(index) {
                node.children.remove(at: kids[index])
            } else if node.gameScene?.entities.indices.contains(index) == true {
                node.gameScene!.entities.remove(at: index)
            }
        }
    }

    private func bind<T>(_ get: @escaping (GameSceneSpec) -> T,
                         _ set: @escaping (inout GameSceneSpec, T) -> Void) -> Binding<T> {
        Binding(
            get: {
                if let spec { return get(spec) }
                // Unreachable in practice (section only renders with a spec).
                return get(GameSceneSpec())
            },
            set: { value in mutate { set(&$0, value) } }
        )
    }

    @ViewBuilder
    private func sliderRow(
        _ label: String, value: Double, range: ClosedRange<Double>, format: String,
        help: String, apply: @escaping (inout GameSceneSpec, Double) -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text(label).font(.caption)
                Spacer()
                Text(String(format: format, value)).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Slider(value: Binding(
                get: { value },
                set: { v in mutate { apply(&$0, v) } }
            ), in: range)
        }
        .help(help)
    }
}

// Bounds-safe array access — the inspector edits by index while entities can
// be added/removed out from under a stale view identity.
private extension Array {
    subscript(safeIndex index: Int) -> Element? {
        get { indices.contains(index) ? self[index] : nil }
        set {
            guard indices.contains(index), let newValue else { return }
            self[index] = newValue
        }
    }
}
