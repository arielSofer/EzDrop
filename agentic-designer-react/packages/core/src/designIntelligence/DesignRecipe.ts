// Ported 1:1 from AgenticDesigner/DesignIntelligence/DesignRecipe.swift
// (VisualStylePreset + LayoutPattern live in models/VisualStylePreset.ts and are
// re-exported here so call sites can keep importing them from this file.)

import type { AppCategory } from './AppCategory';
import type { ScreenType } from './ScreenType';
import type { LayoutPattern, VisualStylePreset } from '../models/VisualStylePreset';

export {
  AllVisualStylePreset,
  AllLayoutPattern,
  isVisualStylePreset,
} from '../models/VisualStylePreset';
export type { VisualStylePreset, LayoutPattern } from '../models/VisualStylePreset';

// מתכון עיצובי שמנחה את ה־Agent איך לבנות מסך איכותי
export interface DesignRecipe {
  category: AppCategory;
  screenType: ScreenType;
  recommendedStyle: VisualStylePreset;
  layoutPattern: LayoutPattern;
  requiredSections: string[];
  recommendedComponents: string[];
  qualityRules: string[];
  avoidRules: string[];
}
