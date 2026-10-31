import { describe, expect, it } from 'vitest';
import { AllComponentType, type ComponentType } from '../../models/ComponentType';
import type { DesignNode } from '../../models/DesignNode';
import { makeDesignAction } from '../../agent/DesignAction';
import { ComponentFactory } from '../ComponentFactory';
import { DesignTokenLibrary } from '../DesignTokenLibrary';

const tokens = DesignTokenLibrary.tokens('softFintech');

function nodeCount(node: DesignNode): number {
  return 1 + node.children.reduce((sum, child) => sum + nodeCount(child), 0);
}

function build(type: ComponentType, props?: Record<string, string>): DesignNode {
  return ComponentFactory.createComponent(type, props, makeDesignAction({ type: 'createComponent' }), tokens);
}

/**
 * Total nodes (root + every descendant) produced by createComponent(type, nil
 * props, empty action) — derived by reading ComponentFactory.swift; the line
 * ranges name the builder each count comes from.
 */
const EXPECTED_NODE_COUNT: Record<ComponentType, number> = {
  // createAvatarGreetingHeader — Swift 266-341: frame + Avatar/Greeting/Title/Notification Icon
  avatarGreetingHeader: 5,
  // createBalanceHeroCard — Swift 343-416: card + Currency Label/Balance/Change
  balanceHeroCard: 4,
  // createQuickActionRow — Swift 613-693: frame + 4 default labels × (bg + icon + label)
  quickActionRow: 13,
  // createTransactionRow — Swift 418-473: frame + Icon/Title/Subtitle/Amount
  transactionRow: 5,
  // createTransactionList — Swift 475-611: frame + 2 header texts + 3 rows × 5
  transactionList: 18,
  // createMetricCard — Swift 933-998: frame + label/value/subtitle (currencyCard/statCard share it)
  currencyCard: 4,
  // createCurrencyCardGrid — Swift 721-800: frame + 2 cards × (card + badge/symbol/value/change)
  currencyCardGrid: 11,
  // createBottomNavBar — Swift 1000-1069: frame + 4 items × (icon + label)
  bottomNavBar: 9,
  // createPrimaryCTA — Swift 885-930: a single .Button, no children
  primaryButton: 1,
  secondaryButton: 1,
  // createInputField — Swift 3330-3356: a single .Input node
  textField: 1,
  metricCard: 4,
  // createChartCard — Swift 802-883: frame + title + 7 default bars + 7 labels (no period)
  chartCard: 16,
  // createOnboardingScreen — Swift 3513-3530: frame + image/title/subtitle
  onboardingScreen: 4,
  // createIllustrationBlock — Swift 3385-3398: frame + illustration icon
  editorialIllustrationBlock: 2,
  // createProgressRing — Swift 2283-2362: frame + track/inner/value/title
  progressRing: 5,
  // createWorkoutCard — Swift 2364-2446: frame + icon bg/icon/title/facts/status
  workoutCard: 6,
  statCard: 4,
  primaryCTA: 1,
  // createMoodJournalCard — Swift 3439-3455: frame + icon/title/action button
  moodCheckInCard: 4,
  journalPromptCard: 4,
  softPrimaryButton: 1,
  // createProgressCard — Swift 3400-3417: frame + title/subtitle/track/fill
  progressCard: 5,
  // createSearchBar — Swift 1748-1789: frame + search icon/placeholder
  searchBar: 3,
  // createDestinationCard — Swift 3419-3437: frame + cover/gradient/title/subtitle
  destinationHeroCard: 5,
  // createCategoryChips — Swift 1791-1837: frame + 3 default chips
  categoryChips: 4,
  destinationCard: 5,
  bookingCTA: 1,
  // createHeader — Swift 1071-1117: frame + title/subtitle
  header: 3,
  // createHeroCard — Swift 1221-1379: no image → visual field + symbol + title + subtitle
  heroCard: 5,
  // createContentCard — Swift 1119-1196: no icon prop → frame + title/subtitle
  contentCard: 3,
  // makeLargeIconTile — Swift 1398-1535: frame + icon bg + icon + title (no subtitle)
  largeIconTile: 4,
  // createIconFeatureGrid — Swift 1537-1614: frame + 4 tiles × 4 nodes
  iconFeatureGrid: 17,
  // createMediaCard — Swift 3259-3296: frame + cover/title/subtitle
  productCard: 4,
  // createChatMessage — Swift 1616-1682: frame + assistant avatar + bubble(+text)
  chatMessage: 4,
  // createChatInput — Swift 1684-1746: frame + attach icon/placeholder/send button(+icon)
  chatInput: 5,
  skipLink: 1,
  // createTextHeadline — Swift 3370-3383: a single .Text node
  editorialHeadline: 1,
  lineArtIllustration: 2,
  bodyCopy: 1,
  pillPrimaryButton: 1,
  pillSecondaryButton: 1,
  headerIcon: 2,
  inputField: 1,
  // createTextLink — Swift 3358-3368
  textLink: 1,
  socialButton: 1,
  // createImageHeroCard — Swift 1839-1954: no image → brand field + 2 orbs + symbol + title
  imageHero: 6,
  imageCard: 6,
  backgroundImage: 6,
  maskedImage: 6,
  productImage: 6,
  // createGalleryStrip — Swift 2196-2218: frame + 3 images
  galleryStrip: 4,
  // createTravelHeroScreen — Swift 1956-2034: frame + background/title/subtitle/CTA
  travelHeroScreen: 5,
  // createTravelDetailScreen — Swift 2036-2083: frame + imageHero(3) + subtitle + detail card(3)
  travelDiscoverScreen: 8,
  travelDetailScreen: 8,
  travelHeroCard: 5,
  // createPropertyScreen — Swift 2085-2108: frame + title/image/glass card(+name+price)
  propertySearchScreen: 6,
  propertyHeroCard: 6,
  propertyDetailCard: 6,
  apartmentCard: 6,
  // createAmenityRow — Swift 3457-3472: frame + icon/title
  amenityRow: 3,
  // createBeverageHeroScreen — Swift 2110-2131: frame + background/title/subtitle/CTA
  beverageHeroScreen: 5,
  flavorVariationStrip: 4,
  beverageProductCard: 5,
  // createProductHeroScreen — Swift 2133-2153: frame + title/image/CTA
  productHeroScreen: 4,
  ecommerceHeroProduct: 4,
  productHeroCard: 4,
  // createProductGrid — Swift 2220-2281: frame + 2 cards × (card + image + name)
  productGrid: 7,
  // createProductDetailPanel — Swift 3493-3511: frame + handle/title/price/description
  productDetailPanel: 5,
  addToCartCTA: 1,
  // createSidebar — Swift 3181-3203: frame + app title + 3 × (icon + label)
  sidebar: 8,
  // createSplitView — Swift 3205-3223: frame + sidebar(8) + main content area
  splitView: 10,
  // createCardGrid — Swift 3225-3257: frame + 6 media cards × 4
  cardGrid: 25,
  mediaCard: 4,
  bookCard: 4,
  // createMeditationHeroScreen — Swift 2155-2175: frame + image/title/audio player card(3)
  meditationHeroScreen: 6,
  meditationHeroImage: 6,
  // createAudioPlayerCard — Swift 2177-2194: frame + track title/play icon
  audioPlayerCard: 3,
  playerControl: 3,
  // createTrackList — Swift 2448-2546: frame + list title + 3 rows × 5
  meditationTrackList: 17,
  audioTrackList: 17,
  // moodTabBar routes to createCategoryChips — Swift 177-178
  moodTabBar: 4,
  // createInstructorCard — Swift 3474-3491: frame + avatar/name/role
  instructorCard: 4,
  // createCreditCardPreview — Swift 2633-2723: frame + 6 texts/icons
  creditCardPreview: 7,
  // createToggleRow — Swift 2725-2791: frame + title/subtitle/toggle track(+knob)
  toggleRow: 5,
  // createProgressBar — Swift 2793-2858: frame + label/right label/track/fill
  progressBar: 5,
  // createCategoryRow — Swift 2860-2931: frame + icon bg(+icon)/title/subtitle/amount
  categoryRow: 6,
  // createBudgetGauge — Swift 2933-2995: frame + gauge track/title/amount/subtitle
  budgetGauge: 5,
  // createControlButton — Swift 2997-3050: frame + button bg(+icon)/label
  controlButton: 4,
  // createInsightCard — Swift 3052-3115: frame + icon container(+icon)/title/description
  insightCard: 5,
  // createSecuritySettingRow — Swift 3117-3179: frame + title/subtitle/toggle track(+knob)
  securitySettingRow: 5,
};

describe('ComponentFactory.createComponent', () => {
  it('builds a node for every ComponentType (the Swift switch has no nil path)', () => {
    for (const type of AllComponentType) {
      const node = build(type);
      expect(node, type).toBeDefined();
      expect(node.id.length, type).toBeGreaterThan(0);
    }
  });

  it('produces the node counts read off ComponentFactory.swift', () => {
    const actual: Record<string, number> = {};
    for (const type of AllComponentType) {
      actual[type] = nodeCount(build(type));
    }
    expect(actual).toEqual(EXPECTED_NODE_COUNT);
  });

  it('routes aliases to the same builder (Swift 130-231 grouped cases)', () => {
    expect(build('metricCard').name).toBe('metricCard');
    expect(build('statCard').name).toBe('statCard');
    expect(build('moodTabBar').name).toBe('Category Chips');
    expect(build('travelHeroCard').name).toBe('Travel Hero Screen');
    expect(build('beverageProductCard').name).toBe('Beverage Hero Screen');
    expect(build('bookCard').name).toBe('Media Card');
  });

  it('createPrimaryCTA colours by type — Swift 885-930', () => {
    const primary = build('primaryCTA');
    expect(primary.type).toBe('Button');
    expect(primary.style.fill).toBe(tokens.colors.accentPrimary);
    expect(primary.style.textColor).toBe(tokens.colors.surfacePrimary);
    expect(primary.style.cornerRadius).toBe(tokens.radius.pill);
    expect(primary.text).toBe('Continue');
    expect(primary.height).toBe(56);

    const secondary = build('secondaryButton');
    expect(secondary.style.fill).toBe(tokens.colors.surfaceSecondary);
    expect(secondary.style.textColor).toBe(tokens.colors.textPrimary);

    const soft = build('softPrimaryButton');
    expect(soft.style.fill).toBe(tokens.colors.surfaceSecondary);
    expect(soft.style.textColor).toBe(tokens.colors.accentPrimary);

    const social = build('socialButton');
    expect(social.style.fill).toBe('#000000');
    expect(social.style.textColor).toBe('#FFFFFF');
  });

  it('createInputField marks password fields secure — Swift 3330-3356', () => {
    const plain = build('textField');
    expect(plain.type).toBe('Input');
    expect(plain.text).toBe('Enter text');
    expect(plain.style.paddingLeft).toBe(16);
    expect(plain.isSecure).toBeUndefined();

    const secure = build('inputField', { placeholder: 'Password' });
    expect(secure.isSecure).toBe(true);

    const hebrew = build('inputField', { placeholder: 'סיסמה' });
    expect(hebrew.isSecure).toBe(true);
  });

  it('createChartCard adds a Period row and honours values/labels — Swift 802-883', () => {
    const chart = build('chartCard', { title: 'Spending', period: 'Last 6 months', values: '1, 2, 3', labels: 'A,B,C' });
    expect(chart.children.map((c) => c.name)).toEqual([
      'Title', 'Period', 'Bar 1', 'Label 1', 'Bar 2', 'Label 2', 'Bar 3', 'Label 3',
    ]);
    // The most recent bar carries the accent; the rest are quiet.
    expect(chart.children[6].style.fill).toBe(tokens.colors.accentPrimary);
    expect(chart.children[2].style.fill).toBe(tokens.colors.surfaceSecondary);
  });

  it('createTransactionList sizes amounts and text columns — Swift 475-611', () => {
    const list = build('transactionList');
    const names = list.children.map((c) => c.name);
    expect(names.slice(0, 2)).toEqual(['List Title', 'List Action']);
    expect(names).toContain('Recent order Amount');
    // "$189.00" → min(104, max(48, 7*8)) = 56
    const amount = list.children.find((c) => c.name === 'Recent order Amount');
    expect(amount?.width).toBe(56);
    // empty amount → width 0
    const delivered = list.children.find((c) => c.name === 'Delivered Amount');
    expect(delivered?.width).toBe(0);
  });

  it('createQuickActionRow prefers the model labels and maps icons — Swift 613-719', () => {
    const row = build('quickActionRow', { actions: 'Shop, Run, Gift, Settings, Extra' });
    // Array(provided.prefix(4)) → 4 labels × 3 nodes
    expect(row.children.length).toBe(12);
    expect(row.children[1].iconName).toBe('bag.fill');
    expect(row.children[4].iconName).toBe('figure.run');
    expect(row.children[7].iconName).toBe('gift.fill');
    expect(row.children[10].iconName).toBe('gearshape.fill');
    // Fewer than two provided labels → generic defaults
    const fallback = build('quickActionRow', { actions: 'Only' });
    expect(fallback.children.filter((c) => c.type === 'Text').map((c) => c.text)).toEqual(['Shop', 'Search', 'Saved', 'Account']);
  });

  it('createProgressRing extracts the value out of "Title: value" — Swift 2283-2362', () => {
    const ring = build('progressRing', { title: 'Daily Goal: 68%' });
    expect(ring.children[2].text).toBe('68%');
    expect(ring.children[3].text).toBe('Daily Goal');
    // 0…1 progress is rendered as a rounded percentage
    const fraction = build('progressRing', { progress: '0.685' });
    expect(fraction.children[2].text).toBe('69%');
    // The ring is capped at 176pt and centred in the allotted width
    const wide = ComponentFactory.createComponent('progressRing', undefined, makeDesignAction({ type: 'createComponent', x: 0, width: 350, height: 350 }), tokens);
    expect(wide.width).toBe(176);
    expect(wide.x).toBe(87);
  });

  it('createGenericComponent humanises the raw component name — Swift 2548-2629, 3298-3328', () => {
    const action = makeDesignAction({ type: 'createComponent', rawComponentName: 'weather_forecast-Card' });
    const node = ComponentFactory.createComponent('contentCard', undefined, action, tokens);
    expect(node.name).toBe('Weather Forecast Card');
  });

  it('watchRunnerScreen is a fixed watch-only screen — Swift 79-105', () => {
    const watch = ComponentFactory.watchRunnerScreen();
    expect(watch.width).toBe(198);
    expect(watch.height).toBe(242);
    expect(watch.supportedPlatforms).toEqual(['appleWatch']);
    expect(watch.children.map((c) => c.name)).toEqual(['Activity', 'Distance', 'Pace', 'Heart Rate', 'Start Run']);
    expect(watch.children[0].text).toBe('OUTDOOR RUN');
    expect(ComponentFactory.watchRunnerScreen('Trail Run').children[0].text).toBe('TRAIL RUN');
  });
});
