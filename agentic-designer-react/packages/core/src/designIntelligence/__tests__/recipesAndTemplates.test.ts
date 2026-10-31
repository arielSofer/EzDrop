import { describe, expect, it } from 'vitest';
import { DesignRecipeLibrary } from '../DesignRecipeLibrary';
import { TemplateFactory } from '../TemplateFactory';
import { AppShotsDesignKnowledge } from '../AppShotsDesignKnowledge';
import { VisualRecipeLibrary } from '../VisualArtDirection';

describe('DesignRecipeLibrary.recipe — DesignRecipeLibrary.swift 13-50', () => {
  it('maps (category, screenType) pairs exactly like the Swift switch', () => {
    expect(DesignRecipeLibrary.recipe('finance', 'home')).toBe(DesignRecipeLibrary.financeHome);
    expect(DesignRecipeLibrary.recipe('banking', 'generic')).toBe(DesignRecipeLibrary.financeHome);
    expect(DesignRecipeLibrary.recipe('trading', 'home')).toBe(DesignRecipeLibrary.financeDashboard);
    expect(DesignRecipeLibrary.recipe('fitness', 'dashboard')).toBe(DesignRecipeLibrary.fitnessHome);
    expect(DesignRecipeLibrary.recipe('health', 'generic')).toBe(DesignRecipeLibrary.fitnessHome);
    expect(DesignRecipeLibrary.recipe('mentalHealth', 'home')).toBe(DesignRecipeLibrary.mentalHealthHome);
    expect(DesignRecipeLibrary.recipe('travel', 'search')).toBe(DesignRecipeLibrary.travelExplore);
    expect(DesignRecipeLibrary.recipe('ecommerce', 'home')).toBe(DesignRecipeLibrary.ecommerceHome);
    expect(DesignRecipeLibrary.recipe('aiChat', 'generic')).toBe(DesignRecipeLibrary.aiChatHome);
    // (_, .onboarding) / (_, .login) beat the default for every category
    expect(DesignRecipeLibrary.recipe('finance', 'onboarding')).toBe(DesignRecipeLibrary.premiumOnboarding);
    expect(DesignRecipeLibrary.recipe('music', 'login')).toBe(DesignRecipeLibrary.premiumLogin);
    expect(DesignRecipeLibrary.recipe('education', 'feed')).toBe(DesignRecipeLibrary.genericPremiumMobile);
  });

  it('keeps the recipe payloads verbatim', () => {
    expect(DesignRecipeLibrary.financeHome.recommendedStyle).toBe('softFintech');
    expect(DesignRecipeLibrary.financeHome.layoutPattern).toBe('mobileHeroCards');
    expect(DesignRecipeLibrary.financeHome.requiredSections.length).toBe(6);
    expect(DesignRecipeLibrary.fitnessHome.recommendedStyle).toBe('healthMetrics');
    expect(DesignRecipeLibrary.ecommerceHome.recommendedStyle).toBe('commerceUtility');
    expect(DesignRecipeLibrary.aiChatHome.recommendedComponents).toEqual(['chatMessage', 'chatInput']);
  });
});

describe('TemplateFactory — TemplateFactory.swift 35-261', () => {
  it('has the 7 starter templates', () => {
    expect(TemplateFactory.all.map((t) => t.id)).toEqual([
      'finance-dashboard', 'fitness-tracker', 'ecommerce-shop', 'travel-explorer', 'ai-chat', 'wellness', 'saas-onboarding',
    ]);
    expect(TemplateFactory.template('wellness')?.name).toBe('Wellness & Meditation');
    expect(TemplateFactory.template('nope')).toBeUndefined();
  });

  it('emits agent-dialect actions decoded through the live parser', () => {
    const template = TemplateFactory.template('finance-dashboard');
    expect(template).toBeDefined();
    const actions = TemplateFactory.actions(template!);
    // 3 screens: 1 frame + stack + 1 nav bar each
    const stackCount = template!.screens.reduce((sum, s) => sum + s.stack.length + (s.bottomBar ? 1 : 0) + 1, 0);
    expect(actions.length).toBe(stackCount);

    const first = actions[0];
    expect(first.type).toBe('createFrame');
    expect(first.name).toBe('Home');
    expect(first.nodeReference).toBe('screen_0');
    expect(first.x).toBe(100);
    expect(first.y).toBe(100);
    expect(first.width).toBe(390);
    expect(first.height).toBe(844);
    expect(first.cornerRadius).toBe(40);
    expect(first.fill).toBe('#F5F8FC'); // softFintech backgroundPrimary

    const second = actions[1];
    expect(second.type).toBe('createComponent');
    expect(second.component).toBe('avatarGreetingHeader');
    expect(second.parentReference).toBe('screen_0');
    expect(second.nodeReference).toBe('screen_0_c0');
    expect(second.stylePreset).toBe('softFintech');
    expect(second.x).toBe(20);
    expect(second.y).toBe(64);
    expect(second.width).toBe(350);
    expect(second.height).toBe(64);
    expect(second.props).toEqual({ greeting: 'Good morning', name: 'Alex' });

    // cursorY advances by height + gap(16)
    expect(actions[2].y).toBe(144);

    const nav = actions.find((a) => a.nodeReference === 'screen_0_nav');
    expect(nav?.component).toBe('bottomNavBar');
    expect(nav?.y).toBe(756);
    expect(nav?.height).toBe(88);

    // The second screen is offset by width + 60
    const screen1 = actions.find((a) => a.nodeReference === 'screen_1');
    expect(screen1?.x).toBe(550);
  });

  it('omits the bottom bar where the template says so', () => {
    const actions = TemplateFactory.actions(TemplateFactory.template('saas-onboarding')!);
    expect(actions.some((a) => a.nodeReference?.endsWith('_nav'))).toBe(false);
  });
});

describe('AppShotsDesignKnowledge — AppShotsDesignKnowledge.swift 28-182', () => {
  it('carries the 6 reference studies and rule lists', () => {
    expect(AppShotsDesignKnowledge.studies.map((s) => s.name)).toEqual(['Shipt', 'Instagram', 'WhatsApp', 'Netflix', 'Less', 'MyFitnessPal']);
    expect(AppShotsDesignKnowledge.studies.reduce((n, s) => n + s.screenCount, 0)).toBe(1856);
    expect(AppShotsDesignKnowledge.universalRules.length).toBe(10);
    expect(AppShotsDesignKnowledge.antiPatterns.length).toBe(8);
  });

  it('recommendedStyle + flowBlueprint route by goal keywords', () => {
    expect(AppShotsDesignKnowledge.recommendedStyle('a netflix style stream app')).toBe('cinematicMedia');
    expect(AppShotsDesignKnowledge.recommendedStyle('group chat')).toBe('messagingUtility');
    expect(AppShotsDesignKnowledge.recommendedStyle('grocery delivery cart')).toBe('commerceUtility');
    expect(AppShotsDesignKnowledge.recommendedStyle('calorie and workout tracking')).toBe('healthMetrics');
    expect(AppShotsDesignKnowledge.recommendedStyle('a mindful journal')).toBe('mindfulIllustrated');
    expect(AppShotsDesignKnowledge.recommendedStyle('photo creator feed')).toBe('socialContent');
    expect(AppShotsDesignKnowledge.recommendedStyle('an app')).toBe('appleCalm');
    expect(AppShotsDesignKnowledge.flowBlueprint('grocery cart')[0]).toBe('Onboarding / location');
    expect(AppShotsDesignKnowledge.flowBlueprint('an app').length).toBe(7);
  });

  it('agentLoopGuide interpolates the style, flow and rule lists', () => {
    const guide = AppShotsDesignKnowledge.agentLoopGuide('grocery cart');
    expect(guide).toContain('Recommended visual system for this goal: commerceUtility.');
    expect(guide).toContain('Onboarding / location → Home / deals');
    expect(guide).toContain('NEVER SHIP');
    expect(guide).toContain(AppShotsDesignKnowledge.antiPatterns[0]);
    expect(AppShotsDesignKnowledge.composerGuide).toContain('REFERENCE-GRADE COMPOSITION');
    expect(AppShotsDesignKnowledge.criticGuide).toContain('production references');
  });
});

describe('VisualRecipeLibrary — VisualArtDirection.swift 182-208', () => {
  it('maps every visual category, sharing recipes the way Swift does', () => {
    expect(VisualRecipeLibrary.recipe('travelNature', 'appScreen').name).toBe('travelNatureShowcase');
    expect(VisualRecipeLibrary.recipe('realEstateLuxury', 'appScreen').name).toBe('glassRealEstateShowcase');
    expect(VisualRecipeLibrary.recipe('beverageBrand', 'appScreen').name).toBe('darkBeverageEditorial');
    expect(VisualRecipeLibrary.recipe('foodDelivery', 'appScreen').name).toBe('darkBeverageEditorial');
    expect(VisualRecipeLibrary.recipe('fashionRetail', 'appScreen').name).toBe('softProductCommerce');
    expect(VisualRecipeLibrary.recipe('musicAudio', 'appScreen').stylePreset).toBe('premiumAudioDark');
    expect(VisualRecipeLibrary.recipe('fintechSoft', 'appScreen').name).toBe('fintechSoftImageLed');
    expect(VisualRecipeLibrary.recipe('generic', 'presentationShot').presentationMode).toBe('presentationShot');
    expect(VisualRecipeLibrary.recipe('fitnessPerformance', 'appScreen').assetPlaceholders).toEqual(['running_trail', 'fitness_workout', 'route_map']);
  });
});
