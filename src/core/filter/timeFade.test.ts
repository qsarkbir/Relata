import { describe, expect, it } from 'vitest';
import type { Dataset } from '../model';
import { gregorianToJdn } from '../time';
import { filterDataset, mkEdge, mkNode, num, person, span } from './fixtures/filterDataset';
import { buildTimeIndex, itemTimeSpans, outOfTime } from './timeFade';

const g = (y: number): number => gregorianToJdn(y, 1, 1);
const gEnd = (y: number): number => gregorianToJdn(y, 12, 31);
const year = (y: number) => span(g(y), gEnd(y));

const ds: Dataset = {
  ...filterDataset(),
  nodes: [
    mkNode('a', person, 'A', [], { kind: 'span', start: year(1500), end: year(1510) }),
    mkNode('b', person, 'B', [], { kind: 'span', start: year(1600) }),
    // 終わりが不明（1650 年から）: 時間フィルタと同じく +∞ 扱い
    mkNode('c', person, 'C', [], {
      kind: 'span',
      start: year(1650),
      end: { kind: 'missing', reason: 'unrecorded' },
    }),
    // 年代なし、欠損、不整合（終わりが開始より前）
    mkNode('d', person, 'D', []),
    mkNode('e', person, 'E', [], { kind: 'missing', reason: 'lost' }),
    mkNode('f', person, 'F', [], { kind: 'span', start: year(1700), end: year(1690) }),
  ],
  edges: [
    // 自分の日付が無いエッジ: 端点で決まる
    mkEdge('e-ab', 'a', 'b', num(1)),
    mkEdge('e-ad', 'a', 'd', num(1)),
    mkEdge('e-dd', 'd', 'e', num(1)),
    // 自分の日付を持つエッジ: その日付だけで決まる
    mkEdge('e-own', 'a', 'b', num(1), { time: { kind: 'span', start: year(1505) } }),
  ],
};
const index = buildTimeIndex(ds, { kind: 'span' }, { kind: 'span' });
const cumulative = (y: number) => ({ from: Number.NEGATIVE_INFINITY, to: gEnd(y) });

describe('FR-TM-02: 日付の幅（再生）', () => {
  it('FR-TM-02: 終わりが欠損の期間は終わりを +∞ とみなす（時間フィルタと同じ）', () => {
    const c = ds.nodes[2];
    if (c === undefined) throw new Error('fixture');
    expect(itemTimeSpans(c, { kind: 'span' })).toEqual([{ start: g(1650), end: Infinity }]);
  });
  it('FR-TM-02: 不整合な期間、年代なし、欠損は日付の幅を持たない', () => {
    for (const i of [3, 4, 5]) {
      const n = ds.nodes[i];
      if (n === undefined) throw new Error('fixture');
      expect(itemTimeSpans(n, { kind: 'span' })).toEqual([]);
    }
  });
});

describe('FR-TM-02: 時刻の外の判定（D-38）', () => {
  it('FR-TM-02: 時刻が無ければ何も薄くしない', () => {
    const out = outOfTime(index, null);
    expect(out.nodes.size).toBe(0);
    expect(out.edges.size).toBe(0);
  });
  it('FR-TM-02: 累積は、時刻より後に始まるものだけが外。終わった後も残る', () => {
    expect([...outOfTime(index, cumulative(1550)).nodes].sort()).toEqual(['b', 'c']);
    expect([...outOfTime(index, cumulative(1620)).nodes].sort()).toEqual(['c']);
    // 1650 年以後は、終わり不明の c も、終わった a も残る
    expect(outOfTime(index, cumulative(1700)).nodes.size).toBe(0);
  });
  it('FR-TM-02: 移動窓は、窓と重ならないものが外（終わった期間も外になる）', () => {
    const out = outOfTime(index, { from: g(1620), to: gEnd(1640) });
    expect([...out.nodes].sort()).toEqual(['a', 'b', 'c']);
    // 終わり不明の c は、始まってからは窓の中に居続ける
    expect([...outOfTime(index, { from: g(1700), to: gEnd(1710) }).nodes].sort()).toEqual([
      'a',
      'b',
    ]);
  });
  it('FR-TM-02: 年代のないノード（なし、欠損、不整合）は薄くしない', () => {
    const out = outOfTime(index, cumulative(1400));
    expect(out.nodes.has('d')).toBe(false);
    expect(out.nodes.has('e')).toBe(false);
    expect(out.nodes.has('f')).toBe(false);
  });
  it('FR-TM-02: 日付のないエッジは端点が外なら薄くし、日付のあるエッジは自分の日付で決まる', () => {
    const out = outOfTime(index, cumulative(1550));
    // e-ab: b が外 → 薄い。e-ad: d は年代なし、a は中 → 薄くしない。e-dd: 両端が年代なし
    expect(out.edges.has('e-ab')).toBe(true);
    expect(out.edges.has('e-ad')).toBe(false);
    expect(out.edges.has('e-dd')).toBe(false);
    // e-own は 1505 年のもの。端点 b が外でも、自分の日付が中なので薄くしない
    expect(out.edges.has('e-own')).toBe(false);
    expect(outOfTime(index, cumulative(1400)).edges.has('e-own')).toBe(true);
  });
  it('FR-TM-02: 出どころが無ければ、すべて年代なしとして薄くしない', () => {
    const none = buildTimeIndex(ds, undefined, undefined);
    expect(outOfTime(none, cumulative(1400)).nodes.size).toBe(0);
  });
});
