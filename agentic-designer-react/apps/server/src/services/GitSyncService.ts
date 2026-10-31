// Ported 1:1 from AgenticDesigner/Services/GitSyncService.swift
//
// "Your app, in your repo" — a real git repository per project. When sync is
// enabled, every checkpoint is also committed to a local git repo, and exports
// are mirrored into it. The repo lives in
// Application Support/AgenticDesigner/GitRepos/<project>/:
//     project.agenticdesign   — pretty-printed, sorted keys → meaningful diffs
//     Exports/Xcode/          — mirror of the last export_xcode_project
//     Exports/SwiftPM/        — mirror of the last export_ios_source
//
// Plumbing is /usr/bin/git; publishing uses the GitHub CLI (`gh`) when present.
import fs from 'node:fs';
import path from 'node:path';
import { agenticSupportDirectory, ensureDirectory, fileExists, isExecutableFile, writeFileAtomic } from '../platform/Paths.js';
import { extendedPATH, ProcessLaunchError, runProcess } from '../platform/ProcessRunner.js';
import { prettySortedJSON } from '../platform/json.js';
import { Settings } from './Settings.js';

export class GitSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitSyncError';
  }
}

/// The project document as the editor serialises it (Swift `DesignProject`).
export type ProjectJSON = Record<string, unknown> & { name?: unknown };

function projectName(project: ProjectJSON): string {
  return typeof project.name === 'string' ? project.name : '';
}

const gitPath = '/usr/bin/git';

/// Serial queue so auto-commits never interleave (DispatchQueue "com.agentic.gitsync").
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = queueTail.then(work, work);
  queueTail = next.catch(() => undefined);
  return next;
}

export const GitSyncService = {
  // MARK: - Locations & state

  root(): string {
    return agenticSupportDirectory('GitRepos');
  },

  safeName(projectNameValue: string): string {
    const safe = projectNameValue.replaceAll('/', '-').replaceAll(':', '-');
    return safe.length === 0 ? 'Untitled' : safe;
  },

  repoDirectory(projectNameValue: string): string {
    return path.join(GitSyncService.root(), GitSyncService.safeName(projectNameValue));
  },

  enabledKey(projectNameValue: string): string {
    return `gitSync.enabled.${GitSyncService.safeName(projectNameValue)}`;
  },

  get isGitAvailable(): boolean {
    return isExecutableFile(gitPath);
  },

  isEnabled(projectNameValue: string): boolean {
    return (
      Settings.bool(GitSyncService.enabledKey(projectNameValue))
      && fileExists(path.join(GitSyncService.repoDirectory(projectNameValue), '.git'))
    );
  },

  // MARK: - Enable / disable

  /// Creates the repo (idempotent), writes the current project into it and
  /// makes the initial commit. Returns the repo directory.
  async enable(project: ProjectJSON): Promise<string> {
    if (!GitSyncService.isGitAvailable) {
      throw new GitSyncError(`git not found at ${gitPath} — install the Xcode Command Line Tools.`);
    }
    const name = projectName(project);
    const repo = GitSyncService.repoDirectory(name);
    ensureDirectory(repo);

    if (!fileExists(path.join(repo, '.git'))) {
      await runGit(repo, ['init', '-b', 'main']);
    }
    // Commits fail without an identity; give the repo a local one only if
    // the user has none configured globally.
    const existingEmail = await runGit(repo, ['config', 'user.email']).catch(() => '');
    if (existingEmail.trim().length === 0) {
      await runGit(repo, ['config', 'user.name', 'AgenticDesigner']);
      await runGit(repo, ['config', 'user.email', 'agenticdesigner@localhost']);
    }

    const gitignore = path.join(repo, '.gitignore');
    if (!fileExists(gitignore)) {
      fs.writeFileSync(gitignore, '.DS_Store\nxcuserdata/\nDerivedData/\nbuild/', 'utf8');
    }
    const readme = path.join(repo, 'README.md');
    if (!fileExists(readme)) {
      fs.writeFileSync(
        readme,
        `# ${name}\n\nBuilt with AgenticDesigner. \`project.agenticdesign\` is the design + logic document; \`Exports/\` holds the generated source (Xcode project / SwiftPM).`,
        'utf8',
      );
    }

    writeProjectFile(project, repo);
    await commitIfDirty(repo, 'Enable git sync');
    Settings.set(GitSyncService.enabledKey(name), true);
    return repo;
  },

  disable(projectNameValue: string): void {
    Settings.set(GitSyncService.enabledKey(projectNameValue), false);
  },

  // MARK: - Auto-commit (called by CheckpointStore on every snapshot)

  /// Fire-and-forget: mirrors the project into the repo and commits, on the
  /// serial queue. Never throws — a git hiccup must not break a design edit.
  recordCheckpoint(project: ProjectJSON, label: string): boolean {
    const name = projectName(project);
    if (!GitSyncService.isEnabled(name)) return false;
    const repo = GitSyncService.repoDirectory(name);
    void enqueue(async () => {
      try {
        writeProjectFile(project, repo);
        await commitIfDirty(repo, `checkpoint: ${label}`);
      } catch (error) {
        console.log(`⚠️ Git sync commit failed: ${(error as Error).message}`);
      }
    });
    return true;
  },

  // MARK: - Export mirroring

  /// Copies an export into <repo>/Exports/<kind>/ and commits it. Returns a
  /// one-line note for the tool result, or null when sync is off. Export
  /// failures here never fail the export itself.
  async syncExport(projectNameValue: string, kind: string, source: string): Promise<string | null> {
    if (!GitSyncService.isEnabled(projectNameValue)) return null;
    const repo = GitSyncService.repoDirectory(projectNameValue);
    // An export written into the repo itself needs no mirror — just commit it.
    const insideRepo = path.resolve(source).startsWith(path.resolve(repo));
    try {
      if (!insideRepo) {
        const destination = path.join(repo, 'Exports', kind);
        if (fileExists(destination)) {
          fs.rmSync(destination, { recursive: true, force: true });
        }
        ensureDirectory(path.dirname(destination));
        fs.cpSync(source, destination, { recursive: true });
      }
      await enqueue(() => commitIfDirty(repo, `export: ${kind}`));
      return `Git: export committed to ${repo}`;
    } catch (error) {
      return `Git: export commit failed — ${(error as Error).message}`;
    }
  },

  // MARK: - Manual commit / status / push

  async commitNow(project: ProjectJSON, message: string | null | undefined): Promise<string> {
    const name = projectName(project);
    if (!GitSyncService.isEnabled(name)) {
      throw new GitSyncError('Git sync is not enabled for this project — enable it first.');
    }
    const repo = GitSyncService.repoDirectory(name);
    return enqueue(async () => {
      writeProjectFile(project, repo);
      const trimmedMessage = message?.trim();
      const committed = await commitIfDirty(repo, trimmedMessage && trimmedMessage.length > 0 ? trimmedMessage : 'manual commit');
      return committed ? 'Committed.' : 'Nothing to commit — repo already up to date.';
    });
  },

  async status(projectNameValue: string): Promise<string> {
    if (!GitSyncService.isEnabled(projectNameValue)) {
      return 'Git sync: OFF. enable_git_sync starts a local repo with full history for this project.';
    }
    const repo = GitSyncService.repoDirectory(projectNameValue);
    const branch = (await runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'main')).trim() || 'main';
    const count = (await runGit(repo, ['rev-list', '--count', 'HEAD']).catch(() => '0')).trim() || '0';
    const dirty = (await runGit(repo, ['status', '--porcelain']).catch(() => ''))
      .split('\n').filter((line) => line.length > 0).length;
    const remote = await GitSyncService.remoteURL(projectNameValue);
    const log = (await runGit(repo, ['log', '--oneline', '-5']).catch(() => '(no commits yet)')).trim() || '(no commits yet)';
    return [
      `Git sync: ON — ${repo}`,
      `Branch: ${branch} · ${count} commit(s) · ${dirty} uncommitted change(s)`,
      `Remote: ${remote ?? 'none — push_to_github publishes this repo'}`,
      'Recent commits:',
      log,
    ].join('\n');
  },

  async remoteURL(projectNameValue: string): Promise<string | null> {
    const repo = GitSyncService.repoDirectory(projectNameValue);
    const url = (await runGit(repo, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
    return url.length > 0 ? url : null;
  },

  /// Publishes the repo. With an existing `origin` it just pushes; otherwise it
  /// creates the GitHub repo via the `gh` CLI (which must be installed + authed).
  async push(project: ProjectJSON, repoName: string | null | undefined, isPrivate: boolean): Promise<string> {
    const name = projectName(project);
    if (!GitSyncService.isEnabled(name)) {
      throw new GitSyncError('Git sync is not enabled for this project — enable it first.');
    }
    const repo = GitSyncService.repoDirectory(name);
    // Never push a stale tree: capture the current project state first.
    await enqueue(async () => {
      writeProjectFile(project, repo);
      await commitIfDirty(repo, 'pre-push snapshot');
    });
    const hasHead = await runGit(repo, ['rev-parse', 'HEAD']).then(() => true, () => false);
    if (!hasHead) {
      throw new GitSyncError('Repo has no commits yet — commit before pushing.');
    }

    const existing = await GitSyncService.remoteURL(name);
    if (existing) {
      await runGit(repo, ['push', '-u', 'origin', 'HEAD']);
      return `Pushed to ${existing}`;
    }

    const gh = GitSyncService.ghPath;
    if (!gh) {
      throw new GitSyncError(
        "No 'origin' remote and the GitHub CLI (gh) is not installed. Either "
        + '`brew install gh && gh auth login`, or add a remote manually: '
        + `git -C "${repo}" remote add origin <url> && git push -u origin main`,
      );
    }
    const normalized = normalizedRepoName(repoName ?? name);
    const output = await run(gh, [
      'repo', 'create', normalized,
      isPrivate ? '--private' : '--public',
      '--source', repo,
      '--push',
    ], repo);
    const created = (await GitSyncService.remoteURL(name)) ?? normalized;
    return `Created GitHub repo and pushed: ${created}\n${output.trim()}`;
  },

  get ghPath(): string | null {
    return ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'].find((candidate) => isExecutableFile(candidate)) ?? null;
  },

  normalizedRepoName,
};

// MARK: - Internals

function writeProjectFile(project: ProjectJSON, repo: string): void {
  // Pretty + sorted keys → line-stable JSON, so git diffs show the actual change.
  writeFileAtomic(path.join(repo, 'project.agenticdesign'), prettySortedJSON(project));
}

/// Stages everything and commits only when the tree actually changed.
async function commitIfDirty(repo: string, message: string): Promise<boolean> {
  await runGit(repo, ['add', '-A']);
  const porcelain = await runGit(repo, ['status', '--porcelain']);
  if (porcelain.trim().length === 0) return false;
  await runGit(repo, ['commit', '-m', message]);
  return true;
}

function normalizedRepoName(name: string): string {
  const lowered = name.toLowerCase();
  let mapped = '';
  for (const character of lowered) {
    mapped += /[\p{L}\p{N}\-_.]/u.test(character) ? character : '-';
  }
  const collapsed = mapped.replace(/--+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return collapsed.length === 0 ? 'agentic-app' : collapsed;
}

function runGit(repo: string, args: string[]): Promise<string> {
  return run(gitPath, ['-C', repo, ...args]);
}

async function run(executable: string, args: string[], workingDirectory?: string): Promise<string> {
  // GUI apps inherit a minimal PATH; gh shells out to git and expects both.
  const env = { ...process.env, PATH: extendedPATH() };
  let result;
  try {
    result = await runProcess(executable, args, { cwd: workingDirectory, env });
  } catch (error) {
    if (error instanceof ProcessLaunchError) {
      throw new GitSyncError(`${path.basename(executable)} ${args[0] ?? ''} failed: ${error.message}`);
    }
    throw error;
  }
  if (result.status !== 0) {
    throw new GitSyncError(`${path.basename(executable)} ${args[0] ?? ''} failed: ${result.output.trim()}`);
  }
  return result.output;
}
