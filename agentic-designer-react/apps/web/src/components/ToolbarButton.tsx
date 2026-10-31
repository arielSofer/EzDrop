// apps/web/src/components/ToolbarButton.tsx
//
// 1:1 port of EditorView's toolbar button shape:
// VStack(icon 14pt, title 10pt), frame 48×40, .buttonStyle(.plain), with optional dropdown menu.

import React, { useState, useRef, useEffect } from 'react';
import SFSymbol from './SFSymbol';

export interface MenuItem {
  label: string;
  icon?: string;
  action: () => void;
  disabled?: boolean;
  destructive?: boolean;
  divider?: boolean;
}

export interface ToolbarButtonProps {
  icon: string;
  title?: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  destructive?: boolean;
  badge?: React.ReactNode;
  menuItems?: MenuItem[];
  className?: string;
  style?: React.CSSProperties;
  color?: string;
}

export function ToolbarButton({
  icon,
  title,
  onClick,
  disabled = false,
  active = false,
  destructive = false,
  badge,
  menuItems,
  className,
  style,
  color,
}: ToolbarButtonProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const handleClick = (e: React.MouseEvent) => {
    if (disabled) return;
    if (menuItems && menuItems.length > 0) {
      e.stopPropagation();
      setMenuOpen(!menuOpen);
    } else if (onClick) {
      onClick();
    }
  };

  const buttonColor = disabled
    ? 'var(--text-dim)'
    : destructive
    ? 'var(--accent-red)'
    : color ?? (active ? 'var(--accent-blue)' : 'var(--text-secondary)');

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        title={title}
        disabled={disabled}
        onClick={handleClick}
        className={className}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 44,
          height: 40,
          padding: '2px 6px',
          borderRadius: 'var(--radius-md)',
          backgroundColor: active ? 'var(--bg-active)' : 'transparent',
          color: buttonColor,
          opacity: disabled ? 0.45 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
          ...style,
        }}
        onMouseEnter={(e) => {
          if (!disabled && !active) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!disabled && !active) e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <SFSymbol name={icon} size={15} color={buttonColor} />
          {badge}
        </div>
        {title && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              marginTop: 2,
              lineHeight: 1.1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 58,
            }}
          >
            {title}
          </span>
        )}
      </button>

      {menuOpen && menuItems && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            minWidth: 160,
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border-color)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            zIndex: 1000,
            padding: '4px 0',
            backdropFilter: 'blur(16px)',
          }}
        >
          {menuItems.map((item, idx) => {
            if (item.divider) {
              return (
                <div
                  key={idx}
                  style={{ height: 1, backgroundColor: 'var(--border-color)', margin: '4px 0' }}
                />
              );
            }
            return (
              <button
                key={idx}
                disabled={item.disabled}
                onClick={() => {
                  setMenuOpen(false);
                  item.action();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  padding: '6px 12px',
                  textAlign: 'left',
                  fontSize: 12,
                  color: item.disabled
                    ? 'var(--text-dim)'
                    : item.destructive
                    ? 'var(--accent-red)'
                    : 'var(--text-primary)',
                  cursor: item.disabled ? 'not-allowed' : 'pointer',
                  opacity: item.disabled ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                  if (!item.disabled) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (!item.disabled) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {item.icon && <SFSymbol name={item.icon} size={13} />}
                <span style={{ flex: 1 }}>{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ToolbarButton;
