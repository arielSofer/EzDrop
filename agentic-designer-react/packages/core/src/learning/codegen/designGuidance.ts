import type { ScreenSnapshot, ScreenComponentSnapshot } from './designSnapshot';
export interface DesignDrill { id: string; title: string; measurements: string; explanation: string; code: string; compare: string }
export interface DesignGuidance { title: string; summary: string; imports: string[]; drills: DesignDrill[] }
const n = (value: number) => Math.round(value * 10) / 10;
const quote = (value: string) => JSON.stringify(value).replace(/\$/g, '\\$');
export function kotlinColor(color?: string): string | undefined {
  const raw = color?.replace('#', '');
  if (!raw || !/^(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.test(raw)) return;
  const hex = raw.length === 3 ? [...raw].map(c => c + c).join('') : raw;
  // Design colors use CSS RRGGBBAA; Kotlin Color uses AARRGGBB.
  return `Color(0x${hex.length === 8 ? hex.slice(6) + hex.slice(0, 6) : 'FF' + hex})`;
}
function measurements(c: ScreenComponentSnapshot) {
  return [c.x !== undefined && c.y !== undefined ? `מיקום בעיצוב: x=${n(c.x)}, y=${n(c.y)}` : 'המיקום לא נשמר בעיצוב הישן',
    c.width !== undefined && c.height !== undefined ? `גודל: ${n(c.width)} × ${n(c.height)}` : '',
    c.fontSize ? `גופן ${c.fontSize}` : '', c.textColor ? `צבע טקסט ${c.textColor}` : '', c.fillColor ? `מילוי ${c.fillColor}` : '',
    c.cornerRadius !== undefined ? `רדיוס ${c.cornerRadius}` : '', c.fontFamily ? `משפחת גופן ${c.fontFamily} — צריך להוסיף את משאב הגופן ל־Android כדי להתאים בדיוק` : ''].filter(Boolean).join(' · ');
}
export function getDesignGuidance(screen: ScreenSnapshot, step: number): DesignGuidance {
  const components = [...screen.components].sort((a,b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
  const text = components.filter(c => c.type === 'Text');
  const inputs = components.filter(c => c.type === 'Input');
  const buttons = components.filter(c => c.type === 'Button');
  const selected = step === 2 ? text : step === 3 ? inputs : step === 4 ? buttons : components;
  const background = kotlinColor(screen.fillColor);
  const roots = components.filter(c => c.parentId === screen.id || !c.parentId);
  const left = Math.max(0, Math.min(...roots.map(c => c.x ?? 0), screen.width));
  const firstY = Math.max(0, Math.min(...roots.map(c => c.y ?? 0), screen.height));
  const layout = `Column(\n    modifier = Modifier.fillMaxSize()${background ? `\n        .background(${background})` : ''}\n        .padding(start = ${n(left)}.dp, top = ${n(firstY)}.dp),\n    horizontalAlignment = Alignment.Start,\n    verticalArrangement = Arrangement.Top\n) {\n    // כתוב את הרכיבים לפי הסדר והריווחים של העיצוב\n}`;
  const drills: DesignDrill[] = step === 1 ? [{ id: screen.id, title: 'רקע, נקודת התחלה ופריסה', measurements: `מסך ${screen.width} × ${screen.height} · רקע ${screen.fillColor ?? 'לא נשמר'}`, explanation: 'fillMaxSize מגדיר את שטח המסך; background צובע אותו; padding מזיז את תחילת התוכן. אלה מידות בסיס מהעיצוב, לא הבטחה להתאמה לכל מכשיר. למסך עם רכיבים זה לצד זה השתמש ב־Row, ולרכיבים חופפים ב־Box. אין למרכז את כל המסך אוטומטית כאשר העיצוב אינו ממורכז.', code: layout, compare: 'השווה את הרקע ואת המיקום של הרכיב הראשון. אחר כך התאם שוליים בטוחים ורוחב למכשיר.' }] : selected.map(c => {
    const previous = components.filter(item => item.parentId === c.parentId && (item.y ?? 0) < (c.y ?? 0)).at(-1);
    const gap = previous && c.y !== undefined && previous.y !== undefined && previous.height !== undefined ? n(c.y - previous.y - previous.height) : undefined;
    const spacing = gap !== undefined && gap >= 0 ? `הרווח מהרכיב הקודם הוא ${gap}; בתוך Column הוסף Spacer(Modifier.height(${gap}.dp)) לפני הרכיב.` : 'בדוק אם הרכיב נמצא בקבוצה, בשורה או בחפיפה; אין להכניס את כולם ל־Column אחד בלי הבחנה.';
    const modifier = `Modifier${c.width !== undefined ? `.width(${n(c.width)}.dp)` : '.fillMaxWidth()'}${c.height !== undefined && c.type !== 'Text' ? `.height(${n(c.height)}.dp)` : ''}`;
    const label = quote(c.text ?? c.name);
    const foreground = kotlinColor(c.textColor ?? (c.type === 'Text' ? c.fillColor : undefined));
    const fill = kotlinColor(c.fillColor);
    const font = c.fontSize ? `,\n    fontSize = ${c.fontSize}.sp` : '';
    const weight = c.fontWeight ? (/bold|heavy|black/i.test(c.fontWeight) ? 700 : /medium|semibold/i.test(c.fontWeight) ? 600 : Number(c.fontWeight) || 400) : undefined;
    const textCode = `Text(\n    text = ${label}${foreground ? `,\n    color = ${foreground}` : ''}${font}${weight ? `,\n    fontWeight = FontWeight(${weight})` : ''}${c.textAlign ? `,\n    textAlign = TextAlign.${c.textAlign === 'center' ? 'Center' : c.textAlign === 'right' ? 'Right' : 'Left'}` : ''},\n    modifier = ${modifier}\n)`;
    let code = textCode;
    if (c.type === 'Input') {
      const state = `field${inputs.findIndex(item => item.id === c.id) + 1}`;
      code = `// לפני הפריסה; אם כבר הגדרת משתנה לשדה, השתמש בשם שלו\nvar ${state} by remember { mutableStateOf("") }\n\n// בתוך הפריסה\nOutlinedTextField(\n    value = ${state},\n    onValueChange = { ${state} = it },\n    placeholder = { Text(${label}) },\n    singleLine = true,\n    modifier = ${modifier},\n    shape = RoundedCornerShape(${c.cornerRadius ?? 4}.dp)${c.isSecure ? ',\n    visualTransformation = PasswordVisualTransformation()' : ''}${fill || foreground ? `,\n    colors = OutlinedTextFieldDefaults.colors(\n        ${[fill && `focusedContainerColor = ${fill}`, fill && `unfocusedContainerColor = ${fill}`, foreground && `focusedTextColor = ${foreground}`, foreground && `unfocusedTextColor = ${foreground}`, kotlinColor(c.stroke) && `focusedBorderColor = ${kotlinColor(c.stroke)}`, kotlinColor(c.stroke) && `unfocusedBorderColor = ${kotlinColor(c.stroke)}`].filter(Boolean).join(',\n        ')}\n    )` : ''}\n)`;
    } else if (c.type === 'Button') {
      code = `Button(\n    onClick = { message = ${quote(`נלחץ: ${c.text ?? c.name}`)} },\n    modifier = ${modifier},\n    shape = RoundedCornerShape(${c.cornerRadius ?? 0}.dp)${fill || foreground ? `,\n    colors = ButtonDefaults.buttonColors(${[fill && `containerColor = ${fill}`, foreground && `contentColor = ${foreground}`].filter(Boolean).join(', ')})` : ''}\n) {\n    Text(text = ${label}${c.fontSize ? `, fontSize = ${c.fontSize}.sp` : ''})\n}`;
    } else if (c.type !== 'Text') code = '// לרכיב זה צריך לבחור רכיב Compose מתאים; אין להחליף אותו אוטומטית בטקסט.';
    return { id: c.id, title: `${c.name} — ${c.type}`, measurements: measurements(c), explanation: `${spacing} ${c.type === 'Text' ? 'fontSize קובע גודל, color צבע, fontWeight משקל ו־textAlign יישור בתוך הרוחב שהגדרת.' : c.type === 'Button' ? 'shape מגדיר פינות; colors מגדיר את צבעי הכפתור והתוכן. הגדר message לפני הפריסה ו־Text(message) בתוכה כדי לראות את פעולת הניסוי; זו אינה התחברות אמיתית.' : c.type === 'Input' ? 'shape משנה פינות; colors מגדיר רקע, טקסט ומסגרת גם כשהשדה מקבל פוקוס. placeholder הוא רמז בתוך שדה ריק; label היא תווית צפה — בחר לפי העיצוב.' : 'שמור את מיקום הרכיב ביחס לקבוצת האב שלו.'}`, code, compare: `השווה לעיצוב: ${c.text ?? c.name}, המיקום, הגודל, הצבעים והפינות. שנה מאפיין אחד בכל פעם והסבר את התוצאה.` };
  });
  return { title: `מעצבים כמו המקור: ${screen.name}`, summary: `ההנחיות מבוססות על ${screen.components.length} הרכיבים בעיצוב השמור. מידות העיצוב הן נקודת התחלה ל־dp ו־sp; יש להתאים למסך, גופן ושוליים בטוחים. ${step === 5 ? 'עבור על כל הרכיבים לפני שמסיימים. בנייה מוצלחת אינה אישור להתאמה חזותית.' : ''}`, imports: ['androidx.compose.foundation.background', 'androidx.compose.foundation.shape.RoundedCornerShape', 'androidx.compose.ui.graphics.Color', 'androidx.compose.ui.text.font.FontWeight', 'androidx.compose.ui.text.style.TextAlign', 'androidx.compose.ui.text.input.PasswordVisualTransformation', 'androidx.compose.ui.unit.sp'], drills };
}
