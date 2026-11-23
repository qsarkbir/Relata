import { describe, expect, it } from 'vitest';
import { toFilterId } from '../core/filter';
import type { FilterDef } from '../core/filter';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createFilterStore, selectFilterState } from './filterStore';
import { getCertaintyCounts, getFilterResult } from './filterView';

// sampleDataset のエッジに、確からしさを割り当てた小さなデータ。
const base = sampleDataset();
const dataset = {
  ...base,
  edges: base.edges.map((e, i) => ({
    ...e,
    ...(i % 3 === 0
      ? { certainty: 'possible' as const }
      : i % 3 === 1
        ? { certainty: 'certain' as const }
        : {}),
  })),
};
const filter: FilterDef = {
  id: toFilterId('c'),
  kind: 'certainty',
  target: 'edge',
  include: ['possible'],
};

describe('FR-DM-06: 確からしさのフィルタの状態', () => {
  it('FR-DM-06: 件数は絞り込み後の集合から数え直し、Undo で戻る', () => {
    const s = createFilterStore();
    const total = dataset.edges.length;
    const before = getCertaintyCounts(dataset, selectFilterState(s.getState()), 'edge');
    expect(before.reduce((n, c) => n + c.total, 0)).toBe(total);
    s.getState().add(filter);
    const state = selectFilterState(s.getState());
    const result = getFilterResult(dataset, state);
    const possible = dataset.edges.filter((e) => e.certainty === 'possible').length;
    expect(result.counts.edges.shown).toBe(possible);
    // 自分自身の確からしさのフィルタは件数から除く（選び直せるように）。
    expect(getCertaintyCounts(dataset, state, 'edge')).toEqual(before);
    s.getState().undo();
    expect(getFilterResult(dataset, selectFilterState(s.getState())).counts.edges.shown).toBe(
      total,
    );
  });
});
