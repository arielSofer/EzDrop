import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockCatalog } from '../BlockDefinitions';
import { AllAppPlatform } from '../DesignProject';
import { AllLogicBlockCategory, AllLogicBlockType, LogicBlockCategory, isLogicBlockType } from '../LogicModels';

const SWIFT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner/AgenticDesigner/Models/BlockDefinitions.swift';
const swiftSource = readFileSync(SWIFT, 'utf8');

/** Every `def(.type, .category, "label", "icon",` in source order. */
function swiftDefs(): { type: string; category: string; label: string; icon: string }[] {
  const re = /def\(\.(\w+),\s*\.(\w+),\s*"((?:[^"\\]|\\.)*)",\s*"((?:[^"\\]|\\.)*)"/g;
  const out: { type: string; category: string; label: string; icon: string }[] = [];
  for (const m of swiftSource.matchAll(re)) {
    out.push({ type: m[1], category: m[2], label: JSON.parse(`"${m[3]}"`), icon: JSON.parse(`"${m[4]}"`) });
  }
  return out;
}

describe('BlockCatalog parity with BlockDefinitions.swift', () => {
  const defs = swiftDefs();

  it('has exactly as many entries as `def(` calls in the Swift file, in the same order', () => {
    const defCallCount = (swiftSource.match(/\bdef\(\./g) ?? []).length;
    expect(defs.length).toBe(defCallCount);
    expect(BlockCatalog.all.length).toBe(defCallCount);
    expect(BlockCatalog.all.map((d) => d.type)).toEqual(defs.map((d) => d.type));
  });

  it('matches every label, icon and category', () => {
    BlockCatalog.all.forEach((d, i) => {
      expect(d.label, d.type).toBe(defs[i].label);
      expect(d.icon, d.type).toBe(defs[i].icon);
      expect(d.category, d.type).toBe(LogicBlockCategory[defs[i].category as keyof typeof LogicBlockCategory]);
      expect(d.color).toBe(BlockCatalog.color(d.category));
    });
  });

  it('defines every LogicBlockType exactly once (no duplicates, no gaps)', () => {
    const types = BlockCatalog.all.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
    const swiftCovered = new Set(defs.map((d) => d.type));
    for (const type of AllLogicBlockType) {
      expect(swiftCovered.has(type), `${type} has a Swift definition`).toBe(true);
      expect(BlockCatalog.definition(type), `${type} has a port definition`).toBeDefined();
    }
    for (const type of swiftCovered) {
      expect(isLogicBlockType(type), `${type} is a LogicBlockType`).toBe(true);
    }
  });

  it('keeps default parameters, ports and labels verbatim (spot checks)', () => {
    const onTap = BlockCatalog.definition('onTap')!;
    expect(onTap.inputPortCount).toBe(0);
    expect(onTap.outputPortCount).toBe(1);
    expect(onTap.defaultParameters).toHaveLength(1);
    expect(onTap.defaultParameters[0]).toMatchObject({
      key: 'element', label: 'Element', type: 'nodeReference', isRequired: true,
      placeholder: 'Select a button or element...',
    });

    const confirm = BlockCatalog.definition('confirmDialog')!;
    expect(confirm.outputPortCount).toBe(2);
    expect(confirm.outputPortLabels).toEqual(['Confirmed', 'Cancelled']);
    expect(confirm.defaultParameters.map((p) => [p.key, p.value, p.isRequired])).toEqual([
      ['title', undefined, true],
      ['message', undefined, false],
      ['confirmLabel', 'Confirm', false],
      ['cancelLabel', 'Cancel', false],
    ]);

    const http = BlockCatalog.definition('httpRequest')!;
    expect(http.outputPortLabels).toEqual(['✓ Success', '✗ Error']);
    expect(http.defaultParameters[3].placeholder).toBe('{"key": "value"}');
    expect(http.defaultParameters[1].options).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

    const platform = BlockCatalog.definition('platformCondition')!;
    expect(platform.defaultParameters[0].options).toEqual([...AllAppPlatform]);
    expect(platform.outputPortLabels).toEqual(['Matches', 'Other']);

    const time = BlockCatalog.definition('getCurrentTime')!;
    expect(time.description).toBe('Store the current time as "H:MM" (e.g. 6:30) in a variable — compare it to an alarm time');

    const addBehavior = BlockCatalog.definition('gameAddBehavior')!;
    expect(addBehavior.description).toContain('{"type":"spin","strength":180}');

    const loadValue = BlockCatalog.definition('loadValue')!;
    expect(loadValue.category).toBe('Variables');

    const stop = BlockCatalog.definition('stopTracking')!;
    expect(stop.defaultParameters).toEqual([]);
    expect(stop.inputPortCount).toBe(1);
    expect(stop.outputPortCount).toBe(1);
    expect(stop.outputPortLabels).toBeUndefined();
  });

  it('category colours and per-category listing', () => {
    expect(BlockCatalog.color('Events')).toBe('#10B981');
    expect(BlockCatalog.color('Device & Sensors')).toBe('#EC4899');
    const total = AllLogicBlockCategory.reduce((sum, c) => sum + BlockCatalog.definitions(c).length, 0);
    expect(total).toBe(BlockCatalog.all.length);
    expect(BlockCatalog.definitions('Firebase').map((d) => d.type)).toContain('firestoreQuery');
  });

  it('makeBlock copies parameters (mutating a block never touches the catalog)', () => {
    const block = BlockCatalog.makeBlock('setVariable', { x: 10, y: 20 })!;
    expect(block).toMatchObject({ type: 'setVariable', category: 'Variables', label: 'Set Variable', x: 10, y: 20, width: 200, isCollapsed: false });
    expect(block.parameters).toHaveLength(2);
    block.parameters[0].value = 'changed';
    expect(BlockCatalog.definition('setVariable')!.defaultParameters[0].value).toBeUndefined();
    const again = BlockCatalog.makeBlock('setVariable', { x: 0, y: 0 })!;
    expect(again.id).not.toBe(block.id);
    expect(again.parameters[0].id).toBe(block.parameters[0].id); // same as Swift: catalog param ids are shared
  });
});
