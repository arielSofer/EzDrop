// Ported 1:1 from AgenticDesigner/Services/ProjectDocumentService.swift
//
// Save and open full AgenticDesigner projects as JSON documents. The
// NSOpenPanel / NSSavePanel halves are the browser's job; this is the disk half.
import fs from 'node:fs';
import path from 'node:path';
import { agenticSupportDirectory, contentModificationDate, ensureDirectory, expandingTildeInPath, pathExtension, writeFileAtomic } from '../platform/Paths.js';
import { prettySortedJSON } from '../platform/json.js';
import type { ProjectJSON } from './GitSyncService.js';

export class ProjectDocumentError extends Error {
  static cancelled(): ProjectDocumentError {
    return new ProjectDocumentError('Cancelled');
  }
}

export const ProjectDocumentService = {
  fileExtension: 'agenticdesign',

  /// save(project:path:) — an explicit path (absolute or ~/…) or the default
  /// Application Support/AgenticDesigner/SavedProjects/<name>.agenticdesign.
  save(project: ProjectJSON, pathValue?: string | null): string {
    const name = typeof project.name === 'string' ? project.name : '';
    let destination: string;
    if (pathValue && pathValue.trim().length > 0) {
      destination = expandingTildeInPath(pathValue);
    } else {
      destination = ProjectDocumentService.defaultSaveURL(name);
    }
    return write(project, destination);
  },

  load(pathValue: string): { project: ProjectJSON; url: string } {
    const url = expandingTildeInPath(pathValue);
    const data = fs.readFileSync(url, 'utf8');
    const parsed = JSON.parse(data);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('The data couldn’t be read because it isn’t in the correct format.');
    }
    return { project: parsed as ProjectJSON, url };
  },

  savedProjectsDirectory(): string {
    return agenticSupportDirectory('SavedProjects');
  },

  defaultSaveURL(projectName: string): string {
    const base = ProjectDocumentService.savedProjectsDirectory();
    ensureDirectory(base);
    return path.join(base, ProjectDocumentService.sanitizedFileName(projectName));
  },

  /// Everything in SavedProjects the open dialog can offer (newest first).
  listSavedProjects(): { path: string; name: string; modified: number }[] {
    const base = ProjectDocumentService.savedProjectsDirectory();
    let names: string[];
    try {
      names = fs.readdirSync(base);
    } catch {
      return [];
    }
    return names
      .filter((fileName) => ['agenticdesign', 'json'].includes(pathExtension(fileName)))
      .map((fileName) => {
        const full = path.join(base, fileName);
        return { path: full, name: fileName, modified: contentModificationDate(full) };
      })
      .sort((a, b) => b.modified - a.modified);
  },

  sanitizedFileName(name: string): string {
    const base = name.trim().replaceAll('/', '-');
    const safeBase = base.length === 0 ? 'Untitled Project' : base;
    const suffix = `.${ProjectDocumentService.fileExtension}`;
    return safeBase.endsWith(suffix) ? safeBase : `${safeBase}${suffix}`;
  },
};

function write(project: ProjectJSON, url: string): string {
  const destination = pathExtension(url).length === 0 ? `${url}.${ProjectDocumentService.fileExtension}` : url;
  ensureDirectory(path.dirname(destination));
  writeFileAtomic(destination, prettySortedJSON(project));
  return destination;
}
