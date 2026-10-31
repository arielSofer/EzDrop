// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { type ScreenSnapshot } from '@agentic/core';
import { guidedSteps, guidedBatches, checkGuidedStep } from '../preview/guidedSteps';
const source = 'fun Login_s() { Column { Text("Title") } }';
vi.mock('../../../stores/projectStore', () => ({ useProjectStore: (selector: any) => selector({ project: { learningProjectId: 'guided-test', sourceOverrides: { 'screen.kt': 'fun Login_s() { Column(modifier = Modifier.fillMaxSize().background(Color(0xFF112233))) { Text("Title") } }' } } }) }));
vi.mock('../../../stores/learningStore', () => ({ useLearningStore: { getState: () => ({ backToDesignMode() {} }) } }));
vi.mock('../../../stores/androidRunStore', () => ({ useAndroidRunStore: { getState: () => ({ isCurrentSuccess: () => false }) } }));
import { GuidedKotlinCompanion } from '../GuidedKotlinCompanion';
const screen: ScreenSnapshot = { id: 's', name: 'Login', width: 390, height: 844, fillColor: '#112233', components: [{ id: 'title', type: 'Text', name: 'Title', text: 'Title', fontSize: 28, textColor: '#ffffff' }] };
it('splits content, color and font and checks the targeted component', () => {
 const steps = guidedSteps(screen);
 expect(steps.map(step => step.id)).toEqual(['structure','background','layout','title:content','title:color','title:font','title:spacing','review']);
 expect(checkGuidedStep(steps[0], source, screen)).toBeNull();
 expect(checkGuidedStep(steps[4], source, screen)).not.toBeNull();
 expect(checkGuidedStep(steps[4], 'fun Login_s() { Column { Text("Other", color = Color(0xFFffffff)); Text("Title") } }', screen)).not.toBeNull();
});
it('shows one step, hides solutions, gates advance and restores saved progress', async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 const saved = new Map<string,string>();
 vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), clear: () => saved.clear() });
 const host = document.createElement('div'); document.body.appendChild(host); let root = createRoot(host);
 const render = () => root.render(<GuidedKotlinCompanion screen={screen} file="screen.kt" />);
 const click = async (text: string) => act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent === text)!.click(); });
 await act(async () => render());
 expect(host.querySelector('pre')).toBeNull(); expect(host.textContent).not.toContain('גודל הגופן:'); expect(host.textContent).toContain('מתוך 3');
 await click('בדוק והמשך למשימה הבאה'); expect(host.textContent).toContain('השווה את התוצאה');
 await click('אני צריך הסבר נוסף'); expect(host.querySelector('pre')).toBeNull();
 await click('רמז לתחביר'); expect(host.querySelector('pre')).toBeNull();
 await click('הצג דוגמה קטנה'); expect(host.querySelector('pre')!.textContent).toContain('Example');
 expect(host.textContent).not.toContain('fun Login_s');
 await click('הצג פתרון למשימה'); expect(host.textContent).toContain('fun Login_s');
 await act(async () => { host.querySelector<HTMLInputElement>('input')!.click(); });
 await click('בדוק והמשך למשימה הבאה');
 expect(host.textContent).toContain('בונים ומעצבים: Title'); expect(host.querySelector('pre')).toBeNull();
 await act(async () => root.unmount()); root = createRoot(host); await act(async () => render());
 expect(host.textContent).toContain('בונים ומעצבים: Title');
 await click('בדוק והמשך למשימה הבאה');
 expect(host.textContent).toContain('המשך על סמך בדיקה ידנית');
 await click('המשך על סמך בדיקה ידנית');
 expect(host.textContent).toContain('השווה את התוצאה לעיצוב');
 await act(async () => host.querySelector<HTMLInputElement>('input')!.click());
 await click('המשך על סמך בדיקה ידנית');
 expect(host.textContent).toContain('השוואה והרצה סופית');
 const persisted = JSON.parse(saved.get('agentic:guided-kotlin:v1:guided-test:s')!);
 expect(persisted.manual).toContain('title:color');
 await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
});

it('groups whole components and maps a previously saved background step to the first batch', () => {
 const batches = guidedBatches(screen);
 expect(batches).toHaveLength(3);
 expect(batches[0].members.map(step => step.id)).toEqual(['structure', 'background', 'layout']);
 expect(batches.findIndex(batch => batch.members.some(step => step.id === 'background'))).toBe(0);
 expect(batches[1].members.map(step => step.id)).toEqual(['title:content', 'title:color', 'title:font', 'title:spacing']);
});

it('teaches an icon with actionable instructions and a real opt-in solution', () => {
 const iconScreen: ScreenSnapshot = { ...screen, components: [{ id: 'mark', type: 'Icon', name: 'PaceGuard Mark', iconName: 'shield.fill', width: 32, height: 32, textColor: '#ccff33' }] };
 const icon = guidedBatches(iconScreen)[1];
 expect(icon.instruction).toContain('בצע');
 expect(icon.members[0].instruction).toContain('בראש הקובץ');
 expect(icon.members[0].instruction).toContain('imageVector');
 expect(icon.members[0].solution).toContain('Icons.Filled.Shield');
 expect(icon.members[0].solution).not.toContain('אין פתרון');
 expect(checkGuidedStep(icon.members[0], 'fun Login_s() { Column { Icon(imageVector = Icons.Filled.Shield, contentDescription = "Mark") } }', iconScreen)).toBeNull();
});
