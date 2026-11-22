/** ノード指標を表の列へ展開する（FR-MT-04）。 */
import type { MetricsResult, MetricFailureCode, NodeMetricId } from '../../core/metrics';
import { NODE_METRIC_IDS } from '../../core/metrics/types';
import type { MessageKey } from '../../i18n';

/** 表示用の指標列。失敗と未計算を数値 0 にしない。 */
export interface MetricColumn {
  readonly id: string;
  readonly name: MessageKey;
  readonly help: MessageKey;
  readonly values: readonly number[] | null;
  readonly failure: MetricFailureCode | 'notComputed' | null;
}
/** ノードの表の並び方。 */
export interface MetricSort {
  readonly column: string;
  readonly descending: boolean;
}
/** 表で使うラベルと指標の行。 */
export interface MetricRow {
  readonly id: string;
  readonly label: string;
  readonly index: number;
}

/** ノード指標の基本名。入・出などの表の列名とは区別する。 */
export const NODE_METRIC_LABELS: Readonly<Record<NodeMetricId, MessageKey>> = {
  degree: 'metrics.degree',
  weightedDegree: 'metrics.weightedDegree',
  betweenness: 'metrics.betweenness',
  closeness: 'metrics.closeness',
  pagerank: 'metrics.pagerank',
  eigenvector: 'metrics.eigenvector',
  kCore: 'metrics.kCore',
  clustering: 'metrics.clustering',
};
const help: Record<NodeMetricId, MessageKey> = {
  degree: 'metrics.help.degree',
  weightedDegree: 'metrics.help.weightedDegree',
  betweenness: 'metrics.help.betweenness',
  closeness: 'metrics.help.closeness',
  pagerank: 'metrics.help.pagerank',
  eigenvector: 'metrics.help.eigenvector',
  kCore: 'metrics.help.kCore',
  clustering: 'metrics.help.clustering',
};

/**
 * Worker の型ごとの値を、向き・HITS を区別した列にする。
 * @param result - Worker の計算結果
 * @returns 表の列
 */
export function metricColumns(result: MetricsResult): MetricColumn[] {
  const columns: MetricColumn[] = [];
  for (const id of NODE_METRIC_IDS) {
    const outcome = result.node[id];
    const variants: [string, MessageKey][] =
      id === 'degree' || id === 'weightedDegree'
        ? result.kind === 'undirected'
          ? [['total', NODE_METRIC_LABELS[id]]]
          : [
              ['total', NODE_METRIC_LABELS[id]],
              ['in', id === 'degree' ? 'metrics.inDegree' : 'metrics.inWeight'],
              ['out', id === 'degree' ? 'metrics.outDegree' : 'metrics.outWeight'],
            ]
        : id === 'closeness'
          ? result.kind === 'undirected'
            ? [['value', NODE_METRIC_LABELS[id]]]
            : [
                ['value', 'metrics.inCloseness'],
                ['outgoing', 'metrics.outCloseness'],
              ]
          : id === 'eigenvector'
            ? result.kind === 'undirected'
              ? [['value', NODE_METRIC_LABELS[id]]]
              : [
                  ['hubs', 'metrics.hubs'],
                  ['authorities', 'metrics.authorities'],
                ]
            : [['value', NODE_METRIC_LABELS[id]]];
    for (const [variant, name] of variants) {
      let values: readonly number[] | null = null;
      let failure: MetricColumn['failure'] =
        outcome === undefined ? 'notComputed' : outcome.ok ? null : outcome.code;
      if (outcome?.ok) {
        const value = outcome.value;
        if (Array.isArray(value)) values = value;
        else {
          const candidate: unknown = Object.getOwnPropertyDescriptor(value, variant)?.value;
          if (Array.isArray(candidate) && candidate.every((n: unknown) => typeof n === 'number'))
            values = candidate;
        }
        if (values === null) failure = 'notComputed';
      }
      columns.push({ id: id + '.' + variant, name, help: help[id], values, failure });
    }
  }
  return columns;
}

/**
 * 数値は数値順、ラベルと ID は現在の言語順で並べる。欠損は方向によらず最後、同点は ID 順。
 * @param rows - ノードの行
 * @param columns - 指標の列
 * @param sort - 並び方
 * @param collator - 表示言語の照合
 * @returns 入力を変更しない並べ替え済みの行
 */
export function sortMetricRows(
  rows: readonly MetricRow[],
  columns: readonly MetricColumn[],
  sort: MetricSort,
  collator: Pick<Intl.Collator, 'compare'>,
): MetricRow[] {
  const column = columns.find((c) => c.id === sort.column);
  return [...rows].sort((a, b) => {
    let comparison = 0;
    if (sort.column === 'label' || sort.column === 'id')
      comparison = collator.compare(a[sort.column], b[sort.column]);
    else {
      const av = column?.values?.[a.index];
      const bv = column?.values?.[b.index];
      const aMissing = av === undefined || !Number.isFinite(av);
      const bMissing = bv === undefined || !Number.isFinite(bv);
      if (aMissing !== bMissing) return aMissing ? 1 : -1;
      if (!aMissing && !bMissing) comparison = av - bv;
    }
    if (comparison !== 0) return sort.descending ? -comparison : comparison;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}
