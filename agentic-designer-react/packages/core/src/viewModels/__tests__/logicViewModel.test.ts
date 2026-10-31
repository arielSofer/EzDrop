// LogicViewModel: validation messages, connection rules, undo/redo,
// templates, variables and BlockGeometry — all against ViewModels/LogicViewModel.swift.

import { describe, expect, it } from 'vitest';
import { BlockCatalog } from '../../models/BlockDefinitions';
import { makeDesignNode, makeNodeStyle } from '../../models/DesignNode';
import { makeDesignPage, makeDesignProject, type DesignProject } from '../../models/DesignProject';
import { FlowTemplateLibrary } from '../../models/FlowTemplateLibrary';
import { makeLogicFlow } from '../../models/LogicModels';
import type { DesignHostForLogic } from '../../services/hosts';
import { BlockGeometry, LogicViewModel } from '../LogicViewModel';

function makeHost(project?: DesignProject): DesignHostForLogic & { project: DesignProject } {
  const screen = makeDesignNode({
    type: 'Frame',
    name: 'Home',
    x: 0,
    y: 0,
    width: 390,
    height: 844,
    style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
    children: [
      makeDesignNode({
        type: 'Button',
        name: 'Continue',
        x: 20,
        y: 700,
        width: 350,
        height: 52,
        text: 'Continue',
        style: makeNodeStyle({ fill: '#111827', cornerRadius: 12, opacity: 1 }),
      }),
    ],
  });
  const doc =
    project ??
    makeDesignProject({
      name: 'Fixture',
      pages: [makeDesignPage({ id: 'PAGE', name: 'Page 1', nodes: [screen] })],
    });
  return {
    project: doc,
    currentPageIndex: 0,
    mutateProject(update) {
      update(doc);
    },
    setLogicBinding() {
      /* recorded by the design store in the app */
    },
  };
}

function attached(): { vm: LogicViewModel; host: ReturnType<typeof makeHost> } {
  const host = makeHost();
  const vm = new LogicViewModel();
  vm.attach(host);
  return { vm, host };
}

describe('attach / persist', () => {
  it('creates "Flow 1" when the page has none, selects it and validates', () => {
    const { vm, host } = attached();
    expect(vm.flows).toHaveLength(1);
    expect(vm.flows[0]!.name).toBe('Flow 1');
    expect(vm.currentFlowId).toBe(vm.flows[0]!.id);
    expect(vm.validationIssues).toEqual([]);
    // The default flow only exists in memory until something persists.
    vm.persist();
    expect(host.project.pages[0]!.logicFlows).toHaveLength(1);
  });

  it('persist() writes the flows back onto the current page', () => {
    const { vm, host } = attached();
    vm.addBlock('onTap', { x: 10, y: 10 });
    expect(host.project.pages[0]!.logicFlows[0]!.blocks).toHaveLength(1);
  });
});

describe('validate()', () => {
  it('reports the exact Swift messages', () => {
    const { vm } = attached();
    const event = vm.addBlock('onTap', { x: 0, y: 0 })!;
    const toast = vm.addBlock('showToast', { x: 0, y: 200 })!;

    vm.validate();
    const messages = vm.validationIssues.map((i) => `${i.severity}: ${i.message}`);
    expect(messages).toContain(`error: ${event.label}: 'Element' is required`);
    expect(messages).toContain(`error: ${toast.label}: 'Message' is required`);
    expect(messages).toContain(`warning: ${event.label}: event is not connected to anything`);
    expect(messages).toContain(`warning: ${toast.label}: unreachable — no incoming connection`);

    // Connecting them clears both warnings.
    expect(vm.connectBlocks(event.id, 0, toast.id, 0)).toBe(true);
    const afterConnect = vm.validationIssues.map((i) => i.message);
    expect(afterConnect).not.toContain(`${event.label}: event is not connected to anything`);
    expect(afterConnect).not.toContain(`${toast.label}: unreachable — no incoming connection`);

    // Filling the required parameters clears the errors.
    vm.linkParameterToNode(event.id, 'element', 'NODE-1');
    vm.updateParameter(toast.id, 'message', 'Saved');
    expect(vm.validationIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(vm.hasIssue(event.id)).toBe(false);
  });

  it('hasIssue only counts errors', () => {
    const { vm } = attached();
    const event = vm.addBlock('onTap', { x: 0, y: 0 })!;
    expect(vm.hasIssue(event.id)).toBe(true); // 'Element' is required
    vm.linkParameterToNode(event.id, 'element', 'NODE-1');
    // The "not connected" warning remains, but hasIssue is errors-only.
    expect(vm.validationIssues.some((i) => i.blockId === event.id)).toBe(true);
    expect(vm.hasIssue(event.id)).toBe(false);
  });
});

describe('connection rules', () => {
  it('rejects self-connections, events as targets, taken input ports and cycles', () => {
    const { vm } = attached();
    const event = vm.addBlock('onTap', { x: 0, y: 0 })!;
    const a = vm.addBlock('showToast', { x: 0, y: 200 })!;
    const b = vm.addBlock('log', { x: 0, y: 400 })!;

    expect(vm.validateConnection(a.id, a.id, 0)).toBe(false); // self
    expect(vm.validateConnection(a.id, event.id, 0)).toBe(false); // events can't receive
    expect(vm.connectBlocks(event.id, 0, a.id, 0)).toBe(true);
    expect(vm.validateConnection(b.id, a.id, 0)).toBe(false); // input port taken
    expect(vm.connectBlocks(a.id, 0, b.id, 0)).toBe(true);
    expect(vm.validateConnection(b.id, a.id, 1)).toBe(false); // cycle a → b → a
    expect(vm.currentFlow!.connections).toHaveLength(2);

    vm.disconnectBlocks(vm.currentFlow!.connections[0]!.id);
    expect(vm.currentFlow!.connections).toHaveLength(1);
  });

  it('endConnectionDrag snaps to an input port within 28pt and ignores anything further', () => {
    const { vm } = attached();
    const event = vm.addBlock('onTap', { x: 0, y: 0 })!;
    const target = vm.addBlock('showToast', { x: 300, y: 400 })!;
    const port = BlockGeometry.inputPortPosition(vm.currentFlow!.blocks[1]!);

    vm.beginConnectionDrag(event.id, 0, { x: 0, y: 0 });
    vm.updateConnectionDrag({ x: port.x, y: port.y + 200 });
    vm.endConnectionDrag({ x: port.x, y: port.y + 200 });
    expect(vm.currentFlow!.connections).toHaveLength(0);
    expect(vm.isConnecting).toBe(false);
    expect(vm.connectionDragStart).toBeUndefined();

    vm.beginConnectionDrag(event.id, 0, { x: 0, y: 0 });
    vm.endConnectionDrag({ x: port.x + 10, y: port.y + 10 });
    expect(vm.currentFlow!.connections).toHaveLength(1);
    expect(vm.currentFlow!.connections[0]!.targetBlockId).toBe(target.id);
    expect(vm.currentFlow!.connections[0]!.targetPortIndex).toBe(0);
  });
});

describe('blocks, flows and undo', () => {
  it('duplicateBlock offsets by 32/32 and gives every parameter a fresh id', () => {
    const { vm } = attached();
    const original = vm.addBlock('showToast', { x: 100, y: 100 })!;
    vm.updateParameter(original.id, 'message', 'Hi');
    vm.duplicateBlock(original.id);

    const copy = vm.currentFlow!.blocks[1]!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.x).toBe(132);
    expect(copy.y).toBe(132);
    expect(copy.parameters[0]!.value).toBe('Hi');
    expect(copy.parameters.map((p) => p.id)).not.toEqual(original.parameters.map((p) => p.id));
  });

  it('deleteBlock removes its connections; deleteSelected prefers the block', () => {
    const { vm } = attached();
    const event = vm.addBlock('onTap', { x: 0, y: 0 })!;
    const toast = vm.addBlock('showToast', { x: 0, y: 200 })!;
    vm.connectBlocks(event.id, 0, toast.id, 0);

    vm.selectedBlockId = toast.id;
    vm.deleteSelected();
    expect(vm.currentFlow!.blocks.map((b) => b.id)).toEqual([event.id]);
    expect(vm.currentFlow!.connections).toHaveLength(0);
    expect(vm.selectedBlockId).toBeUndefined();
  });

  it('undo/redo walk the flow snapshots', () => {
    const { vm } = attached();
    vm.addBlock('onTap', { x: 0, y: 0 });
    vm.addBlock('showToast', { x: 0, y: 200 });
    expect(vm.currentFlow!.blocks).toHaveLength(2);

    vm.undo();
    expect(vm.currentFlow!.blocks).toHaveLength(1);
    vm.undo();
    expect(vm.currentFlow!.blocks).toHaveLength(0);
    vm.redo();
    expect(vm.currentFlow!.blocks).toHaveLength(1);
  });

  it('createFlow / renameFlow / deleteFlow keep a flow selected at all times', () => {
    const { vm } = attached();
    vm.createFlow('Login', 'SCREEN-1');
    expect(vm.flows).toHaveLength(2);
    expect(vm.currentFlow!.name).toBe('Login');
    expect(vm.currentFlow!.screenNodeId).toBe('SCREEN-1');

    vm.renameFlow(vm.currentFlowId!, 'Sign In');
    expect(vm.currentFlow!.name).toBe('Sign In');

    vm.deleteFlow(vm.currentFlowId!);
    expect(vm.flows).toHaveLength(1);
    expect(vm.currentFlowId).toBe(vm.flows[0]!.id);

    vm.deleteFlow(vm.currentFlowId!);
    expect(vm.flows.map((f) => f.name)).toEqual(['Flow 1']);
  });

  it('insertTemplate replaces the empty default flow and unique-names collisions', () => {
    const { vm } = attached();
    const template = FlowTemplateLibrary.all[0]!;
    vm.insertTemplate(template);
    expect(vm.flows).toHaveLength(1);
    expect(vm.flows[0]!.name).toBe(template.build().name);

    vm.insertTemplate(template);
    expect(vm.flows).toHaveLength(2);
    expect(vm.flows[1]!.name).toBe(`${template.build().name} 2`);
  });

  it('applyGenerated drops the empty default flow and focuses the first generated one', () => {
    const { vm } = attached();
    const generated = makeLogicFlow({ name: 'Generated' });
    vm.applyGenerated([generated]);
    expect(vm.flows.map((f) => f.name)).toEqual(['Generated']);
    expect(vm.currentFlowId).toBe(generated.id);
  });
});

describe('variables and platforms', () => {
  it('addVariable routes global variables to the project and flow variables to the flow', () => {
    const { vm, host } = attached();
    vm.addVariable('userId', 'string', 'global', '');
    vm.addVariable('draft', 'json', 'flow', '{}');

    expect(host.project.globalVariables.map((v) => v.name)).toEqual(['userId']);
    expect(vm.currentFlow!.variables.map((v) => v.name)).toEqual(['draft']);
    expect(vm.allVariables.map((v) => v.name)).toEqual(['draft', 'userId']);

    vm.deleteVariable(vm.currentFlow!.variables[0]!.id);
    expect(vm.currentFlow!.variables).toHaveLength(0);
    vm.deleteVariable(host.project.globalVariables[0]!.id);
    expect(host.project.globalVariables).toHaveLength(0);
  });

  it('setPlatform never leaves the project without a platform', () => {
    const { vm, host } = attached();
    vm.setPlatform('appleWatch', true);
    expect(host.project.platformSettings.enabledPlatforms).toEqual(['iPhone', 'iPad', 'appleWatch']);

    vm.setPlatform('iPhone', false);
    vm.setPlatform('iPad', false);
    vm.setPlatform('appleWatch', false);
    expect(host.project.platformSettings.enabledPlatforms).toEqual(['iPhone']);
    expect(host.project.platformSettings.defaultPreviewPlatform).toBe('iPhone');

    vm.setDefaultPreviewPlatform('appleWatch');
    expect(host.project.platformSettings.enabledPlatforms).toContain('appleWatch');
    expect(host.project.platformSettings.defaultPreviewPlatform).toBe('appleWatch');
  });
});

describe('design node access', () => {
  it('flattens the page tree and lists root Frames as screens', () => {
    const { vm, host } = attached();
    const screen = host.project.pages[0]!.nodes[0]!;
    expect(vm.designScreens).toEqual([{ id: screen.id, name: 'Home' }]);
    expect(vm.designNodesFlat.map((n) => n.name)).toEqual(['Home', 'Continue']);
    expect(vm.designNodeName(screen.children[0]!.id)).toBe('Continue');
    expect(vm.designNodeName(undefined)).toBeUndefined();
  });
});

describe('BlockGeometry', () => {
  it('matches the Swift constants and port maths', () => {
    expect(BlockGeometry.headerHeight).toBe(34);
    expect(BlockGeometry.paramRowHeight).toBe(26);
    expect(BlockGeometry.footerHeight).toBe(22);

    const withLabels = BlockCatalog.makeBlock('ifCondition', { x: 100, y: 50 })!;
    const params = withLabels.parameters.length;
    expect(BlockGeometry.height(withLabels)).toBe(34 + params * 26 + 22);

    const plain = BlockCatalog.makeBlock('showToast', { x: 0, y: 0 })!;
    expect(BlockGeometry.height(plain)).toBe(34 + plain.parameters.length * 26 + 10);

    plain.isCollapsed = true;
    expect(BlockGeometry.height(plain)).toBe(34);

    expect(BlockGeometry.inputPortPosition(withLabels)).toEqual({ x: 100 + withLabels.width / 2, y: 50 });
    // Two output ports → thirds of the block width.
    expect(BlockGeometry.outputPortPosition(withLabels, 0).x).toBe(100 + withLabels.width / 3);
    expect(BlockGeometry.outputPortPosition(withLabels, 1).x).toBe(100 + (withLabels.width * 2) / 3);
    expect(BlockGeometry.outputPortPosition(withLabels, 0).y).toBe(50 + BlockGeometry.height(withLabels));
  });
});

describe('subscribe()', () => {
  it('notifies on every published mutation', () => {
    const { vm } = attached();
    let notifications = 0;
    const unsubscribe = vm.subscribe(() => {
      notifications += 1;
    });
    vm.addBlock('onTap', { x: 0, y: 0 });
    expect(notifications).toBeGreaterThan(0);
    const seen = notifications;
    unsubscribe();
    vm.addBlock('log', { x: 0, y: 100 });
    expect(notifications).toBe(seen);
  });
});
