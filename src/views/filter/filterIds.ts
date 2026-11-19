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
