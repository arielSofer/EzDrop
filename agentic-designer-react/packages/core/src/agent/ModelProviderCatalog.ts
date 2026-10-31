// Ported 1:1 from AgenticDesigner/Agent/ModelProviderCatalog.swift
//
// Multi-provider routing, in the spirit of OmniRoute: instead of one account
// whose credit ceiling can stop a run dead, a model id carries its own
// provider prefix and the loop can fall through to the next provider when one
// is out of quota.
//
// Every route here is an OFFICIAL free tier with a published quota, reached at
// the vendor's own OpenAI-compatible endpoint with the user's own key. What is
// deliberately NOT here: services that re-expose frontier models "free, no key"
// by proxying someone else's paid capacity, and anything that drives a
// consumer web session (ChatGPT/Claude.ai) as if it were an API. Those break
// the upstream terms of service, and an app that ships them hands its users
// an account ban rather than a feature.

import { getPlatform } from '../platform';
import { storageGetJSON, storageSetJSON } from '../platform/Storage';
import { environmentValue, fetchWithTimeout, type AgentFetch } from './http';

export interface ModelProviderRoute {
  /** Prefix used in model ids: "cerebras/qwen-3-235b" → route "cerebras". */
  id: string;
  name: string;
  chatEndpoint: string;
  /** undefined for a keyless local server. */
  environmentVariable?: string;
  /** UserDefaults key holding a user-pasted key for this provider. */
  defaultsKey?: string;
  /** Shown in the Agent panel so the quota is visible before it runs out. */
  freeTierNote: string;
}

/** `var requiresKey: Bool` */
export function routeRequiresKey(route: ModelProviderRoute): boolean {
  return route.environmentVariable !== undefined;
}

/**
 * `var modelsEndpoint: URL` — every one of these providers exposes the
 * OpenAI-compatible model list next to the chat endpoint (verified by probe:
 * Cerebras/Groq 401, Gemini 400, NVIDIA 200 — none 404).
 */
export function routeModelsEndpoint(route: ModelProviderRoute): string {
  return route.chatEndpoint.replaceAll('chat/completions', 'models');
}

/** `func resolvedKey() -> String?` — user-pasted key first, then the environment. */
export function routeResolvedKey(route: ModelProviderRoute): string | undefined {
  const storage = getPlatform().storage;
  if (route.defaultsKey) {
    const stored = storage.get(route.defaultsKey)?.trim();
    if (stored) return stored;
  }
  if (route.environmentVariable) {
    const env = environmentValue(route.environmentVariable)?.trim();
    if (env) return env;
  }
  return routeRequiresKey(route) ? undefined : 'local';
}

/** `var isConfigured: Bool` */
export function routeIsConfigured(route: ModelProviderRoute): boolean {
  return routeResolvedKey(route) !== undefined;
}

const openRouterId = 'openrouter';
const localId = 'local';

const routes: ModelProviderRoute[] = [
  {
    id: localId,
    name: 'Local (Ollama / LM Studio)',
    chatEndpoint: 'http://127.0.0.1:11434/v1/chat/completions',
    freeTierNote: 'Unlimited — runs on this Mac, no key, no ceiling.',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    chatEndpoint: 'https://api.cerebras.ai/v1/chat/completions',
    environmentVariable: 'CEREBRAS_API_KEY',
    defaultsKey: 'cerebrasAPIKey',
    freeTierNote: 'Free tier ~1M tokens/day. Fastest inference available; text only.',
  },
  {
    id: 'groq',
    name: 'Groq',
    chatEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    environmentVariable: 'GROQ_API_KEY',
    defaultsKey: 'groqAPIKey',
    freeTierNote: 'Free tier with generous daily request + token limits.',
  },
  {
    id: 'gemini',
    name: 'Google AI Studio',
    chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    environmentVariable: 'GEMINI_API_KEY',
    defaultsKey: 'geminiAPIKey',
    freeTierNote: 'Free tier with a daily request quota. Accepts images — usable as the vision critic.',
  },
  {
    // "nim", NOT "nvidia": OpenRouter already publishes ids under the
    // nvidia/ namespace (nvidia/nemotron-…:free), and stealing that
    // prefix would silently send those to the wrong endpoint.
    id: 'nim',
    name: 'NVIDIA NIM',
    chatEndpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
    environmentVariable: 'NVIDIA_API_KEY',
    defaultsKey: 'nvidiaAPIKey',
    freeTierNote: 'Free credits across 100+ hosted models.',
  },
  {
    id: openRouterId,
    name: 'OpenRouter',
    chatEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    environmentVariable: 'OPENROUTER_API_KEY',
    defaultsKey: 'openRouterAPIKey',
    freeTierNote: 'Aggregator: paid models plus :free variants. Credit balance also caps PROMPT size.',
  },
];

/**
 * Free-tier models worth routing to, newest-capable first. Ids carry the
 * route prefix so a single string picks both provider and model.
 */
const freeModels: { id: string; label: string }[] = [
  { id: 'cerebras/qwen-3-235b-a22b-instruct', label: 'Cerebras Qwen3 235B — FREE, fastest (no vision)' },
  { id: 'cerebras/gpt-oss-120b', label: 'Cerebras GPT-OSS 120B — FREE, very fast (no vision)' },
  { id: 'groq/llama-3.3-70b-versatile', label: 'Groq Llama 3.3 70B — FREE, fast (no vision)' },
  // Verified against a live key: the "-latest" aliases generate, while
  // pinned ids like gemini-2.5-flash / -flash-lite now 404 with "no
  // longer available to new users" EVEN THOUGH /models still lists them.
  // Aliases also can't go stale the way a pinned id does.
  { id: 'gemini/gemini-flash-latest', label: 'Google Gemini Flash — FREE tier, fast, reads images' },
  { id: 'gemini/gemini-pro-latest', label: 'Google Gemini Pro — FREE tier, strongest, reads images' },
  // Verified against NVIDIA's public /v1/models list — the id this
  // originally shipped with ("nemotron-3-ultra-550b") does not exist.
  { id: 'nim/nvidia/llama-3.1-nemotron-ultra-253b-v1', label: 'NVIDIA Nemotron Ultra 253B — FREE credits (no vision)' },
];

/**
 * OpenRouter `:free` models used as last-resort fallbacks. Vision-capable
 * ones first, so a run that depends on screenshots keeps working.
 */
const openRouterFreeFallbacks = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-nano-12b-v2-vl:free',
  'meta-llama/llama-3.3-70b-instruct:free',
];

function route(modelId: string): ModelProviderRoute {
  // The ":free" suffix is OpenRouter's own convention for a free variant,
  // so such an id is always theirs no matter what vendor prefix it wears.
  if (modelId.endsWith(':free')) {
    return routes.find((r) => r.id === openRouterId)!;
  }
  // "cerebras/qwen-3-235b" → cerebras. A bare "vendor/model" id that
  // matches no route is an OpenRouter id (that is its native format).
  const prefix = modelId.split('/')[0];
  if (prefix) {
    const match = routes.find((r) => r.id === prefix);
    if (match) return match;
  }
  return routes.find((r) => r.id === openRouterId)!;
}

/**
 * The model name to send upstream — the route prefix is ours, not theirs.
 * OpenRouter is the exception: it *wants* the full "vendor/model" id.
 */
function upstreamModelName(modelId: string): string {
  const r = route(modelId);
  if (r.id === openRouterId) return modelId;
  return modelId.slice(r.id.length + 1);
}

/**
 * Ordered fallback chain for one requested model: the model itself first,
 * then every OTHER configured route's default free model. This is the
 * OmniRoute idea that matters here — one provider running out of quota
 * should cost a retry, not the whole run.
 */
function fallbackChain(modelId: string): string[] {
  const chain = [modelId];
  const startRoute = route(modelId).id;

  // Gemini's Flash and Pro free-tier aliases are separate model choices
  // in the product and can have different availability/rate limits. If
  // the user picked one, try its sibling before leaving Google AI Studio.
  if (startRoute === 'gemini') {
    for (const candidate of freeModels) {
      if (route(candidate.id).id === startRoute && candidate.id !== modelId) {
        chain.push(candidate.id);
      }
    }
  }

  // Free tiers first: they cost nothing to try.
  for (const candidate of freeModels) {
    if (route(candidate.id).id === startRoute) continue;
    if (!routeIsConfigured(route(candidate.id))) continue;
    chain.push(candidate.id);
  }
  // OpenRouter's own :free variants are a second pool with an INDEPENDENT
  // allowance, reachable with the key most users already have. Without
  // these, someone who configured only one direct vendor has an empty
  // chain the moment that vendor's daily quota runs out.
  const openRouter = routes.find((r) => r.id === openRouterId);
  if (startRoute !== openRouterId && openRouter && routeIsConfigured(openRouter)) {
    chain.push(...openRouterFreeFallbacks);
  }
  // A local model is the last resort that can never run out.
  if (startRoute !== localId) {
    const localFallback = getPlatform().storage.get('localFallbackModel');
    if (localFallback) chain.push(localFallback);
  }
  return chain;
}

/** Cache key for a route's discovered models. */
function cachedModelsKey(r: ModelProviderRoute): string {
  return `discoveredModels.${r.id}`;
}

export const ModelProviderCatalog = {
  openRouterId,
  localId,
  routes,
  freeModels,
  openRouterFreeFallbacks,

  /** `route(for:)` */
  route,
  /** `upstreamModelName(for:)` */
  upstreamModelName,
  /** `fallbackChain(startingWith:)` */
  fallbackChain,

  /**
   * Providers the user has actually set up — surfaced in the Agent panel so
   * "why did it stop" has a visible answer.
   */
  get configuredRoutes(): ModelProviderRoute[] {
    return routes.filter((r) => routeIsConfigured(r));
  },

  // MARK: - Live model discovery

  /**
   * `fetchModels(for:)` — asks the provider what it can actually run. This is
   * what keeps the app honest: a hardcoded model id is a guess that silently
   * 404s at the worst moment.
   */
  async fetchModels(r: ModelProviderRoute, fetchImpl?: AgentFetch): Promise<string[]> {
    const key = routeResolvedKey(r);
    if (!key) throw new Error(`No key set for ${r.name}.`);

    const response = await fetchWithTimeout(
      routeModelsEndpoint(r),
      { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
      30,
      fetchImpl,
    );
    const body = await response.text();
    if (!(response.status >= 200 && response.status < 300)) {
      // The provider's own wording is far more useful than ours: it says
      // "Wrong API Key" vs "quota exceeded" vs "region not supported".
      throw new Error(`${r.name} returned ${response.status}: ${Array.from(body).slice(0, 160).join('')}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`${r.name} returned an undecodable model list.`);
    }
    const entries = (parsed as { data?: { id?: unknown }[] }).data;
    if (!Array.isArray(entries)) throw new Error(`${r.name} returned an undecodable model list.`);
    const ids: string[] = [];
    for (const entry of entries) {
      if (typeof entry?.id !== 'string') throw new Error(`${r.name} returned an undecodable model list.`);
      ids.push(entry.id);
    }
    return ids.sort();
  },

  cachedModelsKey,

  cachedModels(r: ModelProviderRoute): string[] {
    const cached = storageGetJSON<string[]>(getPlatform().storage, cachedModelsKey(r), []);
    return Array.isArray(cached) ? cached : [];
  },

  storeModels(models: string[], r: ModelProviderRoute): void {
    storageSetJSON(getPlatform().storage, cachedModelsKey(r), models);
  },

  /** Where to get a free key, one click from the panel. */
  signupURL(r: ModelProviderRoute): string | undefined {
    switch (r.id) {
      case 'cerebras': return 'https://cloud.cerebras.ai/';
      case 'groq': return 'https://console.groq.com/keys';
      case 'gemini': return 'https://aistudio.google.com/apikey';
      case 'nim': return 'https://build.nvidia.com/';
      case openRouterId: return 'https://openrouter.ai/settings/keys';
      default: return undefined;
    }
  },
} as const;
