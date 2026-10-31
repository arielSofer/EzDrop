// Ported 1:1 from AgenticDesigner/Services/LogicExporter.swift — the SwiftUI
// view emitter: nodeViews and every modifier helper it composes.

import type { GradientStyle } from '../../models/GradientStyle';
import type { DesignNode, NodeLogicBinding, ScrollBehavior } from '../../models/DesignNode';
import type { Point, Size } from '../../models/Geometry';
import type { LogicFlow } from '../../models/LogicModels';
import { eventCalls } from './statements';
import { swiftInterpolatedString, tokensResolve } from './expressions';
import {
  actionFunctionName,
  binding as nodeBinding,
  boundText,
  dynamicVarName,
  gameSceneResourceName,
  imageExpression,
  indent,
  isSecureInput,
  accessibilityIdentifier,
  swiftEscaped,
  swiftIdentifier,
  swiftString,
} from './helpers';
import { swiftDoubleString, swiftPrefix, trimWhitespacesAndNewlines, uuidString } from './swiftRuntime';
import type { DynamicMap, DynamicNodeProperty, RepeatItemContext, VariableTypeMap } from './types';

const int = (value: number): string => String(Math.trunc(value));

export function nodeViews(
  nodes: DesignNode[],
  flows: LogicFlow[],
  variableTypes: VariableTypeMap,
  imageAssets: Map<string, string>,
  dynamic: DynamicMap,
  level: number,
  repeatItem?: RepeatItemContext,
): string {
  // Render in zIndex order (stable for equal zIndex), matching the in-app
  // canvas/preview.
  const ordered = nodes
    .map((element, offset) => ({ element, offset }))
    .sort((lhs, rhs) => {
      const lz = lhs.element.zIndex ?? 0;
      const rz = rhs.element.zIndex ?? 0;
      return lz === rz ? lhs.offset - rhs.offset : lz - rz;
    })
    .map((e) => e.element);

  return ordered
    .map((node) => {
      const indentText = ' '.repeat(level * 4);
      const props: Set<DynamicNodeProperty> = dynamic.get(node.id) ?? new Set();

      if (node.repeatBinding !== undefined) {
        return repeatForEachExpression(node, flows, variableTypes, imageAssets, dynamic, level);
      }

      // Inside a repeat cell, wired taps first record WHICH item's cell fired.
      const withItemContext = (calls: string): string => {
        if (calls.length === 0 || repeatItem === undefined) return calls;
        const aliasVar = swiftIdentifier(repeatItem.alias, 'item');
        return `state.${aliasVar} = GeneratedRepeat.encode(${repeatItem.itemExpr})\n` + calls;
      };

      const widthExpr = props.has('width') ? `state.${dynamicVarName(node.id, 'width')}` : int(node.width);
      const heightExpr = props.has('height') ? `state.${dynamicVarName(node.id, 'height')}` : int(node.height);
      const xExpr = props.has('x')
        ? `state.${dynamicVarName(node.id, 'x')} + (${widthExpr}) / 2`
        : int(node.x + node.width / 2);
      const yExpr = props.has('y')
        ? `state.${dynamicVarName(node.id, 'y')} + (${heightExpr}) / 2`
        : int(node.y + node.height / 2);
      const frame = `.frame(width: ${widthExpr}, height: ${heightExpr}, alignment: ${swiftFrameAlignment(node)})`;
      const position = `.position(x: ${xExpr}, y: ${yExpr})`;

      const tapAction = withItemContext(eventCalls(['onTap', 'onWatchTap'], flows, node.id));
      const submitAction = eventCalls(['onSubmit'], flows, node.id);
      const children =
        node.children.length === 0
          ? ''
          : `\n${nodeViews(node.children, flows, variableTypes, imageAssets, dynamic, level + 1, repeatItem)}\n${indentText}`;

      const rawText = node.text ?? node.name;
      let textExpr: string;
      const bound = boundText(node);
      if (props.has('text')) {
        textExpr = `state.${dynamicVarName(node.id, 'text')}`;
      } else if (bound !== undefined) {
        textExpr = bound;
      } else if (repeatItem !== undefined && rawText.includes('{{')) {
        textExpr = `GeneratedRepeat.substitute(${swiftString(rawText)}, alias: ${swiftString(repeatItem.alias)}, item: ${repeatItem.itemExpr})`;
      } else if (rawText.includes('{{') && tokensResolve(rawText, variableTypes)) {
        textExpr = `verbatim: ${swiftInterpolatedString(rawText, variableTypes)}`;
      } else {
        // LocalizedStringKey, not String.
        textExpr = `LocalizedStringKey(${swiftString(rawText)})`;
      }
      const fillExpr = props.has('fill')
        ? `Color(hex: state.${dynamicVarName(node.id, 'fill')})`
        : shapeStyleExpression(node.style.fill, node.style.gradient, node.width, node.height);

      let expression: string;
      if (node.timePicker !== undefined) {
        expression = `GeneratedTimePicker(hour: $state.${swiftIdentifier(node.timePicker.hourVariable, 'alarmHour')}, minute: $state.${swiftIdentifier(node.timePicker.minuteVariable, 'alarmMinute')})`;
      } else if (node.gameScene !== undefined) {
        expression = `AgentGameView(spec: GameSceneLoader.load(${swiftString(gameSceneResourceName(node))}))`;
      } else {
        switch (node.type) {
          case 'Text':
            expression = `Text(${textExpr})`;
            break;
          case 'Button':
            expression = `Button(action: {\n${indent(tapAction, (level + 1) * 4)}\n${indentText}}) { Text(${textExpr}).frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(Rectangle()) }.buttonStyle(.plain)`;
            break;
          case 'Input': {
            const inputField = isSecureInput(node) ? 'SecureField' : 'TextField';
            expression = `${inputField}(${swiftString(node.text ?? '')}, text: ${nodeBinding(node, variableTypes) ?? '.constant("")'})${submitAction.length === 0 ? '' : `.onSubmit { ${submitAction} }`}`;
            break;
          }
          case 'Image':
            expression = props.has('image')
              ? `DynamicRemoteImage(source: state.${dynamicVarName(node.id, 'image')})`
              : imageExpression(node, imageAssets);
            break;
          case 'Icon':
            expression = `Image(systemName: ${swiftString(node.iconName ?? 'circle')}).resizable().scaledToFit()`;
            break;
          case 'Rectangle':
            expression = `RoundedRectangle(cornerRadius: ${int(node.style.cornerRadius)}).fill(${fillExpr})`;
            break;
          case 'Frame': {
            const scrollBehavior = node.scrollBehavior;
            const scrollableChild = node.children.find((c) => c.repeatBinding?.isScrollable === true);
            const childBinding = scrollableChild?.repeatBinding;
            if (scrollBehavior !== undefined) {
              const contentSize = scrollContentSize(node);
              const offset = scrollOffset(scrollBehavior);
              expression = `ScrollView(${swiftScrollAxes(scrollBehavior.axis)}, showsIndicators: ${scrollBehavior.showsIndicators ?? true}) {
${indentText}    ZStack(alignment: .topLeading) {${children}
${indentText}    }
${indentText}    .frame(width: ${int(contentSize.width)}, height: ${int(contentSize.height)}, alignment: .topLeading)
${indentText}    .offset(x: ${int(offset.x)}, y: ${int(offset.y)})
${indentText}}`;
            } else if (scrollableChild !== undefined && childBinding !== undefined) {
              // Recycler view.
              const axis = childBinding.axis === 'horizontal' ? '.horizontal' : '.vertical';
              const step =
                (childBinding.axis === 'horizontal' ? scrollableChild.width : scrollableChild.height) +
                (scrollableChild.style.spacing ?? 8);
              const sourceVar = `state.${swiftIdentifier(childBinding.sourceVariable, 'items')}`;
              const margin = childBinding.axis === 'horizontal' ? scrollableChild.x : scrollableChild.y;
              const spanExpr = `max(CGFloat(GeneratedRepeat.items(from: ${sourceVar}).count) * ${int(step)} + ${int(margin * 2)}, ${int(childBinding.axis === 'horizontal' ? node.width : node.height)})`;
              const contentWidth = childBinding.axis === 'horizontal' ? spanExpr : int(node.width);
              const contentHeight = childBinding.axis === 'horizontal' ? int(node.height) : spanExpr;
              expression = `ScrollView(${axis}, showsIndicators: true) {
${indentText}    ZStack(alignment: .topLeading) {${children}
${indentText}    }
${indentText}    .frame(width: ${contentWidth}, height: ${contentHeight}, alignment: .topLeading)
${indentText}}`;
            } else {
              expression = `ZStack(alignment: .topLeading) {${children}}`;
            }
            break;
          }
        }
      }

      // Tap/gesture modifiers and their contentShape MUST come before .position().
      const tapModifiers =
        node.type === 'Button' || tapAction.length === 0
          ? ''
          : `\n${indentText}.contentShape(Rectangle())\n${indentText}.onTapGesture { ${tapAction} }`;
      const gestures = gestureModifiers(node, flows, indentText, withItemContext);
      const accessibility = accessibilityModifiers(node, indentText);
      const preModifiers = preFrameModifiers(node, props, node.id);
      const preModifierText = preModifiers.length === 0 ? '' : '\n' + indent(preModifiers, level * 4);
      const postModifiers = postFrameModifiers(node, props, node.id);
      const postModifierText = postModifiers.length === 0 ? '' : '\n' + indent(postModifiers, level * 4);
      const opacityModifier = props.has('opacityChannel')
        ? `\n${indentText}.opacity(state.${dynamicVarName(node.id, 'opacityChannel')})\n${indentText}.allowsHitTesting(state.${dynamicVarName(node.id, 'opacityChannel')} > 0.05)`
        : '';
      const bindingModifiers = stateBindingModifiers(node, variableTypes, indentText);
      return `${indentText}${expression}${preModifierText}
${indentText}${frame}${postModifierText}${tapModifiers}${gestures}
${indentText}${position}${opacityModifier}${bindingModifiers}${accessibility}`;
    })
    .join('\n');
}

/// Accessibility, emitted for EVERY node.
export function accessibilityModifiers(node: DesignNode, indentText: string): string {
  const modifiers: string[] = [`.accessibilityIdentifier(${swiftString(accessibilityIdentifier(node))})`];

  switch (node.type) {
    case 'Button': {
      const title = node.text === undefined ? '' : trimWhitespacesAndNewlines(node.text);
      const label = title.length === 0 ? node.name : title;
      modifiers.push(`.accessibilityLabel(${swiftString(label)})`);
      modifiers.push('.accessibilityAddTraits(.isButton)');
      break;
    }
    case 'Image':
    case 'Icon': {
      const looksDecorative =
        node.name.toLowerCase().includes('background') || node.name.toLowerCase().includes('decor');
      modifiers.push(looksDecorative ? '.accessibilityHidden(true)' : `.accessibilityLabel(${swiftString(node.name)})`);
      break;
    }
    case 'Input':
      modifiers.push(`.accessibilityLabel(${swiftString(node.name)})`);
      break;
    case 'Text':
      if ((node.style.fontSize ?? 16) >= 24) modifiers.push('.accessibilityAddTraits(.isHeader)');
      break;
    default:
      break;
  }
  return '\n' + modifiers.map((m) => indentText + m).join('\n');
}

/// SwiftUI modifiers for a node's visibility / enabled logic bindings.
export function stateBindingModifiers(
  node: DesignNode,
  variableTypes: VariableTypeMap,
  indentText: string,
): string {
  const bindings = node.logicBindings;
  if (bindings === undefined) return '';
  const out: string[] = [];
  for (const binding of bindings) {
    switch (binding.kind) {
      case 'visibility': {
        const cond = bindingBoolExpr(binding, variableTypes);
        out.push(`.opacity((${cond}) ? 1 : 0)`);
        out.push(`.allowsHitTesting(${cond})`);
        break;
      }
      case 'enabled': {
        const cond = bindingBoolExpr(binding, variableTypes);
        out.push(`.disabled(!(${cond}))`);
        break;
      }
      default:
        continue;
    }
  }
  return out.length === 0 ? '' : '\n' + out.map((m) => indentText + m).join('\n');
}

/// The boolean a visibility/enabled binding evaluates.
export function bindingBoolExpr(binding: NodeLogicBinding, variableTypes: VariableTypeMap): string {
  const lhs = `state.${swiftIdentifier(binding.variableName, 'value')}`;
  const condition = binding.condition;
  if (condition === undefined) {
    switch (variableTypes.get(binding.variableName) ?? 'string') {
      case 'boolean': return lhs;
      case 'number': return `${lhs} != 0`;
      default: return `!(String(describing: ${lhs}).isEmpty)`;
    }
  }
  const left = `state.${swiftIdentifier(condition.left, 'value')}`;
  const right = swiftString(condition.right ?? '');
  switch (condition.operation) {
    case 'equals': return `String(describing: ${left}) == ${right}`;
    case 'notEquals': return `String(describing: ${left}) != ${right}`;
    case 'greaterThan': return `(Double(String(describing: ${left})) ?? 0) > (Double(${right}) ?? 0)`;
    case 'lessThan': return `(Double(String(describing: ${left})) ?? 0) < (Double(${right}) ?? 0)`;
    case 'contains': return `String(describing: ${left}).contains(${right})`;
    case 'isEmpty': return `String(describing: ${left}).isEmpty`;
    case 'isNotEmpty': return `!String(describing: ${left}).isEmpty`;
    case 'isTrue': return `String(describing: ${left}) == "true"`;
    case 'isFalse': return `String(describing: ${left}) != "true"`;
  }
}

// One positioned cell per item of the template's bound array variable.
export function repeatForEachExpression(
  node: DesignNode,
  flows: LogicFlow[],
  variableTypes: VariableTypeMap,
  imageAssets: Map<string, string>,
  dynamic: DynamicMap,
  level: number,
): string {
  const binding = node.repeatBinding;
  if (binding === undefined) return '';
  const indentText = ' '.repeat(level * 4);
  const loopVar = `__repeat_${swiftPrefix(uuidString(node.id), 8).replaceAll('-', '')}`;
  const sourceVar = `state.${swiftIdentifier(binding.sourceVariable, 'items')}`;
  const cap = Math.min(binding.maxItems ?? 50, 50);
  const spacing = node.style.spacing ?? 8;
  const stepX = binding.axis === 'horizontal' ? Math.trunc(node.width + spacing) : 0;
  const stepY = binding.axis === 'vertical' ? Math.trunc(node.height + spacing) : 0;

  const cell: DesignNode = { ...node, x: 0, y: 0 };
  delete (cell as { repeatBinding?: unknown }).repeatBinding;
  const cellCode = nodeViews(
    [cell], flows, variableTypes, imageAssets, dynamic, level + 1,
    { alias: binding.itemAlias, itemExpr: `${loopVar}.element` },
  );

  const filterArg =
    binding.filterVariable === undefined ? '' : `, filter: state.${swiftIdentifier(binding.filterVariable, 'query')}`;
  const categoryArg =
    binding.categoryVariable === undefined
      ? ''
      : `, category: state.${swiftIdentifier(binding.categoryVariable, 'category')}`;

  const emptyLabel = binding.itemAlias.length === 0 ? 'items' : binding.itemAlias + 's';
  const emptyState = `${indentText}if GeneratedRepeat.items(from: ${sourceVar}${filterArg}${categoryArg}).isEmpty {
${indentText}    Text("No ${swiftEscaped(emptyLabel)} yet")
${indentText}        .font(.system(size: 15))
${indentText}        .foregroundColor(.secondary)
${indentText}        .frame(width: ${int(node.width)}, height: ${int(node.height)})
${indentText}        .position(x: ${int(node.x + node.width / 2)}, y: ${int(node.y + node.height / 2)})
${indentText}}`;

  return `${emptyState}
${indentText}ForEach(Array(GeneratedRepeat.items(from: ${sourceVar}${filterArg}${categoryArg}).prefix(${cap}).enumerated()), id: \\.offset) { ${loopVar} in
${indentText}    ZStack(alignment: .topLeading) {
${cellCode}
${indentText}    }
${indentText}    .frame(width: ${int(node.width)}, height: ${int(node.height)}, alignment: .topLeading)
${indentText}    .position(x: ${int(node.x + node.width / 2)} + CGFloat(${loopVar}.offset) * ${stepX}, y: ${int(node.y + node.height / 2)} + CGFloat(${loopVar}.offset) * ${stepY})
${indentText}}`;
}

// Double-tap / long-press / swipe flows attach as simultaneous gestures.
export function gestureModifiers(
  node: DesignNode,
  flows: LogicFlow[],
  indentText: string,
  transform: (calls: string) => string,
): string {
  const modifiers: string[] = [];

  const doubleTap = transform(eventCalls(['onDoubleTap'], flows, node.id));
  if (doubleTap.length > 0) {
    modifiers.push(`.simultaneousGesture(TapGesture(count: 2).onEnded { ${doubleTap.replaceAll('\n', '; ')} })`);
  }

  const longPress = transform(eventCalls(['onLongPress'], flows, node.id));
  if (longPress.length > 0) {
    modifiers.push(
      `.simultaneousGesture(LongPressGesture(minimumDuration: 0.5).onEnded { _ in ${longPress.replaceAll('\n', '; ')} })`,
    );
  }

  const swipeBranches: string[] = [];
  for (const flow of flows) {
    for (const event of flow.blocks) {
      if (event.type !== 'onSwipe') continue;
      if (!eventMatchesLocal(event, node.id, flow)) continue;
      const direction = event.parameters.find((p) => p.key === 'direction')?.value ?? '';
      const call = transform(
        `_ = Swift.Task<Void, Never> { @MainActor in await actions.${actionFunctionName(flow, event)}() }`,
      ).replaceAll('\n', '; ');
      if (direction.length === 0) {
        swipeBranches.push(call);
      } else {
        swipeBranches.push(`if __direction == ${swiftString(direction)} { ${call} }`);
      }
    }
  }
  if (swipeBranches.length > 0) {
    modifiers.push(`.simultaneousGesture(DragGesture(minimumDistance: 24).onEnded { __swipe in
${indentText}    let __direction = abs(__swipe.translation.width) > abs(__swipe.translation.height) ? (__swipe.translation.width < 0 ? "left" : "right") : (__swipe.translation.height < 0 ? "up" : "down")
${indentText}    _ = __direction
${indentText}    ${swipeBranches.join(`\n${indentText}    `)}
${indentText}})`);
  }

  if (modifiers.length === 0) return '';
  return `\n${indentText}` + modifiers.join(`\n${indentText}`);
}

function eventMatchesLocal(event: import('../../models/LogicModels').LogicBlock, nodeId: string, flow: LogicFlow): boolean {
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

export function scrollContentSize(node: DesignNode): Size {
  const maxX = node.children.length === 0 ? node.width : Math.max(...node.children.map((c) => c.x + c.width));
  const maxY = node.children.length === 0 ? node.height : Math.max(...node.children.map((c) => c.y + c.height));
  return { width: Math.max(node.width, maxX), height: Math.max(node.height, maxY) };
}

export function scrollOffset(behavior: ScrollBehavior): Point {
  const initialOffset = behavior.initialOffset ?? 0;
  switch (behavior.axis) {
    case 'horizontal': return { x: -initialOffset, y: 0 };
    case 'both': return { x: -initialOffset, y: -initialOffset };
    default: return { x: 0, y: -initialOffset };
  }
}

export function swiftScrollAxes(axis: string): string {
  switch (axis) {
    case 'horizontal': return '.horizontal';
    case 'both': return '[.horizontal, .vertical]';
    default: return '.vertical';
  }
}

export function shapeStyleExpression(
  fill: string,
  gradient: GradientStyle | undefined,
  width: number,
  height: number,
): string {
  if (gradient === undefined || gradient.colors.length === 0) {
    return `Color(hex: "${fill}")`;
  }

  const colors = gradient.colors.map((c) => `Color(hex: ${swiftString(c)})`).join(', ');
  if (gradient.type === 'radial') {
    const radius = Math.trunc(Math.max(width, height) / 2);
    return `RadialGradient(gradient: Gradient(colors: [${colors}]), center: .center, startRadius: 0, endRadius: ${Math.max(radius, 1)})`;
  }

  const angle = Math.trunc(gradient.angle ?? 180);
  return `LinearGradient(gradient: Gradient(colors: [${colors}]), startPoint: UnitPoint(x: CGFloat(0.5 - cos(Angle(degrees: Double(${angle})).radians) / 2), y: CGFloat(0.5 - sin(Angle(degrees: Double(${angle})).radians) / 2)), endPoint: UnitPoint(x: CGFloat(0.5 + cos(Angle(degrees: Double(${angle})).radians) / 2), y: CGFloat(0.5 + sin(Angle(degrees: Double(${angle})).radians) / 2)))`;
}

export function preFrameModifiers(node: DesignNode, dynamic: Set<DynamicNodeProperty>, nodeId: string): string {
  const modifiers: string[] = [];

  switch (node.type) {
    case 'Text':
    case 'Button':
    case 'Input':
    case 'Icon': {
      if (dynamic.has('textColor')) {
        modifiers.push(`.foregroundColor(Color(hex: state.${dynamicVarName(nodeId, 'textColor')}))`);
      } else if (node.style.textColor !== undefined) {
        modifiers.push(`.foregroundColor(Color(hex: "${node.style.textColor}"))`);
      }
      if (node.style.fontSize !== undefined) {
        const weight = swiftFontWeight(node.style.fontWeight);
        modifiers.push(`.font(.system(size: ${int(node.style.fontSize)}, weight: ${weight}))`);
      }
      if (node.style.letterSpacing !== undefined && node.style.letterSpacing !== 0) {
        modifiers.push(`.tracking(${int(node.style.letterSpacing)})`);
      }
      if (node.style.lineHeight !== undefined && node.style.fontSize !== undefined) {
        modifiers.push(`.lineSpacing(${Math.max(0, Math.trunc(node.style.lineHeight - node.style.fontSize))})`);
      }
      if (node.type === 'Text') {
        if (node.textBehavior?.maxLines !== undefined) {
          modifiers.push(`.lineLimit(${Math.max(1, node.textBehavior.maxLines)})`);
        }
        if (node.textBehavior?.autoHeight === true || node.textBehavior?.wrap === true) {
          modifiers.push('.fixedSize(horizontal: false, vertical: true)');
        } else if (node.textBehavior?.truncate === false) {
          modifiers.push('.minimumScaleFactor(0.72)');
          modifiers.push('.allowsTightening(true)');
        }
      }
      break;
    }
    default:
      break;
  }

  if (node.style.textAlign !== undefined) {
    modifiers.push(`.multilineTextAlignment(${swiftTextAlignment(node.style.textAlign)})`);
  } else if (node.text !== undefined && Array.from(node.text).some((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp >= 0x0590 && cp <= 0x05ff;
  })) {
    // Hebrew (or any RTL script here) with no explicit alignment.
    modifiers.push('.multilineTextAlignment(.trailing)');
    modifiers.push('.frame(maxWidth: .infinity, alignment: .trailing)');
  }

  return modifiers.length === 0 ? '' : modifiers.join('\n');
}

export function postFrameModifiers(node: DesignNode, dynamic: Set<DynamicNodeProperty>, nodeId: string): string {
  const modifiers: string[] = [];

  if (node.type === 'Frame') {
    const fill = dynamic.has('fill')
      ? `Color(hex: state.${dynamicVarName(nodeId, 'fill')})`
      : shapeStyleExpression(node.style.fill, node.style.gradient, node.width, node.height);
    modifiers.push(`.background(RoundedRectangle(cornerRadius: ${int(node.style.cornerRadius)}).fill(${fill}))`);
  }

  if (node.type === 'Button' || node.type === 'Input') {
    const fill = dynamic.has('fill')
      ? `Color(hex: state.${dynamicVarName(nodeId, 'fill')})`
      : shapeStyleExpression(node.style.fill, node.style.gradient, node.width, node.height);
    modifiers.push(`.background(RoundedRectangle(cornerRadius: ${int(node.style.cornerRadius)}).fill(${fill}))`);
    modifiers.push(`.clipShape(RoundedRectangle(cornerRadius: ${int(node.style.cornerRadius)}))`);
  }

  if (node.type === 'Image' || node.clipContent === true) {
    modifiers.push(`.clipShape(RoundedRectangle(cornerRadius: ${int(node.style.cornerRadius)}))`);
  }

  if (node.style.stroke !== undefined && node.style.strokeWidth !== undefined && node.style.strokeWidth > 0) {
    modifiers.push(
      `.overlay(RoundedRectangle(cornerRadius: ${int(node.style.cornerRadius)}).stroke(Color(hex: "${node.style.stroke}"), lineWidth: ${int(node.style.strokeWidth)}))`,
    );
  }

  if (node.style.opacity < 1 && !dynamic.has('opacityChannel')) {
    modifiers.push(`.opacity(${swiftDoubleString(node.style.opacity)})`);
  }

  const shadow = node.style.shadow;
  if (shadow !== undefined && shadow.opacity > 0 && shadow.radius > 0) {
    modifiers.push(
      `.shadow(color: Color(hex: "${shadow.color}").opacity(${swiftDoubleString(shadow.opacity)}), radius: ${int(shadow.radius)}, x: ${int(shadow.x)}, y: ${int(shadow.y)})`,
    );
  }

  return modifiers.length === 0 ? '' : modifiers.join('\n');
}

export function swiftTextAlignment(raw: string): string {
  switch (raw.toLowerCase()) {
    case 'center': return '.center';
    case 'right':
    case 'trailing': return '.trailing';
    default: return '.leading';
  }
}

export function swiftFrameAlignment(node: DesignNode): string {
  if (node.type !== 'Text') return '.center';
  switch (node.style.textAlign?.toLowerCase()) {
    case 'center': return '.top';
    case 'right':
    case 'trailing': return '.topTrailing';
    default: return '.topLeading';
  }
}

export function swiftFontWeight(raw: string | undefined): string {
  switch (raw?.toLowerCase()) {
    case 'bold':
    case '700': return '.bold';
    case 'semibold':
    case '600': return '.semibold';
    case 'medium':
    case '500': return '.medium';
    case 'light':
    case '300': return '.light';
    default: return '.regular';
  }
}
