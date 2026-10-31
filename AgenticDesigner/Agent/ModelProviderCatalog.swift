//
//  ModelProviderCatalog.swift
//  AgenticDesigner
//
//  Multi-provider routing, in the spirit of OmniRoute: instead of one account
//  whose credit ceiling can stop a run dead, a model id carries its own
//  provider prefix and the loop can fall through to the next provider when one
//  is out of quota.
//
//  Every route here is an OFFICIAL free tier with a published quota, reached at
//  the vendor's own OpenAI-compatible endpoint with the user's own key. What is
//  deliberately NOT here: services that re-expose frontier models "free, no key"
//  by proxying someone else's paid capacity, and anything that drives a
//  consumer web session (ChatGPT/Claude.ai) as if it were an API. Those break
//  the upstream terms of service, and an app that ships them hands its users
//  an account ban rather than a feature.
//

import Foundation

struct ModelProviderRoute: Identifiable {
    /// Prefix used in model ids: "cerebras/qwen-3-235b" → route "cerebras".
    let id: String
    let name: String
    let chatEndpoint: URL
    /// nil for a keyless local server.
    let environmentVariable: String?
    /// UserDefaults key holding a user-pasted key for this provider.
    let defaultsKey: String?
    /// Shown in the Agent panel so the quota is visible before it runs out.
    let freeTierNote: String

    var requiresKey: Bool { environmentVariable != nil }

    /// Every one of these providers exposes the OpenAI-compatible model list
    /// next to the chat endpoint — verified by probe: Cerebras/Groq 401,
    /// Gemini 400, NVIDIA 200 (public). None 404, so the paths are right.
    var modelsEndpoint: URL {
        URL(string: chatEndpoint.absoluteString
            .replacingOccurrences(of: "chat/completions", with: "models"))
            ?? chatEndpoint
    }

    /// User-pasted key first, then the environment. Local routes need neither.
    func resolvedKey() -> String? {
        if let defaultsKey,
           let stored = UserDefaults.standard.string(forKey: defaultsKey)?
               .trimmingCharacters(in: .whitespacesAndNewlines),
           !stored.isEmpty {
            return stored
        }
        if let environmentVariable,
           let env = ProcessInfo.processInfo.environment[environmentVariable]?
               .trimmingCharacters(in: .whitespacesAndNewlines),
           !env.isEmpty {
            return env
        }
        return requiresKey ? nil : "local"
    }

    var isConfigured: Bool { resolvedKey() != nil }
}

enum ModelProviderCatalog {

    static let openRouterId = "openrouter"
    static let localId = "local"

    static let routes: [ModelProviderRoute] = [
        ModelProviderRoute(
            id: localId,
            name: "Local (Ollama / LM Studio)",
            chatEndpoint: URL(string: "http://127.0.0.1:11434/v1/chat/completions")!,
            environmentVariable: nil,
            defaultsKey: nil,
            freeTierNote: "Unlimited — runs on this Mac, no key, no ceiling."
        ),
        ModelProviderRoute(
            id: "cerebras",
            name: "Cerebras",
            chatEndpoint: URL(string: "https://api.cerebras.ai/v1/chat/completions")!,
            environmentVariable: "CEREBRAS_API_KEY",
            defaultsKey: "cerebrasAPIKey",
            freeTierNote: "Free tier ~1M tokens/day. Fastest inference available; text only."
        ),
        ModelProviderRoute(
            id: "groq",
            name: "Groq",
            chatEndpoint: URL(string: "https://api.groq.com/openai/v1/chat/completions")!,
            environmentVariable: "GROQ_API_KEY",
            defaultsKey: "groqAPIKey",
            freeTierNote: "Free tier with generous daily request + token limits."
        ),
        ModelProviderRoute(
            id: "gemini",
            name: "Google AI Studio",
            chatEndpoint: URL(string: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions")!,
            environmentVariable: "GEMINI_API_KEY",
            defaultsKey: "geminiAPIKey",
            freeTierNote: "Free tier with a daily request quota. Accepts images — usable as the vision critic."
        ),
        ModelProviderRoute(
            // "nim", NOT "nvidia": OpenRouter already publishes ids under the
            // nvidia/ namespace (nvidia/nemotron-…:free), and stealing that
            // prefix would silently send those to the wrong endpoint.
            id: "nim",
            name: "NVIDIA NIM",
            chatEndpoint: URL(string: "https://integrate.api.nvidia.com/v1/chat/completions")!,
            environmentVariable: "NVIDIA_API_KEY",
            defaultsKey: "nvidiaAPIKey",
            freeTierNote: "Free credits across 100+ hosted models."
        ),
        ModelProviderRoute(
            id: openRouterId,
            name: "OpenRouter",
            chatEndpoint: URL(string: "https://openrouter.ai/api/v1/chat/completions")!,
            environmentVariable: "OPENROUTER_API_KEY",
            defaultsKey: "openRouterAPIKey",
            freeTierNote: "Aggregator: paid models plus :free variants. Credit balance also caps PROMPT size."
        )
    ]

    static func route(for modelId: String) -> ModelProviderRoute {
        // The ":free" suffix is OpenRouter's own convention for a free variant,
        // so such an id is always theirs no matter what vendor prefix it wears.
        guard !modelId.hasSuffix(":free") else {
            return routes.first { $0.id == openRouterId }!
        }
        // "cerebras/qwen-3-235b" → cerebras. A bare "vendor/model" id that
        // matches no route is an OpenRouter id (that is its native format).
        if let prefix = modelId.split(separator: "/").first.map(String.init),
           let match = routes.first(where: { $0.id == prefix }) {
            return match
        }
        return routes.first { $0.id == openRouterId }!
    }

    /// The model name to send upstream — the route prefix is ours, not theirs.
    /// OpenRouter is the exception: it *wants* the full "vendor/model" id.
    static func upstreamModelName(for modelId: String) -> String {
        let route = self.route(for: modelId)
        guard route.id != openRouterId else { return modelId }
        return String(modelId.dropFirst(route.id.count + 1))
    }

    /// Free-tier models worth routing to, newest-capable first. Ids carry the
    /// route prefix so a single string picks both provider and model.
    static let freeModels: [(id: String, label: String)] = [
        ("cerebras/qwen-3-235b-a22b-instruct", "Cerebras Qwen3 235B — FREE, fastest (no vision)"),
        ("cerebras/gpt-oss-120b", "Cerebras GPT-OSS 120B — FREE, very fast (no vision)"),
        ("groq/llama-3.3-70b-versatile", "Groq Llama 3.3 70B — FREE, fast (no vision)"),
        // Verified against a live key: the "-latest" aliases generate, while
        // pinned ids like gemini-2.5-flash / -flash-lite now 404 with "no
        // longer available to new users" EVEN THOUGH /models still lists them.
        // Aliases also can't go stale the way a pinned id does.
        ("gemini/gemini-flash-latest", "Google Gemini Flash — FREE tier, fast, reads images"),
        ("gemini/gemini-pro-latest", "Google Gemini Pro — FREE tier, strongest, reads images"),
        // Verified against NVIDIA's public /v1/models list — the id this
        // originally shipped with ("nemotron-3-ultra-550b") does not exist.
        ("nim/nvidia/llama-3.1-nemotron-ultra-253b-v1", "NVIDIA Nemotron Ultra 253B — FREE credits (no vision)")
    ]

    /// OpenRouter `:free` models used as last-resort fallbacks. Vision-capable
    /// ones first, so a run that depends on screenshots keeps working.
    static let openRouterFreeFallbacks = [
        "google/gemma-4-31b-it:free",
        "nvidia/nemotron-nano-12b-v2-vl:free",
        "meta-llama/llama-3.3-70b-instruct:free"
    ]

    /// Ordered fallback chain for one requested model: the model itself first,
    /// then every OTHER configured route's default free model. This is the
    /// OmniRoute idea that matters here — one provider running out of quota
    /// should cost a retry, not the whole run.
    static func fallbackChain(startingWith modelId: String) -> [String] {
        var chain = [modelId]
        let startRoute = route(for: modelId).id

        // Gemini's Flash and Pro free-tier aliases are separate model choices
        // in the product and can have different availability/rate limits. If
        // the user picked one, try its sibling before leaving Google AI Studio.
        if startRoute == "gemini" {
            for candidate in freeModels
                where route(for: candidate.id).id == startRoute && candidate.id != modelId {
                chain.append(candidate.id)
            }
        }

        // Free tiers first: they cost nothing to try.
        for candidate in freeModels where route(for: candidate.id).id != startRoute {
            guard route(for: candidate.id).isConfigured else { continue }
            chain.append(candidate.id)
        }
        // OpenRouter's own :free variants are a second pool with an INDEPENDENT
        // allowance, reachable with the key most users already have. Without
        // these, someone who configured only one direct vendor has an empty
        // chain the moment that vendor's daily quota runs out.
        if startRoute != openRouterId,
           routes.first(where: { $0.id == openRouterId })?.isConfigured == true {
            chain.append(contentsOf: openRouterFreeFallbacks)
        }
        // A local model is the last resort that can never run out.
        if startRoute != localId,
           let localFallback = UserDefaults.standard.string(forKey: "localFallbackModel"),
           !localFallback.isEmpty {
            chain.append(localFallback)
        }
        return chain
    }

    /// Providers the user has actually set up — surfaced in the Agent panel so
    /// "why did it stop" has a visible answer.
    static var configuredRoutes: [ModelProviderRoute] {
        routes.filter(\.isConfigured)
    }

    // MARK: - Live model discovery

    /// Asks the provider what it can actually run. This is what keeps the app
    /// honest: a hardcoded model id is a guess that silently 404s at the worst
    /// moment (the shipped NVIDIA id was wrong exactly this way), and it also
    /// means the user never has to know or type a model name.
    static func fetchModels(for route: ModelProviderRoute) async throws -> [String] {
        guard let key = route.resolvedKey() else {
            throw GitSyncError.message("No key set for \(route.name).")
        }
        var request = URLRequest(url: route.modelsEndpoint)
        request.timeoutInterval = 30
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw GitSyncError.message("No response from \(route.name).")
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            // The provider's own wording is far more useful than ours: it says
            // "Wrong API Key" vs "quota exceeded" vs "region not supported".
            throw GitSyncError.message("\(route.name) returned \(http.statusCode): \(body.prefix(160))")
        }

        struct ModelList: Decodable {
            struct Entry: Decodable { let id: String }
            let data: [Entry]
        }
        let decoded = try JSONDecoder().decode(ModelList.self, from: data)
        return decoded.data.map(\.id).sorted()
    }

    /// Cache key for a route's discovered models, so the picker can offer them
    /// after the first successful test without re-fetching every launch.
    static func cachedModelsKey(_ route: ModelProviderRoute) -> String {
        "discoveredModels.\(route.id)"
    }

    static func cachedModels(for route: ModelProviderRoute) -> [String] {
        UserDefaults.standard.stringArray(forKey: cachedModelsKey(route)) ?? []
    }

    static func storeModels(_ models: [String], for route: ModelProviderRoute) {
        UserDefaults.standard.set(models, forKey: cachedModelsKey(route))
    }

    /// Where to get a free key, one click from the panel.
    static func signupURL(for route: ModelProviderRoute) -> URL? {
        switch route.id {
        case "cerebras": return URL(string: "https://cloud.cerebras.ai/")
        case "groq":     return URL(string: "https://console.groq.com/keys")
        case "gemini":   return URL(string: "https://aistudio.google.com/apikey")
        case "nim":      return URL(string: "https://build.nvidia.com/")
        case openRouterId: return URL(string: "https://openrouter.ai/settings/keys")
        default: return nil
        }
    }
}
