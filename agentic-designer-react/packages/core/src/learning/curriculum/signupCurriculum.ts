// packages/core/src/learning/curriculum/signupCurriculum.ts
//
// 13-step curriculum unit for designing the Signup Screen.
// Ported from Section 7 of docs/hebrew-learning-agent-implementation-plan.he.md.
// All checks are deterministic and local (zero AI cost).

import type { DesignNode } from '../../models/DesignNode';
import type { TaskTemplate, TaskEvaluationContext, TaskEvaluationResult } from '../models';

/** Helper to find all nodes in current active page or inside screens */
function getAllNodesInPage(context: TaskEvaluationContext): DesignNode[] {
  const page = context.project.pages[0];
  if (!page) return [];
  const nodes: DesignNode[] = [];
  function collect(list: DesignNode[]) {
    for (const n of list) {
      nodes.push(n);
      if (n.children && n.children.length > 0) {
        collect(n.children);
      }
    }
  }
  collect(page.nodes);
  return nodes;
}

/** Helper to get root screens (Frames on page root) */
function getRootScreens(context: TaskEvaluationContext): DesignNode[] {
  const page = context.project.pages[0];
  if (!page) return [];
  return page.nodes.filter((n) => n.type === 'Frame');
}

/** Find the screen assigned as signup screen, or the first available screen */
function getSignupScreen(context: TaskEvaluationContext): DesignNode | undefined {
  const screens = getRootScreens(context);
  if (screens.length === 0) return undefined;
  // If assigned in roles:
  const assignedId = Object.entries(context.learningRecord.roles).find(
    ([, role]) => role === 'signup_screen',
  )?.[0];
  if (assignedId) {
    const found = screens.find((s) => s.id === assignedId);
    if (found) return found;
  }
  return screens[0];
}

/** Helper to get child nodes of the signup screen (or nodes intersecting its bounds) */
function getScreenChildren(screen: DesignNode, allNodes: DesignNode[]): DesignNode[] {
  if (screen.children && screen.children.length > 0) {
    return screen.children;
  }
  // If nodes are on page level but positioned inside screen bounds
  return allNodes.filter(
    (n) =>
      n.id !== screen.id &&
      n.x >= screen.x &&
      n.x + n.width <= screen.x + screen.width + 50 &&
      n.y >= screen.y &&
      n.y + n.height <= screen.y + screen.height + 50,
  );
}

export const SIGNUP_TASK_TEMPLATES: TaskTemplate[] = [
  // ─── Step 1: Create Screen ──────────────────────────────────────────
  {
    id: 'signup_1_create_screen',
    unitId: 'signup_screen',
    stepNumber: 1,
    titleHe: 'יצירת מסך ההרשמה',
    promptHe: 'ניצור את מסך ההרשמה שלך באפליקציה.',
    whyHe: 'כל אפליקציה מתחילה ממסך שמגדיר את שטח התצוגה במכשיר הטלפון.',
    hintsHe: [
      'לחץ על כפתור "Screen" בסרגל הכלים העליון כדי להוסיף מסך ראשון לקנבס.',
      'ניתן גם לבחור תבנית של מכשיר (כגון iPhone או Android) מסרגל הכלים.',
    ],
    toolHighlightTarget: 'toolbar-add-screen',
    dependencies: [],
    concepts: ['Screen', 'Frame'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screens = getRootScreens(context);
      if (screens.length > 0) {
        const screen = screens[0];
        return {
          passed: true,
          feedbackHe: `מצוין! יצרת את המסך "${screen.name}". עכשיו יש לנו בסיס להתחיל לעצב עליו.`,
          detectedNodeId: screen.id,
          assignedRole: 'signup_screen',
        };
      }
      return {
        passed: false,
        feedbackHe: 'טרם נוצר מסך בקנבס. לחץ על כפתור Screen כדי ליצור מסך ראשון.',
      };
    },
  },

  // ─── Step 2: Name Screen ───────────────────────────────────────────
  {
    id: 'signup_2_name_screen',
    unitId: 'signup_screen',
    stepNumber: 2,
    titleHe: 'מתן שם מזהה למסך',
    promptHe: 'תן למסך שם שתזהה בהמשך (למשל "מסך הרשמה" או "Signup").',
    whyHe: 'שם ברור יסייע לנו לקשר את המסך בניווט ולכתוב עבורו קוד Jetpack Compose בהמשך.',
    hintsHe: [
      'בחר את המסך בקנבס, ובפאנל המאפיינים מימין שנה את שדה השם.',
      'בחר שם בעברית או באנגלית, למשל "הרשמה", "SignupScreen" או "Signup".',
    ],
    toolHighlightTarget: 'inspector-node-name',
    dependencies: ['signup_1_create_screen'],
    concepts: ['Naming', 'Identification'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) {
        return { passed: false, feedbackHe: 'לא נמצא מסך. נא לחזור לשלב 1 וליצור מסך.' };
      }
      const trimmed = screen.name.trim();
      const isDefault = /^Screen\s*\d*$/i.test(trimmed) || /^Frame\s*\d*$/i.test(trimmed);
      if (trimmed.length > 0 && !isDefault) {
        return {
          passed: true,
          feedbackHe: `מעולה! קראת למסך "${trimmed}". שם ברור עושה סדר בפרויקט.`,
          detectedNodeId: screen.id,
        };
      }
      return {
        passed: false,
        feedbackHe: `למסך עדיין יש שם ברירת מחדל ("${screen.name}"). שנה אותו לשם משמעותי בפאנל המאפיינים.`,
      };
    },
  },

  // ─── Step 3: Add Title Text ────────────────────────────────────────
  {
    id: 'signup_3_add_title',
    unitId: 'signup_screen',
    stepNumber: 3,
    titleHe: 'הוספת כותרת למסך',
    promptHe: 'הוסף כותרת עם שם האפליקציה או ברכת הצטרפות (למשל "ברוכים הבאים").',
    whyHe: 'הכותרת נותנת למשתמש הקשר מיידי ומברכת אותו בכניסה לאפליקציה.',
    hintsHe: [
      'לחץ על כפתור "Text" בסרגל העליון, ולאחר מכן מקם את הכותרת בראש המסך.',
      'לחץ פעמיים על הטקסט או ערוך אותו בפאנל המאפיינים מימין.',
    ],
    toolHighlightTarget: 'toolbar-add-text',
    dependencies: ['signup_2_name_screen'],
    concepts: ['Typography', 'Header'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);
      const textNodes = children.filter((n) => n.type === 'Text');

      if (textNodes.length > 0) {
        const titleNode = textNodes[0];
        return {
          passed: true,
          feedbackHe: `יופי! הוספת כותרת למסך: "${titleNode.text || titleNode.name}".`,
          detectedNodeId: titleNode.id,
          assignedRole: 'app_title',
        };
      }
      return {
        passed: false,
        feedbackHe: 'עדיין לא נוסף רכיב טקסט בתוך המסך. לחץ על כפתור Text בסרגל הכלים.',
      };
    },
  },

  // ─── Step 4: Style Title ───────────────────────────────────────────
  {
    id: 'signup_4_style_title',
    unitId: 'signup_screen',
    stepNumber: 4,
    titleHe: 'עיצוב הכותרת',
    promptHe: 'בחר גודל וצבע לכותרת לפי הטעם האישי שלך.',
    whyHe: 'היררכיה טיפוגרפית מבליטה את הכותרת ויוצרת עיצוב נעים וברור.',
    hintsHe: [
      'בחר את הכותרת, ובפאנל המאפיינים מימין הגדל את גודל הגופן (למשל 24 או 32 פיקסלים).',
      'תוכל גם לבחור צבע טקסט בולט שמתאים למותג שלך.',
    ],
    toolHighlightTarget: 'inspector-text-style',
    dependencies: ['signup_3_add_title'],
    concepts: ['FontSize', 'TextColor', 'VisualHierarchy'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);
      const textNodes = children.filter((n) => n.type === 'Text');

      const styledTitle = textNodes.find(
        (n) => (n.style.fontSize && n.style.fontSize >= 20) || (n.style.fontWeight && n.style.fontWeight !== 'normal'),
      );

      if (styledTitle) {
        return {
          passed: true,
          feedbackHe: `עיצוב נהדר! בחרת גודל ${styledTitle.style.fontSize ?? 24}px. הכותרת בולטת ומזמינה.`,
          detectedNodeId: styledTitle.id,
        };
      }
      return {
        passed: false,
        feedbackHe: 'הגדל את גודל הגופן של הכותרת ל־20 פיקסלים ומעלה בפאנל המאפיינים.',
      };
    },
  },

  // ─── Step 5: Add Email Input ───────────────────────────────────────
  {
    id: 'signup_5_add_email',
    unitId: 'signup_screen',
    stepNumber: 5,
    titleHe: 'הוספת שדה אימייל',
    promptHe: 'הוסף שדה קלט עבור כתובת הדואר האלקטרוני (אימייל).',
    whyHe: 'שדה קלט מאפשר למשתמש להקליד נתונים, שייקלטו ויאומתו בהמשך בקוד האפליקציה.',
    hintsHe: [
      'לחץ על כפתור "Input" בסרגל העליון.',
      'גרור את השדה לתוך המסך מתחת לכותרת.',
    ],
    toolHighlightTarget: 'toolbar-add-input',
    dependencies: ['signup_4_style_title'],
    concepts: ['Input', 'Forms'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);
      const inputNodes = children.filter((n) => n.type === 'Input');

      if (inputNodes.length > 0) {
        const emailInput = inputNodes[0];
        return {
          passed: true,
          feedbackHe: 'כל הכבוד! שדה האימייל נוסף למסך.',
          detectedNodeId: emailInput.id,
          assignedRole: 'email_input',
        };
      }
      return {
        passed: false,
        feedbackHe: 'טרם נוסף שדה קלט. לחץ על כפתור Input בסרגל כדי להוסיף שדה.',
      };
    },
  },

  // ─── Step 6: Add Email Label ───────────────────────────────────────
  {
    id: 'signup_6_label_email',
    unitId: 'signup_screen',
    stepNumber: 6,
    titleHe: 'תווית מסבירה לשדה האימייל',
    promptHe: 'הוסף תווית טקסט מעל השדה או הגדר בו רמז (Placeholder) כמו "הכנס אימייל".',
    whyHe: 'תווית ברורה מסייעת לנגישות ועוזרת למשתמש להבין מה בדיוק עליו למלא.',
    hintsHe: [
      'אפשר להוסיף רכיב Text קטן מעל השדה עם המילה "אימייל".',
      'או לשנות את טקסט ה־Placeholder של שדה הקלט כך שיסביר מה להקליד.',
    ],
    toolHighlightTarget: 'toolbar-add-text',
    dependencies: ['signup_5_add_email'],
    concepts: ['Accessibility', 'Labels', 'Placeholders'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);
      const inputNodes = children.filter((n) => n.type === 'Input');
      const textNodes = children.filter((n) => n.type === 'Text');

      // Check if input placeholder is customized
      const hasCustomInputText = inputNodes.some(
        (i) => i.text && i.text !== 'Enter text...' && i.text.trim().length > 0,
      );
      // Or there is more than 1 text node (title + label)
      const hasLabelText = textNodes.length >= 2;

      if (hasCustomInputText || hasLabelText) {
        return {
          passed: true,
          feedbackHe: 'מצוין! השדה מוסבר כעת בבירור למשתמש.',
          assignedRole: 'email_label',
        };
      }
      return {
        passed: false,
        feedbackHe: 'הוסף תווית טקסט מעל השדה או עדכן את טקסט הרמז של השדה.',
      };
    },
  },

  // ─── Step 7: Add Password Input ────────────────────────────────────
  {
    id: 'signup_7_add_password',
    unitId: 'signup_screen',
    stepNumber: 7,
    titleHe: 'הוספת שדה סיסמה מאובטח',
    promptHe: 'הוסף שדה קלט שני עבור סיסמה, וסמן אותו כשדה מאובטח (Secure).',
    whyHe: 'שדה סיסמה מאובטח מסתיר את התווים המוקלדים על גבי המסך ומגן על פרטיות המשתמש.',
    hintsHe: [
      'הוסף שדה Input נוסף מתחת לשדה האימייל.',
      'בפאנל המאפיינים מימין, סמן את אפשרות "Secure / Password Field" או קרא לו סיסמה.',
    ],
    toolHighlightTarget: 'inspector-input-secure',
    dependencies: ['signup_6_label_email'],
    concepts: ['PasswordSecurity', 'SecureField'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);
      const inputNodes = children.filter((n) => n.type === 'Input');

      if (inputNodes.length >= 2) {
        const pwdNode = inputNodes[1];
        const isSecure = pwdNode.isSecure || /pass|סיסמ/i.test(pwdNode.name + ' ' + (pwdNode.text || ''));
        return {
          passed: true,
          feedbackHe: isSecure
            ? 'מעולה! הוספת שדה סיסמה מאובטח.'
            : 'יופי, הוספת שדה סיסמה. מומלץ לסמן "Secure" בפאנל המאפיינים כדי להסתיר את התווים.',
          detectedNodeId: pwdNode.id,
          assignedRole: 'password_input',
        };
      }
      return {
        passed: false,
        feedbackHe: 'נא להוסיף שדה קלט נוסף עבור הסיסמה (צריכים להיות לפחות שני שדות במסך).',
      };
    },
  },

  // ─── Step 8: Add Submit Button ─────────────────────────────────────
  {
    id: 'signup_8_add_submit_button',
    unitId: 'signup_screen',
    stepNumber: 8,
    titleHe: 'הוספת כפתור הרשמה',
    promptHe: 'הוסף כפתור הרשמה בולט (למשל "הרשם עכשיו" או "צור חשבון").',
    whyHe: 'הכפתור הוא נקודת הפעולה המרכזית (CTA) שמפעילה את תהליך יצירת החשבון באפליקציה.',
    hintsHe: [
      'לחץ על כפתור "Button" בסרגל העליון ומקם אותו מתחת לשדות.',
      'שנה את הטקסט שלו למשהו ברור, כמו "הרשמה" או "המשך".',
    ],
    toolHighlightTarget: 'toolbar-add-button',
    dependencies: ['signup_7_add_password'],
    concepts: ['Button', 'CallToAction', 'Events'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);
      const buttonNodes = children.filter((n) => n.type === 'Button');

      if (buttonNodes.length > 0) {
        const btn = buttonNodes[0];
        return {
          passed: true,
          feedbackHe: `מצוין! כפתור ההרשמה מוכן עם הטקסט "${btn.text || btn.name}".`,
          detectedNodeId: btn.id,
          assignedRole: 'submit_button',
        };
      }
      return {
        passed: false,
        feedbackHe: 'עדיין לא נוסף כפתור למסך. לחץ על כפתור Button בסרגל הכלים.',
      };
    },
  },

  // ─── Step 9: Arrange Layout ────────────────────────────────────────
  {
    id: 'signup_9_arrange_layout',
    unitId: 'signup_screen',
    stepNumber: 9,
    titleHe: 'סידור פריסת הרכיבים',
    promptHe: 'וודא שהרכיבים מסודרים בסדר קריאה הגיוני מלמעלה למטה וללא חפיפות.',
    whyHe: 'ממשק נוח מאפשר למשתמש לעבור באופן טבעי מכותרת, לשדה ראשון, לשדה שני ולכפתור הסיום.',
    hintsHe: [
      'גרור את הרכיבים כך שהכותרת בראש המסך, שדות האימייל והסיסמה במרכז, והכפתור למטה.',
      'שים לב שרכיבים לא עולים זה על זה.',
    ],
    dependencies: ['signup_8_add_submit_button'],
    concepts: ['Layout', 'Spacing', 'Readability'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);

      if (children.length < 4) {
        return { passed: false, feedbackHe: 'חסרים רכיבים במסך לבדיקת סידור.' };
      }

      // Check vertical order:
      const sorted = [...children].sort((a, b) => a.y - b.y);
      const topNode = sorted[0];
      const bottomNode = sorted[sorted.length - 1];

      // Verify that elements are distributed vertically
      const verticalSpread = bottomNode.y - topNode.y;
      if (verticalSpread < 120) {
        return {
          passed: false,
          feedbackHe: 'הרכיבים קרובים מדי זה לזה או חופפים. פזר אותם לאורך המסך בסדר קריאה נעים.',
        };
      }

      return {
        passed: true,
        feedbackHe: 'הפריסה מסודרת היטב! יש מרווחים נכונים ורצף קריאה ברור.',
      };
    },
  },

  // ─── Step 10: Navigation to Login ──────────────────────────────────
  {
    id: 'signup_10_nav_to_login',
    unitId: 'signup_screen',
    stepNumber: 10,
    titleHe: 'מעבר למסך התחברות',
    promptHe: 'הוסף קישור או כפתור משני: "כבר יש לך חשבון? התחבר כאן".',
    whyHe: 'משתמש שכבר נרשם בעבר צריך דרך מהירה לעבור למסך התחברות במקום להירשם שוב.',
    hintsHe: [
      'הוסף שורת טקסט או כפתור קטן בתחתית המסך.',
      'תוכן מומלץ: "יש לך חשבון? התחבר" או "כניסה למשתמש קיים".',
    ],
    toolHighlightTarget: 'toolbar-add-text',
    dependencies: ['signup_9_arrange_layout'],
    concepts: ['Navigation', 'UserFlow'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);

      const navNode = children.find((n) => {
        const txt = (n.text || '') + ' ' + n.name;
        return /התחב|כניס|login|sign in|account|חשבון/i.test(txt);
      });

      if (navNode) {
        return {
          passed: true,
          feedbackHe: 'מעולה! הוספת אפשרות מעבר למסך התחברות.',
          detectedNodeId: navNode.id,
          assignedRole: 'login_link',
        };
      }
      return {
        passed: false,
        feedbackHe: 'טרם נוסף אלמנט מעבר למסך התחברות. הוסף טקסט או כפתור כמו "כבר יש לך חשבון? התחבר".',
      };
    },
  },

  // ─── Step 11: Loading State ────────────────────────────────────────
  {
    id: 'signup_11_loading_state',
    unitId: 'signup_screen',
    stepNumber: 11,
    titleHe: 'תכנון מצב טעינה (Loading)',
    promptHe: 'הוסף אינדיקטור או טקסט שמראה מה קורה בזמן שהאפליקציה שולחת את הנתונים לשרת.',
    whyHe: 'באינטרנט פעולות לוקחות זמן. משתמש חייב לדעת שהבקשה שלו בתהליך כדי שלא ילחץ שוב ושוב.',
    hintsHe: [
      'הוסף אייקון או טקסט קטן ליד הכפתור כמו "יוצר חשבון..." או אייקון ספינר.',
      'זהו תכנון מצב — בהמשך בקוד נלמד להציג אותו רק כשההרשמה פועלת.',
    ],
    dependencies: ['signup_10_nav_to_login'],
    concepts: ['UIStates', 'LoadingState', 'AsyncOperations'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);

      const loadingNode = children.find((n) => {
        const txt = (n.text || '') + ' ' + n.name + ' ' + (n.iconName || '');
        return /load|spin|טעינ|ממתין|שולח|progress/i.test(txt) || n.type === 'Icon';
      });

      if (loadingNode) {
        return {
          passed: true,
          feedbackHe: 'יפה מאוד! תכננת אינדיקציה למצב המתנה ברשת.',
          detectedNodeId: loadingNode.id,
          assignedRole: 'loading_state',
        };
      }
      return {
        passed: false,
        feedbackHe: 'הוסף רכיב טקסט או אייקון המסמן טעינה (למשל טקסט "טוען..." או אייקון).',
      };
    },
  },

  // ─── Step 12: Error State ──────────────────────────────────────────
  {
    id: 'signup_12_error_state',
    unitId: 'signup_screen',
    stepNumber: 12,
    titleHe: 'תכנון אזור הודעת שגיאה',
    promptHe: 'הוסף שורת הודעה (למשל בצבע אדום) המראה היכן תוצג שגיאה אם הפרטים אינם תקינים.',
    whyHe: 'טיפול שגיאות ברור (כגון "כתובת אימייל לא חוקית") מונע תסכול ומסייע למשתמש לתקן את הקלט.',
    hintsHe: [
      'הוסף רכיב Text עם הודעה לדוגמה, למשל "נא להזין אימייל תקין".',
      'מומלץ לצבוע אותו בצבע אדום או אזהרה כדי שיהיה בולט.',
    ],
    dependencies: ['signup_11_loading_state'],
    concepts: ['ErrorHandling', 'Validation', 'Feedback'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);

      const errorNode = children.find((n) => {
        const txt = (n.text || '') + ' ' + n.name;
        const isRed = n.style.fill === '#EF4444' || n.style.fill === '#DC2626' || n.style.fill === 'red' || (n.style.textColor && /red|#EF4444|#DC2626|#E11D48/i.test(n.style.textColor));
        return /שגיא|תקלה|אזהר|invalid|error|alert/i.test(txt) || isRed;
      });

      if (errorNode) {
        return {
          passed: true,
          feedbackHe: 'מצוין! הגדרת מקום להודעת שגיאה ברורה למשתמש.',
          detectedNodeId: errorNode.id,
          assignedRole: 'error_state',
        };
      }
      return {
        passed: false,
        feedbackHe: 'הוסף רכיב טקסט המיועד להודעת שגיאה (למשל "אימייל לא תקין" או טקסט בצבע אדום).',
      };
    },
  },

  // ─── Step 13: Summary & Flow Review ────────────────────────────────
  {
    id: 'signup_13_summary',
    unitId: 'signup_screen',
    stepNumber: 13,
    titleHe: 'סיכום מסך ההרשמה',
    promptHe: 'בדוק את המסך השלם: כותרת, שדות, כפתור, ניווט, ומצבי טעינה ושגיאה.',
    whyHe: 'סיימת בהצלחה את עיצוב המסך הראשון! כעת נוכל להתקדם למסכי ההתחברות והבית.',
    hintsHe: [
      'וודא שאתה מרוצה מהעיצוב ומהשמות שבחרת.',
      'לחץ על "בדוק אותי" או "המשך" כדי לאשר את סיום יחידת ההרשמה.',
    ],
    dependencies: ['signup_12_error_state'],
    concepts: ['SystemOverview', 'ReadinessForCode'],
    check(context: TaskEvaluationContext): TaskEvaluationResult {
      const screen = getSignupScreen(context);
      if (!screen) return { passed: false, feedbackHe: 'לא נמצא מסך.' };
      const all = getAllNodesInPage(context);
      const children = getScreenChildren(screen, all);

      if (children.length >= 4) {
        return {
          passed: true,
          feedbackHe: 'כל הכבוד! מסך ההרשמה שלך מעוצב במלואו, מוכן ומזמין לקראת שלב כתיבת הקוד ב־Kotlin!',
        };
      }
      return {
        passed: false,
        feedbackHe: 'נראה שחסרים חלק מהרכיבים במסך. וודא שכל הרכיבים נשמרו בתוך המסך.',
      };
    },
  },
];
