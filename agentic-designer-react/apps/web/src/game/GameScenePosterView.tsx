// apps/web/src/game/GameScenePosterView.tsx
//
// Ported 1:1 from AgenticDesigner/Views/GameScenePosterView.swift.
// Static, screenshot/export-safe rendering of a GameSceneSpec.
// Renders the background (gradient or solid), non-template entities
// (shapes or sprites), and a play badge overlay.

import React from 'react';
import type { GameEntity, GameSceneSpec } from '@agentic/core';
import SFSymbol from '../components/SFSymbol';

export interface GameScenePosterViewProps {
  spec: GameSceneSpec;
  nodeWidth: number;
  nodeHeight: number;
  className?: string;
  style?: React.CSSProperties;
}

export function GameScenePosterView({
  spec,
  nodeWidth,
  nodeHeight,
  className,
  style,
}: GameScenePosterViewProps) {
  const scaleX = nodeWidth / Math.max(spec.width, 1);
  const scaleY = nodeHeight / Math.max(spec.height, 1);

  const backgroundStyle: React.CSSProperties =
    spec.backgroundGradient && spec.backgroundGradient.length >= 2
      ? {
          background: `linear-gradient(180deg, ${spec.backgroundGradient.join(', ')})`,
        }
      : {
          backgroundColor: spec.backgroundColor || '#1E1F23',
        };

  const entities = (spec.entities || []).filter((e) => !e.isTemplate);
  const playBadgeSize = Math.min(nodeWidth, nodeHeight) * 0.14;

  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: nodeWidth,
        height: nodeHeight,
        overflow: 'hidden',
        ...backgroundStyle,
        ...style,
      }}
    >
      {entities.map((entity) => (
        <EntityPosterView
          key={entity.id}
          entity={entity}
          scaleX={scaleX}
          scaleY={scaleY}
        />
      ))}

      {/* Play badge overlay */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgba(255, 255, 255, 0.85)',
          filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))',
        }}
      >
        <SFSymbol name="play.circle.fill" size={playBadgeSize} />
      </div>
    </div>
  );
}

function EntityPosterView({
  entity,
  scaleX,
  scaleY,
}: {
  entity: GameEntity;
  scaleX: number;
  scaleY: number;
}) {
  const width = entity.width * scaleX;
  const height = entity.height * scaleY;
  const left = entity.x * scaleX;
  const top = entity.y * scaleY;

  const sprite = entity.sprite || entity.frames?.[0];

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width,
        height,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {sprite ? (
        <img
          src={sprite}
          alt={entity.name || 'entity'}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            borderRadius: entity.circleBody ? Math.min(width, height) / 2 : 4,
            backgroundColor: entity.color || '#3B82F6',
          }}
        />
      )}
    </div>
  );
}

export default GameScenePosterView;
