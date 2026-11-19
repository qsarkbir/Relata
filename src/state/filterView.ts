/**
 * フィルタの計算結果を「覚えておく」仕組み（D-32）。
 *
 * 絞り込みの結果（`FilterResult`）、ファセットの件数、フィルタの問題は、ストアには入れない。
 * `Dataset` と `FilterState` から計算し、同じ入力（同じ参照）なら前の結果をそのまま返す。
 * 計算そのものは `core/filter` の関数で、ここでは呼んで覚えるだけ。
 */
import { applyFilters, checkFilterState, facetCounts } from '../core/filter';
import type { FacetCount, FilterIssue, FilterResult, FilterState, Target } from '../core/filter';
import type { Dataset } from '../core/model';

// 【なぜ】キャッシュを 2 段に分ける。ファセットの件数と問題は `state.filters`（配列の参照）だけで決まり、
//       edgeRule と showIsolated の変更では変わらない（NFR-04）。結果（FilterResult）は edgeRule と
//       showIsolated にも左右されるので、FilterState の参照をキーにする。
// 【TS】WeakMap は、キー（オブジェクト）が他から使われなくなると、エントリも自動で捨てられる Map。
//       キーは「内容」ではなく「参照」で比べる。Undo で前の状態に戻ったときも、履歴が同じ参照を
//       持っているので、計算し直さない。
// 【TS】`readonly FilterDef[]` は、書き換え不可の配列の型。`FilterState['filters']` と同じ。
type Filters = FilterState['filters'];

interface FiltersEntry {
  issues?: FilterIssue[];
  readonly facets: Map<string, FacetCount[]>;
}

const resultCache = new WeakMap<Dataset, WeakMap<FilterState, FilterResult>>();
const filtersCache = new WeakMap<Dataset, WeakMap<Filters, FiltersEntry>>();

// 【TS】`<K extends object, V>` はジェネリクス。WeakMap のキーはオブジェクトでなければならないので、
//       `K extends object` と制約を付ける。
function inner<K extends object, V>(
  outer: WeakMap<Dataset, WeakMap<K, V>>,
  dataset: Dataset,
): WeakMap<K, V> {
  let m = outer.get(dataset);
  if (m === undefined) {
    m = new WeakMap();
    outer.set(dataset, m);
  }
  return m;
}

function filtersEntry(dataset: Dataset, filters: Filters): FiltersEntry {
  const m = inner(filtersCache, dataset);
  let entry = m.get(filters);
  if (entry === undefined) {
    entry = { facets: new Map() };
    m.set(filters, entry);
  }
  return entry;
}

/**
 * 絞り込みの結果を返す。同じ `dataset` と `state`（同じ参照）なら、同じオブジェクトを返す。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @returns 絞り込みの結果
 */
export function getFilterResult(dataset: Dataset, state: FilterState): FilterResult {
  const m = inner(resultCache, dataset);
  let result = m.get(state);
  if (result === undefined) {
    result = applyFilters(dataset, state);
    m.set(state, result);
  }
  return result;
}

/**
 * ある属性のファセットの件数を返す。
 *
 * キャッシュのキーは `state.filters` の参照。edgeRule と showIsolated だけが変わっても、
 * 件数は変わらない（D-21 (6)）ので、計算し直さない。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @param target - 対象（ノードかエッジ）
 * @param attr - 属性のキー
 * @returns 項目ごとの件数
 */
export function getFacetCounts(
  dataset: Dataset,
  state: FilterState,
  target: Target,
  attr: string,
): readonly FacetCount[] {
  const entry = filtersEntry(dataset, state.filters);
  // 【なぜ】キーは JSON にする。属性名に区切り文字が入っていても衝突しない（filter-audit #9 と同じ注意）。
  const key = JSON.stringify([target, attr]);
  let counts = entry.facets.get(key);
  if (counts === undefined) {
    counts = facetCounts(dataset, state, target, attr);
    entry.facets.set(key, counts);
  }
  return counts;
}

/**
 * フィルタの問題（存在しない属性など）を返す。同じ `dataset` と `state.filters` なら、同じ配列を返す。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @returns 問題の一覧
 */
export function getFilterIssues(dataset: Dataset, state: FilterState): readonly FilterIssue[] {
  const entry = filtersEntry(dataset, state.filters);
  entry.issues ??= checkFilterState(dataset, state);
  return entry.issues;
}
