import { describe, it, expect } from 'vitest';
import { ModelProviderCatalog } from '../ModelProviderCatalog';

describe('ModelProviderCatalog', () => {
  it('resolves standard openrouter models', () => {
    const route = ModelProviderCatalog.route('anthropic/claude-3.7-sonnet');
    expect(route.id).toBe(ModelProviderCatalog.openRouterId);
    expect(route.name).toBe('OpenRouter');
    expect(route.chatEndpoint).toContain('openrouter.ai');
    expect(ModelProviderCatalog.upstreamModelName('anthropic/claude-3.7-sonnet')).toBe('anthropic/claude-3.7-sonnet');
  });

  it('resolves local/ ollama models', () => {
    const route = ModelProviderCatalog.route('local/qwen3-vl:32b');
    expect(route.id).toBe(ModelProviderCatalog.localId);
    expect(route.chatEndpoint).toBe('http://127.0.0.1:11434/v1/chat/completions');
    expect(ModelProviderCatalog.upstreamModelName('local/qwen3-vl:32b')).toBe('qwen3-vl:32b');
  });

  it('resolves cerebras: prefix', () => {
    const route = ModelProviderCatalog.route('cerebras/llama-3.3-70b');
    expect(route.id).toBe('cerebras');
    expect(route.chatEndpoint).toContain('cerebras.ai');
    expect(ModelProviderCatalog.upstreamModelName('cerebras/llama-3.3-70b')).toBe('llama-3.3-70b');
  });

  it('resolves groq: prefix', () => {
    const route = ModelProviderCatalog.route('groq/llama-3.3-70b-versatile');
    expect(route.id).toBe('groq');
    expect(route.chatEndpoint).toContain('groq.com');
    expect(ModelProviderCatalog.upstreamModelName('groq/llama-3.3-70b-versatile')).toBe('llama-3.3-70b-versatile');
  });

  it('resolves gemini: prefix', () => {
    const route = ModelProviderCatalog.route('gemini/gemini-2.5-flash');
    expect(route.id).toBe('gemini');
    expect(route.chatEndpoint).toContain('generativelanguage.googleapis.com');
    expect(ModelProviderCatalog.upstreamModelName('gemini/gemini-2.5-flash')).toBe('gemini-2.5-flash');
  });

  it('resolves nim: nvidia prefix', () => {
    const route = ModelProviderCatalog.route('nim/meta/llama-3.1-405b-instruct');
    expect(route.id).toBe('nim');
    expect(route.chatEndpoint).toContain('integrate.api.nvidia.com');
    expect(ModelProviderCatalog.upstreamModelName('nim/meta/llama-3.1-405b-instruct')).toBe('meta/llama-3.1-405b-instruct');
  });

  it('handles route catalog and notes', () => {
    expect(ModelProviderCatalog.routes.length).toBeGreaterThanOrEqual(5);
    const openrouter = ModelProviderCatalog.routes.find((r) => r.id === ModelProviderCatalog.openRouterId);
    expect(openrouter).toBeDefined();
    expect(openrouter?.freeTierNote).toBeDefined();
  });

  it('parses model prefix cleanly across varied inputs', () => {
    const cases = [
      ['local/llama3', ModelProviderCatalog.localId, 'llama3'],
      ['cerebras/llama-3.1-8b', 'cerebras', 'llama-3.1-8b'],
      ['groq/mixtral-8x7b-32768', 'groq', 'mixtral-8x7b-32768'],
      ['gemini/gemini-pro', 'gemini', 'gemini-pro'],
      ['nim/meta/llama3-70b', 'nim', 'meta/llama3-70b'],
      ['openai/gpt-4o', ModelProviderCatalog.openRouterId, 'openai/gpt-4o'],
      ['deepseek/deepseek-r1', ModelProviderCatalog.openRouterId, 'deepseek/deepseek-r1'],
    ];

    for (const [input, expectedRouteId, expectedUpstream] of cases) {
      expect(ModelProviderCatalog.route(input!).id).toBe(expectedRouteId);
      expect(ModelProviderCatalog.upstreamModelName(input!)).toBe(expectedUpstream);
    }
  });
});
