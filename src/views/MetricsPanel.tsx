import { useEffect, useMemo, useState } from 'react';
import type { MessageKey } from '../i18n';
import {
  GLOBAL_METRIC_IDS,
  type GlobalMetricId,
  type MetricFailureCode,
  type MetricsNote,
  type MetricsResult,
} from '../core/metrics/types';
import { metricsController } from '../state';
import { useData, useT, useUi } from './hooks';
import { InfoTip } from './ui/InfoTip';
import { getCollator } from './intl';
import {
  NODE_METRIC_LABELS,
  metricColumns,
  sortMetricRows,
  type MetricColumn,
  type MetricSort,
} from './metrics/columns';
import { useCurrentMetrics } from './metrics/useCurrentMetrics';
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
/** 注意ごとの詳しい説明。ダイアログで、短い文の後に続けて示す。 */
const noteDetails: Record<MetricsNote['code'], MessageKey> = {
  mixedAsBidirectional: 'metrics.noteDetail.mixedAsBidirectional',
  directedAsUndirected: 'metrics.noteDetail.directedAsUndirected',
  multipleNodeTypes: 'metrics.noteDetail.multipleNodeTypes',
};

/**
 * 絞り込み後の全体・ノード指標、進行と中止、日英の短い説明を表示する。
 * @returns 指標パネル
 */
export function MetricsPanel() {
  const t = useT();
  const { dataset, filter, graphOptions, phase, result, error } = useCurrentMetrics();
  useEffect(() => {
    metricsController.update(dataset, filter, graphOptions);
    return () => {
      metricsController.cancel();
    };
  }, [dataset, filter, graphOptions]);
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
          <bdi>{error}</bdi>
        </div>
      )}
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
        <h3 id="metrics-global-title">
          {t('metrics.global')}{' '}
          {/* 【なぜ】計算上の注意と指標の意味を、1 つのアイコンにまとめる。狭いパネルに長い説明を
              広げると読みにくいため、ダイアログで読む（利用者の指摘、2026-11-22）。
              注意があるときは、件数をアイコンの横に示して気づけるようにする。 */}
          <InfoTip topic={t('metrics.info.topic')} count={result.notes.length}>
            {result.notes.length > 0 && (
              <section>
                <h3>{t('metrics.notes.title')}</h3>
                {result.notes.map((note) => {
                  const affected = [
                    ...note.nodeMetrics.map((id) => t(NODE_METRIC_LABELS[id])),
                    ...note.globalMetrics.map((id) => t(globalNames[id])),
                  ];
                  return (
                    <section key={note.code} className="metrics-note">
                      <h4>{t(noteNames[note.code])}</h4>
                      {affected.length > 0 && (
                        <p>
                          <strong>{t('metrics.notes.affected')}</strong> {affected.join(', ')}
                        </p>
                      )}
                      <p>{t(noteDetails[note.code])}</p>
                    </section>
                  );
                })}
              </section>
            )}
            <section>
              <h3>{t('metrics.explanations')}</h3>
              <dl className="metrics-definitions">
                {[...definitions].map(([name, help]) => (
                  <div key={name}>
                    <dt>{t(name)}</dt>
                    <dd>{t(help)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <p className="hint">{t('metrics.notes.docs')}</p>
          </InfoTip>
        </h3>
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
    </>
  );
}
