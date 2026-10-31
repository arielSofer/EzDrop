// Per-block semantics, with the expected values read off
// Services/LogicSimulator.swift.

import { describe, expect, it } from 'vitest';
import { BlockCatalog } from '../../models/BlockDefinitions';
import { makeDesignNode, makeNodeStyle } from '../../models/DesignNode';
import { makeDesignPage, makeDesignProject } from '../../models/DesignProject';
import {
  makeBlockConnection,
  makeLogicFlow,
  makeLogicVariable,
  type LogicBlock,
  type LogicBlockType,
  type LogicFlow,
} from '../../models/LogicModels';
import { makeHarness, stubFetch, type Harness } from './simulatorHarness';

interface Wired {
  type: LogicBlockType;
  values?: Record<string, string>;
  variables?: Record<string, string>;
  nodes?: Record<string, string>;
}

function block(spec: Wired, y: number): LogicBlock {
  const made = BlockCatalog.makeBlock(spec.type, { x: 0, y });
  if (!made) throw new Error(`no catalog definition for ${spec.type}`);
  for (const [key, value] of Object.entries(spec.values ?? {})) {
    const param = made.parameters.find((p) => p.key === key);
    if (param) param.value = value;
    else made.parameters.push({ id: `p-${key}`, key, label: key, type: 'string', value, isRequired: false });
  }
  for (const [key, name] of Object.entries(spec.variables ?? {})) {
    const param = made.parameters.find((p) => p.key === key);
    if (param) param.variableReference = name;
    else made.parameters.push({ id: `v-${key}`, key, label: key, type: 'variable', variableReference: name, isRequired: false });
  }
  for (const [key, nodeId] of Object.entries(spec.nodes ?? {})) {
    const param = made.parameters.find((p) => p.key === key);
    if (param) param.nodeReference = nodeId;
    else made.parameters.push({ id: `n-${key}`, key, label: key, type: 'nodeReference', nodeReference: nodeId, isRequired: false });
  }
  return made;
}

/** onScreenLoad → step0 → step1 … (each on output port 0). */
function chainFlow(steps: Wired[], globals: Record<string, string> = {}): { flow: LogicFlow; harness: Harness } {
  const event = block({ type: 'onScreenLoad' }, 0);
  const blocks: LogicBlock[] = [event];
  const connections = [];
  let previous = event.id;
  steps.forEach((spec, index) => {
    const made = block(spec, 120 * (index + 1));
    blocks.push(made);
    connections.push(
      makeBlockConnection({
        sourceBlockId: previous,
        sourcePortIndex: 0,
        targetBlockId: made.id,
        targetPortIndex: 0,
      }),
    );
    previous = made.id;
  });

  const flow = makeLogicFlow({ name: 'Test Flow', blocks, connections });
  const screen = makeDesignNode({
    type: 'Frame',
    name: 'Screen',
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
  });
  const project = makeDesignProject({
    name: 'Fixture',
    pages: [makeDesignPage({ id: 'PAGE', name: 'Page 1', nodes: [screen], logicFlows: [flow] })],
    globalVariables: Object.entries(globals).map(([name, defaultValue]) =>
      makeLogicVariable({ name, defaultValue, type: 'string', scope: 'global' }),
    ),
  });
  const harness = makeHarness(project, 0);
  return { flow: harness.logic.flows[0]!, harness };
}

async function run(steps: Wired[], globals: Record<string, string> = {}): Promise<Harness> {
  const { flow, harness } = chainFlow(steps, globals);
  harness.logic.currentFlowId = flow.id;
  harness.logic.selectedBlockId = flow.blocks[0]!.id;
  harness.simulator.run();
  await harness.simulator.waitForIdle();
  harness.simulator.stopAllTimers();
  return harness;
}

describe('data operations', () => {
  it('setVariable substitutes {{tokens}} from the current variables', async () => {
    const h = await run(
      [
        { type: 'setVariable', variables: { variable: 'greeting' }, values: { value: 'Hello {{name}}' } },
      ],
      { name: 'Ada' },
    );
    expect(h.simulator.variables['greeting']).toBe('Hello Ada');
    expect(h.simulator.log.map((e) => e.message)).toContain('greeting = Hello Ada');
  });

  it('incrementVariable / decrementVariable format whole results without a decimal', async () => {
    const inc = await run(
      [{ type: 'incrementVariable', variables: { variable: 'count' }, values: { amount: '3' } }],
      { count: '4' },
    );
    expect(inc.simulator.variables['count']).toBe('7');

    const dec = await run(
      [{ type: 'decrementVariable', variables: { variable: 'count' }, values: { amount: '0.5' } }],
      { count: '4' },
    );
    expect(dec.simulator.variables['count']).toBe('3.5');
  });

  it('toggleVariable flips against the string "true"', async () => {
    const h = await run([{ type: 'toggleVariable', variables: { variable: 'flag' } }], { flag: 'false' });
    expect(h.simulator.variables['flag']).toBe('true');
  });

  it('appendToArray / removeFromArray keep a newline-separated list', async () => {
    const h = await run(
      [
        { type: 'appendToArray', variables: { array: 'items' }, values: { value: 'a' } },
        { type: 'appendToArray', variables: { array: 'items' }, values: { value: 'b' } },
        { type: 'removeFromArray', variables: { array: 'items' }, values: { value: 'a' } },
      ],
      { items: '' },
    );
    expect(h.simulator.variables['items']).toBe('b');
  });

  it('mathOperation covers + - × ÷ % and stores whole results as integers', async () => {
    const cases: [string, string, string, string][] = [
      ['2', '+', '3', '5'],
      ['7', '-', '2.5', '4.5'],
      ['6', '×', '7', '42'],
      ['9', '÷', '2', '4.5'],
      ['9', '÷', '0', '0'],
      ['7', '%', '4', '3'],
      ['7', '%', '0', '0'],
    ];
    for (const [left, op, right, expected] of cases) {
      const h = await run([
        { type: 'mathOperation', variables: { variable: 'result' }, values: { left, operator: op, right } },
      ]);
      expect(h.simulator.variables['result'], `${left} ${op} ${right}`).toBe(expected);
    }
  });

  it('stringOperation covers uppercase/lowercase/trim/replace and defaults to concat', async () => {
    const cases: [string, string, string, string][] = [
      ['uppercase', ' hi ', '', ' HI '],
      ['lowercase', 'ABC', '', 'abc'],
      ['trim', '  padded  ', '', 'padded'],
      ['replace', 'a-b-a', 'a', '-b-'],
      ['concat', 'foo', 'bar', 'foobar'],
      ['substring', 'foo', 'bar', 'foobar'],
    ];
    for (const [operation, input, argument, expected] of cases) {
      const h = await run([
        {
          type: 'stringOperation',
          variables: { variable: 'out' },
          values: { operation, input, argument },
        },
      ]);
      expect(h.simulator.variables['out'], operation).toBe(expected);
    }
  });

  it('jsonParse takes port 0 for valid JSON and port 1 (error) otherwise', async () => {
    const ok = await run([
      { type: 'jsonParse', variables: { variable: 'parsed' }, values: { input: '{"a":1}' } },
    ]);
    expect(ok.simulator.variables['parsed']).toBe('{"a":1}');
    expect(ok.simulator.log.map((e) => e.message)).toContain('JSON parsed');

    const bad = await run([{ type: 'jsonParse', variables: { variable: 'parsed' }, values: { input: 'nope' } }]);
    expect(bad.simulator.variables['parsed']).toBeUndefined();
    const invalid = bad.simulator.log.find((e) => e.message === 'Invalid JSON');
    expect(invalid?.isError).toBe(true);
  });

  it('appendJsonItem grows a JSON array literal', async () => {
    const h = await run(
      [
        { type: 'appendJsonItem', variables: { variable: 'list' }, values: { item: '{"a":1}' } },
        { type: 'appendJsonItem', variables: { variable: 'list' }, values: { item: '{"b":2}' } },
      ],
      { list: '[]' },
    );
    expect(h.simulator.variables['list']).toBe('[{"a":1},{"b":2}]');
  });

  it('replaceInVariable replaces every occurrence', async () => {
    const h = await run(
      [
        {
          type: 'replaceInVariable',
          variables: { variable: 'text' },
          values: { find: 'ON', replaceWith: 'OFF' },
        },
      ],
      { text: 'ON and ON' },
    );
    expect(h.simulator.variables['text']).toBe('OFF and OFF');
  });

  it('arrayOperation, jsonBuild and formatDate have no simulator implementation — they log and continue', async () => {
    // The Swift `performDataOperation` switch does not name these three;
    // they fall through to `default: append("number", block.label)`.
    for (const type of ['arrayOperation', 'jsonBuild', 'formatDate'] as LogicBlockType[]) {
      const label = BlockCatalog.definition(type)!.label;
      const h = await run([
        {
          type,
          variables: { variable: 'out', array: 'items' },
          values: { operation: 'push', argument: 'x', fields: 'a=1', input: '2026-01-02', format: 'yyyy' },
        },
      ]);
      const entry = h.simulator.log.find((e) => e.message === label);
      expect(entry, type).toBeDefined();
      expect(entry!.icon).toBe('number');
      expect(h.simulator.variables['out']).toBeUndefined();
    }
  });

  it('saveValue / loadValue round-trip through AgenticDesignerPreview.<key>', async () => {
    const h = await run(
      [
        { type: 'saveValue', values: { key: 'greeting', value: '{{name}}!' } },
        { type: 'loadValue', variables: { variable: 'loaded' }, values: { key: 'greeting', default: 'none' } },
      ],
      { name: 'Ada' },
    );
    expect(h.storage.get('AgenticDesignerPreview.greeting')).toBe('Ada!');
    expect(h.simulator.variables['loaded']).toBe('Ada!');
  });

  it('game blocks broadcast commands through the GameCommandSink', async () => {
    const h = await run([
      { type: 'gameSpawn', values: { template: 'pipe', x: '120', y: '40' } },
      { type: 'gameAddScore', values: { points: '3' } },
      { type: 'gameEnd', values: { result: 'win' } },
      { type: 'gameSetGravity', values: { gravityX: '0', gravity: '-9' } },
    ]);
    expect(h.games.commands).toEqual([
      { kind: 'spawn', template: 'pipe', x: 120, y: 40 },
      { kind: 'addScore', value: 3 },
      { kind: 'end', win: true },
      { kind: 'setGravityVector', dx: 0, dy: -9 },
    ]);
  });
});

describe('conditions', () => {
  async function branch(type: LogicBlockType, values: Record<string, string>): Promise<string> {
    const event = block({ type: 'onScreenLoad' }, 0);
    const condition = block({ type, values }, 120);
    const thenLeg = block({ type: 'log', values: { message: 'THEN' } }, 240);
    const elseLeg = block({ type: 'log', values: { message: 'ELSE' } }, 360);
    const flow = makeLogicFlow({
      name: 'Branch',
      blocks: [event, condition, thenLeg, elseLeg],
      connections: [
        makeBlockConnection({ sourceBlockId: event.id, sourcePortIndex: 0, targetBlockId: condition.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: condition.id, sourcePortIndex: 0, targetBlockId: thenLeg.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: condition.id, sourcePortIndex: 1, targetBlockId: elseLeg.id, targetPortIndex: 0 }),
      ],
    });
    const project = makeDesignProject({
      name: 'Fixture',
      pages: [makeDesignPage({ id: 'PAGE', name: 'Page 1', nodes: [], logicFlows: [flow] })],
    });
    const harness = makeHarness(project, 0);
    harness.logic.currentFlowId = harness.logic.flows[0]!.id;
    harness.logic.selectedBlockId = event.id;
    harness.simulator.run();
    await harness.simulator.waitForIdle();
    harness.simulator.stopAllTimers();
    const logged = harness.simulator.log.map((e) => e.message);
    return logged.includes('LOG: THEN') ? 'then' : logged.includes('LOG: ELSE') ? 'else' : 'none';
  }

  it('ifCondition compares numerically when both sides parse as numbers', async () => {
    expect(await branch('ifCondition', { leftValue: '10', operator: '>', rightValue: '9' })).toBe('then');
    expect(await branch('ifCondition', { leftValue: '10', operator: '>', rightValue: '11' })).toBe('else');
    // "10" > "9" is FALSE as strings; the numeric path is what makes it true.
    expect(await branch('ifCondition', { leftValue: '10', operator: '==', rightValue: '10.0' })).toBe('then');
  });

  it('ifCondition falls back to string comparison, contains and isEmpty', async () => {
    expect(await branch('ifCondition', { leftValue: 'abc', operator: '==', rightValue: 'abc' })).toBe('then');
    expect(await branch('ifCondition', { leftValue: 'abc', operator: '!=', rightValue: 'abd' })).toBe('then');
    expect(await branch('ifCondition', { leftValue: 'abcdef', operator: 'contains', rightValue: 'cde' })).toBe('then');
    expect(await branch('ifCondition', { leftValue: '', operator: 'isEmpty', rightValue: '' })).toBe('then');
    expect(await branch('ifCondition', { leftValue: 'x', operator: 'isEmpty', rightValue: '' })).toBe('else');
    // An unknown operator is false → else.
    expect(await branch('ifCondition', { leftValue: 'a', operator: '<', rightValue: 'b' })).toBe('else');
  });

  it('compare uses the left/right keys', async () => {
    expect(await branch('compare', { left: '3', operator: '<=', right: '3' })).toBe('then');
    expect(await branch('compare', { left: '4', operator: '<=', right: '3' })).toBe('else');
  });

  it('isEmpty / contains / logicalNot / logicalAnd / logicalOr', async () => {
    expect(await branch('isEmpty', { value: '' })).toBe('then');
    expect(await branch('isEmpty', { value: 'x' })).toBe('else');
    expect(await branch('contains', { value: 'hello world', substring: 'world' })).toBe('then');
    expect(await branch('contains', { value: 'hello', substring: 'zzz' })).toBe('else');
    expect(await branch('logicalNot', { value: 'false' })).toBe('then');
    expect(await branch('logicalNot', { value: 'true' })).toBe('else');
    expect(await branch('logicalAnd', { a: 'true', b: 'true' })).toBe('then');
    expect(await branch('logicalAnd', { a: 'true', b: 'false' })).toBe('else');
    expect(await branch('logicalOr', { a: 'false', b: 'true' })).toBe('then');
    expect(await branch('logicalOr', { a: 'false', b: 'false' })).toBe('else');
  });

  it('platformCondition branches on the preview platform', async () => {
    expect(await branch('platformCondition', { platform: 'iPhone' })).toBe('then');
    expect(await branch('platformCondition', { platform: 'appleWatch' })).toBe('else');
  });
});

describe('UI updates and bindings', () => {
  it('setText mutates the node through the host and bindProperty keeps it live', async () => {
    const label = makeDesignNode({
      type: 'Text',
      name: 'Label',
      x: 0,
      y: 0,
      width: 100,
      height: 20,
      text: 'before',
      style: makeNodeStyle({ fill: '#00000000', cornerRadius: 0, opacity: 1 }),
    });
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Screen',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
      children: [label],
    });

    const event = block({ type: 'onScreenLoad' }, 0);
    const bind = block({ type: 'bindProperty', nodes: { element: label.id }, variables: { variable: 'counter' }, values: { property: 'text' } }, 120);
    const setText = block({ type: 'setText', nodes: { element: label.id }, values: { text: 'after' } }, 240);
    const increment = block({ type: 'incrementVariable', variables: { variable: 'counter' }, values: { amount: '1' } }, 360);
    const flow = makeLogicFlow({
      name: 'UI',
      blocks: [event, bind, setText, increment],
      connections: [
        makeBlockConnection({ sourceBlockId: event.id, sourcePortIndex: 0, targetBlockId: bind.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: bind.id, sourcePortIndex: 0, targetBlockId: setText.id, targetPortIndex: 0 }),
        makeBlockConnection({ sourceBlockId: setText.id, sourcePortIndex: 0, targetBlockId: increment.id, targetPortIndex: 0 }),
      ],
      variables: [makeLogicVariable({ name: 'counter', type: 'number', defaultValue: '0', scope: 'screen' })],
    });
    const project = makeDesignProject({
      name: 'Fixture',
      pages: [makeDesignPage({ id: 'PAGE', name: 'Page 1', nodes: [screen], logicFlows: [flow] })],
    });
    const harness = makeHarness(project, 0);
    harness.logic.currentFlowId = harness.logic.flows[0]!.id;
    harness.logic.selectedBlockId = event.id;
    harness.simulator.run();
    await harness.simulator.waitForIdle();
    harness.simulator.stopAllTimers();

    // The binding re-pushed "1" after incrementVariable, overwriting "after".
    expect(harness.simulator.variables['counter']).toBe('1');
    expect(harness.design.nodeForSimulation(label.id)?.text).toBe('1');
    expect(harness.simulator.hasUIChanges).toBe(true);
  });

  it('setInputValue writes the node text, the bound variable and fires onChange', async () => {
    const input = makeDesignNode({
      type: 'Input',
      name: 'Email',
      x: 0,
      y: 0,
      width: 200,
      height: 40,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 8, opacity: 1 }),
      logicBindings: [{ id: 'B1', kind: 'value', variableName: 'email' }],
    });
    const screen = makeDesignNode({
      type: 'Frame',
      name: 'Screen',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
      children: [input],
    });
    const event = block({ type: 'onChange', nodes: { element: input.id } }, 0);
    const toast = block({ type: 'showToast', values: { message: 'changed' } }, 120);
    const flow = makeLogicFlow({
      name: 'Change',
      blocks: [event, toast],
      connections: [
        makeBlockConnection({ sourceBlockId: event.id, sourcePortIndex: 0, targetBlockId: toast.id, targetPortIndex: 0 }),
      ],
    });
    const project = makeDesignProject({
      name: 'Fixture',
      pages: [makeDesignPage({ id: 'PAGE', name: 'Page 1', nodes: [screen], logicFlows: [flow] })],
    });
    const harness = makeHarness(project, 0);
    harness.simulator.setInputValue(input.id, 'ada@example.com');
    await harness.simulator.waitForIdle();
    harness.simulator.stopAllTimers();

    expect(harness.design.nodeForSimulation(input.id)?.text).toBe('ada@example.com');
    expect(harness.simulator.variables['email']).toBe('ada@example.com');
    expect(harness.simulator.log.map((e) => e.message)).toContain('TOAST: changed');
    // (the toast auto-dismiss timer already fired: the harness clock is instant)
  });
});

describe('HTTP + Firestore mock', () => {
  it('httpRequest stores statusCode/responseBody and parseJSONResponse walks the path', async () => {
    const { flow, harness } = chainFlow([
      { type: 'httpRequest', values: { url: 'https://example.com/api', method: 'GET' } },
      { type: 'parseJSONResponse', variables: { variable: 'title' }, values: { path: 'items.0.title' } },
    ]);
    const withBody = makeHarness(
      harness.design.project,
      0,
      stubFetch('{"items":[{"title":"First"}]}'),
    );
    withBody.logic.currentFlowId = flow.id;
    withBody.logic.selectedBlockId = flow.blocks[0]!.id;
    withBody.simulator.run();
    await withBody.simulator.waitForIdle();
    withBody.simulator.stopAllTimers();

    expect(withBody.simulator.variables['statusCode']).toBe('200');
    expect(withBody.simulator.variables['responseBody']).toBe('{"items":[{"title":"First"}]}');
    expect(withBody.simulator.variables['title']).toBe('First');
  });

  it('the in-memory Firestore round-trips a write, a read and a query', async () => {
    const h = await run([
      {
        type: 'firestoreSetDocument',
        values: { collection: 'users', documentId: 'u1', data: 'name=Ada\nrole=admin' },
      },
      { type: 'firestoreGetDocument', variables: { variable: 'doc' }, values: { path: 'users/u1' } },
      { type: 'firestoreQuery', variables: { variable: 'rows' }, values: { collection: 'users' } },
    ]);
    expect(h.simulator.variables['doc']).toBe('{"name":"Ada","role":"admin"}');
    expect(h.simulator.variables['rows']).toBe('[{"name":"Ada","role":"admin","id":"u1","_id":"u1"}]');
    expect(h.simulator.log.map((e) => e.message)).toContain('Mock Firestore: users → 1 document(s)');
  });
});
