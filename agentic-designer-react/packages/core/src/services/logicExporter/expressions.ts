// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — parameter →
// Swift-expression resolution (swiftValueExpr, swiftInterpolatedString,
// swiftLiteral, keyValueLiteral, swiftCondition, firestoreQueryConstraints).

import { swiftDouble } from '../../agent/DesignAction';
import type { LogicBlock } from '../../models/LogicModels';
import { paramValue, swiftEscaped, swiftIdentifier, swiftString, variableReference } from './helpers';
import { swiftSplit, trimWhitespaces } from './swiftRuntime';
import type { VariableTypeMap } from './types';

// Renders a keyValue parameter ("key = value" per line, {{var}} aware)
// into a Swift [String: String] dictionary literal.
export function keyValueLiteral(block: LogicBlock, key: string, variableTypes: VariableTypeMap): string {
  const raw = paramValue(block, key);
  if (raw === undefined || raw.length === 0) return '[:]';
  const entries: string[] = [];
  for (const line of swiftSplit(raw, '\n')) {
    const parts = swiftSplit(line, '=', 1).map(trimWhitespaces);
    if (parts.length !== 2) continue;
    entries.push(`${swiftString(parts[0]!)}: ${swiftInterpolatedString(parts[1]!, variableTypes)}`);
  }
  return entries.length === 0 ? '[:]' : `[${entries.join(', ')}]`;
}

// ifCondition uses keys leftValue/rightValue; compare uses left/right —
// same shape, different param names, so this tries both.
export function swiftCondition(block: LogicBlock, variableTypes: VariableTypeMap): string {
  const leftKey = block.parameters.some((p) => p.key === 'leftValue') ? 'leftValue' : 'left';
  const rightKey = block.parameters.some((p) => p.key === 'rightValue') ? 'rightValue' : 'right';
  const leftVariable = variableReference(block, leftKey);
  const leftType = (leftVariable !== undefined ? variableTypes.get(leftVariable) : undefined) ?? 'string';
  const left =
    leftVariable !== undefined
      ? `state.${swiftIdentifier(leftVariable, 'value')}`
      : swiftString(paramValue(block, leftKey) ?? '');
  const op = paramValue(block, 'operator') ?? '==';
  const right = swiftLiteral(paramValue(block, rightKey) ?? '', leftType, variableTypes);
  switch (op) {
    case '!=': return `${left} != ${right}`;
    case '<': return `${left} < ${right}`;
    case '>': return `${left} > ${right}`;
    case '<=': return `${left} <= ${right}`;
    case '>=': return `${left} >= ${right}`;
    case 'contains': return `${left}.contains(${right})`;
    case 'isEmpty': return `${left}.isEmpty`;
    default: return `${left} == ${right}`;
  }
}

// Resolves any block parameter to a String-typed Swift expression,
// converting non-string variable types to their string form.
export function swiftValueExpr(block: LogicBlock, key: string, variableTypes: VariableTypeMap): string {
  const variable = variableReference(block, key);
  if (variable !== undefined) {
    const name = `state.${swiftIdentifier(variable, 'value')}`;
    switch (variableTypes.get(variable) ?? 'string') {
      case 'string':
      case 'json':
        return name;
      case 'optional':
        return `(${name} ?? "")`;
      case 'number':
        return `String(${name})`;
      case 'boolean':
        return `(${name} ? "true" : "false")`;
      case 'array':
        return `${name}.joined(separator: ", ")`;
    }
  }
  return swiftInterpolatedString(paramValue(block, key) ?? '', variableTypes);
}

// Same resolution as swiftValueExpr, for parameters that are always plain text.
export function swiftStringParam(block: LogicBlock, key: string, variableTypes: VariableTypeMap): string {
  return swiftValueExpr(block, key, variableTypes);
}

export function swiftNumberParam(
  block: LogicBlock,
  key: string,
  defaultLiteral: string,
  variableTypes: VariableTypeMap,
): string {
  const variable = variableReference(block, key);
  if (variable !== undefined) {
    const name = `state.${swiftIdentifier(variable, 'value')}`;
    switch (variableTypes.get(variable) ?? 'string') {
      case 'number':
        return name;
      default:
        return `(Double(${name}.description) ?? ${defaultLiteral})`;
    }
  }
  const raw = paramValue(block, key) ?? '';
  return raw.length === 0 ? defaultLiteral : raw;
}

// True when every {{token}} in the text can compile: its root is either a
// reserved token (uid/now/...) or a declared variable.
export function tokensResolve(text: string, variableTypes: VariableTypeMap): boolean {
  let remainder = text;
  let sawToken = false;
  for (;;) {
    const open = remainder.indexOf('{{');
    if (open === -1) break;
    remainder = remainder.slice(open + 2);
    const close = remainder.indexOf('}}');
    if (close === -1) return false;
    const token = trimWhitespaces(remainder.slice(0, close));
    remainder = remainder.slice(close + 2);
    if (token.length === 0) return false;
    sawToken = true;
    const root = swiftSplit(token, '.')[0] ?? token;
    const reserved = ['uid', 'userid', 'currentuserid', 'now', 'timestamp', 'createdat'];
    if (reserved.includes(root.toLowerCase())) continue;
    if (variableTypes.get(root) === undefined && variableTypes.get(swiftIdentifier(root, 'value')) === undefined) {
      return false;
    }
  }
  return sawToken;
}

// Turns "Hello {{name}}!" into a real Swift string interpolation.
export function swiftInterpolatedString(raw: string, variableTypes: VariableTypeMap): string {
  if (!raw.includes('{{')) return swiftString(raw);
  let result = '';
  let remainder = raw;
  for (;;) {
    const open = remainder.indexOf('{{');
    if (open === -1) break;
    result += swiftEscaped(remainder.slice(0, open));
    remainder = remainder.slice(open + 2);
    const close = remainder.indexOf('}}');
    if (close === -1) {
      result += '{{' + swiftEscaped(remainder);
      remainder = '';
      break;
    }
    const varName = trimWhitespaces(remainder.slice(0, close));

    // Reserved tokens: the signed-in user's UID and "now".
    switch (varName.toLowerCase()) {
      case 'uid':
      case 'userid':
      case 'currentuserid':
        result += '\\(state.currentUserId)';
        remainder = remainder.slice(close + 2);
        continue;
      case 'now':
      case 'timestamp':
      case 'createdat':
        result += '\\(ISO8601DateFormatter().string(from: Date()))';
        remainder = remainder.slice(close + 2);
        continue;
      default:
        break;
    }

    const dotIndex = varName.indexOf('.');
    if (dotIndex !== -1) {
      const root = varName.slice(0, dotIndex);
      const path = varName.slice(dotIndex + 1);
      result += `\\(GeneratedRepeat.resolve(state.${swiftIdentifier(root, 'value')}, ${swiftString(path)}))`;
    } else if (variableTypes.get(varName) === 'array') {
      result += `\\(state.${swiftIdentifier(varName, 'value')}.joined(separator: "\\n"))`;
    } else if (variableTypes.get(varName) === 'number') {
      // Whole numbers read as "47", not "47.0".
      result += `\\(GeneratedNumber.clean(state.${swiftIdentifier(varName, 'value')}))`;
    } else {
      result += `\\(state.${swiftIdentifier(varName, 'value')})`;
    }
    remainder = remainder.slice(close + 2);
  }
  result += swiftEscaped(remainder);
  return `"${result}"`;
}

export function swiftLiteral(
  raw: string,
  type: import('../../models/LogicModels').VariableType,
  variableTypes: VariableTypeMap = new Map(),
): string {
  switch (type) {
    case 'number':
      if (raw.includes('{{')) {
        return `(Double(${swiftInterpolatedString(raw, variableTypes)}) ?? 0)`;
      }
      return raw.length === 0 ? '0' : raw;
    case 'boolean':
      if (raw.includes('{{')) {
        return `(${swiftInterpolatedString(raw, variableTypes)} == "true")`;
      }
      return raw === 'true' ? 'true' : 'false';
    case 'array':
      return '[]';
    case 'optional':
      return raw.length === 0 ? 'nil' : swiftInterpolatedString(raw, variableTypes);
    case 'json':
    case 'string':
      return swiftInterpolatedString(raw, variableTypes);
  }
}

// Turns a Query Collection block's `where` and `orderBy` into real Firestore
// query builders.
export function firestoreQueryConstraints(
  block: LogicBlock,
  flag: string,
  variableTypes: VariableTypeMap,
): string {
  const lines: string[] = [];
  const query = `__query_${flag}`;

  for (const clause of swiftSplit(paramValue(block, 'where') ?? '', '\n')) {
    const text = trimWhitespaces(clause);
    if (text.length === 0) continue;
    // Longest operators first, or "==" would match inside ">=".
    const operators: [string, string][] = [
      ['==', 'isEqualTo'], ['!=', 'isNotEqualTo'],
      ['>=', 'isGreaterThanOrEqualTo'], ['<=', 'isLessThanOrEqualTo'],
      ['>', 'isGreaterThan'], ['<', 'isLessThan'],
      [' contains ', 'arrayContains'], [' in ', 'in'],
    ];
    const match = operators.find(([token]) => text.includes(token));
    if (match === undefined) continue;
    const start = text.indexOf(match[0]);
    const field = trimWhitespaces(text.slice(0, start));
    const rawValue = trimWhitespaces(text.slice(start + match[0].length));
    if (field.length === 0 || rawValue.length === 0) continue;
    // A bare number or bool compares as itself; anything else as a string.
    let value: string;
    const number = swiftDouble(rawValue);
    if (number !== null && !rawValue.includes('{{')) {
      value = number === swiftRounded(number) ? String(Math.trunc(number)) : rawValue;
    } else if (['true', 'false'].includes(rawValue.toLowerCase()) && !rawValue.includes('{{')) {
      value = rawValue.toLowerCase();
    } else {
      value = swiftInterpolatedString(rawValue, variableTypes);
    }
    lines.push(`    ${query} = ${query}.whereField(${swiftString(field)}, ${match[1]}: ${value})`);
  }

  const order = trimWhitespaces(paramValue(block, 'orderBy') ?? '');
  if (order.length > 0) {
    const parts = swiftSplit(order, ' ');
    const field = parts[0]!;
    const descending = parts.length > 1 && parts[1]!.toLowerCase().startsWith('desc');
    lines.push(`    ${query} = ${query}.order(by: ${swiftString(field)}, descending: ${descending})`);
  }

  return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

/** Swift `Double.rounded()` — half away from zero. */
function swiftRounded(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}
