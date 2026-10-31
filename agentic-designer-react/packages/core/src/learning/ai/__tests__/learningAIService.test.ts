// packages/core/src/learning/ai/__tests__/learningAIService.test.ts

import { describe, it, expect, vi } from 'vitest';
import { LearningAIService } from '../learningAIService';

describe('LearningAIService', () => {
  it('matches local approved FAQ with zero API calls', async () => {
    const mockFetch = vi.fn();
    const service = new LearningAIService({ apiKey: 'test-key', fetchFn: mockFetch as any });

    const res = await service.ask({ question: 'מה זה Frame?' });
    expect(res.source).toBe('local_approved');
    expect(res.answer).toContain('המעטפת הראשית');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(service.getSessionCallCount()).toBe(0);
  });

  it('provides pedagogical offline fallback when apiKey is missing', async () => {
    const mockFetch = vi.fn();
    const service = new LearningAIService({ apiKey: '', fetchFn: mockFetch as any });

    const res = await service.ask({ question: 'איך עובד ניווט?' });
    expect(res.source).toBe('unavailable');
    expect(res.answer).toContain('לא בוצעה בדיקה אישית');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('calls API, records usage log and cost when query is personal and key is set', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'ב־Jetpack Compose כל רכיב מוגדר כפונקציה.' } }],
        usage: { prompt_tokens: 150, completion_tokens: 45, cost: 0.001 },
      }),
    });

    const service = new LearningAIService({ apiKey: 'valid-key', fetchFn: mockFetch as any });
    const res = await service.ask({ question: 'איך מייצגים מצב ב־Compose?' });

    expect(res.source).toBe('ai_model');
    expect(res.answer).toContain('Jetpack Compose');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(service.getSessionCallCount()).toBe(1);

    const history = service.getUsageHistory();
    expect(history.length).toBe(1);
    expect(history[0].promptTokens).toBe(150);
    expect(history[0].completionTokens).toBe(45);
    expect(service.getTotalEstimatedCostUSD()).toBeGreaterThan(0);
  });

  it('deduplicates concurrent identical requests', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: 'תשובה משותפת' } }],
        }),
      };
    });

    const service = new LearningAIService({ apiKey: 'valid-key', fetchFn: mockFetch as any });

    const [r1, r2] = await Promise.all([
      service.ask({ question: 'שאלה מורכבת זהה' }),
      service.ask({ question: 'שאלה מורכבת זהה' }),
    ]);

    expect(r1.answer).toBe('תשובה משותפת');
    expect(r2.answer).toBe('תשובה משותפת');
    expect(callCount).toBe(1); // Only 1 API call!
  });

  it('enforces budget cap when max calls per session is reached', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'תשובה' } }],
      }),
    });

    const service = new LearningAIService({
      apiKey: 'valid-key',
      maxCallsPerSession: 2,
      fetchFn: mockFetch as any,
    });

    await service.ask({ question: 'שאלה 1' });
    await service.ask({ question: 'שאלה 2' });
    expect(service.getSessionCallCount()).toBe(2);

    // Third call should hit the budget cap:
    const capped = await service.ask({ question: 'שאלה 3' });
    expect(capped.source).toBe('budget_exhausted');
    expect(capped.answer).toContain('הגעת לתקרת');
    expect(mockFetch).toHaveBeenCalledTimes(2); // Not called third time
  });
});


describe('learning tutor context regressions', () => {
  it('routes personal debugging questions to the server with current source and history', async () => {
    const transport = vi.fn().mockResolvedValue({ source: 'ai_model', answer: 'בדוק את המצב' });
    const service = new LearningAIService({ transport });
    await service.ask({ question: 'למה הכפתור שלי לא מגיב למרות שהוספתי onClick?',
      context: { stage: 'code', filePath: 'ui/Home.kt', code: 'Button(onClick = {}) {}', diagnostics: 'not compiled' },
      recentMessages: [{ sender: 'user', text: 'כבר ניסיתי' }] });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport.mock.calls[0][0].context.code).toContain('onClick');
    expect(transport.mock.calls[0][0].recentMessages).toHaveLength(1);
  });
  it('sends source, diagnostics and current code task to provider and does not invent usage', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true,
      json: async () => ({ choices: [{ message: { content: 'תשובה' } }] }) });
    const service = new LearningAIService({ apiKey: 'test', fetchFn });
    const result = await service.ask({ question: 'למה זה נכשל?',
      activeTask: { id: 'code-3', titleHe: 'מצב מסך', promptHe: 'כתוב מצב', whyHe: 'תגובתיות' },
      context: { stage: 'code', code: 'val count = 0', diagnostics: 'Unresolved reference', filePath: 'Home.kt' } });
    const body = JSON.parse(fetchFn.mock.calls[0][1].body);
    expect(JSON.stringify(body.messages)).toContain('val count = 0');
    expect(JSON.stringify(body.messages)).toContain('Unresolved reference');
    expect(body.messages[0].content).toContain('מצב מסך');
    expect(result.logEntry?.estimatedCostUSD).toBeNull();
    expect(result.logEntry?.promptTokens).toBeNull();
  });
});


describe('Kotlin local definitions', () => {
  it.each(['מה זה אומר הcompossable', 'מה זה @Composable?', 'תסביר לי על Composable', 'מה זה קומפוזבל', 'מה זה אומר ה־Composable'])('answers %s without server or API', async question => {
    const transport = vi.fn();
    const service = new LearningAIService({ transport });
    const result = await service.ask({ question, context: { stage: 'code' } });
    expect(result.source).toBe('local_approved');
    expect(result.answer).toContain('@Composable');
    expect(result.answer).toContain('לא מצייר דבר');
    expect(transport).not.toHaveBeenCalled();
    expect(service.getSessionCallCount()).toBe(0);
  });
  it('distinguishes a Compose button from the visual editor tool', async () => {
    const service = new LearningAIService();
    expect((await service.ask({ question: 'מה זה Button', context: { stage: 'code' } })).answer).toContain('onClick');
    expect((await service.ask({ question: 'מה זה Button', context: { stage: 'design' } })).answer).toContain('בסרגל הכלים');
  });
  it.each(['מה זה Composable ולמה הקוד שלי נכשל?', 'למה הcompossable שלי לא עובד', 'מה זה Composable לעומת ViewModel'])('keeps %s on the personal reasoning route', async question => {
    const transport = vi.fn().mockResolvedValue({ source: 'unavailable', answer: 'not connected' });
    await new LearningAIService({ transport }).ask({ question, context: { stage: 'code' } });
    expect(transport).toHaveBeenCalledOnce();
  });
});
