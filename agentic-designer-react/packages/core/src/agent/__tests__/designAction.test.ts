import { describe, expect, it } from 'vitest';
import {
  decodeDesignAction,
  decodeDesignActionStrict,
  decodeDesignActionType,
  decodeDesignAgentResponse,
  flexibleStringValue,
  parseFlexibleNumber,
  replacingGeneratedImageSource,
} from '../DesignAction';
import { setPlatform, SilentLogger } from '../../platform';

setPlatform({ logger: new SilentLogger() });

const UUID_RE = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

describe('DesignActionType normalisation', () => {
  it('accepts case/underscore/dash variants and synonyms', () => {
    expect(decodeDesignActionType('Create_Frame')).toBe('createFrame');
    expect(decodeDesignActionType('  add-page ')).toBe('createPage');
    expect(decodeDesignActionType('enlarge')).toBe('scaleNode');
    expect(decodeDesignActionType('SPACE-EVENLY')).toBe('distributeChildren');
    expect(decodeDesignActionType('remove')).toBe('deleteNode');
    expect(decodeDesignActionType('showcase')).toBe('createPresentationShot');
    expect(decodeDesignActionType('input_field')).toBe('createInput');
  });

  it('rejects unknown and non-string types', () => {
    expect(() => decodeDesignActionType('teleport')).toThrow(/Unsupported DesignAction type: teleport/);
    expect(() => decodeDesignActionType(42)).toThrow();
    expect(decodeDesignAction({ type: 'teleport' })).toBeNull();
    expect(decodeDesignAction({ type: null })).toBeNull();
    expect(decodeDesignAction('createFrame')).toBeNull();
  });
});

describe('flexible scalars', () => {
  it('numbers: px/pt suffixes, decimal comma, auto/fit/hug/fill, booleans', () => {
    const a = decodeDesignActionStrict({
      type: 'createFrame', x: '12px', y: true, width: '1,5', height: 'auto', scale: ' 2pt ', cornerRadius: '',
      opacity: '0,5', zIndex: '3', letterSpacing: 'null', blur: '  8  ',
    });
    expect(a.x).toBe(12);
    expect(a.y).toBeUndefined();
    expect(a.width).toBe(1.5);
    expect(a.height).toBeUndefined();
    expect(a.scale).toBe(2);
    expect(a.cornerRadius).toBeUndefined();
    expect(a.opacity).toBeUndefined(); // Double path: no comma normalisation
    expect(a.zIndex).toBe(3);
    expect(a.letterSpacing).toBeUndefined();
    expect(a.blur).toBe(8);
    expect(parseFlexibleNumber('16 px')).toBeNull(); // "16 " does not parse, like Swift
    expect(parseFlexibleNumber('-.5')).toBe(-0.5);
  });

  it('booleans: yes/no/1/0/on/off strings', () => {
    const a = decodeDesignActionStrict({ type: 'updateStyle', clipContent: 'on', repeatScrollable: '0' });
    expect(a.clipContent).toBe(true);
    expect(a.repeatScrollable).toBe(false);
    expect(decodeDesignActionStrict({ type: 'updateStyle', clipContent: 'maybe' }).clipContent).toBeUndefined();
    expect(decodeDesignActionStrict({ type: 'updateStyle', clipContent: 1 }).clipContent).toBeUndefined();
  });

  it('FlexibleStringValue renders bools, numbers and nested JSON (sorted keys, escaped slashes)', () => {
    expect(flexibleStringValue(true)).toBe('true');
    expect(flexibleStringValue(7)).toBe('7');
    expect(flexibleStringValue(7.25)).toBe('7.25');
    expect(flexibleStringValue(null)).toBeNull();
    expect(flexibleStringValue({ url: 'a/b', z: 1, a: { n: 2 } })).toBe('{"a":"{\\"n\\":\\"2\\"}","url":"a\\/b","z":"1"}');
    expect(flexibleStringValue(['x', 2, null])).toBe('["x","2",null]');
    expect(flexibleStringValue(0.00001)).toBe('1e-05');
  });
});

describe('ids and references', () => {
  it('lowercase UUIDs are uppercased; non-UUID strings become references', () => {
    const a = decodeDesignActionStrict({
      type: 'moveNode',
      nodeId: 'a023aedb-3d91-4139-80e9-e39cfb20dec8',
      parentId: 'HeroCard',
      relativeToNodeId: '  cta-button  ',
    });
    expect(a.nodeId).toBe('A023AEDB-3D91-4139-80E9-E39CFB20DEC8');
    expect(a.nodeReference).toBeUndefined();
    expect(a.parentId).toBeUndefined();
    expect(a.parentReference).toBe('HeroCard');
    expect(a.relativeToNodeId).toBeUndefined();
    expect(a.relativeToReference).toBe('cta-button');
  });

  it('explicit references win over id-derived ones; parent aliases', () => {
    expect(decodeDesignActionStrict({ type: 'createText', parent: 'Card' }).parentReference).toBe('Card');
    expect(decodeDesignActionStrict({ type: 'createText', parentRef: 'Card2' }).parentReference).toBe('Card2');
    expect(decodeDesignActionStrict({ type: 'createText', parentNodeReference: 'Card3' }).parentReference).toBe('Card3');
    const both = decodeDesignActionStrict({ type: 'createText', parentId: 'fromId', parentReference: 'explicit' });
    expect(both.parentReference).toBe('explicit');
  });

  it('id: valid → kept, empty/"null" → generated, garbage → action rejected', () => {
    expect(decodeDesignActionStrict({ type: 'createFrame', id: '0f2c0d4c-1234-4abc-9def-0123456789ab' }).id)
      .toBe('0F2C0D4C-1234-4ABC-9DEF-0123456789AB');
    expect(decodeDesignActionStrict({ type: 'createFrame', id: '' }).id).toMatch(UUID_RE);
    expect(decodeDesignActionStrict({ type: 'createFrame', id: ' null ' }).id).toMatch(UUID_RE);
    expect(decodeDesignActionStrict({ type: 'createFrame', id: 12 }).id).toMatch(UUID_RE);
    expect(decodeDesignAction({ type: 'createFrame', id: 'action-1' })).toBeNull();
  });
});

describe('style key aliases', () => {
  it('fill/stroke/textColor/fontSize aliases in Swift priority order', () => {
    const a = decodeDesignActionStrict({
      type: 'updateStyle', backgroundColor: '#111', fillColor: '#222', borderColor: '#333', borderWidth: '2px',
      color: '#444', foregroundColor: '#555', size: '18pt',
    });
    expect(a.fill).toBe('#111');
    expect(a.stroke).toBe('#333');
    expect(a.strokeWidth).toBe(2);
    expect(a.textColor).toBe('#444');
    expect(a.fontSize).toBe(18);
    expect(a.size).toBe('18pt'); // `size` is ALSO kept as the asset size string

    const explicit = decodeDesignActionStrict({ type: 'updateStyle', fill: '#abc', backgroundColor: '#111', fontSize: 20, size: '1024' });
    expect(explicit.fill).toBe('#abc');
    expect(explicit.fontSize).toBe(20);
  });

  it('icon / image / description aliases', () => {
    expect(decodeDesignActionStrict({ type: 'createIcon', symbol: 'star' }).iconName).toBe('star');
    expect(decodeDesignActionStrict({ type: 'createIcon', systemName: 'heart' }).iconName).toBe('heart');
    expect(decodeDesignActionStrict({ type: 'createIcon', sfSymbol: 'bolt' }).iconName).toBe('bolt');
    expect(decodeDesignActionStrict({ type: 'createIcon', icon: 'moon' }).iconName).toBe('moon');
    const img = decodeDesignActionStrict({ type: 'createImage', assetPrompt: 'a fox', description: 'desc', contentMode: 'Scale_Aspect-Fill' });
    expect(img.imagePrompt).toBe('a fox');
    expect(img.descriptionText).toBe('desc');
    expect(img.contentMode).toBe('fill');
    expect(decodeDesignActionStrict({ type: 'createImage', contentMode: 'contain' }).contentMode).toBe('fit');
    expect(decodeDesignActionStrict({ type: 'createImage', contentMode: 'stretch' }).contentMode).toBeUndefined();
  });
});

describe('padding / margin', () => {
  it('uniform number sets only `padding`', () => {
    const a = decodeDesignActionStrict({ type: 'createFrame', padding: 12, margin: '8px' });
    expect(a.padding).toBe(12);
    expect(a.paddingTop).toBeUndefined();
    expect(a.margin).toBe(8);
    expect(a.marginLeft).toBeUndefined();
  });

  it('object form fans out to sides with horizontal/vertical/all fallbacks', () => {
    const a = decodeDesignActionStrict({ type: 'createFrame', padding: { horizontal: 16, top: '8', trailing: 4 } });
    expect(a.padding).toBeUndefined();
    expect(a.paddingH).toBe(16);
    expect(a.paddingV).toBeUndefined();
    expect(a.paddingTop).toBe(8);
    expect(a.paddingRight).toBe(4);
    expect(a.paddingBottom).toBeUndefined();
    expect(a.paddingLeft).toBe(16);

    const all = decodeDesignActionStrict({ type: 'createFrame', padding: { all: 10 }, paddingTop: 2 });
    expect(all.padding).toBe(10);
    expect(all.paddingTop).toBe(2); // explicit key wins
    expect(all.paddingBottom).toBe(10);

    const m = decodeDesignActionStrict({ type: 'createFrame', margin: { v: 6, x: 3 } });
    expect(m.marginV).toBe(6);
    expect(m.marginH).toBe(3);
    expect(m.marginTop).toBe(6);
    expect(m.marginLeft).toBe(3);
  });
});

describe('layout / constraints / textBehavior / shadow', () => {
  it('layout object → layout/spacing/layoutAlign; string form; gap alias', () => {
    const a = decodeDesignActionStrict({ type: 'setAutoLayout', layout: { direction: 'vertical', spacing: '12', items: 'center' } });
    expect(a.layout).toBe('vertical');
    expect(a.spacing).toBe(12);
    expect(a.layoutAlign).toBe('center');
    const s = decodeDesignActionStrict({ type: 'setAutoLayout', layout: 'horizontalStack', gap: 8 });
    expect(s.layout).toBe('horizontalStack');
    expect(s.spacing).toBe(8);
    // An object without a recognised type key falls back to the JSON string (Swift behaviour).
    expect(decodeDesignActionStrict({ type: 'setAutoLayout', layout: { foo: 1 } }).layout).toBe('{"foo":"1"}');
  });

  it('constraints: true → 0, px strings, `pin` alias, empty → undefined', () => {
    const a = decodeDesignActionStrict({ type: 'pinNode', constraints: { left: true, right: '16px', centerx: 'true', bottom: 'auto' } });
    expect(a.constraints).toEqual({ left: 0, right: 16, centerX: 0 });
    expect(decodeDesignActionStrict({ type: 'pinNode', pin: { top: 0 } }).constraints).toEqual({ top: 0 });
    expect(decodeDesignActionStrict({ type: 'pinNode', constraints: {} }).constraints).toBeUndefined();
    expect(decodeDesignActionStrict({ type: 'pinNode', constraints: 'top' }).constraints).toBeUndefined();
  });

  it('textBehavior: yes/none/wrap words, int strings, blank overflow dropped', () => {
    const a = decodeDesignActionStrict({ type: 'createText', textBehavior: { wrap: 'yes', maxLines: '2', truncate: 'none', overflow: '  ', autoheight: 'auto' } });
    expect(a.textBehavior).toEqual({ wrap: true, maxLines: 2, truncate: false, autoHeight: true });
    expect(decodeDesignActionStrict({ type: 'createText', textBehavior: { maxLines: '2.0' } }).textBehavior).toEqual({});
  });

  it('shadow: presets, full object, incomplete object → undefined', () => {
    expect(decodeDesignActionStrict({ type: 'updateStyle', shadow: 'Soft' }).shadow).toEqual({ color: '#000000', opacity: 0.14, radius: 14, x: 0, y: 8 });
    expect(decodeDesignActionStrict({ type: 'updateStyle', shadow: 'floating' }).shadow?.radius).toBe(32);
    const full = { color: '#123456', opacity: 0.3, radius: 10, x: 1, y: 2 };
    expect(decodeDesignActionStrict({ type: 'updateStyle', shadow: { ...full, extra: 'ignored' } }).shadow).toEqual(full);
    expect(decodeDesignActionStrict({ type: 'updateStyle', shadow: { color: '#000' } }).shadow).toBeUndefined();
  });
});

describe('gradient / scrollBehavior / repeat', () => {
  it('bare colour array → linear gradient; invalid gradient rejects the action', () => {
    const a = decodeDesignActionStrict({ type: 'createFrame', gradient: ['#071B4D', '#126BFF'] });
    expect(a.gradient).toEqual({ type: 'linear', colors: ['#071B4D', '#126BFF'] });
    const keyed = decodeDesignActionStrict({ type: 'createFrame', gradient: { colors: ['#000'], angle: 90 } });
    expect(keyed.gradient).toEqual({ type: 'linear', colors: ['#000'], angle: 90 });
    expect(decodeDesignAction({ type: 'createFrame', gradient: 'linear' })).toBeNull();
    expect(decodeDesignAction({ type: 'createFrame', gradient: [1, 2] })).toBeNull();
  });

  it('scrollBehavior object feeds scrollAxis/scrollOffset/recycle* fallbacks; counts are rounded & clamped', () => {
    const a = decodeDesignActionStrict({
      type: 'createFrame',
      scrollBehavior: { axis: 'horizontal', initialOffset: 20, itemSpacing: 8, itemCount: 5 },
    });
    expect(a.scrollAxis).toBe('horizontal');
    expect(a.scrollOffset).toBe(20);
    expect(a.recycleItemSpacing).toBe(8);
    expect(a.recycleItemCount).toBe(5);
    const b = decodeDesignActionStrict({ type: 'createFrame', scrollAxis: 'vertical', scrollBehavior: { axis: 'both' }, recycleItemCount: '3.6', repeatMaxItems: 0 });
    expect(b.scrollAxis).toBe('vertical');
    expect(b.recycleItemCount).toBe(4);
    expect(b.repeatMaxItems).toBe(1);
    expect(decodeDesignActionStrict({ type: 'createFrame', recycleItemCount: -2.5 }).recycleItemCount).toBe(0);
    expect(decodeDesignAction({ type: 'createFrame', scrollBehavior: { initialOffset: 1 } })).toBeNull(); // axis required
  });
});

describe('component & props', () => {
  it('component synonyms, raw name retained, non-string component', () => {
    const a = decodeDesignActionStrict({ type: 'createComponent', component: 'Quick Actions' });
    expect(a.component).toBe('quickActionRow');
    expect(a.rawComponentName).toBe('Quick Actions');
    expect(decodeDesignActionStrict({ type: 'createComponent', component: 'totally-unknown' }).component).toBe('contentCard');
    expect(decodeDesignActionStrict({ type: 'createComponent', component: 'Balance_Hero_Card' }).component).toBe('balanceHeroCard');
    const n = decodeDesignActionStrict({ type: 'createComponent', component: 5, rawComponentName: 'x' });
    expect(n.component).toBeUndefined();
    expect(n.rawComponentName).toBe('5');
  });

  it('props: mixed-type object stringified per value; array → item1..N', () => {
    const a = decodeDesignActionStrict({ type: 'createComponent', props: { a: 1, b: true, c: null, d: { x: 1 } } });
    expect(a.props).toEqual({ a: '1', b: 'true', d: '{"x":"1"}' });
    const arr = decodeDesignActionStrict({ type: 'createComponent', props: ['one', 2] });
    expect(arr.props).toEqual({ item1: 'one', item2: '2' });
    expect(decodeDesignActionStrict({ type: 'createComponent', props: 'nope' }).props).toBeUndefined();
  });
});

describe('DesignAgentResponse', () => {
  it('plan as string, array, mixed array, and the empty-array quirk', () => {
    const base = { actions: [{ type: 'createFrame' }] };
    expect(decodeDesignAgentResponse({ ...base, plan: 'one step' }).plan).toEqual(['one step']);
    expect(decodeDesignAgentResponse({ ...base, plan: ['a', 1, null, true] }).plan).toEqual(['a', '1', 'true']);
    expect(decodeDesignAgentResponse({ ...base }).plan).toEqual([]);
    expect(decodeDesignAgentResponse({ ...base, plan: [] }).plan).toEqual(['[]']); // faithful to Swift
    expect(decodeDesignAgentResponse({ ...base, plan: [null] }).plan).toEqual([]);
  });

  it('lossy actions: skips bad entries, throws when none survive or actions missing', () => {
    const r = decodeDesignAgentResponse({ actions: [{ type: 'createFrame' }, { type: 'nope' }, 'garbage', { type: 'createText', id: 'bad-id' }] });
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0].type).toBe('createFrame');
    expect(() => decodeDesignAgentResponse({ actions: [{ type: 'nope' }] })).toThrow(/No action in the array could be decoded/);
    expect(decodeDesignAgentResponse({ actions: [] }).actions).toEqual([]);
    expect(() => decodeDesignAgentResponse({ plan: [] })).toThrow(/actions/);
    expect(() => decodeDesignAgentResponse({ actions: null })).toThrow();
    expect(() => decodeDesignAgentResponse({ actions: {} })).toThrow();
    expect(() => decodeDesignAgentResponse([])).toThrow();
  });
});

describe('replacingGeneratedImageSource', () => {
  it('sets imageName+imageSource, keeps id, drops repeat/timePicker fields like Swift', () => {
    const a = decodeDesignActionStrict({ type: 'createImage', name: 'Hero', repeatSourceVariable: 'items', repeatAxis: 'horizontal', imagePrompt: 'p' });
    const b = replacingGeneratedImageSource(a, '/tmp/hero.png');
    expect(b.id).toBe(a.id);
    expect(b.imageName).toBe('/tmp/hero.png');
    expect(b.imageSource).toBe('/tmp/hero.png');
    expect(b.name).toBe('Hero');
    expect(b.imagePrompt).toBe('p');
    expect(b.repeatSourceVariable).toBeUndefined();
    expect(b.repeatAxis).toBeUndefined();
  });
});
