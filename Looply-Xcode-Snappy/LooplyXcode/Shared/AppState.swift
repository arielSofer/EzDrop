import SwiftUI
import Combine

final class AppState: ObservableObject {
    @Published var currentScreen: String = "LooplyForYou"
    @Published var navigationPath: [String] = []
    @Published var presentedSheet: String?
    @Published var presentedBottomSheet: String?
    @Published var alertTitle: String?
    @Published var alertMessage: String?
    @Published var toastMessage: String?
    @Published var colorSchemeOverride: ColorScheme?
    @Published var currentUserEmail: String = ""
    @Published var currentUserId: String = ""
    @Published var pendingConfirmation: PendingConfirmation?
    @Published var campaignComplete: Bool = false
    @Published var currentLevel: String = "1"
    @Published var earnedStars: Double = 0
    @Published var feedPaused: Bool = false
    @Published var gameOver: Bool = false
    @Published var gameScore: Double = 0
    @Published var gameTapX: Double = 0
    @Published var gameTapY: Double = 0
    @Published var gameWon: Bool = false
    @Published var gravityMode: String = "down"
    @Published var level2Unlocked: Bool = false
    @Published var level3Unlocked: Bool = false
    @Published var maxShots: Double = 4
    @Published var resultStarsText: String = "☆ ☆ ☆"
    @Published var resultTitle: String = "RIFT REPORT"
    @Published var resultWon: Bool = false
    @Published var runScore: Double = 0
    @Published var shotsLeft: Double = 4
    @Published var shotsUsed: Double = 0
    @Published var stars1: Double = 0
    @Published var stars1Text: String = "☆ ☆ ☆"
    @Published var stars2: Double = 0
    @Published var stars2Text: String = "☆ ☆ ☆"
    @Published var stars3: Double = 0
    @Published var stars3Text: String = "☆ ☆ ☆"
    @Published var targetsLeft: Double = 0
    @Published var totalScratch: Double = 0
    @Published var totalStars: Double = 0
    @Published var totalStarsText: String = "0 / 9"
    @Published var nodeText_0AEEAEB56F10: String = "604K"
    @Published var nodeFill_0AFAD5EE7461: String = "#FE2C55"
    @Published var nodeFill_4E8C9259E32D: String = "#FE2C55"
    @Published var nodeText_504E43107732: String = "91.6K"
    @Published var nodeText_5448FE70FB65: String = "Add a comment…"
    @Published var nodeFill_60ECC3F9E492: String = "#FFFFFF"
    @Published var nodeText_60F49E610572: String = "Follow"
    @Published var nodeFill_631C16F0A66E: String = "#A0A0A6"
    @Published var nodeText_966AEB5C734F: String = "249K"
    @Published var nodeFill_99E45EF89B0C: String = "#FE2C55"
    @Published var nodeHeight_9CB556A81433: Double = 480.0
    @Published var nodeWidth_9CB556A81433: Double = 340.0
    @Published var nodeX_9CB556A81433: Double = -110.0
    @Published var nodeY_9CB556A81433: Double = 120.0
    @Published var nodeFill_A9272A296159: String = "#FFFFFF"
    @Published var nodeFill_AA9F2E261FC7: String = "#FE2C55"
    @Published var nodeFill_C36B9097FB3B: String = "#25F4EE"
    @Published var nodeText_C5B654D8F774: String = "249K"
    @Published var nodeFill_D5722DE3D107: String = "#FE2C55"
    @Published var nodeFill_D73241C3D426: String = "#FE2C55"
    @Published var nodeFill_EFBADB265256: String = "#FE2C55"

    // MARK: - Session & state restoration
    private var __cancellables = Set<AnyCancellable>()
    private var __persistTask: Task<Void, Never>?

    init() {
        // Any change to a published value schedules a debounced save, so
        // a crash / force-quit / OS eviction can't silently lose state.
        objectWillChange
            .sink { [weak self] _ in self?.__schedulePersist() }
            .store(in: &__cancellables)
    }

    private func __schedulePersist() {
        __persistTask?.cancel()
        __persistTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard let self, !Task.isCancelled else { return }
            StateStore.save(self.__variableSnapshot())
        }
    }

    func __variableSnapshot() -> [String: String] {
        [
            "campaignComplete": String(describing: campaignComplete),
            "currentLevel": String(describing: currentLevel),
            "earnedStars": String(describing: earnedStars),
            "feedPaused": String(describing: feedPaused),
            "gameOver": String(describing: gameOver),
            "gameScore": String(describing: gameScore),
            "gameTapX": String(describing: gameTapX),
            "gameTapY": String(describing: gameTapY),
            "gameWon": String(describing: gameWon),
            "gravityMode": String(describing: gravityMode),
            "level2Unlocked": String(describing: level2Unlocked),
            "level3Unlocked": String(describing: level3Unlocked),
            "maxShots": String(describing: maxShots),
            "resultStarsText": String(describing: resultStarsText),
            "resultTitle": String(describing: resultTitle),
            "resultWon": String(describing: resultWon),
            "runScore": String(describing: runScore),
            "shotsLeft": String(describing: shotsLeft),
            "shotsUsed": String(describing: shotsUsed),
            "stars1": String(describing: stars1),
            "stars1Text": String(describing: stars1Text),
            "stars2": String(describing: stars2),
            "stars2Text": String(describing: stars2Text),
            "stars3": String(describing: stars3),
            "stars3Text": String(describing: stars3Text),
            "targetsLeft": String(describing: targetsLeft),
            "totalScratch": String(describing: totalScratch),
            "totalStars": String(describing: totalStars),
            "totalStarsText": String(describing: totalStarsText)
        ]
    }

    func __applyPersisted(_ values: [String: String]) {
        if let __v = values["campaignComplete"] { campaignComplete = (__v == "true") }
        if let __v = values["currentLevel"] { currentLevel = __v }
        if let __v = values["earnedStars"], let __n = Double(__v) { earnedStars = __n }
        if let __v = values["feedPaused"] { feedPaused = (__v == "true") }
        if let __v = values["gameOver"] { gameOver = (__v == "true") }
        if let __v = values["gameScore"], let __n = Double(__v) { gameScore = __n }
        if let __v = values["gameTapX"], let __n = Double(__v) { gameTapX = __n }
        if let __v = values["gameTapY"], let __n = Double(__v) { gameTapY = __n }
        if let __v = values["gameWon"] { gameWon = (__v == "true") }
        if let __v = values["gravityMode"] { gravityMode = __v }
        if let __v = values["level2Unlocked"] { level2Unlocked = (__v == "true") }
        if let __v = values["level3Unlocked"] { level3Unlocked = (__v == "true") }
        if let __v = values["maxShots"], let __n = Double(__v) { maxShots = __n }
        if let __v = values["resultStarsText"] { resultStarsText = __v }
        if let __v = values["resultTitle"] { resultTitle = __v }
        if let __v = values["resultWon"] { resultWon = (__v == "true") }
        if let __v = values["runScore"], let __n = Double(__v) { runScore = __n }
        if let __v = values["shotsLeft"], let __n = Double(__v) { shotsLeft = __n }
        if let __v = values["shotsUsed"], let __n = Double(__v) { shotsUsed = __n }
        if let __v = values["stars1"], let __n = Double(__v) { stars1 = __n }
        if let __v = values["stars1Text"] { stars1Text = __v }
        if let __v = values["stars2"], let __n = Double(__v) { stars2 = __n }
        if let __v = values["stars2Text"] { stars2Text = __v }
        if let __v = values["stars3"], let __n = Double(__v) { stars3 = __n }
        if let __v = values["stars3Text"] { stars3Text = __v }
        if let __v = values["targetsLeft"], let __n = Double(__v) { targetsLeft = __n }
        if let __v = values["totalScratch"], let __n = Double(__v) { totalScratch = __n }
        if let __v = values["totalStars"], let __n = Double(__v) { totalStars = __n }
        if let __v = values["totalStarsText"] { totalStarsText = __v }
    }

    /// Call once at launch (the exported App entry does this in .task).
    /// Restores the signed-in session and the last saved scalar state.
    @MainActor
    func restoreOnLaunch() async {
        AuthService.shared.restore()
        currentUserId = AuthService.shared.userId
        currentUserEmail = AuthService.shared.email
        __applyPersisted(StateStore.load())
    }

    // Timers created by On Timer events (screen-scoped) and Start
    // Timer blocks (named). Task-based so cancellation is immediate.
    private var generatedTimers: [String: Task<Void, Never>] = [:]

    func scheduleGeneratedTimer(id: String, seconds: Double, repeats: Bool, _ body: @escaping @MainActor () async -> Void) {
        cancelGeneratedTimer(id: id)
        generatedTimers[id] = Task { @MainActor in
            repeat {
                try? await Task.sleep(nanoseconds: UInt64(max(seconds, 0.05) * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await body()
            } while repeats && !Task.isCancelled
        }
    }

    func cancelGeneratedTimer(id: String) {
        generatedTimers[id]?.cancel()
        generatedTimers[id] = nil
    }

    func cancelGeneratedTimers(prefix: String) {
        for key in generatedTimers.keys where key.hasPrefix(prefix) {
            cancelGeneratedTimer(id: key)
        }
    }

    func navigate(to screen: String) {
        if currentScreen != screen {
            navigationPath.append(currentScreen)
            currentScreen = screen
        }
    }

    func goBack() {
        if let previous = navigationPath.popLast() {
            currentScreen = previous
        }
    }

    func resetPresentation() {
        presentedSheet = nil
        alertTitle = nil
        alertMessage = nil
        toastMessage = nil
    }

    // Confirm Dialog blocks await this; RootView renders the actual
    // alert and resumes it when the user taps Confirm or Cancel.
    func confirm(title: String, message: String, confirmLabel: String, cancelLabel: String) async -> Bool {
        await withCheckedContinuation { continuation in
            pendingConfirmation = PendingConfirmation(title: title, message: message, confirmLabel: confirmLabel, cancelLabel: cancelLabel, continuation: continuation)
        }
    }
}

struct PendingConfirmation: Identifiable {
    let id = UUID()
    let title: String
    let message: String
    let confirmLabel: String
    let cancelLabel: String
    let continuation: CheckedContinuation<Bool, Never>
}
