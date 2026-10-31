// packages/core/src/learning/curriculum/loginCurriculum.ts
//
// Curriculum unit for designing the Login Screen.
// Uses shared patterns from Signup Screen with fewer hints to foster independent mastery.

import type { DesignNode } from '../../models/DesignNode';
import type { TaskTemplate, TaskEvaluationContext, TaskEvaluationResult } from '../models';

function getLoginScreen(context: TaskEvaluationContext): DesignNode | undefined {
  const page = context.project.pages[0];
  if (!page) return undefined;
  const screens = page.nodes.filter((n) => n.type === 'Frame');
  if (screens.length === 0) return undefined;

  // Check role or name
  const assignedId = Object.entries(context.learningRecord.roles).find(
    ([, role]) => role === 'login_link' || (role as string) === 'login_screen',
  )?.[0];
  if (assignedId) {
    const found = screens.find((s) => s.id === assignedId);
    if (found) return found;
  }

  // Look for a screen named login or the second screen
  const byName = screens.find((s) => /login|התחב|כניס/i.test(s.name));
  if (byName) return byName;

  return screens.length > 1 ? screens[1] : undefined;
}

function getChildren(screen: DesignNode, context: TaskEvaluationContext): DesignNode[] {
  if (screen.children && screen.children.length > 0) return screen.children;
  const page = context.project.pages[0];
  if (!page) return [];
  return page.nodes.filter(
    (n) =>
      n.id !== screen.id &&
      n.x >= screen.x &&
      n.x + n.width <= screen.x + screen.width + 40 &&
      n.y >= screen.y &&
      n.y + n.height <= screen.y + screen.height + 40,
  );
}

export const LOGIN_TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'login_1_create_screen',
    unitId: 'login_screen',
    stepNumber: 1,
    titleHe: 'יצירת מסך התחברות',
    promptHe: 'צור מסך שני בקנבס ותן לו שם מזהה (למשל "מסך התחברות" או "Login").',
    whyHe: 'מסך נפרד מאפשר למשתמש רשום להתחבר ישירות מבלי לעבור שוב דרך טופס ההרשמה.',
    hintsHe: [
      'לחץ על "Screen" בסרגל העליון כדי להוסיף מסך שני לצד מסך ההרשמה.',
      'בפאנל המאפיינים מימין, שנה את שמו לשם ברור.',
    ],
    toolHighlightTarget: 'toolbar-add-screen',
    dependencies: [],
    concepts: ['Screen', 'Naming', 'MultiScreenLayout'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const page = context.project.pages[0];
      const screens = page?.nodes.filter((n) => n.type === 'Frame') ?? [];
      if (screens.length >= 2) {
        const target = getLoginScreen(context) ?? screens[1];
        return {
          passed: true,
          feedbackHe: `מצוין! מסך ההתחברות "${target.name}" נוצר.`,
          detectedNodeId: target.id,
          assignedRole: 'login_link',
        };
      }
      return {
        passed: false,
        feedbackHe: 'טרם נוסף מסך שני בקנבס. לחץ על Screen בסרגל.',
      };
    },
  },

  {
    id: 'login_2_add_title',
    unitId: 'login_screen',
    stepNumber: 2,
    titleHe: 'כותרת מסך התחברות',
    promptHe: 'הוסף כותרת בראש המסך: "התחברות" או "כניסה לחשבון".',
    whyHe: 'הכותרת מוודאת שהמשתמש יודע מיידית שהוא נמצא במסך הכניסה.',
    hintsHe: ['הוסף רכיב Text בתוך מסך ההתחברות ובחר גופן ברור.'],
    toolHighlightTarget: 'toolbar-add-text',
    dependencies: ['login_1_create_screen'],
    concepts: ['Typography', 'Header'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getLoginScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך התחברות.' };
      const children = getChildren(screen, context);
      const text = children.find((n) => n.type === 'Text');
      if (text) {
        return {
          passed: true,
          feedbackHe: `מעולה! כותרת ההתחברות נוספה: "${text.text || text.name}".`,
          detectedNodeId: text.id,
        };
      }
      return { passed: false, feedbackHe: 'הוסף רכיב טקסט בתוך מסך ההתחברות.' };
    },
  },

  {
    id: 'login_3_add_credentials',
    unitId: 'login_screen',
    stepNumber: 3,
    titleHe: 'שדות אימייל וסיסמה',
    promptHe: 'הוסף למסך שני שדות קלט: שדה אימייל ושדה סיסמה מאובטח.',
    whyHe: 'התחברות דורשת זיהוי המשתמש והוכחת זהותו באמצעות סיסמה.',
    hintsHe: [
      'הוסף שני שדות מסוג Input.',
      'בשדה השני סמן בפאנל המאפיינים "Password / Secure Field".',
    ],
    toolHighlightTarget: 'toolbar-add-input',
    dependencies: ['login_2_add_title'],
    concepts: ['Input', 'Security', 'Credentials'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getLoginScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך התחברות.' };
      const children = getChildren(screen, context);
      const inputs = children.filter((n) => n.type === 'Input');
      if (inputs.length >= 2) {
        return {
          passed: true,
          feedbackHe: 'כל הכבוד! שני שדות הכניסה הוגדרו במסך.',
        };
      }
      return {
        passed: false,
        feedbackHe: `נמצאו רק ${inputs.length} שדות במסך התחברות. נדרשים 2 שדות (אימייל וסיסמה).`,
      };
    },
  },

  {
    id: 'login_4_add_submit_button',
    unitId: 'login_screen',
    stepNumber: 4,
    titleHe: 'כפתור התחברות ראשי',
    promptHe: 'הוסף כפתור ראשי בולט: "התחבר" או "כניסה".',
    whyHe: 'כפתור זה שולח את פרטי ההתחברות לאימות מול השרת.',
    hintsHe: ['לחץ על Button בסרגל ומקם אותו מתחת לשדות.'],
    toolHighlightTarget: 'toolbar-add-button',
    dependencies: ['login_3_add_credentials'],
    concepts: ['Button', 'AuthenticationCTA'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getLoginScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך התחברות.' };
      const children = getChildren(screen, context);
      const btn = children.find((n) => n.type === 'Button');
      if (btn) {
        return {
          passed: true,
          feedbackHe: `יופי! כפתור ההתחברות מוכן: "${btn.text || btn.name}".`,
          detectedNodeId: btn.id,
        };
      }
      return { passed: false, feedbackHe: 'הוסף כפתור למסך ההתחברות.' };
    },
  },

  {
    id: 'login_5_nav_to_signup',
    unitId: 'login_screen',
    stepNumber: 5,
    titleHe: 'קישור חזרה להרשמה',
    promptHe: 'הוסף קישור או כפתור משני: "אין לך חשבון? הירשם כאן".',
    whyHe: 'ניווט דו־כיווני מונע ממשתמשים להיתקע ומאפשר מעבר חופשי בין הרשמה להתחברות.',
    hintsHe: ['הוסף טקסט קטן בתחתית המסך: "עדיין אין לך חשבון? הרשם".'],
    toolHighlightTarget: 'toolbar-add-text',
    dependencies: ['login_4_add_submit_button'],
    concepts: ['Navigation', 'UserFlow'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getLoginScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך התחברות.' };
      const children = getChildren(screen, context);
      const nav = children.find((n) => {
        const txt = (n.text || '') + ' ' + n.name;
        return /הרשמ|sign up|register|אין לך/i.test(txt);
      });
      if (nav) {
        return {
          passed: true,
          feedbackHe: 'מצוין! קישרת בין מסך ההתחברות חזרה למסך ההרשמה.',
          detectedNodeId: nav.id,
        };
      }
      return {
        passed: false,
        feedbackHe: 'הוסף טקסט המקשר חזרה להרשמה, למשל "אין לך חשבון? הירשם כאן".',
      };
    },
  },
];
