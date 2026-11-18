import { describe, expect, it } from 'vitest';
import { applyFilters } from './apply';
import { fid, filterDataset, sorted, st } from './fixtures/filterDataset';
import {
  addFilter,
  clearFilters,
  removeFilter,
  replaceFilter,
  setEdgeRule,
  setShowIsolated,
} from './state';
import { DEFAULT_FILTER_STATE, toFilterId, type FilterDef } from './types';

const role = (...values: string[]): FilterDef => ({
  id: fid('role'),
  kind: 'category',
  target: 'node',
  attr: 'role',
  include: values.map((value) => ({ kind: 'value', value })),
});
const text: FilterDef = {
  id: fid('t'),
  kind: 'text',
  target: 'node',
  query: 'bilal',
  matching: 'loose',
};

describe('FilterState の操作', () => {
  it('FR-FL-01: 既定の状態は両端の規則で、孤立ノードを表示しない', () => {
    expect(DEFAULT_FILTER_STATE).toEqual({
      filters: [],
      edgeRule: 'both-ends',
      showIsolated: false,
    });
  });

  it('FR-FL-08: 追加すると一覧に並び、元の状態は変わらない', () => {
    const s0 = st([]);
    const s1 = addFilter(s0, role('qadi'));
    expect(s0.filters).toHaveLength(0);
    expect(s1.filters.map((f) => f.id)).toEqual(['role']);
  });

  it('FR-FL-08: 同じ ID の追加は、位置を変えずに置き換える（ID は重複しない）', () => {
    const s = addFilter(addFilter(addFilter(st([]), role('qadi')), text), role('scholar'));
    expect(s.filters.map((f) => f.id)).toEqual(['role', 't']);
    expect(s.filters[0]).toEqual(role('scholar'));
  });

  it('FR-FL-10: 同じ参照の定義の追加と置き換えは、state をそのまま返す（履歴の空振りを防ぐ）', () => {
    const f = role('qadi');
    const s = st([f]);
    expect(addFilter(s, f)).toBe(s);
    expect(replaceFilter(s, f)).toBe(s);
  });

  it('FR-FL-08: replaceFilter は既存のものだけを置き換え、無ければ同じ状態を返す', () => {
    const s = st([role('qadi')]);
    expect(replaceFilter(s, role('scholar')).filters[0]).toEqual(role('scholar'));
    expect(replaceFilter(s, text)).toBe(s);
  });

  it('FR-FL-08: 解除すると一覧からも実際の絞り込みからも消える', () => {
    const ds = filterDataset();
    const withRole = st([role('qadi'), text], { showIsolated: true });
    const before = applyFilters(ds, withRole);
    const after = removeFilter(withRole, toFilterId('role'));
    expect(after.filters.map((f) => f.id)).toEqual(['t']);
    // 残りの text だけの結果と同じ（解除した role の絞り込みは残らない）
    expect(sorted(applyFilters(ds, after).nodeIds)).toEqual(
      sorted(applyFilters(ds, st([text], { showIsolated: true })).nodeIds),
    );
    expect(before.nodeIds.size).toBe(0); // role=qadi と bilal の両方を満たすノードは無い
    expect(applyFilters(ds, after).nodeIds.size).toBeGreaterThan(0);
  });

  it('FR-FL-08: 一括で解除すると、設定を残してフィルタだけが空になる', () => {
    const ds = filterDataset();
    const s = st([role('qadi'), text], { edgeRule: 'either-end', showIsolated: true });
    const cleared = clearFilters(s);
    expect(cleared).toEqual({ filters: [], edgeRule: 'either-end', showIsolated: true });
    expect(applyFilters(ds, cleared).nodeIds.size).toBe(7);
  });

  it('FR-FL-08: 無い ID の解除や、空の一括解除は同じ状態を返す', () => {
    const s = st([role('qadi')]);
    expect(removeFilter(s, toFilterId('zzz'))).toBe(s);
    const empty = st([]);
    expect(clearFilters(empty)).toBe(empty);
  });

  it('FR-FL-04、FR-FL-05: 規則と孤立ノードの設定を変える', () => {
    const s = st([]);
    expect(setEdgeRule(s, 'either-end').edgeRule).toBe('either-end');
    expect(setEdgeRule(s, 'both-ends')).toBe(s);
    expect(setShowIsolated(s, true).showIsolated).toBe(true);
    expect(setShowIsolated(s, false)).toBe(s);
  });

  it('toFilterId: 空文字は拒否する', () => {
    expect(() => toFilterId('')).toThrow(RangeError);
  });
});
