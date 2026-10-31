import { describe, expect, it } from 'vitest';
import { makeDesignNode } from '../../models/DesignNode';
import { makeGameEntity, makeGameSceneSpec } from '../../models/GameSpec';
import { entityChildren, nodeEffectiveGameSpec, nodeHasEntityChildren } from '../GameSceneComposer';

describe('GameSceneComposer — GameSceneComposer.swift 15-67', () => {
  const spec = makeGameSceneSpec({
    entities: [
      makeGameEntity({ id: 'bird', name: 'Bird', sprite: 'bird.png', x: 10, y: 20, width: 30, height: 30, circleBody: true }),
      makeGameEntity({ id: 'ground', name: '', color: '#8B5A2B', x: 0, y: 800, width: 390, height: 44 }),
    ],
  });

  it('entityChildren turns embedded entities into canvas nodes', () => {
    const children = entityChildren(spec);
    expect(children.length).toBe(2);
    expect(children[0].type).toBe('Image');
    expect(children[0].name).toBe('Bird');
    expect(children[0].imageSource).toBe('bird.png');
    expect(children[0].style.cornerRadius).toBe(15); // circleBody → min(w,h)/2
    expect(children[0].gameEntity?.sprite).toBeUndefined(); // sprite moves to the node
    expect(children[1].type).toBe('Rectangle');
    expect(children[1].name).toBe('ground'); // empty name → id
    expect(children[1].style.fill).toBe('#8B5A2B');
    expect(children[1].style.cornerRadius).toBe(4);
  });

  it('effectiveGameSpec composes entities from child nodes', () => {
    const children = entityChildren(spec);
    children[0].x = 111;
    children[0].y = 222;
    children[1].style.fill = '#123456';
    const game = makeDesignNode({
      type: 'Frame', name: 'Game', x: 0, y: 0, width: 390, height: 844,
      style: { fill: '#000000', cornerRadius: 0, opacity: 1 },
      gameScene: makeGameSceneSpec({ entities: [] }),
      children,
    });
    expect(nodeHasEntityChildren(game)).toBe(true);
    const composed = nodeEffectiveGameSpec(game);
    expect(composed?.entities.length).toBe(2);
    expect(composed?.entities[0].x).toBe(111);
    expect(composed?.entities[0].y).toBe(222);
    expect(composed?.entities[0].sprite).toBe('bird.png');
    expect(composed?.entities[1].color).toBe('#123456');
  });

  it('keeps embedded entities when there are no entity children (legacy games)', () => {
    const legacy = makeDesignNode({
      type: 'Frame', name: 'Game', x: 0, y: 0, width: 390, height: 844,
      style: { fill: '#000000', cornerRadius: 0, opacity: 1 },
      gameScene: spec,
    });
    expect(nodeHasEntityChildren(legacy)).toBe(false);
    expect(nodeEffectiveGameSpec(legacy)?.entities.length).toBe(2);
    // A node without a gameScene has no spec at all
    const plain = makeDesignNode({ type: 'Frame', name: 'x', x: 0, y: 0, width: 1, height: 1, style: { fill: '#FFF', cornerRadius: 0, opacity: 1 } });
    expect(nodeEffectiveGameSpec(plain)).toBeUndefined();
  });
});
