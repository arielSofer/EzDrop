import { describe, expect, it } from 'vitest';
import { makeDesignNode, makeRepeatBinding, type DesignNode } from '../../models/DesignNode';
import { RepeatBindingExpander } from '../RepeatBindingExpander';

const BOOKS = JSON.stringify([
  { title: 'Swift in Depth', author: { name: 'Tjeerd' }, tags: ['code', 'swift'], stars: 5, free: false },
  { title: 'React Patterns', author: { name: 'Mia' }, tags: ['code', 'web'], stars: 4, free: true },
  { title: 'Garden Notes', author: { name: 'Ori' }, tags: ['life'], stars: 3, free: false },
]);

function template(): DesignNode {
  return makeDesignNode({
    type: 'Frame', name: 'Row', x: 10, y: 100, width: 300, height: 60,
    style: { fill: '#FFFFFF', cornerRadius: 8, opacity: 1, spacing: 12 },
    repeatBinding: makeRepeatBinding({ sourceVariable: 'books', itemAlias: 'book' }),
    text: '{{book.title}}',
    imageSource: 'cover/{{book.author.name}}.png',
    children: [
      makeDesignNode({
        type: 'Text', name: 'Author', x: 0, y: 0, width: 200, height: 20,
        style: { fill: '#00000000', cornerRadius: 0, opacity: 1 },
        text: '{{ book.author.name }} · {{book.stars}} · {{book.free}}',
      }),
    ],
  });
}

function parent(child: DesignNode): DesignNode {
  return makeDesignNode({
    type: 'Frame', name: 'List', x: 0, y: 0, width: 320, height: 400,
    style: { fill: '#FFFFFF', cornerRadius: 0, opacity: 1 },
    children: [child],
  });
}

describe('RepeatBindingExpander — RepeatBindingExpander.swift 60-120', () => {
  it('clones the template once per item, stacking along the axis', () => {
    const expanded = RepeatBindingExpander.expand([template()], { books: BOOKS });
    expect(expanded.length).toBe(3);
    // vertical: cursor starts at node.y and advances by height + spacing (12)
    expect(expanded.map((n) => n.y)).toEqual([100, 172, 244]);
    expect(expanded.every((n) => n.x === 10)).toBe(true);
    expect(expanded.map((n) => n.text)).toEqual(['Swift in Depth', 'React Patterns', 'Garden Notes']);
    expect(expanded.map((n) => n.imageSource)).toEqual(['cover/Tjeerd.png', 'cover/Mia.png', 'cover/Ori.png']);
    // Booleans/numbers stringify like Swift's NSNumber handling (line 232-247)
    expect(expanded[1].children[0].text).toBe('Mia · 4 · true');
    // The clone is no longer a template, and gets a fresh id
    expect(expanded[0].repeatBinding).toBeUndefined();
    expect(new Set(expanded.map((n) => n.id)).size).toBe(3);
  });

  it('stacks horizontally along x when axis = horizontal', () => {
    const node = template();
    node.repeatBinding = makeRepeatBinding({ sourceVariable: 'books', itemAlias: 'book', axis: 'horizontal' });
    const expanded = RepeatBindingExpander.expand([node], { books: BOOKS });
    expect(expanded.map((n) => n.x)).toEqual([10, 322, 634]);
    expect(expanded.every((n) => n.y === 100)).toBe(true);
  });

  it('applies the search filter (filterVariable) case-insensitively', () => {
    const node = template();
    node.repeatBinding = makeRepeatBinding({ sourceVariable: 'books', itemAlias: 'book', filterVariable: 'query' });
    expect(RepeatBindingExpander.expand([node], { books: BOOKS, query: '  SWIFT ' }).map((n) => n.text))
      .toEqual(['Swift in Depth']);
    // An empty / whitespace filter matches everything
    expect(RepeatBindingExpander.expand([node], { books: BOOKS, query: '   ' }).length).toBe(3);
    expect(RepeatBindingExpander.expand([node], { books: BOOKS }).length).toBe(3);
  });

  it('AND-combines the search filter with categoryVariable', () => {
    const node = template();
    node.repeatBinding = makeRepeatBinding({
      sourceVariable: 'books', itemAlias: 'book', filterVariable: 'query', categoryVariable: 'category',
    });
    expect(RepeatBindingExpander.expand([node], { books: BOOKS, query: 'a', category: 'web' }).map((n) => n.text))
      .toEqual(['React Patterns']);
    // Category alone
    expect(RepeatBindingExpander.expand([node], { books: BOOKS, category: 'code' }).map((n) => n.text))
      .toEqual(['Swift in Depth', 'React Patterns']);
    // Both filters must match — nothing does
    expect(RepeatBindingExpander.expand([node], { books: BOOKS, query: 'garden', category: 'web' }).length).toBe(0);
  });

  it('honours maxItems, capped at 50', () => {
    const node = template();
    node.repeatBinding = makeRepeatBinding({ sourceVariable: 'books', itemAlias: 'book', maxItems: 2 });
    expect(RepeatBindingExpander.expand([node], { books: BOOKS }).length).toBe(2);
  });

  it('falls back to a newline-separated list, and passes nodes through untouched', () => {
    const node = template();
    const expanded = RepeatBindingExpander.expand([node], { books: 'one\ntwo' });
    expect(expanded.length).toBe(2);
    expect(expanded.map((n) => n.text)).toEqual(['', '']); // "{{book.title}}" on a scalar → ""
    // Missing variable → the template passes through unchanged
    const untouched = RepeatBindingExpander.expand([template()], {});
    expect(untouched.length).toBe(1);
    expect(untouched[0].repeatBinding).toBeDefined();
    expect(untouched[0].text).toBe('{{book.title}}');
  });

  it('turns the parent of a scrollable template into a scroll container', () => {
    const withRepeat = RepeatBindingExpander.expand([parent(template())], { books: BOOKS });
    expect(withRepeat[0].children.length).toBe(3);
    expect(withRepeat[0].scrollBehavior).toEqual({ axis: 'vertical', showsIndicators: true });

    // An explicit scrollBehavior on the parent is preserved
    const explicit = parent(template());
    explicit.scrollBehavior = { axis: 'horizontal', showsIndicators: false };
    const kept = RepeatBindingExpander.expand([explicit], { books: BOOKS });
    expect(kept[0].scrollBehavior).toEqual({ axis: 'horizontal', showsIndicators: false });
  });

  it('reports a CloneContext per clone (expandWithContext)', () => {
    const [expanded, contexts] = RepeatBindingExpander.expandWithContext([template()], { books: BOOKS });
    expect(contexts.size).toBe(3);
    const first = contexts.get(expanded[0].id);
    expect(first?.itemAlias).toBe('book');
    expect(first?.variables['book.title']).toBe('Swift in Depth');
    expect(first?.variables['book.author.name']).toBe('Tjeerd');
    expect(first?.variables['book.tags.1']).toBe('swift');
    expect(first?.variables['book.free']).toBe('false');
    expect(JSON.parse(first?.itemJSON ?? '{}').title).toBe('Swift in Depth');
  });

  it('itemContext seeds the variables for the Nth row', () => {
    const binding = makeRepeatBinding({ sourceVariable: 'books', itemAlias: 'book' });
    const vars = RepeatBindingExpander.itemContext(binding, { books: BOOKS }, 2);
    expect(vars?.['book.title']).toBe('Garden Notes');
    expect(RepeatBindingExpander.itemContext(binding, { books: BOOKS }, 9)).toBeUndefined();
    expect(RepeatBindingExpander.itemContext(binding, {}, 0)).toBeUndefined();
  });
});
