import { describe, expect, it } from 'vitest';
import { AllVisualStylePreset } from '../../models/VisualStylePreset';
import { DesignTokenLibrary, DesignTokensPresetsByStyle, premiumArtDirection, premiumDark } from '../DesignTokenLibrary';
import { minimalEditorial } from '../../designSystem/DesignTokens';

describe('DesignTokenLibrary', () => {
  it('resolves all 23 VisualStylePreset cases — DesignTokenLibrary.swift 12-61', () => {
    expect(AllVisualStylePreset.length).toBe(23);
    expect(Object.keys(DesignTokensPresetsByStyle).length).toBe(23);
    for (const style of AllVisualStylePreset) {
      const tokens = DesignTokenLibrary.tokens(style);
      expect(tokens, style).toBeDefined();
      expect(tokens.colors.backgroundPrimary, style).toMatch(/^#[0-9A-F]{6}$/);
      expect(tokens.radius.pill, style).toBe(999);
      expect(tokens, style).toBe(DesignTokensPresetsByStyle[style]);
    }
  });

  it('softFintech colours + spacing — Swift 293-320', () => {
    const t = DesignTokenLibrary.tokens('softFintech');
    expect(t.colors).toEqual({
      backgroundPrimary: '#F5F8FC',
      surfacePrimary: '#FFFFFF',
      surfaceSecondary: '#EEF4F8',
      textPrimary: '#0F172A',
      textSecondary: '#64748B',
      accentPrimary: '#2563EB',
      borderSubtle: '#DDE7F0',
    });
    expect(t.spacing).toEqual({ xs: 8, sm: 12, md: 16, lg: 24, xl: 32, xxl: 48 });
    expect(t.radius).toEqual({ sm: 8, md: 16, lg: 24, xl: 999, pill: 999 });
    expect(t.shadows.md).toBe('0 8px 18px rgba(15,23,42,0.08)');
  });

  it('cinematicMedia colours + typography — Swift 101-115', () => {
    const t = DesignTokenLibrary.tokens('cinematicMedia');
    expect(t.colors.backgroundPrimary).toBe('#000000');
    expect(t.colors.surfacePrimary).toBe('#141414');
    expect(t.colors.surfaceSecondary).toBe('#242424');
    expect(t.colors.accentPrimary).toBe('#E50914');
    expect(t.colors.textSecondary).toBe('#B3B3B3');
    expect(t.typography.title1).toEqual({ fontSize: 34, lineHeight: 40, weight: 'bold' });
    expect(t.typography.headline.weight).toBe('bold');
    expect(t.shadows).toEqual({ sm: 'none', md: 'dark', lg: 'cinematic' });
  });

  it('appleCalm warm palette — Swift 500-519', () => {
    const t = DesignTokenLibrary.tokens('appleCalm');
    expect(t.colors.backgroundPrimary).toBe('#FDFCF8');
    expect(t.colors.surfaceSecondary).toBe('#F4F2EC');
    expect(t.colors.accentPrimary).toBe('#D29841');
    expect(t.colors.textSecondary).toBe('#6B6A68');
    expect(t.spacing.xxl).toBe(56);
    expect(t.typography.caption).toEqual({ fontSize: 13, lineHeight: 18, weight: 'regular' });
  });

  it('immersiveWellnessAudio dark palette — Swift 456-475', () => {
    const t = DesignTokenLibrary.tokens('immersiveWellnessAudio');
    expect(t.colors.backgroundPrimary).toBe('#151827');
    expect(t.colors.surfacePrimary).toBe('#22263A');
    expect(t.colors.surfaceSecondary).toBe('#30364F');
    expect(t.colors.accentPrimary).toBe('#A7F3D0');
    expect(t.colors.borderSubtle).toBe('#3B425D');
    expect(t.typography.title1).toEqual({ fontSize: 40, lineHeight: 46, weight: 'bold' });
    expect(t.radius.xl).toBe(38);
  });

  it('mindfulIllustrated + minimalEditorial — Swift 152-166 / DesignTokens.swift', () => {
    const t = DesignTokenLibrary.tokens('mindfulIllustrated');
    expect(t.colors.backgroundPrimary).toBe('#FFFDF7');
    expect(t.colors.surfaceSecondary).toBe('#D8F2FF');
    expect(t.colors.accentPrimary).toBe('#FF7A00');
    expect(t.colors.textPrimary).toBe('#30305F');
    expect(t.spacing.xxl).toBe(44);
    expect(t.shadows).toEqual({ sm: 'none', md: 'soft', lg: 'floating' });

    expect(DesignTokenLibrary.tokens('minimalEditorial')).toBe(minimalEditorial);
    expect(minimalEditorial.colors.backgroundPrimary).toBe('#F8E1CC');
  });

  it('premiumArtDirection is DesignTokens.premiumDark — Swift 498', () => {
    expect(premiumArtDirection).toBe(premiumDark);
    expect(DesignTokenLibrary.tokens('premiumArtDirection')).toBe(DesignTokenLibrary.tokens('premiumDark'));
    expect(premiumDark.colors.accentPrimary).toBe('#3B82F6');
  });
});
