// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift
// (`extension ProjectViewModel` — AgentSemanticDomain and the semantic-copy
// repair pass that keeps a running app from shipping fintech microcopy).

import type { DesignNode } from '@agentic/core';

export const AllAgentSemanticDomain = [
  'runningFitness',
  'finance',
  'ecommerce',
  'music',
  'chat',
  'books',
  'travel',
  'wellness',
  'generic',
] as const;
export type AgentSemanticDomain = (typeof AllAgentSemanticDomain)[number];

export function agentSemanticDomainPrimaryTitle(domain: AgentSemanticDomain): string {
  switch (domain) {
    case 'runningFitness': return 'Run Dashboard';
    case 'finance': return 'Your Portfolio';
    case 'ecommerce': return 'New Arrivals';
    case 'music': return 'Your Library';
    case 'chat': return 'Messages';
    case 'books': return 'Reading Now';
    case 'travel': return 'Explore';
    case 'wellness': return 'Today Check-In';
    case 'generic': return "Today's Focus";
  }
}

export function agentSemanticDomainPrimaryCTA(domain: AgentSemanticDomain): string {
  switch (domain) {
    case 'runningFitness': return 'Start Run';
    case 'finance': return 'View Portfolio';
    case 'ecommerce': return 'Shop Now';
    case 'music': return 'Play Now';
    case 'chat': return 'New Chat';
    case 'books': return 'Continue Reading';
    case 'travel': return 'Explore Trips';
    case 'wellness': return 'Begin Session';
    case 'generic': return 'Get Started';
  }
}

export function agentSemanticDomainFallbackBody(domain: AgentSemanticDomain): string {
  switch (domain) {
    case 'runningFitness': return 'Track pace, distance, routes and progress in one clean view.';
    case 'finance': return 'Track performance, activity and insights at a glance.';
    case 'ecommerce': return 'Discover curated picks and product highlights.';
    case 'music': return 'Queue up fresh tracks and keep listening.';
    case 'chat': return 'Keep conversations organized and easy to continue.';
    case 'books': return 'Continue reading and discover your next book.';
    case 'travel': return 'Explore curated places and plan your next trip.';
    case 'wellness': return 'Slow down, check in and continue your session.';
    case 'generic': return 'Key details for this experience.';
  }
}

export function agentSemanticDomainExactTextReplacements(domain: AgentSemanticDomain): Record<string, string> {
  switch (domain) {
    case 'runningFitness':
      return {
        'your portfolio': 'Run Dashboard',
        portfolio: 'Run Dashboard',
        'shop now': 'Start Run',
        'add to cart': 'Start Run',
        buy: 'Run',
        sell: 'Plan',
        deposit: 'Log',
        transfer: 'Routes',
        markets: 'Activity',
        market: 'Activity',
        trade: 'Routes',
        wallet: 'Progress',
        'market pulse': 'Morning Run',
        'product detail': 'Run Details',
      };
    case 'finance':
      return {
        'shop now': 'View Portfolio',
        'add to cart': 'Transfer',
        'product detail': 'Account Details',
        playlist: 'Watchlist',
      };
    case 'ecommerce':
      return {
        'your portfolio': 'New Arrivals',
        portfolio: 'New Arrivals',
        'market pulse': 'Trending Now',
        buy: 'Shop',
        sell: 'Deals',
        deposit: 'Saved',
        transfer: 'Orders',
      };
    case 'music':
      return {
        'your portfolio': 'Your Library',
        portfolio: 'Your Library',
        'shop now': 'Play Now',
        'add to cart': 'Save Track',
        'market pulse': 'Daily Mix',
        'product detail': 'Track Details',
        buy: 'Play',
        sell: 'Browse',
        deposit: 'Save',
        transfer: 'Share',
      };
    case 'chat':
      return {
        'your portfolio': 'Messages',
        portfolio: 'Messages',
        'shop now': 'New Chat',
        'add to cart': 'Send',
        'market pulse': 'Recent Chats',
        'user message': 'You',
        'ai response': 'Assistant',
        'product detail': 'Conversation',
      };
    case 'books':
      return {
        'your portfolio': 'Reading Now',
        portfolio: 'Reading Now',
        'shop now': 'Continue Reading',
        'add to cart': 'Save Book',
        'market pulse': 'Recommended Reads',
        'product detail': 'Book Details',
        buy: 'Read',
        sell: 'Browse',
        deposit: 'Save',
        transfer: 'Share',
      };
    case 'travel':
      return {
        'your portfolio': 'Explore',
        portfolio: 'Explore',
        'shop now': 'Explore Trips',
        'add to cart': 'Book Trip',
        'market pulse': 'Top Destinations',
        'product detail': 'Trip Details',
        buy: 'Book',
        sell: 'Discover',
        deposit: 'Saved',
        transfer: 'Route',
      };
    case 'wellness':
      return {
        'your portfolio': 'Today Check-In',
        portfolio: 'Today Check-In',
        'shop now': 'Begin Session',
        'add to cart': 'Save Session',
        'market pulse': 'Daily Calm',
        'product detail': 'Session Details',
        buy: 'Start',
        sell: 'Reflect',
        deposit: 'Log',
        transfer: 'Share',
      };
    case 'generic':
      return {};
  }
}

const financeTerms = [
  'portfolio', 'stock', 'broker', 'market', 'buy', 'sell', 'deposit', 'transfer', 'crypto', 'wallet', 'trade',
];
const ecommerceTerms = ['shop', 'cart', 'checkout', 'product', 'price', 'new arrivals'];
const musicTerms = ['playlist', 'album', 'song', 'artist'];
const chatTerms = ['user message', 'ai response', 'chat input'];

export function agentSemanticDomainForbiddenTerms(domain: AgentSemanticDomain): string[] {
  switch (domain) {
    case 'runningFitness':
      return [...financeTerms, ...ecommerceTerms, ...musicTerms, ...chatTerms];
    case 'finance':
      return [...ecommerceTerms, ...musicTerms, ...chatTerms];
    case 'ecommerce':
      return [...financeTerms, ...musicTerms, ...chatTerms];
    case 'music':
      return [...financeTerms, ...ecommerceTerms, ...chatTerms];
    case 'chat':
      return [...financeTerms, ...ecommerceTerms, ...musicTerms];
    case 'books':
      return [...financeTerms, ...ecommerceTerms, ...musicTerms, ...chatTerms];
    case 'travel':
      return [...financeTerms, ...ecommerceTerms, ...musicTerms, ...chatTerms];
    case 'wellness':
      return [...financeTerms, ...ecommerceTerms, ...musicTerms, ...chatTerms];
    case 'generic':
      return [];
  }
}

export function containsAny(text: string, fragments: string[]): boolean {
  return fragments.some((fragment) => text.includes(fragment));
}

export function semanticDomain(prompt: string): AgentSemanticDomain {
  const text = prompt.toLowerCase();

  if (containsAny(text, ['run', 'running', 'runner', 'jog', 'fitness', 'workout', 'gym', 'pace', 'marathon', 'כושר', 'אימון', 'ריצה', 'ריצות', 'ספורט', 'קצב'])) {
    return 'runningFitness';
  }
  if (containsAny(text, ['stock', 'broker', 'trading', 'finance', 'bank', 'wallet', 'portfolio', 'crypto', 'invest', 'מניות', 'מסחר', 'השקעות', 'בנק', 'ארנק', 'פורטפוליו', 'קריפטו'])) {
    return 'finance';
  }
  if (containsAny(text, ['shop', 'store', 'ecommerce', 'commerce', 'product', 'cart', 'retail', 'חנות', 'קניות', 'מוצר', 'מוצרים'])) {
    return 'ecommerce';
  }
  if (containsAny(text, ['spotify', 'music', 'audio', 'playlist', 'song', 'album', 'podcast', 'מוזיקה', 'שירים', 'פלייליסט', 'ספוטיפיי'])) {
    return 'music';
  }
  if (containsAny(text, ['chat', 'message', 'messenger', 'assistant', 'ai', 'צאט', "צ'אט", 'שיחה', 'הודעות', 'עוזר'])) {
    return 'chat';
  }
  if (containsAny(text, ['book', 'reading', 'library', 'ebook', 'novel', 'ספר', 'ספרים', 'קריאה', 'ספריה'])) {
    return 'books';
  }
  if (containsAny(text, ['travel', 'trip', 'hotel', 'flight', 'destination', 'journey', 'טיול', 'נסיעה', 'מלון', 'טיסה', 'חופשה'])) {
    return 'travel';
  }
  if (containsAny(text, ['meditation', 'wellness', 'mental', 'therapy', 'mindful', 'calm', 'מדיטציה', 'רוגע', 'נפש', 'מיינדפולנס'])) {
    return 'wellness';
  }

  return 'generic';
}

export function isPlaceholderCopy(lower: string): boolean {
  return (
    lower === 'flexible section' ||
    lower === 'product detail' ||
    lower === 'key details' ||
    lower.startsWith('[') ||
    lower.endsWith(']') ||
    lower.includes('placeholder') ||
    lower.includes('lorem ipsum')
  );
}

export function looksLikePromptArtifact(text: string): boolean {
  const lower = text.toLowerCase();
  const fragments = [
    'negativeprompt',
    'negative prompt',
    'imageprompt',
    'ui usage',
    'no readable text',
    'app screenshot',
    'phone mockup',
    'watermark',
    'low quality',
    'lighting',
    'palette',
    'composition',
    'constraints',
    'modern professional',
    'quality full',
    'ipatrong',
    'profesm',
    'hiscvvice',
    'strorp',
    'caleative',
    'mdoern',
    'lusisable',
    'prodecasions',
    'artictor',
  ];

  if (containsAny(lower, fragments)) return true;

  const words = lower.split(/[^0-9a-z֐-׿]+/i).filter((word) => word.length >= 7);
  const suspiciousLongWords = words.filter((word) =>
    containsAny(word, ['prompt', 'artifact', 'unstyled', 'render', 'negative']),
  );

  return suspiciousLongWords.length >= 2;
}

export function likelyHeadline(node: DesignNode): boolean {
  const name = node.name.toLowerCase();
  const fontSize = node.style.fontSize ?? 0;
  return fontSize >= 22 || name.includes('title') || name.includes('headline') || name.includes('hero');
}

export function likelyCTA(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 24) return false;
  return (
    trimmed === trimmed.toUpperCase() ||
    containsAny(trimmed.toLowerCase(), ['shop', 'cart', 'start', 'begin', 'continue', 'book', 'play', 'send'])
  );
}

export function styledReplacement(replacement: string, original: string): string {
  const trimmed = original.trim();
  if (trimmed === trimmed.toUpperCase() && trimmed.length <= 24) {
    return replacement.toUpperCase();
  }
  return replacement;
}

export function placeholderReplacement(node: DesignNode, domain: AgentSemanticDomain): string {
  if (likelyHeadline(node)) return agentSemanticDomainPrimaryTitle(domain);
  if (node.type === 'Button' || likelyCTA(node.text ?? '')) return agentSemanticDomainPrimaryCTA(domain);
  return agentSemanticDomainFallbackBody(domain);
}

export function semanticReplacement(node: DesignNode, domain: AgentSemanticDomain): string | undefined {
  if (!(node.type === 'Text' || node.type === 'Button' || node.type === 'Input')) return undefined;
  const originalText = node.text?.trim();
  if (!originalText || originalText.length === 0) return undefined;

  const lower = originalText.toLowerCase();

  if (looksLikePromptArtifact(originalText)) {
    return styledReplacement(agentSemanticDomainFallbackBody(domain), originalText);
  }

  if (isPlaceholderCopy(lower)) {
    return styledReplacement(placeholderReplacement(node, domain), originalText);
  }

  const exact = agentSemanticDomainExactTextReplacements(domain)[lower];
  if (exact !== undefined) {
    return styledReplacement(exact, originalText);
  }

  if (domain === 'generic' || !containsAny(lower, agentSemanticDomainForbiddenTerms(domain))) {
    return undefined;
  }

  if (node.type === 'Button' || likelyCTA(originalText)) {
    return styledReplacement(agentSemanticDomainPrimaryCTA(domain), originalText);
  }

  if (likelyHeadline(node)) {
    return styledReplacement(agentSemanticDomainPrimaryTitle(domain), originalText);
  }

  return styledReplacement(agentSemanticDomainFallbackBody(domain), originalText);
}

export function repairSemanticCopy(node: DesignNode, domain: AgentSemanticDomain): void {
  const replacement = semanticReplacement(node, domain);
  if (replacement !== undefined) node.text = replacement;

  for (const child of node.children) repairSemanticCopy(child, domain);
}
