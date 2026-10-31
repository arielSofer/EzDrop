import React from 'react';
import SFSymbol from '../../components/SFSymbol';
import type { ScreenSnapshot } from '@agentic/core';
export function DesignReferenceCanvas({ screen }: { screen: ScreenSnapshot }) {
  const scale = 260 / Math.max(1, screen.width);
  return <div dir="ltr" aria-label={`העיצוב השמור של ${screen.name}`} style={{ position: 'relative', width: 260, height: screen.height * scale, flexShrink: 0, overflow: 'hidden', background: screen.fillColor ?? '#0f172a', borderRadius: 20, outline: '1px solid #475569' }}>
    {screen.components.map(c => <div key={c.id} dir="auto" style={{ position: 'absolute', boxSizing: 'border-box', left: (c.x ?? 0) * scale, top: (c.y ?? 0) * scale, width: (c.width ?? screen.width) * scale, height: (c.height ?? 30) * scale,
      display: 'flex', alignItems: 'center', justifyContent: c.textAlign === 'center' || c.type === 'Button' ? 'center' : c.textAlign === 'right' ? 'flex-end' : 'flex-start',
      background: c.type === 'Text' ? 'transparent' : c.fillColor, color: c.textColor ?? (c.type === 'Text' ? c.fillColor : '#ffffff'), borderRadius: (c.cornerRadius ?? 0) * scale,
      border: c.stroke ? `${(c.strokeWidth ?? 1) * scale}px solid ${c.stroke}` : undefined,
      fontSize: (c.fontSize ?? 14) * scale, fontWeight: /bold|heavy/i.test(c.fontWeight ?? '') ? 700 : Number(c.fontWeight) || 400,
      fontFamily: c.fontFamily, whiteSpace: 'pre-wrap', textAlign: (c.textAlign ?? 'left') as React.CSSProperties['textAlign'], lineHeight: 1.2, overflow: 'hidden', paddingInline: c.type === 'Input' ? 8 * scale : 0,
    }}>{c.type === 'Icon' && c.iconName ? <SFSymbol name={c.iconName} size={Math.min(c.width ?? 24, c.height ?? 24) * scale} color={c.textColor ?? c.fillColor} /> : ['Text', 'Button', 'Input'].includes(c.type) ? c.text ?? c.name : null}</div>)}
  </div>;
}
