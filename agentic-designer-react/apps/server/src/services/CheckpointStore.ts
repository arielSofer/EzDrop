// Ported 1:1 from AgenticDesigner/Services/CheckpointStore.swift
//
// Persisted project checkpoints — the "iterate fearlessly" loop. A snapshot
// is written automatically before every agent generation (and on demand),
// so any AI change can be rolled back even after the app restarts.
import fs from 'node:fs';
import path from 'node:path';
import { agenticSupportDirectory, contentModificationDate, ensureDirectory, pathExtension } from '../platform/Paths.js';
import { compactJSON } from '../platform/json.js';
import { GitSyncService, type ProjectJSON } from './GitSyncService.js';

export interface ProjectCheckpoint {
  /// The checkpoint file path (Swift: `id: URL`).
  id: string;
  label: string;
  /// ms since epoch
  date: number;
  url: string;
}

export const CheckpointStore = {
  maxCheckpointsPerProject: 40,

  root(): string {
    return agenticSupportDirectory('Checkpoints');
  },

  directory(projectName: string): string {
    const safe = projectName.replaceAll('/', '-').replaceAll(':', '-');
    return path.join(CheckpointStore.root(), safe.length === 0 ? 'Untitled' : safe);
  },

  // MARK: - Save

  save(project: ProjectJSON, label: string): ProjectCheckpoint | null {
    const name = typeof project.name === 'string' ? project.name : '';
    const dir = CheckpointStore.directory(name);
    try {
      ensureDirectory(dir);
      const data = compactJSON(project);

      const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
      const safeLabel = Array.from(label.replaceAll('/', '-')).slice(0, 60).join('');
      const url = path.join(dir, `${stamp}__${safeLabel}.json`);
      fs.writeFileSync(url, data, 'utf8');
      prune(dir);
      // Same snapshot, real history: when git sync is on, every checkpoint
      // is also a commit in the project's repo (background, non-blocking).
      GitSyncService.recordCheckpoint(project, safeLabel);
      return { id: url, url, label: safeLabel, date: Date.now() };
    } catch (error) {
      console.log(`⚠️ Checkpoint save failed: ${(error as Error).message}`);
      return null;
    }
  },

  // MARK: - List / load

  list(projectName: string): ProjectCheckpoint[] {
    const dir = CheckpointStore.directory(projectName);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names
      .filter((fileName) => pathExtension(fileName) === 'json')
      .map((fileName) => {
        const url = path.join(dir, fileName);
        const base = fileName.slice(0, -'.json'.length);
        const parts = base.split('__');
        const date = contentModificationDate(url);
        return { id: url, url, label: parts.length > 1 ? parts.slice(1).join('__') : base, date };
      })
      .sort((a, b) => b.date - a.date);
  },

  load(checkpoint: Pick<ProjectCheckpoint, 'url'>): ProjectJSON {
    const data = fs.readFileSync(checkpoint.url, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The data couldn’t be read because it isn’t in the correct format.');
    }
    return parsed as ProjectJSON;
  },
};

function prune(dir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const checkpoints = names
    .filter((fileName) => pathExtension(fileName) === 'json')
    .map((fileName) => path.join(dir, fileName))
    .sort((a, b) => contentModificationDate(b) - contentModificationDate(a));
  for (const stale of checkpoints.slice(CheckpointStore.maxCheckpointsPerProject)) {
    try {
      fs.rmSync(stale);
    } catch {
      // ignore
    }
  }
}
