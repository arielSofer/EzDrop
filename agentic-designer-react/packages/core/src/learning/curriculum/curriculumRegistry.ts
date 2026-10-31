// packages/core/src/learning/curriculum/curriculumRegistry.ts
//
// Registry of all pilot curriculum units covering the 3-screen track:
// Signup -> Login -> Home.

import type { TaskTemplate } from '../models';
import { SIGNUP_TASK_TEMPLATES } from './signupCurriculum';
import { LOGIN_TASK_TEMPLATES } from './loginCurriculum';
import { HOME_TASK_TEMPLATES } from './homeCurriculum';

export interface CurriculumUnit {
  id: string;
  order: number;
  titleHe: string;
  descriptionHe: string;
  templates: TaskTemplate[];
}

export const CURRICULUM_UNITS: CurriculumUnit[] = [
  {
    id: 'signup_screen',
    order: 1,
    titleHe: 'מסך הרשמה',
    descriptionHe: 'יצירת טופס הרשמה אישי ראשון, שדות קלט, כפתור ומצבי משוב.',
    templates: SIGNUP_TASK_TEMPLATES,
  },
  {
    id: 'login_screen',
    order: 2,
    titleHe: 'מסך התחברות',
    descriptionHe: 'עיצוב מסך כניסה למשתמשים קיימים וחיבור ניווט דו־כיווני.',
    templates: LOGIN_TASK_TEMPLATES,
  },
  {
    id: 'home_screen',
    order: 3,
    titleHe: 'מסך בית',
    descriptionHe: 'השלמת שלד האפליקציה עם מסך בית, כרטיס תוכן וכפתור יציאה.',
    templates: HOME_TASK_TEMPLATES,
  },
];

export function getAllTaskTemplates(): TaskTemplate[] {
  return [
    ...SIGNUP_TASK_TEMPLATES,
    ...LOGIN_TASK_TEMPLATES,
    ...HOME_TASK_TEMPLATES,
  ];
}

export function getUnitById(unitId: string): CurriculumUnit | undefined {
  return CURRICULUM_UNITS.find((u) => u.id === unitId);
}

export function findTaskTemplateById(taskId: string): TaskTemplate | undefined {
  return getAllTaskTemplates().find((t) => t.id === taskId);
}
