// apps/web/src/views/learning/ToolHighlightOverlay.tsx
//
// Overlay that highlights a specific toolbar or inspector control when the
// student clicks "הראה לי איפה" (Show me where). Renders a pulsing spotlight ring.

import React, { useEffect, useState } from 'react';
import { useLearningStore } from '../../stores/learningStore';

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function ToolHighlightOverlay() {
  const highlightTarget = useLearningStore((s) => s.highlightTarget);
  const setHighlightTarget = useLearningStore((s) => s.setHighlightTarget);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);

  useEffect(() => {
    if (!highlightTarget) {
      setTargetRect(null);
      return;
    }

    const findAndMeasure = () => {
      const el = document.querySelector(`[data-tour-target="${highlightTarget}"]`);
      if (el) {
        const rect = el.getBoundingClientRect();
        setTargetRect({
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        });
      } else {
        setTargetRect(null);
      }
    };

    // Initial measure
    findAndMeasure();

    // Re-measure on window resize or scroll
    window.addEventListener('resize', findAndMeasure);
    window.addEventListener('scroll', findAndMeasure, true);

    // Auto-dismiss on click
    const handleGlobalClick = () => {
      setHighlightTarget(null);
    };
    const timer = setTimeout(() => {
      window.addEventListener('click', handleGlobalClick, { once: true });
    }, 200);

    return () => {
      window.removeEventListener('resize', findAndMeasure);
      window.removeEventListener('scroll', findAndMeasure, true);
      window.removeEventListener('click', handleGlobalClick);
      clearTimeout(timer);
    };
  }, [highlightTarget, setHighlightTarget]);

  if (!highlightTarget || !targetRect) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
      {/* Pulsing ring around the target */}
      <div
        style={{
          position: 'absolute',
          top: targetRect.top - 4,
          left: targetRect.left - 4,
          width: targetRect.width + 8,
          height: targetRect.height + 8,
          borderRadius: 8,
          border: '2px solid #3B82F6',
          boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.4), 0 0 16px rgba(59, 130, 246, 0.6)',
          animation: 'pulse 1.5s infinite ease-in-out',
        }}
      />

      {/* Tooltip callout */}
      <div
        dir="rtl"
        style={{
          position: 'absolute',
          top: targetRect.top + targetRect.height + 10,
          left: Math.max(10, targetRect.left - 40),
          backgroundColor: '#1E293B',
          color: '#FFFFFF',
          padding: '6px 12px',
          borderRadius: 8,
          fontSize: 12,
          fontWeight: 600,
          boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
          border: '1px solid #3B82F6',
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>הנה הכלי כאן! לחץ עליו</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            setHighlightTarget(null);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#93C5FD',
            cursor: 'pointer',
            fontSize: 11,
            textDecoration: 'underline',
          }}
        >
          הבנתי
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.98); opacity: 0.8; }
          50% { transform: scale(1.02); opacity: 1; }
          100% { transform: scale(0.98); opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
