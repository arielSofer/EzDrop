//
//  VisualArtDirection.swift
//  AgenticDesigner
//
//  Created by Codex on 03/07/2026.
//

import Foundation

enum VisualProductCategory: String, Codable {
    case travelNature
    case realEstateLuxury
    case beverageBrand
    case ecommerceProduct
    case meditationWellness
    case fitnessPerformance
    case fintechSoft
    case musicAudio
    case fashionRetail
    case foodDelivery
    case generic
}

enum PresentationMode: String, Codable {
    case appScreen
    case presentationShot
}

struct VisualRecipe: Codable {
    let name: String
    let category: VisualProductCategory
    let stylePreset: String
    let presentationMode: PresentationMode
    let visualRules: [String]
    let recommendedComponents: [String]
    let assetPlaceholders: [String]
    let qualityRules: [String]
}

enum VisualProductCategoryClassifier {
    static func classify(prompt: String) -> VisualProductCategory {
        let text = prompt.lowercased()
        
        if text.contains("real estate") ||
            text.contains("property") ||
            text.contains("apartment") ||
            text.contains("villa") {
            return .realEstateLuxury
        }
        
        if text.contains("juice") ||
            text.contains("beverage") ||
            text.contains("drink") ||
            text.contains("smoothie") {
            return .beverageBrand
        }
        
        if text.contains("meditation") ||
            text.contains("wellness") ||
            text.contains("mindful") ||
            text.contains("calm") ||
            text.contains("מדיטציה") ||
            text.contains("רוגע") ||
            text.contains("מיינדפולנס") {
            return .meditationWellness
        }
        
        if text.contains("fitness") ||
            text.contains("workout") ||
            text.contains("gym") ||
            text.contains("run") ||
            text.contains("running") ||
            text.contains("jog") ||
            text.contains("marathon") ||
            text.contains("training") ||
            text.contains("pace") ||
            text.contains("כושר") ||
            text.contains("אימון") ||
            text.contains("ריצה") ||
            text.contains("ריצות") ||
            text.contains("ספורט") ||
            text.contains("קצב") {
            return .fitnessPerformance
        }
        
        if (text.contains("headphone") || text.contains("speaker")) &&
            (text.contains("shop") || text.contains("store") || text.contains("sell") || text.contains("ecommerce") || text.contains("product")) {
            return .ecommerceProduct
        }
        
        if text.contains("spotify") ||
            text.contains("music") ||
            text.contains("album") ||
            text.contains("artist") ||
            text.contains("playlist") ||
            text.contains("song") ||
            text.contains("podcast") ||
            text.contains("audio") ||
            text.contains("headphone") ||
            text.contains("speaker") ||
            text.contains("מוזיקה") ||
            text.contains("שירים") ||
            text.contains("פלייליסט") ||
            text.contains("ספוטיפיי") {
            return .musicAudio
        }
        
        if text.contains("travel") ||
            text.contains("trip") ||
            text.contains("journey") ||
            text.contains("hotel") ||
            text.contains("destination") ||
            text.contains("טיול") ||
            text.contains("נסיעה") ||
            text.contains("מלון") ||
            text.contains("חופשה") {
            return .travelNature
        }
        
        if text.contains("shop") ||
            text.contains("store") ||
            text.contains("product") ||
            text.contains("ecommerce") {
            return .ecommerceProduct
        }
        
        if text.contains("bank") ||
            text.contains("finance") ||
            text.contains("broker") ||
            text.contains("portfolio") ||
            text.contains("stock") ||
            text.contains("trading") ||
            text.contains("trade") ||
            text.contains("invest") ||
            text.contains("crypto") ||
            text.contains("wallet") ||
            text.contains("מניות") ||
            text.contains("מסחר") ||
            text.contains("השקעות") ||
            text.contains("קריפטו") ||
            text.contains("ארנק") ||
            text.contains("פורטפוליו") {
            return .fintechSoft
        }
        
        if text.contains("fashion") ||
            text.contains("clothing") ||
            text.contains("retail") {
            return .fashionRetail
        }
        
        if text.contains("food") ||
            text.contains("restaurant") ||
            text.contains("delivery") {
            return .foodDelivery
        }
        
        return .generic
    }
}

enum PresentationModeClassifier {
    static func classify(prompt: String) -> PresentationMode {
        let text = prompt.lowercased()
        
        if text.contains("presentation") ||
            text.contains("showcase") ||
            text.contains("dribbble") ||
            text.contains("portfolio") ||
            text.contains("concept") ||
            text.contains("inspiration") ||
            text.contains("like the examples") ||
            text.contains("premium app concept") {
            return .presentationShot
        }
        
        return .appScreen
    }
}

enum VisualRecipeLibrary {
    static func recipe(
        visualCategory: VisualProductCategory,
        presentationMode: PresentationMode
    ) -> VisualRecipe {
        switch visualCategory {
        case .travelNature:
            return travelNatureShowcase(presentationMode: presentationMode)
        case .realEstateLuxury:
            return glassRealEstateShowcase(presentationMode: presentationMode)
        case .beverageBrand:
            return darkBeverageEditorial(presentationMode: presentationMode)
        case .ecommerceProduct, .fashionRetail:
            return softProductCommerce(presentationMode: presentationMode)
        case .musicAudio:
            return premiumMusicPlayer(presentationMode: presentationMode)
        case .meditationWellness:
            return immersiveWellnessAudio(presentationMode: presentationMode)
        case .fitnessPerformance:
            return fitnessPerformanceArt(presentationMode: presentationMode)
        case .fintechSoft:
            return fintechImageSoft(presentationMode: presentationMode)
        case .foodDelivery:
            return darkBeverageEditorial(presentationMode: presentationMode)
        case .generic:
            return premiumGenericArtDirection(presentationMode: presentationMode)
        }
    }
    
    private static func fitnessPerformanceArt(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "fitnessPerformanceArt",
            category: .fitnessPerformance,
            stylePreset: "energeticFitness",
            presentationMode: presentationMode,
            visualRules: [
                "Use energetic but controlled sport imagery: runner, workout, route, pace, heart-rate or progress visuals.",
                "Use clear performance hierarchy: one main metric or action, then compact supporting stats.",
                "Use strong contrast, breathable cards and one warm/active accent. Avoid random ecommerce or finance language.",
                "Image-led fitness screens should feel motivational, not like a stock trading dashboard."
            ],
            recommendedComponents: [
                "imageHero",
                "metricCard",
                "progressCard",
                "workoutCard",
                "statCard",
                "primaryCTA",
                "bottomNavBar"
            ],
            assetPlaceholders: [
                "running_trail",
                "fitness_workout",
                "route_map"
            ],
            qualityRules: [
                "Use fitness copy only: pace, distance, route, goal, recovery, activity, start run.",
                "Never use portfolio, shop, cart, stock, buy, sell, deposit, transfer or market labels for fitness screens.",
                "Keep dark sections readable with explicit light text colors."
            ]
        )
    }
    
    private static func travelNatureShowcase(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "travelNatureShowcase",
            category: .travelNature,
            stylePreset: "immersiveTravelNature",
            presentationMode: presentationMode,
            visualRules: [
                "Use large scenic image cards as the dominant element.",
                "Use deep green / forest palette with white cards over imagery.",
                "Use overlay gradients for text readability.",
                "Prefer rounded mobile screens, destination cards, maps/details and gallery strips."
            ],
            recommendedComponents: [
                "travelHeroScreen",
                "travelDiscoverScreen",
                "travelDetailScreen",
                "travelHeroCard",
                "destinationCard",
                "galleryStrip",
                "floatingCTA"
            ],
            assetPlaceholders: [
                "travel_forest",
                "travel_mountain",
                "travel_lake"
            ],
            qualityRules: [
                "The image must be the hero.",
                "Keep text minimal and high contrast.",
                "Use one dominant typographic hero."
            ]
        )
    }
    
    private static func glassRealEstateShowcase(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "glassRealEstateShowcase",
            category: .realEstateLuxury,
            stylePreset: "glassRealEstate",
            presentationMode: presentationMode,
            visualRules: [
                "Use architectural imagery and blue/gray backgrounds.",
                "Use glassmorphism cards, soft blur overlays and large property heroes.",
                "Make price or property title visually dominant."
            ],
            recommendedComponents: [
                "propertySearchScreen",
                "propertyHeroCard",
                "propertyDetailCard",
                "apartmentCard",
                "amenityRow",
                "bookingCTA"
            ],
            assetPlaceholders: [
                "real_estate_building",
                "apartment_interior",
                "city_skyline"
            ],
            qualityRules: [
                "Use soft shadows and glass cards.",
                "Keep property information readable.",
                "Avoid generic rectangle layouts."
            ]
        )
    }
    
    private static func darkBeverageEditorial(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "darkBeverageEditorial",
            category: .beverageBrand,
            stylePreset: "darkBeverageEditorial",
            presentationMode: presentationMode,
            visualRules: [
                "Use dark background with full-bleed product or fruit imagery.",
                "Use white typography and high contrast CTA.",
                "Use product variation strips and editorial brand typography."
            ],
            recommendedComponents: [
                "beverageHeroScreen",
                "flavorVariationStrip",
                "beverageProductCard",
                "priceCTA",
                "imageBackgroundOverlay"
            ],
            assetPlaceholders: [
                "berries_dark",
                "juice_bottle",
                "fruit_texture"
            ],
            qualityRules: [
                "Make the product feel premium and tactile.",
                "Use one strong hero object.",
                "Avoid bright random colors."
            ]
        )
    }
    
    private static func softProductCommerce(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "softProductCommerce",
            category: .ecommerceProduct,
            stylePreset: "softProductCommerce",
            presentationMode: presentationMode,
            visualRules: [
                "Use pastel background, large product hero and rounded product cards.",
                "Use category chips, product grids and soft shadows."
            ],
            recommendedComponents: [
                "productHeroScreen",
                "productHeroCard",
                "productGrid",
                "categoryChips",
                "productDetailPanel",
                "addToCartCTA"
            ],
            assetPlaceholders: [
                "headphones_pink",
                "product_soft_shadow",
                "product_detail"
            ],
            qualityRules: [
                "Make the product the hero.",
                "Use soft depth and clean commerce hierarchy.",
                "Keep CTA obvious."
            ]
        )
    }
    
    private static func premiumMusicPlayer(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "premiumMusicPlayer",
            category: .musicAudio,
            stylePreset: "premiumAudioDark",
            presentationMode: presentationMode,
            visualRules: [
                "Use dark immersive background, glassy cards, large album artwork, waveform motifs and purple/cyan accents.",
                "Make album artwork or now-playing visual card the hero.",
                "Use clear music hierarchy: artist, track, playlist, queue, player controls.",
                "Avoid ecommerce product language and meditation defaults."
            ],
            recommendedComponents: [
                "audioPlayerCard",
                "audioTrackList",
                "moodTabBar",
                "bottomNavBar"
            ],
            assetPlaceholders: [
                "album_art_gradient",
                "artist_portrait",
                "waveform_visual"
            ],
            qualityRules: [
                "Make album artwork the visual hero.",
                "Use clear now-playing hierarchy.",
                "Keep queue content compact.",
                "Avoid meditation or ecommerce defaults.",
                "Keep text high contrast on dark backgrounds."
            ]
        )
    }
    
    private static func immersiveWellnessAudio(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "immersiveWellnessAudio",
            category: .meditationWellness,
            stylePreset: "immersiveWellnessAudio",
            presentationMode: presentationMode,
            visualRules: [
                "Use atmospheric imagery with dark overlays.",
                "Use calm large typography and audio player controls.",
                "Use mood categories and curved shapes."
            ],
            recommendedComponents: [
                "meditationHeroScreen",
                "meditationHeroImage",
                "audioPlayerCard",
                "audioTrackList",
                "moodTabBar",
                "instructorCard"
            ],
            assetPlaceholders: [
                "meditation_landscape",
                "calm_mountains",
                "wellness_ambient"
            ],
            qualityRules: [
                "The mood should feel calm and immersive.",
                "Use soft contrast instead of harsh UI.",
                "Use image overlay for readability."
            ]
        )
    }
    
    private static func fintechImageSoft(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "fintechSoftImageLed",
            category: .fintechSoft,
            stylePreset: "softFintech",
            presentationMode: presentationMode,
            visualRules: [
                "Use strong numeric hierarchy with premium cards.",
                "Use subtle shadows, charts and soft financial imagery sparingly."
            ],
            recommendedComponents: [
                "header",
                "balanceHeroCard",
                "chartCard",
                "metricCard",
                "transactionRow",
                "bottomNavBar"
            ],
            assetPlaceholders: [
                "finance_gradient",
                "market_chart",
                "portfolio_card"
            ],
            qualityRules: [
                "Prioritize trust, clarity and readable numbers.",
                "Use one accent color."
            ]
        )
    }
    
    private static func premiumGenericArtDirection(presentationMode: PresentationMode) -> VisualRecipe {
        VisualRecipe(
            name: "premiumGenericArtDirection",
            category: .generic,
            stylePreset: "premiumArtDirection",
            presentationMode: presentationMode,
            visualRules: [
                "Use a clear visual hero.",
                "Use restrained colors, strong typography, rounded cards and soft shadows."
            ],
            recommendedComponents: [
                "imageHero",
                "heroCard",
                "contentCard",
                "primaryCTA"
            ],
            assetPlaceholders: [
                "premium_placeholder"
            ],
            qualityRules: [
                "Every screen needs one dominant typographic hero.",
                "Avoid overcrowding."
            ]
        )
    }
}
