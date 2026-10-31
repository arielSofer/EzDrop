//
//  DesignAgentService.swift
//  AgenticDesigner
//
//  The full design-agent pipeline (strategy → generation → apply → AI image
//  assets → critic polish) as a reusable service. The Agent panel and the
//  embedded MCP server both run designs through here, so an external agent
//  connected over MCP gets exactly the same pipeline as the in-app button —
//  including real image generation and the critic pass.
//
//  Settings (API key, models, auto-critic) are read from the same
//  UserDefaults keys the Agent panel's @AppStorage fields persist to.
//

import Foundation
import CoreGraphics

struct DesignAgentServiceError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

@MainActor
final class DesignAgentService {

    struct Settings {
        var apiKey: String
        var model: String
        var generationModel: String
        var autoCriticEnabled: Bool

        static func current() -> Settings {
            let defaults = UserDefaults.standard
            return Settings(
                apiKey: defaults.string(forKey: "openRouterAPIKey") ?? "",
                model: defaults.string(forKey: "openRouterModel") ?? OpenRouterConfiguration.model,
                generationModel: defaults.string(forKey: "openRouterGenerationModel") ?? "google/gemma-4-31b-it:free",
                autoCriticEnabled: defaults.object(forKey: "autoCriticEnabled") as? Bool ?? true
            )
        }

        // Same resolution the Agent panel uses: explicit key, else the
        // OPENROUTER_API_KEY environment, else "local" for local models.
        func resolvedAPIKey() -> String? {
            OpenRouterConfiguration.apiKey(userProvidedKey: apiKey)
                ?? (model.hasPrefix("local/") ? "local" : nil)
        }
    }

    struct RunSummary {
        var appliedActionCount = 0
        var createdReferences: [String: UUID] = [:]
        var requestedImageCount = 0
        var generatedImageCount = 0
        var criticRan = false
    }

    private struct GeneratedImageRequest {
        let nodeId: UUID
        let prompt: String
        let assetKind: String?
        let aspectRatio: String?
        let resolution: String?
        let size: String?
    }

    let viewModel: ProjectViewModel
    let pipeline: AgentPipelineCoordinator

    init(viewModel: ProjectViewModel, pipeline: AgentPipelineCoordinator) {
        self.viewModel = viewModel
        self.pipeline = pipeline
    }

    // MARK: - Full pipeline

    // Runs the complete design flow for a text brief. `onApplied` fires right
    // after actions land on the canvas, before the slower image/critic stages.
    // `quickEdit` skips image generation (the critic already skips selection
    // edits) — the fast path for "make this element X" bubble edits.
    func runFullPipeline(prompt userPromptText: String, quickEdit: Bool = false, onApplied: (() -> Void)? = nil) async throws -> RunSummary {
        let settings = Settings.current()

        guard let apiKey = settings.resolvedAPIKey() else {
            throw AIProviderError.missingAPIKey
        }
        // A cloud model with no real key (the "z" placeholder is < 20 chars)
        // otherwise fails with a cryptic 401 — fail clearly instead.
        if !settings.model.hasPrefix("local/"), apiKey.count < 20 {
            throw AIProviderError.needsCloudKey(model: settings.model)
        }

        // Every generation is reversible: snapshot the project before the
        // agent touches it (History menu / restore_checkpoint).
        if !viewModel.project.pages.allSatisfy({ $0.nodes.isEmpty }) {
            CheckpointStore.save(viewModel.project, label: "before: \(userPromptText.prefix(40))")
        }

        let context = viewModel.makeAgentContext(userPrompt: userPromptText)

        // JSON mode keeps the output parseable, so creation can run hot for
        // more varied art direction; edits stay conservative.
        let temperature = context.requestIntent == .createNewDesign ? 0.75 : 0.18
        let provider = OpenRouterProvider(apiKey: apiKey, model: settings.model, temperature: temperature)
        let generationProvider = settings.generationModel.isEmpty ? nil : OpenRouterProvider(
            apiKey: apiKey,
            model: settings.generationModel,
            temperature: temperature
        )

        // Attach the canvas screenshot only when editing existing UI. On a
        // createNewDesign the current canvas is being REPLACED, so its
        // screenshot teaches the model nothing and just burns image tokens
        // (a login shell is worse than useless — it can bias the new design).
        let pageNodes = viewModel.project.pages[viewModel.currentPageIndex].nodes
        // A single-element edit renders only the screen being edited, not the
        // whole multi-screen canvas — that base64 shot was the biggest token
        // cost (tens of thousands of tokens) for a one-element tweak.
        let screenshotNodes: [DesignNode]
        if context.requestIntent == .editSelection, let sel = viewModel.selectedNodeId,
           let screen = viewModel.rootScreen(containing: sel) {
            screenshotNodes = [screen]
        } else {
            screenshotNodes = pageNodes
        }
        let canvasScreenshot = (screenshotNodes.isEmpty || context.requestIntent == .createNewDesign)
            ? nil
            : CanvasSnapshotRenderer.jpegDataURL(for: screenshotNodes)

        var summary = RunSummary()

        await pipeline.runPipeline(
            userPrompt: userPromptText,
            context: context,
            provider: provider,
            generationProvider: generationProvider,
            screenshotDataURL: canvasScreenshot,
            onComplete: { [self] actions in
                let preparedActions = Self.ensuringImageReferences(
                    in: Self.synthesizingPromptsForPlaceholderImages(
                        in: Self.addingRequiredGeneratedImageIfNeeded(
                            to: actions,
                            userPrompt: userPromptText,
                            context: context
                        ),
                        userPrompt: userPromptText,
                        context: context
                    )
                )

                // Apply immediately with placeholders — the design must never
                // be lost because a single image request failed.
                pipeline.state = .applying
                let referenceMap = viewModel.applyDesignActions(preparedActions)
                summary.appliedActionCount = preparedActions.count
                summary.createdReferences = referenceMap
                onApplied?()

                if !quickEdit {
                    pipeline.state = .generatingAssets
                    let imageOutcome = await Self.generateAndPatchImages(
                        for: preparedActions,
                        referenceMap: referenceMap,
                        viewModel: viewModel,
                        provider: provider
                    )
                    summary.requestedImageCount = imageOutcome.requested
                    summary.generatedImageCount = imageOutcome.generated
                }

                if settings.autoCriticEnabled, context.requestIntent != .editSelection {
                    summary.criticRan = await runAutoCritic(apiKey: apiKey, model: settings.model)
                }
            }
        )

        if let errorMessage = pipeline.errorMessage {
            throw DesignAgentServiceError(errorMessage)
        }

        return summary
    }

    // מריץ Critic אוטומטי אחרי יצירה — עם צילום מסך של הקנבס כדי שהמודל
    // ישפוט את התוצאה הוויזואלית האמיתית. כשל כאן אינו מפיל את העיצוב.
    private func runAutoCritic(apiKey: String, model: String) async -> Bool {
        pipeline.state = .reviewing

        let pageNodes = viewModel.project.pages[viewModel.currentPageIndex].nodes
        let screenshot = CanvasSnapshotRenderer.jpegDataURL(for: pageNodes)
        let criticContext = viewModel.makeAgentContext(userPrompt: "Review and fix the current design.")
        let criticProvider = OpenRouterProvider(apiKey: apiKey, model: model, temperature: 0.18)

        do {
            let fixes = try await pipeline.runCriticPass(
                provider: criticProvider,
                context: criticContext,
                pageNodes: pageNodes,
                screenshotDataURL: screenshot
            )
            viewModel.applyDesignActions(fixes)
            return true
        } catch {
            print("⚠️ Auto-critic pass failed (design kept as generated): \(error.localizedDescription)")
            return false
        }
    }

    // MARK: - Image asset generation

    // מייצר את כל התמונות במקביל ומחליף כל placeholder ברגע שהתמונה מוכנה.
    // A single failed image keeps its placeholder instead of killing the design.
    @discardableResult
    static func generateAndPatchImages(
        for actions: [DesignAction],
        referenceMap: [String: UUID],
        viewModel: ProjectViewModel,
        provider: OpenRouterProvider
    ) async -> (requested: Int, generated: Int) {
        var requests: [GeneratedImageRequest] = []

        for action in actions {
            guard action.type == .createImage,
                  let imagePrompt = generatedAssetPrompt(for: action),
                  let reference = action.nodeReference,
                  let nodeId = referenceMap[reference]
            else { continue }

            // The node's real dimensions drive the requested ratio and pixel
            // size so the asset lands in its container without wasteful
            // crops (fill) or letterboxing (fit).
            requests.append(GeneratedImageRequest(
                nodeId: nodeId,
                prompt: imagePrompt,
                assetKind: action.assetKind,
                aspectRatio: fittedAspectRatio(for: action) ?? action.aspectRatio,
                resolution: action.resolution,
                size: action.size ?? fittedPixelSize(for: action)
            ))
        }

        guard !requests.isEmpty else { return (0, 0) }

        var generatedCount = 0

        await withTaskGroup(of: (UUID, String?).self) { group in
            for request in requests {
                group.addTask {
                    do {
                        let path = try await provider.generateImageAsset(
                            prompt: request.prompt,
                            assetKind: request.assetKind,
                            aspectRatio: request.aspectRatio,
                            resolution: request.resolution,
                            size: request.size
                        )
                        return (request.nodeId, path)
                    } catch {
                        // Some providers reject explicit sizes — retry once on
                        // aspect ratio alone before giving up on this asset.
                        if request.size != nil {
                            do {
                                let path = try await provider.generateImageAsset(
                                    prompt: request.prompt,
                                    assetKind: request.assetKind,
                                    aspectRatio: request.aspectRatio,
                                    resolution: nil,
                                    size: nil
                                )
                                return (request.nodeId, path)
                            } catch {
                                print("⚠️ Image generation failed for node \(request.nodeId): \(error.localizedDescription)")
                                return (request.nodeId, nil)
                            }
                        }
                        print("⚠️ Image generation failed for node \(request.nodeId): \(error.localizedDescription)")
                        return (request.nodeId, nil)
                    }
                }
            }

            for await (nodeId, path) in group {
                if let path {
                    viewModel.setGeneratedImage(nodeId: nodeId, imagePath: path)
                    generatedCount += 1
                }
            }
        }

        return (requests.count, generatedCount)
    }

    // MARK: - Action preparation

    static func addingRequiredGeneratedImageIfNeeded(
        to actions: [DesignAction],
        userPrompt: String,
        context: AgentContext
    ) -> [DesignAction] {
        guard context.requestIntent == .createNewDesign,
              !actions.contains(where: { $0.type == .createImage && generatedAssetPrompt(for: $0) != nil })
        else {
            return actions
        }

        let rootReference = actions.first(where: { $0.type == .createFrame })?.nodeReference
        let imageAction = DesignAction(
            type: .createImage,
            parentReference: rootReference,
            name: "Generated Hero Image",
            x: 24,
            y: 132,
            width: 342,
            height: 220,
            fill: "#E5E7EB",
            cornerRadius: 28,
            clipContent: true,
            zIndex: -1,
            imagePrompt: fallbackImagePrompt(userPrompt: userPrompt, context: context),
            assetKind: "hero",
            aspectRatio: "16:9",
            contentMode: .fill
        )

        guard let firstFrameIndex = actions.firstIndex(where: { $0.type == .createFrame }) else {
            return [imageAction] + actions
        }

        var updatedActions = actions
        updatedActions.insert(imageAction, at: actions.index(after: firstFrameIndex))
        return updatedActions
    }

    // Placeholder tokens like "running_trail" render as gray photo boxes.
    // For new designs, turn every prompt-less image into a real generated
    // asset by synthesizing a brief from its name and the app domain.
    static func synthesizingPromptsForPlaceholderImages(
        in actions: [DesignAction],
        userPrompt: String,
        context: AgentContext
    ) -> [DesignAction] {
        guard context.requestIntent == .createNewDesign else { return actions }

        var updatedActions = actions

        for index in updatedActions.indices {
            let action = updatedActions[index]
            guard action.type == .createImage,
                  generatedAssetPrompt(for: action) == nil
            else { continue }

            let source = (action.imageSource ?? action.imageName ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let isPlaceholderToken = source.isEmpty ||
                (!source.contains("/") && !source.lowercased().hasPrefix("http") && source.count < 48)

            guard isPlaceholderToken else { continue }

            let subjectHint = [action.name, source.replacingOccurrences(of: "_", with: " ")]
                .compactMap { $0 }
                .filter { !$0.isEmpty }
                .joined(separator: ", ")

            updatedActions[index].imagePrompt = """
            {
              "subject": "\(subjectHint.replacingOccurrences(of: "\"", with: "\\\"")) — supporting visual for: \(userPrompt.replacingOccurrences(of: "\"", with: "\\\""))",
              "appCategory": "\(context.appCategory.rawValue)",
              "composition": "one clear subject with calm negative space, sized for its card in a mobile app screen",
              "style": "premium editorial product design image, modern, polished, not a UI screenshot",
              "lighting": "soft controlled lighting, subtle depth",
              "palette": "cohesive with a modern app UI, tasteful, high contrast",
              "mood": "professional, distinctive",
              "constraints": ["no readable text", "no app interface", "no buttons", "no phone mockup", "no watermarks"],
              "negativePrompt": "text, letters, numbers, watermark, app screenshot, phone mockup, buttons, clutter, low quality"
            }
            """
        }

        return updatedActions
    }

    // Every generated-image action needs a nodeReference so the created node
    // can be found and patched once its asset arrives.
    static func ensuringImageReferences(in actions: [DesignAction]) -> [DesignAction] {
        var updatedActions = actions

        for index in updatedActions.indices {
            guard updatedActions[index].type == .createImage,
                  generatedAssetPrompt(for: updatedActions[index]) != nil,
                  updatedActions[index].nodeReference == nil
            else { continue }

            updatedActions[index].nodeReference = "generatedImage\(index)"
        }

        return updatedActions
    }

    static func generatedAssetPrompt(for action: DesignAction) -> String? {
        if let imagePrompt = action.imagePrompt?.trimmingCharacters(in: .whitespacesAndNewlines),
           !imagePrompt.isEmpty {
            return imagePrompt
        }

        let source = action.imageSource ?? action.imageName ?? ""
        let trimmedSource = source.trimmingCharacters(in: .whitespacesAndNewlines)

        guard trimmedSource.lowercased().hasPrefix("generate:") else {
            return nil
        }

        let prompt = String(trimmedSource.dropFirst("generate:".count))
            .trimmingCharacters(in: .whitespacesAndNewlines)

        return prompt.isEmpty ? nil : prompt
    }

    private static func fallbackImagePrompt(userPrompt: String, context: AgentContext) -> String {
        """
        {
          "subject": "premium visual hero artwork for \(userPrompt.replacingOccurrences(of: "\"", with: "\\\""))",
          "appCategory": "\(context.appCategory.rawValue)",
          "composition": "one strong cinematic subject with clean negative space, designed to sit inside a rounded mobile hero card",
          "style": "premium editorial product design image, modern, polished, not a UI screenshot",
          "lighting": "soft studio lighting, controlled highlights, subtle depth",
          "palette": "cohesive, tasteful, high-contrast enough for app UI, no muddy dark-on-dark colors",
          "mood": "professional, distinctive, aspirational",
          "uiUsage": "hero image inside a 390x844 mobile app screen",
          "constraints": ["no readable text", "no app interface", "no buttons", "no phone mockup", "no watermarks"],
          "negativePrompt": "text, letters, numbers, watermark, app screenshot, phone mockup, buttons, input fields, clutter, distorted objects, low quality"
        }
        """
    }

    // Snaps the node's width:height to the nearest ratio image models accept,
    // so the generated asset shares the container's proportions.
    private static func fittedAspectRatio(for action: DesignAction) -> String? {
        guard let width = action.width,
              let height = action.height,
              width > 0,
              height > 0
        else { return nil }

        let ratio = width / height
        let supported: [(name: String, value: CGFloat)] = [
            ("21:9", 21.0 / 9.0),
            ("16:9", 16.0 / 9.0),
            ("3:2", 3.0 / 2.0),
            ("4:3", 4.0 / 3.0),
            ("1:1", 1.0),
            ("3:4", 3.0 / 4.0),
            ("2:3", 2.0 / 3.0),
            ("9:16", 9.0 / 16.0)
        ]

        return supported.min { abs($0.value - ratio) < abs($1.value - ratio) }?.name
    }

    // Concrete pixel size matched to the node: max dimension ~1536px for
    // crisp retina rendering, both sides rounded to multiples of 32.
    private static func fittedPixelSize(for action: DesignAction) -> String? {
        guard let width = action.width,
              let height = action.height,
              width > 0,
              height > 0
        else { return nil }

        let maxDimension: CGFloat = 1536
        let scale = maxDimension / max(width, height)

        func rounded(_ value: CGFloat) -> Int {
            max(256, Int((value * scale / 32).rounded()) * 32)
        }

        return "\(rounded(width))x\(rounded(height))"
    }
}
