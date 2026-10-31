// Ported 1:1 from AgenticDesigner/Services/BackendWiringGenerator.swift
//
// The missing third of "one prompt → a working app": an ACCOUNT and REAL
// PERSISTENCE. The design pass produced screens, the logic pass made them
// navigable — but nothing ever created a sign-in screen, wired Firebase
// Auth to it, or saved a single document. The prompt said "with login and
// saved data" and the build quietly skipped it.
//
// Deterministic, like ComposedLogicGenerator: no model call, so it can
// never return empty on a small local model. It:
//   1. turns Firebase on and declares the project's Firestore schema
//      (from BackendBlueprint — per app category);
//   2. creates Log In / Sign Up screens if the design has none, with REAL
//      .Input nodes bound to variables (a decorative "input field" component
//      cannot be typed into, so an auth screen made of them can never work);
//   3. wires the whole account lifecycle: launch gate, log in, sign up +
//      profile document, log out, password reset;
//   4. wires persistence for the app's primary entity: create-on-tap and
//      load-on-screen-appear, both scoped to the signed-in user — which is
//      also exactly what the generated security rules require.

import { LogicAgentTranslator } from '../agent/LogicAgentPromptBuilder';
import { BlockCatalog } from '../models/BlockDefinitions';
import {
  makeDesignNode,
  makeNodeLogicBinding,
  makeNodeStyle,
  type DesignNode,
} from '../models/DesignNode';
import type { DesignProject } from '../models/DesignProject';
import { makeFirebaseConfig, type FirebaseConfig } from '../models/FirebaseConfig';
import {
  makeBlockConnection,
  makeLogicFlow,
  makeLogicVariable,
  type BlockConnection,
  type LogicBlock,
  type LogicBlockType,
  type LogicFlow,
  type VariableType,
} from '../models/LogicModels';
import { newUUID } from '../models/uuid';
import type { LogicViewModel } from '../viewModels/LogicViewModel';
import {
  backendBlueprintCollections,
  infer as inferBlueprint,
  type BackendBlueprint,
  type BackendBlueprintEntity,
} from './BackendBlueprint';
import type { BackendDesignHost } from './themeHosts';

// Variable names the auth inputs bind to. Fixed and shared so the login
// and sign-up screens write into the same session fields.
export const emailVariable = 'authEmail';
export const passwordVariable = 'authPassword';
export const passwordConfirmVariable = 'authPasswordConfirm';
export const nameVariable = 'authDisplayName';
export const uidVariable = 'currentUserId';
export const profileVariable = 'profile';

/** `BackendWiringGenerator.Result` */
export interface BackendWiringResult {
  configured: boolean;
  createdScreens: string[];
  flowNames: string[];
  collections: string[];
  boundInputs: number;
  notes: string[];
}

export function makeBackendWiringResult(): BackendWiringResult {
  return { configured: false, createdScreens: [], flowNames: [], collections: [], boundInputs: 0, notes: [] };
}

/** `Result.isEmpty` */
export function backendWiringResultIsEmpty(result: BackendWiringResult): boolean {
  return result.flowNames.length === 0 && result.createdScreens.length === 0;
}

/** `CGSize(width: 390, height: 844)` */
export const screenSize = { width: 390, height: 844 };

// MARK: - Swift collection helpers (ties keep the FIRST element, as Swift does)

function maxBy<T>(items: T[], isLess: (a: T, b: T) => boolean): T | undefined {
  if (items.length === 0) return undefined;
  let result: T = items[0] as T;
  for (const item of items.slice(1)) if (isLess(result, item)) result = item;
  return result;
}

/** Swift `String.capitalizedFirst` (the private extension at the bottom of the file). */
export function capitalizedFirst(text: string): string {
  const first = [...text][0];
  if (first === undefined) return text;
  return first.toUpperCase() + text.slice(first.length);
}

// MARK: - Entry point

/** `BackendWiringGenerator.wire(prompt:design:logic:blueprint:)` */
export function wire(
  prompt: string,
  design: BackendDesignHost,
  logic: LogicViewModel,
  providedBlueprint?: BackendBlueprint,
): BackendWiringResult {
  const result = makeBackendWiringResult();
  const blueprint = providedBlueprint ?? inferBlueprint(prompt);

  // Without attach() the flows land in the view model but never reach the
  // page — the app looks wired and exports nothing.
  logic.attach(design);

  const pageIndex = design.currentPageIndex;
  if (!(pageIndex >= 0 && pageIndex < design.project.pages.length)) return result;

  // 1 — Project configuration: Firebase on, schema declared.
  const collections = backendBlueprintCollections(blueprint);
  design.mutateProject((project) => {
    const config: FirebaseConfig = { ...(project.firebaseConfig ?? makeFirebaseConfig()) };
    config.isEnabled = true;
    config.enableEmailAuth = true;
    config.defaultCollections = collections;
    config.publicReadCollections = blueprint.publicReadCollections;
    project.firebaseConfig = config;
  });
  result.configured = true;
  result.collections = collections.map((c) => c.name);

  // 2 — Session variables. currentUserId is a reserved name the
  // exporters already resolve {{uid}} against.
  declare(emailVariable, 'string', design);
  declare(passwordVariable, 'string', design);
  declare(passwordConfirmVariable, 'string', design);
  declare(nameVariable, 'string', design);
  declare(uidVariable, 'string', design);
  declare(profileVariable, 'json', design, '{}');
  declare(blueprint.primary.listVariable, 'json', design, '[]');

  // 3 — Screens. Auth screens are created only when the design has none,
  // so a model that already drew a beautiful login keeps it.
  const palette = new Palette(design.project, pageIndex);
  let loginScreen = findScreen(design, pageIndex, loginKeywords);
  let signUpScreen = findScreen(design, pageIndex, signUpKeywords);
  const homeScreen = findHomeScreen(design, pageIndex);

  if (loginScreen === undefined) {
    const frameNode = makeLoginScreen(palette, nextFrameX(design, pageIndex, 0));
    // Inserted FIRST so the exported app starts at the sign-in wall —
    // the generated app's initial screen is the page's first frame.
    design.mutateProject((project) => {
      project.pages[pageIndex]!.nodes.splice(0, 0, frameNode);
    });
    loginScreen = frameNode;
    result.createdScreens.push(frameNode.name);
    result.notes.push("Log In is now the app's first screen.");
  }
  if (signUpScreen === undefined) {
    const frameNode = makeSignUpScreen(palette, nextFrameX(design, pageIndex, 1));
    design.mutateProject((project) => {
      project.pages[pageIndex]!.nodes.splice(1, 0, frameNode);
    });
    signUpScreen = frameNode;
    result.createdScreens.push(frameNode.name);
  }

  // 4 — Bind whatever auth inputs exist (ours or the model's) to the
  // session variables, and mark password fields secure.
  for (const screen of [loginScreen, signUpScreen].filter((s): s is DesignNode => s !== undefined)) {
    result.boundInputs += bindAuthInputs(screen.id, design, pageIndex);
  }

  // Re-read: binding mutated the tree, and the flow builders need the
  // current node ids/names.
  const login = reload(loginScreen, design, pageIndex);
  const signUp = reload(signUpScreen, design, pageIndex);
  const home = reload(homeScreen, design, pageIndex);

  // 5 — Flows. Re-running this (build_full_app already wires a backend,
  // and an agent will reasonably call wire_backend again afterwards) must
  // REPLACE the previous pass, not stack a second copy of every auth flow
  // on the same buttons — two Sign Up flows on one button would register
  // twice and race.
  for (const stale of [...logic.flows]) {
    if (isGeneratedBackendFlow(stale)) logic.deleteFlow(stale.id);
  }

  const flows: LogicFlow[] = [];
  const existingNames = new Set(logic.flows.map((f) => f.name));

  {
    const flow = authGateFlow(home, login);
    if (flow) flows.push(flow);
  }
  if (login) {
    const flow = logInFlow(login, home);
    if (flow) flows.push(flow);
    if (signUp) {
      const link = linkFlow('Go to Sign Up', login, signUp, [
        'sign up', 'signup', 'register', 'create account', 'create an account', 'join', 'הרשמה', 'הרשמו',
      ]);
      if (link) flows.push(link);
    }
    const reset = resetPasswordFlow(login);
    if (reset) flows.push(reset);
  }
  if (signUp) {
    const flow = signUpFlow(signUp, home);
    if (flow) flows.push(flow);
    if (login) {
      const link = linkFlow('Go to Log In', signUp, login, [
        'log in', 'login', 'sign in', 'signin', 'already have', 'התחברות', 'התחבר',
      ]);
      if (link) flows.push(link);
    }
  }
  if (login) {
    const flow = logOutFlow(design, pageIndex, login);
    if (flow) flows.push(flow);
  }
  {
    const excluded = [login?.id, signUp?.id].filter((id): id is string => id !== undefined);
    const flow = loadProfileFlow(design, pageIndex, excluded);
    if (flow) flows.push(flow);
  }

  // Persistence for the app's primary entity.
  const persistence = persistenceFlows(
    blueprint,
    design,
    pageIndex,
    home,
    [login?.id, signUp?.id].filter((id): id is string => id !== undefined),
    logic,
  );
  flows.push(...persistence.flows);
  result.notes.push(...persistence.notes);

  // Never collide with a flow the logic pass already made.
  for (const flow of flows) {
    if (existingNames.has(flow.name)) flow.name += ' (Backend)';
  }

  if (flows.length === 0) return result;
  logic.applyGenerated(flows);
  result.flowNames = flows.map((f) => f.name);
  return result;
}

/**
 * A flow this generator produced on an earlier run: one of its fixed
 * names, and it actually calls the backend. The block check keeps a
 * hand-written flow that merely shares a name ("Log In" that only
 * navigates) from being deleted.
 */
function isGeneratedBackendFlow(flow: LogicFlow): boolean {
  const base = flow.name.split(' (Backend)').join('');
  const fixedNames = new Set([
    'Auth Gate', 'Log In', 'Sign Up', 'Log Out', 'Reset Password',
    'Go to Sign Up', 'Go to Log In',
  ]);
  // "Open New X"/"Close New X" are deliberately NOT deletable: they are
  // wired to the synthesized form's stable node ids, and the form is
  // only synthesized once — deleting them on a re-run would leave the
  // "+" and Back buttons dead with nothing recreating their flows.
  const isFixed = fixedNames.has(base) || base.startsWith('Load ') || base.startsWith('Save ');
  if (!isFixed) return false;
  if (flow.blocks.some((b) => b.category === 'Firebase')) return true;
  // The two link flows carry no backend block at all — a bare
  // onTap → navigate pair under one of our names is still ours.
  return (
    (base === 'Go to Sign Up' || base === 'Go to Log In') &&
    flow.blocks.length === 2 &&
    flow.blocks.some((b) => b.type === 'navigate')
  );
}

// MARK: - Screen discovery

const loginKeywords = ['log in', 'login', 'logon', 'sign in', 'signin', 'התחברות', 'כניסה'];
const signUpKeywords = ['sign up', 'signup', 'register', 'create account', 'הרשמה', 'רישום'];
const nonHomeKeywords = [
  'log in', 'login', 'sign in', 'signin', 'sign up', 'signup',
  'register', 'onboard', 'splash', 'welcome', 'paywall',
  'subscribe', 'התחברות', 'הרשמה', 'פתיחה',
];

function frames(design: BackendDesignHost, pageIndex: number): DesignNode[] {
  return design.project.pages[pageIndex]!.nodes.filter((n) => n.type === 'Frame');
}

function findScreen(design: BackendDesignHost, pageIndex: number, keywords: string[]): DesignNode | undefined {
  return frames(design, pageIndex).find((frameNode) => {
    const name = frameNode.name.toLowerCase();
    return keywords.some((k) => name.includes(k));
  });
}

/**
 * The screen a signed-in user lands on: the one named like a home, else
 * the first screen that is not an auth/onboarding/paywall detour.
 */
function findHomeScreen(design: BackendDesignHost, pageIndex: number): DesignNode | undefined {
  const all = frames(design, pageIndex);
  const preferred = ['home', 'feed', 'dashboard', 'discover', 'today', 'overview', 'בית', 'ראשי'];
  const match = all.find((frameNode) => {
    const name = frameNode.name.toLowerCase();
    return preferred.some((p) => name.includes(p));
  });
  if (match) return match;
  return all.find((frameNode) => {
    const name = frameNode.name.toLowerCase();
    return !nonHomeKeywords.some((k) => name.includes(k));
  });
}

function reload(screen: DesignNode | undefined, design: BackendDesignHost, pageIndex: number): DesignNode | undefined {
  if (screen === undefined) return undefined;
  return design.project.pages[pageIndex]!.nodes.find((n) => n.id === screen.id) ?? screen;
}

function nextFrameX(design: BackendDesignHost, pageIndex: number, index: number): number {
  const existing = frames(design, pageIndex);
  const xs = existing.map((f) => f.x);
  const minX = xs.length === 0 ? 100 : Math.min(...xs);
  // To the LEFT of the existing app, in creation order, so the canvas
  // reads left-to-right: Log In, Sign Up, then the app.
  return minX - (2 - index) * (screenSize.width + 60);
}

// MARK: - Variables

function declare(
  name: string,
  type: VariableType,
  design: BackendDesignHost,
  defaultValue?: string,
): void {
  if (design.project.globalVariables.some((v) => v.name === name)) return;
  design.mutateProject((project) => {
    project.globalVariables.push(
      makeLogicVariable({ name, type, defaultValue, scope: 'global' }),
    );
  });
}

// MARK: - Input binding

/**
 * Binds every text input on an auth screen to the session variable its
 * name implies, and marks password fields secure. Returns how many were
 * bound. An unbound input is a field whose typed text nothing can read —
 * the single most common reason a generated login "does nothing".
 */
function bindAuthInputs(screenId: string, design: BackendDesignHost, pageIndex: number): number {
  let bound = 0;

  function variableFor(node: DesignNode): string | undefined {
    const haystack = [node.name, node.text, node.children[0]?.text]
      .filter((s): s is string => s !== undefined && s !== null)
      .join(' ')
      .toLowerCase();
    // Confirm-password BEFORE password — its name contains "password"
    // too, and binding both fields to the same variable makes the
    // match check compare a value with itself (always true).
    if (
      haystack.includes('confirm') || haystack.includes('again') || haystack.includes('repeat') ||
      haystack.includes('אימות') || haystack.includes('שוב')
    ) {
      return haystack.includes('password') || haystack.includes('סיסמ') ? passwordConfirmVariable : undefined;
    }
    if (haystack.includes('password') || haystack.includes('סיסמ') || haystack.includes('passcode')) {
      return passwordVariable;
    }
    if (
      haystack.includes('email') || haystack.includes('e-mail') || haystack.includes('mail') ||
      haystack.includes('אימייל') || haystack.includes('מייל')
    ) {
      return emailVariable;
    }
    if (haystack.includes('name') || haystack.includes('username') || haystack.includes('שם')) {
      return nameVariable;
    }
    return undefined;
  }

  function walk(nodes: DesignNode[]): void {
    for (const node of nodes) {
      if (node.type === 'Input') {
        const name = variableFor(node);
        if (name !== undefined) {
          const hasBinding = (node.logicBindings ?? []).some((b) => b.kind === 'value' || b.kind === 'text');
          if (!hasBinding) {
            const bindings = node.logicBindings ?? [];
            bindings.push(makeNodeLogicBinding({ kind: 'value', variableName: name }));
            node.logicBindings = bindings;
            bound += 1;
          }
          if (name === passwordVariable) node.isSecure = true;
        }
      }
      walk(node.children);
    }
  }

  design.mutateProject((project) => {
    const screen = project.pages[pageIndex]!.nodes.find((n) => n.id === screenId);
    if (screen === undefined) return;
    walk(screen.children);
  });
  return bound;
}

// MARK: - Flow builders

/**
 * App launch → already signed in? go to the app. Otherwise stay on / go
 * to Log In. Without this the user is thrown back to the login screen on
 * every cold start even though the Firebase session is still valid.
 */
function authGateFlow(home: DesignNode | undefined, login: DesignNode | undefined): LogicFlow | undefined {
  if (home === undefined && login === undefined) return undefined;
  const builder = new FlowBuilder('Auth Gate', 'onAppLaunch');
  if (!builder.isValid) return undefined;
  const check = builder.append('firebaseGetCurrentUser', { variables: { variable: uidVariable } });
  if (home) builder.append('navigate', { from: [check, 0], screens: { screen: home.id } });
  if (login) builder.append('navigate', { from: [check, 1], screens: { screen: login.id } });
  return builder.flow(undefined);
}

function logInFlow(screen: DesignNode, home: DesignNode | undefined): LogicFlow | undefined {
  const button = primaryButton(
    screen,
    ['log in', 'login', 'sign in', 'signin', 'continue', 'התחבר', 'התחברות', 'כניסה'],
    ['sign up', 'signup', 'register', 'forgot', 'google', 'apple', 'facebook', 'back', 'skip'],
  );
  if (button === undefined) return undefined;

  const builder = new FlowBuilder('Log In', 'onTap', button.id);
  if (!builder.isValid) return undefined;
  const inputs = textInputs(screen);
  const emailNode = inputs.find((n) => boundVariable(n) === emailVariable);
  const passwordNode = inputs.find((n) => boundVariable(n) === passwordVariable);

  // Validate BEFORE the network call: a malformed email should never
  // cost a round-trip, and Firebase's own error copy is developer-speak.
  if (emailNode) {
    const check = builder.append('validateForm', { values: { rule: 'email' }, nodes: { element: emailNode.id } });
    builder.append('showAlert', {
      from: [check, 1],
      values: {
        title: 'Check your email address',
        message: "That doesn't look like a valid email.",
      },
    });
  }

  const loginNodes: Record<string, string> = {};
  if (emailNode) loginNodes['email'] = emailNode.id;
  if (passwordNode) loginNodes['password'] = passwordNode.id;
  const login = builder.append('firebaseLogin', { nodes: loginNodes });
  const store = builder.append('firebaseGetCurrentUser', {
    from: [login, 0],
    variables: { variable: uidVariable },
  });
  if (home) {
    builder.append('navigate', { from: [store, 0], screens: { screen: home.id } });
    builder.append('navigate', { from: [store, 1], screens: { screen: home.id } });
  }
  builder.append('showAlert', {
    from: [login, 1],
    values: {
      title: "Couldn't sign in",
      message: 'Check your email and password, then try again.',
    },
  });
  return builder.flow(screen.id);
}

/**
 * Sign up, then WRITE THE PROFILE. The auth user carries only an email —
 * everything the app shows about "me" lives in users/{uid}, so an account
 * created without this document is an account with no profile.
 */
function signUpFlow(screen: DesignNode, home: DesignNode | undefined): LogicFlow | undefined {
  const button = primaryButton(
    screen,
    ['sign up', 'signup', 'create account', 'create an account', 'register', 'get started', 'הרשמה', 'הרשם'],
    ['log in', 'login', 'sign in', 'already', 'google', 'apple', 'facebook', 'back', 'skip'],
  );
  if (button === undefined) return undefined;

  const builder = new FlowBuilder('Sign Up', 'onTap', button.id);
  if (!builder.isValid) return undefined;
  const inputs = textInputs(screen);
  const emailNode = inputs.find((n) => boundVariable(n) === emailVariable);
  const passwordNode = inputs.find((n) => boundVariable(n) === passwordVariable);
  const hasName = inputs.some((n) => boundVariable(n) === nameVariable);
  const hasConfirm = inputs.some((n) => boundVariable(n) === passwordConfirmVariable);

  // Client-side validation, in the order the user reads the form. Each
  // failure alerts in plain language and never leaves the device —
  // Firebase's raw errors ("The supplied auth credential…") are not
  // sign-up copy a professional app shows.
  if (emailNode) {
    const check = builder.append('validateForm', { values: { rule: 'email' }, nodes: { element: emailNode.id } });
    builder.append('showAlert', {
      from: [check, 1],
      values: {
        title: 'Check your email address',
        message: "That doesn't look like a valid email.",
      },
    });
  }
  if (passwordNode) {
    const check = builder.append('validateForm', {
      values: { rule: 'minLength', argument: '6' },
      nodes: { element: passwordNode.id },
    });
    builder.append('showAlert', {
      from: [check, 1],
      values: { title: 'Password too short', message: 'Use at least 6 characters.' },
    });
  }
  if (hasConfirm) {
    const match = builder.append('ifCondition', {
      values: { operator: '==', rightValue: `{{${passwordConfirmVariable}}}` },
      variables: { leftValue: passwordVariable },
    });
    builder.append('showAlert', {
      from: [match, 1],
      values: {
        title: "Passwords don't match",
        message: 'Re-type the confirmation so both fields agree.',
      },
    });
  }

  const registerNodes: Record<string, string> = {};
  if (emailNode) registerNodes['email'] = emailNode.id;
  if (passwordNode) registerNodes['password'] = passwordNode.id;
  const register = builder.append('firebaseRegister', { nodes: registerNodes });
  const uid = builder.append('firebaseGetCurrentUser', {
    from: [register, 0],
    variables: { variable: uidVariable },
  });
  let profileData = `email={{${emailVariable}}}\ncreatedAt={{now}}`;
  if (hasName) profileData = `displayName={{${nameVariable}}}\n` + profileData;
  const profile = builder.append('firestoreSetDocument', {
    from: [uid, 0],
    values: { collection: 'users', documentId: '{{uid}}', data: profileData },
  });
  if (home) builder.append('navigate', { from: [profile, 0], screens: { screen: home.id } });
  builder.append('showAlert', {
    from: [profile, 1],
    values: {
      title: 'Account created',
      message: "We couldn't save your profile yet — you can finish it from Settings.",
    },
  });
  builder.append('showAlert', {
    from: [register, 1],
    values: {
      title: "Couldn't create your account",
      message: 'That email may already be in use, or the password is too short (6+ characters).',
    },
  });
  return builder.flow(screen.id);
}

function resetPasswordFlow(screen: DesignNode): LogicFlow | undefined {
  const link = tappable(screen, ['forgot', 'reset password', 'שכחתי', 'איפוס סיסמה'], []);
  if (link === undefined) return undefined;
  const builder = new FlowBuilder('Reset Password', 'onTap', link.id);
  if (!builder.isValid) return undefined;
  const emailNode = textInputs(screen).find((n) => boundVariable(n) === emailVariable);
  const reset = builder.append('firebaseResetPassword', {
    nodes: emailNode ? { email: emailNode.id } : {},
  });
  builder.append('showToast', {
    from: [reset, 0],
    values: { message: 'Reset link sent — check your inbox.' },
  });
  builder.append('showAlert', {
    from: [reset, 1],
    values: {
      title: "Couldn't send the reset link",
      message: 'Enter the email you signed up with and try again.',
    },
  });
  return builder.flow(screen.id);
}

/** Log out from wherever the design put it (profile, settings, a menu). */
function logOutFlow(design: BackendDesignHost, pageIndex: number, login: DesignNode): LogicFlow | undefined {
  for (const screen of frames(design, pageIndex)) {
    if (screen.id === login.id) continue;
    const control = tappable(
      screen,
      ['log out', 'logout', 'sign out', 'signout', 'התנתק', 'התנתקות', 'יציאה'],
      [],
    );
    if (control === undefined) continue;
    const builder = new FlowBuilder('Log Out', 'onTap', control.id);
    if (!builder.isValid) return undefined;
    // Confirm first — sign-out is cheap to undo but jarring to hit by
    // accident, and every professional app gates it.
    const confirm = builder.append('confirmDialog', {
      values: {
        title: 'Sign out?',
        message: 'You can sign back in anytime.',
        confirmLabel: 'Sign Out',
        cancelLabel: 'Cancel',
      },
    });
    const logout = builder.append('firebaseLogout', { from: [confirm, 0] });
    builder.append('navigate', { from: [logout, 0], screens: { screen: login.id } });
    builder.append('showAlert', { from: [logout, 1], values: { title: "Couldn't sign out" } });
    return builder.flow(screen.id);
  }
  return undefined;
}

/**
 * The users/{uid} profile is written at sign-up and was never read back —
 * so profile screens showed the design's hardcoded persona forever. This
 * loads it whenever a profile/settings/account screen appears, into the
 * shared `profile` variable ({{profile.displayName}} etc.).
 */
function loadProfileFlow(
  design: BackendDesignHost,
  pageIndex: number,
  excluded: string[],
): LogicFlow | undefined {
  const profileScreen = frames(design, pageIndex).find((frameNode) => {
    if (excluded.includes(frameNode.id)) return false;
    const name = frameNode.name.toLowerCase();
    return ['profile', 'account', 'settings', 'me', 'פרופיל', 'חשבון', 'הגדרות'].some(
      (key) => name === key || name.includes(key),
    );
  });
  if (profileScreen === undefined) return undefined;
  const builder = new FlowBuilder('Load Profile', 'onScreenLoad');
  if (!builder.isValid) return undefined;
  builder.append('firestoreGetDocument', {
    values: { path: 'users/{{uid}}' },
    variables: { variable: profileVariable },
  });
  // Error branch intentionally silent: a missing profile document is
  // normal for a guest and not worth an alert on screen entry.
  return builder.flow(profileScreen.id);
}

// MARK: - Persistence

function persistenceFlows(
  blueprint: BackendBlueprint,
  design: BackendDesignHost,
  pageIndex: number,
  home: DesignNode | undefined,
  authScreenIds: string[],
  logic: LogicViewModel,
): { flows: LogicFlow[]; notes: string[] } {
  const flows: LogicFlow[] = [];
  const notes: string[] = [];
  const entity = blueprint.primary;

  // Load: the list screen's appearance queries the user's own documents.
  // The where-clause is not an optimisation — the generated rules only
  // allow reads of documents carrying your uid, so an unscoped query is
  // denied at runtime.
  if (home) {
    const builder = new FlowBuilder(`Load ${entity.label}s`, 'onScreenLoad');
    if (builder.isValid) {
      const query = builder.append('firestoreQuery', {
        values: {
          collection: entity.collection,
          where: 'userId == {{uid}}',
          orderBy: 'createdAt desc',
          limit: '50',
        },
        variables: { variable: entity.listVariable },
      });
      builder.append('showAlert', {
        from: [query, 1],
        values: {
          title: `Couldn't load your ${entity.label.toLowerCase()}s`,
          message: 'Check your connection and reopen this screen.',
        },
      });
      const flow = builder.flow(home.id);
      if (flow) flows.push(flow);
    }
  }

  // Save: the first create-shaped CTA outside the auth screens. When the
  // design has NONE — which was true for most generated apps — synthesize
  // the whole write path: a "New <Entity>" form screen with real inputs,
  // a "+" button on the list screen to reach it, and a Back control.
  // An app that can read its collection but never write to it isn't an
  // app with persistence; it's a viewer for a database nobody fills.
  let createAnchor = createControl(design, pageIndex, authScreenIds);
  if (createAnchor === undefined) {
    const created = synthesizeCreateScreen(entity, design, pageIndex, home);
    if (created) {
      createAnchor = { screen: created.screen, button: created.saveButton };
      flows.push(...created.flows);
      notes.push(
        `Created a '${created.screen.name}' form screen (+ button on ${home?.name ?? 'the list screen'} opens it).`,
      );
    }
  }
  if (createAnchor) {
    const { screen, button } = createAnchor;
    const builder = new FlowBuilder(`Save ${entity.label}`, 'onTap', button.id);
    if (builder.isValid) {
      const inputs = textInputs(screen);
      let data = 'userId={{uid}}\ncreatedAt={{now}}';
      let used = 0;
      for (const field of entity.fields) {
        if (!(used < inputs.length)) break;
        // Only fields a real input on this screen can fill —
        // inventing values would write junk documents.
        const input = matchingInput(field.name, inputs, used);
        if (input === undefined) continue;
        const variable =
          boundVariable(input) ??
          bindDraft(input, field.name, entity, design, pageIndex, screen.id);
        if (variable === undefined) continue;
        data += `\n${field.name}={{${variable}}}`;
        used += 1;
      }
      const save = builder.append('firestoreAddDocument', {
        values: { collection: entity.collection, data },
      });
      builder.append('showToast', { from: [save, 0], values: { message: `${entity.label} saved` } });
      // Re-read after the write, so the list shows what was just
      // saved instead of going stale until the next cold start.
      builder.append('firestoreQuery', {
        values: {
          collection: entity.collection,
          where: 'userId == {{uid}}',
          orderBy: 'createdAt desc',
          limit: '50',
        },
        variables: { variable: entity.listVariable },
      });
      // A dedicated form screen pops back to the list after saving;
      // an inline save button (a FAB on the list itself) must not.
      if (screen.id !== home?.id) builder.append('goBack', {});
      builder.append('showAlert', {
        from: [save, 1],
        values: {
          title: "Couldn't save",
          message: `Your ${entity.label.toLowerCase()} stayed on this device. Try again.`,
        },
      });
      const flow = builder.flow(screen.id);
      if (flow) flows.push(flow);
    }
  } else {
    notes.push(
      'No create/save button found and no list screen to anchor a form to — added the read path only.',
    );
  }

  // Show it: bind a repeatable row/card to the query result so saved
  // documents actually appear instead of the designed placeholder.
  const titleCandidates = ['title', 'name', 'symbol', 'metric', 'mood', 'destination', 'body'];
  const titleFieldName =
    entity.fields.find((f) => titleCandidates.includes(f.name))?.name ?? entity.fields[0]?.name;
  const alreadyBound = home
    ? descendants(home).some((n) => n.repeatBinding?.sourceVariable === entity.listVariable)
    : false;
  if (alreadyBound) {
    // A previous run already bound this list. Binding "the next card
    // too" on every re-run turned a whole storefront into repeats of
    // one collection.
  } else {
    const listScreen = home;
    const template = listScreen ? repeatTemplate(listScreen, entity) : undefined;
    if (listScreen && template && titleFieldName !== undefined) {
      const alias = singular(entity.collection);
      // The alias is ALSO a declared json variable: tapping a row stores
      // that document's JSON here, and the detail screen's
      // {{alias.field}} texts compile against state.<alias>.
      declare(alias, 'json', design, '{}');
      if (
        bindRepeat(template.id, alias, entity.listVariable, titleFieldName, design, pageIndex, listScreen.id)
      ) {
        notes.push(
          `'${template.name}' on ${listScreen.name} now repeats over ${entity.listVariable} ({{${alias}…}} tokens).`,
        );
        // Round out CRUD: tapping a row opens a detail screen showing
        // THAT document, with a confirmed Delete. Without this, saved
        // items were rows you could look at and never touch again.
        const detail = wireDetailAndDelete(
          entity, alias, template.id, listScreen, design, pageIndex, logic,
        );
        flows.push(...detail.flows);
        notes.push(...detail.notes);
      }
    } else {
      notes.push(
        `No row/card on the list screen names ${entity.collection}, so nothing was bound to the ` +
          `query result — ${entity.listVariable} holds the data but no list renders it. Point a row at ` +
          `it with apply_design_actions (updateNode + repeatSourceVariable: "${entity.listVariable}") ` +
          `and put {{${singular(entity.collection)}.<field>}} in its texts.`,
      );
    }
  }

  // Secondary collections (goals, comments, addresses…): every screen
  // named after one gets its own load-on-appear query and, where a row
  // template exists, a live binding — not just the home screen. A
  // "Goals" tab that shows designed placeholders while goals/ sits
  // empty in Firestore is exactly the kind of quiet lie this pass
  // exists to kill.
  for (const secondary of blueprint.secondary) {
    const screen = screenNamedLike(secondary, design, pageIndex, authScreenIds);
    if (screen === undefined) continue;
    declare(secondary.listVariable, 'json', design, '[]');
    const loader = new FlowBuilder(`Load ${secondary.label}s`, 'onScreenLoad');
    if (loader.isValid) {
      loader.append('firestoreQuery', {
        values: {
          collection: secondary.collection,
          where: 'userId == {{uid}}',
          orderBy: 'createdAt desc',
          limit: '50',
        },
        variables: { variable: secondary.listVariable },
      });
      const flow = loader.flow(screen.id);
      if (flow) flows.push(flow);
    }
    const bound = descendants(screen).some((n) => n.repeatBinding?.sourceVariable === secondary.listVariable);
    const template = bound ? undefined : repeatTemplate(screen, secondary);
    const title =
      secondary.fields.find((f) => titleCandidates.includes(f.name))?.name ?? secondary.fields[0]?.name;
    if (!bound && template && title !== undefined) {
      declare(singular(secondary.collection), 'json', design, '{}');
      bindRepeat(
        template.id, singular(secondary.collection), secondary.listVariable, title, design, pageIndex, screen.id,
      );
    }
    notes.push(`${screen.name} loads ${secondary.collection} on appear.`);
  }

  return { flows, notes };
}

/**
 * Builds the missing write path: a "New <Entity>" form screen (real
 * .Input per field, Save + Back), a "+" button on the list screen, and
 * the navigation flows between them. The Save flow itself is built by
 * the caller against the returned button, same as a designed screen.
 */
function synthesizeCreateScreen(
  entity: BackendBlueprintEntity,
  design: BackendDesignHost,
  pageIndex: number,
  home: DesignNode | undefined,
): { screen: DesignNode; saveButton: DesignNode; flows: LogicFlow[] } | undefined {
  if (home === undefined) return undefined;
  const palette = new Palette(design.project, pageIndex);

  const children: DesignNode[] = [];
  let y = 70;
  const backButton = button('Back', 'Back', y, palette);
  backButton.width = 90;
  backButton.height = 40;
  backButton.style.fill = palette.surface;
  backButton.style.textColor = palette.textPrimary;
  backButton.style.fontSize = 14;
  children.push(backButton);
  y += 64;
  children.push(text('Title', `New ${entity.label}`, y, 30, 'bold', palette.textPrimary));
  y += 60;

  // One typeable input per schema field (up to 4 — a longer first-run
  // form loses the user), each pre-bound to its draft variable so the
  // Save flow can read exactly what was typed.
  for (const field of entity.fields.slice(0, 4)) {
    const labelText = field.name.slice(0, 1).toUpperCase() + field.name.slice(1);
    const node = input(`${labelText} Field`, labelText, y, palette, false);
    const variable = 'draft' + capitalizedFirst(singular(entity.collection)) + capitalizedFirst(field.name);
    declare(variable, 'string', design);
    node.logicBindings = [makeNodeLogicBinding({ kind: 'value', variableName: variable })];
    children.push(node);
    y += 68;
  }
  y += 20;
  const saveButton = button('Save Button', `Save ${entity.label}`, y, palette);
  children.push(saveButton);

  const existingFrames = frames(design, pageIndex);
  const maxX = existingFrames.length === 0 ? 100 : Math.max(...existingFrames.map((f) => f.x + f.width));
  const form = frame(`New ${entity.label}`, maxX + 60, palette, children);
  design.mutateProject((project) => {
    project.pages[pageIndex]!.nodes.push(form);
  });

  // The "+" that opens the form, floating above the list content (and
  // above a bottom tab bar if there is one).
  const fab = button(`Add ${entity.label} Button`, '+', 0, palette);
  fab.x = screenSize.width - 24 - 56;
  fab.y = screenSize.height - 180;
  fab.width = 56;
  fab.height = 56;
  fab.style.cornerRadius = 28;
  fab.style.fontSize = 26;
  fab.zIndex = 50;
  design.mutateProject((project) => {
    const homeNode = project.pages[pageIndex]!.nodes.find((n) => n.id === home.id);
    if (homeNode) homeNode.children.push(fab);
  });

  const flows: LogicFlow[] = [];
  const openBuilder = new FlowBuilder(`Open New ${entity.label}`, 'onTap', fab.id);
  if (openBuilder.isValid) {
    openBuilder.append('navigate', { screens: { screen: form.id } });
    const flow = openBuilder.flow(home.id);
    if (flow) flows.push(flow);
  }
  const backBuilder = new FlowBuilder(`Close New ${entity.label}`, 'onTap', backButton.id);
  if (backBuilder.isValid) {
    backBuilder.append('goBack', {});
    const flow = backBuilder.flow(form.id);
    if (flow) flows.push(flow);
  }
  return { screen: form, saveButton, flows };
}

/**
 * A screen whose NAME says it lists this entity ("Goals", "Order History",
 * "Saved Places") — for wiring secondary collections.
 */
function screenNamedLike(
  entity: BackendBlueprintEntity,
  design: BackendDesignHost,
  pageIndex: number,
  excluded: string[],
): DesignNode | undefined {
  const wanted = [
    entity.collection.toLowerCase(),
    singular(entity.collection).toLowerCase(),
    entity.label.toLowerCase(),
  ];
  return frames(design, pageIndex).find((frameNode) => {
    if (excluded.includes(frameNode.id)) return false;
    const name = frameNode.name.toLowerCase();
    // "New X" is the create form, "X Details" the detail — neither is
    // the list screen even though both name the entity.
    if (name.startsWith('new ') || name.includes('detail')) return false;
    return wanted.some((w) => name.includes(w));
  });
}

/**
 * Row tap → "<Label> Details" (every field of THAT document via
 * {{alias.field}} tokens) → confirmed Delete → re-query → back.
 */
function wireDetailAndDelete(
  entity: BackendBlueprintEntity,
  alias: string,
  templateId: string,
  listScreen: DesignNode,
  design: BackendDesignHost,
  pageIndex: number,
  logic: LogicViewModel,
): { flows: LogicFlow[]; notes: string[] } {
  const flows: LogicFlow[] = [];
  const notes: string[] = [];

  // A row that already navigates somewhere keeps its wiring — the model
  // knew what it wanted; we only fill silence.
  const rowAlreadyWired = logic.flows.some((flow) =>
    flow.blocks.some(
      (block) =>
        block.type === 'onTap' &&
        block.parameters.some((p) => p.key === 'element' && p.nodeReference === templateId),
    ),
  );
  if (rowAlreadyWired) {
    return { flows, notes: ['Row already had a tap flow — detail screen not wired.'] };
  }

  // Detail screen: reuse one named like it, else synthesize.
  const detailName = `${entity.label} Details`;
  let detailScreen = frames(design, pageIndex).find(
    (n) => n.name.toLowerCase().includes('detail') && !n.name.toLowerCase().startsWith('new '),
  );
  let deleteButtonId: string | undefined;
  let backButtonId: string | undefined;

  if (detailScreen === undefined) {
    const palette = new Palette(design.project, pageIndex);
    const children: DesignNode[] = [];
    let y = 70;
    const back = button('Back', 'Back', y, palette);
    back.width = 90;
    back.height = 40;
    back.style.fill = palette.surface;
    back.style.textColor = palette.textPrimary;
    back.style.fontSize = 14;
    children.push(back);
    backButtonId = back.id;
    y += 64;
    const titleField = entity.fields[0]?.name ?? 'title';
    children.push(text('Title', `{{${alias}.${titleField}}}`, y, 30, 'bold', palette.textPrimary));
    y += 64;
    for (const field of entity.fields.slice(1, 6)) {
      const labelText = field.name.slice(0, 1).toUpperCase() + field.name.slice(1);
      children.push(text(`${labelText} Label`, labelText, y, 12, 'semibold', palette.textSecondary));
      y += 22;
      children.push(
        text(`${labelText} Value`, `{{${alias}.${field.name}}}`, y, 17, 'regular', palette.textPrimary),
      );
      y += 44;
    }
    y += 24;
    const del = button('Delete Button', `Delete ${entity.label}`, y, palette);
    del.style.fill = '#E5484D';
    del.style.textColor = '#FFFFFF';
    children.push(del);
    deleteButtonId = del.id;

    const existingFrames = frames(design, pageIndex);
    const maxX = existingFrames.length === 0 ? 100 : Math.max(...existingFrames.map((f) => f.x + f.width));
    const detailFrame = frame(detailName, maxX + 60, palette, children);
    design.mutateProject((project) => {
      project.pages[pageIndex]!.nodes.push(detailFrame);
    });
    detailScreen = detailFrame;
    notes.push(`Created '${detailName}' (row tap opens it; fields render the tapped document).`);
  } else {
    deleteButtonId = tappable(detailScreen, ['delete', 'remove', 'מחק'], [])?.id;
  }

  const detail = detailScreen;
  if (detail === undefined) return { flows, notes };

  const open = new FlowBuilder(`Open ${entity.label} Details`, 'onTap', templateId);
  if (open.isValid) {
    open.append('navigate', { screens: { screen: detail.id } });
    const flow = open.flow(listScreen.id);
    if (flow) flows.push(flow);
  }
  if (backButtonId !== undefined) {
    const close = new FlowBuilder(`Close ${entity.label} Details`, 'onTap', backButtonId);
    if (close.isValid) {
      close.append('goBack', {});
      const flow = close.flow(detail.id);
      if (flow) flows.push(flow);
    }
  }
  if (deleteButtonId !== undefined) {
    const remove = new FlowBuilder(`Delete ${entity.label}`, 'onTap', deleteButtonId);
    if (remove.isValid) {
      const confirm = remove.append('confirmDialog', {
        values: {
          title: `Delete this ${entity.label.toLowerCase()}?`,
          message: "This can't be undone.",
          confirmLabel: 'Delete',
          cancelLabel: 'Keep',
        },
      });
      const erase = remove.append('firestoreDeleteDocument', {
        from: [confirm, 0],
        values: { path: `${entity.collection}/{{${alias}._id}}` },
      });
      remove.append('firestoreQuery', {
        from: [erase, 0],
        values: {
          collection: entity.collection,
          where: 'userId == {{uid}}',
          orderBy: 'createdAt desc',
          limit: '50',
        },
        variables: { variable: entity.listVariable },
      });
      remove.append('goBack', {});
      remove.append('showAlert', {
        from: [erase, 1],
        values: { title: "Couldn't delete", message: 'Check your connection and try again.' },
      });
      const flow = remove.flow(detail.id);
      if (flow) flows.push(flow);
    }
  }
  return { flows, notes };
}

/**
 * A field name → the input most likely meant for it, falling back to
 * positional order so a plain "New item" form still saves something.
 */
function matchingInput(field: string, inputs: DesignNode[], alreadyUsed: number): DesignNode | undefined {
  const target = field.toLowerCase();
  const match = inputs.find((node) => {
    const haystack = [node.name, node.text, node.children[0]?.text]
      .filter((s): s is string => s !== undefined && s !== null)
      .join(' ')
      .toLowerCase();
    return haystack.includes(target);
  });
  if (match) return match;
  return alreadyUsed >= 0 && alreadyUsed < inputs.length ? inputs[alreadyUsed] : undefined;
}

/**
 * Gives an unbound form input a variable of its own, so its typed value
 * can reach Firestore.
 */
function bindDraft(
  input: DesignNode,
  field: string,
  entity: BackendBlueprintEntity,
  design: BackendDesignHost,
  pageIndex: number,
  screenId: string,
): string | undefined {
  const variable = 'draft' + capitalizedFirst(singular(entity.collection)) + capitalizedFirst(field);
  declare(variable, 'string', design);
  let applied = false;
  function walk(nodes: DesignNode[]): void {
    for (const node of nodes) {
      if (node.id === input.id) {
        const bindings = node.logicBindings ?? [];
        bindings.push(makeNodeLogicBinding({ kind: 'value', variableName: variable }));
        node.logicBindings = bindings;
        applied = true;
        return;
      }
      walk(node.children);
      if (applied) return;
    }
  }
  let found = false;
  design.mutateProject((project) => {
    const screen = project.pages[pageIndex]!.nodes.find((n) => n.id === screenId);
    if (screen === undefined) return;
    found = true;
    walk(screen.children);
  });
  if (!found) return undefined;
  return applied ? variable : undefined;
}

function bindRepeat(
  templateId: string,
  alias: string,
  source: string,
  titleField: string,
  design: BackendDesignHost,
  pageIndex: number,
  screenId: string,
): boolean {
  let applied = false;
  function walk(nodes: DesignNode[]): void {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      if (node.id === templateId) {
        if (node.repeatBinding !== undefined) return;
        node.repeatBinding = {
          sourceVariable: source,
          itemAlias: alias,
          maxItems: 50,
          axis: 'vertical',
          isScrollable: true,
        };
        // The first text in the row becomes the item's title, so
        // the list shows real data rather than the design's
        // placeholder copy repeated N times.
        retitle(node, `{{${alias}.${titleField}}}`);
        // Sibling placeholder rows ("Product Card 2", "Card 3")
        // must go: real documents would otherwise render on top
        // of — or beside — hardcoded demo content, and the mix
        // reads as data corruption to the user.
        const stem = nameStem(node.name);
        const templateNodeId = node.id;
        for (let i = nodes.length - 1; i >= 0; i -= 1) {
          const sibling = nodes[i]!;
          if (sibling.id !== templateNodeId && nameStem(sibling.name) === stem) nodes.splice(i, 1);
        }
        applied = true;
        return;
      }
      walk(node.children);
      if (applied) return;
    }
  }
  let found = false;
  design.mutateProject((project) => {
    const screen = project.pages[pageIndex]!.nodes.find((n) => n.id === screenId);
    if (screen === undefined) return;
    found = true;
    walk(screen.children);
  });
  if (!found) return false;
  return applied;
}

/**
 * "Product Card 2" → "product card": the name minus trailing numbering,
 * for matching a repeat template against its placeholder siblings.
 */
function nameStem(name: string): string {
  let stem = trimWhitespaces(name.toLowerCase());
  while (stem.length > 0) {
    const last = stem[stem.length - 1]!;
    if (/[0-9]/.test(last) || last === ' ') stem = stem.slice(0, -1);
    else break;
  }
  return stem;
}

/** Swift `trimmingCharacters(in: .whitespaces)` (Unicode spaces, not newlines). */
function trimWhitespaces(text: string): string {
  const ws = '[\\t \\u00a0\\u1680\\u2000-\\u200a\\u202f\\u205f\\u3000]+';
  return text.replace(new RegExp('^' + ws), '').replace(new RegExp(ws + '$'), '');
}

function retitle(node: DesignNode, token: string): void {
  if (node.type === 'Text' && node.text !== undefined && node.text.length > 0 && !node.text.includes('{{')) {
    node.text = token;
    return;
  }
  for (const child of node.children) {
    const before = child.text;
    retitle(child, token);
    if (child.text !== before) return;
  }
}

/**
 * A row/card that reads like a list item for THIS entity and isn't already
 * repeating. The entity check matters: an e-commerce app's primary
 * collection is `orders`, and binding a storefront's "Product Card" to it
 * produced a shop that listed the user's own orders as merchandise. When
 * nothing on the screen names the entity, bind nothing and say so — a
 * wrong binding is worse than a static placeholder the audit already
 * flags.
 */
function repeatTemplate(screen: DesignNode, entity: BackendBlueprintEntity): DesignNode | undefined {
  const singularName = singular(entity.collection).toLowerCase();
  const screenNamesEntity = [screen.name.toLowerCase()].some(
    (n) => n.includes(singularName) || n.includes(entity.collection.toLowerCase()),
  );
  let best: DesignNode | undefined;
  function walk(node: DesignNode): void {
    const name = node.name.toLowerCase();
    const looksLikeRow =
      node.type === 'Frame' &&
      node.repeatBinding === undefined &&
      ['row', 'card', 'item', 'cell', 'entry', 'tile'].some((k) => name.includes(k)) &&
      !['nav', 'tab', 'header', 'hero', 'grid', 'list'].some((k) => name.includes(k)) &&
      node.children.some((c) => c.type === 'Text');
    // Either the row itself names the entity, or the whole screen is
    // that entity's list and the row is generic ("Item Row", "Cell").
    const relatesToEntity =
      name.includes(singularName) ||
      (screenNamesEntity && !name.includes('product') && !name.includes('track'));
    if (looksLikeRow && relatesToEntity && best === undefined) best = node;
    for (const child of node.children) walk(child);
  }
  for (const child of screen.children) walk(child);
  return best;
}

// MARK: - Element discovery

function descendants(node: DesignNode): DesignNode[] {
  const out: DesignNode[] = [];
  function walk(current: DesignNode): void {
    for (const child of current.children) {
      out.push(child);
      walk(child);
    }
  }
  walk(node);
  return out;
}

function textInputs(screen: DesignNode): DesignNode[] {
  return descendants(screen)
    .filter((n) => n.type === 'Input')
    .sort((a, b) => a.y - b.y);
}

function boundVariable(node: DesignNode): string | undefined {
  return (node.logicBindings ?? []).find((b) => b.kind === 'value' || b.kind === 'text')?.variableName;
}

function label(node: DesignNode): string {
  const parts = [node.text, node.name].filter((s): s is string => s !== undefined && s !== null);
  parts.push(...node.children.map((c) => c.text).filter((s): s is string => s !== undefined && s !== null));
  return parts.join(' ').toLowerCase();
}

/**
 * A real Button whose label names the action — the biggest one wins, so a
 * full-width CTA beats a small secondary control with a similar label.
 */
function primaryButton(screen: DesignNode, wanted: string[], unwanted: string[]): DesignNode | undefined {
  const buttons = descendants(screen).filter((n) => n.type === 'Button');
  const matches = buttons.filter((btn) => {
    const text = label(btn);
    return wanted.some((w) => text.includes(w)) && !unwanted.some((u) => text.includes(u));
  });
  const best = maxBy(matches, (a, b) => a.width * a.height < b.width * b.height);
  if (best) return best;
  // No label match: on a screen we did not design, the widest button is
  // the submit control far more often than not.
  return maxBy(
    buttons.filter((btn) => {
      const text = label(btn);
      return !unwanted.some((u) => text.includes(u));
    }),
    (a, b) => a.width * a.height < b.width * b.height,
  );
}

/** Any tappable element (button OR text link) whose label matches. */
function tappable(screen: DesignNode, wanted: string[], unwanted: string[]): DesignNode | undefined {
  return descendants(screen)
    .filter((n) => n.type === 'Button' || n.type === 'Text')
    .find((node) => {
      const text = label(node);
      return wanted.some((w) => text.includes(w)) && !unwanted.some((u) => text.includes(u));
    });
}

function linkFlow(name: string, from: DesignNode, to: DesignNode, keywords: string[]): LogicFlow | undefined {
  const link = tappable(from, keywords, []);
  if (link === undefined) return undefined;
  const builder = new FlowBuilder(name, 'onTap', link.id);
  if (!builder.isValid) return undefined;
  builder.append('navigate', { screens: { screen: to.id } });
  return builder.flow(from.id);
}

/** The app's "make a new one" control: a +, "Add", "Save", "Create"… */
function createControl(
  design: BackendDesignHost,
  pageIndex: number,
  excluded: string[],
): { screen: DesignNode; button: DesignNode } | undefined {
  const wanted = [
    'save', 'add ', 'add', 'create', 'new ', 'log ', 'submit', 'post', '+',
    'שמור', 'הוסף', 'צור', 'שמירה',
  ];
  const unwanted = ['log in', 'login', 'sign in', 'sign up', 'signup', 'add to cart', 'logout', 'log out'];
  // Screens named like a form/create flow first — a "New Task" screen's
  // Save button is a better anchor than a home-screen FAB.
  const formish = (node: DesignNode): boolean =>
    ['new', 'create', 'add', 'form', 'compose', 'log'].some((k) => node.name.toLowerCase().includes(k));
  const ordered = swiftSorted(
    frames(design, pageIndex).filter((f) => !excluded.includes(f.id)),
    (first, second) => formish(first) && !formish(second),
  );
  for (const screen of ordered) {
    const candidates = descendants(screen).filter((n) => n.type === 'Button');
    const match = candidates.find((btn) => {
      const text = label(btn);
      return wanted.some((w) => text.includes(w)) && !unwanted.some((u) => text.includes(u));
    });
    if (match) return { screen, button: match };
  }
  return undefined;
}

/**
 * Swift's `sorted(by:)` with a strict weak ordering predicate. JS's
 * comparator form is equivalent for this predicate (`true` → a before b).
 */
function swiftSorted<T>(items: T[], areInIncreasingOrder: (a: T, b: T) => boolean): T[] {
  return [...items].sort((a, b) => {
    if (areInIncreasingOrder(a, b)) return -1;
    if (areInIncreasingOrder(b, a)) return 1;
    return 0;
  });
}

// MARK: - Generated auth screens

/**
 * Colours sampled from the project so a generated auth screen belongs to
 * the same app — a fixed preset would look bolted on.
 */
export class Palette {
  background = '#FFFFFF';
  surface = '#F2F2F7';
  textPrimary = '#111111';
  textSecondary = '#8A8A8E';
  accent = '#0A84FF';
  accentText = '#FFFFFF';

  constructor(project: DesignProject, pageIndex: number) {
    const pageFrames =
      pageIndex >= 0 && pageIndex < project.pages.length
        ? project.pages[pageIndex]!.nodes.filter((n) => n.type === 'Frame')
        : [];
    const fill = pageFrames[0]?.style.fill;
    if (fill !== undefined && fill.startsWith('#') && fill.length >= 7) {
      this.background = fill;
    }
    const accentHex = project.brand?.accent;
    if (accentHex !== undefined && accentHex.startsWith('#')) {
      this.accent = accentHex;
    } else {
      const cta = pageFrames
        .flatMap((node) => descendants(node))
        .find((n) => n.type === 'Button' && n.style.fill.startsWith('#') && n.style.fill.length >= 7);
      if (cta) this.accent = cta.style.fill;
    }
    const dark = Palette.isDark(this.background);
    this.surface = dark ? Palette.lighten(this.background, 0.1) : Palette.darken(this.background, 0.05);
    this.textPrimary = dark ? '#FFFFFF' : '#111111';
    this.textSecondary = dark ? '#A8A8AE' : '#8A8A8E';
    this.accentText = Palette.isDark(this.accent) ? '#FFFFFF' : '#111111';
  }

  static components(hex: string): [number, number, number] | undefined {
    let value = hex;
    if (value.startsWith('#')) value = value.slice(1);
    if (value.length < 6) return undefined;
    const prefix = value.slice(0, 6);
    if (!/^[0-9a-fA-F]+$/.test(prefix)) return undefined;
    const number = parseInt(prefix, 16);
    if (!Number.isFinite(number)) return undefined;
    return [((number >> 16) & 0xff) / 255, ((number >> 8) & 0xff) / 255, (number & 0xff) / 255];
  }

  static isDark(hex: string): boolean {
    const c = Palette.components(hex);
    if (c === undefined) return false;
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 0.5;
  }

  static lighten(hex: string, amount: number): string {
    return Palette.shift(hex, (v) => Math.min(1, v + amount));
  }

  static darken(hex: string, amount: number): string {
    return Palette.shift(hex, (v) => Math.max(0, v - amount));
  }

  private static shift(hex: string, transform: (value: number) => number): string {
    const c = Palette.components(hex);
    if (c === undefined) return hex;
    const channel = (value: number): number => swiftRounded(transform(value) * 255);
    return `#${hex2(channel(c[0]))}${hex2(channel(c[1]))}${hex2(channel(c[2]))}`;
  }
}

/** Swift `Double.rounded()` — half away from zero. */
function swiftRounded(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** `String(format: "%02X", value)` */
function hex2(value: number): string {
  const clamped = Math.trunc(value);
  return (clamped < 0 ? 0 : clamped).toString(16).toUpperCase().padStart(2, '0');
}

function makeLoginScreen(palette: Palette, x: number): DesignNode {
  const children: DesignNode[] = [];
  let y = 120;
  children.push(text('Title', 'Welcome back', y, 32, 'bold', palette.textPrimary));
  y += 44;
  children.push(text('Subtitle', 'Sign in to continue', y, 15, 'regular', palette.textSecondary));
  y += 48;
  children.push(input('Email Field', 'Email address', y, palette, false));
  y += 68;
  children.push(input('Password Field', 'Password', y, palette, true));
  y += 68;
  children.push(
    text('Forgot Password Link', 'Forgot password?', y, 14, 'semibold', palette.accent, 'right'),
  );
  y += 40;
  children.push(button('Log In Button', 'Log In', y, palette));
  y += 76;
  children.push(
    text('Sign Up Link', 'New here? Create an account', y, 14, 'semibold', palette.accent, 'center'),
  );
  return frame('Log In', x, palette, children);
}

function makeSignUpScreen(palette: Palette, x: number): DesignNode {
  const children: DesignNode[] = [];
  let y = 120;
  children.push(text('Title', 'Create your account', y, 32, 'bold', palette.textPrimary));
  y += 44;
  children.push(text('Subtitle', 'It takes less than a minute', y, 15, 'regular', palette.textSecondary));
  y += 48;
  children.push(input('Name Field', 'Full name', y, palette, false));
  y += 68;
  children.push(input('Email Field', 'Email address', y, palette, false));
  y += 68;
  children.push(input('Password Field', 'Password (6+ characters)', y, palette, true));
  y += 68;
  children.push(input('Confirm Password Field', 'Confirm password', y, palette, true));
  y += 84;
  children.push(button('Sign Up Button', 'Create Account', y, palette));
  y += 76;
  children.push(
    text('Log In Link', 'I already have an account', y, 14, 'semibold', palette.accent, 'center'),
  );
  return frame('Sign Up', x, palette, children);
}

function frame(name: string, x: number, palette: Palette, children: DesignNode[]): DesignNode {
  return makeDesignNode({
    type: 'Frame',
    name,
    x,
    y: 100,
    width: screenSize.width,
    height: screenSize.height,
    style: makeNodeStyle({ fill: palette.background, cornerRadius: 40, opacity: 1 }),
    children,
  });
}

function text(
  name: string,
  value: string,
  y: number,
  size: number,
  weight: string,
  color: string,
  align: string = 'left',
): DesignNode {
  return makeDesignNode({
    type: 'Text',
    name,
    x: 24,
    y,
    width: screenSize.width - 48,
    height: size + 10,
    text: value,
    style: makeNodeStyle({
      fill: '#00000000',
      cornerRadius: 0,
      opacity: 1,
      fontSize: size,
      fontWeight: weight,
      textColor: color,
      textAlign: align,
    }),
  });
}

/**
 * A REAL .Input node — the exporter renders it as a TextField/SecureField
 * bound to a variable. The decorative "inputField" component is a Frame
 * with a placeholder label and cannot be typed into.
 */
function input(name: string, placeholder: string, y: number, palette: Palette, secure: boolean): DesignNode {
  const node = makeDesignNode({
    type: 'Input',
    name,
    x: 24,
    y,
    width: screenSize.width - 48,
    height: 56,
    text: placeholder,
    style: makeNodeStyle({
      fill: palette.surface,
      cornerRadius: 14,
      opacity: 1,
      fontSize: 16,
      fontWeight: 'regular',
      textColor: palette.textPrimary,
      paddingLeft: 16,
    }),
  });
  node.isSecure = secure;
  return node;
}

function button(name: string, title: string, y: number, palette: Palette): DesignNode {
  return makeDesignNode({
    type: 'Button',
    name,
    x: 24,
    y,
    width: screenSize.width - 48,
    height: 56,
    text: title,
    style: makeNodeStyle({
      fill: palette.accent,
      cornerRadius: 16,
      opacity: 1,
      fontSize: 17,
      fontWeight: 'bold',
      textColor: palette.accentText,
      textAlign: 'center',
    }),
  });
}

// MARK: - Naming

function singular(collection: string): string {
  if (collection.endsWith('ies')) return collection.slice(0, -3) + 'y';
  if (collection.endsWith('ses')) return collection.slice(0, -2);
  if (collection.endsWith('s') && !collection.endsWith('ss')) return collection.slice(0, -1);
  return collection;
}

// MARK: - Flow construction

interface AppendOptions {
  from?: [string, number];
  values?: Record<string, string>;
  nodes?: Record<string, string>;
  variables?: Record<string, string>;
  screens?: Record<string, string>;
}

/**
 * `private struct FlowBuilder` — builds a trigger + branching block graph
 * from the real block catalog, so every parameter key, port index and
 * category matches what the editor, simulator and exporters expect.
 * Hand-built blocks drift from the catalog and then silently no-op.
 */
class FlowBuilder {
  blocks: LogicBlock[] = [];
  private connections: BlockConnection[] = [];
  private lastId: string | undefined;
  private readonly name: string;

  get isValid(): boolean {
    return this.lastId !== undefined;
  }

  constructor(name: string, trigger: LogicBlockType, element?: string) {
    this.name = name;
    const event = BlockCatalog.makeBlock(trigger, { x: 40, y: 40 });
    if (event === undefined) return;
    event.label = `${name} Trigger`;
    if (element !== undefined) {
      event.connectedDesignNodeId = element;
      const parameter = event.parameters.find((p) => p.key === 'element');
      if (parameter) parameter.nodeReference = element;
    }
    this.blocks = [event];
    this.lastId = event.id;
  }

  /**
   * Appends a block, wired from `from` (block id + output port) or from the
   * previous block's success port. Returns the new block's id.
   */
  append(type: LogicBlockType, options: AppendOptions = {}): string {
    const source = options.from;
    const values = options.values ?? {};
    const nodes = options.nodes ?? {};
    const variables = options.variables ?? {};
    const screens = options.screens ?? {};

    const sourceId = source?.[0] ?? this.lastId;
    const port = source?.[1] ?? 0;
    const y = 40 + this.blocks.length * 120;
    const block = BlockCatalog.makeBlock(type, { x: 320, y });
    if (block === undefined) return sourceId ?? newUUID();
    for (const parameter of block.parameters) {
      const key = parameter.key;
      const value = values[key];
      if (value !== undefined) parameter.value = value;
      const nodeId = nodes[key];
      if (nodeId !== undefined) parameter.nodeReference = nodeId;
      const screenId = screens[key];
      if (screenId !== undefined) parameter.nodeReference = screenId;
      const variable = variables[key];
      if (variable !== undefined) {
        parameter.variableReference = variable;
        // MCP-driven and older readers look at `value` for "Store In"
        // targets; setting both means no reader silently no-ops.
        if (parameter.type === 'variable' && (parameter.value === undefined || parameter.value.length === 0)) {
          parameter.value = variable;
        }
      }
    }
    this.blocks.push(block);
    if (sourceId !== undefined) {
      this.connections.push(
        makeBlockConnection({
          sourceBlockId: sourceId,
          sourcePortIndex: port,
          targetBlockId: block.id,
          targetPortIndex: 0,
        }),
      );
    }
    // Only a success-port append advances the chain; an error leaf must not
    // become the trunk everything else hangs off.
    if (source === undefined || port === 0) this.lastId = block.id;
    return block.id;
  }

  flow(screenNodeId: string | undefined): LogicFlow | undefined {
    if (this.blocks.length <= 1) return undefined;
    const laidOut = this.blocks.map((b) => ({ ...b }));
    LogicAgentTranslator.layoutIfNeeded(laidOut, this.connections);
    return makeLogicFlow({
      name: this.name,
      blocks: laidOut,
      connections: this.connections,
      screenNodeId,
    });
  }
}

/** Static members of the Swift `BackendWiringGenerator` enum. */
export const BackendWiringGenerator = {
  emailVariable,
  passwordVariable,
  passwordConfirmVariable,
  nameVariable,
  uidVariable,
  profileVariable,
  screenSize,
  wire,
  Palette,
} as const;
