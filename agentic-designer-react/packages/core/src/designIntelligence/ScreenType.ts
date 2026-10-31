// Ported 1:1 from AgenticDesigner/DesignIntelligence/ScreenType.swift

// סוגי מסכים שהמערכת יודעת לייצר
export const AllScreenType = [
  'onboarding',
  'login',
  'home',
  'dashboard',
  'details',
  'profile',
  'settings',
  'checkout',
  'search',
  'feed',
  'analytics',
  'emptyState',
  'paywall',
  'generic',
] as const;
export type ScreenType = (typeof AllScreenType)[number];

export const ScreenTypeClassifier = {
  // מזהה סוג מסך לפי הפרומפט
  classify(prompt: string): ScreenType {
    const text = prompt.toLowerCase();

    if (text.includes('onboarding') || text.includes('intro') || text.includes('welcome')) {
      return 'onboarding';
    }

    if (text.includes('login') || text.includes('sign in') || text.includes('auth')) {
      return 'login';
    }

    if (text.includes('dashboard') || text.includes('analytics')) {
      return 'dashboard';
    }

    if (text.includes('home') || text.includes('main screen')) {
      return 'home';
    }

    if (text.includes('profile') || text.includes('account')) {
      return 'profile';
    }

    if (text.includes('settings')) {
      return 'settings';
    }

    if (text.includes('checkout') || text.includes('payment')) {
      return 'checkout';
    }

    if (text.includes('search') || text.includes('explore')) {
      return 'search';
    }

    if (text.includes('paywall') || text.includes('pricing') || text.includes('subscription')) {
      return 'paywall';
    }

    return 'generic';
  },
};
