// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { GameTemplateLibrary, type GameEvent, type GameCommand } from '@agentic/core';
import { GameSceneRegistry } from '@agentic/core/game/GameSceneRegistry';
import { AgentGameScene } from '../AgentGameScene';

describe('AgentGameScene (headless 60Hz runner)', () => {
  it('loads Flappy template, steps 60 frames, dispatches commands', () => {
    const events: GameEvent[] = [];
    const flappySpec = GameTemplateLibrary.flappy();

    const scene = new AgentGameScene({
      spec: flappySpec,
      size: { width: flappySpec.width, height: flappySpec.height },
      nodeId: 'node-flappy-1',
      onEvent: (event) => events.push(event),
      autoRun: false,
    });

    scene.didMove();
    expect(scene.children.length).toBeGreaterThan(0);

    // Step 60 frames (1 second of physics)
    for (let i = 0; i < 60; i++) {
      scene.step();
    }

    // Send a jump command to the player
    scene.send({ kind: 'impulse', entity: 'bird', dx: 0, dy: 300 });

    // Step another 30 frames
    for (let i = 0; i < 30; i++) {
      scene.step();
    }

    scene.destroy();
  });

  it('loads Angry Birds slingshot template and simulates physics', () => {
    const angryBirdsSpec = GameTemplateLibrary.angryBirds();
    const scene = new AgentGameScene({
      spec: angryBirdsSpec,
      size: { width: angryBirdsSpec.width, height: angryBirdsSpec.height },
      nodeId: 'node-slingshot-1',
      autoRun: false,
    });

    scene.didMove();
    expect(scene.children.length).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) {
      scene.step();
    }

    scene.destroy();
  });

  it('loads Runner template and handles scoring commands', () => {
    const runnerSpec = GameTemplateLibrary.runner();
    const scene = new AgentGameScene({
      spec: runnerSpec,
      size: { width: runnerSpec.width, height: runnerSpec.height },
      nodeId: 'node-runner-1',
      autoRun: false,
    });

    scene.didMove();

    // Test command dispatch via GameSceneRegistry
    const sent = GameSceneRegistry.send('node-runner-1', { kind: 'addScore', value: 50 });
    expect(sent).toBe(true);

    // Step frames
    for (let i = 0; i < 30; i++) {
      scene.step();
    }

    scene.destroy();
  });

  it('handles pause, resume, and restart commands', () => {
    const spec = GameTemplateLibrary.flappy();
    const scene = new AgentGameScene({
      spec,
      size: { width: spec.width, height: spec.height },
      nodeId: 'node-flappy-lifecycle',
      autoRun: false,
    });

    scene.didMove();

    scene.send({ kind: 'pause', value: true });
    scene.step();

    scene.send({ kind: 'pause', value: false });
    scene.step();

    scene.send({ kind: 'restart' });
    scene.step();

    scene.destroy();
  });
});
