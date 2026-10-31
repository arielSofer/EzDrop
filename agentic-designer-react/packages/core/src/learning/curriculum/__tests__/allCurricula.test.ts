// packages/core/src/learning/curriculum/__tests__/allCurricula.test.ts

import { describe, it, expect } from 'vitest';
import { makeDesignProject, makeDesignPage } from '../../../models/DesignProject';
import { makeDesignNode, makeNodeStyle } from '../../../models/DesignNode';
import { newUUID } from '../../../models/uuid';
import { CURRICULUM_UNITS, getAllTaskTemplates, findTaskTemplateById } from '../curriculumRegistry';

describe('All Curricula (Signup, Login, Home)', () => {
  it('registers all 3 units with correct templates', () => {
    expect(CURRICULUM_UNITS.length).toBe(3);
    expect(CURRICULUM_UNITS[0].id).toBe('signup_screen');
    expect(CURRICULUM_UNITS[1].id).toBe('login_screen');
    expect(CURRICULUM_UNITS[2].id).toBe('home_screen');

    const all = getAllTaskTemplates();
    expect(all.length).toBe(13 + 5 + 4); // 22 total steps across 3 screens
  });

  it('evaluates Login screen tasks correctly', () => {
    const signupScreen = makeDesignNode({
      id: newUUID(),
      type: 'Frame',
      name: 'Signup Screen',
      x: 50,
      y: 50,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#000', cornerRadius: 20, opacity: 1 }),
      children: [],
    });
    const loginScreen = makeDesignNode({
      id: newUUID(),
      type: 'Frame',
      name: 'מסך התחברות',
      x: 500,
      y: 50,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#000', cornerRadius: 20, opacity: 1 }),
      children: [],
    });

    const project = makeDesignProject({
      name: 'Login Test',
      pages: [makeDesignPage({ id: newUUID(), name: 'P1', nodes: [signupScreen, loginScreen] })],
    });

    const context = {
      project,
      learningRecord: {
        schemaVersion: '1.0.0',
        id: 'rec-1',
        name: 'Login Test',
        trackId: 'pilot',
        targetPlatform: 'Android' as const,
        createdAt: 0,
        updatedAt: 0,
        activeTaskId: 'login_1_create_screen',
        tasks: {},
        roles: {},
        evidenceLog: [],
        conceptMastery: {},
      },
    };

    const task1 = findTaskTemplateById('login_1_create_screen');
    expect(task1).toBeDefined();
    const res1 = task1!.check(context);
    expect(res1.passed).toBe(true);

    // Add title
    const title = makeDesignNode({
      id: newUUID(),
      type: 'Text',
      name: 'Title',
      text: 'התחברות לחשבון',
      x: 520,
      y: 100,
      width: 200,
      height: 40,
      style: makeNodeStyle({ fill: '#fff', cornerRadius: 0, opacity: 1 }),
      children: [],
    });
    loginScreen.children.push(title);

    const task2 = findTaskTemplateById('login_2_add_title');
    const res2 = task2!.check(context);
    expect(res2.passed).toBe(true);
  });
});
