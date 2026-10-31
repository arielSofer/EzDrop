import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDesignProject } from '../../models/codec';
import { makeHarness } from './simulatorHarness';

describe('PaceGuard Complete End-to-End Logic Walkthrough', () => {
  const projectJson = readFileSync(
    '/Users/ariel/Documents/XcodeApps/AgenticDesigner/agentic-designer-react/apps/web/src/data/starterProject.json',
    'utf8',
  );
  const project = parseDesignProject(projectJson);

  it('runs every step of the runner user journey from A to Z', async () => {
    const { design, logic, simulator } = makeHarness(project);

    // Screen IDs
    const HOME_SCREEN = '9CE7CF83-2AB9-4F69-9ECF-12A2CC98E05A';
    const LIVE_RUN_SCREEN = '510C2C42-C90D-4BEE-94A6-13406811F499';
    const SUMMARY_SCREEN = '82017381-4CA9-43EA-BD4F-9937168D91A9';
    const HISTORY_SCREEN = '868A2668-9C3E-4CAB-AD9A-FC1DD8371DAF';
    const LOGIN_SCREEN = 'D476C3C4-FE2A-418F-8415-44EF98EE6254';
    const SIGNUP_SCREEN = '490BF9C4-5BDA-401C-A935-F83BDEC80B3C';
    const SETTINGS_SCREEN = '0335DBAC-956D-4996-BADB-CC9A1F9044B6';

    // 1. Prime variables on launch
    simulator.primeVariables();

    // 2. Open Sign Up from Log In
    // Node: "Open Sign Up" [800F7699-2D8F-4D93-A4A0-5E93CBE65B12]
    simulator.runTap('800F7699-2D8F-4D93-A4A0-5E93CBE65B12');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(SIGNUP_SCREEN);

    // 3. Back to Log In from Sign Up
    // Node: "Back to Log In" [4D550377-6E21-4A95-B9E7-5CE37E1BD344]
    simulator.runTap('4D550377-6E21-4A95-B9E7-5CE37E1BD344');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(LOGIN_SCREEN);

    // 4. Log In
    // Set valid email & password
    simulator.setVariableValue('loginEmail', 'runner@paceguard.io');
    simulator.setVariableValue('loginPassword', 'secretPass123');
    simulator.runTap('4EECACD5-362D-4A53-BCBD-4C3EF2B32FDF'); // Log In Button
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(HOME_SCREEN);
    expect(simulator.variables['firebaseUser']).toBe('sim-user-001');

    // 5. Navigate to Settings and Back
    // Open Alerts and Settings [8818430A-9D9F-4237-9621-6354B536F8FC]
    simulator.runTap('8818430A-9D9F-4237-9621-6354B536F8FC');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(SETTINGS_SCREEN);

    // Back Home from Settings [4B471588-625E-4468-A4C4-8B78A698210D]
    simulator.runTap('4B471588-625E-4468-A4C4-8B78A698210D');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(HOME_SCREEN);

    // 6. Navigate to Run History and Back
    // Open Run History [02E87796-DD6A-4400-8AC1-E87507ABD2AA]
    simulator.runTap('02E87796-DD6A-4400-8AC1-E87507ABD2AA');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(HISTORY_SCREEN);

    // Back Home from History [F7F24361-C90B-48D2-B4B4-DE2B49818E17]
    simulator.runTap('F7F24361-C90B-48D2-B4B4-DE2B49818E17');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(HOME_SCREEN);

    // 7. Start Workout!
    // Start Run Button [C74ADEE1-1E9F-4AF1-A070-C124DB88BB16]
    simulator.runTap('C74ADEE1-1E9F-4AF1-A070-C124DB88BB16');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(LIVE_RUN_SCREEN);
    expect(simulator.variables['elapsedSeconds']).toBe('0');
    expect(simulator.variables['distanceKm']).toBe('0');
    expect(simulator.variables['runPaused']).toBe('false');

    // 8. Live Workout Ticks (simulating 3 seconds of running)
    const liveFlow = logic.flows.find((f) => f.name.includes('Live Metrics — Native Tracking'));
    expect(liveFlow).toBeDefined();
    for (let i = 0; i < 3; i++) {
      logic.currentFlowId = liveFlow!.id;
      logic.selectedBlockId = liveFlow!.blocks[0]!.id;
      simulator.run();
      await simulator.waitForIdle();
    }
    expect(Number(simulator.variables['elapsedSeconds'])).toBe(3);
    expect(Number(simulator.variables['distanceMeters'])).toBe(9);
    expect(simulator.variables['heartRate']).toBe('142');

    // 9. Pause Workout
    // Pause Button [758E7947-ED1D-46F4-9C66-26C0B24C22F8]
    simulator.runTap('758E7947-ED1D-46F4-9C66-26C0B24C22F8');
    await simulator.waitForIdle();
    expect(simulator.variables['runPaused']).toBe('true');

    // Verify tick while paused does NOT increment elapsedSeconds
    logic.currentFlowId = liveFlow!.id;
    logic.selectedBlockId = liveFlow!.blocks[0]!.id;
    simulator.run();
    await simulator.waitForIdle();
    expect(Number(simulator.variables['elapsedSeconds'])).toBe(3);

    // Resume Workout
    simulator.runTap('758E7947-ED1D-46F4-9C66-26C0B24C22F8');
    await simulator.waitForIdle();
    expect(simulator.variables['runPaused']).toBe('false');

    // 10. Finish Workout
    // Finish Button [88306B56-DDFB-42B8-A5C5-F4F50C509292]
    simulator.runTap('88306B56-DDFB-42B8-A5C5-F4F50C509292');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(SUMMARY_SCREEN);
    expect(simulator.variables['runPaused']).toBe('true');

    // 11. Save Run to Firebase
    // Save Button [C399A956-8B3C-4372-8B9E-2A1C96E3DD95]
    simulator.runTap('C399A956-8B3C-4372-8B9E-2A1C96E3DD95');
    await simulator.waitForIdle();
    expect(simulator.log.some((l) => /run saved/i.test(l.message))).toBe(true);

    // 12. Done - Return to Home
    // Done Button [4B84F2A8-A1C0-48DC-A1DF-EA5CE2704672]
    simulator.runTap('4B84F2A8-A1C0-48DC-A1DF-EA5CE2704672');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(HOME_SCREEN);

    // 13. Log Out
    // Go to Settings, tap Log Out
    simulator.runTap('8818430A-9D9F-4237-9621-6354B536F8FC');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(SETTINGS_SCREEN);

    // Log Out Button [E45F483A-6CC3-40CC-9149-F985DBC2846E]
    simulator.runTap('E45F483A-6CC3-40CC-9149-F985DBC2846E');
    await simulator.waitForIdle();
    expect(simulator.previewScreenId).toBe(LOGIN_SCREEN);
    expect(simulator.variables['currentUserId']).toBe('');

    console.log('🏁 ENTIRE WORKOUT APP FLOW VERIFIED FROM A TO Z WITH 100% SUCCESS!');
  });
});
