// Ported 1:1 from AgenticDesigner/Services/FirebaseProvisioner.swift
//
// Drives the locally installed firebase CLI so "connect a real backend"
// stops being four manual console steps. Everything runs --non-interactive:
// any state that would prompt (not logged in, ToS not accepted) must surface
// as a clear instruction instead.
import path from 'node:path';
import { fileExists, homeDirectory, isExecutableFile } from '../platform/Paths.js';
import { ProcessLaunchError, runProcess } from '../platform/ProcessRunner.js';

export class CLIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CLIError';
  }
}

export interface ProvisionResult {
  projectId: string;
  appId: string;
  apiKey: string;
  messagingSenderId: string;
  storageBucket: string;
  steps: string[];
  warnings: string[];
}

function includesCaseInsensitive(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

export const FirebaseProvisioner = {
  // MARK: - CLI discovery

  /// GUI apps launch with a minimal PATH, so the CLI is found by probing
  /// known install locations rather than trusting the environment.
  cliPath(): string | null {
    const candidates = [
      '/opt/homebrew/bin/firebase',
      '/usr/local/bin/firebase',
      path.join(homeDirectory(), '.local/bin/firebase'),
    ];
    return candidates.find((candidate) => isExecutableFile(candidate)) ?? null;
  },

  /// null when logged in; otherwise the instruction to show the user.
  async loginProblem(): Promise<string | null> {
    const cli = FirebaseProvisioner.cliPath();
    if (!cli) {
      return 'The firebase CLI is not installed. Install it with: brew install firebase-cli (or npm i -g firebase-tools), then run `firebase login` once in Terminal.';
    }
    let output: string;
    try {
      output = await run(cli, ['login:list']);
    } catch {
      return `Could not run the firebase CLI at ${cli}.`;
    }
    if (includesCaseInsensitive(output, 'No authorized accounts')) {
      return 'The firebase CLI is installed but not signed in. Run `firebase login` once in Terminal (it opens a browser), then call this tool again.';
    }
    return null;
  },

  // MARK: - Provisioning chain

  /// Creates (or reuses) the project, registers the iOS app, and returns
  /// the client config ready to drop into FirebaseConfig.
  async provision(projectId: string, displayName: string, bundleId: string): Promise<ProvisionResult> {
    const cli = FirebaseProvisioner.cliPath();
    if (!cli) throw new CLIError('firebase CLI not found.');
    const result: ProvisionResult = {
      projectId, appId: '', apiKey: '', messagingSenderId: '', storageBucket: '', steps: [], warnings: [],
    };

    // 1 — Project. "Already exists" for OUR id is fine (idempotent
    // re-run); any other failure is real.
    try {
      await run(cli, ['projects:create', projectId, '--display-name', displayName, '--non-interactive']);
      result.steps.push(`Created Firebase project '${projectId}'.`);
    } catch (error) {
      const text = (error as Error).message;
      if (includesCaseInsensitive(text, 'already exists') || includesCaseInsensitive(text, 'HTTP Error: 409')) {
        // Reachable for us, or taken by someone else? Listing tells.
        const mine = await run(cli, ['projects:list']).catch(() => '');
        if (mine.includes(projectId)) {
          result.steps.push(`Project '${projectId}' already exists — reusing it.`);
        } else {
          throw new CLIError(`Project id '${projectId}' is taken by another account. Pick a different projectId (they are global across all of Firebase).`);
        }
      } else {
        throw new CLIError(`projects:create failed: ${text.slice(0, 600)}`);
      }
    }

    // 2 — iOS app registration (or reuse).
    let appId = '';
    try {
      const created = await run(cli, ['apps:create', 'IOS', displayName, '--bundle-id', bundleId, '--project', projectId, '--non-interactive']);
      appId = firstMatch(created, /App ID:\s*([0-9]+:[0-9]+:ios:[a-f0-9]+)/) ?? '';
      result.steps.push(`Registered iOS app (${bundleId}).`);
    } catch (error) {
      // Perhaps it already exists — find it in the list.
      const list = await run(cli, ['apps:list', 'IOS', '--project', projectId]).catch(() => '');
      appId = firstMatch(list, /([0-9]+:[0-9]+:ios:[a-f0-9]+)/) ?? '';
      if (appId.length === 0) {
        const text = (error as Error).message;
        throw new CLIError(`apps:create failed and no existing iOS app found: ${text.slice(0, 600)}`);
      }
      result.steps.push('iOS app already registered — reusing it.');
    }
    result.appId = appId;

    // 3 — Client config. sdkconfig prints the GoogleService-Info plist;
    // parse the real keys out of it rather than scraping lines.
    const configOutput = await run(cli, ['apps:sdkconfig', 'IOS', appId, '--project', projectId, '--non-interactive']);
    const start = configOutput.indexOf('<?xml');
    const end = configOutput.indexOf('</plist>');
    if (start < 0 || end < 0) {
      throw new CLIError(`apps:sdkconfig returned no plist. Raw output: ${configOutput.slice(0, 400)}`);
    }
    const plistText = configOutput.slice(start, end + '</plist>'.length);
    const plist = parsePlistStrings(plistText);
    if (!plist) {
      throw new CLIError('Could not parse the sdkconfig plist.');
    }
    result.apiKey = plist['API_KEY'] ?? '';
    result.messagingSenderId = plist['GCM_SENDER_ID'] ?? '';
    result.storageBucket = plist['STORAGE_BUCKET'] ?? '';
    if (plist['GOOGLE_APP_ID']) result.appId = plist['GOOGLE_APP_ID'];
    result.steps.push('Pulled the iOS client config (API key, sender id, bucket).');

    // 4 — Firestore database. New projects have none; rules deploy fails
    // without it. Failure here is a warning, not an error — the console
    // may require accepting terms once.
    try {
      await run(cli, ['firestore:databases:create', '(default)', '--location', 'nam5', '--project', projectId, '--non-interactive']);
      result.steps.push('Created the Firestore database (nam5).');
    } catch (error) {
      const text = (error as Error).message;
      if (includesCaseInsensitive(text, 'already exists')) {
        result.steps.push('Firestore database already exists.');
      } else {
        result.warnings.push(`Could not create the Firestore database automatically (${text.slice(0, 200)}). Open the Firebase console once, create Firestore, then deploy_firestore_rules.`);
      }
    }

    result.warnings.push('Sign-in methods must still be enabled once in the console (Authentication ▸ Sign-in method ▸ Email/Password) — the CLI has no command for it.');
    return result;
  },

  /// Deploys firestore.rules from an export directory (which ships
  /// firebase.json + .firebaserc, so the CLI knows what to deploy where).
  async deployRules(exportDir: string, projectId: string): Promise<string> {
    const cli = FirebaseProvisioner.cliPath();
    if (!cli) throw new CLIError('firebase CLI not found.');
    if (!fileExists(path.join(exportDir, 'firebase.json'))) {
      throw new CLIError(`No firebase.json at ${exportDir} — re-export first (exports now include it next to firestore.rules).`);
    }
    return run(cli, ['deploy', '--only', 'firestore:rules', '--project', projectId, '--non-interactive'], exportDir);
  },
};

// MARK: - Plumbing

function firstMatch(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (!match || match.length < 2) return null;
  return match[match.length - 1] ?? null;
}

/// PropertyListSerialization for the string-valued dict the sdkconfig prints.
export function parsePlistStrings(plistText: string): Record<string, string> | null {
  const pairs = /<key>([^<]*)<\/key>\s*<string>([^<]*)<\/string>/g;
  const result: Record<string, string> = {};
  let found = false;
  let match: RegExpExecArray | null;
  while ((match = pairs.exec(plistText)) !== null) {
    found = true;
    result[decodeXML(match[1] ?? '')] = decodeXML(match[2] ?? '');
  }
  if (!found && !/<dict>/.test(plistText)) return null;
  return result;
}

function decodeXML(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&');
}

async function run(executable: string, args: string[], currentDirectory?: string): Promise<string> {
  // The CLI is a node script: it needs its own bin dir on PATH (for
  // `node`) even though we invoke it by absolute path.
  const extraPaths = '/opt/homebrew/bin:/usr/local/bin';
  const env = { ...process.env, PATH: extraPaths + ':' + (process.env.PATH ?? '/usr/bin:/bin') };
  let result;
  try {
    result = await runProcess(executable, args, { cwd: currentDirectory, env });
  } catch (error) {
    if (error instanceof ProcessLaunchError) throw new CLIError(error.message);
    throw error;
  }
  if (result.status !== 0) {
    throw new CLIError(result.output.length === 0 ? `${executable} exited ${result.status}` : result.output);
  }
  return result.output;
}
