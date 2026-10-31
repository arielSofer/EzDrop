// Ported 1:1 from AgenticDesigner/Services/LocalModelTranslator.swift
//
// Paragraph translation through the user's LOCAL models (Ollama, LM Studio,
// Hugging Face Transformers, or any OpenAI-compatible server) — no cloud
// calls. Model discovery tries Ollama's /api/tags first, then the OpenAI-style
// /v1/models; chat goes through /v1/chat/completions, which both runtimes
// serve.

import { getPlatform } from '../platform/platform';
import { storageGetString } from '../platform/Storage';
import { getLocalBridges } from '../platform/LocalBridges';
import { fetchWithTimeout, type AgentFetch } from './http';

export class LocalTranslatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocalTranslatorError';
  }

  static noModel(): LocalTranslatorError {
    return new LocalTranslatorError('No local model selected — open the Translate tool settings and pick one.');
  }
  static badEndpoint(endpoint: string): LocalTranslatorError {
    return new LocalTranslatorError(`Invalid endpoint: ${endpoint}`);
  }
  static serverError(body: string): LocalTranslatorError {
    return new LocalTranslatorError(`Local model server error: ${body}`);
  }
  static badResponse(): LocalTranslatorError {
    return new LocalTranslatorError('The local model returned an unexpected response.');
  }
  static unsupportedLanguage(model: string, language: string): LocalTranslatorError {
    return new LocalTranslatorError(`${model} only supports English to Hebrew, not ${language}.`);
  }
  static helsinkiWorker(message: string): LocalTranslatorError {
    return new LocalTranslatorError(`Helsinki translator error: ${message}`);
  }
}

export class LocalModelTranslator {
  static readonly helsinkiModel = 'Helsinki-NLP/opus-mt-en-he';
  static readonly commonLanguages = [
    'Hebrew',
    'English',
    'Arabic',
    'French',
    'German',
    'Spanish',
    'Russian',
    'Chinese',
    'Japanese',
  ];

  private static readonly endpointKey = 'localTranslatorEndpoint';
  private static readonly modelKey = 'localTranslatorModel';
  private static readonly languageKey = 'localTranslatorLanguage';

  private _endpoint: string;
  private _selectedModel: string;
  private _targetLanguage: string;
  private _availableModels: string[] = [];
  private _activeTranslations = 0;
  private _lastError: string | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly fetchImpl?: AgentFetch;

  constructor(options: { fetchImpl?: AgentFetch } = {}) {
    const storage = getPlatform().storage;
    this._endpoint = storageGetString(storage, LocalModelTranslator.endpointKey, 'http://127.0.0.1:11434');
    this._selectedModel = storageGetString(storage, LocalModelTranslator.modelKey, '');
    this._targetLanguage = storageGetString(storage, LocalModelTranslator.languageKey, 'Hebrew');
    this.fetchImpl = options.fetchImpl;
  }

  get endpoint(): string {
    return this._endpoint;
  }
  set endpoint(val: string) {
    this._endpoint = val;
    getPlatform().storage.set(LocalModelTranslator.endpointKey, val);
    this.notify();
  }

  get selectedModel(): string {
    return this._selectedModel;
  }
  set selectedModel(val: string) {
    this._selectedModel = val;
    getPlatform().storage.set(LocalModelTranslator.modelKey, val);
    this.notify();
  }

  get targetLanguage(): string {
    return this._targetLanguage;
  }
  set targetLanguage(val: string) {
    this._targetLanguage = val;
    getPlatform().storage.set(LocalModelTranslator.languageKey, val);
    this.notify();
  }

  get availableModels(): readonly string[] {
    return this._availableModels;
  }

  get activeTranslations(): number {
    return this._activeTranslations;
  }

  get lastError(): string | null {
    return this._lastError;
  }

  get isTranslating(): boolean {
    return this._activeTranslations > 0;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // ignore
      }
    }
  }

  // MARK: - Model discovery

  async refreshModels(): Promise<void> {
    this._lastError = null;
    let discovered = await this.fetchOllamaTags();
    if (!discovered) {
      discovered = await this.fetchOpenAIModels();
    }
    if (discovered) {
      const all = Array.from(new Set([...discovered, LocalModelTranslator.helsinkiModel])).sort();
      this._availableModels = all;
      if (this._selectedModel.length === 0 || !all.includes(this._selectedModel)) {
        this._selectedModel = all[0] ?? '';
      }
    } else {
      this._availableModels = [LocalModelTranslator.helsinkiModel];
      if (this._selectedModel.length === 0 || !this._availableModels.includes(this._selectedModel)) {
        this._selectedModel = LocalModelTranslator.helsinkiModel;
      }
      this._lastError = `No Ollama/LM Studio server at ${this._endpoint}. The Helsinki model is still available.`;
    }
    this.notify();
  }

  private async fetchOllamaTags(): Promise<string[] | null> {
    try {
      const res = await fetchWithTimeout(`${this._endpoint}/api/tags`, { method: 'GET' }, 30, this.fetchImpl);
      if (res.status !== 200) return null;
      const text = await res.text();
      const data = JSON.parse(text) as { models?: { name?: string }[] };
      if (!data || !Array.isArray(data.models)) return null;
      return data.models.map((m) => m.name).filter((n): n is string => typeof n === 'string');
    } catch {
      return null;
    }
  }

  private async fetchOpenAIModels(): Promise<string[] | null> {
    try {
      const res = await fetchWithTimeout(`${this._endpoint}/v1/models`, { method: 'GET' }, 30, this.fetchImpl);
      if (res.status !== 200) return null;
      const text = await res.text();
      const data = JSON.parse(text) as { data?: { id?: string }[] };
      if (!data || !Array.isArray(data.data)) return null;
      return data.data.map((m) => m.id).filter((id): id is string => typeof id === 'string');
    } catch {
      return null;
    }
  }

  // MARK: - Translation

  async translate(text: string, toLanguage?: string, model?: string): Promise<string> {
    const useModel = model ?? this._selectedModel;
    if (!useModel) {
      throw LocalTranslatorError.noModel();
    }
    const useLanguage = toLanguage ?? this._targetLanguage;

    this._activeTranslations += 1;
    this.notify();

    try {
      if (useModel === LocalModelTranslator.helsinkiModel) {
        if (useLanguage.toLowerCase() !== 'hebrew') {
          throw LocalTranslatorError.unsupportedLanguage(useModel, useLanguage);
        }
        return await this.translateWithHelsinki(text);
      }

      const res = await fetchWithTimeout(
        `${this._endpoint}/v1/chat/completions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: useModel,
            stream: false,
            max_tokens: 1600,
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content: `You are a professional translator. Translate the user's text into ${useLanguage}. Preserve the meaning and tone. Keep mathematical symbols, notation and formulas EXACTLY as they appear - never convert them to LaTeX or rewrite them. The text may contain placeholder tokens like ⟦0⟧ or ⟦1⟧ — keep every token EXACTLY as written, at the position where its content belongs in the translated sentence; never translate, drop, or renumber them. Output ONLY the translation — no explanations, no quotes, no notes.`,
              },
              { role: 'user', content: text },
            ],
          }),
        },
        600,
        this.fetchImpl,
      );

      if (res.status < 200 || res.status >= 300) {
        const body = (await res.text()).slice(0, 300);
        throw LocalTranslatorError.serverError(body);
      }

      const textRes = await res.text();
      const parsed = JSON.parse(textRes) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        throw LocalTranslatorError.badResponse();
      }

      const translated = LocalModelTranslator.stripReasoning(content).trim();
      if (translated.length === 0) {
        throw LocalTranslatorError.badResponse();
      }
      return translated;
    } finally {
      this._activeTranslations -= 1;
      this.notify();
    }
  }

  private async translateWithHelsinki(text: string): Promise<string> {
    await this.ensureHelsinkiWorker();
    const res = await fetchWithTimeout(
      'http://127.0.0.1:17841/translate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      },
      1200,
      this.fetchImpl,
    );

    const raw = await res.text();
    let payload: { error?: string; translation?: string } | undefined;
    try {
      payload = JSON.parse(raw) as { error?: string; translation?: string };
    } catch {
      // ignore
    }

    if (res.status < 200 || res.status >= 300 || !payload) {
      throw LocalTranslatorError.helsinkiWorker(payload?.error ?? 'Unexpected worker response');
    }

    const translated = (payload.translation ?? '').trim();
    if (translated.length === 0) {
      throw LocalTranslatorError.badResponse();
    }
    return translated;
  }

  private async ensureHelsinkiWorker(): Promise<void> {
    const bridges = getLocalBridges();
    await bridges.ensureHelsinkiWorker();
  }

  // Reasoning models (qwen3 etc.) may wrap deliberation in <think> tags —
  // keep only the final answer.
  static stripReasoning(text: string): string {
    const closeIndex = text.indexOf('</think>');
    if (closeIndex < 0) return text;
    return text.slice(closeIndex + '</think>'.length);
  }

  // Right-to-left detection drives the replacement's text alignment and
  // font choice (Hebrew/Arabic glyph coverage).
  static isRightToLeft(text: string): boolean {
    for (const char of text) {
      const code = char.codePointAt(0);
      if (code !== undefined && code >= 0x0590 && code <= 0x08ff) {
        return true;
      }
    }
    return false;
  }
}
