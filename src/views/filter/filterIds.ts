import { toFilterId } from '../../core/filter';
import type { FilterId, Target } from '../../core/filter';

// 【なぜ】フィルタの ID は「種類・対象・属性」から決める。同じ部品が何度操作されても、
//       同じ属性のフィルタは常に 1 つ（追加は置き換え）になり、一覧に重複が出ない。
//       属性名に区切り文字が入っていても衝突しないよう、JSON で組み立てる。

/**
 * カテゴリのフィルタの ID。
 *
 * @param target - 対象
 * @param attr - 属性のキー
 * @returns FilterId
 */
export function categoryFilterId(target: Target, attr: string): FilterId {
  return toFilterId(JSON.stringify(['category', target, attr]));
}

/**
 * 数値の範囲のフィルタの ID。
 *
 * @param target - 対象
 * @param attr - 属性のキー
 * @returns FilterId
 */
export function rangeFilterId(target: Target, attr: string): FilterId {
  return toFilterId(JSON.stringify(['range', target, attr]));
}

/**
 * テキスト検索のフィルタの ID（対象ごとに 1 つ）。
 *
 * @param target - 対象
 * @returns FilterId
 */
export function textFilterId(target: Target): FilterId {
  return toFilterId(JSON.stringify(['text', target]));
}

/** ノード型のフィルタの ID（1 つだけ）。 */
export const NODE_TYPE_FILTER_ID: FilterId = toFilterId(JSON.stringify(['nodeType']));

/**
 * 確からしさのフィルタの ID（対象ごとに 1 つ）。
 *
 * @param target - 対象
 * @returns FilterId
 */
export function certaintyFilterId(target: Target): FilterId {
  return toFilterId(JSON.stringify(['certainty', target]));
}

/**
 * 時間フィルタの ID（対象ごとに 1 つ）。
 *
 * 【なぜ】日付の出どころ（期間・属性）が変わっても同じ ID にする。対象ごとの時間の条件は 1 つで、
 * 出どころを替えると置き換わる（一覧に似た条件が並ばない）。
 *
 * @param target - 対象
 * @returns FilterId
 */
export function timeFilterId(target: Target): FilterId {
  return toFilterId(JSON.stringify(['time', target]));
}

/** 範囲選択から作るノード集合のフィルタの ID（1 つだけ。もう一度押すと置き換わる。D-41）。 */
export const NODE_SET_FILTER_ID: FilterId = toFilterId(JSON.stringify(['nodeSet']));
