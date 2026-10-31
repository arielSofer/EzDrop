//
//  DesignAction.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation
import CoreGraphics

// התשובה החדשה שה-Agent יחזיר (Milestone 4: Design Plan)
struct DesignAgentResponse: Decodable {
    let plan: [String]
    let actions: [DesignAction]
    
    private enum CodingKeys: String, CodingKey {
        case plan
        case actions
    }
    
    init(plan: [String], actions: [DesignAction]) {
        self.plan = plan
        self.actions = actions
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let planValues = (try? container.decodeIfPresent([FlexibleStringValue].self, forKey: .plan)) ?? []
        let singlePlan = (try? container.decodeIfPresent(FlexibleStringValue.self, forKey: .plan))?.stringValue
        
        self.plan = planValues.isEmpty ? [singlePlan].compactMap { $0 } : planValues.compactMap(\.stringValue)

        // Lossy decode: one invented action type or malformed entry must not
        // discard the whole response — skip bad actions, keep the rest.
        let lossy = try container.decode([LossyDesignAction].self, forKey: .actions)
        let decoded = lossy.compactMap(\.action)
        if decoded.isEmpty && !lossy.isEmpty {
            throw DecodingError.dataCorrupted(DecodingError.Context(
                codingPath: [CodingKeys.actions],
                debugDescription: "No action in the array could be decoded."
            ))
        }
        if decoded.count < lossy.count {
            print("⚠️ Skipped \(lossy.count - decoded.count) undecodable action(s), kept \(decoded.count)")
        }
        self.actions = decoded
    }
}

// Wrapper that swallows individual decode failures inside action arrays.
struct LossyDesignAction: Decodable {
    let action: DesignAction?

    init(from decoder: Decoder) throws {
        action = try? DesignAction(from: decoder)
    }
}

// סוג הפעולה שה־Agent רוצה לבצע
enum DesignActionType: String, Codable {
    case createFrame
    case createText
    case createButton
    case createInput
    case createRectangle
    case createImage
    case createIcon
    case createPage
    case updateText
    case updateStyle
    case moveNode
    case resizeNode
    case scaleNode
    case setAutoLayout
    case pinNode
    case bringToFront
    case sendToBack
    case setZIndex
    case alignChildren
    case distributeChildren
    case positionRelativeTo
    case deleteNode
    case createOnboardingScreen
    case createComponent
    case createPresentationShot
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let rawValue = try container.decode(String.self)
        let normalizedValue = rawValue
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
        
        switch normalizedValue {
        case "createframe", "frame":
            self = .createFrame
        case "createtext", "text":
            self = .createText
        case "createbutton", "button":
            self = .createButton
        case "createinput", "input", "createinputfield", "inputfield":
            self = .createInput
        case "createrectangle", "rectangle", "createshape":
            self = .createRectangle
        case "createimage", "image":
            self = .createImage
        case "createicon", "icon":
            self = .createIcon
        case "createpage", "page", "addpage", "newpage":
            self = .createPage
        case "updatetext":
            self = .updateText
        case "updatestyle":
            self = .updateStyle
        case "movenode":
            self = .moveNode
        case "resizenode":
            self = .resizeNode
        case "scalenode", "scale", "enlarge", "shrink":
            self = .scaleNode
        case "setautolayout", "autolayout", "layoutnode", "setlayout":
            self = .setAutoLayout
        case "pinnode", "pin", "setconstraints", "constraints":
            self = .pinNode
        case "bringtofront", "front", "movefront":
            self = .bringToFront
        case "sendtoback", "back", "moveback":
            self = .sendToBack
        case "setzindex", "zindex", "setlayerorder", "layerorder":
            self = .setZIndex
        case "alignchildren", "alignitems", "align":
            self = .alignChildren
        case "distributechildren", "distributeitems", "distribute", "spaceevenly", "splitevenly":
            self = .distributeChildren
        case "positionrelativeto", "positionrelative", "place relative", "placerelative":
            self = .positionRelativeTo
        case "deletenode", "removenode", "delete", "remove":
            self = .deleteNode
        case "createonboardingscreen", "onboardingscreen":
            self = .createOnboardingScreen
        case "createcomponent", "component":
            self = .createComponent
        case "createpresentationshot", "presentationshot", "createshowcase", "showcase":
            self = .createPresentationShot
        default:
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported DesignAction type: \(rawValue)"
            )
        }
    }
    
    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }
}

// פעולה אחת שה־Agent מחזיר לאפליקציה
struct DesignAction: Decodable, Identifiable {
    var id = UUID()
    
    let type: DesignActionType
    let component: ComponentType?
    let rawComponentName: String?
    let props: [String: String]?
    
    // מזהה Node קיים — רלוונטי לעדכון/הזזה/resize
    let nodeId: UUID?
    // var so the app can tag generated-image actions with a reference before
    // applying, which lets it patch the real asset in after async generation.
    var nodeReference: String?
    
    // מזהה ההורה שאליו נרצה להוסיף Node חדש
    let parentId: UUID?
    let parentReference: String?
    
    // נתונים כלליים
    let name: String?
    let text: String?
    let pageName: String?        // לcreatePage
    
    // מיקום וגודל
    let x: CGFloat?
    let y: CGFloat?
    let width: CGFloat?
    let height: CGFloat?
    let scale: CGFloat?
    let axis: String?
    let alignment: String?
    let relativeToNodeId: UUID?
    let relativeToReference: String?
    let anchor: String?
    let offsetX: CGFloat?
    let offsetY: CGFloat?
    
    // Style
    let fill: String?
    let stroke: String?
    let strokeWidth: CGFloat?
    let gradient: GradientStyle?
    let cornerRadius: CGFloat?
    let opacity: Double?
    let fontSize: CGFloat?
    let textColor: String?       // צבע טקסט
    let textAlign: String?
    let letterSpacing: CGFloat?
    let lineHeight: CGFloat?
    let constraints: EdgeConstraints?
    let clipContent: Bool?
    let zIndex: Double?
    let textBehavior: TextBehavior?
    let scrollAxis: String?
    let scrollOffset: CGFloat?
    let recycleItemSpacing: CGFloat?
    let recycleItemCount: Int?
    // Data-bound repeat (recycler) template: clone this node once per item
    // of a JSON-array variable, {{alias.field}} tokens resolving per item.
    let repeatSourceVariable: String?
    let timePickerHourVariable: String?
    let timePickerMinuteVariable: String?
    let repeatItemAlias: String?
    let repeatAxis: String?          // "vertical" | "horizontal"
    let repeatMaxItems: Int?
    let repeatScrollable: Bool?
    let repeatFilterVariable: String?  // live search filter variable
    let repeatCategoryVariable: String?  // second (category) filter variable
    let shadow: ShadowStyle?
    let overlayColor: String?
    let overlayOpacity: Double?
    let blur: CGFloat?
    let backgroundBlur: CGFloat?
    let padding: CGFloat?        // padding אחיד לכל הכיוונים
    let paddingH: CGFloat?       // padding אופקי (left+right)
    let paddingV: CGFloat?       // padding אנכי (top+bottom)
    let paddingTop: CGFloat?
    let paddingRight: CGFloat?
    let paddingBottom: CGFloat?
    let paddingLeft: CGFloat?
    let margin: CGFloat?
    let marginH: CGFloat?
    let marginV: CGFloat?
    let marginTop: CGFloat?
    let marginRight: CGFloat?
    let marginBottom: CGFloat?
    let marginLeft: CGFloat?
    
    // Auto Layout
    let layout: String?          // e.g. "verticalStack", "horizontalStack"
    let spacing: CGFloat?        // מרווח בין ילדים
    let layoutAlign: String?
    
    // ספציפי לתמונה / אייקוןIcon
    let imageName: String?       // URL או path לImage nodes
    let imageSource: String?
    // var so the app can synthesize a brief for placeholder-only images
    // instead of rendering a gray placeholder box.
    var imagePrompt: String?
    let assetKind: String?
    let aspectRatio: String?
    let resolution: String?
    let size: String?
    let contentMode: ImageContentMode?
    let iconName: String?        // שם SF Symbol לIcon nodes
    
    // Onboarding Macro fields
    let title: String?
    let descriptionText: String? // Mapped from "description" in JSON
    let primaryCTA: String?
    let secondaryCTA: String?
    let stylePreset: String?
    let fontWeight: String?
    let fontFamily: String?
    
    init(
        id: UUID = UUID(),
        type: DesignActionType,
        nodeId: UUID? = nil,
        nodeReference: String? = nil,
        parentId: UUID? = nil,
        parentReference: String? = nil,
        name: String? = nil,
        text: String? = nil,
        pageName: String? = nil,
        x: CGFloat? = nil,
        y: CGFloat? = nil,
        width: CGFloat? = nil,
        height: CGFloat? = nil,
        scale: CGFloat? = nil,
        axis: String? = nil,
        alignment: String? = nil,
        relativeToNodeId: UUID? = nil,
        relativeToReference: String? = nil,
        anchor: String? = nil,
        offsetX: CGFloat? = nil,
        offsetY: CGFloat? = nil,
        fill: String? = nil,
        stroke: String? = nil,
        strokeWidth: CGFloat? = nil,
        gradient: GradientStyle? = nil,
        cornerRadius: CGFloat? = nil,
        opacity: Double? = nil,
        fontSize: CGFloat? = nil,
        textColor: String? = nil,
        textAlign: String? = nil,
        letterSpacing: CGFloat? = nil,
        lineHeight: CGFloat? = nil,
        constraints: EdgeConstraints? = nil,
        clipContent: Bool? = nil,
        zIndex: Double? = nil,
        textBehavior: TextBehavior? = nil,
        scrollAxis: String? = nil,
        scrollOffset: CGFloat? = nil,
        recycleItemSpacing: CGFloat? = nil,
        recycleItemCount: Int? = nil,
        repeatSourceVariable: String? = nil,
        timePickerHourVariable: String? = nil,
        timePickerMinuteVariable: String? = nil,
        repeatItemAlias: String? = nil,
        repeatAxis: String? = nil,
        repeatMaxItems: Int? = nil,
        repeatScrollable: Bool? = nil,
        repeatFilterVariable: String? = nil,
        repeatCategoryVariable: String? = nil,
        shadow: ShadowStyle? = nil,
        overlayColor: String? = nil,
        overlayOpacity: Double? = nil,
        blur: CGFloat? = nil,
        backgroundBlur: CGFloat? = nil,
        padding: CGFloat? = nil,
        paddingH: CGFloat? = nil,
        paddingV: CGFloat? = nil,
        paddingTop: CGFloat? = nil,
        paddingRight: CGFloat? = nil,
        paddingBottom: CGFloat? = nil,
        paddingLeft: CGFloat? = nil,
        margin: CGFloat? = nil,
        marginH: CGFloat? = nil,
        marginV: CGFloat? = nil,
        marginTop: CGFloat? = nil,
        marginRight: CGFloat? = nil,
        marginBottom: CGFloat? = nil,
        marginLeft: CGFloat? = nil,
        imageName: String? = nil,
        imageSource: String? = nil,
        imagePrompt: String? = nil,
        assetKind: String? = nil,
        aspectRatio: String? = nil,
        resolution: String? = nil,
        size: String? = nil,
        contentMode: ImageContentMode? = nil,
        iconName: String? = nil,
        title: String? = nil,
        descriptionText: String? = nil,
        primaryCTA: String? = nil,
        secondaryCTA: String? = nil,
        stylePreset: String? = nil,
        fontWeight: String? = nil,
        fontFamily: String? = nil,
        rawComponentName: String? = nil,
        component: ComponentType? = nil,
        props: [String: String]? = nil,
        layout: String? = nil,
        spacing: CGFloat? = nil,
        layoutAlign: String? = nil
    ) {
        self.id = id
        self.type = type
        self.nodeId = nodeId
        self.nodeReference = nodeReference
        self.parentId = parentId
        self.parentReference = parentReference
        self.name = name
        self.text = text
        self.pageName = pageName
        self.x = x
        self.y = y
        self.width = width
        self.height = height
        self.scale = scale
        self.axis = axis
        self.alignment = alignment
        self.relativeToNodeId = relativeToNodeId
        self.relativeToReference = relativeToReference
        self.anchor = anchor
        self.offsetX = offsetX
        self.offsetY = offsetY
        self.fill = fill
        self.stroke = stroke
        self.strokeWidth = strokeWidth
        self.gradient = gradient
        self.cornerRadius = cornerRadius
        self.opacity = opacity
        self.fontSize = fontSize
        self.textColor = textColor
        self.textAlign = textAlign
        self.letterSpacing = letterSpacing
        self.lineHeight = lineHeight
        self.constraints = constraints
        self.clipContent = clipContent
        self.zIndex = zIndex
        self.textBehavior = textBehavior
        self.scrollAxis = scrollAxis
        self.scrollOffset = scrollOffset
        self.recycleItemSpacing = recycleItemSpacing
        self.recycleItemCount = recycleItemCount
        self.repeatSourceVariable = repeatSourceVariable
        self.timePickerHourVariable = timePickerHourVariable
        self.timePickerMinuteVariable = timePickerMinuteVariable
        self.repeatItemAlias = repeatItemAlias
        self.repeatAxis = repeatAxis
        self.repeatMaxItems = repeatMaxItems
        self.repeatScrollable = repeatScrollable
        self.repeatFilterVariable = repeatFilterVariable
        self.repeatCategoryVariable = repeatCategoryVariable
        self.shadow = shadow
        self.overlayColor = overlayColor
        self.overlayOpacity = overlayOpacity
        self.blur = blur
        self.backgroundBlur = backgroundBlur
        self.padding = padding
        self.paddingH = paddingH
        self.paddingV = paddingV
        self.paddingTop = paddingTop
        self.paddingRight = paddingRight
        self.paddingBottom = paddingBottom
        self.paddingLeft = paddingLeft
        self.margin = margin
        self.marginH = marginH
        self.marginV = marginV
        self.marginTop = marginTop
        self.marginRight = marginRight
        self.marginBottom = marginBottom
        self.marginLeft = marginLeft
        self.imageName = imageName
        self.imageSource = imageSource
        self.imagePrompt = imagePrompt
        self.assetKind = assetKind
        self.aspectRatio = aspectRatio
        self.resolution = resolution
        self.size = size
        self.contentMode = contentMode
        self.iconName = iconName
        self.title = title
        self.descriptionText = descriptionText
        self.primaryCTA = primaryCTA
        self.secondaryCTA = secondaryCTA
        self.stylePreset = stylePreset
        self.fontWeight = fontWeight
        self.fontFamily = fontFamily
        self.component = component
        self.rawComponentName = rawComponentName
        self.props = props
        self.layout = layout
        self.spacing = spacing
        self.layoutAlign = layoutAlign
    }
    
    func replacingGeneratedImageSource(_ imageSource: String) -> DesignAction {
        DesignAction(
            id: id,
            type: type,
            nodeId: nodeId,
            nodeReference: nodeReference,
            parentId: parentId,
            parentReference: parentReference,
            name: name,
            text: text,
            pageName: pageName,
            x: x,
            y: y,
            width: width,
            height: height,
            scale: scale,
            axis: axis,
            alignment: alignment,
            relativeToNodeId: relativeToNodeId,
            relativeToReference: relativeToReference,
            anchor: anchor,
            offsetX: offsetX,
            offsetY: offsetY,
            fill: fill,
            stroke: stroke,
            strokeWidth: strokeWidth,
            gradient: gradient,
            cornerRadius: cornerRadius,
            opacity: opacity,
            fontSize: fontSize,
            textColor: textColor,
            textAlign: textAlign,
            letterSpacing: letterSpacing,
            lineHeight: lineHeight,
            constraints: constraints,
            clipContent: clipContent,
            zIndex: zIndex,
            textBehavior: textBehavior,
            scrollAxis: scrollAxis,
            scrollOffset: scrollOffset,
            recycleItemSpacing: recycleItemSpacing,
            recycleItemCount: recycleItemCount,
            shadow: shadow,
            overlayColor: overlayColor,
            overlayOpacity: overlayOpacity,
            blur: blur,
            backgroundBlur: backgroundBlur,
            padding: padding,
            paddingH: paddingH,
            paddingV: paddingV,
            paddingTop: paddingTop,
            paddingRight: paddingRight,
            paddingBottom: paddingBottom,
            paddingLeft: paddingLeft,
            margin: margin,
            marginH: marginH,
            marginV: marginV,
            marginTop: marginTop,
            marginRight: marginRight,
            marginBottom: marginBottom,
            marginLeft: marginLeft,
            imageName: imageSource,
            imageSource: imageSource,
            imagePrompt: imagePrompt,
            assetKind: assetKind,
            aspectRatio: aspectRatio,
            resolution: resolution,
            size: size,
            contentMode: contentMode,
            iconName: iconName,
            title: title,
            descriptionText: descriptionText,
            primaryCTA: primaryCTA,
            secondaryCTA: secondaryCTA,
            stylePreset: stylePreset,
            fontWeight: fontWeight,
            fontFamily: fontFamily,
            rawComponentName: rawComponentName,
            component: component,
            props: props,
            layout: layout,
            spacing: spacing,
            layoutAlign: layoutAlign
        )
    }
    
    fileprivate enum CodingKeys: String, CodingKey {
        case id
        case type
        case component
        case rawComponentName
        case props
        case nodeId
        case nodeReference
        case parentId
        case parentReference
        case parent
        case parentRef
        case parentNodeReference
        case name
        case text
        case pageName
        case x, y, width, height
        case scale
        case axis
        case alignment
        case relativeToNodeId
        case relativeToReference
        case anchor
        case offsetX
        case offsetY
        case fill
        case backgroundColor
        case fillColor
        case stroke
        case borderColor
        case strokeWidth
        case borderWidth
        case gradient
        case cornerRadius
        case opacity
        case fontSize
        case textColor
        case color
        case foregroundColor
        case textAlign
        case letterSpacing
        case lineHeight
        case constraints
        case pin
        case clipContent
        case zIndex
        case textBehavior
        case scrollAxis
        case scrollOffset
        case recycleItemSpacing
        case recycleItemCount
        case repeatSourceVariable
        case timePickerHourVariable
        case timePickerMinuteVariable
        case repeatItemAlias
        case repeatAxis
        case repeatMaxItems
        case repeatScrollable
        case repeatFilterVariable
        case repeatCategoryVariable
        case scrollBehavior
        case shadow
        case overlayColor
        case overlayOpacity
        case blur
        case backgroundBlur
        case padding
        case paddingH
        case paddingV
        case paddingTop
        case paddingRight
        case paddingBottom
        case paddingLeft
        case margin
        case marginH
        case marginV
        case marginTop
        case marginRight
        case marginBottom
        case marginLeft
        case imageName
        case imageSource
        case imagePrompt
        case assetPrompt
        case assetKind
        case aspectRatio
        case resolution
        case size
        case contentMode
        case iconName
        case symbol
        case systemName
        case sfSymbol
        case icon
        case title
        case descriptionText = "description"
        case primaryCTA
        case secondaryCTA
        case stylePreset
        case fontWeight
        case fontFamily
        case layout
        case spacing
        case gap
        case layoutAlign
    }
    
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedNodeId = try container.decodeFlexibleUUIDReferenceIfPresent(forKey: .nodeId)
        let decodedParentId = try container.decodeFlexibleUUIDReferenceIfPresent(forKey: .parentId)
        
        self.id = try container.decodeFlexibleUUIDIfPresent(forKey: .id) ?? UUID()
        self.type = try container.decode(DesignActionType.self, forKey: .type)
        self.rawComponentName = try container.decodeFlexibleStringIfPresent(forKey: .component)
            ?? container.decodeFlexibleStringIfPresent(forKey: .rawComponentName)
        self.component = try? container.decodeIfPresent(ComponentType.self, forKey: .component)
        self.props = try container.decodeFlexibleStringDictionaryIfPresent(forKey: .props)
        self.nodeId = decodedNodeId.uuid
        self.nodeReference = try container.decodeFlexibleStringIfPresent(forKey: .nodeReference) ?? decodedNodeId.reference
        self.parentId = decodedParentId.uuid
        self.parentReference = try container.decodeFlexibleStringIfPresent(forKey: .parentReference)
            ?? container.decodeFlexibleStringIfPresent(forKey: .parent)
            ?? container.decodeFlexibleStringIfPresent(forKey: .parentRef)
            ?? container.decodeFlexibleStringIfPresent(forKey: .parentNodeReference)
            ?? decodedParentId.reference
        self.name = try container.decodeFlexibleStringIfPresent(forKey: .name)
        self.text = try container.decodeFlexibleStringIfPresent(forKey: .text)
        self.pageName = try container.decodeFlexibleStringIfPresent(forKey: .pageName)
        self.x = try container.decodeFlexibleCGFloatIfPresent(forKey: .x)
        self.y = try container.decodeFlexibleCGFloatIfPresent(forKey: .y)
        self.width = try container.decodeFlexibleCGFloatIfPresent(forKey: .width)
        self.height = try container.decodeFlexibleCGFloatIfPresent(forKey: .height)
        self.scale = try container.decodeFlexibleCGFloatIfPresent(forKey: .scale)
        self.axis = try container.decodeFlexibleStringIfPresent(forKey: .axis)
        self.alignment = try container.decodeFlexibleStringIfPresent(forKey: .alignment)
        let decodedRelativeToNodeId = try container.decodeFlexibleUUIDReferenceIfPresent(forKey: .relativeToNodeId)
        self.relativeToNodeId = decodedRelativeToNodeId.uuid
        self.relativeToReference = try container.decodeFlexibleStringIfPresent(forKey: .relativeToReference) ?? decodedRelativeToNodeId.reference
        self.anchor = try container.decodeFlexibleStringIfPresent(forKey: .anchor)
        self.offsetX = try container.decodeFlexibleCGFloatIfPresent(forKey: .offsetX)
        self.offsetY = try container.decodeFlexibleCGFloatIfPresent(forKey: .offsetY)
        self.fill = try container.decodeFlexibleStringIfPresent(forKey: .fill)
            ?? container.decodeFlexibleStringIfPresent(forKey: .backgroundColor)
            ?? container.decodeFlexibleStringIfPresent(forKey: .fillColor)
        self.stroke = try container.decodeFlexibleStringIfPresent(forKey: .stroke)
            ?? container.decodeFlexibleStringIfPresent(forKey: .borderColor)
        self.strokeWidth = try container.decodeFlexibleCGFloatIfPresent(forKey: .strokeWidth)
            ?? container.decodeFlexibleCGFloatIfPresent(forKey: .borderWidth)
        self.gradient = try container.decodeIfPresent(GradientStyle.self, forKey: .gradient)
        self.cornerRadius = try container.decodeFlexibleCGFloatIfPresent(forKey: .cornerRadius)
        self.opacity = try container.decodeFlexibleDoubleIfPresent(forKey: .opacity)
        self.fontSize = try container.decodeFlexibleCGFloatIfPresent(forKey: .fontSize)
            ?? container.decodeFlexibleCGFloatIfPresent(forKey: .size)
        self.textColor = try container.decodeFlexibleStringIfPresent(forKey: .textColor)
            ?? container.decodeFlexibleStringIfPresent(forKey: .color)
            ?? container.decodeFlexibleStringIfPresent(forKey: .foregroundColor)
        self.textAlign = try container.decodeFlexibleStringIfPresent(forKey: .textAlign)
        self.letterSpacing = try container.decodeFlexibleCGFloatIfPresent(forKey: .letterSpacing)
        self.lineHeight = try container.decodeFlexibleCGFloatIfPresent(forKey: .lineHeight)
        self.constraints = try container.decodeFlexibleConstraintsIfPresent(forKey: .constraints)
            ?? container.decodeFlexibleConstraintsIfPresent(forKey: .pin)
        self.clipContent = try container.decodeFlexibleBoolIfPresent(forKey: .clipContent)
        self.zIndex = try container.decodeFlexibleDoubleIfPresent(forKey: .zIndex)
        self.textBehavior = try container.decodeFlexibleTextBehaviorIfPresent(forKey: .textBehavior)
        let decodedScroll = try container.decodeIfPresent(ScrollBehavior.self, forKey: .scrollBehavior)
        self.scrollAxis = try container.decodeFlexibleStringIfPresent(forKey: .scrollAxis)
            ?? decodedScroll?.axis
        self.scrollOffset = try container.decodeFlexibleCGFloatIfPresent(forKey: .scrollOffset)
            ?? decodedScroll?.initialOffset
        self.recycleItemSpacing = try container.decodeFlexibleCGFloatIfPresent(forKey: .recycleItemSpacing)
            ?? decodedScroll?.itemSpacing
        let decodedRecycleCount = try container.decodeFlexibleCGFloatIfPresent(forKey: .recycleItemCount)
        self.recycleItemCount = decodedRecycleCount.map { max(0, Int($0.rounded())) }
            ?? decodedScroll?.itemCount
        self.repeatSourceVariable = try container.decodeFlexibleStringIfPresent(forKey: .repeatSourceVariable)
        self.timePickerHourVariable = try container.decodeFlexibleStringIfPresent(forKey: .timePickerHourVariable)
        self.timePickerMinuteVariable = try container.decodeFlexibleStringIfPresent(forKey: .timePickerMinuteVariable)
        self.repeatItemAlias = try container.decodeFlexibleStringIfPresent(forKey: .repeatItemAlias)
        self.repeatAxis = try container.decodeFlexibleStringIfPresent(forKey: .repeatAxis)
        let decodedRepeatMax = try container.decodeFlexibleCGFloatIfPresent(forKey: .repeatMaxItems)
        self.repeatMaxItems = decodedRepeatMax.map { max(1, Int($0.rounded())) }
        self.repeatScrollable = try container.decodeFlexibleBoolIfPresent(forKey: .repeatScrollable)
        self.repeatFilterVariable = try container.decodeFlexibleStringIfPresent(forKey: .repeatFilterVariable)
        self.repeatCategoryVariable = try container.decodeFlexibleStringIfPresent(forKey: .repeatCategoryVariable)
        self.shadow = try container.decodeFlexibleShadowIfPresent(forKey: .shadow)
        self.overlayColor = try container.decodeFlexibleStringIfPresent(forKey: .overlayColor)
        self.overlayOpacity = try container.decodeFlexibleDoubleIfPresent(forKey: .overlayOpacity)
        self.blur = try container.decodeFlexibleCGFloatIfPresent(forKey: .blur)
        self.backgroundBlur = try container.decodeFlexibleCGFloatIfPresent(forKey: .backgroundBlur)
        
        let decodedPadding = try container.decodeFlexiblePaddingIfPresent(forKey: .padding)
        self.padding = decodedPadding.all
        self.paddingH = try container.decodeFlexibleCGFloatIfPresent(forKey: .paddingH)
            ?? decodedPadding.horizontal
        self.paddingV = try container.decodeFlexibleCGFloatIfPresent(forKey: .paddingV)
            ?? decodedPadding.vertical
        self.paddingTop = try container.decodeFlexibleCGFloatIfPresent(forKey: .paddingTop)
            ?? decodedPadding.top
        self.paddingRight = try container.decodeFlexibleCGFloatIfPresent(forKey: .paddingRight)
            ?? decodedPadding.right
        self.paddingBottom = try container.decodeFlexibleCGFloatIfPresent(forKey: .paddingBottom)
            ?? decodedPadding.bottom
        self.paddingLeft = try container.decodeFlexibleCGFloatIfPresent(forKey: .paddingLeft)
            ?? decodedPadding.left
        let decodedMargin = try container.decodeFlexiblePaddingIfPresent(forKey: .margin)
        self.margin = decodedMargin.all
        self.marginH = try container.decodeFlexibleCGFloatIfPresent(forKey: .marginH)
            ?? decodedMargin.horizontal
        self.marginV = try container.decodeFlexibleCGFloatIfPresent(forKey: .marginV)
            ?? decodedMargin.vertical
        self.marginTop = try container.decodeFlexibleCGFloatIfPresent(forKey: .marginTop)
            ?? decodedMargin.top
        self.marginRight = try container.decodeFlexibleCGFloatIfPresent(forKey: .marginRight)
            ?? decodedMargin.right
        self.marginBottom = try container.decodeFlexibleCGFloatIfPresent(forKey: .marginBottom)
            ?? decodedMargin.bottom
        self.marginLeft = try container.decodeFlexibleCGFloatIfPresent(forKey: .marginLeft)
            ?? decodedMargin.left
        self.imageName = try container.decodeFlexibleStringIfPresent(forKey: .imageName)
        self.imageSource = try container.decodeFlexibleStringIfPresent(forKey: .imageSource)
        self.imagePrompt = try container.decodeFlexibleStringIfPresent(forKey: .imagePrompt)
            ?? container.decodeFlexibleStringIfPresent(forKey: .assetPrompt)
        self.assetKind = try container.decodeFlexibleStringIfPresent(forKey: .assetKind)
        self.aspectRatio = try container.decodeFlexibleStringIfPresent(forKey: .aspectRatio)
        self.resolution = try container.decodeFlexibleStringIfPresent(forKey: .resolution)
        self.size = try container.decodeFlexibleStringIfPresent(forKey: .size)
        self.contentMode = try container.decodeFlexibleContentModeIfPresent(forKey: .contentMode)
        self.iconName = try container.decodeFlexibleStringIfPresent(forKey: .iconName)
            ?? container.decodeFlexibleStringIfPresent(forKey: .symbol)
            ?? container.decodeFlexibleStringIfPresent(forKey: .systemName)
            ?? container.decodeFlexibleStringIfPresent(forKey: .sfSymbol)
            ?? container.decodeFlexibleStringIfPresent(forKey: .icon)
        self.title = try container.decodeFlexibleStringIfPresent(forKey: .title)
        self.descriptionText = try container.decodeFlexibleStringIfPresent(forKey: .descriptionText)
        self.primaryCTA = try container.decodeFlexibleStringIfPresent(forKey: .primaryCTA)
        self.secondaryCTA = try container.decodeFlexibleStringIfPresent(forKey: .secondaryCTA)
        self.stylePreset = try container.decodeFlexibleStringIfPresent(forKey: .stylePreset)
        self.fontWeight = try container.decodeFlexibleStringIfPresent(forKey: .fontWeight)
        self.fontFamily = try container.decodeFlexibleStringIfPresent(forKey: .fontFamily)
        let decodedLayout = try container.decodeFlexibleLayoutIfPresent(forKey: .layout)
        let layoutString = try container.decodeFlexibleStringIfPresent(forKey: .layout)
        self.layout = decodedLayout.type ?? layoutString
        self.spacing = try container.decodeFlexibleCGFloatIfPresent(forKey: .spacing)
            ?? container.decodeFlexibleCGFloatIfPresent(forKey: .gap)
            ?? decodedLayout.gap
        self.layoutAlign = try container.decodeFlexibleStringIfPresent(forKey: .layoutAlign)
            ?? decodedLayout.align
    }
}

private struct FlexibleStringValue: Decodable {
    let stringValue: String?
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        
        if container.decodeNil() {
            self.stringValue = nil
        } else if let value = try? container.decode(String.self) {
            self.stringValue = value
        } else if let value = try? container.decode(Bool.self) {
            self.stringValue = value ? "true" : "false"
        } else if let value = try? container.decode(Int.self) {
            self.stringValue = String(value)
        } else if let value = try? container.decode(Double.self) {
            self.stringValue = String(value)
        } else if let value = try? container.decode([String: FlexibleStringValue].self) {
            self.stringValue = Self.jsonString(from: value)
        } else if let value = try? container.decode([FlexibleStringValue].self) {
            self.stringValue = Self.jsonString(from: value)
        } else {
            self.stringValue = nil
        }
    }
    
    private static func jsonString(from object: [String: FlexibleStringValue]) -> String? {
        let jsonObject = object.reduce(into: [String: Any]()) { result, item in
            result[item.key] = item.value.jsonObject
        }
        
        return serializedJSONString(from: jsonObject)
    }
    
    private static func jsonString(from array: [FlexibleStringValue]) -> String? {
        serializedJSONString(from: array.map(\.jsonObject))
    }
    
    private static func serializedJSONString(from object: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let string = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        
        return string
    }
    
    private var jsonObject: Any {
        stringValue ?? NSNull()
    }
}

private struct FlexiblePaddingValue {
    var all: CGFloat?
    var horizontal: CGFloat?
    var vertical: CGFloat?
    var top: CGFloat?
    var right: CGFloat?
    var bottom: CGFloat?
    var left: CGFloat?
}

private struct FlexibleLayoutValue {
    var type: String?
    var gap: CGFloat?
    var align: String?
}

private extension CGFloat {
    static func parseFlexibleNumber(_ rawValue: String) -> CGFloat? {
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
}

private extension KeyedDecodingContainer where K == DesignAction.CodingKeys {
    
    func decodeFlexibleStringIfPresent(forKey key: K) throws -> String? {
        guard let value = try? decodeIfPresent(FlexibleStringValue.self, forKey: key) else {
            return nil
        }
        
        return value.stringValue
    }
    
    func decodeFlexibleStringDictionaryIfPresent(forKey key: K) throws -> [String: String]? {
        if let values = try? decodeIfPresent([String: FlexibleStringValue].self, forKey: key) {
            return values.reduce(into: [String: String]()) { result, item in
                if let stringValue = item.value.stringValue {
                    result[item.key] = stringValue
                }
            }
        }
        
        if let values = try? decodeIfPresent([FlexibleStringValue].self, forKey: key) {
            return values.enumerated().reduce(into: [String: String]()) { result, item in
                if let stringValue = item.element.stringValue {
                    result["item\(item.offset + 1)"] = stringValue
                }
            }
        }
        
        return nil
    }
    
    func decodeFlexibleContentModeIfPresent(forKey key: K) throws -> ImageContentMode? {
        guard let rawValue = try decodeFlexibleStringIfPresent(forKey: key)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
        else {
            return nil
        }
        
        switch rawValue {
        case "fill", "cover", "aspectfill", "scaleaspectfill", "crop":
            return .fill
        case "fit", "contain", "aspectfit", "scaleaspectfit":
            return .fit
        default:
            return nil
        }
    }
    
    func decodeFlexiblePaddingIfPresent(forKey key: K) throws -> FlexiblePaddingValue {
        if let uniform = try? decodeFlexibleCGFloatIfPresent(forKey: key) {
            return FlexiblePaddingValue(
                all: uniform,
                horizontal: nil,
                vertical: nil,
                top: nil,
                right: nil,
                bottom: nil,
                left: nil
            )
        }
        
        guard let values = try? decodeIfPresent([String: FlexibleStringValue].self, forKey: key) else {
            return FlexiblePaddingValue()
        }
        
        func number(_ names: String...) -> CGFloat? {
            for name in names {
                if let raw = values[name]?.stringValue,
                   let value = CGFloat.parseFlexibleNumber(raw) {
                    return value
                }
            }
            
            return nil
        }
        
        let all = number("all", "value")
        let horizontal = number("horizontal", "h", "x")
        let vertical = number("vertical", "v", "y")
        
        return FlexiblePaddingValue(
            all: all,
            horizontal: horizontal,
            vertical: vertical,
            top: number("top") ?? vertical ?? all,
            right: number("right", "trailing") ?? horizontal ?? all,
            bottom: number("bottom") ?? vertical ?? all,
            left: number("left", "leading") ?? horizontal ?? all
        )
    }
    
    func decodeFlexibleLayoutIfPresent(forKey key: K) throws -> FlexibleLayoutValue {
        guard let values = try? decodeIfPresent([String: FlexibleStringValue].self, forKey: key) else {
            return FlexibleLayoutValue()
        }
        
        func string(_ names: String...) -> String? {
            for name in names {
                if let raw = values[name]?.stringValue,
                   !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return raw
                }
            }
            
            return nil
        }
        
        func number(_ names: String...) -> CGFloat? {
            for name in names {
                if let raw = values[name]?.stringValue,
                   let value = CGFloat.parseFlexibleNumber(raw) {
                    return value
                }
            }
            
            return nil
        }
        
        return FlexibleLayoutValue(
            type: string("type", "direction", "layout"),
            gap: number("gap", "spacing"),
            align: string("align", "alignment", "items")
        )
    }
    
    func decodeFlexibleConstraintsIfPresent(forKey key: K) throws -> EdgeConstraints? {
        guard let values = try? decodeIfPresent([String: FlexibleStringValue].self, forKey: key) else {
            return nil
        }
        
        func number(_ names: String...) -> CGFloat? {
            for name in names {
                guard let raw = values[name]?.stringValue else { continue }
                let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                
                if normalized == "true" {
                    return 0
                }
                
                if let value = CGFloat.parseFlexibleNumber(raw) {
                    return value
                }
            }
            
            return nil
        }
        
        let constraints = EdgeConstraints(
            top: number("top"),
            right: number("right", "trailing"),
            bottom: number("bottom"),
            left: number("left", "leading"),
            centerX: number("centerX", "centerx", "horizontalCenter"),
            centerY: number("centerY", "centery", "verticalCenter")
        )
        
        if constraints.top == nil,
           constraints.right == nil,
           constraints.bottom == nil,
           constraints.left == nil,
           constraints.centerX == nil,
           constraints.centerY == nil {
            return nil
        }
        
        return constraints
    }
    
    func decodeFlexibleTextBehaviorIfPresent(forKey key: K) throws -> TextBehavior? {
        guard let values = try? decodeIfPresent([String: FlexibleStringValue].self, forKey: key) else {
            return nil
        }
        
        func bool(_ names: String...) -> Bool? {
            for name in names {
                guard let raw = values[name]?.stringValue else { continue }
                let normalized = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
                if ["true", "yes", "1", "wrap", "auto"].contains(normalized) { return true }
                if ["false", "no", "0", "none"].contains(normalized) { return false }
            }
            
            return nil
        }
        
        func int(_ names: String...) -> Int? {
            for name in names {
                guard let raw = values[name]?.stringValue else { continue }
                if let value = Int(raw.trimmingCharacters(in: .whitespacesAndNewlines)) {
                    return value
                }
            }
            
            return nil
        }
        
        func string(_ names: String...) -> String? {
            for name in names {
                if let raw = values[name]?.stringValue,
                   !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    return raw
                }
            }
            
            return nil
        }
        
        return TextBehavior(
            wrap: bool("wrap"),
            autoHeight: bool("autoHeight", "autoheight"),
            maxLines: int("maxLines", "maxlines"),
            truncate: bool("truncate", "truncation"),
            overflow: string("overflow")
        )
    }
    
    func decodeFlexibleShadowIfPresent(forKey key: K) throws -> ShadowStyle? {
        if let shadow = try? decodeIfPresent(ShadowStyle.self, forKey: key) {
            return shadow
        }
        
        guard let string = try decodeFlexibleStringIfPresent(forKey: key) else {
            return nil
        }
        
        switch string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "soft", "sm":
            return ShadowStyle(color: "#000000", opacity: 0.14, radius: 14, x: 0, y: 8)
        case "medium", "md":
            return ShadowStyle(color: "#000000", opacity: 0.18, radius: 22, x: 0, y: 14)
        case "large", "lg", "floating":
            return ShadowStyle(color: "#000000", opacity: 0.22, radius: 32, x: 0, y: 22)
        default:
            return nil
        }
    }
    
    func decodeFlexibleUUIDIfPresent(forKey key: K) throws -> UUID? {
        if let uuid = try? decodeIfPresent(UUID.self, forKey: key) {
            return uuid
        }
        
        guard let string = try? decodeIfPresent(String.self, forKey: key) else {
            return nil
        }
        
        let trimmed = string.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        if trimmed.isEmpty || trimmed.lowercased() == "null" {
            return nil
        }
        
        guard let uuid = UUID(uuidString: trimmed) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Expected UUID string for \(key.stringValue), got \(string)"
            )
        }
        
        return uuid
    }
    
    func decodeFlexibleUUIDReferenceIfPresent(forKey key: K) throws -> (uuid: UUID?, reference: String?) {
        if let uuid = try? decodeIfPresent(UUID.self, forKey: key) {
            return (uuid, nil)
        }
        
        guard let string = try? decodeIfPresent(String.self, forKey: key) else {
            return (nil, nil)
        }
        
        let trimmed = string.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        if trimmed.isEmpty || trimmed.lowercased() == "null" {
            return (nil, nil)
        }
        
        if let uuid = UUID(uuidString: trimmed) {
            return (uuid, nil)
        }
        
        return (nil, trimmed)
    }
    
    func decodeFlexibleCGFloatIfPresent(forKey key: K) throws -> CGFloat? {
        if let value = try? decodeIfPresent(CGFloat.self, forKey: key) {
            return value
        }
        
        if let value = try? decodeIfPresent(Double.self, forKey: key) {
            return CGFloat(value)
        }
        
        guard let string = try? decodeIfPresent(String.self, forKey: key) else {
            return nil
        }
        
        let trimmed = string.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        if trimmed.isEmpty || trimmed.lowercased() == "null" {
            return nil
        }
        
        if ["auto", "fit", "hug", "fill"].contains(trimmed.lowercased()) {
            return nil
        }
        
        return CGFloat.parseFlexibleNumber(trimmed)
    }
    
    func decodeFlexibleDoubleIfPresent(forKey key: K) throws -> Double? {
        if let value = try? decodeIfPresent(Double.self, forKey: key) {
            return value
        }
        
        guard let string = try? decodeIfPresent(String.self, forKey: key) else {
            return nil
        }
        
        let trimmed = string.trimmingCharacters(in: CharacterSet.whitespacesAndNewlines)
        
        if trimmed.isEmpty || trimmed.lowercased() == "null" {
            return nil
        }
        
        if ["auto", "fit", "hug", "fill"].contains(trimmed.lowercased()) {
            return nil
        }
        
        return Double(trimmed)
    }
    
    func decodeFlexibleBoolIfPresent(forKey key: K) throws -> Bool? {
        if let value = try? decodeIfPresent(Bool.self, forKey: key) {
            return value
        }
        
        guard let string = try? decodeIfPresent(String.self, forKey: key) else {
            return nil
        }
        
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        
        if ["true", "yes", "1", "on"].contains(trimmed) {
            return true
        }
        
        if ["false", "no", "0", "off"].contains(trimmed) {
            return false
        }
        
        return nil
    }
}
