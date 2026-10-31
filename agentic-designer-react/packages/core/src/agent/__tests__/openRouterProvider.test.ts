import { describe, it, expect } from 'vitest';
import { OpenRouterProvider, extractErrorMessage } from '../OpenRouterProvider';

describe('OpenRouterProvider response handling & normalisation', () => {
  it('extracts error messages from varied formats', () => {
    expect(extractErrorMessage('{"error":{"message":"Invalid API key"}}')).toBe('Invalid API key');
    expect(extractErrorMessage('{"error":{"metadata":{"raw":"{\\"error\\":{\\"message\\":\\"Upstream model error\\"}}"}}}')).toBe('Upstream model error');
    expect(extractErrorMessage('plain text error')).toBe('plain text error');
  });

  it('detects exhausted quota vs temporary throttle', () => {
    expect(OpenRouterProvider.isQuotaExhausted('You exceeded your current quota')).toBe(true);
    expect(OpenRouterProvider.isQuotaExhausted('Daily limit reached for free models')).toBe(true);
    expect(OpenRouterProvider.isQuotaExhausted('free-models-per-day allowance exhausted')).toBe(true);
    expect(OpenRouterProvider.isQuotaExhausted('Rate limit exceeded: please try again in 15 seconds')).toBe(false);
    expect(OpenRouterProvider.isQuotaExhausted('Too many requests per minute')).toBe(false);
  });

  it('parses prompt token limit from error messages', () => {
    const parsed = OpenRouterProvider.parsePromptTokenLimit('Prompt tokens limit exceeded: 17434 > 15878');
    expect(parsed).toEqual({ actual: 17434, limit: 15878 });

    expect(OpenRouterProvider.parsePromptTokenLimit('Something else entirely')).toBeUndefined();
  });

  it('parses affordable tokens from 402 messages', () => {
    expect(OpenRouterProvider.affordableTokens('You can only afford 3121 tokens with this balance')).toBe(3121);
    expect(OpenRouterProvider.affordableTokens('Insufficient balance')).toBeUndefined();
  });

  it('marks cache breakpoints for Anthropic models', () => {
    const messages = [
      { role: 'system', content: 'You are an agent.' },
      { role: 'user', content: 'Turn 1' },
      { role: 'assistant', content: 'Answer 1' },
      { role: 'user', content: 'Turn 2' },
      { role: 'assistant', content: 'Answer 2' },
      { role: 'user', content: 'Turn 3' },
    ];

    const marked = OpenRouterProvider.markingCacheBreakpoints(messages);
    expect(marked.length).toBe(6);
    // System message has cache_control
    expect(marked[0]!.content).toEqual([
      { type: 'text', text: 'You are an agent.', cache_control: { type: 'ephemeral' } },
    ]);
  });
});
