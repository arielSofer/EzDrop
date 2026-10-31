// packages/core/src/learning/codegen/kotlinCodeChecker.ts
//
// Evaluates student's Kotlin / Jetpack Compose code locally against task requirements.
// Zero AI token cost, instant feedback with encouraging Hebrew explanations.

import type { KotlinLearningTask } from './kotlinTaskGenerator';

export interface CodeEvaluationResult {
  passed: boolean;
  feedbackHe: string;
  missingDetailsHe?: string[];
  validation?: 'structure-only' | 'android-runtime';
}

function checkStructure(
  code: string,
  task: KotlinLearningTask,
): CodeEvaluationResult {
  const clean = code.trim();
  if (!clean) {
    return {
      passed: false,
      feedbackHe: 'הקובץ ריק. נא להוסיף את קוד ה־Kotlin הנדרש.',
      missingDetailsHe: ['קוד מקור'],
    };
  }

  // Strip comments so comments like '// TODO: Text(...)' don't falsely pass tests
  const activeCode = maskNonCode(clean).replace(/^\s*(import|package)\s+[^\n]+/gm, '');
  if (!balanced(activeCode)) return { passed: false, feedbackHe: 'יש סוגריים או מחרוזת שלא נסגרו. תקן אותם לפני המשך הבדיקה.' };
  if (!activeCode.trim()) {
    return {
      passed: false,
      feedbackHe: 'טרם נמצא קוד מימוש פעיל מעבר להערות ולהצהרות import/package. כתוב את הקוד של המשימה.',
      missingDetailsHe: ['קוד מקור פעיל'],
    };
  }

  if (task.noMatchingDesignComponent && [3, 4].includes(task.stepNumber)) return { passed: true, feedbackHe: 'אין רכיב מסוג זה בעיצוב השמור. אין צורך להוסיף רכיב שאינו שייך למסך.', validation: 'structure-only' };
  const step = task.stepNumber;

  switch (step) {
    case 1: {
      // Scaffold check: @Composable fun and layout container
      const hasComposable = /@Composable\s+fun\s+\w+/i.test(activeCode);
      const hasLayout = /\b(Column|Box|Row|Scaffold)\s*(?:\([^;]*?\))?\s*\{/.test(activeCode);

      if (hasComposable && hasLayout) {
        return {
          passed: true,
          feedbackHe: 'זוהו פונקציית Composable ומבנה פריסה. זו בדיקת מבנה בלבד; הקוד לא קומפל.',
        };
      }

      const missing: string[] = [];
      if (!hasComposable) missing.push('אנוטציית @Composable והגדרת פונקציה (fun)');
      if (!hasLayout) missing.push('מכולת פריסה כגון Column { ... }');

      return {
        passed: false,
        feedbackHe: 'שלד הקומפוננטה עדיין אינו שלם.',
        missingDetailsHe: missing,
      };
    }

    case 2: {
      // Title Text check
      const hasText = /Text\s*\(\s*text\s*=/i.test(activeCode) || /Text\s*\(\s*"/i.test(activeCode);
      if (hasText) {
        return {
          passed: true,
          feedbackHe: 'זוהתה קריאת Text. יש לבדוק את תוכנה ומיקומה בהרצה; הקוד לא קומפל.',
        };
      }
      return {
        passed: false,
        feedbackHe: 'טרם נוסף רכיב Text עבור הכותרת. הוסף למשל: Text(text = "...")',
        missingDetailsHe: ['רכיב Text'],
      };
    }

    case 3: {
      // State and Input field check
      const hasState = /remember\s*\{\s*mutableStateOf/i.test(activeCode);
      const hasTextField = /OutlinedTextField|TextField/i.test(activeCode);

      if (hasState && hasTextField) {
        return {
          passed: true,
          feedbackHe: 'זוהו הצהרת מצב ושדה קלט. החיבור וההתנהגות עדיין דורשים בדיקת הרצה.',
        };
      }

      const missing: string[] = [];
      if (!hasState) missing.push('הגדרת משתנה מצב בעזרת remember { mutableStateOf("") }');
      if (!hasTextField) missing.push('רכיב קלט מסוג OutlinedTextField או TextField');

      return {
        passed: false,
        feedbackHe: 'חסרה הגדרת המצב או שדה הקלט.',
        missingDetailsHe: missing,
      };
    }

    case 4: {
      // Button check
      const hasButton = /Button\s*\(\s*onClick/i.test(activeCode) || /Button\s*\{/i.test(activeCode);
      if (hasButton) {
        return {
          passed: true,
          feedbackHe: 'זוהה מבנה כפתור עם onClick. פעולת הלחיצה עדיין לא נבדקה בהרצה.',
        };
      }
      return {
        passed: false,
        feedbackHe: 'טרם נוסף כפתור לפריסה. הוסף Button(onClick = { ... }) { Text(...) }',
        missingDetailsHe: ['כפתור Button עם onClick'],
      };
    }

    case 5:
      return {
        passed: false,
        feedbackHe: /@Preview\b/.test(activeCode)
          ? 'זוהתה אנוטציית Preview, אך זו אינה הרצה. לחץ על בנייה והרצה ב־Android כדי לאמת את המסך באמולטור.'
          : 'יש להכין פונקציית Preview. אימות המסך דורש בנייה והרצה באמולטור Android.',
      };

    default:
      return {
        passed: false,
        feedbackHe: 'אין בדיקה מוגדרת למשימה זו.',
      };
  }
}


// A lightweight lexical filter, explicitly not a Kotlin compiler or semantic validator.
// Mask comments and string contents so keywords inside examples do not count as code.
function maskNonCode(source: string): string {
  let out = '', i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++; }
    } else if (source.startsWith('/*', i)) {
      let depth = 1; i += 2; out += '  ';
      while (i < source.length && depth) {
        if (source.startsWith('/*', i)) { depth++; i += 2; out += '  '; }
        else if (source.startsWith('*/', i)) { depth--; i += 2; out += '  '; }
        else { out += source[i] === '\n' ? '\n' : ' '; i++; }
      }
      if (depth) return '('; // incomplete input
    } else if (source[i] === '"' || source[i] === "'") {
      const delimiter = source.startsWith('"""', i) ? '"""' : source[i];
      out += delimiter; i += delimiter.length;
      let closed = false;
      while (i < source.length) {
        if (delimiter.length === 1 && source[i] === '\\') { out += '  '; i += 2; }
        else if (source.startsWith(delimiter, i)) { out += delimiter; i += delimiter.length; closed = true; break; }
        else { out += source[i] === '\n' ? '\n' : ' '; i++; }
      }
      if (!closed) return '(';
    } else { out += source[i++]; }
  }
  return out;
}
function balanced(source: string): boolean {
  const stack: string[] = [];
  for (const char of source) {
    if ('({['.includes(char)) stack.push(char);
    if (')}]'.includes(char) && stack.pop() !== ({ ')': '(', '}': '{', ']': '[' } as Record<string, string>)[char]) return false;
  }
  return stack.length === 0;
}
export function evaluateKotlinCode(code: string, task: KotlinLearningTask): CodeEvaluationResult {
  return { ...checkStructure(code, task), validation: 'structure-only' };
}
