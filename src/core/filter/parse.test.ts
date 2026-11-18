import { describe, expect, it } from 'vitest';
import { applyFilters } from './apply';
import { fid, filterDataset, sorted, st } from './fixtures/filterDataset';
import { parseFilterState } from './parse';
import { toNodeTypeId } from '../model';
import type { FilterDef, FilterState } from './types';

const all: FilterDef[] = [
  {
    id: fid('c'),
    kind: 'category',
    target: 'node',
    attr: 'role',
    include: [
      { kind: 'value', value: 'qadi' },
      { kind: 'missing', reason: 'lost' },
    ],
  },
  {
    id: fid('r1'),
    kind: 'range',
    target: 'node',
    attr: 'age',
    min: 40,
    max: 60,
    missing: 'exclude',
  },
  { id: fid('r2'), kind: 'range', target: 'edge', attr: 'amount', missing: 'include' },
  {
    id: fid('t'),
    kind: 'time',
    target: 'edge',
    from: -5,
    to: 2_000_000,
    match: 'within',
    missing: 'include',
  },
  { id: fid('x'), kind: 'text', target: 'node', query: 'أحمد', matching: 'strict' },
  { id: fid('n'), kind: 'nodeType', include: [toNodeTypeId('person')] },
];

const roundTrip = (s: FilterState): unknown => parseFilterState(JSON.parse(JSON.stringify(s)));

describe('parseFilterState（D-21 (8)、D-24）', () => {
  it('FR-PJ-01: 全種類のフィルタが JSON を往復しても同じになる', () => {
    const state = st(all, { edgeRule: 'either-end', showIsolated: true });
    expect(roundTrip(state)).toEqual({ ok: true, value: state });
  });

  it('FR-PJ-01: 往復したものを適用しても同じ結果になる', () => {
    const ds = filterDataset();
    const state = st(all.slice(0, 2));
    const r = parseFilterState(JSON.parse(JSON.stringify(state)));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(sorted(applyFilters(ds, r.value).nodeIds)).toEqual(
      sorted(applyFilters(ds, state).nodeIds),
    );
  });

  it('FR-PJ-01: 既定の状態も往復できる', () => {
    expect(roundTrip(st([]))).toEqual({ ok: true, value: st([]) });
  });

  it('D-24: edgeRule と showIsolated が無ければ既定値で補う', () => {
    expect(parseFilterState({ filters: [] })).toEqual({ ok: true, value: st([]) });
  });

  it('D-24: 余分な項目は落とす', () => {
    const r = parseFilterState({
      filters: [{ id: 'a', kind: 'text', target: 'node', query: 'q', matching: 'loose', extra: 1 }],
      extra: true,
    });
    expect(r).toEqual({
      ok: true,
      value: st([{ id: fid('a'), kind: 'text', target: 'node', query: 'q', matching: 'loose' }]),
    });
  });

  it('D-24: __proto__ の項目を引き継がない', () => {
    const json =
      '{"filters":[{"id":"a","kind":"nodeType","include":["person"],"__proto__":{"polluted":1}}],"__proto__":{"polluted":2}}';
    const r = parseFilterState(JSON.parse(json));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.hasOwn(r.value, '__proto__')).toBe(false);
    expect(Object.hasOwn(r.value.filters[0] ?? {}, '__proto__')).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('FR-FL-02: 列名が constructor や __proto__ のフィルタも往復できる', () => {
    const f = (attr: string): FilterDef => ({
      id: fid(attr),
      kind: 'category',
      target: 'node',
      attr,
      include: [{ kind: 'value', value: 'v' }],
    });
    const state = st([f('constructor'), f('__proto__')]);
    expect(roundTrip(state)).toEqual({ ok: true, value: state });
  });

  it('FR-FL-02: min と max が無い範囲フィルタは、項目を作らない', () => {
    const r = parseFilterState({
      filters: [{ id: 'a', kind: 'range', target: 'node', attr: 'age', missing: 'exclude' }],
    });
    expect(r.ok && Object.keys(r.value.filters[0] ?? {})).toEqual([
      'id',
      'kind',
      'target',
      'attr',
      'missing',
    ]);
  });

  const bad = (x: unknown): { path: string } | undefined => {
    const r = parseFilterState(x);
    return r.ok ? undefined : { path: r.path };
  };

  it('壊れた入力は、壊れた場所の経路を返す', () => {
    expect(bad(null)).toEqual({ path: '' });
    expect(bad([])).toEqual({ path: '' });
    expect(bad({})).toEqual({ path: 'filters' });
    expect(bad({ filters: {} })).toEqual({ path: 'filters' });
    expect(bad({ filters: [1] })).toEqual({ path: 'filters[0]' });
    expect(bad({ filters: [{ id: '', kind: 'nodeType', include: [] }] })).toEqual({
      path: 'filters[0].id',
    });
    expect(bad({ filters: [{ id: 'a', kind: 'zzz' }] })).toEqual({ path: 'filters[0].kind' });
    expect(
      bad({
        filters: [
          {
            id: 'a',
            kind: 'category',
            target: 'node',
            attr: 'x',
            include: [{ kind: 'missing', reason: 'nope' }],
          },
        ],
      }),
    ).toEqual({
      path: 'filters[0].include[0].reason',
    });
    expect(
      bad({ filters: [{ id: 'a', kind: 'category', target: 'both', attr: 'x', include: [] }] }),
    ).toEqual({
      path: 'filters[0].target',
    });
    expect(
      bad({
        filters: [
          { id: 'a', kind: 'range', target: 'node', attr: 'x', min: 'a', missing: 'include' },
        ],
      }),
    ).toEqual({
      path: 'filters[0].min',
    });
    expect(
      bad({
        filters: [
          { id: 'a', kind: 'range', target: 'node', attr: 'x', max: null, missing: 'include' },
        ],
      }),
    ).toEqual({
      path: 'filters[0].max',
    });
    expect(
      bad({
        filters: [
          {
            id: 'a',
            kind: 'time',
            target: 'node',
            from: 1.5,
            to: 2,
            match: 'within',
            missing: 'include',
          },
        ],
      }),
    ).toEqual({
      path: 'filters[0].from',
    });
    expect(
      bad({ filters: [{ id: 'a', kind: 'text', target: 'node', query: 'q', matching: 'fuzzy' }] }),
    ).toEqual({
      path: 'filters[0].matching',
    });
    expect(bad({ filters: [{ id: 'a', kind: 'nodeType', include: ['ok', ''] }] })).toEqual({
      path: 'filters[0].include[1]',
    });
    expect(bad({ filters: [], edgeRule: 'any' })).toEqual({ path: 'edgeRule' });
    expect(bad({ filters: [], showIsolated: 'yes' })).toEqual({ path: 'showIsolated' });
  });

  it('FR-FL-02: 逆転した範囲（min > max、from > to）は拒否する。両端が同じなら許す', () => {
    const range = (min: number, max: number): unknown => ({
      filters: [
        { id: 'a', kind: 'range', target: 'node', attr: 'x', min, max, missing: 'include' },
      ],
    });
    expect(bad(range(2, 1))).toEqual({ path: 'filters[0].max' });
    expect(bad(range(1, 1))).toBeUndefined();
    const time = (from: number, to: number): unknown => ({
      filters: [
        { id: 'a', kind: 'time', target: 'node', from, to, match: 'within', missing: 'include' },
      ],
    });
    expect(bad(time(5, 4))).toEqual({ path: 'filters[0].to' });
    expect(bad(time(4, 4))).toBeUndefined();
  });

  it('FR-FL-08: フィルタの ID が重複していると拒否する', () => {
    const f = { id: 'a', kind: 'nodeType', include: [] };
    expect(bad({ filters: [f, f] })).toEqual({ path: 'filters[1].id' });
  });

  it('継承した項目（constructor）を値として読まない', () => {
    // target が無いカテゴリは壊れた入力。Object.prototype の constructor を拾って通してはいけない
    expect(bad({ filters: [{ id: 'a', kind: 'category', attr: 'x', include: [] }] })).toEqual({
      path: 'filters[0].target',
    });
  });
});
