// Ported 1:1 from AgenticDesigner/Models/GradientStyle.swift

/// Describes a gradient fill for design nodes.
/// Supports linear and radial gradients with configurable colors, angle, and stops.
export interface GradientStyle {
  /** "linear" or "radial" */
  type: string;
  /** Array of hex color strings, e.g. ["#071B4D", "#126BFF"] */
  colors: string[];
  /** Degrees for linear gradient direction (0 = top-to-bottom, 90 = left-to-right, etc.) */
  angle?: number;
  /** Stop positions between 0.0 and 1.0, must match colors count */
  stops?: number[];
}

export function makeGradientStyle(init: {
  type?: string;
  colors: string[];
  angle?: number;
  stops?: number[];
}): GradientStyle {
  const g: GradientStyle = { type: init.type ?? 'linear', colors: init.colors };
  if (init.angle !== undefined) g.angle = init.angle;
  if (init.stops !== undefined) g.stops = init.stops;
  return g;
}
