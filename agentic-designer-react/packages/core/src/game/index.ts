// The game runtime's pure-TypeScript half: the registry logic blocks reach a
// live scene through, and the spec loader exported screens use. The playable
// scene itself is apps/web/src/game/AgentGameScene.ts (DOM + matter-js).
export * from './GameSceneRegistry';
export * from './GameSceneLoader';
