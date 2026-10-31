import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LearningAIService, localLearningAnswer, type AskAgentOptions, type AskAgentResult } from '@agentic/core';
import { writeFileAtomic, ensureDirectory } from '../platform/Paths.js';
import { Settings, settingsPath } from './Settings.js';

type Ledger = { day: string; calls: number; reportedCostUSD: number; unknownCostCalls: number };
/** Local server-wide quota. A browser refresh, new tab or project cannot reset it.
 * Reserve synchronously on disk before the first await. This server runs a single process.
 * Fail closed on unreadable state. Production multi-user deployments need authenticated
 * user quotas and transactional shared storage, rather than a client-supplied user ID.
 */
export class LearningTutorService {
  private pending = new Map<string, Promise<AskAgentResult>>();
  constructor(private options: {
    ledgerPath?: string; maxCallsPerDay?: number; now?: () => Date;
    apiKey?: () => string; provider?: (args: AskAgentOptions) => Promise<AskAgentResult>;
  } = {}) {}

  async ask(input: AskAgentOptions): Promise<AskAgentResult> {
    if (!input || typeof input.question !== 'string' || input.question.length > 3000 || JSON.stringify(input).length > 32000) {
      throw new Error('שאלה או הקשר ארוכים מדי. התמקד בקטע הקוד הרלוונטי.');
    }
    // Pick only the supported wire fields; clients cannot select a key, model or quota.
    const args: AskAgentOptions = {
      question: input.question,
      activeTask: input.activeTask && {
        id: String(input.activeTask.id).slice(0, 200), titleHe: String(input.activeTask.titleHe).slice(0, 500),
        promptHe: String(input.activeTask.promptHe).slice(0, 2000), whyHe: String(input.activeTask.whyHe).slice(0, 1000),
      },
      context: input.context,
      recentMessages: input.recentMessages,
    };
    if (args.context && (!['code', 'design'].includes(args.context.stage) ||
        ['code', 'filePath', 'diagnostics'].some(k => {
          const v = (args.context as unknown as Record<string, unknown>)[k];
          return v !== undefined && typeof v !== 'string';
        }))) throw new Error('Invalid tutor context');
    if (args.recentMessages && (!Array.isArray(args.recentMessages) || args.recentMessages.some(m =>
      !m || !['user', 'agent'].includes(m.sender) || typeof m.text !== 'string'))) throw new Error('Invalid tutor history');
    const local = localLearningAnswer(args.question, args.context?.stage);
    if (local) return { source: 'local_approved', answer: local };
    const key = createHash('sha256').update(JSON.stringify(args)).digest('hex');
    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;
    const promise = this.run(args);
    this.pending.set(key, promise);
    try { return await promise; } finally { this.pending.delete(key); }
  }

  private file() { return this.options.ledgerPath ?? path.join(path.dirname(settingsPath()), 'learning-usage.json'); }
  private read(): Ledger {
    const day = (this.options.now?.() ?? new Date()).toISOString().slice(0, 10);
    if (!fs.existsSync(this.file())) return { day, calls: 0, reportedCostUSD: 0, unknownCostCalls: 0 };
    const saved = JSON.parse(fs.readFileSync(this.file(), 'utf8')) as Ledger;
    if (typeof saved.day !== 'string' || !Number.isInteger(saved.calls) || saved.calls < 0 ||
        !Number.isFinite(saved.reportedCostUSD) || !Number.isInteger(saved.unknownCostCalls)) throw new Error('Invalid usage ledger');
    return saved.day === day ? saved : { day, calls: 0, reportedCostUSD: 0, unknownCostCalls: 0 };
  }
  private write(ledger: Ledger) {
    ensureDirectory(path.dirname(this.file()));
    writeFileAtomic(this.file(), JSON.stringify(ledger));
  }
  private async run(args: AskAgentOptions): Promise<AskAgentResult> {
    const key = this.options.apiKey?.() ?? process.env.OPENROUTER_API_KEY ?? Settings.string('openRouterAPIKey') ?? '';
    if (!key && !this.options.provider) return { source: 'unavailable',
      answer: 'מפתח שירות ההדרכה אינו מוגדר בשרת המקומי. הרמזים זמינים; לא בוצעה בדיקה אישית.' };
    const ledger = this.read();
    const limit = this.options.maxCallsPerDay ?? 20;
    if (ledger.calls >= limit) return { source: 'budget_exhausted',
      answer: `מכסת ${limit} בקשות ההדרכה היומית בשרת מוצתה. היא מתחדשת בחצות UTC. אפשר להמשיך ברמזים ובעריכה.` };
    ledger.calls++;
    ledger.unknownCostCalls++; // Retain reservation on failure: upstream may have billed it.
    this.write(ledger);
    const provider = this.options.provider ?? (request => new LearningAIService({ apiKey: key }).ask(request));
    const result = await provider(args);
    const cost = result.logEntry?.estimatedCostUSD;
    if (typeof cost === 'number') {
      const current = this.read();
      if (current.day === ledger.day) {
        current.reportedCostUSD += cost;
        current.unknownCostCalls = Math.max(0, current.unknownCostCalls - 1);
        this.write(current);
      }
    }
    return result;
  }
}
