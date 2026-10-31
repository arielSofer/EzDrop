import { describe, it, expect } from 'vitest';
import { BriefIntake } from '../BriefIntake';
import { makeDesignProject } from '../../models/DesignProject';

describe('BriefIntake', () => {
  it('identifies open questions for a bare brief', () => {
    const project = makeDesignProject({ name: 'Untitled Project' });
    const questions = BriefIntake.analyze('Build me a fitness app', project);
    expect(questions.length).toBeGreaterThan(0);
    // Should ask for name
    expect(questions.some((q) => q.id === 'name')).toBe(true);
  });

  it('skips name question if prompt provides a name', () => {
    const project = makeDesignProject({ name: 'Untitled Project' });
    const questions = BriefIntake.analyze('Build me an app called "FitPulse" for workout tracking', project);
    expect(questions.some((q) => q.id === 'name')).toBe(false);
  });

  it('provides Hebrew questions when input is in Hebrew', () => {
    const project = makeDesignProject({ name: 'Untitled Project' });
    const questions = BriefIntake.analyze('תבנה לי אפליקציה של חדר כושר', project);
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.some((q) => q.id === 'name')).toBe(true);
    expect(questions.some((q) => q.question.includes('איך לקרוא'))).toBe(true);
  });

  it('returns empty or minimal questions when brief is fully specified', () => {
    const project = makeDesignProject({ name: 'PaceGuard' });
    const detailed = 'Build a running app named "PaceGuard" in dark mode with email sign in and pace tracking';
    const questions = BriefIntake.analyze(detailed, project);
    // A specific detailed prompt should leave very few or zero open questions
    expect(questions.length).toBeLessThanOrEqual(2);
  });
});
