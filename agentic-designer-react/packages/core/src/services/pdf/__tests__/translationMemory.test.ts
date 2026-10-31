import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryFileSystem } from '../../../platform/FileSystem';
import { getPlatform, resetPlatform, setPlatform } from '../../../platform/platform';
import { TranslationMemory } from '../TranslationMemory';

describe('TranslationMemory', () => {
  let fs: MemoryFileSystem;

  beforeEach(() => {
    resetPlatform();
    fs = new MemoryFileSystem();
    setPlatform({ fileSystem: fs });
  });

  it('normalises the language and derives the Swift paths', async () => {
    expect(TranslationMemory.normalizedLanguage('  Hebrew ')).toBe('hebrew');
    const memory = await TranslationMemory.create(' Hebrew ');
    memory.store('Definition', 'הגדרה');
    await memory.save();
    const base = getPlatform().fileSystem.applicationSupportDirectory();
    expect(await fs.exists(`${base}/Translation/cache-hebrew.json`)).toBe(true);
    expect(await fs.exists(`${base}/Translation/glossary-hebrew.json`)).toBe(true);
  });

  it('serves an exact match and counts hits/misses', async () => {
    const memory = await TranslationMemory.create('he');
    expect(memory.cached('Definition')).toBeNull();
    memory.store('Definition', 'הגדרה');
    expect(memory.cached('Definition')).toBe('הגדרה');
    expect(memory.hits).toBe(1);
    expect(memory.misses).toBe(1);
    expect(memory.hitRate).toBe(0.5);
  });

  it('collapses whitespace so a re-flowed line still hits', async () => {
    const memory = await TranslationMemory.create('he');
    memory.store('the same   sentence\n reflowed', 'x');
    expect(memory.cached('the same sentence reflowed')).toBe('x');
  });

  it('never stores an empty key or an empty translation', async () => {
    const memory = await TranslationMemory.create('he');
    memory.store('   ', 'x');
    memory.store('source', '  ');
    expect(memory.cacheCount).toBe(0);
  });

  it('round-trips cache and glossary through the file system', async () => {
    const first = await TranslationMemory.create('he');
    first.store('Example', 'דוגמה');
    await first.setTerm('eigenvalue', 'ערך עצמי');
    await first.setTerm('eigenvalue decomposition', 'פירוק לערכים עצמיים');
    await first.save();

    const second = await TranslationMemory.create('he');
    expect(second.cached('Example')).toBe('דוגמה');
    // Longest first: the compound term must win over its prefix.
    expect(second.glossary.map((entry) => entry.source)).toEqual(['eigenvalue decomposition', 'eigenvalue']);
  });

  it('writes the Swift JSON shape (sorted keys, source/translation only)', async () => {
    const memory = await TranslationMemory.create('he');
    memory.store('b', '2');
    memory.store('a', '1');
    await memory.setTerm('rank', 'דרגה');
    const base = getPlatform().fileSystem.applicationSupportDirectory();
    expect(await fs.readText(`${base}/Translation/cache-he.json`)).toBe('{\n  "a": "1",\n  "b": "2"\n}');
    expect(await fs.readText(`${base}/Translation/glossary-he.json`)).toBe(
      '[\n  {\n    "source": "rank",\n    "translation": "דרגה"\n  }\n]',
    );
  });

  it('masks whole glossary terms only, continuing the sentinel numbering', async () => {
    const memory = await TranslationMemory.create('he');
    await memory.setTerm('rank', 'דרגה');
    const masked = memory.maskTerms('The Rank of the ranking matrix', 3);
    expect(masked.masked).toBe('The [[3]] of the ranking matrix');
    expect(masked.restorations).toEqual({ '[[3]]': 'דרגה' });
  });

  it('removes a term', async () => {
    const memory = await TranslationMemory.create('he');
    await memory.setTerm('rank', 'דרגה');
    await memory.removeTerm('RANK');
    expect(memory.glossary).toHaveLength(0);
  });
});
