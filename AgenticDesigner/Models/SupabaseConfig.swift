//
//  SupabaseConfig.swift
//  AgenticDesigner
//
//  Project-level Supabase configuration used by Data & Backends blocks.
//  Supabase's REST (PostgREST) API needs only a project URL and anon key,
//  so generated code talks to it directly over URLSession — no SDK needed.
//

import Foundation

struct SupabaseConfig: Codable {
    var projectURL: String = ""
    var anonKey: String = ""
    var isEnabled: Bool = false

    var isConfigured: Bool {
        !projectURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !anonKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}
