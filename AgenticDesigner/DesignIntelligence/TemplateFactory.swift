//
//  TemplateFactory.swift
//  AgenticDesigner
//
//  One-click starter apps — no prompt, no API key, no wait. Each template is
//  assembled deterministically from the typed component registry and styled
//  by a VisualStylePreset, emitted in the agent's own action dialect and
//  replayed through the exact applyDesignActions path the AI uses. Templates
//  therefore improve automatically whenever ComponentFactory does.
//

import Foundation
import CoreGraphics

struct AppTemplate: Identifiable {
    let id: String
    let name: String
    let subtitle: String
    let style: VisualStylePreset
    let screens: [TemplateScreen]
}

struct TemplateScreen {
    let name: String
    /// (componentType raw name, props, fixed height in the stack)
    let stack: [(type: String, props: [String: String], height: CGFloat)]
    /// Component pinned to the screen bottom (tab bar), if any.
    var bottomBar: Bool = true
}

enum TemplateFactory {

    // MARK: - Catalog

    static let all: [AppTemplate] = [
        AppTemplate(
            id: "finance-dashboard", name: "Finance Dashboard",
            subtitle: "Balance, quick actions, transactions",
            style: .softFintech,
            screens: [
                TemplateScreen(name: "Home", stack: [
                    ("avatarGreetingHeader", ["greeting": "Good morning", "name": "Alex"], 64),
                    ("balanceHeroCard", ["title": "Total Balance", "amount": "$24,562.80", "delta": "+2.4% this month"], 180),
                    ("quickActionRow", [:], 92),
                    ("transactionList", ["title": "Recent Activity"], 280),
                ]),
                TemplateScreen(name: "Analytics", stack: [
                    ("header", ["title": "Analytics"], 56),
                    ("chartCard", ["title": "Spending", "period": "Last 6 months"], 240),
                    ("metricCard", ["title": "Income", "value": "$8,210"], 110),
                    ("metricCard", ["title": "Expenses", "value": "$5,904"], 110),
                ]),
                TemplateScreen(name: "Profile", stack: [
                    ("avatarGreetingHeader", ["greeting": "Premium member", "name": "Alex Rivera"], 72),
                    ("contentCard", ["title": "Account", "subtitle": "Profile, security, linked banks"], 110),
                    ("contentCard", ["title": "Notifications", "subtitle": "Alerts and weekly summaries"], 110),
                    ("contentCard", ["title": "Privacy", "subtitle": "Data sharing and permissions"], 110),
                ]),
            ]
        ),
        AppTemplate(
            id: "fitness-tracker", name: "Fitness Tracker",
            subtitle: "Workouts, progress rings, streaks",
            style: .energeticFitness,
            screens: [
                TemplateScreen(name: "Today", stack: [
                    ("avatarGreetingHeader", ["greeting": "Let's move", "name": "Jordan"], 64),
                    ("progressRing", ["title": "Daily Goal", "progress": "68%"], 200),
                    ("workoutCard", ["title": "Morning Run", "duration": "5.2 km · 28 min"], 140),
                    ("workoutCard", ["title": "Strength", "duration": "Upper body · 45 min"], 140),
                ]),
                TemplateScreen(name: "Workout", stack: [
                    ("header", ["title": "Morning Run"], 56),
                    ("heroCard", ["title": "5.2 km", "subtitle": "Personal best pace"], 200),
                    ("metricCard", ["title": "Calories", "value": "412"], 110),
                    ("metricCard", ["title": "Heart Rate", "value": "148 bpm"], 110),
                ]),
                TemplateScreen(name: "Stats", stack: [
                    ("header", ["title": "This Week"], 56),
                    ("chartCard", ["title": "Activity", "period": "7 days"], 240),
                    ("statCard", ["title": "Streak", "value": "12 days"], 110),
                ]),
            ]
        ),
        AppTemplate(
            id: "ecommerce-shop", name: "E-commerce Shop",
            subtitle: "Storefront, product page, cart",
            style: .playfulEcommerce,
            screens: [
                TemplateScreen(name: "Shop", stack: [
                    ("searchBar", ["placeholder": "Search products"], 52),
                    ("categoryChips", [:], 48),
                    ("heroCard", ["title": "Summer Sale", "subtitle": "Up to 40% off"], 180),
                    ("productGrid", [:], 300),
                ]),
                TemplateScreen(name: "Product", stack: [
                    ("header", ["title": "Product"], 56),
                    ("heroCard", ["title": "Studio Headphones", "subtitle": "$249"], 260),
                    ("contentCard", ["title": "Details", "subtitle": "Wireless, 40h battery, memory foam."], 140),
                    ("primaryButton", ["title": "Add to Cart"], 60),
                ]),
                TemplateScreen(name: "Cart", stack: [
                    ("header", ["title": "Your Cart"], 56),
                    ("contentCard", ["title": "Studio Headphones", "subtitle": "Qty 1 · $249"], 96),
                    ("contentCard", ["title": "Woven Tote Bag", "subtitle": "Qty 1 · $189"], 96),
                    ("metricCard", ["title": "Total", "value": "$438"], 100),
                    ("primaryButton", ["title": "Checkout"], 60),
                ]),
            ]
        ),
        AppTemplate(
            id: "travel-explorer", name: "Travel Explorer",
            subtitle: "Destinations, trip details",
            style: .luxuryTravel,
            screens: [
                TemplateScreen(name: "Explore", stack: [
                    ("searchBar", ["placeholder": "Where to?"], 52),
                    ("categoryChips", [:], 48),
                    ("heroCard", ["title": "Kyoto, Japan", "subtitle": "Temples & gardens"], 220),
                    ("contentCard", ["title": "Santorini", "subtitle": "Aegean sunsets"], 140),
                ]),
                TemplateScreen(name: "Trip", stack: [
                    ("header", ["title": "Kyoto"], 56),
                    ("heroCard", ["title": "5 days", "subtitle": "Apr 12 – Apr 17"], 220),
                    ("contentCard", ["title": "Itinerary", "subtitle": "Fushimi Inari, Arashiyama, tea ceremony."], 160),
                    ("primaryButton", ["title": "Book Trip"], 60),
                ]),
                TemplateScreen(name: "Saved", stack: [
                    ("header", ["title": "Saved Places"], 56),
                    ("contentCard", ["title": "Lisbon", "subtitle": "Tram 28, pastel streets"], 130),
                    ("contentCard", ["title": "Reykjavik", "subtitle": "Northern lights"], 130),
                ]),
            ]
        ),
        AppTemplate(
            id: "ai-chat", name: "AI Chat Assistant",
            subtitle: "Conversation, history",
            style: .premiumDark,
            screens: [
                TemplateScreen(name: "Chat", stack: [
                    ("header", ["title": "Assistant"], 56),
                    ("chatMessage", ["role": "assistant", "text": "Hi! How can I help today?"], 90),
                    ("chatMessage", ["role": "user", "text": "Plan my week"], 70),
                    ("chatMessage", ["role": "assistant", "text": "Here's a focused plan for your week…"], 110),
                    ("textField", ["placeholder": "Message…"], 56),
                ], bottomBar: false),
                TemplateScreen(name: "History", stack: [
                    ("header", ["title": "Conversations"], 56),
                    ("contentCard", ["title": "Week planning", "subtitle": "Yesterday"], 100),
                    ("contentCard", ["title": "Trip ideas", "subtitle": "Monday"], 100),
                    ("contentCard", ["title": "Recipe help", "subtitle": "Last week"], 100),
                ]),
            ]
        ),
        AppTemplate(
            id: "wellness", name: "Wellness & Meditation",
            subtitle: "Calm home, session player",
            style: .appleCalm,
            screens: [
                TemplateScreen(name: "Today", stack: [
                    ("avatarGreetingHeader", ["greeting": "Good evening", "name": "Sam"], 64),
                    ("heroCard", ["title": "Evening Wind-down", "subtitle": "10 min · Breathing"], 200),
                    ("contentCard", ["title": "Sleep Stories", "subtitle": "Drift off gently"], 130),
                    ("contentCard", ["title": "Focus", "subtitle": "Deep work sounds"], 130),
                ]),
                TemplateScreen(name: "Session", stack: [
                    ("header", ["title": "Evening Wind-down"], 56),
                    ("progressRing", ["title": "Remaining", "progress": "6:24"], 240),
                    ("primaryButton", ["title": "Pause"], 60),
                ]),
            ]
        ),
        AppTemplate(
            id: "saas-onboarding", name: "SaaS Onboarding",
            subtitle: "Welcome, login, paywall",
            style: .minimalEditorial,
            screens: [
                TemplateScreen(name: "Welcome", stack: [
                    ("heroCard", ["title": "Ship faster", "subtitle": "The workspace for modern teams"], 280),
                    ("primaryButton", ["title": "Get Started"], 60),
                    ("secondaryButton", ["title": "I have an account"], 56),
                ], bottomBar: false),
                TemplateScreen(name: "Login", stack: [
                    ("header", ["title": "Welcome back"], 64),
                    ("textField", ["placeholder": "Email"], 56),
                    ("textField", ["placeholder": "Password"], 56),
                    ("primaryButton", ["title": "Log In"], 60),
                ], bottomBar: false),
                TemplateScreen(name: "Paywall", stack: [
                    ("header", ["title": "Go Pro"], 64),
                    ("heroCard", ["title": "Pro", "subtitle": "$12/mo — unlimited projects"], 220),
                    ("contentCard", ["title": "Everything in Free", "subtitle": "plus SSO, audit log, priority support"], 140),
                    ("primaryButton", ["title": "Start Free Trial"], 60),
                ], bottomBar: false),
            ]
        ),
    ]

    static func template(id: String) -> AppTemplate? {
        all.first { $0.id == id }
    }

    // MARK: - Action assembly

    private static let screenSize = CGSize(width: 390, height: 844)
    private static let margin: CGFloat = 20
    private static let gap: CGFloat = 16
    private static let topInset: CGFloat = 64

    /// Agent-dialect actions for a template — decoded through the same
    /// parser as live agent output, so apply behavior is identical.
    static func actions(for template: AppTemplate) throws -> [DesignAction] {
        let tokens = DesignTokenLibrary.tokens(for: template.style)
        var actionDicts: [[String: Any]] = []

        for (index, screen) in template.screens.enumerated() {
            let screenRef = "screen_\(index)"
            let originX = 100 + CGFloat(index) * (screenSize.width + 60)
            actionDicts.append([
                "type": "createFrame",
                "name": screen.name,
                "nodeReference": screenRef,
                "x": originX, "y": 100,
                "width": screenSize.width, "height": screenSize.height,
                "fill": tokens.colors.backgroundPrimary,
                "cornerRadius": 40,
            ])

            var cursorY = topInset
            for (componentIndex, item) in screen.stack.enumerated() {
                actionDicts.append([
                    "type": "createComponent",
                    "component": item.type,
                    "props": item.props,
                    "parentReference": screenRef,
                    "nodeReference": "\(screenRef)_c\(componentIndex)",
                    "stylePreset": template.style.rawValue,
                    "x": margin, "y": cursorY,
                    "width": screenSize.width - margin * 2, "height": item.height,
                ])
                cursorY += item.height + gap
            }

            if screen.bottomBar {
                actionDicts.append([
                    "type": "createComponent",
                    "component": "bottomNavBar",
                    "props": [:],
                    "parentReference": screenRef,
                    "nodeReference": "\(screenRef)_nav",
                    "stylePreset": template.style.rawValue,
                    "x": 0, "y": screenSize.height - 88,
                    "width": screenSize.width, "height": 88,
                ])
            }
        }

        let payload: [String: Any] = ["plan": [], "actions": actionDicts]
        let data = try JSONSerialization.data(withJSONObject: payload)
        return try JSONDecoder().decode(DesignAgentResponse.self, from: data).actions
    }
}
