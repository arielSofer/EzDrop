// Ported 1:1 from AgenticDesigner/Models/SupabaseConfig.swift
//
// Project-level Supabase configuration used by Data & Backends blocks.
// Supabase's REST (PostgREST) API needs only a project URL and anon key,
// so generated code talks to it directly over URLSession — no SDK needed.

export interface SupabaseConfig {
  projectURL: string;
  anonKey: string;
  isEnabled: boolean;
}

export function makeSupabaseConfig(init: Partial<SupabaseConfig> = {}): SupabaseConfig {
  return {
    projectURL: init.projectURL ?? '',
    anonKey: init.anonKey ?? '',
    isEnabled: init.isEnabled ?? false,
  };
}

export function supabaseConfigIsConfigured(config: SupabaseConfig): boolean {
  return config.projectURL.trim().length > 0 && config.anonKey.trim().length > 0;
}
