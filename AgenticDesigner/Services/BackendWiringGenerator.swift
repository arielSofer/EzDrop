//
//  BackendWiringGenerator.swift
//  AgenticDesigner
//
//  The missing third of "one prompt → a working app": an ACCOUNT and REAL
//  PERSISTENCE. The design pass produced screens, the logic pass made them
//  navigable — but nothing ever created a sign-in screen, wired Firebase
//  Auth to it, or saved a single document. The prompt said "with login and
//  saved data" and the build quietly skipped it.
//
//  Deterministic, like ComposedLogicGenerator: no model call, so it can
//  never return empty on a small local model. It:
//    1. turns Firebase on and declares the project's Firestore schema
//       (from BackendBlueprint — per app category);
//    2. creates Log In / Sign Up screens if the design has none, with REAL
//       .Input nodes bound to variables (a decorative "input field" component
//       cannot be typed into, so an auth screen made of them can never work);
//    3. wires the whole account lifecycle: launch gate, log in, sign up +
//       profile document, log out, password reset;
//    4. wires persistence for the app's primary entity: create-on-tap and
//       load-on-screen-appear, both scoped to the signed-in user — which is
//       also exactly what the generated security rules require.
//

import Foundation
import CoreGraphics

@MainActor
enum BackendWiringGenerator {

    // Variable names the auth inputs bind to. Fixed and shared so the login
    // and sign-up screens write into the same session fields.
    static let emailVariable = "authEmail"
    static let passwordVariable = "authPassword"
    static let passwordConfirmVariable = "authPasswordConfirm"
    static let nameVariable = "authDisplayName"
    static let uidVariable = "currentUserId"
    static let profileVariable = "profile"

    struct Result {
        var configured = false
        var createdScreens: [String] = []
        var flowNames: [String] = []
        var collections: [String] = []
        var boundInputs = 0
        var notes: [String] = []

        var isEmpty: Bool { flowNames.isEmpty && createdScreens.isEmpty }
    }

    // MARK: - Entry point

    static func wire(
        prompt: String,
        design: ProjectViewModel,
        logic: LogicViewModel,
        blueprint providedBlueprint: BackendBlueprint? = nil
    ) -> Result {
        var result = Result()
        let blueprint = providedBlueprint ?? BackendBlueprint.infer(prompt: prompt)

        // Without attach() the flows land in the view model but never reach the
        // page — the app looks wired and exports nothing.
        logic.attach(to: design)

        let pageIndex = design.currentPageIndex
        guard design.project.pages.indices.contains(pageIndex) else { return result }

        // 1 — Project configuration: Firebase on, schema declared.
        var config = design.project.firebaseConfig ?? FirebaseConfig()
        config.isEnabled = true
        config.enableEmailAuth = true
        config.defaultCollections = blueprint.collections
        config.publicReadCollections = blueprint.publicReadCollections
        design.project.firebaseConfig = config
        result.configured = true
        result.collections = blueprint.collections.map(\.name)

        // 2 — Session variables. currentUserId is a reserved name the
        // exporters already resolve {{uid}} against.
        declare(emailVariable, .string, in: design)
        declare(passwordVariable, .string, in: design)
        declare(passwordConfirmVariable, .string, in: design)
        declare(nameVariable, .string, in: design)
        declare(uidVariable, .string, in: design)
        declare(profileVariable, .json, in: design, default: "{}")
        declare(blueprint.primary.listVariable, .json, in: design, default: "[]")

        // 3 — Screens. Auth screens are created only when the design has none,
        // so a model that already drew a beautiful login keeps it.
        let palette = Palette(project: design.project, pageIndex: pageIndex)
        var loginScreen = findScreen(in: design, pageIndex: pageIndex, keywords: loginKeywords)
        var signUpScreen = findScreen(in: design, pageIndex: pageIndex, keywords: signUpKeywords)
        let homeScreen = findHomeScreen(in: design, pageIndex: pageIndex)

        if loginScreen == nil {
            let frame = makeLoginScreen(palette: palette, x: nextFrameX(design, pageIndex: pageIndex, index: 0))
            // Inserted FIRST so the exported app starts at the sign-in wall —
            // the generated app's initial screen is the page's first frame.
            design.project.pages[pageIndex].nodes.insert(frame, at: 0)
            loginScreen = frame
            result.createdScreens.append(frame.name)
            result.notes.append("Log In is now the app's first screen.")
        }
        if signUpScreen == nil {
            let frame = makeSignUpScreen(palette: palette, x: nextFrameX(design, pageIndex: pageIndex, index: 1))
            design.project.pages[pageIndex].nodes.insert(frame, at: 1)
            signUpScreen = frame
            result.createdScreens.append(frame.name)
        }

        // 4 — Bind whatever auth inputs exist (ours or the model's) to the
        // session variables, and mark password fields secure.
        for screen in [loginScreen, signUpScreen].compactMap({ $0 }) {
            result.boundInputs += bindAuthInputs(screenId: screen.id, design: design, pageIndex: pageIndex)
        }

        // Re-read: binding mutated the tree, and the flow builders need the
        // current node ids/names.
        let login = reload(loginScreen, design: design, pageIndex: pageIndex)
        let signUp = reload(signUpScreen, design: design, pageIndex: pageIndex)
        let home = reload(homeScreen, design: design, pageIndex: pageIndex)

        // 5 — Flows. Re-running this (build_full_app already wires a backend,
        // and an agent will reasonably call wire_backend again afterwards) must
        // REPLACE the previous pass, not stack a second copy of every auth flow
        // on the same buttons — two Sign Up flows on one button would register
        // twice and race.
        for stale in logic.flows where isGeneratedBackendFlow(stale) {
            logic.deleteFlow(id: stale.id)
        }

        var flows: [LogicFlow] = []
        let existingNames = Set(logic.flows.map(\.name))

        if let flow = authGateFlow(home: home, login: login) { flows.append(flow) }
        if let login {
            if let flow = logInFlow(screen: login, home: home) { flows.append(flow) }
            if let signUp, let flow = linkFlow(
                name: "Go to Sign Up", from: login, to: signUp,
                keywords: ["sign up", "signup", "register", "create account", "create an account", "join", "הרשמה", "הרשמו"]
            ) { flows.append(flow) }
            if let flow = resetPasswordFlow(screen: login) { flows.append(flow) }
        }
        if let signUp {
            if let flow = signUpFlow(screen: signUp, home: home) { flows.append(flow) }
            if let login, let flow = linkFlow(
                name: "Go to Log In", from: signUp, to: login,
                keywords: ["log in", "login", "sign in", "signin", "already have", "התחברות", "התחבר"]
            ) { flows.append(flow) }
        }
        if let login, let flow = logOutFlow(design: design, pageIndex: pageIndex, login: login) {
            flows.append(flow)
        }
        if let flow = loadProfileFlow(design: design, pageIndex: pageIndex, excluding: [login?.id, signUp?.id].compactMap { $0 }) {
            flows.append(flow)
        }

        // Persistence for the app's primary entity.
        let persistence = persistenceFlows(
            blueprint: blueprint, design: design, pageIndex: pageIndex,
            home: home, authScreenIds: [login?.id, signUp?.id].compactMap { $0 }, logic: logic
        )
        flows.append(contentsOf: persistence.flows)
        result.notes.append(contentsOf: persistence.notes)

        // Never collide with a flow the logic pass already made.
        for index in flows.indices where existingNames.contains(flows[index].name) {
            flows[index].name += " (Backend)"
        }

        guard !flows.isEmpty else { return result }
        logic.applyGenerated(flows: flows)
        result.flowNames = flows.map(\.name)
        return result
    }

    /// A flow this generator produced on an earlier run: one of its fixed
    /// names, and it actually calls the backend. The block check keeps a
    /// hand-written flow that merely shares a name ("Log In" that only
    /// navigates) from being deleted.
    private static func isGeneratedBackendFlow(_ flow: LogicFlow) -> Bool {
        let base = flow.name.replacingOccurrences(of: " (Backend)", with: "")
        let fixedNames: Set<String> = [
            "Auth Gate", "Log In", "Sign Up", "Log Out", "Reset Password",
            "Go to Sign Up", "Go to Log In",
        ]
        // "Open New X"/"Close New X" are deliberately NOT deletable: they are
        // wired to the synthesized form's stable node ids, and the form is
        // only synthesized once — deleting them on a re-run would leave the
        // "+" and Back buttons dead with nothing recreating their flows.
        let isFixed = fixedNames.contains(base)
            || base.hasPrefix("Load ") || base.hasPrefix("Save ")
        guard isFixed else { return false }
        if flow.blocks.contains(where: { $0.category == .firebase }) { return true }
        // The two link flows carry no backend block at all — a bare
        // onTap → navigate pair under one of our names is still ours.
        return (base == "Go to Sign Up" || base == "Go to Log In")
            && flow.blocks.count == 2
            && flow.blocks.contains { $0.type == .navigate }
    }

    // MARK: - Screen discovery

    private static let loginKeywords = ["log in", "login", "logon", "sign in", "signin", "התחברות", "כניסה"]
    private static let signUpKeywords = ["sign up", "signup", "register", "create account", "הרשמה", "רישום"]
    private static let nonHomeKeywords = ["log in", "login", "sign in", "signin", "sign up", "signup",
                                          "register", "onboard", "splash", "welcome", "paywall",
                                          "subscribe", "התחברות", "הרשמה", "פתיחה"]

    private static func frames(_ design: ProjectViewModel, pageIndex: Int) -> [DesignNode] {
        design.project.pages[pageIndex].nodes.filter { $0.type == .Frame }
    }

    private static func findScreen(in design: ProjectViewModel, pageIndex: Int, keywords: [String]) -> DesignNode? {
        frames(design, pageIndex: pageIndex).first { frame in
            let name = frame.name.lowercased()
            return keywords.contains { name.contains($0) }
        }
    }

    /// The screen a signed-in user lands on: the one named like a home, else
    /// the first screen that is not an auth/onboarding/paywall detour.
    private static func findHomeScreen(in design: ProjectViewModel, pageIndex: Int) -> DesignNode? {
        let all = frames(design, pageIndex: pageIndex)
        let preferred = ["home", "feed", "dashboard", "discover", "today", "overview", "בית", "ראשי"]
        if let match = all.first(where: { frame in
            let name = frame.name.lowercased()
            return preferred.contains { name.contains($0) }
        }) { return match }
        return all.first { frame in
            let name = frame.name.lowercased()
            return !nonHomeKeywords.contains { name.contains($0) }
        }
    }

    private static func reload(_ screen: DesignNode?, design: ProjectViewModel, pageIndex: Int) -> DesignNode? {
        guard let screen else { return nil }
        return design.project.pages[pageIndex].nodes.first { $0.id == screen.id } ?? screen
    }

    private static func nextFrameX(_ design: ProjectViewModel, pageIndex: Int, index: Int) -> CGFloat {
        let existing = frames(design, pageIndex: pageIndex)
        let minX = existing.map(\.x).min() ?? 100
        // To the LEFT of the existing app, in creation order, so the canvas
        // reads left-to-right: Log In, Sign Up, then the app.
        return minX - CGFloat(2 - index) * (screenSize.width + 60)
    }

    // MARK: - Variables

    private static func declare(
        _ name: String,
        _ type: VariableType,
        in design: ProjectViewModel,
        default defaultValue: String? = nil
    ) {
        guard !design.project.globalVariables.contains(where: { $0.name == name }) else { return }
        design.project.globalVariables.append(
            LogicVariable(name: name, type: type, defaultValue: defaultValue, scope: .global)
        )
    }

    // MARK: - Input binding

    /// Binds every text input on an auth screen to the session variable its
    /// name implies, and marks password fields secure. Returns how many were
    /// bound. An unbound input is a field whose typed text nothing can read —
    /// the single most common reason a generated login "does nothing".
    private static func bindAuthInputs(screenId: UUID, design: ProjectViewModel, pageIndex: Int) -> Int {
        var bound = 0

        func variable(for node: DesignNode) -> String? {
            let haystack = [node.name, node.text, node.children.first?.text]
                .compactMap { $0 }.joined(separator: " ").lowercased()
            // Confirm-password BEFORE password — its name contains "password"
            // too, and binding both fields to the same variable makes the
            // match check compare a value with itself (always true).
            if haystack.contains("confirm") || haystack.contains("again") || haystack.contains("repeat")
                || haystack.contains("אימות") || haystack.contains("שוב") {
                return haystack.contains("password") || haystack.contains("סיסמ")
                    ? passwordConfirmVariable : nil
            }
            if haystack.contains("password") || haystack.contains("סיסמ") || haystack.contains("passcode") {
                return passwordVariable
            }
            if haystack.contains("email") || haystack.contains("e-mail") || haystack.contains("mail")
                || haystack.contains("אימייל") || haystack.contains("מייל") {
                return emailVariable
            }
            if haystack.contains("name") || haystack.contains("username") || haystack.contains("שם") {
                return nameVariable
            }
            return nil
        }

        func walk(_ nodes: inout [DesignNode]) {
            for index in nodes.indices {
                if nodes[index].type == .Input, let name = variable(for: nodes[index]) {
                    let hasBinding = nodes[index].logicBindings?.contains {
                        $0.kind == .value || $0.kind == .text
                    } ?? false
                    if !hasBinding {
                        var bindings = nodes[index].logicBindings ?? []
                        bindings.append(NodeLogicBinding(kind: .value, variableName: name))
                        nodes[index].logicBindings = bindings
                        bound += 1
                    }
                    if name == passwordVariable { nodes[index].isSecure = true }
                }
                walk(&nodes[index].children)
            }
        }

        guard let screenIndex = design.project.pages[pageIndex].nodes.firstIndex(where: { $0.id == screenId })
        else { return 0 }
        walk(&design.project.pages[pageIndex].nodes[screenIndex].children)
        return bound
    }

    // MARK: - Flow builders

    /// App launch → already signed in? go to the app. Otherwise stay on / go
    /// to Log In. Without this the user is thrown back to the login screen on
    /// every cold start even though the Firebase session is still valid.
    private static func authGateFlow(home: DesignNode?, login: DesignNode?) -> LogicFlow? {
        guard home != nil || login != nil else { return nil }
        var builder = FlowBuilder(name: "Auth Gate", trigger: .onAppLaunch)
        guard builder.isValid else { return nil }
        let check = builder.append(.firebaseGetCurrentUser, variables: ["variable": uidVariable])
        if let home {
            builder.append(.navigate, from: (check, 0), screens: ["screen": home.id])
        }
        if let login {
            builder.append(.navigate, from: (check, 1), screens: ["screen": login.id])
        }
        return builder.flow(screenNodeId: nil)
    }

    private static func logInFlow(screen: DesignNode, home: DesignNode?) -> LogicFlow? {
        guard let button = primaryButton(
            in: screen,
            preferring: ["log in", "login", "sign in", "signin", "continue", "התחבר", "התחברות", "כניסה"],
            avoiding: ["sign up", "signup", "register", "forgot", "google", "apple", "facebook", "back", "skip"]
        ) else { return nil }

        var builder = FlowBuilder(name: "Log In", trigger: .onTap, element: button.id)
        guard builder.isValid else { return nil }
        let inputs = textInputs(in: screen)
        let emailNode = inputs.first { boundVariable($0) == emailVariable }
        let passwordNode = inputs.first { boundVariable($0) == passwordVariable }

        // Validate BEFORE the network call: a malformed email should never
        // cost a round-trip, and Firebase's own error copy is developer-speak.
        if let emailNode {
            let check = builder.append(.validateForm, values: ["rule": "email"], nodes: ["element": emailNode.id])
            builder.append(.showAlert, from: (check, 1), values: [
                "title": "Check your email address",
                "message": "That doesn't look like a valid email.",
            ])
        }

        let login = builder.append(
            .firebaseLogin,
            nodes: [
                "email": emailNode?.id,
                "password": passwordNode?.id,
            ].compactMapValues { $0 }
        )
        let store = builder.append(.firebaseGetCurrentUser, from: (login, 0), variables: ["variable": uidVariable])
        if let home {
            builder.append(.navigate, from: (store, 0), screens: ["screen": home.id])
            builder.append(.navigate, from: (store, 1), screens: ["screen": home.id])
        }
        builder.append(.showAlert, from: (login, 1), values: [
            "title": "Couldn't sign in",
            "message": "Check your email and password, then try again.",
        ])
        return builder.flow(screenNodeId: screen.id)
    }

    /// Sign up, then WRITE THE PROFILE. The auth user carries only an email —
    /// everything the app shows about "me" lives in users/{uid}, so an account
    /// created without this document is an account with no profile.
    private static func signUpFlow(screen: DesignNode, home: DesignNode?) -> LogicFlow? {
        guard let button = primaryButton(
            in: screen,
            preferring: ["sign up", "signup", "create account", "create an account", "register", "get started", "הרשמה", "הרשם"],
            avoiding: ["log in", "login", "sign in", "already", "google", "apple", "facebook", "back", "skip"]
        ) else { return nil }

        var builder = FlowBuilder(name: "Sign Up", trigger: .onTap, element: button.id)
        guard builder.isValid else { return nil }
        let inputs = textInputs(in: screen)
        let emailNode = inputs.first { boundVariable($0) == emailVariable }
        let passwordNode = inputs.first { boundVariable($0) == passwordVariable }
        let hasName = inputs.contains { boundVariable($0) == nameVariable }
        let hasConfirm = inputs.contains { boundVariable($0) == passwordConfirmVariable }

        // Client-side validation, in the order the user reads the form. Each
        // failure alerts in plain language and never leaves the device —
        // Firebase's raw errors ("The supplied auth credential…") are not
        // sign-up copy a professional app shows.
        if let emailNode {
            let check = builder.append(.validateForm, values: ["rule": "email"], nodes: ["element": emailNode.id])
            builder.append(.showAlert, from: (check, 1), values: [
                "title": "Check your email address",
                "message": "That doesn't look like a valid email.",
            ])
        }
        if let passwordNode {
            let check = builder.append(.validateForm, values: [
                "rule": "minLength", "argument": "6",
            ], nodes: ["element": passwordNode.id])
            builder.append(.showAlert, from: (check, 1), values: [
                "title": "Password too short",
                "message": "Use at least 6 characters.",
            ])
        }
        if hasConfirm {
            let match = builder.append(.ifCondition, values: [
                "operator": "==",
                "rightValue": "{{\(passwordConfirmVariable)}}",
            ], variables: ["leftValue": passwordVariable])
            builder.append(.showAlert, from: (match, 1), values: [
                "title": "Passwords don't match",
                "message": "Re-type the confirmation so both fields agree.",
            ])
        }

        let register = builder.append(
            .firebaseRegister,
            nodes: [
                "email": emailNode?.id,
                "password": passwordNode?.id,
            ].compactMapValues { $0 }
        )
        let uid = builder.append(.firebaseGetCurrentUser, from: (register, 0), variables: ["variable": uidVariable])
        var profileData = "email={{\(emailVariable)}}\ncreatedAt={{now}}"
        if hasName { profileData = "displayName={{\(nameVariable)}}\n" + profileData }
        let profile = builder.append(.firestoreSetDocument, from: (uid, 0), values: [
            "collection": "users",
            "documentId": "{{uid}}",
            "data": profileData,
        ])
        if let home {
            builder.append(.navigate, from: (profile, 0), screens: ["screen": home.id])
        }
        builder.append(.showAlert, from: (profile, 1), values: [
            "title": "Account created",
            "message": "We couldn't save your profile yet — you can finish it from Settings.",
        ])
        builder.append(.showAlert, from: (register, 1), values: [
            "title": "Couldn't create your account",
            "message": "That email may already be in use, or the password is too short (6+ characters).",
        ])
        return builder.flow(screenNodeId: screen.id)
    }

    private static func resetPasswordFlow(screen: DesignNode) -> LogicFlow? {
        guard let link = tappable(
            in: screen,
            preferring: ["forgot", "reset password", "שכחתי", "איפוס סיסמה"],
            avoiding: []
        ) else { return nil }
        var builder = FlowBuilder(name: "Reset Password", trigger: .onTap, element: link.id)
        guard builder.isValid else { return nil }
        let emailNode = textInputs(in: screen).first { boundVariable($0) == emailVariable }
        let reset = builder.append(
            .firebaseResetPassword,
            nodes: emailNode.map { ["email": $0.id] } ?? [:]
        )
        builder.append(.showToast, from: (reset, 0), values: ["message": "Reset link sent — check your inbox."])
        builder.append(.showAlert, from: (reset, 1), values: [
            "title": "Couldn't send the reset link",
            "message": "Enter the email you signed up with and try again.",
        ])
        return builder.flow(screenNodeId: screen.id)
    }

    /// Log out from wherever the design put it (profile, settings, a menu).
    private static func logOutFlow(design: ProjectViewModel, pageIndex: Int, login: DesignNode) -> LogicFlow? {
        for screen in frames(design, pageIndex: pageIndex) where screen.id != login.id {
            guard let control = tappable(
                in: screen,
                preferring: ["log out", "logout", "sign out", "signout", "התנתק", "התנתקות", "יציאה"],
                avoiding: []
            ) else { continue }
            var builder = FlowBuilder(name: "Log Out", trigger: .onTap, element: control.id)
            guard builder.isValid else { return nil }
            // Confirm first — sign-out is cheap to undo but jarring to hit by
            // accident, and every professional app gates it.
            let confirm = builder.append(.confirmDialog, values: [
                "title": "Sign out?",
                "message": "You can sign back in anytime.",
                "confirmLabel": "Sign Out",
                "cancelLabel": "Cancel",
            ])
            let logout = builder.append(.firebaseLogout, from: (confirm, 0))
            builder.append(.navigate, from: (logout, 0), screens: ["screen": login.id])
            builder.append(.showAlert, from: (logout, 1), values: ["title": "Couldn't sign out"])
            return builder.flow(screenNodeId: screen.id)
        }
        return nil
    }

    /// The users/{uid} profile is written at sign-up and was never read back —
    /// so profile screens showed the design's hardcoded persona forever. This
    /// loads it whenever a profile/settings/account screen appears, into the
    /// shared `profile` variable ({{profile.displayName}} etc.).
    private static func loadProfileFlow(
        design: ProjectViewModel,
        pageIndex: Int,
        excluding excluded: [UUID]
    ) -> LogicFlow? {
        let profileScreen = frames(design, pageIndex: pageIndex).first { frame in
            guard !excluded.contains(frame.id) else { return false }
            let name = frame.name.lowercased()
            return ["profile", "account", "settings", "me", "פרופיל", "חשבון", "הגדרות"]
                .contains { name == $0 || name.contains($0) }
        }
        guard let profileScreen else { return nil }
        var builder = FlowBuilder(name: "Load Profile", trigger: .onScreenLoad)
        guard builder.isValid else { return nil }
        _ = builder.append(.firestoreGetDocument, values: [
            "path": "users/{{uid}}",
        ], variables: ["variable": profileVariable])
        // Error branch intentionally silent: a missing profile document is
        // normal for a guest and not worth an alert on screen entry.
        return builder.flow(screenNodeId: profileScreen.id)
    }

    // MARK: - Persistence

    private static func persistenceFlows(
        blueprint: BackendBlueprint,
        design: ProjectViewModel,
        pageIndex: Int,
        home: DesignNode?,
        authScreenIds: [UUID],
        logic: LogicViewModel
    ) -> (flows: [LogicFlow], notes: [String]) {
        var flows: [LogicFlow] = []
        var notes: [String] = []
        let entity = blueprint.primary

        // Load: the list screen's appearance queries the user's own documents.
        // The where-clause is not an optimisation — the generated rules only
        // allow reads of documents carrying your uid, so an unscoped query is
        // denied at runtime.
        if let listScreen = home {
            var builder = FlowBuilder(name: "Load \(entity.label)s", trigger: .onScreenLoad)
            if builder.isValid {
                let query = builder.append(.firestoreQuery, values: [
                    "collection": entity.collection,
                    "where": "userId == {{uid}}",
                    "orderBy": "createdAt desc",
                    "limit": "50",
                ], variables: ["variable": entity.listVariable])
                builder.append(.showAlert, from: (query, 1), values: [
                    "title": "Couldn't load your \(entity.label.lowercased())s",
                    "message": "Check your connection and reopen this screen.",
                ])
                if let flow = builder.flow(screenNodeId: listScreen.id) { flows.append(flow) }
            }
        }

        // Save: the first create-shaped CTA outside the auth screens. When the
        // design has NONE — which was true for most generated apps — synthesize
        // the whole write path: a "New <Entity>" form screen with real inputs,
        // a "+" button on the list screen to reach it, and a Back control.
        // An app that can read its collection but never write to it isn't an
        // app with persistence; it's a viewer for a database nobody fills.
        var createAnchor = createControl(design: design, pageIndex: pageIndex, excluding: authScreenIds)
        if createAnchor == nil {
            let created = synthesizeCreateScreen(
                entity: entity, design: design, pageIndex: pageIndex, home: home
            )
            if let created {
                createAnchor = (created.screen, created.saveButton)
                flows.append(contentsOf: created.flows)
                notes.append("Created a '\(created.screen.name)' form screen (+ button on \(home?.name ?? "the list screen") opens it).")
            }
        }
        if let (screen, button) = createAnchor {
            var builder = FlowBuilder(name: "Save \(entity.label)", trigger: .onTap, element: button.id)
            if builder.isValid {
                let inputs = textInputs(in: screen)
                var data = "userId={{uid}}\ncreatedAt={{now}}"
                var used = 0
                for field in entity.fields where used < inputs.count {
                    // Only fields a real input on this screen can fill —
                    // inventing values would write junk documents.
                    guard let input = matchingInput(for: field.name, in: inputs, alreadyUsed: used) else { continue }
                    let variable = boundVariable(input) ?? bindDraft(
                        input: input, field: field.name, entity: entity,
                        design: design, pageIndex: pageIndex, screenId: screen.id
                    )
                    guard let variable else { continue }
                    data += "\n\(field.name)={{\(variable)}}"
                    used += 1
                }
                let save = builder.append(.firestoreAddDocument, values: [
                    "collection": entity.collection,
                    "data": data,
                ])
                builder.append(.showToast, from: (save, 0), values: ["message": "\(entity.label) saved"])
                // Re-read after the write, so the list shows what was just
                // saved instead of going stale until the next cold start.
                builder.append(.firestoreQuery, values: [
                    "collection": entity.collection,
                    "where": "userId == {{uid}}",
                    "orderBy": "createdAt desc",
                    "limit": "50",
                ], variables: ["variable": entity.listVariable])
                // A dedicated form screen pops back to the list after saving;
                // an inline save button (a FAB on the list itself) must not.
                if screen.id != home?.id {
                    builder.append(.goBack)
                }
                builder.append(.showAlert, from: (save, 1), values: [
                    "title": "Couldn't save",
                    "message": "Your \(entity.label.lowercased()) stayed on this device. Try again.",
                ])
                if let flow = builder.flow(screenNodeId: screen.id) { flows.append(flow) }
            }
        } else {
            notes.append("No create/save button found and no list screen to anchor a form to — added the read path only.")
        }

        // Show it: bind a repeatable row/card to the query result so saved
        // documents actually appear instead of the designed placeholder.
        let titleCandidates = ["title", "name", "symbol", "metric", "mood", "destination", "body"]
        let titleFieldName = entity.fields.first { titleCandidates.contains($0.name) }?.name
            ?? entity.fields.first?.name
        let alreadyBound = home.map { screen in
            descendants(of: screen).contains { $0.repeatBinding?.sourceVariable == entity.listVariable }
        } ?? false
        if alreadyBound {
            // A previous run already bound this list. Binding "the next card
            // too" on every re-run turned a whole storefront into repeats of
            // one collection.
        } else if let listScreen = home,
                  let template = repeatTemplate(in: listScreen, entity: entity),
                  let titleField = titleFieldName {
            let alias = singular(entity.collection)
            // The alias is ALSO a declared json variable: tapping a row stores
            // that document's JSON here, and the detail screen's
            // {{alias.field}} texts compile against state.<alias>.
            declare(alias, .json, in: design, default: "{}")
            if bindRepeat(
                templateId: template.id, alias: alias, source: entity.listVariable,
                titleField: titleField, design: design, pageIndex: pageIndex, screenId: listScreen.id
            ) {
                notes.append("'\(template.name)' on \(listScreen.name) now repeats over \(entity.listVariable) ({{\(alias)…}} tokens).")
                // Round out CRUD: tapping a row opens a detail screen showing
                // THAT document, with a confirmed Delete. Without this, saved
                // items were rows you could look at and never touch again.
                let detail = wireDetailAndDelete(
                    entity: entity, alias: alias, templateId: template.id,
                    listScreen: listScreen, design: design, pageIndex: pageIndex, logic: logic
                )
                flows.append(contentsOf: detail.flows)
                notes.append(contentsOf: detail.notes)
            }
        } else {
            notes.append("""
            No row/card on the list screen names \(entity.collection), so nothing was bound to the \
            query result — \(entity.listVariable) holds the data but no list renders it. Point a row at \
            it with apply_design_actions (updateNode + repeatSourceVariable: "\(entity.listVariable)") \
            and put {{\(singular(entity.collection)).<field>}} in its texts.
            """)
        }

        // Secondary collections (goals, comments, addresses…): every screen
        // named after one gets its own load-on-appear query and, where a row
        // template exists, a live binding — not just the home screen. A
        // "Goals" tab that shows designed placeholders while goals/ sits
        // empty in Firestore is exactly the kind of quiet lie this pass
        // exists to kill.
        for secondary in blueprint.secondary {
            guard let screen = screenNamed(like: secondary, design: design, pageIndex: pageIndex, excluding: authScreenIds) else { continue }
            declare(secondary.listVariable, .json, in: design, default: "[]")
            var loader = FlowBuilder(name: "Load \(secondary.label)s", trigger: .onScreenLoad)
            if loader.isValid {
                loader.append(.firestoreQuery, values: [
                    "collection": secondary.collection,
                    "where": "userId == {{uid}}",
                    "orderBy": "createdAt desc",
                    "limit": "50",
                ], variables: ["variable": secondary.listVariable])
                if let flow = loader.flow(screenNodeId: screen.id) { flows.append(flow) }
            }
            let bound = descendants(of: screen).contains { $0.repeatBinding?.sourceVariable == secondary.listVariable }
            if !bound,
               let template = repeatTemplate(in: screen, entity: secondary),
               let title = secondary.fields.first(where: { titleCandidates.contains($0.name) })?.name ?? secondary.fields.first?.name {
                declare(singular(secondary.collection), .json, in: design, default: "{}")
                _ = bindRepeat(
                    templateId: template.id, alias: singular(secondary.collection), source: secondary.listVariable,
                    titleField: title, design: design, pageIndex: pageIndex, screenId: screen.id
                )
            }
            notes.append("\(screen.name) loads \(secondary.collection) on appear.")
        }

        return (flows, notes)
    }

    /// Builds the missing write path: a "New <Entity>" form screen (real
    /// .Input per field, Save + Back), a "+" button on the list screen, and
    /// the navigation flows between them. The Save flow itself is built by
    /// the caller against the returned button, same as a designed screen.
    private static func synthesizeCreateScreen(
        entity: BackendBlueprint.Entity,
        design: ProjectViewModel,
        pageIndex: Int,
        home: DesignNode?
    ) -> (screen: DesignNode, saveButton: DesignNode, flows: [LogicFlow])? {
        guard let home else { return nil }
        let palette = Palette(project: design.project, pageIndex: pageIndex)

        var children: [DesignNode] = []
        var y: CGFloat = 70
        let back = button("Back", "Back", y: y, palette: palette)
        var backButton = back
        backButton.width = 90
        backButton.height = 40
        backButton.style.fill = palette.surface
        backButton.style.textColor = palette.textPrimary
        backButton.style.fontSize = 14
        children.append(backButton)
        y += 64
        children.append(text("Title", "New \(entity.label)", y: y, size: 30, weight: "bold", color: palette.textPrimary))
        y += 60

        // One typeable input per schema field (up to 4 — a longer first-run
        // form loses the user), each pre-bound to its draft variable so the
        // Save flow can read exactly what was typed.
        for field in entity.fields.prefix(4) {
            let label = field.name.prefix(1).uppercased() + field.name.dropFirst()
            var node = input("\(label) Field", placeholder: String(label), y: y, palette: palette, secure: false)
            let variable = "draft" + singular(entity.collection).capitalizedFirst + field.name.capitalizedFirst
            declare(variable, .string, in: design)
            node.logicBindings = [NodeLogicBinding(kind: .value, variableName: variable)]
            children.append(node)
            y += 68
        }
        y += 20
        let saveButton = button("Save Button", "Save \(entity.label)", y: y, palette: palette)
        children.append(saveButton)

        let maxX = frames(design, pageIndex: pageIndex).map { $0.x + $0.width }.max() ?? 100
        let form = frame(name: "New \(entity.label)", x: maxX + 60, palette: palette, children: children)
        design.project.pages[pageIndex].nodes.append(form)

        // The "+" that opens the form, floating above the list content (and
        // above a bottom tab bar if there is one).
        var fab = button("Add \(entity.label) Button", "+", y: 0, palette: palette)
        fab.x = screenSize.width - 24 - 56
        fab.y = screenSize.height - 180
        fab.width = 56
        fab.height = 56
        fab.style.cornerRadius = 28
        fab.style.fontSize = 26
        fab.zIndex = 50
        if let homeIndex = design.project.pages[pageIndex].nodes.firstIndex(where: { $0.id == home.id }) {
            design.project.pages[pageIndex].nodes[homeIndex].children.append(fab)
        }

        var flows: [LogicFlow] = []
        var openBuilder = FlowBuilder(name: "Open New \(entity.label)", trigger: .onTap, element: fab.id)
        if openBuilder.isValid {
            openBuilder.append(.navigate, screens: ["screen": form.id])
            if let flow = openBuilder.flow(screenNodeId: home.id) { flows.append(flow) }
        }
        var backBuilder = FlowBuilder(name: "Close New \(entity.label)", trigger: .onTap, element: backButton.id)
        if backBuilder.isValid {
            backBuilder.append(.goBack)
            if let flow = backBuilder.flow(screenNodeId: form.id) { flows.append(flow) }
        }
        return (form, saveButton, flows)
    }

    /// A screen whose NAME says it lists this entity ("Goals", "Order History",
    /// "Saved Places") — for wiring secondary collections.
    private static func screenNamed(
        like entity: BackendBlueprint.Entity,
        design: ProjectViewModel,
        pageIndex: Int,
        excluding excluded: [UUID]
    ) -> DesignNode? {
        let wanted = [entity.collection.lowercased(), singular(entity.collection).lowercased(), entity.label.lowercased()]
        return frames(design, pageIndex: pageIndex).first { frame in
            guard !excluded.contains(frame.id) else { return false }
            let name = frame.name.lowercased()
            // "New X" is the create form, "X Details" the detail — neither is
            // the list screen even though both name the entity.
            guard !name.hasPrefix("new "), !name.contains("detail") else { return false }
            return wanted.contains { name.contains($0) }
        }
    }

    /// Row tap → "<Label> Details" (every field of THAT document via
    /// {{alias.field}} tokens) → confirmed Delete → re-query → back.
    private static func wireDetailAndDelete(
        entity: BackendBlueprint.Entity,
        alias: String,
        templateId: UUID,
        listScreen: DesignNode,
        design: ProjectViewModel,
        pageIndex: Int,
        logic: LogicViewModel
    ) -> (flows: [LogicFlow], notes: [String]) {
        var flows: [LogicFlow] = []
        var notes: [String] = []

        // A row that already navigates somewhere keeps its wiring — the model
        // knew what it wanted; we only fill silence.
        let rowAlreadyWired = logic.flows.contains { flow in
            flow.blocks.contains { block in
                block.type == .onTap && block.parameters.contains { $0.key == "element" && $0.nodeReference == templateId }
            }
        }
        guard !rowAlreadyWired else {
            return (flows, ["Row already had a tap flow — detail screen not wired."])
        }

        // Detail screen: reuse one named like it, else synthesize.
        let detailName = "\(entity.label) Details"
        var detailScreen = frames(design, pageIndex: pageIndex).first {
            $0.name.lowercased().contains("detail") && !$0.name.lowercased().hasPrefix("new ")
        }
        var deleteButtonId: UUID?
        var backButtonId: UUID?

        if detailScreen == nil {
            let palette = Palette(project: design.project, pageIndex: pageIndex)
            var children: [DesignNode] = []
            var y: CGFloat = 70
            var back = button("Back", "Back", y: y, palette: palette)
            back.width = 90; back.height = 40
            back.style.fill = palette.surface
            back.style.textColor = palette.textPrimary
            back.style.fontSize = 14
            children.append(back)
            backButtonId = back.id
            y += 64
            let titleField = entity.fields.first?.name ?? "title"
            children.append(text("Title", "{{\(alias).\(titleField)}}", y: y, size: 30, weight: "bold", color: palette.textPrimary))
            y += 64
            for field in entity.fields.dropFirst().prefix(5) {
                let label = field.name.prefix(1).uppercased() + field.name.dropFirst()
                children.append(text("\(label) Label", String(label), y: y, size: 12, weight: "semibold", color: palette.textSecondary))
                y += 22
                children.append(text("\(label) Value", "{{\(alias).\(field.name)}}", y: y, size: 17, weight: "regular", color: palette.textPrimary))
                y += 44
            }
            y += 24
            var delete = button("Delete Button", "Delete \(entity.label)", y: y, palette: palette)
            delete.style.fill = "#E5484D"
            delete.style.textColor = "#FFFFFF"
            children.append(delete)
            deleteButtonId = delete.id

            let maxX = frames(design, pageIndex: pageIndex).map { $0.x + $0.width }.max() ?? 100
            let detailFrame = frame(name: detailName, x: maxX + 60, palette: palette, children: children)
            design.project.pages[pageIndex].nodes.append(detailFrame)
            detailScreen = detailFrame
            notes.append("Created '\(detailName)' (row tap opens it; fields render the tapped document).")
        } else if let existing = detailScreen {
            deleteButtonId = tappable(in: existing, preferring: ["delete", "remove", "מחק"], avoiding: [])?.id
        }

        guard let detail = detailScreen else { return (flows, notes) }

        var open = FlowBuilder(name: "Open \(entity.label) Details", trigger: .onTap, element: templateId)
        if open.isValid {
            open.append(.navigate, screens: ["screen": detail.id])
            if let flow = open.flow(screenNodeId: listScreen.id) { flows.append(flow) }
        }
        if let backId = backButtonId {
            var close = FlowBuilder(name: "Close \(entity.label) Details", trigger: .onTap, element: backId)
            if close.isValid {
                close.append(.goBack)
                if let flow = close.flow(screenNodeId: detail.id) { flows.append(flow) }
            }
        }
        if let deleteId = deleteButtonId {
            var remove = FlowBuilder(name: "Delete \(entity.label)", trigger: .onTap, element: deleteId)
            if remove.isValid {
                let confirm = remove.append(.confirmDialog, values: [
                    "title": "Delete this \(entity.label.lowercased())?",
                    "message": "This can't be undone.",
                    "confirmLabel": "Delete",
                    "cancelLabel": "Keep",
                ])
                let erase = remove.append(.firestoreDeleteDocument, from: (confirm, 0), values: [
                    "path": "\(entity.collection)/{{\(alias)._id}}",
                ])
                remove.append(.firestoreQuery, from: (erase, 0), values: [
                    "collection": entity.collection,
                    "where": "userId == {{uid}}",
                    "orderBy": "createdAt desc",
                    "limit": "50",
                ], variables: ["variable": entity.listVariable])
                remove.append(.goBack)
                remove.append(.showAlert, from: (erase, 1), values: [
                    "title": "Couldn't delete",
                    "message": "Check your connection and try again.",
                ])
                if let flow = remove.flow(screenNodeId: detail.id) { flows.append(flow) }
            }
        }
        return (flows, notes)
    }

    /// A field name → the input most likely meant for it, falling back to
    /// positional order so a plain "New item" form still saves something.
    private static func matchingInput(for field: String, in inputs: [DesignNode], alreadyUsed: Int) -> DesignNode? {
        let target = field.lowercased()
        if let match = inputs.first(where: { node in
            let haystack = [node.name, node.text, node.children.first?.text]
                .compactMap { $0 }.joined(separator: " ").lowercased()
            return haystack.contains(target)
        }) { return match }
        return inputs.indices.contains(alreadyUsed) ? inputs[alreadyUsed] : nil
    }

    /// Gives an unbound form input a variable of its own, so its typed value
    /// can reach Firestore.
    private static func bindDraft(
        input: DesignNode,
        field: String,
        entity: BackendBlueprint.Entity,
        design: ProjectViewModel,
        pageIndex: Int,
        screenId: UUID
    ) -> String? {
        let variable = "draft" + singular(entity.collection).capitalizedFirst + field.capitalizedFirst
        declare(variable, .string, in: design)
        var applied = false
        func walk(_ nodes: inout [DesignNode]) {
            for index in nodes.indices {
                if nodes[index].id == input.id {
                    var bindings = nodes[index].logicBindings ?? []
                    bindings.append(NodeLogicBinding(kind: .value, variableName: variable))
                    nodes[index].logicBindings = bindings
                    applied = true
                    return
                }
                walk(&nodes[index].children)
                if applied { return }
            }
        }
        guard let screenIndex = design.project.pages[pageIndex].nodes.firstIndex(where: { $0.id == screenId })
        else { return nil }
        walk(&design.project.pages[pageIndex].nodes[screenIndex].children)
        return applied ? variable : nil
    }

    private static func bindRepeat(
        templateId: UUID,
        alias: String,
        source: String,
        titleField: String,
        design: ProjectViewModel,
        pageIndex: Int,
        screenId: UUID
    ) -> Bool {
        var applied = false
        func walk(_ nodes: inout [DesignNode]) {
            for index in nodes.indices {
                if nodes[index].id == templateId {
                    guard nodes[index].repeatBinding == nil else { return }
                    nodes[index].repeatBinding = RepeatBinding(
                        sourceVariable: source, itemAlias: alias, maxItems: 50
                    )
                    // The first text in the row becomes the item's title, so
                    // the list shows real data rather than the design's
                    // placeholder copy repeated N times.
                    retitle(&nodes[index], token: "{{\(alias).\(titleField)}}")
                    // Sibling placeholder rows ("Product Card 2", "Card 3")
                    // must go: real documents would otherwise render on top
                    // of — or beside — hardcoded demo content, and the mix
                    // reads as data corruption to the user.
                    let stem = nameStem(nodes[index].name)
                    let templateNodeId = nodes[index].id
                    nodes.removeAll { sibling in
                        sibling.id != templateNodeId && nameStem(sibling.name) == stem
                    }
                    applied = true
                    return
                }
                walk(&nodes[index].children)
                if applied { return }
            }
        }
        guard let screenIndex = design.project.pages[pageIndex].nodes.firstIndex(where: { $0.id == screenId })
        else { return false }
        walk(&design.project.pages[pageIndex].nodes[screenIndex].children)
        return applied
    }

    /// "Product Card 2" → "product card": the name minus trailing numbering,
    /// for matching a repeat template against its placeholder siblings.
    private static func nameStem(_ name: String) -> String {
        var stem = name.lowercased().trimmingCharacters(in: .whitespaces)
        while let last = stem.last, last.isNumber || last == " " {
            stem.removeLast()
        }
        return stem
    }

    private static func retitle(_ node: inout DesignNode, token: String) {
        if node.type == .Text, let text = node.text, !text.isEmpty, !text.contains("{{") {
            node.text = token
            return
        }
        for index in node.children.indices {
            let before = node.children[index].text
            retitle(&node.children[index], token: token)
            if node.children[index].text != before { return }
        }
    }

    /// A row/card that reads like a list item for THIS entity and isn't already
    /// repeating. The entity check matters: an e-commerce app's primary
    /// collection is `orders`, and binding a storefront's "Product Card" to it
    /// produced a shop that listed the user's own orders as merchandise. When
    /// nothing on the screen names the entity, bind nothing and say so — a
    /// wrong binding is worse than a static placeholder the audit already
    /// flags.
    private static func repeatTemplate(in screen: DesignNode, entity: BackendBlueprint.Entity) -> DesignNode? {
        let singularName = singular(entity.collection).lowercased()
        let screenNamesEntity = [screen.name.lowercased()].contains {
            $0.contains(singularName) || $0.contains(entity.collection.lowercased())
        }
        var best: DesignNode?
        func walk(_ node: DesignNode) {
            let name = node.name.lowercased()
            let looksLikeRow = node.type == .Frame
                && node.repeatBinding == nil
                && ["row", "card", "item", "cell", "entry", "tile"].contains { name.contains($0) }
                && !["nav", "tab", "header", "hero", "grid", "list"].contains { name.contains($0) }
                && node.children.contains { $0.type == .Text }
            // Either the row itself names the entity, or the whole screen is
            // that entity's list and the row is generic ("Item Row", "Cell").
            let relatesToEntity = name.contains(singularName)
                || (screenNamesEntity && !name.contains("product") && !name.contains("track"))
            if looksLikeRow, relatesToEntity, best == nil { best = node }
            for child in node.children { walk(child) }
        }
        for child in screen.children { walk(child) }
        return best
    }

    // MARK: - Element discovery

    private static func descendants(of node: DesignNode) -> [DesignNode] {
        var out: [DesignNode] = []
        func walk(_ current: DesignNode) {
            for child in current.children {
                out.append(child)
                walk(child)
            }
        }
        walk(node)
        return out
    }

    private static func textInputs(in screen: DesignNode) -> [DesignNode] {
        descendants(of: screen).filter { $0.type == .Input }.sorted { $0.y < $1.y }
    }

    private static func boundVariable(_ node: DesignNode) -> String? {
        node.logicBindings?.first { $0.kind == .value || $0.kind == .text }?.variableName
    }

    private static func label(_ node: DesignNode) -> String {
        var parts = [node.text, node.name].compactMap { $0 }
        parts += node.children.compactMap(\.text)
        return parts.joined(separator: " ").lowercased()
    }

    /// A real Button whose label names the action — the biggest one wins, so a
    /// full-width CTA beats a small secondary control with a similar label.
    private static func primaryButton(
        in screen: DesignNode,
        preferring wanted: [String],
        avoiding unwanted: [String]
    ) -> DesignNode? {
        let buttons = descendants(of: screen).filter { $0.type == .Button }
        let matches = buttons.filter { button in
            let text = label(button)
            return wanted.contains { text.contains($0) } && !unwanted.contains { text.contains($0) }
        }
        if let best = matches.max(by: { $0.width * $0.height < $1.width * $1.height }) { return best }
        // No label match: on a screen we did not design, the widest button is
        // the submit control far more often than not.
        return buttons
            .filter { button in
                let text = label(button)
                return !unwanted.contains { text.contains($0) }
            }
            .max { $0.width * $0.height < $1.width * $1.height }
    }

    /// Any tappable element (button OR text link) whose label matches.
    private static func tappable(
        in screen: DesignNode,
        preferring wanted: [String],
        avoiding unwanted: [String]
    ) -> DesignNode? {
        descendants(of: screen)
            .filter { $0.type == .Button || $0.type == .Text }
            .first { node in
                let text = label(node)
                return wanted.contains { text.contains($0) } && !unwanted.contains { text.contains($0) }
            }
    }

    private static func linkFlow(name: String, from: DesignNode, to: DesignNode, keywords: [String]) -> LogicFlow? {
        guard let link = tappable(in: from, preferring: keywords, avoiding: []) else { return nil }
        var builder = FlowBuilder(name: name, trigger: .onTap, element: link.id)
        guard builder.isValid else { return nil }
        builder.append(.navigate, screens: ["screen": to.id])
        return builder.flow(screenNodeId: from.id)
    }

    /// The app's "make a new one" control: a +, "Add", "Save", "Create"…
    private static func createControl(
        design: ProjectViewModel,
        pageIndex: Int,
        excluding excluded: [UUID]
    ) -> (screen: DesignNode, button: DesignNode)? {
        let wanted = ["save", "add ", "add", "create", "new ", "log ", "submit", "post", "+",
                      "שמור", "הוסף", "צור", "שמירה"]
        let unwanted = ["log in", "login", "sign in", "sign up", "signup", "add to cart", "logout", "log out"]
        // Screens named like a form/create flow first — a "New Task" screen's
        // Save button is a better anchor than a home-screen FAB.
        let ordered = frames(design, pageIndex: pageIndex)
            .filter { !excluded.contains($0.id) }
            .sorted { first, second in
                let firstFormish = ["new", "create", "add", "form", "compose", "log"].contains { first.name.lowercased().contains($0) }
                let secondFormish = ["new", "create", "add", "form", "compose", "log"].contains { second.name.lowercased().contains($0) }
                return firstFormish && !secondFormish
            }
        for screen in ordered {
            let candidates = descendants(of: screen).filter { $0.type == .Button }
            if let match = candidates.first(where: { button in
                let text = label(button)
                return wanted.contains { text.contains($0) } && !unwanted.contains { text.contains($0) }
            }) {
                return (screen, match)
            }
        }
        return nil
    }

    // MARK: - Generated auth screens

    static let screenSize = CGSize(width: 390, height: 844)

    /// Colours sampled from the project so a generated auth screen belongs to
    /// the same app — a fixed preset would look bolted on.
    struct Palette {
        var background = "#FFFFFF"
        var surface = "#F2F2F7"
        var textPrimary = "#111111"
        var textSecondary = "#8A8A8E"
        var accent = "#0A84FF"
        var accentText = "#FFFFFF"

        init(project: DesignProject, pageIndex: Int) {
            let frames = project.pages.indices.contains(pageIndex)
                ? project.pages[pageIndex].nodes.filter { $0.type == .Frame }
                : []
            if let fill = frames.first?.style.fill, fill.hasPrefix("#"), fill.count >= 7 {
                background = fill
            }
            if let accentHex = project.brand?.accent, accentHex.hasPrefix("#") {
                accent = accentHex
            } else if let cta = frames.flatMap({ node in
                BackendWiringGenerator.descendants(of: node)
            }).first(where: { $0.type == .Button && $0.style.fill.hasPrefix("#") && $0.style.fill.count >= 7 }) {
                accent = cta.style.fill
            }
            let dark = Palette.isDark(background)
            surface = dark ? Palette.lighten(background, by: 0.10) : Palette.darken(background, by: 0.05)
            textPrimary = dark ? "#FFFFFF" : "#111111"
            textSecondary = dark ? "#A8A8AE" : "#8A8A8E"
            accentText = Palette.isDark(accent) ? "#FFFFFF" : "#111111"
        }

        static func components(_ hex: String) -> (Double, Double, Double)? {
            var value = hex
            if value.hasPrefix("#") { value.removeFirst() }
            guard value.count >= 6, let number = Int(value.prefix(6), radix: 16) else { return nil }
            return (Double((number >> 16) & 0xFF) / 255,
                    Double((number >> 8) & 0xFF) / 255,
                    Double(number & 0xFF) / 255)
        }

        static func isDark(_ hex: String) -> Bool {
            guard let (r, g, b) = components(hex) else { return false }
            return (0.299 * r + 0.587 * g + 0.114 * b) < 0.5
        }

        static func lighten(_ hex: String, by amount: Double) -> String {
            shift(hex) { min(1, $0 + amount) }
        }

        static func darken(_ hex: String, by amount: Double) -> String {
            shift(hex) { max(0, $0 - amount) }
        }

        private static func shift(_ hex: String, _ transform: (Double) -> Double) -> String {
            guard let (r, g, b) = components(hex) else { return hex }
            func channel(_ value: Double) -> Int { Int((transform(value) * 255).rounded()) }
            return String(format: "#%02X%02X%02X", channel(r), channel(g), channel(b))
        }
    }

    private static func makeLoginScreen(palette: Palette, x: CGFloat) -> DesignNode {
        var children: [DesignNode] = []
        var y: CGFloat = 120
        children.append(text("Title", "Welcome back", y: y, size: 32, weight: "bold", color: palette.textPrimary))
        y += 44
        children.append(text("Subtitle", "Sign in to continue", y: y, size: 15, weight: "regular", color: palette.textSecondary))
        y += 48
        children.append(input("Email Field", placeholder: "Email address", y: y, palette: palette, secure: false))
        y += 68
        children.append(input("Password Field", placeholder: "Password", y: y, palette: palette, secure: true))
        y += 68
        children.append(text("Forgot Password Link", "Forgot password?", y: y, size: 14, weight: "semibold", color: palette.accent, align: "right"))
        y += 40
        children.append(button("Log In Button", "Log In", y: y, palette: palette))
        y += 76
        children.append(text("Sign Up Link", "New here? Create an account", y: y, size: 14, weight: "semibold", color: palette.accent, align: "center"))
        return frame(name: "Log In", x: x, palette: palette, children: children)
    }

    private static func makeSignUpScreen(palette: Palette, x: CGFloat) -> DesignNode {
        var children: [DesignNode] = []
        var y: CGFloat = 120
        children.append(text("Title", "Create your account", y: y, size: 32, weight: "bold", color: palette.textPrimary))
        y += 44
        children.append(text("Subtitle", "It takes less than a minute", y: y, size: 15, weight: "regular", color: palette.textSecondary))
        y += 48
        children.append(input("Name Field", placeholder: "Full name", y: y, palette: palette, secure: false))
        y += 68
        children.append(input("Email Field", placeholder: "Email address", y: y, palette: palette, secure: false))
        y += 68
        children.append(input("Password Field", placeholder: "Password (6+ characters)", y: y, palette: palette, secure: true))
        y += 68
        children.append(input("Confirm Password Field", placeholder: "Confirm password", y: y, palette: palette, secure: true))
        y += 84
        children.append(button("Sign Up Button", "Create Account", y: y, palette: palette))
        y += 76
        children.append(text("Log In Link", "I already have an account", y: y, size: 14, weight: "semibold", color: palette.accent, align: "center"))
        return frame(name: "Sign Up", x: x, palette: palette, children: children)
    }

    private static func frame(name: String, x: CGFloat, palette: Palette, children: [DesignNode]) -> DesignNode {
        DesignNode(
            type: .Frame, name: name,
            x: x, y: 100, width: screenSize.width, height: screenSize.height,
            style: NodeStyle(fill: palette.background, cornerRadius: 40, opacity: 1),
            children: children
        )
    }

    private static func text(
        _ name: String, _ value: String, y: CGFloat,
        size: CGFloat, weight: String, color: String, align: String = "left"
    ) -> DesignNode {
        DesignNode(
            type: .Text, name: name,
            x: 24, y: y, width: screenSize.width - 48, height: size + 10,
            text: value,
            style: NodeStyle(
                fill: "#00000000", cornerRadius: 0, opacity: 1,
                fontSize: size, fontWeight: weight, textColor: color, textAlign: align
            )
        )
    }

    /// A REAL .Input node — the exporter renders it as a TextField/SecureField
    /// bound to a variable. The decorative "inputField" component is a Frame
    /// with a placeholder label and cannot be typed into.
    private static func input(
        _ name: String, placeholder: String, y: CGFloat, palette: Palette, secure: Bool
    ) -> DesignNode {
        var node = DesignNode(
            type: .Input, name: name,
            x: 24, y: y, width: screenSize.width - 48, height: 56,
            text: placeholder,
            style: NodeStyle(
                fill: palette.surface, cornerRadius: 14, opacity: 1,
                fontSize: 16, fontWeight: "regular", textColor: palette.textPrimary,
                paddingLeft: 16
            )
        )
        node.isSecure = secure
        return node
    }

    private static func button(_ name: String, _ title: String, y: CGFloat, palette: Palette) -> DesignNode {
        DesignNode(
            type: .Button, name: name,
            x: 24, y: y, width: screenSize.width - 48, height: 56,
            text: title,
            style: NodeStyle(
                fill: palette.accent, cornerRadius: 16, opacity: 1,
                fontSize: 17, fontWeight: "bold", textColor: palette.accentText,
                textAlign: "center"
            )
        )
    }

    // MARK: - Naming

    private static func singular(_ collection: String) -> String {
        if collection.hasSuffix("ies") { return String(collection.dropLast(3)) + "y" }
        if collection.hasSuffix("ses") { return String(collection.dropLast(2)) }
        if collection.hasSuffix("s"), !collection.hasSuffix("ss") { return String(collection.dropLast()) }
        return collection
    }
}

// MARK: - Flow construction

/// Builds a trigger + branching block graph from the real block catalog, so
/// every parameter key, port index and category matches what the editor,
/// simulator and exporters expect. Hand-built blocks drift from the catalog
/// and then silently no-op.
@MainActor
private struct FlowBuilder {
    private(set) var blocks: [LogicBlock] = []
    private var connections: [BlockConnection] = []
    private var lastId: UUID?
    private let name: String

    var isValid: Bool { lastId != nil }

    init(name: String, trigger: LogicBlockType, element: UUID? = nil) {
        self.name = name
        guard var event = BlockCatalog.makeBlock(type: trigger, at: CGPoint(x: 40, y: 40)) else { return }
        event.label = "\(name) Trigger"
        if let element {
            event.connectedDesignNodeId = element
            if let index = event.parameters.firstIndex(where: { $0.key == "element" }) {
                event.parameters[index].nodeReference = element
            }
        }
        blocks = [event]
        lastId = event.id
    }

    /// Appends a block, wired from `from` (block id + output port) or from the
    /// previous block's success port. Returns the new block's id.
    @discardableResult
    mutating func append(
        _ type: LogicBlockType,
        from source: (UUID, Int)? = nil,
        values: [String: String] = [:],
        nodes: [String: UUID] = [:],
        variables: [String: String] = [:],
        screens: [String: UUID] = [:]
    ) -> UUID {
        let sourceId = source?.0 ?? lastId
        let port = source?.1 ?? 0
        let y = CGFloat(40 + blocks.count * 120)
        guard var block = BlockCatalog.makeBlock(type: type, at: CGPoint(x: 320, y: y)) else {
            return sourceId ?? UUID()
        }
        for index in block.parameters.indices {
            let key = block.parameters[index].key
            if let value = values[key] { block.parameters[index].value = value }
            if let nodeId = nodes[key] { block.parameters[index].nodeReference = nodeId }
            if let screenId = screens[key] { block.parameters[index].nodeReference = screenId }
            if let variable = variables[key] {
                block.parameters[index].variableReference = variable
                // MCP-driven and older readers look at `value` for "Store In"
                // targets; setting both means no reader silently no-ops.
                if block.parameters[index].type == .variable, block.parameters[index].value?.isEmpty ?? true {
                    block.parameters[index].value = variable
                }
            }
        }
        blocks.append(block)
        if let sourceId {
            connections.append(BlockConnection(
                sourceBlockId: sourceId, sourcePortIndex: port,
                targetBlockId: block.id, targetPortIndex: 0
            ))
        }
        // Only a success-port append advances the chain; an error leaf must not
        // become the trunk everything else hangs off.
        if source == nil || port == 0 { lastId = block.id }
        return block.id
    }

    func flow(screenNodeId: UUID?) -> LogicFlow? {
        guard blocks.count > 1 else { return nil }
        var laidOut = blocks
        LogicAgentTranslator.layoutIfNeeded(blocks: &laidOut, connections: connections)
        return LogicFlow(
            name: name, blocks: laidOut, connections: connections, screenNodeId: screenNodeId
        )
    }
}

private extension String {
    var capitalizedFirst: String {
        guard let first else { return self }
        return first.uppercased() + dropFirst()
    }
}
