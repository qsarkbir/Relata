/**
 * ファセットの件数（FR-FL-06、FR-FL-07、D-21 (6)）。
 */
import { getAttr, MISSING_REASONS, type Attrs, type Dataset } from '../model';
import { certaintyKeyOf, passingFlags } from './apply';
import { categoryKeyId, categoryKeysOf } from './keys';
import {
  CERTAINTY_KEYS,
  type CategoryKey,
  type CertaintyKey,
  type FilterState,
  type Target,
} from './types';

/** ファセットの 1 項目と、その件数。 */
export interface FacetCount {
  readonly key: CategoryKey;
  /** 他のフィルタ（このファセット自身を除く）の条件に合う件数。表示中の件数ではない。 */
  readonly filtered: number;
  /** 全体の件数。 */
  readonly total: number;
}

/**
 * ある属性のファセットの件数を数える。
 *
 * 「同じ対象・同じ属性のカテゴリのフィルタ」を除いた、その対象のフィルタをすべて通った要素
 * （§6.2 の手順 1、2 の段階）を数える。エッジの規則と孤立ノードの除去（手順 3、4）の前なので、
 * `edgeRule` や `showIsolated` に左右されない。値を選んでも、同じファセットの他の値の件数が
 * 0 にならない（FR-FL-07）。
 *
 * この `filtered` は「条件に合う件数」であり、画面に実際に表示されている件数
 * （FR-FL-09、`applyFilters` の結果）とは別のもの。例えば A(qadi)–B(amir) で
 * include が [qadi] なら、ファセットは qadi 1/1、amir 1/1 だが、両端の規則では
 * エッジが消えるので表示は 0 になる。
 *
 * 全体の件数は、その属性のキーを持つ要素の数。キーを持たない要素（その型に当てはまらない）は
 * どの項目にも数えない。複数値の要素は、値ごとに 1 回ずつ数える。
 * 欠損は、理由ごとの項目になる（FR-FL-06。文字列 "undefined" は作らない）。
 *
 * 項目の並びは、値が最初に現れた順、そのあとに欠損（理由は MISSING_REASONS の順）。
 * 並べ替えは画面の役目。
 *
 * 計算量: O(F·N)（N は対象の要素数）＋ 要素数 × 値の数。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @param target - 数える対象（ノードかエッジ）
 * @param attr - 属性のキー
 * @returns 項目ごとの件数
 */
export function facetCounts(
  dataset: Dataset,
  state: FilterState,
  target: Target,
  attr: string,
): FacetCount[] {
  const others = state.filters.filter(
    (f) => !(f.kind === 'category' && f.target === target && f.attr === attr),
  );
  const flags = passingFlags(dataset, others, target);

  const items = new Map<string, { key: CategoryKey; filtered: number; total: number }>();
  const count = (attrs: Attrs, shown: boolean): void => {
    const a = getAttr(attrs, attr);
    if (a === undefined) return;
    for (const key of categoryKeysOf(a)) {
      const id = categoryKeyId(key);
      const item = items.get(id) ?? { key, filtered: 0, total: 0 };
      item.total += 1;
      if (shown) item.filtered += 1;
      items.set(id, item);
    }
  };
  const owners = target === 'node' ? dataset.nodes : dataset.edges;
  owners.forEach((o, i) => {
    count(o.attrs, flags[i] === true);
  });

  const all = [...items.values()];
  const values = all.filter((i) => i.key.kind === 'value');
  const missings = MISSING_REASONS.flatMap((reason) =>
    all.filter((i) => i.key.kind === 'missing' && i.key.reason === reason),
  );
  return [...values, ...missings];
}

/** 確からしさのファセットの 1 項目と、その件数。 */
export interface CertaintyFacetCount {
  readonly key: CertaintyKey;
  /** 他のフィルタ（同じ対象の確からしさのフィルタを除く）の条件に合う件数。 */
  readonly filtered: number;
  /** 全体の件数。 */
  readonly total: number;
}

/**
 * 確からしさのファセットの件数を数える（D-37、FR-DM-06）。
 *
 * 数え方は `facetCounts` と同じ。同じ対象の `certainty` フィルタを除いた他のフィルタを通った
 * 要素を `filtered`、全要素を `total` とする。`certainty` を持たない要素は 'unspecified' に数える。
 * 項目は常に `CERTAINTY_KEYS` の 4 つ（件数 0 も含む）。この順序なので、画面は並べ替えなしで使える。
 *
 * 計算量: O(F·N)。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @param target - 数える対象（ノードかエッジ）
 * @returns 4 項目の件数
 */
export function certaintyFacetCounts(
  dataset: Dataset,
  state: FilterState,
  target: Target,
): CertaintyFacetCount[] {
  const others = state.filters.filter((f) => !(f.kind === 'certainty' && f.target === target));
  const flags = passingFlags(dataset, others, target);
  const counts = new Map<CertaintyKey, { filtered: number; total: number }>(
    CERTAINTY_KEYS.map((k) => [k, { filtered: 0, total: 0 }]),
  );
  const owners = target === 'node' ? dataset.nodes : dataset.edges;
  owners.forEach((o, i) => {
    const c = counts.get(certaintyKeyOf(o.certainty));
    if (c === undefined) return;
    c.total += 1;
    if (flags[i] === true) c.filtered += 1;
  });
  return CERTAINTY_KEYS.map((key) => ({
    key,
    filtered: counts.get(key)?.filtered ?? 0,
    total: counts.get(key)?.total ?? 0,
  }));
}
