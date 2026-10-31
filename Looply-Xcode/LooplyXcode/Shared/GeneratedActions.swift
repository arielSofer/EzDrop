import SwiftUI
#if canImport(FirebaseAuth)
import FirebaseAuth
#endif
#if canImport(FirebaseFirestore)
import FirebaseFirestore
#endif
#if canImport(FirebaseAnalytics)
import FirebaseAnalytics
#endif
#if canImport(LocalAuthentication)
import LocalAuthentication
#endif
#if canImport(AVFoundation)
import AVFoundation
#endif
#if canImport(Photos)
import Photos
#endif
#if canImport(CoreLocation)
import CoreLocation
#endif
#if canImport(UserNotifications)
import UserNotifications
#endif

@MainActor
final class GeneratedActions {
    let state: AppState
    // Carries the most recent HTTP Request's response to a
    // downstream Parse JSON / Handle Error block in the same flow.
    private var __lastResponseData = Data()
    private var __lastStatusCode = 0
    // Set Header / Set Body accumulate here and the next HTTP Request
    // consumes and clears them — that is what makes those blocks real
    // instead of no-ops (so an Authorization header actually ships).
    private var __pendingHeaders: [String: String] = [:]
    private var __pendingBody: Data?

    init(state: AppState) {
        self.state = state
    }

    func runLooplyForYouNavigationOnTap_8A7957A5() async {
        state.navigate(to: "LooplyDiscover")
    }

    func runLooplyForYouNavigationOnTap_AC9A2FF3() async {
        state.navigate(to: "LooplyInbox")
    }

    func runLooplyForYouNavigationOnTap_227A70AF() async {
        state.navigate(to: "LooplyProfile")
    }

    func runLooplyDiscoverNavigationOnTap_CE4988C2() async {
        state.navigate(to: "LooplyForYou")
    }

    func runLooplyDiscoverNavigationOnTap_E5D4B2D9() async {
        state.navigate(to: "LooplyInbox")
    }

    func runLooplyDiscoverNavigationOnTap_0B68029F() async {
        state.navigate(to: "LooplyProfile")
    }

    func runLooplyInboxNavigationOnTap_BF497666() async {
        state.navigate(to: "LooplyForYou")
    }

    func runLooplyInboxNavigationOnTap_2E7369E8() async {
        state.navigate(to: "LooplyDiscover")
    }

    func runLooplyInboxNavigationOnTap_A3AC03F7() async {
        state.navigate(to: "LooplyProfile")
    }

    func runLooplyProfileNavigationOnTap_D8C651A2() async {
        state.navigate(to: "LooplyForYou")
    }

    func runLooplyProfileNavigationOnTap_87475F06() async {
        state.navigate(to: "LooplyDiscover")
    }

    func runLooplyProfileNavigationOnTap_2389706E() async {
        state.navigate(to: "LooplyInbox")
    }

    func runForYouInteractionsOnTap_7A68B79C() async {
        state.navigate(to: "LooplyDiscover")
    }

    func runForYouInteractionsOnTap_B6FDF604() async {
        state.navigate(to: "LooplyCreate")
    }

    func runForYouInteractionsOnTap_87142BA8() async {
        state.navigate(to: "LooplyInbox")
    }

    func runForYouInteractionsOnTap_4F72588A() async {
        state.navigate(to: "LooplyProfile")
    }

    func runForYouInteractionsOnTap_26BD6128() async {
        state.navigate(to: "LooplyDiscover")
    }

    func runForYouInteractionsOnTap_CABB26EC() async {
        GeneratedHaptics.play()
        state.nodeFill_D73241C3D426 = "#FE2C55"
        state.nodeText_966AEB5C734F = "249K"
    }

    func runForYouInteractionsOnTap_7DE83C73() async {
        GeneratedHaptics.play()
        state.nodeFill_EFBADB265256 = "#25F4EE"
        state.toastMessage = "Following @maya.moves"
    }

    func runForYouInteractionsOnTap_DED276FE() async {
        state.toastMessage = "Comments opened"
    }

    func runForYouInteractionsOnTap_086C1DD6() async {
        GeneratedHaptics.play()
        GeneratedShare.present(text: "Watch @maya.moves on Looply ✨", urlString: "https://looply.app/v/maya-moves")
    }

    func runDiscoverInteractionsOnTap_C564435F() async {
        state.navigate(to: "LooplyForYou")
    }

    func runDiscoverInteractionsOnTap_740AFFF5() async {
        state.navigate(to: "LooplyCreate")
    }

    func runDiscoverInteractionsOnTap_3A3668AF() async {
        state.navigate(to: "LooplyInbox")
    }

    func runDiscoverInteractionsOnTap_D7B7E11C() async {
        state.navigate(to: "LooplyProfile")
    }

    func runDiscoverInteractionsOnTap_BA2D35F9() async {
        state.toastMessage = "Search ready"
    }

    func runDiscoverInteractionsOnTap_28E74CC5() async {
        state.nodeText_60F49E610572 = "Following"
        state.nodeFill_0AFAD5EE7461 = "#25F4EE"
        GeneratedHaptics.play()
    }

    func runDiscoverInteractionsOnTap_A815E398() async {
        state.toastMessage = "Opening trending video"
    }

    func runCreateInteractionsOnTap_0F1F5711() async {
        state.navigate(to: "LooplyForYou")
    }

    func runCreateInteractionsOnTap_3FF4CCE2() async {
        GeneratedHaptics.play()
        state.nodeFill_C36B9097FB3B = "#25F4EE"
        state.toastMessage = "Recording started"
    }

    func runCreateInteractionsOnTap_EC6E5DA3() async {
        state.toastMessage = "Filters opened"
    }

    func runCreateInteractionsOnTap_349DB9E7() async {
        state.toastMessage = "Gallery opened"
    }

    func runInboxInteractionsOnTap_D680B1F7() async {
        state.navigate(to: "LooplyForYou")
    }

    func runInboxInteractionsOnTap_34D41225() async {
        state.navigate(to: "LooplyDiscover")
    }

    func runInboxInteractionsOnTap_E97AC004() async {
        state.navigate(to: "LooplyCreate")
    }

    func runInboxInteractionsOnTap_745354F7() async {
        state.navigate(to: "LooplyProfile")
    }

    func runInboxInteractionsOnTap_AB6BBF7E() async {
        state.toastMessage = "New message"
    }

    func runInboxInteractionsOnTap_9A170F6C() async {
        state.toastMessage = "Maya liked your video"
    }

    func runProfileInteractionsOnTap_D68E0842() async {
        state.navigate(to: "LooplyForYou")
    }

    func runProfileInteractionsOnTap_98E88431() async {
        state.navigate(to: "LooplyDiscover")
    }

    func runProfileInteractionsOnTap_B0100262() async {
        state.navigate(to: "LooplyCreate")
    }

    func runProfileInteractionsOnTap_C0E7A4AC() async {
        state.navigate(to: "LooplyInbox")
    }

    func runProfileInteractionsOnTap_631B5086() async {
        state.toastMessage = "Edit profile opened"
    }

    func runProfileInteractionsOnTap_B6A0E308() async {
        GeneratedShare.present(text: "Follow @ariel.creates on Looply", urlString: "https://looply.app/@ariel.creates")
    }

    func runCustomEvent(named name: String) async {
        switch name {
        case "__none": break
        default:
            break
        }
    }
}
