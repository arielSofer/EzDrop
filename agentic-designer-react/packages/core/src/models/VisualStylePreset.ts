// Ported 1:1 from AgenticDesigner/DesignIntelligence/DesignRecipe.swift
// (VisualStylePreset + LayoutPattern enums only; DesignRecipe itself ships with
// the DesignIntelligence port).

export const AllVisualStylePreset = [
  'softFintech',
  'minimalEditorial',
  'premiumDark',
  'appleCalm',
  'cleanSaaS',
  'energeticFitness',
  'softWellness',
  'luxuryTravel',
  'playfulEcommerce',
  'focusedProductivity',
  'immersiveTravelNature',
  'glassRealEstate',
  'darkBeverageEditorial',
  'softProductCommerce',
  'immersiveWellnessAudio',
  'premiumAudioDark',
  'premiumArtDirection',
  // Production-app systems distilled from the local AppShots corpus.
  'socialContent',
  'messagingUtility',
  'cinematicMedia',
  'commerceUtility',
  'healthMetrics',
  'mindfulIllustrated',
] as const;
export type VisualStylePreset = (typeof AllVisualStylePreset)[number];

export function isVisualStylePreset(value: unknown): value is VisualStylePreset {
  return typeof value === 'string' && (AllVisualStylePreset as readonly string[]).includes(value);
}

export const AllLayoutPattern = [
  'mobileHeroCards',
  'mobileOnboardingCarousel',
  'mobileDashboard',
  'mobileFormCentered',
  'mobileFeed',
  'mobileSearchExplore',
  'mobileProgressHome',
  'mobileCheckout',
  'mobileChat',
] as const;
export type LayoutPattern = (typeof AllLayoutPattern)[number];
