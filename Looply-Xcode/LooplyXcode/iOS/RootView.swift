import SwiftUI

struct RootView: View {
    @EnvironmentObject private var state: AppState

    var body: some View {
        NavigationStack {
            Group {
                switch state.currentScreen {
                case "LooplyForYou": LooplyForYouView(actions: GeneratedActions(state: state))
        case "LooplyDiscover": LooplyDiscoverView(actions: GeneratedActions(state: state))
        case "LooplyCreate": LooplyCreateView(actions: GeneratedActions(state: state))
        case "LooplyInbox": LooplyInboxView(actions: GeneratedActions(state: state))
        case "LooplyProfile": LooplyProfileView(actions: GeneratedActions(state: state))
                default: LooplyForYouView(actions: GeneratedActions(state: state))
                }
            }
        }
        .sheet(item: Binding(
            get: { state.presentedSheet.map(IdentifiedString.init(value:)) },
            set: { state.presentedSheet = $0?.value }
        )) { item in
            sheetView(item.value)
        }
        .sheet(item: Binding(
            get: { state.presentedBottomSheet.map(IdentifiedString.init(value:)) },
            set: { state.presentedBottomSheet = $0?.value }
        )) { item in
            sheetView(item.value)
                .presentationDetents([.medium, .large])
        }
        .preferredColorScheme(state.colorSchemeOverride)
        .alert(state.alertTitle ?? "", isPresented: Binding(
            get: { state.alertTitle != nil },
            set: { if !$0 { state.alertTitle = nil; state.alertMessage = nil } }
        )) {
            Button("OK", role: .cancel) { state.alertTitle = nil; state.alertMessage = nil }
        } message: {
            Text(state.alertMessage ?? "")
        }
        .alert(state.pendingConfirmation?.title ?? "", isPresented: Binding(
            get: { state.pendingConfirmation != nil },
            set: { isPresented in
                if !isPresented, let pending = state.pendingConfirmation {
                    pending.continuation.resume(returning: false)
                    state.pendingConfirmation = nil
                }
            }
        )) {
            Button(state.pendingConfirmation?.cancelLabel ?? "Cancel", role: .cancel) {
                state.pendingConfirmation?.continuation.resume(returning: false)
                state.pendingConfirmation = nil
            }
            Button(state.pendingConfirmation?.confirmLabel ?? "Confirm") {
                state.pendingConfirmation?.continuation.resume(returning: true)
                state.pendingConfirmation = nil
            }
        } message: {
            Text(state.pendingConfirmation?.message ?? "")
        }
        .overlay(alignment: .bottom) {
            if let toast = state.toastMessage {
                Text(toast)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color.black.opacity(0.86))
                    .clipShape(Capsule())
                    .padding(.bottom, 28)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onChange(of: state.toastMessage) { _ in
            guard state.toastMessage != nil else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                state.toastMessage = nil
            }
        }
        .onAppear {
            // no app launch actions
        }
    }

    @ViewBuilder
    private func sheetView(_ key: String) -> some View {
        switch key {
        case "LooplyForYou": LooplyForYouView(actions: GeneratedActions(state: state))
        case "LooplyDiscover": LooplyDiscoverView(actions: GeneratedActions(state: state))
        case "LooplyCreate": LooplyCreateView(actions: GeneratedActions(state: state))
        case "LooplyInbox": LooplyInboxView(actions: GeneratedActions(state: state))
        case "LooplyProfile": LooplyProfileView(actions: GeneratedActions(state: state))
        default: Text(key)
        }
    }
}

struct IdentifiedString: Identifiable {
    let value: String
    var id: String { value }
}
