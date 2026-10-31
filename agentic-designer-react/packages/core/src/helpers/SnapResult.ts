// Ported 1:1 from AgenticDesigner/Helpers/SnapResult.swift

// קווי עזר שמופיעים בזמן Snap
export interface SnapGuides {
  verticalX?: number;
  horizontalY?: number;
}

// תוצאה של חישוב Snap
export interface SnapResult {
  x: number;
  y: number;
  guides: SnapGuides;
}
