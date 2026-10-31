// Deliberately small Kotlin expression/assignment interpreter; no eval or network execution.
import { previewText } from './composePreview';
type Value = string | number | boolean;
const lex = (source: string) => source.match(/"(?:\\.|[^"\\])*"|\d+(?:\.\d+)?|[A-Za-z_]\w*|==|!=|&&|\|\||\+\+|--|\+=|-=|->|[^\s]/g) ?? [];
export function evaluatePreview(expression: string, values: Record<string, string>, input?: string): Value {
  const tokens = lex(expression); let index = 0;
  const atom = (): Value => {
    const token = tokens[index++];
    if (token === '!') return !atom();
    if (token === '(') { const result = binary(0); if (tokens[index++] !== ')') throw Error('סוגריים לא תקינים'); return result; }
    let result: Value;
    if (token?.startsWith('"')) result = previewText(token, values);
    else if (/^\d+(\.\d+)?$/.test(token ?? '')) result = Number(token);
    else if (token === 'true' || token === 'false') result = token === 'true';
    else if (token === 'it' && input !== undefined) result = input;
    else if (Object.hasOwn(values, token)) {
      const raw = values[token]; result = raw.startsWith('"') ? JSON.parse(raw) : raw === 'true' ? true : raw === 'false' ? false : Number(raw);
    } else throw Error(`הביטוי ${token ?? ''} אינו נתמך`);
    while (tokens[index] === '.') {
      index++; const method = tokens[index++];
      if (method === 'length' && typeof result === 'string') { result = result.length; continue; }
      if (tokens[index++] !== '(' || tokens[index++] !== ')') throw Error('קריאה זו אינה נתמכת');
      if (method === 'toString') result = String(result);
      else if (typeof result === 'string' && ['isBlank', 'isNotBlank', 'isEmpty', 'isNotEmpty'].includes(method)) result = method === 'isBlank' ? !result.trim() : method === 'isNotBlank' ? !!result.trim() : method === 'isEmpty' ? !result.length : !!result.length;
      else throw Error(`הפעולה ${method} אינה נתמכת`);
    }
    return result;
  };
  const priority: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '+': 4, '-': 4 };
  const binary = (minimum: number): Value => {
    let left = atom();
    while ((priority[tokens[index]] ?? -1) >= minimum) {
      const op = tokens[index++]; const right = binary(priority[op] + 1);
      if (op === '+') left = typeof left === 'string' || typeof right === 'string' ? String(left) + String(right) : Number(left) + Number(right);
      else if (op === '-') left = Number(left) - Number(right);
      else if (op === '==') left = left === right;
      else if (op === '!=') left = left !== right;
      else if (op === '&&') left = Boolean(left) && Boolean(right);
      else left = Boolean(left) || Boolean(right);
    }
    return left;
  };
  const result = binary(0);
  if (index !== tokens.length || (typeof result === 'number' && !Number.isFinite(result))) throw Error('ביטוי זה אינו נתמך');
  return result;
}
export function applyPreviewAction(action: string | undefined, values: Record<string, string>, writable: string[], input?: string): Record<string, string> {
  if (!action?.trim().startsWith('{') || !action.trim().endsWith('}')) throw Error('הפעולה הזו דורשת הרצה באמולטור.');
  const tokens = lex(action.trim().slice(1, -1));
  let index = 0; let alias = 'it';
  if (tokens[1] === '->') { alias = tokens[0]!; index = 2; }
  const next = { ...values };
  while (index < tokens.length) {
    if (tokens[index] === ';') { index++; continue; }
    const name = tokens[index++]; const operator = tokens[index++];
    if (!writable.includes(name) || !['=', '+=', '-=', '++', '--'].includes(operator)) throw Error('ה־Preview תומך כאן בהשמה למשתנה מקומי בלבד. בדוק את הפעולה באמולטור.');
    let expression: string[] = [];
    if (!['++', '--'].includes(operator)) {
      while (index < tokens.length && tokens[index] !== ';') {
        if (expression.length && /^[A-Za-z_]\w*$/.test(tokens[index]) && ['=', '+=', '-=', '++', '--'].includes(tokens[index + 1])) break;
        expression.push(input !== undefined && tokens[index] === alias ? 'it' : tokens[index]); index++;
      }
    }
    const right = ['++', '--'].includes(operator) ? '1' : expression.join(' ');
    const result = evaluatePreview(operator === '=' ? right : `${name} ${operator.startsWith('+') ? '+' : '-'} (${right})`, next, input);
    next[name] = JSON.stringify(result);
  }
  return next;
}
