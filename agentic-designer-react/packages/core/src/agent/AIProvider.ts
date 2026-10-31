// Ported 1:1 from AgenticDesigner/Agent/AIProvider.swift

import type { DesignAction } from './DesignAction';

export interface AIProvider {
  generateActions(systemPrompt: string, userPrompt: string): Promise<DesignAction[]>;
}

/** Swift's `String.prefix(_:)` — grapheme-ish (code points), not UTF-16 units. */
function prefix(text: string, count: number): string {
  return Array.from(text).slice(0, count).join('');
}

export type AIProviderErrorCase =
  | { kind: 'missingAPIKey' }
  | { kind: 'needsCloudKey'; model: string }
  | { kind: 'invalidResponse' }
  | { kind: 'httpError'; statusCode: number; message: string }
  | { kind: 'emptyContent' }
  | { kind: 'invalidJSON'; message: string }
  /**
   * A low-credit OpenRouter account gets a hard PROMPT ceiling. Distinct
   * from a generic 402 because the fix is to shrink the conversation, not
   * the output reservation.
   */
  | { kind: 'promptTooLarge'; actual: number; limit: number }
  /**
   * A free tier's allowance is spent. Distinct from a transient rate limit:
   * retrying the same provider cannot succeed, so the loop must switch.
   */
  | { kind: 'quotaExceeded'; provider: string; detail: string }
  /**
   * The route exists but its configured credential is missing, expired or
   * rejected. The loop can continue on another configured provider instead
   * of repeating the same impossible request three times.
   */
  | { kind: 'providerUnavailable'; provider: string; detail: string }
  /**
   * Transient congestion on a shared free model. Worth retrying — but only
   * if there is nothing else to switch to, because a different provider is
   * far likelier to answer than the same congested one moments later.
   */
  | { kind: 'rateLimited'; provider: string; detail: string };

export class AIProviderError extends Error {
  readonly errorCase: AIProviderErrorCase;

  constructor(errorCase: AIProviderErrorCase) {
    super(AIProviderError.errorDescription(errorCase));
    this.name = 'AIProviderError';
    this.errorCase = errorCase;
  }

  /** `var errorDescription: String?` (also `localizedDescription`). */
  get errorDescription(): string {
    return AIProviderError.errorDescription(this.errorCase);
  }

  get localizedDescription(): string {
    return this.errorDescription;
  }

  static errorDescription(errorCase: AIProviderErrorCase): string {
    switch (errorCase.kind) {
      case 'missingAPIKey':
        return 'Missing OpenRouter API key.';
      case 'needsCloudKey':
        return `“${errorCase.model}” is a cloud model and needs a valid OpenRouter API key — paste one in the key field, or pick a local model (Gemma / Qwen) which runs on-device with no key.`;
      case 'invalidResponse':
        return 'Invalid response from AI provider.';
      case 'httpError':
        return `OpenRouter returned HTTP ${errorCase.statusCode}: ${errorCase.message}`;
      case 'emptyContent':
        return 'OpenRouter returned an empty response.';
      case 'rateLimited':
        return `${errorCase.provider} is rate-limited right now. (${prefix(errorCase.detail, 120)})`;
      case 'quotaExceeded':
        return `${errorCase.provider} quota exhausted — switching to another free provider. (${prefix(errorCase.detail, 120)})`;
      case 'providerUnavailable':
        return `${errorCase.provider} is not authenticated — switching to another configured provider. (${prefix(errorCase.detail, 120)})`;
      case 'promptTooLarge':
        return `Prompt is ${errorCase.actual} tokens but this account allows ${errorCase.limit} — compacting the conversation and retrying. Add credits at openrouter.ai/settings/credits to raise the ceiling.`;
      case 'invalidJSON':
        return `Could not decode DesignAction JSON: ${errorCase.message}`;
    }
  }

  static is(error: unknown): error is AIProviderError {
    return error instanceof AIProviderError;
  }

  // Case constructors — `AIProviderError.invalidJSON(…)` reads like Swift.

  static missingAPIKey(): AIProviderError {
    return new AIProviderError({ kind: 'missingAPIKey' });
  }
  static needsCloudKey(model: string): AIProviderError {
    return new AIProviderError({ kind: 'needsCloudKey', model });
  }
  static invalidResponse(): AIProviderError {
    return new AIProviderError({ kind: 'invalidResponse' });
  }
  static httpError(statusCode: number, message: string): AIProviderError {
    return new AIProviderError({ kind: 'httpError', statusCode, message });
  }
  static emptyContent(): AIProviderError {
    return new AIProviderError({ kind: 'emptyContent' });
  }
  static invalidJSON(message: string): AIProviderError {
    return new AIProviderError({ kind: 'invalidJSON', message });
  }
  static promptTooLarge(actual: number, limit: number): AIProviderError {
    return new AIProviderError({ kind: 'promptTooLarge', actual, limit });
  }
  static quotaExceeded(provider: string, detail: string): AIProviderError {
    return new AIProviderError({ kind: 'quotaExceeded', provider, detail });
  }
  static providerUnavailable(provider: string, detail: string): AIProviderError {
    return new AIProviderError({ kind: 'providerUnavailable', provider, detail });
  }
  static rateLimited(provider: string, detail: string): AIProviderError {
    return new AIProviderError({ kind: 'rateLimited', provider, detail });
  }
}
