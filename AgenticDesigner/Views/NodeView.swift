//
//  NodeView.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//
import SwiftUI

extension DesignNode {
    // Arch/tombstone silhouette (archTopRadius set): rounds only the top
    // corners, by that radius, leaving the bottom flat. Otherwise the usual
    // uniform-corner rectangle. Shared by every place that draws or clips to
    // this node's outline — fill, stroke, and child-content clipping — so
    // they can never fall out of sync with each other.
    var outlineShape: AnyShape {
        if let archTopRadius = style.archTopRadius {
            return AnyShape(UnevenRoundedRectangle(
                topLeadingRadius: archTopRadius,
                bottomLeadingRadius: style.cornerRadius,
                bottomTrailingRadius: style.cornerRadius,
                topTrailingRadius: archTopRadius
            ))
        }
        return AnyShape(RoundedRectangle(cornerRadius: style.cornerRadius))
    }
}

struct NodeView: View {
    let node: DesignNode
    let isSelected: Bool
    // Offscreen snapshots can't rasterize SpriteView (Metal) — they get the
    // static poster instead of the live game.
    @Environment(\.isCanvasSnapshot) private var isCanvasSnapshot
    // Set by the interactive preview: routes game events into the simulator.
    @Environment(\.gameEventHandler) private var gameEventHandler
    // Set by the interactive preview: live variable bindings for controls.
    @Environment(\.previewVariableBinding) private var previewVariableBinding

    // ערכי padding עם defaults
    private var padTop:    CGFloat { node.style.paddingTop    ?? 0 }
    private var padBottom: CGFloat { node.style.paddingBottom ?? 0 }
    private var padLeft:   CGFloat { node.style.paddingLeft   ?? 0 }
    private var padRight:  CGFloat { node.style.paddingRight  ?? 0 }

    @ViewBuilder
    private var backgroundShape: some View {
        if let gradient = node.style.gradient, !gradient.colors.isEmpty {
            let colors = gradient.colors.map { Color(hex: $0) }
            if gradient.type == "radial" {
                node.outlineShape
                    .fill(RadialGradient(gradient: Gradient(colors: colors), center: .center, startRadius: 0, endRadius: max(node.width, node.height) / 2))
            } else {
                let angle = Angle(degrees: Double(gradient.angle ?? 180))
                // Approximate start/end points based on angle
                let rad = angle.radians
                let start = UnitPoint(x: 0.5 - cos(rad)/2, y: 0.5 - sin(rad)/2)
                let end = UnitPoint(x: 0.5 + cos(rad)/2, y: 0.5 + sin(rad)/2)
                node.outlineShape
                    .fill(LinearGradient(gradient: Gradient(colors: colors), startPoint: start, endPoint: end))
            }
        } else {
            node.outlineShape
                .fill(Color(hex: node.style.fill))
        }
    }

    @ViewBuilder
    private var strokeOverlay: some View {
        if let strokeHex = node.style.stroke {
            node.outlineShape
                .stroke(Color(hex: strokeHex), lineWidth: node.style.strokeWidth ?? 1)
        }
    }
    
    private var textAlignment: Alignment {
        switch node.style.textAlign {
        case "center": return .top
        case "right": return .topTrailing
        default: return .topLeading
        }
    }
    
    private var multilineAlignment: TextAlignment {
        switch node.style.textAlign {
        case "center": return .center
        case "right": return .trailing
        default: return .leading
        }
    }
    
    @ViewBuilder
    private func configuredText(_ content: String) -> some View {
        Text(content)
            .font(getFont(size: node.style.fontSize ?? 16, weight: node.style.fontWeight, family: node.style.fontFamily))
            .foregroundColor(Color(hex: node.style.textColor ?? node.style.fill))
            .tracking(node.style.letterSpacing ?? 0)
            .lineSpacing((node.style.lineHeight ?? (node.style.fontSize ?? 16) * 1.2) - (node.style.fontSize ?? 16))
            .multilineTextAlignment(multilineAlignment)
            .lineLimit(textLineLimit)
            .fixedSize(horizontal: false, vertical: node.textBehavior?.autoHeight == true)
    }
    
    var body: some View {
        ZStack {
            if let picker = node.timePicker {
                // Native time picker: two hour/minute wheels bound to logic
                // variables. Live in the preview; a static mock on the canvas.
                if let bind = previewVariableBinding {
                    let hour = bind(picker.hourVariable, "6")
                    let minute = bind(picker.minuteVariable, "30")
                    HStack(spacing: 2) {
                        Picker("", selection: Binding(
                            get: { Int(hour.wrappedValue) ?? 6 },
                            set: { hour.wrappedValue = String($0) })) {
                            ForEach(0..<24, id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                        }
                        .labelsHidden()
                        Text(":").font(.headline)
                        Picker("", selection: Binding(
                            get: { Int(minute.wrappedValue) ?? 30 },
                            set: { minute.wrappedValue = String(format: "%02d", $0) })) {
                            ForEach(0..<60, id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
                        }
                        .labelsHidden()
                    }
                    .frame(width: node.width, height: node.height)
                    .background(backgroundShape)
                } else {
                    backgroundShape
                        .overlay(
                            Text("06 : 30")
                                .font(.system(size: min(node.height * 0.5, 28), weight: .semibold, design: .rounded))
                                .foregroundColor(Color(hex: node.style.textColor ?? "#FFFFFF"))
                        )
                        .overlay(alignment: .bottomTrailing) {
                            Label("time picker", systemImage: "clock")
                                .font(.caption2)
                                .padding(3)
                                .foregroundStyle(.secondary)
                        }
                }
            } else if node.gameScene != nil, let gameScene = node.effectiveGameSpec {
                // A live, playable game surface — intercepts before the normal
                // type switch so any node (a plain Frame) can host a game.
                if isCanvasSnapshot {
                    GameScenePosterView(spec: gameScene, nodeWidth: node.width, nodeHeight: node.height)
                        .clipShape(RoundedRectangle(cornerRadius: node.style.cornerRadius))
                } else if isSelected && node.hasEntityChildren && gameEventHandler == nil {
                    // EDIT MODE: the game frame is selected on the canvas —
                    // show the scene background and let the entity CHILD NODES
                    // render on top as normal, draggable design nodes.
                    // Deselect to play the live scene with the edits applied.
                    ZStack(alignment: .topLeading) {
                        if gameScene.backgroundGradient.count >= 2 {
                            LinearGradient(colors: gameScene.backgroundGradient.map { Color(hex: $0) },
                                           startPoint: .top, endPoint: .bottom)
                        } else {
                            Color(hex: gameScene.backgroundColor)
                        }
                        Label("edit mode — drag entities · click away to play", systemImage: "slider.horizontal.3")
                            .font(.caption2)
                            .padding(4)
                            .background(Capsule().fill(.black.opacity(0.4)))
                            .foregroundStyle(.white)
                            .padding(6)
                    }
                    .frame(width: node.width, height: node.height)
                    .clipShape(RoundedRectangle(cornerRadius: node.style.cornerRadius))
                } else {
                    // SpriteView eats every click, which made the game node
                    // UNSELECTABLE on the design canvas (no way to reach its
                    // inspector). Gate input: on the canvas the first click
                    // selects (game ignores it), the SELECTED game plays. In
                    // the interactive preview (gameEventHandler set) it is
                    // always playable.
                    AgentGameView(spec: gameScene, onEvent: gameEventHandler)
                        .frame(width: node.width, height: node.height)
                        .clipShape(RoundedRectangle(cornerRadius: node.style.cornerRadius))
                        .allowsHitTesting(isSelected || gameEventHandler != nil)
                        .overlay(alignment: .topTrailing) {
                            if !isSelected && gameEventHandler == nil {
                                Label("select to play", systemImage: "cursorarrow.click")
                                    .font(.caption2)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 3)
                                    .background(Capsule().fill(.black.opacity(0.35)))
                                    .foregroundStyle(.white)
                                    .padding(6)
                                    .allowsHitTesting(false)
                            }
                        }
                }
            } else {
            switch node.type {

            case .Frame, .Rectangle:
                backgroundShape
                    .overlay(strokeOverlay)
                
            case .Text:
                configuredText(node.text ?? "")
                    .padding(.top,      padTop)
                    .padding(.bottom,   padBottom)
                    .padding(.leading,  padLeft)
                    .padding(.trailing, padRight)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: textAlignment)
                
            case .Button:
                backgroundShape
                    .overlay(
                        configuredText(node.text ?? "Button")
                            .foregroundColor(Color(hex: node.style.textColor ?? "#FFFFFF"))
                            .padding(.top,      padTop)
                            .padding(.bottom,   padBottom)
                            .padding(.leading,  padLeft)
                            .padding(.trailing, padRight)
                    )
                    .overlay(strokeOverlay)
                
            case .Input:
                backgroundShape
                    .overlay(strokeOverlay)
                    .overlay(
                        RoundedRectangle(cornerRadius: node.style.cornerRadius)
                            .stroke(Color(hex: node.style.stroke ?? "#CBD5E1"), lineWidth: node.style.strokeWidth ?? 1)
                    )
                    .overlay(
                        HStack {
                            configuredText(node.text ?? "Input")
                                .foregroundColor(Color(hex: node.style.textColor ?? "#94A3B8"))
                                .lineLimit(1)
                            
                            Spacer(minLength: 0)
                        }
                        .padding(.leading,  max(14, padLeft))
                        .padding(.trailing, max(14, padRight))
                        .padding(.top,      padTop)
                        .padding(.bottom,   padBottom)
                    )
                
            case .Image:
                imageNodeView
                
            case .Icon:
                iconNodeView
            }
            }
        }
        .frame(width: node.width, height: node.height)
        .opacity(node.style.opacity)
        .blur(radius: node.style.blur ?? 0)
        .shadow(
            color: Color(hex: node.style.shadow?.color ?? "#000000")
                .opacity(node.style.shadow?.opacity ?? 0),
            radius: node.style.shadow?.radius ?? 0,
            x: node.style.shadow?.x ?? 0,
            y: node.style.shadow?.y ?? 0
        )
        .overlay {
            if let overlayColor = node.style.overlayColor,
               let overlayOpacity = node.style.overlayOpacity,
               overlayOpacity > 0 {
                RoundedRectangle(cornerRadius: node.style.cornerRadius)
                    .fill(Color(hex: overlayColor).opacity(overlayOpacity))
                    .allowsHitTesting(false)
            }
        }
        .transaction { transaction in
            // מונע אנימציות לא רצויות בזמן Drag/Resize
            transaction.animation = nil
        }
    }
    
    private var textLineLimit: Int? {
        if let maxLines = node.textBehavior?.maxLines {
            return max(1, maxLines)
        }
        
        if node.textBehavior?.wrap == true || node.textBehavior?.truncate == false {
            return nil
        }
        
        return nil
    }
    
    // MARK: – Image node
    @ViewBuilder
    private var imageNodeView: some View {
        let imageName = node.imageSource ?? node.imageName ?? ""
        let bg = backgroundShape
        let shouldFit = node.contentMode == .fit
        
        if imageName.hasPrefix("http://") || imageName.hasPrefix("https://") {
            AsyncImage(url: URL(string: imageName)) { phase in
                switch phase {
                case .success(let image):
                    image.resizable()
                        .aspectRatio(contentMode: shouldFit ? .fit : .fill)
                        .frame(width: node.width, height: node.height)
                        .clipShape(RoundedRectangle(cornerRadius: node.style.cornerRadius))
                case .failure:
                    bg.overlay(
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundColor(.orange)
                    )
                case .empty:
                    bg.overlay(ProgressView())
                @unknown default:
                    bg
                }
            }
        } else if !imageName.isEmpty, let assetImage = NSImage(named: imageName) {
            Image(nsImage: assetImage)
                .resizable()
                .aspectRatio(contentMode: shouldFit ? .fit : .fill)
                .frame(width: node.width, height: node.height)
                .clipShape(RoundedRectangle(cornerRadius: node.style.cornerRadius))
        } else if !imageName.isEmpty, let nsImage = NSImage(contentsOfFile: imageName) {
            Image(nsImage: nsImage)
                .resizable()
                .aspectRatio(contentMode: shouldFit ? .fit : .fill)
                .frame(width: node.width, height: node.height)
                .clipShape(RoundedRectangle(cornerRadius: node.style.cornerRadius))
        } else {
            semanticImagePlaceholder(for: imageName)
        }
    }
    
    @ViewBuilder
    private func semanticImagePlaceholder(for imageName: String) -> some View {
        let lower = imageName.lowercased()
        let icon: String = {
            if lower.contains("music") || lower.contains("album") || lower.contains("audio") || lower.contains("headphone") {
                return "music.note"
            }
            if lower.contains("travel") || lower.contains("destination") || lower.contains("landscape") {
                return "sparkles"
            }
            if lower.contains("person") || lower.contains("avatar") || lower.contains("portrait") {
                return "person.crop.circle.fill"
            }
            if lower.contains("food") || lower.contains("drink") || lower.contains("beverage") {
                return "cup.and.saucer.fill"
            }
            return "photo.fill"
        }()
        let colors: [Color] = lower.contains("music") || lower.contains("audio")
            ? [Color(hex: "#7C3AED"), Color(hex: "#06B6D4"), Color(hex: "#0B1020")]
            : [Color(hex: node.style.fill), Color(hex: "#111827")]
        
        RoundedRectangle(cornerRadius: node.style.cornerRadius)
            .fill(
                LinearGradient(
                    gradient: Gradient(colors: colors),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                Image(systemName: icon)
                    .font(.system(size: min(node.width, node.height) * 0.26, weight: .semibold))
                    .foregroundColor(.white.opacity(0.82))
            )
    }
    
    // MARK: – Icon node
    @ViewBuilder
    private var iconNodeView: some View {
        let symbolName = node.iconName ?? "star"
        let iconColor  = Color(hex: node.style.textColor ?? node.style.fill)
        let defaultPad: CGFloat = node.style.fill == "#00000000" ? 0 : 8
        
        ZStack {
            RoundedRectangle(cornerRadius: node.style.cornerRadius)
                .fill(Color(hex: node.style.fill))
            
            Image(systemName: symbolName)
                .resizable()
                .scaledToFit()
                .foregroundColor(iconColor)
                .padding(EdgeInsets(
                    top:      node.style.paddingTop != nil ? padTop : defaultPad,
                    leading:  node.style.paddingLeft != nil ? padLeft : defaultPad,
                    bottom:   node.style.paddingBottom != nil ? padBottom : defaultPad,
                    trailing: node.style.paddingRight != nil ? padRight : defaultPad
                ))
        }
    }
    
    private func getFont(size: CGFloat, weight: String?, family: String?) -> Font {
        let w: Font.Weight
        switch weight?.lowercased() {
        case "black":                w = .black
        case "heavy", "extrabold":   w = .heavy
        case "bold":                 w = .bold
        case "semibold":             w = .semibold
        case "medium":               w = .medium
        case "light":                w = .light
        default:                     w = .regular
        }
        
        if let family {
            let normalizedFamily = family
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            
            switch normalizedFamily {
            case "rounded", "systemrounded", "sf rounded", "sf pro rounded", "sfprorounded":
                return .system(size: size, weight: w, design: .rounded)
            case "serif", "editorial", "newspaper", "georgia":
                return .system(size: size, weight: w, design: .serif)
            case "monospaced", "mono", "code", "sf mono", "sfmono":
                return .system(size: size, weight: w, design: .monospaced)
            case "system", "sf pro", "sfpro":
                return .system(size: size, weight: w)
            default:
                if !normalizedFamily.isEmpty {
                    return .custom(family, size: size).weight(w)
                }
            }
        }
        
        return .system(size: size, weight: w)
    }
}
