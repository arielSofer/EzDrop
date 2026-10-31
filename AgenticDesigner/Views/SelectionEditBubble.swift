//
//  SelectionEditBubble.swift
//  AgenticDesigner
//
//  The "click anything, say anything" loop: when a node is selected, a
//  floating pill appears over the canvas — type an instruction and the agent
//  edits ONLY that element (selection-scoped intent, fast path: no image
//  generation, no critic). Checkpointed, so every edit is one click to undo.
//

import SwiftUI

struct SelectionEditBubble: View {
    @ObservedObject var viewModel: ProjectViewModel
    @State private var prompt: String = ""
    @State private var isRunning = false
    @State private var errorMessage: String?
    @StateObject private var pipeline = AgentPipelineCoordinator()

    var body: some View {
        if let nodeId = viewModel.selectedNodeId, !isRunningDisabledContext {
            VStack(spacing: 6) {
                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                        .frame(maxWidth: 380)
                }
                HStack(spacing: 8) {
                    Image(systemName: "sparkles")
                        .foregroundStyle(.tint)
                    TextField("Edit this element — e.g. \"coral gradient, bolder title\"", text: $prompt)
                        .textFieldStyle(.plain)
                        .frame(width: 300)
                        .onSubmit { run(nodeId: nodeId) }
                        .disabled(isRunning)
                    if isRunning {
                        ProgressView().controlSize(.small)
                    } else {
                        Button {
                            run(nodeId: nodeId)
                        } label: {
                            Image(systemName: "arrow.up.circle.fill")
                                .font(.title3)
                        }
                        .buttonStyle(.plain)
                        .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(.regularMaterial, in: Capsule())
                .overlay(Capsule().stroke(Color(nsColor: .separatorColor), lineWidth: 0.5))
                .shadow(color: .black.opacity(0.18), radius: 12, y: 4)
            }
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private var isRunningDisabledContext: Bool {
        // Hide while a full pipeline run owns the canvas.
        pipeline.isRunning && !isRunning
    }

    private func run(nodeId: UUID) {
        let instruction = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !instruction.isEmpty, !isRunning else { return }
        isRunning = true
        errorMessage = nil
        Task { @MainActor in
            CheckpointStore.save(viewModel.project, label: "before edit: \(instruction.prefix(40))")
            viewModel.selectedNodeId = nodeId
            let service = DesignAgentService(viewModel: viewModel, pipeline: pipeline)
            do {
                _ = try await service.runFullPipeline(prompt: instruction, quickEdit: true)
                prompt = ""
            } catch {
                errorMessage = error.localizedDescription
            }
            isRunning = false
        }
    }
}
