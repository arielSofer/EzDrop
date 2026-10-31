//
//  BackendBlueprint.swift
//  AgenticDesigner
//
//  What "save the user's data" MEANS for a given app. A habit tracker needs
//  habits + check-ins keyed by uid; a shop needs orders and a public catalog;
//  a chat app needs conversations and messages. Nothing in the pipeline used
//  to decide this, so a generated app got auth blocks at best and no data
//  model at all — the user had to invent the Firestore schema by hand.
//
//  Deterministic (no model call): the app category the classifier already
//  detects maps to a real schema, so one prompt produces the same correct
//  backend every time, on any model, including tiny local ones.
//

import Foundation

struct BackendBlueprint {

    /// A collection the generated app writes per-user documents into.
    struct Entity {
        /// Firestore collection name — plural, lowercase, no path separators.
        var collection: String
        /// Human label for copy ("Save Workout", "New Habit").
        var label: String
        /// Fields the create-flow writes, beyond userId/createdAt.
        var fields: [FirestoreFieldTemplate]
        /// Global variable the list query stores its JSON array into.
        var listVariable: String
    }

    var category: AppCategory
    /// The one collection the app's main screen lists and its primary CTA
    /// writes to. Everything else is secondary.
    var primary: Entity
    var secondary: [Entity]
    /// Profile fields written to users/{uid} at sign-up.
    var profileFields: [FirestoreFieldTemplate]
    /// Collections every signed-in user may READ but only the owner may write
    /// (a shop catalog, a social feed, a course list). Owner-only read rules
    /// would break these at runtime — a feed nobody can read is not a feed.
    var publicReadCollections: [String]

    /// Every collection the project should declare, users/ first.
    var collections: [FirestoreCollectionTemplate] {
        var out = [FirestoreCollectionTemplate(name: "users", fields: profileFields)]
        for entity in [primary] + secondary {
            out.append(FirestoreCollectionTemplate(
                name: entity.collection,
                fields: [FirestoreFieldTemplate(name: "userId", type: "string")]
                    + entity.fields
                    + [FirestoreFieldTemplate(name: "createdAt", type: "timestamp")]
            ))
        }
        return out
    }

    // MARK: - Inference

    static func infer(prompt: String) -> BackendBlueprint {
        blueprint(for: AppCategoryClassifier.classify(prompt: prompt))
    }

    static func blueprint(for category: AppCategory) -> BackendBlueprint {
        let profile = [
            FirestoreFieldTemplate(name: "displayName", type: "string", isRequired: false),
            FirestoreFieldTemplate(name: "email", type: "string"),
            FirestoreFieldTemplate(name: "photoURL", type: "string", isRequired: false),
            FirestoreFieldTemplate(name: "createdAt", type: "timestamp"),
        ]

        func field(_ name: String, _ type: String = "string", required: Bool = true) -> FirestoreFieldTemplate {
            FirestoreFieldTemplate(name: name, type: type, isRequired: required)
        }

        switch category {
        case .finance, .banking:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "transactions", label: "Transaction",
                    fields: [field("title"), field("amount", "number"), field("category"), field("note", required: false)],
                    listVariable: "transactions"
                ),
                secondary: [
                    Entity(collection: "accounts", label: "Account",
                           fields: [field("name"), field("balance", "number"), field("currency")],
                           listVariable: "accounts"),
                    Entity(collection: "budgets", label: "Budget",
                           fields: [field("category"), field("limit", "number")],
                           listVariable: "budgets"),
                ],
                profileFields: profile,
                publicReadCollections: []
            )

        case .trading, .crypto:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "holdings", label: "Holding",
                    fields: [field("symbol"), field("quantity", "number"), field("buyPrice", "number")],
                    listVariable: "holdings"
                ),
                secondary: [
                    Entity(collection: "watchlist", label: "Watchlist Item",
                           fields: [field("symbol"), field("note", required: false)],
                           listVariable: "watchlist"),
                    Entity(collection: "orders", label: "Order",
                           fields: [field("symbol"), field("side"), field("quantity", "number"), field("price", "number")],
                           listVariable: "orders"),
                ],
                profileFields: profile,
                publicReadCollections: ["markets"]
            )

        case .fitness:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "workouts", label: "Workout",
                    fields: [field("title"), field("distance", "number"), field("duration", "number"),
                             field("calories", "number", required: false), field("notes", required: false)],
                    listVariable: "workouts"
                ),
                secondary: [
                    Entity(collection: "goals", label: "Goal",
                           fields: [field("metric"), field("target", "number"), field("period")],
                           listVariable: "goals"),
                ],
                profileFields: profile + [field("weightKg", "number", required: false)],
                publicReadCollections: []
            )

        case .health:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "healthLogs", label: "Health Log",
                    fields: [field("metric"), field("value", "number"), field("unit"), field("notes", required: false)],
                    listVariable: "healthLogs"
                ),
                secondary: [
                    Entity(collection: "medications", label: "Medication",
                           fields: [field("name"), field("dose"), field("schedule")],
                           listVariable: "medications"),
                ],
                profileFields: profile,
                publicReadCollections: []
            )

        case .mentalHealth:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "moodEntries", label: "Mood Entry",
                    fields: [field("mood"), field("score", "number"), field("note", required: false)],
                    listVariable: "moodEntries"
                ),
                secondary: [
                    Entity(collection: "journalEntries", label: "Journal Entry",
                           fields: [field("title"), field("body")],
                           listVariable: "journalEntries"),
                ],
                profileFields: profile,
                publicReadCollections: ["meditations"]
            )

        case .travel:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "trips", label: "Trip",
                    fields: [field("destination"), field("startDate"), field("endDate"), field("notes", required: false)],
                    listVariable: "trips"
                ),
                secondary: [
                    Entity(collection: "bookings", label: "Booking",
                           fields: [field("tripId"), field("kind"), field("reference"), field("price", "number")],
                           listVariable: "bookings"),
                    Entity(collection: "savedPlaces", label: "Saved Place",
                           fields: [field("name"), field("city"), field("imageURL", required: false)],
                           listVariable: "savedPlaces"),
                ],
                profileFields: profile,
                publicReadCollections: ["destinations"]
            )

        case .ecommerce:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "orders", label: "Order",
                    fields: [field("items"), field("total", "number"), field("status"), field("address", required: false)],
                    listVariable: "orders"
                ),
                secondary: [
                    Entity(collection: "cartItems", label: "Cart Item",
                           fields: [field("productId"), field("title"), field("price", "number"), field("quantity", "number")],
                           listVariable: "cartItems"),
                    Entity(collection: "favorites", label: "Favorite",
                           fields: [field("productId"), field("title"), field("imageURL", required: false)],
                           listVariable: "favorites"),
                ],
                profileFields: profile + [field("shippingAddress", required: false)],
                publicReadCollections: ["products"]
            )

        case .foodDelivery:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "orders", label: "Order",
                    fields: [field("restaurantId"), field("items"), field("total", "number"), field("status")],
                    listVariable: "orders"
                ),
                secondary: [
                    Entity(collection: "addresses", label: "Address",
                           fields: [field("label"), field("line1"), field("city")],
                           listVariable: "addresses"),
                    Entity(collection: "favorites", label: "Favorite",
                           fields: [field("restaurantId"), field("name")],
                           listVariable: "favorites"),
                ],
                profileFields: profile,
                publicReadCollections: ["restaurants", "menuItems"]
            )

        case .education:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "enrollments", label: "Enrollment",
                    fields: [field("courseId"), field("title"), field("progress", "number")],
                    listVariable: "enrollments"
                ),
                secondary: [
                    Entity(collection: "notes", label: "Note",
                           fields: [field("courseId"), field("body")],
                           listVariable: "notes"),
                ],
                profileFields: profile,
                publicReadCollections: ["courses", "lessons"]
            )

        case .productivity:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "tasks", label: "Task",
                    fields: [field("title"), field("notes", required: false), field("dueDate", required: false),
                             field("isDone", "boolean")],
                    listVariable: "tasks"
                ),
                secondary: [
                    Entity(collection: "projects", label: "Project",
                           fields: [field("name"), field("color", required: false)],
                           listVariable: "projects"),
                ],
                profileFields: profile,
                publicReadCollections: []
            )

        case .aiChat:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "conversations", label: "Conversation",
                    fields: [field("title"), field("lastMessage", required: false)],
                    listVariable: "conversations"
                ),
                secondary: [
                    Entity(collection: "messages", label: "Message",
                           fields: [field("conversationId"), field("role"), field("content")],
                           listVariable: "messages"),
                ],
                profileFields: profile,
                publicReadCollections: []
            )

        case .social:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "posts", label: "Post",
                    fields: [field("body"), field("imageURL", required: false), field("likeCount", "number", required: false)],
                    listVariable: "posts"
                ),
                secondary: [
                    Entity(collection: "comments", label: "Comment",
                           fields: [field("postId"), field("body")],
                           listVariable: "comments"),
                    Entity(collection: "follows", label: "Follow",
                           fields: [field("followingId")],
                           listVariable: "follows"),
                ],
                profileFields: profile + [field("username"), field("bio", required: false)],
                // A feed only works if everyone can read everyone's posts.
                publicReadCollections: ["posts", "comments", "follows"]
            )

        case .realEstate:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "savedListings", label: "Saved Listing",
                    fields: [field("listingId"), field("title"), field("price", "number"), field("imageURL", required: false)],
                    listVariable: "savedListings"
                ),
                secondary: [
                    Entity(collection: "inquiries", label: "Inquiry",
                           fields: [field("listingId"), field("message")],
                           listVariable: "inquiries"),
                ],
                profileFields: profile,
                publicReadCollections: ["listings"]
            )

        case .music:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "playlists", label: "Playlist",
                    fields: [field("name"), field("trackCount", "number", required: false)],
                    listVariable: "playlists"
                ),
                secondary: [
                    Entity(collection: "likedTracks", label: "Liked Track",
                           fields: [field("trackId"), field("title"), field("artist")],
                           listVariable: "likedTracks"),
                ],
                profileFields: profile,
                publicReadCollections: ["tracks", "albums"]
            )

        case .calendar:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "events", label: "Event",
                    fields: [field("title"), field("startDate"), field("endDate", required: false),
                             field("location", required: false), field("notes", required: false)],
                    listVariable: "events"
                ),
                secondary: [],
                profileFields: profile,
                publicReadCollections: []
            )

        case .habitTracker:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "habits", label: "Habit",
                    fields: [field("name"), field("target", "number"), field("streak", "number", required: false)],
                    listVariable: "habits"
                ),
                secondary: [
                    Entity(collection: "checkins", label: "Check-in",
                           fields: [field("habitId"), field("date")],
                           listVariable: "checkins"),
                ],
                profileFields: profile,
                publicReadCollections: []
            )

        case .generic:
            return BackendBlueprint(
                category: category,
                primary: Entity(
                    collection: "items", label: "Item",
                    fields: [field("title"), field("notes", required: false)],
                    listVariable: "items"
                ),
                secondary: [],
                profileFields: profile,
                publicReadCollections: []
            )
        }
    }

    // MARK: - Opt-out detection

    /// A prompt can wave the backend off — "no login", "local only", "בלי
    /// הרשמה". Without this an explicitly offline app would still be given a
    /// sign-in wall, which is the opposite of what was asked for.
    static func promptOptsOut(_ prompt: String) -> Bool {
        let text = prompt.lowercased()
        let phrases = [
            "no login", "no log in", "no sign in", "no sign-in", "without login",
            "without sign in", "no signup", "no sign up", "no account", "no accounts",
            "no auth", "no backend", "no firebase", "local only", "local-only",
            "offline only", "offline-only", "no server", "guest only",
            "בלי הרשמה", "ללא הרשמה", "בלי התחברות", "ללא התחברות",
            "בלי חשבון", "ללא חשבון", "בלי שרת", "ללא שרת", "מקומי בלבד",
        ]
        return phrases.contains { text.contains($0) }
    }
}
