// LogicSimulator smoke test over the real sample projects: every event flow
// runs to completion without throwing and logs the entries the Swift logs.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BlockCatalog } from '../../models/BlockDefinitions';
import { parseDesignProject } from '../../models/codec';
import type { LogicBlockType } from '../../models/LogicModels';
import { makeHarness } from './simulatorHarness';

const ROOT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner';

const SAMPLES = [
  'SavedProjects/AsterReader-BookApp-FullLogic.agenticdesign',
  'SavedProjects/WaltDelivery-MusicApp-FullLogic.agenticdesign',
  'PaceGuard.agenticdesign',
  'Looply.agenticdesign',
  'SavedProjects/flappy-agent-demo.agenticdesign',
  'SavedProjects/flappy-and-runner.agenticdesign',
].map((relative) => `${ROOT}/${relative}`);

const SCREEN_EVENTS: LogicBlockType[] = ['onScreenLoad', 'onAppLaunch', 'onScreenOpened'];

describe('LogicSimulator over the sample projects', () => {
  for (const path of SAMPLES) {
    const name = path.slice(path.lastIndexOf('/') + 1);

    it(`runs every event flow of ${name}`, async () => {
      expect(existsSync(path), path).toBe(true);
      const project = parseDesignProject(readFileSync(path, 'utf8'));

      let flowsRun = 0;
      let screenEventFlows = 0;

      for (let pageIndex = 0; pageIndex < project.pages.length; pageIndex += 1) {
        const page = project.pages[pageIndex]!;
        if (page.logicFlows.length === 0) continue;

        const { logic, simulator } = makeHarness(project, pageIndex);
        try {
          for (const flow of logic.flows) {
            // Same rule as LogicSimulator.run(): start from the selected
            // event block, else the first event block of the flow.
            const events = flow.blocks.filter((b) => BlockCatalog.definition(b.type)?.inputPortCount === 0);
            const event = events.find((b) => SCREEN_EVENTS.includes(b.type)) ?? events[0];
            if (!event) continue;
            if (SCREEN_EVENTS.includes(event.type)) screenEventFlows += 1;

            logic.currentFlowId = flow.id;
            logic.selectedBlockId = event.id;
            simulator.run();
            await simulator.waitForIdle();

            const messages = simulator.log.map((entry) => entry.message);
            expect(messages[0]).toBe(`▶ Running '${flow.name}' from '${event.label}'`);
            expect(messages).toContain(`Event: ${event.label}`);
            expect(messages[messages.length - 1]).toBe('Flow finished');
            expect(simulator.isRunning).toBe(false);
            flowsRun += 1;
          }
        } finally {
          simulator.stopAllTimers();
          simulator.stop();
        }
      }

      expect(flowsRun).toBeGreaterThan(0);
      // PaceGuard and Looply are the samples wired with screen lifecycle events.
      if (name === 'PaceGuard.agenticdesign' || name === 'Looply.agenticdesign') {
        expect(screenEventFlows).toBeGreaterThan(0);
      }
    }, 60_000);
  }

  it('logs onScreenLoad / onAppLaunch flows of PaceGuard end to end', async () => {
    const project = parseDesignProject(readFileSync(`${ROOT}/PaceGuard.agenticdesign`, 'utf8'));
    const { logic, simulator } = makeHarness(project, 0);
    try {
      for (const type of ['onScreenLoad', 'onAppLaunch'] as LogicBlockType[]) {
        const flow = logic.flows.find((f) => f.blocks.some((b) => b.type === type));
        expect(flow, `sample has an ${type} flow`).toBeDefined();
        const event = flow!.blocks.find((b) => b.type === type)!;

        logic.currentFlowId = flow!.id;
        logic.selectedBlockId = event.id;
        simulator.run();
        await simulator.waitForIdle();

        const messages = simulator.log.map((e) => e.message);
        expect(messages).toContain(`Event: ${event.label}`);
        expect(messages[messages.length - 1]).toBe('Flow finished');
      }
    } finally {
      simulator.stopAllTimers();
      simulator.stop();
    }
  }, 30_000);

  it('runs tap flows too, and mutates the design through the host', async () => {
    const project = parseDesignProject(
      readFileSync(`${ROOT}/SavedProjects/AsterReader-BookApp-FullLogic.agenticdesign`, 'utf8'),
    );
    const { logic, simulator } = makeHarness(project, 0);
    try {
      const tapEvents = logic.flows.flatMap((flow) =>
        flow.blocks
          .filter((b) => b.type === 'onTap')
          .map((block) => ({
            flowId: flow.id,
            nodeId: block.parameters.find((p) => p.key === 'element')?.nodeReference,
          })),
      );
      const wired = tapEvents.find((t) => t.nodeId !== undefined);
      expect(wired, 'sample has a tap flow bound to an element').toBeDefined();

      simulator.runTap(wired!.nodeId!);
      await simulator.waitForIdle();
      expect(simulator.log.map((e) => e.message)).toContain('Flow finished');
    } finally {
      simulator.stopAllTimers();
      simulator.stop();
    }
  }, 30_000);

  it('handleGameEvent seeds the game variables the Swift seeds', async () => {
    const project = parseDesignProject(
      readFileSync(`${ROOT}/SavedProjects/flappy-agent-demo.agenticdesign`, 'utf8'),
    );
    const { simulator } = makeHarness(project, 0);
    try {
      simulator.handleGameEvent({ kind: 'started' });
      await simulator.waitForIdle();
      expect(simulator.variables['gameOver']).toBe('false');
      expect(simulator.variables['gameWon']).toBe('false');

      simulator.handleGameEvent({ kind: 'scoreChanged', score: 7 });
      await simulator.waitForIdle();
      expect(simulator.variables['gameScore']).toBe('7');

      simulator.handleGameEvent({ kind: 'gameOver', score: 12 });
      await simulator.waitForIdle();
      expect(simulator.variables['gameScore']).toBe('12');
      expect(simulator.variables['gameOver']).toBe('true');

      simulator.handleGameEvent({ kind: 'lifeLost', remaining: 2 });
      await simulator.waitForIdle();
      expect(simulator.variables['gameLives']).toBe('2');

      simulator.handleGameEvent({ kind: 'tap', x: 41.7, y: 88.2 });
      await simulator.waitForIdle();
      expect(simulator.variables['gameTapX']).toBe('41');
      expect(simulator.variables['gameTapY']).toBe('88');

      simulator.handleGameEvent({ kind: 'launched', entityId: 'bird-1' });
      await simulator.waitForIdle();
      expect(simulator.variables['gameLaunched']).toBe('bird-1');
    } finally {
      simulator.stopAllTimers();
      simulator.stop();
    }
  }, 30_000);
});
