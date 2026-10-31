//
//  BriefIntake.swift
//  AgenticDesigner
//
//  The professional intake: which product-shaping decisions does this brief
//  actually leave open? "Build me a fitness app" and a Lovable-grade result
//  are separated by four answers nobody wrote down — name, accounts, style,
//  and (sometimes) what kind of app this even is. Guessing them silently is
//  how a build ends up polished AND wrong.
//
//  Deterministic on purpose: the agent loop injects this analysis into its
//  first message so even a small local model knows exactly what to ask, and
//  the analyze_brief MCP tool gives an external agent the same checklist to
//  run with ITS user. Every question maps to a knob the pipeline can really
//  turn — a question whose answer nothing consumes is theater.
//
//  Just as important is what this file refuses to ask about: spacing, copy,
//  component choice, screen count — decisions the pipeline makes well on its
//  own. An interview that reads like a settings form kills the one-prompt
//  magic the product is built around.
//

import Foundation

struct IntakeQuestion: Identifiable {
    /// Stable id so answers can be matched back programmatically.
    let id: String
    let question: String
    /// 2–4 choices, the RECOMMENDED one first. Free text is always allowed.
    let options: [String]
    /// Which pipeline knob consumes the answer (documentation for the asker).
    let consumedBy: String

    var asPromptLine: String {
        "- [\(id)] \(question) Options (recommended first): \(options.joined(separator: " | ")). Answer is consumed by: \(consumedBy)."
    }
}

enum BriefIntake {

    /// The decisions a thin brief leaves open, as ready-to-ask questions.
    /// Empty means: the brief is complete enough — build, don't interview.
    static func analyze(prompt: String, project: DesignProject?) -> [IntakeQuestion] {
        var questions: [IntakeQuestion] = []
        let text = prompt.lowercased()
        let isHebrew = prompt.unicodeScalars.contains { (0x0590...0x05FF).contains($0.value) }

        // 1 — Product name. An app shipped as "Untitled Project" is the
        // single most visible sign nobody asked. Quoted names, "called X",
        // and an already-named project all count as answered.
        let projectNamed = (project?.name.isEmpty == false)
            && project?.name.lowercased().contains("untitled") == false
        let promptNames = prompt.contains("\"") || prompt.contains("“")
            || text.contains(" called ") || text.contains(" named ")
            || text.contains("בשם ") || text.contains("שנקראת ") || text.contains("שנקרא ")
        if !projectNamed && !promptNames {
            questions.append(IntakeQuestion(
                id: "name",
                question: isHebrew ? "איך לקרוא לאפליקציה?" : "What should the app be called?",
                options: [isHebrew ? "תבחר אתה שם קליט (מומלץ)" : "Pick a catchy name for me (recommended)"],
                consumedBy: "set_product_identity (also derives the bundle id)"
            ))
        }

        // 2 — App category, only when the classifier can't tell. A wrong
        // category means the wrong Firestore schema and the wrong screens —
        // the most expensive guess on this list.
        if AppCategoryClassifier.classify(prompt: prompt) == .generic {
            questions.append(IntakeQuestion(
                id: "category",
                question: isHebrew
                    ? "לאיזה סוג אפליקציה זה הכי קרוב? (קובע את מבנה המסכים ואת סכימת הנתונים)"
                    : "What kind of app is this closest to? (decides the screen structure and the data schema)",
                options: ["productivity / tasks", "social / feed", "e-commerce / store",
                          "fitness / health", "education / courses"],
                consumedBy: "BackendBlueprint schema + wire_backend category override"
            ))
        }

        // 3 — Accounts. The default is Firebase email sign-in; a brief that
        // neither asks for accounts nor waves them off gets asked ONCE,
        // because this decides the app's first screen.
        let mentionsAccounts = ["login", "log in", "sign in", "signup", "sign up", "account",
                                "auth", "firebase", "supabase", "backend", "user", "users",
                                "הרשמה", "התחברות", "חשבון", "משתמש", "משתמשים"]
            .contains { text.contains($0) }
        if !mentionsAccounts && !BackendBlueprint.promptOptsOut(prompt) {
            questions.append(IntakeQuestion(
                id: "accounts",
                question: isHebrew
                    ? "האם המשתמשים צריכים חשבון? (קובע אם המסך הראשון הוא התחברות ואיפה הנתונים נשמרים)"
                    : "Should users have accounts? (decides whether the first screen is a login, and where data lives)",
                options: isHebrew
                    ? ["הרשמה באימייל + שמירה בענן (מומלץ)", "בלי חשבונות — הכל מקומי במכשיר"]
                    : ["Email sign-in + cloud sync (recommended)", "No accounts — everything stays on the device"],
                consumedBy: "build_full_app backend: firebase|none (wire_backend runs only for firebase)"
            ))
        }

        // 4 — Visual direction. Only when the brief gives zero visual signal;
        // one adjective ("minimal", "dark", "playful", a colour) is enough to
        // skip this — the designer takes it from there.
        let visualSignals = ["dark", "light", "minimal", "playful", "elegant", "premium", "bold",
                             "clean", "modern", "retro", "neon", "pastel", "colorful", "colourful",
                             "blue", "green", "red", "purple", "orange", "pink", "black", "white",
                             "כהה", "בהיר", "מינימלי", "צבעוני", "יוקרתי", "נקי", "מודרני",
                             "כחול", "ירוק", "אדום", "סגול", "כתום", "ורוד", "שחור", "לבן"]
        if !visualSignals.contains(where: { text.contains($0) }) {
            questions.append(IntakeQuestion(
                id: "style",
                question: isHebrew ? "איזה כיוון עיצובי?" : "Which visual direction?",
                options: isHebrew
                    ? ["שתבחר אתה לפי סוג האפליקציה (מומלץ)", "בהיר ונקי", "כהה ופרימיום", "צבעוני ומשחקי"]
                    : ["Designer's choice for this app type (recommended)", "Light & clean", "Dark & premium", "Colorful & playful"],
                consumedBy: "apply_theme preset + set_brand accent"
            ))
        }

        // 5 — UI language, asked only for a Hebrew brief. A Hebrew speaker
        // describing an app in Hebrew may still want an English product —
        // never assume either way.
        if isHebrew {
            questions.append(IntakeQuestion(
                id: "language",
                question: "באיזו שפה יהיה הממשק של האפליקציה עצמה?",
                options: ["אנגלית (מומלץ — תמיכת RTL בעיצובים עדיין חלקית)", "עברית"],
                consumedBy: "the copy the design/logic agents write into every screen"
            ))
        }

        // Interview discipline: more than 4 questions reads as a form, not a
        // conversation. Keep the most consequential (list is already ordered).
        return Array(questions.prefix(4))
    }

    /// The block injected into the agent loop's first message.
    static func promptSection(prompt: String, project: DesignProject?) -> String {
        let questions = analyze(prompt: prompt, project: project)
        guard !questions.isEmpty else {
            return """
            BRIEF ANALYSIS: the brief covers the product-shaping decisions — do NOT ask \
            clarifying questions; build.
            """
        }
        return """
        BRIEF ANALYSIS: the brief leaves \(questions.count) product-shaping decision(s) open. \
        BEFORE building, ask each one with the ask_user tool (one call per question, options \
        included, recommended option first). If the user does not answer in time you will get \
        the recommended option back — proceed with it and note the choice in your summary. \
        Ask nothing beyond these:
        \(questions.map(\.asPromptLine).joined(separator: "\n"))
        """
    }
}
