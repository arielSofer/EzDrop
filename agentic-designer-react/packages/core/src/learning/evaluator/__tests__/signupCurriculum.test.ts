// packages/core/src/learning/evaluator/__tests__/signupCurriculum.test.ts

import { describe, it, expect } from 'vitest';
import { makeDesignProject, makeDesignPage } from '../../../models/DesignProject';
import { makeDesignNode, makeNodeStyle } from '../../../models/DesignNode';
import { newUUID } from '../../../models/uuid';
import {
  createInitialLearningRecord,
  evaluateActiveTask,
  advanceToNextTask,
  verifyAllCompletedTasks,
} from '../taskEvaluator';
import { SIGNUP_TASK_TEMPLATES } from '../../curriculum/signupCurriculum';

describe('Signup Screen Curriculum Unit & Evaluator', () => {
  it('initializes record with 13 tasks and step 1 active', () => {
    const record = createInitialLearningRecord('proj-123', 'My Learning App');
    expect(record.activeTaskId).toBe('signup_1_create_screen');
    expect(Object.keys(record.tasks).length).toBe(13);
    expect(record.tasks['signup_1_create_screen']?.status).toBe('active');
    expect(record.tasks['signup_2_name_screen']?.status).toBe('pending_dependencies');
  });

  it('evaluates step 1 (create screen)', () => {
    let project = makeDesignProject({
      name: 'Test Project',
      pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [] })],
    });
    let record = createInitialLearningRecord('proj-123', 'My App');

    // Without screen: fails
    let evalRes = evaluateActiveTask(project, record);
    expect(evalRes.result.passed).toBe(false);

    // Add screen
    const screen = makeDesignNode({
      id: newUUID(),
      type: 'Frame',
      name: 'Screen 1',
      x: 80,
      y: 80,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 24, opacity: 1 }),
      children: [],
    });
    project.pages[0].nodes.push(screen);

    evalRes = evaluateActiveTask(project, record);
    expect(evalRes.result.passed).toBe(true);
    expect(evalRes.updatedRecord.tasks['signup_1_create_screen'].status).toBe('completed');
    expect(evalRes.updatedRecord.roles[screen.id]).toBe('signup_screen');
    expect(evalRes.updatedRecord.evidenceLog.length).toBe(1);

    // Advance to step 2
    record = advanceToNextTask(evalRes.updatedRecord);
    expect(record.activeTaskId).toBe('signup_2_name_screen');
    expect(record.tasks['signup_2_name_screen'].status).toBe('active');
  });

  it('evaluates step 2 (name screen) and rejects default name', () => {
    const screen = makeDesignNode({
      id: newUUID(),
      type: 'Frame',
      name: 'Screen 1',
      x: 80,
      y: 80,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 24, opacity: 1 }),
      children: [],
    });
    const project = makeDesignProject({
      name: 'Test Project',
      pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [screen] })],
    });
    let record = createInitialLearningRecord('proj-123', 'My App');
    record.activeTaskId = 'signup_2_name_screen';

    // Fails on default name "Screen 1"
    let evalRes = evaluateActiveTask(project, record);
    expect(evalRes.result.passed).toBe(false);

    // Change to custom name
    screen.name = 'מסך הרשמה';
    evalRes = evaluateActiveTask(project, record);
    expect(evalRes.result.passed).toBe(true);
    expect(evalRes.updatedRecord.tasks['signup_2_name_screen'].status).toBe('completed');
  });

  it('runs end-to-end through full signup flow', () => {
    const screen = makeDesignNode({
      id: newUUID(),
      type: 'Frame',
      name: 'מסך הרשמה',
      x: 80,
      y: 80,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 24, opacity: 1 }),
      children: [],
    });
    const project = makeDesignProject({
      name: 'Full Flow App',
      pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [screen] })],
    });

    let record = createInitialLearningRecord('proj-123', 'Full Flow App');

    // Step 1: Create screen
    let res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 2: Name screen
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 3: Add title
    expect(record.activeTaskId).toBe('signup_3_add_title');
    const titleNode = makeDesignNode({
      id: newUUID(),
      type: 'Text',
      name: 'Title',
      text: 'ברוכים הבאים',
      x: 100,
      y: 120,
      width: 200,
      height: 40,
      style: makeNodeStyle({ fill: '#000000', cornerRadius: 0, opacity: 1, fontSize: 16 }),
      children: [],
    });
    screen.children.push(titleNode);
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 4: Style title (increase font size)
    expect(record.activeTaskId).toBe('signup_4_style_title');
    titleNode.style.fontSize = 28;
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 5: Add email input
    expect(record.activeTaskId).toBe('signup_5_add_email');
    const emailNode = makeDesignNode({
      id: newUUID(),
      type: 'Input',
      name: 'Email Input',
      text: 'user@example.com',
      x: 100,
      y: 200,
      width: 280,
      height: 48,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 8, opacity: 1 }),
      children: [],
    });
    screen.children.push(emailNode);
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 6: Label email
    expect(record.activeTaskId).toBe('signup_6_label_email');
    emailNode.text = 'הכנס את כתובת האימייל שלך';
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 7: Add password
    expect(record.activeTaskId).toBe('signup_7_add_password');
    const passwordNode = makeDesignNode({
      id: newUUID(),
      type: 'Input',
      name: 'Password Input',
      isSecure: true,
      text: 'סיסמה',
      x: 100,
      y: 270,
      width: 280,
      height: 48,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 8, opacity: 1 }),
      children: [],
    });
    screen.children.push(passwordNode);
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 8: Add submit button
    expect(record.activeTaskId).toBe('signup_8_add_submit_button');
    const buttonNode = makeDesignNode({
      id: newUUID(),
      type: 'Button',
      name: 'Submit Button',
      text: 'הרשמה',
      x: 100,
      y: 350,
      width: 280,
      height: 48,
      style: makeNodeStyle({ fill: '#2563EB', cornerRadius: 12, opacity: 1 }),
      children: [],
    });
    screen.children.push(buttonNode);
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 9: Arrange layout
    expect(record.activeTaskId).toBe('signup_9_arrange_layout');
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 10: Nav to login
    expect(record.activeTaskId).toBe('signup_10_nav_to_login');
    const navNode = makeDesignNode({
      id: newUUID(),
      type: 'Text',
      name: 'Login Nav',
      text: 'כבר רשום? התחבר כאן',
      x: 100,
      y: 420,
      width: 200,
      height: 30,
      style: makeNodeStyle({ fill: '#3B82F6', cornerRadius: 0, opacity: 1 }),
      children: [],
    });
    screen.children.push(navNode);
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 11: Loading state
    expect(record.activeTaskId).toBe('signup_11_loading_state');
    const loadingNode = makeDesignNode({
      id: newUUID(),
      type: 'Text',
      name: 'Loading Spinner',
      text: 'יוצר חשבון, נא להמתין...',
      x: 100,
      y: 460,
      width: 200,
      height: 24,
      style: makeNodeStyle({ fill: '#6B7280', cornerRadius: 0, opacity: 1 }),
      children: [],
    });
    screen.children.push(loadingNode);
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 12: Error state
    expect(record.activeTaskId).toBe('signup_12_error_state');
    const errorNode = makeDesignNode({
      id: newUUID(),
      type: 'Text',
      name: 'Error Message',
      text: 'שגיאה: אימייל לא חוקי',
      x: 100,
      y: 490,
      width: 200,
      height: 24,
      style: makeNodeStyle({ fill: '#EF4444', cornerRadius: 0, opacity: 1, textColor: '#EF4444' }),
      children: [],
    });
    screen.children.push(errorNode);
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = advanceToNextTask(res.updatedRecord);

    // Step 13: Summary
    expect(record.activeTaskId).toBe('signup_13_summary');
    res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
  });

  it('detects missing node after undo via verifyAllCompletedTasks', () => {
    const screen = makeDesignNode({
      id: newUUID(),
      type: 'Frame',
      name: 'מסך הרשמה',
      x: 80,
      y: 80,
      width: 390,
      height: 844,
      style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 24, opacity: 1 }),
      children: [],
    });
    const project = makeDesignProject({
      name: 'Undo Test',
      pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [screen] })],
    });
    let record = createInitialLearningRecord('proj-undo', 'Undo Test');

    // Complete step 1
    const res = evaluateActiveTask(project, record);
    expect(res.result.passed).toBe(true);
    record = res.updatedRecord;
    expect(record.tasks['signup_1_create_screen'].status).toBe('completed');

    // Simulate Undo removing the screen
    project.pages[0].nodes = [];
    const verifiedRecord = verifyAllCompletedTasks(project, record);
    expect(verifiedRecord.tasks['signup_1_create_screen'].status).toBe('needs_recheck');
  });
});
