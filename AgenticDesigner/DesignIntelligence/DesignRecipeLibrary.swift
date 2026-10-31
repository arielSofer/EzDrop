//
//  DesignRecipeLibrary.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

enum DesignRecipeLibrary {
    
    // מחזיר מתכון עיצובי לפי סוג האפליקציה וסוג המסך
    static func recipe(
        category: AppCategory,
        screenType: ScreenType
    ) -> DesignRecipe {
        
        switch (category, screenType) {
            
        case (.finance, .home), (.finance, .generic), (.banking, .home), (.banking, .generic):
            return financeHome
            
        case (.finance, .dashboard), (.trading, .dashboard), (.trading, .generic), (.trading, .home):
            return financeDashboard
            
        case (.fitness, .home), (.fitness, .generic), (.fitness, .dashboard), (.health, .home), (.health, .generic):
            return fitnessHome

        case (.mentalHealth, .home), (.mentalHealth, .generic):
            return mentalHealthHome

        case (.travel, .home), (.travel, .search), (.travel, .generic):
            return travelExplore

        case (.ecommerce, .home), (.ecommerce, .generic):
            return ecommerceHome
            
        case (.aiChat, .home), (.aiChat, .generic):
            return aiChatHome
            
        case (_, .onboarding):
            return premiumOnboarding
            
        case (_, .login):
            return premiumLogin
            
        default:
            return genericPremiumMobile
        }
    }
}

// MARK: - Specific Recipes
extension DesignRecipeLibrary {
    
    static let financeHome = DesignRecipe(
        category: .finance,
        screenType: .home,
        recommendedStyle: .softFintech,
        layoutPattern: .mobileHeroCards,
        requiredSections: [
            "Header with avatar and greeting",
            "Large balance hero card",
            "Quick actions row",
            "Latest transaction section",
            "Currency or account cards",
            "Bottom navigation"
        ],
        recommendedComponents: [
            "avatarGreetingHeader",
            "balanceHeroCard",
            "quickActionRow",
            "transactionRow",
            "currencyCard",
            "bottomNavBar"
        ],
        qualityRules: [
            "Use one strong accent color only.",
            "Make the balance the dominant visual element.",
            "Use large rounded cards with soft shadows.",
            "Keep financial values highly readable.",
            "Use clear separation between sections.",
            "Use muted metadata and strong primary numbers."
        ],
        avoidRules: [
            "Avoid too many bright colors.",
            "Avoid tiny financial numbers.",
            "Avoid unaligned transaction values.",
            "Avoid dense tables on mobile.",
            "Avoid generic rectangle layouts."
        ]
    )
    
    static let financeDashboard = DesignRecipe(
        category: .finance,
        screenType: .dashboard,
        recommendedStyle: .softFintech,
        layoutPattern: .mobileDashboard,
        requiredSections: [
            "Header with period selector",
            "Main chart area",
            "Key metrics row",
            "Detailed list"
        ],
        recommendedComponents: [
            "header",
            "chartCard",
            "metricCard",
            "transactionRow"
        ],
        qualityRules: [
            "Keep charts clean and simple.",
            "Focus on the main trend."
        ],
        avoidRules: [
            "Avoid cluttered axes on charts."
        ]
    )
    
    static let fitnessHome = DesignRecipe(
        category: .fitness,
        screenType: .home,
        recommendedStyle: .healthMetrics,
        layoutPattern: .mobileProgressHome,
        requiredSections: [
            "Personal greeting",
            "Daily progress hero section",
            "Workout plan cards",
            "Activity stats",
            "Primary workout CTA",
            "Bottom navigation"
        ],
        recommendedComponents: [
            "progressRing",
            "workoutCard",
            "statCard",
            "primaryCTA",
            "bottomNavBar"
        ],
        qualityRules: [
            "Use energetic but controlled color.",
            "Make progress visually clear.",
            "Use bold stats and simple labels.",
            "Keep the primary workout action dominant.",
            "Use cards for workout modules."
        ],
        avoidRules: [
            "Avoid overly medical visuals.",
            "Avoid too many stats at once.",
            "Avoid weak CTA hierarchy.",
            "Avoid random neon colors."
        ]
    )
    
    static let mentalHealthHome = DesignRecipe(
        category: .mentalHealth,
        screenType: .home,
        recommendedStyle: .mindfulIllustrated,
        layoutPattern: .mobileHeroCards,
        requiredSections: [
            "Calm greeting",
            "Mood check-in card",
            "Daily reflection prompt",
            "Breathing or meditation CTA",
            "Soft progress card"
        ],
        recommendedComponents: [
            "moodCheckInCard",
            "journalPromptCard",
            "softPrimaryButton",
            "progressCard"
        ],
        qualityRules: [
            "Use calm muted colors.",
            "Use generous whitespace.",
            "Avoid aggressive contrast.",
            "Make the interface feel safe and gentle.",
            "Use soft rounded cards."
        ],
        avoidRules: [
            "Avoid red warning colors.",
            "Avoid dense analytics.",
            "Avoid aggressive CTAs.",
            "Avoid financial-style dashboards."
        ]
    )
    
    static let travelExplore = DesignRecipe(
        category: .travel,
        screenType: .search,
        recommendedStyle: .luxuryTravel,
        layoutPattern: .mobileSearchExplore,
        requiredSections: [
            "Large search area",
            "Destination hero card",
            "Category chips",
            "Popular destinations carousel",
            "Booking CTA"
        ],
        recommendedComponents: [
            "searchBar",
            "destinationHeroCard",
            "categoryChips",
            "destinationCard",
            "bookingCTA"
        ],
        qualityRules: [
            "Use image-first composition.",
            "Use aspirational spacing.",
            "Make search highly visible.",
            "Use elegant destination cards.",
            "Use warm premium accents."
        ],
        avoidRules: [
            "Avoid dense text.",
            "Avoid tiny image placeholders.",
            "Avoid dashboard-like layouts.",
            "Avoid weak visual destination hierarchy."
        ]
    )
    
    static let ecommerceHome = DesignRecipe(
        category: .ecommerce,
        screenType: .home,
        recommendedStyle: .commerceUtility,
        layoutPattern: .mobileFeed,
        requiredSections: [
            "Header with cart",
            "Promo banner",
            "Categories carousel",
            "Featured products grid"
        ],
        recommendedComponents: [
            "header",
            "heroCard",
            "categoryChips",
            "productCard"
        ],
        qualityRules: [
            "High quality product images.",
            "Clear pricing."
        ],
        avoidRules: [
            "Cluttered grids."
        ]
    )
    
    static let aiChatHome = DesignRecipe(
        category: .aiChat,
        screenType: .home,
        recommendedStyle: .messagingUtility,
        layoutPattern: .mobileChat,
        requiredSections: [
            "Chat feed",
            "Input area with attach actions"
        ],
        recommendedComponents: [
            "chatMessage",
            "chatInput"
        ],
        qualityRules: [
            "Focus on content readability."
        ],
        avoidRules: [
            "Distracting backgrounds."
        ]
    )
    
    static let premiumOnboarding = DesignRecipe(
        category: .generic,
        screenType: .onboarding,
        recommendedStyle: .minimalEditorial,
        layoutPattern: .mobileOnboardingCarousel,
        requiredSections: [
            "Skip link",
            "Large editorial headline",
            "Central illustration",
            "Short explanatory body copy",
            "Primary CTA",
            "Secondary CTA"
        ],
        recommendedComponents: [
            "skipLink",
            "editorialHeadline",
            "lineArtIllustration",
            "bodyCopy",
            "pillPrimaryButton",
            "pillSecondaryButton"
        ],
        qualityRules: [
            "Use large whitespace.",
            "Use one clear visual idea.",
            "Use short, confident copy.",
            "Use bold editorial typography.",
            "Keep the design restrained and premium."
        ],
        avoidRules: [
            "Avoid clutter.",
            "Avoid tiny text.",
            "Avoid multiple competing illustrations.",
            "Avoid too many colors.",
            "Avoid generic login layout."
        ]
    )
    
    static let premiumLogin = DesignRecipe(
        category: .generic,
        screenType: .login,
        recommendedStyle: .minimalEditorial,
        layoutPattern: .mobileFormCentered,
        requiredSections: [
            "Logo or icon",
            "Welcome back headline",
            "Email input",
            "Password input",
            "Login CTA",
            "Forgot password link",
            "Social login buttons"
        ],
        recommendedComponents: [
            "headerIcon",
            "editorialHeadline",
            "inputField",
            "primaryCTA",
            "textLink",
            "socialButton"
        ],
        qualityRules: [
            "Keep the form clean and spacious."
        ],
        avoidRules: [
            "Avoid cluttered forms."
        ]
    )
    
    static let genericPremiumMobile = DesignRecipe(
        category: .generic,
        screenType: .generic,
        recommendedStyle: .appleCalm,
        layoutPattern: .mobileHeroCards,
        requiredSections: [
            "Clear header",
            "Hero section",
            "Primary content card",
            "Primary CTA"
        ],
        recommendedComponents: [
            "header",
            "heroCard",
            "contentCard",
            "primaryButton"
        ],
        qualityRules: [
            "Use strong hierarchy.",
            "Use consistent spacing.",
            "Use one primary CTA.",
            "Use restrained colors.",
            "Make the layout feel intentional."
        ],
        avoidRules: [
            "Avoid random element placement.",
            "Avoid inconsistent margins.",
            "Avoid too many colors.",
            "Avoid weak typography."
        ]
    )
}
