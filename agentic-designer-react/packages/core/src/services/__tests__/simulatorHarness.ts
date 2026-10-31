// Shared test harness: a fake ProjectViewModel host plus a simulator wired
// to it. Mirrors what `apps/web` will implement for real.

import type { DesignNode } from '../../models/DesignNode';
import type { DesignProject } from '../../models/DesignProject';
import type { NodeLogicBindingKind } from '../../models/DesignNode';
import type { Clock } from '../../platform/Clock';
import { MemoryStorage } from '../../platform/Storage';
import { LogicViewModel } from '../../viewModels/LogicViewModel';
import { LogicSimulator } from '../LogicSimulator';
import type { DesignHostForLogic, FetchLike, GameCommandSink, SimulatorDesignHost } from '../hosts';
import type { GameCommand } from '../../models/GameCommand';

/** Resolves on the macrotask queue whatever the requested duration is. */
export class TestClock implements Clock {
  constructor(private readonly fixedNow = Date.UTC(2026, 0, 2, 3, 4, 5)) {}
  now(): number {
    return this.fixedNow;
  }
  monotonic(): number {
    return 0;
  }
  sleep(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export class FakeDesignHost implements SimulatorDesignHost, DesignHostForLogic {
  currentPageIndex = 0;
  selectedNodeId: string | undefined;

  constructor(public project: DesignProject) {}

  mutateProject(update: (project: DesignProject) => void): void {
    update(this.project);
  }

  get nodes(): DesignNode[] {
    return this.project.pages[this.currentPageIndex]?.nodes ?? [];
  }

  private find(nodes: DesignNode[], id: string): DesignNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = this.find(node.children, id);
      if (found) return found;
    }
    return undefined;
  }

  nodeForSimulation(id: string): DesignNode | undefined {
    return this.find(this.nodes, id);
  }

  simulateUpdateNode(id: string, update: (node: DesignNode) => void): void {
    const node = this.find(this.nodes, id);
    if (node) update(node);
  }

  snapshotNodesForSimulation(): DesignNode[] {
    return this.nodes;
  }

  restoreNodesFromSimulation(nodes: DesignNode[]): void {
    const page = this.project.pages[this.currentPageIndex];
    if (page) page.nodes = nodes;
  }

  selectNode(id: string): void {
    this.selectedNodeId = id;
  }

  repeatTemplateForOrAncestorOf(id: string): DesignNode | undefined {
    const search = (nodes: DesignNode[], ancestorTemplate: DesignNode | undefined): DesignNode | undefined => {
      for (const node of nodes) {
        const template = node.repeatBinding !== undefined ? node : ancestorTemplate;
        if (node.id === id) return template;
        const found = search(node.children, template);
        if (found) return found;
      }
      return undefined;
    };
    return search(this.nodes, undefined);
  }

  setLogicBinding(nodeId: string, kind: NodeLogicBindingKind, variableName: string | undefined): void {
    this.simulateUpdateNode(nodeId, (node) => {
      const bindings = (node.logicBindings ?? []).filter((b) => b.kind !== kind);
      if (variableName !== undefined && variableName !== '') {
        bindings.push({ id: 'BINDING', kind, variableName });
      }
      node.logicBindings = bindings;
    });
  }
}

export class RecordingGameSink implements GameCommandSink {
  readonly commands: GameCommand[] = [];
  queryResult = '';
  broadcast(command: GameCommand): void {
    this.commands.push(command);
  }
  query(): string {
    return this.queryResult;
  }
}

/** `URLSession.shared` stand-in: always 200 with the given body. */
export function stubFetch(body = '{}', status = 200): FetchLike {
  return () => Promise.resolve({ status, text: () => Promise.resolve(body) });
}

export interface Harness {
  design: FakeDesignHost;
  logic: LogicViewModel;
  simulator: LogicSimulator;
  games: RecordingGameSink;
  storage: MemoryStorage;
}

export function makeHarness(project: DesignProject, pageIndex = 0, fetchImpl: FetchLike = stubFetch()): Harness {
  const design = new FakeDesignHost(project);
  design.currentPageIndex = pageIndex;
  const logic = new LogicViewModel();
  logic.attach(design);
  const games = new RecordingGameSink();
  const storage = new MemoryStorage();
  const simulator = new LogicSimulator({ fetchImpl, gameSink: games, storage, clock: new TestClock() });
  simulator.logicViewModel = logic;
  simulator.designViewModel = design;
  simulator.speed = 0;
  // Firebase auth / confirm / permission blocks pause for a human; the
  // harness always takes the first (success) branch.
  // (deferred to a microtask: `awaitBranchChoice` publishes `awaitingChoice`
  // before it installs the continuation, exactly as the Swift does.)
  simulator.subscribe(() => {
    if (!simulator.awaitingChoice) return;
    queueMicrotask(() => {
      if (simulator.awaitingChoice) simulator.choose(0);
    });
  });
  return { design, logic, simulator, games, storage };
}
