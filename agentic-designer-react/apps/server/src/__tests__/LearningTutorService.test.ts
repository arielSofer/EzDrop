import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LearningTutorService } from '../services/LearningTutorService';
const dirs: string[] = [];
function ledgerPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-quota-test-'));
  dirs.push(dir); return path.join(dir, 'usage.json');
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe('server learning quota', () => {
  it('survives service restart and cannot be reset by changing context/project', async () => {
    const file = ledgerPath();
    const provider = vi.fn().mockResolvedValue({ source: 'ai_model', answer: 'answer' });
    const options = { ledgerPath: file, maxCallsPerDay: 1, provider };
    await new LearningTutorService(options).ask({ question: 'שאלה אישית א' });
    const second = await new LearningTutorService(options).ask({ question: 'שאלה אישית ב', context: {stage: 'code', filePath: 'another.kt'} });
    expect(second.source).toBe('budget_exhausted');
    expect(provider).toHaveBeenCalledOnce();
  });
  it('reserves before concurrent requests and deduplicates the same request', async () => {
    const provider = vi.fn().mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return { source: 'ai_model', answer: 'answer' };
    });
    const service = new LearningTutorService({ ledgerPath: ledgerPath(), maxCallsPerDay: 1, provider });
    const [a, b, c] = await Promise.all([
      service.ask({ question: 'שאלה אישית' }), service.ask({ question: 'שאלה אישית' }),
      service.ask({ question: 'שאלה שונה' }),
    ]);
    expect(a).toEqual(b);
    expect(c.source).toBe('budget_exhausted');
    expect(provider).toHaveBeenCalledOnce();
  });
  it('does not spend for local hints and renews quota only on the next UTC day', async () => {
    let day = '2026-09-06T12:00:00Z';
    const provider = vi.fn().mockResolvedValue({ source: 'ai_model', answer: 'answer' });
    const service = new LearningTutorService({ ledgerPath: ledgerPath(), maxCallsPerDay: 1, provider, now: () => new Date(day) });
    expect((await service.ask({question: 'מה זה מסך?'})).source).toBe('local_approved');
    expect(provider).not.toHaveBeenCalled();
    await service.ask({question: 'שאלה אישית'});
    expect((await service.ask({question: 'שאלה אחרת'})).source).toBe('budget_exhausted');
    day = '2026-09-07T00:00:00Z';
    expect((await service.ask({question: 'שאלה אחרת'})).source).toBe('ai_model');
  });
  it('fails closed on corrupt ledger and rejects oversized context before calling provider', async () => {
    const file = ledgerPath(); fs.writeFileSync(file, 'corrupt');
    const provider = vi.fn();
    const service = new LearningTutorService({ ledgerPath: file, provider });
    await expect(service.ask({question: 'שאלה אישית'})).rejects.toThrow();
    await expect(service.ask({question: 'x'.repeat(3001)})).rejects.toThrow();
    expect(provider).not.toHaveBeenCalled();
  });
});
