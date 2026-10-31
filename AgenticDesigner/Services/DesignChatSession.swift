//
//  DesignChatSession.swift
//  AgenticDesigner
//
//  The conversation behind the designer. A single "Ask Agent" text field
//  makes the agent feel like a command line; a thread makes it feel like a
//  collaborator. Every user turn snapshots the project first, so any message
//  can be reverted individually — "undo that idea" rather than "undo 40 node
//  edits".
//

import Foundation
import Combine

@MainActor
final class DesignChatSession: ObservableObject {

    enum Role {
        case user
        case agent
        case system
    }

    struct Message: Identifiable {
        let id = UUID()
        let role: Role
        var text: String
        var date = Date()
        /// The project state BEFORE this turn ran — reverting restores it.
        var checkpoint: ProjectCheckpoint?
        /// Live status while the turn is running ("Designing screens…").
        var stage: String?
        var isRunning = false
        var summary: String?
    }

    @Published private(set) var messages: [Message] = []
    @Published private(set) var isRunning = false

    // MARK: - Turn lifecycle

    func appendUser(_ text: String, checkpoint: ProjectCheckpoint?) -> UUID {
        messages.append(Message(role: .user, text: text, checkpoint: checkpoint))
        let agent = Message(role: .agent, text: "", stage: "Thinking…", isRunning: true)
        messages.append(agent)
        isRunning = true
        return agent.id
    }

    func updateStage(_ id: UUID, _ stage: String) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].stage = stage
    }

    func finish(_ id: UUID, summary: String) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].isRunning = false
        messages[index].stage = nil
        messages[index].text = summary
        isRunning = false
    }

    func fail(_ id: UUID, error: String) {
        guard let index = messages.firstIndex(where: { $0.id == id }) else { return }
        messages[index].isRunning = false
        messages[index].stage = nil
        messages[index].text = "Failed: \(error)"
        isRunning = false
    }

    func appendSystem(_ text: String) {
        messages.append(Message(role: .system, text: text))
    }

    /// Reverts the project to the state before this user message, and drops
    /// that turn (and everything after it) from the thread.
    func revert(to message: Message, design: ProjectViewModel) throws {
        guard let checkpoint = message.checkpoint else { return }
        let restored = try CheckpointStore.load(checkpoint)
        CheckpointStore.save(design.project, label: "before revert")
        design.replaceProject(restored)
        if let index = messages.firstIndex(where: { $0.id == message.id }) {
            messages.removeSubrange(index...)
        }
        appendSystem("Reverted to the state before that message.")
    }

    func clear() {
        messages.removeAll()
    }
}
