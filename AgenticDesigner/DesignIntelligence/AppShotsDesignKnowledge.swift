//
//  AppShotsDesignKnowledge.swift
//  AgenticDesigner
//
//  A compact, product-safe distillation of the AppShots reference corpus.
//  The source screenshots are used as design research, never copied into a
//  generated app.  This file captures the reusable systems behind them:
//  hierarchy, palette discipline, geometry, density and end-to-end flows.
//

import Foundation

struct ReferenceAppStudy {
    let name: String
    let screenCount: Int
    let flowCount: Int
    let surfaceModel: String
    let paletteModel: String
    let layoutModel: String
    let flowTags: [String]
}

enum AppShotsDesignKnowledge {

    /// 1,856 iPhone screens inspected from the local reference library.
    /// Counts and flow names mirror the curated AppShots pages, while the
    /// visual descriptions are our own reusable design observations.
    static let studies: [ReferenceAppStudy] = [
        ReferenceAppStudy(
            name: "Shipt", screenCount: 95, flowCount: 19,
            surfaceModel: "utility-first white surfaces, flat product grids, calm lavender promotion panels",
            paletteModel: "deep plum + fresh green + white; photography supplies secondary colour",
            layoutModel: "20pt content rails, dense 2-column merchandise, 44-56pt controls, persistent bottom navigation",
            flowTags: ["Onboarding", "Location", "Home", "Explore", "Search", "Catalog", "Add to cart", "Checkout", "Payment", "Order", "Notification", "Support"]
        ),
        ReferenceAppStudy(
            name: "Instagram", screenCount: 739, flowCount: 27,
            surfaceModel: "neutral chrome that gives user media visual priority",
            paletteModel: "black + white + cool gray + one blue action colour; semantic red only when needed",
            layoutModel: "edge-to-edge media, compact 44pt toolbars, hairline separators, restrained sheets and forms",
            flowTags: ["Onboarding", "Feed", "Search", "Create", "Upload", "Share", "Comment", "Chat", "Profile", "Analytics", "Settings", "Support"]
        ),
        ReferenceAppStudy(
            name: "WhatsApp", screenCount: 529, flowCount: 29,
            surfaceModel: "native-feeling lists, conversational canvases, action sheets and focused editors",
            paletteModel: "white + grouped gray + green identity + native blue controls",
            layoutModel: "44-56pt rows, strong title bars, quiet separators, chat bubbles and bottom-safe composers",
            flowTags: ["Onboarding", "Permission", "Chat", "Message", "Audio", "Location", "Create", "Share", "Profile", "Avatar", "Settings", "Notification", "Support", "FAQ"]
        ),
        ReferenceAppStudy(
            name: "Netflix", screenCount: 56, flowCount: 6,
            surfaceModel: "cinematic black canvas with imagery carrying most of the hierarchy",
            paletteModel: "black + charcoal + white + a single Netflix-red action accent",
            layoutModel: "full-bleed hero art, poster rails, compact metadata and overlay controls with minimal chrome",
            flowTags: ["Onboarding", "Feed", "Filter", "Video", "Share", "FAQ"]
        ),
        ReferenceAppStudy(
            name: "Less", screenCount: 101, flowCount: 11,
            surfaceModel: "friendly illustrated scenes above calm tracking and editorial surfaces",
            paletteModel: "sky blue + mint + orange + indigo + warm off-white",
            layoutModel: "large illustration zones, pill actions, generous onboarding whitespace, simple weekly analytics",
            flowTags: ["Onboarding", "Routine", "Details", "Analytics", "Carousels", "Personalisation", "Notification", "Settings", "Support", "FAQ"]
        ),
        ReferenceAppStudy(
            name: "MyFitnessPal", screenCount: 336, flowCount: 41,
            surfaceModel: "high-information white utility screens with data isolated into clear sections",
            paletteModel: "royal blue + white + pale gray; green, orange and purple only for semantic metrics",
            layoutModel: "44-52pt rows, compact dashboards, ring/chart focal points, sticky add actions and tab navigation",
            flowTags: ["Onboarding", "Home", "Create", "Details", "History", "Analytics", "Routine", "Challenges", "Community", "Notification", "Settings", "Support"]
        )
    ]

    static let universalRules: [String] = [
        "Choose one dominant visual idea per screen. Everything else supports it.",
        "Use one persistent 16/20/24pt content rail across the product; full-bleed media is the intentional exception.",
        "Build on an 8pt rhythm with 4pt optical adjustments: 8/12/16 inside controls, 20/24 between groups, 32 between sections.",
        "Use a small type ladder: 11-13 metadata, 15-17 body/control, 20-24 section title, 28-36 display. Weight creates hierarchy before colour does.",
        "Keep controls at least 44pt tall. Primary actions are normally 48-56pt and visually unique on the screen.",
        "Use no more than one brand accent plus semantic colours. Images may be colourful; interface chrome stays disciplined.",
        "Choose either flat separated utility surfaces or elevated rounded cards for a section. Do not wrap every row in a floating card.",
        "Use 8/12/16pt radii for utility UI, 20/24/28pt for hero surfaces, and pills only for chips or deliberate actions.",
        "Make navigation spatially stable across screens and keep scrollable content above its interactive bottom region.",
        "Every screen must represent a real state in a journey: entry, discovery, decision, action, feedback, or recovery."
    ]

    static let antiPatterns: [String] = [
        "generic dashboard mosaics unrelated to the product",
        "random gradients, rainbow accents or decorative glass on every surface",
        "identical card stacks on every screen",
        "placeholder copy such as Item, Featured, Subtitle, Lorem or Button",
        "tiny text used to compensate for overcrowding",
        "navigation destinations with no screen or wired action behind them",
        "large empty areas with no intentional illustration, media or focus",
        "screens that photograph well but do not form a complete task flow"
    ]

    static func recommendedStyle(for goal: String) -> VisualStylePreset {
        let text = goal.lowercased()
        if containsAny(text, ["movie", "video", "stream", "cinema", "netflix", "סרט", "וידאו"]) {
            return .cinematicMedia
        }
        if containsAny(text, ["chat", "message", "messenger", "whatsapp", "community", "צ׳אט", "הודעות"]) {
            return .messagingUtility
        }
        if containsAny(text, ["shop", "store", "grocery", "cart", "order", "delivery", "commerce", "חנות", "קניות", "משלוח"]) {
            return .commerceUtility
        }
        if containsAny(text, ["fitness", "nutrition", "calorie", "workout", "health", "habit", "כושר", "תזונה", "בריאות"]) {
            return .healthMetrics
        }
        if containsAny(text, ["mindful", "alcohol", "wellness", "journal", "reflection", "רוגע", "הרגל", "יומן"]) {
            return .mindfulIllustrated
        }
        if containsAny(text, ["social", "photo", "creator", "feed", "instagram", "חברתי", "תמונות"]) {
            return .socialContent
        }
        return .appleCalm
    }

    static func flowBlueprint(for goal: String) -> [String] {
        switch recommendedStyle(for: goal) {
        case .commerceUtility:
            return ["Onboarding / location", "Home / deals", "Search / catalog", "Product details", "Cart", "Checkout / payment", "Order confirmation"]
        case .socialContent:
            return ["Onboarding / permission", "Feed", "Search / discovery", "Create / upload", "Share / feedback", "Profile / analytics", "Settings / support"]
        case .messagingUtility:
            return ["Onboarding / permission", "Conversation list", "Conversation", "Create / attach", "Contact or group details", "Profile", "Settings / support"]
        case .cinematicMedia:
            return ["Onboarding", "Personalised feed", "Search / filter", "Title details", "Playback", "Share / recovery"]
        case .healthMetrics:
            return ["Onboarding / goal", "Today dashboard", "Log / create", "Entry details", "History / analytics", "Routine / reminder", "Settings / support"]
        case .mindfulIllustrated:
            return ["Onboarding / goal", "Today check-in", "Log action", "Weekly history", "Analytics / reflection", "Reminder", "Settings / support"]
        default:
            return ["Onboarding", "Home", "Discover / list", "Details", "Primary action", "Confirmation / feedback", "Settings / support"]
        }
    }

    /// Injected into every Agent Loop run, regardless of provider/model.
    static func agentLoopGuide(for goal: String) -> String {
        let style = recommendedStyle(for: goal)
        let flow = flowBlueprint(for: goal).joined(separator: " → ")
        return """
        APPSHOTS REFERENCE BAR (deterministic product standard)
        The local research corpus contains 1,856 production iPhone screens across commerce, social, messaging, media, health and habit products. Do not copy a brand or screen; reproduce the SYSTEM quality.
        Recommended visual system for this goal: \(style.rawValue).
        Required journey skeleton: \(flow).

        NON-NEGOTIABLE VISUAL RULES
        - \(universalRules.joined(separator: "\n- "))
        - Prefer compose_reference_app for a new multi-screen UI: it lets code own geometry while you own product decisions and copy. Use apply_design_actions afterward only for intentional differentiation and polish.
        - A product flow normally needs 5-7 purposeful screens. A 2-screen mockup is not a complete app unless the user explicitly asked for only two screens.
        - Capture the latest screenshot, run check_design_quality, and repair until it prints REFERENCE BAR PASS. finish is rejected below that bar.

        NEVER SHIP
        - \(antiPatterns.joined(separator: "\n- "))
        """
    }

    static var composerGuide: String {
        """
        REFERENCE-GRADE COMPOSITION
        Compose 5-7 purposeful screens that form one continuous primary journey, not isolated concepts. Use the domain flow that best matches the brief:
        - commerce: onboarding/location → home/deals → search/catalog → details → cart → checkout/payment → confirmation
        - social: onboarding/permission → feed → discover → create/upload → share/feedback → profile/settings
        - messaging: onboarding/permission → chats → conversation → attach/create → details → settings/support
        - media: onboarding → feed → search/filter → title details → playback → share/recovery
        - health/habit: onboarding/goal → today → log/create → details → history/analytics → reminder/settings

        Use 3-5 substantial components per screen. Vary the composition by screen purpose while preserving one palette, one content rail, one type ladder and one navigation shell. Use specific, believable copy. The app must contain the destinations its navigation promises.
        """
    }

    static var criticGuide: String {
        """
        Judge against production references, not a generic Dribbble moodboard: stable rails, restrained palette, clear type ladder, native-sized controls, purposeful density, consistent shell, real copy, and a complete journey. Penalize decorative excess, repeated card stacks, sparse filler screens, missing image assets, dead navigation and flows that skip decision/feedback states.
        """
    }

    private static func containsAny(_ text: String, _ values: [String]) -> Bool {
        values.contains { text.contains($0) }
    }
}
