import type { ReactNode } from 'react';
import { MISSING_REASONS } from '../core/model';
import type { MissingReason } from '../core/model';
import type { MessageKey } from '../i18n';
import { missingRate } from '../core/missing';
import type { AttrMissingRow, MissingCounts } from '../core/missing';
import { getMissingRows, selectFilterState } from '../state';
import { useData, useFilter, useT, useUi } from './hooks';
import { StatusMessage } from './ui/StatusMessage';
import './workspace.css';

/** 欠損の理由の見出しの辞書のキー。理由を足して書き忘れると、型エラーになる。 */
const REASON_KEYS = {
  unrecorded: 'missing.reason.unrecorded',
  lost: 'missing.reason.lost',
  illegible: 'missing.reason.illegible',
  'not-applicable': 'missing.reason.not-applicable',
} as const satisfies Record<MissingReason, MessageKey>;

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
 * 属性ごとの欠損率の一覧（FR-VG-12、R-21）。下の段の「欠損」タブの中身。
 *
 * 絞り込み後の値と全体の値を、属性ごとに 2 行で並べる。理由別に件数と割合を出す。
 * 集計は state の `getMissingRows`（core の純粋な関数）。ここでは表に並べるだけ。
 * 【なぜ】時期ごとの欠損率は年表（T2-05b）の区切りが統合された後に、この下へ節を足す。
 * @returns 欠損率の一覧
 */
export function MissingView() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const dataset = useData((s) => s.dataset);
  const filters = useFilter(selectFilterState);
  if (dataset === null)
    return (
      <div className="missing-view">
        <StatusMessage state={{ kind: 'empty', message: t('missing.noData') }} />
      </div>
    );
  const rows = getMissingRows(dataset, filters);
  if (rows.length === 0)
    return (
      <div className="missing-view">
        <StatusMessage state={{ kind: 'empty', message: t('missing.noAttrs') }} />
      </div>
    );
  const cell = (counts: MissingCounts, n: number): ReactNode => {
    const rate = counts.total === 0 ? null : n / counts.total;
    return t('missing.cell', {
      count: n,
      rate: rate === null ? t('missing.noRate') : percent(locale, rate),
    });
  };
  const body = (row: AttrMissingRow): ReactNode => {
    const scopes = [
      { id: 'filtered', counts: row.filtered, label: t('missing.scope.filtered') },
      { id: 'whole', counts: row.whole, label: t('missing.scope.whole') },
    ] as const;
    return scopes.map((s, i) => {
      const total = missingRate(s.counts);
      return (
        <tr key={`${row.target}:${row.key}:${s.id}`} data-attr={row.key} data-scope={s.id}>
          {i === 0 && (
            <th scope="rowgroup" rowSpan={2}>
              {/* 属性名は利用者の値（アラビア文字などもありうる）なので、`<bdi>` で隔離する。 */}
              <bdi>{row.label}</bdi>
              <span className="missing-target">
                {' '}
                ({t(row.target === 'node' ? 'missing.target.node' : 'missing.target.edge')})
              </span>
            </th>
          )}
          <th scope="row">{s.label}</th>
          <td data-numeric="true">{s.counts.total}</td>
          <td data-numeric="true" data-testid="missing-total">
            {total === null ? t('missing.noRate') : cell(s.counts, s.counts.missing)}
          </td>
          {MISSING_REASONS.map((r) => (
            <td key={r} data-numeric="true">
              {cell(s.counts, s.counts.byReason[r])}
            </td>
          ))}
          <td data-numeric="true">{s.counts.absent}</td>
        </tr>
      );
    });
  };
  return (
    <div className="missing-view">
      <p className="table-count">{t('missing.note')}</p>
      <div
        className="table-scroll"
        role="region"
        tabIndex={0}
        aria-label={t('missing.view')}
        data-testid="missing-table"
      >
        <table>
          <thead>
            <tr>
              <th scope="col">{t('missing.col.attr')}</th>
              <th scope="col">{t('missing.col.scope')}</th>
              <th scope="col" data-numeric="true">
                {t('missing.col.total')}
              </th>
              <th scope="col" data-numeric="true">
                {t('missing.col.missing')}
              </th>
              {MISSING_REASONS.map((r) => (
                <th key={r} scope="col" data-numeric="true">
                  {t(REASON_KEYS[r])}
                </th>
              ))}
              <th scope="col" data-numeric="true">
                {t('missing.col.absent')}
              </th>
            </tr>
          </thead>
          <tbody>{rows.map(body)}</tbody>
        </table>
      </div>
    </div>
  );
}
