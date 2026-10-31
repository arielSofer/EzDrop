// Ported 1:1 from AgenticDesigner/Services/BackendBlueprint.swift
//
// What "save the user's data" MEANS for a given app. A habit tracker needs
// habits + check-ins keyed by uid; a shop needs orders and a public catalog;
// a chat app needs conversations and messages. Nothing in the pipeline used
// to decide this, so a generated app got auth blocks at best and no data
// model at all — the user had to invent the Firestore schema by hand.
//
// Deterministic (no model call): the app category the classifier already
// detects maps to a real schema, so one prompt produces the same correct
// backend every time, on any model, including tiny local ones.

import { AppCategoryClassifier, type AppCategory } from '../designIntelligence/AppCategory';
import {
  makeFirestoreCollectionTemplate,
  makeFirestoreFieldTemplate,
  type FirestoreCollectionTemplate,
  type FirestoreFieldTemplate,
} from '../models/FirebaseConfig';

// The security rules, GoogleService-Info.plist and collection derivation that
// turn a blueprint into real backend files live next to the codegen in
// LogicExporter (Swift: LogicExporter.firestoreRules / googleServiceInfoPlist /
// firestoreCollections). Re-exported here so the backend pass and its tests
// reach them by name.
export {
  firestoreCollections,
  firestoreRulesSource,
  googleServiceInfoPlist,
  firebaseRCSource,
} from './logicExporter/projectFiles';

/** `BackendBlueprint.Entity` — a collection the generated app writes per-user documents into. */
export interface BackendBlueprintEntity {
  /** Firestore collection name — plural, lowercase, no path separators. */
  collection: string;
  /** Human label for copy ("Save Workout", "New Habit"). */
  label: string;
  /** Fields the create-flow writes, beyond userId/createdAt. */
  fields: FirestoreFieldTemplate[];
  /** Global variable the list query stores its JSON array into. */
  listVariable: string;
}

export interface BackendBlueprint {
  category: AppCategory;
  /** The one collection the app's main screen lists and its primary CTA writes to. */
  primary: BackendBlueprintEntity;
  secondary: BackendBlueprintEntity[];
  /** Profile fields written to users/{uid} at sign-up. */
  profileFields: FirestoreFieldTemplate[];
  /**
   * Collections every signed-in user may READ but only the owner may write
   * (a shop catalog, a social feed, a course list). Owner-only read rules
   * would break these at runtime — a feed nobody can read is not a feed.
   */
  publicReadCollections: string[];
}

/** `BackendBlueprint.collections` — every collection the project should declare, users/ first. */
export function backendBlueprintCollections(blueprint: BackendBlueprint): FirestoreCollectionTemplate[] {
  const out: FirestoreCollectionTemplate[] = [
    makeFirestoreCollectionTemplate({ name: 'users', fields: blueprint.profileFields }),
  ];
  for (const entity of [blueprint.primary, ...blueprint.secondary]) {
    out.push(
      makeFirestoreCollectionTemplate({
        name: entity.collection,
        fields: [
          makeFirestoreFieldTemplate({ name: 'userId', type: 'string' }),
          ...entity.fields,
          makeFirestoreFieldTemplate({ name: 'createdAt', type: 'timestamp' }),
        ],
      }),
    );
  }
  return out;
}

function field(name: string, type: string = 'string', required: boolean = true): FirestoreFieldTemplate {
  return makeFirestoreFieldTemplate({ name, type, isRequired: required });
}

function entity(
  collection: string,
  label: string,
  fields: FirestoreFieldTemplate[],
  listVariable: string,
): BackendBlueprintEntity {
  return { collection, label, fields, listVariable };
}

function profileFields(): FirestoreFieldTemplate[] {
  return [
    makeFirestoreFieldTemplate({ name: 'displayName', type: 'string', isRequired: false }),
    makeFirestoreFieldTemplate({ name: 'email', type: 'string' }),
    makeFirestoreFieldTemplate({ name: 'photoURL', type: 'string', isRequired: false }),
    makeFirestoreFieldTemplate({ name: 'createdAt', type: 'timestamp' }),
  ];
}

/** `BackendBlueprint.blueprint(for:)` */
export function blueprint(category: AppCategory): BackendBlueprint {
  const profile = profileFields();

  switch (category) {
    case 'finance':
    case 'banking':
      return {
        category,
        primary: entity(
          'transactions',
          'Transaction',
          [field('title'), field('amount', 'number'), field('category'), field('note', 'string', false)],
          'transactions',
        ),
        secondary: [
          entity('accounts', 'Account', [field('name'), field('balance', 'number'), field('currency')], 'accounts'),
          entity('budgets', 'Budget', [field('category'), field('limit', 'number')], 'budgets'),
        ],
        profileFields: profile,
        publicReadCollections: [],
      };

    case 'trading':
    case 'crypto':
      return {
        category,
        primary: entity(
          'holdings',
          'Holding',
          [field('symbol'), field('quantity', 'number'), field('buyPrice', 'number')],
          'holdings',
        ),
        secondary: [
          entity('watchlist', 'Watchlist Item', [field('symbol'), field('note', 'string', false)], 'watchlist'),
          entity(
            'orders',
            'Order',
            [field('symbol'), field('side'), field('quantity', 'number'), field('price', 'number')],
            'orders',
          ),
        ],
        profileFields: profile,
        publicReadCollections: ['markets'],
      };

    case 'fitness':
      return {
        category,
        primary: entity(
          'workouts',
          'Workout',
          [
            field('title'),
            field('distance', 'number'),
            field('duration', 'number'),
            field('calories', 'number', false),
            field('notes', 'string', false),
          ],
          'workouts',
        ),
        secondary: [
          entity('goals', 'Goal', [field('metric'), field('target', 'number'), field('period')], 'goals'),
        ],
        profileFields: [...profile, field('weightKg', 'number', false)],
        publicReadCollections: [],
      };

    case 'health':
      return {
        category,
        primary: entity(
          'healthLogs',
          'Health Log',
          [field('metric'), field('value', 'number'), field('unit'), field('notes', 'string', false)],
          'healthLogs',
        ),
        secondary: [
          entity('medications', 'Medication', [field('name'), field('dose'), field('schedule')], 'medications'),
        ],
        profileFields: profile,
        publicReadCollections: [],
      };

    case 'mentalHealth':
      return {
        category,
        primary: entity(
          'moodEntries',
          'Mood Entry',
          [field('mood'), field('score', 'number'), field('note', 'string', false)],
          'moodEntries',
        ),
        secondary: [
          entity('journalEntries', 'Journal Entry', [field('title'), field('body')], 'journalEntries'),
        ],
        profileFields: profile,
        publicReadCollections: ['meditations'],
      };

    case 'travel':
      return {
        category,
        primary: entity(
          'trips',
          'Trip',
          [field('destination'), field('startDate'), field('endDate'), field('notes', 'string', false)],
          'trips',
        ),
        secondary: [
          entity(
            'bookings',
            'Booking',
            [field('tripId'), field('kind'), field('reference'), field('price', 'number')],
            'bookings',
          ),
          entity(
            'savedPlaces',
            'Saved Place',
            [field('name'), field('city'), field('imageURL', 'string', false)],
            'savedPlaces',
          ),
        ],
        profileFields: profile,
        publicReadCollections: ['destinations'],
      };

    case 'ecommerce':
      return {
        category,
        primary: entity(
          'orders',
          'Order',
          [field('items'), field('total', 'number'), field('status'), field('address', 'string', false)],
          'orders',
        ),
        secondary: [
          entity(
            'cartItems',
            'Cart Item',
            [field('productId'), field('title'), field('price', 'number'), field('quantity', 'number')],
            'cartItems',
          ),
          entity(
            'favorites',
            'Favorite',
            [field('productId'), field('title'), field('imageURL', 'string', false)],
            'favorites',
          ),
        ],
        profileFields: [...profile, field('shippingAddress', 'string', false)],
        publicReadCollections: ['products'],
      };

    case 'foodDelivery':
      return {
        category,
        primary: entity(
          'orders',
          'Order',
          [field('restaurantId'), field('items'), field('total', 'number'), field('status')],
          'orders',
        ),
        secondary: [
          entity('addresses', 'Address', [field('label'), field('line1'), field('city')], 'addresses'),
          entity('favorites', 'Favorite', [field('restaurantId'), field('name')], 'favorites'),
        ],
        profileFields: profile,
        publicReadCollections: ['restaurants', 'menuItems'],
      };

    case 'education':
      return {
        category,
        primary: entity(
          'enrollments',
          'Enrollment',
          [field('courseId'), field('title'), field('progress', 'number')],
          'enrollments',
        ),
        secondary: [entity('notes', 'Note', [field('courseId'), field('body')], 'notes')],
        profileFields: profile,
        publicReadCollections: ['courses', 'lessons'],
      };

    case 'productivity':
      return {
        category,
        primary: entity(
          'tasks',
          'Task',
          [field('title'), field('notes', 'string', false), field('dueDate', 'string', false), field('isDone', 'boolean')],
          'tasks',
        ),
        secondary: [
          entity('projects', 'Project', [field('name'), field('color', 'string', false)], 'projects'),
        ],
        profileFields: profile,
        publicReadCollections: [],
      };

    case 'aiChat':
      return {
        category,
        primary: entity(
          'conversations',
          'Conversation',
          [field('title'), field('lastMessage', 'string', false)],
          'conversations',
        ),
        secondary: [
          entity('messages', 'Message', [field('conversationId'), field('role'), field('content')], 'messages'),
        ],
        profileFields: profile,
        publicReadCollections: [],
      };

    case 'social':
      return {
        category,
        primary: entity(
          'posts',
          'Post',
          [field('body'), field('imageURL', 'string', false), field('likeCount', 'number', false)],
          'posts',
        ),
        secondary: [
          entity('comments', 'Comment', [field('postId'), field('body')], 'comments'),
          entity('follows', 'Follow', [field('followingId')], 'follows'),
        ],
        profileFields: [...profile, field('username'), field('bio', 'string', false)],
        // A feed only works if everyone can read everyone's posts.
        publicReadCollections: ['posts', 'comments', 'follows'],
      };

    case 'realEstate':
      return {
        category,
        primary: entity(
          'savedListings',
          'Saved Listing',
          [field('listingId'), field('title'), field('price', 'number'), field('imageURL', 'string', false)],
          'savedListings',
        ),
        secondary: [
          entity('inquiries', 'Inquiry', [field('listingId'), field('message')], 'inquiries'),
        ],
        profileFields: profile,
        publicReadCollections: ['listings'],
      };

    case 'music':
      return {
        category,
        primary: entity(
          'playlists',
          'Playlist',
          [field('name'), field('trackCount', 'number', false)],
          'playlists',
        ),
        secondary: [
          entity('likedTracks', 'Liked Track', [field('trackId'), field('title'), field('artist')], 'likedTracks'),
        ],
        profileFields: profile,
        publicReadCollections: ['tracks', 'albums'],
      };

    case 'calendar':
      return {
        category,
        primary: entity(
          'events',
          'Event',
          [
            field('title'),
            field('startDate'),
            field('endDate', 'string', false),
            field('location', 'string', false),
            field('notes', 'string', false),
          ],
          'events',
        ),
        secondary: [],
        profileFields: profile,
        publicReadCollections: [],
      };

    case 'habitTracker':
      return {
        category,
        primary: entity(
          'habits',
          'Habit',
          [field('name'), field('target', 'number'), field('streak', 'number', false)],
          'habits',
        ),
        secondary: [entity('checkins', 'Check-in', [field('habitId'), field('date')], 'checkins')],
        profileFields: profile,
        publicReadCollections: [],
      };

    case 'generic':
      return {
        category,
        primary: entity('items', 'Item', [field('title'), field('notes', 'string', false)], 'items'),
        secondary: [],
        profileFields: profile,
        publicReadCollections: [],
      };
  }
}

/** `BackendBlueprint.infer(prompt:)` */
export function infer(prompt: string): BackendBlueprint {
  return blueprint(AppCategoryClassifier.classify(prompt));
}

/**
 * `BackendBlueprint.promptOptsOut(_:)` — a prompt can wave the backend off
 * ("no login", "local only", "בלי הרשמה"). Without this an explicitly offline
 * app would still be given a sign-in wall, the opposite of what was asked for.
 */
export function promptOptsOut(prompt: string): boolean {
  const text = prompt.toLowerCase();
  const phrases = [
    'no login', 'no log in', 'no sign in', 'no sign-in', 'without login',
    'without sign in', 'no signup', 'no sign up', 'no account', 'no accounts',
    'no auth', 'no backend', 'no firebase', 'local only', 'local-only',
    'offline only', 'offline-only', 'no server', 'guest only',
    'בלי הרשמה', 'ללא הרשמה', 'בלי התחברות', 'ללא התחברות',
    'בלי חשבון', 'ללא חשבון', 'בלי שרת', 'ללא שרת', 'מקומי בלבד',
  ];
  return phrases.some((phrase) => text.includes(phrase));
}

/** Static members of the Swift `BackendBlueprint` struct. */
export const BackendBlueprintLibrary = {
  infer,
  blueprint,
  promptOptsOut,
  collections: backendBlueprintCollections,
} as const;
