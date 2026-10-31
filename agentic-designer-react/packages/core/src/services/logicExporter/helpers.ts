// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — the small
// pure helpers at the bottom of the file (swiftIdentifier, swiftString,
// paramValue, ...) plus the node-level lookups shared by every emitter.

import type { DesignNode } from '../../models/DesignNode';
import type { LogicBlock, LogicFlow, LogicVariable, VariableType } from '../../models/LogicModels';
import type { DynamicNodeProperty, VariableTypeMap } from './types';
import {
  componentsSeparatedByNonAlphanumerics,
  isNumberChar,
  swiftPrefix,
  swiftSplit,
  trimCharacters,
  trimWhitespacesAndNewlines,
  uuidString,
} from './swiftRuntime';

// MARK: Parameters

export function variableReference(block: LogicBlock, key: string): string | undefined {
  return block.parameters.find((p) => p.key === key)?.variableReference;
}

export function nodeReference(block: LogicBlock, key: string): string | undefined {
  return block.parameters.find((p) => p.key === key)?.nodeReference;
}

export function paramValue(block: LogicBlock, key: string): string | undefined {
  return block.parameters.find((p) => p.key === key)?.value;
}

// MARK: Identifiers & literals

export function swiftIdentifier(raw: string, fallback: string): string {
  const parts = componentsSeparatedByNonAlphanumerics(raw).filter((p) => p.length > 0);
  const joined = parts
    .map((part, index) => {
      if (index === 0) return part;
      const cps = Array.from(part);
      return cps[0]!.toUpperCase() + cps.slice(1).join('');
    })
    .join('');
  const candidate = joined.length === 0 ? fallback : joined;
  const first = Array.from(candidate)[0];
  return first !== undefined && isNumberChar(first) ? `${fallback}${candidate}` : candidate;
}

export function swiftType(type: VariableType): string {
  switch (type) {
    case 'number': return 'Double';
    case 'boolean': return 'Bool';
    case 'array': return '[String]';
    case 'json': return 'String';
    case 'optional': return 'String?';
    case 'string': return 'String';
  }
}

export function swiftDefault(variable: LogicVariable): string {
  const value = variable.defaultValue;
  if (value === undefined || value.length === 0) {
    switch (variable.type) {
      case 'number': return '0';
      case 'boolean': return 'false';
      case 'array': return '[]';
      case 'json': return '"{}"';
      case 'optional': return 'nil';
      case 'string': return '""';
    }
  }
  switch (variable.type) {
    case 'number': return value;
    case 'boolean': return value === 'true' ? 'true' : 'false';
    case 'array': return '[]';
    case 'optional': return swiftString(value);
    case 'json':
    case 'string': return swiftString(value);
  }
}

export function swiftString(raw: string): string {
  return `"${swiftEscaped(raw)}"`;
}

export function swiftEscaped(raw: string): string {
  return raw.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

export function indent(text: string, spaces: number): string {
  const prefix = ' '.repeat(spaces);
  return swiftSplit(text, '\n', Number.MAX_SAFE_INTEGER, false)
    .map((line) => prefix + line)
    .join('\n');
}

// flow.name/event.label are free-text — two flows can easily collide, so a
// slice of the (always unique) event id is folded into the function name.
export function actionFunctionName(flow: LogicFlow, event: LogicBlock): string {
  const readable = swiftIdentifier(flow.name + event.label, 'Flow');
  const suffix = swiftSplit(uuidString(event.id), '-')[0] ?? '';
  return `run${readable}_${suffix}`;
}

export function screenKey(screen: DesignNode): string {
  return swiftIdentifier(screen.name, 'Screen');
}

// MARK: Dynamic node state

export function dynamicVarName(nodeId: string, property: DynamicNodeProperty): string {
  const short = swiftPrefix(uuidString(nodeId).replaceAll('-', ''), 12);
  switch (property) {
    case 'text': return `nodeText_${short}`;
    case 'fill': return `nodeFill_${short}`;
    case 'textColor': return `nodeTextColor_${short}`;
    case 'opacityChannel': return `nodeOpacity_${short}`;
    case 'image': return `nodeImage_${short}`;
    case 'x': return `nodeX_${short}`;
    case 'y': return `nodeY_${short}`;
    case 'width': return `nodeWidth_${short}`;
    case 'height': return `nodeHeight_${short}`;
  }
}

// MARK: Node lookups

export function findNode(id: string, nodes: DesignNode[]): DesignNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(id, node.children);
    if (found) return found;
  }
  return undefined;
}

/// Stable bundle-resource base name for a game node's scene JSON.
export function gameSceneResourceName(node: DesignNode): string {
  return 'GameScene_' + uuidString(node.id).replaceAll('-', '');
}

/// Stable, test-friendly identifier derived from the designer's node name.
export function accessibilityIdentifier(node: DesignNode): string {
  const cleaned = trimCharacters(
    trimWhitespacesAndNewlines(node.name).replace(/[^A-Za-z0-9]+/g, '_'),
    '_',
  );
  return cleaned.length === 0 ? `node_${swiftPrefix(uuidString(node.id), 8)}` : cleaned;
}

/// A name that names a secret. Used both to hide the field and to keep the
/// value OUT of on-disk persistence.
export function looksSensitive(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    ['password', 'passcode', 'pwd', 'secret', 'pin', 'cvv', 'otp', 'token'].some((needle) => lower.includes(needle)) ||
    text.includes('סיסמ')
  );
}

export function boundText(node: DesignNode): string | undefined {
  const binding = node.logicBindings?.find((b) => b.kind === 'text');
  if (!binding) return undefined;
  return `String(describing: state.${swiftIdentifier(binding.variableName, 'value')})`;
}

/// True when a text input should render as a SecureField.
export function isSecureInput(node: DesignNode): boolean {
  if (node.isSecure === true) return true;
  const bound = node.logicBindings?.map((b) => b.variableName) ?? [];
  const haystack = [node.name, node.text, ...bound].filter((s): s is string => s !== undefined).join(' ');
  return looksSensitive(haystack);
}

export function binding(node: DesignNode, variableTypes: VariableTypeMap): string | undefined {
  const b = node.logicBindings?.find((x) => x.kind === 'value' || x.kind === 'text');
  if (!b) return undefined;
  const name = swiftIdentifier(b.variableName, 'value');
  switch (variableTypes.get(b.variableName) ?? 'string') {
    case 'string':
    case 'json':
      return `$state.${name}`;
    case 'optional':
      return `Binding(get: { state.${name} ?? "" }, set: { state.${name} = $0 })`;
    case 'number':
      return `Binding(get: { String(state.${name}) }, set: { state.${name} = Double($0) ?? state.${name} })`;
    case 'boolean':
      return `Binding(get: { state.${name} ? "true" : "false" }, set: { state.${name} = ($0 == "true") })`;
    case 'array':
      return `Binding(get: { state.${name}.joined(separator: ", ") }, set: { state.${name} = $0.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) } })`;
  }
}

export function imageExpression(node: DesignNode, imageAssets: Map<string, string>): string {
  const source = [node.imageSource, node.imageName].find((s): s is string => s !== undefined) ?? '';
  const fileName = imageAssets.get(source);
  if (fileName !== undefined) {
    return `GeneratedImage(resourceName: ${swiftString(fileName)}).scaledToFill()`;
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return `AsyncImage(url: URL(string: ${swiftString(source)})) { image in image.resizable().scaledToFill() } placeholder: { Color.gray.opacity(0.2) }`;
  }
  return 'Color.gray.opacity(0.2)';
}

/** `Set<LogicBlockType>.contains` over an event-type list. */
export function flatten(node: DesignNode): DesignNode[] {
  return [node, ...node.children.flatMap(flatten)];
}
