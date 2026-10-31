// Ported 1:1 from AgenticDesigner/DesignIntelligence/VisualArtDirection.swift

export const AllVisualProductCategory = [
  'travelNature',
  'realEstateLuxury',
  'beverageBrand',
  'ecommerceProduct',
  'meditationWellness',
  'fitnessPerformance',
  'fintechSoft',
  'musicAudio',
  'fashionRetail',
  'foodDelivery',
  'generic',
] as const;
export type VisualProductCategory = (typeof AllVisualProductCategory)[number];

export const AllPresentationMode = ['appScreen', 'presentationShot'] as const;
export type PresentationMode = (typeof AllPresentationMode)[number];

export interface VisualRecipe {
  name: string;
  category: VisualProductCategory;
  stylePreset: string;
  presentationMode: PresentationMode;
  visualRules: string[];
  recommendedComponents: string[];
  assetPlaceholders: string[];
  qualityRules: string[];
}

export const VisualProductCategoryClassifier = {
  classify(prompt: string): VisualProductCategory {
    const text = prompt.toLowerCase();

    if (
      text.includes('real estate') ||
      text.includes('property') ||
      text.includes('apartment') ||
      text.includes('villa')
    ) {
      return 'realEstateLuxury';
    }

    if (
      text.includes('juice') ||
      text.includes('beverage') ||
      text.includes('drink') ||
      text.includes('smoothie')
    ) {
      return 'beverageBrand';
    }

    if (
      text.includes('meditation') ||
      text.includes('wellness') ||
      text.includes('mindful') ||
      text.includes('calm') ||
      text.includes('מדיטציה') ||
      text.includes('רוגע') ||
      text.includes('מיינדפולנס')
    ) {
      return 'meditationWellness';
    }

    if (
      text.includes('fitness') ||
      text.includes('workout') ||
      text.includes('gym') ||
      text.includes('run') ||
      text.includes('running') ||
      text.includes('jog') ||
      text.includes('marathon') ||
      text.includes('training') ||
      text.includes('pace') ||
      text.includes('כושר') ||
      text.includes('אימון') ||
      text.includes('ריצה') ||
      text.includes('ריצות') ||
      text.includes('ספורט') ||
      text.includes('קצב')
    ) {
      return 'fitnessPerformance';
    }

    if (
      (text.includes('headphone') || text.includes('speaker')) &&
      (text.includes('shop') || text.includes('store') || text.includes('sell') || text.includes('ecommerce') || text.includes('product'))
    ) {
      return 'ecommerceProduct';
    }

    if (
      text.includes('spotify') ||
      text.includes('music') ||
      text.includes('album') ||
      text.includes('artist') ||
      text.includes('playlist') ||
      text.includes('song') ||
      text.includes('podcast') ||
      text.includes('audio') ||
      text.includes('headphone') ||
      text.includes('speaker') ||
      text.includes('מוזיקה') ||
      text.includes('שירים') ||
      text.includes('פלייליסט') ||
      text.includes('ספוטיפיי')
    ) {
      return 'musicAudio';
    }

    if (
      text.includes('travel') ||
      text.includes('trip') ||
      text.includes('journey') ||
      text.includes('hotel') ||
      text.includes('destination') ||
      text.includes('טיול') ||
      text.includes('נסיעה') ||
      text.includes('מלון') ||
      text.includes('חופשה')
    ) {
      return 'travelNature';
    }

    if (
      text.includes('shop') ||
      text.includes('store') ||
      text.includes('product') ||
      text.includes('ecommerce')
    ) {
      return 'ecommerceProduct';
    }

    if (
      text.includes('bank') ||
      text.includes('finance') ||
      text.includes('broker') ||
      text.includes('portfolio') ||
      text.includes('stock') ||
      text.includes('trading') ||
      text.includes('trade') ||
      text.includes('invest') ||
      text.includes('crypto') ||
      text.includes('wallet') ||
      text.includes('מניות') ||
      text.includes('מסחר') ||
      text.includes('השקעות') ||
      text.includes('קריפטו') ||
      text.includes('ארנק') ||
      text.includes('פורטפוליו')
    ) {
      return 'fintechSoft';
    }

    if (
      text.includes('fashion') ||
      text.includes('clothing') ||
      text.includes('retail')
    ) {
      return 'fashionRetail';
    }

    if (
      text.includes('food') ||
      text.includes('restaurant') ||
      text.includes('delivery')
    ) {
      return 'foodDelivery';
    }

    return 'generic';
  },
};

export const PresentationModeClassifier = {
  classify(prompt: string): PresentationMode {
    const text = prompt.toLowerCase();

    if (
      text.includes('presentation') ||
      text.includes('showcase') ||
      text.includes('dribbble') ||
      text.includes('portfolio') ||
      text.includes('concept') ||
      text.includes('inspiration') ||
      text.includes('like the examples') ||
      text.includes('premium app concept')
    ) {
      return 'presentationShot';
    }

    return 'appScreen';
  },
};

function fitnessPerformanceArt(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'fitnessPerformanceArt',
    category: 'fitnessPerformance',
    stylePreset: 'energeticFitness',
    presentationMode,
    visualRules: [
      'Use energetic but controlled sport imagery: runner, workout, route, pace, heart-rate or progress visuals.',
      'Use clear performance hierarchy: one main metric or action, then compact supporting stats.',
      'Use strong contrast, breathable cards and one warm/active accent. Avoid random ecommerce or finance language.',
      'Image-led fitness screens should feel motivational, not like a stock trading dashboard.',
    ],
    recommendedComponents: [
      'imageHero',
      'metricCard',
      'progressCard',
      'workoutCard',
      'statCard',
      'primaryCTA',
      'bottomNavBar',
    ],
    assetPlaceholders: [
      'running_trail',
      'fitness_workout',
      'route_map',
    ],
    qualityRules: [
      'Use fitness copy only: pace, distance, route, goal, recovery, activity, start run.',
      'Never use portfolio, shop, cart, stock, buy, sell, deposit, transfer or market labels for fitness screens.',
      'Keep dark sections readable with explicit light text colors.',
    ],
  };
}

function travelNatureShowcase(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'travelNatureShowcase',
    category: 'travelNature',
    stylePreset: 'immersiveTravelNature',
    presentationMode,
    visualRules: [
      'Use large scenic image cards as the dominant element.',
      'Use deep green / forest palette with white cards over imagery.',
      'Use overlay gradients for text readability.',
      'Prefer rounded mobile screens, destination cards, maps/details and gallery strips.',
    ],
    recommendedComponents: [
      'travelHeroScreen',
      'travelDiscoverScreen',
      'travelDetailScreen',
      'travelHeroCard',
      'destinationCard',
      'galleryStrip',
      'floatingCTA',
    ],
    assetPlaceholders: [
      'travel_forest',
      'travel_mountain',
      'travel_lake',
    ],
    qualityRules: [
      'The image must be the hero.',
      'Keep text minimal and high contrast.',
      'Use one dominant typographic hero.',
    ],
  };
}

function glassRealEstateShowcase(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'glassRealEstateShowcase',
    category: 'realEstateLuxury',
    stylePreset: 'glassRealEstate',
    presentationMode,
    visualRules: [
      'Use architectural imagery and blue/gray backgrounds.',
      'Use glassmorphism cards, soft blur overlays and large property heroes.',
      'Make price or property title visually dominant.',
    ],
    recommendedComponents: [
      'propertySearchScreen',
      'propertyHeroCard',
      'propertyDetailCard',
      'apartmentCard',
      'amenityRow',
      'bookingCTA',
    ],
    assetPlaceholders: [
      'real_estate_building',
      'apartment_interior',
      'city_skyline',
    ],
    qualityRules: [
      'Use soft shadows and glass cards.',
      'Keep property information readable.',
      'Avoid generic rectangle layouts.',
    ],
  };
}

function darkBeverageEditorial(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'darkBeverageEditorial',
    category: 'beverageBrand',
    stylePreset: 'darkBeverageEditorial',
    presentationMode,
    visualRules: [
      'Use dark background with full-bleed product or fruit imagery.',
      'Use white typography and high contrast CTA.',
      'Use product variation strips and editorial brand typography.',
    ],
    recommendedComponents: [
      'beverageHeroScreen',
      'flavorVariationStrip',
      'beverageProductCard',
      'priceCTA',
      'imageBackgroundOverlay',
    ],
    assetPlaceholders: [
      'berries_dark',
      'juice_bottle',
      'fruit_texture',
    ],
    qualityRules: [
      'Make the product feel premium and tactile.',
      'Use one strong hero object.',
      'Avoid bright random colors.',
    ],
  };
}

function softProductCommerce(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'softProductCommerce',
    category: 'ecommerceProduct',
    stylePreset: 'softProductCommerce',
    presentationMode,
    visualRules: [
      'Use pastel background, large product hero and rounded product cards.',
      'Use category chips, product grids and soft shadows.',
    ],
    recommendedComponents: [
      'productHeroScreen',
      'productHeroCard',
      'productGrid',
      'categoryChips',
      'productDetailPanel',
      'addToCartCTA',
    ],
    assetPlaceholders: [
      'headphones_pink',
      'product_soft_shadow',
      'product_detail',
    ],
    qualityRules: [
      'Make the product the hero.',
      'Use soft depth and clean commerce hierarchy.',
      'Keep CTA obvious.',
    ],
  };
}

function premiumMusicPlayer(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'premiumMusicPlayer',
    category: 'musicAudio',
    stylePreset: 'premiumAudioDark',
    presentationMode,
    visualRules: [
      'Use dark immersive background, glassy cards, large album artwork, waveform motifs and purple/cyan accents.',
      'Make album artwork or now-playing visual card the hero.',
      'Use clear music hierarchy: artist, track, playlist, queue, player controls.',
      'Avoid ecommerce product language and meditation defaults.',
    ],
    recommendedComponents: [
      'audioPlayerCard',
      'audioTrackList',
      'moodTabBar',
      'bottomNavBar',
    ],
    assetPlaceholders: [
      'album_art_gradient',
      'artist_portrait',
      'waveform_visual',
    ],
    qualityRules: [
      'Make album artwork the visual hero.',
      'Use clear now-playing hierarchy.',
      'Keep queue content compact.',
      'Avoid meditation or ecommerce defaults.',
      'Keep text high contrast on dark backgrounds.',
    ],
  };
}

function immersiveWellnessAudio(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'immersiveWellnessAudio',
    category: 'meditationWellness',
    stylePreset: 'immersiveWellnessAudio',
    presentationMode,
    visualRules: [
      'Use atmospheric imagery with dark overlays.',
      'Use calm large typography and audio player controls.',
      'Use mood categories and curved shapes.',
    ],
    recommendedComponents: [
      'meditationHeroScreen',
      'meditationHeroImage',
      'audioPlayerCard',
      'audioTrackList',
      'moodTabBar',
      'instructorCard',
    ],
    assetPlaceholders: [
      'meditation_landscape',
      'calm_mountains',
      'wellness_ambient',
    ],
    qualityRules: [
      'The mood should feel calm and immersive.',
      'Use soft contrast instead of harsh UI.',
      'Use image overlay for readability.',
    ],
  };
}

function fintechImageSoft(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'fintechSoftImageLed',
    category: 'fintechSoft',
    stylePreset: 'softFintech',
    presentationMode,
    visualRules: [
      'Use strong numeric hierarchy with premium cards.',
      'Use subtle shadows, charts and soft financial imagery sparingly.',
    ],
    recommendedComponents: [
      'header',
      'balanceHeroCard',
      'chartCard',
      'metricCard',
      'transactionRow',
      'bottomNavBar',
    ],
    assetPlaceholders: [
      'finance_gradient',
      'market_chart',
      'portfolio_card',
    ],
    qualityRules: [
      'Prioritize trust, clarity and readable numbers.',
      'Use one accent color.',
    ],
  };
}

function premiumGenericArtDirection(presentationMode: PresentationMode): VisualRecipe {
  return {
    name: 'premiumGenericArtDirection',
    category: 'generic',
    stylePreset: 'premiumArtDirection',
    presentationMode,
    visualRules: [
      'Use a clear visual hero.',
      'Use restrained colors, strong typography, rounded cards and soft shadows.',
    ],
    recommendedComponents: [
      'imageHero',
      'heroCard',
      'contentCard',
      'primaryCTA',
    ],
    assetPlaceholders: [
      'premium_placeholder',
    ],
    qualityRules: [
      'Every screen needs one dominant typographic hero.',
      'Avoid overcrowding.',
    ],
  };
}

export const VisualRecipeLibrary = {
  recipe(visualCategory: VisualProductCategory, presentationMode: PresentationMode): VisualRecipe {
    switch (visualCategory) {
      case 'travelNature':
        return travelNatureShowcase(presentationMode);
      case 'realEstateLuxury':
        return glassRealEstateShowcase(presentationMode);
      case 'beverageBrand':
        return darkBeverageEditorial(presentationMode);
      case 'ecommerceProduct':
      case 'fashionRetail':
        return softProductCommerce(presentationMode);
      case 'musicAudio':
        return premiumMusicPlayer(presentationMode);
      case 'meditationWellness':
        return immersiveWellnessAudio(presentationMode);
      case 'fitnessPerformance':
        return fitnessPerformanceArt(presentationMode);
      case 'fintechSoft':
        return fintechImageSoft(presentationMode);
      case 'foodDelivery':
        return darkBeverageEditorial(presentationMode);
      case 'generic':
        return premiumGenericArtDirection(presentationMode);
    }
  },
};
