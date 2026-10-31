// Ported 1:1 from AgenticDesigner/DesignIntelligence/TemplateFactory.swift
//
// One-click starter apps — no prompt, no API key, no wait. Each template is
// assembled deterministically from the typed component registry and styled
// by a VisualStylePreset, emitted in the agent's own action dialect and
// replayed through the exact applyDesignActions path the AI uses. Templates
// therefore improve automatically whenever ComponentFactory does.

import { decodeDesignAgentResponse, type DesignAction } from '../agent/DesignAction';
import type { JSONObject, JSONValue } from '../models/JSON';
import type { VisualStylePreset } from '../models/VisualStylePreset';
import { DesignTokenLibrary } from './DesignTokenLibrary';

export interface AppTemplate {
  id: string;
  name: string;
  subtitle: string;
  style: VisualStylePreset;
  screens: TemplateScreen[];
}

export interface TemplateStackItem {
  /** componentType raw name */
  type: string;
  props: Record<string, string>;
  /** fixed height in the stack */
  height: number;
}

export interface TemplateScreen {
  name: string;
  stack: TemplateStackItem[];
  /** Component pinned to the screen bottom (tab bar), if any. */
  bottomBar: boolean;
}

function screen(name: string, stack: [string, Record<string, string>, number][], bottomBar: boolean = true): TemplateScreen {
  return {
    name,
    stack: stack.map(([type, props, height]) => ({ type, props, height })),
    bottomBar,
  };
}

// MARK: - Catalog

const all: AppTemplate[] = [
  {
    id: 'finance-dashboard', name: 'Finance Dashboard',
    subtitle: 'Balance, quick actions, transactions',
    style: 'softFintech',
    screens: [
      screen('Home', [
        ['avatarGreetingHeader', { greeting: 'Good morning', name: 'Alex' }, 64],
        ['balanceHeroCard', { title: 'Total Balance', amount: '$24,562.80', delta: '+2.4% this month' }, 180],
        ['quickActionRow', {}, 92],
        ['transactionList', { title: 'Recent Activity' }, 280],
      ]),
      screen('Analytics', [
        ['header', { title: 'Analytics' }, 56],
        ['chartCard', { title: 'Spending', period: 'Last 6 months' }, 240],
        ['metricCard', { title: 'Income', value: '$8,210' }, 110],
        ['metricCard', { title: 'Expenses', value: '$5,904' }, 110],
      ]),
      screen('Profile', [
        ['avatarGreetingHeader', { greeting: 'Premium member', name: 'Alex Rivera' }, 72],
        ['contentCard', { title: 'Account', subtitle: 'Profile, security, linked banks' }, 110],
        ['contentCard', { title: 'Notifications', subtitle: 'Alerts and weekly summaries' }, 110],
        ['contentCard', { title: 'Privacy', subtitle: 'Data sharing and permissions' }, 110],
      ]),
    ],
  },
  {
    id: 'fitness-tracker', name: 'Fitness Tracker',
    subtitle: 'Workouts, progress rings, streaks',
    style: 'energeticFitness',
    screens: [
      screen('Today', [
        ['avatarGreetingHeader', { greeting: "Let's move", name: 'Jordan' }, 64],
        ['progressRing', { title: 'Daily Goal', progress: '68%' }, 200],
        ['workoutCard', { title: 'Morning Run', duration: '5.2 km · 28 min' }, 140],
        ['workoutCard', { title: 'Strength', duration: 'Upper body · 45 min' }, 140],
      ]),
      screen('Workout', [
        ['header', { title: 'Morning Run' }, 56],
        ['heroCard', { title: '5.2 km', subtitle: 'Personal best pace' }, 200],
        ['metricCard', { title: 'Calories', value: '412' }, 110],
        ['metricCard', { title: 'Heart Rate', value: '148 bpm' }, 110],
      ]),
      screen('Stats', [
        ['header', { title: 'This Week' }, 56],
        ['chartCard', { title: 'Activity', period: '7 days' }, 240],
        ['statCard', { title: 'Streak', value: '12 days' }, 110],
      ]),
    ],
  },
  {
    id: 'ecommerce-shop', name: 'E-commerce Shop',
    subtitle: 'Storefront, product page, cart',
    style: 'playfulEcommerce',
    screens: [
      screen('Shop', [
        ['searchBar', { placeholder: 'Search products' }, 52],
        ['categoryChips', {}, 48],
        ['heroCard', { title: 'Summer Sale', subtitle: 'Up to 40% off' }, 180],
        ['productGrid', {}, 300],
      ]),
      screen('Product', [
        ['header', { title: 'Product' }, 56],
        ['heroCard', { title: 'Studio Headphones', subtitle: '$249' }, 260],
        ['contentCard', { title: 'Details', subtitle: 'Wireless, 40h battery, memory foam.' }, 140],
        ['primaryButton', { title: 'Add to Cart' }, 60],
      ]),
      screen('Cart', [
        ['header', { title: 'Your Cart' }, 56],
        ['contentCard', { title: 'Studio Headphones', subtitle: 'Qty 1 · $249' }, 96],
        ['contentCard', { title: 'Woven Tote Bag', subtitle: 'Qty 1 · $189' }, 96],
        ['metricCard', { title: 'Total', value: '$438' }, 100],
        ['primaryButton', { title: 'Checkout' }, 60],
      ]),
    ],
  },
  {
    id: 'travel-explorer', name: 'Travel Explorer',
    subtitle: 'Destinations, trip details',
    style: 'luxuryTravel',
    screens: [
      screen('Explore', [
        ['searchBar', { placeholder: 'Where to?' }, 52],
        ['categoryChips', {}, 48],
        ['heroCard', { title: 'Kyoto, Japan', subtitle: 'Temples & gardens' }, 220],
        ['contentCard', { title: 'Santorini', subtitle: 'Aegean sunsets' }, 140],
      ]),
      screen('Trip', [
        ['header', { title: 'Kyoto' }, 56],
        ['heroCard', { title: '5 days', subtitle: 'Apr 12 – Apr 17' }, 220],
        ['contentCard', { title: 'Itinerary', subtitle: 'Fushimi Inari, Arashiyama, tea ceremony.' }, 160],
        ['primaryButton', { title: 'Book Trip' }, 60],
      ]),
      screen('Saved', [
        ['header', { title: 'Saved Places' }, 56],
        ['contentCard', { title: 'Lisbon', subtitle: 'Tram 28, pastel streets' }, 130],
        ['contentCard', { title: 'Reykjavik', subtitle: 'Northern lights' }, 130],
      ]),
    ],
  },
  {
    id: 'ai-chat', name: 'AI Chat Assistant',
    subtitle: 'Conversation, history',
    style: 'premiumDark',
    screens: [
      screen('Chat', [
        ['header', { title: 'Assistant' }, 56],
        ['chatMessage', { role: 'assistant', text: 'Hi! How can I help today?' }, 90],
        ['chatMessage', { role: 'user', text: 'Plan my week' }, 70],
        ['chatMessage', { role: 'assistant', text: "Here's a focused plan for your week…" }, 110],
        ['textField', { placeholder: 'Message…' }, 56],
      ], false),
      screen('History', [
        ['header', { title: 'Conversations' }, 56],
        ['contentCard', { title: 'Week planning', subtitle: 'Yesterday' }, 100],
        ['contentCard', { title: 'Trip ideas', subtitle: 'Monday' }, 100],
        ['contentCard', { title: 'Recipe help', subtitle: 'Last week' }, 100],
      ]),
    ],
  },
  {
    id: 'wellness', name: 'Wellness & Meditation',
    subtitle: 'Calm home, session player',
    style: 'appleCalm',
    screens: [
      screen('Today', [
        ['avatarGreetingHeader', { greeting: 'Good evening', name: 'Sam' }, 64],
        ['heroCard', { title: 'Evening Wind-down', subtitle: '10 min · Breathing' }, 200],
        ['contentCard', { title: 'Sleep Stories', subtitle: 'Drift off gently' }, 130],
        ['contentCard', { title: 'Focus', subtitle: 'Deep work sounds' }, 130],
      ]),
      screen('Session', [
        ['header', { title: 'Evening Wind-down' }, 56],
        ['progressRing', { title: 'Remaining', progress: '6:24' }, 240],
        ['primaryButton', { title: 'Pause' }, 60],
      ]),
    ],
  },
  {
    id: 'saas-onboarding', name: 'SaaS Onboarding',
    subtitle: 'Welcome, login, paywall',
    style: 'minimalEditorial',
    screens: [
      screen('Welcome', [
        ['heroCard', { title: 'Ship faster', subtitle: 'The workspace for modern teams' }, 280],
        ['primaryButton', { title: 'Get Started' }, 60],
        ['secondaryButton', { title: 'I have an account' }, 56],
      ], false),
      screen('Login', [
        ['header', { title: 'Welcome back' }, 64],
        ['textField', { placeholder: 'Email' }, 56],
        ['textField', { placeholder: 'Password' }, 56],
        ['primaryButton', { title: 'Log In' }, 60],
      ], false),
      screen('Paywall', [
        ['header', { title: 'Go Pro' }, 64],
        ['heroCard', { title: 'Pro', subtitle: '$12/mo — unlimited projects' }, 220],
        ['contentCard', { title: 'Everything in Free', subtitle: 'plus SSO, audit log, priority support' }, 140],
        ['primaryButton', { title: 'Start Free Trial' }, 60],
      ], false),
    ],
  },
];

// MARK: - Action assembly

const screenSize = { width: 390, height: 844 };
const margin = 20;
const gap = 16;
const topInset = 64;

export const TemplateFactory = {
  all,

  template(id: string): AppTemplate | undefined {
    return all.find((template) => template.id === id);
  },

  /// Agent-dialect actions for a template — decoded through the same
  /// parser as live agent output, so apply behavior is identical.
  actions(template: AppTemplate): DesignAction[] {
    const tokens = DesignTokenLibrary.tokens(template.style);
    const actionDicts: JSONObject[] = [];

    template.screens.forEach((templateScreen, index) => {
      const screenRef = `screen_${index}`;
      const originX = 100 + index * (screenSize.width + 60);
      actionDicts.push({
        type: 'createFrame',
        name: templateScreen.name,
        nodeReference: screenRef,
        x: originX, y: 100,
        width: screenSize.width, height: screenSize.height,
        fill: tokens.colors.backgroundPrimary,
        cornerRadius: 40,
      });

      let cursorY = topInset;
      templateScreen.stack.forEach((item, componentIndex) => {
        actionDicts.push({
          type: 'createComponent',
          component: item.type,
          props: item.props as unknown as JSONValue,
          parentReference: screenRef,
          nodeReference: `${screenRef}_c${componentIndex}`,
          stylePreset: template.style,
          x: margin, y: cursorY,
          width: screenSize.width - margin * 2, height: item.height,
        });
        cursorY += item.height + gap;
      });

      if (templateScreen.bottomBar) {
        actionDicts.push({
          type: 'createComponent',
          component: 'bottomNavBar',
          props: {},
          parentReference: screenRef,
          nodeReference: `${screenRef}_nav`,
          stylePreset: template.style,
          x: 0, y: screenSize.height - 88,
          width: screenSize.width, height: 88,
        });
      }
    });

    const payload: JSONObject = { plan: [], actions: actionDicts };
    return decodeDesignAgentResponse(payload).actions;
  },
};
