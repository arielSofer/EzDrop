// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ undo: vi.fn(), redo: vi.fn(), pushStackElement: vi.fn(), mounts: vi.fn() }));
vi.mock('@monaco-editor/react', () => ({ default: (props: any) => {
  React.useEffect(() => {
    mocks.mounts();
    props.onMount({ getModel: () => mocks, focus() {} }, { editor: { defineTheme() {}, setTheme() {} } });
  }, []);
  return <textarea aria-label="code" />;
} }));
import { CodeTextView } from '../CodeTextView';
it('routes Hebrew physical Cmd Z and Cmd Shift Z to undo/redo without remounting on edits', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement('div'); document.body.appendChild(element); const root = createRoot(element);
  await act(async () => root.render(<CodeTextView fileId="test.kt" text="a" isEditable resetToken="one" />));
  element.querySelector('textarea')!.focus();
  for (const shiftKey of [false, true]) {
    const event = new KeyboardEvent('keydown', { key: 'ז', code: 'KeyZ', metaKey: true, shiftKey, bubbles: true, cancelable: true });
    element.querySelector('textarea')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(shiftKey ? mocks.redo : mocks.undo).toHaveBeenCalledTimes(1);
  }
  const nativeUndo = new InputEvent('beforeinput', { inputType: 'historyUndo', bubbles: true, cancelable: true });
  element.querySelector('textarea')!.dispatchEvent(nativeUndo);
  expect(nativeUndo.defaultPrevented).toBe(true);
  expect(mocks.undo).toHaveBeenCalledTimes(2);
  await act(async () => root.render(<CodeTextView fileId="test.kt" text="ab" isEditable resetToken="one" />));
  expect(mocks.mounts).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount()); element.remove();
});
