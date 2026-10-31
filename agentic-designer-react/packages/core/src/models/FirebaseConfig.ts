// Ported 1:1 from AgenticDesigner/Models/FirebaseConfig.swift
//
// Project-level Firebase configuration applied to all Firebase blocks.
// Blocks describe *what* should happen; the exported blueprint carries this
// configuration so real Firebase code can be generated for the target platform.

import { newUUID } from './uuid';

export interface FirebaseConfig {
  projectId: string;
  apiKey: string;
  authDomain: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  isEnabled: boolean;

  // Auth settings
  enableEmailAuth: boolean;
  enableGoogleAuth: boolean;
  enableAppleAuth: boolean;
  enableAnonymousAuth: boolean;

  // Firestore settings
  firestoreRules: string;
  defaultCollections: FirestoreCollectionTemplate[];
  /// Collections every signed-in user may READ, but only the document's
  /// owner may write: a shop catalog, a social feed, a course list. The
  /// default owner-only read rule is correct for private data and fatal for
  /// shared data — a feed nobody but the author can read is not a feed.
  publicReadCollections: string[];
}

export function makeFirebaseConfig(init: Partial<FirebaseConfig> = {}): FirebaseConfig {
  return {
    projectId: init.projectId ?? '',
    apiKey: init.apiKey ?? '',
    authDomain: init.authDomain ?? '',
    storageBucket: init.storageBucket ?? '',
    messagingSenderId: init.messagingSenderId ?? '',
    appId: init.appId ?? '',
    isEnabled: init.isEnabled ?? false,
    enableEmailAuth: init.enableEmailAuth ?? true,
    enableGoogleAuth: init.enableGoogleAuth ?? false,
    enableAppleAuth: init.enableAppleAuth ?? false,
    enableAnonymousAuth: init.enableAnonymousAuth ?? false,
    firestoreRules: init.firestoreRules ?? '',
    defaultCollections: init.defaultCollections ?? [],
    publicReadCollections: init.publicReadCollections ?? [],
  };
}

export function firebaseConfigIsConfigured(config: FirebaseConfig): boolean {
  return config.projectId.trim().length > 0;
}

export interface FirestoreCollectionTemplate {
  id: string;
  name: string;
  fields: FirestoreFieldTemplate[];
}

export function makeFirestoreCollectionTemplate(
  init: Partial<FirestoreCollectionTemplate> & { name: string },
): FirestoreCollectionTemplate {
  return { id: init.id ?? newUUID(), name: init.name, fields: init.fields ?? [] };
}

export interface FirestoreFieldTemplate {
  id: string;
  name: string;
  /** "string", "number", "boolean", "timestamp", "map", "array" */
  type: string;
  isRequired: boolean;
}

export function makeFirestoreFieldTemplate(
  init: Partial<FirestoreFieldTemplate> & { name: string },
): FirestoreFieldTemplate {
  return {
    id: init.id ?? newUUID(),
    name: init.name,
    type: init.type ?? 'string',
    isRequired: init.isRequired ?? true,
  };
}
