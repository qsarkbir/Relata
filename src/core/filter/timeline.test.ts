import { describe, expect, it } from 'vitest';
import type { Dataset } from '../model';
import { gregorianToJdn, hijriToJdn } from '../time';
import { filterDataset, mkEdge, mkNode, num, person, span } from './fixtures/filterDataset';
import {
  MAX_TIMELINE_BINS,
  aggregateTimeline,
  binStartYearsOf,
  itemDayRanges,
  resolveTimelineSource,
  sameTimeSource,
  timelineSourceOptions,
} from './timeline';

const g = (y: number, m = 1, d = 1): number => gregorianToJdn(y, m, d);
/**
 * 西暦の年の幅（1 月 1 日から 12 月 31 日）。精度が年の日付。
 *
 * @param y - 西暦の年
 * @returns 幅のある日付
 */
const yearSpan = (y: number) => span(g(y, 1, 1), g(y, 12, 31));

const ds: Dataset = {
  ...filterDataset(),
  schema: [{ key: 'born', label: '生年', appliesTo: 'node', valueType: 'date' }],
  nodes: [
    // a: 1 点（1505 年。精度が年）
    mkNode('a', person, 'A', [], { kind: 'span', start: yearSpan(1505) }),
    // b: 幅のある年代（1498〜1512 の「頃」）
    mkNode('b', person, 'B', [], { kind: 'span', start: span(g(1498), g(1512, 12, 31)) }),
    // c: 期間（1500 年から 1525 年まで）
    mkNode('c', person, 'C', [], { kind: 'span', start: yearSpan(1500), end: yearSpan(1525) }),
    // d: 終わりが不明（1650 年から）
    mkNode('d', person, 'D', [], {
      kind: 'span',
      start: yearSpan(1650),
      end: { kind: 'missing', reason: 'unrecorded' },
    }),
    // e: 年代なし
    mkNode('e', person, 'E', []),
    // f: 時期が欠損
    mkNode('f', person, 'F', [], { kind: 'missing', reason: 'lost' }),
  ],
  edges: [],
};

describe('FR-TM-04: 日付の幅の定義', () => {
  it('FR-TM-04: span は、開始の最も早い日から終了の最も遅い日まで', () => {
    const c = ds.nodes[2];
    if (c === undefined) throw new Error('fixture');
    expect(itemDayRanges(c, { kind: 'span' })).toEqual([
      { earliest: g(1500, 1, 1), latest: g(1525, 12, 31) },
    ]);
  });
  it('FR-TM-04: 終了が欠損なら開始の幅だけ（終わりを推測しない）', () => {
    const d = ds.nodes[3];
    if (d === undefined) throw new Error('fixture');
    expect(itemDayRanges(d, { kind: 'span' })).toEqual([
      { earliest: g(1650, 1, 1), latest: g(1650, 12, 31) },
    ]);
  });
  it('FR-TM-05: 時期が無い、欠損なら幅は空', () => {
    for (const i of [4, 5]) {
      const n = ds.nodes[i];
      if (n === undefined) throw new Error('fixture');
      expect(itemDayRanges(n, { kind: 'span' })).toEqual([]);
    }
  });
  it('FR-TM-04: 複数値の日付属性は、値ごとに幅を持つ。日付でない・欠損は空', () => {
    const n = mkNode('x', person, 'X', [
      ['born', { kind: 'date', value: [span(g(1500)), span(g(1600))] }],
    ]);
    expect(itemDayRanges(n, { kind: 'attr', attr: 'born' })).toHaveLength(2);
    expect(itemDayRanges(n, { kind: 'attr', attr: 'none' })).toEqual([]);
    const m = mkNode('y', person, 'Y', [['born', { kind: 'missing', reason: 'unrecorded' }]]);
    expect(itemDayRanges(m, { kind: 'attr', attr: 'born' })).toEqual([]);
  });
  it('FR-TM-04: 安全な整数でない端の幅は捨てる', () => {
    const n = mkNode('x', person, 'X', [], {
      kind: 'span',
      start: span(0, Number.MAX_SAFE_INTEGER + 10),
    });
    expect(itemDayRanges(n, { kind: 'span' })).toEqual([]);
  });
  it('FR-TM-04: 区切りの始まりの年は、重なる区切りを重複なく昇順で返す', () => {
    const ranges = [
      { earliest: g(1498), latest: g(1512, 12, 31) },
      { earliest: g(1505), latest: g(1505, 12, 31) },
    ];
    expect(binStartYearsOf(ranges, 'gregorian', 10)).toEqual([1490, 1500, 1510]);
    expect(binStartYearsOf([], 'gregorian', 10)).toEqual([]);
  });
});

describe('FR-TM-01 / FR-TM-04: 年表の集計', () => {
  const all = aggregateTimeline(ds, 'node', undefined, { kind: 'span' }, 'gregorian', 10);
  const byYear = (r: typeof all) => new Map(r.bins.map((b) => [b.startYear, b]));

  it('FR-TM-01: 先頭から末尾まで切れ目なく並び、空の区切りも含む', () => {
    expect(all.bins[0]?.startYear).toBe(1490);
    expect(all.bins.at(-1)?.startYear).toBe(1650);
    expect(all.bins).toHaveLength((1650 - 1490) / 10 + 1);
    expect(byYear(all).get(1600)?.count).toBe(0);
  });
  it('FR-TM-04: 幅のある要素は、重なる区切りのすべてに 1 回ずつ数える', () => {
    const m = byYear(all);
    // 1490: b。1500: a, b, c。1510: b, c。1520: c。
    expect(m.get(1490)?.count).toBe(1);
    expect(m.get(1500)?.count).toBe(3);
    expect(m.get(1510)?.count).toBe(2);
    expect(m.get(1520)?.count).toBe(1);
    expect(m.get(1650)?.count).toBe(1);
  });
  it('FR-TM-04: 幅が 1 つの区切りに収まる要素だけが contained に入る', () => {
    const m = byYear(all);
    expect(m.get(1500)?.contained).toBe(1); // a だけ
    expect(m.get(1510)?.contained).toBe(0);
    expect(m.get(1650)?.contained).toBe(1); // d
  });
  it('FR-TM-05: 年代のない要素は区切りに数えず noDate に数える', () => {
    expect(all.noDate).toBe(2);
    expect(all.noDateTotal).toBe(2);
    expect(all.bins.reduce((s, b) => s + b.count, 0)).toBe(1 + 3 + 2 + 1 + 1);
  });
  it('FR-TM-05: 絞り込み後の集合で数え直す。軸と total は全要素のまま、noDate は集合の中だけ', () => {
    const ids = new Set(['a', 'e']);
    const r = aggregateTimeline(ds, 'node', ids, { kind: 'span' }, 'gregorian', 10);
    const m = byYear(r);
    expect(m.get(1500)?.count).toBe(1);
    expect(m.get(1500)?.total).toBe(3);
    expect(m.get(1650)?.count).toBe(0);
    expect(r.bins).toHaveLength(all.bins.length);
    expect(r.noDate).toBe(1); // e だけ（f は絞り込みで除かれた）
    expect(r.noDateTotal).toBe(2);
    expect(r.maxTotal).toBe(3);
  });
  it('FR-TM-01: 区切りの幅を替えると、区切りの数と件数が変わる', () => {
    const w100 = aggregateTimeline(ds, 'node', undefined, { kind: 'span' }, 'gregorian', 100);
    expect(w100.bins.map((b) => b.startYear)).toEqual([1400, 1500, 1600]);
    // 1498〜1512 の b は 1400 と 1500 の両方。
    expect(w100.bins[0]?.count).toBe(1);
    expect(w100.bins[1]?.count).toBe(3);
    const w1 = aggregateTimeline(ds, 'node', undefined, { kind: 'span' }, 'gregorian', 1);
    expect(w1.bins.find((b) => b.startYear === 1505)?.count).toBe(3); // a, b, c
  });
  it('FR-TM-09: ヒジュラ暦で区切ると、ヒジュラ暦の年の境界で分かれる', () => {
    const hds: Dataset = {
      ...filterDataset(),
      nodes: [
        mkNode('h1', person, 'H1', [], {
          kind: 'span',
          start: span(hijriToJdn(905, 1, 1), hijriToJdn(905, 12, 29)),
        }),
        mkNode('h2', person, 'H2', [], {
          kind: 'span',
          start: span(hijriToJdn(911, 1, 1), hijriToJdn(911, 12, 29)),
        }),
      ],
      edges: [],
    };
    const r = aggregateTimeline(hds, 'node', undefined, { kind: 'span' }, 'hijri', 10);
    expect(r.bins.map((b) => [b.startYear, b.count])).toEqual([
      [900, 1],
      [910, 1],
    ]);
  });
  it('FR-TM-01: 日付の属性を出どころにできる。複数値が同じ区切りに入っても 1 回', () => {
    const attrDs: Dataset = {
      ...ds,
      nodes: [
        mkNode('p', person, 'P', [
          ['born', { kind: 'date', value: [span(g(1501)), span(g(1503))] }],
        ]),
        mkNode('q', person, 'Q', [['born', { kind: 'date', value: span(g(1620)) }]]),
        mkNode('r', person, 'R', []),
      ],
    };
    const r = aggregateTimeline(
      attrDs,
      'node',
      undefined,
      { kind: 'attr', attr: 'born' },
      'gregorian',
      10,
    );
    expect(r.bins.find((b) => b.startYear === 1500)?.count).toBe(1);
    expect(r.bins.find((b) => b.startYear === 1500)?.contained).toBe(1);
    expect(r.bins.find((b) => b.startYear === 1620)?.count).toBe(1);
    expect(r.noDate).toBe(1);
  });
  it('FR-TM-01: 複数値が別の区切りにまたがる要素は contained にしない', () => {
    const d2: Dataset = {
      ...ds,
      nodes: [
        mkNode('p', person, 'P', [
          ['born', { kind: 'date', value: [span(g(1501)), span(g(1561))] }],
        ]),
      ],
    };
    const r = aggregateTimeline(
      d2,
      'node',
      undefined,
      { kind: 'attr', attr: 'born' },
      'gregorian',
      10,
    );
    expect(r.bins.filter((b) => b.count > 0).map((b) => b.contained)).toEqual([0, 0]);
  });
  it('FR-TM-01: エッジも数える', () => {
    const eds: Dataset = {
      ...ds,
      edges: [
        mkEdge('e1', 'a', 'b', num(1), { time: { kind: 'span', start: yearSpan(1700) } }),
        mkEdge('e2', 'a', 'b', num(1)),
      ],
    };
    const r = aggregateTimeline(eds, 'edge', undefined, { kind: 'span' }, 'gregorian', 100);
    expect(r.bins.map((b) => [b.startYear, b.count])).toEqual([[1700, 1]]);
    expect(r.noDate).toBe(1);
  });
  it('FR-TM-01: 日付がまったく無ければ区切りは空（上限超えではない）', () => {
    const r = aggregateTimeline(ds, 'edge', undefined, { kind: 'span' }, 'gregorian', 10);
    expect(r.bins).toEqual([]);
    expect(r.tooManyBins).toBe(false);
    expect(r.noDate).toBe(0);
  });
  it('FR-TM-01: 区切りの数が上限を超えるときは集計せず知らせる（件数は数える）', () => {
    const far: Dataset = {
      ...ds,
      nodes: [
        mkNode('p', person, 'P', [], { kind: 'span', start: yearSpan(1500) }),
        mkNode('q', person, 'Q', [], {
          kind: 'span',
          start: span(g(1500 + MAX_TIMELINE_BINS + 10)),
        }),
        mkNode('r', person, 'R', []),
      ],
    };
    const r = aggregateTimeline(far, 'node', undefined, { kind: 'span' }, 'gregorian', 1);
    expect(r.tooManyBins).toBe(true);
    expect(r.bins).toEqual([]);
    expect(r.noDate).toBe(1);
    // 幅を広げれば集計できる。
    expect(
      aggregateTimeline(far, 'node', undefined, { kind: 'span' }, 'gregorian', 25).tooManyBins,
    ).toBe(false);
  });
});

describe('FR-TM-01: 年表の日付の出どころの選択', () => {
  it('FR-TM-01: 期間のある対象は span が先頭、続いて日付の属性', () => {
    expect(timelineSourceOptions(ds, 'node')).toEqual([
      { kind: 'span' },
      { kind: 'attr', attr: 'born' },
    ]);
  });
  it('FR-TM-01: 期間のない対象は日付の属性だけ。何も無ければ空', () => {
    expect(timelineSourceOptions(ds, 'edge')).toEqual([]);
    const noSpan: Dataset = { ...ds, nodes: [mkNode('a', person, 'A', [])] };
    expect(timelineSourceOptions(noSpan, 'node')).toEqual([{ kind: 'attr', attr: 'born' }]);
  });
  it('FR-TM-01: 保存された選択が候補にあればそれ、無ければ最初の候補', () => {
    const opts = timelineSourceOptions(ds, 'node');
    expect(resolveTimelineSource(opts, { kind: 'attr', attr: 'born' })).toEqual({
      kind: 'attr',
      attr: 'born',
    });
    expect(resolveTimelineSource(opts, { kind: 'attr', attr: 'gone' })).toEqual({ kind: 'span' });
    expect(resolveTimelineSource(opts, null)).toEqual({ kind: 'span' });
    expect(resolveTimelineSource([], null)).toBeUndefined();
  });
  it('FR-TM-01: 出どころの同一判定', () => {
    expect(sameTimeSource({ kind: 'span' }, { kind: 'span' })).toBe(true);
    expect(sameTimeSource({ kind: 'span' }, { kind: 'attr', attr: 'a' })).toBe(false);
    expect(sameTimeSource({ kind: 'attr', attr: 'a' }, { kind: 'attr', attr: 'b' })).toBe(false);
  });
});
