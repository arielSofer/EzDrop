//
//  LogicAgentPromptBuilder.swift
//  AgenticDesigner
//
//  Lets the AI agent create logic chains: prompts describing the block
//  catalog and the current screen, a response schema, and a translator
//  that resolves element names to node IDs and lays out the graph.
//

import Foundation
import CoreGraphics

// MARK: - Response models

struct LogicAgentResponse: Decodable {
    let plan: [String]?
    let flows: [GeneratedFlow]
}

struct GeneratedFlow: Decodable {
    let name: String
    let blocks: [GeneratedBlock]
    let connections: [GeneratedConnection]
}

struct GeneratedBlock: Decodable {
    let ref: String
    let type: String
    let x: CGFloat?
    let y: CGFloat?
    let comment: String?
    let parameters: [String: String]?
}

struct GeneratedConnection: Decodable {
    let from: String
    let fromPort: Int?
    let to: String
    let toPort: Int?
}

// MARK: - Prompts

enum LogicAgentPromptBuilder {

    static func buildSystemPrompt() -> String {
        """
        You are a visual logic programmer inside a native macOS design editor.
        The user has designed app screens; you now wire up their BEHAVIOR by creating flows of connected logic blocks (like a node-based visual programming tool).

        Output contract — return ONLY one valid JSON object:
        {
          "plan": ["Step 1: ...", "Step 2: ..."],
          "flows": [
            {
              "name": "Login Flow",
              "blocks": [
                { "ref": "b1", "type": "onTap", "parameters": { "element": "Login Button" } },
                { "ref": "b2", "type": "setLoading", "parameters": { "element": "Login Button", "loading": "true" } },
                { "ref": "b3", "type": "firebaseLogin", "parameters": { "email": "Email Input", "password": "Password Input" } },
                { "ref": "b4", "type": "navigate", "parameters": { "screen": "Home Screen" } },
                { "ref": "b5", "type": "showAlert", "parameters": { "title": "Login Failed", "message": "Check your credentials" } }
              ],
              "connections": [
                { "from": "b1", "to": "b2" },
                { "from": "b2", "to": "b3" },
                { "from": "b3", "fromPort": 0, "to": "b4" },
                { "from": "b3", "fromPort": 1, "to": "b5" }
              ]
            }
          ]
        }

        RULES:
        1. Every flow starts with exactly ONE event block (an Events-category block). Events are triggers — they never receive connections.
        2. Connect blocks in execution order. "fromPort" 0 is the main/success output (default); "fromPort" 1 is the error/else branch — only blocks listed below with 2 outputs have it. Omit fromPort/toPort when 0.
        3. Every non-event block must be reachable from the event via connections. No cycles.
        4. Element parameters must use the EXACT element name from SCREEN ELEMENTS in the context. Screen parameters must use exact screen names.
        5. Fill every required parameter with a realistic value: real alert copy, real Firestore collection names, real URLs — no placeholders like "TODO".
        6. Variables: reference existing VARIABLES by name, or introduce new camelCase names — they will be created automatically.
        7. Keep flows focused: one user intention per flow (login, search, save, refresh...). Use "x"/"y" only if you want a specific layout; otherwise omit them and the editor auto-arranges the chain.
        8. Handle errors: any block with a port-1 error output should have its error branch wired to user feedback (showAlert/showToast) when that matters for UX.

        \(blockCatalogSection())
        """
    }

    static func buildUserPrompt(
        request: String,
        elements: [(id: UUID, name: String, type: String)],
        screens: [(id: UUID, name: String)],
        variables: [LogicVariable],
        existingFlowNames: [String],
        firebaseConfigured: Bool
    ) -> String {
        let elementLines = elements
            .map { "- \($0.name) (\($0.type))" }
            .joined(separator: "\n")
        let screenLines = screens.map { "- \($0.name)" }.joined(separator: "\n")
        let variableLines = variables.isEmpty
            ? "(none defined yet)"
            : variables.map { "- \($0.name) (\($0.type.rawValue), \($0.scope.rawValue))" }.joined(separator: "\n")

        return """
        User request:
        \(request)

        SCREEN ELEMENTS (use these exact names for element parameters):
        \(elementLines.isEmpty ? "(no elements on canvas)" : elementLines)

        SCREENS (for navigate/presentSheet targets):
        \(screenLines.isEmpty ? "(none)" : screenLines)

        VARIABLES:
        \(variableLines)

        Existing flows (do not duplicate their names): \(existingFlowNames.isEmpty ? "none" : existingFlowNames.joined(separator: ", "))
        Firebase configured: \(firebaseConfigured ? "yes" : "no — you may still use Firebase blocks; the user will configure credentials later")

        Return only the JSON object described in the system prompt. No explanations.
        """
    }

    // Generates the block catalog listing from the real definitions so the
    // prompt never drifts from what the editor actually supports.
    private static func blockCatalogSection() -> String {
        var lines: [String] = ["AVAILABLE BLOCKS (type — required parameters — outputs):"]

        for category in LogicBlockCategory.allCases {
            lines.append("\n\(category.rawValue):")
            for def in BlockCatalog.definitions(in: category) {
                let params = def.defaultParameters
                    .map { param in
                        let kind: String
                        switch param.type {
                        case .nodeReference: kind = "element name"
                        case .screenReference: kind = "screen name"
                        case .variable: kind = "variable name"
                        case .dropdown, .httpMethod: kind = (param.options ?? []).joined(separator: "|")
                        default: kind = param.type.rawValue
                        }
                        return "\(param.key)(\(kind))\(param.isRequired ? "" : "?")"
                    }
                    .joined(separator: ", ")

                let outputs = def.outputPortCount > 1
                    ? " — 2 outputs: 0=\(def.outputPortLabels?.first ?? "ok"), 1=\(def.outputPortLabels?.last ?? "error")"
                    : ""

                lines.append("- \(def.type.rawValue): \(def.description). Params: \(params.isEmpty ? "none" : params)\(outputs)")
            }
        }

        return lines.joined(separator: "\n")
    }
}

// MARK: - Translator

// Turns a decoded LogicAgentResponse into real LogicFlows: resolves element
// names to node IDs, matches parameters by key/type, and auto-lays-out the
// graph in execution order when the model didn't position blocks.
enum LogicAgentTranslator {

    static func decodeResponse(from content: String) throws -> LogicAgentResponse {
        let cleaned = content
            .replacingOccurrences(of: "```json", with: "")
            .replacingOccurrences(of: "```", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if let data = cleaned.data(using: .utf8),
           let response = try? JSONDecoder().decode(LogicAgentResponse.self, from: data) {
            return response
        }

        guard let start = cleaned.firstIndex(of: "{"),
              let end = cleaned.lastIndex(of: "}")
        else {
            throw AIProviderError.invalidJSON("No JSON object in logic agent response.")
        }

        let candidate = String(cleaned[start...end])
        return try JSONDecoder().decode(LogicAgentResponse.self, from: Data(candidate.utf8))
    }

    static func makeFlows(
        from response: LogicAgentResponse,
        elements: [(id: UUID, name: String, type: String)],
        screens: [(id: UUID, name: String)]
    ) -> [LogicFlow] {
        response.flows.compactMap { generated in
            makeFlow(from: generated, elements: elements, screens: screens)
        }
    }

    private static func makeFlow(
        from generated: GeneratedFlow,
        elements: [(id: UUID, name: String, type: String)],
        screens: [(id: UUID, name: String)]
    ) -> LogicFlow? {
        var refToId: [String: UUID] = [:]
        var blocks: [LogicBlock] = []
        var newVariables: Set<String> = []

        for generatedBlock in generated.blocks {
            guard let type = resolveBlockType(generatedBlock.type),
                  var block = BlockCatalog.makeBlock(
                    type: type,
                    at: CGPoint(x: generatedBlock.x ?? 0, y: generatedBlock.y ?? 0)
                  )
            else {
                print("⚠️ Logic agent: unknown block type '\(generatedBlock.type)' skipped")
                continue
            }

            block.comment = generatedBlock.comment

            if let parameters = generatedBlock.parameters {
                for paramIndex in block.parameters.indices {
                    let key = block.parameters[paramIndex].key
                    guard let rawValue = parameters[key], !rawValue.isEmpty else { continue }

                    switch block.parameters[paramIndex].type {
                    case .nodeReference:
                        if let nodeId = resolveElement(named: rawValue, in: elements) {
                            block.parameters[paramIndex].nodeReference = nodeId
                        } else {
                            block.parameters[paramIndex].value = rawValue
                        }
                    case .screenReference:
                        if let screenId = resolveScreen(named: rawValue, in: screens) {
                            block.parameters[paramIndex].nodeReference = screenId
                        } else {
                            block.parameters[paramIndex].value = rawValue
                        }
                    case .variable:
                        block.parameters[paramIndex].variableReference = rawValue
                        newVariables.insert(rawValue)
                    default:
                        block.parameters[paramIndex].value = rawValue
                    }
                }
            }

            refToId[generatedBlock.ref] = block.id
            blocks.append(block)
        }

        guard !blocks.isEmpty else { return nil }

        var connections: [BlockConnection] = []
        for generatedConnection in generated.connections {
            guard let sourceId = refToId[generatedConnection.from],
                  let targetId = refToId[generatedConnection.to],
                  sourceId != targetId
            else { continue }

            connections.append(BlockConnection(
                sourceBlockId: sourceId,
                sourcePortIndex: generatedConnection.fromPort ?? 0,
                targetBlockId: targetId,
                targetPortIndex: generatedConnection.toPort ?? 0
            ))
        }

        layoutIfNeeded(blocks: &blocks, connections: connections)

        // .screen (not .flow): counters/toggles/fetched-data variables the
        // AI invents should survive between separate taps on this screen —
        // that's the whole point of state existing. .flow scope means
        // "reset every run", which would make them useless for exactly the
        // things AI-authored flows use variables for.
        let variables = newVariables.map {
            LogicVariable(name: $0, type: .string, scope: .screen)
        }

        return LogicFlow(
            name: generated.name,
            blocks: blocks,
            connections: connections,
            variables: variables
        )
    }

    private static func resolveBlockType(_ raw: String) -> LogicBlockType? {
        if let type = LogicBlockType(rawValue: raw) { return type }
        let normalized = raw.lowercased().replacingOccurrences(of: "_", with: "")
        return BlockCatalog.all.first {
            $0.type.rawValue.lowercased() == normalized
        }?.type
    }

    private static func resolveElement(
        named name: String,
        in elements: [(id: UUID, name: String, type: String)]
    ) -> UUID? {
        let query = name.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if let exact = elements.first(where: { $0.name.lowercased() == query }) {
            return exact.id
        }
        return elements.first { $0.name.lowercased().contains(query) || query.contains($0.name.lowercased()) }?.id
    }

    private static func resolveScreen(
        named name: String,
        in screens: [(id: UUID, name: String)]
    ) -> UUID? {
        let query = name.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if let exact = screens.first(where: { $0.name.lowercased() == query }) {
            return exact.id
        }
        return screens.first { $0.name.lowercased().contains(query) }?.id
    }

    // Auto-layout: BFS depth from event blocks sets the row; error branches
    // (port > 0) shift one lane to the right so branches read left-to-right.
    static func layoutIfNeeded(blocks: inout [LogicBlock], connections: [BlockConnection]) {
        let unpositioned = blocks.allSatisfy { $0.x == 0 && $0.y == 0 }
        guard unpositioned else { return }

        var depth: [UUID: Int] = [:]
        var lane: [UUID: Int] = [:]

        let targetIds = Set(connections.map(\.targetBlockId))
        let roots = blocks.filter { !targetIds.contains($0.id) }

        for (rootIndex, root) in roots.enumerated() {
            depth[root.id] = 0
            lane[root.id] = rootIndex * 2

            var queue: [UUID] = [root.id]
            while !queue.isEmpty {
                let current = queue.removeFirst()
                for connection in connections where connection.sourceBlockId == current {
                    let target = connection.targetBlockId
                    let nextDepth = (depth[current] ?? 0) + 1
                    let nextLane = (lane[current] ?? 0) + (connection.sourcePortIndex > 0 ? 1 : 0)

                    if nextDepth > (depth[target] ?? -1) {
                        depth[target] = nextDepth
                        lane[target] = max(lane[target] ?? 0, nextLane)
                        queue.append(target)
                    }
                }
            }
        }

        for index in blocks.indices {
            let id = blocks[index].id
            blocks[index].x = 80 + CGFloat(lane[id] ?? 0) * 250
            blocks[index].y = 70 + CGFloat(depth[id] ?? 0) * 175
        }
    }
}
