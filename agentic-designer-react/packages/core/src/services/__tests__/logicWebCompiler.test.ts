// LogicWebCompiler: program shape per block type, plus a snapshot of the
// compiled output for three sample projects (the runtime script is fixed,
// so the snapshot pins both the program JSON and the interpreter).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockCatalog } from '../../models/BlockDefinitions';
import { parseDesignProject } from '../../models/codec';
import { makeDesignNode, makeNodeStyle } from '../../models/DesignNode';
import { makeBlockConnection, makeLogicFlow, makeLogicVariable, type LogicBlock } from '../../models/LogicModels';
import { LogicWebCompiler, runtime } from '../LogicWebCompiler';

const ROOT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner';

const SNAPSHOT_SAMPLES = [
  'SavedProjects/AsterReader-BookApp-FullLogic.agenticdesign',
  'PaceGuard.agenticdesign',
  'Looply.agenticdesign',
];

function payloadOf(dataBlock: string): Record<string, unknown> {
  const open = '<script id="app-data" type="application/json">';
  const json = dataBlock.slice(open.length, dataBlock.length - '</script>'.length).split('<\\/').join('</');
  return JSON.parse(json) as Record<string, unknown>;
}

function blockWith(type: Parameters<typeof BlockCatalog.makeBlock>[0], values: Record<string, string>, variables: Record<string, string> = {}): LogicBlock {
  const made = BlockCatalog.makeBlock(type, { x: 0, y: 0 })!;
  for (const [key, value] of Object.entries(values)) {
    const p = made.parameters.find((param) => param.key === key);
    if (p) p.value = value;
  }
  for (const [key, name] of Object.entries(variables)) {
    const p = made.parameters.find((param) => param.key === key);
    if (p) p.variableReference = name;
  }
  return made;
}

describe('LogicWebCompiler.compile', () => {
  it('indexes tap programs by node id and accumulates several flows per node', () => {
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Home',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFF', cornerRadius: 0, opacity: 1 }),
    });
    const nodeId = 'BUTTON-1';

    const makeTapFlow = (message: string) => {
      const tap = blockWith('onTap', {}, {});
      tap.parameters.find((p) => p.key === 'element')!.nodeReference = nodeId;
      const toast = blockWith('showToast', { message });
      return makeLogicFlow({
        name: `Flow ${message}`,
        blocks: [tap, toast],
        connections: [
          makeBlockConnection({ sourceBlockId: tap.id, sourcePortIndex: 0, targetBlockId: toast.id, targetPortIndex: 0 }),
        ],
      });
    };

    const compiled = LogicWebCompiler.compile({
      screens: [screen],
      flows: [makeTapFlow('one'), makeTapFlow('two')],
      globals: [makeLogicVariable({ name: 'count', type: 'number', defaultValue: '3', scope: 'global' })],
    });
    const payload = payloadOf(compiled.dataBlock);

    expect(payload['firstScreen']).toBe(screen.id);
    expect(payload['state']).toEqual({ count: 3 });
    expect((payload['taps'] as Record<string, unknown[]>)[nodeId]).toEqual([
      { t: 'toast', msg: 'one' },
      { t: 'toast', msg: 'two' },
    ]);
  });

  it('compiles an if/else into then/else branches with the web operator names', () => {
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Home',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFF', cornerRadius: 0, opacity: 1 }),
    });
    const load = blockWith('onScreenLoad', {});
    const branch = blockWith('ifCondition', { operator: '>', rightValue: '2' }, { leftValue: 'count' });
    const thenLeg = blockWith('showToast', { message: 'many' });
    const elseLeg = blockWith('log', { message: 'few' });
    const flow = makeLogicFlow({
      name: 'Load',
      blocks: [load, branch, thenLeg, elseLeg],
      screenNodeId: screen.id,
      connections: [
        makeBlockConnection({ sourceBlockId: load.id, sourcePortIndex: 0, targetBlockId: branch.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: branch.id, sourcePortIndex: 0, targetBlockId: thenLeg.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: branch.id, sourcePortIndex: 1, targetBlockId: elseLeg.id, targetPortIndex: 0 }),
      ],
    });

    const payload = payloadOf(LogicWebCompiler.compile({ screens: [screen], flows: [flow], globals: [] }).dataBlock);
    expect((payload['screenLoads'] as Record<string, unknown[]>)[screen.id]).toEqual([
      {
        t: 'if',
        left: 'count',
        op: 'greaterThan',
        right: '2',
        then: [{ t: 'toast', msg: 'many' }],
        else: [{ t: 'log', msg: 'few' }],
      },
    ]);
  });

  it('drops native-only blocks and keeps the rest of the chain', () => {
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Home',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFF', cornerRadius: 0, opacity: 1 }),
    });
    const tap = blockWith('onTap', {});
    tap.parameters.find((p) => p.key === 'element')!.nodeReference = 'BUTTON-1';
    const haptic = blockWith('hapticFeedback', { style: 'light' });
    const increment = blockWith('incrementVariable', { amount: '2' }, { variable: 'count' });
    const decrement = blockWith('decrementVariable', { amount: '2' }, { variable: 'count' });
    const flow = makeLogicFlow({
      name: 'Tap',
      blocks: [tap, haptic, increment, decrement],
      connections: [
        makeBlockConnection({ sourceBlockId: tap.id, sourcePortIndex: 0, targetBlockId: haptic.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: haptic.id, sourcePortIndex: 0, targetBlockId: increment.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: increment.id, sourcePortIndex: 0, targetBlockId: decrement.id, targetPortIndex: 0 }),
      ],
    });

    const payload = payloadOf(LogicWebCompiler.compile({ screens: [screen], flows: [flow], globals: [] }).dataBlock);
    expect((payload['taps'] as Record<string, unknown[]>)['BUTTON-1']).toEqual([
      { t: 'add', var: 'count', by: 2 },
      { t: 'add', var: 'count', by: -2 },
    ]);
  });

  it('bakes the toggle knob travel into isOn bindings', () => {
    const knob = makeDesignNode({
      type: 'Rectangle',
      name: 'Toggle Knob',
      x: 2,
      y: 2,
      width: 24,
      height: 24,
      style: makeNodeStyle({ fill: '#FFF', cornerRadius: 12, opacity: 1 }),
      logicBindings: [{ id: 'B', kind: 'isOn', variableName: 'darkModeEnabled' }],
    });
    const track = makeDesignNode({
      type: 'Rectangle',
      name: 'Toggle Track',
      x: 0,
      y: 0,
      width: 52,
      height: 28,
      style: makeNodeStyle({ fill: '#D8DCE3', cornerRadius: 14, opacity: 1 }),
      children: [knob],
    });
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Settings',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFF', cornerRadius: 0, opacity: 1 }),
      children: [track],
    });

    const payload = payloadOf(LogicWebCompiler.compile({ screens: [screen], flows: [], globals: [] }).dataBlock);
    expect(payload['bindings']).toEqual([
      { node: knob.id, kind: 'isOn', var: 'darkModeEnabled', travel: 52 - 24 - 2 * 2 },
    ]);
  });

  it('embeds the Supabase url/key only when the project is configured', () => {
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Home',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFF', cornerRadius: 0, opacity: 1 }),
    });
    const unconfigured = payloadOf(
      LogicWebCompiler.compile({
        screens: [screen],
        flows: [],
        globals: [],
        supabase: { projectURL: '', anonKey: '', isEnabled: true },
      }).dataBlock,
    );
    expect(unconfigured['supabase']).toBeUndefined();

    const configured = payloadOf(
      LogicWebCompiler.compile({
        screens: [screen],
        flows: [],
        globals: [],
        supabase: { projectURL: 'https://x.supabase.co', anonKey: 'anon', isEnabled: true },
      }).dataBlock,
    );
    expect(configured['supabase']).toEqual({ url: 'https://x.supabase.co', key: 'anon' });
  });

  it('escapes "</" so a value can never close the JSON script block', () => {
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Home',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFF', cornerRadius: 0, opacity: 1 }),
    });
    const compiled = LogicWebCompiler.compile({
      screens: [screen],
      flows: [],
      globals: [makeLogicVariable({ name: 'x', type: 'string', defaultValue: '</script><img>', scope: 'global' })],
    });
    expect(compiled.dataBlock).toContain('<\\/script>');
    expect(compiled.dataBlock.indexOf('</script>')).toBe(compiled.dataBlock.length - '</script>'.length);
  });

  it('runtime() is the fixed interpreter', () => {
    expect(runtime()).toMatchSnapshot();
  });
});

describe('compiled output for the sample projects', () => {
  for (const relative of SNAPSHOT_SAMPLES) {
    it(`matches the snapshot for ${relative}`, () => {
      const project = parseDesignProject(readFileSync(`${ROOT}/${relative}`, 'utf8'));
      const page = project.pages[0]!;
      const screens = page.nodes.filter((n) => n.type === 'Frame');
      const compiled = LogicWebCompiler.compile({
        screens,
        flows: page.logicFlows,
        globals: project.globalVariables,
        supabase: project.supabaseConfig,
      });
      // The runtime is snapshotted once above; the program is what varies.
      expect(compiled.dataBlock).toMatchSnapshot();
      expect(compiled.runtimeScript).toBe(`<script>\n${runtime()}\n</script>`);
    });
  }
});

describe('runtime parity with LogicWebCompiler.swift', () => {
  it('emits the Swift multi-line string verbatim (dedented by its closing delimiter)', () => {
    const swift = readFileSync(`${ROOT}/AgenticDesigner/Services/LogicWebCompiler.swift`, 'utf8');
    const lines = swift.split('\n');
    const open = lines.findIndex((l) => l.trim() === '"""' && lines[lines.indexOf(l) + 1]?.includes('(function ()'));
    expect(open).toBeGreaterThan(-1);
    const close = lines.indexOf('        """', open + 1);
    expect(close).toBeGreaterThan(open);
    const indent = (lines[close]!.length - lines[close]!.trimStart().length);
    const expected = lines
      .slice(open + 1, close)
      .map((line) => (line.length >= indent ? line.slice(indent) : line.trimStart()))
      .join('\n');
    expect(runtime()).toBe(expected);
  });
});
