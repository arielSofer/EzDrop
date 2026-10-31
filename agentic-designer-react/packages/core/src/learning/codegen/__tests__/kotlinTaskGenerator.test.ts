// packages/core/src/learning/codegen/__tests__/kotlinTaskGenerator.test.ts

import { describe, it, expect } from 'vitest';
import { createDesignSnapshot } from '../designSnapshot';
import { generateKotlinLearningTasks, generateStarterKotlinFile } from '../kotlinTaskGenerator';
import { makeDesignProject, makeDesignPage } from '../../../models/DesignProject';
import { makeDesignNode, makeNodeStyle } from '../../../models/DesignNode';
import { newUUID } from '../../../models/uuid';

describe('Design-to-Kotlin Code Generation & Tasks', () => {
  it('creates design snapshot and generates 5 Kotlin Compose tasks', () => {
    const screen = makeDesignNode({
      id: newUUID(),
      type: 'Frame',
      name: 'SignupScreen',
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#fff', cornerRadius: 16, opacity: 1 }),
      children: [
        makeDesignNode({
          id: newUUID(),
          type: 'Text',
          name: 'Title',
          text: 'הרשמה מהירה',
          x: 20,
          y: 60,
          width: 200,
          height: 40,
          style: makeNodeStyle({ fill: '#000', cornerRadius: 0, opacity: 1 }),
          children: [],
        }),
      ],
    });

    const project = makeDesignProject({
      name: 'Kotlin Test App',
      pages: [makeDesignPage({ id: newUUID(), name: 'P1', nodes: [screen] })],
    });

    const snapshot = createDesignSnapshot(project);
    expect(snapshot.screens.length).toBe(1);
    expect(snapshot.screens[0].name).toBe('SignupScreen');

    const tasks = generateKotlinLearningTasks(snapshot.screens[0]);
    expect(tasks.length).toBe(5);
    expect(tasks[0].id).toContain('kotlin_1_scaffold');
    expect(tasks[1].promptHe).toContain('הרשמה מהירה');

    const starterCode = generateStarterKotlinFile(snapshot.screens[0]);
    expect(starterCode).toContain('package com.example.app.ui');
    expect(starterCode).toContain('SignupScreen');
    expect(starterCode).toContain('// TODO (משימה 1)');
    expect(starterCode).not.toContain('OutlinedTextField');
    expect(starterCode).not.toContain('Button(');
  });
});
