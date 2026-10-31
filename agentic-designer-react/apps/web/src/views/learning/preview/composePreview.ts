// A bounded visual interpreter for the introductory Compose lessons. Never executes Kotlin.
export interface PreviewNode { kind: string; args: Record<string, string>; children: PreviewNode[] }
export interface PreviewDocument { nodes: PreviewNode[]; values: Record<string, string>; warnings: string[]; writable: string[] }
const supported = new Set(['Icon', 'Column', 'Row', 'Box', 'Text', 'Button', 'OutlinedButton', 'TextButton', 'OutlinedTextField', 'TextField', 'Spacer', 'Surface', 'Card']);
export function parseComposePreview(source: string, entry: string): PreviewDocument {
  if (source.length > 100_000) throw new Error('הקובץ גדול מדי לתצוגה המהירה.');
  const tokens = source.match(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[A-Za-z_][\w]*|\d+(?:\.\d+)?|[^\s]/g)?.filter(t => !t.startsWith('//') && !t.startsWith('/*')) ?? [];
  const pairs = new Map<number, number>(); const stack: number[] = [];
  tokens.forEach((t, i) => {
    if (['(', '{', '['].includes(t)) stack.push(i);
    if ([')', '}', ']'].includes(t)) {
      const open = stack.pop();
      if (open === undefined || '({['.indexOf(tokens[open]) !== ')}]'.indexOf(t)) throw new Error('השלם את הסוגריים כדי לעדכן את התצוגה.');
      pairs.set(open, i);
    }
  });
  if (stack.length) throw new Error('השלם את הסוגריים כדי לעדכן את התצוגה.');
  const start = tokens.findIndex((t, i) => t === 'fun' && tokens[i + 1] === entry);
  if (start < 0) throw new Error('כתוב את פונקציית המסך כדי לראות אותה כאן.');
  const params = start + 2;
  const body = (pairs.get(params) ?? params) + 1;
  if (tokens[body] !== '{') throw new Error('התצוגה תומכת בפונקציית מסך עם גוף { … }.');
  const values: Record<string, string> = {};
  const warnings = new Set<string>();
  const end = pairs.get(body)!;
  const bodyText = tokens.slice(body + 1, end).join(' ');
  for (const match of bodyText.matchAll(/(?:var|val)\s+(\w+)\s+(?:by\s+remember(?:Saveable)?\s*\{\s*mutableStateOf\s*\(\s*|=\s*)("(?:\\.|[^"\\])*"|\d+|true|false)/g)) values[match[1]] = match[2];
  const writable = [...bodyText.matchAll(/var\s+(\w+)\s+(?:by|=)/g)].map(m => m[1]).filter(name => Object.hasOwn(values, name));
  const argsAt = (open: number, close: number): Record<string, string> => {
    const result: Record<string, string> = {}; let from = open + 1; let positional = 0;
    for (let i = from; i <= close; i++) {
      if (i === close || tokens[i] === ',') {
        const part = tokens.slice(from, i); const named = part[1] === '=';
        if (part.length) result[named ? part[0] : String(positional++)] = part.slice(named ? 2 : 0).join(' ');
        from = i + 1;
      } else if (pairs.has(i)) i = pairs.get(i)!;
    }
    return result;
  };
  const parse = (from: number, to: number, depth = 0): PreviewNode[] => {
    if (depth > 30) throw new Error('הפריסה עמוקה מדי לתצוגה המהירה.');
    const nodes: PreviewNode[] = [];
    for (let i = from; i < to; i++) {
      const kind = tokens[i];
      if (['if', 'when', 'for', 'while'].includes(kind)) warnings.add('תנאים ולולאות אינם מחושבים בתצוגה המהירה.');
      if (supported.has(kind) && tokens[i + 1] === '{') {
        nodes.push({ kind, args: {}, children: parse(i + 2, pairs.get(i + 1)!, depth + 1) });
        i = pairs.get(i + 1)!;
        continue;
      }
      if (tokens[i + 1] !== '(') continue;
      const close = pairs.get(i + 1); if (close === undefined) continue;
      const trailing = tokens[close + 1] === '{' ? close + 1 : undefined;
      if (supported.has(kind)) {
        const args = argsAt(i + 1, close);
        let children = trailing === undefined ? [] : parse(trailing + 1, pairs.get(trailing)!, depth + 1);
        if (args.modifier?.includes('{')) warnings.add('תוכן הרכיב נמצא בתוך modifier. סגור את רשימת הפרמטרים ב־) וכתוב אחריה { Text("…") }.');
        if (kind.endsWith('Button') && !children.length) warnings.add('לכפתור חסר תוכן גלוי. הוסף { Text("המשך") } אחרי הסוגר ) של Button.');
        const knownModifiers = new Set(['fillMaxSize', 'fillMaxWidth', 'fillMaxHeight', 'padding', 'width', 'height', 'size', 'background', 'clip']);
        for (const call of (args.modifier ?? '').matchAll(/\.\s*(\w+)\s*\(/g)) {
          if (!knownModifiers.has(call[1])) warnings.add(`Modifier.${call[1]} אינו משתקף בתצוגה המהירה.`);
        }
        if (!children.length && args.content) warnings.add('כתוב את תוכן הפריסה בתוך בלוק { } אחרי הסוגריים.');
        nodes.push({ kind, args, children });
      } else if (kind === 'MaterialTheme') {
        if (trailing !== undefined) nodes.push(...parse(trailing + 1, pairs.get(trailing)!, depth + 1));
      } else if (/^[A-Z]/.test(kind)) warnings.add(`הרכיב ${kind} עדיין אינו נתמך ב־Preview המהיר.`);
      i = trailing === undefined ? close : pairs.get(trailing)!;
    }
    return nodes;
  };
  return { nodes: parse(body + 1, end), values, writable, warnings: [...warnings] };
}
export function previewText(expression: string | undefined, values: Record<string, string>): string {
  if (!expression) return '';
  if (Object.hasOwn(values, expression)) { const raw = values[expression]; return raw.startsWith('"') ? JSON.parse(raw) : raw; }
  const value = expression;
  if (/^"(?:\\.|[^"\\])*"$/.test(value)) {
    let text: string; try { text = JSON.parse(value); } catch { return value.slice(1, -1); }
    return text.replace(/\$\{?(\w+)\}?/g, (_, key) => values[key] ? previewText(values[key], {}) : `$${key}`);
  }
  return value;
}
