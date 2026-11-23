/**
 * 欠損率の一覧の計算結果を覚えておく（D-32 と同じ考え方）。
 *
 * 集計そのものは `core/missing` の純粋な関数。ここでは、絞り込みの結果（`FilterResult`）を
 * 引数に渡して呼び、同じ入力（同じ参照）なら前の結果を返す。ストアには入れない（保存しない計算結果）。
 */
import { countMissingByAttribute } from '../core/missing';
import type { AttrMissingRow } from '../core/missing';
import type { FilterState } from '../core/filter';
import type { Dataset } from '../core/model';
import { getFilterResult } from './filterView';

const cache = new WeakMap<Dataset, WeakMap<FilterState, readonly AttrMissingRow[]>>();

/**
 * 属性ごとの欠損率の一覧（絞り込み後と全体）。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @returns 属性ごとの行
 */
export function getMissingRows(dataset: Dataset, state: FilterState): readonly AttrMissingRow[] {
  let inner = cache.get(dataset);
  if (inner === undefined) {
    inner = new WeakMap();
    cache.set(dataset, inner);
  }
  let rows = inner.get(state);
  if (rows === undefined) {
    const result = getFilterResult(dataset, state);
    rows = countMissingByAttribute(dataset, { nodeIds: result.nodeIds, edgeIds: result.edgeIds });
    inner.set(state, rows);
  }
  return rows;
}
