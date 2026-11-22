import { describe, expect, it } from 'vitest';
import type { MetricsResult } from '../../core/metrics';
import { metricColumns, sortMetricRows, type MetricColumn } from './columns';

const result: MetricsResult = {
  kind: 'directed',
  nodeIds: ['a', 'b'],
  global: {},
  notes: [],
  node: {
    degree: { ok: true, value: { total: [1, 2], in: [0, 1], out: [1, 1] } },
    closeness: { ok: true, value: { value: [0, 0.5], outgoing: [0.5, 0] } },
    eigenvector: { ok: true, value: { kind: 'hits', hubs: [1, 0], authorities: [0, 1] } },
    pagerank: { ok: false, code: 'noConvergence', message: 'internal message' },
  },
};
describe('FR-MT-04: 指標の表とソート', () => {
  it('入/出、近接の向き、HITSのハブと権威を別列に展開する', () => {
    const columns = metricColumns(result);
    expect(columns.find((c) => c.id === 'degree.in')?.values).toEqual([0, 1]);
    expect(columns.find((c) => c.id === 'closeness.outgoing')?.values).toEqual([0.5, 0]);
    expect(columns.find((c) => c.id === 'eigenvector.authorities')?.values).toEqual([0, 1]);
    expect(columns.find((c) => c.id === 'pagerank.value')).toMatchObject({
      values: null,
      failure: 'noConvergence',
    });
    expect(columns.find((c) => c.id === 'kCore.value')).toMatchObject({
      values: null,
      failure: 'notComputed',
    });
  });
  it('無向の固有ベクトルを表示し、入/出/HITSの列は作らない', () => {
    const columns = metricColumns({
      ...result,
      kind: 'undirected',
      node: { eigenvector: { ok: true, value: { kind: 'eigenvector', value: [1, 2] } } },
    });
    expect(columns.find((c) => c.id === 'eigenvector.value')?.values).toEqual([1, 2]);
    expect(columns.some((c) => c.id === 'degree.in')).toBe(false);
  });
  it('数値順に並べ替え、欠損は昇順・降順とも末尾、同点はID順にする', () => {
    const rows = ['b', 'a', 'd', 'c'].map((id, index) => ({ id, label: id, index }));
    const columns: MetricColumn[] = [
      {
        id: 'value',
        name: 'metrics.degree',
        help: 'metrics.help.degree',
        values: [10, 2, NaN, 2],
        failure: null,
      },
    ];
    const ascending = sortMetricRows(
      rows,
      columns,
      { column: 'value', descending: false },
      new Intl.Collator('en'),
    );
    expect(ascending.map((r) => r.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(
      sortMetricRows(
        rows,
        columns,
        { column: 'value', descending: true },
        new Intl.Collator('en'),
      ).map((r) => r.id),
    ).toEqual(['b', 'a', 'c', 'd']);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'd', 'c']);
  });
  it('ラベルの言語順とIDの並べ替えを使える', () => {
    const rows = [
      { id: 'b', label: 'Z', index: 0 },
      { id: 'a', label: 'A', index: 1 },
    ];
    expect(
      sortMetricRows(rows, [], { column: 'label', descending: false }, new Intl.Collator('en')).map(
        (r) => r.id,
      ),
    ).toEqual(['a', 'b']);
    expect(
      sortMetricRows(rows, [], { column: 'id', descending: true }, new Intl.Collator('en')).map(
        (r) => r.id,
      ),
    ).toEqual(['b', 'a']);
  });
});
