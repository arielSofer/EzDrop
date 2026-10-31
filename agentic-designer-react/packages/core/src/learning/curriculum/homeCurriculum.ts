// packages/core/src/learning/curriculum/homeCurriculum.ts
//
// Curriculum unit for designing the Home / Dashboard Screen.

import type { DesignNode } from '../../models/DesignNode';
import type { TaskTemplate, TaskEvaluationContext, TaskEvaluationResult } from '../models';

function getHomeScreen(context: TaskEvaluationContext): DesignNode | undefined {
  const page = context.project.pages[0];
  if (!page) return undefined;
  const screens = page.nodes.filter((n) => n.type === 'Frame');
  if (screens.length === 0) return undefined;

  const byName = screens.find((s) => /home|בית|ראשי|dashboard/i.test(s.name));
  if (byName) return byName;

  return screens.length > 2 ? screens[2] : screens[screens.length - 1];
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

export const HOME_TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'home_1_create_screen',
    unitId: 'home_screen',
    stepNumber: 1,
    titleHe: 'יצירת מסך בית',
    promptHe: 'צור מסך שלישי בקנבס וקרא לו "מסך בית" או "HomeScreen".',
    whyHe: 'זהו המסך הראשי שאליו מגיע המשתמש לאחר הרשמה או התחברות מוצלחת.',
    hintsHe: ['לחץ על Screen בסרגל הכלים להוספת מסך שלישי.'],
    toolHighlightTarget: 'toolbar-add-screen',
    dependencies: [],
    concepts: ['Screen', 'Dashboard'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const page = context.project.pages[0];
      const screens = page?.nodes.filter((n) => n.type === 'Frame') ?? [];
      if (screens.length >= 3) {
        const target = getHomeScreen(context) ?? screens[2];
        return {
          passed: true,
          feedbackHe: `יופי! מסך הבית "${target.name}" נוצר. כעת יש לנו 3 מסכי אפליקציה שלמים!`,
          detectedNodeId: target.id,
        };
      }
      return {
        passed: false,
        feedbackHe: 'נא להוסיף מסך שלישי בקנבס עבור מסך הבית.',
      };
    },
  },

  {
    id: 'home_2_greeting_header',
    unitId: 'home_screen',
    stepNumber: 2,
    titleHe: 'ברכת כניסה אישית',
    promptHe: 'הוסף כותרת או ברכה: "שלום, [שם משתמש]" או "ברוך שובך!".',
    whyHe: 'פנייה אישית במסך הבית מחזקת את חוויית המשתמש ומאשרת שהמערכת מזהה אותו.',
    hintsHe: ['הוסף רכיב Text בראש מסך הבית.'],
    toolHighlightTarget: 'toolbar-add-text',
    dependencies: ['home_1_create_screen'],
    concepts: ['Personalization', 'WelcomeHeader'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getHomeScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך בית.' };
      const children = getChildren(screen, context);
      const text = children.find((n) => n.type === 'Text');
      if (text) {
        return {
          passed: true,
          feedbackHe: `מעולה! הברכה נוספה: "${text.text || text.name}".`,
          detectedNodeId: text.id,
        };
      }
      return { passed: false, feedbackHe: 'הוסף רכיב טקסט בתוך מסך הבית.' };
    },
  },

  {
    id: 'home_3_content_card',
    unitId: 'home_screen',
    stepNumber: 3,
    titleHe: 'כרטיס תוכן ראשי',
    promptHe: 'הוסף מסגרת או כרטיס תוכן (Frame או Rectangle) שיציג את המידע העיקרי של האפליקציה.',
    whyHe: 'כרטיסי תוכן (Cards) הם דפוס העיצוב המקובל ב־Material Design להצגת מידע מרוכז.',
    hintsHe: [
      'הוסף Frame קטן או Rectangle בתוך מסך הבית.',
      'תן לו פינות מעוגלות (Corner Radius 12 או 16) ורקע מעט בהיר יותר.',
    ],
    dependencies: ['home_2_greeting_header'],
    concepts: ['CardLayout', 'ContentHierarchy'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getHomeScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך בית.' };
      const children = getChildren(screen, context);
      const card = children.find((n) => (n.type === 'Frame' || n.type === 'Rectangle') && n.width >= 150);
      if (card) {
        return {
          passed: true,
          feedbackHe: 'מצוין! כרטיס התוכן הראשי מוכן במסך הבית.',
          detectedNodeId: card.id,
        };
      }
      return { passed: false, feedbackHe: 'הוסף כרטיס תוכן (מלבן או מסגרת פנימית) במסך הבית.' };
    },
  },

  {
    id: 'home_4_logout_button',
    unitId: 'home_screen',
    stepNumber: 4,
    titleHe: 'כפתור התנתקות',
    promptHe: 'הוסף כפתור להתנתקות מהחשבון ("התנתק" או "יציאה").',
    whyHe: 'לכל משתמש צריכה להיות שליטה על פרטיותו ואפשרות להתנתק מהמכשיר בכל עת.',
    hintsHe: ['הוסף רכיב Button בתחתית המסך ושנה את הטקסט שלו ל"התנתק".'],
    toolHighlightTarget: 'toolbar-add-button',
    dependencies: ['home_3_content_card'],
    concepts: ['Logout', 'SessionControl'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getHomeScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך בית.' };
      const children = getChildren(screen, context);
      const btn = children.find((n) => {
        const txt = (n.text || '') + ' ' + n.name;
        return /התנתק|יציא|logout|sign out|exit/i.test(txt) || n.type === 'Button';
      });
      if (btn) {
        return {
          passed: true,
          feedbackHe: 'כל הכבוד! כפתור ההתנתקות נוסף. עיצוב 3 המסכים הושלם במלואו!',
          detectedNodeId: btn.id,
        };
      }
      return { passed: false, feedbackHe: 'הוסף כפתור התנתקות במסך הבית.' };
    },
  },
];
