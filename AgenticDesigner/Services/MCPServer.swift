//
//  MCPServer.swift
//  AgenticDesigner
//
//  Embedded MCP server (Streamable HTTP transport, JSON-RPC 2.0) so external
//  agents — Claude Code, Claude Desktop, any MCP client — can connect to the
//  running app and drive it: inspect the design tree, apply design actions,
//  grab canvas screenshots, read logic flows.
//
//  Transport notes: stateless (no session ids), single JSON-RPC message per
//  POST, responses are plain application/json. Binds to 127.0.0.1 only and
//  rejects non-local Origin headers (anti DNS-rebinding).
//

import Foundation
import Network

// MARK: - Tool surface (implemented by MCPServerController)

struct MCPToolDefinition {
    let name: String
    let description: String
    let inputSchema: [String: Any]
    let handler: @MainActor ([String: Any]) async throws -> MCPToolResult
}

// MARK: - Prompts
// MCP prompts are reusable, parameterized templates the server offers to every
// client. Clients surface them (slash commands / template pickers), so this is
// how a methodology like "build a real, verified app" reaches ANY model that
// connects — not just one that happens to have been told.

struct MCPPromptArgument {
    let name: String
    let description: String
    let required: Bool
}

struct MCPPromptDefinition {
    let name: String
    let description: String
    let arguments: [MCPPromptArgument]
    /// Builds the prompt text from the (optional) argument values a client passes.
    let build: ([String: String]) -> String
}

struct MCPToolResult {
    var content: [MCPContentItem]
    var isError: Bool = false

    static func text(_ string: String) -> MCPToolResult {
        MCPToolResult(content: [.text(string)])
    }

    static func failure(_ message: String) -> MCPToolResult {
        MCPToolResult(content: [.text(message)], isError: true)
    }
}

enum MCPContentItem {
    case text(String)
    case image(base64: String, mimeType: String)

    var jsonObject: [String: Any] {
        switch self {
        case .text(let text):
            return ["type": "text", "text": text]
        case .image(let base64, let mimeType):
            return ["type": "image", "data": base64, "mimeType": mimeType]
        }
    }
}

struct MCPToolError: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

// MARK: - Server

final class MCPServer: @unchecked Sendable {

    struct Configuration {
        var port: UInt16
        var path: String = "/mcp"
        var serverName: String = "AgenticDesigner"
        var serverVersion: String = "1.0.0"
        var instructions: String = ""
    }

    private let configuration: Configuration
    private let tools: [MCPToolDefinition]
    private let prompts: [MCPPromptDefinition]
    private let log: @Sendable (String) -> Void
    private let queue = DispatchQueue(label: "com.agenticdesigner.mcp-server")
    private var listener: NWListener?

    private static let supportedProtocolVersions = ["2024-11-05", "2025-03-26", "2025-06-18"]
    private static let maxBodyBytes = 20 * 1024 * 1024

    init(
        configuration: Configuration,
        tools: [MCPToolDefinition],
        prompts: [MCPPromptDefinition] = [],
        log: @escaping @Sendable (String) -> Void
    ) {
        self.configuration = configuration
        self.tools = tools
        self.prompts = prompts
        self.log = log
    }

    func start(onStateChange: @escaping @Sendable (Bool, String?) -> Void) throws {
        let parameters = NWParameters.tcp
        parameters.allowLocalEndpointReuse = true
        // Loopback binding: the server must never be reachable from the network.
        parameters.requiredLocalEndpoint = NWEndpoint.hostPort(
            host: NWEndpoint.Host("127.0.0.1"),
            port: NWEndpoint.Port(rawValue: configuration.port) ?? 8765
        )

        let listener = try NWListener(using: parameters)

        listener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                self?.log("🔌 MCP: server listening on 127.0.0.1:\(self?.configuration.port ?? 0)")
                onStateChange(true, nil)
            case .failed(let error):
                self?.log("🔌 MCP: server failed — \(error.localizedDescription)")
                onStateChange(false, error.localizedDescription)
            case .cancelled:
                onStateChange(false, nil)
            case .waiting(let error):
                // Usually a briefly-still-held port right after a killed
                // previous instance — NWListener retries on its own and
                // normally reaches .ready shortly. Silent before this, so a
                // slow-to-bind launch looked identical to a hung one.
                self?.log("🔌 MCP: waiting to bind 127.0.0.1:\(self?.configuration.port ?? 0) — \(error.localizedDescription)")
            default:
                break
            }
        }

        listener.newConnectionHandler = { [weak self] connection in
            guard let self else {
                connection.cancel()
                return
            }
            connection.start(queue: self.queue)
            self.receive(on: connection, buffer: Data())
        }

        listener.start(queue: queue)
        self.listener = listener
    }

    func stop() {
        listener?.cancel()
        listener = nil
    }

    // MARK: - Connection handling

    private func receive(on connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 16) { [weak self] data, _, isComplete, error in
            guard let self else {
                connection.cancel()
                return
            }

            var buffer = buffer
            if let data {
                buffer.append(data)
            }

            guard buffer.count <= Self.maxBodyBytes else {
                self.send(Self.httpResponse(status: 413, body: nil), on: connection, close: true)
                return
            }

            switch Self.parseRequest(from: buffer) {
            case .request(let request, let consumed):
                buffer.removeFirst(consumed)
                let remaining = buffer
                Task {
                    let (response, close) = await self.respond(to: request)
                    self.send(response, on: connection, close: close) {
                        // Keep-alive: keep parsing on the same connection.
                        self.receive(on: connection, buffer: remaining)
                    }
                }
            case .malformed:
                self.send(Self.httpResponse(status: 400, body: nil), on: connection, close: true)
            case .incomplete:
                if isComplete || error != nil {
                    connection.cancel()
                } else {
                    self.receive(on: connection, buffer: buffer)
                }
            }
        }
    }

    private func send(_ data: Data, on connection: NWConnection, close: Bool, then continuation: (() -> Void)? = nil) {
        connection.send(content: data, completion: .contentProcessed { _ in
            if close {
                connection.cancel()
            } else {
                continuation?()
            }
        })
    }

    // MARK: - HTTP parsing

    private struct HTTPRequest {
        let method: String
        let path: String
        let headers: [String: String]
        let body: Data
        let keepAlive: Bool
    }

    private enum HTTPParseOutcome {
        case incomplete
        case malformed
        case request(HTTPRequest, consumed: Int)
    }

    private static func parseRequest(from buffer: Data) -> HTTPParseOutcome {
        guard let headerEnd = buffer.range(of: Data("\r\n\r\n".utf8)) else {
            return buffer.count > 64 * 1024 ? .malformed : .incomplete
        }

        guard let headerText = String(data: buffer[..<headerEnd.lowerBound], encoding: .utf8)
            ?? String(data: buffer[..<headerEnd.lowerBound], encoding: .isoLatin1)
        else {
            return .malformed
        }

        var lines = headerText.components(separatedBy: "\r\n")
        guard !lines.isEmpty else { return .malformed }

        let requestLineParts = lines.removeFirst().split(separator: " ")
        guard requestLineParts.count >= 3 else { return .malformed }

        let method = String(requestLineParts[0]).uppercased()
        let path = String(requestLineParts[1])
        let version = String(requestLineParts[2])

        var headers: [String: String] = [:]
        for line in lines {
            guard let colon = line.firstIndex(of: ":") else { continue }
            let key = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }

        let contentLength = Int(headers["content-length"] ?? "0") ?? 0
        guard contentLength >= 0, contentLength <= maxBodyBytes else { return .malformed }

        let totalLength = headerEnd.upperBound - buffer.startIndex + contentLength
        guard buffer.count >= totalLength else { return .incomplete }

        let body = buffer.subdata(in: headerEnd.upperBound..<(headerEnd.upperBound + contentLength))
        let connectionHeader = headers["connection"]?.lowercased() ?? ""
        let keepAlive = connectionHeader != "close" && version != "HTTP/1.0"

        return .request(
            HTTPRequest(method: method, path: path, headers: headers, body: body, keepAlive: keepAlive),
            consumed: totalLength
        )
    }

    // MARK: - Routing

    private func respond(to request: HTTPRequest) async -> (Data, close: Bool) {
        let close = !request.keepAlive

        // Reject cross-origin browser calls: local tools only.
        if let origin = request.headers["origin"],
           let host = URL(string: origin)?.host,
           !["127.0.0.1", "localhost", "::1"].contains(host.lowercased()) {
            return (Self.httpResponse(status: 403, body: Data("Forbidden origin".utf8), contentType: "text/plain"), true)
        }

        let normalizedPath = request.path.split(separator: "?").first.map(String.init) ?? request.path
        guard normalizedPath == configuration.path || normalizedPath == "/" else {
            return (Self.httpResponse(status: 404, body: Data("Not found — MCP endpoint is \(configuration.path)".utf8), contentType: "text/plain"), close)
        }

        switch request.method {
        case "POST":
            let (status, payload) = await handleRPC(body: request.body)
            return (Self.httpResponse(status: status, body: payload), close)
        case "OPTIONS":
            return (Self.httpResponse(status: 204, body: nil), close)
        case "GET", "DELETE":
            // Stateless server: no SSE stream to open, no session to delete.
            return (Self.httpResponse(status: 405, body: nil, extraHeaders: ["Allow": "POST"]), close)
        default:
            return (Self.httpResponse(status: 405, body: nil, extraHeaders: ["Allow": "POST"]), close)
        }
    }

    // MARK: - JSON-RPC

    private struct RPCError: Error {
        let code: Int
        let message: String

        static func methodNotFound(_ method: String) -> RPCError {
            RPCError(code: -32601, message: "Method not found: \(method)")
        }

        static func invalidParams(_ message: String) -> RPCError {
            RPCError(code: -32602, message: message)
        }

        static func invalidRequest(_ message: String) -> RPCError {
            RPCError(code: -32600, message: message)
        }
    }

    private func handleRPC(body: Data) async -> (Int, Data?) {
        guard let parsed = try? JSONSerialization.jsonObject(with: body) else {
            return (400, Self.encodeEnvelope(id: NSNull(), error: RPCError(code: -32700, message: "Parse error: body is not valid JSON")))
        }

        guard let message = parsed as? [String: Any] else {
            return (400, Self.encodeEnvelope(id: NSNull(), error: .invalidRequest("Batched JSON-RPC messages are not supported — send one message per request.")))
        }

        guard let method = message["method"] as? String else {
            return (400, Self.encodeEnvelope(id: message["id"] ?? NSNull(), error: .invalidRequest("Missing 'method'.")))
        }

        let id = message["id"]
        let isNotification = id == nil || id is NSNull
        let params = message["params"] as? [String: Any] ?? [:]

        if isNotification {
            // notifications/initialized, notifications/cancelled, …
            return (202, nil)
        }

        switch await dispatch(method: method, params: params) {
        case .success(let result):
            return (200, Self.encodeEnvelope(id: id ?? NSNull(), result: result))
        case .failure(let error):
            return (200, Self.encodeEnvelope(id: id ?? NSNull(), error: error))
        }
    }

    private func dispatch(method: String, params: [String: Any]) async -> Result<[String: Any], RPCError> {
        switch method {
        case "initialize":
            let requested = params["protocolVersion"] as? String ?? ""
            let negotiated = Self.supportedProtocolVersions.contains(requested)
                ? requested
                : Self.supportedProtocolVersions.last!
            let clientName = ((params["clientInfo"] as? [String: Any])?["name"] as? String) ?? "unknown client"
            log("🔌 MCP: initialize from \(clientName) (protocol \(negotiated))")

            var capabilities: [String: Any] = ["tools": [String: Any]()]
            if !prompts.isEmpty { capabilities["prompts"] = ["listChanged": false] }
            return .success([
                "protocolVersion": negotiated,
                "capabilities": capabilities,
                "serverInfo": [
                    "name": configuration.serverName,
                    "title": "Agentic Designer",
                    "version": configuration.serverVersion
                ],
                "instructions": configuration.instructions
            ])

        case "ping":
            return .success([:])

        case "prompts/list":
            log("🔌 MCP: prompts/list → \(prompts.count) prompts")
            return .success([
                "prompts": prompts.map { prompt in
                    [
                        "name": prompt.name,
                        "description": prompt.description,
                        "arguments": prompt.arguments.map {
                            ["name": $0.name, "description": $0.description, "required": $0.required] as [String: Any]
                        }
                    ] as [String: Any]
                }
            ])

        case "prompts/get":
            guard let name = params["name"] as? String else {
                return .failure(.invalidParams("Missing prompt 'name'."))
            }
            guard let prompt = prompts.first(where: { $0.name == name }) else {
                return .failure(.invalidParams("Unknown prompt: \(name)"))
            }
            let rawArgs = params["arguments"] as? [String: Any] ?? [:]
            let args = rawArgs.reduce(into: [String: String]()) { result, pair in
                result[pair.key] = pair.value as? String ?? String(describing: pair.value)
            }
            log("🔌 MCP: prompts/get \(name)")
            return .success([
                "description": prompt.description,
                "messages": [
                    [
                        "role": "user",
                        "content": ["type": "text", "text": prompt.build(args)]
                    ] as [String: Any]
                ]
            ])

        case "tools/list":
            log("🔌 MCP: tools/list → \(tools.count) tools")
            return .success([
                "tools": tools.map { tool in
                    [
                        "name": tool.name,
                        "description": tool.description,
                        "inputSchema": tool.inputSchema
                    ] as [String: Any]
                }
            ])

        case "tools/call":
            guard let name = params["name"] as? String else {
                return .failure(.invalidParams("Missing tool 'name'."))
            }
            guard let tool = tools.first(where: { $0.name == name }) else {
                return .failure(.invalidParams("Unknown tool: \(name)"))
            }

            let arguments = params["arguments"] as? [String: Any] ?? [:]
            let started = Date()

            do {
                let result = try await tool.handler(arguments)
                let ms = Int(Date().timeIntervalSince(started) * 1000)
                log("🔌 MCP: called \(name) (\(ms)ms)\(result.isError ? " — tool error" : "")")
                return .success([
                    "content": result.content.map(\.jsonObject),
                    "isError": result.isError
                ])
            } catch {
                let ms = Int(Date().timeIntervalSince(started) * 1000)
                log("🔌 MCP: called \(name) (\(ms)ms) — failed: \(error.localizedDescription)")
                return .success([
                    "content": [["type": "text", "text": "Error: \(error.localizedDescription)"]],
                    "isError": true
                ])
            }

        default:
            return .failure(.methodNotFound(method))
        }
    }

    private static func encodeEnvelope(id: Any, result: [String: Any]) -> Data? {
        try? JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        ])
    }

    private static func encodeEnvelope(id: Any, error: RPCError) -> Data? {
        try? JSONSerialization.data(withJSONObject: [
            "jsonrpc": "2.0",
            "id": id,
            "error": ["code": error.code, "message": error.message]
        ])
    }

    // MARK: - HTTP response builder

    private static let statusReasons: [Int: String] = [
        200: "OK", 202: "Accepted", 204: "No Content",
        400: "Bad Request", 403: "Forbidden", 404: "Not Found",
        405: "Method Not Allowed", 413: "Payload Too Large", 500: "Internal Server Error"
    ]

    private static func httpResponse(
        status: Int,
        body: Data?,
        contentType: String = "application/json",
        extraHeaders: [String: String] = [:]
    ) -> Data {
        var head = "HTTP/1.1 \(status) \(statusReasons[status] ?? "Unknown")\r\n"
        if let body, !body.isEmpty {
            head += "Content-Type: \(contentType)\r\n"
            head += "Content-Length: \(body.count)\r\n"
        } else {
            head += "Content-Length: 0\r\n"
        }
        for (key, value) in extraHeaders {
            head += "\(key): \(value)\r\n"
        }
        head += "\r\n"

        var response = Data(head.utf8)
        if let body {
            response.append(body)
        }
        return response
    }
}
