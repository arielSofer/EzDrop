// Ported 1:1 from AgenticDesigner/DesignSystem/MobileDesignPatterns.swift

// קטגוריות עיצוב נפוצות לאפליקציות מובייל
export const AllMobileAppCategory = [
  'finance',
  'banking',
  'mentalHealth',
  'travel',
  'aiChat',
  'ecommerce',
  'productivity',
  'fitness',
  'generic',
] as const;
export type MobileAppCategory = (typeof AllMobileAppCategory)[number];

// חוקי עיצוב שמנחים את ה־Agent לייצר UI ברמה גבוהה
export interface MobileDesignPattern {
  category: MobileAppCategory;
  layoutPrinciples: string[];
  visualPrinciples: string[];
  commonComponents: string[];
  avoid: string[];
}

// פיננסים / מסחר / בנקאות
const finance: MobileDesignPattern = {
  category: 'finance',
  layoutPrinciples: [
    'Use a strong top summary section.',
    'Use cards for balances, metrics, and quick actions.',
    'Keep financial data highly readable.',
    'Prioritize trust, clarity, and precision.',
    'Use consistent alignment for numbers and labels.',
  ],
  visualPrinciples: [
    'Use dark or clean neutral backgrounds.',
    'Use one strong accent color only.',
    'Use subtle borders and soft shadows.',
    'Use large numeric typography for key values.',
    'Avoid decorative clutter.',
  ],
  commonComponents: [
    'balanceCard',
    'metricCard',
    'transactionList',
    'quickActionButton',
    'chartCard',
    'segmentedControl',
  ],
  avoid: [
    'Too many bright colors.',
    'Unaligned numbers.',
    'Weak contrast.',
    'Random card sizes.',
    'Overly playful illustrations.',
  ],
};

// בריאות נפשית / Self care
const mentalHealth: MobileDesignPattern = {
  category: 'mentalHealth',
  layoutPrinciples: [
    'Use calm spacing and soft hierarchy.',
    'Use large breathing room between sections.',
    'Make the primary action feel safe and calm.',
    'Prefer simple daily check-in flows.',
    'Use cards for mood, journal, and habit modules.',
  ],
  visualPrinciples: [
    'Use soft backgrounds.',
    'Use muted accent colors.',
    'Use rounded cards.',
    'Avoid aggressive contrast.',
    'Prefer warm and calming UI.',
  ],
  commonComponents: [
    'moodCard',
    'dailyCheckIn',
    'progressCard',
    'journalPrompt',
    'softPrimaryButton',
  ],
  avoid: [
    'Hard black backgrounds.',
    'Aggressive red colors.',
    'Dense financial-style dashboards.',
    'Too many stats on one screen.',
  ],
};

// Travel
const travel: MobileDesignPattern = {
  category: 'travel',
  layoutPrinciples: [
    'Use large visual hero areas.',
    'Use destination cards with strong imagery placeholders.',
    'Use search prominently.',
    'Use horizontal carousels for categories.',
    'Keep booking actions clear.',
  ],
  visualPrinciples: [
    'Use bright, aspirational spacing.',
    'Use image-first cards.',
    'Use soft overlays.',
    'Use friendly rounded controls.',
    'Use lightweight typography.',
  ],
  commonComponents: [
    'searchBar',
    'destinationCard',
    'categoryChips',
    'bookingCTA',
    'popularPlacesCarousel',
  ],
  avoid: [
    'Too much text.',
    'Dense dashboards.',
    'Tiny destination cards.',
    'Weak image hierarchy.',
  ],
};

// AI Chat / Assistant apps
const aiChat: MobileDesignPattern = {
  category: 'aiChat',
  layoutPrinciples: [
    'Use a clear chat entry point.',
    'Use suggestion cards.',
    'Use clean message bubbles.',
    'Prioritize the input area.',
    'Show recent tasks or capabilities.',
  ],
  visualPrinciples: [
    'Use minimal futuristic styling.',
    'Use subtle gradients carefully.',
    'Use clean neutral surfaces.',
    'Use one accent for AI actions.',
    'Avoid noisy sci-fi effects.',
  ],
  commonComponents: [
    'chatInput',
    'suggestionCard',
    'messageBubble',
    'agentStatus',
    'quickPromptGrid',
  ],
  avoid: [
    'Overloaded neon visuals.',
    'Too many gradients.',
    'Unclear input placement.',
    'Tiny unreadable chat text.',
  ],
};

const fitness: MobileDesignPattern = {
  category: 'fitness',
  layoutPrinciples: [
    'Use one motivational hero moment.',
    'Show pace, distance, progress, route or workout state clearly.',
    'Keep workout actions prominent and touch-friendly.',
    'Use compact activity rows/cards below the hero.',
    'Use bottom navigation for Home, Activity, Explore and Profile when needed.',
  ],
  visualPrinciples: [
    'Use energetic but controlled colors.',
    'Use strong contrast for metrics.',
    'Use real sport imagery or route/fitness visuals.',
    'Avoid finance, ecommerce or marketplace language.',
    'Keep dark cards readable.',
  ],
  commonComponents: [
    'imageHero',
    'metricCard',
    'progressCard',
    'workoutCard',
    'statCard',
    'primaryCTA',
  ],
  avoid: [
    'Portfolio, market, buy, sell or shop labels.',
    'Random neon colors.',
    'Too many metrics without hierarchy.',
    'Low contrast dark-on-dark typography.',
  ],
};

const generic: MobileDesignPattern = {
  category: 'generic',
  layoutPrinciples: [
    "Infer the product's real objects from the prompt.",
    'Build semantic sections with primitives before using generic components.',
    'Use one hero, one main workflow area and one supporting section.',
    'Prefer fewer well-spaced elements over many weak cards.',
    'Use domain-specific labels and icons.',
  ],
  visualPrinciples: [
    'Use one coherent accent color.',
    'Use generated imagery when it helps explain the product.',
    'Keep text readable and aligned.',
    'Avoid finance defaults unless the prompt is finance.',
    'Avoid placeholder copy.',
  ],
  commonComponents: [
    'imageHero',
    'largeIconTile',
    'iconFeatureGrid',
    'primaryCTA',
    'bottomNavBar',
  ],
  avoid: [
    'Finance defaults for unknown categories.',
    'Generic placeholder text.',
    'Unrelated labels from other app domains.',
    'Overcrowded screens.',
  ],
};

/** Static members of the Swift `MobileDesignPattern` extension. */
export const MobileDesignPatternPresets = {
  finance,
  mentalHealth,
  travel,
  aiChat,
  fitness,
  generic,
} as const;

export const MobileDesignPatternLibrary = {
  // בוחר סגנון לפי מילים בפרומפט של המשתמש
  pattern(prompt: string): MobileDesignPattern {
    const lowercased = prompt.toLowerCase();

    if (
      lowercased.includes('finance') ||
      lowercased.includes('trading') ||
      lowercased.includes('bank') ||
      lowercased.includes('wallet') ||
      lowercased.includes('crypto') ||
      lowercased.includes('מניות') ||
      lowercased.includes('מסחר') ||
      lowercased.includes('השקעות') ||
      lowercased.includes('בנק') ||
      lowercased.includes('ארנק') ||
      lowercased.includes('קריפטו')
    ) {
      return finance;
    }

    if (
      lowercased.includes('fitness') ||
      lowercased.includes('workout') ||
      lowercased.includes('gym') ||
      lowercased.includes('run') ||
      lowercased.includes('running') ||
      lowercased.includes('jog') ||
      lowercased.includes('pace') ||
      lowercased.includes('כושר') ||
      lowercased.includes('אימון') ||
      lowercased.includes('ריצה') ||
      lowercased.includes('ריצות') ||
      lowercased.includes('ספורט')
    ) {
      return fitness;
    }

    if (
      lowercased.includes('mental') ||
      lowercased.includes('therapy') ||
      lowercased.includes('self care') ||
      lowercased.includes('wellness') ||
      lowercased.includes('מדיטציה') ||
      lowercased.includes('רוגע')
    ) {
      return mentalHealth;
    }

    if (
      lowercased.includes('travel') ||
      lowercased.includes('hotel') ||
      lowercased.includes('flight') ||
      lowercased.includes('trip') ||
      lowercased.includes('טיול') ||
      lowercased.includes('נסיעה') ||
      lowercased.includes('חופשה')
    ) {
      return travel;
    }

    if (
      lowercased.includes('ai') ||
      lowercased.includes('chat') ||
      lowercased.includes('assistant') ||
      lowercased.includes('צאט') ||
      lowercased.includes("צ'אט") ||
      lowercased.includes('שיחה') ||
      lowercased.includes('הודעות')
    ) {
      return aiChat;
    }

    return generic;
  },
};
