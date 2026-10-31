//
//  OpenRouterProvider.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

/// Result of one function-calling turn: either the model wants tools run, or
/// it produced its final text.
enum AgentToolTurn {
    case text(String)
    case toolCalls([OpenRouterMessageToolCall], assistantText: String?)
}

struct AgentToolUsage {
    let promptTokens: Int
    let completionTokens: Int
    let costUSD: Double?
}

struct AgentToolTurnResult {
    let turn: AgentToolTurn
    let usage: AgentToolUsage?
}

struct OpenRouterProvider: AIProvider {
    let apiKey: String
    let model: String
    let temperature: Double
    
    // A model id carries its own provider: "local/qwen3-vl:32b" runs on Ollama,
    // "cerebras/…" and "gemini/…" hit those vendors' free tiers directly, and a
    // bare "vendor/model" is an OpenRouter id. See ModelProviderCatalog.
    private var route: ModelProviderRoute { ModelProviderCatalog.route(for: model) }
    private var isLocalModel: Bool { route.id == ModelProviderCatalog.localId }
    private var resolvedModelName: String { ModelProviderCatalog.upstreamModelName(for: model) }
    private var endpoint: URL { route.chatEndpoint }
    /// The route's own key wins: an OpenRouter key must not be sent to Cerebras.
    private var effectiveKey: String {
        route.resolvedKey() ?? apiKey
    }
    private let imageEndpoint = URL(string: "https://openrouter.ai/api/v1/images")!
    
    init(apiKey: String, model: String, temperature: Double = 0.35) {
        self.apiKey = apiKey
        self.model = model
        self.temperature = temperature
    }
    
    func generateActions(
        systemPrompt: String,
        userPrompt: String
    ) async throws -> [DesignAction] {
        try await generateActions(messages: [
            OpenRouterMessage(role: "system", content: systemPrompt),
            OpenRouterMessage(role: "user", content: userPrompt)
        ])
    }
    
    func generateActions(messages: [OpenRouterMessage]) async throws -> [DesignAction] {
        var conversation = messages
        var lastFailureMessage = "No JSON object or array found in model response."

        // One generation attempt plus one self-repair round trip: on a decode
        // failure the model sees its own broken output and the exact decode error.
        for attempt in 1...2 {
            let content = try await generateRawChat(messages: conversation, jsonMode: true)

            print("===== RAW AI RESPONSE (attempt \(attempt)) =====")
            print(content)
            print("===========================")

            let jsonCandidates = extractJSONCandidates(from: content)
            var attemptedJSON: [String] = []
            var lastDecodeError: Error?

            for candidate in jsonCandidates {
                let repairedJSON = repairCommonJSONMistakes(in: candidate)
                attemptedJSON.append(repairedJSON)

                do {
                    let response = try decodeAgentResponse(from: Data(repairedJSON.utf8))
                    print("===== AGENT DESIGN PLAN =====")
                    response.plan.forEach { print("- \($0)") }
                    print("=============================")
                    return response.actions
                } catch {
                    lastDecodeError = error
                }
            }

            lastFailureMessage = lastDecodeError.map(decodingDebugMessage)
                ?? "No JSON object or array found in model response."

            print("===== EXTRACTED ACTION JSON CANDIDATES =====")
            attemptedJSON.forEach { candidate in
                print(candidate)
                print("-----")
            }
            print("===== ACTION JSON DECODE ERROR =====")
            print(lastFailureMessage)

            conversation.append(OpenRouterMessage(role: "assistant", content: content))
            conversation.append(OpenRouterMessage(
                role: "user",
                content: """
                Your previous response could not be parsed as a valid `DesignAgentResponse`.
                Decode error: \(lastFailureMessage)
                Return the complete corrected JSON object only ({ "plan": [...], "actions": [...] }). No explanations, no markdown fences.
                """
            ))
        }

        throw AIProviderError.invalidJSON(lastFailureMessage)
    }

    /// Schema-CONSTRAINED generation on a local model. Ollama's native
    /// `/api/chat` accepts a JSON Schema in `format`, and the decoder is then
    /// physically unable to emit a token that would break it — malformed JSON
    /// stops being unlikely and becomes impossible. Measured: gemma3:4b, a
    /// model far weaker than the 30B that kept sending `"x:140,` and
    /// stringified arrays, returns a valid actions array every time.
    ///
    /// Note the endpoint: the OpenAI-compatible `/v1` path with
    /// `response_format` returned EMPTY output for MLX models, so this
    /// deliberately talks to the native API instead.
    func generateConstrainedJSON(
        messages: [OpenRouterMessage],
        schema: [String: Any],
        maxTokens: Int = 4096
    ) async throws -> String {
        guard isLocalModel else {
            // Cloud providers get the ordinary json_object path; only Ollama
            // exposes true grammar-constrained decoding here.
            return try await generateRawChat(messages: messages, jsonMode: true, maxTokens: maxTokens)
        }

        var body: [String: Any] = [
            "model": resolvedModelName,
            "stream": false,
            "format": schema,
            "options": ["num_predict": maxTokens, "temperature": temperature],
            "messages": messages.map { message -> [String: Any] in
                var entry: [String: Any] = ["role": message.role, "content": message.content]
                if !message.imageDataURLs.isEmpty {
                    // Ollama's native API takes bare base64, not data: URLs.
                    entry["images"] = message.imageDataURLs.map { url in
                        url.components(separatedBy: "base64,").last ?? url
                    }
                }
                return entry
            }
        ]
        body["keep_alive"] = "10m"

        var request = URLRequest(url: URL(string: "http://127.0.0.1:11434/api/chat")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 1800
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let session = URLSession(configuration: {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 1800
            config.timeoutIntervalForResource = 2100
            return config
        }())
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let text = String(data: data, encoding: .utf8) ?? ""
            throw AIProviderError.httpError(
                statusCode: (response as? HTTPURLResponse)?.statusCode ?? -1,
                message: "Ollama constrained call failed: \(text.prefix(200))"
            )
        }
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let message = object["message"] as? [String: Any],
              let content = message["content"] as? String,
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            throw AIProviderError.emptyContent
        }

        // MEASURED: Ollama's MLX-quantised builds silently IGNORE `format` and
        // answer in prose, while GGUF builds honour it. Verified across
        // gemma3:4b (respects) vs gemma4:12b-mlx / gemma4:26b-mlx (ignore).
        // Say so loudly — otherwise constrained decoding looks "enabled" while
        // doing nothing, which is worse than not having it.
        let leading = content.trimmingCharacters(in: .whitespacesAndNewlines).first
        if leading != "{" && leading != "[" {
            print("""
            ⚠️ \(resolvedModelName) ignored the JSON schema and answered in prose. \
            Ollama's MLX builds do not support constrained decoding — pull a GGUF \
            build of a comparable model to get guaranteed-valid output.
            """)
        }
        return content
    }

    func generateRawChat(messages: [OpenRouterMessage], jsonMode: Bool = false, retryCount: Int = 0, maxTokens: Int = 24576) async throws -> String {
        print("===== FULL AI PROMPT =====")
        messages.forEach { msg in
            print("--- \(msg.role.uppercased()) ---")
            print(msg.content)
        }
        print("==========================")
        
        let trimmedKey = effectiveKey.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedKey.isEmpty || isLocalModel else {
            throw AIProviderError.missingAPIKey
        }

        let requestBody = OpenRouterChatRequest(
            model: resolvedModelName,
            messages: messages,
            temperature: temperature,
            responseFormat: jsonMode ? OpenRouterResponseFormat(type: "json_object") : nil,
            maxTokens: isLocalModel ? nil : maxTokens
        )

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        // Large free models can take minutes to emit a full multi-screen
        // response — the default 60s timeout kills them mid-generation.
        request.timeoutInterval = 600
        request.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("AgenticDesigner", forHTTPHeaderField: "X-OpenRouter-Title")
        request.httpBody = try JSONEncoder().encode(requestBody)

        let session = URLSession(configuration: {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = 600
            config.timeoutIntervalForResource = 900
            return config
        }())
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIProviderError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = extractErrorMessage(from: data)
            let lowerMessage = message.lowercased()
            if [401, 403].contains(httpResponse.statusCode)
                || (httpResponse.statusCode == 400 && lowerMessage.contains("api key")) {
                throw AIProviderError.providerUnavailable(provider: route.name, detail: message)
            }

            // 402 = the account can't cover the OUTPUT RESERVATION, not the
            // real cost. Shrink max_tokens toward what the balance affords
            // (OpenRouter names the affordable number in the message).
            if httpResponse.statusCode == 402, maxTokens > 2048 {
                let affordable = Self.affordableTokens(from: message).map { Int(Double($0) * 0.9) }
                let next = max(2048, min(affordable ?? maxTokens / 2, maxTokens / 2))
                print("⚠️ HTTP 402 (credits) — retrying with max_tokens \(next)")
                return try await generateRawChat(messages: messages, jsonMode: jsonMode, retryCount: retryCount, maxTokens: next)
            }

            // Free-tier congestion (429 rate limit, 502/503 overload) is
            // transient — back off and retry up to 3 times before failing.
            if [429, 502, 503].contains(httpResponse.statusCode), retryCount < 3 {
                let delay = UInt64((retryCount + 1) * 8) * 1_000_000_000
                print("⚠️ HTTP \(httpResponse.statusCode) — retrying in \((retryCount + 1) * 8)s (attempt \(retryCount + 1)/3)")
                try await Task.sleep(nanoseconds: delay)
                return try await generateRawChat(messages: messages, jsonMode: jsonMode, retryCount: retryCount + 1, maxTokens: maxTokens)
            }

            // Some providers reject response_format; retry once without it.
            if jsonMode, message.lowercased().contains("response_format") {
                print("⚠️ Provider rejected response_format — retrying without JSON mode.")
                return try await generateRawChat(messages: messages, jsonMode: false, maxTokens: maxTokens)
            }

            // Text-only models have no endpoints accepting image parts —
            // retry once with the screenshots stripped.
            if message.lowercased().contains("no endpoints found"),
               messages.contains(where: { !$0.imageDataURLs.isEmpty }) {
                print("⚠️ Model has no vision endpoint — retrying without screenshots.")
                let textOnly = messages.map {
                    OpenRouterMessage(role: $0.role, content: $0.content)
                }
                return try await generateRawChat(messages: textOnly, jsonMode: jsonMode, maxTokens: maxTokens)
            }

            throw AIProviderError.httpError(
                statusCode: httpResponse.statusCode,
                message: message
            )
        }
        
        let decodedResponse: OpenRouterChatResponse
        do {
            decodedResponse = try JSONDecoder().decode(OpenRouterChatResponse.self, from: data)
        } catch {
            let rawResponse = String(data: data, encoding: .utf8) ?? "Unreadable response body"
            print("===== OPENROUTER CHAT DECODE ERROR =====")
            print(decodingDebugMessage(error))
            print(rawResponse)
            print("========================================")
            throw AIProviderError.invalidJSON(
                "Could not decode OpenRouter chat response: \(decodingDebugMessage(error)). Raw response: \(rawResponse.prefix(700))"
            )
        }
        
        if let providerError = decodedResponse.error {
            // A provider error INSIDE an HTTP-200 body (e.g. the model host
            // returned 500 "Internal Server Error") is an upstream hiccup —
            // transient. Back off and retry instead of losing the whole build.
            if retryCount < 3 {
                let delay = UInt64((retryCount + 1) * 6) * 1_000_000_000
                print("⚠️ Provider error in 200 body: \(providerError.message) — retrying in \((retryCount + 1) * 6)s (attempt \(retryCount + 1)/3)")
                try await Task.sleep(nanoseconds: delay)
                return try await generateRawChat(messages: messages, jsonMode: jsonMode, retryCount: retryCount + 1, maxTokens: maxTokens)
            }
            throw AIProviderError.httpError(
                statusCode: httpResponse.statusCode,
                message: providerError.message
            )
        }
        
        guard let content = decodedResponse.choices?
            .compactMap(\.content)
            .first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw AIProviderError.emptyContent
        }
        
        return content
    }
    
    /// One turn of a function-calling conversation: sends the messages plus
    /// tool schemas ([{type:"function",function:{name,description,parameters}}])
    /// and returns either the model's tool calls or its final text. The agent
    /// tool loop drives this repeatedly, feeding results back as "tool" messages.
    func generateToolTurn(
        messages: [OpenRouterMessage],
        toolSchemas: [[String: Any]],
        retryCount: Int = 0,
        // A tool turn's output is usually small, but it can legitimately be a
        // whole file (set_source_override) or a long action batch. The HTTP 402
        // path below shrinks this adaptively for low-credit accounts, so the
        // ceiling doesn't need to be pre-emptively low — and a truncated tool
        // call is a silent, expensive failure.
        maxTokens: Int = 16384
    ) async throws -> AgentToolTurnResult {
        let trimmedKey = effectiveKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty || isLocalModel else {
            throw AIProviderError.missingAPIKey
        }

        // The message array reuses the existing Encodable path (images, tool
        // echoes); tools carry free-form JSON-Schema dictionaries, so the two
        // are merged at the JSON level rather than fighting Encodable.
        let encodedRequest = try JSONEncoder().encode(OpenRouterChatRequest(
            model: resolvedModelName,
            messages: messages,
            temperature: temperature,
            responseFormat: nil
        ))
        var body = try JSONSerialization.jsonObject(with: encodedRequest) as? [String: Any] ?? [:]
        body["tools"] = toolSchemas
        // Ask OpenRouter to return per-turn token and cost data. The agent loop
        // uses the actual billed cost for its approval guard; local providers
        // simply return no usage block and remain unrestricted.
        // OpenRouter-ONLY extension. Google's OpenAI-compat layer validates
        // strictly and 400s on any unknown field — sending this to Gemini made
        // every agent turn fail with "Unknown name \"usage\": Cannot find field",
        // which surfaced only as "Stopped after 3 failed model attempts".
        if route.id == ModelProviderCatalog.openRouterId {
            body["usage"] = ["include": true]
        }
        // Start from what this balance was last known to afford, so a
        // low-credit account doesn't fail-and-halve its way down on every turn.
        let effectiveMaxTokens = min(maxTokens, Self.learnedOutputTokenCeiling ?? maxTokens)
        if !isLocalModel { body["max_tokens"] = effectiveMaxTokens }
        // Anthropic bills a cached prefix at ~10% — but ONLY where the caller
        // places explicit cache_control breakpoints (OpenAI and Gemini cache
        // automatically). In a tool loop the same system prompt + schemas +
        // history are resent every single turn, so this is the single largest
        // cost lever available; it only pays off while the prefix stays byte
        // stable, which is why the tool belt is now fixed for a whole run.
        if supportsExplicitPromptCaching,
           let encodedMessages = body["messages"] as? [[String: Any]] {
            body["messages"] = Self.markingCacheBreakpoints(encodedMessages)
        }

        // Local models legitimately take much longer per turn: a 30B running
        // on the same GPU as image generation (mflux) can crawl through a
        // single prefill+think for many minutes. Cloud keeps the tighter cap.
        // Direct cloud tool turns normally complete in seconds. A 10-minute
        // timeout followed by two internal retries could freeze a Gemini vision
        // pass for half an hour while the rest of the app looked alive. Local
        // models still need the long leash; cloud gets a bounded recovery path.
        let turnTimeout: TimeInterval = isLocalModel ? 1800 : 150

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = turnTimeout
        request.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("AgenticDesigner", forHTTPHeaderField: "X-OpenRouter-Title")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let session = URLSession(configuration: {
            let config = URLSessionConfiguration.default
            config.timeoutIntervalForRequest = turnTimeout
            config.timeoutIntervalForResource = turnTimeout + 300
            return config
        }())

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where [.timedOut, .networkConnectionLost].contains(error.code) && isLocalModel && retryCount < 2 {
            // A timed-out local turn usually means transient GPU contention.
            try await Task.sleep(nanoseconds: 10_000_000_000)
            return try await generateToolTurn(messages: messages, toolSchemas: toolSchemas, retryCount: retryCount + 1)
        } catch let error as URLError where [.timedOut, .networkConnectionLost].contains(error.code) {
            throw AIProviderError.rateLimited(
                provider: route.name,
                detail: "Tool turn did not respond within \(Int(turnTimeout)) seconds (\(error.localizedDescription))."
            )
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIProviderError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = extractErrorMessage(from: data)
            let lowerMessage = message.lowercased()
            if [401, 403].contains(httpResponse.statusCode)
                || (httpResponse.statusCode == 400 && lowerMessage.contains("api key")) {
                throw AIProviderError.providerUnavailable(provider: route.name, detail: message)
            }
            // A 402 has TWO different causes. "Prompt tokens limit exceeded"
            // means the conversation itself is too big for what the balance
            // allows — shrinking max_tokens does nothing for it, so surface a
            // distinct error the agent loop can answer by compacting. The
            // learned ceiling is kept so later turns pre-trim instead of
            // burning a failed round-trip each time.
            if httpResponse.statusCode == 402,
               let promptLimit = Self.parsePromptTokenLimit(from: message) {
                Self.learnedPromptTokenCeiling = promptLimit.limit
                throw AIProviderError.promptTooLarge(actual: promptLimit.actual, limit: promptLimit.limit)
            }
            // Credits: shrink the output reservation to what the balance
            // affords. The floor used to be 2048, which made an account that
            // could only afford 1583 unrecoverable — it failed, halved, hit the
            // floor, and threw. Now it follows the number OpenRouter reports
            // and remembers it, so later turns start there instead of burning
            // a failed round-trip on every single step.
            if httpResponse.statusCode == 402, maxTokens > 256 {
                let affordable = Self.affordableTokens(from: message).map { Int(Double($0) * 0.9) }
                let proposed = affordable ?? (maxTokens / 2)
                let next = max(256, min(proposed, maxTokens - 1))
                if next < maxTokens {
                    Self.learnedOutputTokenCeiling = next
                    return try await generateToolTurn(messages: messages, toolSchemas: toolSchemas, retryCount: retryCount, maxTokens: next)
                }
            }
            if httpResponse.statusCode == 402 {
                throw AIProviderError.quotaExceeded(provider: route.name, detail: message)
            }
            // A 429 is either "slow down" (transient — worth a backoff) or
            // "your allowance is gone" (retrying can never succeed). Telling
            // them apart is what makes automatic provider fallback possible;
            // otherwise the loop burns 3 pointless retries and dies.
            if httpResponse.statusCode == 429, Self.isQuotaExhausted(message) {
                throw AIProviderError.quotaExceeded(provider: route.name, detail: message)
            }
            // A transient 429 is surfaced instead of being retried in here:
            // the LOOP knows whether another provider is available, and
            // switching beats waiting out congestion on a shared free model.
            // It falls back to retrying only when the chain is exhausted.
            if httpResponse.statusCode == 429 {
                throw AIProviderError.rateLimited(provider: route.name, detail: message)
            }
            if [502, 503].contains(httpResponse.statusCode), retryCount < 3 {
                try await Task.sleep(nanoseconds: UInt64((retryCount + 1) * 8) * 1_000_000_000)
                return try await generateToolTurn(messages: messages, toolSchemas: toolSchemas, retryCount: retryCount + 1, maxTokens: maxTokens)
            }
            throw AIProviderError.httpError(statusCode: httpResponse.statusCode, message: message)
        }

        let decoded: OpenRouterChatResponse
        do {
            decoded = try JSONDecoder().decode(OpenRouterChatResponse.self, from: data)
        } catch {
            let raw = String(data: data, encoding: .utf8) ?? "Unreadable response body"
            throw AIProviderError.invalidJSON("Could not decode tool-turn response: \(decodingDebugMessage(error)). Raw: \(raw.prefix(600))")
        }

        if let providerError = decoded.error {
            if retryCount < 3 {
                try await Task.sleep(nanoseconds: UInt64((retryCount + 1) * 6) * 1_000_000_000)
                return try await generateToolTurn(messages: messages, toolSchemas: toolSchemas, retryCount: retryCount + 1, maxTokens: maxTokens)
            }
            throw AIProviderError.httpError(statusCode: httpResponse.statusCode, message: providerError.message)
        }

        guard let choice = decoded.choices?.first else {
            throw AIProviderError.emptyContent
        }
        let usage = decoded.usage.map {
            AgentToolUsage(
                promptTokens: $0.promptTokens ?? 0,
                completionTokens: $0.completionTokens ?? 0,
                costUSD: $0.cost
            )
        }
        let toolCalls = choice.toolCalls
        if !toolCalls.isEmpty {
            return AgentToolTurnResult(
                turn: .toolCalls(toolCalls, assistantText: choice.content),
                usage: usage
            )
        }
        let text = choice.content?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !text.isEmpty else { throw AIProviderError.emptyContent }
        return AgentToolTurnResult(turn: .text(text), usage: usage)
    }

    func generateImageAsset(
        prompt: String,
        assetKind: String?,
        aspectRatio: String?,
        resolution: String?,
        size: String?
    ) async throws -> String {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !trimmedPrompt.isEmpty else {
            throw AIProviderError.invalidJSON("Missing imagePrompt for generated asset.")
        }

        // Local-first: if a Draw Things / A1111-compatible server is running
        // on 127.0.0.1:7860, generate there (free, offline, no API key
        // needed) — this must be tried before the API-key check below, or a
        // downloaded local model becomes unusable without a cloud key too.
        if let localPath = try? await generateLocalImage(prompt: trimmedPrompt, size: size) {
            return localPath
        }

        guard !trimmedKey.isEmpty else {
            throw AIProviderError.missingAPIKey
        }

        let requestBody = OpenRouterImageRequest(
            model: OpenRouterConfiguration.imageModel,
            prompt: enrichedImagePrompt(trimmedPrompt, assetKind: assetKind, aspectRatio: aspectRatio, size: size),
            size: size,
            aspectRatio: aspectRatio,
            resolution: resolution
        )
        
        var request = URLRequest(url: imageEndpoint)
        request.httpMethod = "POST"
        request.setValue("Bearer \(trimmedKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("AgenticDesigner", forHTTPHeaderField: "X-OpenRouter-Title")
        request.httpBody = try JSONEncoder().encode(requestBody)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AIProviderError.invalidResponse
        }
        
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = extractErrorMessage(from: data)
            throw AIProviderError.httpError(
                statusCode: httpResponse.statusCode,
                message: message
            )
        }
        
        let decodedResponse = try JSONDecoder().decode(OpenRouterImageResponse.self, from: data)
        
        if let base64 = decodedResponse.data.first?.b64Json,
           let imageData = Data(base64Encoded: base64) {
            return try saveGeneratedImageData(imageData, preferredExtension: "png")
        }
        
        if let urlString = decodedResponse.data.first?.url,
           let url = URL(string: urlString) {
            let (imageData, _) = try await URLSession.shared.data(from: url)
            return try saveGeneratedImageData(imageData, preferredExtension: url.pathExtension.isEmpty ? "png" : url.pathExtension)
        }
        
        throw AIProviderError.emptyContent
    }
    
    private func enrichedImagePrompt(
        _ prompt: String,
        assetKind: String?,
        aspectRatio: String? = nil,
        size: String? = nil
    ) -> String {
        let base = baseEnrichedImagePrompt(prompt, assetKind: assetKind)

        guard aspectRatio != nil || size != nil else { return base }

        var framingParts: [String] = []
        if let aspectRatio {
            framingParts.append("\"targetAspectRatio\": \"\(aspectRatio)\"")
        }
        if let size {
            framingParts.append("\"targetSize\": \"\(size)\"")
        }
        framingParts.append("\"instruction\": \"Compose specifically for this exact crop: keep the full subject inside the frame, keep important details away from all edges, and balance negative space for this ratio. Do not letterbox, pad, or add borders.\"")

        return base + "\n{ \"framing\": { " + framingParts.joined(separator: ", ") + " } }"
    }

    private func baseEnrichedImagePrompt(_ prompt: String, assetKind: String?) -> String {
        let kind = assetKind?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "hero"

        switch kind {
        case "icon", "appicon", "symbol":
            return """
            {
              "task": "Generate one premium app icon or symbolic image asset for use inside a product UI.",
              "assetKind": "\(kind)",
              "coreBrief": "\(prompt.jsonEscaped)",
              "visualIntent": {
                "roleInInterface": "A polished visual symbol that can sit inside a button, card, navigation tile, feature tile, or compact hero area.",
                "subject": "Use the core brief as the exact subject. Keep the symbol instantly recognizable at small sizes.",
                "composition": "Single centered subject, balanced negative space, strong silhouette, no clutter, no cropped edges.",
                "style": "Premium contemporary app-design asset, refined 3D/vector-like finish, crisp geometry, subtle depth, clean edges.",
                "lighting": "Soft studio lighting with gentle highlights and controlled shadows.",
                "background": "Simple transparent-looking or minimal background, never a full app screen.",
                "colorDirection": "Use a cohesive 2-4 color palette that can fit a modern mobile UI. Avoid muddy colors."
              },
              "qualityBar": {
                "detailLevel": "High detail where useful, but readable at icon size.",
                "finish": "Polished, intentional, commercially usable, no rough artifacts.",
                "contrast": "Clear contrast between subject and background."
              },
              "strictConstraints": {
                "noText": true,
                "noLetters": true,
                "noNumbers": true,
                "noWatermarks": true,
                "noMockupChrome": true,
                "noButtons": true,
                "noMenus": true,
                "noFullUIScreen": true
              },
              "negativePrompt": "readable text, letters, numbers, watermark, logo text, app screenshot, phone mockup, UI controls, buttons, menu bars, low resolution, blurry, distorted, messy composition, extra objects"
            }
            """
        case "product", "productcutout", "cutout", "object":
            return """
            {
              "task": "Generate one premium product/object image asset for placement inside a mobile app UI. The output is an asset only, not a UI mockup.",
              "assetKind": "\(kind)",
              "coreBrief": "\(prompt.jsonEscaped)",
              "visualIntent": {
                "roleInInterface": "A clean product cutout or hero object that can sit inside a card, product detail screen, gallery tile, or editorial hero.",
                "subject": "Follow the core brief precisely. The subject must be the clear focus and recognizable at mobile size.",
                "composition": "Single product/object, centered or slightly off-center, fully visible, elegant negative space, no cropped important edges.",
                "style": "Premium commercial product photography or polished 3D/product render, refined material detail, crisp contours, app-design ready.",
                "lighting": "Soft studio lighting, controlled highlights, subtle grounding shadow, no harsh glare.",
                "background": "Clean transparent-looking, seamless, or very minimal background that is easy to mask into UI cards.",
                "colorDirection": "Cohesive palette that can drive the UI accent color and background tint.",
                "edgeQuality": "Clean silhouette and contours suitable for rounded masks or floating above cards."
              },
              "strictConstraints": {
                "noText": true,
                "noLetters": true,
                "noNumbers": true,
                "noWatermarks": true,
                "noAppScreenshot": true,
                "noPhoneMockup": true,
                "noButtons": true,
                "noMenus": true
              },
              "negativePrompt": "text, letters, numbers, watermark, logo text, app screenshot, phone mockup, UI, buttons, menu bars, clutter, messy background, cropped product, distorted object, blurry, low quality"
            }
            """
        case "sprite", "gamesprite", "character", "gameasset":
            return """
            {
              "task": "Generate one 2D game sprite asset for a mobile game. The output is a single game object on a plain, easily-removable background — NOT a scene, NOT a UI.",
              "assetKind": "\(kind)",
              "coreBrief": "\(prompt.jsonEscaped)",
              "visualIntent": {
                "roleInInterface": "A single game sprite (character, obstacle, projectile, coin, tile) that will be cut out and composited into a live SpriteKit scene.",
                "subject": "Exactly the core brief, one subject only, whole and uncropped, centered, facing right or 3/4 view unless the brief says otherwise.",
                "composition": "Single centered subject filling ~70% of the frame, generous even margin on all sides, no ground shadow touching edges.",
                "style": "Clean modern 2D game art — crisp vector/illustrated or polished game-render look, bold readable silhouette, saturated game-friendly colors, thick clean edges.",
                "lighting": "Even flat lighting, minimal cast shadow, no dramatic gradients that bleed into the background.",
                "background": "A COMPLETELY FLAT, SOLID, UNIFORM background of a single distinct color (bright magenta or pure white) with NO gradient, NO texture, NO scenery — so it mattes out perfectly."
              },
              "strictConstraints": {
                "noScene": true,
                "noBackgroundDetail": true,
                "noGradientBackground": true,
                "noText": true,
                "noUI": true,
                "noMultipleObjects": true,
                "noCroppedSubject": true,
                "singleSubjectOnly": true
              },
              "negativePrompt": "scene, landscape, background scenery, gradient background, textured background, multiple objects, text, letters, UI, buttons, cropped subject, drop shadow on floor, photo, realistic photograph, watermark, low quality, blurry"
            }
            """
        case "poster", "cover", "thumbnail", "avatar":
            return """
            {
              "task": "Generate one premium cropped image asset for use as a poster, cover, thumbnail, avatar, or gallery image inside an app UI.",
              "assetKind": "\(kind)",
              "coreBrief": "\(prompt.jsonEscaped)",
              "visualIntent": {
                "roleInInterface": "A compact visual asset that works inside rounded cards, circular masks, poster stacks, thumbnail rails, or content previews.",
                "subject": "Use the core brief as the exact subject. Keep the subject readable at small size.",
                "composition": "Strong central focal point, clean crop, useful negative space, balanced edges, no overcrowding.",
                "style": "Editorial, premium, modern, commercially usable, cohesive with a polished mobile UI.",
                "lighting": "Soft controlled lighting and clear depth.",
                "palette": "Limited cohesive palette that can harmonize with nearby UI controls."
              },
              "strictConstraints": {
                "noText": true,
                "noWatermarks": true,
                "noAppScreenshot": true,
                "noPhoneMockup": true,
                "noButtons": true
              },
              "negativePrompt": "readable text, watermark, UI screenshot, phone frame, buttons, menus, clutter, low resolution, bad crop, blurry"
            }
            """
        default:
            return """
            {
              "task": "Generate one premium visual image asset for a designed app screen. The output is an image asset only, not a UI mockup.",
              "assetKind": "\(kind)",
              "coreBrief": "\(prompt.jsonEscaped)",
              "visualIntent": {
                "roleInInterface": "A high-impact asset for a hero section, card, background, artwork tile, product panel, or editorial visual inside a mobile app.",
                "subject": "Follow the core brief precisely. Make the subject category-specific and visually memorable.",
                "composition": "Strong focal point, intentional hierarchy, generous negative space for possible overlay text, no overcrowding, professional crop.",
                "cameraAndFraming": "Design-friendly framing, subject fully intentional in frame, avoid awkward crops, avoid excessive empty corners unless useful for overlay text.",
                "style": "Premium product-design imagery, modern editorial quality, cinematic but clean, commercially usable in a polished app.",
                "lighting": "High-quality controlled lighting, soft gradients, believable highlights, tasteful shadows, no harsh amateur contrast.",
                "palette": "Cohesive palette that can pair with modern UI tokens; avoid random rainbow color, avoid muddy gray unless requested.",
                "textureAndDepth": "Use refined texture, depth, and atmosphere only when it supports the brief. Keep it crisp and usable.",
                "background": "No app chrome. No fake UI. Background may be photographic, abstract, product-studio, environmental, or illustrated according to the core brief."
              },
              "usabilityForUI": {
                "overlaySafety": "Leave some visually calm area for text overlays when the brief sounds like a hero/background.",
                "edgeSafety": "Keep important subject details away from extreme edges.",
                "readability": "Avoid busy patterns behind where UI text may sit.",
                "contentPolicy": "No readable typography inside the generated image unless the user explicitly requested a real-world sign or label."
              },
              "qualityBar": {
                "finish": "Senior art-director quality, polished, coherent, premium.",
                "detailLevel": "Rich enough to feel real and intentional, not generic stock.",
                "artifactControl": "Clean anatomy/objects, no distortions, no malformed hands/faces/products, no duplicated weird details."
              },
              "strictConstraints": {
                "noReadableText": true,
                "noWatermarks": true,
                "noLogosUnlessRequested": true,
                "noPhoneMockups": true,
                "noAppScreenshots": true,
                "noButtonsOrInputFields": true,
                "noNavigationBars": true,
                "noPlaceholderText": true
              },
              "negativePrompt": "readable text, watermark, logo text, app UI, app screenshot, phone mockup, browser chrome, buttons, input fields, navigation bar, placeholder text, low quality, blurry, noisy, distorted objects, generic stock photo, cluttered composition, ugly crop"
            }
            """
        }
    }
    
    /// Parses OpenRouter's 402 message ("...can only afford 3121...") so the
    /// retry asks for what the balance actually covers.
    static func affordableTokens(from message: String) -> Int? {
        guard let range = message.range(of: "afford") else { return nil }
        let tail = message[range.upperBound...]
        let digits = tail.drop { !$0.isNumber }.prefix { $0.isNumber }
        return Int(digits)
    }

    // Draw Things / AUTOMATIC1111-compatible local image generation.
    // Keeps the auto-started bridge alive for the app's lifetime.
    private static var imageBridgeProcess: Process?

    /// If the MFLUX bridge (A1111-compatible, on :7860) isn't already running,
    /// spawn the bundled `mflux_bridge.py` — so local image generation works
    /// out of the box instead of requiring the user to start it by hand.
    private func ensureImageBridge() async {
        if await isPortOpen(7860) { return }
        if let running = Self.imageBridgeProcess, running.isRunning { return }
        guard let scriptURL = Bundle.main.url(forResource: "mflux_bridge", withExtension: "py", subdirectory: "Resources")
                ?? Bundle.main.url(forResource: "mflux_bridge", withExtension: "py"),
              let python = ["/opt/homebrew/bin/python3", "/usr/bin/python3"].first(where: { FileManager.default.isExecutableFile(atPath: $0) })
        else { return }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: python)
        process.arguments = [scriptURL.path]
        do { try process.run(); Self.imageBridgeProcess = process } catch { return }
        // Give the HTTP server a few seconds to bind before the first request.
        for _ in 0..<12 {
            if await isPortOpen(7860) { return }
            try? await Task.sleep(nanoseconds: 500_000_000)
        }
    }

    private func isPortOpen(_ port: UInt16) async -> Bool {
        var req = URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!)
        req.timeoutInterval = 1.5
        do { _ = try await URLSession.shared.data(for: req); return true }
        catch let error as URLError { return error.code != .cannotConnectToHost }
        catch { return true }
    }

    private func generateLocalImage(prompt: String, size: String?) async throws -> String {
        await ensureImageBridge()
        var width = 1024, height = 1024
        if let size, size.lowercased().contains("x"),
           let w = Int(size.lowercased().split(separator: "x")[0]),
           let h = Int(size.lowercased().split(separator: "x")[1]) {
            width = min(w, 1536); height = min(h, 1536)
        }

        var request = URLRequest(url: URL(string: "http://127.0.0.1:7860/sdapi/v1/txt2img")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 300
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "prompt": prompt, "width": width, "height": height, "steps": 8
        ])

        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let images = json["images"] as? [String],
              let base64 = images.first,
              let imageData = Data(base64Encoded: base64)
        else {
            throw AIProviderError.emptyContent
        }

        print("🖼️ Image generated locally (\(width)x\(height))")
        return try saveGeneratedImageData(imageData, preferredExtension: "png")
    }

    private func saveGeneratedImageData(_ data: Data, preferredExtension: String) throws -> String {
        let fileManager = FileManager.default
        let supportDirectory = try fileManager.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let assetsDirectory = supportDirectory
            .appendingPathComponent("AgenticDesigner", isDirectory: true)
            .appendingPathComponent("GeneratedAssets", isDirectory: true)
        
        try fileManager.createDirectory(at: assetsDirectory, withIntermediateDirectories: true)
        
        let sanitizedExtension = preferredExtension
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let fileExtension = sanitizedExtension.isEmpty ? "png" : sanitizedExtension
        let fileURL = assetsDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(fileExtension)
        
        try data.write(to: fileURL, options: .atomic)
        return fileURL.path
    }
    
    private func decodeAgentResponse(from jsonData: Data) throws -> DesignAgentResponse {
        let decoder = JSONDecoder()
        
        do {
            return try decoder.decode(DesignAgentResponse.self, from: jsonData)
        } catch let responseError {
            do {
                let lossy = try decoder.decode([LossyDesignAction].self, from: jsonData)
                let actions = lossy.compactMap(\.action)
                guard !actions.isEmpty else { throw responseError }
                return DesignAgentResponse(
                    plan: ["Provider returned legacy action array; decoded actions directly."],
                    actions: actions
                )
            } catch {
                throw responseError
            }
        }
    }
    
    private func extractJSONCandidates(from content: String) -> [String] {
        let trimmed = content
            .replacingOccurrences(of: "```json", with: "```")
            .replacingOccurrences(of: "```JSON", with: "```")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        
        var candidates = balancedJSONCandidates(in: trimmed)
        
        if candidates.isEmpty {
            candidates = [trimmed]
        }
        
        var seen = Set<String>()
        let uniqueCandidates = candidates.filter { candidate in
            let normalized = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty, !seen.contains(normalized) else { return false }
            seen.insert(normalized)
            return true
        }
        let agentCandidates = uniqueCandidates.filter(isLikelyAgentJSONCandidate)
        
        return (agentCandidates.isEmpty ? uniqueCandidates : agentCandidates).sorted {
            jsonCandidateScore($0) > jsonCandidateScore($1)
        }
    }
    
    private func isLikelyAgentJSONCandidate(_ candidate: String) -> Bool {
        let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
        
        if trimmed.hasPrefix("{") {
            return trimmed.contains("\"actions\"")
        }
        
        if trimmed.hasPrefix("[") {
            return trimmed.contains("\"type\"")
        }
        
        return false
    }
    
    private func balancedJSONCandidates(in text: String) -> [String] {
        let characters = Array(text)
        var candidates: [String] = []
        
        for start in characters.indices where characters[start] == "{" || characters[start] == "[" {
            var stack: [Character] = []
            var isInsideString = false
            var isEscaped = false
            
            for index in start..<characters.count {
                let character = characters[index]
                
                if isInsideString {
                    if isEscaped {
                        isEscaped = false
                    } else if character == "\\" {
                        isEscaped = true
                    } else if character == "\"" {
                        isInsideString = false
                    }
                    continue
                }
                
                if character == "\"" {
                    isInsideString = true
                    continue
                }
                
                if character == "{" {
                    stack.append("}")
                } else if character == "[" {
                    stack.append("]")
                } else if let expectedClose = stack.last, character == expectedClose {
                    stack.removeLast()
                    
                    if stack.isEmpty {
                        candidates.append(String(characters[start...index]))
                        break
                    }
                }
            }
        }
        
        return candidates
    }
    
    private func jsonCandidateScore(_ candidate: String) -> Int {
        var score = candidate.count
        
        if candidate.contains("\"actions\"") {
            score += 1_000_000
        }
        if candidate.contains("\"plan\"") {
            score += 250_000
        }
        if candidate.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("{") {
            score += 10_000
        }
        
        return score
    }
    
    private func repairCommonJSONMistakes(in json: String) -> String {
        var repaired = json.trimmingCharacters(in: .whitespacesAndNewlines)
        
        if repaired.hasPrefix("```"), repaired.hasSuffix("```") {
            repaired = repaired
                .dropFirst(3)
                .dropLast(3)
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        
        // Common model typo: "height": "height": 28
        repaired = repaired.replacingOccurrences(
            of: #""([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*"\1"\s*:"#,
            with: #""$1":"#,
            options: .regularExpression
        )
        
        // Same typo without the opening quote around the repeated key: "width":width": 1
        repaired = repaired.replacingOccurrences(
            of: #""([A-Za-z_][A-Za-z0-9_]*)"\s*:\s*\1"\s*:"#,
            with: #""$1":"#,
            options: .regularExpression
        )
        
        // Remove trailing commas before closing containers.
        repaired = repaired.replacingOccurrences(
            of: #",\s*([}\]])"#,
            with: #"$1"#,
            options: .regularExpression
        )
        
        return repaired
    }
    
    private func decodingDebugMessage(_ error: Error) -> String {
        switch error {
        case let DecodingError.dataCorrupted(context):
            return "\(context.debugDescription) at \(codingPathDescription(context.codingPath))"
        case let DecodingError.keyNotFound(key, context):
            return "Missing key '\(key.stringValue)' at \(codingPathDescription(context.codingPath))"
        case let DecodingError.typeMismatch(type, context):
            return "Type mismatch for \(type): \(context.debugDescription) at \(codingPathDescription(context.codingPath))"
        case let DecodingError.valueNotFound(type, context):
            return "Missing value for \(type): \(context.debugDescription) at \(codingPathDescription(context.codingPath))"
        default:
            return error.localizedDescription
        }
    }
    
    private func codingPathDescription(_ codingPath: [CodingKey]) -> String {
        guard !codingPath.isEmpty else {
            return "root"
        }
        
        return codingPath
            .map { $0.stringValue }
            .joined(separator: ".")
    }
    
    private func extractErrorMessage(from data: Data) -> String {
        let fallback = String(data: data, encoding: .utf8) ?? "No response body"
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let errorInfo = json["error"] as? [String: Any] else {
            return fallback
        }
        
        if let metadata = errorInfo["metadata"] as? [String: Any],
           let raw = metadata["raw"] as? String, !raw.isEmpty {
            if let rawData = raw.data(using: .utf8),
               let rawJson = try? JSONSerialization.jsonObject(with: rawData) as? [String: Any],
               let innerError = rawJson["error"] as? [String: Any],
               let innerMessage = innerError["message"] as? String {
                return innerMessage
            }
            return raw
        }
        
        if let message = errorInfo["message"] as? String, !message.isEmpty {
            return message
        }
        
        return fallback
    }
}

extension OpenRouterProvider {

    /// Hard PROMPT ceiling this account is subject to, learned the first time
    /// OpenRouter rejects a turn for it. nil until something gets rejected.
    nonisolated(unsafe) static var learnedPromptTokenCeiling: Int?

    /// Output reservation this balance can actually afford, learned from a 402.
    /// Applied up-front so every later turn doesn't repeat the same rejection.
    nonisolated(unsafe) static var learnedOutputTokenCeiling: Int?

    static func resetLearnedTokenCeilings() {
        learnedPromptTokenCeiling = nil
        learnedOutputTokenCeiling = nil
    }

    /// Distinguishes an exhausted allowance from a momentary rate limit.
    /// Google says "You exceeded your current quota"; OpenRouter says
    /// "rate-limited upstream" / "daily limit"; a plain per-minute throttle
    /// usually says "too many requests" and IS worth retrying.
    static func isQuotaExhausted(_ message: String) -> Bool {
        let text = message.lowercased()
        // "free-models-per-day" is OpenRouter's daily cap and contains no
        // "quota" at all — matching only on that word missed it entirely.
        let exhausted = ["exceeded your current quota", "quota exceeded", "insufficient_quota",
                         "daily limit", "out of credits", "exhausted",
                         "per-day", "per day", "daily quota"]
        if exhausted.contains(where: text.contains) { return true }
        // "quota" alone counts only when it isn't phrased as a short throttle.
        return text.contains("quota") && !text.contains("per minute") && !text.contains("try again in")
    }

    /// Parses `Prompt tokens limit exceeded: 17434 > 15878`.
    static func parsePromptTokenLimit(from message: String) -> (actual: Int, limit: Int)? {
        guard message.lowercased().contains("prompt tokens limit") else { return nil }
        let numbers = message
            .components(separatedBy: CharacterSet.decimalDigits.inverted)
            .compactMap(Int.init)
        guard numbers.count >= 2 else { return nil }
        return (actual: numbers[0], limit: numbers[1])
    }

    /// Only Anthropic requires caller-placed breakpoints; other providers on
    /// OpenRouter cache prefixes automatically (or not at all), and sending
    /// cache_control to them is at best ignored.
    var supportsExplicitPromptCaching: Bool {
        let model = resolvedModelName.lowercased()
        return model.contains("claude") || model.contains("anthropic")
    }

    /// Anthropic allows up to 4 breakpoints; everything BEFORE a breakpoint is
    /// cached. Two are enough here: the system prompt (large, byte-identical
    /// every turn) and the settled head of the conversation, leaving the newest
    /// exchanges live so a growing transcript keeps extending the cached prefix.
    static func markingCacheBreakpoints(_ messages: [[String: Any]]) -> [[String: Any]] {
        var result = messages
        var breakpoints: [Int] = []

        if let systemIndex = result.lastIndex(where: { ($0["role"] as? String) == "system" }) {
            breakpoints.append(systemIndex)
        }
        // Everything except the two newest messages counts as settled history.
        let settledEnd = result.count - 3
        if settledEnd > (breakpoints.last ?? -1) {
            breakpoints.append(settledEnd)
        }

        for index in breakpoints where result.indices.contains(index) {
            result[index] = markedForCaching(result[index])
        }
        return result
    }

    /// cache_control lives on a content BLOCK, so a plain string body has to be
    /// promoted to block form first. Messages with no textual content (an
    /// assistant turn that is only tool_calls) are left untouched — there is
    /// nothing there to cache and providers reject an empty block array.
    private static func markedForCaching(_ message: [String: Any]) -> [String: Any] {
        var message = message
        let cacheControl: [String: Any] = ["type": "ephemeral"]

        if let text = message["content"] as? String, !text.isEmpty {
            message["content"] = [["type": "text", "text": text, "cache_control": cacheControl]]
        } else if var blocks = message["content"] as? [[String: Any]], !blocks.isEmpty {
            blocks[blocks.count - 1]["cache_control"] = cacheControl
            message["content"] = blocks
        }
        return message
    }
}

struct OpenRouterChatRequest: Encodable {
    let model: String
    let messages: [OpenRouterMessage]
    let temperature: Double
    let responseFormat: OpenRouterResponseFormat?
    // Cap the output reservation. Without this OpenRouter reserves the
    // model's FULL output ceiling (65k on some models) against the account
    // balance and low-credit accounts get HTTP 402 for requests that would
    // actually cost cents.
    var maxTokens: Int? = nil

    private enum CodingKeys: String, CodingKey {
        case model
        case messages
        case temperature
        case responseFormat = "response_format"
        case maxTokens = "max_tokens"
    }
}

struct OpenRouterResponseFormat: Encodable {
    let type: String
}

private struct OpenRouterImageRequest: Encodable {
    let model: String
    let prompt: String
    let size: String?
    let aspectRatio: String?
    let resolution: String?
    
    private enum CodingKeys: String, CodingKey {
        case model
        case prompt
        case size
        case aspectRatio = "aspect_ratio"
        case resolution
    }
}

private struct OpenRouterImageResponse: Decodable {
    let data: [OpenRouterImageData]
}

private struct OpenRouterImageData: Decodable {
    let b64Json: String?
    let url: String?
    
    private enum CodingKeys: String, CodingKey {
        case b64Json = "b64_json"
        case url
    }
}

struct OpenRouterMessage: Codable {
    let role: String
    let content: String
    var imageDataURLs: [String] = []
    // Function-calling round trip (the agent tool loop): an assistant message
    // that requested tools echoes them back via `toolCalls`; a "tool" role
    // message carries the result for `toolCallId`.
    var toolCallId: String? = nil
    var toolCalls: [OpenRouterMessageToolCall]? = nil

    init(role: String, content: String, imageDataURLs: [String] = [],
         toolCallId: String? = nil, toolCalls: [OpenRouterMessageToolCall]? = nil) {
        self.role = role
        self.content = content
        self.imageDataURLs = imageDataURLs
        self.toolCallId = toolCallId
        self.toolCalls = toolCalls
    }

    private enum CodingKeys: String, CodingKey {
        case role
        case content
        case toolCallId = "tool_call_id"
        case toolCalls = "tool_calls"
    }

    private struct ContentPart: Encodable {
        struct ImageURL: Encodable {
            let url: String
        }

        let type: String
        let text: String?
        let imageURL: ImageURL?

        private enum CodingKeys: String, CodingKey {
            case type
            case text
            case imageURL = "image_url"
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        role = try container.decode(String.self, forKey: .role)
        content = (try? container.decode(String.self, forKey: .content)) ?? ""
        imageDataURLs = []
        toolCallId = try? container.decodeIfPresent(String.self, forKey: .toolCallId)
        toolCalls = try? container.decodeIfPresent([OpenRouterMessageToolCall].self, forKey: .toolCalls)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(role, forKey: .role)
        try container.encodeIfPresent(toolCallId, forKey: .toolCallId)
        if let toolCalls, !toolCalls.isEmpty {
            try container.encode(toolCalls, forKey: .toolCalls)
        }

        guard !imageDataURLs.isEmpty else {
            try container.encode(content, forKey: .content)
            return
        }

        var parts = [ContentPart(type: "text", text: content, imageURL: nil)]
        parts.append(contentsOf: imageDataURLs.map {
            ContentPart(type: "image_url", text: nil, imageURL: .init(url: $0))
        })
        try container.encode(parts, forKey: .content)
    }
}

/// One requested function call, in OpenAI/OpenRouter wire shape:
/// {"id","type":"function","function":{"name","arguments"}} — `arguments` is a
/// JSON string. Decoding tolerates providers (some Ollama builds) that send
/// `arguments` as a raw object instead of a string.
struct OpenRouterMessageToolCall: Codable {
    let id: String
    let name: String
    let arguments: String
    /// Opaque provider-specific payload that came back with this tool call and
    /// MUST be echoed on the next turn. Gemini puts a `thought_signature`
    /// here and rejects the follow-up request without it:
    ///   400 "Function call is missing a thought_signature in functionCall
    ///        parts. This is required for tools to work correctly."
    /// Dropping it made every agent turn after the first one fail, which the
    /// UI reported only as "Stopped after 3 failed model attempts".
    let extraContentJSON: String?

    init(id: String, name: String, arguments: String, extraContentJSON: String? = nil) {
        self.id = id
        self.name = name
        self.arguments = arguments
        self.extraContentJSON = extraContentJSON
    }

    private enum CodingKeys: String, CodingKey { case id, type, function, extraContent = "extra_content" }
    private enum FunctionKeys: String, CodingKey { case name, arguments }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decodeIfPresent(String.self, forKey: .id) ?? UUID().uuidString
        let function = try container.nestedContainer(keyedBy: FunctionKeys.self, forKey: .function)
        name = try function.decode(String.self, forKey: .name)
        if let s = try? function.decode(String.self, forKey: .arguments) {
            arguments = s
        } else if let obj = try? function.decode(JSONFragment.self, forKey: .arguments) {
            arguments = obj.rawJSON
        } else {
            arguments = "{}"
        }
        extraContentJSON = (try? container.decode(JSONFragment.self, forKey: .extraContent))?.rawJSON
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(id, forKey: .id)
        try container.encode("function", forKey: .type)
        var function = container.nestedContainer(keyedBy: FunctionKeys.self, forKey: .function)
        try function.encode(name, forKey: .name)
        try function.encode(arguments, forKey: .arguments)

        // Re-emit the provider's opaque blob byte-for-byte.
        if let extraContentJSON,
           let data = extraContentJSON.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) {
            try container.encode(JSONEncodableValue(object), forKey: .extraContent)
        }
    }
}

/// Encodes an already-parsed JSON value (from JSONSerialization) back out
/// through Codable, so opaque provider payloads survive a round trip.
struct JSONEncodableValue: Encodable {
    private let value: Any
    init(_ value: Any) { self.value = value }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try Self.encode(value, into: &container)
    }

    private static func encode(_ value: Any, into container: inout SingleValueEncodingContainer) throws {
        switch value {
        case let dictionary as [String: Any]:
            try container.encode(dictionary.mapValues(JSONEncodableValue.init))
        case let array as [Any]:
            try container.encode(array.map(JSONEncodableValue.init))
        case let string as String: try container.encode(string)
        case let bool as Bool: try container.encode(bool)
        case let int as Int: try container.encode(int)
        case let double as Double: try container.encode(double)
        case let number as NSNumber: try container.encode(number.doubleValue)
        default: try container.encodeNil()
        }
    }
}

/// Decodes any JSON value and preserves it as a compact JSON string — used to
/// accept `arguments` objects from providers that don't string-encode them.
struct JSONFragment: Decodable {
    let rawJSON: String

    init(from decoder: Decoder) throws {
        let value = try Self.decodeValue(from: decoder)
        if JSONSerialization.isValidJSONObject(value),
           let data = try? JSONSerialization.data(withJSONObject: value) {
            rawJSON = String(data: data, encoding: .utf8) ?? "{}"
        } else {
            rawJSON = "{}"
        }
    }

    private static func decodeValue(from decoder: Decoder) throws -> Any {
        if let keyed = try? decoder.container(keyedBy: DynamicKey.self) {
            var dict: [String: Any] = [:]
            for key in keyed.allKeys {
                let nested = try keyed.superDecoder(forKey: key)
                dict[key.stringValue] = try decodeValue(from: nested)
            }
            return dict
        }
        if var unkeyed = try? decoder.unkeyedContainer() {
            var array: [Any] = []
            while !unkeyed.isAtEnd {
                array.append(try decodeValue(from: try unkeyed.superDecoder()))
            }
            return array
        }
        let single = try decoder.singleValueContainer()
        if let b = try? single.decode(Bool.self) { return b }
        if let i = try? single.decode(Int.self) { return i }
        if let d = try? single.decode(Double.self) { return d }
        if let s = try? single.decode(String.self) { return s }
        return NSNull()
    }

    private struct DynamicKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { return nil }
    }
}

private extension String {
    var jsonEscaped: String {
        self
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "\\r")
            .replacingOccurrences(of: "\t", with: "\\t")
    }
}

private struct OpenRouterChatResponse: Decodable {
    let choices: [OpenRouterChoice]?
    let error: OpenRouterAPIError?
    let usage: OpenRouterUsage?
}

private struct OpenRouterUsage: Decodable {
    let promptTokens: Int?
    let completionTokens: Int?
    let cost: Double?

    private enum CodingKeys: String, CodingKey {
        case promptTokens = "prompt_tokens"
        case completionTokens = "completion_tokens"
        case cost
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        promptTokens = try? container.decodeIfPresent(Int.self, forKey: .promptTokens)
        completionTokens = try? container.decodeIfPresent(Int.self, forKey: .completionTokens)
        if let numericCost = try? container.decodeIfPresent(Double.self, forKey: .cost) {
            cost = numericCost
        } else if let stringCost = try? container.decodeIfPresent(String.self, forKey: .cost) {
            cost = Double(stringCost)
        } else {
            cost = nil
        }
    }
}

private struct OpenRouterChoice: Decodable {
    let message: OpenRouterResponseMessage?
    let delta: OpenRouterResponseMessage?
    let text: String?
    let directContent: String?

    var content: String? {
        message?.content ?? delta?.content ?? text ?? directContent
    }

    var toolCalls: [OpenRouterMessageToolCall] {
        message?.toolCalls ?? delta?.toolCalls ?? []
    }

    private enum CodingKeys: String, CodingKey {
        case message
        case delta
        case text
        case directContent = "content"
    }
}

private struct OpenRouterResponseMessage: Decodable {
    let role: String?
    let content: String?
    let toolCalls: [OpenRouterMessageToolCall]?

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        role = try container.decodeIfPresent(String.self, forKey: .role)
        content = try container.decodeFlexibleContentIfPresent(forKey: .content)
        toolCalls = try? container.decodeIfPresent([OpenRouterMessageToolCall].self, forKey: .toolCalls)
    }

    private enum CodingKeys: String, CodingKey {
        case role
        case content
        case toolCalls = "tool_calls"
    }
}

private struct OpenRouterAPIError: Decodable {
    let message: String
    
    init(from decoder: Decoder) throws {
        let singleValue = try decoder.singleValueContainer()
        
        if let message = try? singleValue.decode(String.self) {
            self.message = message
            return
        }
        
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedMessage = try container.decodeFlexibleContentIfPresent(forKey: .message)
        let code = try container.decodeFlexibleContentIfPresent(forKey: .code)
        self.message = [decodedMessage, code.map { "code: \($0)" }]
            .compactMap { $0 }
            .joined(separator: " ")
    }
    
    private enum CodingKeys: String, CodingKey {
        case message
        case code
    }
}

private struct OpenRouterContentPart: Decodable {
    let type: String?
    let text: String?
    let content: String?
}

private struct FlexibleOpenRouterContentValue: Decodable {
    let stringValue: String?
    
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        
        if container.decodeNil() {
            stringValue = nil
        } else if let value = try? container.decode(String.self) {
            stringValue = value
        } else if let value = try? container.decode([OpenRouterContentPart].self) {
            let joined = value
                .compactMap { $0.text ?? $0.content }
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            stringValue = joined.isEmpty ? nil : joined
        } else if let value = try? container.decode(Bool.self) {
            stringValue = value ? "true" : "false"
        } else if let value = try? container.decode(Int.self) {
            stringValue = String(value)
        } else if let value = try? container.decode(Double.self) {
            stringValue = String(value)
        } else if let value = try? container.decode([String: FlexibleOpenRouterContentValue].self) {
            stringValue = Self.jsonString(from: value)
        } else if let value = try? container.decode([FlexibleOpenRouterContentValue].self) {
            stringValue = Self.jsonString(from: value)
        } else {
            stringValue = nil
        }
    }
    
    private static func jsonString(from object: [String: FlexibleOpenRouterContentValue]) -> String? {
        let jsonObject = object.reduce(into: [String: Any]()) { result, item in
            result[item.key] = item.value.jsonObject
        }
        
        return serializedJSONString(from: jsonObject)
    }
    
    private static func jsonString(from array: [FlexibleOpenRouterContentValue]) -> String? {
        serializedJSONString(from: array.map(\.jsonObject))
    }
    
    private static func serializedJSONString(from object: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let string = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        
        return string
    }
    
    private var jsonObject: Any {
        stringValue ?? NSNull()
    }
}

private extension KeyedDecodingContainer {
    func decodeFlexibleContentIfPresent(forKey key: Key) throws -> String? {
        guard let value = try? decodeIfPresent(FlexibleOpenRouterContentValue.self, forKey: key) else {
            return nil
        }
        
        return value.stringValue
    }
}
