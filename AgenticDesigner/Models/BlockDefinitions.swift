//
//  BlockDefinitions.swift
//  AgenticDesigner
//
//  Static catalog defining appearance, default parameters and port
//  configuration for every logic block type. The Block Palette renders
//  these as draggable templates.
//

import Foundation

struct BlockDefinition {
    let type: LogicBlockType
    let category: LogicBlockCategory
    let label: String
    let icon: String
    let color: String
    let description: String
    let defaultParameters: [BlockParameter]
    let inputPortCount: Int
    let outputPortCount: Int
    let outputPortLabels: [String]?
}

enum BlockCatalog {

    static func definition(for type: LogicBlockType) -> BlockDefinition? {
        byType[type]
    }

    static func definitions(in category: LogicBlockCategory) -> [BlockDefinition] {
        all.filter { $0.category == category }
    }

    static func color(for category: LogicBlockCategory) -> String {
        switch category {
        case .event: return "#10B981"
        case .action: return "#3B82F6"
        case .condition: return "#F59E0B"
        case .api: return "#8B5CF6"
        case .firebase: return "#F97316"
        case .variable: return "#6B7280"
        case .ui: return "#14B8A6"
        case .storage: return "#0EA5E9"
        case .device: return "#EC4899"
        }
    }

    static func makeBlock(type: LogicBlockType, at point: CGPoint) -> LogicBlock? {
        guard let def = definition(for: type) else { return nil }
        return LogicBlock(
            type: def.type,
            category: def.category,
            label: def.label,
            x: point.x,
            y: point.y,
            parameters: def.defaultParameters
        )
    }

    private static let byType: [LogicBlockType: BlockDefinition] = {
        Dictionary(uniqueKeysWithValues: all.map { ($0.type, $0) })
    }()

    // MARK: - Helpers

    private static func def(
        _ type: LogicBlockType,
        _ category: LogicBlockCategory,
        _ label: String,
        _ icon: String,
        _ description: String,
        params: [BlockParameter] = [],
        inputs: Int = 1,
        outputs: Int = 1,
        outputLabels: [String]? = nil
    ) -> BlockDefinition {
        BlockDefinition(
            type: type,
            category: category,
            label: label,
            icon: icon,
            color: color(for: category),
            description: description,
            defaultParameters: params,
            inputPortCount: inputs,
            outputPortCount: outputs,
            outputPortLabels: outputLabels
        )
    }

    private static func p(
        _ key: String,
        _ label: String,
        _ type: ParameterType,
        value: String? = nil,
        required: Bool = true,
        placeholder: String? = nil,
        options: [String]? = nil
    ) -> BlockParameter {
        BlockParameter(
            key: key,
            label: label,
            type: type,
            value: value,
            isRequired: required,
            placeholder: placeholder,
            options: options
        )
    }

    private static let successError = ["✓ Success", "✗ Error"]

    // MARK: - Catalog

    static let all: [BlockDefinition] = [

        // ── Events ─────────────────────────────────────────────
        def(.onTap, .event, "On Tap", "hand.tap",
            "Triggers when the user taps the connected UI element",
            params: [p("element", "Element", .nodeReference, placeholder: "Select a button or element...")],
            inputs: 0),
        def(.onDoubleTap, .event, "On Double Tap", "hand.tap.fill",
            "Triggers when the user double-taps the connected element",
            params: [p("element", "Element", .nodeReference)],
            inputs: 0),
        def(.onLongPress, .event, "On Long Press", "hand.raised",
            "Triggers when the user long-presses the connected element",
            params: [p("element", "Element", .nodeReference)],
            inputs: 0),
        def(.onSwipe, .event, "On Swipe", "hand.draw",
            "Triggers on a swipe gesture over the connected element",
            params: [
                p("element", "Element", .nodeReference),
                p("direction", "Direction", .dropdown, value: "left", options: ["left", "right", "up", "down"])
            ],
            inputs: 0),
        def(.onScreenLoad, .event, "On Screen Load", "bolt.circle",
            "Triggers when the screen appears",
            inputs: 0),
        def(.onScreenDisappear, .event, "On Screen Disappear", "bolt.slash",
            "Triggers when the screen disappears",
            inputs: 0),
        def(.onAppLaunch, .event, "App Launch", "app.badge",
            "Triggers when the exported app starts",
            inputs: 0),
        def(.onScreenOpened, .event, "Screen Opened", "rectangle.portrait.on.rectangle.portrait",
            "Triggers when the preview or exported app opens this screen",
            inputs: 0),
        def(.onChange, .event, "On Change", "pencil.line",
            "Triggers when an input field or variable value changes",
            params: [p("source", "Watch", .nodeReference, placeholder: "Input field or variable...")],
            inputs: 0),
        def(.onSubmit, .event, "On Submit", "return",
            "Triggers when an input submits",
            params: [p("element", "Input", .nodeReference)],
            inputs: 0),
        def(.onGameOver, .event, "On Game Over", "gamecontroller",
            "Fires when a game on this screen ends in game-over — wire what happens next (save score, navigate, ...)",
            inputs: 0),
        def(.onGameWin, .event, "On Game Win", "trophy",
            "Fires when a game on this screen is won",
            inputs: 0),
        def(.onGameScore, .event, "On Game Score", "number.circle",
            "Fires every time the game score changes; the current score is in the gameScore variable",
            inputs: 0),
        def(.onGameCollision, .event, "On Game Collision", "circle.grid.cross",
            "Fires when two game categories touch (leave a field empty to match any)",
            params: [
                p("categoryA", "Category A", .string, required: false),
                p("categoryB", "Category B", .string, required: false)
            ],
            inputs: 0),
        def(.onGameStart, .event, "On Game Start", "play.circle",
            "Fires when the game begins (first tap after the start overlay)",
            inputs: 0),
        def(.onGameLifeLost, .event, "On Life Lost", "heart.slash",
            "Fires when the player loses a life (remaining lives are in gameLives)",
            inputs: 0),
        def(.onGameSpawned, .event, "On Entity Spawned", "sparkle",
            "Fires when a spawner creates an entity — filter by category, empty = any",
            params: [p("category", "Category", .string, required: false)],
            inputs: 0),
        def(.onGameImpact, .event, "On Impact", "burst",
            "Fires when two categories collide WITH FORCE — gameImpactForce holds how hard (use minForce to ignore light taps). This is what drives realistic destruction",
            params: [
                p("categoryA", "Category A", .string, required: false),
                p("categoryB", "Category B", .string, required: false),
                p("minForce", "Min force", .string, value: "0", required: false)
            ],
            inputs: 0),
        def(.onGameLaunched, .event, "On Launched", "figure.archery",
            "Fires the moment a slingshot shot is released — gameLaunched holds the entity id",
            inputs: 0),
        def(.onGameTap, .event, "On Game Tap", "hand.tap.fill",
            "Fires when the player taps inside the game — the position lands in gameTapX / gameTapY",
            inputs: 0),
        def(.onGameDrag, .event, "On Game Drag", "hand.draw.fill",
            "Fires while the player drags in the game (phase start/move/end in gameDragPhase; position in gameDragX / gameDragY)",
            params: [p("phase", "Phase", .dropdown, value: "move", options: ["start", "move", "end", "any"])],
            inputs: 0),
        def(.onGameEntityDestroyed, .event, "On Entity Destroyed", "burst",
            "Fires when a game entity is destroyed (removed by collision, explosion or health) — filter by category, empty = any",
            params: [p("category", "Category", .string, required: false)],
            inputs: 0),
        def(.onTimer, .event, "On Timer", "timer",
            "Fires after a delay, optionally repeating",
            params: [
                p("seconds", "Seconds", .number, value: "1"),
                p("repeats", "Repeats", .boolean, value: "false", required: false)
            ],
            inputs: 0),
        def(.onWatchAction, .event, "Watch Action", "applewatch.radiowaves.left.and.right",
            "Triggers from a watchOS action or complication entry point",
            params: [p("name", "Action Name", .string, value: "watchAction")],
            inputs: 0),
        def(.customEvent, .event, "Custom Event", "sparkles",
            "Named event that can be triggered by generated code",
            params: [p("name", "Event Name", .string, value: "customEvent")],
            inputs: 0),

        // ── Actions ────────────────────────────────────────────
        def(.navigate, .action, "Navigate", "arrow.right.circle",
            "Push a different screen",
            params: [p("screen", "Screen", .screenReference, placeholder: "Select target screen...")]),
        def(.goBack, .action, "Go Back", "arrow.left.circle",
            "Pop the current screen"),
        def(.presentSheet, .action, "Present Sheet", "rectangle.portrait.bottomhalf.inset.filled",
            "Show a screen as a modal sheet",
            params: [p("screen", "Screen", .screenReference)]),
        def(.dismissSheet, .action, "Dismiss Sheet", "rectangle.portrait.slash",
            "Dismiss the current modal sheet"),
        def(.showAlert, .action, "Show Alert", "exclamationmark.bubble",
            "Show an alert dialog",
            params: [
                p("title", "Title", .string, placeholder: "Alert title"),
                p("message", "Message", .string, required: false, placeholder: "Alert message")
            ]),
        def(.showToast, .action, "Show Toast", "text.bubble",
            "Show a brief toast message",
            params: [p("message", "Message", .string)]),
        def(.openURL, .action, "Open URL", "safari",
            "Open an external URL",
            params: [p("url", "URL", .url, placeholder: "https://...")]),
        def(.copyToClipboard, .action, "Copy to Clipboard", "doc.on.doc",
            "Copy text to the clipboard",
            params: [p("text", "Text", .string)]),
        def(.hapticFeedback, .action, "Haptic", "iphone.radiowaves.left.and.right",
            "Trigger haptic feedback",
            params: [p("style", "Style", .dropdown, value: "light", options: ["light", "medium", "heavy", "success", "warning", "error"])]),
        def(.delay, .action, "Delay", "clock",
            "Wait N seconds before the next block",
            params: [p("seconds", "Seconds", .number, value: "1")]),
        def(.log, .action, "Log", "terminal",
            "Console log for debugging",
            params: [p("message", "Message", .string)]),
        def(.startTimer, .action, "Start Timer", "timer.circle",
            "Start a named repeating timer — each tick fires the Custom Event with the same name",
            params: [
                p("name", "Timer", .string, value: "mainTimer"),
                p("seconds", "Seconds", .number, value: "1")
            ]),
        def(.stopTimer, .action, "Stop Timer", "timer.circle.fill",
            "Stop a named timer",
            params: [p("name", "Timer", .string, value: "mainTimer")]),
        def(.saveValue, .action, "Save Value", "externaldrive.badge.checkmark",
            "Persist a lightweight value in app storage",
            params: [
                p("key", "Key", .string),
                p("value", "Value", .string)
            ]),
        def(.loadValue, .variable, "Load Value", "externaldrive.badge.plus",
            "Read a value saved earlier with Save Value into a variable. On first run (nothing saved yet) it uses Default. This is the READ side of persistence — Save Value only writes",
            params: [
                p("key", "Key", .string),
                p("variable", "Store In", .variable),
                p("default", "Default", .string, required: false)
            ]),
        def(.customAction, .action, "Custom Action", "function",
            "Named action hook for custom generated code",
            params: [p("name", "Action Name", .string, value: "customAction")]),
        def(.confirmDialog, .action, "Confirm Dialog", "questionmark.bubble",
            "Ask the user to confirm or cancel before continuing",
            params: [
                p("title", "Title", .string, placeholder: "Are you sure?"),
                p("message", "Message", .string, required: false),
                p("confirmLabel", "Confirm Label", .string, value: "Confirm", required: false),
                p("cancelLabel", "Cancel Label", .string, value: "Cancel", required: false)
            ],
            outputs: 2, outputLabels: ["Confirmed", "Cancelled"]),
        def(.shareContent, .action, "Share", "square.and.arrow.up",
            "Present the system share sheet with text, a URL, or both",
            params: [
                p("text", "Text", .string, required: false),
                p("url", "URL", .url, required: false)
            ]),
        def(.sendEmail, .action, "Send Email", "envelope",
            "Present the mail composer, or open mailto: if Mail isn't configured",
            params: [
                p("to", "To", .string, placeholder: "person@example.com"),
                p("subject", "Subject", .string, required: false),
                p("body", "Body", .string, required: false)
            ]),
        def(.callNumber, .action, "Call Number", "phone",
            "Open the Phone app to dial a number",
            params: [p("number", "Phone Number", .string, placeholder: "+1 555 0100")]),
        def(.sendSMS, .action, "Send SMS", "message",
            "Present the Messages composer with a prefilled number and body",
            params: [
                p("number", "Phone Number", .string, placeholder: "+1 555 0100"),
                p("body", "Message", .string, required: false)
            ]),
        def(.launchMaps, .action, "Launch Maps", "map",
            "Open Apple Maps with a search query or address",
            params: [p("query", "Address or Query", .string, placeholder: "1 Infinite Loop, Cupertino")]),
        def(.requestPermission, .action, "Request Permission", "checkmark.shield",
            "Ask the user for a system permission",
            params: [p("kind", "Permission", .dropdown, value: "camera", options: ["camera", "photoLibrary", "location", "microphone", "notifications", "health", "motion"])],
            outputs: 2, outputLabels: ["Granted", "Denied"]),
        def(.biometricAuth, .action, "Biometric Auth", "faceid",
            "Authenticate the user with Face ID / Touch ID",
            params: [p("reason", "Reason", .string, value: "Authenticate to continue")],
            outputs: 2, outputLabels: successError),
        def(.scheduleLocalNotification, .action, "Local Notification", "bell.badge",
            "Schedule a local notification after a delay",
            params: [
                p("title", "Title", .string),
                p("body", "Body", .string, required: false),
                p("seconds", "Delay (seconds)", .number, value: "5"),
                p("repeats", "Repeat", .dropdown, value: "false", required: false, options: ["false", "true"])
            ]),
        def(.scheduleNotificationAt, .action, "Alarm Notification", "alarm",
            "Schedule a daily local notification at an exact hour:minute (real alarm — fires even when the app is closed)",
            params: [
                p("title", "Title", .string, value: "Alarm"),
                p("body", "Body", .string, required: false),
                p("hour", "Hour (0-23)", .string, value: "6"),
                p("minute", "Minute (0-59)", .string, value: "30")
            ]),
        def(.setBadgeCount, .action, "Set Badge Count", "app.badge",
            "Set the app icon's badge number",
            params: [p("count", "Count", .number, value: "0")]),
        def(.gameQuery, .variable, "Game: Read", "eye",
            "Read live game state into a variable: positionX/positionY/health (entity id), count (category), score, lives, timeLeft",
            params: [
                p("what", "Read", .dropdown, value: "count", options: ["positionX", "positionY", "velocityX", "velocityY", "rotation", "health", "count", "score", "lives", "timeLeft"]),
                p("target", "Entity id / category", .string, required: false),
                p("variable", "Store In", .variable)
            ]),
        def(.gameSetVelocity, .action, "Game: Velocity", "speedometer",
            "Set an entity's exact velocity (design coords: +Y is down)",
            params: [
                p("entity", "Entity id", .string),
                p("vx", "Velocity X", .string, value: "0"),
                p("vy", "Velocity Y (down+)", .string, value: "0")
            ]),
        def(.gameSetProperty, .action, "Game: Set Property", "paintbrush.pointed",
            "Change an entity's look live: sprite (path), color (#hex), width, height, rotation (deg), opacity (0-1)",
            params: [
                p("entity", "Entity id", .string),
                p("property", "Property", .dropdown, value: "color", options: ["sprite", "color", "width", "height", "rotation", "opacity"]),
                p("value", "Value", .string)
            ]),
        def(.gameAnimate, .action, "Game: Animate", "arrow.triangle.swap",
            "Glide an entity to x/y over duration seconds (eased tween)",
            params: [
                p("entity", "Entity id", .string),
                p("x", "X", .string, value: "100"),
                p("y", "Y", .string, value: "100"),
                p("duration", "Seconds", .string, value: "0.6")
            ]),
        def(.gameAddBehavior, .action, "Game: Add Behavior", "puzzlepiece.extension",
            "Attach ANY behavior to an entity mid-game, as JSON — e.g. {\"type\":\"spin\",\"strength\":180} or {\"type\":\"autoFire\",\"template\":\"bolt\",\"interval\":0.2}",
            params: [
                p("entity", "Entity id", .string),
                p("behavior", "Behavior JSON", .string)
            ]),
        def(.gameRemoveBehavior, .action, "Game: Remove Behavior", "puzzlepiece",
            "Detach a behavior type from an entity (e.g. stop its spawner / autoFire / spin)",
            params: [
                p("entity", "Entity id", .string),
                p("behaviorType", "Behavior type", .string)
            ]),
        def(.gameSetHealth, .action, "Game: Set Health", "cross.case",
            "Set an entity's health points",
            params: [
                p("entity", "Entity id", .string),
                p("health", "Health", .string, value: "3")
            ]),
        def(.gameShake, .action, "Game: Shake", "waveform.path",
            "Shake the camera (impact / drama)",
            params: [p("intensity", "Intensity", .string, value: "10")]),
        def(.gameParticles, .action, "Game: Particles", "sparkles",
            "Burst particles at x/y: debris, spark, smoke, fire, confetti, hearts",
            params: [
                p("kind", "Kind", .dropdown, value: "confetti", options: ["debris", "spark", "smoke", "fire", "confetti", "hearts"]),
                p("x", "X", .string, value: "195"),
                p("y", "Y", .string, value: "300"),
                p("burst", "Amount", .string, value: "40")
            ]),
        def(.gameSetTimeScale, .action, "Game: Time Scale", "timelapse",
            "Slow motion / fast forward: 0.3 = slow-mo, 1 = normal, 2 = double speed",
            params: [p("scale", "Scale", .string, value: "0.5")]),
        def(.gameSetSpawnRate, .action, "Game: Spawn Rate", "clock.arrow.2.circlepath",
            "Set every spawner's interval in seconds (live difficulty control)",
            params: [p("interval", "Seconds between spawns", .string, value: "1.0")]),
        def(.gameSetLives, .action, "Game: Set Lives", "heart.circle",
            "Set the player's remaining lives",
            params: [p("lives", "Lives", .string, value: "3")]),
        def(.gameRestart, .action, "Game: Restart", "arrow.counterclockwise.circle",
            "Rebuild the scene from scratch (fresh run)"),
        def(.gameLoadSlingshot, .action, "Game: Load Slingshot", "arrow.uturn.backward.circle",
            "Put a bird/projectile back on the slingshot (recreates it if the last shot flew away) — this is how a level gets several shots",
            params: [p("entity", "Entity id", .string)]),
        def(.gameMotor, .action, "Game: Throttle", "gauge.high",
            "Drive a bike's wheels. 1 = full forward, -1 = reverse/brake, 0 = coast. Holds until changed",
            params: [
                p("entity", "Bike entity id", .string),
                p("throttle", "Throttle (-1…1)", .string, value: "1")
            ]),
        def(.gameTorque, .action, "Game: Lean", "arrow.clockwise",
            "Spin the chassis mid-air — positive leans back (wheelie/backflip), negative leans forward",
            params: [
                p("entity", "Entity id", .string),
                p("amount", "Lean force", .string, value: "40")
            ]),
        def(.gameDamage, .action, "Game: Damage", "bolt.heart",
            "Deal damage to an entity — it dies (with debris) when health runs out",
            params: [
                p("entity", "Entity id", .string),
                p("amount", "Amount", .string, value: "1")
            ]),
        def(.gameLaunch, .action, "Game: Launch", "paperplane.fill",
            "Throw an entity at an angle — Angry-Birds style. Angle in degrees: 0 = right, 90 = up, 180 = left, 45 = up-right arc. Strength is launch speed in points/sec (900 ≈ 340pt range, 1300 ≈ 700pt)",
            params: [
                p("entity", "Entity id", .string),
                p("angle", "Angle (deg)", .string, value: "60"),
                p("strength", "Speed (pt/s)", .string, value: "900")
            ]),
        def(.gameSetPhysics, .action, "Game: Physics", "atom",
            "Change an entity's physics live: bounciness (0-1), friction, damping, mass, rotation (true/false), gravity (true/false), bodyType (dynamic/static/kinematic)",
            params: [
                p("entity", "Entity id", .string),
                p("property", "Property", .dropdown, value: "bounciness", options: ["bounciness", "friction", "damping", "mass", "rotation", "gravity", "bodyType"]),
                p("value", "Value", .string)
            ]),
        def(.gameSpawn, .action, "Game: Spawn", "plus.viewfinder",
            "Spawn a game entity from a template at x/y (design coords)",
            params: [
                p("template", "Template entity id", .string),
                p("x", "X", .string, value: "100"),
                p("y", "Y", .string, value: "100")
            ]),
        def(.gameRemove, .action, "Game: Remove", "minus.circle",
            "Remove game entities by id or category",
            params: [p("target", "Entity id / category", .string)]),
        def(.gameImpulse, .action, "Game: Impulse", "arrow.up.right.circle",
            "Push a physics entity (dx right, dy up-positive in design terms)",
            params: [
                p("entity", "Entity id", .string),
                p("dx", "Force X", .string, value: "0"),
                p("dy", "Force Y (up)", .string, value: "-8")
            ]),
        def(.gameMove, .action, "Game: Move", "arrow.up.and.down.and.arrow.left.and.right",
            "Teleport an entity to x/y (design coords)",
            params: [
                p("entity", "Entity id", .string),
                p("x", "X", .string, value: "100"),
                p("y", "Y", .string, value: "100")
            ]),
        def(.gameSetGravity, .action, "Game: Gravity", "arrow.down.to.line",
            "Change the scene gravity live. Vertical: negative pulls down (-18). Sideways adds wind/space drift; 0/0 = zero-G top-down games",
            params: [
                p("gravity", "Vertical (neg = down)", .string, value: "-18"),
                p("gravityX", "Sideways", .string, value: "0", required: false)
            ]),
        def(.gameAddScore, .action, "Game: Add Score", "plus.square",
            "Add points to the running game's score",
            params: [p("points", "Points", .string, value: "1")]),
        def(.gameEnd, .action, "Game: End", "flag.checkered",
            "End the running game",
            params: [p("result", "Result", .dropdown, value: "gameOver", options: ["gameOver", "win"])]),
        def(.gamePause, .action, "Game: Pause", "pause.circle",
            "Pause or resume the running game",
            params: [p("mode", "Mode", .dropdown, value: "pause", options: ["pause", "resume"])]),
        def(.ringAlarm, .action, "Ring Alarm", "bell.and.waves.left.and.right",
            "Start a looping alarm ring (synthesized — no sound file needed). Styles: classic, beep, pulse. Stop Sound stops it.",
            params: [
                p("style", "Ringtone", .string, value: "classic"),
                p("duration", "Auto-stop after (s, 0 = ring until stopped)", .string, value: "0", required: false)
            ]),
        def(.playSound, .action, "Play Sound", "speaker.wave.2",
            "Play a bundled audio file (add it to the export's Resources folder)",
            params: [p("file", "File Name", .string, placeholder: "chime.mp3")]),
        def(.stopSound, .action, "Stop Sound", "speaker.slash",
            "Stop any currently playing sound started by Play Sound"),
        def(.validateForm, .action, "Validate Field", "checkmark.rectangle",
            "Validate one field against a rule; chain several for a whole form",
            params: [
                p("element", "Field", .nodeReference, placeholder: "Select an input..."),
                p("rule", "Rule", .dropdown, value: "notEmpty", options: ["notEmpty", "email", "minLength", "matchesRegex"]),
                p("argument", "Argument", .string, required: false, placeholder: "e.g. 8 for minLength, a pattern for regex")
            ],
            outputs: 2, outputLabels: ["Valid", "Invalid"]),
        def(.clearField, .action, "Clear Field", "xmark.rectangle",
            "Reset an input's text (and any bound variable) to empty",
            params: [p("element", "Field", .nodeReference)]),
        def(.executeCustomCode, .action, "Custom Code", "chevron.left.forwardslash.chevron.right",
            "Insert raw Swift statements directly into the generated action",
            params: [p("code", "Swift Code", .string, placeholder: "state.someValue = 42")]),
        def(.setDarkModeOverride, .action, "Set Dark Mode", "circle.lefthalf.filled",
            "Force the app's color scheme, or follow the system setting",
            params: [p("mode", "Mode", .dropdown, value: "system", options: ["system", "light", "dark"])]),
        def(.downloadFile, .action, "Download File", "arrow.down.circle",
            "Download a remote file to the app's Documents folder",
            params: [
                p("url", "URL", .url, placeholder: "https://example.com/file.pdf"),
                p("variable", "Store Local Path In", .variable)
            ],
            outputs: 2, outputLabels: successError),

        // ── Conditions ─────────────────────────────────────────
        def(.ifCondition, .condition, "If / Else", "arrow.triangle.branch",
            "Branch the flow based on a condition",
            params: [
                p("leftValue", "Value", .variable),
                p("operator", "Operator", .dropdown, value: "==", options: ["==", "!=", "<", ">", "<=", ">=", "contains", "isEmpty"]),
                p("rightValue", "Compare To", .string, required: false)
            ],
            outputs: 2, outputLabels: ["Then ✓", "Else ✗"]),
        def(.switchCase, .condition, "Switch", "arrow.triangle.swap",
            "Multi-branch switch on a value",
            params: [
                p("value", "Value", .variable),
                p("cases", "Cases (comma-separated)", .string, placeholder: "a, b, c")
            ],
            outputs: 3, outputLabels: ["Case 1", "Case 2", "Default"]),
        def(.compare, .condition, "Compare", "equal.circle",
            "Compare two values and output a boolean",
            params: [
                p("left", "Left", .string),
                p("operator", "Operator", .dropdown, value: "==", options: ["==", "!=", "<", ">", "<=", ">="]),
                p("right", "Right", .string)
            ]),
        def(.logicalAnd, .condition, "AND", "circle.grid.2x1",
            "True when both inputs are true",
            params: [p("a", "A", .variable), p("b", "B", .variable)]),
        def(.logicalOr, .condition, "OR", "circle.grid.2x1.fill",
            "True when either input is true",
            params: [p("a", "A", .variable), p("b", "B", .variable)]),
        def(.logicalNot, .condition, "NOT", "exclamationmark.circle",
            "Negate a boolean",
            params: [p("value", "Value", .variable)]),
        def(.isEmpty, .condition, "Is Empty", "circle.dashed",
            "Check whether a string or array is empty",
            params: [p("value", "Value", .variable)],
            outputs: 2, outputLabels: ["Empty", "Not Empty"]),
        def(.contains, .condition, "Contains", "magnifyingglass.circle",
            "Check whether a string contains a substring",
            params: [
                p("value", "Value", .variable),
                p("substring", "Substring", .string)
            ],
            outputs: 2, outputLabels: ["Yes", "No"]),
        def(.platformCondition, .condition, "Platform", "iphone.and.arrow.forward",
            "Branch by the active export or preview platform",
            params: [
                p("platform", "Platform", .dropdown, value: "iPhone", options: AppPlatform.allCases.map(\.rawValue))
            ],
            outputs: 2, outputLabels: ["Matches", "Other"]),

        // ── API ────────────────────────────────────────────────
        def(.httpRequest, .api, "HTTP Request", "network",
            "Make an HTTP request to a REST API endpoint",
            params: [
                p("url", "URL", .url, placeholder: "https://api.example.com/users"),
                p("method", "Method", .httpMethod, value: "GET", options: ["GET", "POST", "PUT", "PATCH", "DELETE"]),
                p("headers", "Headers", .keyValue, required: false),
                p("body", "Body (JSON)", .string, required: false, placeholder: "{\"key\": \"value\"}")
            ],
            outputs: 2, outputLabels: successError),
        def(.setRequestHeader, .api, "Set Header", "list.bullet.rectangle",
            "Add or set a header on the next request",
            params: [
                p("key", "Header", .string, placeholder: "Authorization"),
                p("value", "Value", .string, placeholder: "Bearer {{token}}")
            ], outputs: 2, outputLabels: successError),
        def(.setRequestBody, .api, "Set Body", "doc.text",
            "Set the JSON body for the next request",
            params: [p("body", "Body (JSON)", .string, placeholder: "{\"name\": \"{{userName}}\"}")], outputs: 2, outputLabels: successError),
        def(.parseJSONResponse, .api, "Parse JSON", "curlybraces",
            "Extract a value from a JSON response into a variable",
            params: [
                p("path", "JSON Path", .jsonPath, placeholder: "data.user.name"),
                p("variable", "Store In", .variable)
            ], outputs: 2, outputLabels: successError),
        def(.handleAPIError, .api, "Handle Error", "exclamationmark.octagon",
            "Handle HTTP error codes",
            params: [p("codes", "Status Codes", .string, value: "4xx,5xx", required: false)],
            outputs: 2, outputLabels: ["Handled", "Rethrow"]),
        def(.buildURL, .api, "Build URL", "link",
            "Construct a URL with path params and query strings",
            params: [
                p("base", "Base URL", .url, placeholder: "https://api.example.com"),
                p("path", "Path", .string, placeholder: "/users/{userId}"),
                p("query", "Query Params", .keyValue, required: false),
                p("variable", "Store In", .variable)
            ], outputs: 2, outputLabels: successError),

        // ── Commerce & Push ────────────────────────────────────
        def(.purchaseProduct, .api, "Purchase (StoreKit)", "cart",
            "Buy an in-app product or subscription with StoreKit 2. Success = paid & verified.",
            params: [
                p("productId", "Product ID", .string, placeholder: "com.app.pro.monthly"),
                p("variable", "Store Result In", .variable, required: false)
            ], outputs: 2, outputLabels: successError),
        def(.restorePurchases, .api, "Restore Purchases", "arrow.clockwise.circle",
            "Restore the user's previous StoreKit purchases. Success = at least one entitlement is active.",
            outputs: 2, outputLabels: successError),
        def(.registerForPush, .api, "Register for Push", "bell.badge",
            "Ask for notification permission and register with APNs. Success stores the device token.",
            params: [
                p("variable", "Store Token In", .variable, required: false)
            ], outputs: 2, outputLabels: successError),

        // ── Firebase Auth ──────────────────────────────────────
        def(.firebaseLogin, .firebase, "Firebase Login", "person.badge.key",
            "Sign in with email and password using Firebase Authentication",
            params: [
                p("email", "Email", .nodeReference, placeholder: "Select email input field..."),
                p("password", "Password", .nodeReference, placeholder: "Select password input field...")
            ],
            outputs: 2, outputLabels: successError),
        def(.firebaseRegister, .firebase, "Firebase Register", "person.badge.plus",
            "Create a new account with email and password",
            params: [
                p("email", "Email", .nodeReference),
                p("password", "Password", .nodeReference)
            ],
            outputs: 2, outputLabels: successError),
        def(.firebaseLogout, .firebase, "Firebase Logout", "rectangle.portrait.and.arrow.right",
            "Sign out the current user",
            outputs: 2, outputLabels: successError),
        def(.firebaseGetCurrentUser, .firebase, "Current User", "person.crop.circle",
            "Get the currently signed-in user's info",
            params: [p("variable", "Store In", .variable)],
            outputs: 2, outputLabels: ["Signed In", "Signed Out"]),
        def(.firebaseResetPassword, .firebase, "Reset Password", "key.horizontal",
            "Send a password reset email",
            params: [p("email", "Email", .nodeReference)],
            outputs: 2, outputLabels: successError),
        def(.firebaseDeleteAccount, .firebase, "Delete Account", "person.badge.minus",
            "Delete the current user's account",
            outputs: 2, outputLabels: successError),
        def(.firebaseUpdateProfile, .firebase, "Update Profile", "person.text.rectangle",
            "Update the user's display name or photo URL",
            params: [
                p("displayName", "Display Name", .string, required: false),
                p("photoURL", "Photo URL", .url, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.firebaseAuthStateChanged, .firebase, "Auth State Changed", "person.wave.2",
            "Listen for sign-in / sign-out state changes",
            inputs: 0, outputs: 2, outputLabels: ["Signed In", "Signed Out"]),

        // ── Firestore ──────────────────────────────────────────
        def(.firestoreAddDocument, .firebase, "Add Document", "plus.rectangle.on.folder",
            "Add a new document with an auto-generated ID",
            params: [
                p("collection", "Collection", .firebasePath, placeholder: "users"),
                p("data", "Data Fields", .keyValue)
            ],
            outputs: 2, outputLabels: ["✓ Saved", "✗ Error"]),
        def(.firestoreSetDocument, .firebase, "Save to Firestore", "tray.and.arrow.down",
            "Save or overwrite a document in a Firestore collection",
            params: [
                p("collection", "Collection", .firebasePath, placeholder: "users"),
                p("documentId", "Document ID", .string, required: false, placeholder: "Leave empty for auto-ID"),
                p("data", "Data Fields", .keyValue)
            ],
            outputs: 2, outputLabels: ["✓ Saved", "✗ Error"]),
        def(.firestoreGetDocument, .firebase, "Get Document", "tray.and.arrow.up",
            "Read a single document",
            params: [
                p("path", "Document Path", .firebasePath, placeholder: "users/{userId}"),
                p("variable", "Store In", .variable)
            ],
            outputs: 2, outputLabels: successError),
        def(.firestoreUpdateDocument, .firebase, "Update Document", "square.and.pencil",
            "Update specific fields of a document",
            params: [
                p("path", "Document Path", .firebasePath),
                p("data", "Fields", .keyValue)
            ],
            outputs: 2, outputLabels: successError),
        def(.firestoreDeleteDocument, .firebase, "Delete Document", "trash",
            "Delete a document",
            params: [p("path", "Document Path", .firebasePath)],
            outputs: 2, outputLabels: successError),
        def(.firestoreQuery, .firebase, "Query Collection", "line.3.horizontal.decrease.circle",
            "Query a collection with filters",
            params: [
                p("collection", "Collection", .firebasePath),
                p("where", "Where", .string, required: false, placeholder: "status == active"),
                p("orderBy", "Order By", .string, required: false),
                p("limit", "Limit", .number, required: false),
                p("variable", "Store In", .variable)
            ],
            outputs: 2, outputLabels: successError),
        def(.firestoreListenDocument, .firebase, "Listen to Document", "dot.radiowaves.left.and.right",
            "Real-time listener on a document",
            params: [
                p("path", "Document Path", .firebasePath),
                p("variable", "Store In", .variable)
            ],
            outputs: 2, outputLabels: ["Changed", "✗ Error"]),
        def(.firestoreListenQuery, .firebase, "Listen to Query", "antenna.radiowaves.left.and.right",
            "Real-time listener on a query",
            params: [
                p("collection", "Collection", .firebasePath),
                p("where", "Where", .string, required: false),
                p("variable", "Store In", .variable)
            ],
            outputs: 2, outputLabels: ["Changed", "✗ Error"]),
        def(.firestoreBatchWrite, .firebase, "Batch Write", "square.stack.3d.up",
            "Batch multiple writes into one atomic commit",
            params: [p("description", "Writes", .string, placeholder: "Describe the batched writes")],
            outputs: 2, outputLabels: successError),

        // ── Data & Backends (Supabase / SQLite / Algolia / Analytics) ──
        // MARK: Device & sensors
        def(.startTracking, .device, "Start Tracking", "figure.run.circle.fill",
            "Begin a live activity: continuously track distance and pace, filtering GPS noise, even with the screen locked",
            params: [
                p("distanceVariable", "Distance (m) Into", .variable, required: false),
                p("speedVariable", "Speed (km/h) Into", .variable, required: false),
                p("background", "Track In Background", .dropdown, value: "true", required: false, options: ["true", "false"])
            ],
            outputs: 2, outputLabels: successError),
        def(.stopTracking, .device, "Stop Tracking", "stop.circle.fill",
            "End the live activity. The final distance and pace stay in their variables.",
            params: [],
            outputs: 1),
        def(.getLocation, .device, "Get Location", "location.fill",
            "Read the device's current GPS position once (asks permission if needed)",
            params: [
                p("latitudeVariable", "Latitude Into", .variable, required: false),
                p("longitudeVariable", "Longitude Into", .variable, required: false),
                p("accuracy", "Accuracy", .string, required: false, placeholder: "best | balanced | low")
            ],
            outputs: 2, outputLabels: successError),
        def(.onLocationChanged, .event, "On Location Changed", "location.circle",
            "Runs whenever the device moves (live location updates)",
            params: [
                p("latitudeVariable", "Latitude Into", .variable, required: false),
                p("longitudeVariable", "Longitude Into", .variable, required: false),
                p("minimumMeters", "Minimum Distance (m)", .number, required: false, placeholder: "50")
            ],
            outputs: 1),
        def(.readMotion, .device, "Read Motion", "gyroscope",
            "Read the accelerometer / gyroscope (iPhone, iPad, Watch)",
            params: [
                p("xVariable", "X Into", .variable, required: false),
                p("yVariable", "Y Into", .variable, required: false),
                p("zVariable", "Z Into", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.readHeartRate, .device, "Read Heart Rate", "heart.fill",
            "Read the latest heart rate from HealthKit (Apple Watch)",
            params: [
                p("variable", "Store BPM In", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.readStepCount, .device, "Read Step Count", "figure.walk",
            "Read today's step count from the pedometer / HealthKit",
            params: [
                p("variable", "Store Steps In", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.readBatteryLevel, .device, "Read Battery Level", "battery.75",
            "Read the battery level (0–100) and charging state",
            params: [
                p("variable", "Store Level In", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.onShake, .event, "On Shake", "iphone.gen3.radiowaves.left.and.right",
            "Runs when the user shakes the device",
            params: [],
            outputs: 1),

        // MARK: Apple Watch
        def(.onDigitalCrown, .event, "On Digital Crown", "digitalcrown.horizontal.arrow.clockwise",
            "Apple Watch: runs as the user turns the Digital Crown; stores the rotation value",
            params: [
                p("valueVariable", "Value Into", .variable, required: false),
                p("sensitivity", "Sensitivity", .dropdown, value: "medium", required: false, options: ["low", "medium", "high"])
            ],
            outputs: 1),
        def(.onWatchTap, .event, "On Watch Tap", "hand.tap.fill",
            "Apple Watch: runs when the element is tapped on the watch face",
            params: [p("element", "Element", .nodeReference, required: false)],
            outputs: 1),
        def(.onWatchLongPress, .event, "On Watch Long Press", "hand.point.up.braille.fill",
            "Apple Watch: runs on a firm/long press on the watch",
            params: [p("element", "Element", .nodeReference, required: false)],
            outputs: 1),
        def(.watchHaptic, .device, "Watch Haptic", "applewatch.radiowaves.left.and.right",
            "Play a Taptic Engine haptic on the Apple Watch",
            params: [
                p("type", "Haptic", .dropdown, value: "notification", required: false,
                  options: ["notification", "success", "failure", "retry", "start", "stop", "click", "directionUp", "directionDown"])
            ],
            outputs: 1),
        def(.startWatchWorkout, .device, "Start Watch Workout", "figure.run",
            "Apple Watch: begin a real HKWorkoutSession — live heart rate, energy and distance, kept alive in the background",
            params: [
                p("activity", "Activity", .dropdown, value: "running", required: false,
                  options: ["running", "walking", "cycling", "hiking", "swimming", "other"])
            ],
            outputs: 2, outputLabels: successError),
        def(.pauseWatchWorkout, .device, "Pause / Resume Watch Workout", "pause.circle.fill",
            "Apple Watch: pause or resume the active workout session",
            params: [],
            outputs: 1),
        def(.endWatchWorkout, .device, "End Watch Workout", "stop.circle.fill",
            "Apple Watch: end and save the workout to Health",
            params: [],
            outputs: 1),

        def(.supabaseSignUp, .storage, "Supabase Sign Up", "person.badge.plus",
            "Create a new user account with email and password",
            params: [
                p("email", "Email", .string, placeholder: "user@example.com"),
                p("password", "Password", .string, placeholder: "••••••••"),
                p("sessionVariable", "Store Session In", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.supabaseSignIn, .storage, "Supabase Sign In", "person.crop.circle.badge.checkmark",
            "Sign an existing user in with email and password",
            params: [
                p("email", "Email", .string, placeholder: "user@example.com"),
                p("password", "Password", .string, placeholder: "••••••••"),
                p("sessionVariable", "Store Session In", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.supabaseSignOut, .storage, "Supabase Sign Out", "rectangle.portrait.and.arrow.right",
            "Sign the current user out and clear the stored session",
            params: [
                p("sessionVariable", "Session Variable", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.supabaseCurrentUser, .storage, "Supabase Current User", "person.text.rectangle",
            "Fetch the signed-in user's profile into a variable",
            params: [
                p("userVariable", "Store User In", .variable, required: false)
            ],
            outputs: 2, outputLabels: successError),
        def(.supabaseInsert, .storage, "Supabase Insert", "tray.and.arrow.down",
            "Insert a row into a Supabase table via its REST API",
            params: [
                p("table", "Table", .string, placeholder: "profiles"),
                p("data", "Data Fields", .keyValue)
            ],
            outputs: 2, outputLabels: successError),
        def(.supabaseQuery, .storage, "Supabase Query", "line.3.horizontal.decrease.circle",
            "Query rows from a Supabase table with an optional filter",
            params: [
                p("table", "Table", .string, placeholder: "profiles"),
                p("filter", "Filter", .string, required: false, placeholder: "id=eq.42"),
                p("limit", "Limit", .number, required: false),
                p("variable", "Store In", .variable)
            ],
            outputs: 2, outputLabels: successError),
        def(.supabaseUpdate, .storage, "Supabase Update", "square.and.pencil",
            "Update rows matching a filter",
            params: [
                p("table", "Table", .string),
                p("filter", "Filter", .string, placeholder: "id=eq.42"),
                p("data", "Fields", .keyValue)
            ],
            outputs: 2, outputLabels: successError),
        def(.supabaseDelete, .storage, "Supabase Delete", "trash",
            "Delete rows matching a filter",
            params: [
                p("table", "Table", .string),
                p("filter", "Filter", .string, placeholder: "id=eq.42")
            ],
            outputs: 2, outputLabels: successError),
        def(.sqliteQuery, .storage, "SQLite Query", "cylinder.split.1x2",
            "Run a read-only SQL query against the app's local database",
            params: [
                p("sql", "SQL", .string, placeholder: "SELECT * FROM notes WHERE done = 0"),
                p("variable", "Store In (JSON)", .variable)
            ],
            outputs: 2, outputLabels: successError),
        def(.sqliteExecute, .storage, "SQLite Execute", "cylinder.split.1x2.fill",
            "Run an INSERT/UPDATE/DELETE/CREATE statement against the local database",
            params: [p("sql", "SQL", .string, placeholder: "INSERT INTO notes (title) VALUES ('New note')")],
            outputs: 2, outputLabels: successError),
        def(.algoliaSearch, .storage, "Algolia Search", "magnifyingglass",
            "Search an Algolia index",
            params: [
                p("appId", "Application ID", .string),
                p("apiKey", "Search API Key", .string),
                p("index", "Index", .string),
                p("query", "Query", .string),
                p("variable", "Store In", .variable)
            ],
            outputs: 2, outputLabels: successError),
        def(.logAnalyticsEvent, .storage, "Analytics Event", "chart.bar.xaxis",
            "Log an event to Firebase Analytics",
            params: [
                p("name", "Event Name", .string, placeholder: "sign_up"),
                p("parameters", "Parameters", .keyValue, required: false)
            ]),

        // ── Variables & Data ───────────────────────────────────
        def(.setVariable, .variable, "Set Variable", "arrow.down.doc",
            "Set a variable to a value",
            params: [
                p("variable", "Variable", .variable),
                p("value", "Value", .string)
            ]),
        def(.toggleVariable, .variable, "Toggle Bool", "switch.2",
            "Toggle a boolean variable",
            params: [p("variable", "Variable", .variable)]),
        def(.incrementVariable, .variable, "Increment", "plus.circle",
            "Add to a number variable",
            params: [
                p("variable", "Variable", .variable),
                p("amount", "Amount", .number, value: "1")
            ]),
        def(.decrementVariable, .variable, "Decrement", "minus.circle",
            "Subtract from a number variable",
            params: [
                p("variable", "Variable", .variable),
                p("amount", "Amount", .number, value: "1")
            ]),
        def(.appendToArray, .variable, "Append Item", "text.badge.plus",
            "Append a value to a list variable",
            params: [
                p("array", "Array", .variable),
                p("value", "Value", .string)
            ]),
        def(.removeFromArray, .variable, "Remove Item", "text.badge.minus",
            "Remove a value from a list variable",
            params: [
                p("array", "Array", .variable),
                p("value", "Value", .string)
            ]),
        def(.getVariable, .variable, "Get Variable", "arrow.up.doc",
            "Read a variable value",
            params: [p("variable", "Variable", .variable)]),
        def(.appendJsonItem, .variable, "Append List Item", "text.badge.plus",
            "Append a JSON object to a JSON-array variable (drives repeat lists), e.g. {\"time\":\"6:30\",\"state\":\"ON\"}",
            params: [
                p("variable", "List Variable", .variable),
                p("item", "Item JSON", .string)
            ]),
        def(.replaceInVariable, .variable, "Replace In Variable", "arrow.2.squarepath",
            "Replace every occurrence of Find with Replace inside a variable's text — great for toggling a field inside a JSON list",
            params: [
                p("variable", "Variable", .variable),
                p("find", "Find", .string),
                p("replaceWith", "Replace", .string)
            ]),
        def(.getCurrentTime, .variable, "Current Time", "clock",
            "Store the current time as \"H:MM\" (e.g. 6:30) in a variable — compare it to an alarm time",
            params: [p("variable", "Store In", .variable)]),
        def(.randomNumber, .variable, "Random Number", "die.face.5",
            "Store a random whole number between Min and Max in a variable — new every run (dice rolls, math problems, spawn variety)",
            params: [
                p("min", "Min", .number, value: "1"),
                p("max", "Max", .number, value: "10"),
                p("variable", "Store In", .variable)
            ]),
        def(.mathOperation, .variable, "Math", "plus.forwardslash.minus",
            "Add, subtract, multiply or divide",
            params: [
                p("left", "Left", .string),
                p("operator", "Operator", .dropdown, value: "+", options: ["+", "-", "×", "÷", "%"]),
                p("right", "Right", .string),
                p("variable", "Store In", .variable)
            ]),
        def(.stringOperation, .variable, "String Op", "textformat.abc",
            "Concatenate, substring, replace or change case",
            params: [
                p("operation", "Operation", .dropdown, value: "concat", options: ["concat", "substring", "replace", "uppercase", "lowercase", "trim"]),
                p("input", "Input", .string),
                p("argument", "Argument", .string, required: false),
                p("variable", "Store In", .variable)
            ]),
        def(.arrayOperation, .variable, "Array Op", "square.stack",
            "Push, pop, filter, map or find in an array",
            params: [
                p("operation", "Operation", .dropdown, value: "push", options: ["push", "pop", "filter", "map", "find", "count"]),
                p("array", "Array", .variable),
                p("argument", "Argument", .string, required: false)
            ]),
        def(.jsonBuild, .variable, "Build JSON", "curlybraces.square",
            "Construct a JSON object from key-value fields",
            params: [
                p("fields", "Fields", .keyValue),
                p("variable", "Store In", .variable)
            ]),
        def(.jsonParse, .variable, "Parse JSON", "doc.badge.gearshape",
            "Parse a JSON string into structured data",
            params: [
                p("input", "JSON String", .string),
                p("variable", "Store In", .variable)
            ],
            outputs: 2, outputLabels: ["✓ Parsed", "✗ Invalid"]),
        def(.formatDate, .variable, "Format Date", "calendar",
            "Format a date value",
            params: [
                p("input", "Date", .string),
                p("format", "Format", .string, value: "yyyy-MM-dd"),
                p("variable", "Store In", .variable)
            ]),
        def(.generateId, .variable, "Generate ID", "number.square",
            "Generate a unique UUID",
            params: [p("variable", "Store In", .variable)]),

        // ── UI Updates ─────────────────────────────────────────
        def(.setText, .ui, "Set Text", "textformat",
            "Change the text of a Text, Button or Input node",
            params: [
                p("element", "Element", .nodeReference),
                p("text", "Text", .string)
            ]),
        def(.setColor, .ui, "Set Color", "paintbrush",
            "Change the fill or text color of a node",
            params: [
                p("element", "Element", .nodeReference),
                p("property", "Property", .dropdown, value: "fill", options: ["fill", "textColor", "stroke"]),
                p("color", "Color", .color, value: "#3B82F6")
            ]),
        def(.setVisible, .ui, "Show / Hide", "eye",
            "Show or hide a node",
            params: [
                p("element", "Element", .nodeReference),
                p("visible", "Visible", .boolean, value: "true")
            ]),
        def(.setEnabled, .ui, "Enable / Disable", "hand.raised.slash",
            "Enable or disable interaction on a node",
            params: [
                p("element", "Element", .nodeReference),
                p("enabled", "Enabled", .boolean, value: "true")
            ]),
        def(.setImage, .ui, "Set Image", "photo",
            "Change the image source of an Image node",
            params: [
                p("element", "Element", .nodeReference),
                p("source", "Image URL", .url)
            ]),
        def(.scrollTo, .ui, "Scroll To", "arrow.down.to.line",
            "Scroll to a specific element",
            params: [
                p("element", "Scroll Container", .nodeReference),
                p("axis", "Axis", .dropdown, value: "vertical", options: ["vertical", "horizontal", "both"]),
                p("offset", "Offset", .number, value: "0"),
                p("duration", "Duration (s)", .number, value: "0.3")
            ]),
        def(.setLoading, .ui, "Set Loading", "arrow.triangle.2.circlepath",
            "Show or hide a loading spinner on an element",
            params: [
                p("element", "Element", .nodeReference),
                p("loading", "Loading", .boolean, value: "true")
            ]),
        def(.animate, .ui, "Animate", "wand.and.rays",
            "Animate a property change on a node",
            params: [
                p("element", "Element", .nodeReference),
                p("property", "Property", .dropdown, value: "opacity", options: ["opacity", "scale", "x", "y", "width", "height", "cornerRadius"]),
                p("to", "To Value", .string),
                p("duration", "Duration (s)", .number, value: "0.3")
            ]),
        def(.bindProperty, .ui, "Bind Property", "link.circle",
            "Bind a component property to state",
            params: [
                p("element", "Element", .nodeReference),
                p("property", "Property", .dropdown, value: "text", options: ["text", "value", "isOn", "visibility", "enabled", "selectedIndex"]),
                p("variable", "Variable", .variable)
            ]),
        def(.setNavigationSelection, .ui, "Set Selection", "sidebar.left",
            "Set tab or navigation selection state",
            params: [
                p("variable", "Selection", .variable),
                p("value", "Value", .string)
            ]),
        def(.presentBottomSheet, .ui, "Bottom Sheet", "rectangle.bottomthird.inset.filled",
            "Present a screen as a partial-height bottom sheet",
            params: [
                p("screen", "Screen", .screenReference),
                p("detent", "Height", .dropdown, value: "medium", options: ["medium", "large"])
            ]),
        def(.dismissBottomSheet, .ui, "Dismiss Bottom Sheet", "rectangle.bottomthird.inset.filled",
            "Dismiss the current bottom sheet"),
        def(.presentDatePicker, .ui, "Date Picker", "calendar.badge.clock",
            "Present a date/time picker sheet and store the chosen date",
            params: [
                p("mode", "Mode", .dropdown, value: "date", options: ["date", "time", "dateAndTime"]),
                p("variable", "Store In (ISO 8601)", .variable)
            ]),
        def(.presentColorPicker, .ui, "Color Picker", "eyedropper",
            "Present a color picker sheet and store the chosen hex color",
            params: [p("variable", "Store In (hex)", .variable)])
    ]
}
