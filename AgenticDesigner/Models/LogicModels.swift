//
//  LogicModels.swift
//  AgenticDesigner
//
//  Core data structures for the visual block-programming system (Logic Mode).
//

import Foundation
import CoreGraphics

// MARK: - Flow

struct LogicFlow: Codable, Identifiable {
    var id: UUID = UUID()
    var name: String                    // e.g., "Login Flow", "Search Flow"
    var blocks: [LogicBlock] = []
    var connections: [BlockConnection] = []
    var screenNodeId: UUID?             // Which screen (root Frame) this flow belongs to
    var variables: [LogicVariable] = []
    var supportedPlatforms: [AppPlatform]? = nil
}

// MARK: - Block

struct LogicBlock: Codable, Identifiable {
    var id: UUID = UUID()
    var type: LogicBlockType
    var category: LogicBlockCategory
    var label: String
    var x: CGFloat
    var y: CGFloat
    var width: CGFloat = 200
    var parameters: [BlockParameter] = []
    var connectedDesignNodeId: UUID?
    var isCollapsed: Bool = false
    var comment: String?
}

// MARK: - Connection

struct BlockConnection: Codable, Identifiable, Equatable {
    var id: UUID = UUID()
    var sourceBlockId: UUID
    var sourcePortIndex: Int
    var targetBlockId: UUID
    var targetPortIndex: Int
}

// MARK: - Parameters

struct BlockParameter: Codable, Identifiable {
    var id: UUID = UUID()
    var key: String
    var label: String
    var type: ParameterType
    var value: String?
    var nodeReference: UUID?
    var variableReference: String?
    var isRequired: Bool = true
    var placeholder: String?
    var options: [String]?
}

enum ParameterType: String, Codable {
    case string
    case number
    case boolean
    case url
    case nodeReference
    case variable
    case jsonPath
    case dropdown
    case firebasePath
    case httpMethod
    case keyValue
    case color
    case screenReference
}

// MARK: - Variables

struct LogicVariable: Codable, Identifiable {
    var id: UUID = UUID()
    var name: String
    var type: VariableType = .string
    var defaultValue: String?
    var scope: VariableScope = .flow
}

enum VariableType: String, Codable, CaseIterable {
    case string, number, boolean, json, array, optional
}

enum VariableScope: String, Codable, CaseIterable {
    case flow       // Local to this flow
    case screen     // Shared across flows on the same screen
    case global     // Available everywhere in the project
}

// MARK: - Validation

struct LogicIssue: Identifiable {
    let id = UUID()
    let blockId: UUID?
    let message: String
    let severity: LogicIssueSeverity
}

enum LogicIssueSeverity: String {
    case error
    case warning
}

// MARK: - Categories

enum LogicBlockCategory: String, Codable, CaseIterable {
    case event      = "Events"
    case action     = "Actions"
    case condition  = "Conditions"
    case api        = "API"
    case firebase   = "Firebase"
    case storage    = "Data & Backends"
    case variable   = "Variables"
    case ui         = "UI Updates"
    case device     = "Device & Sensors"
}

// MARK: - Block Types

enum LogicBlockType: String, Codable {
    // ── Events ────────────────────────────
    case onTap
    case onDoubleTap
    case onLongPress
    case onSwipe
    case onScreenLoad
    case onScreenDisappear
    case onAppLaunch
    case onScreenOpened
    case onChange
    case onSubmit
    case onTimer
    case onWatchAction
    case customEvent

    // ── Actions ───────────────────────────
    case navigate
    case goBack
    case presentSheet
    case dismissSheet
    case showAlert
    case showToast
    case openURL
    case copyToClipboard
    case hapticFeedback
    case delay
    case log
    case startTimer
    case stopTimer
    case saveValue
    case loadValue
    case customAction
    case confirmDialog
    case shareContent
    case sendEmail
    case callNumber
    case sendSMS
    case launchMaps
    case requestPermission
    case biometricAuth
    case scheduleLocalNotification
    case setBadgeCount
    case playSound
    case stopSound
    case validateForm
    case clearField
    case executeCustomCode
    case setDarkModeOverride
    case downloadFile

    // ── Conditions ────────────────────────
    case ifCondition
    case switchCase
    case compare
    case logicalAnd
    case logicalOr
    case logicalNot
    case isEmpty
    case contains
    case platformCondition

    // ── API ───────────────────────────────
    case httpRequest
    case setRequestHeader
    case setRequestBody
    case parseJSONResponse
    case handleAPIError
    case buildURL

    // ── Commerce & Push ───────────────────
    // The revenue and re-engagement layer a shippable app needs: real
    // StoreKit 2 purchases and real APNs registration.
    case purchaseProduct
    case restorePurchases
    case registerForPush

    // ── Firebase Auth ─────────────────────
    case firebaseLogin
    case firebaseRegister
    case firebaseLogout
    case firebaseGetCurrentUser
    case firebaseResetPassword
    case firebaseDeleteAccount
    case firebaseUpdateProfile
    case firebaseAuthStateChanged

    // ── Firebase Firestore ────────────────
    case firestoreAddDocument
    case firestoreSetDocument
    case firestoreGetDocument
    case firestoreUpdateDocument
    case firestoreDeleteDocument
    case firestoreQuery
    case firestoreListenDocument
    case firestoreListenQuery
    case firestoreBatchWrite

    // ── Data & Backends (Supabase / SQLite / Algolia / Analytics) ──
    // Device & sensors — iPhone / iPad / Apple Watch hardware.
    // Continuous run tracking — the engine that reads live distance/pace and
    // survives a locked screen. `getLocation` is only a one-shot read; without
    // these, the tracking engine was never started and measured nothing.
    case startTracking
    case stopTracking
    case getLocation
    case readMotion
    case readHeartRate
    case readStepCount
    case readBatteryLevel
    case onShake
    case onLocationChanged

    // Apple Watch — the interaction model that makes a watch app a watch app:
    // the Digital Crown, watch-native buttons/gestures, and watch haptics.
    case onDigitalCrown
    case onWatchTap
    case onWatchLongPress
    case watchHaptic
    case startWatchWorkout
    case pauseWatchWorkout
    case endWatchWorkout

    // Supabase auth — the missing half of "a real backend": data blocks
    // existed, but nothing could create or authenticate a user.
    case supabaseSignUp
    case supabaseSignIn
    case supabaseSignOut
    case supabaseCurrentUser
    case supabaseInsert
    case supabaseQuery
    case supabaseUpdate
    case supabaseDelete
    case sqliteQuery
    case sqliteExecute
    case algoliaSearch
    case logAnalyticsEvent

    // ── Variables & Data ──────────────────
    case setVariable
    case toggleVariable
    case incrementVariable
    case decrementVariable
    case appendToArray
    case removeFromArray
    case getVariable
    case mathOperation
    case randomNumber
    case getCurrentTime
    case scheduleNotificationAt
    case ringAlarm
    case appendJsonItem
    case replaceInVariable
    case onGameOver
    case onGameWin
    case onGameScore
    case onGameCollision
    case onGameTap
    case onGameDrag
    case onGameEntityDestroyed
    case gameSpawn
    case gameRemove
    case gameImpulse
    case gameMove
    case gameSetGravity
    case gameAddScore
    case gameEnd
    case gamePause
    case onGameStart
    case onGameLifeLost
    case onGameSpawned
    case gameSetVelocity
    case gameSetProperty
    case gameAnimate
    case gameAddBehavior
    case gameRemoveBehavior
    case gameSetHealth
    case gameShake
    case gameParticles
    case gameSetTimeScale
    case gameSetSpawnRate
    case gameSetLives
    case gameRestart
    case gameQuery
    case gameLaunch
    case gameSetPhysics
    case onGameImpact
    case onGameLaunched
    case gameLoadSlingshot
    case gameDamage
    case gameMotor
    case gameTorque
    case stringOperation
    case arrayOperation
    case jsonBuild
    case jsonParse
    case formatDate
    case generateId

    // ── UI Updates ────────────────────────
    case setText
    case setColor
    case setVisible
    case setEnabled
    case setImage
    case scrollTo
    case setLoading
    case animate
    case bindProperty
    case setNavigationSelection
    case presentBottomSheet
    case dismissBottomSheet
    case presentDatePicker
    case presentColorPicker
}
