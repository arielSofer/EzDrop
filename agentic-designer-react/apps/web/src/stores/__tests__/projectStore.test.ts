// Store tests for the ProjectViewModel port. Values come straight from
// AgenticDesigner/ViewModels/ProjectViewModel.swift.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  DevicePresetLibrary,
  getPlatform,
  makeDesignAction,
  makeDesignNode,
  makeDesignPage,
  makeDesignProject,
  makeNodeStyle,
  newUUID,
  resetTextMeasurer,
  type DesignNode,
  type DesignProject,
} from '@agentic/core';
import { useProjectStore, makeStarterProject, autoHugTextBoxes } from '../projectStore';

function setAutoHug(enabled: boolean): void {
  getPlatform().storage.set('autoHugTextBoxes', enabled ? 'true' : 'false');
}

function emptyProject(): DesignProject {
  return makeDesignProject({
    name: 'Test Project',
    pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [] })],
  });
}

function node(partial: Partial<DesignNode> & { name: string; x: number; y: number; width: number; height: number }): DesignNode {
  return makeDesignNode({
    id: partial.id ?? newUUID(),
    type: partial.type ?? 'Rectangle',
    name: partial.name,
    x: partial.x,
    y: partial.y,
    width: partial.width,
    height: partial.height,
    text: partial.text,
    style: partial.style ?? makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1 }),
    zIndex: partial.zIndex,
    children: partial.children ?? [],
  });
}

function reset(project: DesignProject = emptyProject()): void {
  useProjectStore.setState({
    project,
    selectedNodeId: undefined,
    selectedNodeIds: new Set<string>(),
    canvasFocusRequest: undefined,
    currentPageIndex: 0,
    undoStack: [],
    redoStack: [],
    currentAgentStylePreset: 'minimalEditorial',
    currentAgentRequestIntent: 'createNewDesign',
    currentAgentPresentationMode: 'appScreen',
    currentAgentUserPrompt: '',
    shouldAutoParentUnreferencedAgentActions: true,
    allowsRootScreenDeletion: false,
  });
}

const store = () => useProjectStore.getState();

beforeEach(() => {
  resetTextMeasurer();
  setAutoHug(true);
  reset();
});

describe('starter document', () => {
  it('builds the Swift starter screen', () => {
    const project = makeStarterProject();
    expect(project.name).toBe('Untitled Project');
    expect(project.pages).toHaveLength(1);
    expect(project.pages[0].name).toBe('App Screens');
    const frame = project.pages[0].nodes[0];
    expect(frame.name).toBe('Login Screen');
    expect(frame).toMatchObject({ x: 100, y: 100, width: 390, height: 844, type: 'Frame' });
    expect(frame.style).toMatchObject({ fill: '#111827', stroke: '#3B82F6', cornerRadius: 24, opacity: 1 });
    const [title, button] = frame.children;
    expect(title).toMatchObject({ name: 'Title', type: 'Text', x: 32, y: 80, text: 'Welcome Back' });
    expect(title.style.fontSize).toBe(32);
    expect(button).toMatchObject({ name: 'Login Button', type: 'Button', x: 32, y: 680, width: 326, height: 56 });
    expect(button.style).toMatchObject({ fill: '#2563EB', cornerRadius: 14, fontSize: 16, textColor: '#FFFFFF' });
  });

  it('reads autoHugTextBoxes from the "autoHugTextBoxes" key, default true', () => {
    getPlatform().storage.remove('autoHugTextBoxes');
    expect(autoHugTextBoxes()).toBe(true);
    setAutoHug(false);
    expect(autoHugTextBoxes()).toBe(false);
  });
});

describe('creation defaults', () => {
  it('addTextNode uses the 220x40 / 24pt / #000000 defaults and then hugs', () => {
    setAutoHug(false);
    store().addTextNode();
    const created = store().currentPage().nodes[0];
    expect(created).toMatchObject({ type: 'Text', name: 'Text', x: 160, y: 160, width: 220, height: 40, text: 'New Text' });
    expect(created.style).toMatchObject({ fill: '#000000', cornerRadius: 0, opacity: 1, fontSize: 24 });
    expect(store().selectedNodeId).toBe(created.id);
    expect(store().undoStack).toHaveLength(1);
  });

  it('addTextNode hugs the default box when autoHugTextBoxes is on', () => {
    setAutoHug(true);
    store().addTextNode();
    const created = store().currentPage().nodes[0];
    // ApproximateTextMeasurer: 8 chars × 24pt × 0.52 = 99.84 → 100; 24 × 1.193 → 29.
    expect(created.width).toBe(100);
    expect(created.height).toBe(29);
    expect(created.x).toBe(160);
  });

  it('addButtonNode / addFrameNode / addDeviceFrame / addImageNode / addIconNode defaults', () => {
    store().addButtonNode();
    expect(store().currentPage().nodes[0]).toMatchObject({
      type: 'Button', name: 'Button', x: 160, y: 230, width: 160, height: 48, text: 'Click me',
    });
    expect(store().currentPage().nodes[0].style).toMatchObject({ fill: '#2563EB', cornerRadius: 12, fontSize: 16 });

    reset();
    store().addFrameNode();
    expect(store().currentPage().nodes[0]).toMatchObject({
      type: 'Frame', name: 'Frame', x: 120, y: 120, width: 390, height: 844,
    });
    expect(store().currentPage().nodes[0].style).toMatchObject({
      fill: '#111827', stroke: '#3B82F6', cornerRadius: 24, opacity: 1,
    });

    reset();
    const preset = DevicePresetLibrary.iPhone15Pro;
    store().addDeviceFrame(preset);
    const device = store().currentPage().nodes[0];
    expect(device).toMatchObject({
      type: 'Frame', name: preset.name, x: 120, y: 120, width: preset.width, height: preset.height,
      devicePresetId: preset.id,
    });
    expect(device.style).toMatchObject({ fill: '#FFFFFF', stroke: '#E5E7EB', cornerRadius: preset.cornerRadius });

    reset();
    store().addImageNode();
    expect(store().currentPage().nodes[0]).toMatchObject({
      type: 'Image', name: 'Image', x: 160, y: 160, width: 260, height: 180,
    });
    expect(store().currentPage().nodes[0].style).toMatchObject({ fill: '#1E293B', cornerRadius: 12 });

    reset();
    store().addImageNodeWithSource('/tmp/photo.png');
    expect(store().currentPage().nodes[0]).toMatchObject({
      type: 'Image', name: 'Photo', x: 180, y: 180, width: 360, height: 240,
      imageName: '/tmp/photo.png', imageSource: '/tmp/photo.png', contentMode: 'fill',
    });
    expect(store().currentPage().nodes[0].style).toMatchObject({ fill: '#E5E7EB', cornerRadius: 0 });

    reset();
    store().addIconNode();
    expect(store().currentPage().nodes[0]).toMatchObject({
      type: 'Icon', name: 'Icon', x: 160, y: 160, width: 48, height: 48, iconName: 'star',
    });
    expect(store().currentPage().nodes[0].style).toMatchObject({ fill: '#00000000', textColor: '#FFFFFF' });
  });

  it('addArtboard offsets by 48 per existing frame and clips', () => {
    store().addFrameNode();
    store().addArtboard('Poster', 1000, 1800);
    const artboard = store().currentPage().nodes[1];
    expect(artboard).toMatchObject({ name: 'Poster', x: 168, y: 148, width: 1000, height: 1800, clipContent: true });
    expect(artboard.style.shadow).toEqual({ color: '#0F172A', opacity: 0.12, radius: 20, x: 0, y: 12 });
  });

  it('addMizmorShapeArtboard is an arch with archTopRadius 500', () => {
    store().addMizmorShapeArtboard();
    const artboard = store().currentPage().nodes[0];
    expect(artboard).toMatchObject({ name: 'Mizmor Shape 100x180cm', width: 1000, height: 1800 });
    expect(artboard.style.archTopRadius).toBe(500);
  });

  it('addMizmorLetodahArtboard builds the background plus 13 lines and selects the text', () => {
    store().addMizmorLetodahArtboard();
    const artboard = store().currentPage().nodes[0];
    expect(artboard.children).toHaveLength(14);
    expect(artboard.children[0]).toMatchObject({ name: 'Mizmor Background', zIndex: -100, contentMode: 'fill' });
    expect(artboard.children[1]).toMatchObject({ name: 'Mizmor Letodah Line 1', x: 70, y: 90, width: 860, height: 110 });
    expect(artboard.children[1].style).toMatchObject({ fontSize: 56, fontFamily: 'Arial Hebrew', textAlign: 'right', lineHeight: 125 });
    expect(store().selectedNodeIds.size).toBe(13);
  });
});

describe('selection', () => {
  const screenId = newUUID();
  const cardId = newUUID();
  const labelId = newUUID();
  const backdropId = newUUID();

  beforeEach(() => {
    reset(
      makeDesignProject({
        name: 'Selection',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: screenId, type: 'Frame', name: 'Home Screen', x: 0, y: 0, width: 390, height: 844,
                children: [
                  node({ id: backdropId, name: 'Background Wash', x: 0, y: 0, width: 390, height: 844, zIndex: -1 }),
                  node({ id: cardId, type: 'Frame', name: 'Card', x: 20, y: 40, width: 200, height: 100,
                    children: [node({ id: labelId, type: 'Text', name: 'Label', x: 10, y: 10, width: 60, height: 20, text: 'Hi' })] }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('selectNode keeps selectedNodeIds consistent (the didSet)', () => {
    store().selectNode(cardId);
    expect(store().selectedNodeId).toBe(cardId);
    expect([...store().selectedNodeIds]).toEqual([cardId]);

    store().clearSelection();
    expect(store().selectedNodeId).toBeUndefined();
    expect(store().selectedNodeIds.size).toBe(0);
  });

  it('selectAndRevealNode emits a fresh canvasFocusRequest each time', () => {
    store().selectAndRevealNode(cardId);
    const first = store().canvasFocusRequest;
    store().selectAndRevealNode(cardId);
    const second = store().canvasFocusRequest;
    expect(first?.nodeId).toBe(cardId);
    expect(second?.nodeId).toBe(cardId);
    expect(second?.requestId).not.toBe(first?.requestId);
  });

  it('toggleNodeInSelection adds, removes and re-points the primary', () => {
    store().selectNode(cardId);
    store().toggleNodeInSelection(labelId);
    expect(store().selectedNodeId).toBe(labelId);
    expect(store().selectedNodeIds.size).toBe(2);

    store().toggleNodeInSelection(labelId);
    expect(store().selectedNodeIds.has(labelId)).toBe(false);
    expect(store().selectedNodeId).toBe(cardId);
  });

  it('selectNodes picks direct children of screen roots and skips pass-through nodes', () => {
    store().selectNodes({ x: 0, y: 0, width: 390, height: 844 });
    expect([...store().selectedNodeIds]).toEqual([cardId]);
    expect(store().selectedNodeId).toBe(cardId);
  });

  it('selectNodes with a zero-size rect clears (or keeps when extending)', () => {
    store().selectNode(cardId);
    store().selectNodes({ x: 10, y: 10, width: 0, height: 0 }, true);
    expect(store().selectedNodeId).toBe(cardId);
    store().selectNodes({ x: 10, y: 10, width: 0, height: 0 });
    expect(store().selectedNodeId).toBeUndefined();
  });

  it('shouldBeginMarqueeSelection is true for screen roots and pass-through backdrops', () => {
    expect(store().shouldBeginMarqueeSelection(screenId)).toBe(true);
    expect(store().shouldBeginMarqueeSelection(backdropId)).toBe(true);
    expect(store().shouldBeginMarqueeSelection(cardId)).toBe(false);
  });

  it('deleteSelectedNode removes every selected node and snapshots once', () => {
    store().selectNode(cardId);
    store().deleteSelectedNode();
    expect(store().node(cardId)).toBeUndefined();
    expect(store().undoStack).toHaveLength(1);
    expect(store().selectedNodeId).toBeUndefined();
  });
});

describe('hit testing', () => {
  const screenId = newUUID();
  const cardId = newUUID();
  const iconId = newUUID();
  const oversizedId = newUUID();

  beforeEach(() => {
    reset(
      makeDesignProject({
        name: 'Hit',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: screenId, type: 'Frame', name: 'Home Screen', x: 0, y: 0, width: 390, height: 844,
                children: [
                  node({
                    id: cardId, type: 'Frame', name: 'Card', x: 20, y: 20, width: 300, height: 200,
                    children: [
                      node({ id: oversizedId, name: 'Big Box', x: 0, y: 0, width: 300, height: 200 }),
                      node({ id: iconId, type: 'Icon', name: 'Star', x: 10, y: 10, width: 24, height: 24 }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('hitTestChain walks outermost → innermost and lets a small leaf beat a huge sibling', () => {
    const chain = store().hitTestChain({ x: 42, y: 42 });
    expect(chain).toEqual([screenId, cardId, iconId]);
  });

  it('topmost sibling wins when the areas are comparable', () => {
    const chain = store().hitTestChain({ x: 200, y: 100 });
    expect(chain).toEqual([screenId, cardId, oversizedId]);
  });

  it('an already-selected node under the cursor keeps the hit', () => {
    store().selectNode(oversizedId);
    const chain = store().hitTestChain({ x: 42, y: 42 });
    expect(chain).toEqual([screenId, cardId, oversizedId]);
  });

  it('smart mode returns chain[1] with nothing selected and drills in afterwards', () => {
    expect(store().hitTestNodeId({ x: 200, y: 100 })).toBe(cardId);
    store().selectNode(cardId);
    expect(store().hitTestNodeId({ x: 200, y: 100 })).toBe(oversizedId);
    store().selectNode(oversizedId);
    // Nothing deeper — repeat clicks stay put.
    expect(store().hitTestNodeId({ x: 200, y: 100 })).toBe(oversizedId);
  });

  it('deepest mode goes straight to the leaf', () => {
    expect(store().hitTestNodeId({ x: 200, y: 100 }, 'deepest')).toBe(oversizedId);
    expect(store().hitTestNodeId({ x: 42, y: 42 }, 'deepest')).toBe(iconId);
  });

  it('a point outside every node yields an empty chain', () => {
    expect(store().hitTestChain({ x: 3000, y: 3000 })).toEqual([]);
    expect(store().hitTestNodeId({ x: 3000, y: 3000 })).toBeUndefined();
  });

  it('text nodes use their glyph bounds inset by -4/-3', () => {
    const textId = newUUID();
    reset(
      makeDesignProject({
        name: 'Text hit',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: textId, type: 'Text', name: 'Label', x: 0, y: 0, width: 400, height: 100, text: 'Hi',
                style: makeNodeStyle({ fill: '#000000', cornerRadius: 0, opacity: 1, fontSize: 20 }),
              }),
            ],
          }),
        ],
      }),
    );
    // "Hi" ≈ 2 × 20 × 0.52 = 20.8 → 21pt wide, +4 slop on each side.
    expect(store().hitTestChain({ x: 10, y: 10 })).toEqual([textId]);
    expect(store().hitTestChain({ x: 300, y: 10 })).toEqual([]);
  });
});

describe('moving, clamping and reparenting', () => {
  const screenId = newUUID();
  const cardId = newUUID();
  const labelId = newUUID();
  const otherScreenId = newUUID();

  beforeEach(() => {
    reset(
      makeDesignProject({
        name: 'Move',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: screenId, type: 'Frame', name: 'Home Screen', x: 0, y: 0, width: 390, height: 844,
                children: [
                  node({ id: cardId, type: 'Frame', name: 'Card', x: 20, y: 40, width: 200, height: 100,
                    children: [node({ id: labelId, type: 'Text', name: 'Label', x: 10, y: 10, width: 60, height: 20, text: 'Hi' })] }),
                ],
              }),
              node({ id: otherScreenId, type: 'Frame', name: 'Detail Screen', x: 500, y: 0, width: 390, height: 844 }),
            ],
          }),
        ],
      }),
    );
  });

  it('moveNode drops constraints and marks the node hand-placed', () => {
    store().moveNode(cardId, 33, 44);
    const card = store().node(cardId)!;
    expect(card).toMatchObject({ x: 33, y: 44, manuallyPositioned: true });
    expect(card.constraints).toBeUndefined();
  });

  it('clampedPositionForMove keeps a child inside its parent', () => {
    expect(store().clampedPositionForMove(cardId, -50, -50)).toEqual({ x: 0, y: 0 });
    expect(store().clampedPositionForMove(cardId, 9999, 9999)).toEqual({ x: 190, y: 744 });
    // A root node has no parent — the proposal passes through.
    expect(store().clampedPositionForMove(screenId, -80, -90)).toEqual({ x: -80, y: -90 });
  });

  it('canReparentNode rejects self and descendants', () => {
    expect(store().canReparentNode(cardId, cardId)).toBe(false);
    expect(store().canReparentNode(cardId, labelId)).toBe(false);
    expect(store().canReparentNode(cardId, otherScreenId)).toBe(true);
  });

  it('reparentNode preserves the screen position, clamped inside the new parent', () => {
    store().reparentNode(cardId, otherScreenId);
    const card = store().node(cardId)!;
    // Global (20,40) − target origin (500,0) = (−480,40) → clamped to (0,40).
    expect(card).toMatchObject({ x: 0, y: 40 });
    expect(store().parentOfNode(cardId)?.id).toBe(otherScreenId);
    expect(store().selectedNodeId).toBe(cardId);
    expect(store().undoStack).toHaveLength(1);
  });

  it('globalRect / isRootNode / rootScreen / nodesExcluding', () => {
    expect(store().globalRect(labelId)).toEqual({ x: 30, y: 50, width: 60, height: 20 });
    expect(store().isRootNode(screenId)).toBe(true);
    expect(store().isRootNode(cardId)).toBe(false);
    expect(store().rootScreen(labelId)?.id).toBe(screenId);
    expect(store().nodesExcluding(screenId).map((n) => n.id)).toEqual([otherScreenId]);
  });

  it('studioExportNodes returns the frame, its parent frame, or the page', () => {
    expect(store().studioExportNodes()).toHaveLength(2);
    store().selectNode(cardId);
    expect(store().studioExportNodes().map((n) => n.id)).toEqual([cardId]);
    store().selectNode(labelId);
    expect(store().studioExportNodes().map((n) => n.id)).toEqual([cardId]);
  });
});

describe('undo / redo', () => {
  it('swaps whole project snapshots and clears the selection', () => {
    store().addFrameNode();
    const afterAdd = store().currentPage().nodes.length;
    expect(afterAdd).toBe(1);

    store().undo();
    expect(store().currentPage().nodes).toHaveLength(0);
    expect(store().selectedNodeId).toBeUndefined();
    expect(store().redoStack).toHaveLength(1);

    store().redo();
    expect(store().currentPage().nodes).toHaveLength(1);
    expect(store().undoStack).toHaveLength(1);
  });

  it('snapshot caps the undo stack at 50 and clears redo', () => {
    for (let index = 0; index < 60; index += 1) store().snapshot();
    expect(store().undoStack).toHaveLength(50);
    store().undo();
    expect(store().redoStack).toHaveLength(1);
    store().snapshot();
    expect(store().redoStack).toHaveLength(0);
  });

  it('replaceProject re-hugs text, heals clipping and resets both stacks', () => {
    store().snapshot();
    const textId = newUUID();
    store().replaceProject(
      makeDesignProject({
        name: 'Loaded',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Loaded page',
            nodes: [
              node({
                id: textId, type: 'Text', name: 'Wide', x: 0, y: 0, width: 400, height: 80, text: 'Hi',
                style: makeNodeStyle({ fill: '#000000', cornerRadius: 0, opacity: 1, fontSize: 20 }),
              }),
            ],
          }),
        ],
      }),
    );
    expect(store().undoStack).toHaveLength(0);
    expect(store().redoStack).toHaveLength(0);
    expect(store().node(textId)!.width).toBe(21);
  });
});

describe('pages', () => {
  it('addPage / renamePage / deletePage (blocked at one page)', () => {
    store().deletePage(0);
    expect(store().project.pages).toHaveLength(1);

    store().addPage();
    expect(store().project.pages[1].name).toBe('New Page');
    store().addPage('Flows');
    expect(store().project.pages[2].name).toBe('Flows');

    store().renamePage(0, 'Home');
    expect(store().project.pages[0].name).toBe('Home');

    store().selectPage(2);
    expect(store().currentPageIndex).toBe(2);
    store().deletePage(2);
    expect(store().project.pages).toHaveLength(2);
    expect(store().currentPageIndex).toBe(1);
  });
});

describe('design action pipelines', () => {
  const actions = () => [
    makeDesignAction({
      type: 'createFrame', nodeReference: 'home', name: 'Home Screen',
      x: 1000, y: 1000, width: 390, height: 844,
    }),
    makeDesignAction({
      type: 'createFrame', nodeReference: 'detail', name: 'Detail Screen',
      x: 2000, y: 1000, width: 390, height: 844,
    }),
  ];

  it('applyDesignActions runs the normalization passes and restacks the screens', () => {
    const temporaryIds = store().applyDesignActions(actions());
    expect(Object.keys(temporaryIds).sort()).toEqual(['__defaultAgentRootFrame', 'detail', 'home']);

    const [home, detail] = store().currentPage().nodes;
    expect(home).toMatchObject({ name: 'Home Screen', x: 100, y: 80, width: 390, height: 844, clipContent: true });
    expect(detail).toMatchObject({ name: 'Detail Screen', x: 562, y: 80 });
    expect(home.style.paddingTop).toBe(24);
    expect(store().undoStack).toHaveLength(1);
  });

  it('applyDesignActionsExactly keeps the coordinates and marks nodes hand-placed', () => {
    const temporaryIds = store().applyDesignActionsExactly(actions());
    expect(Object.keys(temporaryIds).sort()).toEqual(['detail', 'home']);

    const [home, detail] = store().currentPage().nodes;
    expect(home).toMatchObject({ name: 'Home Screen', x: 1000, y: 1000, manuallyPositioned: true });
    expect(detail).toMatchObject({ name: 'Detail Screen', x: 2000, y: 1000, manuallyPositioned: true });
    // The intent flags are restored afterwards.
    expect(store().currentAgentRequestIntent).toBe('createNewDesign');
    expect(store().allowsRootScreenDeletion).toBe(false);
  });

  it('applyDesignActionsExactly auto-references create actions that have no nodeReference', () => {
    const temporaryIds = store().applyDesignActionsExactly([
      makeDesignAction({ type: 'createText', name: 'Free text', x: 5, y: 6, width: 200, height: 40, text: 'Hello' }),
    ]);
    expect(Object.keys(temporaryIds)).toEqual(['node0']);
    expect(store().currentPage().nodes[0]).toMatchObject({ name: 'Free text', x: 5, y: 6 });
  });

  it('the exact path still hugs text boxes but never moves the glyphs', () => {
    store().applyDesignActionsExactly([
      makeDesignAction({ type: 'createText', name: 'Wide', x: 40, y: 40, width: 400, height: 90, text: 'Hi', fontSize: 20 }),
    ]);
    const text = store().currentPage().nodes[0];
    expect(text.x).toBe(40);
    expect(text.width).toBe(21);
  });

  it('deleteNode is refused for a root screen unless the exact path allows it', () => {
    const ids = store().applyDesignActionsExactly(actions());
    const homeId = ids['home'];
    store().applyDesignActions([makeDesignAction({ type: 'deleteNode', nodeId: homeId })]);
    expect(store().node(homeId)).toBeDefined();
    store().applyDesignActionsExactly([makeDesignAction({ type: 'deleteNode', nodeId: homeId })]);
    expect(store().node(homeId)).toBeUndefined();
  });
});

describe('alignment and distribution', () => {
  const a = newUUID();
  const b = newUUID();
  const c = newUUID();

  beforeEach(() => {
    reset(
      makeDesignProject({
        name: 'Align',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({ id: a, name: 'A', x: 0, y: 0, width: 100, height: 50 }),
              node({ id: b, name: 'B', x: 200, y: 100, width: 50, height: 50 }),
              node({ id: c, name: 'C', x: 400, y: 300, width: 100, height: 100 }),
            ],
          }),
        ],
      }),
    );
  });

  it('alignSelection aligns two or more nodes to their union box', () => {
    useProjectStore.setState({ selectedNodeIds: new Set([a, b]), selectedNodeId: a });
    store().alignSelection('left');
    expect(store().node(a)!.x).toBe(0);
    expect(store().node(b)!.x).toBe(0);

    useProjectStore.setState({ selectedNodeIds: new Set([a, b]), selectedNodeId: a });
    store().alignSelection('bottom');
    // union bottom = max(50, 150) = 150
    expect(store().node(a)!.y).toBe(100);
    expect(store().node(b)!.y).toBe(100);
  });

  it('alignSelection with one node aligns it inside its parent', () => {
    const parentId = newUUID();
    const childId = newUUID();
    reset(
      makeDesignProject({
        name: 'Align in parent',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: parentId, type: 'Frame', name: 'Card', x: 0, y: 0, width: 300, height: 200,
                style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 0, opacity: 1, paddingLeft: 20, paddingRight: 20, paddingTop: 10, paddingBottom: 10 }),
                children: [node({ id: childId, name: 'Child', x: 5, y: 5, width: 60, height: 40 })],
              }),
            ],
          }),
        ],
      }),
    );
    store().selectNode(childId);
    store().alignSelection('center');
    // padL 20 + (innerW 260 − 60) / 2 = 120
    expect(store().node(childId)!.x).toBe(120);
    store().selectNode(childId);
    store().alignSelection('middle');
    // padT 10 + (innerH 180 − 40) / 2 = 80
    expect(store().node(childId)!.y).toBe(80);
  });

  it('distributeSelection needs three nodes and spaces the gaps evenly', () => {
    useProjectStore.setState({ selectedNodeIds: new Set([a, b]), selectedNodeId: a });
    store().distributeSelection('horizontal');
    expect(store().node(b)!.x).toBe(200);

    useProjectStore.setState({ selectedNodeIds: new Set([a, b, c]), selectedNodeId: a });
    store().distributeSelection('horizontal');
    // span 0…500, total width 250 → gap = 125
    expect(store().node(a)!.x).toBe(0);
    expect(store().node(b)!.x).toBe(225);
    expect(store().node(c)!.x).toBe(400);
  });

  it('alignChildren / distributeChildren operate on a container', () => {
    const parentId = newUUID();
    const one = newUUID();
    const two = newUUID();
    reset(
      makeDesignProject({
        name: 'Children',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: parentId, type: 'Frame', name: 'Row', x: 0, y: 0, width: 300, height: 100,
                children: [
                  node({ id: one, name: 'One', x: 0, y: 0, width: 40, height: 20 }),
                  node({ id: two, name: 'Two', x: 100, y: 40, width: 60, height: 20 }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    store().alignChildren(parentId, 'center');
    expect(store().node(one)!.x).toBe(130);
    expect(store().node(two)!.x).toBe(120);

    store().distributeChildren(parentId, 'horizontal');
    expect(store().node(one)!.x).toBe(0);
    expect(store().node(one)!.y).toBe(40);
  });
});

describe('duplicate, layering and bindings', () => {
  const cardId = newUUID();
  const labelId = newUUID();

  beforeEach(() => {
    reset(
      makeDesignProject({
        name: 'Duplicate',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: cardId, type: 'Frame', name: 'Card', x: 10, y: 10, width: 200, height: 100,
                children: [node({ id: labelId, type: 'Text', name: 'Label', x: 5, y: 5, width: 60, height: 20, text: 'Hi' })],
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('duplicateSelection remaps every id, offsets by 24 and appends " Copy"', () => {
    store().selectNode(cardId);
    store().duplicateSelection();

    const nodes = store().currentPage().nodes;
    expect(nodes).toHaveLength(2);
    const copy = nodes[1];
    expect(copy.id).not.toBe(cardId);
    expect(copy.name).toBe('Card Copy');
    expect(copy).toMatchObject({ x: 34, y: 34, manuallyPositioned: true });
    expect(copy.children[0].id).not.toBe(labelId);
    expect(copy.children[0].name).toBe('Label');
    expect(store().selectedNodeId).toBe(copy.id);
  });

  it('bringSelectionToFront / sendSelectionToBack walk the z range', () => {
    store().selectNode(cardId);
    store().bringSelectionToFront();
    expect(store().node(cardId)!.zIndex).toBe(1);
    store().sendSelectionToBack();
    expect(store().node(cardId)!.zIndex).toBe(-1);
  });

  it('setLogicBinding adds, replaces and removes bindings', () => {
    store().setLogicBinding(labelId, 'text', 'greeting');
    expect(store().node(labelId)!.logicBindings).toHaveLength(1);
    expect(store().node(labelId)!.logicBindings![0]).toMatchObject({ kind: 'text', variableName: 'greeting' });

    store().setLogicBinding(labelId, 'text', 'other');
    expect(store().node(labelId)!.logicBindings).toHaveLength(1);
    expect(store().node(labelId)!.logicBindings![0].variableName).toBe('other');

    store().setLogicBinding(labelId, 'text', undefined);
    expect(store().node(labelId)!.logicBindings).toBeUndefined();
  });

  it('simulation snapshot / restore round-trips the page nodes', () => {
    const before = store().snapshotNodesForSimulation();
    store().simulateUpdateNode(labelId, (n) => {
      n.text = 'Changed';
    });
    expect(store().node(labelId)!.text).toBe('Changed');
    store().restoreNodesFromSimulation(before);
    expect(store().node(labelId)!.text).toBe('Hi');
  });

  it('setGeneratedImage patches the image source in place', () => {
    store().setGeneratedImage(cardId, '/tmp/sprite.png');
    expect(store().node(cardId)!.imageSource).toBe('/tmp/sprite.png');
  });
});

describe('text hugging', () => {
  it('fitTextNodeToContent only ever shrinks and keeps the glyphs put', () => {
    const leftId = newUUID();
    const centerId = newUUID();
    const rightId = newUUID();
    reset(
      makeDesignProject({
        name: 'Hug',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({ id: leftId, type: 'Text', name: 'L', x: 0, y: 0, width: 400, height: 60, text: 'Hi',
                style: makeNodeStyle({ fill: '#000', cornerRadius: 0, opacity: 1, fontSize: 20 }) }),
              node({ id: centerId, type: 'Text', name: 'C', x: 0, y: 100, width: 400, height: 60, text: 'Hi',
                style: makeNodeStyle({ fill: '#000', cornerRadius: 0, opacity: 1, fontSize: 20, textAlign: 'center' }) }),
              node({ id: rightId, type: 'Text', name: 'R', x: 0, y: 200, width: 400, height: 60, text: 'Hi',
                style: makeNodeStyle({ fill: '#000', cornerRadius: 0, opacity: 1, fontSize: 20, textAlign: 'right' }) }),
            ],
          }),
        ],
      }),
    );

    expect(store().fitTextNodeToContent(leftId)).toBe(true);
    const left = store().node(leftId)!;
    expect(left).toMatchObject({ x: 0, width: 21, height: 24, manuallyPositioned: true });

    store().fitTextNodeToContent(centerId);
    expect(store().node(centerId)!.x).toBe((400 - 21) / 2);

    store().fitTextNodeToContent(rightId);
    expect(store().node(rightId)!.x).toBe(400 - 21);

    // Already fitted → no change, no snapshot.
    expect(store().fitTextNodeToContent(leftId)).toBe(false);
  });

  it('wrapping text keeps its slot (never hugged)', () => {
    const wrapId = newUUID();
    reset(
      makeDesignProject({
        name: 'Wrap',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              makeDesignNode({
                id: wrapId, type: 'Text', name: 'Body', x: 0, y: 0, width: 400, height: 200, text: 'Hi',
                style: makeNodeStyle({ fill: '#000', cornerRadius: 0, opacity: 1, fontSize: 20 }),
                textBehavior: { wrap: true, autoHeight: true },
                children: [],
              }),
            ],
          }),
        ],
      }),
    );
    expect(store().fitTextNodeToContent(wrapId)).toBe(false);
    expect(store().node(wrapId)!.width).toBe(400);
  });

  it('fitTextNodesToContent walks a whole subtree', () => {
    const frameId = newUUID();
    reset(
      makeDesignProject({
        name: 'Bulk hug',
        pages: [
          makeDesignPage({
            id: newUUID(),
            name: 'Page 1',
            nodes: [
              node({
                id: frameId, type: 'Frame', name: 'Card', x: 0, y: 0, width: 500, height: 500,
                children: [
                  node({ id: newUUID(), type: 'Text', name: 'A', x: 0, y: 0, width: 400, height: 60, text: 'Hi',
                    style: makeNodeStyle({ fill: '#000', cornerRadius: 0, opacity: 1, fontSize: 20 }) }),
                  node({ id: newUUID(), type: 'Text', name: 'B', x: 0, y: 100, width: 400, height: 60, text: 'Hi',
                    style: makeNodeStyle({ fill: '#000', cornerRadius: 0, opacity: 1, fontSize: 20 }) }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    expect(store().fitTextNodesToContent(frameId)).toBe(2);
    expect(store().fitTextNodesToContent(frameId)).toBe(0);
  });

  it('addInputNode adds an Input node with default styling', () => {
    store().addInputNode();
    const sel = store().selectedNode();
    expect(sel).toBeDefined();
    expect(sel?.type).toBe('Input');
    expect(sel?.name).toBe('Input Field');
    expect(sel?.width).toBe(280);
    expect(sel?.height).toBe(48);
  });

  it('addScreenNode calculates non-overlapping x position', () => {
    const page = store().currentPage();
    const initialScreenCount = page.nodes.filter((n) => n.type === 'Frame').length;
    store().addScreenNode();
    const updatedScreens = store().currentPage().nodes.filter((n) => n.type === 'Frame');
    expect(updatedScreens.length).toBe(initialScreenCount + 1);
    const newScreen = updatedScreens[updatedScreens.length - 1]!;
    expect(newScreen.type).toBe('Frame');
    expect(newScreen.name).toContain('Screen');
  });

  it('duplicateSelection duplicates the active node', () => {
    store().addTextNode();
    const original = store().selectedNode();
    expect(original).toBeDefined();
    const countBefore = store().currentPage().nodes.length;
    store().duplicateSelection();
    const countAfter = store().currentPage().nodes.length;
    expect(countAfter).toBe(countBefore + 1);
    const duplicate = store().selectedNode();
    expect(duplicate?.id).not.toBe(original?.id);
    expect(duplicate?.name).toContain('Copy');
  });
});
