// BackendWiringGenerator over the real sample projects, one per app category.
// The expected flow names and block counts are derived from
// Services/BackendWiringGenerator.swift: e.g. "Auth Gate" is
// onAppLaunch → firebaseGetCurrentUser → navigate(home) + navigate(login)
// (4 blocks / 3 connections), and "Sign Up" on a synthesized screen is
// trigger + 3 validation pairs + register + getCurrentUser + setDocument +
// navigate + 2 alerts (13 blocks / 12 connections).

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDesignProject } from '../../models/codec';
import { LogicViewModel } from '../../viewModels/LogicViewModel';
import { wire } from '../BackendWiringGenerator';
import { FakeDesignHost } from './simulatorHarness';

const ROOT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner';

interface Expectation {
  file: string;
  prompt: string;
  collections: string[];
  createdScreens: string[];
  boundInputs: number;
  /** [flow name, block count, connection count] */
  flows: [string, number, number][];
}

const CASES: Expectation[] = [
  {
    file: 'SavedProjects/TradeWise-Academy-Trading-Learning-clean.agenticdesign',
    prompt: 'a stock trading app with portfolio and watchlist',
    collections: ['users', 'holdings', 'watchlist', 'orders'],
    createdScreens: ['Log In', 'Sign Up'],
    boundInputs: 6,
    flows: [
      ['Auth Gate', 4, 3],
      ['Log In', 8, 7],
      ['Go to Sign Up', 2, 1],
      ['Reset Password', 4, 3],
      ['Sign Up', 13, 12],
      ['Go to Log In', 2, 1],
      ['Load Profile', 2, 1],
      ['Load Holdings', 3, 2],
      ['Open New Holding', 2, 1],
      ['Close New Holding', 2, 1],
      ['Save Holding', 6, 5],
    ],
  },
  {
    file: 'PaceGuard.agenticdesign',
    prompt: 'a running fitness tracker with workouts',
    collections: ['users', 'workouts', 'goals'],
    createdScreens: [],
    boundInputs: 0,
    flows: [
      ['Auth Gate', 4, 3],
      // No bound email input on the designed login screen → no validate pair.
      ['Log In', 6, 5],
      ['Go to Sign Up', 2, 1],
      ['Reset Password', 4, 3],
      ['Sign Up', 7, 6],
      ['Log Out', 5, 4],
      ['Load Profile', 2, 1],
      ['Load Workouts', 3, 2],
      ['Save Workout', 6, 5],
    ],
  },
  {
    file: 'SavedProjects/WaltDelivery-MusicApp-FullLogic.agenticdesign',
    prompt: 'a music streaming app with playlists',
    collections: ['users', 'playlists', 'likedTracks'],
    createdScreens: ['Log In', 'Sign Up'],
    boundInputs: 6,
    flows: [
      ['Auth Gate', 4, 3],
      ['Log In', 8, 7],
      ['Go to Sign Up', 2, 1],
      ['Reset Password', 4, 3],
      ['Sign Up', 13, 12],
      ['Go to Log In', 2, 1],
      ['Load Profile', 2, 1],
      ['Load Playlists', 3, 2],
      ['Open New Playlist', 2, 1],
      ['Close New Playlist', 2, 1],
      ['Save Playlist', 6, 5],
    ],
  },
  {
    file: 'Looply.agenticdesign',
    prompt: 'a habit tracker',
    collections: ['users', 'habits', 'checkins'],
    createdScreens: ['Log In', 'Sign Up'],
    boundInputs: 6,
    flows: [
      ['Auth Gate', 4, 3],
      ['Log In', 8, 7],
      ['Go to Sign Up', 2, 1],
      ['Reset Password', 4, 3],
      ['Sign Up', 13, 12],
      ['Go to Log In', 2, 1],
      ['Load Profile', 2, 1],
      ['Load Habits', 3, 2],
      ['Open New Habit', 2, 1],
      ['Close New Habit', 2, 1],
      ['Save Habit', 6, 5],
    ],
  },
  {
    file: 'AeronShop.agenticdesign',
    prompt: 'an online shop with products and cart',
    collections: ['users', 'orders', 'cartItems', 'favorites'],
    createdScreens: [],
    boundInputs: 0,
    flows: [
      ['Auth Gate', 4, 3],
      ['Log In', 6, 5],
      ['Go to Sign Up', 2, 1],
      ['Sign Up', 7, 6],
      ['Load Profile', 2, 1],
      ['Load Orders', 3, 2],
      // The save CTA lives on the list screen itself → no goBack block.
      ['Save Order', 5, 4],
      ['Load Favorites', 2, 1],
    ],
  },
];

function run(file: string, prompt: string) {
  const path = `${ROOT}/${file}`;
  expect(existsSync(path), path).toBe(true);
  const project = parseDesignProject(readFileSync(path, 'utf8'));
  const design = new FakeDesignHost(project);
  const logic = new LogicViewModel();
  const result = wire(prompt, design, logic);
  return { design, logic, result };
}

describe('BackendWiringGenerator over the sample projects', () => {
  for (const expected of CASES) {
    it(`wires ${expected.file}`, () => {
      const { design, logic, result } = run(expected.file, expected.prompt);

      expect(result.configured).toBe(true);
      expect(result.collections).toEqual(expected.collections);
      expect(result.createdScreens).toEqual(expected.createdScreens);
      expect(result.boundInputs).toBe(expected.boundInputs);
      expect(result.flowNames).toEqual(expected.flows.map((f) => f[0]));

      const byName = new Map(logic.flows.map((f) => [f.name, f] as const));
      for (const [name, blocks, connections] of expected.flows) {
        const flow = byName.get(name);
        expect(flow, name).toBeDefined();
        expect([name, flow!.blocks.length, flow!.connections.length]).toEqual([name, blocks, connections]);
      }

      // Firebase is switched on with the blueprint's schema.
      const config = design.project.firebaseConfig;
      expect(config?.isEnabled).toBe(true);
      expect(config?.enableEmailAuth).toBe(true);
      expect(config?.defaultCollections.map((c) => c.name)).toEqual(expected.collections);

      // The fixed session variables are declared globally.
      const globals = design.project.globalVariables.map((v) => v.name);
      for (const name of ['authEmail', 'authPassword', 'authPasswordConfirm', 'authDisplayName', 'currentUserId', 'profile']) {
        expect(globals, name).toContain(name);
      }
    });
  }

  it('replaces its own flows instead of stacking them on a re-run', () => {
    const first = run(CASES[0]!.file, CASES[0]!.prompt);
    const before = first.logic.flows.filter((f) => f.name === 'Log In').length;
    expect(before).toBe(1);

    // Re-running (build_full_app then wire_backend) must not register twice.
    wire(CASES[0]!.prompt, first.design, first.logic);
    expect(first.logic.flows.filter((f) => f.name === 'Log In').length).toBe(1);
    expect(first.logic.flows.filter((f) => f.name === 'Sign Up').length).toBe(1);
    expect(first.logic.flows.filter((f) => f.name === 'Open New Holding').length).toBe(1);
  });
});
