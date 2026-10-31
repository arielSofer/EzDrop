import { describe, expect, it } from 'vitest';
import { makeDesignNode, type DesignNode } from '../../models/DesignNode';
import { SnapEngine } from '../SnapEngine';
import { nodeGeometry } from '../NodeGeometry';

function node(x: number, y: number, width: number, height: number, name = 'n'): DesignNode {
  return makeDesignNode({
    type: 'Rectangle', name, x, y, width, height,
    style: { fill: '#FFFFFF', cornerRadius: 0, opacity: 1 },
  });
}

// SnapEngine.swift 15: threshold = 6, and 51/66 snap on `distance < bestDistance`.
describe('SnapEngine.snap', () => {
  it('1. left edge snaps to a target left edge inside the threshold', () => {
    const dragged = node(0, 0, 100, 50);
    const target = node(100, 500, 100, 50);
    const result = SnapEngine.snap(dragged, 103, 0, [target]);
    expect(result.x).toBe(100);
    expect(result.guides.verticalX).toBe(100);
    expect(result.y).toBe(0);
    expect(result.guides.horizontalY).toBeUndefined();
  });

  it('2. no snap at exactly the threshold distance (6 is not < 6)', () => {
    const dragged = node(0, 0, 100, 50);
    const target = node(100, 500, 100, 50);
    const result = SnapEngine.snap(dragged, 106, 0, [target]);
    expect(result.x).toBe(106);
    expect(result.guides.verticalX).toBeUndefined();
  });

  it('3. centre-to-centre snap wins over farther edge anchors', () => {
    const dragged = node(0, 0, 50, 50);
    const target = node(100, 500, 100, 50); // left 100, centerX 150, right 200
    const result = SnapEngine.snap(dragged, 124, 0, [target]); // centerX 149
    expect(result.x).toBe(125);
    expect(result.guides.verticalX).toBe(150);
  });

  it('4. the dragged right edge snaps to a target left edge', () => {
    const dragged = node(0, 0, 100, 50);
    const target = node(100, 500, 100, 50);
    const result = SnapEngine.snap(dragged, 2, 0, [target]); // right = 102
    expect(result.x).toBe(0);
    expect(result.guides.verticalX).toBe(100);
  });

  it('5. the Y axis snaps independently of X', () => {
    const dragged = node(0, 0, 100, 50);
    const target = node(900, 100, 100, 50);
    const result = SnapEngine.snap(dragged, 0, 97, [target]);
    expect(result.x).toBe(0);
    expect(result.guides.verticalX).toBeUndefined();
    expect(result.y).toBe(100);
    expect(result.guides.horizontalY).toBe(100);
  });

  it('6. with several targets the closest anchor wins', () => {
    const dragged = node(0, 0, 40, 40);
    const far = node(100, 0, 40, 40);
    const near = node(104, 0, 40, 40);
    const result = SnapEngine.snap(dragged, 107, 500, [far, near]);
    expect(result.x).toBe(104);
    expect(result.guides.verticalX).toBe(104);
    // No target is near y = 500.
    expect(result.y).toBe(500);
    expect(result.guides.horizontalY).toBeUndefined();
  });

  it('leaves the dragged node itself untouched (Swift copies it)', () => {
    const dragged = node(0, 0, 100, 50);
    SnapEngine.snap(dragged, 103, 97, [node(100, 100, 100, 50)]);
    expect(dragged.x).toBe(0);
    expect(dragged.y).toBe(0);
  });
});

// NodeGeometry.swift 11-64
describe('NodeGeometry', () => {
  it('exposes the Swift computed properties', () => {
    const g = nodeGeometry(node(10, 20, 100, 50));
    expect(g.left).toBe(10);
    expect(g.top).toBe(20);
    expect(g.right).toBe(110);
    expect(g.bottom).toBe(70);
    expect(g.centerX).toBe(60);
    expect(g.centerY).toBe(45);
    expect(g.center).toEqual({ x: 60, y: 45 });
    expect(g.rect).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });
});
