//
//  OpenRouterConfiguration.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

enum OpenRouterConfiguration {
    static let model = "google/gemini-2.5-pro"
    static let imageModel = "bytedance-seed/seedream-4.5"

    // Models offered in the Agent panel picker. Any OpenRouter chat model id works;
    // the vision critic requires a model that accepts image input (all of these do).
    static let availableModels: [(id: String, label: String)] = [
        ("google/gemini-2.5-pro", "Gemini 2.5 Pro — best balance"),
        ("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5 — best design taste"),
        ("openai/gpt-5.6-sol-pro", "GPT-5.6 Sol Pro — top-tier reasoning"),
        ("moonshotai/kimi-k3", "Kimi K3 — strong agentic reasoning"),
        ("x-ai/grok-4.5", "Grok 4.5 — strong reasoning, vision"),
        ("google/gemini-2.5-flash", "Gemini 2.5 Flash — fastest"),
        ("openai/gpt-5-nano", "GPT-5 Nano — best performance"),
        ("local/qwen3-vl:32b", "LOCAL Qwen3-VL 32B — smartest on-device, vision"),
        ("local/gemma4:26b-mlx", "LOCAL Gemma 4 26B (MLX) — on-device, vision"),
        ("openrouter/free", "Free Router — auto-picks a capable free model"),
        ("nvidia/nemotron-3-ultra-550b-a55b:free", "Nemotron 3 Ultra 550B — FREE (no vision)"),
        ("meta-llama/llama-3.3-70b-instruct:free", "Llama 3.3 70B — FREE (no vision)"),
        ("google/gemma-4-31b-it:free", "Gemma 4 31B — FREE (reads images)"),
        ("google/gemma-4-26b-a4b-it:free", "Gemma 4 26B — FREE (reads images)"),
        ("nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "Nemotron 3 Omni 30B — FREE (reads images)"),
        ("nvidia/nemotron-nano-12b-v2-vl:free", "Nemotron Nano 12B VL — FREE (reads images)"),
        ("mistralai/mistral-small-3.1-24b-instruct:free", "Mistral Small 3.1 — FREE")
    ] + ModelProviderCatalog.freeModels
    // ↑ Direct-to-vendor free tiers (Cerebras / Groq / Google AI Studio /
    // NVIDIA). These use their OWN key and their OWN quota, so an exhausted
    // OpenRouter balance doesn't touch them — which is the point.

    
    static func apiKey(userProvidedKey: String) -> String? {
        let userKey = userProvidedKey.trimmingCharacters(in: .whitespacesAndNewlines)
        
        if !userKey.isEmpty {
            return userKey
        }
        
        let environmentKey = ProcessInfo.processInfo.environment["OPENROUTER_API_KEY"]?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        
        return environmentKey?.isEmpty == false ? environmentKey : nil
    }
}
