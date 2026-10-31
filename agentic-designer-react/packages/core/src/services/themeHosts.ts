// Host interfaces for the deterministic project-mutating services
// (ThemeApplier, BrandKit, BackendWiringGenerator, ComposedAppGenerator,
// AppBuildOrchestrator).
//
// The Swift versions take a `ProjectViewModel` (an ObservableObject) and write
// straight into its value-typed `project`. The port depends only on the members
// each service actually touches — names verbatim — so the web app's zustand
// store satisfies them structurally without inheriting anything.

import type { DesignAction } from '../agent/DesignAction';
import type { DesignHostForLogic, RawChatProvider } from './hosts';
import type { DesignProject } from '../models/DesignProject';
import type { JSONObject } from '../models/JSON';

// MARK: - ThemeApplier / BrandKit → ProjectViewModel

/**
 * Exactly the `ProjectViewModel` members `Services/ThemeApplier.swift` and
 * `Services/BrandKit.swift` touch: they read `viewModel.project`, rebuild it
 * as a value, and hand the whole document back through `replaceProject(_:)`.
 * (Neither calls `snapshot()` — the caller checkpoints before re-theming.)
 */
export interface ThemeHost {
  /** `project` — read only; both services rewrite a local copy. */
  readonly project: DesignProject;
  /** `replaceProject(_:)` */
  replaceProject(project: DesignProject): void;
}

// MARK: - Document mutation

/**
 * The document members `Services/BackendWiringGenerator.swift` uses
 * (`design.project`, `design.currentPageIndex`, and direct writes into
 * `design.project.pages[...]` / `.globalVariables` / `.firebaseConfig`).
 * A store cannot observe direct property writes, so every Swift `design.project.x = y`
 * becomes one `mutateProject` call that applies `update` to the live document
 * and publishes. Structurally identical to `DesignHostForLogic` minus
 * `setLogicBinding`, so one store implementation satisfies both.
 */
export interface DesignDocumentHost {
  readonly project: DesignProject;
  readonly currentPageIndex: number;
  mutateProject(update: (project: DesignProject) => void): void;
}

/**
 * `BackendWiringGenerator.wire(prompt:design:logic:blueprint:)`'s `design`.
 * It also hands the same view model to `logic.attach(to:)`, so it is exactly
 * `DesignHostForLogic` (document + `setLogicBinding`).
 */
export type BackendDesignHost = DesignHostForLogic;

/**
 * The `ProjectViewModel` members `Services/ComposedAppGenerator.swift` uses on
 * top of the document: it clears the page, applies decoded DesignActions and
 * patches generated images in.
 */
export interface ComposedDesignHost extends DesignDocumentHost {
  /** `applyDesignActions(_:) -> [String: UUID]` (reference name → node id). */
  applyDesignActions(actions: DesignAction[]): Record<string, string>;
  /** `setGeneratedImage(nodeId:imagePath:)` */
  setGeneratedImage(nodeId: string, imagePath: string): void;
}

/**
 * `AppBuildOrchestrator.design` — the composed host, plus `replaceProject`
 * (restore) and the logic-side `setLogicBinding` (it hands the same view
 * model to ComposedLogicGenerator and BackendWiringGenerator).
 */
export interface OrchestratorDesignHost extends ComposedDesignHost, ThemeHost, DesignHostForLogic {}

// MARK: - Model provider

/** `OpenRouterMessage(role:content:imageDataURLs:)` as the composer builds it. */
export interface ComposerMessage {
  role: string;
  content: string;
  imageDataURLs?: string[];
}

/**
 * The two `OpenRouterProvider` members `ComposedAppGenerator.swift` calls.
 * The ported OpenRouterProvider satisfies this structurally.
 */
export interface ComposerProvider {
  /** `generateConstrainedJSON(messages:schema:)` */
  generateConstrainedJSON(messages: ComposerMessage[], schema: JSONObject): Promise<string>;
  /** `generateImageAsset(prompt:assetKind:aspectRatio:resolution:size:) -> String` (a file path). */
  generateImageAsset(
    prompt: string,
    assetKind: string | undefined,
    aspectRatio: string | undefined,
    resolution: string | undefined,
    size: string | undefined,
  ): Promise<string>;
}

/** `SpriteGenerator` only needs the image half. */
export type ImageAssetProvider = Pick<ComposerProvider, 'generateImageAsset'>;

// MARK: - AppBuildOrchestrator collaborators

/** `DesignAgentService.Settings` — the two members the orchestrator reads. */
export interface AgentSettings {
  model: string;
  /** `resolvedAPIKey()` */
  resolvedAPIKey(): string | undefined;
}

/** `DesignAgentService.Settings.current()` + `OpenRouterProvider(apiKey:model:temperature:)`. */
export interface AgentProviderFactory {
  current(): AgentSettings;
  makeProvider(apiKey: string, model: string, temperature: number): ComposerProvider & RawChatProvider;
}

/** `DesignAgentService(viewModel:pipeline:).runFullPipeline(prompt:)`. */
export interface DetailedDesignPipeline {
  runFullPipeline(prompt: string): Promise<{ appliedActionCount: number }>;
}

// MARK: - CheckpointStore → GitSyncService

/**
 * `GitSyncService.recordCheckpoint(project:label:)` — the one call
 * `Services/CheckpointStore.swift` makes into git sync (fire-and-forget).
 */
export interface GitSyncHook {
  recordCheckpoint(project: DesignProject, label: string): void;
}

/** The Swift no-op when git sync is disabled for the project. */
export const NullGitSyncHook: GitSyncHook = {
  recordCheckpoint() {},
};

// MARK: - GeneratedSourcePreview → swiftc

/** One parsed `swiftc` invocation: `xcrun -sdk iphonesimulator swiftc -typecheck …`. */
export interface TypecheckRunner {
  /**
   * Runs the compiler over `sourcePaths` (already written to disk by the
   * caller) and returns swiftc's combined stdout+stderr with its exit status.
   */
  run(sourcePaths: string[]): Promise<{ status: number; output: string }>;
}

// MARK: - SpriteGenerator → CoreGraphics/ImageIO

/** RGBA8 pixel buffer — the shape `flipHorizontal` operates on. */
export interface RGBAImage {
  width: number;
  height: number;
  /** width * height * 4 bytes, row-major, RGBA (premultipliedLast). */
  pixels: Uint8Array;
}

/**
 * PNG encode/decode, standing in for `NSImage(contentsOfFile:)` +
 * `CGImageDestination`. The server implements it (sharp / pngjs); the browser
 * with a canvas.
 */
export interface ImageCodec {
  decodePNG(bytes: Uint8Array): RGBAImage;
  encodePNG(image: RGBAImage): Uint8Array;
}

/**
 * `VNGenerateForegroundInstanceMaskRequest` + `generateMaskedImage(croppedToInstancesExtent:)`
 * — the on-device subject lift. There is no browser/Node equivalent, so the
 * server implements it (Vision via a helper) and the default reports "no
 * subject", which is exactly the `SpriteGeneratorError.noSubjectFound` path.
 */
export interface SubjectMasker {
  /** Returns the cut-out image, or undefined when Vision found no subject. */
  cutout(image: RGBAImage): Promise<RGBAImage | undefined>;
}
