// @agentic/core — pure TypeScript port of AgenticDesigner's model, design
// system, agent-protocol and platform-adapter layers. No DOM, no Node APIs.
export * from './models';
export * from './designSystem';
export * from './agent';
export * from './mcp';
export * from './platform';
export * from './helpers';
export * from './designIntelligence';

// Logic simulator, web compiler/exporter, composed logic generator and the
// Logic Mode view model (Services/LogicSimulator.swift, LogicWebCompiler.swift,
// WebExporter.swift, ComposedLogicGenerator.swift, ViewModels/LogicViewModel.swift).
export * from './services/hosts';
export * from './services/GeneratedFileTree';
export * from './services/LogicSimulator';
export * from './services/LogicWebCompiler';
export * from './services/WebExporter';
export * from './services/ComposedLogicGenerator';
export * from './viewModels/LogicViewModel';
export * from './models/GameCommand';
export * from './services/LogicExporter';

// PDF Editor mode engine — Services/PDFMathGuard.swift, PDFTextFitter.swift,
// PDFTextExtractor.swift, TranslationMemory.swift, plus the paragraph-detection
// rules that live inside ViewModels/PDFEditorViewModel.swift.
export * from './services/pdf/PDFMathGuard';
export * from './services/pdf/PDFTextFitter';
export * from './services/pdf/PDFTextExtractor';
export * from './services/pdf/TranslationMemory';
export * from './services/pdf/PDFParagraphDetector';

// Backend wiring, export/design audits, theming, component library,
// checkpoints, documents, code preview, sprites and the build orchestrator
// (Services/BackendWiringGenerator.swift, BackendBlueprint.swift,
// ExportReadiness.swift, DesignQualityAudit.swift, ThemeApplier.swift,
// BrandKit.swift, ComponentLibrary.swift, CheckpointStore.swift,
// ProjectDocumentService.swift, ComposedAppGenerator.swift,
// GeneratedSourcePreview.swift, SpriteGenerator.swift,
// AppBuildOrchestrator.swift). Named exports only — several of these Swift
// enums share member names (`audit`, `save`, `summary`, `generate`).
export * from './services/themeHosts';
export {
  BackendBlueprintLibrary,
  backendBlueprintCollections,
  type BackendBlueprint,
  type BackendBlueprintEntity,
} from './services/BackendBlueprint';
export {
  BackendWiringGenerator,
  makeBackendWiringResult,
  backendWiringResultIsEmpty,
  type BackendWiringResult,
} from './services/BackendWiringGenerator';
export {
  ExportReadiness,
  AllReadinessSeverity,
  type ReadinessFinding,
  type ReadinessSeverity,
} from './services/ExportReadiness';
export {
  DesignQualityAudit,
  AllDesignQualitySeverity,
  passesReferenceBar,
  blockerCount,
  warningCount,
  infoCount,
  type DesignQualityFinding,
  type DesignQualityReport,
  type DesignQualitySeverity,
} from './services/DesignQualityAudit';
export { ThemeApplier } from './services/ThemeApplier';
export { BrandKit } from './services/BrandKit';
export {
  ComponentLibrary,
  encodeSavedComponent,
  decodeSavedComponent,
  iso8601String,
  savedComponentWidth,
  savedComponentHeight,
  savedComponentChildCount,
  type SavedComponent,
} from './services/ComponentLibrary';
export {
  CheckpointStore,
  checkpointURL,
  maxCheckpointsPerProject,
  type ProjectCheckpoint,
} from './services/CheckpointStore';
export { ProjectDocumentService, ProjectDocumentError } from './services/ProjectDocumentService';
export {
  ComposedAppGenerator,
  decodeComposedApp,
  decodeComposedScreen,
  decodeComposedComponent,
  type ComposedApp,
  type ComposedScreen,
  type ComposedComponent,
  type ComposedAppResult,
} from './services/ComposedAppGenerator';
export {
  GeneratedSourcePreview,
  SwiftCodeHighlighter,
  CodeTheme,
  generatedSourceFileId,
  generatedSourceFileName,
  generatedSourceFileDirectory,
  generatedSourceFileLineCount,
  type GeneratedSourceFile,
  type CodeDiagnostic,
  type TypecheckResult,
  type HighlightToken,
  type HighlightedCode,
} from './services/GeneratedSourcePreview';
export {
  SpriteGenerator,
  SpriteGeneratorError,
  spriteGeneratorErrorDescription,
  flippedHorizontally,
  AllSpriteGeneratorErrorKind,
  type SpriteGenerationResult,
  type SpriteGeneratorDeps,
  type SpriteGeneratorErrorKind,
  type GenerateSpriteOptions,
} from './services/SpriteGenerator';
export {
  AppBuildOrchestrator,
  Stage,
  AllStage,
  AllBackendChoice,
  AllGenerationMode,
  makeBuildSummary,
  type BuildSummary,
  type BackendChoice,
  type GenerationMode,
  type BuildAppOptions,
  type AppBuildOrchestratorDeps,
} from './services/AppBuildOrchestrator';

export * from './learning';

