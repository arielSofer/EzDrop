//
//  DesignRecipe.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

enum VisualStylePreset: String, Codable, CaseIterable {
    case softFintech
    case minimalEditorial
    case premiumDark
    case appleCalm
    case cleanSaaS
    case energeticFitness
    case softWellness
    case luxuryTravel
    case playfulEcommerce
    case focusedProductivity
    case immersiveTravelNature
    case glassRealEstate
    case darkBeverageEditorial
    case softProductCommerce
    case immersiveWellnessAudio
    case premiumAudioDark
    case premiumArtDirection
    // Production-app systems distilled from the local AppShots corpus.
    case socialContent
    case messagingUtility
    case cinematicMedia
    case commerceUtility
    case healthMetrics
    case mindfulIllustrated
}

enum LayoutPattern: String, Codable {
    case mobileHeroCards
    case mobileOnboardingCarousel
    case mobileDashboard
    case mobileFormCentered
    case mobileFeed
    case mobileSearchExplore
    case mobileProgressHome
    case mobileCheckout
    case mobileChat
}

// מתכון עיצובי שמנחה את ה־Agent איך לבנות מסך איכותי
struct DesignRecipe: Codable {
    let category: AppCategory
    let screenType: ScreenType
    let recommendedStyle: VisualStylePreset
    let layoutPattern: LayoutPattern
    let requiredSections: [String]
    let recommendedComponents: [String]
    let qualityRules: [String]
    let avoidRules: [String]
}
