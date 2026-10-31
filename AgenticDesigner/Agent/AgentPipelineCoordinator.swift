import Foundation
import Combine
import SwiftUI

enum PipelineState: String {
    case idle = ""
    case planning = "Planning Strategy & Design System..."
    case generating = "Generating Architecture & Components..."
    case generatingAssets = "Generating Visual Assets..."
    case reviewing = "Reviewing & Polishing..."
    case applying = "Applying to Canvas..."
}

@MainActor
class AgentPipelineCoordinator: ObservableObject {
    @Published var state: PipelineState = .idle
    @Published var errorMessage: String? = nil {
        didSet {
            if let errorMessage {
                print("🔴 AI Chat Error: \(errorMessage)")
            }
        }
    }
    @Published var isRunning = false

    func runPipeline(
        userPrompt: String,
        context: AgentContext,
        provider: OpenRouterProvider,
        generationProvider: OpenRouterProvider? = nil,
        screenshotDataURL: String? = nil,
        onComplete: @escaping ([DesignAction]) async throws -> Void
    ) async {
        self.isRunning = true
        self.errorMessage = nil
        let screenshotAttachments = screenshotDataURL.map { [$0] } ?? []

        do {
            self.state = .planning
            var strategyMessages: [OpenRouterMessage] = [
                OpenRouterMessage(role: "system", content: AgentPromptBuilder.buildStrategySystemPrompt())
            ]

            let strategyBasePrompt = AgentPromptBuilder.buildStrategyUserPrompt(
                userPrompt: userPrompt,
                context: context,
                hasScreenshot: screenshotDataURL != nil
            )

            let stage1Prompt = """
            \(strategyBasePrompt)

            PHASE 1 (STRATEGY & DESIGN SYSTEM):
            Analyze the user's request using the Product Designer methodology.
            \(stageOneInstructions(for: context))

            Do NOT output any JSON yet. Just outline your strategy clearly as text.
            """

            strategyMessages.append(OpenRouterMessage(
                role: "user",
                content: stage1Prompt,
                imageDataURLs: screenshotAttachments
            ))

            print("===== PIPELINE STAGE 1: STRATEGY (screenshot: \(screenshotDataURL != nil)) =====")
            let strategyContent = try await provider.generateRawChat(messages: strategyMessages)
            print(strategyContent)

            self.state = .generating
            let actionBasePrompt = AgentPromptBuilder.buildUserPrompt(
                userPrompt: userPrompt,
                context: context,
                hasScreenshot: screenshotDataURL != nil
            )
            var actionMessages: [OpenRouterMessage] = [
                OpenRouterMessage(role: "system", content: AgentPromptBuilder.buildSystemPrompt(context: context)),
                OpenRouterMessage(role: "user", content: actionBasePrompt, imageDataURLs: screenshotAttachments),
                OpenRouterMessage(role: "assistant", content: strategyContent)
            ]
            let stage2Prompt = """
            PHASE 2 (GENERATION & PRESENTATION):
            Execute your approved strategy above EXACTLY — same concept, palette direction, screens, and image plan.
            Follow the intent, screen-contract, layout, and imagery rules from the system prompt.
            Return only the final DesignAgentResponse JSON.
            """
            actionMessages.append(OpenRouterMessage(role: "user", content: stage2Prompt))

            print("===== PIPELINE STAGE 2: GENERATION (model: \((generationProvider ?? provider).model)) =====")
            let actions = try await (generationProvider ?? provider).generateActions(messages: actionMessages)

            self.state = .generatingAssets
            try await onComplete(actions)
            self.state = .idle
        } catch {
            self.errorMessage = error.localizedDescription
            self.state = .idle
        }
        self.isRunning = false
    }

    // מריץ מעבר Critic אחד — משותף לכפתור הידני וללולאה האוטומטית.
    // When a screenshot is provided the critic judges the rendered result
    // visually instead of guessing from raw coordinates.
    func runCriticPass(
        provider: OpenRouterProvider,
        context: AgentContext,
        pageNodes: [DesignNode],
        screenshotDataURL: String?
    ) async throws -> [DesignAction] {
        let systemPrompt = CriticPromptBuilder.buildSystemPrompt()
        let userPrompt = CriticPromptBuilder.buildUserPrompt(
            pageNodes: pageNodes,
            context: context,
            hasScreenshot: screenshotDataURL != nil
        )

        let messages = [
            OpenRouterMessage(role: "system", content: systemPrompt),
            OpenRouterMessage(
                role: "user",
                content: userPrompt,
                imageDataURLs: screenshotDataURL.map { [$0] } ?? []
            )
        ]

        print("===== CRITIC PASS (screenshot: \(screenshotDataURL != nil)) =====")
        return try await provider.generateActions(messages: messages)
    }

    private func stageOneInstructions(for context: AgentContext) -> String {
        switch context.requestIntent {
        case .createNewDesign:
            let instructions = """
            1. Define the App Concept and Target Audience.
            2. Propose 3 visually distinct art-direction concepts with different hierarchy, rhythm, motif, and hero treatment.
            3. Select the strongest concept and explain why it best fits the product.
            4. Choose the exact Visual Style Direction and ComponentTypes from our registry for the selected concept.
            5. Choose an image integration pattern: full-bleed hero, product cutout, masked photo card, poster/cover rail, thumbnail gallery, avatar/media cluster, or abstract background.
            6. Define typography roles: display headline, section title, metadata/body, CTA. Choose fontFamily/fontWeight roles.
            7. Define outline/contour language: strokes, pill borders, separators, circular callouts, or masked card edges.
            8. Decide whether this request should be one focused mobile screen or a full app flow. For app/full app/clone/product requests, plan 2-5 core screens such as Home, Discover/Search, Detail, Player/Cart/Chat, and Profile/Settings when relevant. PresentationShot is only for showcase composition, not the only way to create multiple screens.
            9. Decide which generated visual assets are needed. Use them for dominant hero/artwork/product/background images and small supporting thumbnails/icons only when they improve the UI.
            """
            return instructions
        case .editSelection:
            return """
            1. Identify the selected node and the user's requested change.
            2. Decide which existing child nodes need alignment, distribution, resizing, or style updates.
            3. Use the selected node bounds, padding, and sibling positions from context.
            4. Do not plan a new screen, presentation shot, frame, or component.
            """
        case .improveExistingCanvas:
            return """
            1. Identify the existing screen structure and visible layout problems.
            2. Prioritize layoutIssues from context, then hierarchy, spacing, contrast, and alignment.
            3. Plan updates to existing nodes before considering any local child additions.
            4. Do not plan a new root screen or presentation shot.
            """
        }
    }
}
