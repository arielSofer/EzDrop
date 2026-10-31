import SwiftUI

@main
struct LooplyApp: App {
    @StateObject private var state = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(state)
                .task { await state.restoreOnLaunch() }
        }
    }
}
