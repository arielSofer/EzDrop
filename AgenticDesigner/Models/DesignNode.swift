//
//  DesignNode.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation
import CoreGraphics

enum NodeType: String, Codable {
    case Text
    case Frame
    case Rectangle
    case Button
    case Input
    case Image
    case Icon
}

enum ImageContentMode: String, Codable {
    case fill
    case fit
}

struct ShadowStyle: Codable {
    var color: String
    var opacity: Double
    var radius: CGFloat
    var x: CGFloat
    var y: CGFloat
}

struct EdgeConstraints: Codable {
    var top: CGFloat?
    var right: CGFloat?
    var bottom: CGFloat?
    var left: CGFloat?
    var centerX: CGFloat?
    var centerY: CGFloat?
}

struct TextBehavior: Codable {
    var wrap: Bool?
    var autoHeight: Bool?
    var maxLines: Int?
    var truncate: Bool?
    var overflow: String?
}

struct ScrollBehavior: Codable {
    /// "vertical", "horizontal", or "both".
    var axis: String
    var showsIndicators: Bool?
    /// Initial content offset used by previews/snapshots.
    var initialOffset: CGFloat?
    /// Optional spacing hint for generated repeated item layouts.
    var itemSpacing: CGFloat?
    /// Optional item count hint for recycler/list semantics.
    var itemCount: Int?
}

struct NodeStyle: Codable {
    var fill: String
    var stroke: String?
    var strokeWidth: CGFloat?
    var cornerRadius: CGFloat
    var opacity: Double
    var fontSize: CGFloat?
    var fontWeight: String?
    var fontFamily: String? = nil
    /// צבע הטקסט — לText, Button, Input, Icon
    var textColor: String?
    /// Text alignment: "left", "center", "right"
    var textAlign: String?
    /// Letter spacing in points
    var letterSpacing: CGFloat?
    /// Line height in points
    var lineHeight: CGFloat?
    /// Padding פנימי — מרווח בין גבול הNode לתוכן בפנים
    var paddingTop: CGFloat?
    var paddingRight: CGFloat?
    var paddingBottom: CGFloat?
    var paddingLeft: CGFloat?
    /// Margin חיצוני — מיושם בתוך Auto Layout containers
    var marginTop: CGFloat?
    var marginRight: CGFloat?
    var marginBottom: CGFloat?
    var marginLeft: CGFloat?
    
    // Auto Layout properties
    var layout: String?
    var spacing: CGFloat?
    var layoutAlign: String?
    
    // Visual Art Direction properties
    var shadow: ShadowStyle?
    var blur: CGFloat?
    var backgroundBlur: CGFloat?
    var overlayColor: String?
    var overlayOpacity: Double?
    
    // Gradient fill (overrides solid fill when present)
    var gradient: GradientStyle?

    // Arch/tombstone silhouette: rounds only the top-left and top-right
    // corners by this radius (typically width/2 for a full semicircle),
    // leaving the bottom corners flat per `cornerRadius`. nil keeps the
    // existing uniform-corner RoundedRectangle behavior everywhere.
    var archTopRadius: CGFloat? = nil
}

struct DesignNode: Codable, Identifiable {
    var id: UUID = UUID()
    var type: NodeType
    var name: String
    
    
    var x: CGFloat
    var y: CGFloat
    var width: CGFloat
    var height: CGFloat
    
    var text: String? = nil
    // Marks an .Input as a password field → exported as SwiftUI SecureField,
    // not a plain TextField. Optional so older documents decode unchanged.
    var isSecure: Bool? = nil
    var imageName: String? = nil  // URL או שם קובץ לImageNodes
    var imageSource: String? = nil
    var contentMode: ImageContentMode? = nil
    var iconName: String? = nil   // שם SF Symbol לIconNodes
    var style: NodeStyle
    var constraints: EdgeConstraints? = nil
    var clipContent: Bool? = nil
    var zIndex: Double? = nil
    // Set when the user drags a node by hand — the auto-layout engine then
    // leaves its position alone instead of restacking it.
    var manuallyPositioned: Bool? = nil
    var textBehavior: TextBehavior? = nil
    var scrollBehavior: ScrollBehavior? = nil
    
    var devicePresetId: String? = nil
    var supportedPlatforms: [AppPlatform]? = nil
    var logicBindings: [NodeLogicBinding]? = nil
    // Turns this node into a template: in the interactive preview it's
    // cloned once per item in `sourceVariable` (a JSON array, e.g. from
    // firestoreQuery/httpRequest+parseJSONResponse), stacked along `axis`,
    // with {{alias.field}} tokens in its text/imageSource (and its
    // children's) substituted per item. nil elsewhere — a single static
    // node, unchanged from today. The design canvas always shows just the
    // one template so it stays editable; only the live preview expands it.
    // When isScrollable, this template's direct PARENT automatically
    // becomes a scroll container along the same axis (a recycler view: one
    // cell template + a data source + a direction), unless the parent
    // already has its own explicit scrollBehavior set.
    var repeatBinding: RepeatBinding? = nil
    // Makes this node a GAME ENTITY inside its parent game frame: the node's
    // x/y/size/fill/image drive the entity's placement and look (editable on
    // the canvas like any node), while this config carries the physics and
    // behaviors. The runtime spec is composed from these children.
    var gameEntity: GameEntity? = nil
    // Turns this node into a native TIME PICKER (hour/minute wheels) bound
    // to two logic variables — live in the preview, native wheels in exports
    // (crown-scrollable on watchOS). The node stays a Frame.
    var timePicker: TimePickerBinding? = nil
    // Turns this node into a live 2D game surface. When set, the node renders a
    // playable SpriteKit scene (AgentGameView) instead of its normal type view,
    // both on the design canvas and in exported apps. The node's type stays a
    // plain Frame so every existing NodeType switch keeps working unchanged.
    var gameScene: GameSceneSpec? = nil
    var children: [DesignNode] = []
}

struct RepeatBinding: Codable, Equatable {
    var sourceVariable: String
    var itemAlias: String = "item"
    // Safety cap on how many clones the preview will ever render.
    var maxItems: Int? = nil
    var axis: RepeatAxis = .vertical
    var isScrollable: Bool = true
    // When set, only items whose values contain this variable's text
    // (case-insensitive) are shown — a live, reactive search filter. Empty
    // filter shows everything.
    var filterVariable: String? = nil
    // A second, independent filter (e.g. a category chip) AND-combined with
    // filterVariable: an item shows only if it matches BOTH. Empty = match all.
    var categoryVariable: String? = nil
}

enum RepeatAxis: String, Codable, CaseIterable {
    case vertical
    case horizontal
}

struct NodeLogicBinding: Codable, Identifiable {
    var id: UUID = UUID()
    var kind: NodeLogicBindingKind
    var variableName: String
    var condition: LogicConditionExpression? = nil
}

enum NodeLogicBindingKind: String, Codable, CaseIterable {
    case text
    case value
    case isOn
    case visibility
    case enabled
    case selectedIndex
}

struct LogicConditionExpression: Codable {
    var left: String
    var operation: LogicConditionOperation
    var right: String?
}

enum LogicConditionOperation: String, Codable, CaseIterable {
    case equals
    case notEquals
    case greaterThan
    case lessThan
    case contains
    case isEmpty
    case isNotEmpty
    case isTrue
    case isFalse
}

struct TimePickerBinding: Codable, Equatable {
    var hourVariable: String = "alarmHour"
    var minuteVariable: String = "alarmMinute"
}
