import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { countMissingByPeriod } from '../core/missing';
import type { MissingCounts, PeriodSpecialRow } from '../core/missing';
import { resolveTimelineSource, timelineSourceOptions } from '../core/filter';
import type { TimeSource } from '../core/filter';
import type { Dataset } from '../core/model';
import { binCalendarOf, describeDayRange } from '../core/time';
import { getFilterResult, selectFilterState } from '../state';
import { useDisplay, useFilter, useT, useTimelineView, useUi } from './hooks';
import { getNumberFormat } from './intl';
import { renderingsText } from './filter/timeText';
import { StatusMessage } from './ui/StatusMessage';
import './workspace.css';

/** 割合の書式（言語ごとに 1 つ）。 */
const percentFormats = new Map<string, Intl.NumberFormat>();
function percent(locale: string, rate: number): string {
  let f = percentFormats.get(locale);
  if (f === undefined) {
    f = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    percentFormats.set(locale, f);
  }
  return f.format(rate);
}

/**
 * 時期ごとの欠損率（FR-VG-12、D-42）。「欠損」タブの、属性ごとの一覧の下の節。
 *
 * 数え方（日付の出どころ、区切りの幅、対象、暦）は年表の設定に従う。ここには別の設定を持たない
 * （年表と食い違わないように）。集計は core の `countMissingByPeriod`（純粋関数）。
 * 行は時期（区切り）、列は属性。セルは「欠損 / その区切りに数えた、その属性が当てはまる要素（割合）」。
 * 年代のない要素と、期間が不整合な要素は、区切りとは別の行にする。
 *
 * @param props - データセット
 * @param props.dataset - データセット
 * @returns 時期ごとの欠損率の節
 */
export function MissingByPeriod({ dataset }: { readonly dataset: Dataset }) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const filters = useFilter(selectFilterState);
  const settings = useTimelineView((s) => s.timeline);
  const display = useDisplay((s) => s.calendar);
  const calendar = binCalendarOf(display);
  const { target, width } = settings;
  const options = useMemo(() => timelineSourceOptions(dataset, target), [dataset, target]);
  const source = resolveTimelineSource(options, settings[target]);
  const result = getFilterResult(dataset, filters);
  const ids = target === 'node' ? result.nodeIds : result.edgeIds;
  // 【なぜ】絞り込み後の集合から毎回数え直す（差分で更新しない）。入力が同じ間は前の結果を使う。
  const period = useMemo(
    () =>
      source === undefined
        ? null
        : countMissingByPeriod(dataset, target, ids, source, calendar, width),
    [dataset, target, ids, source, calendar, width],
  );

  const sourceLabel = (s: TimeSource): string => {
    if (s.kind === 'span') return t('filter.time.source.span');
    const label = dataset.schema.find((a) => a.key === s.attr && a.appliesTo === target)?.label;
    return t('filter.time.source.attr', { label: label ?? s.attr });
  };
  const cell = (c: MissingCounts | undefined): ReactNode => {
    if (c === undefined) return null;
    return t('missing.period.cell', {
      missing: nf.format(c.missing),
      total: nf.format(c.total),
      rate: c.total === 0 ? t('missing.noRate') : percent(locale, c.missing / c.total),
    });
  };

  // 状態の区別: 出どころなし、上限超え、絞り込みで 0 件、日付が全く無い、属性なし。
  let message: string | null = null;
  if (source === undefined) message = t('missing.period.noSource');
  else if (period?.tooManyBins === true) message = t('timeline.tooMany');
  else if (period !== null && period.shownItems === 0) message = t('missing.period.filteredOut');
  else if (period !== null && period.attrs.length === 0) message = t('missing.period.noAttrs');
  else if (period !== null && period.rows.length === 0 && period.inconsistent.items === 0)
    message = t('timeline.noBins');

  const special = (label: string, row: PeriodSpecialRow, key: string): ReactNode =>
    row.items === 0 ? null : (
      <tr key={key} data-period={key}>
        <th scope="row">
          {label} <span className="missing-target">({nf.format(row.items)})</span>
        </th>
        {row.counts.map((c, i) => (
          <td key={period?.attrs[i]?.key ?? i} data-numeric="true">
            {cell(c)}
          </td>
        ))}
      </tr>
    );

  return (
    <section className="missing-period" aria-labelledby="missing-period-title">
      <h3 id="missing-period-title">{t('missing.period.title')}</h3>
      <p className="table-count" data-testid="missing-period-basis">
        {t('missing.period.basis', {
          target: t(target === 'node' ? 'missing.target.node' : 'missing.target.edge'),
          source: source === undefined ? '—' : sourceLabel(source),
          width: width,
        })}{' '}
        {t(
          calendar === 'hijri'
            ? 'missing.period.calendar.hijri'
            : 'missing.period.calendar.gregorian',
        )}
      </p>
      {message !== null && (
        <StatusMessage
          state={{
            kind: source === undefined || period?.shownItems !== 0 ? 'empty' : 'no-results',
            message,
          }}
        />
      )}
      {period !== null && message === null && (
        <>
          <p className="table-count">{t('missing.period.note')}</p>
          <div
            className="table-scroll"
            role="region"
            tabIndex={0}
            aria-label={t('missing.period.region')}
            data-testid="missing-period-table"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('missing.period.col.period')}</th>
                  {period.attrs.map((a, i) => (
                    <th key={`${a.key}:${String(i)}`} scope="col" data-numeric="true">
                      {/* 属性名は利用者の値なので、`<bdi>` で隔離する。 */}
                      <bdi>{a.label}</bdi>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {period.rows.map((r) => (
                  <tr key={r.startYear} data-period={String(r.startYear)}>
                    <th scope="row">
                      <bdi>
                        {renderingsText(
                          t,
                          describeDayRange(
                            { earliest: r.earliest, latest: r.latest },
                            display,
                            'year',
                          ),
                        )}
                      </bdi>{' '}
                      <span className="missing-target">({nf.format(r.items)})</span>
                    </th>
                    {r.counts.map((c, i) => (
                      <td key={`${period.attrs[i]?.key ?? ''}:${String(i)}`} data-numeric="true">
                        {cell(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {/* 区切りに入らない要素は、別のグループ（<tbody>）の行にする。 */}
              <tbody>
                {special(t('missing.period.noDate'), period.noDate, 'noDate')}
                {special(t('missing.period.inconsistent'), period.inconsistent, 'inconsistent')}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
