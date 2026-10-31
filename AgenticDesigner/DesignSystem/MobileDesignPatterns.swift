//
//  MobileDesignPatterns.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

// קטגוריות עיצוב נפוצות לאפליקציות מובייל
enum MobileAppCategory: String, Codable {
    case finance
    case banking
    case mentalHealth
    case travel
    case aiChat
    case ecommerce
    case productivity
    case fitness
    case generic
}

// חוקי עיצוב שמנחים את ה־Agent לייצר UI ברמה גבוהה
struct MobileDesignPattern: Codable {
    let category: MobileAppCategory
    let layoutPrinciples: [String]
    let visualPrinciples: [String]
    let commonComponents: [String]
    let avoid: [String]
}

extension MobileDesignPattern {
    
    // פיננסים / מסחר / בנקאות
    static let finance = MobileDesignPattern(
        category: .finance,
        layoutPrinciples: [
            "Use a strong top summary section.",
            "Use cards for balances, metrics, and quick actions.",
            "Keep financial data highly readable.",
            "Prioritize trust, clarity, and precision.",
            "Use consistent alignment for numbers and labels."
        ],
        visualPrinciples: [
            "Use dark or clean neutral backgrounds.",
            "Use one strong accent color only.",
            "Use subtle borders and soft shadows.",
            "Use large numeric typography for key values.",
            "Avoid decorative clutter."
        ],
        commonComponents: [
            "balanceCard",
            "metricCard",
            "transactionList",
            "quickActionButton",
            "chartCard",
            "segmentedControl"
        ],
        avoid: [
            "Too many bright colors.",
            "Unaligned numbers.",
            "Weak contrast.",
            "Random card sizes.",
            "Overly playful illustrations."
        ]
    )
    
    // בריאות נפשית / Self care
    static let mentalHealth = MobileDesignPattern(
        category: .mentalHealth,
        layoutPrinciples: [
            "Use calm spacing and soft hierarchy.",
            "Use large breathing room between sections.",
            "Make the primary action feel safe and calm.",
            "Prefer simple daily check-in flows.",
            "Use cards for mood, journal, and habit modules."
        ],
        visualPrinciples: [
            "Use soft backgrounds.",
            "Use muted accent colors.",
            "Use rounded cards.",
            "Avoid aggressive contrast.",
            "Prefer warm and calming UI."
        ],
        commonComponents: [
            "moodCard",
            "dailyCheckIn",
            "progressCard",
            "journalPrompt",
            "softPrimaryButton"
        ],
        avoid: [
            "Hard black backgrounds.",
            "Aggressive red colors.",
            "Dense financial-style dashboards.",
            "Too many stats on one screen."
        ]
    )
    
    // Travel
    static let travel = MobileDesignPattern(
        category: .travel,
        layoutPrinciples: [
            "Use large visual hero areas.",
            "Use destination cards with strong imagery placeholders.",
            "Use search prominently.",
            "Use horizontal carousels for categories.",
            "Keep booking actions clear."
        ],
        visualPrinciples: [
            "Use bright, aspirational spacing.",
            "Use image-first cards.",
            "Use soft overlays.",
            "Use friendly rounded controls.",
            "Use lightweight typography."
        ],
        commonComponents: [
            "searchBar",
            "destinationCard",
            "categoryChips",
            "bookingCTA",
            "popularPlacesCarousel"
        ],
        avoid: [
            "Too much text.",
            "Dense dashboards.",
            "Tiny destination cards.",
            "Weak image hierarchy."
        ]
    )
    
    // AI Chat / Assistant apps
    static let aiChat = MobileDesignPattern(
        category: .aiChat,
        layoutPrinciples: [
            "Use a clear chat entry point.",
            "Use suggestion cards.",
            "Use clean message bubbles.",
            "Prioritize the input area.",
            "Show recent tasks or capabilities."
        ],
        visualPrinciples: [
            "Use minimal futuristic styling.",
            "Use subtle gradients carefully.",
            "Use clean neutral surfaces.",
            "Use one accent for AI actions.",
            "Avoid noisy sci-fi effects."
        ],
        commonComponents: [
            "chatInput",
            "suggestionCard",
            "messageBubble",
            "agentStatus",
            "quickPromptGrid"
        ],
        avoid: [
            "Overloaded neon visuals.",
            "Too many gradients.",
            "Unclear input placement.",
            "Tiny unreadable chat text."
        ]
    )
    
    static let fitness = MobileDesignPattern(
        category: .fitness,
        layoutPrinciples: [
            "Use one motivational hero moment.",
            "Show pace, distance, progress, route or workout state clearly.",
            "Keep workout actions prominent and touch-friendly.",
            "Use compact activity rows/cards below the hero.",
            "Use bottom navigation for Home, Activity, Explore and Profile when needed."
        ],
        visualPrinciples: [
            "Use energetic but controlled colors.",
            "Use strong contrast for metrics.",
            "Use real sport imagery or route/fitness visuals.",
            "Avoid finance, ecommerce or marketplace language.",
            "Keep dark cards readable."
        ],
        commonComponents: [
            "imageHero",
            "metricCard",
            "progressCard",
            "workoutCard",
            "statCard",
            "primaryCTA"
        ],
        avoid: [
            "Portfolio, market, buy, sell or shop labels.",
            "Random neon colors.",
            "Too many metrics without hierarchy.",
            "Low contrast dark-on-dark typography."
        ]
    )
    
    static let generic = MobileDesignPattern(
        category: .generic,
        layoutPrinciples: [
            "Infer the product's real objects from the prompt.",
            "Build semantic sections with primitives before using generic components.",
            "Use one hero, one main workflow area and one supporting section.",
            "Prefer fewer well-spaced elements over many weak cards.",
            "Use domain-specific labels and icons."
        ],
        visualPrinciples: [
            "Use one coherent accent color.",
            "Use generated imagery when it helps explain the product.",
            "Keep text readable and aligned.",
            "Avoid finance defaults unless the prompt is finance.",
            "Avoid placeholder copy."
        ],
        commonComponents: [
            "imageHero",
            "largeIconTile",
            "iconFeatureGrid",
            "primaryCTA",
            "bottomNavBar"
        ],
        avoid: [
            "Finance defaults for unknown categories.",
            "Generic placeholder text.",
            "Unrelated labels from other app domains.",
            "Overcrowded screens."
        ]
    )
}

enum MobileDesignPatternLibrary {
    // בוחר סגנון לפי מילים בפרומפט של המשתמש
    static func pattern(for prompt: String) -> MobileDesignPattern {
        let lowercased = prompt.lowercased()
        
        if lowercased.contains("finance") ||
            lowercased.contains("trading") ||
            lowercased.contains("bank") ||
            lowercased.contains("wallet") ||
            lowercased.contains("crypto") ||
            lowercased.contains("מניות") ||
            lowercased.contains("מסחר") ||
            lowercased.contains("השקעות") ||
            lowercased.contains("בנק") ||
            lowercased.contains("ארנק") ||
            lowercased.contains("קריפטו") {
            return .finance
        }
        
        if lowercased.contains("fitness") ||
            lowercased.contains("workout") ||
            lowercased.contains("gym") ||
            lowercased.contains("run") ||
            lowercased.contains("running") ||
            lowercased.contains("jog") ||
            lowercased.contains("pace") ||
            lowercased.contains("כושר") ||
            lowercased.contains("אימון") ||
            lowercased.contains("ריצה") ||
            lowercased.contains("ריצות") ||
            lowercased.contains("ספורט") {
            return .fitness
        }
        
        if lowercased.contains("mental") ||
            lowercased.contains("therapy") ||
            lowercased.contains("self care") ||
            lowercased.contains("wellness") ||
            lowercased.contains("מדיטציה") ||
            lowercased.contains("רוגע") {
            return .mentalHealth
        }
        
        if lowercased.contains("travel") ||
            lowercased.contains("hotel") ||
            lowercased.contains("flight") ||
            lowercased.contains("trip") ||
            lowercased.contains("טיול") ||
            lowercased.contains("נסיעה") ||
            lowercased.contains("חופשה") {
            return .travel
        }
        
        if lowercased.contains("ai") ||
            lowercased.contains("chat") ||
            lowercased.contains("assistant") ||
            lowercased.contains("צאט") ||
            lowercased.contains("צ'אט") ||
            lowercased.contains("שיחה") ||
            lowercased.contains("הודעות") {
            return .aiChat
        }
        
        return .generic
    }
}
