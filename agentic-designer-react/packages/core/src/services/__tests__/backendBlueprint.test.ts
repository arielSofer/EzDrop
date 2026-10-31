// BackendBlueprint: per-category schemas, the opt-out phrases, and the
// GoogleService-Info.plist / firestore.rules the blueprint's collections and
// publicReadCollections produce.

import { describe, expect, it } from 'vitest';
import { makeFirebaseConfig } from '../../models/FirebaseConfig';
import {
  backendBlueprintCollections,
  blueprint,
  firestoreCollections,
  firestoreRulesSource,
  googleServiceInfoPlist,
  infer,
  promptOptsOut,
} from '../BackendBlueprint';

describe('BackendBlueprint', () => {
  it('infers the category schema from the prompt', () => {
    expect(infer('a crypto trading portfolio app').primary.collection).toBe('holdings');
    expect(infer('a running tracker with workouts').primary.collection).toBe('workouts');
    expect(infer('a food delivery app').primary.collection).toBe('orders');
    expect(infer('something entirely unclassifiable').primary.collection).toBe('items');
  });

  it('always puts users first and wraps every entity with userId/createdAt', () => {
    const trading = blueprint('trading');
    const collections = backendBlueprintCollections(trading);
    expect(collections.map((c) => c.name)).toEqual(['users', 'holdings', 'watchlist', 'orders']);
    expect(collections[0]!.fields.map((f) => f.name)).toEqual(['displayName', 'email', 'photoURL', 'createdAt']);
    expect(collections[1]!.fields.map((f) => f.name)).toEqual([
      'userId', 'symbol', 'quantity', 'buyPrice', 'createdAt',
    ]);
    expect(trading.publicReadCollections).toEqual(['markets']);
  });

  it('marks the collections a feed has to share', () => {
    expect(blueprint('social').publicReadCollections).toEqual(['posts', 'comments', 'follows']);
    expect(blueprint('foodDelivery').publicReadCollections).toEqual(['restaurants', 'menuItems']);
    expect(blueprint('productivity').publicReadCollections).toEqual([]);
  });

  it('adds the per-category profile fields', () => {
    expect(blueprint('fitness').profileFields.map((f) => f.name)).toEqual([
      'displayName', 'email', 'photoURL', 'createdAt', 'weightKg',
    ]);
    expect(blueprint('social').profileFields.map((f) => f.name)).toEqual([
      'displayName', 'email', 'photoURL', 'createdAt', 'username', 'bio',
    ]);
  });

  it('detects an explicit backend opt-out', () => {
    expect(promptOptsOut('a notes app, local only, no login')).toBe(true);
    expect(promptOptsOut('אפליקציית מטלות בלי הרשמה')).toBe(true);
    expect(promptOptsOut('a notes app with sync')).toBe(false);
  });

  it('generates owner-scoped rules with public reads for the shared collections', () => {
    const social = blueprint('social');
    const config = makeFirebaseConfig({
      isEnabled: true,
      projectId: 'demo-app',
      apiKey: 'AIzaTESTKEY',
      appId: '1:1234567890:ios:abcdef',
      messagingSenderId: '1234567890',
      defaultCollections: backendBlueprintCollections(social),
      publicReadCollections: social.publicReadCollections,
    });
    const rules = firestoreRulesSource(firestoreCollections([], config), config.publicReadCollections);
    expect(rules).toMatchSnapshot();
  });

  it('writes a GoogleService-Info.plist once every credential is present', () => {
    const config = makeFirebaseConfig({
      isEnabled: true,
      projectId: 'demo-app',
      apiKey: 'AIzaTESTKEY',
      appId: '1:1234567890:ios:abcdef',
      messagingSenderId: '1234567890',
    });
    expect(googleServiceInfoPlist(config, 'com.agentic.demo')).toMatchSnapshot();
    // A projectId alone is not enough for a plist.
    expect(googleServiceInfoPlist(makeFirebaseConfig({ isEnabled: true, projectId: 'demo' }), 'com.agentic.demo')).toBeUndefined();
    expect(googleServiceInfoPlist(undefined, 'com.agentic.demo')).toBeUndefined();
  });
});
