// Ported 1:1 from AgenticDesigner/DesignIntelligence/ComponentRegistry.swift
// The file contains only the ComponentType enum and its lenient decoder, which
// live in models/ComponentType.ts (the model layer); re-exported here so the
// Swift file's contents are reachable under its own name.

export {
  AllComponentType,
  decodeComponentType,
} from '../models/ComponentType';
export type { ComponentType } from '../models/ComponentType';
