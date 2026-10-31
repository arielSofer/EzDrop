// Ported 1:1 from AgenticDesigner/Services/TranslationMemory.swift
//
//  Two things a textbook needs that a per-paragraph translator cannot give:
//
//  CONSISTENCY. "eigenvalue" must be the same Hebrew word on page 40 and on
//  page 380. A model asked 200 times independently will not do that — not
//  because it is wrong each time, but because it is free each time.
//
//  REPETITION. A structured book is full of identical short strings —
//  "Definition", "Example", "Remark", "Theorem", "Proof". Translating them
//  again per occurrence costs time and invites variation.
//
//  The cache answers the second and reinforces the first: an exact source
//  string always yields the exact translation it yielded before. The glossary
//  answers the first outright, by removing chosen terms from the model's reach
//  entirely — the same masking trick PDFMathGuard uses for formulas, which is
//  already proven on this document.
//
// PORT NOTE: Swift's `init` loaded synchronously off `FileManager`; the port
// goes through the async `FileSystem` platform adapter, so construction is
// `await TranslationMemory.create(language)` (or `new TranslationMemory(lang)`
// followed by `await memory.load()`). The on-disk JSON shape is unchanged:
// Application Support/AgenticDesigner/Translation/{cache,glossary}-<lang>.json.

import { stringifySorted } from '../../models/JSON';
import { getPlatform } from '../../platform/platform';

export interface GlossaryEntry {
  source: string;
  translation: string;
}

/** `GlossaryEntry.id` */
export function glossaryEntryID(entry: GlossaryEntry): string {
  return entry.source.toLowerCase();
}

export class TranslationMemory {
  /** `@Published private(set) var glossary` */
  glossary: GlossaryEntry[] = [];
  /** `@Published private(set) var hits` */
  hits = 0;
  /** `@Published private(set) var misses` */
  misses = 0;

  private cache: Record<string, string> = {};
  readonly language: string;

  constructor(language: string) {
    this.language = TranslationMemory.normalizedLanguage(language);
  }

  /** `init(language:)` — Swift's initializer loads from disk. */
  static async create(language: string): Promise<TranslationMemory> {
    const memory = new TranslationMemory(language);
    await memory.load();
    return memory;
  }

  static normalizedLanguage(raw: string): string {
    return raw.trim().toLowerCase();
  }

  // MARK: - Cache

  /**
   * Exact-match only. A fuzzy cache would "helpfully" reuse a translation
   * for text that differs by a digit or a variable name, which in a maths
   * book is a wrong sentence rather than a near-miss.
   */
  cached(source: string): string | null {
    const key = TranslationMemory.key(source);
    const value = this.cache[key];
    if (value !== undefined) {
      this.hits += 1;
      return value;
    }
    this.misses += 1;
    return null;
  }

  store(source: string, translation: string): void {
    const key = TranslationMemory.key(source);
    if (key.length === 0 || translation.replace(/^[ \t]+|[ \t]+$/g, '').length === 0) return;
    this.cache[key] = translation;
  }

  /**
   * Collapses insignificant whitespace so the same sentence re-flowed across
   * a different line break still hits.
   */
  private static key(source: string): string {
    return source.trim().split(/\s+/u).filter((part) => part.length > 0).join(' ');
  }

  get hitRate(): number {
    const total = this.hits + this.misses;
    return total > 0 ? this.hits / total : 0;
  }

  /** Entry count on disk — used by the MCP metrics text. */
  get cacheCount(): number {
    return Object.keys(this.cache).length;
  }

  // MARK: - Glossary

  async setTerm(source: string, translation: string): Promise<void> {
    const trimmed = source.trim();
    if (trimmed.length === 0) return;
    const id = trimmed.toLowerCase();
    this.glossary = this.glossary.filter((entry) => glossaryEntryID(entry) !== id);
    this.glossary.push({ source: trimmed, translation });
    // Longest first: "eigenvalue decomposition" must win over "eigenvalue".
    this.glossary.sort((lhs, rhs) => rhs.source.length - lhs.source.length);
    await this.save();
  }

  async removeTerm(source: string): Promise<void> {
    const id = source.toLowerCase();
    this.glossary = this.glossary.filter((entry) => glossaryEntryID(entry) !== id);
    await this.save();
  }

  /**
   * Replaces glossary terms with sentinels BEFORE translation and puts the
   * fixed wording back after — so the model never sees the term and cannot
   * paraphrase it. Sentinels continue PDFMathGuard's numbering space so the
   * two maskers can be applied to the same string without collision.
   */
  maskTerms(text: string, startingAt: number): { masked: string; restorations: Record<string, string> } {
    if (this.glossary.length === 0) return { masked: text, restorations: {} };
    let masked = text;
    const restorations: Record<string, string> = {};
    let next = startingAt;

    for (const entry of this.glossary) {
      if (entry.translation.length === 0) continue;
      // Whole words only, case-insensitive: "rank" must not match inside
      // "ranking", and a sentence-initial "Rank" is the same term.
      const pattern = '\\b' + escapedPattern(entry.source) + '\\b';
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'gi');
      } catch {
        continue;
      }
      regex.lastIndex = 0;
      if (!regex.test(masked)) continue;

      const token = `[[${next}]]`;
      next += 1;
      regex.lastIndex = 0;
      masked = masked.replace(regex, token);
      restorations[token] = entry.translation;
    }
    return { masked, restorations };
  }

  // MARK: - Persistence

  private get directory(): string {
    const fs = getPlatform().fileSystem;
    return fs.join(fs.applicationSupportDirectory(), 'Translation');
  }
  private get cacheURL(): string {
    return getPlatform().fileSystem.join(this.directory, `cache-${this.language}.json`);
  }
  private get glossaryURL(): string {
    return getPlatform().fileSystem.join(this.directory, `glossary-${this.language}.json`);
  }

  async load(): Promise<void> {
    const fs = getPlatform().fileSystem;
    try {
      const text = await fs.readText(this.cacheURL);
      const stored = JSON.parse(text) as unknown;
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
        const entries: Record<string, string> = {};
        for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
          if (typeof value === 'string') entries[key] = value;
        }
        this.cache = entries;
      }
    } catch {
      // No cache yet — `try? Data(contentsOf:)`.
    }
    try {
      const text = await fs.readText(this.glossaryURL);
      const stored = JSON.parse(text) as unknown;
      if (Array.isArray(stored)) {
        const entries: GlossaryEntry[] = [];
        for (const raw of stored) {
          if (raw && typeof raw === 'object') {
            const record = raw as Record<string, unknown>;
            if (typeof record.source === 'string' && typeof record.translation === 'string') {
              entries.push({ source: record.source, translation: record.translation });
            }
          }
        }
        this.glossary = entries.sort((lhs, rhs) => rhs.source.length - lhs.source.length);
      }
    } catch {
      // No glossary yet.
    }
  }

  async save(): Promise<void> {
    const fs = getPlatform().fileSystem;
    try {
      await fs.mkdirp(this.directory);
      await fs.writeText(this.cacheURL, stringifySorted(this.cache, 2));
      await fs.writeText(this.glossaryURL, stringifySorted(this.glossary, 2));
    } catch {
      // `try?` — persistence failures never break a translation run.
    }
  }
}

/** `NSRegularExpression.escapedPattern(for:)` */
export function escapedPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
