// Ported 1:1 from AgenticDesigner/Services/CheckpointStore.swift
//
// Persisted project checkpoints — the "iterate fearlessly" loop. A snapshot
// is written automatically before every agent generation (and on demand),
// so any AI change can be rolled back even after the app restarts. The
// in-memory undo stack covers small edits; this covers "the agent redid my
// whole screen and I want yesterday's version back."

import { decodeDesignProject, encodeDesignProject } from '../models/codec';
import type { DesignProject } from '../models/DesignProject';
import type { FileSystem } from '../platform/FileSystem';
import { getPlatform } from '../platform/platform';
import { iso8601String } from './ComponentLibrary';
import { NullGitSyncHook, type GitSyncHook } from './themeHosts';

export interface ProjectCheckpoint {
  /** `let id: URL` — the checkpoint file's path. */
  id: string;
  label: string;
  /** ms since the Unix epoch. */
  date: number;
}

/** `ProjectCheckpoint.url` */
export function checkpointURL(checkpoint: ProjectCheckpoint): string {
  return checkpoint.id;
}

export const maxCheckpointsPerProject = 40;

function fileSystem(fs?: FileSystem): FileSystem {
  return fs ?? getPlatform().fileSystem;
}

/** `CheckpointStore.root` */
export function rootDirectory(fs?: FileSystem): string {
  const system = fileSystem(fs);
  return system.join(system.applicationSupportDirectory(), 'Checkpoints');
}

/** `CheckpointStore.directory(for:)` */
export function directory(projectName: string, fs?: FileSystem): string {
  const system = fileSystem(fs);
  const safe = projectName.split('/').join('-').split(':').join('-');
  return system.join(rootDirectory(system), safe.length === 0 ? 'Untitled' : safe);
}

// MARK: - Save

/** `CheckpointStore.save(_:label:)` */
export async function save(
  project: DesignProject,
  label: string,
  options: { fs?: FileSystem; git?: GitSyncHook } = {},
): Promise<ProjectCheckpoint | undefined> {
  const system = fileSystem(options.fs);
  const git = options.git ?? NullGitSyncHook;
  const dir = directory(project.name, system);
  try {
    await system.mkdirp(dir);
    const data = JSON.stringify(encodeDesignProject(project));

    const now = getPlatform().clock.now();
    const stamp = iso8601String(now).split(':').join('-');
    const safeLabel = [...label.split('/').join('-')].slice(0, 60).join('');
    const path = system.join(dir, `${stamp}__${safeLabel}.json`);
    await system.writeText(path, data);
    await prune(dir, system);
    // Same snapshot, real history: when git sync is on, every checkpoint
    // is also a commit in the project's repo (background, non-blocking).
    git.recordCheckpoint(project, safeLabel);
    return { id: path, label: safeLabel, date: now };
  } catch (error) {
    getPlatform().logger.error(`⚠️ Checkpoint save failed: ${String(error)}`);
    return undefined;
  }
}

// MARK: - List / load

/** `CheckpointStore.list(projectName:)` — newest first. */
export async function list(projectName: string, fs?: FileSystem): Promise<ProjectCheckpoint[]> {
  const system = fileSystem(fs);
  const dir = directory(projectName, system);
  let names: string[];
  try {
    names = await system.readdir(dir);
  } catch {
    return [];
  }
  const checkpoints: ProjectCheckpoint[] = [];
  for (const fileName of names) {
    if (!fileName.endsWith('.json')) continue;
    const path = system.join(dir, fileName);
    const name = fileName.slice(0, -'.json'.length);
    const parts = name.split('__');
    const stat = await system.stat(path);
    // `.distantPast` when the modification date can't be read.
    const date = stat?.modifiedAt ?? DISTANT_PAST_MS;
    checkpoints.push({ id: path, label: parts.length > 1 ? parts[1]! : name, date });
  }
  return checkpoints.sort((a, b) => b.date - a.date);
}

/** `CheckpointStore.load(_:)` */
export async function load(checkpoint: ProjectCheckpoint, fs?: FileSystem): Promise<DesignProject> {
  const system = fileSystem(fs);
  const text = await system.readText(checkpointURL(checkpoint));
  return decodeDesignProject(JSON.parse(text));
}

/** Swift `Date.distantPast` as ms since the Unix epoch. */
export const DISTANT_PAST_MS = -62_135_769_600_000;

async function prune(dir: string, system: FileSystem): Promise<void> {
  let names: string[];
  try {
    names = await system.readdir(dir);
  } catch {
    return;
  }
  const entries: { path: string; date: number }[] = [];
  for (const fileName of names) {
    if (!fileName.endsWith('.json')) continue;
    const path = system.join(dir, fileName);
    const stat = await system.stat(path);
    entries.push({ path, date: stat?.modifiedAt ?? DISTANT_PAST_MS });
  }
  entries.sort((a, b) => b.date - a.date);
  for (const stale of entries.slice(maxCheckpointsPerProject)) {
    try {
      await system.remove(stale.path);
    } catch {
      // `try?`
    }
  }
}

/** Static members of the Swift `CheckpointStore` enum. */
export const CheckpointStore = {
  maxCheckpointsPerProject,
  save,
  list,
  load,
  directory,
  rootDirectory,
} as const;
