// Renders an SF Symbol name (as used verbatim throughout the ported Swift
// code) with the closest lucide-react icon. Unmapped or unknown names render
// a small initials badge instead of disappearing, so a missing mapping is
// visible in the UI rather than silent.
import * as Lucide from 'lucide-react';
import { sfSymbolMap } from './sfSymbolMap';

export interface SFSymbolProps {
  name: string;
  size?: number;
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  color?: string;
  className?: string;
  title?: string;
}

const strokeForWeight: Record<NonNullable<SFSymbolProps['weight']>, number> = {
  regular: 1.75,
  medium: 2,
  semibold: 2.25,
  bold: 2.5,
};

/** Initials shown when a symbol has no mapping: first letter of the first two dot-segments. */
function initialsFor(name: string): string {
  const parts = name.split('.').filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? '').join('');
  return (letters || '?').toUpperCase();
}

export function lucideNameForSFSymbol(name: string): string | undefined {
  return sfSymbolMap[name];
}

export function SFSymbol({
  name,
  size = 14,
  weight = 'regular',
  color,
  className,
  title,
}: SFSymbolProps) {
  const lucideName = sfSymbolMap[name];
  const icons = Lucide as unknown as Record<string, React.ComponentType<{
    size?: number; strokeWidth?: number; color?: string; className?: string;
  }> | undefined>;
  const Icon = lucideName ? icons[lucideName] : undefined;

  if (Icon) {
    return (
      <span className={className} title={title ?? name} style={{ display: 'inline-flex', lineHeight: 0 }}>
        <Icon size={size} strokeWidth={strokeForWeight[weight]} color={color} />
      </span>
    );
  }

  return (
    <span
      className={className}
      title={title ?? name}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        fontSize: Math.max(7, size * 0.5),
        fontWeight: 700,
        letterSpacing: '-0.02em',
        border: '1px solid currentColor',
        borderRadius: Math.max(2, size * 0.2),
        opacity: 0.75,
        color,
      }}
    >
      {initialsFor(name)}
    </span>
  );
}

export default SFSymbol;
