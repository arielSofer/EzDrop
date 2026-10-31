//
//  AgentLoopActivityView.swift
//  AgenticDesigner
//
//  Live view of a running AgentToolLoop: the model-owned plan as a checklist,
//  the tool-call transcript, and mid-run controls (steer + cancel). Shared by
//  DesignChatPanel and AgentPanel.
//

import SwiftUI

/// Shows the activity of a loop the app didn't start itself — one delegated
/// through the run_agent_loop MCP tool. Observes the controller so the view
/// appears the moment an external run begins.
struct MCPDelegatedLoopMirror: View {
    @ObservedObject var controller: MCPServerController
    @Binding var steerText: String

    var body: some View {
        if let loop = controller.activeAgentLoop, loop.isRunning || !loop.transcript.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Label("Delegated agent run (via MCP)", systemImage: "antenna.radiowaves.left.and.right")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                AgentLoopActivityView(loop: loop, steerText: $steerText)
            }
        }
    }
}

struct AgentLoopActivityView: View {
    @ObservedObject var loop: AgentToolLoop
    @Binding var steerText: String
    @State private var questionText = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !loop.plan.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(loop.plan) { item in
                        HStack(spacing: 6) {
                            Image(systemName: item.status == "done"
                                  ? "checkmark.circle.fill"
                                  : item.status == "doing" ? "arrow.triangle.2.circlepath.circle.fill" : "circle")
                                .foregroundStyle(item.status == "done" ? .green
                                                 : item.status == "doing" ? .blue : .secondary)
                                .font(.caption)
                            Text(item.title)
                                .font(.caption)
                                .strikethrough(item.status == "done")
                                .foregroundStyle(item.status == "pending" ? .secondary : .primary)
                        }
                    }
                }
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.05)))
            }

            if !loop.transcript.isEmpty {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(loop.transcript) { entry in
                                HStack(alignment: .top, spacing: 6) {
                                    Image(systemName: icon(for: entry.kind))
                                        .font(.caption2)
                                        .foregroundStyle(color(for: entry.kind))
                                        .padding(.top, 2)
                                    VStack(alignment: .leading, spacing: 1) {
                                        Text(entry.title).font(.caption).fontWeight(.medium)
                                        if !entry.detail.isEmpty {
                                            Text(entry.detail)
                                                .font(.caption2)
                                                .foregroundStyle(.secondary)
                                                .lineLimit(4)
                                        }
                                    }
                                }
                                .id(entry.id)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(6)
                    }
                    .frame(minHeight: 80, maxHeight: 200)
                    .background(RoundedRectangle(cornerRadius: 8).fill(Color.primary.opacity(0.04)))
                    .onChange(of: loop.transcript.count) { _, _ in
                        if let last = loop.transcript.last {
                            withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                        }
                    }
                }
            }

            // A question from the agent blocks the run until answered — it gets
            // the loudest treatment in the panel so a waiting run is never
            // mistaken for a stuck one.
            if let question = loop.pendingQuestion {
                VStack(alignment: .leading, spacing: 8) {
                    Label(question.question, systemImage: "questionmark.bubble.fill")
                        .font(.callout.weight(.semibold))
                    if !question.options.isEmpty {
                        // Vertical list, not an HStack — options are sentences.
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                                Button {
                                    loop.answer(option)
                                } label: {
                                    HStack(spacing: 6) {
                                        Image(systemName: index == 0 ? "star.fill" : "circle")
                                            .font(.caption2)
                                            .foregroundStyle(index == 0 ? .yellow : .secondary)
                                        Text(option)
                                            .font(.caption)
                                            .multilineTextAlignment(.leading)
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.vertical, 5)
                                    .padding(.horizontal, 8)
                                    .background(RoundedRectangle(cornerRadius: 6).fill(Color.primary.opacity(0.06)))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    HStack(spacing: 6) {
                        TextField("Or type your own answer…", text: $questionText)
                            .textFieldStyle(.roundedBorder)
                            .font(.caption)
                            .onSubmit(sendAnswer)
                        Button("Answer", action: sendAnswer)
                            .font(.caption)
                            .disabled(questionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        Button("Skip") { loop.skipQuestion() }
                            .font(.caption)
                            .help("Let the agent go with its recommended option.")
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 8).fill(Color.blue.opacity(0.10)))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.blue.opacity(0.35)))
            }

            if loop.isRunning {
                if loop.runPromptTokens > 0 || loop.runCostUSD > 0 {
                    HStack(spacing: 5) {
                        Image(systemName: "dollarsign.circle")
                        Text(
                            "Run \(loop.runPromptTokens.formatted()) in · \(loop.runCompletionTokens.formatted()) out · "
                            + String(format: "$%.4f", loop.runCostUSD)
                        )
                        if loop.costApprovalRequired {
                            Text("approval needed")
                                .foregroundStyle(.orange)
                        }
                    }
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                }

                HStack(spacing: 6) {
                    if loop.costApprovalRequired {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundStyle(.orange)
                    } else {
                        ProgressView().controlSize(.mini)
                    }
                    Text(loop.statusLine.isEmpty ? "Working…" : loop.statusLine)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                }
                HStack(spacing: 6) {
                    TextField("Steer the agent mid-run…", text: $steerText)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption)
                        .onSubmit(sendSteer)
                    Button("Send", action: sendSteer)
                        .font(.caption)
                        .disabled(steerText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Button {
                        loop.isPaused ? loop.resume() : loop.pause()
                    } label: {
                        Image(systemName: loop.isPaused ? "play.circle.fill" : "pause.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(loop.isPaused ? .green : .orange)
                    .help(loop.isPaused
                          ? (loop.costApprovalRequired
                             ? "Approve the next cost band and continue from exactly where the run paused."
                             : "Resume from exactly where it paused.")
                          : "Pause after the current step — work freely in the app, then resume from the same point.")
                    Button(role: .destructive) {
                        loop.cancel()
                    } label: {
                        Image(systemName: "stop.circle.fill")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(.red)
                    .help("Stop after the current step (checkpoints are saved).")
                }
            }
        }
    }

    private func sendSteer() {
        loop.steer(steerText)
        steerText = ""
    }

    private func sendAnswer() {
        loop.answer(questionText)
        questionText = ""
    }

    private func icon(for kind: AgentToolLoop.TranscriptEntry.Kind) -> String {
        switch kind {
        case .info: return "text.bubble"
        case .tool: return "wrench.and.screwdriver"
        case .result: return "arrow.turn.down.right"
        case .error: return "exclamationmark.triangle"
        case .steer: return "person.wave.2"
        case .done: return "checkmark.seal.fill"
        }
    }

    private func color(for kind: AgentToolLoop.TranscriptEntry.Kind) -> Color {
        switch kind {
        case .error: return .orange
        case .done: return .green
        case .steer: return .purple
        case .tool: return .blue
        default: return .secondary
        }
    }
}
