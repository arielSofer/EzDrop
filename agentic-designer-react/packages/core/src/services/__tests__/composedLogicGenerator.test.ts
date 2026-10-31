// ComposedLogicGenerator: deterministic auto-wiring (tab bars, back buttons,
// toggles) plus the model-decided interaction pass.

import { describe, expect, it } from 'vitest';
import { makeDesignNode, makeNodeStyle, type DesignNode } from '../../models/DesignNode';
import { makeDesignPage, makeDesignProject } from '../../models/DesignProject';
import { LogicViewModel } from '../../viewModels/LogicViewModel';
import { ComposedLogicGenerator } from '../ComposedLogicGenerator';
import type { RawChatProvider } from '../hosts';
import { FakeDesignHost } from './simulatorHarness';

const plain = (fill = '#FFFFFF') => makeNodeStyle({ fill, cornerRadius: 0, opacity: 1 });

function text(name: string, value: string, x: number): DesignNode {
  return makeDesignNode({ type: 'Text', name, x, y: 0, width: 60, height: 20, text: value, style: plain('#00000000') });
}

function fixture(): FakeDesignHost {
  const navBar = makeDesignNode({
    type: 'Frame',
    name: 'Bottom Navigation',
    x: 0,
    y: 760,
    width: 390,
    height: 84,
    style: plain('#F8F8F8'),
    children: [text('Tab 1', 'Home', 10), text('Tab 2', 'Profile', 200), text('Tab 3', 'Nowhere', 300)],
  });
  const home = makeDesignNode({
    type: 'Frame',
    name: 'Home',
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    style: plain(),
    children: [navBar],
  });

  const knob = makeDesignNode({
    type: 'Rectangle',
    name: 'Toggle Knob',
    x: 2,
    y: 2,
    width: 24,
    height: 24,
    style: plain(),
  });
  const track = makeDesignNode({
    type: 'Rectangle',
    name: 'Toggle Track',
    x: 300,
    y: 100,
    width: 52,
    height: 28,
    style: plain('#D8DCE3'),
    children: [knob],
  });
  const row = makeDesignNode({
    type: 'Frame',
    name: 'Row',
    x: 0,
    y: 100,
    width: 390,
    height: 56,
    style: plain(),
    children: [makeDesignNode({ type: 'Text', name: 'Title', x: 20, y: 0, width: 200, height: 20, text: 'Dark Mode', style: plain('#00000000') }), track],
  });
  const back = makeDesignNode({
    type: 'Button',
    name: 'Back Button',
    x: 16,
    y: 40,
    width: 44,
    height: 44,
    text: 'Back',
    style: plain(),
  });
  const save = makeDesignNode({
    type: 'Button',
    name: 'Save Button',
    x: 20,
    y: 600,
    width: 350,
    height: 52,
    text: 'Save',
    style: plain(),
  });
  const profile = makeDesignNode({
    type: 'Frame',
    name: 'Profile',
    x: 400,
    y: 0,
    width: 390,
    height: 844,
    style: plain(),
    children: [back, row, save],
  });

  const project = makeDesignProject({
    name: 'Fixture',
    pages: [makeDesignPage({ id: 'PAGE', name: 'Page 1', nodes: [home, profile] })],
  });
  return new FakeDesignHost(project);
}

function stubProvider(content: string): RawChatProvider {
  return { generateRawChat: () => Promise.resolve(content) };
}

describe('ComposedLogicGenerator.generate', () => {
  it('auto-wires tab bars, back buttons and toggles with no provider at all', async () => {
    const design = fixture();
    const logic = new LogicViewModel();
    const result = await ComposedLogicGenerator.generate('a settings app', undefined, design, logic);

    expect(result.flowCount).toBe(2);
    expect(result.wiredElements).toBe(0);
    // Home: one tab ("Profile"; "Home" is the current screen, "Nowhere" has no
    // match). Profile: back button + toggle.
    expect(result.autoWired).toBe(3);

    const names = logic.flows.map((f) => f.name);
    expect(names).toEqual(['Home Navigation', 'Profile Navigation']);

    const homeFlow = logic.flows[0]!;
    expect(homeFlow.blocks.map((b) => b.type)).toEqual(['onTap', 'navigate']);
    expect(homeFlow.connections).toHaveLength(1);
    const navigate = homeFlow.blocks[1]!;
    const profileScreen = design.project.pages[0]!.nodes[1]!;
    expect(navigate.parameters.find((p) => p.key === 'screen')?.nodeReference).toBe(profileScreen.id);

    const profileFlow = logic.flows[1]!;
    expect(profileFlow.blocks.map((b) => b.type)).toEqual(['onTap', 'goBack', 'onTap', 'toggleVariable']);
    const toggle = profileFlow.blocks[3]!;
    expect(toggle.parameters.find((p) => p.key === 'variable')?.variableReference).toBe('darkModeEnabled');

    // The variable is declared globally and the knob is bound to it.
    expect(design.project.globalVariables.map((v) => v.name)).toEqual(['darkModeEnabled']);
    const knob = profileScreen.children[1]!.children[1]!.children[0]!;
    expect(knob.name).toBe('Toggle Knob');
    expect(knob.logicBindings).toEqual([{ id: knob.logicBindings![0]!.id, kind: 'isOn', variableName: 'darkModeEnabled' }]);

    // The flows really landed on the page (attach + persist).
    expect(design.project.pages[0]!.logicFlows).toHaveLength(2);
  });

  it('builds the model-decided interactions on top of the auto-wired ones', async () => {
    const design = fixture();
    const logic = new LogicViewModel();
    const provider = stubProvider(
      `Sure! {"interactions":[
        {"element":"Save","screen":"Profile","action":"toast","message":"Saved!"},
        {"element":"Back","screen":"Profile","action":"back"},
        {"element":"Save","screen":"Profile","action":"navigate","target":"Home"},
        {"element":"Ghost","screen":"Profile","action":"toast","message":"never"},
        {"element":"Save","screen":"Profile","action":"explode"}
      ]}`,
    );

    const result = await ComposedLogicGenerator.generate('a settings app', provider, design, logic);
    expect(result.wiredElements).toBe(3);
    expect(result.flowCount).toBe(3);
    const interactions = logic.flows.find((f) => f.name === 'Profile Interactions')!;
    expect(interactions.blocks.map((b) => b.type)).toEqual(['onTap', 'showToast', 'onTap', 'goBack', 'onTap', 'navigate']);
    expect(interactions.blocks[1]!.parameters.find((p) => p.key === 'message')?.value).toBe('Saved!');
  });

  it('survives a provider that answers with no JSON at all', async () => {
    const design = fixture();
    const logic = new LogicViewModel();
    const result = await ComposedLogicGenerator.generate('x', stubProvider('sorry, no'), design, logic);
    expect(result.wiredElements).toBe(0);
    expect(result.flowCount).toBe(2);
  });

  it('does nothing when the page has no screens', async () => {
    const project = makeDesignProject({
      name: 'Empty',
      pages: [makeDesignPage({ id: 'PAGE', name: 'Page 1', nodes: [] })],
    });
    const design = new FakeDesignHost(project);
    const logic = new LogicViewModel();
    const result = await ComposedLogicGenerator.generate('x', undefined, design, logic);
    expect(result).toEqual({ flowCount: 0, wiredElements: 0, autoWired: 0 });
    expect(logic.flows).toEqual([]);
  });
});
