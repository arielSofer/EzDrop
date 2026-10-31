//
//  AgentContext.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation
import CoreGraphics

enum AgentRequestIntent: String, Codable {
    case createNewDesign
    case editSelection
    case improveExistingCanvas
}

enum AgentRequestIntentClassifier {
    static func classify(prompt: String, hasSelection: Bool, hasCanvasNodes: Bool) -> AgentRequestIntent {
        let text = prompt.lowercased()
        let tokens = Set(
            text.components(separatedBy: CharacterSet.alphanumerics.inverted)
                .filter { !$0.isEmpty }
        )

        // Whole-canvas review requests win over everything when there is a canvas.
        let improvePhrases = [
            "review and fix", "current design", "whole canvas", "entire canvas",
            "existing design", "existing canvas", "העיצוב הנוכחי", "כל הקנבס"
        ]
        if hasCanvasNodes, improvePhrases.contains(where: { text.contains($0) }) {
            return .improveExistingCanvas
        }

        // Creation verbs win over edit words so "build a better travel app"
        // creates a design instead of silently editing the canvas.
        let createPhrases = [
            "create", "build", "make a new", "new screen", "new app",
            "generate", "design me", "design a", "design an", "from scratch", "clone",
            "another screen", "another page", "add a screen", "add a page",
            "add screen", "add page", "more screens", "second screen", "next screen",
            "תיצור", "צור", "תבנה", "בנה", "תעצב", "עצב",
            "מסך חדש", "אפליקציה חדשה", "מאפס", "עוד מסך", "עוד עמוד", "מסך נוסף"
        ]
        if createPhrases.contains(where: { text.contains($0) }) {
            return .createNewDesign
        }

        // Word-boundary matching so short edit words don't fire inside
        // unrelated words ("moving" ≠ "move on canvas", "exchange" ≠ "change").
        let editTokens: Set<String> = [
            "redesign", "improve", "fix", "adjust", "align", "distribute",
            "split", "evenly", "center", "resize", "bigger", "smaller",
            "increase", "decrease", "padding", "spacing", "recolor", "change",
            "move", "place", "arrange", "tidy", "polish", "better",
            "תקן", "תתקן", "שפר", "תשפר", "יישר", "מרכז",
            "רווח", "הזז", "שנה", "סדר"
        ]
        let editPhrases = ["make bigger", "make smaller", "יותר טוב"]
        if hasCanvasNodes,
           !tokens.isDisjoint(with: editTokens) || editPhrases.contains(where: { text.contains($0) }) {
            return hasSelection ? .editSelection : .improveExistingCanvas
        }

        return hasSelection ? .editSelection : .createNewDesign
    }
}

// Context שה-Agent מקבל על המצב הנוכחי של העורך
struct AgentContext: Codable {
    let requestIntent: AgentRequestIntent
    let selectedNode: AgentNodeSummary?
    let selectedParent: AgentNodeSummary?
    let selectedSiblings: [AgentNodeSummary]
    let selectedContainerId: UUID?
    let canvasSummary: [AgentNodeSummary]
    let layoutIssues: [AgentLayoutIssue]
    let creativeDirection: AgentCreativeDirection
    
    // Layout hints — עוזרים ל-Agent לדעת איפה להניח אלמנטים
    let containerWidth: CGFloat?         // רוחב הContainer הנבחר
    let containerHeight: CGFloat?        // גובה הContainer הנבחר
    let suggestedNextY: CGFloat?         // ה-Y הפנוי הבא בתוך הContainer (אחרי כל הילדים הקיימים + gap)
    let horizontalMargin: CGFloat        // margin צדדי מומלץ מכל צד
    let suggestedElementWidth: CGFloat?  // רוחב מומלץ לאלמנט חדש (containerWidth - 2 * margin)
    let existingChildrenCount: Int       // כמה ילדים כבר יש בContainer
    
    let mobileDesignPattern: MobileDesignPattern?
    
    // Design Intelligence Layer
    let appCategory: AppCategory
    let screenType: ScreenType
    let designRecipe: DesignRecipe
    let designTokens: DesignTokens
    
    // Visual Art Direction Layer
    let visualProductCategory: VisualProductCategory
    let presentationMode: PresentationMode
    let visualRecipe: VisualRecipe
    
    let deviceRules: DeviceDesignRules?
}

// סיכום קצר של Node בשביל AI
struct AgentBoxEdges: Codable {
    let top: CGFloat?
    let right: CGFloat?
    let bottom: CGFloat?
    let left: CGFloat?
    
    static func from(top: CGFloat?, right: CGFloat?, bottom: CGFloat?, left: CGFloat?) -> AgentBoxEdges? {
        if top == nil, right == nil, bottom == nil, left == nil {
            return nil
        }
        
        return AgentBoxEdges(top: top, right: right, bottom: bottom, left: left)
    }
}

struct AgentNodeSummary: Codable {
    let id: UUID
    let name: String
    let type: String
    let x: CGFloat
    let y: CGFloat
    let right: CGFloat
    let bottom: CGFloat
    let centerX: CGFloat
    let centerY: CGFloat
    let width: CGFloat
    let height: CGFloat
    let aspectRatio: CGFloat?
    let text: String?
    let fill: String?
    let textColor: String?
    let stroke: String?
    let strokeWidth: CGFloat?
    let cornerRadius: CGFloat?
    let fontSize: CGFloat?
    let fontWeight: String?
    let fontFamily: String?
    let imageSource: String?
    let contentMode: String?
    let layout: String?
    let spacing: CGFloat?
    let layoutAlign: String?
    let padding: AgentBoxEdges?
    let margin: AgentBoxEdges?
    let constraints: EdgeConstraints?
    let clipContent: Bool?
    let zIndex: Double?
    let devicePresetId: String?
    let platform: String?
    let children: [AgentNodeSummary]
}

struct AgentCreativeDirection: Codable {
    let conceptHook: String
    let layoutRhythm: String
    let visualMotif: String
    let imageStrategy: String
    let spatialRule: String
}

struct AgentLayoutIssue: Codable {
    let severity: String
    let nodeId: UUID
    let relatedNodeId: UUID?
    let issue: String
    let suggestedAction: String
}

enum AgentCreativeDirectionLibrary {
    // Axes are sampled independently, so runs draw from hundreds of
    // combinations instead of three fixed templates.
    private static let conceptHooks = [
        "Design around one memorable hero moment that explains the product instantly.",
        "Make the screen feel like a premium product shot, not an admin template.",
        "Create a distinctive app personality from the domain language, not generic mobile UI.",
        "Lead with the user's single most important task and let everything else recede.",
        "Treat the screen like an editorial magazine spread about the product's promise.",
        "Build the identity around one bold, ownable color-and-shape gesture."
    ]

    private static let layoutRhythms = [
        "Use a strong hero, then compact supporting groups with alternating density.",
        "Use fewer, larger sections with generous negative space and one compressed data area.",
        "Mix one tall dramatic section with two shorter functional sections.",
        "Stack a full-bleed opening moment above a calm, evenly-spaced utility zone.",
        "Alternate wide full-width surfaces with a two-column cluster for contrast.",
        "Anchor the composition with a dominant center object and orbit small controls around it."
    ]

    private static let visualMotifs = [
        "Large soft object shapes, oversized icon moments, and one confident accent color.",
        "Floating cards, glassy surfaces, big icon badges, and subtle depth.",
        "Icon-led modules, expressive typography, and tactile rounded controls.",
        "Thin elegant strokes, pill borders, and quiet monochrome surfaces with one warm accent.",
        "Oversized numerals and display type as graphic elements, minimal ornamentation.",
        "Layered rounded masks with overlapping imagery and soft believable shadows."
    ]

    private static let imageStrategies = [
        "Use one large immersive image/visual surface when the category can benefit from imagery.",
        "Prefer a dominant visual card or masked image over many small placeholders.",
        "If photos are not useful, create a large symbolic icon/illustration area instead.",
        "Use a full-bleed background photo with a gradient overlay and high-contrast text.",
        "Feature one product-cutout object floating over a calm card with a grounded shadow."
    ]

    private static let spatialRules = [
        "Keep every group aligned to a clear column, but offset one feature card for editorial energy.",
        "Establish a 24pt outer grid and align centers intentionally across related elements.",
        "Group related icon + label pairs into equal columns with text centered below icons.",
        "Hold a strict left-aligned text axis and let only imagery break the grid.",
        "Use one intentional overlap (image behind text or card over hero) and keep the rest orthogonal."
    ]

    static func direction(for prompt: String) -> AgentCreativeDirection {
        AgentCreativeDirection(
            conceptHook: conceptHooks.randomElement() ?? conceptHooks[0],
            layoutRhythm: layoutRhythms.randomElement() ?? layoutRhythms[0],
            visualMotif: visualMotifs.randomElement() ?? visualMotifs[0],
            imageStrategy: imageStrategies.randomElement() ?? imageStrategies[0],
            spatialRule: spatialRules.randomElement() ?? spatialRules[0]
        )
    }
}

extension AgentNodeSummary {

    // ממיר DesignNode לסיכום קל עבור ה-AI.
    // Coordinates are rounded and the child tree is depth-capped to keep the
    // context JSON compact — long float tails and deep trees only burn tokens.
    init(node: DesignNode, maxDepth: Int = 4) {
        func rounded(_ value: CGFloat) -> CGFloat {
            value.rounded()
        }

        self.id = node.id
        self.name = node.name
        self.type = node.type.rawValue
        self.x = rounded(node.x)
        self.y = rounded(node.y)
        self.right = rounded(node.x + node.width)
        self.bottom = rounded(node.y + node.height)
        self.centerX = rounded(node.x + node.width / 2)
        self.centerY = rounded(node.y + node.height / 2)
        self.width = rounded(node.width)
        self.height = rounded(node.height)
        self.aspectRatio = node.height > 0
            ? ((node.width / node.height) * 100).rounded() / 100
            : nil
        self.text = node.text.map { $0.count > 120 ? String($0.prefix(117)) + "..." : $0 }
        self.fill = node.style.fill
        self.textColor = node.style.textColor
        self.stroke = node.style.stroke
        self.strokeWidth = node.style.strokeWidth
        self.cornerRadius = node.style.cornerRadius
        self.fontSize = node.style.fontSize
        self.fontWeight = node.style.fontWeight
        self.fontFamily = node.style.fontFamily
        self.imageSource = node.imageSource ?? node.imageName
        self.contentMode = node.contentMode?.rawValue
        self.layout = node.style.layout
        self.spacing = node.style.spacing
        self.layoutAlign = node.style.layoutAlign
        self.padding = AgentBoxEdges.from(
            top: node.style.paddingTop,
            right: node.style.paddingRight,
            bottom: node.style.paddingBottom,
            left: node.style.paddingLeft
        )
        self.margin = AgentBoxEdges.from(
            top: node.style.marginTop,
            right: node.style.marginRight,
            bottom: node.style.marginBottom,
            left: node.style.marginLeft
        )
        self.constraints = node.constraints
        self.clipContent = node.clipContent
        self.zIndex = node.zIndex

        self.devicePresetId = node.devicePresetId
        if let devicePresetId = node.devicePresetId,
           let preset = DevicePresetLibrary.preset(for: devicePresetId) {
            self.platform = preset.platform.rawValue
        } else {
            self.platform = nil
        }

        self.children = maxDepth > 1
            ? node.children.map { AgentNodeSummary(node: $0, maxDepth: maxDepth - 1) }
            : []
    }
}
