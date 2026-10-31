// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — the chain
// walker (swiftStatements), the branching blocks (swiftBranch/asyncBranch)
// and the per-block statement emitter (swiftStatement/animateStatement).

import { swiftInt as parseSwiftInt } from '../../agent/DesignAction';
import { BlockCatalog } from '../../models/BlockDefinitions';
import type { DesignNode } from '../../models/DesignNode';
import type { DesignProject } from '../../models/DesignProject';
import type { LogicBlock, LogicBlockType, LogicFlow } from '../../models/LogicModels';
import { asyncSetup, permissionSetup } from './asyncSetup';
import {
  keyValueLiteral,
  swiftCondition,
  swiftInterpolatedString,
  swiftLiteral,
  swiftNumberParam,
  swiftStringParam,
  swiftValueExpr,
} from './expressions';
import {
  actionFunctionName,
  dynamicVarName,
  findNode,
  indent,
  looksSensitive,
  nodeReference,
  paramValue,
  screenKey,
  swiftEscaped,
  swiftIdentifier,
  swiftString,
  variableReference,
} from './helpers';
import { swiftPrefix, swiftSplit, trimWhitespaces, uuidString } from './swiftRuntime';
import type { DynamicMap, DynamicNodeProperty, VariableTypeMap } from './types';

// Generated action functions are async, so every call site launches a Task.
export function eventCalls(
  types: LogicBlockType[],
  flows: LogicFlow[],
  nodeId: string | undefined,
  receiver: string = 'actions',
): string {
  const calls: string[] = [];
  for (const flow of flows) {
    for (const event of flow.blocks) {
      if (!types.includes(event.type)) continue;
      if (nodeId !== undefined && !eventMatches(event, nodeId, flow)) continue;
      calls.push(`_ = Swift.Task<Void, Never> { @MainActor in await ${receiver}.${actionFunctionName(flow, event)}() }`);
    }
  }
  return calls.join('\n');
}

export function eventMatches(event: LogicBlock, nodeId: string, flow: LogicFlow): boolean {
  if (event.connectedDesignNodeId === nodeId) return true;
  if (event.parameters.some((p) => p.nodeReference === nodeId)) return true;
  if (
    (event.type === 'onScreenLoad' || event.type === 'onScreenOpened' || event.type === 'onScreenDisappear') &&
    flow.screenNodeId === nodeId
  ) {
    return true;
  }
  return false;
}

// Walks one execution chain, turning each connected block into a Swift
// statement. Any block whose catalog definition has more than one output port
// branches: every output port gets its own recursive chain.
export function swiftStatements(
  blockId: string,
  port: number,
  flow: LogicFlow,
  screens: DesignNode[],
  variableTypes: VariableTypeMap,
  project: DesignProject,
  dynamic: DynamicMap,
  imageAssets: Map<string, string>,
  visited: Set<string>,
): { code: string; visited: Set<string> } {
  const lines: string[] = [];
  let currentId = blockId;
  let currentPort = port;
  for (;;) {
    const connection = flow.connections.find((c) => c.sourceBlockId === currentId && c.sourcePortIndex === currentPort);
    if (connection === undefined) break;
    if (visited.has(connection.targetBlockId)) break;
    visited.add(connection.targetBlockId);
    const block = flow.blocks.find((b) => b.id === connection.targetBlockId);
    if (block === undefined) break;

    const outputCount = Math.max(1, BlockCatalog.definition(block.type)?.outputPortCount ?? 1);
    if (outputCount > 1) {
      const chains: string[] = [];
      const visitedUnion = new Set(visited);
      for (let outputPort = 0; outputPort < outputCount; outputPort++) {
        const portVisited = new Set(visited);
        const result = swiftStatements(
          block.id, outputPort, flow, screens, variableTypes, project, dynamic, imageAssets, portVisited,
        );
        chains.push(result.code);
        for (const id of result.visited) visitedUnion.add(id);
      }
      visited = visitedUnion;
      lines.push(swiftBranch(block, chains, screens, variableTypes, project));
      break;
    }

    const statement = swiftStatement(block, screens, variableTypes, dynamic, project, imageAssets);
    if (statement !== undefined) lines.push(statement);
    currentId = block.id;
    currentPort = 0;
  }
  return { code: lines.join('\n'), visited };
}

// MARK: - Branching blocks (If/Else, Switch, every Success/Error block)

export function swiftBranch(
  block: LogicBlock,
  chains: string[],
  screens: DesignNode[],
  variableTypes: VariableTypeMap,
  project: DesignProject,
): string {
  const onSuccess = chains[0] ?? '';
  const onError = chains.length > 1 ? chains[1]! : '';

  switch (block.type) {
    case 'ifCondition':
    case 'compare':
      return ifElse(swiftCondition(block, variableTypes), onSuccess, onError);

    case 'isEmpty':
      return ifElse(`${swiftValueExpr(block, 'value', variableTypes)}.isEmpty`, onSuccess, onError);

    case 'contains': {
      const haystack = swiftValueExpr(block, 'value', variableTypes);
      const needle = swiftStringParam(block, 'substring', variableTypes);
      return ifElse(`${haystack}.contains(${needle})`, onSuccess, onError);
    }

    case 'logicalAnd':
      return ifElse(
        `(${swiftBoolExpr(block, 'a', variableTypes)} && ${swiftBoolExpr(block, 'b', variableTypes)})`,
        onSuccess,
        onError,
      );

    case 'logicalOr':
      return ifElse(
        `(${swiftBoolExpr(block, 'a', variableTypes)} || ${swiftBoolExpr(block, 'b', variableTypes)})`,
        onSuccess,
        onError,
      );

    case 'logicalNot':
      return ifElse(`!(${swiftBoolExpr(block, 'value', variableTypes)})`, onSuccess, onError);

    case 'platformCondition': {
      const platform = paramValue(block, 'platform') ?? 'iPhone';
      return ifElse(`GeneratedPlatform.matches(${swiftString(platform)})`, onSuccess, onError);
    }

    case 'switchCase': {
      const value = swiftValueExpr(block, 'value', variableTypes);
      const cases = swiftSplit(paramValue(block, 'cases') ?? '', ',').map(trimWhitespaces);
      const case1 = cases.length > 0 ? swiftString(cases[0]!) : undefined;
      const case2 = cases.length > 1 ? swiftString(cases[1]!) : undefined;
      const defaultChain = chains.length > 2 ? chains[2]! : '';
      const switchLines = [`switch ${value} {`];
      if (case1 !== undefined) switchLines.push(`case ${case1}:\n${indent(onSuccess.length === 0 ? 'break' : onSuccess, 4)}`);
      if (case2 !== undefined) switchLines.push(`case ${case2}:\n${indent(onError.length === 0 ? 'break' : onError, 4)}`);
      switchLines.push(`default:\n${indent(defaultChain.length === 0 ? 'break' : defaultChain, 4)}`);
      switchLines.push('}');
      return switchLines.join('\n');
    }

    default:
      return asyncBranch(block, onSuccess, onError, screens, variableTypes, project);
  }
}

export function ifElse(condition: string, thenBody: string, elseBody: string): string {
  return `if ${condition} {
${indent(thenBody.length === 0 ? '// no-op' : thenBody, 4)}
} else {
${indent(elseBody.length === 0 ? '// no-op' : elseBody, 4)}
}`;
}

export function swiftBoolExpr(block: LogicBlock, key: string, variableTypes: VariableTypeMap): string {
  return `(${swiftValueExpr(block, key, variableTypes)} == "true")`;
}

export function asyncBranch(
  block: LogicBlock,
  onSuccess: string,
  onError: string,
  screens: DesignNode[],
  variableTypes: VariableTypeMap,
  project: DesignProject,
): string {
  const suffix = swiftPrefix(uuidString(block.id).replaceAll('-', ''), 8);
  const flag = `opSuccess_${suffix}`;
  const setup = asyncSetup(block, flag, screens, variableTypes, project);
  return `${setup}
if ${flag} {
${indent(onSuccess.length === 0 ? '// no-op' : onSuccess, 4)}
} else {
${indent(onError.length === 0 ? '// no-op' : onError, 4)}
}`;
}

// setText/clearField need to write wherever the node's value actually comes
// from at render time.
export function writableTextTarget(
  nodeId: string,
  screens: DesignNode[],
  dynamic: DynamicMap,
  variableTypes: VariableTypeMap = new Map(),
): string | undefined {
  const node = findNode(nodeId, screens);
  const binding = node?.logicBindings?.find((b) => b.kind === 'value' || b.kind === 'text');
  if (node !== undefined && binding !== undefined) {
    switch (variableTypes.get(binding.variableName) ?? 'string') {
      case 'string':
      case 'json':
      case 'optional':
        return `state.${swiftIdentifier(binding.variableName, 'value')}`;
      default:
        break;
    }
  }
  if (dynamic.get(nodeId)?.has('text') !== true) return undefined;
  return `state.${dynamicVarName(nodeId, 'text')}`;
}

export function swiftStatement(
  block: LogicBlock,
  screens: DesignNode[],
  variableTypes: VariableTypeMap,
  dynamic: DynamicMap = new Map(),
  _project: DesignProject | undefined = undefined,
  imageAssets: Map<string, string> = new Map(),
): string | undefined {
  switch (block.type) {
    case 'navigate': {
      const id = nodeReference(block, 'screen');
      const screen = id === undefined ? undefined : screens.find((s) => s.id === id);
      return screen === undefined ? undefined : `state.navigate(to: ${swiftString(screenKey(screen))})`;
    }
    case 'presentSheet': {
      const id = nodeReference(block, 'screen');
      const screen = id === undefined ? undefined : screens.find((s) => s.id === id);
      return screen === undefined ? undefined : `state.presentedSheet = ${swiftString(screenKey(screen))}`;
    }
    case 'dismissSheet':
      return 'state.presentedSheet = nil';
    case 'presentBottomSheet': {
      const id = nodeReference(block, 'screen');
      const screen = id === undefined ? undefined : screens.find((s) => s.id === id);
      return screen === undefined ? undefined : `state.presentedBottomSheet = ${swiftString(screenKey(screen))}`;
    }
    case 'dismissBottomSheet':
      return 'state.presentedBottomSheet = nil';
    case 'goBack':
      return 'state.goBack()';
    case 'showAlert':
      return `state.alertTitle = ${swiftStringParam(block, 'title', variableTypes)}\nstate.alertMessage = ${swiftStringParam(block, 'message', variableTypes)}`;
    case 'showToast':
      return `state.toastMessage = ${swiftStringParam(block, 'message', variableTypes)}`;
    case 'setVariable': {
      const variable = variableReference(block, 'variable');
      if (variable === undefined) return undefined;
      return `state.${swiftIdentifier(variable, 'value')} = ${swiftLiteral(paramValue(block, 'value') ?? '', variableTypes.get(variable) ?? 'string', variableTypes)}`;
    }
    case 'toggleVariable': {
      const variable = variableReference(block, 'variable');
      if (variable === undefined) return undefined;
      return `state.${swiftIdentifier(variable, 'value')}.toggle()`;
    }
    case 'incrementVariable':
    case 'decrementVariable': {
      const variable = variableReference(block, 'variable');
      if (variable === undefined) return undefined;
      const amount = paramValue(block, 'amount') ?? '1';
      return `state.${swiftIdentifier(variable, 'value')} ${block.type === 'incrementVariable' ? '+=' : '-='} ${amount}`;
    }
    case 'appendToArray': {
      const array = variableReference(block, 'array');
      if (array === undefined) return undefined;
      const item = swiftStringParam(block, 'value', variableTypes);
      return `state.${swiftIdentifier(array, 'value')}.append(${item})`;
    }
    case 'removeFromArray': {
      const array = variableReference(block, 'array');
      if (array === undefined) return undefined;
      const item = swiftStringParam(block, 'value', variableTypes);
      return `state.${swiftIdentifier(array, 'value')}.removeAll { $0 == ${item} }`;
    }
    case 'getVariable':
      return undefined; // read-only; nothing to execute
    case 'appendJsonItem': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const item = swiftStringParam(block, 'item', variableTypes);
      return `state.${swiftIdentifier(storeIn, 'value')} = GeneratedJSONList.appending(state.${swiftIdentifier(storeIn, 'value')}, item: ${item})`;
    }
    case 'replaceInVariable': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const find = swiftStringParam(block, 'find', variableTypes);
      const repl = swiftStringParam(block, 'replaceWith', variableTypes);
      return `state.${swiftIdentifier(storeIn, 'value')} = state.${swiftIdentifier(storeIn, 'value')}.replacingOccurrences(of: ${find}, with: ${repl})`;
    }
    case 'loadValue': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const key = swiftStringParam(block, 'key', variableTypes);
      const fallback = swiftStringParam(block, 'default', variableTypes);
      const keyValue = paramValue(block, 'key');
      const sensitive = keyValue === undefined ? false : looksSensitive(keyValue);
      const raw = sensitive
        ? `(GeneratedKeychain.get(forKey: ${key}) ?? ${fallback})`
        : `(UserDefaults.standard.string(forKey: ${key}) ?? ${fallback})`;
      const target = `state.${swiftIdentifier(storeIn, 'value')}`;
      if (variableTypes.get(storeIn) === 'number') return `${target} = Double(${raw}) ?? 0`;
      if (variableTypes.get(storeIn) === 'boolean') return `${target} = (${raw} == "true")`;
      return `${target} = ${raw}`;
    }
    case 'getCurrentTime': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      return `{ let __c = Calendar.current.dateComponents([.hour, .minute], from: Date()); state.${swiftIdentifier(storeIn, 'value')} = "\\(__c.hour ?? 0):" + String(format: "%02d", __c.minute ?? 0) }()`;
    }
    case 'randomNumber': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const lo = swiftNumberParam(block, 'min', '1', variableTypes);
      const hi = swiftNumberParam(block, 'max', '10', variableTypes);
      const rollExpr = `Int.random(in: Int(min(${lo}, ${hi}))...Int(max(${lo}, ${hi})))`;
      const targetIsNumber = variableTypes.get(storeIn) === 'number';
      return `state.${swiftIdentifier(storeIn, 'value')} = ${targetIsNumber ? `Double(${rollExpr})` : `String(${rollExpr})`}`;
    }
    case 'mathOperation': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const left = swiftNumberParam(block, 'left', '0', variableTypes);
      const right = swiftNumberParam(block, 'right', '0', variableTypes);
      const op = paramValue(block, 'operator') ?? '+';
      let swiftOp: string;
      switch (op) {
        case '-': swiftOp = '-'; break;
        case '×': swiftOp = '*'; break;
        case '÷': swiftOp = '/'; break;
        case '%': swiftOp = 'truncatingRemainder(dividingBy:)'; break;
        default: swiftOp = '+';
      }
      const expr = op === '%' ? `(${left}).truncatingRemainder(dividingBy: ${right})` : `(${left}) ${swiftOp} (${right})`;
      const targetIsNumber = variableTypes.get(storeIn) === 'number';
      return `state.${swiftIdentifier(storeIn, 'value')} = ${targetIsNumber ? expr : `String(${expr})`}`;
    }
    case 'stringOperation': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const input = swiftStringParam(block, 'input', variableTypes);
      const argument = swiftStringParam(block, 'argument', variableTypes);
      const op = paramValue(block, 'operation') ?? 'concat';
      let expr: string;
      switch (op) {
        case 'uppercase': expr = `(${input}).uppercased()`; break;
        case 'lowercase': expr = `(${input}).lowercased()`; break;
        case 'trim': expr = `(${input}).trimmingCharacters(in: .whitespacesAndNewlines)`; break;
        case 'replace': expr = `(${input}).replacingOccurrences(of: ${argument}, with: "")`; break;
        case 'substring': expr = `String((${input}).prefix(Int(${argument}) ?? (${input}).count))`; break;
        default: expr = `(${input}) + (${argument})`;
      }
      return `state.${swiftIdentifier(storeIn, 'value')} = ${expr}`;
    }
    case 'arrayOperation': {
      const array = variableReference(block, 'array');
      if (array === undefined) return undefined;
      const name = `state.${swiftIdentifier(array, 'value')}`;
      const argument = swiftStringParam(block, 'argument', variableTypes);
      switch (paramValue(block, 'operation') ?? 'push') {
        case 'pop': return `if !${name}.isEmpty { ${name}.removeLast() }`;
        case 'filter': return `${name} = ${name}.filter { $0.contains(${argument}) }`;
        default: return `${name}.append(${argument})`;
      }
    }
    case 'jsonBuild': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const fields = keyValueLiteral(block, 'fields', variableTypes);
      return `state.${swiftIdentifier(storeIn, 'value')} = GeneratedJSON.encode(${fields})`;
    }
    case 'formatDate': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const input = swiftStringParam(block, 'input', variableTypes);
      const format = swiftStringParam(block, 'format', variableTypes);
      return `state.${swiftIdentifier(storeIn, 'value')} = GeneratedDateFormat.format(${input}, pattern: ${format})`;
    }
    case 'generateId': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      return `state.${swiftIdentifier(storeIn, 'value')} = UUID().uuidString`;
    }
    case 'hapticFeedback':
      return 'GeneratedHaptics.play()';
    case 'log':
      return `print(${swiftStringParam(block, 'message', variableTypes)})`;
    case 'openURL':
      return openExternal(swiftStringParam(block, 'url', variableTypes));
    case 'copyToClipboard':
      return `GeneratedClipboard.copy(${swiftStringParam(block, 'text', variableTypes)})`;
    case 'delay':
      return `try? await Task.sleep(nanoseconds: UInt64((${swiftNumberParam(block, 'seconds', '1', variableTypes)}) * 1_000_000_000))`;
    case 'startTimer': {
      const name = swiftStringParam(block, 'name', variableTypes);
      const seconds = swiftNumberParam(block, 'seconds', '1', variableTypes);
      return `let __timerState = state
state.scheduleGeneratedTimer(id: "named:" + ${name}, seconds: ${seconds}, repeats: true) { [weak __timerState] in
    guard let __timerState else { return }
    await GeneratedActions(state: __timerState).runCustomEvent(named: ${name})
}`;
    }
    case 'stopTimer': {
      const name = swiftStringParam(block, 'name', variableTypes);
      return `state.cancelGeneratedTimer(id: "named:" + ${name})`;
    }
    case 'saveValue': {
      const key = swiftStringParam(block, 'key', variableTypes);
      const value = swiftStringParam(block, 'value', variableTypes);
      const literalKey = paramValue(block, 'key');
      if (literalKey !== undefined && looksSensitive(literalKey)) {
        return `GeneratedKeychain.set(${value}, forKey: ${key})`;
      }
      return `UserDefaults.standard.set(${value}, forKey: ${key})`;
    }
    case 'customAction':
      return `// Custom action hook: ${swiftEscaped(paramValue(block, 'name') ?? 'customAction')}`;
    case 'shareContent': {
      const text = swiftStringParam(block, 'text', variableTypes);
      const url = swiftStringParam(block, 'url', variableTypes);
      return `GeneratedShare.present(text: ${text}, urlString: ${url})`;
    }
    case 'sendEmail': {
      const to = swiftStringParam(block, 'to', variableTypes);
      const subject = swiftStringParam(block, 'subject', variableTypes);
      const body = swiftStringParam(block, 'body', variableTypes);
      return `GeneratedShare.sendEmail(to: ${to}, subject: ${subject}, body: ${body})`;
    }
    case 'callNumber':
      return openExternal(`"tel:\\(${swiftStringParam(block, 'number', variableTypes)})"`);
    case 'sendSMS': {
      const number = swiftStringParam(block, 'number', variableTypes);
      const body = swiftStringParam(block, 'body', variableTypes);
      return `GeneratedShare.sendSMS(number: ${number}, body: ${body})`;
    }
    case 'launchMaps':
      return `GeneratedShare.launchMaps(query: ${swiftStringParam(block, 'query', variableTypes)})`;
    case 'scheduleLocalNotification': {
      const title = swiftStringParam(block, 'title', variableTypes);
      const body = swiftStringParam(block, 'body', variableTypes);
      const seconds = swiftNumberParam(block, 'seconds', '5', variableTypes);
      return `GeneratedNotifications.schedule(title: ${title}, body: ${body}, seconds: ${seconds})`;
    }
    case 'scheduleNotificationAt': {
      const title = swiftStringParam(block, 'title', variableTypes);
      const body = swiftStringParam(block, 'body', variableTypes);
      const hour = swiftStringParam(block, 'hour', variableTypes);
      const minute = swiftStringParam(block, 'minute', variableTypes);
      return `GeneratedNotifications.scheduleAt(title: ${title}, body: ${body}, hour: ${hour}, minute: ${minute})`;
    }
    case 'setBadgeCount':
      return `GeneratedNotifications.setBadge(${parseSwiftInt(paramValue(block, 'count') ?? '0') ?? 0})`;
    case 'gameSpawn': {
      const t = swiftStringParam(block, 'template', variableTypes);
      const gx = swiftNumberParam(block, 'x', '100', variableTypes);
      const gy = swiftNumberParam(block, 'y', '100', variableTypes);
      return `GameSceneRegistry.broadcast(.spawn(template: ${t}, x: CGFloat(${gx}), y: CGFloat(${gy})))`;
    }
    case 'gameRemove':
      return `GameSceneRegistry.broadcast(.remove(target: ${swiftStringParam(block, 'target', variableTypes)}))`;
    case 'gameImpulse': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const dx = swiftNumberParam(block, 'dx', '0', variableTypes);
      const dy = swiftNumberParam(block, 'dy', '0', variableTypes);
      return `GameSceneRegistry.broadcast(.impulse(entity: ${ent}, dx: CGFloat(${dx}), dy: CGFloat(${dy})))`;
    }
    case 'gameMove': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const mx = swiftNumberParam(block, 'x', '0', variableTypes);
      const my = swiftNumberParam(block, 'y', '0', variableTypes);
      return `GameSceneRegistry.broadcast(.move(entity: ${ent}, x: CGFloat(${mx}), y: CGFloat(${my})))`;
    }
    case 'gameSetGravity': {
      const gvx = swiftNumberParam(block, 'gravityX', '0', variableTypes);
      const gvy = swiftNumberParam(block, 'gravity', '-18', variableTypes);
      return `GameSceneRegistry.broadcast(.setGravityVector(dx: CGFloat(${gvx}), dy: CGFloat(${gvy})))`;
    }
    case 'gameAddScore':
      return `GameSceneRegistry.broadcast(.addScore(Int(${swiftNumberParam(block, 'points', '1', variableTypes)})))`;
    case 'gameEnd':
      return `GameSceneRegistry.broadcast(.end(win: ${(paramValue(block, 'result') ?? 'gameOver') === 'win'}))`;
    case 'gamePause':
      return `GameSceneRegistry.broadcast(.pause(${(paramValue(block, 'mode') ?? 'pause') === 'pause'}))`;
    case 'gameSetVelocity': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const vx = swiftNumberParam(block, 'vx', '0', variableTypes);
      const vy = swiftNumberParam(block, 'vy', '0', variableTypes);
      return `GameSceneRegistry.broadcast(.setVelocity(entity: ${ent}, vx: CGFloat(${vx}), vy: CGFloat(${vy})))`;
    }
    case 'gameSetProperty': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const prop = swiftString(paramValue(block, 'property') ?? 'color');
      const v = swiftStringParam(block, 'value', variableTypes);
      return `GameSceneRegistry.broadcast(.setProperty(entity: ${ent}, property: ${prop}, value: ${v}))`;
    }
    case 'gameAnimate': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const ax = swiftNumberParam(block, 'x', '100', variableTypes);
      const ay = swiftNumberParam(block, 'y', '100', variableTypes);
      const dur = swiftNumberParam(block, 'duration', '0.6', variableTypes);
      return `GameSceneRegistry.broadcast(.animate(entity: ${ent}, x: CGFloat(${ax}), y: CGFloat(${ay}), duration: CGFloat(${dur})))`;
    }
    case 'gameAddBehavior': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const bjson = swiftStringParam(block, 'behavior', variableTypes);
      return `GameSceneRegistry.broadcast(.addBehavior(entity: ${ent}, behaviorJSON: ${bjson}))`;
    }
    case 'gameRemoveBehavior': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const btype = swiftStringParam(block, 'behaviorType', variableTypes);
      return `GameSceneRegistry.broadcast(.removeBehavior(entity: ${ent}, type: ${btype}))`;
    }
    case 'gameSetHealth': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      return `GameSceneRegistry.broadcast(.setHealth(entity: ${ent}, health: Int(${swiftNumberParam(block, 'health', '3', variableTypes)})))`;
    }
    case 'gameShake':
      return `GameSceneRegistry.broadcast(.shake(CGFloat(${swiftNumberParam(block, 'intensity', '10', variableTypes)})))`;
    case 'gameParticles': {
      const kind = swiftString(paramValue(block, 'kind') ?? 'confetti');
      const px = swiftNumberParam(block, 'x', '195', variableTypes);
      const py = swiftNumberParam(block, 'y', '300', variableTypes);
      const burst = swiftNumberParam(block, 'burst', '40', variableTypes);
      return `GameSceneRegistry.broadcast(.particles(kind: ${kind}, x: CGFloat(${px}), y: CGFloat(${py}), burst: Int(${burst})))`;
    }
    case 'gameSetTimeScale':
      return `GameSceneRegistry.broadcast(.setTimeScale(CGFloat(${swiftNumberParam(block, 'scale', '1', variableTypes)})))`;
    case 'gameSetSpawnRate':
      return `GameSceneRegistry.broadcast(.setSpawnInterval(CGFloat(${swiftNumberParam(block, 'interval', '1', variableTypes)})))`;
    case 'gameSetLives':
      return `GameSceneRegistry.broadcast(.setLives(Int(${swiftNumberParam(block, 'lives', '3', variableTypes)})))`;
    case 'gameRestart':
      return 'GameSceneRegistry.broadcast(.restart)';
    case 'gameMotor': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const thr = swiftNumberParam(block, 'throttle', '1', variableTypes);
      return `GameSceneRegistry.broadcast(.motor(entity: ${ent}, throttle: CGFloat(${thr})))`;
    }
    case 'gameTorque': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const amt = swiftNumberParam(block, 'amount', '40', variableTypes);
      return `GameSceneRegistry.broadcast(.torque(entity: ${ent}, amount: CGFloat(${amt})))`;
    }
    case 'gameLoadSlingshot':
      return `GameSceneRegistry.broadcast(.loadSlingshot(entity: ${swiftStringParam(block, 'entity', variableTypes)}))`;
    case 'gameDamage': {
      const dent = swiftStringParam(block, 'entity', variableTypes);
      return `GameSceneRegistry.broadcast(.damageEntity(entity: ${dent}, amount: Int(${swiftNumberParam(block, 'amount', '1', variableTypes)})))`;
    }
    case 'gameLaunch': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const ang = swiftNumberParam(block, 'angle', '60', variableTypes);
      const str = swiftNumberParam(block, 'strength', '40', variableTypes);
      return `GameSceneRegistry.broadcast(.launch(entity: ${ent}, angle: CGFloat(${ang}), strength: CGFloat(${str})))`;
    }
    case 'gameSetPhysics': {
      const ent = swiftStringParam(block, 'entity', variableTypes);
      const prop = swiftString(paramValue(block, 'property') ?? 'bounciness');
      const v = swiftStringParam(block, 'value', variableTypes);
      return `GameSceneRegistry.broadcast(.setPhysics(entity: ${ent}, property: ${prop}, value: ${v}))`;
    }
    case 'gameQuery': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      const what = swiftString(paramValue(block, 'what') ?? 'score');
      const target = swiftStringParam(block, 'target', variableTypes);
      const dest = `state.${swiftIdentifier(storeIn, 'value')}`;
      if (variableTypes.get(storeIn) === 'number') {
        return `${dest} = Double(GameSceneRegistry.query(${what}, ${target})) ?? 0`;
      }
      return `${dest} = GameSceneRegistry.query(${what}, ${target})`;
    }
    case 'ringAlarm': {
      const ringStyle = swiftStringParam(block, 'style', variableTypes);
      const autoStop = swiftNumberParam(block, 'duration', '0', variableTypes);
      return `GeneratedSound.startRinging(${ringStyle}, autoStop: ${autoStop})`;
    }
    case 'playSound':
      return `GeneratedSound.play(${swiftStringParam(block, 'file', variableTypes)})`;
    case 'stopSound':
      return 'GeneratedSound.stop()';
    case 'clearField': {
      const nodeId = nodeReference(block, 'element');
      if (nodeId === undefined) return undefined;
      const target = writableTextTarget(nodeId, screens, dynamic, variableTypes);
      if (target === undefined) return undefined;
      return `${target} = ""`;
    }
    case 'executeCustomCode':
      return paramValue(block, 'code') ?? '// (empty custom code block)';
    case 'setDarkModeOverride':
      switch (paramValue(block, 'mode') ?? 'system') {
        case 'light': return 'state.colorSchemeOverride = .light';
        case 'dark': return 'state.colorSchemeOverride = .dark';
        default: return 'state.colorSchemeOverride = nil';
      }
    case 'presentDatePicker': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      return `state.${swiftIdentifier(storeIn, 'value')} = ISO8601DateFormatter().string(from: Date()) // TODO: present a real DatePicker sheet bound to this variable`;
    }
    case 'presentColorPicker': {
      const storeIn = variableReference(block, 'variable');
      if (storeIn === undefined) return undefined;
      return `// TODO: present a real ColorPicker sheet that writes a hex string into state.${swiftIdentifier(storeIn, 'value')}`;
    }
    // UI updates — write to the per-node dynamic state nodeViews() reads from.
    case 'setText': {
      const nodeId = nodeReference(block, 'element');
      if (nodeId === undefined) return undefined;
      const target = writableTextTarget(nodeId, screens, dynamic, variableTypes);
      if (target === undefined) return undefined;
      return `${target} = ${swiftStringParam(block, 'text', variableTypes)}`;
    }
    case 'setColor': {
      const nodeId = nodeReference(block, 'element');
      if (nodeId === undefined) return undefined;
      const property: DynamicNodeProperty = (paramValue(block, 'property') ?? 'fill') === 'textColor' ? 'textColor' : 'fill';
      if (dynamic.get(nodeId)?.has(property) !== true) return undefined;
      return `state.${dynamicVarName(nodeId, property)} = ${swiftStringParam(block, 'color', variableTypes)}`;
    }
    case 'setVisible': {
      const nodeId = nodeReference(block, 'element');
      if (nodeId === undefined || dynamic.get(nodeId)?.has('opacityChannel') !== true) return undefined;
      const visible = paramValue(block, 'visible') !== 'false';
      return `withAnimation(.easeInOut(duration: 0.2)) { state.${dynamicVarName(nodeId, 'opacityChannel')} = ${visible ? '1' : '0.08'} }`;
    }
    case 'setEnabled': {
      const nodeId = nodeReference(block, 'element');
      if (nodeId === undefined || dynamic.get(nodeId)?.has('opacityChannel') !== true) return undefined;
      const enabled = paramValue(block, 'enabled') !== 'false';
      return `state.${dynamicVarName(nodeId, 'opacityChannel')} = ${enabled ? '1' : '0.45'}`;
    }
    case 'setLoading': {
      const nodeId = nodeReference(block, 'element');
      if (nodeId === undefined || dynamic.get(nodeId)?.has('opacityChannel') !== true) return undefined;
      const loading = paramValue(block, 'loading') !== 'false';
      return `state.${dynamicVarName(nodeId, 'opacityChannel')} = ${loading ? '0.55' : '1'}`;
    }
    case 'setImage': {
      const nodeId = nodeReference(block, 'element');
      if (nodeId === undefined || dynamic.get(nodeId)?.has('image') !== true) return undefined;
      const rawSource = paramValue(block, 'source') ?? '';
      const mapped = imageAssets.get(rawSource);
      const resolvedSource = mapped !== undefined ? swiftString(mapped) : swiftStringParam(block, 'source', variableTypes);
      return `state.${dynamicVarName(nodeId, 'image')} = ${resolvedSource}`;
    }
    case 'scrollTo':
      return `// Scroll To: '${paramValue(block, 'axis') ?? 'vertical'}' scrolling needs a real ScrollView container around this element`;
    case 'animate':
      return animateStatement(block, variableTypes, dynamic);
    case 'bindProperty':
      return undefined; // logicBindings already wires this node's live rendering
    case 'setNavigationSelection': {
      const variable = variableReference(block, 'variable');
      if (variable === undefined) return undefined;
      return `state.${swiftIdentifier(variable, 'value')} = ${swiftStringParam(block, 'value', variableTypes)}`;
    }
    case 'logAnalyticsEvent': {
      const name = swiftStringParam(block, 'name', variableTypes);
      const params = keyValueLiteral(block, 'parameters', variableTypes);
      return `#if canImport(FirebaseAnalytics)
Analytics.logEvent(${name}, parameters: ${params})
#else
print("Analytics event (add FirebaseAnalytics to enable): \\(${name})")
#endif`;
    }
    default:
      return undefined;
  }
}

// opacity/scale/cornerRadius/x/y/width/height animation — mirrors the in-app
// simulator's semantics exactly.
export function animateStatement(
  block: LogicBlock,
  variableTypes: VariableTypeMap,
  dynamic: DynamicMap,
): string | undefined {
  const nodeId = nodeReference(block, 'element');
  if (nodeId === undefined) return undefined;
  const props = dynamic.get(nodeId);
  if (props === undefined) return undefined;
  const duration = swiftNumberParam(block, 'duration', '0.3', variableTypes);
  const to = swiftNumberParam(block, 'to', '0', variableTypes);
  const animation = `withAnimation(.interactiveSpring(response: ${duration}, dampingFraction: 0.82))`;

  const property = paramValue(block, 'property') ?? 'opacity';
  if (property === 'opacity' && props.has('opacityChannel')) {
    return `${animation} { state.${dynamicVarName(nodeId, 'opacityChannel')} = min(max(${to}, 0), 1) }`;
  }
  if (property === 'scale' && (['x', 'y', 'width', 'height'] as DynamicNodeProperty[]).every((p) => props.has(p))) {
    const xVar = dynamicVarName(nodeId, 'x');
    const yVar = dynamicVarName(nodeId, 'y');
    const wVar = dynamicVarName(nodeId, 'width');
    const hVar = dynamicVarName(nodeId, 'height');
    return `${animation} {
    let scale = max(${to}, 0.05)
    let centerX = state.${xVar} + state.${wVar} / 2
    let centerY = state.${yVar} + state.${hVar} / 2
    state.${wVar} = max(1, state.${wVar} * scale)
    state.${hVar} = max(1, state.${hVar} * scale)
    state.${xVar} = centerX - state.${wVar} / 2
    state.${yVar} = centerY - state.${hVar} / 2
}`;
  }
  if (property === 'x' && props.has('x')) return `${animation} { state.${dynamicVarName(nodeId, 'x')} = ${to} }`;
  if (property === 'y' && props.has('y')) return `${animation} { state.${dynamicVarName(nodeId, 'y')} = ${to} }`;
  if (property === 'width' && props.has('width')) return `${animation} { state.${dynamicVarName(nodeId, 'width')} = max(1, ${to}) }`;
  if (property === 'height' && props.has('height')) return `${animation} { state.${dynamicVarName(nodeId, 'height')} = max(1, ${to}) }`;
  return undefined;
}

export function openExternal(urlExpr: string): string {
  return `#if os(iOS)
if let url = URL(string: ${urlExpr}) { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
#elseif canImport(AppKit)
if let url = URL(string: ${urlExpr}) { NSWorkspace.shared.open(url) }
#endif`;
}

export { permissionSetup };
export { swiftInterpolatedString };
