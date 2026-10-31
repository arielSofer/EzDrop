//
//  AppCategory.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

// סוגי אפליקציות שהמערכת יודעת לעצב עבורם
enum AppCategory: String, Codable {
    case finance
    case banking
    case trading
    case fitness
    case health
    case mentalHealth
    case travel
    case ecommerce
    case foodDelivery
    case education
    case productivity
    case aiChat
    case social
    case realEstate
    case music
    case crypto
    case calendar
    case habitTracker
    case generic
}

enum AppCategoryClassifier {

    // מזהה קטגוריית אפליקציה לפי הפרומפט.
    // Matching is word-based (not substring) so short keywords like "ai" or "run"
    // don't fire inside unrelated words ("email", "brunch", "nail").
    static func classify(prompt: String) -> AppCategory {
        let text = prompt.lowercased()
        let tokens = Set(
            text.components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { !$0.isEmpty }
        )

        func word(_ words: [String]) -> Bool {
            words.contains { tokens.contains($0) }
        }

        func stem(_ stems: [String]) -> Bool {
            tokens.contains { token in stems.contains { token.hasPrefix($0) } }
        }

        if word(["trading", "stock", "stocks", "forex", "crypto", "broker", "brokerage", "portfolio",
                 "מסחר", "מניות", "השקעות", "השקעה", "קריפטו", "ברוקר", "פורטפוליו"]) ||
            stem(["invest"]) ||
            text.contains("תיק השקעות") {
            return .trading
        }

        if word(["finance", "financial", "bank", "banking", "wallet", "budget",
                 "כסף", "בנק", "ארנק", "פיננסים", "פיננסי", "תקציב"]) ||
            stem(["פיננס"]) {
            return .finance
        }

        // stem() keeps typo tolerance: "runing", "runnning", "joging" still match.
        if word(["fitness", "workout", "workouts", "gym", "marathon", "training", "tempo",
                 "pace", "sport", "sports",
                 "כושר", "אימון", "אימונים", "ריצה", "ריצות", "רץ", "רצים", "הליכה", "ספורט", "קצב", "מסלול"]) ||
            stem(["run", "jog"]) {
            return .fitness
        }

        if word(["mental", "therapy", "wellness", "meditation", "mindfulness", "calm",
                 "מדיטציה", "נפש", "רוגע", "מיינדפולנס"]) {
            return .mentalHealth
        }

        if word(["travel", "hotel", "hotels", "flight", "flights", "trip", "trips", "vacation",
                 "טיול", "טיולים", "נסיעה", "נסיעות", "מלון", "מלונות", "טיסה", "טיסות", "חופשה"]) {
            return .travel
        }

        if word(["shop", "shopping", "ecommerce", "store", "marketplace", "product", "products",
                 "חנות", "קניות", "מוצר", "מוצרים"]) {
            return .ecommerce
        }

        if word(["food", "delivery", "restaurant", "restaurants", "recipe", "recipes",
                 "אוכל", "משלוחים", "מסעדה", "מסעדות", "מתכון", "מתכונים"]) {
            return .foodDelivery
        }

        if word(["learn", "learning", "course", "courses", "education", "school", "study",
                 "לימוד", "לימודים", "קורס", "קורסים", "חינוך"]) {
            return .education
        }

        if word(["spotify", "music", "song", "songs", "playlist", "playlists", "audio", "podcast", "podcasts",
                 "מוזיקה", "שיר", "שירים", "פלייליסט", "ספוטיפיי", "פודקאסט"]) {
            return .music
        }

        if word(["ai", "chat", "chatbot", "assistant", "messaging", "messenger", "messages",
                 "צאט", "שיחה", "הודעות", "עוזר"]) ||
            text.contains("צ'אט") {
            return .aiChat
        }

        if word(["habit", "habits", "routine", "routines", "streak", "streaks", "הרגל", "הרגלים"]) {
            return .habitTracker
        }

        return .generic
    }
}
