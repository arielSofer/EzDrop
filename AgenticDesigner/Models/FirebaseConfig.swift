//
//  FirebaseConfig.swift
//  AgenticDesigner
//
//  Project-level Firebase configuration applied to all Firebase blocks.
//  Blocks describe *what* should happen; the exported blueprint carries this
//  configuration so real Firebase code can be generated for the target platform.
//

import Foundation

struct FirebaseConfig: Codable {
    var projectId: String = ""
    var apiKey: String = ""
    var authDomain: String = ""
    var storageBucket: String = ""
    var messagingSenderId: String = ""
    var appId: String = ""
    var isEnabled: Bool = false

    // Auth settings
    var enableEmailAuth: Bool = true
    var enableGoogleAuth: Bool = false
    var enableAppleAuth: Bool = false
    var enableAnonymousAuth: Bool = false

    // Firestore settings
    var firestoreRules: String = ""
    var defaultCollections: [FirestoreCollectionTemplate] = []
    /// Collections every signed-in user may READ, but only the document's
    /// owner may write: a shop catalog, a social feed, a course list. The
    /// default owner-only read rule is correct for private data and fatal for
    /// shared data — a feed nobody but the author can read is not a feed.
    var publicReadCollections: [String] = []

    var isConfigured: Bool {
        !projectId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

struct FirestoreCollectionTemplate: Codable, Identifiable {
    var id: UUID = UUID()
    var name: String
    var fields: [FirestoreFieldTemplate] = []
}

struct FirestoreFieldTemplate: Codable, Identifiable {
    var id: UUID = UUID()
    var name: String
    var type: String = "string"   // "string", "number", "boolean", "timestamp", "map", "array"
    var isRequired: Bool = true
}
