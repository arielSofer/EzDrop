// Ported 1:1 from AgenticDesigner/Services/ExportReadiness.swift
//
// Product truth. The designer could always show a rich logic graph — 33
// flows, 192 blocks — while the exported binary silently contained a
// fraction of it, because `scopedFlowsForExport` drops any flow that isn't
// bound to a screen or element. A tool that lets you believe an unbound
// flow will run is a tool that manufactures confidence it hasn't earned.
//
// This audits the gap between what the canvas PROMISES and what the
// compiled app can actually DO, and says so out loud.

import type { DesignNode } from '../models/DesignNode';
import type { DesignProject } from '../models/DesignProject';
import { firebaseConfigIsConfigured } from '../models/FirebaseConfig';
import { supabaseConfigIsConfigured } from '../models/SupabaseConfig';
import type { LogicBlockType, LogicFlow } from '../models/LogicModels';
import { newUUID } from '../models/uuid';
import { blocksWithoutNativeCodegen, bindingKindsWithoutNativeSupport } from './LogicExporter';

export const AllReadinessSeverity = ['blocker', 'warning', 'info'] as const;
/**
 * `ReadinessFinding.Severity`
 * - blocker: the app cannot do what the screens claim.
 * - warning: it will run, but something is fake or missing.
 */
export type ReadinessSeverity = (typeof AllReadinessSeverity)[number];

export interface ReadinessFinding {
  id: string;
  severity: ReadinessSeverity;
  title: string;
  detail: string;
}

function finding(severity: ReadinessSeverity, title: string, detail: string): ReadinessFinding {
  return { id: newUUID(), severity, title, detail };
}

/**
 * The honest list of unimplemented blocks lives in LogicExporter, next to
 * the codegen, so it cannot drift out of sync with reality. Reading a
 * hand-maintained copy here is exactly how the truth-check came to print
 * "READY" over an app whose login could never succeed.
 */
const previewOnlyBlocks: ReadonlySet<LogicBlockType> = blocksWithoutNativeCodegen;

export function audit(project: DesignProject, flows: LogicFlow[]): ReadinessFinding[] {
  const findings: ReadinessFinding[] = [];

  const screens = project.pages.flatMap((page) => page.nodes.filter((n) => n.type === 'Frame'));
  const screenIds = new Set(screens.map((s) => s.id));
  const elementIds = new Set<string>();
  function collect(node: DesignNode): void {
    elementIds.add(node.id);
    node.children.forEach(collect);
  }
  screens.forEach(collect);

  // 1. Flows the exporter will DROP — the single most dangerous lie,
  //    because the canvas counts them and the binary doesn't have them.
  // Game-event triggers (On Game Over/Win/Score/Tap/Drag/Collision/
  // Entity Destroyed) and app-launch/custom events fire without a node
  // binding — the game screen's export closure calls them directly.
  const selfTriggering: ReadonlySet<LogicBlockType> = new Set<LogicBlockType>([
    'onGameOver', 'onGameWin', 'onGameScore', 'onGameTap', 'onGameDrag',
    'onGameCollision', 'onGameEntityDestroyed', 'onAppLaunch', 'customEvent',
    'onGameStart', 'onGameLifeLost', 'onGameSpawned', 'onGameImpact', 'onGameLaunched',
  ]);
  const unbound = flows.filter((flow) => {
    if (flow.blocks.length === 0) return false;
    if (flow.blocks.some((b) => selfTriggering.has(b.type))) return false;
    if (flow.screenNodeId !== undefined && screenIds.has(flow.screenNodeId)) return false;
    const boundToElement = flow.blocks.some((block) => {
      if (block.connectedDesignNodeId !== undefined && elementIds.has(block.connectedDesignNodeId)) return true;
      return block.parameters.some((parameter) => {
        const reference = parameter.nodeReference;
        if (reference === undefined) return false;
        return elementIds.has(reference) || screenIds.has(reference);
      });
    });
    return !boundToElement;
  });
  if (unbound.length > 0) {
    findings.push(
      finding(
        'blocker',
        `${unbound.length} flow(s) will NOT be in the exported app`,
        'These flows have no trigger bound to a screen or element, so the exporter drops ' +
          'them — they run in the preview and are absent from the binary: ' +
          `${unbound.map((f) => f.name).join(', ')}. ` +
          "Bind each one's trigger to a button or screen.",
      ),
    );
  }

  // 2. Blocks with no native implementation.
  const previewOnly: string[] = [];
  for (const flow of flows) {
    for (const block of flow.blocks) {
      if (previewOnlyBlocks.has(block.type)) previewOnly.push(`${flow.name} → ${block.label}`);
    }
  }
  if (previewOnly.length > 0) {
    findings.push(
      finding(
        'blocker',
        `${previewOnly.length} block(s) have no native implementation`,
        `They do nothing in the exported app: ${previewOnly.join(', ')}.`,
      ),
    );
  }

  // 3. Backend blocks with no backend configured — the screens will say
  //    "secured" while nothing is wired to anything.
  const usesFirebase = flows.some((flow) => flow.blocks.some((b) => b.category === 'Firebase'));
  const supabaseTypes: ReadonlySet<LogicBlockType> = new Set<LogicBlockType>([
    'supabaseSignUp', 'supabaseSignIn', 'supabaseSignOut', 'supabaseCurrentUser',
    'supabaseInsert', 'supabaseQuery', 'supabaseUpdate', 'supabaseDelete',
  ]);
  const usesSupabase = flows.some((flow) => flow.blocks.some((b) => supabaseTypes.has(b.type)));
  const firebaseConfig = project.firebaseConfig;
  if (usesFirebase && !(firebaseConfig !== undefined && firebaseConfigIsConfigured(firebaseConfig))) {
    findings.push(
      finding(
        'blocker',
        'Firebase flows exist, but Firebase is not configured',
        'No project credentials, so no GoogleService-Info.plist can be generated and ' +
          'FirebaseApp.configure() traps at launch. Call set_firebase_config with the ' +
          "Firebase console's projectId / apiKey / appId / messagingSenderId (Project " +
          'settings ▸ your iOS app), then re-export — the plist is then written into the ' +
          'app target for you.',
      ),
    );
  } else if (
    usesFirebase &&
    firebaseConfig !== undefined &&
    (firebaseConfig.apiKey.length === 0 ||
      firebaseConfig.appId.length === 0 ||
      firebaseConfig.messagingSenderId.length === 0)
  ) {
    // A projectId alone passes isConfigured but is NOT enough for a
    // plist — the app would build and then trap on first launch.
    const missing = [
      firebaseConfig.apiKey.length === 0 ? 'apiKey' : undefined,
      firebaseConfig.appId.length === 0 ? 'appId' : undefined,
      firebaseConfig.messagingSenderId.length === 0 ? 'messagingSenderId' : undefined,
    ].filter((v): v is string => v !== undefined);
    findings.push(
      finding(
        'blocker',
        'Firebase credentials are incomplete',
        `Missing ${missing.join(', ')} — set_firebase_config needs all of them before a GoogleService-Info.plist can be written.`,
      ),
    );
  }
  const supabaseConfig = project.supabaseConfig;
  if (usesSupabase && !(supabaseConfig !== undefined && supabaseConfigIsConfigured(supabaseConfig))) {
    findings.push(
      finding(
        'blocker',
        'Supabase flows exist, but Supabase is not configured',
        'Set the project URL and anon key (set_supabase_config), or the auth/data calls fail at runtime.',
      ),
    );
  }

  // 4. Sensor use without the matching permission prompt.
  const sensorBlocks: ReadonlySet<LogicBlockType> = new Set<LogicBlockType>([
    'getLocation', 'readHeartRate', 'readStepCount', 'readMotion',
  ]);
  const usedSensors = flows.flatMap((f) => f.blocks).filter((b) => sensorBlocks.has(b.type));
  if (usedSensors.length > 0) {
    findings.push(
      finding(
        'info',
        `${usedSensors.length} sensor block(s) will read real hardware`,
        'Location uses CLLocation.distance with accuracy/jitter filtering; Health uses HealthKit. The Mac preview shows sample values — only a physical device proves them.',
      ),
    );
  }

  // 5. Screens whose data is hardcoded — "history" that looks real.
  const dataScreens = screens.filter((screen) => {
    const text = allText(screen);
    const looksLikeData = text.some((t) => t.includes('$') || t.includes('km') || t.includes('bpm'));
    const hasBinding = hasAnyBinding(screen);
    return looksLikeData && !hasBinding;
  });
  if (dataScreens.length > 0) {
    findings.push(
      finding(
        'warning',
        `${dataScreens.length} screen(s) show hardcoded data as if it were real`,
        `${dataScreens.map((s) => s.name).join(', ')} display numbers that are baked into the design ` +
          'and never come from a variable or the backend. An honest empty state beats invented user data.',
      ),
    );
  }

  // 6. Apple Watch. SPM cannot produce a watch app BUNDLE — that needs a
  //    watchOS App target in Xcode. The generated workout session and
  //    connectivity code are real and compile, but until that target
  //    exists there is no watch app, only watch code.
  if (project.platformSettings.enabledPlatforms.includes('appleWatch')) {
    findings.push(
      finding(
        'info',
        'Apple Watch: use export_xcode_project for a real watch app',
        'export_xcode_project produces a genuine watchOS App target (WatchWorkoutService — ' +
          'HKWorkoutSession + live heart rate — and PhoneWatchSync) embedded into the iPhone ' +
          'app; both targets build and the watch app runs on a watch. The SwiftPM export ' +
          '(export_ios_source) CANNOT build a watch bundle — there the watch screens only run ' +
          'inside the phone app. Pick the Xcode export to ship the watch.',
      ),
    );
  }

  // 7. Auth without a profile write — an account with no username is not
  //    a user record.
  const hasRegister = flows.some((flow) =>
    flow.blocks.some((b) => b.type === 'firebaseRegister' || b.type === 'supabaseSignUp'),
  );
  const profileWriters: ReadonlySet<LogicBlockType> = new Set<LogicBlockType>([
    'firestoreSetDocument', 'firestoreAddDocument', 'supabaseInsert',
  ]);
  const writesProfile = flows.some((flow) => flow.blocks.some((b) => profileWriters.has(b.type)));
  if (hasRegister && !writesProfile) {
    findings.push(
      finding(
        'warning',
        'Sign-up creates an account but never stores a profile',
        'The auth user only carries an email. Write users/{uid} with the username, or the name the user typed is discarded.',
      ),
    );
  }

  // 8. Permissions asked all at once on launch — the popup ambush that
  //    gets every one of them denied.
  const launchPermissions = flows.filter(
    (flow) =>
      flow.blocks.some((b) => b.type === 'onAppLaunch' || b.type === 'onScreenLoad') &&
      flow.blocks.some((b) => b.type === 'requestPermission'),
  );
  if (launchPermissions.length > 1) {
    findings.push(
      finding(
        'warning',
        `${launchPermissions.length} permission prompts fire on launch`,
        'Asking before the user has seen any value reads as an ambush and is the fastest way ' +
          'to get denied — and iOS only lets you ask once. Use Permissions.requestLocation() / ' +
          'requestNotifications() / requestHealth() at the moment each one buys the user something.',
      ),
    );
  }

  // 9. Node bindings the native export still can't honour.
  let unsupportedBindings = 0;
  function scanBindings(node: DesignNode): void {
    for (const binding of node.logicBindings ?? []) {
      if (bindingKindsWithoutNativeSupport.has(binding.kind)) unsupportedBindings += 1;
    }
    node.children.forEach(scanBindings);
  }
  screens.forEach(scanBindings);
  if (unsupportedBindings > 0) {
    findings.push(
      finding(
        'warning',
        `${unsupportedBindings} binding(s) don't affect the native app`,
        'selectedIndex bindings render on the canvas and in the preview but are dropped in the SwiftUI export — that element won\'t reflect the variable on device.',
      ),
    );
  }

  // 10. Packaging.
  if (project.name.length === 0 || project.name.toLowerCase().includes('untitled')) {
    findings.push(
      finding(
        'warning',
        `Project is still called "${project.name}"`,
        'The bundle identifier and app name are derived from this — set a real product name before shipping.',
      ),
    );
  }

  return findings;
}

/** A blunt verdict a human can act on. */
export function summary(findings: ReadinessFinding[]): string {
  const blockers = findings.filter((f) => f.severity === 'blocker');
  const warnings = findings.filter((f) => f.severity === 'warning');

  const lines: string[] = [];
  if (blockers.length === 0 && warnings.length === 0) {
    lines.push('READY — every flow is bound, every block has a native implementation, and backends are configured.');
  } else if (blockers.length === 0) {
    lines.push(`RUNS, WITH CAVEATS — no blockers, but ${warnings.length} thing(s) are not what they appear.`);
  } else {
    lines.push(`NOT A WORKING APP — ${blockers.length} blocker(s). The screens promise more than the binary can do.`);
  }
  for (const item of findings) {
    const tag = item.severity.toUpperCase();
    lines.push(`\n[${tag}] ${item.title}\n  ${item.detail}`);
  }
  return lines.join('\n');
}

// MARK: - Helpers

function allText(node: DesignNode): string[] {
  const out: string[] = [];
  if (node.text !== undefined) out.push(node.text);
  for (const child of node.children) out.push(...allText(child));
  return out;
}

function hasAnyBinding(node: DesignNode): boolean {
  if (node.logicBindings !== undefined && node.logicBindings.length > 0) return true;
  if (node.repeatBinding !== undefined) return true;
  return node.children.some(hasAnyBinding);
}

/** Static members of the Swift `ExportReadiness` enum. */
export const ExportReadiness = { audit, summary } as const;
