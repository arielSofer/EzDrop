import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setApplicationSupportDirectoryForTesting } from '../platform/Paths.js';
import { CheckpointStore } from '../services/CheckpointStore.js';
import { GitSyncService } from '../services/GitSyncService.js';
import { ProjectDocumentService } from '../services/ProjectDocumentService.js';
import { Settings } from '../services/Settings.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-git-test-'));
const project = { name: 'Demo/App', pages: [{ id: 'P1', name: 'Home', nodes: [] }], version: 1 };

beforeAll(() => {
  setApplicationSupportDirectoryForTesting(path.join(scratch, 'AppSupport'));
  process.env.AGENTIC_SETTINGS_PATH = path.join(scratch, 'settings.json');
  process.env.AGENTIC_DOT_DIR = scratch;
});

afterAll(() => {
  setApplicationSupportDirectoryForTesting(undefined);
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe.skipIf(!GitSyncService.isGitAvailable)('GitSyncService (GitSyncService.swift) against a temp Application Support', () => {
  it('reports OFF and refuses commits before enabling', async () => {
    expect(GitSyncService.isEnabled('Demo/App')).toBe(false);
    expect(await GitSyncService.status('Demo/App')).toBe('Git sync: OFF. enable_git_sync starts a local repo with full history for this project.');
    await expect(GitSyncService.commitNow(project, null)).rejects.toThrow('Git sync is not enabled for this project — enable it first.');
  });

  it('enables: creates the repo under GitRepos/<safe name> with README, .gitignore and the sorted project file', async () => {
    const repo = await GitSyncService.enable(project);
    expect(repo).toBe(path.join(scratch, 'AppSupport', 'AgenticDesigner', 'GitRepos', 'Demo-App'));
    expect(fs.existsSync(path.join(repo, '.git'))).toBe(true);
    expect(fs.readFileSync(path.join(repo, '.gitignore'), 'utf8')).toBe('.DS_Store\nxcuserdata/\nDerivedData/\nbuild/');
    expect(fs.readFileSync(path.join(repo, 'README.md'), 'utf8')).toContain('# Demo/App');
    const written = fs.readFileSync(path.join(repo, 'project.agenticdesign'), 'utf8');
    expect(written.startsWith('{\n  "name" : "Demo\\/App"')).toBe(true);
    expect(JSON.parse(written)).toEqual(project);
    expect(Settings.bool('gitSync.enabled.Demo-App')).toBe(true);
    expect(GitSyncService.isEnabled('Demo/App')).toBe(true);
  });

  it('status shows the branch, the initial commit and no remote', async () => {
    const status = await GitSyncService.status('Demo/App');
    expect(status).toContain('Git sync: ON — ');
    expect(status).toContain('Branch: main · 1 commit(s) · 0 uncommitted change(s)');
    expect(status).toContain('Remote: none — push_to_github publishes this repo');
    expect(status).toContain('Enable git sync');
  });

  it('commitNow is a no-op on a clean tree and commits real changes', async () => {
    expect(await GitSyncService.commitNow(project, null)).toBe('Nothing to commit — repo already up to date.');
    const changed = { ...project, pages: [{ id: 'P1', name: 'Home', nodes: [{ id: 'N1', type: 'Frame' }] }] };
    expect(await GitSyncService.commitNow(changed, '  add frame  ')).toBe('Committed.');
    expect(await GitSyncService.status('Demo/App')).toContain('2 commit(s)');
    expect(await GitSyncService.status('Demo/App')).toContain('add frame');
  });

  it('checkpoints auto-commit when sync is on, and CheckpointStore files follow the Swift naming', async () => {
    const checkpoint = CheckpointStore.save({ ...project, version: 2 }, 'before agent: x/y');
    expect(checkpoint).not.toBeNull();
    expect(path.basename(checkpoint!.url)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z__before agent: x-y\.json$/);
    expect(CheckpointStore.list('Demo/App')[0]!.label).toBe('before agent: x-y');
    // recordCheckpoint runs on the serial queue; a following commitNow observes it.
    expect(await GitSyncService.commitNow({ ...project, version: 2 }, null)).toBe('Nothing to commit — repo already up to date.');
    expect(await GitSyncService.status('Demo/App')).toContain('checkpoint: before agent: x-y');
  });

  it('mirrors exports into Exports/<kind> and commits', async () => {
    const source = path.join(scratch, 'export-src');
    fs.mkdirSync(path.join(source, 'Sources'), { recursive: true });
    fs.writeFileSync(path.join(source, 'Sources', 'App.swift'), 'import SwiftUI\n');
    expect(await GitSyncService.syncExport('Demo/App', 'SwiftPM', source)).toBe(`Git: export committed to ${GitSyncService.repoDirectory('Demo/App')}`);
    expect(fs.existsSync(path.join(GitSyncService.repoDirectory('Demo/App'), 'Exports', 'SwiftPM', 'Sources', 'App.swift'))).toBe(true);
    expect(await GitSyncService.status('Demo/App')).toContain('export: SwiftPM');
    expect(await GitSyncService.syncExport('Other', 'Xcode', source)).toBeNull();
  });

  it('push without a remote and without gh explains what to do', async () => {
    if (GitSyncService.ghPath) return; // gh present on this Mac — the create path would hit GitHub.
    await expect(GitSyncService.push(project, null, true)).rejects.toThrow("No 'origin' remote and the GitHub CLI (gh) is not installed.");
  });

  it('normalizes repo names like the Swift code', () => {
    expect(GitSyncService.normalizedRepoName('My Cool App!!')).toBe('my-cool-app');
    expect(GitSyncService.normalizedRepoName('---')).toBe('agentic-app');
  });

  it('disable turns the flag off but keeps the repo', async () => {
    GitSyncService.disable('Demo/App');
    expect(GitSyncService.isEnabled('Demo/App')).toBe(false);
    expect(fs.existsSync(path.join(GitSyncService.repoDirectory('Demo/App'), '.git'))).toBe(true);
  });
});

describe('ProjectDocumentService (ProjectDocumentService.swift)', () => {
  it('saves to SavedProjects with the .agenticdesign extension and loads back', () => {
    const saved = ProjectDocumentService.save(project, null);
    expect(saved).toBe(path.join(scratch, 'AppSupport', 'AgenticDesigner', 'SavedProjects', 'Demo-App.agenticdesign'));
    expect(ProjectDocumentService.load(saved).project).toEqual(project);
    const explicit = ProjectDocumentService.save(project, path.join(scratch, 'elsewhere', 'thing'));
    expect(explicit.endsWith('/elsewhere/thing.agenticdesign')).toBe(true);
    expect(ProjectDocumentService.listSavedProjects()[0]!.name).toBe('Demo-App.agenticdesign');
  });
});
