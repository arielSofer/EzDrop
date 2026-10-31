// Ported 1:1 from AgenticDesigner/DesignIntelligence/ComponentRegistry.swift
// (the ComponentType enum + its lenient decoder; the registry body ships with
// the DesignIntelligence port).

export const AllComponentType = [
  'avatarGreetingHeader',
  'balanceHeroCard',
  'quickActionRow',
  'transactionRow',
  'transactionList',
  'currencyCard',
  'currencyCardGrid',
  'bottomNavBar',
  'primaryButton',
  'secondaryButton',
  'textField',
  'metricCard',
  'chartCard',
  'onboardingScreen',
  'editorialIllustrationBlock',
  'progressRing',
  'workoutCard',
  'statCard',
  'primaryCTA',
  'moodCheckInCard',
  'journalPromptCard',
  'softPrimaryButton',
  'progressCard',
  'searchBar',
  'destinationHeroCard',
  'categoryChips',
  'destinationCard',
  'bookingCTA',
  'header',
  'heroCard',
  'contentCard',
  'largeIconTile',
  'iconFeatureGrid',
  'productCard',
  'chatMessage',
  'chatInput',
  'skipLink',
  'editorialHeadline',
  'lineArtIllustration',
  'bodyCopy',
  'pillPrimaryButton',
  'pillSecondaryButton',
  'headerIcon',
  'inputField',
  'textLink',
  'socialButton',
  'imageHero',
  'imageCard',
  'backgroundImage',
  'maskedImage',
  'productImage',
  'galleryStrip',
  'travelHeroScreen',
  'travelDiscoverScreen',
  'travelDetailScreen',
  'travelHeroCard',
  'propertySearchScreen',
  'propertyHeroCard',
  'propertyDetailCard',
  'apartmentCard',
  'amenityRow',
  'beverageHeroScreen',
  'flavorVariationStrip',
  'beverageProductCard',
  'productHeroScreen',
  'ecommerceHeroProduct',
  'productHeroCard',
  'productGrid',
  'productDetailPanel',
  'addToCartCTA',

  // iPad & Media Components
  'sidebar',
  'splitView',
  'cardGrid',
  'mediaCard',
  'bookCard',
  'meditationHeroScreen',
  'meditationHeroImage',
  'audioPlayerCard',
  'playerControl',
  'meditationTrackList',
  'audioTrackList',
  'moodTabBar',
  'instructorCard',
  // Banking / Card Management / Insights components
  'creditCardPreview',
  'toggleRow',
  'progressBar',
  'categoryRow',
  'budgetGauge',
  'controlButton',
  'insightCard',
  'securitySettingRow',
] as const;
export type ComponentType = (typeof AllComponentType)[number];

function normalizeComponentName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replaceAll('_', '')
    .replaceAll('-', '')
    .replaceAll(' ', '');
}

const normalizedExact: ReadonlyMap<string, ComponentType> = new Map(
  AllComponentType.map((c) => [normalizeComponentName(c), c] as const),
);

const synonyms: ReadonlyMap<string, ComponentType> = new Map<string, ComponentType>([
  ...(['quickactionscard', 'quickactions', 'quickactioncards', 'actionrow', 'actiongrid'] as const).map((k) => [k, 'quickActionRow'] as const),
  ...(['accountcard', 'accountsummarycard', 'portfoliocard', 'portfoliosummarycard', 'brokeragecard'] as const).map((k) => [k, 'balanceHeroCard'] as const),
  ...(['assetrow', 'holdingrow', 'stockrow', 'marketrow', 'tickerrow', 'watchlistrow'] as const).map((k) => [k, 'transactionRow'] as const),
  ...(['assetlist', 'holdinglist', 'stocklist', 'marketlist', 'watchlist', 'tickerlist', 'transactions', 'activitylist'] as const).map((k) => [k, 'transactionList'] as const),
  ...(['marketchart', 'portfoliochart', 'performancechart', 'interactivechart'] as const).map((k) => [k, 'chartCard'] as const),
  ...(['primarycta', 'ctabutton', 'primarybutton'] as const).map((k) => [k, 'primaryCTA'] as const),
  ...(['navbar', 'bottomnavigation', 'tabbar'] as const).map((k) => [k, 'bottomNavBar'] as const),
  ...(['greetingheader', 'avatarheader', 'profileheader'] as const).map((k) => [k, 'avatarGreetingHeader'] as const),
  ...(['statcard', 'statscard', 'keymetriccard', 'metric'] as const).map((k) => [k, 'metricCard'] as const),
  ...(['travelherocard', 'travelheroimagecard', 'heroimagescreen'] as const).map((k) => [k, 'travelHeroScreen'] as const),
  ...(['traveldiscoverscreen', 'discovercardscreen', 'destinationdiscoverscreen'] as const).map((k) => [k, 'travelDiscoverScreen'] as const),
  ...(['traveldetailscreen', 'destinationdetailscreen', 'tripdetailscreen'] as const).map((k) => [k, 'travelDetailScreen'] as const),
  ...(['propertysearchscreen', 'propertylistscreen', 'realestatesearchscreen'] as const).map((k) => [k, 'propertySearchScreen'] as const),
  ...(['propertyherocard', 'realestateherocard', 'apartmentherocard'] as const).map((k) => [k, 'propertyHeroCard'] as const),
  ...(['propertydetailscreen', 'propertydetailcard', 'realestatedetailscreen'] as const).map((k) => [k, 'propertyDetailCard'] as const),
  ...(['beverageheroscreen', 'juiceheroscreen', 'drinkheroscreen'] as const).map((k) => [k, 'beverageHeroScreen'] as const),
  ...(['productheroscreen', 'ecommerceheroproduct', 'ecommerceheroscreen', 'productherocard'] as const).map((k) => [k, 'productHeroScreen'] as const),
  ...(['meditationheroscreen', 'meditationaudioscreen', 'wellnessaudioscreen'] as const).map((k) => [k, 'meditationHeroScreen'] as const),
  ...(['audioplayercard', 'playercontrol', 'musicplayercard'] as const).map((k) => [k, 'audioPlayerCard'] as const),
  ...(['icontile', 'largeicontile', 'featureicon', 'featuretile', 'imageicontile', 'bigicontile'] as const).map((k) => [k, 'largeIconTile'] as const),
  ...(['iconfeaturegrid', 'featuregrid', 'icongrid', 'largeicongrid', 'imageicongrid', 'featuretiles'] as const).map((k) => [k, 'iconFeatureGrid'] as const),
  ...(['creditcard', 'creditcardpreview', 'cardpreview', 'visacard', 'mastercardpreview'] as const).map((k) => [k, 'creditCardPreview'] as const),
  ...(['toggle', 'togglerow', 'switchrow', 'togglesetting', 'settingtoggle'] as const).map((k) => [k, 'toggleRow'] as const),
  ...(['progress', 'progressbar', 'horizontalprogress', 'loadingbar'] as const).map((k) => [k, 'progressBar'] as const),
  ...(['categoryrow', 'spendingcategory', 'budgetcategory', 'categoryspendinrow'] as const).map((k) => [k, 'categoryRow'] as const),
  ...(['budgetgauge', 'budgetmeter', 'budgetprogress', 'spendingprogress'] as const).map((k) => [k, 'budgetGauge'] as const),
  ...(['controlbutton', 'iconbutton', 'actionbutton', 'circlebutton'] as const).map((k) => [k, 'controlButton'] as const),
  ...(['insightcard', 'financialinsight', 'tipcard', 'suggestioncard'] as const).map((k) => [k, 'insightCard'] as const),
  ...(['securitysettingrow', 'securityrow', 'securitysetting', 'securityoption'] as const).map((k) => [k, 'securitySettingRow'] as const),
]);

/**
 * `ComponentType.init(from:)` — exact (normalised) match first, then the
 * synonym table, then `.contentCard`. Never fails for a string input.
 */
export function decodeComponentType(rawValue: string): ComponentType {
  const normalized = normalizeComponentName(rawValue);
  const exact = normalizedExact.get(normalized);
  if (exact) return exact;
  return synonyms.get(normalized) ?? 'contentCard';
}
