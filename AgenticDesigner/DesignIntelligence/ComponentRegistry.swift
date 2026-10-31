//
//  ComponentRegistry.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

enum ComponentType: String, Codable, CaseIterable {
    case avatarGreetingHeader
    case balanceHeroCard
    case quickActionRow
    case transactionRow
    case transactionList
    case currencyCard
    case currencyCardGrid
    case bottomNavBar
    case primaryButton
    case secondaryButton
    case textField
    case metricCard
    case chartCard
    case onboardingScreen
    case editorialIllustrationBlock
    case progressRing
    case workoutCard
    case statCard
    case primaryCTA
    case moodCheckInCard
    case journalPromptCard
    case softPrimaryButton
    case progressCard
    case searchBar
    case destinationHeroCard
    case categoryChips
    case destinationCard
    case bookingCTA
    case header
    case heroCard
    case contentCard
    case largeIconTile
    case iconFeatureGrid
    case productCard
    case chatMessage
    case chatInput
    case skipLink
    case editorialHeadline
    case lineArtIllustration
    case bodyCopy
    case pillPrimaryButton
    case pillSecondaryButton
    case headerIcon
    case inputField
    case textLink
    case socialButton
    case imageHero
    case imageCard
    case backgroundImage
    case maskedImage
    case productImage
    case galleryStrip
    case travelHeroScreen
    case travelDiscoverScreen
    case travelDetailScreen
    case travelHeroCard
    case propertySearchScreen
    case propertyHeroCard
    case propertyDetailCard
    case apartmentCard
    case amenityRow
    case beverageHeroScreen
    case flavorVariationStrip
    case beverageProductCard
    case productHeroScreen
    case ecommerceHeroProduct
    case productHeroCard
    case productGrid
    case productDetailPanel
    case addToCartCTA
    
    // iPad & Media Components
    case sidebar
    case splitView
    case cardGrid
    case mediaCard
    case bookCard
    case meditationHeroScreen
    case meditationHeroImage
    case audioPlayerCard
    case playerControl
    case meditationTrackList
    case audioTrackList
    case moodTabBar
    case instructorCard
    // Banking / Card Management / Insights components
    case creditCardPreview
    case toggleRow
    case progressBar
    case categoryRow
    case budgetGauge
    case controlButton
    case insightCard
    case securitySettingRow
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        let normalizedValue = rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: " ", with: "")
        
        if let exactMatch = ComponentType.allCases.first(where: {
            $0.rawValue
                .lowercased()
                .replacingOccurrences(of: "_", with: "")
                .replacingOccurrences(of: "-", with: "")
                .replacingOccurrences(of: " ", with: "") == normalizedValue
        }) {
            self = exactMatch
            return
        }
        
        switch normalizedValue {
        case "quickactionscard", "quickactions", "quickactioncards", "actionrow", "actiongrid":
            self = .quickActionRow
        case "accountcard", "accountsummarycard", "portfoliocard", "portfoliosummarycard", "brokeragecard":
            self = .balanceHeroCard
        case "assetrow", "holdingrow", "stockrow", "marketrow", "tickerrow", "watchlistrow":
            self = .transactionRow
        case "assetlist", "holdinglist", "stocklist", "marketlist", "watchlist", "tickerlist", "transactions", "activitylist":
            self = .transactionList
        case "marketchart", "portfoliochart", "performancechart", "interactivechart":
            self = .chartCard
        case "primarycta", "ctabutton", "primarybutton":
            self = .primaryCTA
        case "navbar", "bottomnavigation", "tabbar":
            self = .bottomNavBar
        case "greetingheader", "avatarheader", "profileheader":
            self = .avatarGreetingHeader
        case "statcard", "statscard", "keymetriccard", "metric":
            self = .metricCard
        case "travelherocard", "travelheroimagecard", "heroimagescreen":
            self = .travelHeroScreen
        case "traveldiscoverscreen", "discovercardscreen", "destinationdiscoverscreen":
            self = .travelDiscoverScreen
        case "traveldetailscreen", "destinationdetailscreen", "tripdetailscreen":
            self = .travelDetailScreen
        case "propertysearchscreen", "propertylistscreen", "realestatesearchscreen":
            self = .propertySearchScreen
        case "propertyherocard", "realestateherocard", "apartmentherocard":
            self = .propertyHeroCard
        case "propertydetailscreen", "propertydetailcard", "realestatedetailscreen":
            self = .propertyDetailCard
        case "beverageheroscreen", "juiceheroscreen", "drinkheroscreen":
            self = .beverageHeroScreen
        case "productheroscreen", "ecommerceheroproduct", "ecommerceheroscreen", "productherocard":
            self = .productHeroScreen
        case "meditationheroscreen", "meditationaudioscreen", "wellnessaudioscreen":
            self = .meditationHeroScreen
        case "audioplayercard", "playercontrol", "musicplayercard":
            self = .audioPlayerCard
        case "icontile", "largeicontile", "featureicon", "featuretile", "imageicontile", "bigicontile":
            self = .largeIconTile
        case "iconfeaturegrid", "featuregrid", "icongrid", "largeicongrid", "imageicongrid", "featuretiles":
            self = .iconFeatureGrid
        case "creditcard", "creditcardpreview", "cardpreview", "visacard", "mastercardpreview":
            self = .creditCardPreview
        case "toggle", "togglerow", "switchrow", "togglesetting", "settingtoggle":
            self = .toggleRow
        case "progress", "progressbar", "horizontalprogress", "loadingbar":
            self = .progressBar
        case "categoryrow", "spendingcategory", "budgetcategory", "categoryspendinrow":
            self = .categoryRow
        case "budgetgauge", "budgetmeter", "budgetprogress", "spendingprogress":
            self = .budgetGauge
        case "controlbutton", "iconbutton", "actionbutton", "circlebutton":
            self = .controlButton
        case "insightcard", "financialinsight", "tipcard", "suggestioncard":
            self = .insightCard
        case "securitysettingrow", "securityrow", "securitysetting", "securityoption":
            self = .securitySettingRow
        default:
            self = .contentCard
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}
