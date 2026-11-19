import type { ReactNode } from 'react';
import { assertNever } from '../../core/util/assertNever';
import type { FilterDef, FilterId, FilterIssue } from '../../core/filter';
import type { Dataset } from '../../core/model';
import { useFilter, useT, useUi } from '../hooks';
import { getNumberFormat } from '../intl';
import { categoryKeyText } from './labels';
import type { Translate } from './labels';

/** 適用中のフィルタの一覧の入力。 */
interface AppliedListProps {
  readonly dataset: Dataset;
  /** `FilterState.filters` そのもの。別の一覧を作らない（FR-FL-08）。 */
  readonly filters: readonly FilterDef[];
  readonly issues: readonly FilterIssue[];
  /** フィルタごとの、欠損のために除いた件数（`FilterResult.missingExcluded`。FR-FL-06）。 */
  readonly missingExcluded: ReadonlyMap<FilterId, number>;
}

/**
 * 適用中のフィルタの一覧（FR-FL-08）と、`checkFilterState` の問題の表示。
 *
 * 一覧は `FilterState.filters` をそのまま並べる。各行から個別に、上のボタンから一括で解除できる。
 * 範囲と時間の行には、欠損のために除いた件数を常に添える（FR-FL-06）。
 * 問題（存在しない属性や値）は、該当するフィルタの行に添える。
 *
 * @param props - データセット、フィルタ、問題、欠損で除いた件数
 * @returns 一覧の要素
 */
export function AppliedList({ dataset, filters, issues, missingExcluded }: AppliedListProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const remove = useFilter((s) => s.remove);
  const clearAll = useFilter((s) => s.clearAll);
  const nf = getNumberFormat(locale);

  return (
    <section className="applied" aria-labelledby="applied-title">
      <div className="applied-head">
        <h3 id="applied-title">{t('filter.applied')}</h3>
        <button type="button" disabled={filters.length === 0} onClick={clearAll}>
          {t('filter.clearAll')}
        </button>
      </div>
      {filters.length === 0 ? (
        <p className="hint">{t('filter.applied.none')}</p>
      ) : (
        <ul className="applied-list">
          {filters.map((f) => {
            const mine = issues.filter((i) => i.filterId === f.id);
            const label = plainSummary(t, nf, dataset, f);
            return (
              <li key={f.id}>
                <span className="applied-summary">
                  <span className="applied-target">{targetText(t, f)} </span>
                  {summary(t, nf, dataset, f)}
                  {(f.kind === 'range' || f.kind === 'time') && (
                    <span className="applied-missing">
                      {' '}
                      {t(
                        f.missing === 'include'
                          ? 'filter.summary.missingIncluded'
                          : 'filter.summary.missingExcluded',
                        { count: nf.format(missingExcluded.get(f.id) ?? 0) },
                      )}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={t('filter.removeLabel', { label })}
                  onClick={() => {
                    remove(f.id);
                  }}
                >
                  {t('filter.remove')}
                </button>
                {mine.length > 0 && (
                  <ul className="issues" aria-label={t('filter.issues')}>
                    {mine.map((i, n) => (
                      <li key={n}>{issueText(t, i)}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// 【TS】数値の整形関数の型。`Intl.NumberFormat` のインスタンスから、必要な `format` だけを取り出した形。
type NumberFormatter = Pick<Intl.NumberFormat, 'format'>;

// 対象の語（ノード／エッジ）。ノード型のフィルタはノード専用。
function targetText(t: Translate, f: FilterDef): string {
  return t(
    f.kind === 'nodeType' || f.target === 'node' ? 'filter.target.node' : 'filter.target.edge',
  );
}

function attrLabel(dataset: Dataset, target: 'node' | 'edge', key: string): string {
  return dataset.schema.find((d) => d.key === key && d.appliesTo === target)?.label ?? key;
}

// 範囲の端の説明（両端、片端、どちらも無し）。
function rangeText(t: Translate, nf: NumberFormatter, min?: number, max?: number): string {
  if (min !== undefined && max !== undefined) {
    return t('filter.summary.rangeBoth', { min: nf.format(min), max: nf.format(max) });
  }
  if (min !== undefined) return t('filter.summary.rangeMin', { min: nf.format(min) });
  if (max !== undefined) return t('filter.summary.rangeMax', { max: nf.format(max) });
  return '';
}

// 時間の期間の説明。
// 【なぜ】本来は西暦の日付にするが、暦の換算は src/core/time の関数だけで行う（設計書 §5.1）。
//       その関数が入るまでの暫定として、ユリウス通日（JDN）の番号をそのまま示す（時間のフィルタは
//       フェーズ 2 で画面を作るので、今は読み込んだファイルのフィルタを一覧に出すためだけ）。
function timeText(t: Translate, nf: NumberFormatter, from: number, to: number): string {
  return t('filter.summary.time', { from: nf.format(from), to: nf.format(to) });
}

// 一覧の 1 行の説明（人名などは <bdi> で隔離した要素）。
// 【TS】`switch (f.kind)` の各 case の中では、TypeScript が f をその種類に絞り込む（判別共用体）。
//       `default` の `assertNever` は、種類を足して case を書き忘れたときに型エラーにする。
function summary(t: Translate, nf: NumberFormatter, dataset: Dataset, f: FilterDef): ReactNode {
  switch (f.kind) {
    case 'category': {
      const def = dataset.schema.find((d) => d.key === f.attr && d.appliesTo === f.target);
      return (
        <>
          <bdi>{attrLabel(dataset, f.target, f.attr)}</bdi>:{' '}
          {f.include.map((k, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <bdi>{categoryKeyText(t, k, def)}</bdi>
            </span>
          ))}
        </>
      );
    }
    case 'range':
      return (
        <>
          <bdi>{attrLabel(dataset, f.target, f.attr)}</bdi>: {rangeText(t, nf, f.min, f.max)}
        </>
      );
    case 'time':
      return timeText(t, nf, f.from, f.to);
    case 'text':
      return (
        <>
          {t('filter.search.title')}: <bdi>{f.query}</bdi> (
          {t(f.matching === 'loose' ? 'filter.summary.text.loose' : 'filter.summary.text.strict')})
        </>
      );
    case 'nodeType':
      return (
        <>
          {f.include.map((id, i) => (
            <span key={id}>
              {i > 0 && ', '}
              <bdi>{dataset.nodeTypes.find((nt) => nt.id === id)?.label ?? id}</bdi>
            </span>
          ))}
        </>
      );
    default:
      return assertNever(f, 'FilterDef');
  }
}

// ボタンの aria-label 用の、文字だけの説明。
function plainSummary(t: Translate, nf: NumberFormatter, dataset: Dataset, f: FilterDef): string {
  switch (f.kind) {
    case 'category': {
      const def = dataset.schema.find((d) => d.key === f.attr && d.appliesTo === f.target);
      return `${targetText(t, f)} ${attrLabel(dataset, f.target, f.attr)}: ${f.include
        .map((k) => categoryKeyText(t, k, def))
        .join(', ')}`;
    }
    case 'range':
      return `${targetText(t, f)} ${attrLabel(dataset, f.target, f.attr)}: ${rangeText(t, nf, f.min, f.max)}`;
    case 'time':
      return `${targetText(t, f)} ${timeText(t, nf, f.from, f.to)}`;
    case 'text':
      return `${targetText(t, f)} ${t('filter.summary.text', { query: f.query })}`;
    case 'nodeType': {
      // 【なぜ】選んでいる型の名前も入れる。読み上げで、どの「解除」ボタンかを区別できるように。
      const names = f.include
        .map((id) => dataset.nodeTypes.find((nt) => nt.id === id)?.label ?? id)
        .join(', ');
      return `${targetText(t, f)} ${t('filter.nodeTypes')}: ${names}`;
    }
    default:
      return assertNever(f, 'FilterDef');
  }
}

// 問題の文。値は人名や地名などで向きが混ざりうるので、<bdi> で隔離する（NFR-09）。
function issueText(t: Translate, i: FilterIssue): ReactNode {
  switch (i.kind) {
    case 'unknown-attr':
      return t('filter.issue.unknown-attr');
    case 'unknown-node-type':
      return (
        <>
          {t('filter.issue.unknown-node-type')} <bdi>{i.nodeType}</bdi>
        </>
      );
    case 'unknown-category':
      return (
        <>
          {t('filter.issue.unknown-category')} <bdi>{categoryKeyText(t, i.key, undefined)}</bdi>
        </>
      );
    case 'reversed-range':
      return t('filter.issue.reversed-range');
    default:
      return assertNever(i, 'FilterIssue');
  }
}
