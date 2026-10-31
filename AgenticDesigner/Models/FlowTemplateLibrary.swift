//
//  FlowTemplateLibrary.swift
//  AgenticDesigner
//
//  Ready-made logic chains for common app patterns (auth, Firestore,
//  Supabase, REST). Templates insert with their event/element references
//  unbound — the user picks which button/screen each one wires to via the
//  same block inspector any hand-built block uses.
//

import Foundation
import CoreGraphics

struct FlowTemplate: Identifiable {
    let id = UUID()
    let name: String
    let description: String
    let icon: String
    let build: () -> LogicFlow
}

enum FlowTemplateLibrary {

    static let all: [FlowTemplate] = [
        FlowTemplate(
            name: "Sign Up (Firebase)",
            description: "Register with email/password, create a Firestore profile doc, then navigate on success.",
            icon: "person.badge.plus",
            build: signUpFirebase
        ),
        FlowTemplate(
            name: "Log In (Firebase)",
            description: "Sign in with email/password and navigate to the signed-in screen, or show an error.",
            icon: "person.badge.key",
            build: logInFirebase
        ),
        FlowTemplate(
            name: "Log Out (with confirmation)",
            description: "Ask the user to confirm, sign out, then return to the login screen.",
            icon: "rectangle.portrait.and.arrow.right",
            build: logOutConfirm
        ),
        FlowTemplate(
            name: "Forgot Password",
            description: "Send a password reset email and show a toast, or an error alert.",
            icon: "key.horizontal",
            build: forgotPassword
        ),
        FlowTemplate(
            name: "Fetch List (REST API)",
            description: "Load data from a REST endpoint when the screen appears, parsing the response into a variable.",
            icon: "network",
            build: fetchListAPI
        ),
        FlowTemplate(
            name: "Save Item (Supabase)",
            description: "Insert a row into a Supabase table and confirm with a toast, or show an error.",
            icon: "tray.and.arrow.down",
            build: saveItemSupabase
        ),

        // MARK: Auth (Supabase)
        FlowTemplate(
            name: "Sign Up + Profile (Supabase)",
            description: "Create the account, store the session, then insert the user's profile row (username, email) into the profiles table.",
            icon: "person.crop.circle.badge.plus",
            build: signUpSupabase
        ),
        FlowTemplate(
            name: "Log In (Supabase)",
            description: "Sign in with email/password, store the session token, and navigate on success.",
            icon: "person.badge.key.fill",
            build: logInSupabase
        ),

        // MARK: Notifications
        FlowTemplate(
            name: "Ask Notification Permission",
            description: "Request permission on first launch, then confirm with a toast.",
            icon: "bell.badge",
            build: askNotificationPermission
        ),
        FlowTemplate(
            name: "Daily Reminder",
            description: "Schedule a repeating local notification and set the app badge.",
            icon: "bell.and.waves.left.and.right",
            build: dailyReminder
        ),

        // MARK: Device & sensors
        FlowTemplate(
            name: "Find My Location",
            description: "Ask for permission, read GPS coordinates into variables, then show them.",
            icon: "location.fill",
            build: findMyLocation
        ),
        FlowTemplate(
            name: "Live Location Tracking",
            description: "Update latitude/longitude variables whenever the device moves.",
            icon: "location.circle.fill",
            build: liveLocation
        ),
        FlowTemplate(
            name: "Fitness Stats (Watch)",
            description: "Read heart rate and today's step count from HealthKit on screen load.",
            icon: "heart.text.square",
            build: fitnessStats
        ),
        FlowTemplate(
            name: "Shake to Refresh",
            description: "Reload data when the user shakes the device, with haptic feedback.",
            icon: "iphone.gen3.radiowaves.left.and.right",
            build: shakeToRefresh
        ),
        FlowTemplate(
            name: "Motion / Tilt Reader",
            description: "Read accelerometer x/y/z into variables — drive tilt-based UI.",
            icon: "gyroscope",
            build: motionReader
        ),
        FlowTemplate(
            name: "Battery Saver Check",
            description: "Read the battery level and warn the user when it's low.",
            icon: "battery.25",
            build: batteryCheck
        ),
    ]

    // MARK: - Builders

    private static func signUpFirebase() -> LogicFlow {
        // The profile document is what makes an account useful: the auth user
        // only carries an email, so the username lives in users/{uid}.
        chain(name: "Sign Up", event: .onTap, steps: [
            (.firebaseRegister, [:]),
            (.firestoreSetDocument, [
                "collection": "users",
                "documentId": "{{uid}}",
                "data": "username={{username}}\nemail={{email}}\ncreatedAt={{now}}",
            ]),
            (.showToast, ["message": "Welcome, {{username}}!"]),
            (.navigate, [:]),
        ], errorBranches: [
            1: (.showAlert, ["title": "Registration Failed"]),
            2: (.showAlert, ["title": "Couldn't Save Profile"]),
        ])
    }

    // MARK: - Supabase auth

    private static func signUpSupabase() -> LogicFlow {
        chain(name: "Sign Up", event: .onTap, steps: [
            (.supabaseSignUp, [:]),
            (.supabaseInsert, [
                "table": "profiles",
                "data": "username={{username}}\nemail={{email}}",
            ]),
            (.showToast, ["message": "Account created"]),
            (.navigate, [:]),
        ], errorBranches: [
            1: (.showAlert, ["title": "Sign Up Failed"]),
            2: (.showAlert, ["title": "Couldn't Save Profile"]),
        ])
    }

    private static func logInSupabase() -> LogicFlow {
        chain(name: "Log In", event: .onTap, steps: [
            (.supabaseSignIn, [:]),
            (.navigate, [:]),
        ], errorBranches: [
            1: (.showAlert, ["title": "Login Failed", "message": "Check your email and password."]),
        ])
    }

    // MARK: - Notifications

    private static func askNotificationPermission() -> LogicFlow {
        chain(name: "Notification Permission", event: .onAppLaunch, steps: [
            (.requestPermission, ["kind": "notifications"]),
            (.showToast, ["message": "Notifications enabled"]),
        ], errorBranches: [
            0: (.showAlert, [
                "title": "Notifications Off",
                "message": "You can enable them later in Settings.",
            ]),
        ])
    }

    private static func dailyReminder() -> LogicFlow {
        chain(name: "Daily Reminder", event: .onTap, steps: [
            (.requestPermission, ["kind": "notifications"]),
            (.scheduleLocalNotification, [
                "title": "Time for your daily check-in",
                "body": "Keep your streak going.",
                "seconds": "86400",
                "repeats": "true",
            ]),
            (.setBadgeCount, ["count": "1"]),
            (.showToast, ["message": "Reminder scheduled"]),
        ], errorBranches: [
            0: (.showAlert, ["title": "Permission Needed"]),
        ])
    }

    // MARK: - Device & sensors

    private static func findMyLocation() -> LogicFlow {
        chain(name: "Find My Location", event: .onTap, steps: [
            (.requestPermission, ["kind": "location"]),
            (.getLocation, ["accuracy": "best"]),
            (.showToast, ["message": "You are at {{latitude}}, {{longitude}}"]),
        ], errorBranches: [
            1: (.showAlert, [
                "title": "Location Unavailable",
                "message": "Allow location access to use this feature.",
            ]),
        ])
    }

    private static func liveLocation() -> LogicFlow {
        chain(name: "Live Location", event: .onLocationChanged, steps: [
            (.log, ["message": "Moved to {{latitude}}, {{longitude}}"]),
        ], errorBranches: [:])
    }

    private static func fitnessStats() -> LogicFlow {
        chain(name: "Fitness Stats", event: .onScreenLoad, steps: [
            (.requestPermission, ["kind": "health"]),
            (.readHeartRate, [:]),
            (.readStepCount, [:]),
        ], errorBranches: [
            0: (.showAlert, [
                "title": "Health Access Needed",
                "message": "Allow Health access to read heart rate and steps.",
            ]),
        ])
    }

    private static func shakeToRefresh() -> LogicFlow {
        chain(name: "Shake to Refresh", event: .onShake, steps: [
            (.hapticFeedback, [:]),
            (.httpRequest, [:]),
            (.showToast, ["message": "Refreshed"]),
        ], errorBranches: [
            1: (.showToast, ["message": "Couldn't refresh"]),
        ])
    }

    private static func motionReader() -> LogicFlow {
        chain(name: "Motion Reader", event: .onScreenLoad, steps: [
            (.readMotion, [:]),
        ], errorBranches: [:])
    }

    private static func batteryCheck() -> LogicFlow {
        chain(name: "Battery Check", event: .onScreenLoad, steps: [
            (.readBatteryLevel, [:]),
            (.ifCondition, ["left": "batteryLevel", "operation": "lessThan", "right": "20"]),
            (.showAlert, [
                "title": "Low Battery",
                "message": "Plug in to keep tracking.",
            ]),
        ], errorBranches: [:])
    }

    private static func logInFirebase() -> LogicFlow {
        chain(name: "Log In", event: .onTap, steps: [
            (.firebaseLogin, [:]),
            (.navigate, [:]),
        ], errorBranches: [
            1: (.showAlert, ["title": "Login Failed", "message": "Check your email and password."]),
        ])
    }

    private static func logOutConfirm() -> LogicFlow {
        chain(name: "Log Out", event: .onTap, steps: [
            (.confirmDialog, ["title": "Log out?", "message": "You can log back in anytime."]),
            (.firebaseLogout, [:]),
            (.navigate, [:]),
        ], errorBranches: [
            2: (.showAlert, ["title": "Couldn't Log Out"]),
        ])
    }

    private static func forgotPassword() -> LogicFlow {
        chain(name: "Forgot Password", event: .onTap, steps: [
            (.firebaseResetPassword, [:]),
            (.showToast, ["message": "Password reset email sent"]),
        ], errorBranches: [
            1: (.showAlert, ["title": "Couldn't Send Reset Email"]),
        ])
    }

    private static func fetchListAPI() -> LogicFlow {
        chain(name: "Fetch List", event: .onScreenLoad, steps: [
            (.httpRequest, ["method": "GET"]),
            (.parseJSONResponse, ["path": "data"]),
        ], errorBranches: [
            1: (.showAlert, ["title": "Couldn't Load Data"]),
        ])
    }

    private static func saveItemSupabase() -> LogicFlow {
        chain(name: "Save Item", event: .onTap, steps: [
            (.supabaseInsert, [:]),
            (.showToast, ["message": "Saved"]),
        ], errorBranches: [
            1: (.showAlert, ["title": "Couldn't Save"]),
        ])
    }

    // MARK: - Shared chain builder

    // Builds a linear success chain (each step's port 0 feeds the next),
    // with an optional error-branch leaf hanging off port 1 of any step
    // whose block type actually has an error output. Event/element
    // parameters are left unbound so the palette's "Select an element..."
    // placeholder guides the user to wire it up.
    private static func chain(
        name: String,
        event eventType: LogicBlockType,
        steps: [(LogicBlockType, [String: String])],
        errorBranches: [Int: (LogicBlockType, [String: String])]
    ) -> LogicFlow {
        guard var event = BlockCatalog.makeBlock(type: eventType, at: .zero) else {
            return LogicFlow(name: name)
        }
        event.label = "\(name) Trigger"

        var blocks: [LogicBlock] = [event]
        var connections: [BlockConnection] = []
        var previousId = event.id

        for (index, step) in steps.enumerated() {
            guard var block = BlockCatalog.makeBlock(type: step.0, at: .zero) else { continue }
            for (key, value) in step.1 {
                if let paramIndex = block.parameters.firstIndex(where: { $0.key == key }) {
                    block.parameters[paramIndex].value = value
                }
            }
            blocks.append(block)
            connections.append(BlockConnection(sourceBlockId: previousId, sourcePortIndex: 0, targetBlockId: block.id, targetPortIndex: 0))

            if let (errorType, errorParams) = errorBranches[index], var errorBlock = BlockCatalog.makeBlock(type: errorType, at: .zero) {
                for (key, value) in errorParams {
                    if let paramIndex = errorBlock.parameters.firstIndex(where: { $0.key == key }) {
                        errorBlock.parameters[paramIndex].value = value
                    }
                }
                blocks.append(errorBlock)
                connections.append(BlockConnection(sourceBlockId: block.id, sourcePortIndex: 1, targetBlockId: errorBlock.id, targetPortIndex: 0))
            }

            previousId = block.id
        }

        LogicAgentTranslator.layoutIfNeeded(blocks: &blocks, connections: connections)
        return LogicFlow(name: name, blocks: blocks, connections: connections)
    }
}
