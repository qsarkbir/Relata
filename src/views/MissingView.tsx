import type { ReactNode } from 'react';
import { MISSING_REASONS } from '../core/model';
import type { MissingReason } from '../core/model';
import type { MessageKey } from '../i18n';
import type { AttrMissingRow, MissingCounts } from '../core/missing';
import { getFilterResult, getMissingRows, selectFilterState } from '../state';
import { MissingByPeriod } from './MissingByPeriod';
import { getNumberFormat } from './intl';
import { formatPercent } from './percent';
import { useData, useFilter, useT, useUi } from './hooks';
import { StatusMessage } from './ui/StatusMessage';
import './workspace.css';

/** 欠損の理由の見出しの辞書のキー。理由を足して書き忘れると、型エラーになる。 */
// 【TS】`as const` は値を文字列リテラルのまま保つ（`string` に広げない）。`satisfies Record<MissingReason, MessageKey>` は
//       「理由の 4 種すべてがキーにあり、値が辞書のキーとして正しいか」だけを検査し、型そのものは狭いまま残す。
const REASON_KEYS = {
  unrecorded: 'missing.reason.unrecorded',
  lost: 'missing.reason.lost',
  illegible: 'missing.reason.illegible',
  'not-applicable': 'missing.reason.not-applicable',
} as const satisfies Record<MissingReason, MessageKey>;

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
  const nf = getNumberFormat(locale);
  // 欠損の件数と割合を 1 つのセルの文字にする。分母が 0 なら割合は出さない（0% と偽らない）。
  const cell = (counts: MissingCounts, n: number): ReactNode => {
    const rate = counts.total === 0 ? null : n / counts.total;
    return t('missing.cell', {
      count: nf.format(n),
      rate: rate === null ? t('missing.noRate') : formatPercent(locale, rate),
    });
  };
  const typeLabel = (id: string): string =>
    dataset.nodeTypes.find((nt) => nt.id === id)?.label ?? id;
  const body = (row: AttrMissingRow, index: number): ReactNode => {
    const scopes = [
      { id: 'filtered', counts: row.filtered, label: t('missing.scope.filtered') },
      { id: 'whole', counts: row.whole, label: t('missing.scope.whole') },
    ] as const; // 【TS】`as const` で `id` を 'filtered' | 'whole' のリテラル型に保つ（`data-scope` と key に使う）。
    // 【なぜ】属性ごとに <tbody> を分ける。`scope="rowgroup"` の見出しは、行のグループ（<tbody>）に対して
    //   意味を持つので、支援技術が「この 2 行は 1 つの属性」と読める。
    return (
      // 【なぜ】同じキーの属性がノードの型ごとに定義されうるので、キーだけでは React の `key` が衝突する。
      //       スキーマの並び（index）を含めて一意にする。
      <tbody key={`${row.target}:${row.key}:${String(index)}`}>
        {scopes.map((s, i) => (
          <tr key={s.id} data-attr={row.key} data-scope={s.id}>
            {i === 0 && (
              <th scope="rowgroup" rowSpan={2}>
                {/* 属性名は利用者の値（アラビア文字などもありうる）なので、`<bdi>` で隔離する。 */}
                <bdi>{row.label}</bdi>
                <span className="missing-target">
                  {' '}
                  ({t(row.target === 'node' ? 'missing.target.node' : 'missing.target.edge')}
                  {row.nodeType !== undefined && (
                    <>
                      {t('missing.target.typeSep')}
                      <bdi>{typeLabel(row.nodeType)}</bdi>
                    </>
                  )}
                  )
                </span>
              </th>
            )}
            <th scope="row">{s.label}</th>
            <td data-numeric="true">{nf.format(s.counts.total)}</td>
            <td data-numeric="true" data-testid="missing-total">
              {cell(s.counts, s.counts.missing)}
            </td>
            {MISSING_REASONS.map((r) => (
              <td key={r} data-numeric="true">
                {cell(s.counts, s.counts.byReason[r])}
              </td>
            ))}
            <td data-numeric="true">{nf.format(s.counts.absent)}</td>
          </tr>
        ))}
      </tbody>
    );
  };
  const result = getFilterResult(dataset, filters);
  const filteredOut = result.nodeIds.size === 0 && result.edgeIds.size === 0;
  return (
    <div className="missing-view">
      {filteredOut && (
        // 【なぜ】データなし（上の分岐）と、絞り込みで 0 件は別の事情。表は出したまま、旨を示す。
        <StatusMessage
          state={{
            kind: 'no-results',
            message: t('missing.filteredOut'),
            hint: t('table.noResults.hint'),
          }}
        />
      )}
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
          {rows.map(body)}
        </table>
      </div>
      <MissingByPeriod dataset={dataset} />
    </div>
  );
}
