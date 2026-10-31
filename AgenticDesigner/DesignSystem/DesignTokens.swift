//
//  DesignTokens.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation
import CoreGraphics

struct ColorTokens: Codable {
    let backgroundPrimary: String
    let surfacePrimary: String
    let surfaceSecondary: String
    let textPrimary: String
    let textSecondary: String
    let accentPrimary: String
    let borderSubtle: String
    // Extended semantic colors
    var accentSecondary: String?
    var success: String?
    var warning: String?
    var error: String?
    var cardGradientStart: String?
    var cardGradientEnd: String?
}

struct SpacingTokens: Codable {
    let xs: CGFloat
    let sm: CGFloat
    let md: CGFloat
    let lg: CGFloat
    let xl: CGFloat
    let xxl: CGFloat
}

struct TextStyleToken: Codable {
    let fontSize: CGFloat
    let lineHeight: CGFloat
    let weight: String // "regular", "semibold", "bold"
    var letterSpacing: CGFloat?
}

struct TypographyTokens: Codable {
    let title1: TextStyleToken
    let headline: TextStyleToken
    let body: TextStyleToken
    let caption: TextStyleToken
    // Extended text styles
    var subtitle: TextStyleToken?
    var overline: TextStyleToken?
    var button: TextStyleToken?
    var navLabel: TextStyleToken?
}

struct RadiusTokens: Codable {
    let sm: CGFloat
    let md: CGFloat
    let lg: CGFloat
    let xl: CGFloat
    let pill: CGFloat
}

struct ShadowTokens: Codable {
    let sm: String
    let md: String
    let lg: String
}

struct GradientTokens: Codable {
    let heroCard: GradientStyle
    let subtleBackground: GradientStyle
    var creditCard: GradientStyle?
    var accent: GradientStyle?
}

struct DesignTokens: Codable {
    let colors: ColorTokens
    let spacing: SpacingTokens
    let typography: TypographyTokens
    let radius: RadiusTokens
    let shadows: ShadowTokens
    var gradients: GradientTokens?
}

extension DesignTokens {
    static let minimalEditorial = DesignTokens(
        colors: ColorTokens(
            backgroundPrimary: "#F8E1CC",
            surfacePrimary: "#FFFFFF",
            surfaceSecondary: "#F7F7F5",
            textPrimary: "#111111",
            textSecondary: "#7A7A7A",
            accentPrimary: "#111111",
            borderSubtle: "#E8E3DD"
        ),
        spacing: SpacingTokens(
            xs: 4,
            sm: 8,
            md: 16,
            lg: 24,
            xl: 32,
            xxl: 48
        ),
        typography: TypographyTokens(
            title1: TextStyleToken(
                fontSize: 42,
                lineHeight: 48,
                weight: "bold"
            ),
            headline: TextStyleToken(
                fontSize: 24,
                lineHeight: 32,
                weight: "semibold"
            ),
            body: TextStyleToken(
                fontSize: 16,
                lineHeight: 24,
                weight: "regular"
            ),
            caption: TextStyleToken(
                fontSize: 13,
                lineHeight: 18,
                weight: "regular"
            )
        ),
        radius: RadiusTokens(
            sm: 8,
            md: 14,
            lg: 24,
            xl: 36,
            pill: 999
        ),
        shadows: ShadowTokens(
            sm: "0 1px 2px rgba(0,0,0,0.05)",
            md: "0 4px 6px rgba(0,0,0,0.05)",
            lg: "0 10px 15px rgba(0,0,0,0.05)"
        )
    )
}
