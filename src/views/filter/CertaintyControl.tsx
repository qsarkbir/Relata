import { useState } from 'react';
import type { CertaintyFacetCount, CertaintyKey, Target } from '../../core/filter';
import { useFilter, useT, useUi } from '../hooks';
import { getNumberFormat } from '../intl';
import type { FilterOfKind } from './activeFilters';
import { DuplicateNotice } from './DuplicateNotice';
import { certaintyFilterId } from './filterIds';
import { InfoTip } from '../ui/InfoTip';

/** 確からしさの絞り込みの部品の入力。 */
interface CertaintyControlProps {
  readonly target: Target;
  /**
   * 4 項目の件数を返す関数（`getCertaintyCounts` を呼ぶもの）。
   * 【なぜ】値ではなく関数で受ける。開いているときだけ呼ぶ（ファセットと同じ。NFR-04）。
   */
  readonly getCounts: () => readonly CertaintyFacetCount[];
  /** いま適用中の、この対象の最初の確からしさのフィルタ（無ければ undefined）。 */
  // 【TS】`FilterOfKind<'certainty'>` は、FilterDef のうち kind が 'certainty' のものだけを取り出した型。
  //       これで `active.include` を、確からしさの項目の配列として安全に読める。
  readonly active: FilterOfKind<'certainty'> | undefined;
  /** 同じ条件の、2 つ目以降のフィルタの数。 */
  readonly duplicates: number;
}

/**
 * 確からしさ（確実／おそらく／可能性あり／指定なし）の絞り込み（D-37、FR-DM-06）。
 *
 * チェックの状態は `active`（FilterState のフィルタ）から導き出す。部品の中に選択の状態を持たない。
 * 件数は core の `certaintyFacetCounts`（絞り込み後の集合から計算し直す）。
 * 色や線の種類だけで確からしさを伝えない（項目は文字で示す）。
 *
 * @param props - 対象、件数を返す関数、適用中のフィルタ
 * @returns 確からしさの節
 */
export function CertaintyControl({ target, getCounts, active, duplicates }: CertaintyControlProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const add = useFilter((s) => s.add);
  const remove = useFilter((s) => s.remove);
  const [open, setOpen] = useState(false);
  const selected = new Set<CertaintyKey>(active?.include ?? []);
  const numberFormat = getNumberFormat(locale);

  const toggle = (key: CertaintyKey, on: boolean): void => {
    const id = active?.id ?? certaintyFilterId(target);
    const current = active?.include ?? [];
    const include = on
      ? [...current.filter((k) => k !== key), key]
      : current.filter((k) => k !== key);
    // 【なぜ】選択が空になったフィルタを消すのは画面の役目（D-21 (2)）。空の include は全件を除いてしまう。
    if (include.length === 0) remove(id);
    else add({ id, kind: 'certainty', target, include });
  };

  let body = null;
  if (open) {
    body = (
      <>
        <div className="info-row">
          <InfoTip topic={t('filter.certainty.topic')}>
            <p>{t('filter.certainty.hint')}</p>
          </InfoTip>
        </div>
        <ul className="facet-list">
          {getCounts().map((c) => {
            const filtered = numberFormat.format(c.filtered);
            const total = numberFormat.format(c.total);
            return (
              <li key={c.key}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(c.key)}
                    onChange={(e) => {
                      toggle(c.key, e.currentTarget.checked);
                    }}
                  />
                  {/* 【TS】テンプレートリテラル型: `filter.certainty.${c.key}` は、c.key が 4 つの項目の
                      どれかなので、辞書にある 4 つのキーのどれかとして型検査される（書き間違いは型エラー）。 */}
                  <span className="facet-value">{t(`filter.certainty.${c.key}`)}</span>
                  <span className="facet-count" aria-hidden="true">
                    {t('filter.facet.count', { filtered, total })}
                  </span>
                  <span className="visually-hidden">
                    {t('filter.facet.countLabel', { filtered, total })}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </>
    );
  }

  return (
    <details
      className="facet"
      onToggle={(e) => {
        setOpen(e.currentTarget.open);
      }}
    >
      <summary>
        {t('filter.certainty')}
        {selected.size > 0 && (
          <span className="facet-selected">
            {' '}
            ({t('filter.facet.selected', { count: selected.size })})
          </span>
        )}
      </summary>
      <DuplicateNotice count={duplicates} />
      {body}
    </details>
  );
}
