import { CsvExportControls } from './metrics/CsvExportControls';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { MessageKey } from '../i18n';
import {
  GLOBAL_METRIC_IDS,
  type GlobalMetricId,
  type MetricFailureCode,
  type MetricsNote,
  type MetricsResult,
} from '../core/metrics/types';
import { selectFilterState, graphViewStore, selectGraphOptions } from '../state';
import { useData, useFilter, useT, useUi } from './hooks';
import { getCollator } from './intl';
import {
  NODE_METRIC_LABELS,
  metricColumns,
  sortMetricRows,
  type MetricColumn,
  type MetricSort,
} from './metrics/columns';
import { metricsController } from './metrics/controller';
import './metrics/metrics.css';

const globalNames: Record<GlobalMetricId, MessageKey> = {
  nodeCount: 'metrics.nodeCount',
  edgeCount: 'metrics.edgeCount',
  density: 'metrics.density',
  averageDegree: 'metrics.averageDegree',
  components: 'metrics.components',
  transitivity: 'metrics.transitivity',
  reciprocity: 'metrics.reciprocity',
};
const globalHelp: Record<GlobalMetricId, MessageKey> = {
  nodeCount: 'metrics.help.nodeCount',
  edgeCount: 'metrics.help.edgeCount',
  density: 'metrics.help.density',
  averageDegree: 'metrics.help.averageDegree',
  components: 'metrics.help.components',
  transitivity: 'metrics.help.transitivity',
  reciprocity: 'metrics.help.reciprocity',
};
const failureNames: Record<MetricFailureCode | 'notComputed', MessageKey> = {
  notApplicable: 'metrics.failure.notApplicable',
  notDefined: 'metrics.failure.notDefined',
  noConvergence: 'metrics.failure.noConvergence',
  unexpected: 'metrics.failure.unexpected',
  notComputed: 'metrics.failure.notComputed',
};
const noteNames: Record<MetricsNote['code'], MessageKey> = {
  mixedAsBidirectional: 'metrics.note.mixedAsBidirectional',
  directedAsUndirected: 'metrics.note.directedAsUndirected',
  multipleNodeTypes: 'metrics.note.multipleNodeTypes',
};

/**
 * 絞り込み後の全体・ノード指標、進行と中止、日英の短い説明を表示する。
 * @returns 指標パネル
 */
export function MetricsPanel() {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  const filter = useFilter(selectFilterState);
  const graphOptions = useStore(graphViewStore, selectGraphOptions);
  const view = useSyncExternalStore(metricsController.subscribe, metricsController.getSnapshot);
  useEffect(() => {
    metricsController.update(dataset, filter, graphOptions);
    return () => {
      metricsController.cancel();
    };
  }, [dataset, filter, graphOptions]);
  // 【なぜ】effect が次の入力を渡す前の描画でも、前のデータ・フィルタの数値を見せない。
  const current =
    view.input?.dataset === dataset &&
    view.input.filter === filter &&
    view.input.graphOptions === graphOptions;
  const phase = dataset === null ? 'empty' : current ? view.phase : 'waiting';
  const result = current && phase === 'ready' ? view.result : null;
  const busy = phase === 'waiting' || phase === 'running';
  return (
    <section className="metrics-panel" aria-labelledby="metrics-title">
      <h2 id="metrics-title">{t('metrics.title')}</h2>
      <p role="status" aria-live="polite">
        {phase === 'empty'
          ? t('metrics.empty')
          : phase === 'waiting'
            ? t('metrics.waiting')
            : phase === 'running'
              ? t('metrics.running')
              : phase === 'cancelled'
                ? t('metrics.cancelled')
                : ''}
      </p>
      {busy && <progress aria-label={t('metrics.running')} />}
      {dataset !== null && (
        <div className="metrics-actions">
          {busy ? (
            <button
              type="button"
              onClick={() => {
                metricsController.cancel();
              }}
            >
              {t('metrics.cancel')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                metricsController.update(dataset, filter, graphOptions);
              }}
            >
              {t('metrics.recalculate')}
            </button>
          )}
        </div>
      )}
      {phase === 'error' && (
        <div role="alert">
          <p>{t('metrics.failed')}</p>
          <bdi>{view.error}</bdi>
        </div>
      )}
      {dataset !== null && <CsvExportControls dataset={dataset} filter={filter} result={result} />}
      {result !== null && <MetricResults result={result} />}
    </section>
  );
}

function MetricResults({ result }: { readonly result: MetricsResult }) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const dataset = useData((s) => s.dataset);
  const nf = useMemo(
    () => new Intl.NumberFormat(locale, { maximumSignificantDigits: 6 }),
    [locale],
  );
  const counts = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const columns = useMemo(() => metricColumns(result), [result]);
  const [sort, setSort] = useState<MetricSort>({ column: 'label', descending: false });
  const [pagination, setPagination] = useState<{ result: MetricsResult | null; index: number }>({
    result: null,
    index: 0,
  });
  const pageIndex =
    pagination.result === result
      ? Math.min(pagination.index, Math.max(0, Math.ceil(result.nodeIds.length / 50) - 1))
      : 0;
  const rows = useMemo(() => {
    const labels = new Map(dataset?.nodes.map((node) => [String(node.id), node.label]));
    return result.nodeIds.map((id, index) => ({ id, label: labels.get(id) ?? id, index }));
  }, [dataset, result]);
  const ordered = useMemo(
    () => sortMetricRows(rows, columns, sort, getCollator(locale)),
    [rows, columns, sort, locale],
  );
  const visible = ordered.slice(pageIndex * 50, (pageIndex + 1) * 50);
  const sorting = (id: string, label: string, helpText?: string) => (
    <th
      key={id}
      scope="col"
      aria-sort={sort.column === id ? (sort.descending ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        title={helpText}
        aria-label={t('metrics.sortBy', { label })}
        onClick={() => {
          setSort({
            column: id,
            descending: sort.column === id ? !sort.descending : id !== 'label' && id !== 'id',
          });
          setPagination({ result, index: 0 });
        }}
      >
        {label}
        {sort.column === id ? (sort.descending ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );
  const cellText = (column: MetricColumn, index: number): string => {
    const value = column.values?.[index];
    return value !== undefined && Number.isFinite(value)
      ? nf.format(value)
      : t(failureNames[column.failure ?? 'notComputed']);
  };
  // 説明一覧は title のツールチップを開けないキーボード・タッチ利用者にも提供する。
  const definitions = new Map<MessageKey, MessageKey>();
  for (const column of columns) definitions.set(column.name, column.help);
  for (const id of GLOBAL_METRIC_IDS) definitions.set(globalNames[id], globalHelp[id]);
  return (
    <>
      <section aria-labelledby="metrics-global-title">
        <h3 id="metrics-global-title">{t('metrics.global')}</h3>
        <dl className="metrics-global">
          {GLOBAL_METRIC_IDS.map((id) => {
            const outcome = result.global[id];
            return (
              <div key={id}>
                <dt title={t(globalHelp[id])}>{t(globalNames[id])}</dt>
                <dd data-testid={'metric-global-' + id}>
                  {outcome?.ok && Number.isFinite(outcome.value)
                    ? (['nodeCount', 'edgeCount', 'components'].includes(id) ? counts : nf).format(
                        outcome.value,
                      )
                    : t(
                        failureNames[
                          outcome === undefined || outcome.ok ? 'notComputed' : outcome.code
                        ],
                      )}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>
      {result.notes.length > 0 && (
        <ul className="metrics-notes">
          {result.notes.map((note) => (
            <li key={note.code}>
              {t(noteNames[note.code])}
              {(note.nodeMetrics.length > 0 || note.globalMetrics.length > 0) && (
                <span>
                  {' '}
                  (
                  {[
                    ...note.nodeMetrics.map((id) => t(NODE_METRIC_LABELS[id])),
                    ...note.globalMetrics.map((id) => t(globalNames[id])),
                  ].join(', ')}
                  )
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div
        className="metrics-table-wrap"
        role="region"
        aria-label={t('metrics.nodes')}
        tabIndex={0}
      >
        <table className="metrics-table">
          <caption>{t('metrics.nodes')}</caption>
          <thead>
            <tr>
              {sorting('label', t('metrics.label'))}
              {sorting('id', t('metrics.id'))}
              {columns.map((column) => sorting(column.id, t(column.name), t(column.help)))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.id}>
                <th scope="row">
                  <bdi>{row.label}</bdi>
                </th>
                <td>
                  <bdi>{row.id}</bdi>
                </td>
                {columns.map((column) => (
                  <td key={column.id}>{cellText(column, row.index)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="metrics-pagination">
        <p>
          {t('metrics.page', {
            from: counts.format(ordered.length === 0 ? 0 : pageIndex * 50 + 1),
            to: counts.format(Math.min((pageIndex + 1) * 50, ordered.length)),
            total: counts.format(ordered.length),
          })}
        </p>
        <button
          type="button"
          disabled={pageIndex === 0}
          onClick={() => {
            setPagination({ result, index: pageIndex - 1 });
          }}
        >
          {t('metrics.previous')}
        </button>
        <button
          type="button"
          disabled={(pageIndex + 1) * 50 >= ordered.length}
          onClick={() => {
            setPagination({ result, index: pageIndex + 1 });
          }}
        >
          {t('metrics.next')}
        </button>
      </div>
      <details className="metrics-definitions">
        <summary>{t('metrics.explanations')}</summary>
        <dl>
          {[...definitions].map(([name, help]) => (
            <div key={name}>
              <dt>{t(name)}</dt>
              <dd>{t(help)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </>
  );
}
