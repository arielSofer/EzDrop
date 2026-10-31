//
//  GameScenePosterView.swift
//  AgenticDesigner
//
//  Static, ImageRenderer-safe rendering of a GameSceneSpec. SpriteView is a
//  Metal-backed platform view, and SwiftUI's offscreen ImageRenderer refuses
//  to draw those — every canvas snapshot (get_screenshot, the vision critic,
//  template thumbnails, print/PDF export) showed a yellow "prohibited"
//  placeholder where a game node sat. Snapshot paths set `isCanvasSnapshot`
//  in the environment and NodeView swaps the live SpriteView for this poster:
//  the same entities drawn as plain SwiftUI shapes/images at their design
//  positions, which ImageRenderer handles fine.
//

import SwiftUI

private struct IsCanvasSnapshotKey: EnvironmentKey {
    static let defaultValue = false
}

extension EnvironmentValues {
    /// True while rendering inside CanvasSnapshotRenderer (offscreen).
    var isCanvasSnapshot: Bool {
        get { self[IsCanvasSnapshotKey.self] }
        set { self[IsCanvasSnapshotKey.self] = newValue }
    }
}

private struct PreviewVariableBindingKey: EnvironmentKey {
    static let defaultValue: ((String, String) -> Binding<String>)? = nil
}

extension EnvironmentValues {
    /// Live variable bindings for interactive controls (time pickers) in the
    /// preview: (variableName, default) → Binding into the LogicSimulator.
    /// nil on the plain canvas — controls render statically there.
    var previewVariableBinding: ((String, String) -> Binding<String>)? {
        get { self[PreviewVariableBindingKey.self] }
        set { self[PreviewVariableBindingKey.self] = newValue }
    }
}

private struct GameEventHandlerKey: EnvironmentKey {
    static let defaultValue: ((GameEvent) -> Void)? = nil
}

extension EnvironmentValues {
    /// Game → logic bridge: the interactive preview injects a handler that
    /// routes GameEvents (score, game over, win, runFlow) into the
    /// LogicSimulator. nil on the plain design canvas — games play standalone.
    var gameEventHandler: ((GameEvent) -> Void)? {
        get { self[GameEventHandlerKey.self] }
        set { self[GameEventHandlerKey.self] = newValue }
    }
}

struct GameScenePosterView: View {
    let spec: GameSceneSpec
    let nodeWidth: CGFloat
    let nodeHeight: CGFloat

    var body: some View {
        let scaleX = nodeWidth / max(spec.width, 1)
        let scaleY = nodeHeight / max(spec.height, 1)

        ZStack(alignment: .topLeading) {
            if spec.backgroundGradient.count >= 2 {
                LinearGradient(
                    colors: spec.backgroundGradient.map { Color(hex: $0) },
                    startPoint: .top, endPoint: .bottom
                )
            } else {
                Color(hex: spec.backgroundColor)
            }

            ForEach(spec.entities.filter { !$0.isTemplate }, id: \.id) { entity in
                entityView(entity)
                    .frame(width: entity.width * scaleX, height: entity.height * scaleY)
                    .position(
                        x: (entity.x + entity.width / 2) * scaleX,
                        y: (entity.y + entity.height / 2) * scaleY
                    )
            }

            // A play badge so agents and humans read this still as a live game.
            Image(systemName: "play.circle.fill")
                .font(.system(size: min(nodeWidth, nodeHeight) * 0.14))
                .foregroundStyle(.white.opacity(0.85), .black.opacity(0.35))
                .position(x: nodeWidth / 2, y: nodeHeight / 2)
        }
        .frame(width: nodeWidth, height: nodeHeight)
    }

    @ViewBuilder
    private func entityView(_ entity: GameEntity) -> some View {
        if let sprite = entity.sprite ?? entity.frames?.first,
           let image = NSImage(contentsOfFile: sprite) {
            Image(nsImage: image)
                .resizable()
                .scaledToFit()
        } else {
            RoundedRectangle(cornerRadius: entity.circleBody ? min(entity.width, entity.height) / 2 : 4)
                .fill(Color(hex: entity.color ?? "#3B82F6"))
        }
    }
}
