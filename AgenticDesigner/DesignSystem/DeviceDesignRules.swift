import Foundation

// חוקים עיצוביים לפי פלטפורמה
struct DeviceDesignRules: Codable {
    let platform: DevicePlatform
    let rules: [String]
    let recommendedComponents: [String]
    let avoid: [String]
}

enum DeviceDesignRuleLibrary {
    
    static func rules(for platform: DevicePlatform) -> DeviceDesignRules {
        switch platform {
        case .iPhone:
            return DeviceDesignRules(
                platform: .iPhone,
                rules: [
                    "Use single-column mobile layouts.",
                    "Use large touch targets of at least 44pt.",
                    "Prefer bottom navigation or tab bars.",
                    "Use safe area aware spacing.",
                    "Keep primary CTA visible and thumb-friendly."
                ],
                recommendedComponents: [
                    "mobileHeader",
                    "heroCard",
                    "bottomNavBar",
                    "cardList",
                    "primaryCTA"
                ],
                avoid: [
                    "Avoid desktop sidebars.",
                    "Avoid tiny controls.",
                    "Avoid dense tables."
                ]
            )
            
        case .iPad:
            return DeviceDesignRules(
                platform: .iPad,
                rules: [
                    "Use more spacious layouts.",
                    "Prefer split view or sidebar layouts.",
                    "Use multi-column grids where useful.",
                    "Use larger cards and richer secondary panels."
                ],
                recommendedComponents: [
                    "sidebar",
                    "splitView",
                    "cardGrid",
                    "detailPanel",
                    "toolbar"
                ],
                avoid: [
                    "Avoid overly stretched iPhone layouts.",
                    "Avoid leaving large empty areas."
                ]
            )
            
        case .appleWatch:
            return DeviceDesignRules(
                platform: .appleWatch,
                rules: [
                    "Use glanceable UI.",
                    "Use very few elements.",
                    "Use large readable text.",
                    "Prefer circular or compact controls.",
                    "Keep interactions short."
                ],
                recommendedComponents: [
                    "watchGlanceCard",
                    "circularProgress",
                    "largeMetric",
                    "compactAction"
                ],
                avoid: [
                    "Avoid long forms.",
                    "Avoid dense lists.",
                    "Avoid small text.",
                    "Avoid multi-column layouts."
                ]
            )
            
        case .mac:
            return DeviceDesignRules(
                platform: .mac,
                rules: [
                    "Use desktop productivity layouts.",
                    "Prefer sidebars, toolbars, inspectors, and tables.",
                    "Use multi-pane interfaces.",
                    "Use keyboard and pointer-friendly controls."
                ],
                recommendedComponents: [
                    "sidebar",
                    "toolbar",
                    "table",
                    "inspectorPanel",
                    "dashboardGrid"
                ],
                avoid: [
                    "Avoid mobile bottom nav.",
                    "Avoid oversized mobile cards.",
                    "Avoid phone-like single-column screens."
                ]
            )
            
        case .custom:
            return DeviceDesignRules(
                platform: .custom,
                rules: [
                    "Respect the frame size.",
                    "Choose layout density according to available space."
                ],
                recommendedComponents: [],
                avoid: []
            )
        }
    }
}
