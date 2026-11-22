/** 旧版の操作順で、状態から表示・集計・指標までを通す回帰テスト（T1-23）。 */
import { describe, expect, it } from 'vitest';
import { applyFilters, facetCounts, toFilterId, DEFAULT_FILTER_STATE } from '../core/filter';
import type { FilterDef, FilterState } from '../core/filter';
import { buildGraph, toSnapshot } from '../core/graph';
import { computeMetrics } from '../core/metrics';
import type { MetricsResult } from '../core/metrics';
import { createMetricsClient } from '../workers/metrics.client';
import type { MetricsWorkerHandle } from '../workers/metrics.client';
import { makeAttrs, toNodeId, toEdgeId, toNodeTypeId } from '../core/model';
import type { Dataset, FuzzyDate } from '../core/model';
import { createFilterStore, selectFilterState } from '../state/filterStore';
import { findFilters } from '../views/filter/activeFilters';
import { DEFAULT_IMPORT_SETTINGS, parseProject, serializeProject } from '../io/project';

const occupation = 'Occupation (source), notes';
const person = toNodeTypeId('person');
const category: FilterDef = {
  id: toFilterId('from a saved project, (1)'),
  kind: 'category',
  target: 'node',
  attr: occupation,
  include: [{ kind: 'value', value: 'researcher' }],
};
function date(day: number): FuzzyDate {
  return {
    earliest: day,
    latest: day,
    calendar: 'gregorian',
    certainty: 'certain',
    label: String(day),
  };
}
function dataset(): Dataset {
  return {
    graphMode: 'directed',
    nodeTypes: [{ id: person, label: '人物' }],
    meta: { title: '回帰用' },
    schema: [
      { key: occupation, label: occupation, appliesTo: 'node', valueType: 'category' },
      { key: 'amount', label: '額', appliesTo: 'edge', valueType: 'number' },
      { key: 'other', label: '別の額', appliesTo: 'edge', valueType: 'number' },
    ],
    nodes: ['a', 'b', 'c', 'iso'].map((id) => ({
      id: toNodeId(id),
      type: person,
      label: id,
      attrs: makeAttrs([
        [occupation, { kind: 'value', value: id === 'b' ? 'student' : 'researcher' }],
      ]),
    })),
    edges: [
      {
        id: toEdgeId('e1'),
        source: toNodeId('a'),
        target: toNodeId('b'),
        directed: true,
        weight: 10,
        attrs: makeAttrs([
          ['amount', { kind: 'value', value: 10 }],
          ['other', { kind: 'value', value: 2 }],
        ]),
        time: { kind: 'span', start: date(100), end: date(120) },
      },
      {
        id: toEdgeId('e2'),
        source: toNodeId('a'),
        target: toNodeId('b'),
        directed: true,
        weight: 20,
        attrs: makeAttrs([
          ['amount', { kind: 'value', value: 20 }],
          ['other', { kind: 'value', value: 7 }],
        ]),
        time: { kind: 'missing', reason: 'lost' },
      },
      {
        id: toEdgeId('e3'),
        source: toNodeId('b'),
        target: toNodeId('c'),
        directed: true,
        weight: 5,
        attrs: makeAttrs([
          ['amount', { kind: 'value', value: 5 }],
          ['other', { kind: 'value', value: 3 }],
        ]),
        time: { kind: 'span', start: date(150) },
      },
    ],
  };
}
function state(filters: readonly FilterDef[] = []): FilterState {
  return { ...DEFAULT_FILTER_STATE, filters, showIsolated: true };
}

describe('filter-audit: 操作をまたぐ統合回帰', () => {
  it('FR-MT-03 / audit #4: 中止した指標の遅い結果・失敗が届いても新しい絞り込みの計算を止めない', async () => {
    const ds = dataset();
    const all = toSnapshot(buildGraph(ds, applyFilters(ds, state())));
    const filtered = toSnapshot(buildGraph(ds, applyFilters(ds, state([category]))));
    const request = { nodeMetrics: [], globalMetrics: ['nodeCount'] } as const;
    const oldResult = computeMetrics(all, request);
    const newResult = computeMetrics(filtered, request);
    expect(oldResult.global.nodeCount).not.toEqual(newResult.global.nodeCount);
    const replies: ((result: MetricsResult) => void)[] = [];
    const failures: ((error: Error) => void)[] = [];
    let terminated = 0;
    const spawn = (): MetricsWorkerHandle => ({
      api: {
        compute: () =>
          new Promise((resolve) => {
            replies.push(resolve);
          }),
      },
      terminate: () => {
        terminated++;
      },
      onFailure: (listener) => {
        failures.push(listener);
      },
    });
    const client = createMetricsClient(spawn);
    const old = client.run({ snapshot: all, request });
    client.cancel();
    await expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const fresh = client.run({ snapshot: filtered, request });
    let freshResolved = false;
    const freshObserved = fresh.then((result) => {
      freshResolved = true;
      return result;
    });
    replies[0]?.(oldResult);
    failures[0]?.(new Error('old Worker error'));
    await Promise.resolve();
    expect(freshResolved).toBe(false);
    replies[1]?.(newResult);
    await expect(freshObserved).resolves.toEqual(newResult);
    expect(terminated).toBe(1);
    const failed = client.run({ snapshot: filtered, request });
    failures[1]?.(new Error('current Worker error'));
    await expect(failed).rejects.toThrow('current Worker error');
    const recovered = client.run({ snapshot: all, request });
    replies[3]?.(oldResult);
    await expect(recovered).resolves.toEqual(oldResult);
    client.cancel();
  });

  it('FR-DM-04 / FR-FL-06 / audit #10: 欠損の理由と実データの文字列undefinedを保存後のファセットでも区別する', () => {
    const ds = dataset();
    const attrs: Dataset = {
      ...ds,
      nodes: ds.nodes.map((node, index) => ({
        ...node,
        attrs: makeAttrs([
          [
            occupation,
            index === 0
              ? { kind: 'missing', reason: 'lost' }
              : index === 1
                ? { kind: 'missing', reason: 'unrecorded' }
                : { kind: 'value', value: 'undefined' },
          ],
        ]),
      })),
    };
    const restored = parseProject(
      serializeProject(
        { dataset: attrs, importSettings: DEFAULT_IMPORT_SETTINGS, view: { filter: state() } },
        '2026-11-21T00:00:00+09:00',
      ),
    );
    if (!restored.ok) throw new Error(restored.reason);
    const counts = facetCounts(
      restored.value.dataset,
      restored.value.view.filter,
      'node',
      occupation,
    );
    expect(counts).toHaveLength(3);
    expect(counts).toEqual(
      expect.arrayContaining([
        { key: { kind: 'missing', reason: 'lost' }, filtered: 1, total: 1 },
        { key: { kind: 'missing', reason: 'unrecorded' }, filtered: 1, total: 1 },
        { key: { kind: 'value', value: 'undefined' }, filtered: 2, total: 2 },
      ]),
    );
    const onlyMissing = applyFilters(
      restored.value.dataset,
      state([{ ...category, include: [{ kind: 'missing', reason: 'lost' }] }]),
    );
    expect([...onlyMissing.nodeIds]).toEqual(['a']);
  });
  it('FR-GR-01 / audit #1, #5: 集計列切替→除外→全除外→解除で異なる額が混ざらない', () => {
    const ds = dataset();
    const all = applyFilters(ds, state());
    const amount = buildGraph(ds, all, { weight: { attr: 'amount' }, selfLoops: true });
    const other = buildGraph(ds, all, { weight: { attr: 'other' }, selfLoops: true });
    expect(amount.getEdgeAttribute(toNodeId('a'), toNodeId('b'), 'weight')).toBe(30);
    expect(other.getEdgeAttribute(toNodeId('a'), toNodeId('b'), 'weight')).toBe(9);
    const narrow: FilterDef = {
      id: toFilterId('amount'),
      kind: 'range',
      target: 'edge',
      attr: 'amount',
      min: 20,
      missing: 'exclude',
    };
    const selected = buildGraph(ds, applyFilters(ds, state([narrow])), {
      weight: { attr: 'other' },
      selfLoops: true,
    });
    expect(selected.size).toBe(1);
    expect(selected.getEdgeAttribute(toNodeId('a'), toNodeId('b'), 'weight')).toBe(7);
    const empty = buildGraph(ds, applyFilters(ds, state([{ ...narrow, min: 999 }])), {
      weight: { attr: 'other' },
      selfLoops: true,
    });
    expect(empty.size).toBe(0);
    const restored = buildGraph(ds, applyFilters(ds, state()), {
      weight: { attr: 'amount' },
      selfLoops: true,
    });
    expect(restored.getEdgeAttribute(toNodeId('a'), toNodeId('b'), 'weight')).toBe(30);
    expect(toSnapshot(restored)).toEqual(toSnapshot(amount));
  });

  it('FR-FL-08 / audit #2, #3 / #166: 集計・ファセットを作り直しても一覧と実際の絞り込みは同じ状態を参照する', () => {
    const ds = dataset();
    const store = createFilterStore(state([category]));
    const current = () => selectFilterState(store.getState());
    const before = applyFilters(ds, current());
    for (const weight of ['count', 'weight', { attr: 'amount' }] as const) {
      buildGraph(ds, before, { weight, selfLoops: true });
      facetCounts(ds, current(), 'node', occupation);
      expect(current().filters).toEqual([category]);
      expect(findFilters(current().filters, 'category', (f) => f.attr === occupation)).toEqual([
        category,
      ]);
      expect([...applyFilters(ds, current()).nodeIds]).toEqual([...before.nodeIds]);
    }
    store.getState().remove(category.id);
    expect(findFilters(current().filters, 'category')).toEqual([]);
    expect(applyFilters(ds, current()).edgeIds.size).toBe(3);
    store.getState().undo();
    expect(current().filters).toEqual([category]);
    store.getState().clearAll();
    expect(current().filters).toEqual([]);
    expect(applyFilters(ds, current()).nodeIds.size).toBe(4);
  });

  it('FR-FL-01 / audit #6: ノードとエッジの条件、両端・片端、孤立ノードを別々に切り替えられる', () => {
    const ds = dataset();
    const both = applyFilters(ds, state([category]));
    expect([...both.nodeIds].sort()).toEqual(['a', 'c', 'iso']);
    expect(both.edgeIds.size).toBe(0);
    const either = applyFilters(ds, { ...state([category]), edgeRule: 'either-end' });
    expect(either.edgeIds.size).toBe(3);
    const edgeOnly: FilterDef = {
      id: toFilterId('edge'),
      kind: 'range',
      target: 'edge',
      attr: 'amount',
      max: 10,
      missing: 'exclude',
    };
    const filtered = applyFilters(ds, state([edgeOnly]));
    expect([...filtered.edgeIds].sort()).toEqual(['e1', 'e3']);
    expect(filtered.nodeIds.size).toBe(4);
    expect(applyFilters(ds, { ...state(), showIsolated: false }).nodeIds.has(toNodeId('iso'))).toBe(
      false,
    );
  });

  it('FR-DM-01 / FR-DM-08 / audit #7, #9: 同名の人物・地名とカンマで衝突する端点の組を別々に保つ', () => {
    const ds = dataset();
    const place = toNodeTypeId('place');
    const ids = ['a,b', 'c', 'a', 'b,c', 'same-name-person'];
    const graphData: Dataset = {
      ...ds,
      nodeTypes: [...ds.nodeTypes, { id: place, label: '地名' }],
      nodes: ids.map((id, i) => ({
        id: toNodeId(id),
        type: i === 1 ? place : person,
        label: 'Paris',
        attrs: makeAttrs([]),
      })),
      edges: [
        ['a,b', 'c'],
        ['a', 'b,c'],
      ].map(([source, target], i) => ({
        id: toEdgeId(String(i)),
        source: toNodeId(source ?? ''),
        target: toNodeId(target ?? ''),
        directed: true,
        weight: i + 1,
        attrs: makeAttrs([]),
      })),
    };
    const graph = buildGraph(graphData, applyFilters(graphData, state()));
    expect(graph.order).toBe(5);
    expect(graph.size).toBe(2);
    expect(graph.getEdgeAttribute(toNodeId('a,b'), toNodeId('c'), 'weight')).toBe(1);
    expect(graph.getEdgeAttribute(toNodeId('a'), toNodeId('b,c'), 'weight')).toBe(2);
  });

  it('FR-DM-03 / FR-MT-01 / audit #8: 集約した有向グラフの指標は入次数と出次数を区別する', () => {
    const ds = dataset();
    const graph = buildGraph(ds, applyFilters(ds, state()));
    const result = computeMetrics(toSnapshot(graph), {
      nodeMetrics: ['degree'],
      globalMetrics: ['reciprocity'],
    });
    expect(result.kind).toBe('directed');
    const degree = result.node.degree;
    if (!degree?.ok) throw new Error('degree did not succeed');
    expect(degree.value.in?.[result.nodeIds.indexOf('a')]).toBe(0);
    expect(degree.value.out?.[result.nodeIds.indexOf('a')]).toBe(1);
    expect(degree.value.in?.[result.nodeIds.indexOf('c')]).toBe(1);
    expect(degree.value.out?.[result.nodeIds.indexOf('c')]).toBe(0);
    expect(result.global.reciprocity).toEqual({ ok: true, value: 0 });
  });

  it('FR-FL-06 / audit #10 / #81: 日付の重なり判定と欠損除外数を保ち、欠損を含む指定で取り戻せる', () => {
    const ds = dataset();
    const time: FilterDef = {
      id: toFilterId('time'),
      kind: 'time',
      target: 'edge',
      from: 110,
      to: 130,
      match: 'overlaps',
      missing: 'exclude',
    };
    const excluded = applyFilters(ds, state([time]));
    expect([...excluded.edgeIds]).toEqual(['e1']);
    expect(excluded.missingExcluded.get(time.id)).toBe(1);
    const included = applyFilters(ds, state([{ ...time, missing: 'include' }]));
    expect([...included.edgeIds]).toEqual(['e1', 'e2']);
    expect(included.missingExcluded.get(time.id)).toBe(0);
  });

  it('FR-PJ-01 / FR-FL-08 / #104: 表示の離脱・再読込後もフィルタと集計対象のIDが保存前と一致する', () => {
    const ds = dataset();
    const selected: FilterState = {
      ...state([
        category,
        {
          id: toFilterId('saved amount'),
          kind: 'range',
          target: 'edge',
          attr: 'amount',
          max: 10,
          missing: 'exclude',
        },
      ]),
      edgeRule: 'either-end',
    };
    const before = applyFilters(ds, selected);
    expect([...before.edgeIds].sort()).toEqual(['e1', 'e3']);
    const json = serializeProject(
      { dataset: ds, importSettings: DEFAULT_IMPORT_SETTINGS, view: { filter: selected } },
      '2026-11-21T00:00:00+09:00',
    );
    const restored = parseProject(json);
    if (!restored.ok) throw new Error(restored.reason);
    expect(restored.warnings).toEqual([]);
    const store = createFilterStore(restored.value.view.filter);
    const after = applyFilters(restored.value.dataset, selectFilterState(store.getState()));
    expect([...after.nodeIds]).toEqual([...before.nodeIds]);
    expect([...after.edgeIds]).toEqual([...before.edgeIds]);
    expect(findFilters(selectFilterState(store.getState()).filters, 'category')).toEqual([
      category,
    ]);
  });
});
