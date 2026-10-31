//
//  ComponentFactory.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation
import CoreGraphics
import AppKit

private func makeStyle(
    fill: String,
    stroke: String? = nil,
    strokeWidth: CGFloat? = nil,
    cornerRadius: CGFloat = 0,
    opacity: Double = 1.0,
    fontSize: CGFloat? = nil,
    fontWeight: String? = nil,
    textColor: String? = nil,
    textAlign: String? = nil,
    letterSpacing: CGFloat? = nil,
    lineHeight: CGFloat? = nil,
    paddingTop: CGFloat? = nil,
    paddingRight: CGFloat? = nil,
    paddingBottom: CGFloat? = nil,
    paddingLeft: CGFloat? = nil,
    marginTop: CGFloat? = nil,
    marginRight: CGFloat? = nil,
    marginBottom: CGFloat? = nil,
    marginLeft: CGFloat? = nil,
    layout: String? = nil,
    spacing: CGFloat? = nil,
    shadow: ShadowStyle? = nil,
    blur: CGFloat? = nil,
    backgroundBlur: CGFloat? = nil,
    overlayColor: String? = nil,
    overlayOpacity: Double? = nil,
    gradient: GradientStyle? = nil
) -> NodeStyle {
    NodeStyle(
        fill: fill,
        stroke: stroke,
        strokeWidth: strokeWidth,
        cornerRadius: cornerRadius,
        opacity: opacity,
        fontSize: fontSize,
        fontWeight: fontWeight,
        textColor: textColor,
        textAlign: textAlign,
        letterSpacing: letterSpacing,
        lineHeight: lineHeight,
        paddingTop: paddingTop,
        paddingRight: paddingRight,
        paddingBottom: paddingBottom,
        paddingLeft: paddingLeft,
        marginTop: marginTop,
        marginRight: marginRight,
        marginBottom: marginBottom,
        marginLeft: marginLeft,
        layout: layout,
        spacing: spacing,
        shadow: shadow,
        blur: blur,
        backgroundBlur: backgroundBlur,
        overlayColor: overlayColor,
        overlayOpacity: overlayOpacity,
        gradient: gradient
    )
}


// Create pre-designed components based on DesignRecipe and DesignTokens
enum ComponentFactory {

    /// A deterministic, watch-sized runner screen (marked appleWatch-only).
    /// Built in code — NOT by the model — so a watch app appears for ANY AI
    /// that triggers a watch build, not just one smart enough to design it.
    static func watchRunnerScreen(activity: String = "Outdoor Run") -> DesignNode {
        let w: CGFloat = 198, h: CGFloat = 242
        var frame = DesignNode(
            type: .Frame, name: "Watch Runner",
            x: 0, y: 0, width: w, height: h,
            style: makeStyle(fill: "#0B0B0F", cornerRadius: 44),
            children: [
                DesignNode(type: .Text, name: "Activity", x: 16, y: 18, width: w - 32, height: 16,
                           text: activity.uppercased(),
                           style: transparentTextStyle(fontSize: 11, fontWeight: "semibold", color: "#9CA3AF")),
                DesignNode(type: .Text, name: "Distance", x: 16, y: 40, width: w - 32, height: 46,
                           text: "0.00 km",
                           style: transparentTextStyle(fontSize: 40, fontWeight: "bold", color: "#34D399")),
                DesignNode(type: .Text, name: "Pace", x: 16, y: 92, width: w - 32, height: 20,
                           text: "—:— /km",
                           style: transparentTextStyle(fontSize: 15, fontWeight: "medium", color: "#FFFFFF")),
                DesignNode(type: .Text, name: "Heart Rate", x: 16, y: 116, width: w - 32, height: 18,
                           text: "— bpm · Zone —",
                           style: transparentTextStyle(fontSize: 13, color: "#9CA3AF")),
                DesignNode(type: .Button, name: "Start Run", x: 16, y: h - 56, width: w - 32, height: 44,
                           text: "Start",
                           style: makeStyle(fill: "#34D399", cornerRadius: 22, fontSize: 16, fontWeight: "bold", textColor: "#0B0B0F"))
            ]
        )
        frame.supportedPlatforms = [.appleWatch]
        return frame
    }

    static func createComponent(
        _ type: ComponentType,
        props: [String: String]?,
        action: DesignAction,
        tokens: DesignTokens
    ) -> DesignNode {
        switch type {
        case .avatarGreetingHeader:
            return createAvatarGreetingHeader(props: props, action: action, tokens: tokens)
        case .balanceHeroCard:
            return createBalanceHeroCard(props: props, action: action, tokens: tokens)
        case .quickActionRow:
            return createQuickActionRow(props: props, action: action, tokens: tokens)
        case .progressRing:
            return createProgressRing(props: props, action: action, tokens: tokens)
        case .workoutCard:
            return createWorkoutCard(props: props, action: action, tokens: tokens)
        case .transactionRow:
            return createTransactionRow(props: props, action: action, tokens: tokens)
        case .transactionList:
            return createTransactionList(props: props, action: action, tokens: tokens)
        case .chartCard:
            return createChartCard(props: props, action: action, tokens: tokens)
        case .metricCard, .statCard, .currencyCard:
            return createMetricCard(type: type, props: props, action: action, tokens: tokens)
        case .currencyCardGrid:
            return createCurrencyCardGrid(props: props, action: action, tokens: tokens)
        case .bottomNavBar:
            return createBottomNavBar(props: props, action: action, tokens: tokens)
        case .header:
            return createHeader(props: props, action: action, tokens: tokens)
        case .searchBar:
            return createSearchBar(props: props, action: action, tokens: tokens)
        case .categoryChips:
            return createCategoryChips(props: props, action: action, tokens: tokens)
        case .heroCard:
            return createHeroCard(props: props, action: action, tokens: tokens)
        case .contentCard:
            return createContentCard(type: type, props: props, action: action, tokens: tokens)
        case .largeIconTile:
            return createLargeIconTile(props: props, action: action, tokens: tokens)
        case .iconFeatureGrid:
            return createIconFeatureGrid(props: props, action: action, tokens: tokens)
        case .chatMessage:
            return createChatMessage(props: props, action: action, tokens: tokens)
        case .chatInput:
            return createChatInput(props: props, action: action, tokens: tokens)

        case .imageHero, .imageCard, .backgroundImage, .maskedImage, .productImage:
            return createImageHeroCard(type: type, props: props, action: action, tokens: tokens)
        case .travelHeroScreen, .travelHeroCard:
            return createTravelHeroScreen(props: props, action: action, tokens: tokens)
        case .travelDiscoverScreen, .travelDetailScreen:
            return createTravelDetailScreen(type: type, props: props, action: action, tokens: tokens)
        case .propertySearchScreen, .propertyHeroCard, .propertyDetailCard, .apartmentCard:
            return createPropertyScreen(type: type, props: props, action: action, tokens: tokens)
        case .beverageHeroScreen, .beverageProductCard:
            return createBeverageHeroScreen(props: props, action: action, tokens: tokens)
        case .flavorVariationStrip, .galleryStrip:
            return createGalleryStrip(type: type, props: props, action: action, tokens: tokens)
        case .productHeroScreen, .ecommerceHeroProduct, .productHeroCard:
            return createProductHeroScreen(props: props, action: action, tokens: tokens)
        case .productGrid:
            return createProductGrid(props: props, action: action, tokens: tokens)
        case .meditationHeroScreen, .meditationHeroImage:
            return createMeditationHeroScreen(props: props, action: action, tokens: tokens)
        case .audioPlayerCard, .playerControl:
            return createAudioPlayerCard(props: props, action: action, tokens: tokens)
        case .audioTrackList, .meditationTrackList:
            return createTrackList(type: type, props: props, action: action, tokens: tokens)
        case .moodTabBar:
            return createCategoryChips(props: props, action: action, tokens: tokens)
        case .creditCardPreview:
            return createCreditCardPreview(props: props, action: action, tokens: tokens)
        case .toggleRow:
            return createToggleRow(props: props, action: action, tokens: tokens)
        case .progressBar:
            return createProgressBar(props: props, action: action, tokens: tokens)
        case .categoryRow:
            return createCategoryRow(props: props, action: action, tokens: tokens)
        case .budgetGauge:
            return createBudgetGauge(props: props, action: action, tokens: tokens)
        case .controlButton:
            return createControlButton(props: props, action: action, tokens: tokens)
        case .insightCard:
            return createInsightCard(props: props, action: action, tokens: tokens)
        case .securitySettingRow:
            return createSecuritySettingRow(props: props, action: action, tokens: tokens)
        case .sidebar:
            return createSidebar(props: props, action: action, tokens: tokens)
        case .splitView:
            return createSplitView(props: props, action: action, tokens: tokens)
        case .cardGrid:
            return createCardGrid(props: props, action: action, tokens: tokens)
        case .mediaCard, .bookCard, .productCard:
            return createMediaCard(props: props, action: action, tokens: tokens)
        case .progressCard:
            return createProgressCard(props: props, action: action, tokens: tokens)
        case .destinationCard, .destinationHeroCard:
            return createDestinationCard(type: type, props: props, action: action, tokens: tokens)
        case .moodCheckInCard, .journalPromptCard:
            return createMoodJournalCard(type: type, props: props, action: action, tokens: tokens)
        case .instructorCard:
            return createInstructorCard(props: props, action: action, tokens: tokens)
        case .textField, .inputField:
            return createInputField(props: props, action: action, tokens: tokens)
        case .primaryCTA, .primaryButton, .secondaryButton, .softPrimaryButton, .pillPrimaryButton, .pillSecondaryButton, .bookingCTA, .addToCartCTA, .skipLink, .socialButton:
            return createPrimaryCTA(type: type, props: props, action: action, tokens: tokens)
        case .textLink:
            return createTextLink(props: props, action: action, tokens: tokens)
        case .editorialHeadline, .bodyCopy:
            return createTextHeadline(type: type, props: props, action: action, tokens: tokens)
        case .editorialIllustrationBlock, .lineArtIllustration, .headerIcon:
            return createIllustrationBlock(type: type, props: props, action: action, tokens: tokens)
        case .amenityRow:
            return createAmenityRow(props: props, action: action, tokens: tokens)
        case .productDetailPanel:
            return createProductDetailPanel(props: props, action: action, tokens: tokens)
        case .onboardingScreen:
            return createOnboardingScreen(props: props, action: action, tokens: tokens)
        default:
            // Fallback for unimplemented components: just a simple card with a label
            return createGenericComponent(type: type, action: action, tokens: tokens)
        }
    }
    
    private static func transparentTextStyle(
        fontSize: CGFloat,
        fontWeight: String? = nil,
        color: String,
        textAlign: String? = nil
    ) -> NodeStyle {
        makeStyle(
            fill: "#00000000",
            fontSize: fontSize,
            fontWeight: fontWeight,
            textColor: color,
            textAlign: textAlign
        )
    }
    
    private static func flexibleNumber(_ rawValue: String?) -> CGFloat? {
        guard let rawValue else { return nil }
        let cleaned = rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "px", with: "")
            .replacingOccurrences(of: "pt", with: "")
            .replacingOccurrences(of: ",", with: ".")
        
        guard !cleaned.isEmpty,
              !["auto", "fit", "hug", "fill", "null"].contains(cleaned.lowercased()),
              let value = Double(cleaned)
        else {
            return nil
        }
        
        return CGFloat(value)
    }
    
    private static func createAvatarGreetingHeader(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 72
        let greeting = props?["greeting"] ?? "Welcome back"
        let name = props?["name"] ?? props?["title"] ?? "Today's focus"
        let titleWidth = w - 112
        let titleSize = fittingFontSize(name, width: titleWidth, maxSize: 24, minSize: 18)
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Avatar Greeting Header",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: [
                DesignNode(
                    type: .Rectangle,
                    name: "Avatar",
                    x: 0,
                    y: 8,
                    width: 48,
                    height: 48,
                    style: makeStyle(
                        fill: tokens.colors.surfaceSecondary,
                        cornerRadius: 24,
                        opacity: 1.0
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "Greeting",
                    x: 64,
                    y: 8,
                    width: titleWidth,
                    height: 20,
                    text: greeting,
                    style: transparentTextStyle(
                        fontSize: tokens.typography.caption.fontSize,
                        fontWeight: "regular",
                        color: tokens.colors.textSecondary
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "Title",
                    x: 64,
                    y: 30,
                    width: titleWidth,
                    height: 32,
                    text: name,
                    style: transparentTextStyle(
                        fontSize: titleSize,
                        fontWeight: "bold",
                        color: tokens.colors.textPrimary
                    ),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                ),
                DesignNode(
                    type: .Icon,
                    name: "Notification Icon",
                    x: w - 40,
                    y: 16,
                    width: 32,
                    height: 32,
                    iconName: "bell",
                    style: makeStyle(
                        fill: "#00000000",
                        textColor: tokens.colors.textPrimary
                    )
                )
            ]
        )
    }
    
    private static func createBalanceHeroCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 326
        let h = action.height ?? 168
        
        let currency = props?["currency"] ?? "USD"
        let balance = props?["balance"] ?? props?["amount"] ?? "$12,480.65"
        let change = props?["change"] ?? props?["delta"] ?? "+2.4% this month"
        
        let cardId = UUID()
        let card = DesignNode(
            id: cardId,
            type: .Frame,
            name: action.name ?? "Balance Hero Card",
            x: action.x ?? 32,
            y: action.y ?? 112,
            width: w,
            height: h,
            text: nil,
            style: makeStyle(
                fill: tokens.colors.accentPrimary,
                cornerRadius: tokens.radius.lg,
                opacity: 1.0,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.12, radius: 24, x: 0, y: 14)
            ),
            children: [
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Currency Label",
                    x: tokens.spacing.lg,
                    y: tokens.spacing.lg,
                    width: 100, height: 24,
                    text: currency,
                    style: makeStyle(
                        fill: "#00000000",
                        fontSize: tokens.typography.body.fontSize,
                        fontWeight: "medium",
                        textColor: "#FFFFFF"
                    )
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Balance",
                    x: tokens.spacing.lg,
                    y: tokens.spacing.lg + 32,
                    width: w - tokens.spacing.lg * 2, height: 48,
                    text: balance,
                    style: makeStyle(
                        fill: "#00000000",
                        fontSize: tokens.typography.title1.fontSize,
                        fontWeight: "bold",
                        textColor: "#FFFFFF"
                    )
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Change",
                    x: tokens.spacing.lg,
                    y: h - tokens.spacing.lg - 24,
                    width: 100, height: 24,
                    text: change,
                    style: makeStyle(
                        fill: "#00000000",
                        fontSize: tokens.typography.body.fontSize,
                        fontWeight: "medium",
                        textColor: "#DCEBFF"
                    )
                )
            ]
        )
        return card
    }
    
    private static func createTransactionRow(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h: CGFloat = 72
        
        let title = props?["title"] ?? "Transaction"
        let subtitle = props?["subtitle"] ?? "Today"
        let amount = props?["amount"] ?? props?["value"] ?? "-$42.30"
        let iconName = props?["icon"] ?? "cart.fill"
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Transaction Row",
            x: action.x ?? 16, y: action.y ?? 16,
            width: w, height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md, opacity: 1.0),
            children: [
                DesignNode(
                    id: UUID(),
                    type: .Icon,
                    name: "Icon",
                    x: 16, y: 16,
                    width: 40, height: 40,
                    iconName: iconName,
                    style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 20, opacity: 1.0, textColor: tokens.colors.accentPrimary)
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Title",
                    x: 72, y: 16,
                    width: 200, height: 24,
                    text: title,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.body.fontSize, fontWeight: "semibold", textColor: tokens.colors.textPrimary)
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Subtitle",
                    x: 72, y: 40,
                    width: 200, height: 16,
                    text: subtitle,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.caption.fontSize, fontWeight: "regular", textColor: tokens.colors.textSecondary)
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Amount",
                    x: w - 116, y: 24,
                    width: 100, height: 24,
                    text: amount,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.body.fontSize, fontWeight: "semibold", textColor: tokens.colors.textPrimary)
                )
            ]
        )
    }
    
    private static func createTransactionList(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 232
        // Rows are model-overridable (item1Title/item1Subtitle/item1Amount …);
        // the defaults are neutral activity, NOT Apple/Tesla stock tickers that
        // turned every "Recent activity" list into a trading app.
        func row(_ i: Int, _ dTitle: String, _ dSub: String, _ dAmt: String, _ icon: String, _ bg: String, _ fg: String)
            -> (String, String, String, String, String, String) {
            (props?["item\(i)Title"] ?? props?["item\(i)"] ?? dTitle,
             props?["item\(i)Subtitle"] ?? dSub,
             props?["item\(i)Amount"] ?? dAmt,
             props?["item\(i)Icon"] ?? icon, bg, fg)
        }
        let rows = [
            row(1, "Recent order", "2 items", "$189.00", "bag.fill", "#DCFCE7", tokens.colors.accentPrimary),
            row(2, "Delivered", "Last week", "", "shippingbox.fill", "#DBEAFE", "#2563EB"),
            row(3, "Saved for later", "Wishlist", "", "heart.fill", "#FEE2E2", "#DC2626")
        ]
        let rowHeight: CGFloat = 52
        let rowGap: CGFloat = 10
        
        var children: [DesignNode] = [
            DesignNode(
                type: .Text,
                name: "List Title",
                x: 18,
                y: 16,
                width: w - 108,
                height: 24,
                text: props?["title"] ?? "Recent activity",
                style: transparentTextStyle(
                    fontSize: fittingFontSize(props?["title"] ?? "Recent activity", width: w - 108, maxSize: 18, minSize: 14),
                    fontWeight: "bold",
                    color: tokens.colors.textPrimary
                ),
                textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
            ),
            DesignNode(
                type: .Text,
                name: "List Action",
                x: w - 88,
                y: 18,
                width: 70,
                height: 20,
                text: props?["action"] ?? "See all",
                style: transparentTextStyle(fontSize: 12, fontWeight: "semibold", color: tokens.colors.accentPrimary)
            )
        ]
        
        for (index, row) in rows.enumerated() {
            let y = CGFloat(index) * (rowHeight + rowGap) + 52
            let amountWidth: CGFloat = row.2.isEmpty ? 0 : min(104, max(48, CGFloat(row.2.count) * 8))
            let textWidth = max(108, w - 72 - amountWidth - (amountWidth > 0 ? 16 : 18))
            children.append(contentsOf: [
                DesignNode(
                    type: .Rectangle,
                    name: "\(row.0) Icon Background",
                    x: 18,
                    y: y + 6,
                    width: 40,
                    height: 40,
                    style: makeStyle(fill: row.4, cornerRadius: 20, opacity: 1.0)
                ),
                DesignNode(
                    type: .Icon,
                    name: "\(row.0) Icon",
                    x: 27,
                    y: y + 15,
                    width: 22,
                    height: 22,
                    iconName: row.3,
                    style: makeStyle(fill: "#00000000", textColor: row.5)
                ),
                DesignNode(
                    type: .Text,
                    name: "\(row.0) Name",
                    x: 72,
                    y: y + 6,
                    width: textWidth,
                    height: 22,
                    text: row.0,
                    style: transparentTextStyle(
                        fontSize: fittingFontSize(row.0, width: textWidth, maxSize: 15, minSize: 11),
                        fontWeight: "semibold",
                        color: tokens.colors.textPrimary
                    ),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                ),
                DesignNode(
                    type: .Text,
                    name: "\(row.0) Detail",
                    x: 72,
                    y: y + 30,
                    width: textWidth,
                    height: 18,
                    text: row.1,
                    style: transparentTextStyle(
                        fontSize: fittingFontSize(row.1, width: textWidth, maxSize: 12, minSize: 10),
                        color: tokens.colors.textSecondary
                    ),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                ),
                DesignNode(
                    type: .Text,
                    name: "\(row.0) Amount",
                    x: w - 18 - amountWidth,
                    y: y + 18,
                    width: amountWidth,
                    height: 22,
                    text: row.2,
                    style: transparentTextStyle(
                        fontSize: fittingFontSize(row.2, width: max(1, amountWidth), maxSize: 14, minSize: 10),
                        fontWeight: "bold",
                        color: row.5,
                        textAlign: "right"
                    ),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                )
            ])
        }
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Transaction List",
            x: action.x ?? 16,
            y: action.y ?? 420,
            width: w,
            height: h,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: tokens.radius.lg,
                opacity: 1.0,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.06, radius: 18, x: 0, y: 10)
            ),
            children: children
        )
    }
    
    private static func createQuickActionRow(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 96
        // Prefer the model's own labels — it puts them in a comma list under an
        // advertised key (subtitle/text). Only fall back if it gave none, and
        // to GENERIC labels, not Buy/Sell/Deposit/Transfer that made every app
        // look like a banking app.
        let provided = (props?["actions"] ?? props?["items"] ?? props?["categories"] ?? props?["subtitle"] ?? props?["text"])?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let fallback = [props?["first"], props?["second"], props?["third"], props?["fourth"]].compactMap { $0 }
        let labels: [String] = {
            if let provided, provided.count >= 2 { return Array(provided.prefix(4)) }
            if fallback.count >= 2 { return fallback }
            return ["Shop", "Search", "Saved", "Account"]
        }()
        let icons = labels.map { quickActionIcon(for: $0) }
        let horizontalPadding: CGFloat = 4
        let itemWidth = (w - horizontalPadding * 2) / CGFloat(labels.count)
        
        let children: [DesignNode] = labels.enumerated().flatMap { index, label in
            let x = horizontalPadding + CGFloat(index) * itemWidth
            return [
                DesignNode(
                    type: .Rectangle,
                    name: "\(label) Icon Background",
                    x: x + (itemWidth - 56) / 2,
                    y: 4,
                    width: 56,
                    height: 56,
                    style: makeStyle(
                        fill: tokens.colors.accentPrimary + "1F",
                        cornerRadius: 28,
                        opacity: 1.0
                    )
                ),
                DesignNode(
                    type: .Icon,
                    name: "\(label) Icon",
                    x: x + (itemWidth - 28) / 2,
                    y: 18,
                    width: 28,
                    height: 28,
                    iconName: icons[index],
                    style: makeStyle(
                        fill: "#00000000",
                        textColor: tokens.colors.accentPrimary
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "\(label) Label",
                    x: x + 2,
                    y: 66,
                    width: max(40, itemWidth - 4),
                    height: 34,
                    text: label,
                    style: transparentTextStyle(
                        fontSize: fittingFontSize(label, width: max(40, itemWidth - 8), maxSize: 13, minSize: 10, maxLines: 2),
                        fontWeight: "semibold",
                        color: tokens.colors.textPrimary,
                        textAlign: "center"
                    ),
                    textBehavior: TextBehavior(wrap: true, autoHeight: false, maxLines: 2, truncate: false)
                )
            ]
        }
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Quick Action Row",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: children
        )
    }
    
    /// Maps an action/category label to a fitting SF Symbol, with a neutral
    /// grid fallback so a store's "Running / Lifestyle" never shows a bank's
    /// transfer arrows.
    private static func quickActionIcon(for label: String) -> String {
        let l = label.lowercased()
        let map: [(String, String)] = [
            ("pause", "pause.fill"), ("split", "flag.checkered"), ("lap", "flag.checkered"),
            ("mute", "speaker.slash.fill"), ("audio", "speaker.wave.2.fill"),
            ("finish", "stop.fill"), ("stop", "stop.fill"),
            ("gps", "location.fill"), ("heart", "heart.fill"), ("sensor", "applewatch"),
            ("coach", "figure.strengthtraining.traditional"),
            ("improve", "chart.line.uptrend.xyaxis"), ("progress", "chart.line.uptrend.xyaxis"),
            ("shop", "bag.fill"), ("buy", "bag.fill"), ("cart", "cart.fill"), ("store", "storefront.fill"),
            ("search", "magnifyingglass"), ("discover", "safari.fill"), ("explore", "safari.fill"),
            ("wishlist", "heart.fill"), ("saved", "heart.fill"), ("save", "heart"), ("favorite", "star.fill"),
            ("account", "person.fill"), ("profile", "person.fill"), ("setting", "gearshape.fill"),
            ("run", "figure.run"), ("training", "dumbbell.fill"), ("workout", "dumbbell.fill"), ("lifestyle", "sparkles"),
            ("sell", "arrow.down.left"), ("deposit", "plus"), ("transfer", "arrow.left.arrow.right"), ("send", "paperplane.fill"),
            ("home", "house.fill"), ("order", "shippingbox.fill"), ("track", "location.fill"), ("deliver", "shippingbox.fill"),
            ("men", "figure.stand"), ("women", "figure.stand.dress"), ("kid", "figure.child"),
            ("new", "sparkles"), ("sale", "tag.fill"), ("categor", "square.grid.2x2.fill"), ("gift", "gift.fill")
        ]
        for (key, icon) in map where l.contains(key) { return icon }
        return "circle.grid.2x2.fill"
    }

    private static func createCurrencyCardGrid(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 156
        let gap: CGFloat = 12
        let cardWidth = (w - gap) / 2
        let items = [
            ("NVDA", "+2.4%", "$128.44", "#EEF2FF", "#4F46E5"),
            ("BTC", "+1.8%", "$64,210", "#FFF7ED", "#EA580C")
        ]
        
        let cards: [DesignNode] = items.enumerated().map { index, item in
            let x = CGFloat(index) * (cardWidth + gap)
            return DesignNode(
                type: .Frame,
                name: "\(item.0) Card",
                x: x,
                y: 0,
                width: cardWidth,
                height: h,
                style: makeStyle(
                    fill: tokens.colors.surfacePrimary,
                    cornerRadius: tokens.radius.lg,
                    opacity: 1.0,
                    shadow: ShadowStyle(color: "#0F172A", opacity: 0.06, radius: 16, x: 0, y: 8)
                ),
                children: [
                    DesignNode(
                        type: .Rectangle,
                        name: "\(item.0) Badge",
                        x: 16,
                        y: 16,
                        width: 44,
                        height: 44,
                        style: makeStyle(fill: item.3, cornerRadius: 22, opacity: 1.0)
                    ),
                    DesignNode(
                        type: .Text,
                        name: "\(item.0) Symbol",
                        x: 16,
                        y: 74,
                        width: cardWidth - 32,
                        height: 24,
                        text: item.0,
                        style: transparentTextStyle(fontSize: 17, fontWeight: "bold", color: tokens.colors.textPrimary)
                    ),
                    DesignNode(
                        type: .Text,
                        name: "\(item.0) Value",
                        x: 16,
                        y: 102,
                        width: cardWidth - 32,
                        height: 24,
                        text: item.2,
                        style: transparentTextStyle(fontSize: 15, fontWeight: "semibold", color: tokens.colors.textPrimary)
                    ),
                    DesignNode(
                        type: .Text,
                        name: "\(item.0) Change",
                        x: cardWidth - 66,
                        y: 24,
                        width: 50,
                        height: 18,
                        text: item.1,
                        style: transparentTextStyle(fontSize: 12, fontWeight: "bold", color: "#16A34A")
                    )
                ]
            )
        }
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Market Cards",
            x: action.x ?? 16,
            y: action.y ?? 664,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: cards
        )
    }
    
    private static func createChartCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 220
        let title = props?["title"] ?? "Activity"
        let period = props?["period"] ?? props?["subtitle"]

        // A real bar chart, composed from primitives — so it renders correctly
        // on the canvas, in the web export and in the SwiftUI export with no
        // new node type. (This used to be an empty grey "Chart Placeholder"
        // box, the most obvious "unfinished" tell in generated apps.)
        let parsedValues: [CGFloat] = (props?["values"] ?? "")
            .split(separator: ",")
            .compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
            .map { CGFloat($0) }
            .filter { $0 > 0 }
        let values: [CGFloat] = parsedValues.isEmpty
            ? [0.45, 0.62, 0.38, 0.80, 0.55, 0.72, 0.90]
            : parsedValues
        let labels = props?["labels"]?.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
            ?? ["M", "T", "W", "T", "F", "S", "S"]

        let chartTop: CGFloat = period == nil ? 56 : 74
        let labelStrip: CGFloat = 18
        let plotHeight = max(40, h - chartTop - 16 - labelStrip)
        let plotWidth = w - 32
        let maxValue = values.max() ?? 1
        let slot = plotWidth / CGFloat(max(1, values.count))
        let barWidth = min(slot * 0.55, 26)

        var children: [DesignNode] = [
            DesignNode(
                id: UUID(), type: .Text, name: "Title",
                x: 16, y: 16, width: plotWidth, height: 24, text: title,
                style: makeStyle(fill: "#00000000", fontSize: tokens.typography.headline.fontSize,
                                 fontWeight: "bold", textColor: tokens.colors.textPrimary)
            )
        ]
        if let period {
            children.append(DesignNode(
                id: UUID(), type: .Text, name: "Period",
                x: 16, y: 44, width: plotWidth, height: 18, text: period,
                style: makeStyle(fill: "#00000000", fontSize: tokens.typography.caption.fontSize,
                                 textColor: tokens.colors.textSecondary)
            ))
        }

        for (index, value) in values.enumerated() {
            let ratio = max(0.08, value / max(maxValue, 0.0001))
            let barHeight = plotHeight * ratio
            let x = 16 + slot * CGFloat(index) + (slot - barWidth) / 2
            // The most recent bar carries the accent; the rest are quiet.
            let isLatest = index == values.count - 1
            children.append(DesignNode(
                id: UUID(), type: .Rectangle, name: "Bar \(index + 1)",
                x: x, y: chartTop + (plotHeight - barHeight),
                width: barWidth, height: barHeight,
                style: makeStyle(
                    fill: isLatest ? tokens.colors.accentPrimary : tokens.colors.surfaceSecondary,
                    cornerRadius: min(barWidth / 2, 8)
                )
            ))
            if index < labels.count {
                children.append(DesignNode(
                    id: UUID(), type: .Text, name: "Label \(index + 1)",
                    x: 16 + slot * CGFloat(index), y: chartTop + plotHeight + 4,
                    width: slot, height: labelStrip - 2, text: labels[index],
                    style: makeStyle(fill: "#00000000", fontSize: 10,
                                     textColor: tokens.colors.textSecondary, textAlign: "center")
                ))
            }
        }

        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Chart Card",
            x: action.x ?? 16, y: action.y ?? 16,
            width: w, height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.lg, opacity: 1.0),
            children: children
        )
    }
    
    private static func createPrimaryCTA(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h: CGFloat = 56
        let label = props?["label"] ?? props?["title"] ?? "Continue"
        
        var fill = tokens.colors.accentPrimary
        var textColor = tokens.colors.surfacePrimary
        var radius = tokens.radius.pill
        
        switch type {
        case .secondaryButton, .pillSecondaryButton, .skipLink:
            fill = tokens.colors.surfaceSecondary
            textColor = tokens.colors.textPrimary
        case .softPrimaryButton:
            fill = tokens.colors.surfaceSecondary
            textColor = tokens.colors.accentPrimary
        case .socialButton:
            fill = "#000000"
            textColor = "#FFFFFF"
        default:
            break
        }
        
        if type == .softPrimaryButton {
            fill = tokens.colors.surfaceSecondary
            textColor = tokens.colors.accentPrimary
        }
        
        return DesignNode(
            id: UUID(),
            type: .Button,
            name: action.name ?? "CTA Button",
            x: action.x ?? 16, y: action.y ?? 16,
            width: w, height: h,
            text: label,
            style: makeStyle(
                fill: fill,
                cornerRadius: radius,
                opacity: 1.0,
                fontSize: tokens.typography.body.fontSize,
                fontWeight: "bold",
                textColor: textColor
            ),
            children: []
        )
    }

    
    private static func createMetricCard(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 170
        let h = action.height ?? 96
        let title = props?["title"] ?? props?["label"] ?? type.rawValue
        let value = props?["value"] ?? props?["amount"] ?? "1,284"
        let subtitle = props?["subtitle"] ?? props?["change"] ?? "Today"
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? title,
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: tokens.radius.lg,
                opacity: 1.0,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.06, radius: 18, x: 0, y: 10)
            ),
            children: [
                DesignNode(
                    type: .Text,
                    name: "Metric Label",
                    x: 14,
                    y: 14,
                    width: w - 28,
                    height: 18,
                    text: title,
                    style: transparentTextStyle(
                        fontSize: tokens.typography.caption.fontSize,
                        color: tokens.colors.textSecondary
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "Metric Value",
                    x: 14,
                    y: 38,
                    width: w - 28,
                    height: 28,
                    text: value,
                    style: transparentTextStyle(
                        fontSize: tokens.typography.headline.fontSize,
                        fontWeight: "bold",
                        color: tokens.colors.textPrimary
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "Metric Subtitle",
                    x: 14,
                    y: 70,
                    width: w - 28,
                    height: 18,
                    text: subtitle,
                    style: transparentTextStyle(
                        fontSize: tokens.typography.caption.fontSize,
                        fontWeight: "semibold",
                        color: tokens.colors.accentPrimary
                    )
                )
            ]
        )
    }
    
    private static func createBottomNavBar(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 64
        let label1 = props?["label1"] ?? "Home"
        let icon1 = props?["icon1"] ?? "house.fill"
        
        let label2 = props?["label2"] ?? "Discover"
        let icon2 = props?["icon2"] ?? "magnifyingglass"
        
        let label3 = props?["label3"] ?? "Favorites"
        let icon3 = props?["icon3"] ?? "heart.fill"
        
        let label4 = props?["label4"] ?? "Profile"
        let icon4 = props?["icon4"] ?? "person.fill"
        
        let labels = [label1, label2, label3, label4]
        let icons = [icon1, icon2, icon3, icon4]
        let activeIndex = max(0, min(3, (Int(props?["activeIndex"] ?? "1") ?? 1) - 1))
        let itemWidth = w / 4
        
        let children: [DesignNode] = labels.enumerated().flatMap { index, label in
            let x = CGFloat(index) * itemWidth
            return [
                DesignNode(
                    type: .Icon,
                    name: "\(label) Icon",
                    x: x + (itemWidth - 22) / 2,
                    y: 10,
                    width: 22,
                    height: 22,
                    iconName: icons[index],
                    style: makeStyle(
                        fill: "#00000000",
                        textColor: index == activeIndex ? tokens.colors.accentPrimary : tokens.colors.textSecondary
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "\(label) Label",
                    x: x,
                    y: 36,
                    width: itemWidth,
                    height: 18,
                    text: label,
                    style: transparentTextStyle(
                        fontSize: 11,
                        fontWeight: index == activeIndex ? "bold" : "regular",
                        color: index == activeIndex ? tokens.colors.accentPrimary : tokens.colors.textSecondary,
                        textAlign: "center"
                    )
                )
            ]
        }
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Bottom Navigation",
            x: action.x ?? 16,
            y: action.y ?? 720,
            width: w,
            height: h,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: tokens.radius.lg,
                opacity: 1.0
            ),
            children: children
        )
    }
    
    private static func createHeader(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let title = props?["title"] ?? action.name ?? "Overview"
        let subtitle = props?["subtitle"] ?? "Today"
        let w = action.width ?? 358
        let titleSize = fittingFontSize(title, width: w, maxSize: 26, minSize: 19)
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Header",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: action.height ?? 72,
            style: makeStyle(fill: "#00000000"),
            children: [
                DesignNode(
                    type: .Text,
                    name: "Header Title",
                    x: 0,
                    y: 4,
                    width: w,
                    height: 34,
                    text: title,
                    style: transparentTextStyle(
                        fontSize: titleSize,
                        fontWeight: "bold",
                        color: tokens.colors.textPrimary
                    ),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                ),
                DesignNode(
                    type: .Text,
                    name: "Header Subtitle",
                    x: 0,
                    y: 40,
                    width: w,
                    height: 20,
                    text: subtitle,
                    style: transparentTextStyle(
                        fontSize: tokens.typography.caption.fontSize,
                        color: tokens.colors.textSecondary
                    )
                )
            ]
        )
    }
    
    private static func createContentCard(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 132
        let title = props?["title"] ?? action.title ?? action.name ?? humanizedComponentName(action.rawComponentName ?? type.rawValue)
        let subtitle = props?["subtitle"] ?? props?["description"] ?? "A focused content section"
        let icon = props?["icon"]
        
        let textX: CGFloat = icon != nil ? 64 : 18
        
        var children: [DesignNode] = []
        
        if let icon {
            children.append(
                DesignNode(
                    type: .Icon,
                    name: "Card Icon",
                    x: 18,
                    y: 20,
                    width: 32,
                    height: 32,
                    iconName: icon,
                    style: makeStyle(
                        fill: "#00000000",
                        textColor: tokens.colors.accentPrimary
                    )
                )
            )
        }
        
        children.append(contentsOf: [
            DesignNode(
                type: .Text,
                name: "Card Title",
                x: textX,
                y: 18,
                width: w - textX - 18,
                height: 30,
                text: title,
                style: transparentTextStyle(
                    fontSize: fittingFontSize(title, width: w - textX - 18, maxSize: tokens.typography.headline.fontSize, minSize: 15, maxLines: 2),
                    fontWeight: "bold",
                    color: tokens.colors.textPrimary
                ),
                textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
            ),
            DesignNode(
                type: .Text,
                name: "Card Subtitle",
                x: textX,
                y: 56,
                width: w - textX - 18,
                height: 60,
                text: subtitle,
                style: transparentTextStyle(
                    fontSize: fittingFontSize(subtitle, width: w - textX - 18, maxSize: tokens.typography.body.fontSize, minSize: 12, maxLines: 3),
                    color: tokens.colors.textSecondary
                ),
                textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 3, truncate: false)
            )
        ])
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? title,
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: tokens.radius.lg,
                opacity: 1.0,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.07, radius: 18, x: 0, y: 10)
            ),
            children: children
        )
    }
    
    /// Largest font (≤ maxSize) at which `text` fits in `maxLines` lines of the
    /// given width — so a long headline scales down instead of overflowing its
    /// fixed box onto whatever sits below it. Bold glyphs average ~0.58em wide.
    private static func fittingFontSize(_ text: String, width: CGFloat, maxSize: CGFloat, minSize: CGFloat, maxLines: Int = 1) -> CGFloat {
        guard width > 0, !text.isEmpty else { return minSize }
        for candidate in stride(from: maxSize, through: minSize, by: -0.5) {
            let font = NSFont.systemFont(ofSize: candidate, weight: .semibold)
            if maxLines <= 1 {
                let measured = (text as NSString).size(withAttributes: [.font: font]).width
                if measured <= width { return candidate }
            } else {
                let rect = (text as NSString).boundingRect(
                    with: CGSize(width: width, height: .greatestFiniteMagnitude),
                    options: [.usesLineFragmentOrigin, .usesFontLeading],
                    attributes: [.font: font]
                )
                let allowedHeight = ceil(font.boundingRectForFont.height * CGFloat(maxLines)) + 2
                if ceil(rect.height) <= allowedHeight { return candidate }
            }
        }
        return minSize
    }

    private static func createHeroCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 300
        let title = props?["title"] ?? action.title ?? action.name ?? "Featured"
        let subtitle = props?["subtitle"] ?? props?["description"] ?? "A beautiful highlighted moment"
        let image = props?["image"] ?? props?["imageSource"] ?? action.imageSource ?? action.imageName
        let kicker = props?["kicker"] ?? props?["eyebrow"]
        let textColor = props?["textColor"] ?? "#FFFFFF"
        let secondaryTextColor = props?["secondaryTextColor"] ?? "#DDE6F8"
        let overlayColor = props?["overlayColor"] ?? "#000000"
        let overlayOpacity = flexibleNumber(props?["overlayOpacity"]).map(Double.init) ?? 0.28
        let radius = action.cornerRadius ?? tokens.radius.xl
        
        var children: [DesignNode] = []
        
        if let image, !image.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            children.append(
                DesignNode(
                    type: .Image,
                    name: "Hero Image",
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    imageName: image,
                    imageSource: image,
                    contentMode: .fill,
                    style: makeStyle(
                        fill: tokens.colors.surfaceSecondary,
                        cornerRadius: radius,
                        opacity: 1.0,
                        overlayColor: overlayColor,
                        overlayOpacity: overlayOpacity
                    )
                )
            )
            children.append(
                DesignNode(
                    type: .Rectangle,
                    name: "Hero Text Overlay",
                    x: 0,
                    y: h * 0.42,
                    width: w,
                    height: h * 0.58,
                    style: makeStyle(
                        fill: overlayColor,
                        cornerRadius: radius,
                        opacity: 0.18,
                        gradient: GradientStyle(
                            type: "linear",
                            colors: ["#00000000", overlayColor],
                            angle: 180,
                            stops: [0, 1]
                        )
                    )
                )
            )
        } else {
            children.append(
                DesignNode(
                    type: .Rectangle,
                    name: "Hero Visual Field",
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    style: makeStyle(
                        fill: tokens.colors.surfacePrimary,
                        cornerRadius: radius,
                        opacity: 1.0,
                        gradient: GradientStyle(
                            type: "linear",
                            colors: [tokens.colors.accentPrimary, tokens.colors.accentPrimary + "CC"],
                            angle: 135,
                            stops: [0, 1]
                        )
                    )
                )
            )
            children.append(
                DesignNode(
                    type: .Icon,
                    name: "Hero Symbol",
                    x: w - 94,
                    y: 28,
                    width: 58,
                    height: 58,
                    iconName: props?["icon"] ?? action.iconName ?? "sparkles",
                    style: makeStyle(fill: "#00000000", textColor: textColor)
                )
            )
        }
        
        if let kicker, !kicker.isEmpty {
            children.append(
                DesignNode(
                    type: .Text,
                    name: "Hero Kicker",
                    x: 24,
                    y: max(24, h - 134),
                    width: w - 48,
                    height: 18,
                    text: kicker,
                    style: transparentTextStyle(fontSize: 12, fontWeight: "semibold", color: secondaryTextColor)
                )
            )
        }
        
        children.append(contentsOf: [
            DesignNode(
                type: .Text,
                name: "Hero Title",
                x: 24,
                y: h - 118,
                width: w - 48,
                height: 54,
                text: title,
                style: transparentTextStyle(
                    // Shrink the font so a long title stays within its 50pt box
                    // instead of wrapping down onto the subtitle.
                    fontSize: fittingFontSize(title, width: w - 48, maxSize: min(34, max(24, tokens.typography.title1.fontSize - 4)), minSize: 18, maxLines: 1),
                    fontWeight: "bold",
                    color: textColor
                ),
                textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
            ),
            DesignNode(
                type: .Text,
                name: "Hero Subtitle",
                x: 24,
                y: h - 58,
                width: w - 48,
                height: 42,
                text: subtitle,
                style: transparentTextStyle(
                    fontSize: fittingFontSize(subtitle, width: w - 48, maxSize: max(13, tokens.typography.caption.fontSize), minSize: 11, maxLines: 2),
                    fontWeight: "medium",
                    color: secondaryTextColor
                ),
                textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
            )
        ])
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? title,
            x: action.x ?? 24,
            y: action.y ?? 120,
            width: w,
            height: h,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: radius,
                opacity: action.opacity ?? 1.0,
                shadow: action.shadow ?? ShadowStyle(color: "#000000", opacity: 0.20, radius: 28, x: 0, y: 18)
            ),
            children: children
        )
    }
    
    private static func createLargeIconTile(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        makeLargeIconTile(
            props: props,
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: action.width ?? 156,
            height: action.height ?? 172,
            name: action.name,
            cornerRadius: action.cornerRadius,
            opacity: action.opacity,
            shadow: action.shadow,
            fallbackIcon: action.iconName,
            fallbackImage: action.imageSource,
            tokens: tokens
        )
    }
    
    private static func makeLargeIconTile(
        props: [String: String]?,
        x: CGFloat,
        y: CGFloat,
        width: CGFloat,
        height: CGFloat,
        name: String?,
        cornerRadius: CGFloat? = nil,
        opacity: Double? = nil,
        shadow: ShadowStyle? = nil,
        fallbackIcon: String? = nil,
        fallbackImage: String? = nil,
        tokens: DesignTokens
    ) -> DesignNode {
        let w = width
        let h = height
        let title = props?["title"] ?? props?["label"] ?? name ?? "Feature"
        let subtitle = props?["subtitle"] ?? props?["description"]
        let icon = props?["icon"] ?? props?["iconName"] ?? fallbackIcon ?? "sparkles"
        let image = props?["image"] ?? props?["imageSource"] ?? fallbackImage
        let accent = props?["accent"] ?? props?["color"] ?? tokens.colors.accentPrimary
        let fill = props?["fill"] ?? tokens.colors.surfacePrimary
        let padding: CGFloat = 14
        let visualSize = min(max(64, min(w - padding * 2, h * 0.46)), 96)
        let visualX = (w - visualSize) / 2
        let visualY: CGFloat = padding
        let titleY = visualY + visualSize + 14
        let subtitleY = titleY + 25
        let titleHeight: CGFloat = subtitle == nil ? 38 : 24
        let subtitleHeight = max(0, h - subtitleY - padding)
        
        var children: [DesignNode] = []
        
        if let image, !image.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            children.append(
                DesignNode(
                    type: .Image,
                    name: "Tile Image",
                    x: visualX,
                    y: visualY,
                    width: visualSize,
                    height: visualSize,
                    imageName: image,
                    imageSource: image,
                    contentMode: .fill,
                    style: makeStyle(
                        fill: tokens.colors.surfaceSecondary,
                        cornerRadius: visualSize * 0.32,
                        opacity: 1.0,
                        shadow: ShadowStyle(color: "#000000", opacity: 0.10, radius: 18, x: 0, y: 10)
                    )
                )
            )
        } else {
            children.append(
                DesignNode(
                    type: .Rectangle,
                    name: "Icon Background",
                    x: visualX,
                    y: visualY,
                    width: visualSize,
                    height: visualSize,
                    style: makeStyle(
                        fill: accent,
                        cornerRadius: visualSize * 0.34,
                        opacity: 0.14
                    )
                )
            )
            children.append(
                DesignNode(
                    type: .Icon,
                    name: "Feature Icon",
                    x: visualX + visualSize * 0.26,
                    y: visualY + visualSize * 0.26,
                    width: visualSize * 0.48,
                    height: visualSize * 0.48,
                    iconName: icon,
                    style: makeStyle(
                        fill: "#00000000",
                        textColor: accent
                    )
                )
            )
        }
        
        children.append(
            DesignNode(
                type: .Text,
                name: "Tile Title",
                x: padding,
                y: titleY,
                width: w - padding * 2,
                height: titleHeight,
                text: title,
                style: transparentTextStyle(
                    fontSize: w < 140 ? 14 : 16,
                    fontWeight: "bold",
                    color: tokens.colors.textPrimary
                )
            )
        )
        
        if let subtitle, !subtitle.isEmpty {
            children.append(
                DesignNode(
                    type: .Text,
                    name: "Tile Subtitle",
                    x: padding,
                    y: subtitleY,
                    width: w - padding * 2,
                    height: max(20, subtitleHeight),
                    text: subtitle,
                    style: transparentTextStyle(
                        fontSize: 12,
                        fontWeight: "medium",
                        color: tokens.colors.textSecondary
                    )
                )
            )
        }
        
        return DesignNode(
            type: .Frame,
            name: name ?? title,
            x: x,
            y: y,
            width: w,
            height: h,
            style: makeStyle(
                fill: fill,
                cornerRadius: cornerRadius ?? tokens.radius.lg,
                opacity: opacity ?? 1.0,
                shadow: shadow ?? ShadowStyle(color: "#0F172A", opacity: 0.08, radius: 20, x: 0, y: 12)
            ),
            children: children
        )
    }
    
    private static func createIconFeatureGrid(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 360
        let requestedColumns = flexibleNumber(props?["columns"])
        let columns = max(1, min(3, Int(requestedColumns ?? (w >= 360 ? 3 : 2))))
        let gap: CGFloat = flexibleNumber(props?["gap"]) ?? 14
        let padding: CGFloat = flexibleNumber(props?["padding"]) ?? 0
        let labels = [
            props?["firstTitle"] ?? props?["first"] ?? props?["title1"] ?? props?["item1Title"] ?? "Discover",
            props?["secondTitle"] ?? props?["second"] ?? props?["title2"] ?? props?["item2Title"] ?? "Track",
            props?["thirdTitle"] ?? props?["third"] ?? props?["title3"] ?? props?["item3Title"] ?? "Create",
            props?["fourthTitle"] ?? props?["fourth"] ?? props?["title4"] ?? props?["item4Title"] ?? "Share"
        ]
        let subtitles = [
            props?["firstSubtitle"] ?? props?["subtitle1"] ?? props?["item1Subtitle"],
            props?["secondSubtitle"] ?? props?["subtitle2"] ?? props?["item2Subtitle"],
            props?["thirdSubtitle"] ?? props?["subtitle3"] ?? props?["item3Subtitle"],
            props?["fourthSubtitle"] ?? props?["subtitle4"] ?? props?["item4Subtitle"]
        ]
        let icons = [
            props?["firstIcon"] ?? props?["icon1"] ?? props?["item1Icon"] ?? "sparkles",
            props?["secondIcon"] ?? props?["icon2"] ?? props?["item2Icon"] ?? "chart.line.uptrend.xyaxis",
            props?["thirdIcon"] ?? props?["icon3"] ?? props?["item3Icon"] ?? "plus",
            props?["fourthIcon"] ?? props?["icon4"] ?? props?["item4Icon"] ?? "square.and.arrow.up"
        ]
        let a1 = props?["firstAccent"] ?? props?["accent1"] ?? props?["item1Accent"]
        let a2 = props?["secondAccent"] ?? props?["accent2"] ?? props?["item2Accent"]
        let a3 = props?["thirdAccent"] ?? props?["accent3"] ?? props?["item3Accent"]
        let a4 = props?["fourthAccent"] ?? props?["accent4"] ?? props?["item4Accent"]
        
        let accents = [
            a1 ?? tokens.colors.accentPrimary,
            a2 ?? "#14B8A6",
            a3 ?? "#F97316",
            a4 ?? "#8B5CF6"
        ]
        
        let rows = Int(ceil(Double(labels.count) / Double(columns)))
        let tileW = max(96, (w - padding * 2 - gap * CGFloat(columns - 1)) / CGFloat(columns))
        let tileH = max(136, (h - padding * 2 - gap * CGFloat(rows - 1)) / CGFloat(rows))
        
        var tiles: [DesignNode] = []
        for (index, label) in labels.enumerated() {
            let column = index % columns
            let row = index / columns
            let tileProps: [String: String] = [
                "title": label,
                "subtitle": subtitles[index] ?? "",
                "icon": icons[index],
                "accent": accents[index],
                "fill": props?["tileFill"] ?? tokens.colors.surfacePrimary
            ]
            let tileX = padding + CGFloat(column) * (tileW + gap)
            let tileY = padding + CGFloat(row) * (tileH + gap)
            tiles.append(
                makeLargeIconTile(
                    props: tileProps,
                    x: tileX,
                    y: tileY,
                    width: tileW,
                    height: tileH,
                    name: label + " Tile",
                    tokens: tokens
                )
            )
        }
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Feature Grid",
            x: action.x ?? 24,
            y: action.y ?? 220,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: tiles
        )
    }
    
    private static func createChatMessage(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 76
        let role = (props?["role"] ?? props?["sender"] ?? action.name ?? "assistant").lowercased()
        let isUser = role.contains("user") || role.contains("me")
        let text = props?["message"] ?? props?["text"] ?? (isUser ? "Can you help me plan today?" : "Absolutely. I can help you organize it.")
        let bubbleWidth = min(w - 64, max(180, CGFloat(text.count) * 7 + 44))
        let bubbleX = isUser ? w - bubbleWidth : 48
        let bubbleFill = isUser ? tokens.colors.accentPrimary : tokens.colors.surfacePrimary
        let bubbleText = isUser ? "#FFFFFF" : tokens.colors.textPrimary
        
        var children: [DesignNode] = []
        
        if !isUser {
            children.append(
                DesignNode(
                    type: .Rectangle,
                    name: "Assistant Avatar",
                    x: 0,
                    y: h - 40,
                    width: 34,
                    height: 34,
                    style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 17, opacity: 1.0)
                )
            )
        }
        
        children.append(
            DesignNode(
                type: .Frame,
                name: isUser ? "User Bubble" : "Assistant Bubble",
                x: bubbleX,
                y: 0,
                width: bubbleWidth,
                height: h,
                style: makeStyle(
                    fill: bubbleFill,
                    cornerRadius: 22,
                    opacity: 1.0,
                    shadow: ShadowStyle(color: "#000000", opacity: 0.06, radius: 12, x: 0, y: 8)
                ),
                children: [
                    DesignNode(
                        type: .Text,
                        name: "Message Text",
                        x: 16,
                        y: 14,
                        width: bubbleWidth - 32,
                        height: h - 28,
                        text: text,
                        style: transparentTextStyle(fontSize: 15, fontWeight: "regular", color: bubbleText)
                    )
                ]
            )
        )
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? (isUser ? "User Message" : "AI Response"),
            x: action.x ?? 24,
            y: action.y ?? 120,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: children
        )
    }
    
    private static func createChatInput(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 64
        let placeholder = props?["placeholder"] ?? props?["text"] ?? "Message..."
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Chat Input",
            x: action.x ?? 24,
            y: action.y ?? 748,
            width: w,
            height: h,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: h / 2,
                opacity: 1.0,
                shadow: ShadowStyle(color: "#000000", opacity: 0.12, radius: 22, x: 0, y: 12)
            ),
            children: [
                DesignNode(
                    type: .Icon,
                    name: "Attach Icon",
                    x: 18,
                    y: 22,
                    width: 20,
                    height: 20,
                    iconName: "plus",
                    style: makeStyle(fill: "#00000000", textColor: tokens.colors.textSecondary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Input Placeholder",
                    x: 50,
                    y: 21,
                    width: w - 118,
                    height: 22,
                    text: placeholder,
                    style: transparentTextStyle(fontSize: 15, color: tokens.colors.textSecondary)
                ),
                DesignNode(
                    type: .Frame,
                    name: "Send Button",
                    x: w - 54,
                    y: 10,
                    width: 44,
                    height: 44,
                    style: makeStyle(fill: tokens.colors.accentPrimary, cornerRadius: 22, opacity: 1.0),
                    children: [
                        DesignNode(
                            type: .Icon,
                            name: "Send Icon",
                            x: 12,
                            y: 12,
                            width: 20,
                            height: 20,
                            iconName: "arrow.up",
                            style: makeStyle(fill: "#00000000", textColor: "#FFFFFF")
                        )
                    ]
                )
            ]
        )
    }
    
    private static func createSearchBar(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 326
        let h = action.height ?? 52
        let placeholder = props?["placeholder"] ?? props?["title"] ?? "Search"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Search Bar",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(
                fill: action.fill ?? tokens.colors.surfacePrimary,
                cornerRadius: action.cornerRadius ?? h / 2,
                opacity: action.opacity ?? 1.0,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.06, radius: 14, x: 0, y: 8)
            ),
            children: [
                DesignNode(
                    type: .Icon,
                    name: "Search Icon",
                    x: 18,
                    y: (h - 20) / 2,
                    width: 20,
                    height: 20,
                    iconName: "magnifyingglass",
                    style: makeStyle(fill: "#00000000", textColor: tokens.colors.textSecondary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Search Placeholder",
                    x: 48,
                    y: (h - 22) / 2,
                    width: w - 66,
                    height: 22,
                    text: placeholder,
                    style: transparentTextStyle(fontSize: 15, fontWeight: "medium", color: tokens.colors.textSecondary)
                )
            ]
        )
    }
    
    private static func createCategoryChips(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 326
        let h = action.height ?? 44
        let provided = (props?["items"] ?? props?["categories"] ?? props?["subtitle"])?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let fallback = [props?["first"], props?["second"], props?["third"]].compactMap { $0 }
        let labels = provided?.isEmpty == false
            ? Array(provided!.prefix(3))
            : (fallback.isEmpty ? ["All", "Trending", "New"] : fallback)
        var currentX: CGFloat = 0
        let chips = labels.enumerated().map { index, label -> DesignNode in
            let chipWidth = min(max(CGFloat(label.count) * 8 + 28, 64), 122)
            defer { currentX += chipWidth + 10 }
            
            return DesignNode(
                type: .Button,
                name: "\(label) Chip",
                x: currentX,
                y: 0,
                width: chipWidth,
                height: h,
                text: label,
                style: makeStyle(
                    fill: index == 0 ? tokens.colors.accentPrimary : tokens.colors.surfacePrimary,
                    cornerRadius: h / 2,
                    opacity: 1.0,
                    fontSize: 13,
                    fontWeight: "semibold",
                    textColor: index == 0 ? "#FFFFFF" : tokens.colors.textPrimary,
                    shadow: index == 0 ? ShadowStyle(color: "#0F172A", opacity: 0.08, radius: 12, x: 0, y: 6) : nil
                )
            )
        }
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Category Chips",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: chips
        )
    }
    
    private static func createImageHeroCard(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 326
        let h = action.height ?? 240
        let image = props?["image"] ?? props?["imageSource"] ?? action.imageSource ?? action.imageName
        let title = props?["title"] ?? action.name ?? "Hero Image"
        let subtitle = props?["subtitle"] ?? props?["description"] ?? ""
        let hasRealImage = image.map {
            let lower = $0.lowercased()
            return !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && !lower.contains("placeholder") && !lower.contains("image prompt")
        } ?? false

        var children: [DesignNode] = []
        if hasRealImage, let image {
            children.append(
                DesignNode(
                    type: .Image,
                    name: "Hero Image",
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    imageName: image,
                    imageSource: image,
                    contentMode: .fill,
                    style: makeStyle(
                        fill: tokens.colors.surfaceSecondary,
                        cornerRadius: action.cornerRadius ?? tokens.radius.lg,
                        opacity: 1.0,
                        overlayColor: "#07111F",
                        overlayOpacity: 0.34
                    )
                )
            )
        } else {
            // No resolved asset: render an intentional branded illustration
            // instead of a grey missing-image glyph. This keeps the quality
            // floor high for text-only/low-cost models without pretending an
            // image was generated.
            children.append(contentsOf: [
                DesignNode(
                    type: .Rectangle, name: "Hero Brand Field",
                    x: 0, y: 0, width: w, height: h,
                    style: makeStyle(fill: tokens.colors.accentPrimary,
                                     cornerRadius: action.cornerRadius ?? tokens.radius.lg)
                ),
                DesignNode(
                    type: .Rectangle, name: "Hero Orb Large",
                    x: w - 126, y: -28, width: 156, height: 156,
                    style: makeStyle(fill: "#FFFFFF", cornerRadius: 78, opacity: 0.12)
                ),
                DesignNode(
                    type: .Rectangle, name: "Hero Orb Small",
                    x: w - 72, y: 94, width: 82, height: 82,
                    style: makeStyle(fill: "#FFFFFF", cornerRadius: 41, opacity: 0.09)
                ),
                DesignNode(
                    type: .Icon, name: "Hero Symbol",
                    x: 20, y: 22, width: 42, height: 42,
                    iconName: props?["icon"] ?? "figure.run",
                    style: makeStyle(fill: "#00000000", textColor: "#FFFFFF")
                )
            ])
        }

        let titleWidth = w - 36
        let titleSize = fittingFontSize(title, width: titleWidth, maxSize: 26, minSize: 19, maxLines: 2)
        children.append(
            DesignNode(
                type: .Text,
                name: "Hero Title",
                x: 18,
                y: h - (subtitle.isEmpty ? 82 : 120),
                width: titleWidth,
                height: subtitle.isEmpty ? 64 : 58,
                text: title,
                style: transparentTextStyle(fontSize: titleSize, fontWeight: "bold", color: "#FFFFFF"),
                textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
            )
        )
        if !subtitle.isEmpty {
            children.append(
                DesignNode(
                type: .Text,
                name: "Hero Subtitle",
                x: 18,
                y: h - 58,
                width: titleWidth,
                height: 44,
                text: subtitle,
                style: transparentTextStyle(
                    fontSize: fittingFontSize(subtitle, width: titleWidth, maxSize: 13, minSize: 11, maxLines: 2),
                    fontWeight: "medium",
                    color: "#EAF2FF"
                ),
                textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
            )
            )
        }
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? type.rawValue,
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: action.cornerRadius ?? tokens.radius.lg,
                opacity: 1.0,
                shadow: action.shadow ?? ShadowStyle(color: "#000000", opacity: 0.18, radius: 24, x: 0, y: 16)
            ),
            children: children
        )
    }
    
    private static func createTravelHeroScreen(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 260
        let h = action.height ?? 560
        let title = props?["title"] ?? "Explore Your Favorite Journey"
        let subtitle = props?["subtitle"] ?? "Let's make our life better"
        let image = props?["image"] ?? "travel_forest"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Travel Hero Screen",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(
                fill: "#294D2A",
                cornerRadius: 36,
                opacity: 1.0,
                shadow: ShadowStyle(color: "#000000", opacity: 0.24, radius: 30, x: 0, y: 18)
            ),
            children: [
                DesignNode(
                    type: .Image,
                    name: "Scenic Background",
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    imageName: image,
                    imageSource: image,
                    contentMode: .fill,
                    style: makeStyle(
                        fill: "#355E3B",
                        cornerRadius: 36,
                        opacity: 1.0,
                        overlayColor: "#000000",
                        overlayOpacity: 0.28
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "Hero Title",
                    x: 22,
                    y: 84,
                    width: w - 44,
                    height: 120,
                    text: title,
                    style: transparentTextStyle(fontSize: 34, fontWeight: "bold", color: "#FFFFFF")
                ),
                DesignNode(
                    type: .Text,
                    name: "Hero Subtitle",
                    x: 22,
                    y: 214,
                    width: w - 44,
                    height: 42,
                    text: subtitle,
                    style: transparentTextStyle(fontSize: 15, color: "#E8F3E1")
                ),
                DesignNode(
                    type: .Button,
                    name: "Explore CTA",
                    x: 22,
                    y: h - 84,
                    width: w - 44,
                    height: 52,
                    text: props?["cta"] ?? "Explore Now",
                    style: makeStyle(
                        fill: "#FFFFFF",
                        cornerRadius: 26,
                        opacity: 1.0,
                        fontSize: 15,
                        fontWeight: "bold",
                        textColor: "#1F3B22"
                    )
                )
            ]
        )
    }
    
    private static func createTravelDetailScreen(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 260
        let h = action.height ?? 560
        let title = props?["title"] ?? (type == .travelDetailScreen ? "La Selva" : "Discover")
        let subtitle = props?["location"] ?? props?["subtitle"] ?? "Peru, South America"
        let image = props?["image"] ?? "travel_mountain"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? type.rawValue,
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: "#F9FAF6", cornerRadius: 36, opacity: 1.0, shadow: ShadowStyle(color: "#000000", opacity: 0.18, radius: 28, x: 0, y: 18)),
            children: [
                createImageHeroCard(
                    type: ComponentType.imageHero,
                    props: ["title": title, "image": image],
                    action: DesignAction(type: .createComponent, x: 16, y: 20, width: w - 32, height: 250),
                    tokens: tokens
                ),
                DesignNode(
                    type: .Text,
                    name: "Detail Subtitle",
                    x: 22,
                    y: 288,
                    width: w - 44,
                    height: 24,
                    text: subtitle,
                    style: transparentTextStyle(fontSize: 13, color: "#60745F")
                ),
                DesignNode(
                    type: .Frame,
                    name: "Detail Card",
                    x: 16,
                    y: 330,
                    width: w - 32,
                    height: 142,
                    style: makeStyle(fill: "#FFFFFF", cornerRadius: 26, opacity: 1.0, shadow: ShadowStyle(color: "#000000", opacity: 0.10, radius: 18, x: 0, y: 10)),
                    children: [
                        DesignNode(type: .Text, name: "Price", x: 18, y: 18, width: w - 68, height: 34, text: props?["price"] ?? "$1270", style: transparentTextStyle(fontSize: 26, fontWeight: "bold", color: "#102414")),
                        DesignNode(type: .Text, name: "Body", x: 18, y: 60, width: w - 68, height: 54, text: "Image-led destination details with soft cards and clear hierarchy.", style: transparentTextStyle(fontSize: 13, color: "#60745F"))
                    ]
                )
            ]
        )
    }
    
    private static func createPropertyScreen(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 260
        let h = action.height ?? 560
        let title = props?["title"] ?? "Find The Perfect Place"
        let image = props?["image"] ?? "real_estate_building"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? type.rawValue,
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: "#E2E8F0", cornerRadius: 36, opacity: 1.0, shadow: ShadowStyle(color: "#000000", opacity: 0.20, radius: 30, x: 0, y: 20)),
            children: [
                DesignNode(type: .Text, name: "Property Title", x: 20, y: 34, width: w - 40, height: 84, text: title, style: transparentTextStyle(fontSize: 30, fontWeight: "bold", color: "#0F172A")),
                DesignNode(type: .Image, name: "Property Image", x: 16, y: 132, width: w - 32, height: 230, imageName: image, imageSource: image, contentMode: .fill, style: makeStyle(fill: "#CBD5E1", cornerRadius: 28, opacity: 1.0, overlayColor: "#000000", overlayOpacity: 0.08)),
                DesignNode(type: .Frame, name: "Glass Price Card", x: 28, y: 328, width: w - 56, height: 104, style: makeStyle(fill: "#FFFFFF", cornerRadius: 24, opacity: 0.88, shadow: ShadowStyle(color: "#000000", opacity: 0.12, radius: 20, x: 0, y: 12)), children: [
                    DesignNode(type: .Text, name: "Property Name", x: 16, y: 14, width: w - 88, height: 24, text: props?["property"] ?? "Opulence Apartment", style: transparentTextStyle(fontSize: 17, fontWeight: "bold", color: "#0F172A")),
                    DesignNode(type: .Text, name: "Property Price", x: 16, y: 48, width: w - 88, height: 34, text: props?["price"] ?? "$1,280/mo", style: transparentTextStyle(fontSize: 25, fontWeight: "bold", color: "#2563EB"))
                ])
            ]
        )
    }
    
    private static func createBeverageHeroScreen(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 260
        let h = action.height ?? 560
        let title = props?["title"] ?? "Berry Juice"
        let image = props?["image"] ?? "berries_dark"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Beverage Hero Screen",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: "#121111", cornerRadius: 36, opacity: 1.0, shadow: ShadowStyle(color: "#000000", opacity: 0.26, radius: 34, x: 0, y: 20)),
            children: [
                DesignNode(type: .Image, name: "Fruit Background", x: 0, y: 0, width: w, height: h, imageName: image, imageSource: image, contentMode: .fill, style: makeStyle(fill: "#23181D", cornerRadius: 36, opacity: 1.0, overlayColor: "#000000", overlayOpacity: 0.36)),
                DesignNode(type: .Text, name: "Brand Title", x: 20, y: 76, width: w - 40, height: 96, text: title, style: transparentTextStyle(fontSize: 40, fontWeight: "bold", color: "#FFFFFF")),
                DesignNode(type: .Text, name: "Beverage Subtitle", x: 20, y: 180, width: w - 40, height: 42, text: props?["subtitle"] ?? "Fresh dark berry flavor", style: transparentTextStyle(fontSize: 15, color: "#F3DCE4")),
                DesignNode(type: .Button, name: "Price CTA", x: 20, y: h - 82, width: w - 40, height: 52, text: props?["cta"] ?? "Add to cart - $12", style: makeStyle(fill: "#F43F5E", cornerRadius: 26, opacity: 1.0, fontSize: 15, fontWeight: "bold", textColor: "#FFFFFF"))
            ]
        )
    }
    
    private static func createProductHeroScreen(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 260
        let h = action.height ?? 560
        let title = props?["title"] ?? "New Arrivals"
        let image = props?["image"] ?? "headphones_pink"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Product Hero Screen",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: "#FCE7F3", cornerRadius: 36, opacity: 1.0, shadow: ShadowStyle(color: "#000000", opacity: 0.16, radius: 28, x: 0, y: 18)),
            children: [
                DesignNode(type: .Text, name: "Product Title", x: 20, y: 46, width: w - 40, height: 82, text: title, style: transparentTextStyle(fontSize: 36, fontWeight: "bold", color: "#111827")),
                DesignNode(type: .Image, name: "Product Image", x: 22, y: 144, width: w - 44, height: 230, imageName: image, imageSource: image, contentMode: .fit, style: makeStyle(fill: "#FDF2F8", cornerRadius: 32, opacity: 1.0, shadow: ShadowStyle(color: "#EC4899", opacity: 0.16, radius: 28, x: 0, y: 18))),
                DesignNode(type: .Button, name: "Add To Cart", x: 20, y: h - 82, width: w - 40, height: 52, text: props?["cta"] ?? "Add to Cart", style: makeStyle(fill: "#EC4899", cornerRadius: 26, opacity: 1.0, fontSize: 15, fontWeight: "bold", textColor: "#FFFFFF"))
            ]
        )
    }
    
    private static func createMeditationHeroScreen(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 260
        let h = action.height ?? 560
        let title = props?["title"] ?? "Killing Anxiety"
        let image = props?["image"] ?? "meditation_landscape"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Meditation Hero Screen",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: "#151827", cornerRadius: 36, opacity: 1.0, shadow: ShadowStyle(color: "#000000", opacity: 0.24, radius: 32, x: 0, y: 20)),
            children: [
                DesignNode(type: .Image, name: "Atmospheric Image", x: 0, y: 0, width: w, height: 300, imageName: image, imageSource: image, contentMode: .fill, style: makeStyle(fill: "#30364F", cornerRadius: 36, opacity: 1.0, overlayColor: "#000000", overlayOpacity: 0.32)),
                DesignNode(type: .Text, name: "Meditation Title", x: 22, y: 220, width: w - 44, height: 72, text: title, style: transparentTextStyle(fontSize: 32, fontWeight: "bold", color: "#FFFFFF")),
                createAudioPlayerCard(props: ["title": props?["track"] ?? "Breathing Session"], action: DesignAction(type: .createComponent, x: 20, y: h - 154, width: w - 40, height: 112), tokens: tokens)
            ]
        )
    }
    
    private static func createAudioPlayerCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 220
        let h = action.height ?? 96
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Audio Player Card",
            x: action.x ?? 20,
            y: action.y ?? 20,
            width: w,
            height: h,
            style: makeStyle(fill: "#FFFFFF", cornerRadius: 26, opacity: 0.16, shadow: ShadowStyle(color: "#000000", opacity: 0.18, radius: 20, x: 0, y: 12)),
            children: [
                DesignNode(type: .Text, name: "Track Title", x: 16, y: 16, width: w - 32, height: 24, text: props?["title"] ?? "Calm Session", style: transparentTextStyle(fontSize: 15, fontWeight: "bold", color: "#FFFFFF")),
                DesignNode(type: .Icon, name: "Play", x: w / 2 - 18, y: h - 48, width: 36, height: 36, iconName: "play.fill", style: makeStyle(fill: "#A7F3D0", cornerRadius: 18, opacity: 1.0, textColor: "#151827"))
            ]
        )
    }
    
    private static func createGalleryStrip(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 240
        let h = action.height ?? 78
        let images = [
            props?["image1"] ?? "travel_forest",
            props?["image2"] ?? "travel_mountain",
            props?["image3"] ?? "travel_lake"
        ]
        let itemWidth = (w - 20) / 3
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? type.rawValue,
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: images.enumerated().map { index, image in
                DesignNode(type: .Image, name: "Gallery \(index + 1)", x: CGFloat(index) * (itemWidth + 10), y: 0, width: itemWidth, height: h, imageName: image, imageSource: image, contentMode: .fill, style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 18, opacity: 1.0))
            }
        )
    }
    
    private static func createProductGrid(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 240
        let h = action.height ?? 180
        let itemWidth = (w - 12) / 2
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Product Grid",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: [0, 1].map { index in
                makeProductGridCard(index: index, itemWidth: itemWidth, height: h)
            }
        )
    }
    
    private static func makeProductGridCard(index: Int, itemWidth: CGFloat, height: CGFloat) -> DesignNode {
        let image = index == 0 ? "headphones_pink" : "product_detail"
        let title = index == 0 ? "Air Soft" : "Pulse Max"
        
        return DesignNode(
            type: .Frame,
            name: "Product Card \(index + 1)",
            x: CGFloat(index) * (itemWidth + 12),
            y: 0,
            width: itemWidth,
            height: height,
            style: makeStyle(
                fill: "#FFFFFF",
                cornerRadius: 22,
                opacity: 1.0,
                shadow: ShadowStyle(color: "#000000", opacity: 0.10, radius: 16, x: 0, y: 10)
            ),
            children: [
                DesignNode(
                    type: .Image,
                    name: "Product Image",
                    x: 12,
                    y: 12,
                    width: itemWidth - 24,
                    height: 92,
                    imageName: image,
                    imageSource: image,
                    contentMode: .fit,
                    style: makeStyle(fill: "#FDF2F8", cornerRadius: 18, opacity: 1.0)
                ),
                DesignNode(
                    type: .Text,
                    name: "Product Name",
                    x: 12,
                    y: 116,
                    width: itemWidth - 24,
                    height: 22,
                    text: title,
                    style: transparentTextStyle(fontSize: 13, fontWeight: "bold", color: "#111827")
                )
            ]
        )
    }
    
    private static func createProgressRing(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let rawTitle = props?["title"] ?? "Goal"
        let progress = props?["progress"] ?? "50%"
        let titleParts = rawTitle.split(separator: ":", maxSplits: 1).map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let title = titleParts.first ?? rawTitle
        let extractedValue = titleParts.count == 2 ? titleParts[1] : nil
        let fallbackValue: String = {
            let trimmed = progress.trimmingCharacters(in: .whitespacesAndNewlines)
            if let numeric = Double(trimmed), numeric >= 0, numeric <= 1 {
                return "\(Int((numeric * 100).rounded()))%"
            }
            return trimmed
        }()
        let displayValue = props?["value"] ?? props?["amount"] ?? extractedValue ?? fallbackValue
        // A progress ring is a modest circle, NOT a full-width blob: the
        // composer passes the whole content width, which made a 350×350 disc
        // that swallowed the screen and overlapped its own labels. Cap the
        // diameter and centre it in the allotted width.
        let allotted = action.width ?? 200
        let size = min(action.height ?? 176, 176)
        let originX = (action.x ?? 32) + max(0, (allotted - size) / 2)

        // A real ring, not a flat grey disc: an accent gradient outer circle, a
        // surface inner disc that carves the ring band, a coloured shadow for
        // depth, and centred value + label.
        let band: CGFloat = 14
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Progress Ring",
            x: originX,
            y: action.y ?? 120,
            width: size,
            height: size,
            text: nil,
            style: makeStyle(fill: "#00000000"),
            children: [
                DesignNode(
                    id: UUID(), type: .Rectangle, name: "Ring Track",
                    x: 0, y: 0, width: size, height: size,
                    style: makeStyle(
                        fill: tokens.colors.accentPrimary, cornerRadius: size / 2, opacity: 1.0,
                        shadow: ShadowStyle(color: tokens.colors.accentPrimary, opacity: 0.30, radius: 22, x: 0, y: 12),
                        gradient: GradientStyle(type: "linear",
                                                colors: [tokens.colors.accentPrimary, tokens.colors.accentPrimary + "B3"],
                                                angle: 135, stops: [0, 1])
                    )
                ),
                DesignNode(
                    id: UUID(), type: .Rectangle, name: "Ring Inner",
                    x: band, y: band, width: size - band * 2, height: size - band * 2,
                    style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: (size - band * 2) / 2, opacity: 1.0)
                ),
                DesignNode(
                    id: UUID(), type: .Text, name: "Progress Value",
                    x: 10, y: size / 2 - 28, width: size - 20, height: 34, text: displayValue,
                    style: transparentTextStyle(
                        fontSize: fittingFontSize(displayValue, width: size - 28, maxSize: 30, minSize: 17),
                        fontWeight: "bold",
                        color: tokens.colors.accentPrimary,
                        textAlign: "center"
                    ),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                ),
                DesignNode(
                    id: UUID(), type: .Text, name: "Title",
                    x: 12, y: size / 2 + 10, width: size - 24, height: 38, text: title,
                    style: transparentTextStyle(
                        fontSize: fittingFontSize(title, width: size - 28, maxSize: 12, minSize: 10, maxLines: 2),
                        fontWeight: "medium",
                        color: tokens.colors.textSecondary,
                        textAlign: "center"
                    ),
                    textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
                )
            ]
        )
    }
    
    private static func createWorkoutCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 326
        let h = action.height ?? 100
        let title = props?["title"] ?? "Workout"
        let duration = props?["duration"] ?? "30 min"
        let distance = props?["distance"] ?? props?["value"] ?? ""
        let intensity = props?["intensity"] ?? props?["subtitle"] ?? ""
        let status = props?["status"] ?? props?["badge"] ?? "Ready"
        let facts = [duration, distance, intensity]
            .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .joined(separator: "  •  ")
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? "Workout Card",
            x: action.x ?? 32,
            y: action.y ?? 260,
            width: w,
            height: h,
            text: nil,
            style: makeStyle(
                fill: tokens.colors.surfacePrimary,
                cornerRadius: tokens.radius.md,
                opacity: 1.0
            ),
            children: [
                DesignNode(
                    id: UUID(), type: .Rectangle, name: "Workout Icon Background",
                    x: 16, y: 16, width: 44, height: 44,
                    style: makeStyle(fill: tokens.colors.accentPrimary + "1F", cornerRadius: 22, opacity: 1.0)
                ),
                DesignNode(
                    id: UUID(), type: .Icon, name: "Workout Icon",
                    x: 27, y: 27, width: 22, height: 22,
                    iconName: props?["icon"] ?? "figure.run",
                    style: makeStyle(fill: "#00000000", textColor: tokens.colors.accentPrimary)
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Title",
                    x: 72,
                    y: 14,
                    width: w - 88, height: 48,
                    text: title,
                    style: makeStyle(
                        fill: "#00000000",
                        fontSize: fittingFontSize(title, width: w - 88, maxSize: 18, minSize: 14, maxLines: 2),
                        fontWeight: "bold",
                        textColor: tokens.colors.textPrimary
                    ),
                    textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Workout Facts",
                    x: 16,
                    y: 76,
                    width: w - 32, height: 20,
                    text: facts,
                    style: makeStyle(
                        fill: "#00000000",
                        fontSize: fittingFontSize(facts, width: w - 32, maxSize: 13, minSize: 10),
                        textColor: tokens.colors.textSecondary
                    ),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                ),
                DesignNode(
                    id: UUID(),
                    type: .Text,
                    name: "Workout Status",
                    x: 16,
                    y: 108,
                    width: w - 32, height: 20,
                    text: "● \(status)",
                    style: transparentTextStyle(fontSize: 12, fontWeight: "semibold", color: tokens.colors.accentPrimary),
                    textBehavior: TextBehavior(wrap: false, autoHeight: false, maxLines: 1, truncate: false)
                )
            ]
        )
    }
    
    private static func createTrackList(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 326
        let h = action.height ?? 260
        let isMeditation = type == .meditationTrackList
        let title = props?["title"] ?? action.name ?? (isMeditation ? "For your evening" : "Recently played")
        let rowTitle1 = props?["first"] ?? props?["track1"] ?? (isMeditation ? "Deep Focus" : "Neon Skyline")
        let rowTitle2 = props?["second"] ?? props?["track2"] ?? (isMeditation ? "Quiet Breath" : "After Hours")
        let rowTitle3 = props?["third"] ?? props?["track3"] ?? (isMeditation ? "Soft Rain" : "Velvet Bass")
        let rows = [
            (rowTitle1, props?["firstMeta"] ?? props?["meta1"] ?? (isMeditation ? "8 min" : "Luna Vale · 3:42"), props?["firstIcon"] ?? props?["icon1"] ?? "play.fill"),
            (rowTitle2, props?["secondMeta"] ?? props?["meta2"] ?? (isMeditation ? "12 min" : "The Motion · 4:08"), props?["secondIcon"] ?? props?["icon2"] ?? "waveform"),
            (rowTitle3, props?["thirdMeta"] ?? props?["meta3"] ?? (isMeditation ? "5 min" : "Mira North · 2:57"), props?["thirdIcon"] ?? props?["icon3"] ?? "music.note")
        ]
        let rowHeight: CGFloat = 54
        
        var children: [DesignNode] = [
            DesignNode(
                type: .Text,
                name: "List Title",
                x: 18,
                y: 16,
                width: w - 36,
                height: 26,
                text: title,
                style: transparentTextStyle(fontSize: 18, fontWeight: "bold", color: tokens.colors.textPrimary)
            )
        ]
        
        for (index, row) in rows.enumerated() {
            let y = CGFloat(index) * (rowHeight + 8) + 54
            children.append(contentsOf: [
                DesignNode(
                    type: .Rectangle,
                    name: "\(row.0) Icon Background",
                    x: 18,
                    y: y,
                    width: 44,
                    height: 44,
                    style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 22, opacity: 1.0)
                ),
                DesignNode(
                    type: .Icon,
                    name: "\(row.0) Icon",
                    x: 30,
                    y: y + 12,
                    width: 20,
                    height: 20,
                    iconName: row.2,
                    style: makeStyle(fill: "#00000000", textColor: tokens.colors.accentPrimary)
                ),
                DesignNode(
                    type: .Text,
                    name: "\(row.0) Title",
                    x: 76,
                    y: y + 4,
                    width: w - 142,
                    height: 22,
                    text: row.0,
                    style: transparentTextStyle(fontSize: 15, fontWeight: "semibold", color: tokens.colors.textPrimary)
                ),
                DesignNode(
                    type: .Text,
                    name: "\(row.0) Meta",
                    x: 76,
                    y: y + 28,
                    width: w - 142,
                    height: 18,
                    text: row.1,
                    style: transparentTextStyle(fontSize: 12, color: tokens.colors.textSecondary)
                ),
                DesignNode(
                    type: .Icon,
                    name: "\(row.0) More",
                    x: w - 42,
                    y: y + 12,
                    width: 20,
                    height: 20,
                    iconName: "chevron.right",
                    style: makeStyle(fill: "#00000000", textColor: tokens.colors.textSecondary)
                )
            ])
        }
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Track List",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(
                fill: action.fill ?? tokens.colors.surfacePrimary,
                cornerRadius: action.cornerRadius ?? tokens.radius.lg,
                opacity: action.opacity ?? 1.0,
                shadow: ShadowStyle(color: "#0F172A", opacity: 0.07, radius: 18, x: 0, y: 10)
            ),
            children: children
        )
    }
    
    private static func createGenericComponent(type: ComponentType, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 260
        let h = action.height ?? 128
        let rawName = action.rawComponentName ?? type.rawValue
        let title = action.title ?? action.name ?? humanizedComponentName(rawName)
        let subtitle = action.descriptionText ?? action.props?["subtitle"] ?? action.props?["description"] ?? "Key details"
        let iconName = action.iconName ?? action.props?["icon"] ?? "sparkles"
        let compact = h < 96
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.name ?? title,
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            text: nil,
            style: makeStyle(
                fill: action.fill ?? tokens.colors.surfacePrimary,
                cornerRadius: action.cornerRadius ?? tokens.radius.lg,
                opacity: action.opacity ?? 1.0,
                shadow: action.shadow ?? ShadowStyle(color: "#000000", opacity: 0.08, radius: 18, x: 0, y: 10)
            ),
            children: [
                DesignNode(
                    type: .Rectangle,
                    name: "Generic Icon Background",
                    x: 16,
                    y: 16,
                    width: compact ? 36 : 44,
                    height: compact ? 36 : 44,
                    style: makeStyle(
                        fill: tokens.colors.surfaceSecondary,
                        cornerRadius: compact ? 18 : 22,
                        opacity: 1.0
                    )
                ),
                DesignNode(
                    type: .Icon,
                    name: "Generic Icon",
                    x: compact ? 25 : 27,
                    y: compact ? 25 : 27,
                    width: compact ? 18 : 22,
                    height: compact ? 18 : 22,
                    iconName: iconName,
                    style: makeStyle(
                        fill: "#00000000",
                        textColor: tokens.colors.accentPrimary
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "Generic Title",
                    x: compact ? 64 : 74,
                    y: compact ? 18 : 18,
                    width: w - (compact ? 80 : 92),
                    height: compact ? 24 : 28,
                    text: title,
                    style: transparentTextStyle(
                        fontSize: compact ? tokens.typography.body.fontSize : tokens.typography.headline.fontSize,
                        fontWeight: "bold",
                        color: tokens.colors.textPrimary
                    )
                ),
                DesignNode(
                    type: .Text,
                    name: "Generic Subtitle",
                    x: compact ? 64 : 74,
                    y: compact ? 44 : 52,
                    width: w - (compact ? 80 : 92),
                    height: compact ? max(20, h - 52) : max(36, h - 68),
                    text: subtitle,
                    style: makeStyle(
                        fill: "#00000000",
                        fontSize: tokens.typography.caption.fontSize,
                        textColor: tokens.colors.textSecondary
                    )
                )
            ]
        )
    }
    
    // MARK: - Banking / Fintech Components
    
    private static func createCreditCardPreview(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 216
        
        let cardNetwork = props?["network"] ?? "Visa"
        let cardNumber = props?["last4"] ?? "••••  ••••  ••••  4281"
        let cardHolder = props?["holder"] ?? "Sarah Jenkins"
        let expiry = props?["expiry"] ?? "12/28"
        let cardType = props?["type"] ?? "Credit"
        
        // Use provided gradient or fallback to token gradient
        let bgStyle = makeStyle(
            fill: "#00000000",
            cornerRadius: tokens.radius.lg,
            shadow: ShadowStyle(color: "#000000", opacity: 0.15, radius: 24, x: 0, y: 12),
            gradient: tokens.gradients?.creditCard ?? GradientStyle(type: "linear", colors: ["#1A1B20", "#3E4150"], angle: 135, stops: [0, 1])
        )
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "creditCardPreview",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: bgStyle,
            children: [
                DesignNode(
                    type: .Icon,
                    name: "Chip Icon",
                    x: 24,
                    y: 24,
                    width: 32,
                    height: 24,
                    iconName: "simcard.fill",
                    style: makeStyle(fill: "#00000000", fontSize: 24, textColor: "#E5C88F")
                ),
                DesignNode(
                    type: .Text,
                    name: "Card Network",
                    x: w - 80,
                    y: 24,
                    width: 56,
                    height: 24,
                    text: cardNetwork,
                    style: transparentTextStyle(fontSize: 16, fontWeight: "bold", color: "#FFFFFF")
                ),
                DesignNode(
                    type: .Text,
                    name: "Card Number",
                    x: 24,
                    y: 88,
                    width: w - 48,
                    height: 32,
                    text: cardNumber,
                    style: makeStyle(fill: "#00000000", fontSize: 22, fontWeight: "bold", textColor: "#FFFFFF", letterSpacing: 2)
                ),
                DesignNode(
                    type: .Text,
                    name: "Card Holder",
                    x: 24,
                    y: h - 56,
                    width: w / 2,
                    height: 24,
                    text: cardHolder,
                    style: transparentTextStyle(fontSize: 14, fontWeight: "semibold", color: "#FFFFFF")
                ),
                DesignNode(
                    type: .Text,
                    name: "Expiry",
                    x: 24,
                    y: h - 32,
                    width: 60,
                    height: 16,
                    text: expiry,
                    style: transparentTextStyle(fontSize: 12, color: "#9CA3AF")
                ),
                DesignNode(
                    type: .Text,
                    name: "Card Type",
                    x: w - 80,
                    y: h - 32,
                    width: 56,
                    height: 16,
                    text: cardType,
                    style: transparentTextStyle(fontSize: 12, color: "#9CA3AF")
                )
            ]
        )
    }

    private static func createToggleRow(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 64
        let title = props?["title"] ?? "Enable Setting"
        let subtitle = props?["subtitle"] ?? props?["description"]
        let isOn = (props?["isOn"] ?? props?["value"] ?? "true").lowercased() == "true"
        
        let toggleColor = isOn ? (tokens.colors.success ?? "#34D399") : tokens.colors.surfaceSecondary
        let knobX = isOn ? 26 : 2
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "toggleRow",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md),
            children: [
                DesignNode(
                    type: .Text,
                    name: "Title",
                    x: 16,
                    y: subtitle == nil ? h / 2 - 10 : 12,
                    width: w - 90,
                    height: 20,
                    text: title,
                    style: transparentTextStyle(fontSize: tokens.typography.body.fontSize, fontWeight: "semibold", color: tokens.colors.textPrimary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Subtitle",
                    x: 16,
                    y: 36,
                    width: w - 90,
                    height: 30,
                    text: subtitle ?? "",
                    style: transparentTextStyle(
                        fontSize: fittingFontSize(subtitle ?? "", width: w - 90, maxSize: 12, minSize: 10, maxLines: 2),
                        color: tokens.colors.textSecondary
                    ),
                    textBehavior: TextBehavior(wrap: true, autoHeight: true, maxLines: 2, truncate: false)
                ),
                DesignNode(
                    type: .Frame,
                    name: "Toggle Track",
                    x: w - 66,
                    y: h / 2 - 16,
                    width: 50,
                    height: 32,
                    style: makeStyle(fill: toggleColor, cornerRadius: 16),
                    children: [
                        DesignNode(
                            type: .Rectangle,
                            name: "Toggle Knob",
                            x: CGFloat(knobX),
                            y: 2,
                            width: 28,
                            height: 28,
                            style: makeStyle(fill: "#FFFFFF", cornerRadius: 14, shadow: ShadowStyle(color: "#000000", opacity: 0.1, radius: 4, x: 0, y: 2))
                        )
                    ]
                )
            ]
        )
    }

    private static func createProgressBar(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 48
        let label = props?["label"] ?? props?["title"] ?? "Progress"
        let progressRaw = props?["progress"] ?? "0.5"
        let progressValue = Double(progressRaw) ?? 0.5
        let rightLabel = props?["rightLabel"] ?? props?["value"] ?? "\(Int(progressValue * 100))%"
        
        let barWidth = w * CGFloat(progressValue)
        let barHeight: CGFloat = 8
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "progressBar",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: [
                DesignNode(
                    type: .Text,
                    name: "Label",
                    x: 0,
                    y: 0,
                    width: w / 2,
                    height: 20,
                    text: label,
                    style: transparentTextStyle(fontSize: tokens.typography.caption.fontSize, fontWeight: "semibold", color: tokens.colors.textPrimary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Right Label",
                    x: w / 2,
                    y: 0,
                    width: w / 2,
                    height: 20,
                    text: rightLabel,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.caption.fontSize, fontWeight: "semibold", textColor: tokens.colors.textSecondary, textAlign: "right")
                ),
                DesignNode(
                    type: .Rectangle,
                    name: "Track",
                    x: 0,
                    y: 24,
                    width: w,
                    height: barHeight,
                    style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: barHeight / 2)
                ),
                DesignNode(
                    type: .Rectangle,
                    name: "Fill",
                    x: 0,
                    y: 24,
                    width: barWidth,
                    height: barHeight,
                    style: makeStyle(
                        fill: "#00000000",
                        cornerRadius: barHeight / 2,
                        gradient: tokens.gradients?.accent ?? GradientStyle(type: "linear", colors: [tokens.colors.accentPrimary, tokens.colors.textPrimary], angle: 90, stops: [0, 1])
                    )
                )
            ]
        )
    }

    private static func createCategoryRow(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 72
        let title = props?["title"] ?? "Groceries"
        let subtitle = props?["subtitle"] ?? "42 Transactions"
        let amount = props?["amount"] ?? "-$450.00"
        let iconName = props?["icon"] ?? "cart.fill"
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "categoryRow",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md),
            children: [
                DesignNode(
                    type: .Frame,
                    name: "Icon BG",
                    x: 16,
                    y: 12,
                    width: 48,
                    height: 48,
                    style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: tokens.radius.md),
                    children: [
                        DesignNode(
                            type: .Icon,
                            name: "Icon",
                            x: 12,
                            y: 12,
                            width: 24,
                            height: 24,
                            iconName: iconName,
                            style: makeStyle(fill: "#00000000", fontSize: 20, textColor: tokens.colors.textPrimary)
                        )
                    ]
                ),
                DesignNode(
                    type: .Text,
                    name: "Title",
                    x: 76,
                    y: 16,
                    width: w - 160,
                    height: 20,
                    text: title,
                    style: transparentTextStyle(fontSize: tokens.typography.body.fontSize, fontWeight: "semibold", color: tokens.colors.textPrimary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Subtitle",
                    x: 76,
                    y: 40,
                    width: w - 160,
                    height: 16,
                    text: subtitle,
                    style: transparentTextStyle(fontSize: tokens.typography.caption.fontSize, color: tokens.colors.textSecondary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Amount",
                    x: w - 120,
                    y: h / 2 - 10,
                    width: 104,
                    height: 20,
                    text: amount,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.body.fontSize, fontWeight: "semibold", textColor: tokens.colors.textPrimary, textAlign: "right")
                )
            ]
        )
    }

    private static func createBudgetGauge(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 200
        let title = props?["title"] ?? "Left to Spend"
        let amount = props?["amount"] ?? "$1,250"
        let subtitle = props?["subtitle"] ?? "of $3,000 budget"
        
        let ringSize = min(w - 32, h - 32)
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "budgetGauge",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.lg, shadow: ShadowStyle(color: "#000000", opacity: 0.05, radius: 10, x: 0, y: 4)),
            children: [
                // Background arc (approximate with a rounded rect for now since we don't have true arcs)
                DesignNode(
                    type: .Rectangle,
                    name: "Gauge Track",
                    x: (w - ringSize) / 2,
                    y: (h - ringSize) / 2,
                    width: ringSize,
                    height: ringSize,
                    style: makeStyle(fill: "#00000000", stroke: tokens.colors.surfaceSecondary, strokeWidth: 16, cornerRadius: ringSize / 2)
                ),
                // Text centered inside
                DesignNode(
                    type: .Text,
                    name: "Title",
                    x: 0,
                    y: h / 2 - 36,
                    width: w,
                    height: 20,
                    text: title,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.caption.fontSize, textColor: tokens.colors.textSecondary, textAlign: "center")
                ),
                DesignNode(
                    type: .Text,
                    name: "Amount",
                    x: 0,
                    y: h / 2 - 12,
                    width: w,
                    height: 36,
                    text: amount,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.headline.fontSize + 4, fontWeight: "bold", textColor: tokens.colors.textPrimary, textAlign: "center")
                ),
                DesignNode(
                    type: .Text,
                    name: "Subtitle",
                    x: 0,
                    y: h / 2 + 28,
                    width: w,
                    height: 20,
                    text: subtitle,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.caption.fontSize, textColor: tokens.colors.textSecondary, textAlign: "center")
                )
            ]
        )
    }

    private static func createControlButton(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 80
        let h = action.height ?? 100
        let label = props?["label"] ?? "Lock"
        let iconName = props?["icon"] ?? "lock.fill"
        
        let isActive = (props?["isActive"] ?? "false").lowercased() == "true"
        let iconBg = isActive ? tokens.colors.accentPrimary : tokens.colors.surfacePrimary
        let iconColor = isActive ? tokens.colors.backgroundPrimary : tokens.colors.textPrimary
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "controlButton",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: [
                DesignNode(
                    type: .Frame,
                    name: "Button BG",
                    x: (w - 60) / 2,
                    y: 0,
                    width: 60,
                    height: 60,
                    style: makeStyle(fill: iconBg, cornerRadius: 30, shadow: ShadowStyle(color: "#000000", opacity: 0.05, radius: 8, x: 0, y: 4)),
                    children: [
                        DesignNode(
                            type: .Icon,
                            name: "Icon",
                            x: 18,
                            y: 18,
                            width: 24,
                            height: 24,
                            iconName: iconName,
                            style: makeStyle(fill: "#00000000", fontSize: 20, textColor: iconColor)
                        )
                    ]
                ),
                DesignNode(
                    type: .Text,
                    name: "Label",
                    x: 0,
                    y: 72,
                    width: w,
                    height: 20,
                    text: label,
                    style: makeStyle(fill: "#00000000", fontSize: tokens.typography.caption.fontSize, fontWeight: "semibold", textColor: tokens.colors.textPrimary, textAlign: "center")
                )
            ]
        )
    }

    private static func createInsightCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 140
        let title = props?["title"] ?? "Spending Alert"
        let description = props?["description"] ?? "You've spent 20% more on dining this month."
        let iconName = props?["icon"] ?? "exclamationmark.triangle.fill"
        let isPositive = (props?["isPositive"] ?? "false").lowercased() == "true"
        
        let accentColor = isPositive ? (tokens.colors.success ?? "#34D399") : (tokens.colors.warning ?? "#FBBF24")
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "insightCard",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.lg, shadow: ShadowStyle(color: "#000000", opacity: 0.08, radius: 12, x: 0, y: 6)),
            children: [
                DesignNode(
                    type: .Frame,
                    name: "Icon Container",
                    x: 20,
                    y: 20,
                    width: 40,
                    height: 40,
                    style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 20),
                    children: [
                        DesignNode(
                            type: .Icon,
                            name: "Icon",
                            x: 10,
                            y: 10,
                            width: 20,
                            height: 20,
                            iconName: iconName,
                            style: makeStyle(fill: "#00000000", fontSize: 16, textColor: accentColor)
                        )
                    ]
                ),
                DesignNode(
                    type: .Text,
                    name: "Title",
                    x: 76,
                    y: 20,
                    width: w - 96,
                    height: 24,
                    text: title,
                    style: transparentTextStyle(fontSize: tokens.typography.body.fontSize, fontWeight: "bold", color: tokens.colors.textPrimary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Description",
                    x: 76,
                    y: 48,
                    width: w - 96,
                    height: h - 64,
                    text: description,
                    style: transparentTextStyle(fontSize: tokens.typography.caption.fontSize + 1, color: tokens.colors.textSecondary)
                )
            ]
        )
    }

    private static func createSecuritySettingRow(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 342
        let h = action.height ?? 88
        let title = props?["title"] ?? "Freeze Card"
        let subtitle = props?["subtitle"] ?? "Temporarily disable transactions"
        let isOn = (props?["isOn"] ?? "false").lowercased() == "true"
        
        let toggleColor = isOn ? (tokens.colors.success ?? "#34D399") : tokens.colors.surfaceSecondary
        let knobX = isOn ? 26 : 2
        
        return DesignNode(
            id: UUID(),
            type: .Frame,
            name: action.nodeReference ?? "securitySettingRow",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: tokens.radius.md),
            children: [
                DesignNode(
                    type: .Text,
                    name: "Title",
                    x: 16,
                    y: 20,
                    width: w - 90,
                    height: 24,
                    text: title,
                    style: transparentTextStyle(fontSize: tokens.typography.body.fontSize, fontWeight: "semibold", color: tokens.colors.textPrimary)
                ),
                DesignNode(
                    type: .Text,
                    name: "Subtitle",
                    x: 16,
                    y: 46,
                    width: w - 90,
                    height: 36,
                    text: subtitle,
                    style: transparentTextStyle(fontSize: tokens.typography.caption.fontSize, color: tokens.colors.textSecondary)
                ),
                DesignNode(
                    type: .Frame,
                    name: "Toggle Track",
                    x: w - 66,
                    y: h / 2 - 16,
                    width: 50,
                    height: 32,
                    style: makeStyle(fill: toggleColor, cornerRadius: 16),
                    children: [
                        DesignNode(
                            type: .Rectangle,
                            name: "Toggle Knob",
                            x: CGFloat(knobX),
                            y: 2,
                            width: 28,
                            height: 28,
                            style: makeStyle(fill: "#FFFFFF", cornerRadius: 14, shadow: ShadowStyle(color: "#000000", opacity: 0.1, radius: 4, x: 0, y: 2))
                        )
                    ]
                )
            ]
        )
    }

    private static func createSidebar(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 280
        let h = action.height ?? 800
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Sidebar",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 0, opacity: 1.0),
            children: [
                DesignNode(type: .Text, name: "App Title", x: 24, y: 32, width: w - 48, height: 32, text: props?["title"] ?? "My App", style: transparentTextStyle(fontSize: 24, fontWeight: "bold", color: tokens.colors.textPrimary)),
                DesignNode(type: .Icon, name: "Nav Icon 1", x: 24, y: 92, width: 24, height: 24, iconName: "square.grid.2x2.fill", style: makeStyle(fill: "#00000000", textColor: tokens.colors.accentPrimary)),
                DesignNode(type: .Text, name: "Nav Label 1", x: 60, y: 92, width: w - 84, height: 24, text: "Dashboard", style: transparentTextStyle(fontSize: 17, fontWeight: "semibold", color: tokens.colors.accentPrimary)),
                DesignNode(type: .Icon, name: "Nav Icon 2", x: 24, y: 140, width: 24, height: 24, iconName: "book.fill", style: makeStyle(fill: "#00000000", textColor: tokens.colors.textSecondary)),
                DesignNode(type: .Text, name: "Nav Label 2", x: 60, y: 140, width: w - 84, height: 24, text: "Library", style: transparentTextStyle(fontSize: 17, color: tokens.colors.textSecondary)),
                DesignNode(type: .Icon, name: "Nav Icon 3", x: 24, y: 188, width: 24, height: 24, iconName: "star.fill", style: makeStyle(fill: "#00000000", textColor: tokens.colors.textSecondary)),
                DesignNode(type: .Text, name: "Nav Label 3", x: 60, y: 188, width: w - 84, height: 24, text: "Favorites", style: transparentTextStyle(fontSize: 17, color: tokens.colors.textSecondary))
            ]
        )
    }

    private static func createSplitView(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 1024
        let h = action.height ?? 768
        let sidebarW: CGFloat = 300
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Split View",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h,
            style: makeStyle(fill: tokens.colors.backgroundPrimary, cornerRadius: 0, opacity: 1.0),
            children: [
                createSidebar(props: nil as [String: String]?, action: DesignAction(type: .createComponent, x: 0, y: 0, width: sidebarW, height: h), tokens: tokens),
                DesignNode(type: .Frame, name: "Main Content Area", x: sidebarW, y: 0, width: w - sidebarW, height: h, style: makeStyle(fill: tokens.colors.backgroundPrimary, cornerRadius: 0, opacity: 1.0), children: [])
            ]
        )
    }

    private static func createCardGrid(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 700
        let h = action.height ?? 600
        let cols: CGFloat = 3
        let spacing: CGFloat = 24
        let cardW = (w - (cols - 1) * spacing) / cols
        let cardH: CGFloat = cardW * 1.4
        
        var children: [DesignNode] = []
        for i in 0..<6 {
            let row = CGFloat(i / Int(cols))
            let col = CGFloat(i % Int(cols))
            
            children.append(
                createMediaCard(
                    props: ["title": "Item \(i+1)", "subtitle": "Description"],
                    action: DesignAction(type: .createComponent, x: col * (cardW + spacing), y: row * (cardH + spacing + 40), width: cardW, height: cardH),
                    tokens: tokens
                )
            )
        }
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Card Grid",
            x: action.x ?? 16,
            y: action.y ?? 16,
            width: w,
            height: h,
            style: makeStyle(fill: "#00000000"),
            children: children
        )
    }

    private static func createMediaCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 180
        let h = action.height ?? 260
        let title = props?["title"] ?? props?["name"] ?? "Featured"
        let subtitle = props?["subtitle"] ?? props?["author"] ?? props?["price"] ?? "Tap to view"
        let image = props?["image"] ?? "book_cover_placeholder"
        
        return DesignNode(
            type: .Frame,
            name: action.name ?? "Media Card",
            x: action.x ?? 0,
            y: action.y ?? 0,
            width: w,
            height: h + 60, // Extra space for text below the cover
            style: makeStyle(fill: "#00000000"),
            children: [
                DesignNode(
                    type: .Image,
                    name: "Cover Image",
                    x: 0,
                    y: 0,
                    width: w,
                    height: h,
                    imageName: image,
                    imageSource: image,
                    contentMode: .fill,
                    style: makeStyle(
                        fill: tokens.colors.surfaceSecondary,
                        cornerRadius: tokens.radius.md,
                        opacity: 1.0,
                        shadow: ShadowStyle(color: "#000000", opacity: 0.15, radius: 12, x: 0, y: 6)
                    )
                ),
                DesignNode(type: .Text, name: "Title", x: 0, y: h + 16, width: w, height: 24, text: title, style: transparentTextStyle(fontSize: 16, fontWeight: "semibold", color: tokens.colors.textPrimary)),
                DesignNode(type: .Text, name: "Subtitle", x: 0, y: h + 42, width: w, height: 20, text: subtitle, style: transparentTextStyle(fontSize: 14, color: tokens.colors.textSecondary))
            ]
        )
    }

    private static func humanizedComponentName(_ rawName: String) -> String {
        let cleaned = rawName
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
        var words: [String] = []
        var current = ""
        
        for scalar in cleaned.unicodeScalars {
            if CharacterSet.whitespacesAndNewlines.contains(scalar) {
                if !current.isEmpty {
                    words.append(current)
                    current = ""
                }
            } else if CharacterSet.uppercaseLetters.contains(scalar), !current.isEmpty {
                words.append(current)
                current = String(scalar)
            } else {
                current.append(String(scalar))
            }
        }
        
        if !current.isEmpty {
            words.append(current)
        }
        
        let title = words
            .map { $0.prefix(1).uppercased() + $0.dropFirst() }
            .joined(separator: " ")
        
        return title.isEmpty ? "Custom Section" : title
    }

    private static func createInputField(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h: CGFloat = 56
        let placeholder = props?["placeholder"] ?? props?["label"] ?? "Enter text"

        // A REAL .Input node, not a decorative Frame with a placeholder label.
        // The decorative version could never be typed into — so every composed
        // form, search bar and auth screen built from this component was a
        // picture of a form. The exporter renders .Input as a TextField (or
        // SecureField for password-named fields) and the wiring passes can
        // bind its value to a variable.
        var node = DesignNode(
            id: UUID(), type: .Input, name: action.name ?? "Input Field",
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            text: placeholder,
            style: makeStyle(
                fill: tokens.colors.surfaceSecondary, cornerRadius: 12,
                fontSize: 15, textColor: tokens.colors.textPrimary
            )
        )
        node.style.paddingLeft = 16
        let sensitive = (action.name ?? "") + " " + placeholder
        if sensitive.lowercased().contains("password") || sensitive.contains("סיסמ") {
            node.isSecure = true
        }
        return node
    }

    private static func createTextLink(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 100
        let h: CGFloat = 20
        let text = props?["text"] ?? props?["label"] ?? "Learn more"
        return DesignNode(
            id: UUID(), type: .Text, name: action.name ?? "Text Link",
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            text: text,
            style: transparentTextStyle(fontSize: 14, fontWeight: "semibold", color: tokens.colors.accentPrimary)
        )
    }
    
    private static func createTextHeadline(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? (type == .editorialHeadline ? 80 : 120)
        let text = props?["text"] ?? props?["content"] ?? "Sample text content."
        let fontSize: CGFloat = type == .editorialHeadline ? 28 : 16
        let weight = type == .editorialHeadline ? "bold" : "regular"
        
        return DesignNode(
            id: UUID(), type: .Text, name: action.name ?? type.rawValue,
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            text: text,
            style: transparentTextStyle(fontSize: fontSize, fontWeight: weight, color: tokens.colors.textPrimary)
        )
    }

    private static func createIllustrationBlock(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 200
        let iconName = props?["icon"] ?? "sparkles"
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? type.rawValue,
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 16),
            children: [
                DesignNode(type: .Icon, name: "Illustration", x: (w-64)/2, y: (h-64)/2, width: 64, height: 64, iconName: iconName, style: makeStyle(fill: "#00000000", textColor: tokens.colors.accentPrimary))
            ]
        )
    }

    private static func createProgressCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 100
        let title = props?["title"] ?? "Progress"
        let subtitle = props?["subtitle"] ?? "50%"
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? "Progress Card",
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: 16, shadow: ShadowStyle(color: "#000000", opacity: 0.05, radius: 10, x: 0, y: 4)),
            children: [
                DesignNode(type: .Text, name: "Title", x: 16, y: 16, width: w-32, height: 20, text: title, style: transparentTextStyle(fontSize: 16, fontWeight: "bold", color: tokens.colors.textPrimary)),
                DesignNode(type: .Text, name: "Subtitle", x: 16, y: 38, width: w-32, height: 16, text: subtitle, style: transparentTextStyle(fontSize: 14, color: tokens.colors.textSecondary)),
                DesignNode(type: .Rectangle, name: "Track", x: 16, y: 64, width: w-32, height: 8, style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 4)),
                DesignNode(type: .Rectangle, name: "Fill", x: 16, y: 64, width: (w-32)*0.5, height: 8, style: makeStyle(fill: tokens.colors.accentPrimary, cornerRadius: 4))
            ]
        )
    }

    private static func createDestinationCard(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? (type == .destinationHeroCard ? 358 : 200)
        let h = action.height ?? (type == .destinationHeroCard ? 400 : 250)
        let title = props?["title"] ?? props?["destination"] ?? "Paris"
        let subtitle = props?["subtitle"] ?? props?["country"] ?? "France"
        let image = props?["image"] ?? "travel_mountain"
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? "Destination Card",
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 24, shadow: ShadowStyle(color: "#000000", opacity: 0.1, radius: 12, x: 0, y: 6)),
            children: [
                DesignNode(type: .Image, name: "Cover", x: 0, y: 0, width: w, height: h, imageName: image, style: makeStyle(fill: "#00000000", cornerRadius: 24)),
                DesignNode(type: .Rectangle, name: "Gradient", x: 0, y: h/2, width: w, height: h/2, style: makeStyle(fill: "#000000", cornerRadius: 24, opacity: 0.5)),
                DesignNode(type: .Text, name: "Title", x: 20, y: h-60, width: w-40, height: 28, text: title, style: transparentTextStyle(fontSize: 24, fontWeight: "bold", color: "#FFFFFF")),
                DesignNode(type: .Text, name: "Subtitle", x: 20, y: h-30, width: w-40, height: 16, text: subtitle, style: transparentTextStyle(fontSize: 14, color: "#E5E7EB"))
            ]
        )
    }

    private static func createMoodJournalCard(type: ComponentType, props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h = action.height ?? 160
        let title = props?["title"] ?? props?["prompt"] ?? "How are you feeling?"
        let iconName = props?["icon"] ?? (type == .moodCheckInCard ? "face.smiling" : "book.closed")
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? type.rawValue,
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: 20, shadow: ShadowStyle(color: "#000000", opacity: 0.08, radius: 16, x: 0, y: 8)),
            children: [
                DesignNode(type: .Icon, name: "Icon", x: 20, y: 20, width: 32, height: 32, iconName: iconName, style: makeStyle(fill: "#00000000", textColor: tokens.colors.accentPrimary)),
                DesignNode(type: .Text, name: "Title", x: 20, y: 64, width: w-40, height: 60, text: title, style: transparentTextStyle(fontSize: 18, fontWeight: "semibold", color: tokens.colors.textPrimary)),
                DesignNode(type: .Button, name: "Action", x: w-50, y: 20, width: 30, height: 30, text: "", iconName: "arrow.right", style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 15, textColor: tokens.colors.textPrimary), children: [])
            ]
        )
    }
    
    private static func createAmenityRow(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 358
        let h: CGFloat = 40
        let title = props?["title"] ?? props?["amenity"] ?? "Free Wi-Fi"
        let iconName = props?["icon"] ?? "wifi"
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? "Amenity",
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            style: makeStyle(fill: "#00000000"),
            children: [
                DesignNode(type: .Icon, name: "Icon", x: 0, y: 8, width: 24, height: 24, iconName: iconName, style: makeStyle(fill: "#00000000", textColor: tokens.colors.textSecondary)),
                DesignNode(type: .Text, name: "Title", x: 40, y: 10, width: w-40, height: 20, text: title, style: transparentTextStyle(fontSize: 15, color: tokens.colors.textPrimary))
            ]
        )
    }

    private static func createInstructorCard(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 160
        let h = action.height ?? 200
        let name = props?["name"] ?? "Instructor"
        let role = props?["role"] ?? "Guide"
        let image = props?["image"] ?? "profile_placeholder"
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? "Instructor Card",
            x: action.x ?? 16, y: action.y ?? 16, width: w, height: h,
            style: makeStyle(fill: tokens.colors.surfacePrimary, cornerRadius: 16),
            children: [
                DesignNode(type: .Image, name: "Avatar", x: (w-80)/2, y: 24, width: 80, height: 80, imageName: image, style: makeStyle(fill: "#00000000", cornerRadius: 40)),
                DesignNode(type: .Text, name: "Name", x: 10, y: 120, width: w-20, height: 20, text: name, style: transparentTextStyle(fontSize: 16, fontWeight: "bold", color: tokens.colors.textPrimary, textAlign: "center")),
                DesignNode(type: .Text, name: "Role", x: 10, y: 144, width: w-20, height: 16, text: role, style: transparentTextStyle(fontSize: 13, color: tokens.colors.textSecondary, textAlign: "center"))
            ]
        )
    }

    private static func createProductDetailPanel(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 390
        let h = action.height ?? 400
        let title = props?["title"] ?? "Product Name"
        let price = props?["price"] ?? "$99.99"
        let desc = props?["description"] ?? "Product description goes here."
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? "Product Details",
            x: action.x ?? 0, y: action.y ?? 400, width: w, height: h,
            style: makeStyle(fill: tokens.colors.backgroundPrimary, cornerRadius: 32, shadow: ShadowStyle(color: "#000000", opacity: 0.1, radius: 20, x: 0, y: -4)),
            children: [
                DesignNode(type: .Rectangle, name: "Handle", x: w/2 - 20, y: 12, width: 40, height: 4, style: makeStyle(fill: tokens.colors.surfaceSecondary, cornerRadius: 2)),
                DesignNode(type: .Text, name: "Title", x: 24, y: 40, width: w-120, height: 32, text: title, style: transparentTextStyle(fontSize: 24, fontWeight: "bold", color: tokens.colors.textPrimary)),
                DesignNode(type: .Text, name: "Price", x: w-90, y: 44, width: 66, height: 28, text: price, style: transparentTextStyle(fontSize: 20, fontWeight: "bold", color: tokens.colors.accentPrimary, textAlign: "right")),
                DesignNode(type: .Text, name: "Description", x: 24, y: 80, width: w-48, height: 100, text: desc, style: transparentTextStyle(fontSize: 15, color: tokens.colors.textSecondary))
            ]
        )
    }

    private static func createOnboardingScreen(props: [String: String]?, action: DesignAction, tokens: DesignTokens) -> DesignNode {
        let w = action.width ?? 390
        let h = action.height ?? 844
        let title = props?["title"] ?? "Welcome"
        let subtitle = props?["subtitle"] ?? "Let's get started"
        let image = props?["image"] ?? "travel_forest"
        
        return DesignNode(
            id: UUID(), type: .Frame, name: action.name ?? "Onboarding Screen",
            x: action.x ?? 0, y: action.y ?? 0, width: w, height: h,
            style: makeStyle(fill: tokens.colors.backgroundPrimary),
            children: [
                DesignNode(type: .Image, name: "Image", x: 0, y: 0, width: w, height: h*0.6, imageName: image, style: makeStyle(fill: tokens.colors.surfaceSecondary)),
                DesignNode(type: .Text, name: "Title", x: 24, y: h*0.6 + 40, width: w-48, height: 40, text: title, style: transparentTextStyle(fontSize: 32, fontWeight: "bold", color: tokens.colors.textPrimary)),
                DesignNode(type: .Text, name: "Subtitle", x: 24, y: h*0.6 + 90, width: w-48, height: 60, text: subtitle, style: transparentTextStyle(fontSize: 16, color: tokens.colors.textSecondary))
            ]
        )
    }
}
