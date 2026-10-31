export interface KotlinLesson {
  subject: string;
  overview: string;
  placement: string;
  parameters: Array<{ name: string; description: string }>;
  imports?: string[];
  examples: Array<{ label: string; code: string }>;
  experiment: string;
  commonMistake: string;
}
// Curated teaching material; explanations and examples do not require a model call.
// References: developer.android.com/develop/ui/compose/text/style-text
// and developer.android.com/develop/ui/compose/text/user-input (value-based overload).
const lessons: Record<number, KotlinLesson> = {
  1: {
    subject: '@Composable ו־Column',
    overview: '@Composable מסמן פונקציה שמשתתפת ב־Compose. Column מסדר את רכיבי התוכן אנכית. הסימון והפריסה לבדם אינם מציגים טקסט.',
    placement: 'את @Composable כותבים מעל fun. בתוך גוף הפונקציה כותבים Column. הגדרות הפריסה נכנסות ל־( ); רכיבי המסך נכנסים ל־{ } שמגיעים אחריהם.',
    parameters: [
      { name: 'modifier', description: 'התאמות לפריסה. fillMaxSize() מבקש את השטח הזמין; padding(24.dp) מוסיף ריווח פנימי.' },
      { name: 'horizontalAlignment', description: 'יישור הילדים בציר האופקי, למשל Alignment.CenterHorizontally.' },
      { name: 'verticalArrangement', description: 'סידור הילדים בציר האנכי. Arrangement.Center ממקם במרכז כשיש שטח פנוי.' },
      { name: 'content { … }', description: 'התוכן שמסדרים: Text, שדות וכפתורים. Column ריק יכול להיבנות ולהציג מסך ריק.' },
    ],
    examples: [{ label: 'דוגמה בתוך פונקציית @Composable', code: 'Column(\n    modifier = Modifier.fillMaxSize().padding(24.dp),\n    horizontalAlignment = Alignment.CenterHorizontally\n) {\n    Text("שלום")\n}' }],
    experiment: 'נבא מה יקרה אם תוסיף Text נוסף בתוך המסולסלים, ואז בדוק ב־Preview.',
    commonMistake: 'לא מכניסים Text לתוך רשימת הפרמטרים של Column. אין לכתוב Text(...) בין Column( לבין modifier = ... .',
  },
  2: {
    subject: 'Text — הצגת טקסט ועיצובו',
    overview: 'Text היא פונקציית Compose שמציגה מחרוזת. את התוכן והעיצוב מעבירים כפרמטרים בסוגריים; מפרידים ביניהם בפסיקים. היא אינה שדה שאפשר להקליד בו.',
    placement: 'בתוך המסולסלים של Column, במקום שבו הכותרת צריכה להופיע. את המאפיינים כותבים בתוך Text(...), ולא בשרשרת אחרי הקריאה.',
    parameters: [
      { name: 'text', description: 'המחרוזת שרואים במסך, למשל text = "PACEGUARD". אפשר להעביר גם משתנה מסוג String.' },
      { name: 'style', description: 'סגנון טקסט משותף, למשל MaterialTheme.typography.headlineMedium. האות h קטנה — HeadlineMedium אינו אותו שם.' },
      { name: 'fontSize', description: 'גודל טקסט ביחידות sp, המתחשבות בהעדפת גודל הטקסט במכשיר. למשל 28.sp.' },
      { name: 'fontWeight', description: 'עובי האותיות, למשל FontWeight.Bold.' },
      { name: 'color', description: 'צבע האותיות. MaterialTheme.colorScheme.primary משתמש בצבע הראשי של ערכת הנושא.' },
      { name: 'modifier', description: 'גודל ומרווחים של הרכיב, למשל Modifier.fillMaxWidth().padding(8.dp).' },
      { name: 'textAlign', description: 'יישור הטקסט בתוך רוחב הרכיב, למשל TextAlign.Center. כדי להבחין ביישור צריך שיהיה שטח פנוי.' },
      { name: 'maxLines / overflow', description: 'מגבילים מספר שורות וקובעים מה יקרה לתוכן עודף, למשל שורה אחת ו־TextOverflow.Ellipsis.' },
    ],
    imports: ['import androidx.compose.ui.unit.sp', 'import androidx.compose.ui.text.font.FontWeight'],
    examples: [{ label: 'דוגמה קטנה — בתוך Column { … }', code: 'Text(\n    text = "PACEGUARD",\n    fontSize = 28.sp,\n    fontWeight = FontWeight.Bold,\n    color = MaterialTheme.colorScheme.primary\n)' }],
    experiment: 'שנה רק את fontSize מ־28.sp ל־20.sp. ראה את השינוי מיד ב־Preview והשווה. אחר כך שנה צבע בנפרד.',
    commonMistake: 'Text("כותרת").Modifier אינו תחביר לעיצוב Text. כתוב modifier = Modifier... בתוך הסוגריים. ל־TextAlign נדרש import androidx.compose.ui.text.style.TextAlign ול־TextOverflow נדרש import androidx.compose.ui.text.style.TextOverflow.',
  },
  3: {
    subject: 'OutlinedTextField ו־State — קלט שמגיב להקלדה',
    overview: 'OutlinedTextField מציג שדה קלט ממוסגר. בדוגמה הזו value מציג את המצב הנוכחי ו־onValueChange מעדכן אותו. mutableStateOf יוצר מצב ש־Compose יכול לעקוב אחר קריאות אליו; remember שומר אותו בין recompositions כל עוד אותו מקום נשאר ב־Composition. הוא אינו שומר אוטומטית אחרי סגירת האפליקציה.',
    placement: 'את משתנה email כותבים בתחילת פונקציית המסך, לפני Column. את שדה הקלט כותבים בתוך המסולסלים של Column, מתחת לכותרת.',
    parameters: [
      { name: 'value', description: 'הטקסט הנוכחי בשדה: value = email.' },
      { name: 'onValueChange', description: 'פונקציה שמקבלת את הטקסט החדש. { email = it } שומר אותו במצב; it הוא הפרמטר של הלמדא.' },
      { name: 'label', description: 'תוכן Compose לתווית, למשל { Text("אימייל") }.' },
      { name: 'singleLine', description: 'true הופך את הקלט לשורה אחת.' },
      { name: 'modifier', description: 'למשל Modifier.fillMaxWidth() כדי לנצל את רוחב הפריסה הזמין.' },
    ],
    examples: [
      { label: 'בתוך פונקציית המסך, לפני Column', code: 'var email by remember { mutableStateOf("") }' },
      { label: 'בתוך Column { … }', code: 'OutlinedTextField(\n    value = email,\n    onValueChange = { email = it },\n    label = { Text("אימייל") },\n    singleLine = true,\n    modifier = Modifier.fillMaxWidth()\n)' },
    ],
    experiment: 'נבא מה יקרה אם onValueChange יהיה ריק. בדוק הקלדה באמולטור — ב־Preview אפשר לבדוק הקלדה ועדכון מצב מקומי; פעולות שרת וחיישנים דורשות אמולטור.',
    commonMistake: 'אם לא מעדכנים את email, value ממשיך להחזיר את הערך הישן. הכנסת המשתנה לתוך onValueChange תיצור משתנה מקומי אחר ולא את המצב שמוצג בשדה.',
  },
  4: {
    subject: 'Button ו־onClick — מראה לעומת פעולה',
    overview: 'Button מציג כפתור ומפעיל את onClick כאשר לוחצים. הכיתוב הוא רכיב Text בתוך בלוק התוכן. הוספת כפתור אינה מממשת התחברות בעצמה; נתחיל מפעולה מקומית שקל לראות ולבדוק.',
    placement: 'את משתנה message מגדירים לפני Column. את הכפתור ואת Text(message) מוסיפים בתוך Column, אחרי שדה הקלט.',
    parameters: [
      { name: 'onClick', description: 'למדא שמופעלת בלחיצה. כאן היא משנה את message, ו־Compose יכול לעדכן את הטקסט שקורא אותו.' },
      { name: 'enabled', description: 'false מבטל את הלחיצה ומשנה את המראה. ברירת המחדל היא true.' },
      { name: 'modifier', description: 'למשל Modifier.fillMaxWidth() לרוחב מלא.' },
      { name: 'content { … }', description: 'הכיתוב או האייקון שבתוך הכפתור, למשל Text("המשך").' },
    ],
    examples: [
      { label: 'לפני Column', code: 'var message by remember { mutableStateOf("") }' },
      { label: 'בתוך Column', code: 'Button(\n    onClick = { message = "הלחיצה נקלטה" },\n    modifier = Modifier.fillMaxWidth()\n) {\n    Text("המשך")\n}\nText(message)' },
    ],
    experiment: 'לחץ ב־Preview וראה את ההודעה. אחר כך נסה enabled = false והסבר מה השתנה.',
    commonMistake: 'הערה בתוך onClick אינה פעולה. אין לבצע בקשת רשת חוסמת על חוט הממשק; חיבור לשרת יילמד בנפרד.',
  },
  5: {
    subject: 'Preview — השוואת הקוד לעיצוב',
    overview: 'במערכת שלנו Preview מהיר מציג רכיבי Compose בסיסיים בדפדפן ומתעדכן בהקלדה ללא בנייה. זו הדמיה אינטראקטיבית שתומכת בהקלדה, לחיצות והשמות למצב מקומי. היא אינה מריצה Kotlin מלא; שרתים, חיישנים ועיצוב Android המדויק נבדקים באמולטור. @Preview היא אנוטציה נפרדת לתצוגה בכלי פיתוח כמו Android Studio; היא אינה מפעילה את האפליקציה.',
    placement: 'פתח את לשונית Preview מהקוד לצד עיצוב היעד והתחל לערוך. הדוגמה הבאה היא פונקציה נפרדת ל־Android Studio, מחוץ לפונקציית המסך.',
    parameters: [
      { name: 'showBackground', description: 'ב־@Preview: האם להציג רקע בתצוגת כלי הפיתוח.' },
      { name: 'name', description: 'ב־@Preview: שם לתצוגה כדי לזהות אותה בין דוגמאות.' },
      { name: 'widthDp / heightDp', description: 'ב־@Preview: מידות שטח התצוגה ביחידות dp.' },
    ],
    examples: [{ label: 'דוגמת @Preview עצמאית לכלי הפיתוח', code: '@Preview(showBackground = true, name = "טקסט לדוגמה")\n@Composable\nfun TextExamplePreview() {\n    MaterialTheme { Text("שלום") }\n}' }],
    experiment: 'השווה כותרת, ריווח ויישור מול העיצוב. בדוק כפתורים והקלדה בחלון האמולטור.',
    commonMistake: 'בנייה מוצלחת אינה בדיקה של איכות העיצוב או של כל ההתנהגויות. Preview בדפדפן אינו בדיקת קומפילציה ואינו הוכחה שהקוד ירוץ ב־Android.',
  },
};
export function getKotlinLesson(step: number): KotlinLesson | undefined { return lessons[step]; }
