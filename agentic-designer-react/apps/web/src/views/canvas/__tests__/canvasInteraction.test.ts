// apps/web/src/views/canvas/__tests__/canvasInteraction.test.ts
//
// Tests verifying that node movements, child clamping, screen snapping,
// and canvas coordinate calculations never collapse coordinates to (0, 0).

import { describe, expect, it, beforeEach } from 'vitest';
import {
  makeDesignNode,
  makeDesignPage,
  makeDesignProject,
  makeNodeStyle,
  newUUID,
  SnapEngine,
} from '@agentic/core';
import { useProjectStore } from '../../../stores/projectStore';

describe('Canvas Interactions and Drag Geometry', () => {
  beforeEach(() => {
    const defaultStyle = makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 });

    const screen1 = makeDesignNode({
      id: 'screen-1',
      name: 'Home Screen',
      type: 'Frame',
      x: 80,
      y: 80,
      width: 393,
      height: 852,
      style: defaultStyle,
      children: [
        makeDesignNode({
          id: 'btn-1',
          name: 'Action Button',
          type: 'Button',
          x: 24,
          y: 200,
          width: 345,
          height: 50,
          style: defaultStyle,
        }),
      ],
    });

    const screen2 = makeDesignNode({
      id: 'screen-2',
      name: 'Live Run',
      type: 'Frame',
      x: 510,
      y: 80,
      width: 393,
      height: 852,
      style: defaultStyle,
      children: [],
    });

    const project = makeDesignProject({
      name: 'Running App',
      pages: [
        makeDesignPage({
          id: newUUID(),
          name: 'Main Page',
          nodes: [screen1, screen2],
        }),
      ],
    });

    useProjectStore.setState({
      project,
      currentPageIndex: 0,
      selectedNodeId: undefined,
      selectedNodeIds: new Set<string>(),
      undoStack: [],
      redoStack: [],
    });
  });

  it('moves a root screen smoothly by delta without jumping to (0,0)', () => {
    const store = useProjectStore.getState();
    const screen1 = store.node('screen-1');
    expect(screen1).toBeDefined();
    expect(screen1?.x).toBe(80);
    expect(screen1?.y).toBe(80);

    // Initial position on drag start
    const startX = screen1!.x;
    const startY = screen1!.y;

    // Simulate user dragging by 150px right and 30px down
    const totalDeltaX = 150;
    const totalDeltaY = 30;

    const proposedX = startX + totalDeltaX;
    const proposedY = startY + totalDeltaY;

    // Call moveNode as fixed in CanvasView
    store.moveNode('screen-1', proposedX, proposedY);

    const updated = useProjectStore.getState().node('screen-1');
    expect(updated?.x).toBe(230);
    expect(updated?.y).toBe(110);
    // Crucial check: it did NOT jump to (totalDeltaX, totalDeltaY) or (0, 0)!
    expect(updated?.x).not.toBe(150);
  });

  it('clamps a child element within its parent screen boundary', () => {
    const store = useProjectStore.getState();

    // btn-1 is inside screen-1 (width: 393, height: 852, btn width: 345, height: 50)
    // max X for child = 393 - 345 = 48
    // max Y for child = 852 - 50 = 802

    // Propose moving child far outside parent bounds
    const clampedOvershoot = store.clampedPositionForMove('btn-1', 100, 1000);
    expect(clampedOvershoot.x).toBe(48);
    expect(clampedOvershoot.y).toBe(802);

    // Propose moving child to negative coords
    const clampedNegative = store.clampedPositionForMove('btn-1', -50, -20);
    expect(clampedNegative.x).toBe(0);
    expect(clampedNegative.y).toBe(0);

    // Within bounds
    const clampedValid = store.clampedPositionForMove('btn-1', 24, 250);
    expect(clampedValid.x).toBe(24);
    expect(clampedValid.y).toBe(250);
  });

  it('snaps root screens when dragged near each other using SnapEngine', () => {
    const store = useProjectStore.getState();
    const screen2 = store.node('screen-2')!;
    const others = store.nodesExcluding('screen-2');

    // screen-1 is at y: 80.
    // Dragging screen-2 near y: 82 should snap its top edge to screen-1 at y: 80
    const snapResult = SnapEngine.snap(screen2, 510, 82, others);
    expect(snapResult.y).toBe(80);
    expect(snapResult.guides.horizontalY).toBe(80);
  });

  it('resizes child nodes within their local coordinate system', () => {
    const store = useProjectStore.getState();
    store.selectNode('btn-1');

    // Button starts at local x: 24, y: 200, w: 345, h: 50
    // Resize by +20w, +10h
    store.resizeSelectedNode(24, 200, 365, 60);

    const updatedBtn = useProjectStore.getState().node('btn-1');
    expect(updatedBtn?.x).toBe(24);
    expect(updatedBtn?.y).toBe(200);
    expect(updatedBtn?.width).toBe(365);
    expect(updatedBtn?.height).toBe(60);
  });
});
