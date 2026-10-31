// Ported 1:1 from AgenticDesigner/DesignSystem/DesignTokens.swift

import type { GradientStyle } from '../models/GradientStyle';

export interface ColorTokens {
  backgroundPrimary: string;
  surfacePrimary: string;
  surfaceSecondary: string;
  textPrimary: string;
  textSecondary: string;
  accentPrimary: string;
  borderSubtle: string;
  // Extended semantic colors
  accentSecondary?: string;
  success?: string;
  warning?: string;
  error?: string;
  cardGradientStart?: string;
  cardGradientEnd?: string;
}

export interface SpacingTokens {
  xs: number;
  sm: number;
  md: number;
  lg: number;
  xl: number;
  xxl: number;
}

export interface TextStyleToken {
  fontSize: number;
  lineHeight: number;
  /** "regular", "semibold", "bold" */
  weight: string;
  letterSpacing?: number;
}

export interface TypographyTokens {
  title1: TextStyleToken;
  headline: TextStyleToken;
  body: TextStyleToken;
  caption: TextStyleToken;
  // Extended text styles
  subtitle?: TextStyleToken;
  overline?: TextStyleToken;
  button?: TextStyleToken;
  navLabel?: TextStyleToken;
}

export interface RadiusTokens {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  pill: number;
}

export interface ShadowTokens {
  sm: string;
  md: string;
  lg: string;
}

export interface GradientTokens {
  heroCard: GradientStyle;
  subtleBackground: GradientStyle;
  creditCard?: GradientStyle;
  accent?: GradientStyle;
}

export interface DesignTokens {
  colors: ColorTokens;
  spacing: SpacingTokens;
  typography: TypographyTokens;
  radius: RadiusTokens;
  shadows: ShadowTokens;
  gradients?: GradientTokens;
}

/** `DesignTokens.minimalEditorial` */
export const minimalEditorial: DesignTokens = {
  colors: {
    backgroundPrimary: '#F8E1CC',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#F7F7F5',
    textPrimary: '#111111',
    textSecondary: '#7A7A7A',
    accentPrimary: '#111111',
    borderSubtle: '#E8E3DD',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
    xl: 32,
    xxl: 48,
  },
  typography: {
    title1: { fontSize: 42, lineHeight: 48, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
    caption: { fontSize: 13, lineHeight: 18, weight: 'regular' },
  },
  radius: {
    sm: 8,
    md: 14,
    lg: 24,
    xl: 36,
    pill: 999,
  },
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 6px rgba(0,0,0,0.05)',
    lg: '0 10px 15px rgba(0,0,0,0.05)',
  },
};

/** Static members of the Swift `DesignTokens` extension. */
export const DesignTokensPresets = {
  minimalEditorial,
} as const;
