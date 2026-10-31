// apps/web/src/views/canvas/NodeView.tsx
//
// 1:1 port of Views/NodeView.swift.
// Renders visual shapes, text, inputs, buttons, images, icons, and game artboards.

import React from 'react';
import type { DesignNode } from '@agentic/core';
import SFSymbol from '../../components/SFSymbol';
import { AgentGameView } from '../../game/AgentGameView';
import { GameScenePosterView } from '../../game/GameScenePosterView';
import { useIsCanvasSnapshot } from '../../game/gameContexts';

export interface NodeViewProps {
  node: DesignNode;
  isSelected?: boolean;
}

export function NodeView({ node, isSelected = false }: NodeViewProps) {
  const isCanvasSnapshot = useIsCanvasSnapshot();
  const { style, type } = node;
  const cornerRadius = style.cornerRadius ?? 0;
  const archTop = style.archTopRadius;

  const borderRadius =
    archTop !== undefined
      ? `${archTop}px ${archTop}px ${cornerRadius}px ${cornerRadius}px`
      : `${cornerRadius}px`;

  // Gradient or solid fill
  let background = style.fill ?? '#FFFFFF';
  if (style.gradient && style.gradient.colors && style.gradient.colors.length > 0) {
    const { colors, angle = 180, type: gType } = style.gradient;
    if (gType === 'radial') {
      background = `radial-gradient(circle, ${colors.join(', ')})`;
    } else {
      background = `linear-gradient(${angle}deg, ${colors.join(', ')})`;
    }
  }

  const border = style.stroke
    ? `${style.strokeWidth ?? 1}px solid ${style.stroke}`
    : undefined;

  const boxShadow = style.shadow
    ? `${style.shadow.x}px ${style.shadow.y}px ${style.shadow.radius}px ${style.shadow.color}`
    : undefined;

  const baseStyle: React.CSSProperties = {
    position: 'relative',
    width: node.width,
    height: node.height,
    opacity: style.opacity ?? 1,
    borderRadius,
    background,
    border,
    boxShadow,
    boxSizing: 'border-box',
    overflow: node.clipContent ? 'hidden' : 'visible',
    display: 'flex',
    flexDirection: 'column',
    paddingTop: style.paddingTop ?? 0,
    paddingBottom: style.paddingBottom ?? 0,
    paddingLeft: style.paddingLeft ?? 0,
    paddingRight: style.paddingRight ?? 0,
  };

  // Time picker special case
  if (node.timePicker) {
    return (
      <div id={`canvas-node-${node.id}`} style={baseStyle}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: Math.min(node.height * 0.45, 26),
            fontWeight: 600,
            fontFamily: 'var(--font-mono)',
            color: style.textColor ?? '#FFFFFF',
          }}
        >
          06 : 30
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: 4,
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: 'var(--text-muted)',
          }}
        >
          <SFSymbol name="clock" size={10} />
          <span>time picker</span>
        </div>
      </div>
    );
  }

  // Game scene node
  if (node.gameScene) {
    if (isCanvasSnapshot) {
      return (
        <div id={`canvas-node-${node.id}`} style={baseStyle}>
          <GameScenePosterView
            spec={node.gameScene}
            nodeWidth={node.width}
            nodeHeight={node.height}
          />
        </div>
      );
    }
    return (
      <div id={`canvas-node-${node.id}`} style={baseStyle}>
        <AgentGameView spec={node.gameScene} nodeId={node.id} />
        {!isSelected && (
          <div
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '3px 8px',
              backgroundColor: 'rgba(0, 0, 0, 0.45)',
              borderRadius: 12,
              color: '#FFFFFF',
              fontSize: 10,
              pointerEvents: 'none',
            }}
          >
            <SFSymbol name="cursorarrow.click" size={10} />
            <span>select to play</span>
          </div>
        )}
      </div>
    );
  }

  switch (type) {
    case 'Text': {
      const textAlign = (style.textAlign as React.CSSProperties['textAlign']) ?? 'left';
      const isMultiLine =
        node.textBehavior?.wrap === true ||
        (node.textBehavior?.maxLines ?? 0) > 1 ||
        Boolean(node.text?.includes('\n')) ||
        (node.height > (style.fontSize ?? 16) * 1.8 && node.textBehavior?.wrap !== false);

      const whiteSpace = node.textBehavior?.autoHeight
        ? 'pre-wrap'
        : (!isMultiLine ? 'nowrap' : 'normal');

      return (
        <div
          id={`canvas-node-${node.id}`}
          style={{
            ...baseStyle,
            background: 'transparent',
            color: style.textColor ?? style.fill ?? '#FFFFFF',
            fontSize: style.fontSize ?? 16,
            fontWeight: (style.fontWeight as React.CSSProperties['fontWeight']) ?? 'normal',
            fontFamily: style.fontFamily ?? 'inherit',
            textAlign,
            letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
            lineHeight: style.lineHeight ? `${style.lineHeight}px` : 1.25,
            whiteSpace,
            overflowWrap: 'normal',
            wordBreak: 'normal',
            userSelect: 'none',
          }}
        >
          {node.text ?? ''}
        </div>
      );
    }

    case 'Button': {
      return (
        <div
          id={`canvas-node-${node.id}`}
          style={{
            ...baseStyle,
            alignItems: 'center',
            justifyContent: 'center',
            color: style.textColor ?? '#FFFFFF',
            fontSize: style.fontSize ?? 15,
            fontWeight: (style.fontWeight as React.CSSProperties['fontWeight']) ?? 600,
            fontFamily: style.fontFamily ?? 'inherit',
            cursor: 'default',
          }}
        >
          {node.text ?? 'Button'}
        </div>
      );
    }

    case 'Input': {
      return (
        <div
          id={`canvas-node-${node.id}`}
          style={{
            ...baseStyle,
            justifyContent: 'center',
            paddingLeft: Math.max(14, style.paddingLeft ?? 0),
            paddingRight: Math.max(14, style.paddingRight ?? 0),
            color: style.textColor ?? '#94A3B8',
            fontSize: style.fontSize ?? 14,
            fontFamily: style.fontFamily ?? 'inherit',
          }}
        >
          {node.text ?? 'Input'}
        </div>
      );
    }

    case 'Image': {
      const imageSrc = node.imageSource ?? node.imageName;
      return (
        <div id={`canvas-node-${node.id}`} style={{ ...baseStyle, overflow: 'hidden' }}>
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={node.name}
              style={{
                width: '100%',
                height: '100%',
                objectFit: node.contentMode === 'fit' ? 'contain' : 'cover',
                display: 'block',
              }}
            />
          ) : (
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--text-muted)',
                gap: 6,
              }}
            >
              <SFSymbol name="photo" size={28} />
              <span style={{ fontSize: 11 }}>{node.name}</span>
            </div>
          )}
        </div>
      );
    }

    case 'Icon': {
      const iconName = node.iconName ?? 'star.circle';
      return (
        <div
          id={`canvas-node-${node.id}`}
          style={{
            ...baseStyle,
            background: 'transparent',
            alignItems: 'center',
            justifyContent: 'center',
            color: style.textColor ?? style.fill ?? '#FFFFFF',
          }}
        >
          <SFSymbol name={iconName} size={Math.min(node.width, node.height) * 0.8} />
        </div>
      );
    }

    case 'Frame':
    case 'Rectangle':
    default: {
      return <div id={`canvas-node-${node.id}`} style={baseStyle} />;
    }
  }
}

export default NodeView;
