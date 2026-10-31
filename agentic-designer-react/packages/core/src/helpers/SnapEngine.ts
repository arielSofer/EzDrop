// Ported 1:1 from AgenticDesigner/Helpers/SnapEngine.swift

import type { DesignNode } from '../models/DesignNode';
import { nodeGeometry } from './NodeGeometry';
import type { SnapResult } from './SnapResult';

// נקודת הצמדה אחת
interface SnapAnchor {
  value: number;
}

// נקודות הצמדה בציר X: שמאל, מרכז, ימין
function xAnchors(node: DesignNode): SnapAnchor[] {
  const g = nodeGeometry(node);
  return [{ value: g.left }, { value: g.centerX }, { value: g.right }];
}

// נקודות הצמדה בציר Y: למעלה, מרכז, למטה
function yAnchors(node: DesignNode): SnapAnchor[] {
  const g = nodeGeometry(node);
  return [{ value: g.top }, { value: g.centerY }, { value: g.bottom }];
}

// מנוע שאחראי לחשב הצמדות בין אובייקטים בקנבס
export const SnapEngine = {
  // כמה קרוב צריך להיות כדי להידבק
  threshold: 6,

  // מחשב Snap עבור Node שנגרר למיקום חדש
  snap(draggedNode: DesignNode, proposedX: number, proposedY: number, otherNodes: DesignNode[]): SnapResult {
    // יוצרים עותק של ה־Node עם המיקום החדש שהמשתמש מנסה להגיע אליו
    const movedNode: DesignNode = { ...draggedNode, x: proposedX, y: proposedY };

    let finalX = proposedX;
    let finalY = proposedY;

    let verticalGuideX: number | undefined;
    let horizontalGuideY: number | undefined;

    let bestXDistance = SnapEngine.threshold;
    let bestYDistance = SnapEngine.threshold;

    const draggedXAnchors = xAnchors(movedNode);
    const draggedYAnchors = yAnchors(movedNode);

    for (const target of otherNodes) {
      const targetXAnchors = xAnchors(target);
      const targetYAnchors = yAnchors(target);

      // בדיקת Snap בציר X
      for (const draggedAnchor of draggedXAnchors) {
        for (const targetAnchor of targetXAnchors) {
          const distance = Math.abs(draggedAnchor.value - targetAnchor.value);

          if (distance < bestXDistance) {
            bestXDistance = distance;

            // מזיזים את ה־Node כך שהעוגן הנגרר יתיישר לעוגן היעד
            finalX = proposedX + (targetAnchor.value - draggedAnchor.value);
            verticalGuideX = targetAnchor.value;
          }
        }
      }

      // בדיקת Snap בציר Y
      for (const draggedAnchor of draggedYAnchors) {
        for (const targetAnchor of targetYAnchors) {
          const distance = Math.abs(draggedAnchor.value - targetAnchor.value);

          if (distance < bestYDistance) {
            bestYDistance = distance;

            // מזיזים את ה־Node כך שהעוגן הנגרר יתיישר לעוגן היעד
            finalY = proposedY + (targetAnchor.value - draggedAnchor.value);
            horizontalGuideY = targetAnchor.value;
          }
        }
      }
    }

    const guides: SnapResult['guides'] = {};
    if (verticalGuideX !== undefined) guides.verticalX = verticalGuideX;
    if (horizontalGuideY !== undefined) guides.horizontalY = horizontalGuideY;

    return { x: finalX, y: finalY, guides };
  },
};
