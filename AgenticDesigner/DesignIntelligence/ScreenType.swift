//
//  ScreenType.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

// סוגי מסכים שהמערכת יודעת לייצר
enum ScreenType: String, Codable {
    case onboarding
    case login
    case home
    case dashboard
    case details
    case profile
    case settings
    case checkout
    case search
    case feed
    case analytics
    case emptyState
    case paywall
    case generic
}

enum ScreenTypeClassifier {
    
    // מזהה סוג מסך לפי הפרומפט
    static func classify(prompt: String) -> ScreenType {
        let text = prompt.lowercased()
        
        if text.contains("onboarding") || text.contains("intro") || text.contains("welcome") {
            return .onboarding
        }
        
        if text.contains("login") || text.contains("sign in") || text.contains("auth") {
            return .login
        }
        
        if text.contains("dashboard") || text.contains("analytics") {
            return .dashboard
        }
        
        if text.contains("home") || text.contains("main screen") {
            return .home
        }
        
        if text.contains("profile") || text.contains("account") {
            return .profile
        }
        
        if text.contains("settings") {
            return .settings
        }
        
        if text.contains("checkout") || text.contains("payment") {
            return .checkout
        }
        
        if text.contains("search") || text.contains("explore") {
            return .search
        }
        
        if text.contains("paywall") || text.contains("pricing") || text.contains("subscription") {
            return .paywall
        }
        
        return .generic
    }
}
