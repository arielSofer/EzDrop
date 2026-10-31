// Ported 1:1 from AgenticDesigner/Agent/OpenRouterConfiguration.swift

import { ModelProviderCatalog } from './ModelProviderCatalog';
import { environmentValue } from './http';

export const OpenRouterConfiguration = {
  model: 'google/gemini-2.5-pro',
  imageModel: 'bytedance-seed/seedream-4.5',

  // Models offered in the Agent panel picker. Any OpenRouter chat model id works;
  // the vision critic requires a model that accepts image input (all of these do).
  availableModels: [
    { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro — best balance' },
    { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5 — best design taste' },
    { id: 'openai/gpt-5.6-sol-pro', label: 'GPT-5.6 Sol Pro — top-tier reasoning' },
    { id: 'moonshotai/kimi-k3', label: 'Kimi K3 — strong agentic reasoning' },
    { id: 'x-ai/grok-4.5', label: 'Grok 4.5 — strong reasoning, vision' },
    { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash — fastest' },
    { id: 'openai/gpt-5-nano', label: 'GPT-5 Nano — best performance' },
    { id: 'local/qwen3-vl:32b', label: 'LOCAL Qwen3-VL 32B — smartest on-device, vision' },
    { id: 'local/gemma4:26b-mlx', label: 'LOCAL Gemma 4 26B (MLX) — on-device, vision' },
    { id: 'openrouter/free', label: 'Free Router — auto-picks a capable free model' },
    { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B — FREE (no vision)' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'Llama 3.3 70B — FREE (no vision)' },
    { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B — FREE (reads images)' },
    { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B — FREE (reads images)' },
    { id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free', label: 'Nemotron 3 Omni 30B — FREE (reads images)' },
    { id: 'nvidia/nemotron-nano-12b-v2-vl:free', label: 'Nemotron Nano 12B VL — FREE (reads images)' },
    { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small 3.1 — FREE' },
    // ↑ Direct-to-vendor free tiers (Cerebras / Groq / Google AI Studio /
    // NVIDIA). These use their OWN key and their OWN quota, so an exhausted
    // OpenRouter balance doesn't touch them — which is the point.
    ...ModelProviderCatalog.freeModels,
  ] as { id: string; label: string }[],

  /** `apiKey(userProvidedKey:)` */
  apiKey(userProvidedKey: string): string | undefined {
    const userKey = userProvidedKey.trim();
    if (userKey.length > 0) return userKey;
    const environmentKey = environmentValue('OPENROUTER_API_KEY')?.trim();
    return environmentKey ? environmentKey : undefined;
  },
} as const;
