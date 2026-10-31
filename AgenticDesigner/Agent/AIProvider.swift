//
//  AIProvider.swift
//  AgenticDesigner
//
//  Created by ariel sofer on 03/07/2026.
//

import Foundation

protocol AIProvider {
    func generateActions(
        systemPrompt: String,
        userPrompt: String
    ) async throws -> [DesignAction]
}

enum AIProviderError: LocalizedError {
    case missingAPIKey
    case needsCloudKey(model: String)
    case invalidResponse
    case httpError(statusCode: Int, message: String)
    case emptyContent
    case invalidJSON(String)
    /// A low-credit OpenRouter account gets a hard PROMPT ceiling. Distinct
    /// from a generic 402 because the fix is to shrink the conversation, not
    /// the output reservation.
    case promptTooLarge(actual: Int, limit: Int)
    /// A free tier's allowance is spent. Distinct from a transient rate limit:
    /// retrying the same provider cannot succeed, so the loop must switch.
    case quotaExceeded(provider: String, detail: String)
    /// The route exists but its configured credential is missing, expired or
    /// rejected. The loop can continue on another configured provider instead
    /// of repeating the same impossible request three times.
    case providerUnavailable(provider: String, detail: String)
    /// Transient congestion on a shared free model. Worth retrying — but only
    /// if there is nothing else to switch to, because a different provider is
    /// far likelier to answer than the same congested one moments later.
    case rateLimited(provider: String, detail: String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            return "Missing OpenRouter API key."
        case let .needsCloudKey(model):
            return "“\(model)” is a cloud model and needs a valid OpenRouter API key — paste one in the key field, or pick a local model (Gemma / Qwen) which runs on-device with no key."
        case .invalidResponse:
            return "Invalid response from AI provider."
        case let .httpError(statusCode, message):
            return "OpenRouter returned HTTP \(statusCode): \(message)"
        case .emptyContent:
            return "OpenRouter returned an empty response."
        case let .rateLimited(provider, detail):
            return "\(provider) is rate-limited right now. (\(detail.prefix(120)))"
        case let .quotaExceeded(provider, detail):
            return "\(provider) quota exhausted — switching to another free provider. (\(detail.prefix(120)))"
        case let .providerUnavailable(provider, detail):
            return "\(provider) is not authenticated — switching to another configured provider. (\(detail.prefix(120)))"
        case let .promptTooLarge(actual, limit):
            return "Prompt is \(actual) tokens but this account allows \(limit) — compacting the conversation and retrying. Add credits at openrouter.ai/settings/credits to raise the ceiling."
        case let .invalidJSON(message):
            return "Could not decode DesignAction JSON: \(message)"
        }
    }
}
