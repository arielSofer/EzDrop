import { type ScreenSnapshot, kotlinScreenName } from '@agentic/core';
import { kotlinColor } from '../../../../../../packages/core/src/learning/codegen/designGuidance';
import { parseComposePreview, previewText, type PreviewNode } from './composePreview';
export interface GuidedStep {
 id: string; title: string; observe: string; explain: string; instruction: string; question: string;
 hints: [string, string, string]; solution: string;
 kind?: string; label?: string; property?: string; expected?: string; manual?: boolean;
}
const quote = (text: string) => JSON.stringify(text).replace(/\$/g, '\\$');
export function guidedSteps(screen: ScreenSnapshot): GuidedStep[] {
 const steps: GuidedStep[] = [];
 const add = (step: GuidedStep) => steps.push(step);
 add({ id: 'structure', title: 'שלד המסך בלבד', observe: `פתח את עיצוב היעד של ${screen.name}. בשלב הזה מתבוננים במבנה הכללי בלבד.`, explain: 'Composable מתאר ממשק. Column מסדר ילדים זה מתחת לזה; התוכן שלו נמצא בתוך סוגריים מסולסלים. עדיין לא מוסיפים רכיבים.', instruction: 'כתוב פונקציית מסך עם Column ריק. אם היא כבר קיימת, בדוק אותה בלי למחוק דבר.', question: 'מה נכנס לתוך הסוגריים המסולסלים של Column?', hints: ['התחל מהפונקציה, ורק בתוכה הגדר פריסה.', 'האנוטציה היא @Composable, והגוף מתחיל אחרי חתימת הפונקציה.', '@Composable\nfun Example() { Column { } }'], solution: `@Composable\nfun ${kotlinScreenName(screen)}() {\n    Column { }\n}`, kind: 'Column' });
 const roots = screen.components.filter(c => !c.parentId || c.parentId === screen.id);
 const left = Math.max(0, Math.min(...roots.map(c => c.x ?? 0), screen.width));
 const top = Math.max(0, Math.min(...roots.map(c => c.y ?? 0), screen.height));
 const bg = kotlinColor(screen.fillColor);
 if (bg) add({ id: 'background', title: 'צבע הרקע בלבד', observe: `צבע הרקע בעיצוב: ${screen.fillColor}.`, explain: 'background צובע את השטח של הרכיב. fillMaxSize נותן לפריסה את השטח הזמין. סדר ה־Modifier משפיע על איזה שטח נצבע.', instruction: 'הוסף לפריסה את צבע הרקע המקורי. אל תשנה עדיין את הכותרת או השדות.', question: 'מדוע חשוב שהפריסה תמלא את המסך לפני שבודקים את הרקע?', hints: ['הרקע שייך למכולת המסך.', 'הוסף background לשרשרת Modifier. נדרש import androidx.compose.foundation.background וגם androidx.compose.ui.graphics.Color.', 'Modifier.fillMaxSize().background(Color(0xFF112233))'], solution: `modifier = Modifier.fillMaxSize().background(${bg})`, kind: 'Column', property: 'modifier', expected: bg });
 add({ id: 'layout', title: 'נקודת ההתחלה והשוליים', observe: `מידות המקור: ${screen.width} × ${screen.height}. בדוק את המרחק מהקצה לרכיב הראשון.`, explain: 'padding משאיר מקום בתוך הפריסה. dp היא יחידת מרחק המתאימה לצפיפויות מסך שונות. אל תמרכז את כל התוכן אם המקור מתחיל בחלק העליון.', instruction: 'התאם רק את השוליים ונקודת ההתחלה לפי עיצוב היעד. השתמש ב־Preview להשוואה.', question: 'אילו שוליים שינית, ואיך הם שינו את מיקום התוכן?', hints: ['מדוד קודם את המרחק העליון ואת הצדדים בעיצוב.', 'padding יכול לקבל start, end, top ו־bottom בנפרד.', 'Modifier.padding(start = 16.dp, top = 32.dp)'], solution: `// מרחקים מהעיצוב השמור; התאם לשוליים הבטוחים של המכשיר\nmodifier = Modifier.fillMaxSize().padding(start = ${left}.dp, top = ${top}.dp)`, manual: true });
 const components = [...screen.components].sort((a,b) => (a.y ?? 0)-(b.y ?? 0) || (a.x ?? 0)-(b.x ?? 0));
 for (const c of components) {
  if (c.type === 'Icon') {
   const iconMap: Record<string, string> = { 'figure.run': 'DirectionsRun', 'shield': 'Shield', 'shield.fill': 'Shield', 'bolt': 'Bolt', 'bolt.fill': 'Bolt', 'heart': 'Favorite', 'heart.fill': 'Favorite', 'star': 'Star', 'star.fill': 'Star', 'person': 'Person', 'person.fill': 'Person' };
   const icon = iconMap[c.iconName ?? ''] ?? 'HelpOutline';
   const width = c.width ?? 24; const height = c.height ?? 24;
   const tint = kotlinColor(c.textColor ?? c.fillColor) ?? 'Color(0xFF888888)';
   const choice = icon === 'HelpOutline' ? `שם האייקון המקורי ${c.iconName ?? 'לא נשמר'} אינו ממופה כרגע ל־Android. HelpOutline הוא סימן זמני בלבד, לא שחזור הסמל. בחר סמל Material מתאים לפני ההשוואה הסופית.` : `הסמל המקורי ${c.iconName} מקבל כאן חלופת Material בשם ${icon}. צורת Material עשויה להיות שונה מסמל Apple; בדוק את ההבדל מול המקור.`;
   const imports = `import androidx.compose.material.icons.Icons\nimport androidx.compose.material.icons.filled.${icon}\nimport androidx.compose.material3.Icon\nimport androidx.compose.ui.graphics.Color`;
   add({ id: `${c.id}:layout`, title: `בונים אייקון: ${c.name}`, observe: `בעיצוב: ${c.name}, סמל ${c.iconName ?? 'לא ידוע'}, גודל ${width} × ${height}, צבע ${c.textColor ?? c.fillColor ?? 'לא נשמר'}.`,
    explain: `Icon הוא הרכיב שמצייר סמל ב־Compose. imageVector בוחר את ציור הסמל מתוך Icons.Filled; tint צובע אותו; modifier קובע מידות ומיקום. contentDescription מספק תיאור לקורא מסך, או null אם הסמל דקורטיבי והמידע כבר מופיע בטקסט לידו. ${choice}`,
    instruction: `1. בראש הקובץ הוסף רק imports חסרים: androidx.compose.material.icons.Icons, androidx.compose.material.icons.filled.${icon}, androidx.compose.material3.Icon ו־androidx.compose.ui.graphics.Color. 2. בתוך גוף הפריסה, במקום של הסמל ולפני הטקסט הסמוך, כתוב קריאת Icon. 3. הגדר imageVector לסמל ${icon}, תיאור נגישות מתאים, tint לצבע המקור ומידות ${width} על ${height} dp ב־Modifier. 4. אם הסמל והכותרת זה לצד זה, מקם אותם בתוך Row. אל תוסיף Box ריק במקום אייקון. ספריית האייקונים מוגדרת במנוע Android של המערכת.`,
    question: 'האם הסמל מעביר מידע שלא מופיע בטקסט הסמוך? בהתאם לכך, איזה תיאור נגישות צריך לתת לו?',
    hints: [`${choice} כעת קבע את ארבעת הפרמטרים: imageVector, contentDescription, tint ו־modifier.`, `הייבואים בראש הקובץ; Icon בתוך { } של הפריסה. imageVector מקבל Icons.Filled.${icon}. width ו־height נמדדים ב־dp.`, 'Icon(imageVector = Icons.Filled.Star, contentDescription = "מועדף")\n// לדוגמה זו נדרש import androidx.compose.material.icons.filled.Star'],
    solution: `${imports}\n\n// בתוך גוף הפריסה; החלופה אינה בהכרח זהה לסמל המקורי\nIcon(\n    imageVector = Icons.Filled.${icon},\n    contentDescription = ${quote(c.name)},\n    tint = ${tint},\n    modifier = Modifier.width(${width}.dp).height(${height}.dp)\n)`, kind: 'Icon', property: 'imageVector', expected: 'Icons.' });
   continue;
  }
  if (!['Text','Input','Button'].includes(c.type)) {
   add({ id: `${c.id}:layout`, title: `מיקום וקבוצה: ${c.name}`, observe: `רכיב ${c.type} במיקום ${c.x ?? '?'} / ${c.y ?? '?'}.`, explain: 'לפני כתיבת קוד בוחרים פריסה לפי היחסים בין הרכיבים: Row לצדדים, Column לעמודה, Box לחפיפה. לרכיבי תמונה או אייקון צריך לבחור גם משאב מתאים.', instruction: 'התאם את הרכיב או את קבוצת האב לעיצוב, ובדוק מול המקור.', question: 'איזה רכיב Compose בחרת ומדוע?', hints: ['בדוק אם זה תוכן גלוי או מכולה של ילדים.', 'מיקום הילדים נמדד ביחס למכולת האב.', 'Box { /* רכיבים חופפים */ }'], solution: '// אין פתרון אוטומטי לרכיב זה. בחר מכולה או משאב לפי העיצוב.', manual: true }); continue;
  }
  const label = c.text ?? c.name; const kind = c.type === 'Input' ? 'OutlinedTextField' : c.type;
  const content = c.type === 'Text' ? `Text(text = ${quote(label)})` : c.type === 'Button' ? `Button(onClick = { }) { Text(${quote(label)}) }` : `// לפני הפריסה\nvar fieldValue by remember { mutableStateOf("") }\n// בתוך הפריסה; בחר שם ייחודי לכל שדה\nOutlinedTextField(value = fieldValue, onValueChange = { fieldValue = it }, placeholder = { Text(${quote(label)}) })`;
  add({ id: `${c.id}:content`, title: `תוכן בלבד: ${label}`, observe: `מצא בעיצוב את ״${label}״. כרגע מתמקדים בתוכן שלו בלבד.`, explain: c.type === 'Text' ? 'Text מציג את המחרוזת שבפרמטר text. צבע, גודל ויישור יגיעו בצעדים נפרדים.' : c.type === 'Input' ? 'השדה מציג value. onValueChange מעדכן את משתנה המצב בהקלדה. placeholder הוא הרמז בשדה הריק; שם המשתנה צריך להיות ייחודי לכל שדה.' : 'Button מכיל רכיב Text לכיתוב. onClick קובע מה קורה בלחיצה; קודם נבנה את המראה, ובהמשך נחבר פעולה.', instruction: `הוסף רק את הרכיב עם הכיתוב ״${label}״, בקבוצת האב המתאימה. אם הוא כבר קיים, אל תוסיף עותק.`, question: c.type === 'Input' ? 'מה ההבדל בין value ל־onValueChange?' : 'מה קובע את התוכן הגלוי של הרכיב?', hints: ['חפש את המקום שלו ביחס לרכיבים שכבר כתבת.', 'הפרמטרים בתוך ( ); תוכן כפתור בתוך { } שמופיע אחריהם.', c.type === 'Text' ? 'Text(text = "דוגמה")' : c.type === 'Button' ? 'Button(onClick = { }) { Text("דוגמה") }' : 'OutlinedTextField(value = name, onValueChange = { name = it })'], solution: content, kind, label });
  const propertyStep = (id: string, title: string, explain: string, property: string, expected: string, solution: string, example: string) => add({ id: `${c.id}:${id}`, title: `${title}: ${label}`, observe: `לפי העיצוב המקורי של ״${label}״: ${title} ${id === 'color' ? c.textColor : id === 'fill' ? c.fillColor : id === 'font' ? c.fontSize : id === 'radius' ? c.cornerRadius : id === 'weight' ? c.fontWeight : id === 'align' ? c.textAlign : id === 'secure' ? 'שדה סיסמה' : c.width}.`, explain, instruction: `שנה רק את ${title} של הרכיב הקיים.`, question: `מה שינית ב־${title}, ומה קרה ב־Preview?`, hints: ['אתר את הפרמטר ברכיב הקיים; אין צורך לכתוב את כל הרכיב מחדש.', `הפרמטר שבו נשתמש הוא ${property}.`, example], solution, kind, label, property, expected });
  if (c.type === 'Text' && kotlinColor(c.textColor ?? c.fillColor)) propertyStep('color','צבע הטקסט','color קובע את צבע האותיות. Color מקבל ערך צבע; שתי הספרות הראשונות ב־0xAARRGGBB קובעות שקיפות. נדרש import androidx.compose.ui.graphics.Color.', 'color', kotlinColor(c.textColor ?? c.fillColor)!, `color = ${kotlinColor(c.textColor ?? c.fillColor)}`, 'color = Color(0xFF112233)');
  if (c.type === 'Text' && c.fontSize) propertyStep('font','גודל הגופן','fontSize נמדד ב־sp ומתחשב בהגדלת הטקסט במכשיר. נדרש import androidx.compose.ui.unit.sp.', 'fontSize', `${c.fontSize}.sp`, `fontSize = ${c.fontSize}.sp`, 'fontSize = 18.sp');
  if (c.type !== 'Text' && kotlinColor(c.fillColor)) propertyStep('fill','צבע הרקע','colors מאפשר לשנות את צבעי Material של הרכיב. לכפתור מגדירים containerColor; לשדה מגדירים רקע גם כשהוא בפוקוס וגם בלעדיו.', 'colors', kotlinColor(c.fillColor)!, c.type === 'Button' ? `colors = ButtonDefaults.buttonColors(containerColor = ${kotlinColor(c.fillColor)})` : `colors = OutlinedTextFieldDefaults.colors(focusedContainerColor = ${kotlinColor(c.fillColor)}, unfocusedContainerColor = ${kotlinColor(c.fillColor)})`, 'colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF112233))');
  if (c.type !== 'Text' && c.cornerRadius !== undefined) propertyStep('radius','רדיוס הפינות','shape מגדיר את צורת הרכיב. RoundedCornerShape מקבל רדיוס ב־dp. נדרש import androidx.compose.foundation.shape.RoundedCornerShape.', 'shape', `RoundedCornerShape(${c.cornerRadius}.dp)`, `shape = RoundedCornerShape(${c.cornerRadius}.dp)`, 'shape = RoundedCornerShape(8.dp)');
  if (c.type === 'Text' && c.fontWeight) {
   const weight = /bold|heavy|black/i.test(c.fontWeight) ? 700 : /medium|semibold/i.test(c.fontWeight) ? 600 : Number(c.fontWeight) || 400;
   propertyStep('weight','משקל הגופן',`fontWeight קובע את עובי האותיות. במקור המשקל הוא ${c.fontWeight}. נדרש import androidx.compose.ui.text.font.FontWeight.`, 'fontWeight', `FontWeight(${weight})`, `fontWeight = FontWeight(${weight})`, 'fontWeight = FontWeight(700)');
  }
  if (c.type === 'Text' && c.textAlign) {
   const align = c.textAlign === 'center' ? 'Center' : c.textAlign === 'right' ? 'Right' : 'Left';
   propertyStep('align','יישור הטקסט',`היישור במקור הוא ${c.textAlign}. textAlign מיישר בתוך שטח הרכיב, ולכן גם רוחבו חשוב. נדרש import androidx.compose.ui.text.style.TextAlign.`, 'textAlign', `TextAlign.${align}`, `textAlign = TextAlign.${align}`, 'textAlign = TextAlign.Center');
  }
  if (c.type !== 'Text' && kotlinColor(c.textColor)) propertyStep('color','צבע הטקסט','צבע התוכן צריך להיות קריא על הרקע. הוסף אותו לאותה הגדרת colors, בלי למחוק את צבע הרקע שכבר הגדרת.', 'colors', kotlinColor(c.textColor)!, c.type === 'Button' ? `// בתוך ButtonDefaults.buttonColors הקיים\ncontentColor = ${kotlinColor(c.textColor)}` : `// בתוך OutlinedTextFieldDefaults.colors הקיים\nfocusedTextColor = ${kotlinColor(c.textColor)},\nunfocusedTextColor = ${kotlinColor(c.textColor)}`, '// צבע נוסף בתוך colors הקיים\ncontentColor = Color(0xFFFFFFFF)');
  if (c.type === 'Button') add({ id: `${c.id}:action`, title: `פעולת לחיצה: ${label}`, observe: 'אחרי שהכפתור נראה נכון, נבדוק מה הוא עושה.', explain: 'onClick מופעל בלחיצה. נעדכן מצב מקומי ונציג אותו בטקסט. זו פעולת ניסוי; התחברות לשרת דורשת מימוש נפרד.', instruction: 'חבר לחיצה לעדכון הודעה מקומית, והוסף טקסט שמציג אותה. לחץ ב־Preview.', question: 'למה שינוי message משנה את הטקסט על המסך?', hints: ['הגדר משתנה מצב לפני הפריסה.', 'ב־onClick משנים את המשתנה; ברכיב Text קוראים אותו.', 'onClick = { message = "נלחץ" }'], solution: '// לפני הפריסה\nvar message by remember { mutableStateOf("") }\n// בפרמטר onClick של הכפתור\nonClick = { message = "נלחץ" }\n// בתוך הפריסה\nText(message)', kind, label, property: 'onClick', expected: '=' });
  if (c.type === 'Input' && c.isSecure) propertyStep('secure','הסתרת סיסמה','visualTransformation משנה את הצגת התווים, אך אינו מצפין את ערך הסיסמה בזיכרון. נדרש import androidx.compose.ui.text.input.PasswordVisualTransformation.', 'visualTransformation', 'PasswordVisualTransformation()', 'visualTransformation = PasswordVisualTransformation()', 'visualTransformation = PasswordVisualTransformation()');
  add({ id: `${c.id}:spacing`, title: `מיקום וריווח: ${label}`, observe: `מיקום מקור x=${c.x ?? '?'}, y=${c.y ?? '?'}; מידות ${c.width ?? '?'} × ${c.height ?? '?'}.`, explain: 'רוחב, יישור ורווחים עובדים יחד. Spacer מפריד בין רכיבים; padding מוסיף שוליים. אם רכיבים עומדים זה לצד זה, מקם אותם ב־Row במקום להוסיף רווח אנכי.', instruction: 'התאם עכשיו רק את המיקום, הרוחב והרווח מסביב לרכיב. השווה למקור.', question: 'איך החלטת אם להשתמש ברווח, בשוליים או במכולת פריסה?', hints: ['השווה לקצה הרכיב הקודם, לא רק לקצה המסך.', 'Spacer עם height יוצר רווח ב־Column. width מגדיר רוחב רכיב.', 'Spacer(Modifier.height(12.dp))'], solution: `// נקודת התחלה למידות; התאם לפריסה ולרוחב המכשיר\nmodifier = Modifier.width(${c.width ?? 200}.dp)`, manual: true });
 }
 add({ id: 'review', title: 'השוואה והרצה סופית', observe: 'הצב את עיצוב היעד מול הקוד שבנית.', explain: 'Preview עוזר לראות ולנסות את המסך. רק בניית Android בודקת קומפילציה; השוואה חזותית ובדיקת התנהגות משלימות אותה.', instruction: 'בדוק את כל הרכיבים, הצבעים, הטיפוגרפיה, הריווח והפעולות. הרץ ב־Android דרך כפתור ההרצה.', question: 'מה עדיין שונה מהעיצוב ומה צריך לשפר?', hints: ['בדוק אזור אחד בכל פעם.', 'בדוק גם טקסט ארוך ושדה ריק.', '// הרצת Android נעשית מהכפתור בסרגל'], solution: '// אין קוד חדש בצעד זה; בדוק את התוצאה.', manual: true });
 return steps;
}
const normalize = (value: string) => value.replace(/\s/g,'').toLowerCase();
export function checkGuidedStep(step: GuidedStep, source: string, screen: ScreenSnapshot): string | null {
 if (step.manual) return null;
 let nodes: PreviewNode[];
 try { const document = parseComposePreview(source, kotlinScreenName(screen)); const flat = (items: PreviewNode[]): PreviewNode[] => items.flatMap(node => [node, ...flat(node.children)]); nodes = flat(document.nodes); }
 catch { return 'לא ניתן לבדוק את המבנה כרגע. בדוק שהפונקציה והסוגריים שלמים.'; }
 const flattenText = (node: PreviewNode): string[] => [previewText(node.args.text ?? node.args['0'], {}), ...node.children.flatMap(flattenText)];
 const candidates = nodes.filter(node => node.kind === step.kind && (!step.label || flattenText(node).includes(step.label) || (node.args.label ?? node.args.placeholder ?? '').includes(quote(step.label))));
 if (!candidates.length) return 'הרכיב של הצעד הזה עדיין לא זוהה בקוד. בדוק את סוג הרכיב ואת הכיתוב שלו.';
 if (step.property && !candidates.some(node => normalize(node.args[step.property!] ?? '').includes(normalize(step.expected ?? '')))) return 'המאפיין המבוקש עדיין לא זוהה בערך של העיצוב. אם השתמשת במשתנה או בסגנון משותף, הבדיקה המקומית אינה יודעת לפתור אותו; בדוק את הביטוי הישיר.';
 return null;
}

export interface GuidedBatch extends GuidedStep { members: GuidedStep[] }
/** Group related edits into one useful outcome, retaining member IDs for saved progress. */
export function guidedBatches(screen: ScreenSnapshot): GuidedBatch[] {
 const groups: GuidedStep[][] = [];
 for (const step of guidedSteps(screen)) {
  const groupId = ['structure','background','layout'].includes(step.id) ? 'screen-layout' : step.id.includes(':') ? step.id.split(':')[0] : step.id;
  const previous = groups.at(-1);
  const previousId = previous?.[0].id;
  const previousGroup = previousId && (['structure','background','layout'].includes(previousId) ? 'screen-layout' : previousId.split(':')[0]);
  if (previous && previousGroup === groupId) previous.push(step); else groups.push([step]);
 }
 return groups.map(members => {
  const first = members[0];
  const component = screen.components.find(c => first.id.startsWith(`${c.id}:`));
  const layout = first.id === 'structure';
  const question = layout
   ? 'אם המסך יהיה צר יותר או שהמשתמש יגדיל את הגופן, מה עלול להיחתך בפריסה שבחרת? הסבר כיצד תתאים את השוליים והיישור.'
   : component?.type === 'Text'
   ? 'נסה להכפיל את אורך הטקסט ולהגדיל את הגופן. האם נשמרת היררכיה ברורה בלי חיתוך? הסבר את בחירת הרוחב, היישור ומשקל הגופן.'
   : component?.type === 'Input'
   ? 'בדוק שדה ריק, טקסט ארוך ופוקוס. האם הרמז, הערך והמסגרת נשארים קריאים ונאמנים לעיצוב? מה צריך להשתנות בין המצבים?'
   : component?.type === 'Button'
   ? 'בדוק לחיצה וכיתוב ארוך. איזה משוב המשתמש מקבל, והאם הכפתור עדיין קריא ונגיש? הסבר כיצד המצב והעיצוב עובדים יחד.'
   : first.question;
  const explain = layout
   ? 'בונים יחד את שלד המסך, הרקע והשוליים. בחר Column לתוכן אנכי, Row לתוכן זה לצד זה ו־Box לחפיפה. סדר ה־Modifier קובע איזה שטח נצבע והיכן מתחיל התוכן; אל תמרכז אוטומטית אם המקור אינו ממורכז.'
   : component?.type === 'Text'
   ? 'מעצבים את הטקסט כיחידה אחת: תוכן, צבע, גודל, משקל ויישור. גודל נמדד ב־sp; הרוחב והיישור קובעים היכן השורות נשברות. סיים בהשוואת המיקום והרווח מהרכיבים הסמוכים.'
   : component?.type === 'Input'
   ? 'מחברים value ו־onValueChange למצב מקומי, ומעצבים את השדה יחד: רקע, טקסט, פינות וריווח. placeholder הוא רמז בשדה ריק; צבעי הפוקוס והמצב הרגיל צריכים לשמור על קריאות. שדה סיסמה דורש גם הסתרת תווים.'
   : component?.type === 'Button'
   ? 'בונים את הכפתור השלם: כיתוב, צבעי הרקע והתוכן, צורה ומידות. onClick מעדכן את המצב המקומי ומייצר משוב גלוי; פעולת ניסוי אינה חיבור אמיתי לשרת.'
   : first.explain;
  return { ...first, members, title: layout ? 'שלד, רקע ושוליים' : component ? `בונים ומעצבים: ${component.text ?? component.name}` : first.title,
   observe: layout ? `התבונן במסך ${screen.name}: רקע ${screen.fillColor ?? 'לפי המקור'}, מידות ${screen.width} × ${screen.height} ומיקום תחילת התוכן.` : first.observe,
   explain, instruction: 'בצע את השינויים הבאים יחד, ואז השווה את התוצאה לעיצוב:', question,
   hints: [explain, members.map(step => step.hints[1]).join('\n\n'), members.map(step => step.hints[2]).join('\n\n')],
   solution: members.map(step => `// ${step.title}\n${step.solution}`).join('\n\n'),
  };
 });
}
