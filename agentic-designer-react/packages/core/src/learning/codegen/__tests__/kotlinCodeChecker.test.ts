// packages/core/src/learning/codegen/__tests__/kotlinCodeChecker.test.ts

import { describe, it, expect } from 'vitest';
import { evaluateKotlinCode } from '../kotlinCodeChecker';
import type { KotlinLearningTask } from '../kotlinTaskGenerator';

function makeTask(stepNumber: number): KotlinLearningTask {
  return {
    id: `test_task_${stepNumber}`,
    stepNumber,
    titleHe: `משימה ${stepNumber}`,
    promptHe: `הנחיה ${stepNumber}`,
    targetFile: 'ui/TestScreen.kt',
    explanationHe: 'הסבר',
    predictionQuestionHe: 'שאלת ניבוי',
    expectedKeywords: [],
  };
}

describe('kotlinCodeChecker', () => {
  it('evaluates task 1 (scaffold)', () => {
    const task = makeTask(1);

    // Missing composable
    const res1 = evaluateKotlinCode('fun MyScreen() {}', task);
    expect(res1.passed).toBe(false);

    // Valid composable and Column
    const res2 = evaluateKotlinCode(
      `
      @Composable
      fun MyScreen() {
          Column {
          }
      }
    `,
      task,
    );
    expect(res2.passed).toBe(true);
  });

  it('evaluates task 2 (title text)', () => {
    const task = makeTask(2);

    const res1 = evaluateKotlinCode('@Composable fun S() {}', task);
    expect(res1.passed).toBe(false);

    const res2 = evaluateKotlinCode('Text(text = "שלום")', task);
    expect(res2.passed).toBe(true);
  });

  it('evaluates task 3 (state and input)', () => {
    const task = makeTask(3);

    const res1 = evaluateKotlinCode('var x = ""', task);
    expect(res1.passed).toBe(false);

    const res2 = evaluateKotlinCode(
      `
      var email by remember { mutableStateOf("") }
      OutlinedTextField(value = email, onValueChange = { email = it })
    `,
      task,
    );
    expect(res2.passed).toBe(true);
  });

  it('evaluates task 4 (button with onClick)', () => {
    const task = makeTask(4);

    const res1 = evaluateKotlinCode('Text("Hello")', task);
    expect(res1.passed).toBe(false);

    const res2 = evaluateKotlinCode(
      `
      Button(onClick = { /* submit */ }) {
          Text("הרשמה")
      }
    `,
      task,
    );
    expect(res2.passed).toBe(true);
  });
});


describe('honest structural checks', () => {
  it('never accepts arbitrary long text, @Preview, or unknown tasks as a verified Android run', () => {
    for (const code of ['x'.repeat(201), '@Preview', '@Preview @Composable fun Preview() {}']) {
      expect(evaluateKotlinCode(code, makeTask(5)).passed).toBe(false);
    }
    expect(evaluateKotlinCode('anything', makeTask(99)).passed).toBe(false);
  });
  it('does not count keywords inside strings, comments or imports', () => {
    expect(evaluateKotlinCode('val hint = "@Composable fun Demo() { Column {} }"', makeTask(1)).passed).toBe(false);
    expect(evaluateKotlinCode('import androidx.compose.foundation.layout.Column\n@Composable fun Demo() {}', makeTask(1)).passed).toBe(false);
    expect(evaluateKotlinCode('@Composable fun Demo() { Column {', makeTask(1)).passed).toBe(false);
    const result = evaluateKotlinCode('@Composable fun Demo() { Column {} }', makeTask(1));
    expect(result.passed).toBe(true);
    expect(result.validation).toBe('structure-only');
  });
});
