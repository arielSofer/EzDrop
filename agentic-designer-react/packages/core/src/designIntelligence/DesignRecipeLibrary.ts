// Ported 1:1 from AgenticDesigner/DesignIntelligence/DesignRecipeLibrary.swift

import type { AppCategory } from './AppCategory';
import type { DesignRecipe } from './DesignRecipe';
import type { ScreenType } from './ScreenType';

// MARK: - Specific Recipes

export const financeHome: DesignRecipe = {
  category: 'finance',
  screenType: 'home',
  recommendedStyle: 'softFintech',
  layoutPattern: 'mobileHeroCards',
  requiredSections: [
    'Header with avatar and greeting',
    'Large balance hero card',
    'Quick actions row',
    'Latest transaction section',
    'Currency or account cards',
    'Bottom navigation',
  ],
  recommendedComponents: [
    'avatarGreetingHeader',
    'balanceHeroCard',
    'quickActionRow',
    'transactionRow',
    'currencyCard',
    'bottomNavBar',
  ],
  qualityRules: [
    'Use one strong accent color only.',
    'Make the balance the dominant visual element.',
    'Use large rounded cards with soft shadows.',
    'Keep financial values highly readable.',
    'Use clear separation between sections.',
    'Use muted metadata and strong primary numbers.',
  ],
  avoidRules: [
    'Avoid too many bright colors.',
    'Avoid tiny financial numbers.',
    'Avoid unaligned transaction values.',
    'Avoid dense tables on mobile.',
    'Avoid generic rectangle layouts.',
  ],
};

export const financeDashboard: DesignRecipe = {
  category: 'finance',
  screenType: 'dashboard',
  recommendedStyle: 'softFintech',
  layoutPattern: 'mobileDashboard',
  requiredSections: [
    'Header with period selector',
    'Main chart area',
    'Key metrics row',
    'Detailed list',
  ],
  recommendedComponents: [
    'header',
    'chartCard',
    'metricCard',
    'transactionRow',
  ],
  qualityRules: [
    'Keep charts clean and simple.',
    'Focus on the main trend.',
  ],
  avoidRules: [
    'Avoid cluttered axes on charts.',
  ],
};

export const fitnessHome: DesignRecipe = {
  category: 'fitness',
  screenType: 'home',
  recommendedStyle: 'healthMetrics',
  layoutPattern: 'mobileProgressHome',
  requiredSections: [
    'Personal greeting',
    'Daily progress hero section',
    'Workout plan cards',
    'Activity stats',
    'Primary workout CTA',
    'Bottom navigation',
  ],
  recommendedComponents: [
    'progressRing',
    'workoutCard',
    'statCard',
    'primaryCTA',
    'bottomNavBar',
  ],
  qualityRules: [
    'Use energetic but controlled color.',
    'Make progress visually clear.',
    'Use bold stats and simple labels.',
    'Keep the primary workout action dominant.',
    'Use cards for workout modules.',
  ],
  avoidRules: [
    'Avoid overly medical visuals.',
    'Avoid too many stats at once.',
    'Avoid weak CTA hierarchy.',
    'Avoid random neon colors.',
  ],
};

export const mentalHealthHome: DesignRecipe = {
  category: 'mentalHealth',
  screenType: 'home',
  recommendedStyle: 'mindfulIllustrated',
  layoutPattern: 'mobileHeroCards',
  requiredSections: [
    'Calm greeting',
    'Mood check-in card',
    'Daily reflection prompt',
    'Breathing or meditation CTA',
    'Soft progress card',
  ],
  recommendedComponents: [
    'moodCheckInCard',
    'journalPromptCard',
    'softPrimaryButton',
    'progressCard',
  ],
  qualityRules: [
    'Use calm muted colors.',
    'Use generous whitespace.',
    'Avoid aggressive contrast.',
    'Make the interface feel safe and gentle.',
    'Use soft rounded cards.',
  ],
  avoidRules: [
    'Avoid red warning colors.',
    'Avoid dense analytics.',
    'Avoid aggressive CTAs.',
    'Avoid financial-style dashboards.',
  ],
};

export const travelExplore: DesignRecipe = {
  category: 'travel',
  screenType: 'search',
  recommendedStyle: 'luxuryTravel',
  layoutPattern: 'mobileSearchExplore',
  requiredSections: [
    'Large search area',
    'Destination hero card',
    'Category chips',
    'Popular destinations carousel',
    'Booking CTA',
  ],
  recommendedComponents: [
    'searchBar',
    'destinationHeroCard',
    'categoryChips',
    'destinationCard',
    'bookingCTA',
  ],
  qualityRules: [
    'Use image-first composition.',
    'Use aspirational spacing.',
    'Make search highly visible.',
    'Use elegant destination cards.',
    'Use warm premium accents.',
  ],
  avoidRules: [
    'Avoid dense text.',
    'Avoid tiny image placeholders.',
    'Avoid dashboard-like layouts.',
    'Avoid weak visual destination hierarchy.',
  ],
};

export const ecommerceHome: DesignRecipe = {
  category: 'ecommerce',
  screenType: 'home',
  recommendedStyle: 'commerceUtility',
  layoutPattern: 'mobileFeed',
  requiredSections: [
    'Header with cart',
    'Promo banner',
    'Categories carousel',
    'Featured products grid',
  ],
  recommendedComponents: [
    'header',
    'heroCard',
    'categoryChips',
    'productCard',
  ],
  qualityRules: [
    'High quality product images.',
    'Clear pricing.',
  ],
  avoidRules: [
    'Cluttered grids.',
  ],
};

export const aiChatHome: DesignRecipe = {
  category: 'aiChat',
  screenType: 'home',
  recommendedStyle: 'messagingUtility',
  layoutPattern: 'mobileChat',
  requiredSections: [
    'Chat feed',
    'Input area with attach actions',
  ],
  recommendedComponents: [
    'chatMessage',
    'chatInput',
  ],
  qualityRules: [
    'Focus on content readability.',
  ],
  avoidRules: [
    'Distracting backgrounds.',
  ],
};

export const premiumOnboarding: DesignRecipe = {
  category: 'generic',
  screenType: 'onboarding',
  recommendedStyle: 'minimalEditorial',
  layoutPattern: 'mobileOnboardingCarousel',
  requiredSections: [
    'Skip link',
    'Large editorial headline',
    'Central illustration',
    'Short explanatory body copy',
    'Primary CTA',
    'Secondary CTA',
  ],
  recommendedComponents: [
    'skipLink',
    'editorialHeadline',
    'lineArtIllustration',
    'bodyCopy',
    'pillPrimaryButton',
    'pillSecondaryButton',
  ],
  qualityRules: [
    'Use large whitespace.',
    'Use one clear visual idea.',
    'Use short, confident copy.',
    'Use bold editorial typography.',
    'Keep the design restrained and premium.',
  ],
  avoidRules: [
    'Avoid clutter.',
    'Avoid tiny text.',
    'Avoid multiple competing illustrations.',
    'Avoid too many colors.',
    'Avoid generic login layout.',
  ],
};

export const premiumLogin: DesignRecipe = {
  category: 'generic',
  screenType: 'login',
  recommendedStyle: 'minimalEditorial',
  layoutPattern: 'mobileFormCentered',
  requiredSections: [
    'Logo or icon',
    'Welcome back headline',
    'Email input',
    'Password input',
    'Login CTA',
    'Forgot password link',
    'Social login buttons',
  ],
  recommendedComponents: [
    'headerIcon',
    'editorialHeadline',
    'inputField',
    'primaryCTA',
    'textLink',
    'socialButton',
  ],
  qualityRules: [
    'Keep the form clean and spacious.',
  ],
  avoidRules: [
    'Avoid cluttered forms.',
  ],
};

export const genericPremiumMobile: DesignRecipe = {
  category: 'generic',
  screenType: 'generic',
  recommendedStyle: 'appleCalm',
  layoutPattern: 'mobileHeroCards',
  requiredSections: [
    'Clear header',
    'Hero section',
    'Primary content card',
    'Primary CTA',
  ],
  recommendedComponents: [
    'header',
    'heroCard',
    'contentCard',
    'primaryButton',
  ],
  qualityRules: [
    'Use strong hierarchy.',
    'Use consistent spacing.',
    'Use one primary CTA.',
    'Use restrained colors.',
    'Make the layout feel intentional.',
  ],
  avoidRules: [
    'Avoid random element placement.',
    'Avoid inconsistent margins.',
    'Avoid too many colors.',
    'Avoid weak typography.',
  ],
};

export const DesignRecipeLibrary = {
  financeHome,
  financeDashboard,
  fitnessHome,
  mentalHealthHome,
  travelExplore,
  ecommerceHome,
  aiChatHome,
  premiumOnboarding,
  premiumLogin,
  genericPremiumMobile,

  // מחזיר מתכון עיצובי לפי סוג האפליקציה וסוג המסך
  recipe(category: AppCategory, screenType: ScreenType): DesignRecipe {
    const pair = `${category}|${screenType}`;
    switch (pair) {
      case 'finance|home':
      case 'finance|generic':
      case 'banking|home':
      case 'banking|generic':
        return financeHome;

      case 'finance|dashboard':
      case 'trading|dashboard':
      case 'trading|generic':
      case 'trading|home':
        return financeDashboard;

      case 'fitness|home':
      case 'fitness|generic':
      case 'fitness|dashboard':
      case 'health|home':
      case 'health|generic':
        return fitnessHome;

      case 'mentalHealth|home':
      case 'mentalHealth|generic':
        return mentalHealthHome;

      case 'travel|home':
      case 'travel|search':
      case 'travel|generic':
        return travelExplore;

      case 'ecommerce|home':
      case 'ecommerce|generic':
        return ecommerceHome;

      case 'aiChat|home':
      case 'aiChat|generic':
        return aiChatHome;

      default:
        // case (_, .onboarding) / (_, .login) come before the default in Swift.
        if (screenType === 'onboarding') return premiumOnboarding;
        if (screenType === 'login') return premiumLogin;
        return genericPremiumMobile;
    }
  },
};
