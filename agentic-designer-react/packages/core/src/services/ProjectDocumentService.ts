// Ported 1:1 from AgenticDesigner/Services/ProjectDocumentService.swift
//
// Save and open full AgenticDesigner projects as JSON documents.
// (The NSOpenPanel / NSSavePanel halves are UI and live in the web app; this
// is the file half, on the FileSystem adapter.)

import { parseDesignProject, serializeDesignProject } from '../models/codec';
import type { DesignProject } from '../models/DesignProject';
import type { FileSystem } from '../platform/FileSystem';
import { getPlatform } from '../platform/platform';

export const fileExtension = 'agenticdesign';

/** `ProjectDocumentError` */
export class ProjectDocumentError extends Error {
  readonly kind: 'cancelled';
  constructor(kind: 'cancelled' = 'cancelled') {
    super('Cancelled');
    this.kind = kind;
    this.name = 'ProjectDocumentError';
  }
  /** `ProjectDocumentError.cancelled` */
  static get cancelled(): ProjectDocumentError {
    return new ProjectDocumentError('cancelled');
  }
}

function fileSystem(fs?: FileSystem): FileSystem {
  return fs ?? getPlatform().fileSystem;
}

/** `NSString.expandingTildeInPath` */
function expandingTildeInPath(path: string, system: FileSystem): string {
  if (path === '~') return system.homeDirectory();
  if (path.startsWith('~/')) return system.join(system.homeDirectory(), path.slice(2));
  return path;
}

/** `URL.pathExtension` */
function pathExtension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1);
}

/** `URL.deletingLastPathComponent()` */
function parentDirectory(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash <= 0 ? '/' : path.slice(0, slash);
}

/** `ProjectDocumentService.save(project:to:)` — `to` is a file path here. */
export async function save(project: DesignProject, to: string, fs?: FileSystem): Promise<string> {
  return write(project, to, fs);
}

/** `ProjectDocumentService.save(project:path:)` — nil/empty path → the default location. */
export async function saveToPath(
  project: DesignProject,
  path: string | undefined,
  fs?: FileSystem,
): Promise<string> {
  const system = fileSystem(fs);
  let destination: string;
  if (path !== undefined && path.trim().length > 0) {
    destination = expandingTildeInPath(path, system);
  } else {
    destination = defaultSaveURL(project.name, system);
  }
  return write(project, destination, system);
}

/** `ProjectDocumentService.load(from:)` */
export async function load(
  path: string,
  fs?: FileSystem,
): Promise<{ project: DesignProject; url: string }> {
  const system = fileSystem(fs);
  const url = expandingTildeInPath(path, system);
  const text = await system.readText(url);
  return { project: parseDesignProject(text), url };
}

/** `ProjectDocumentService.write(project:to:)` — pretty-printed + sorted keys, atomic. */
async function write(project: DesignProject, url: string, fs?: FileSystem): Promise<string> {
  const system = fileSystem(fs);
  const destination = pathExtension(url).length === 0 ? `${url}.${fileExtension}` : url;
  await system.mkdirp(parentDirectory(destination));
  await system.writeText(destination, serializeDesignProject(project));
  return destination;
}

/** `ProjectDocumentService.defaultSaveURL(for:)` */
export function defaultSaveURL(projectName: string, fs?: FileSystem): string {
  const system = fileSystem(fs);
  return system.join(system.applicationSupportDirectory(), 'SavedProjects', sanitizedFileName(projectName));
}

/** `ProjectDocumentService.sanitizedFileName(_:)` */
export function sanitizedFileName(name: string): string {
  const base = name.trim().split('/').join('-');
  const safeBase = base.length === 0 ? 'Untitled Project' : base;
  return safeBase.endsWith(`.${fileExtension}`) ? safeBase : `${safeBase}.${fileExtension}`;
}

/** Static members of the Swift `ProjectDocumentService` enum. */
export const ProjectDocumentService = {
  fileExtension,
  save,
  saveToPath,
  load,
  defaultSaveURL,
  sanitizedFileName,
} as const;
