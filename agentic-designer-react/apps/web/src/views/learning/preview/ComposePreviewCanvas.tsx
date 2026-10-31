import { Shield, Footprints, Heart, Zap, HelpCircle, Star, User } from 'lucide-react';
import React, { useEffect, useState, useRef } from 'react';
import { applyPreviewAction, evaluatePreview } from './previewInteraction';
import { previewText, type PreviewDocument, type PreviewNode } from './composePreview';
const colors: Record<string, string> = { White: '#ffffff', Black: '#000000', Red: '#f44336', Blue: '#2196f3', Green: '#4caf50', Gray: '#888888', Yellow: '#ffff00', Transparent: 'transparent' };
function color(value?: string) {
  const compact = value?.replace(/\s/g, '') ?? '';
  const hex = compact.match(/^Color\(0x(?:([\da-f]{2}))?([\da-f]{6})\)$/i);
  return hex ? `#${hex[2]}${hex[1] ?? ''}` : colors[compact.replace('Color.', '')];
}
function modifierStyle(value = ''): React.CSSProperties {
  const compact = value.replace(/\s/g, ''); const style: React.CSSProperties = {};
  const number = (name: string) => compact.match(new RegExp(`\\.${name}\\((\\d+(?:\\.\\d+)?)\\.dp\\)`))?.[1];
  if (compact.includes('.fillMaxSize(')) { style.width = '100%'; style.height = '100%'; }
  if (compact.includes('.fillMaxWidth(')) style.width = '100%';
  if (compact.includes('.fillMaxHeight(')) style.height = '100%';
  for (const prop of ['padding', 'width', 'height'] as const) if (number(prop)) style[prop] = Number(number(prop));
  if (number('size')) { style.width = Number(number('size')); style.height = Number(number('size')); }
  const padding = compact.match(/\.padding\(horizontal=(\d+)\.dp,vertical=(\d+)\.dp\)/);
  if (padding) style.padding = `${padding[2]}px ${padding[1]}px`;
  const paddingArgs = compact.match(/\.padding\(([^)]*)\)/)?.[1];
  for (const [arg, prop] of [['start','paddingLeft'], ['end','paddingRight'], ['top','paddingTop'], ['bottom','paddingBottom']] as const) {
    const amount = paddingArgs?.match(new RegExp(`${arg}=(\\d+(?:\\.\\d+)?)\\.dp`))?.[1];
    if (amount) style[prop] = Number(amount);
  }
  const bg = value.match(/\.\s*background\s*\(\s*(Color\s*\([^)]*\)|Color\s*\.\s*\w+)/);
  if (bg) style.background = color(bg[1]);
  const radius = compact.match(/RoundedCornerShape\((\d+)\.dp\)/); if (radius) style.borderRadius = Number(radius[1]);
  return style;
}
const alignment = (s = '') => /Center/.test(s) ? 'center' : /End|Bottom/.test(s) ? 'flex-end' : 'flex-start';
type Action = (callback: string | undefined, input?: string) => void;
function Node({ node, values, action }: { node: PreviewNode; values: Record<string, string>; action: Action }) {
  const { kind, args, children } = node;
  const enabled = (() => { try { return args.enabled === undefined || evaluatePreview(args.enabled, values) === true; } catch { return false; } })();
  const text = (expression?: string) => { try { return String(evaluatePreview(expression ?? '""', values)); } catch { return previewText(expression, values); } };
  const configuredColor = (name: string) => color(args.colors?.match(new RegExp(`${name}\\s*=\\s*(Color\\s*\\([^)]*\\)|Color\\s*\\.\\s*\\w+)`))?.[1]);
  const radius = args.shape?.match(/RoundedCornerShape\s*\(\s*(\d+)/)?.[1];
  const style: React.CSSProperties = { boxSizing: 'border-box', ...modifierStyle(args.modifier) };
  const content = children.map((child, i) => kind === 'Box'
    ? <div key={i} style={{ gridArea: '1 / 1', alignSelf: alignment(args.contentAlignment), justifySelf: alignment(args.contentAlignment) }}><Node node={child} values={values} action={action} /></div>
    : <Node key={i} node={child} values={values} action={action} />);
  if (kind === 'Icon') {
    const name = args.imageVector?.replace(/\s/g, '').split('.').pop() ?? '';
    const icons = { Shield, DirectionsRun: Footprints, Favorite: Heart, Bolt: Zap, HelpOutline: HelpCircle, Star, Person: User };
    const Symbol = icons[name as keyof typeof icons] ?? HelpCircle;
    return <Symbol role="img" aria-label={text(args.contentDescription) || name} style={{ width: 24, height: 24, color: color(args.tint) ?? 'currentColor', ...style }} />;
  }
  if (kind === 'Text') {
    const typography = args.style?.replace(/\s/g, '').split('.').pop();
    const sizes: Record<string, number> = { headlineLarge: 32, headlineMedium: 28, headlineSmall: 24, titleLarge: 22, titleMedium: 16, bodyLarge: 16, bodyMedium: 14, labelLarge: 14 };
    return <span dir="auto" style={{ display: 'block', fontSize: Number(args.fontSize?.match(/\d+/)?.[0]) || sizes[typography ?? ''] || 16, color: color(args.color), fontWeight: /Bold/.test(args.fontWeight ?? '') ? 700 : 400, textAlign: /Center/.test(args.textAlign ?? '') ? 'center' : undefined, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', ...style }}>{text(args.text ?? args['0'])}</span>;
  }
  if (kind.endsWith('TextField')) {
    const label = (args.label ?? args.placeholder)?.match(/Text\s*\(\s*(?:text\s*=\s*)?("(?:\\.|[^"\\])*")/)?.[1];
    return <label style={{ display: 'block', minWidth: 0, border: '1px solid #79747e', borderRadius: 4, padding: '8px 12px', color: configuredColor('unfocusedTextColor') ?? '#49454f', background: configuredColor('unfocusedContainerColor'), borderColor: configuredColor('unfocusedBorderColor'), ...(radius ? { borderRadius: Number(radius) } : {}), ...style }}>
      {label && <span dir="auto" style={{ fontSize: 12 }}>{previewText(label, values)}</span>}
      <input aria-label={previewText(label, values) || 'שדה קלט בתצוגה'} type={args.visualTransformation?.includes('PasswordVisualTransformation') ? 'password' : 'text'} disabled={!enabled} readOnly={args.readOnly === 'true'} value={text(args.value)} onChange={event => action(args.onValueChange, event.target.value)} style={{ width: '100%', border: 0, background: 'transparent', color: 'inherit', fontSize: 16, outline: 'none' }} />
    </label>;
  }
  if (kind.endsWith('Button')) return <button type="button" disabled={!enabled} onClick={() => action(args.onClick)} style={{ border: kind === 'OutlinedButton' ? '1px solid #79747e' : 0, borderRadius: radius ? Number(radius) : 24, background: configuredColor('containerColor') ?? (kind === 'Button' ? '#6750a4' : 'transparent'), color: configuredColor('contentColor') ?? (kind === 'Button' ? '#fff' : '#6750a4'), padding: '10px 24px', cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.45, ...style }}>{content}</button>;
  if (kind === 'Spacer') return <div style={{ flexShrink: 0, ...style }} />;
  if (kind === 'Box') return <div style={{ display: 'grid', ...style }}>{content}</div>;
  const arrangement = args.verticalArrangement ?? args.horizontalArrangement ?? '';
  const spacing = arrangement.match(/spacedBy\s*\(\s*(\d+)/)?.[1];
  return <div style={{ display: 'flex', flexDirection: kind === 'Row' ? 'row' : 'column', alignItems: alignment(args.horizontalAlignment ?? args.verticalAlignment ?? args.contentAlignment), justifyContent: /SpaceBetween/.test(arrangement) ? 'space-between' : /SpaceEvenly/.test(arrangement) ? 'space-evenly' : /SpaceAround/.test(arrangement) ? 'space-around' : alignment(arrangement), gap: spacing ? Number(spacing) : undefined, ...(kind === 'Card' ? { background: '#e7e0ec', borderRadius: 12, padding: 12 } : {}), ...style }}>{content}</div>;
}
export function ComposePreviewCanvas({ document, width = 390, height = 844 }: { document: PreviewDocument; width?: number; height?: number }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const element = viewport.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const update = () => setScale(Math.max(1, element.clientWidth) / Math.max(1, width));
    const observer = new ResizeObserver(update); observer.observe(element); update();
    return () => observer.disconnect();
  }, [width]);
  const [values, setValues] = useState(document.values);
  const [notice, setNotice] = useState('');
  useEffect(() => { setValues(document.values); setNotice(''); }, [document]);
  const action: Action = (callback, input) => {
    try { setValues(applyPreviewAction(callback, values, document.writable, input)); setNotice(''); }
    catch (error) { setNotice((error as Error).message); }
  };
  return <>
    <button className="learning-control" onClick={() => { setValues(document.values); setNotice(''); }} style={{ marginBottom: 8 }}>איפוס התצוגה</button>
    <p role="status" style={{ color: '#fbbf24' }}>{notice}</p>
    <div ref={viewport} dir="ltr" style={{ width: '100%', aspectRatio: `${width} / ${height}`, background: '#fffbfe', color: '#1c1b1f', borderRadius: 24, border: '6px solid #374151', overflow: 'auto', fontFamily: 'Arial, sans-serif', position: 'relative' }}>
    <div style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>{document.nodes.map((node, i) => <Node key={i} node={node} values={values} action={action} />)}</div>
  </div></>;
}
