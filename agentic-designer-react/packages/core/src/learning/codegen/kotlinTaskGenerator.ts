// packages/core/src/learning/codegen/kotlinTaskGenerator.ts
//
// Converts a DesignSnapshot into personalized Kotlin / Jetpack Compose learning tasks.
// Generates starter source files with guided student exercises.

export { getDesignGuidance } from './designGuidance';
import { getDesignGuidance } from './designGuidance';
export { getKotlinLesson } from './kotlinLessons';
import type { ScreenSnapshot } from './designSnapshot';

export interface KotlinLearningTask {
  id: string;
  stepNumber: number;
  titleHe: string;
  promptHe: string;
  targetFile: string;
  explanationHe: string;
  predictionQuestionHe: string;
  hintHe?: string;
  sampleCodeSnippet?: string;
  expectedKeywords: string[];
  noMatchingDesignComponent?: boolean;
}

export function kotlinScreenName(screen: ScreenSnapshot): string {
  const base = screen.name.replace(/[^a-zA-Z0-9]/g, '') || 'Screen';
  return `${/^[0-9]/.test(base) ? 'Screen' : ''}${base}_${screen.id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

export function generateKotlinLearningTasks(screen: ScreenSnapshot): KotlinLearningTask[] {
  const safeName = kotlinScreenName(screen);
  const targetFile = `app/src/main/java/com/example/app/ui/${safeName}.kt`;

  const titleComp = screen.components.find((c) => c.type === 'Text' || c.role === 'app_title');
  const titleText = titleComp?.text || 'ברוכים הבאים';

  const tasks: KotlinLearningTask[] = [
    {
      id: `${screen.id}_kotlin_1_scaffold`,
      stepNumber: 1,
      titleHe: 'הכרת שלד הקומפוננטה ב־Compose',
      promptHe: `פתח את הקובץ ${safeName}.kt בעורך. כתוב את שלד הקומפוננטה שלך: הגדר פונקציית @Composable fun ${safeName}() ובתוכה מכולת פריסה Column { }.`,
      targetFile,
      explanationHe:
        'ב־Jetpack Compose כל מסך ורכיב מיוצגים על ידי פונקציית Kotlin המסומנת באנוטציית @Composable. פונקציה זו מתארת כיצד ה־UI צריך להיראות.',
      predictionQuestionHe: 'מה תפקיד האנוטציה @Composable ומדוע שם הפונקציה מתחיל באות גדולה?',
      hintHe: 'הגדר פונקציה עם המילה השמורה fun, ומעליה אנוטציה @Composable. בתוך גוף הפונקציה הוסף Column { }',
      sampleCodeSnippet: `@Composable\nfun ${safeName}() {\n    Column(\n        modifier = Modifier\n            .fillMaxSize()\n            .padding(24.dp),\n        horizontalAlignment = Alignment.CenterHorizontally,\n        verticalArrangement = Arrangement.Center\n    ) {\n        // כאן יבואו רכיבי המסך במשימות הבאות\n    }\n}`,
      expectedKeywords: ['@Composable', 'fun', 'Column'],
    },
    {
      id: `${screen.id}_kotlin_2_title`,
      stepNumber: 2,
      titleHe: 'כתיבת רכיב הכותרת',
      promptHe: `הוסף לתוך ה־Column את כותרת המסך שעיצבת בעזרת רכיב Text(text = "${titleText}").`,
      targetFile,
      explanationHe:
        'רכיב Text הוא הבסיס לכל הצגת מחרוזת ב־Compose. ניתן לעצב אותו בעזרת פרמטר style = MaterialTheme.typography.headlineMedium.',
      predictionQuestionHe: 'מה יקרה אם נשנה את הפרמטר text למחרוזת ריקה?',
      hintHe: 'רכיב Text נכתב בתוך הסוגריים המסולסלים של ה־Column. למשל: Text(text = "...")',
      sampleCodeSnippet: `Text(\n    text = "${titleText}",\n    style = MaterialTheme.typography.headlineMedium\n)`,
      expectedKeywords: ['Text', titleText],
    },
    {
      id: `${screen.id}_kotlin_3_state_and_input`,
      stepNumber: 3,
      titleHe: 'ניהול מצב ושדה קלט ראשון',
      promptHe: 'הגדר משתנה מצב var email by remember { mutableStateOf("") } וחבר אותו לשדה OutlinedTextField.',
      targetFile,
      explanationHe:
        'ב־Compose הממשק תלוי במצב (State). כאשר המצב משתנה, Compose מבצע Recomposition מתזמן הערכה מחדש של תחומי הקריאה הרלוונטיים.',
      predictionQuestionHe: 'מדוע משתמשים ב־remember כדי לשמור על ערך המשתנה בין הרכבות (Recompositions)?',
      hintHe: 'משתנה המצב מוגדר בתחילת פונקציית ה־Composable לפני ה־Column. שדה ה־OutlinedTextField מקבל value = email ו־onValueChange = { email = it }',
      sampleCodeSnippet: `var email by remember { mutableStateOf("") }\n\nOutlinedTextField(\n    value = email,\n    onValueChange = { email = it },\n    label = { Text("אימייל") },\n    modifier = Modifier.fillMaxWidth()\n)`,
      expectedKeywords: ['remember', 'mutableStateOf', 'OutlinedTextField'],
    },
    {
      id: `${screen.id}_kotlin_4_button`,
      stepNumber: 4,
      titleHe: 'הוספת כפתור והאזנה ללחיצה',
      promptHe: 'הוסף כפתור Button עם בלוק onClick שמבצע פעולה ורכיב Text לכיתוב הכפתור.',
      targetFile,
      explanationHe:
        'הכפתור מקבל למדא onClick. בלחיצה נעדכן את המצב או נבצע פעולת רשת.',
      predictionQuestionHe: 'מה ההבדל בין פעולה בתוך onClick לבין קוד שנכתב ישירות בגוף ה־Composable?',
      hintHe: 'הגדר Button(onClick = { /* פעולה */ }) ובתוכו רכיב Text("המשך")',
      sampleCodeSnippet: `Button(\n    onClick = { /* פעולת לחיצה */ },\n    modifier = Modifier.fillMaxWidth()\n) {\n    Text("המשך")\n}`,
      expectedKeywords: ['Button', 'onClick'],
    },
    {
      id: `${screen.id}_kotlin_5_run`,
      stepNumber: 5,
      titleHe: 'בנייה והרצה באמולטור Android',
      promptHe: 'לחץ על בנייה והרצה ב־Android. המערכת תבנה את קוד המסך שלך, תפתח אמולטור ותתקין את האפליקציה. בדוק בה הקלדה ולחיצות והשווה לעיצוב.',
      targetFile,
      explanationHe:
        'השוואה חזותית ובדיקת תגובתיות: לחיצה, הקלדה ואימות תקינות.',
      predictionQuestionHe: 'האם התנהגות הקלט תואמת למה שתכננת בשלב העיצוב?',
      hintHe: 'הגדר פונקציה עם אנוטציה @Preview(showBackground = true) שקוראת לפונקציית המסך שלך בתוך MaterialTheme',
      sampleCodeSnippet: `@Preview(showBackground = true)\n@Composable\nfun ${safeName}Preview() {\n    MaterialTheme {\n        ${safeName}()\n    }\n}`,
      expectedKeywords: ['Preview'],
    },
  ];
  return tasks.map(task => {
    const guide = getDesignGuidance(screen, task.stepNumber);
    const count = guide.drills.length;
    const prompts: Record<number, string> = {
      1: `בנה את פריסת ${screen.name} לפי הרקע, השוליים ומיקום הרכיב הראשון בעיצוב. עיין בהסבר העיצוב לפני כתיבת ה־Column.`,
      2: `עצב את כל ${count} רכיבי הטקסט במסך, אחד בכל פעם. התחל ב־${titleText}. התאם לכל אחד צבע, גודל, משקל, רוחב ויישור לפי הכרטיס שלו.`,
      3: count ? `חבר את ${count} שדות הקלט בעיצוב למשתני מצב. עצב לכל שדה רקע, מסגרת, פינות ומידות לפי המקור; אל תוסיף שדות שלא קיימים במסך.` : 'במסך הזה אין שדות קלט. אל תוסיף שדה אימייל כללי; בדוק אילו רכיבים כן צריכים מצב.',
      4: count ? `הוסף את ${count} הכפתורים בעיצוב, עם הכיתוב והצבעים המקוריים. הגדר message לפני הפריסה, חבר פעולת ניסוי ובדוק את הפינות, המידות והריווח.` : 'במסך הזה אין כפתורים. אל תוסיף כפתור המשך שאינו בעיצוב.',
      5: 'לפני הבנייה השווה את כל רכיבי המסך לעיצוב היעד: רקע, סדר וקבוצות, שוליים, ריווח, צבעים, גדלי גופן ופינות. לאחר מכן הרץ ב־Android ובדוק את ההתנהגות.',
    };
    return { ...task, promptHe: prompts[task.stepNumber], titleHe: task.stepNumber === 2 ? 'טיפוגרפיה ועיצוב כל הטקסטים' : task.titleHe,
      sampleCodeSnippet: task.stepNumber === 5 ? task.sampleCodeSnippet : guide.drills[0]?.code,
      hintHe: 'פתח את כרטיס הרכיב תחת ״מעצבים כמו המקור״. קרא את משמעות המאפיינים, הוסף רכיב אחד והשווה לעיצוב לפני ההמשך.',
      explanationHe: guide.summary,
      noMatchingDesignComponent: !count && [3,4].includes(task.stepNumber),
      expectedKeywords: !count && [3,4].includes(task.stepNumber) ? [] : task.expectedKeywords };
  });
}

export function generateStarterKotlinFile(screen: ScreenSnapshot): string {
  const safeName = kotlinScreenName(screen);

  return `package com.example.app.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

/**
 * ממומש על פי העיצוב האישי שלך: "${screen.name}"
 * עקוב אחר ההנחיות בפאנל המלווה משמאל וכתוב את הקוד שלב אחר שלב בעצמך.
 */

// TODO (משימה 1): כתוב כאן פונקציית @Composable עם פריסת Column עבור ${safeName}
`;
}
