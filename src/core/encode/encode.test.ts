import { describe, expect, it } from 'vitest';
import {
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type Missing,
  type NodeId,
  type NodeType,
} from '../model';
import {
  CATEGORY_COLORS,
  DEFAULT_ENCODING,
  MISSING_COLOR,
  OTHER_COLOR,
  VIRIDIS_STOPS,
  encodeEdgeWidths,
  typeStyles,
  type CategoryValue,
  encodeNodeColorsByCategory,
  encodeNodeColorsByNumber,
  encodeNodeSizes,
  makeScale,
  normalizeColor,
  parseEncodingSettings,
  typeColors,
  typeShapes,
  viridisColor,
} from './index';

const R = { min: 0, max: 10 };
const miss: Missing = { kind: 'missing', reason: 'unrecorded' };
const n = (s: string): NodeId => toNodeId(s);

describe('FR-VG-04: スケール', () => {
  it('線形は値に比例する', () => {
    const s = makeScale([0, 5, 10], 'linear', R);
    expect(s.apply(5)).toBeCloseTo(5);
    expect(s.apply(10)).toBe(10);
  });
  it('平方根で最小 0 のとき、半径の 2 乗が値に比例する', () => {
    const s = makeScale([0, 4, 16, 100], 'sqrt', { min: 0, max: 10 });
    for (const v of [4, 16, 100]) expect(s.apply(v) ** 2 / v).toBeCloseTo(1);
  });
  it('対数は log(1+v) に比例する', () => {
    const s = makeScale([0, 99], 'log', R);
    expect(s.apply(9)).toBeCloseTo((Math.log(10) / Math.log(100)) * 10);
  });
  it('定義域の端: 0 と最大値が範囲の両端、範囲外は丸める', () => {
    const s = makeScale([2, 8], 'linear', { min: 2, max: 6 });
    expect(s.domain).toEqual({ min: 0, max: 8 });
    expect(s.apply(0)).toBe(2);
    expect(s.apply(8)).toBe(6);
    expect(s.apply(100)).toBe(6);
    expect(s.apply(-100)).toBe(2);
  });
  it('負の値: 平方根と対数は 0 として扱い件数を返す。線形は負を定義域に含める', () => {
    const sq = makeScale([-4, 4, 9], 'sqrt', R);
    expect(sq.negativeCount).toBe(1);
    expect(sq.apply(-4)).toBe(0);
    expect(sq.domain.min).toBe(0);
    const lg = makeScale([-1, -2, 3], 'log', R);
    expect(lg.negativeCount).toBe(2);
    const li = makeScale([-5, 5], 'linear', R);
    expect(li.negativeCount).toBe(0);
    expect(li.domain).toEqual({ min: -5, max: 5 });
    expect(li.apply(-5)).toBe(0);
    expect(li.apply(0)).toBe(5);
  });
  it('FR-VG-04: 線形の定義域は全部負でも 0 を含む', () => {
    const s = makeScale([-8, -2], 'linear', R);
    expect(s.domain).toEqual({ min: -8, max: 0 });
    expect(s.apply(-8)).toBe(0);
    expect(s.apply(0)).toBe(10);
  });
  it('空、単一、すべて 0、すべて同じ値でも 0 除算にならない', () => {
    for (const kind of ['linear', 'sqrt', 'log'] as const) {
      expect(makeScale([], kind, { min: 2, max: 8 }).apply(3)).toBe(2);
      expect(makeScale([0, 0], kind, { min: 2, max: 8 }).apply(0)).toBe(2);
      expect(makeScale([5], kind, { min: 2, max: 8 }).apply(5)).toBe(8);
      expect(Number.isFinite(makeScale([-3], kind, R).apply(-3))).toBe(true);
    }
  });
  it('min = max ならどの値も同じ大きさ。有限でない値は最小値', () => {
    const s = makeScale([1, 2, 3], 'sqrt', { min: 4, max: 4 });
    expect(s.apply(1)).toBe(4);
    expect(s.apply(3)).toBe(4);
    expect(makeScale([1], 'linear', R).apply(NaN)).toBe(0);
  });
});

describe('FR-VG-03、FR-VG-08: 大きさと太さの適用', () => {
  const setting = {
    source: { kind: 'attr', attr: 'x' },
    scale: 'linear',
    min: 2,
    max: 12,
  } as const;
  it('欠損は最小の大きさで、印が付く（FR-DM-02）', () => {
    const { sizes, legend } = encodeNodeSizes(
      [n('a'), n('b'), n('c')],
      new Map<NodeId, number | Missing>([
        [n('a'), 10],
        [n('b'), miss],
      ]),
      setting,
    );
    expect(sizes.get(n('a'))).toEqual({ size: 12, missing: false });
    expect(sizes.get(n('b'))).toEqual({ size: 2, missing: true });
    expect(sizes.get(n('c'))?.missing).toBe(true);
    expect(legend?.domain).toEqual({ min: 0, max: 10 });
  });
  it('定数は中央の大きさで凡例なし', () => {
    const r = encodeNodeSizes([n('a')], new Map(), { ...setting, source: { kind: 'constant' } });
    expect(r.sizes.get(n('a'))?.size).toBe(7);
    expect(r.legend).toBeNull();
  });
  it('エッジの太さは重みにスケールを当てる', () => {
    const { widths } = encodeEdgeWidths(
      [
        { id: toEdgeId('e1'), weight: 1 },
        { id: toEdgeId('e2'), weight: 4 },
      ],
      { source: { kind: 'weight' }, scale: 'sqrt', min: 0, max: 8 },
    );
    expect(widths.get(toEdgeId('e2'))?.width).toBe(8);
    expect(widths.get(toEdgeId('e1'))?.width).toBeCloseTo(4);
  });
});

describe('NFR-07: 配色', () => {
  const cats = (keys: string[]): Map<NodeId, CategoryValue> =>
    new Map(keys.map((k, i) => [n(`n${String(i)}`), [k]]));
  it('8 色まで別々、9 個目以降は灰色で巡回しない', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `c${String(i)}`);
    const all = cats(keys);
    const { colors, legend } = encodeNodeColorsByCategory(all, all);
    const used = keys.map((_, i) => colors.get(n(`n${String(i)}`))?.color);
    expect(new Set(used.slice(0, 8)).size).toBe(8);
    expect(used[8]).toBe(OTHER_COLOR);
    expect(used[9]).toBe(OTHER_COLOR);
    expect(legend.entries).toHaveLength(8);
    expect(legend.otherCount).toBe(2);
    expect(CATEGORY_COLORS).not.toContain(OTHER_COLOR);
  });
  it('件数の多い順に色が付き、データの並びで変わらない', () => {
    const p = cats(['x', 'y', 'y', 'z']);
    const q = cats(['z', 'y', 'x', 'y']);
    const a = encodeNodeColorsByCategory(p, p);
    const b = encodeNodeColorsByCategory(q, q);
    expect(a.legend.entries.map((e) => e.key)).toEqual(['y', 'x', 'z']);
    expect(b.legend.entries).toEqual(a.legend.entries);
    expect(a.legend.entries[0]?.color).toBe('#e69f00');
  });
  it('basis を基準にするので、絞り込んでも色が変わらない', () => {
    const all = cats(['x', 'y', 'y']);
    const part = new Map<NodeId, CategoryValue>([[n('n0'), ['x']]]);
    expect(encodeNodeColorsByCategory(part, all).colors.get(n('n0'))?.color).toBe('#56b4e9');
  });
  it('basis に無い値は灰色になり、「その他」に数える', () => {
    const basis = cats(['x']);
    const part = new Map<NodeId, CategoryValue>([[n('z'), ['new']]]);
    const r = encodeNodeColorsByCategory(part, basis);
    expect(r.colors.get(n('z'))?.color).toBe(OTHER_COLOR);
    expect(r.legend.otherCount).toBe(1);
  });
  it('複数値は最初の値の色で、multi の印。数値は String で比べる', () => {
    const m = new Map<NodeId, CategoryValue>([
      [n('a'), ['x', 'y']],
      [n('b'), [1]],
    ]);
    const r = encodeNodeColorsByCategory(m, m);
    expect(r.colors.get(n('a'))?.multi).toBe(true);
    expect(r.colors.get(n('b'))?.multi).toBe(false);
    expect(r.legend.entries.map((e) => e.key).sort()).toEqual(['1', 'x', 'y']);
  });
  it('欠損は理由を問わず薄い灰色で印が付く', () => {
    const m = new Map<NodeId, CategoryValue>([
      [n('a'), miss],
      [n('b'), { kind: 'missing', reason: 'lost' }],
    ]);
    const { colors, legend } = encodeNodeColorsByCategory(m, m);
    expect(colors.get(n('a'))).toEqual({ color: MISSING_COLOR, missing: true, multi: false });
    expect(colors.get(n('b'))?.color).toBe(MISSING_COLOR);
    expect(legend.missingCount).toBe(2);
  });
  it('viridis の両端と中間', () => {
    expect(viridisColor(0)).toBe(VIRIDIS_STOPS[0]);
    expect(viridisColor(1)).toBe(VIRIDIS_STOPS[8]);
    expect(viridisColor(0.5)).toBe(VIRIDIS_STOPS[4]);
    expect(viridisColor(-3)).toBe(VIRIDIS_STOPS[0]);
    expect(viridisColor(NaN)).toBe(VIRIDIS_STOPS[0]);
  });
  it('連続値: 最小と最大に両端の色、同じ値は中間、欠損は薄い灰色', () => {
    const { colors } = encodeNodeColorsByNumber(
      new Map<NodeId, number | Missing>([
        [n('a'), 1],
        [n('b'), 3],
        [n('c'), miss],
      ]),
    );
    expect(colors.get(n('a'))?.color).toBe(VIRIDIS_STOPS[0]);
    expect(colors.get(n('b'))?.color).toBe(VIRIDIS_STOPS[8]);
    expect(colors.get(n('c'))).toEqual({ color: MISSING_COLOR, missing: true });
    const same = encodeNodeColorsByNumber(new Map([[n('a'), 5]]));
    expect(same.colors.get(n('a'))?.color).toBe(VIRIDIS_STOPS[4]);
  });
});

describe('D-23: NodeType の色と形', () => {
  const t = (id: string, extra: Partial<NodeType> = {}): NodeType => ({
    id: toNodeTypeId(id),
    label: id,
    ...extra,
  });
  it('NodeType.color を優先し、無ければ位置の Okabe-Ito、不正なら既定に戻して報告', () => {
    const { colors, invalid } = typeColors([
      t('a', { color: '#ABCDEF' }),
      t('b'),
      t('c', { color: 'red' }),
    ]);
    expect(colors.get(toNodeTypeId('a'))).toBe('#abcdef');
    expect(colors.get(toNodeTypeId('b'))).toBe(CATEGORY_COLORS[1]);
    expect(colors.get(toNodeTypeId('c'))).toBe(CATEGORY_COLORS[2]);
    expect(invalid).toEqual([{ typeId: toNodeTypeId('c'), color: 'red' }]);
  });
  it('9 つ目以降の型は灰色', () => {
    const types = Array.from({ length: 9 }, (_, i) => t(`t${String(i)}`));
    expect(typeColors(types).colors.get(toNodeTypeId('t8'))).toBe(OTHER_COLOR);
  });
  it('NodeType.shape を優先し、無ければ位置で形を変える。定数なら全部同じ', () => {
    const types = [t('a', { shape: 'diamond' }), t('b')];
    const s = typeShapes(types, { kind: 'nodeType' });
    expect(s.get(toNodeTypeId('a'))).toBe('diamond');
    expect(s.get(toNodeTypeId('b'))).toBe('square');
    const c = typeShapes(types, { kind: 'constant', shape: 'triangle' });
    expect(c.get(toNodeTypeId('a'))).toBe('triangle');
  });
  it('normalizeColor は #rrggbb だけ通す', () => {
    expect(normalizeColor('#FFF')).toBeNull();
    expect(normalizeColor('#12345g')).toBeNull();
    expect(normalizeColor(undefined)).toBeNull();
  });
});

describe('FR-VG-03: 有限でない値と凡例', () => {
  const setting = {
    source: { kind: 'attr', attr: 'x' },
    scale: 'linear',
    min: 2,
    max: 12,
  } as const;
  it('NaN と ±Infinity は欠損として最小の大きさ、件数を返す', () => {
    const v = new Map<NodeId, number | Missing>([
      [n('a'), 10],
      [n('b'), NaN],
      [n('c'), Infinity],
      [n('d'), -Infinity],
    ]);
    const { sizes, legend } = encodeNodeSizes([n('a'), n('b'), n('c'), n('d')], v, setting);
    expect(sizes.get(n('a'))?.size).toBe(12);
    for (const id of ['b', 'c', 'd']) expect(sizes.get(n(id))).toEqual({ size: 2, missing: true });
    expect(legend?.missingCount).toBe(3);
    expect(legend?.domain).toEqual({ min: 0, max: 10 });
  });
  it('FR-VG-08: 有限でない重みも欠損', () => {
    const { widths, legend } = encodeEdgeWidths(
      [
        { id: toEdgeId('e1'), weight: 4 },
        { id: toEdgeId('e2'), weight: NaN },
      ],
      { source: { kind: 'weight' }, scale: 'linear', min: 1, max: 5 },
    );
    expect(widths.get(toEdgeId('e2'))).toEqual({ width: 1, missing: true });
    expect(legend?.missingCount).toBe(1);
  });
  it('凡例の代表値は apply と同じ大きさ。幅が 0 なら 1 つ', () => {
    const v = new Map<NodeId, number | Missing>([
      [n('a'), 0],
      [n('b'), 100],
    ]);
    const { legend } = encodeNodeSizes([n('a'), n('b')], v, {
      ...setting,
      scale: 'sqrt',
      min: 0,
      max: 10,
    });
    expect(legend?.ticks.map((t) => t.value)).toEqual([0, 50, 100]);
    expect(legend?.ticks[2]?.size).toBe(10);
    expect(legend?.ticks[1]?.size).toBeCloseTo(10 * Math.sqrt(0.5));
    const z = encodeNodeSizes([n('a')], new Map([[n('a'), 0]]), setting);
    expect(z.legend?.ticks).toHaveLength(1);
  });
  it('連続値の凡例の状態: range、single、empty', () => {
    const st = (m: Map<NodeId, number | Missing>): string =>
      encodeNodeColorsByNumber(m).legend.state;
    expect(
      st(
        new Map([
          [n('a'), 1],
          [n('b'), 2],
        ]),
      ),
    ).toBe('range');
    expect(st(new Map([[n('a'), 1]]))).toBe('single');
    expect(st(new Map([[n('a'), NaN]]))).toBe('empty');
    expect(st(new Map())).toBe('empty');
  });
});

describe('D-23: 型の見た目の衝突', () => {
  const t = (id: string, extra: Partial<NodeType> = {}): NodeType => ({
    id: toNodeTypeId(id),
    label: id,
    ...extra,
  });
  it('9 つ目以降の灰色の型と、色と形が同じ型を報告する', () => {
    const types = Array.from({ length: 10 }, (_, i) => t(`t${String(i)}`));
    const { collisions } = typeStyles(types, { kind: 'nodeType' });
    expect(collisions.filter((c) => c.reason === 'gray').map((c) => c.typeId)).toEqual([
      toNodeTypeId('t8'),
      toNodeTypeId('t9'),
    ]);
    // 形を定数にすると、灰色の t8 と t9 は色も形も同じ組になる。
    const c = typeStyles(types, { kind: 'constant', shape: 'circle' });
    expect(c.collisions).toContainEqual({ typeId: toNodeTypeId('t9'), reason: 'same-style' });
  });
  it('利用者の指定色が他の型の色と重なる型を報告する', () => {
    const { collisions } = typeStyles([t('a'), t('b', { color: '#e69f00' })], { kind: 'nodeType' });
    expect(collisions).toContainEqual({ typeId: toNodeTypeId('b'), reason: 'user-color-overlap' });
  });
  it('衝突がなければ空', () => {
    expect(typeStyles([t('a'), t('b')], { kind: 'nodeType' }).collisions).toEqual([]);
  });
});

describe('FR-VG-04: parseEncodingSettings', () => {
  it('既定値は JSON を往復しても同じ', () => {
    const r = parseEncodingSettings(JSON.parse(JSON.stringify(DEFAULT_ENCODING)));
    expect(r).toEqual({ ok: true, value: DEFAULT_ENCODING });
  });
  it('既定のスケールは平方根（D-08）', () => {
    expect(DEFAULT_ENCODING.nodeSize.scale).toBe('sqrt');
    expect(DEFAULT_ENCODING.edgeWidth.scale).toBe('sqrt');
  });
  it('空のオブジェクトは既定値、全項目の往復', () => {
    expect(parseEncodingSettings({})).toEqual({ ok: true, value: DEFAULT_ENCODING });
    const full = {
      nodeSize: { source: { kind: 'metric', metric: 'degree' }, scale: 'log', min: 2, max: 30 },
      nodeColor: { kind: 'attr', attr: 'religion' },
      nodeShape: { kind: 'constant', shape: 'square' },
      edgeWidth: { source: { kind: 'constant' }, scale: 'linear', min: 1, max: 1 },
    };
    expect(parseEncodingSettings(JSON.parse(JSON.stringify(full)))).toEqual({
      ok: true,
      value: full,
    });
  });
  it('壊れた入力は path つきで失敗する', () => {
    const bad = (x: unknown): string => {
      const r = parseEncodingSettings(x);
      return r.ok ? 'ok' : r.path;
    };
    expect(bad(null)).toBe('');
    expect(bad({ nodeSize: 3 })).toBe('nodeSize');
    expect(bad({ nodeSize: { scale: 'cubic' } })).toBe('nodeSize.scale');
    expect(bad({ nodeSize: { source: { kind: 'attr' } } })).toBe('nodeSize.source.attr');
    expect(bad({ nodeSize: { min: 9, max: 3 } })).toBe('nodeSize.min');
    expect(bad({ nodeSize: { min: 'a' } })).toBe('nodeSize.min');
    expect(bad({ edgeWidth: { max: -1 } })).toBe('edgeWidth.max');
    expect(bad({ nodeColor: { kind: 'x' } })).toBe('nodeColor.kind');
    expect(bad({ nodeShape: { kind: 'constant', shape: 'star' } })).toBe('nodeShape.shape');
    expect(bad({ edgeWidth: { source: { kind: 'metric' } } })).toBe('edgeWidth.source.kind');
  });
  it('余分な項目と __proto__ は引き継がない', () => {
    const r = parseEncodingSettings(JSON.parse('{"__proto__":{"x":1},"extra":1}'));
    expect(r).toEqual({ ok: true, value: DEFAULT_ENCODING });
  });
});
