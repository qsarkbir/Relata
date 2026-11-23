import { describe, expect, it } from 'vitest';
import { gregorianToJdn, hijriToJdn } from '../time';
import { fid, filterDataset, mkNode, person, span } from './fixtures/filterDataset';
import { dateAttributes, describeTimeFilter, timeDataExtent } from './timeSource';
import type { Dataset } from '../model';
import type { FilterDef } from './types';

type TimeDef = Extract<FilterDef, { kind: 'time' }>;
const base: TimeDef = {
  id: fid('t'),
  kind: 'time',
  target: 'node',
  source: { kind: 'span' },
  from: gregorianToJdn(1500, 1, 1),
  to: gregorianToJdn(1510, 12, 31),
  match: 'overlaps',
  missing: 'exclude',
};

describe('FR-FL-03: 日付属性の一覧', () => {
  const withDates: Dataset = {
    ...filterDataset(),
    schema: [
      { key: 'born', label: '生年', appliesTo: 'node', valueType: 'date' },
      { key: 'sent', label: '発信日', appliesTo: 'edge', valueType: 'date' },
      { key: 'age', label: '年齢', appliesTo: 'node', valueType: 'number' },
    ],
  };
  it('FR-FL-03: 対象ごとに valueType が date の属性だけを返す', () => {
    expect(dateAttributes(withDates, 'node').map((a) => a.key)).toEqual(['born']);
    expect(dateAttributes(withDates, 'edge').map((a) => a.key)).toEqual(['sent']);
  });
  it('FR-FL-03: 日付属性が無ければ空', () => {
    expect(dateAttributes({ ...withDates, schema: [] }, 'node')).toEqual([]);
  });
});

describe('FR-FL-03 / FR-TM-09: 時間フィルタの説明', () => {
  const ds: Dataset = {
    ...filterDataset(),
    schema: [{ key: 'born', label: '生年', appliesTo: 'node', valueType: 'date' }],
  };
  it('FR-FL-03: span は属性名なし、match と missing をそのまま返す', () => {
    const d = describeTimeFilter({ ...base, match: 'within', missing: 'include' }, ds, 'gregorian');
    expect(d.source).toEqual({ kind: 'span' });
    expect(d.match).toBe('within');
    expect(d.missing).toBe('include');
    expect(d.reversed).toBe(false);
  });
  it('FR-FL-03: attr は属性のキーと表示名、schema に無ければ表示名なし', () => {
    const d = describeTimeFilter(
      { ...base, source: { kind: 'attr', attr: 'born' } },
      ds,
      'gregorian',
    );
    expect(d.source).toEqual({ kind: 'attr', attr: 'born', label: '生年' });
    const e = describeTimeFilter(
      { ...base, source: { kind: 'attr', attr: 'zzz' } },
      ds,
      'gregorian',
    );
    expect(e.source).toEqual({ kind: 'attr', attr: 'zzz', label: undefined });
    const f = describeTimeFilter(
      { ...base, source: { kind: 'attr', attr: 'born' } },
      undefined,
      'gregorian',
    );
    expect(f.source).toMatchObject({ label: undefined });
  });
  it('FR-TM-09: 範囲は選んだ暦で部品になる', () => {
    const d = describeTimeFilter(base, ds, 'both');
    expect(d.range.map((r) => r.calendar)).toEqual(['gregorian', 'hijri']);
    expect(d.range[0]?.from).toMatchObject({ year: 1500 });
    expect(d.range[0]?.to).toMatchObject({ year: 1510 });
  });
  it('FR-TM-09: ヒジュラ暦の年の範囲をヒジュラ暦で表すと年精度', () => {
    const d = describeTimeFilter(
      { ...base, from: hijriToJdn(905, 1, 1), to: hijriToJdn(906, 1, 1) - 1 },
      ds,
      'hijri',
    );
    expect(d.range[0]?.from).toEqual({ calendar: 'hijri', era: 'common', year: 905 });
    expect(d.range[0]?.to).toBeUndefined();
  });
  it('FR-FL-03: 逆転した範囲は reversed で、表記は並べ替えて返す', () => {
    const d = describeTimeFilter({ ...base, from: base.to, to: base.from }, ds, 'gregorian');
    expect(d.reversed).toBe(true);
    expect(d.range[0]?.from).toMatchObject({ year: 1500 });
  });
});

describe('FR-FL-03: データの日付の最小値と最大値', () => {
  const ds: Dataset = {
    ...filterDataset(),
    nodes: [
      mkNode('a', person, 'A', [['born', { kind: 'date', value: span(100, 120) }]]),
      mkNode('b', person, 'B', [['born', { kind: 'date', value: [span(50), span(300, 310)] }]]),
      mkNode('c', person, 'C', [['born', { kind: 'missing', reason: 'unrecorded' }]]),
      mkNode('d', person, 'D', [], { kind: 'span', start: span(10, 20), end: span(900) }),
    ],
    edges: [],
  };
  it('FR-FL-03: 属性の日付は、複数値と幅の両端まで数え、欠損は数えない', () => {
    expect(timeDataExtent(ds, 'node', { kind: 'attr', attr: 'born' })).toEqual({
      min: 50,
      max: 310,
    });
  });
  it('FR-FL-03: span は始点と終点を数える', () => {
    expect(timeDataExtent(ds, 'node', { kind: 'span' })).toEqual({ min: 10, max: 900 });
  });
  it('FR-FL-03: 日付が無ければ undefined', () => {
    expect(timeDataExtent(ds, 'edge', { kind: 'span' })).toBeUndefined();
    expect(timeDataExtent(ds, 'node', { kind: 'attr', attr: 'none' })).toBeUndefined();
  });
});
