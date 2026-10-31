// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — the emitters
// that combine computed fragments with the extracted Swift templates:
// App.swift, AppState.swift, GeneratedActions.swift, GeneratedSupport.swift,
// RootView.swift, each screen view and the watch target's views.

import { swiftDouble } from '../../agent/DesignAction';
import { BlockCatalog } from '../../models/BlockDefinitions';
import type { DesignNode } from '../../models/DesignNode';
import type { DesignProject } from '../../models/DesignProject';
import { nodeEffectiveGameSpec } from '../../helpers/GameSceneComposer';
import type { LogicBlock, LogicBlockType, LogicFlow, LogicVariable } from '../../models/LogicModels';
import {
  actionFunctionName,
  binding as nodeBinding,
  boundText,
  dynamicVarName,
  gameSceneResourceName,
  imageExpression,
  indent,
  isSecureInput,
  looksSensitive,
  screenKey,
  swiftDefault,
  swiftEscaped,
  swiftIdentifier,
  swiftString,
  swiftType,
} from './helpers';
import { eventCalls, swiftStatements } from './statements';
import {
  swiftCount,
  swiftDoubleString,
  swiftPrefix,
  swiftStringCompare,
  uuidString,
} from './swiftRuntime';
import {
  actionFunctionTemplate,
  actionsSourceTemplate,
  appSourceTemplate,
  appStateSourceTemplate,
  crownModifierTemplate,
  crownOnChangeTemplate,
  customEventDispatcherTemplate,
  gameScreenSourceTemplate,
  generatedImageSourceTemplate,
  rootViewSourceTemplate,
  screenSourceTemplate,
  scrollingContentBlockTemplate,
  staticContentBlockTemplate,
  supportSourceTemplate,
  watchRootSourceTemplate,
  watchScreenSourceTemplate,
  xcodeAppEntryTemplate,
} from './templates';
import type { DynamicMap, DynamicNodeProperty, VariableTypeMap } from './types';
import { nodeViews, shapeStyleExpression } from './views';

const int = (value: number): string => String(Math.trunc(value));

/// A per-target @main entry (Xcode export).
export function xcodeAppEntry(
  appName: string,
  rootView: string,
  structName: string,
  withPushDelegate: boolean = false,
  firebaseConfigure: boolean = false,
): string {
  void appName;
  const pushLine = withPushDelegate
    ? '\n    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate'
    : '';
  const firebaseImport = firebaseConfigure
    ? '\n        #if canImport(FirebaseCore)\n        import FirebaseCore\n        #endif'
    : '';
  const firebaseInit = firebaseConfigure
    ? `\n    init() {
        #if canImport(FirebaseCore)
        FirebaseApp.configure()
        #endif
    }`
    : '';
  return xcodeAppEntryTemplate({ firebaseImport, structName, pushLine, firebaseInit, rootView });
}

export function appSource(appName: string, hasWatch: boolean, usesPush: boolean = false): string {
  const content = hasWatch
    ? `        #if os(watchOS)
        WatchRootView()
            .environmentObject(state)
            .task { await state.restoreOnLaunch() }
        #else
        RootView()
            .environmentObject(state)
            .task { await state.restoreOnLaunch() }
        #endif`
    : `        RootView()
            .environmentObject(state)
            .task { await state.restoreOnLaunch() }`;
  // The APNs delegate adaptor is iOS-only (watchOS has no UIApplication).
  const pushAdaptor = usesPush
    ? `
    #if os(iOS)
    @UIApplicationDelegateAdaptor(PushAppDelegate.self) private var pushDelegate
    #endif`
    : '';
  return appSourceTemplate({ appName, pushAdaptor, content });
}

/// Properties AppState always declares itself.
export const appStateReservedProperties: ReadonlySet<string> = new Set([
  'currentScreen', 'navigationPath', 'presentedSheet', 'presentedBottomSheet',
  'alertTitle', 'alertMessage', 'toastMessage', 'colorSchemeOverride',
  'currentUserEmail', 'currentUserId', 'pendingConfirmation',
]);

// Emits one @Published line per (node, property) pair, seeded with the node's
// current designed value so the initial render is unchanged.
export function dynamicStateLines(screens: DesignNode[], dynamic: DynamicMap): string {
  if (dynamic.size === 0) return '';
  const nodesById = new Map<string, DesignNode>();
  const index = (node: DesignNode): void => {
    nodesById.set(node.id, node);
    node.children.forEach(index);
  };
  screens.forEach(index);

  const lines: string[] = [];
  const entries = [...dynamic.entries()].sort((a, b) => swiftStringCompare(uuidString(a[0]), uuidString(b[0])));
  for (const [nodeId, properties] of entries) {
    const node = nodesById.get(nodeId);
    if (node === undefined) continue;
    const sorted = [...properties].sort(swiftStringCompare);
    for (const property of sorted) {
      const name = dynamicVarName(nodeId, property);
      switch (property) {
        case 'text':
          lines.push(`@Published var ${name}: String = ${swiftString(node.text ?? node.name)}`);
          break;
        case 'fill':
          lines.push(`@Published var ${name}: String = ${swiftString(node.style.fill)}`);
          break;
        case 'textColor':
          lines.push(`@Published var ${name}: String = ${swiftString(node.style.textColor ?? node.style.fill)}`);
          break;
        case 'opacityChannel':
          lines.push(`@Published var ${name}: Double = ${swiftDoubleString(node.style.opacity)}`);
          break;
        case 'image':
          lines.push(`@Published var ${name}: String = ${swiftString(node.imageSource ?? node.imageName ?? '')}`);
          break;
        case 'x':
          lines.push(`@Published var ${name}: Double = ${swiftDoubleString(node.x)}`);
          break;
        case 'y':
          lines.push(`@Published var ${name}: Double = ${swiftDoubleString(node.y)}`);
          break;
        case 'width':
          lines.push(`@Published var ${name}: Double = ${swiftDoubleString(node.width)}`);
          break;
        case 'height':
          lines.push(`@Published var ${name}: Double = ${swiftDoubleString(node.height)}`);
          break;
      }
    }
  }
  return lines.join('\n    ');
}

// Item aliases of every repeat-list template anywhere in the design.
export function repeatAliases(screens: DesignNode[]): string[] {
  const aliases = new Set<string>();
  const walk = (node: DesignNode): void => {
    if (node.repeatBinding !== undefined) {
      aliases.add(swiftIdentifier(node.repeatBinding.itemAlias, 'item'));
    }
    node.children.forEach(walk);
  };
  screens.forEach(walk);
  return [...aliases].sort(swiftStringCompare);
}

export function appStateSource(
  variables: LogicVariable[],
  firstScreen: DesignNode | undefined,
  screens: DesignNode[],
  dynamic: DynamicMap,
): string {
  const first = swiftString(
    firstScreen !== undefined ? swiftIdentifier(firstScreen.name, 'Screen') : 'Home',
  );
  const variableLines = variables
    .filter((v) => !appStateReservedProperties.has(swiftIdentifier(v.name, 'value')))
    .map(
      (variable) =>
        `@Published var ${swiftIdentifier(variable.name, 'value')}: ${swiftType(variable.type)} = ${swiftDefault(variable)}`,
    );
  const declared = new Set<string>([
    ...variables.map((v) => swiftIdentifier(v.name, 'value')),
    ...appStateReservedProperties,
  ]);
  for (const alias of repeatAliases(screens)) {
    if (declared.has(alias)) continue;
    variableLines.push(`@Published var ${alias}: String = "{}"`);
  }
  const variableLinesJoined = variableLines.join('\n    ');
  const dynamicLines = dynamicStateLines(screens, dynamic);

  // Persistence: only scalar variables round-trip through StateStore, and
  // sensitive variables are treated as ephemeral.
  const persistable = variables.filter(
    (v) => (['string', 'number', 'boolean'] as string[]).includes(v.type) && !looksSensitive(v.name),
  );
  const snapshotEntries = persistable
    .map((v) => `            ${swiftString(v.name)}: String(describing: ${swiftIdentifier(v.name, 'value')})`)
    .join(',\n');
  const snapshotLiteral = persistable.length === 0 ? '[:]' : `[\n${snapshotEntries}\n        ]`;
  const applyLines = persistable
    .map((v) => {
      const id = swiftIdentifier(v.name, 'value');
      switch (v.type) {
        case 'number': return `        if let __v = values[${swiftString(v.name)}], let __n = Double(__v) { ${id} = __n }`;
        case 'boolean': return `        if let __v = values[${swiftString(v.name)}] { ${id} = (__v == "true") }`;
        default: return `        if let __v = values[${swiftString(v.name)}] { ${id} = __v }`;
      }
    })
    .join('\n');

  return appStateSourceTemplate({
    first,
    variableLinesJoined,
    dynamicLines,
    snapshotLiteral,
    applyLines: applyLines.length === 0 ? '        // No scalar variables to restore.' : applyLines,
  });
}

export function actionsSource(
  appName: string,
  project: DesignProject,
  flows: LogicFlow[],
  screens: DesignNode[],
  variables: LogicVariable[],
  dynamic: DynamicMap,
  imageAssets: Map<string, string>,
): string {
  void appName;
  const variableTypes: VariableTypeMap = new Map(variables.map((v) => [v.name, v.type]));
  const functions: string[] = [];
  const emittedNames = new Set<string>();
  for (const flow of flows) {
    const events = flow.blocks.filter((b) => BlockCatalog.definition(b.type)?.inputPortCount === 0);
    for (const event of events) {
      const name = actionFunctionName(flow, event);
      // A duplicated flow must not emit the same function twice.
      if (emittedNames.has(name)) continue;
      emittedNames.add(name);
      const visited = new Set<string>([event.id]);
      const body = swiftStatements(
        event.id, 0, flow, screens, variableTypes, project, dynamic, imageAssets, visited,
      ).code;
      functions.push(
        actionFunctionTemplate({
          name,
          body: indent(
            body.length === 0 ? `print("No generated actions for ${swiftEscaped(flow.name)}")` : body,
            8,
          ),
        }),
      );
    }
  }

  // Custom Event flows are reachable by name.
  const customEventCases = new Map<string, string[]>();
  for (const flow of flows) {
    for (const event of flow.blocks) {
      if (event.type !== 'customEvent') continue;
      const eventName = event.parameters.find((p) => p.key === 'name')?.value ?? 'customEvent';
      const list = customEventCases.get(eventName) ?? [];
      list.push(`await ${actionFunctionName(flow, event)}()`);
      customEventCases.set(eventName, list);
    }
  }
  const dispatcherCases = [...customEventCases.entries()]
    .sort((a, b) => swiftStringCompare(a[0], b[0]))
    .map(([name, calls]) => `        case ${swiftString(name)}:\n${calls.map((c) => `            ${c}`).join('\n')}`)
    .join('\n');
  functions.push(
    customEventDispatcherTemplate({
      dispatcherCases: dispatcherCases.length === 0 ? '        case "__none": break' : dispatcherCases,
    }),
  );

  return actionsSourceTemplate({ functions: functions.join('\n\n') });
}

export function rootViewSource(appName: string, screens: DesignNode[], flows: LogicFlow[]): string {
  void appName;
  const cases = screens
    .map(
      (screen) =>
        `case ${swiftString(screenKey(screen))}: ${swiftIdentifier(screen.name, 'Screen')}View(actions: GeneratedActions(state: state))`,
    )
    .join('\n        ');
  const fallback =
    screens.length > 0
      ? `${swiftIdentifier(screens[0]!.name, 'Screen')}View(actions: GeneratedActions(state: state))`
      : 'Text("No screens exported")';
  const launchCalls = eventCalls(['onAppLaunch'], flows, undefined, 'GeneratedActions(state: state)');
  const backgroundCases = screens
    .map(
      (screen) =>
        `case ${swiftString(screenKey(screen))}: return ${swiftString(screen.style.fill.startsWith('#') ? screen.style.fill : '#FFFFFF')}`,
    )
    .join('\n        ');
  const firstFill =
    screens.length > 0 ? (screens[0]!.style.fill.startsWith('#') ? screens[0]!.style.fill : '#FFFFFF') : '#FFFFFF';

  return rootViewSourceTemplate({
    cases,
    fallback,
    launchCalls: indent(launchCalls.length === 0 ? '// no app launch actions' : launchCalls, 12),
    backgroundCases,
    firstFill: swiftString(firstFill),
  });
}

export function screenSource(
  screen: DesignNode,
  flows: LogicFlow[],
  variableTypes: VariableTypeMap,
  imageAssets: Map<string, string>,
  dynamic: DynamicMap,
): string {
  const viewName = swiftIdentifier(screen.name, 'Screen');

  // A screen that IS a game: the whole screen is the SpriteKit surface.
  if (nodeEffectiveGameSpec(screen) !== undefined) {
    const gameFlows = flows.filter((f) => f.screenNodeId === undefined || f.screenNodeId === screen.id);
    const eventLines: string[] = [];
    const calls = (type: LogicBlockType): string =>
      gameFlows
        .map((flow) => {
          const event = flow.blocks.find((b) => b.type === type);
          return event === undefined ? undefined : `await actions.${actionFunctionName(flow, event)}()`;
        })
        .filter((c): c is string => c !== undefined)
        .join('\n                            ');
    const scoreSync =
      variableTypes.get('gameScore') !== undefined
        ? `state.gameScore = ${variableTypes.get('gameScore') === 'number' ? 'Double(score)' : 'String(score)'}`
        : '_ = score';
    eventLines.push(
      `case .scoreChanged(let score):\n                            ${scoreSync}\n                            ${calls('onGameScore').length === 0 ? 'break' : calls('onGameScore')}`,
    );
    eventLines.push(`case .gameOver:\n                            ${calls('onGameOver').length === 0 ? 'break' : calls('onGameOver')}`);
    eventLines.push(`case .won:\n                            ${calls('onGameWin').length === 0 ? 'break' : calls('onGameWin')}`);
    const collisionLines: string[] = [];
    for (const flow of gameFlows) {
      const event = flow.blocks.find((b) => b.type === 'onGameCollision');
      if (event === undefined) continue;
      const fa = event.parameters.find((p) => p.key === 'categoryA')?.value ?? '';
      const fb = event.parameters.find((p) => p.key === 'categoryB')?.value ?? '';
      const conditions: string[] = [];
      if (fa.length > 0) conditions.push(`(a == ${swiftString(fa)} || b == ${swiftString(fa)})`);
      if (fb.length > 0) conditions.push(`(a == ${swiftString(fb)} || b == ${swiftString(fb)})`);
      const condition = conditions.length === 0 ? 'true' : conditions.join(' && ');
      const usesIds = flow.blocks.some((block) =>
        block.parameters.some((parameter) => {
          const reference = parameter.variableReference;
          if (reference === undefined) return false;
          return reference === 'gameCollisionEntityA' || reference === 'gameCollisionEntityB';
        }),
      );
      const assigns: string[] = [];
      if (usesIds) {
        const swapExpr = fa.length === 0 ? 'false' : `(b == ${swiftString(fa)})`;
        assigns.push(`let __cs = ${swapExpr}`);
        if (variableTypes.get('gameCollisionEntityA') !== undefined) assigns.push('state.gameCollisionEntityA = __cs ? idB : idA');
        if (variableTypes.get('gameCollisionEntityB') !== undefined) assigns.push('state.gameCollisionEntityB = __cs ? idA : idB');
      }
      const body = [...assigns, `await actions.${actionFunctionName(flow, event)}()`].join('; ');
      collisionLines.push(`if ${condition} { ${body} }`);
    }
    eventLines.push(
      `case .collision(let a, let b, let idA, let idB):\n                            ${collisionLines.length === 0 ? '_ = a; _ = b; _ = idA; _ = idB' : '_ = idA; _ = idB\n                            ' + collisionLines.join('\n                            ')}`,
    );
    const axisAssign = (name: string, expr: string, integer: string): string | undefined => {
      const type = variableTypes.get(name);
      if (type === undefined) return undefined;
      return `state.${name} = ${type === 'number' ? expr : integer}`;
    };
    let tapParts = [
      axisAssign('gameTapX', 'Double(x)', 'String(Int(x))'),
      axisAssign('gameTapY', 'Double(y)', 'String(Int(y))'),
    ].filter((p): p is string => p !== undefined);
    if (tapParts.length === 0) tapParts = ['_ = x; _ = y'];
    const tapSet = tapParts.join('; ');
    eventLines.push(
      `case .tap(let x, let y):\n                            ${tapSet}\n                            ${calls('onGameTap').length === 0 ? 'break' : calls('onGameTap')}`,
    );
    const dragLines: string[] = [];
    for (const flow of gameFlows) {
      const event = flow.blocks.find((b) => b.type === 'onGameDrag');
      if (event === undefined) continue;
      const wanted = event.parameters.find((p) => p.key === 'phase')?.value ?? 'move';
      const condition = wanted === 'any' ? 'true' : `phase == ${swiftString(wanted)}`;
      dragLines.push(`if ${condition} { await actions.${actionFunctionName(flow, event)}() }`);
    }
    let dragParts = [
      axisAssign('gameDragX', 'Double(x)', 'String(Int(x))'),
      axisAssign('gameDragY', 'Double(y)', 'String(Int(y))'),
    ].filter((p): p is string => p !== undefined);
    if (dragParts.length === 0) dragParts = ['_ = x; _ = y'];
    const dragSet = dragParts.join('; ');
    eventLines.push(
      `case .drag(let phase, let x, let y):\n                            ${dragSet}\n                            ${dragLines.length === 0 ? '_ = phase' : dragLines.join('\n                            ')}`,
    );
    const destroyedLines: string[] = [];
    for (const flow of gameFlows) {
      const event = flow.blocks.find((b) => b.type === 'onGameEntityDestroyed');
      if (event === undefined) continue;
      const wanted = event.parameters.find((p) => p.key === 'category')?.value ?? '';
      const condition = wanted.length === 0 ? 'true' : `category == ${swiftString(wanted)}`;
      destroyedLines.push(`if ${condition} { await actions.${actionFunctionName(flow, event)}() }`);
    }
    eventLines.push(
      `case .entityDestroyed(let category):\n                            ${destroyedLines.length === 0 ? '_ = category' : destroyedLines.join('\n                            ')}`,
    );
    eventLines.push(`case .started:\n                            ${calls('onGameStart').length === 0 ? 'break' : calls('onGameStart')}`);
    const livesSet =
      variableTypes.get('gameLives') !== undefined
        ? `state.gameLives = ${variableTypes.get('gameLives') === 'number' ? 'Double(remaining)' : 'String(remaining)'}`
        : '_ = remaining';
    eventLines.push(
      `case .lifeLost(let remaining):\n                            ${livesSet}\n                            ${calls('onGameLifeLost').length === 0 ? 'break' : calls('onGameLifeLost')}`,
    );
    const spawnedLines: string[] = [];
    for (const flow of gameFlows) {
      const event = flow.blocks.find((b) => b.type === 'onGameSpawned');
      if (event === undefined) continue;
      const wanted = event.parameters.find((p) => p.key === 'category')?.value ?? '';
      const condition = wanted.length === 0 ? 'true' : `category == ${swiftString(wanted)}`;
      spawnedLines.push(`if ${condition} { await actions.${actionFunctionName(flow, event)}() }`);
    }
    eventLines.push(
      `case .spawned(let category):\n                            ${spawnedLines.length === 0 ? '_ = category' : spawnedLines.join('\n                            ')}`,
    );
    const impactLines: string[] = [];
    for (const flow of gameFlows) {
      const event = flow.blocks.find((b) => b.type === 'onGameImpact');
      if (event === undefined) continue;
      const fa = event.parameters.find((p) => p.key === 'categoryA')?.value ?? '';
      const fb = event.parameters.find((p) => p.key === 'categoryB')?.value ?? '';
      const minForce = swiftDouble(event.parameters.find((p) => p.key === 'minForce')?.value ?? '0') ?? 0;
      const conditions: string[] = [];
      if (fa.length > 0) conditions.push(`(a == ${swiftString(fa)} || b == ${swiftString(fa)})`);
      if (fb.length > 0) conditions.push(`(a == ${swiftString(fb)} || b == ${swiftString(fb)})`);
      if (minForce > 0) conditions.push(`force >= ${swiftDoubleString(minForce)}`);
      const condition = conditions.length === 0 ? 'true' : conditions.join(' && ');
      const flowUsesEntityIds = flow.blocks.some((block) =>
        block.parameters.some((parameter) => {
          const reference = parameter.variableReference;
          if (reference === undefined) return false;
          return reference === 'gameImpactEntityA' || reference === 'gameImpactEntityB';
        }),
      );
      const assigns: string[] = [];
      if (
        flowUsesEntityIds &&
        (variableTypes.get('gameImpactEntityA') !== undefined || variableTypes.get('gameImpactEntityB') !== undefined)
      ) {
        const swapExpr = fa.length === 0 ? 'false' : `(b == ${swiftString(fa)})`;
        assigns.push(`let __sw = ${swapExpr}`);
        if (variableTypes.get('gameImpactEntityA') !== undefined) assigns.push('state.gameImpactEntityA = __sw ? idB : idA');
        if (variableTypes.get('gameImpactEntityB') !== undefined) assigns.push('state.gameImpactEntityB = __sw ? idA : idB');
      }
      const body = [...assigns, `await actions.${actionFunctionName(flow, event)}()`].join('; ');
      impactLines.push(`if ${condition} { ${body} }`);
    }
    const forceSet =
      variableTypes.get('gameImpactForce') !== undefined
        ? `state.gameImpactForce = ${variableTypes.get('gameImpactForce') === 'number' ? 'Double(force)' : 'String(Int(force))'}`
        : '';
    eventLines.push(
      `case .impact(let a, let b, let force, let idA, let idB):\n                            ${forceSet.length === 0 ? '' : forceSet + '\n                            '}${impactLines.length === 0 ? '_ = a; _ = b; _ = force; _ = idA; _ = idB' : '_ = idA; _ = idB\n                            ' + impactLines.join('\n                            ')}`,
    );
    const launchedSet = variableTypes.get('gameLaunched') !== undefined ? 'state.gameLaunched = entityId' : '_ = entityId';
    eventLines.push(
      `case .launched(let entityId):\n                            ${launchedSet}\n                            ${calls('onGameLaunched').length === 0 ? 'break' : calls('onGameLaunched')}`,
    );
    eventLines.push('default:\n                            break');

    return gameScreenSourceTemplate({
      viewName,
      sceneResource: swiftString(gameSceneResourceName(screen)),
      eventLines: eventLines.join('\n                            '),
    });
  }

  const scopedFlows = flows.filter((f) => f.screenNodeId === undefined || f.screenNodeId === screen.id);
  const nodes = nodeViews(screen.children, scopedFlows, variableTypes, imageAssets, dynamic, 4);
  let appearCalls = eventCalls(['onScreenLoad', 'onScreenOpened'], scopedFlows, screen.id);
  // On Timer event flows arm while their screen is showing.
  const timerLines: string[] = [];
  for (const flow of scopedFlows) {
    for (const event of flow.blocks) {
      if (event.type !== 'onTimer') continue;
      const seconds = swiftDouble(event.parameters.find((p) => p.key === 'seconds')?.value ?? '1') ?? 1;
      const repeats = event.parameters.find((p) => p.key === 'repeats')?.value === 'true';
      const timerId = `screen:${viewName}:${swiftPrefix(uuidString(event.id), 8)}`;
      timerLines.push(
        `state.scheduleGeneratedTimer(id: ${swiftString(timerId)}, seconds: ${swiftDoubleString(seconds)}, repeats: ${repeats}) { await actions.${actionFunctionName(flow, event)}() }`,
      );
    }
  }
  if (timerLines.length > 0) {
    appearCalls = (appearCalls.length === 0 ? '' : appearCalls + '\n') + timerLines.join('\n');
  }
  let disappearCalls = eventCalls(['onScreenDisappear'], scopedFlows, screen.id);
  if (timerLines.length > 0) {
    disappearCalls =
      `state.cancelGeneratedTimers(prefix: ${swiftString(`screen:${viewName}:`)})` +
      (disappearCalls.length === 0 ? '' : '\n' + disappearCalls);
  }
  const screenBackground = shapeStyleExpression(screen.style.fill, screen.style.gradient, screen.width, screen.height);

  const scrolls = screen.scrollBehavior?.axis === 'vertical' || screen.scrollBehavior?.axis === 'both';
  const contentHeight = Math.max(
    screen.children.length === 0 ? screen.height : Math.max(...screen.children.map((c) => c.y + c.height)),
    screen.height,
  );
  const contentBlock = scrolls
    ? scrollingContentBlockTemplate({ nodes, screenWidth: int(screen.width), contentHeight: int(contentHeight) })
    : staticContentBlockTemplate({ nodes, screenWidth: int(screen.width), screenHeight: int(screen.height) });

  return screenSourceTemplate({
    viewName,
    screenBackground,
    contentBlock,
    appearCalls: indent(appearCalls.length === 0 ? '// no screen appear actions' : appearCalls, 12),
    disappearCalls: indent(disappearCalls.length === 0 ? '// no screen disappear actions' : disappearCalls, 12),
  });
}

export function watchRootSource(
  screens: DesignNode[],
  flows: LogicFlow[],
  variableTypes: VariableTypeMap,
  imageAssets: Map<string, string>,
  dynamic: DynamicMap,
): string {
  const cases = screens
    .map(
      (screen) =>
        `case ${swiftString(screenKey(screen))}: ${swiftIdentifier(screen.name, 'Screen')}WatchView(actions: GeneratedActions(state: state))`,
    )
    .join('\n                ');
  const fallback =
    screens.length > 0
      ? `${swiftIdentifier(screens[0]!.name, 'Screen')}WatchView(actions: GeneratedActions(state: state))`
      : 'Text("No screens exported")';
  const launchCalls = eventCalls(['onAppLaunch'], flows, undefined, 'GeneratedActions(state: state)');
  const screenViews = screens
    .map((screen) => watchScreenSource(screen, flows, variableTypes, imageAssets, dynamic))
    .join('\n');

  return watchRootSourceTemplate({
    cases,
    fallback,
    launchCalls: indent(launchCalls.length === 0 ? '// no app launch actions' : launchCalls, 12),
    screenViews,
  });
}

export function watchScreenSource(
  screen: DesignNode,
  flows: LogicFlow[],
  variableTypes: VariableTypeMap,
  imageAssets: Map<string, string>,
  dynamic: DynamicMap,
): string {
  const viewName = swiftIdentifier(screen.name, 'Screen');
  const scopedFlows = flows.filter((f) => f.screenNodeId === undefined || f.screenNodeId === screen.id);
  const elements = watchElementViews(
    screen.children, scopedFlows, variableTypes, imageAssets, screen.name === 'Home',
  );
  let appearCalls = eventCalls(['onScreenLoad', 'onScreenOpened'], scopedFlows, screen.id);
  const timerLines: string[] = [];
  for (const flow of scopedFlows) {
    for (const event of flow.blocks) {
      if (event.type !== 'onTimer') continue;
      const seconds = swiftDouble(event.parameters.find((p) => p.key === 'seconds')?.value ?? '1') ?? 1;
      const repeats = event.parameters.find((p) => p.key === 'repeats')?.value === 'true';
      const timerId = `watch:${viewName}:${swiftPrefix(uuidString(event.id), 8)}`;
      timerLines.push(
        `state.scheduleGeneratedTimer(id: ${swiftString(timerId)}, seconds: ${swiftDoubleString(seconds)}, repeats: ${repeats}) { await actions.${actionFunctionName(flow, event)}() }`,
      );
    }
  }
  if (timerLines.length > 0) {
    appearCalls = (appearCalls.length === 0 ? '' : appearCalls + '\n') + timerLines.join('\n');
  }

  // Digital Crown.
  const crownFlow = scopedFlows.find((f) => f.blocks.some((b) => b.type === 'onDigitalCrown'));
  const crownBlock = crownFlow?.blocks.find((b) => b.type === 'onDigitalCrown');
  const crownVarRef = crownBlock?.parameters.find((p) => p.key === 'valueVariable')?.variableReference;
  const crownVar = crownVarRef === undefined ? undefined : swiftIdentifier(crownVarRef, 'crown');
  const crownState = '@State private var __crown: Double = 0';
  let crownModifier: string;
  let crownOnChange: string;
  if (crownBlock !== undefined && crownVar !== undefined) {
    const sensitivity = crownBlock.parameters.find((p) => p.key === 'sensitivity')?.value ?? 'medium';
    const step = sensitivity === 'high' ? '0.05' : sensitivity === 'low' ? '0.5' : '0.15';
    const crownCalls = eventCalls(['onDigitalCrown'], scopedFlows, undefined);
    crownModifier = crownModifierTemplate({ step });
    crownOnChange = crownOnChangeTemplate({
      crownVar,
      crownCalls: indent(crownCalls.length === 0 ? '' : crownCalls, 16),
    });
  } else {
    crownModifier = '';
    crownOnChange = '';
  }

  // FAITHFUL rendering: the same absolute-layout generator the iPhone screens
  // use, scaled to the physical watch display.
  const nodes = nodeViews(screen.children, scopedFlows, variableTypes, imageAssets, dynamic, 5);
  const screenBackground = shapeStyleExpression(screen.style.fill, screen.style.gradient, screen.width, screen.height);
  void elements; // legacy semantic adaptation retained above for reference

  return watchScreenSourceTemplate({
    viewName,
    crownState: crownVar !== undefined ? crownState : '',
    safeWidth: String(Math.max(Math.trunc(screen.width), 1)),
    safeHeight: String(Math.max(Math.trunc(screen.height), 1)),
    screenBackground,
    nodes,
    screenWidth: int(screen.width),
    screenHeight: int(screen.height),
    crownModifier,
    crownOnChange,
    appearCalls: indent(appearCalls.length === 0 ? '// no screen appear actions' : appearCalls, 12),
  });
}

export function watchElementViews(
  nodes: DesignNode[],
  flows: LogicFlow[],
  variableTypes: VariableTypeMap,
  imageAssets: Map<string, string>,
  compactAlarmHome: boolean = false,
): string {
  const lines: string[] = [];

  const firstText = (node: DesignNode): string | undefined => {
    if (node.type === 'Text' && node.text !== undefined && node.text.length > 0) return node.text;
    for (const child of node.children) {
      const found = firstText(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };

  const emit = (node: DesignNode): void => {
    // On the watch, a tap is a tap: onWatchTap and onTap both fire.
    const tapAction = eventCalls(['onTap', 'onWatchTap'], flows, node.id);
    const longPressAction = eventCalls(['onWatchLongPress', 'onLongPress'], flows, node.id);
    const longPressModifier = longPressAction.length === 0 ? '' : `\n.onLongPressGesture { ${longPressAction} }`;
    switch (node.type) {
      case 'Text': {
        if (compactAlarmHome && node.text !== undefined && swiftCount(node.text) > 15) return;
        let line = `Text(${boundText(node) ?? swiftString(node.text ?? node.name)})${watchFont(node.style.fontSize)}`;
        if (node.style.textColor !== undefined) {
          line += `.foregroundColor(Color(hex: "${node.style.textColor}"))`;
        }
        if (tapAction.length > 0) {
          line += `\n.contentShape(Rectangle()).onTapGesture { ${tapAction} }`;
        }
        line += longPressModifier;
        lines.push(line);
        break;
      }
      case 'Button':
        lines.push(`Button {
${indent(tapAction.length === 0 ? '// no action' : tapAction, 4)}
} label: {
    Text(${boundText(node) ?? swiftString(node.text ?? node.name)})
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(Rectangle())
}
.frame(maxWidth: .infinity, minHeight: 44)
.contentShape(Rectangle())
.buttonStyle(.plain)
.tint(Color(hex: "${node.style.fill}"))${longPressModifier}`);
        break;
      case 'Input': {
        const field = isSecureInput(node) ? 'SecureField' : 'TextField';
        lines.push(
          `${field}(${swiftString(node.text ?? '')}, text: ${nodeBinding(node, variableTypes) ?? '.constant("")'})`,
        );
        break;
      }
      case 'Icon': {
        if (tapAction.length === 0) break;
        lines.push(`Button {
${indent(tapAction, 4)}
} label: {
    Label(${swiftString(node.name)}, systemImage: ${swiftString(node.iconName ?? 'circle')})
}`);
        break;
      }
      case 'Image': {
        const image = `${imageExpression(node, imageAssets)}.frame(maxWidth: .infinity).frame(height: 64).clipShape(RoundedRectangle(cornerRadius: 8))`;
        if (tapAction.length === 0) {
          lines.push(image);
        } else {
          lines.push(`Button {
${indent(tapAction, 4)}
} label: {
    ${image}
}
.buttonStyle(.plain)`);
        }
        break;
      }
      case 'Rectangle':
        break; // decorative on the watch
      case 'Frame':
        if (tapAction.length === 0) {
          node.children.forEach(emit);
        } else {
          // A tappable container becomes a single watch button.
          lines.push(`Button {
${indent(tapAction, 4)}
} label: {
    Text(${swiftString(firstText(node) ?? node.name)}).frame(maxWidth: .infinity)
}
.tint(Color(hex: "${node.style.fill}"))`);
        }
        break;
    }
  };

  nodes.forEach(emit);
  return lines.join('\n');
}

export function watchFont(fontSize: number | undefined): string {
  const size = fontSize ?? 15;
  // The canvas uses phone-sized typography; watchOS needs a denser scale.
  if (size >= 48) return '.font(.title2)';
  if (size >= 24) return '.font(.headline)';
  if (size >= 17) return '.font(.subheadline)';
  if (size >= 13) return '.font(.caption)';
  return '.font(.caption2)';
}

export function generatedImageSource(appName: string): string {
  return generatedImageSourceTemplate({ appName });
}

export function supportSource(
  appName: string,
  hasResources: boolean,
  imageAssets: Map<string, string> = new Map(),
): string {
  // Runtime map from the ORIGINAL design-time file path to the bundled
  // resource name.
  let assetMapLiteral: string;
  if (imageAssets.size === 0) {
    assetMapLiteral = '[:]';
  } else {
    const entries = [...imageAssets.entries()]
      .sort((a, b) => swiftStringCompare(a[0], b[0]))
      .map(([key, value]) => `            ${swiftString(key)}: ${swiftString(value)}`)
      .join(',\n');
    assetMapLiteral = `[\n${entries}\n        ]`;
  }
  return supportSourceTemplate({
    assetMapLiteral,
    generatedImage: hasResources ? generatedImageSource(appName) : '',
  });
}

/** Emitted by dynamicProperties(); re-exported for the facade. */
export type { DynamicNodeProperty, LogicBlock };
