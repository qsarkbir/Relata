import { describe, expect, it } from 'vitest';
import { applyFilters } from './apply';
import { checkFilterState } from './check';
import { describeTimeFilter } from './timeSource';
import { fid, filterDataset, sorted, st } from './fixtures/filterDataset';
import { parseFilterState } from './parse';
import { gregorianToJdn } from '../time';
import type { FilterDef } from './types';

type TimeDef = Extract<FilterDef, { kind: 'time' }>;
const ds = filterDataset();
// 範囲の項目（from、to）は、無い側が開いた端。
const time = (
  range: { from?: number; to?: number },
  match: 'overlaps' | 'within',
  missing: 'include' | 'exclude' = 'exclude',
): TimeDef => ({
  id: fid('tm'),
  kind: 'time',
  target: 'node',
  source: { kind: 'span' },
  ...range,
  match,
  missing,
});
// p1 = [100, 220]、p4 = [300, 終わりが欠損 = +∞]、iso は時期が欠損。他は時期の項目が無く、常に通る。
const nodes = (f: FilterDef): string[] =>
  sorted(applyFilters(ds, st([f], { showIsolated: true })).nodeIds);
const NO_TIME = ['c1', 'c2', 'p2', 'p3'];

describe('FR-FL-03: 開いた端の時間フィルタ（適用）', () => {
  it('FR-FL-03: 重なる × 終わりが開いている（from だけ）', () => {
    expect(nodes(time({ from: 250 }, 'overlaps'))).toEqual([...NO_TIME, 'p4'].sort());
    expect(nodes(time({ from: 200 }, 'overlaps'))).toEqual([...NO_TIME, 'p1', 'p4'].sort());
  });
  it('FR-FL-03: 収まる × 終わりが開いている。終わりが欠損（+∞）の期間も収まる', () => {
    // 終わりが +∞ の p4 は、to が開いていれば収まる。p1 は始まりが 100 なので from=50 でも収まる
    expect(nodes(time({ from: 50 }, 'within'))).toEqual([...NO_TIME, 'p1', 'p4'].sort());
    // from=150 だと p1（始まり 100）は収まらない
    expect(nodes(time({ from: 150 }, 'within'))).toEqual([...NO_TIME, 'p4'].sort());
  });
  it('FR-FL-03: 収まる × to だけ。終わりが欠損の期間は収まらない', () => {
    expect(nodes(time({ to: 500 }, 'within'))).toEqual([...NO_TIME, 'p1'].sort());
  });
  it('FR-FL-03: 重なる × to だけ（始まりが開いている）', () => {
    expect(nodes(time({ to: 150 }, 'overlaps'))).toEqual([...NO_TIME, 'p1'].sort());
    expect(nodes(time({ to: 50 }, 'overlaps'))).toEqual(NO_TIME);
  });
  it('FR-FL-03: 欠損の設定は開いた端でも効く', () => {
    expect(nodes(time({ from: 250 }, 'overlaps', 'include'))).toContain('iso');
    expect(nodes(time({ from: 250 }, 'overlaps'))).not.toContain('iso');
  });
  it('FR-FL-03: 両方とも開いていれば、時期のある要素はすべて通る（check が不正と報告する）', () => {
    expect(nodes(time({}, 'within'))).toEqual([...NO_TIME, 'p1', 'p4'].sort());
  });
});

describe('FR-FL-03: 開いた端の検査・保存', () => {
  it('FR-FL-03: 両方なしは time-unbounded、片側だけなら問題なし', () => {
    expect(checkFilterState(ds, st([time({}, 'overlaps')]))).toEqual([
      { kind: 'time-unbounded', filterId: 'tm' },
    ]);
    expect(checkFilterState(ds, st([time({ from: 1 }, 'overlaps')]))).toEqual([]);
    expect(checkFilterState(ds, st([time({ to: 1 }, 'within')]))).toEqual([]);
  });
  it('FR-FL-03: 保存の往復で、開いた端は項目ごと省かれ、元に戻る', () => {
    const state = st([
      time({ from: 5 }, 'overlaps'),
      { ...time({ to: 9 }, 'within'), id: fid('t2') },
    ]);
    const json: unknown = JSON.parse(JSON.stringify(state));
    expect(JSON.stringify(state)).not.toContain('Infinity');
    const r = parseFilterState(json);
    expect(r).toEqual({ ok: true, value: state });
    if (r.ok) {
      const [a, b] = r.value.filters;
      expect(a && Object.hasOwn(a, 'to')).toBe(false);
      expect(b && Object.hasOwn(b, 'from')).toBe(false);
    }
  });
  it('FR-FL-03: 保存の読み込みは、両方なしも読める（check が報告する）。型の違う値は拒否', () => {
    const f = (extra: object): unknown => ({
      filters: [
        {
          id: 'a',
          kind: 'time',
          target: 'node',
          source: { kind: 'span' },
          match: 'within',
          missing: 'include',
          ...extra,
        },
      ],
    });
    expect(parseFilterState(f({})).ok).toBe(true);
    expect(parseFilterState(f({ from: '1500' }))).toMatchObject({
      ok: false,
      path: 'filters[0].from',
    });
    expect(parseFilterState(f({ to: 1.5 }))).toMatchObject({ ok: false, path: 'filters[0].to' });
  });
});

describe('FR-FL-03 / FR-TM-09: 開いた端の説明', () => {
  const a = gregorianToJdn(1500, 1, 1);
  it('FR-FL-03: bound と range が、閉じている端に合う', () => {
    const both = describeTimeFilter(
      time({ from: a, to: a + 10 }, 'overlaps'),
      undefined,
      'gregorian',
    );
    expect(both.bound).toBe('both');
    const fromOnly = describeTimeFilter(time({ from: a }, 'overlaps'), undefined, 'gregorian');
    expect(fromOnly).toMatchObject({ bound: 'from-only', to: undefined, reversed: false });
    // 年の初日なので年の精度（「1500 年以後」）
    expect(fromOnly.range[0]?.from).toEqual({ calendar: 'gregorian', era: 'common', year: 1500 });
    const toOnly = describeTimeFilter(time({ to: a }, 'within'), undefined, 'both');
    expect(toOnly).toMatchObject({ bound: 'to-only', from: undefined });
    expect(toOnly.range).toHaveLength(2);
    const none = describeTimeFilter(time({}, 'within'), undefined, 'gregorian');
    expect(none).toMatchObject({ bound: 'none', range: [] });
  });
  it('FR-TM-09: 片側だけの端の精度は暦ごとに推測する（年初なら年、月初なら月、年末なら年、それ以外は日）', () => {
    const d = (
      r: { from?: number; to?: number },
      display: 'gregorian' | 'hijri' | 'both' = 'gregorian',
    ) => describeTimeFilter(time(r, 'overlaps'), undefined, display).range;
    expect(d({ from: gregorianToJdn(1600, 3, 1) })[0]?.from).toEqual({
      calendar: 'gregorian',
      era: 'common',
      year: 1600,
      month: 3,
    });
    expect(d({ from: gregorianToJdn(1600, 3, 2) })[0]?.from).toMatchObject({ day: 2 });
    expect(d({ to: gregorianToJdn(1600, 12, 31) })[0]?.from).toEqual({
      calendar: 'gregorian',
      era: 'common',
      year: 1600,
    });
    expect(d({ to: gregorianToJdn(1600, 2, 29) })[0]?.from).toMatchObject({ month: 2 });
    expect(d({ to: gregorianToJdn(1600, 2, 29) })[0]?.from.day).toBeUndefined();
    expect(d({ to: gregorianToJdn(1600, 2, 28) })[0]?.from).toMatchObject({ day: 28 });
    // both: 西暦の年初は、ヒジュラ暦では日の精度
    const both = d({ from: gregorianToJdn(1600, 1, 1) }, 'both');
    expect(both[0]?.from.month).toBeUndefined();
    expect(both[1]?.from.day).toBeDefined();
  });
});
