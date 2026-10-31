// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { expect, it } from 'vitest';
import { ComposePreviewCanvas } from '../ComposePreviewCanvas';
import { parseComposePreview } from '../composePreview';
it('lets the student type, click, see state, reset and get unsupported-action feedback', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement('div'); document.body.appendChild(element); const root = createRoot(element);
  const source = `fun Login() {
    var email by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    Column {
      OutlinedTextField(value = email, onValueChange = { email = it }, label = { Text("אימייל") })
      Button(enabled = email.isNotBlank(), onClick = { message = "שלום $email" }) { Text("המשך") }
      Text(message)
      Button(onClick = { login() }) { Text("שרת") }
    }
  }`;
  await act(async () => root.render(<ComposePreviewCanvas document={parseComposePreview(source, 'Login')} />));
  const button = () => [...element.querySelectorAll('button')].find(b => b.textContent === 'המשך')!;
  expect(button().disabled).toBe(true);
  const input = element.querySelector('input')!;
  await act(async () => { Simulate.change(input, { target: { value: 'דנה' } } as any); });
  expect(input.value).toBe('דנה'); expect(button().disabled).toBe(false);
  await act(async () => button().click());
  expect(element.textContent).toContain('שלום דנה');
  await act(async () => [...element.querySelectorAll('button')].find(b => b.textContent === 'שרת')!.click());
  expect(element.textContent).toContain('בדוק את הפעולה באמולטור');
  await act(async () => [...element.querySelectorAll('button')].find(b => b.textContent === 'איפוס התצוגה')!.click());
  expect(input.value).toBe(''); expect(button().disabled).toBe(true);
  expect(element.textContent).not.toContain('שלום דנה');
  await act(async () => root.unmount()); element.remove();
});
