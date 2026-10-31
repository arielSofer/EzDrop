// Ported 1:1 from AgenticDesigner/Services/MCPServerController.swift
// (buildMethodology, makePrompts and the server `instructions` string).
// Pure text, kept server-side so prompts/list + prompts/get and `initialize`
// work even before the editor tab connects.
import type { MCPPromptDefinition } from './MCPServer.js';

// MARK: - Production build methodology
// The discipline that makes an app REAL rather than a mockup, offered to
// every connecting model three ways: server `instructions` (always seen),
// the `build_production_app` MCP prompt (client-surfaced template), and the
// get_build_methodology tool (self-serve fallback / mid-task reference).

export function buildMethodology(
  appName: string = '[APP_NAME]',
  bundleId: string = '[BUNDLE_ID]',
  platforms: string = 'iPhone, appleWatch',
  backend: string = '[Firebase / Supabase]',
  brand: string = '[BRAND / ACCENT]',
  sensors: string = '[location, speed, distance, heart rate]',
  screens: string = '[LIST]',
): string {
  return `You are building a PRODUCTION-oriented app using AgenticDesigner via MCP.

CORE PRINCIPLE: a screen that LOOKS like an app is not an app. Every capability must pass
four layers, and you must prove each: (1) UI exists → (2) UI is bound to state + logic →
(3) logic exports to native code → (4) the exported project builds and runs.

HARD CONSTRAINTS
1. Make all product/design/logic changes ONLY through AgenticDesigner MCP tools.
2. Do NOT hand-edit generated Swift, JSON, pbxproj, Info.plist or exported source.
3. Shell tools are for READ-ONLY inspection, build, install, launch, simulator verification.
4. Never declare success from a mockup, preview, or an "Applied successfully" message.
5. Preserve the existing design unless a change is required for functionality.
6. Never hide a blocker. Always separate: implemented logic / compiled functionality /
   simulator-verified / physical-device-only / missing external credentials.

PRODUCT INPUTS
App name: ${appName}   Bundle id: ${bundleId}   Platforms: ${platforms}
Brand: ${brand}   Backend: ${backend}   Sensors: ${sensors}   Screens: ${screens}

PHASE 1 — ORIENT: load newest project; get_project_overview; read design tree, flows,
variables, platforms; DISCOVER the current MCP tool list (don't trust an older schema);
checkpoint before destructive changes. Identify fake data, hardcoded metrics, unbound
inputs, unbound triggers, missing permissions, missing platform routing, backend calls
with no user identity.

PHASE 2 — STATE MODEL: explicit variables for auth fields, current-user UID, sensor
readings, derived metrics, alert thresholds, alert-dedup flags, query results. Every input
field gets a two-way binding; every output text reads the right variable; sensitive
variables are detected and EXCLUDED from persistence.

PHASE 3 — AUTH + PERSISTENCE: call wire_backend first — one deterministic pass gives you the
launch gate, log in, sign up + users/{uid} profile write, log out, password reset, and
per-user Firestore read/write of the main entity (it creates Log In / Sign Up screens only if
the design lacks them). Then set_firebase_config with projectId + apiKey + appId +
messagingSenderId so the export can write GoogleService-Info.plist. Extend by hand from
there (email/password validation before the call, confirm-password, provider buttons). VERIFY
the generated backend calls read state variables, not empty literals or unresolved node
references (a common trap), and that the UID — not the email — keys every document.

PHASE 4 — SENSORS: Start → request permission → start NATIVE continuous tracking →
distanceMeters/speedKmh. Derive km, pace, average. Delete fake timer/GPS math. Finish →
stop → summarize → save users/{uid}/runs → Summary.

PHASE 5 — ALERTS: per alert = threshold variable + condition + a boolean that blocks repeat
firing each tick + reset at session start + in-app alert/haptic/notification.

PHASE 6 — APPLE WATCH: enable appleWatch; on launch route watchOS to the Watch screen via a
Platform condition (both targets otherwise start on the same screen). Workout = Health +
Location permission → native GPS → HKWorkoutSession → heart rate → sync via
WatchConnectivity → end + save. A responsive iPhone screen is NOT a watch app; require a
real embedded watchOS target in the Xcode export.

PHASE 7 — SECURITY: password/passcode/PIN/token inputs export as SecureField; sensitive
variables absent from persisted snapshots; UID captured before Firestore writes; Firestore
paths user-scoped; permissions progressive; no fake private/history data; security rules
generated (and need deployment).

PHASE 8 — IDENTITY: via MCP set product name, bundle id, platforms; preserve brand; generate
AppIcon assets.

PHASE 9 — TRUTH CHECK: run check_export_readiness; resolve every code-level blocker via MCP;
do NOT suppress or reinterpret blockers. GoogleService-Info.plist is NOT an external blocker
any more — it is generated from set_firebase_config, so missing credentials are yours to fix.
Expected EXTERNAL blockers: signing team, console-side sign-in methods + rules deployment,
push server, billing, physical-device sensor testing.

PHASE 10 — EXPORT & BUILD: use export_xcode_project (not only SwiftPM). Verify the .xcodeproj,
iOS target, embedded watchOS target, bundle ids, AppIcon, and Firebase deps/bootstrap when
enabled. Run a clean xcodebuild WITHOUT disabling AppIcon requirements. Do not patch
generated source to make the build pass.

PHASE 11 — RUNTIME: install + launch iPhone app in an iOS simulator and the Watch app in a
watchOS simulator; verify each starts on the intended screen; screenshot; check for crashes.

FINAL REPORT (separate, honest): 1) implemented via MCP, 2) cleanly compiled, 3) launched,
4) verified only by artifact inspection, 5) needs credentials/devices, 6) exact paths to the
.agenticdesign project and the .xcodeproj. Never call the app production-ready while a real
blocker remains.

THE ONE SENTENCE: don't prove the screen looks right; prove the action travels from UI,
through state and logic, to native code, to a running binary.`;
}

export function makePrompts(): MCPPromptDefinition[] {
  return [
    {
      name: 'build_production_app',
      description:
        'The AgenticDesigner method for building a REAL, verified app (not a mockup): four-layer product-truth discipline + an 11-phase plan (orient, state, auth, sensors, alerts, watch, security, identity, truth-check, export/build, runtime).',
      arguments: [
        { name: 'app_name', description: 'Product name, e.g. PaceGuard.', required: false },
        { name: 'bundle_id', description: 'Reverse-DNS bundle id, e.g. com.acme.paceguard.', required: false },
        { name: 'platforms', description: 'e.g. iPhone, appleWatch.', required: false },
        { name: 'backend', description: 'Firebase or Supabase.', required: false },
        { name: 'brand', description: 'Brand name / accent hex.', required: false },
        { name: 'sensors', description: 'e.g. location, speed, distance, heart rate.', required: false },
        { name: 'screens', description: 'Required screens, comma-separated.', required: false },
      ],
      build: (args) =>
        buildMethodology(
          args['app_name'] ?? '[APP_NAME]',
          args['bundle_id'] ?? '[BUNDLE_ID]',
          args['platforms'] ?? 'iPhone, appleWatch',
          args['backend'] ?? '[Firebase / Supabase]',
          args['brand'] ?? '[BRAND / ACCENT]',
          args['sensors'] ?? '[location, speed, distance, heart rate]',
          args['screens'] ?? '[LIST]',
        ),
    },
  ];
}

/// MCPServer.Configuration.instructions — verbatim from MCPServerController.start().
export const serverInstructions =
  'AgenticDesigner is a macOS visual app-design tool with a logic block editor AND a real iOS/watchOS exporter.\n' +
  '\n' +
  'DESIGN: get_project_overview → get_design_tree (node ids) → apply_design_actions (applies your x/y exactly; createImage with an imagePrompt generates real AI images). Or delegate: run_design_agent / build_full_app runs the full pipeline from a brief. Call get_screenshot after changes.\n' +
  '\n' +
  "ACCOUNTS + DATA: build_full_app already wires a real backend (Firebase Auth sign-up / log-in / launch gate, a users/{uid} profile document, and per-user Firestore read+write of the app's main entity, with matching security rules). On a design that doesn't have it yet, call wire_backend — deterministic, no AI call. Then set_firebase_config with the Firebase console's projectId / apiKey / appId / messagingSenderId: that is what lets export_xcode_project generate a working GoogleService-Info.plist. Without those four the exported app builds and then traps on launch, so treat them as part of the build, not an afterthought.\n" +
  '\n' +
  'PRODUCT-TRUTH DISCIPLINE — how work is judged here: a screen that LOOKS like an app is NOT an app. Every capability must pass four layers: (1) UI exists, (2) UI is bound to state + logic, (3) logic exports to native code, (4) the exported project builds and runs. Never declare done from a mockup, a preview, or an "Applied successfully" message. After changes, verify: read flows/bindings back, run check_export_readiness (the truth check — resolve every code-level blocker, never hide one), export with export_xcode_project, then build and launch. Always separate what is: implemented / compiled / simulator-verified / needs a device or credentials.\n' +
  '\n' +
  'For the full production build method, invoke the `build_production_app` prompt or call the get_build_methodology tool.';
