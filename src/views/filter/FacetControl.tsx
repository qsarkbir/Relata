import { useState } from 'react';
import { categoryKeyId } from '../../core/filter';
import type { CategoryKey, FacetCount, Target } from '../../core/filter';
import type { AttributeDef } from '../../core/model';
import { useFilter, useT, useUi } from '../hooks';
import { getCollator, getNumberFormat } from '../intl';
import type { FilterOfKind } from './activeFilters';
import { DuplicateNotice } from './DuplicateNotice';
import { categoryFilterId } from './filterIds';
import { categoryKeyText } from './labels';
import { InfoTip } from '../ui/InfoTip';

/** 最初に表示する項目の数（種類の多い属性で、一覧が長くなりすぎないように）。 */
const INITIAL_LIMIT = 50;

/** ファセット 1 属性の部品の入力。 */
interface FacetControlProps {
  readonly target: Target;
  readonly def: AttributeDef;
  /**
   * この属性のファセットの件数を返す関数（`getFacetCounts` を呼ぶもの）。
   * 【なぜ】値ではなく関数で受ける。開いているときだけ呼び、閉じた属性の件数は計算しない（NFR-04）。
   */
  readonly getCounts: () => readonly FacetCount[];
  /** いま適用中のこの属性の最初のフィルタ（無ければ undefined）。 */
  readonly active: FilterOfKind<'category'> | undefined;
  /** 同じ条件の、2 つ目以降のフィルタの数。 */
  readonly duplicates: number;
}

/**
 * カテゴリ・文字列・真偽値の属性のファセット（FR-FL-02、FR-FL-06、FR-FL-07）。
 *
 * チェックの状態は `active`（FilterState のフィルタ）から導き出す。部品の中に選択の状態を持たない。
 * 値ごとに「条件に合う件数 / 全体」を示し、欠損は理由ごとの項目として並べる。
 * 開閉は表示だけの状態なので、部品のローカルな状態として持つ。
 *
 * @param props - 対象、属性の定義、件数を返す関数、適用中のフィルタ
 * @returns ファセットの要素
 */
export function FacetControl({ target, def, getCounts, active, duplicates }: FacetControlProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const add = useFilter((s) => s.add);
  const remove = useFilter((s) => s.remove);
  // 【TS】`useState(false)` の型は boolean と推論される。
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const selected = new Set((active?.include ?? []).map(categoryKeyId));
  // 【なぜ】Intl の書式は作るのに時間がかかるので、言語ごとに使い回す（views/intl.ts）。
  const numberFormat = getNumberFormat(locale);

  const toggle = (key: CategoryKey, on: boolean): void => {
    // 【なぜ】操作は最初のフィルタに対して行う。無ければ新しい ID で追加する。
    const id = active?.id ?? categoryFilterId(target, def.key);
    const current = active?.include ?? [];
    const kid = categoryKeyId(key);
    const include = on
      ? [...current.filter((k) => categoryKeyId(k) !== kid), key]
      : current.filter((k) => categoryKeyId(k) !== kid);
    // 【なぜ】選択が空になったフィルタを消すのは画面の役目（D-21 (2)）。空の include は全件を除いてしまう。
    if (include.length === 0) remove(id);
    else add({ id, kind: 'category', target, attr: def.key, include });
  };

  let body = null;
  if (open) {
    // 【なぜ】値は全体の件数の多い順、同数は言語ごとの照合順。「条件に合う件数」で並べると、
    //       他のフィルタを変えるたびに項目が入れ替わり、チェックしたい項目を目で追えなくなる。
    //       全体の件数は、フィルタを変えても動かない。欠損は最後（core が値の後ろに並べている）。
    const collator = getCollator(locale);
    const counts = getCounts();
    // `filter` は新しい配列を返すので、`sort` で並べ替えても元の配列は変わらない。
    const values = counts
      .filter((c) => c.key.kind === 'value')
      .sort((a, b) => b.total - a.total || collator.compare(keyValue(a.key), keyValue(b.key)));
    const missings = counts.filter((c) => c.key.kind === 'missing');
    const ordered = [...values, ...missings];
    // 選んでいる項目は、上位 50 件の外でも常に見せる（チェックの状態が見えなくならないように）。
    const visible = showAll
      ? ordered
      : ordered.filter((c, i) => i < INITIAL_LIMIT || selected.has(categoryKeyId(c.key)));
    const hidden = ordered.length - visible.length;
    body = (
      <>
        <div className="info-row">
          <InfoTip topic={t('filter.facet.topic')}>
            <p>{t('filter.facet.hint')}</p>
          </InfoTip>
        </div>
        <ul className="facet-list">
          {visible.map((c) => {
            const id = categoryKeyId(c.key);
            const text = categoryKeyText(t, c.key, def);
            const filtered = numberFormat.format(c.filtered);
            const total = numberFormat.format(c.total);
            return (
              <li key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={selected.has(id)}
                    onChange={(e) => {
                      toggle(c.key, e.currentTarget.checked);
                    }}
                  />
                  {/* 【なぜ】値は人名や地名で、アラビア文字など右から左の文字を含みうる。
                      <bdi> で向きを隔離し、前後の記号が崩れないようにする（NFR-09）。 */}
                  <bdi className="facet-value">{text}</bdi>
                  {/* 見た目は「n / m」。読み上げは、意味が分かる文に替える。 */}
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
        {hidden > 0 && (
          <button
            type="button"
            onClick={() => {
              setShowAll(true);
            }}
          >
            {t('filter.facet.showMore', { count: numberFormat.format(hidden) })}
          </button>
        )}
        {showAll && ordered.length > INITIAL_LIMIT && (
          <button
            type="button"
            onClick={() => {
              setShowAll(false);
            }}
          >
            {t('filter.facet.showLess')}
          </button>
        )}
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
        <bdi>{def.label}</bdi>
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

function keyValue(key: CategoryKey): string {
  return key.kind === 'value' ? key.value : '';
}
