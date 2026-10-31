// `AgentRequestIntent` (Agent/AgentContext.swift) and `PresentationMode`
// (DesignIntelligence/VisualArtDirection.swift) — the two enums the view
// model keeps as private run state.
//
// Declared here as string-literal unions identical to the ones the core
// `@agentic/core/agent/AgentContext` and
// `@agentic/core/designIntelligence/VisualArtDirection` modules export, so the
// store compiles standalone; being literal unions they are structurally
// interchangeable with core's once those modules land (swap these for
// `export type { … } from …` at integration).

export const AllAgentRequestIntent = ['createNewDesign', 'editSelection', 'improveExistingCanvas'] as const;
export type AgentRequestIntent = (typeof AllAgentRequestIntent)[number];

export const AllPresentationMode = ['appScreen', 'presentationShot'] as const;
export type PresentationMode = (typeof AllPresentationMode)[number];
