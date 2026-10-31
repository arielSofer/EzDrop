// Curated introductory explanations. Only standalone definition requests match;
// personal debugging and compound questions retain their source-aware AI route.
// Compose reference: https://developer.android.com/develop/ui/compose/mental-model
const concepts = [
  {
    aliases: ['composable', 'compossable', 'קומפוזבל', 'קומפוזאבל'],
    answer: '@Composable היא אנוטציה — סימון שמוסיפים לפני פונקציה ב־Kotlin. היא מאפשרת לפונקציה להשתתף במערכת Compose ולקרוא לפונקציות כמו Text ו־Column מתוך הקשר Composable.\n\nלדוגמה:\n@Composable\nfun Greeting() {\n    Text("שלום!")\n}\n\nהסימון עצמו לא מצייר דבר. Text מציג את הטקסט; Column ריק עדיין ייתן מסך ריק. אם נסיר את @Composable מהדוגמה, הקריאה ל־Text בתוך הפונקציה הרגילה תגרום לשגיאת קומפילציה.\n\nבדיקת הבנה: איזו שורה בדוגמה אחראית לטקסט שרואים במסך?',
  },
  {
    aliases: ['column', 'קולום', 'קולומן'],
    answer: 'Column היא פונקציית פריסה ב־Compose שמסדרת את הרכיבים שבתוכה אנכית, אחד מתחת לשני.\n\nלדוגמה, בתוך פונקציית @Composable:\nColumn {\n    Text("כותרת")\n    Text("שורה שנייה")\n}\n\nColumn ללא רכיבים אינו מציג טקסט או כפתורים, גם אם הוא ממלא את המסך. מה לדעתך ישתנה אם נחליף אותו ב־Row?',
  },
  {
    aliases: ['row'],
    answer: 'Row היא פונקציית פריסה ב־Compose שמסדרת רכיבים בשורה אופקית. למשל Row { Text("אחד"); Text("שניים") } מציב שני רכיבי טקסט בשורה. כיוון הפריסה מושפע מכיוון הממשק. Column מסדר את הרכיבים אנכית. נסה להסביר איזו פריסה מתאימה לשני כפתורים זה לצד זה.',
  },
  {
    aliases: ['modifier', 'מודיפייר'],
    answer: 'Modifier מתאר התאמות לרכיב Compose: גודל, ריווח, רקע והתנהגות. למשל Modifier.fillMaxSize().padding(24.dp) מבקש למלא את הגודל הזמין ולהשאיר ריווח פנימי. סדר הפעולות יכול לשנות את התוצאה. Modifier אינו מוסיף בעצמו Text או Button, ולכן פריסה ריקה יכולה להישאר ריקה גם אחרי העיצוב.',
  },
  {
    aliases: ['text'],
    answer: 'Text היא פונקציית Compose שמציגה טקסט. לדוגמה Text("שלום!") בתוך פונקציית @Composable יוסיף טקסט גלוי למסך. אפשר לשנות את הגודל והצבע בעזרת הפרמטרים שלה. שינוי ההערה בקוד לא משנה את הטקסט במסך — צריך לשנות את המחרוזת שמועברת ל־Text.',
  },
  {
    aliases: ['button'],
    answer: 'Button ב־Compose מציג כפתור. הפרמטר onClick מקבל את הפעולה שתתבצע בלחיצה; הבלוק הפנימי מתאר את תוכן הכפתור. לדוגמה, בתוך @Composable:\nButton(onClick = { /* פעולה */ }) {\n    Text("התחבר")\n}\n\nבדוגמה הכפתור מוצג, אבל הלחיצה עדיין לא מבצעת התחברות כי ב־onClick יש רק הערה. מה צריך להוסיף כדי לתת לו התנהגות?',
  },
];
export function kotlinConceptAnswer(normalized: string, stage?: 'design' | 'code'): string | null {
  const match = normalized.match(/^(?:(?:מה זה אומר|מה זה|מה זאת|מה אומר|מה פירוש|מה המשמעות של|מה התפקיד של|מה עושה|תסביר לי על|תסביר לי|תסביר על|הסבר לי על|הסבר לי)\s+)?(?:ה)?([a-zא-ת]+)$/);
  if (!match) return null;
  const term = match[1];
  // Shared visual-editor vocabulary should keep its existing design explanations.
  if (stage !== 'code' && ['button', 'text'].includes(term)) return null;
  return concepts.find(concept => concept.aliases.includes(term))?.answer ?? null;
}
