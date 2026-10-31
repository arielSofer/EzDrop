import { expect, it } from 'vitest';
import { applyPreviewAction, evaluatePreview } from '../previewInteraction';
it('updates strings, interpolates, toggles and increments local state', () => {
  const values = { email: '""', message: '""', count: '0', active: 'false' };
  const a = applyPreviewAction('{ email = it }', values, Object.keys(values), 'אימייל $count');
  expect(evaluatePreview('email', a)).toBe('אימייל $count');
  const b = applyPreviewAction('{ count++; active = !active; message = "שלום $email" }', a, Object.keys(values));
  expect(b.count).toBe('1'); expect(b.active).toBe('true'); expect(JSON.parse(b.message)).toBe('שלום אימייל $count');
  expect(evaluatePreview('email.isNotBlank() && count != 0', b)).toBe(true);
});
it('supports named input arguments and string concatenation', () => {
  expect(applyPreviewAction('{ value -> email = value }', { email: '""' }, ['email'], 'abc').email).toBe('"abc"');
  expect(evaluatePreview('"count: " + count.toString()', { count: '2' })).toBe('count: 2');
});
it('rejects unsupported operations atomically and never changes original state', () => {
  const values = { count: '0' };
  expect(() => applyPreviewAction('{ count++; login() }', values, ['count'])).toThrow();
  expect(values.count).toBe('0');
  expect(() => applyPreviewAction('{ count = 2 }', values, [])).toThrow();
  expect(() => evaluatePreview('fetch("url")', {})).toThrow();
});
