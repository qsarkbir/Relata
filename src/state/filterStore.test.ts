import { describe, expect, it } from 'vitest';
import { toFilterId } from '../core/filter';
import type { CategoryKey, FilterDef, FilterState } from '../core/filter';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createDataStore } from './dataStore';
import {
  bindFilterToData,
  createFilterStore,
  selectCanRedo,
  selectCanUndo,
  selectFilterState,
} from './filterStore';
import { getFacetCounts, getFilterIssues, getFilterResult } from './filterView';

const q = (value: string): CategoryKey => ({ kind: 'value', value });
const roleFilter = (id: string, ...values: string[]): FilterDef => ({
  id: toFilterId(id),
  kind: 'category',
  target: 'node',
  attr: 'role',
  include: values.map(q),
});

describe('filterStore', () => {
  it('FR-FL-10: 追加を Undo と Redo で往復できる', () => {
    const s = createFilterStore();
    s.getState().add(roleFilter('a', 'qadi'));
    expect(selectFilterState(s.getState()).filters).toHaveLength(1);
    expect(selectCanUndo(s.getState())).toBe(true);
    s.getState().undo();
    expect(selectFilterState(s.getState()).filters).toHaveLength(0);
    expect(selectCanRedo(s.getState())).toBe(true);
    s.getState().redo();
    expect(selectFilterState(s.getState()).filters).toHaveLength(1);
  });

  it('FR-FL-10: 新しい操作をするとやり直しの履歴は消える', () => {
    const s = createFilterStore();
    s.getState().add(roleFilter('a', 'qadi'));
    s.getState().undo();
    s.getState().setShowIsolated(true);
    expect(selectCanRedo(s.getState())).toBe(false);
  });

  it('FR-FL-10: 変化の無い操作は履歴を増やさない', () => {
    const s = createFilterStore();
    s.getState().setEdgeRule('both-ends'); // 既定と同じ
    s.getState().remove(toFilterId('none'));
    s.getState().clearAll();
    expect(selectCanUndo(s.getState())).toBe(false);
  });

  it('FR-FL-04, FR-FL-05: edgeRule と showIsolated を変えられる', () => {
    const s = createFilterStore();
    s.getState().setEdgeRule('either-end');
    s.getState().setShowIsolated(true);
    expect(selectFilterState(s.getState())).toMatchObject({
      edgeRule: 'either-end',
      showIsolated: true,
    });
  });

  it('FR-FL-08: 個別に解除すると一覧からも実際の絞り込みからも消える', () => {
    const ds = sampleDataset();
    const s = createFilterStore();
    s.getState().add(roleFilter('a', 'qadi'));
    const narrowed = getFilterResult(ds, selectFilterState(s.getState()));
    s.getState().remove(toFilterId('a'));
    const state = selectFilterState(s.getState());
    expect(state.filters).toHaveLength(0);
    expect(getFilterResult(ds, state).counts.nodes.shown).toBeGreaterThan(
      narrowed.counts.nodes.shown,
    );
  });

  it('FR-FL-08: 一括解除すると一覧も絞り込みも消え、表示の設定は残る', () => {
    const ds = sampleDataset();
    const s = createFilterStore();
    s.getState().setShowIsolated(true);
    s.getState().add(roleFilter('a', 'qadi'));
    s.getState().add(roleFilter('b', 'scholar'));
    s.getState().clearAll();
    const state = selectFilterState(s.getState());
    expect(state.filters).toEqual([]);
    expect(state.showIsolated).toBe(true);
    expect(getFilterResult(ds, state).counts.nodes.shown).toBe(ds.nodes.length);
    s.getState().undo();
    expect(selectFilterState(s.getState()).filters).toHaveLength(2);
  });

  it('FR-FL-08: 同じ ID の追加は置き換えで、一覧に重複しない', () => {
    const s = createFilterStore();
    s.getState().add(roleFilter('a', 'qadi'));
    s.getState().add(roleFilter('a', 'scholar'));
    expect(selectFilterState(s.getState()).filters).toHaveLength(1);
    s.getState().replace(roleFilter('zzz', 'x')); // 無い ID の置き換えは無視
    expect(selectFilterState(s.getState()).filters).toHaveLength(1);
  });

  it('FR-FL-10: reset は履歴を捨てて、指定した状態から始める', () => {
    const s = createFilterStore();
    s.getState().add(roleFilter('a', 'qadi'));
    const init: FilterState = { filters: [], edgeRule: 'either-end', showIsolated: false };
    s.getState().reset(init);
    expect(selectFilterState(s.getState())).toBe(init);
    expect(selectCanUndo(s.getState())).toBe(false);
  });

  it('FR-FL-08: データを読み替えると履歴が初期化される', () => {
    const data = createDataStore();
    const s = createFilterStore();
    const unbind = bindFilterToData(s, data);
    s.getState().add(roleFilter('a', 'qadi'));
    data.getState().setDataset(sampleDataset());
    expect(selectFilterState(s.getState()).filters).toHaveLength(0);
    expect(selectCanUndo(s.getState())).toBe(false);
    s.getState().add(roleFilter('a', 'qadi'));
    unbind();
    data.getState().setDataset(null);
    expect(selectFilterState(s.getState()).filters).toHaveLength(1);
  });
});

describe('filterView（計算の覚え方）', () => {
  it('FR-FL-09: 同じ入力なら同じ結果のオブジェクトを返し、入力が変われば計算し直す', () => {
    const ds = sampleDataset();
    const s = createFilterStore();
    const st1 = selectFilterState(s.getState());
    expect(getFilterResult(ds, st1)).toBe(getFilterResult(ds, st1));
    s.getState().add(roleFilter('a', 'qadi'));
    const st2 = selectFilterState(s.getState());
    expect(getFilterResult(ds, st2)).not.toBe(getFilterResult(ds, st1));
    // Undo で前の状態に戻っても、同じ参照なので覚えている結果が返る
    const r1 = getFilterResult(ds, st1);
    s.getState().undo();
    expect(getFilterResult(ds, selectFilterState(s.getState()))).toBe(r1);
  });

  it('FR-FL-07, NFR-04: ファセットの件数は edgeRule と showIsolated の変更で計算し直さない', () => {
    const ds = sampleDataset();
    const s = createFilterStore();
    s.getState().add(roleFilter('a', 'qadi'));
    const before = selectFilterState(s.getState());
    const counts = getFacetCounts(ds, before, 'node', 'role');
    expect(getFacetCounts(ds, before, 'node', 'role')).toBe(counts);
    s.getState().setEdgeRule('either-end');
    s.getState().setShowIsolated(true);
    const after = selectFilterState(s.getState());
    expect(after).not.toBe(before);
    expect(after.filters).toBe(before.filters);
    expect(getFacetCounts(ds, after, 'node', 'role')).toBe(counts);
    expect(getFilterIssues(ds, after)).toBe(getFilterIssues(ds, before));
    // フィルタを変えれば計算し直す
    s.getState().add(roleFilter('b', 'scholar'));
    expect(getFacetCounts(ds, selectFilterState(s.getState()), 'node', 'role')).not.toBe(counts);
  });

  it('FR-FL-07: ファセットの件数と問題は、同じ入力なら同じ配列を返す', () => {
    const ds = sampleDataset();
    const st = selectFilterState(createFilterStore().getState());
    expect(getFacetCounts(ds, st, 'node', 'role')).toBe(getFacetCounts(ds, st, 'node', 'role'));
    expect(getFacetCounts(ds, st, 'node', 'role')).not.toBe(getFacetCounts(ds, st, 'node', 'note'));
    expect(getFilterIssues(ds, st)).toBe(getFilterIssues(ds, st));
  });

  it('FR-FL-09: 同じ FilterState でも、別の Dataset ではキャッシュが分かれる', () => {
    const a = sampleDataset();
    const b = sampleDataset(); // 内容は同じでも別の参照
    const st = selectFilterState(createFilterStore().getState());
    expect(getFilterResult(a, st)).not.toBe(getFilterResult(b, st));
    expect(getFacetCounts(a, st, 'node', 'role')).not.toBe(getFacetCounts(b, st, 'node', 'role'));
    expect(getFilterIssues(a, st)).not.toBe(getFilterIssues(b, st));
    expect(getFilterResult(a, st)).toBe(getFilterResult(a, st));
  });
});
