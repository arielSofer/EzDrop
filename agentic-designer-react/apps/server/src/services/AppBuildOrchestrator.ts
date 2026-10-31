// Ported from AgenticDesigner/Services/AppBuildOrchestrator.swift — the OS half.
//
// `buildApp` (design pipeline → wiring → backend → preview) runs against the
// live view models and therefore lives in the browser (apps/web). What the
// server owns is the disk side the orchestrator touches: the checkpoint it
// saves before every build, `restore(_:)` (load a checkpoint, snapshot the
// current project first so a restore is itself undoable), and the compile
// loop the typecheck_generated tool shares with the Recompile button.
import { CheckpointStore, type ProjectCheckpoint } from './CheckpointStore.js';
import { GeneratedSourcePreview, type TypecheckResult } from './GeneratedSourcePreview.js';
import type { ExportFiles } from './ExportWriter.js';
import type { ProjectJSON } from './GitSyncService.js';

export const Stage = {
  checkpoint: 'Saving checkpoint',
  designing: 'Designing screens',
  imaging: 'Generating images',
  wiring: 'Wiring logic',
  backend: 'Connecting backend',
  previewing: 'Opening preview',
} as const;
export type Stage = keyof typeof Stage;

export const AllGenerationModes = ['composed', 'detailed'] as const;
export type GenerationMode = (typeof AllGenerationModes)[number];

export const AllBackendChoices = ['firebase', 'none'] as const;
export type BackendChoice = (typeof AllBackendChoices)[number];

export const AppBuildOrchestrator = {
  /// Stage 0 of buildApp: `CheckpointStore.save(design.project, label: "before: <prompt prefix>")`.
  saveBuildCheckpoint(project: ProjectJSON, prompt: string): ProjectCheckpoint | null {
    return CheckpointStore.save(project, `before: ${Array.from(prompt).slice(0, 40).join('')}`);
  },

  // MARK: - Checkpoint restore

  /// Replaces the live project with a checkpoint (the current state is
  /// snapshotted first, so a restore is itself undoable). Returns the project
  /// the editor should install via `replaceProject`.
  restore(currentProject: ProjectJSON, checkpoint: Pick<ProjectCheckpoint, 'url'>): ProjectJSON {
    const restored = CheckpointStore.load(checkpoint);
    CheckpointStore.save(currentProject, 'before restore');
    return restored;
  },

  /// typecheck_generated / Code Mode "Recompile".
  typecheck(files: ExportFiles): Promise<TypecheckResult> {
    return GeneratedSourcePreview.typecheck(files);
  },
};
