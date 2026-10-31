// Ported 1:1 from AgenticDesigner/DesignIntelligence/DesignTokenLibrary.swift
// (the DesignTokenLibrary enum + the `extension DesignTokens` holding every
// preset's token data; `minimalEditorial` is declared in DesignSystem/
// DesignTokens.swift and is imported from designSystem here.)

import type { DesignTokens } from '../designSystem/DesignTokens';
import { minimalEditorial } from '../designSystem/DesignTokens';
import type { VisualStylePreset } from '../models/VisualStylePreset';

// MARK: - extension DesignTokens

// Neutral content-first chrome, learned from Instagram-style media apps.
export const socialContent: DesignTokens = {
  colors: {
    backgroundPrimary: '#FFFFFF', surfacePrimary: '#FFFFFF', surfaceSecondary: '#F2F3F5',
    textPrimary: '#111111', textSecondary: '#737373', accentPrimary: '#0095F6', borderSubtle: '#DBDDE1',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 },
  typography: {
    title1: { fontSize: 30, lineHeight: 36, weight: 'bold' },
    headline: { fontSize: 20, lineHeight: 26, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 21, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 },
  shadows: { sm: 'none', md: 'subtle', lg: 'soft' },
};

// Native-feeling grouped lists and chat surfaces, learned from WhatsApp.
export const messagingUtility: DesignTokens = {
  colors: {
    backgroundPrimary: '#F2F2F7', surfacePrimary: '#FFFFFF', surfaceSecondary: '#E9E9EE',
    textPrimary: '#111111', textSecondary: '#6D6D72', accentPrimary: '#25D366', borderSubtle: '#D8D8DC',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 },
  typography: {
    title1: { fontSize: 30, lineHeight: 36, weight: 'bold' },
    headline: { fontSize: 20, lineHeight: 26, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 },
  shadows: { sm: 'none', md: 'subtle', lg: 'soft' },
};

// Image-led dark entertainment, learned from Netflix's restrained chrome.
export const cinematicMedia: DesignTokens = {
  colors: {
    backgroundPrimary: '#000000', surfacePrimary: '#141414', surfaceSecondary: '#242424',
    textPrimary: '#FFFFFF', textSecondary: '#B3B3B3', accentPrimary: '#E50914', borderSubtle: '#333333',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 },
  typography: {
    title1: { fontSize: 34, lineHeight: 40, weight: 'bold' },
    headline: { fontSize: 21, lineHeight: 27, weight: 'bold' },
    body: { fontSize: 15, lineHeight: 21, weight: 'regular' },
    caption: { fontSize: 11, lineHeight: 15, weight: 'regular' },
  },
  radius: { sm: 4, md: 8, lg: 12, xl: 18, pill: 999 },
  shadows: { sm: 'none', md: 'dark', lg: 'cinematic' },
};

// Dense commerce utility with a plum/green brand pair, learned from Shipt.
export const commerceUtility: DesignTokens = {
  colors: {
    backgroundPrimary: '#FFFFFF', surfacePrimary: '#FFFFFF', surfaceSecondary: '#F2ECFA',
    textPrimary: '#251132', textSecondary: '#716879', accentPrimary: '#2D123E', borderSubtle: '#E3DEE7',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 },
  typography: {
    title1: { fontSize: 30, lineHeight: 36, weight: 'bold' },
    headline: { fontSize: 20, lineHeight: 26, weight: 'bold' },
    body: { fontSize: 15, lineHeight: 21, weight: 'regular' },
    caption: { fontSize: 11, lineHeight: 15, weight: 'regular' },
  },
  radius: { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 },
  shadows: { sm: 'none', md: 'subtle', lg: 'soft' },
};

// High-information health UI, learned from MyFitnessPal.
export const healthMetrics: DesignTokens = {
  colors: {
    backgroundPrimary: '#F7F8FA', surfacePrimary: '#FFFFFF', surfaceSecondary: '#EEF3F8',
    textPrimary: '#172133', textSecondary: '#657184', accentPrimary: '#0066EE', borderSubtle: '#DDE3EA',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 40 },
  typography: {
    title1: { fontSize: 32, lineHeight: 38, weight: 'bold' },
    headline: { fontSize: 20, lineHeight: 26, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 21, weight: 'regular' },
    caption: { fontSize: 11, lineHeight: 15, weight: 'regular' },
  },
  radius: { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 },
  shadows: { sm: 'none', md: 'subtle', lg: 'soft' },
};

// Friendly illustration-led habit tracking, learned from Less.
export const mindfulIllustrated: DesignTokens = {
  colors: {
    backgroundPrimary: '#FFFDF7', surfacePrimary: '#FFFFFF', surfaceSecondary: '#D8F2FF',
    textPrimary: '#30305F', textSecondary: '#72758A', accentPrimary: '#FF7A00', borderSubtle: '#E8E5DB',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 20, xl: 28, xxl: 44 },
  typography: {
    title1: { fontSize: 32, lineHeight: 39, weight: 'bold' },
    headline: { fontSize: 21, lineHeight: 28, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 16, lg: 24, xl: 30, pill: 999 },
  shadows: { sm: 'none', md: 'soft', lg: 'floating' },
};

export const luxuryTravel: DesignTokens = {
  colors: {
    backgroundPrimary: '#F7F3EC',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#EFE7D8',
    textPrimary: '#2B2118',
    textSecondary: '#8A7B66',
    accentPrimary: '#B9862F',
    borderSubtle: '#E7DCC8',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 34, lineHeight: 42, weight: 'bold' },
    headline: { fontSize: 22, lineHeight: 30, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 18, lg: 26, xl: 999, pill: 999 },
  shadows: {
    sm: '0 1px 2px rgba(43,33,24,0.06)',
    md: '0 8px 18px rgba(43,33,24,0.10)',
    lg: '0 18px 40px rgba(43,33,24,0.14)',
  },
};

export const cleanSaaS: DesignTokens = {
  colors: {
    backgroundPrimary: '#F8FAFC',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#EEF2F7',
    textPrimary: '#0F172A',
    textSecondary: '#64748B',
    accentPrimary: '#4F46E5',
    borderSubtle: '#E2E8F0',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 36, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 8, md: 14, lg: 20, xl: 999, pill: 999 },
  shadows: {
    sm: '0 1px 2px rgba(15,23,42,0.05)',
    md: '0 8px 18px rgba(15,23,42,0.08)',
    lg: '0 18px 40px rgba(15,23,42,0.12)',
  },
};

export const softWellness: DesignTokens = {
  colors: {
    backgroundPrimary: '#F6F4F1',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#ECE8E1',
    textPrimary: '#33302B',
    textSecondary: '#8B8577',
    accentPrimary: '#7C9A6D',
    borderSubtle: '#E3DED4',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 34, lineHeight: 42, weight: 'semibold' },
    headline: { fontSize: 22, lineHeight: 30, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 26, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 12, md: 20, lg: 28, xl: 999, pill: 999 },
  shadows: {
    sm: '0 1px 2px rgba(51,48,43,0.05)',
    md: '0 8px 18px rgba(51,48,43,0.08)',
    lg: '0 18px 40px rgba(51,48,43,0.12)',
  },
};

export const playfulEcommerce: DesignTokens = {
  colors: {
    backgroundPrimary: '#FFF7F0',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#FFEDE0',
    textPrimary: '#1F1B16',
    textSecondary: '#8C8177',
    accentPrimary: '#F0653C',
    borderSubtle: '#F3E3D5',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 36, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'bold' },
    body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 12, md: 20, lg: 28, xl: 999, pill: 999 },
  shadows: {
    sm: '0 1px 2px rgba(31,27,22,0.05)',
    md: '0 8px 18px rgba(31,27,22,0.08)',
    lg: '0 18px 40px rgba(31,27,22,0.12)',
  },
};

export const focusedProductivity: DesignTokens = {
  colors: {
    backgroundPrimary: '#F4F5F7',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#E9ECEF',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    accentPrimary: '#0F766E',
    borderSubtle: '#E0E4E8',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 34, lineHeight: 42, weight: 'bold' },
    headline: { fontSize: 22, lineHeight: 30, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 8, md: 14, lg: 20, xl: 999, pill: 999 },
  shadows: {
    sm: '0 1px 2px rgba(17,24,39,0.05)',
    md: '0 8px 18px rgba(17,24,39,0.08)',
    lg: '0 18px 40px rgba(17,24,39,0.12)',
  },
};

export const softFintech: DesignTokens = {
  colors: {
    backgroundPrimary: '#F5F8FC',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#EEF4F8',
    textPrimary: '#0F172A',
    textSecondary: '#64748B',
    accentPrimary: '#2563EB',
    borderSubtle: '#DDE7F0',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 36, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 8, md: 16, lg: 24, xl: 999, pill: 999 },
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 8px 18px rgba(15,23,42,0.08)',
    lg: '0 18px 40px rgba(15,23,42,0.12)',
  },
};

export const premiumDark: DesignTokens = {
  colors: {
    backgroundPrimary: '#000000',
    surfacePrimary: '#111111',
    surfaceSecondary: '#222222',
    textPrimary: '#FFFFFF',
    textSecondary: '#888888',
    accentPrimary: '#3B82F6',
    borderSubtle: '#333333',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 36, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 8, md: 16, lg: 24, xl: 32, pill: 999 },
  shadows: {
    sm: '0 1px 2px rgba(0,0,0,0.2)',
    md: '0 4px 6px rgba(0,0,0,0.3)',
    lg: '0 10px 15px rgba(0,0,0,0.4)',
  },
};

export const energeticFitness: DesignTokens = {
  colors: {
    backgroundPrimary: '#F7FAF7',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#EAF3EE',
    textPrimary: '#10201A',
    textSecondary: '#63756D',
    accentPrimary: '#1F9D6A',
    borderSubtle: '#D7E5DE',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 22, xl: 30, xxl: 44 },
  typography: {
    title1: { fontSize: 38, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 23, lineHeight: 30, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 16, lg: 24, xl: 32, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

export const immersiveTravelNature: DesignTokens = {
  colors: {
    backgroundPrimary: '#294D2A',
    surfacePrimary: '#F9FAF6',
    surfaceSecondary: '#DDE8D3',
    textPrimary: '#102414',
    textSecondary: '#5F7564',
    accentPrimary: '#D9F99D',
    borderSubtle: '#B9CAB4',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 34, xxl: 52 },
  typography: {
    title1: { fontSize: 38, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 22, lineHeight: 30, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 18, lg: 28, xl: 36, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

export const glassRealEstate: DesignTokens = {
  colors: {
    backgroundPrimary: '#A7B0BA',
    surfacePrimary: '#F8FAFC',
    surfaceSecondary: '#E2E8F0',
    textPrimary: '#0F172A',
    textSecondary: '#64748B',
    accentPrimary: '#2563EB',
    borderSubtle: '#CBD5E1',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 32, xxl: 48 },
  typography: {
    title1: { fontSize: 36, lineHeight: 42, weight: 'bold' },
    headline: { fontSize: 22, lineHeight: 30, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 18, lg: 26, xl: 34, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

export const darkBeverageEditorial: DesignTokens = {
  colors: {
    backgroundPrimary: '#121111',
    surfacePrimary: '#1F1A1C',
    surfaceSecondary: '#33252A',
    textPrimary: '#FFFFFF',
    textSecondary: '#C8B8BE',
    accentPrimary: '#F43F5E',
    borderSubtle: '#44343A',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 36, xxl: 56 },
  typography: {
    title1: { fontSize: 42, lineHeight: 48, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 18, lg: 28, xl: 38, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

export const softProductCommerce: DesignTokens = {
  colors: {
    backgroundPrimary: '#FCE7F3',
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#FDF2F8',
    textPrimary: '#111827',
    textSecondary: '#6B7280',
    accentPrimary: '#EC4899',
    borderSubtle: '#FBCFE8',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 34, xxl: 52 },
  typography: {
    title1: { fontSize: 38, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 22, lineHeight: 30, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 18, lg: 28, xl: 38, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

export const immersiveWellnessAudio: DesignTokens = {
  colors: {
    backgroundPrimary: '#151827',
    surfacePrimary: '#22263A',
    surfaceSecondary: '#30364F',
    textPrimary: '#FFFFFF',
    textSecondary: '#B8C1D9',
    accentPrimary: '#A7F3D0',
    borderSubtle: '#3B425D',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 34, xxl: 52 },
  typography: {
    title1: { fontSize: 40, lineHeight: 46, weight: 'bold' },
    headline: { fontSize: 23, lineHeight: 31, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 18, lg: 28, xl: 38, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

export const premiumAudioDark: DesignTokens = {
  colors: {
    backgroundPrimary: '#080A12',
    surfacePrimary: '#121827',
    surfaceSecondary: '#1E293B',
    textPrimary: '#FFFFFF',
    textSecondary: '#A8B3CF',
    accentPrimary: '#7C3AED',
    borderSubtle: '#263247',
  },
  spacing: { xs: 6, sm: 10, md: 16, lg: 24, xl: 34, xxl: 52 },
  typography: {
    title1: { fontSize: 42, lineHeight: 48, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'semibold' },
    body: { fontSize: 15, lineHeight: 22, weight: 'regular' },
    caption: { fontSize: 12, lineHeight: 16, weight: 'regular' },
  },
  radius: { sm: 10, md: 18, lg: 28, xl: 40, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

/** `static let premiumArtDirection = DesignTokens.premiumDark` */
export const premiumArtDirection: DesignTokens = premiumDark;

export const appleCalm: DesignTokens = {
  colors: {
    backgroundPrimary: '#FDFCF8', // Warm light cream
    surfacePrimary: '#FFFFFF',
    surfaceSecondary: '#F4F2EC', // Light warm grey/beige
    textPrimary: '#1A1A1A',
    textSecondary: '#6B6A68',
    accentPrimary: '#D29841', // Sophisticated gold/tan
    borderSubtle: '#EAE7E0',
  },
  spacing: { xs: 8, sm: 12, md: 16, lg: 24, xl: 36, xxl: 56 },
  typography: {
    title1: { fontSize: 36, lineHeight: 44, weight: 'bold' },
    headline: { fontSize: 24, lineHeight: 32, weight: 'semibold' },
    body: { fontSize: 16, lineHeight: 24, weight: 'regular' },
    caption: { fontSize: 13, lineHeight: 18, weight: 'regular' },
  },
  radius: { sm: 8, md: 14, lg: 20, xl: 28, pill: 999 },
  shadows: { sm: 'soft', md: 'medium', lg: 'floating' },
};

/** Every `DesignTokens` static preset, by VisualStylePreset raw value. */
export const DesignTokensPresetsByStyle: Readonly<Record<VisualStylePreset, DesignTokens>> = {
  softFintech,
  minimalEditorial,
  premiumDark,
  appleCalm,
  cleanSaaS,
  energeticFitness,
  softWellness,
  luxuryTravel,
  playfulEcommerce,
  focusedProductivity,
  immersiveTravelNature,
  glassRealEstate,
  darkBeverageEditorial,
  softProductCommerce,
  immersiveWellnessAudio,
  premiumAudioDark,
  premiumArtDirection,
  socialContent,
  messagingUtility,
  cinematicMedia,
  commerceUtility,
  healthMetrics,
  mindfulIllustrated,
};

export const DesignTokenLibrary = {
  tokens(style: VisualStylePreset): DesignTokens {
    switch (style) {
      case 'softFintech':
        return softFintech;
      case 'minimalEditorial':
        return minimalEditorial;
      case 'premiumDark':
        return premiumDark;
      case 'energeticFitness':
        return energeticFitness;
      case 'immersiveTravelNature':
        return immersiveTravelNature;
      case 'glassRealEstate':
        return glassRealEstate;
      case 'darkBeverageEditorial':
        return darkBeverageEditorial;
      case 'softProductCommerce':
        return softProductCommerce;
      case 'immersiveWellnessAudio':
        return immersiveWellnessAudio;
      case 'premiumAudioDark':
        return premiumAudioDark;
      case 'premiumArtDirection':
        return premiumArtDirection;
      case 'socialContent':
        return socialContent;
      case 'messagingUtility':
        return messagingUtility;
      case 'cinematicMedia':
        return cinematicMedia;
      case 'commerceUtility':
        return commerceUtility;
      case 'healthMetrics':
        return healthMetrics;
      case 'mindfulIllustrated':
        return mindfulIllustrated;
      case 'appleCalm':
        return appleCalm;
      case 'luxuryTravel':
        return luxuryTravel;
      case 'cleanSaaS':
        return cleanSaaS;
      case 'softWellness':
        return softWellness;
      case 'playfulEcommerce':
        return playfulEcommerce;
      case 'focusedProductivity':
        return focusedProductivity;
    }
  },
};
