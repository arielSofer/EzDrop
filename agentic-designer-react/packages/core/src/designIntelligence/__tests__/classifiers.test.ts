import { describe, expect, it } from 'vitest';
import { AppCategoryClassifier, type AppCategory } from '../AppCategory';
import { ScreenTypeClassifier, type ScreenType } from '../ScreenType';
import { PresentationModeClassifier, VisualProductCategoryClassifier, type VisualProductCategory } from '../VisualArtDirection';

describe('AppCategoryClassifier — AppCategory.swift 38-115', () => {
  const cases: [string, AppCategory][] = [
    ['A stock trading app', 'trading'],              // word("stock"/"trading") — line 53
    ['Track my investments', 'trading'],             // stem("invest") — line 55
    ['banking app with a budget', 'finance'],        // word("banking"/"budget") — line 60
    ['my running tracker', 'fitness'],               // stem("run") — line 70
    ['a calm meditation space', 'mentalHealth'],     // word("meditation"/"calm") — line 74
    ['hotel booking for my vacation', 'travel'],     // word("hotel"/"vacation") — line 79
    ['an online store for products', 'ecommerce'],   // word("store"/"products") — line 84
    ['food delivery from a restaurant', 'foodDelivery'], // line 89
    ['a spotify style playlist app', 'music'],       // line 99
    ['ai assistant chat', 'aiChat'],                 // line 104
    ['daily habit streaks', 'habitTracker'],         // line 110
    ['an email client', 'generic'],                  // "ai" must NOT fire inside "email" — line 36-37
  ];

  it.each(cases)('%s → %s', (prompt, expected) => {
    expect(AppCategoryClassifier.classify(prompt)).toBe(expected);
  });

  it('matches Hebrew keywords and the "תיק השקעות" phrase', () => {
    expect(AppCategoryClassifier.classify('אפליקציית מניות')).toBe('trading');
    expect(AppCategoryClassifier.classify('תיק השקעות')).toBe('trading');
    expect(AppCategoryClassifier.classify("צ'אט עם עוזר")).toBe('aiChat');
  });
});

describe('ScreenTypeClassifier — ScreenType.swift 31-70', () => {
  const cases: [string, ScreenType][] = [
    ['onboarding flow', 'onboarding'],
    ['a welcome intro', 'onboarding'],
    ['login page', 'login'],
    ['sign in screen', 'login'],
    ['analytics dashboard', 'dashboard'],
    ['home screen', 'home'],
    ['account settings', 'profile'],   // "account" (line 50) wins over "settings" (line 54)
    ['settings list', 'settings'],
    ['checkout with payment', 'checkout'],
    ['explore and search', 'search'],
    ['subscription paywall pricing', 'paywall'],
    ['a random panel', 'generic'],
  ];

  it.each(cases)('%s → %s', (prompt, expected) => {
    expect(ScreenTypeClassifier.classify(prompt)).toBe(expected);
  });
});

describe('VisualProductCategoryClassifier — VisualArtDirection.swift 41-159', () => {
  const cases: [string, VisualProductCategory][] = [
    ['a real estate listing app', 'realEstateLuxury'],
    ['fresh juice brand', 'beverageBrand'],
    ['guided meditation sessions', 'meditationWellness'],
    ['running and workout pace', 'fitnessPerformance'],
    ['headphone shop', 'ecommerceProduct'],       // line 86-88: headphone AND shop
    ['spotify playlist artist', 'musicAudio'],
    ['a trip to a hotel', 'travelNature'],
    ['an online store', 'ecommerceProduct'],      // line 120-124
    ['bank wallet balance', 'fintechSoft'],
    ['fashion clothing brand', 'fashionRetail'],
    ['restaurant food delivery', 'foodDelivery'],
    ['something entirely different', 'generic'],
  ];

  it.each(cases)('%s → %s', (prompt, expected) => {
    expect(VisualProductCategoryClassifier.classify(prompt)).toBe(expected);
  });

  it('PresentationModeClassifier — VisualArtDirection.swift 163-178', () => {
    expect(PresentationModeClassifier.classify('a dribbble showcase')).toBe('presentationShot');
    expect(PresentationModeClassifier.classify('premium app concept')).toBe('presentationShot');
    expect(PresentationModeClassifier.classify('a settings screen')).toBe('appScreen');
  });
});
