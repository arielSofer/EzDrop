// Ported 1:1 from AgenticDesigner/Models/DesignProject.swift

import type { APIEndpointConfig } from './APIEndpointConfig';
import type { BrandIdentity } from './BrandIdentity';
import type { DesignNode } from './DesignNode';
import type { FirebaseConfig } from './FirebaseConfig';
import type { LogicFlow, LogicVariable } from './LogicModels';
import type { SupabaseConfig } from './SupabaseConfig';

export interface DesignProject {
  /** Stable identity for learning persistence; independent of the display name. */
  learningProjectId?: string;
  name: string;
  pages: DesignPage[];
  firebaseConfig?: FirebaseConfig;
  supabaseConfig?: SupabaseConfig;
  apiEndpoints: APIEndpointConfig[];
  globalVariables: LogicVariable[];
  platformSettings: ProjectPlatformSettings;
  // The product's identity colour. Persisted so re-theming, templates and
  // future agent runs keep the brand instead of reverting to stock palettes.
  brand?: BrandIdentity;
  // Overrides the auto-derived com.agentic.<name> bundle id for shipping.
  bundleIdentifier?: string;
  // Apple Developer Team id (e.g. "AB12CD34EF") — when set, exports emit
  // DEVELOPMENT_TEAM so the project runs on device / archives without
  // opening Xcode to pick a team.
  developmentTeam?: string;
  // The agent's persistent project memo (its CLAUDE.md equivalent): design
  // decisions, tone, and constraints committed in past runs — injected into
  // every agent loop so the design system isn't re-derived from scratch.
  agentMemo?: string;
  // Code Mode edits: generated-source files the user rewrote by hand, keyed
  // by FILE NAME (unique across .swift files in every export layout). Applied
  // on top of generation in Code Mode, both exports, and simulator runs —
  // an edited file stays edited until explicitly reverted.
  sourceOverrides?: Record<string, string>;
}

/** Swift `CodingKeys` order for DesignProject. */
export const DesignProjectCodingKeys = [
  'learningProjectId', 'name', 'pages', 'firebaseConfig', 'supabaseConfig', 'apiEndpoints', 'globalVariables', 'platformSettings',
  'brand', 'bundleIdentifier', 'developmentTeam', 'agentMemo', 'sourceOverrides',
] as const satisfies readonly (keyof DesignProject)[];

export function makeDesignProject(init: Partial<DesignProject> & { name: string; pages: DesignPage[] }): DesignProject {
  const p: DesignProject = {
    name: init.name,
    pages: init.pages,
    apiEndpoints: init.apiEndpoints ?? [],
    globalVariables: init.globalVariables ?? [],
    platformSettings: init.platformSettings ?? makeProjectPlatformSettings(),
  };
  if (init.learningProjectId !== undefined) p.learningProjectId = init.learningProjectId;
  if (init.firebaseConfig !== undefined) p.firebaseConfig = init.firebaseConfig;
  if (init.supabaseConfig !== undefined) p.supabaseConfig = init.supabaseConfig;
  if (init.brand !== undefined) p.brand = init.brand;
  if (init.bundleIdentifier !== undefined) p.bundleIdentifier = init.bundleIdentifier;
  if (init.developmentTeam !== undefined) p.developmentTeam = init.developmentTeam;
  if (init.agentMemo !== undefined) p.agentMemo = init.agentMemo;
  if (init.sourceOverrides !== undefined) p.sourceOverrides = init.sourceOverrides;
  return p;
}

export interface DesignPage {
  id: string;
  name: string;
  nodes: DesignNode[];
  logicFlows: LogicFlow[];
  supportedPlatforms?: AppPlatform[];
}

export function makeDesignPage(init: Partial<DesignPage> & { id: string; name: string; nodes: DesignNode[] }): DesignPage {
  const page: DesignPage = {
    id: init.id,
    name: init.name,
    nodes: init.nodes,
    logicFlows: init.logicFlows ?? [],
  };
  if (init.supportedPlatforms !== undefined) page.supportedPlatforms = init.supportedPlatforms;
  return page;
}

export const AllAppPlatform = ['iPhone', 'iPad', 'appleWatch'] as const;
export type AppPlatform = (typeof AllAppPlatform)[number];

export function isAppPlatform(value: unknown): value is AppPlatform {
  return typeof value === 'string' && (AllAppPlatform as readonly string[]).includes(value);
}

/** `AppPlatform.displayName` */
export function appPlatformDisplayName(platform: AppPlatform): string {
  switch (platform) {
    case 'iPhone': return 'iPhone';
    case 'iPad': return 'iPad';
    case 'appleWatch': return 'Apple Watch';
  }
}

export interface ProjectPlatformSettings {
  enabledPlatforms: AppPlatform[];
  defaultPreviewPlatform: AppPlatform;
  /** Which way the device is held. Games (and any wide layout) ship
   * landscape-only; without this the exported app rotates back to portrait
   * and a landscape level is letterboxed into uselessness. */
  orientation: AppOrientation;
}

export function makeProjectPlatformSettings(init: Partial<ProjectPlatformSettings> = {}): ProjectPlatformSettings {
  return {
    enabledPlatforms: init.enabledPlatforms ?? ['iPhone', 'iPad'],
    defaultPreviewPlatform: init.defaultPreviewPlatform ?? 'iPhone',
    orientation: init.orientation ?? 'portrait',
  };
}

export const AllAppOrientation = ['portrait', 'landscape', 'all'] as const;
export type AppOrientation = (typeof AllAppOrientation)[number];

/** `AppOrientation.displayName` */
export function appOrientationDisplayName(orientation: AppOrientation): string {
  switch (orientation) {
    case 'portrait': return 'Portrait';
    case 'landscape': return 'Landscape';
    case 'all': return 'Both';
  }
}

/** `AppOrientation.plistOrientations` — Info.plist value for iPhone (UISupportedInterfaceOrientations). */
export function appOrientationPlistOrientations(orientation: AppOrientation): string[] {
  switch (orientation) {
    case 'portrait': return ['UIInterfaceOrientationPortrait'];
    case 'landscape': return ['UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'];
    case 'all':
      return [
        'UIInterfaceOrientationPortrait',
        'UIInterfaceOrientationLandscapeLeft',
        'UIInterfaceOrientationLandscapeRight',
      ];
  }
}
