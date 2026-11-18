/**
 * FilterState を操作する純粋関数（FR-FL-08）。入力は書き換えず、新しい値を返す。
 */
import type { EdgeRule, FilterDef, FilterId, FilterState } from './types';

/**
 * フィルタを追加する。同じ ID のフィルタが既にあれば、その位置で置き換える。
 *
 * 【なぜ】ID の重複を作らない。一覧（FR-FL-08）で同じ ID が 2 つ並ぶと、個別の解除がどちらを
 * 指すのか決まらなくなる。
 *
 * @param state - 元の状態
 * @param def - 追加するフィルタ
 * @returns 新しい状態
 */
// 【TS】`{ ...state, filters: … }` はオブジェクトのスプレッド。state の項目をすべて複製し、
//       filters だけを新しい値で上書きした新しいオブジェクトを作る（元は書き換えない）。
export function addFilter(state: FilterState, def: FilterDef): FilterState {
  // 【なぜ】同じ参照の定義が既にあるなら何も変わらない。同じ state を返し、履歴に空振りを積まない。
  if (state.filters.includes(def)) return state;
  const exists = state.filters.some((f) => f.id === def.id);
  return {
    ...state,
    filters: exists
      ? state.filters.map((f) => (f.id === def.id ? def : f))
      : [...state.filters, def],
  };
}

/**
 * 既にあるフィルタを置き換える（同じ ID のものを、位置を変えずに差し替える）。
 *
 * @param state - 元の状態
 * @param def - 新しい定義（`id` で対象を決める）
 * @returns 新しい状態。該当の ID が無ければ、state をそのまま返す
 */
export function replaceFilter(state: FilterState, def: FilterDef): FilterState {
  if (!state.filters.some((f) => f.id === def.id)) return state;
  return addFilter(state, def); // 同じ参照なら addFilter が state をそのまま返す
}

/**
 * フィルタを 1 つ解除する（FR-FL-08）。
 *
 * @param state - 元の状態
 * @param id - 解除するフィルタの ID
 * @returns 新しい状態。該当の ID が無ければ、state をそのまま返す
 */
export function removeFilter(state: FilterState, id: FilterId): FilterState {
  if (!state.filters.some((f) => f.id === id)) return state;
  return { ...state, filters: state.filters.filter((f) => f.id !== id) };
}

/**
 * フィルタをすべて解除する（FR-FL-08）。`edgeRule` と `showIsolated` は「フィルタ」ではなく
 * 表示の設定なので、そのまま残す。
 *
 * @param state - 元の状態
 * @returns フィルタの一覧が空の新しい状態
 */
export function clearFilters(state: FilterState): FilterState {
  return state.filters.length === 0 ? state : { ...state, filters: [] };
}

/**
 * エッジの表示の規則を変える（FR-FL-04）。
 *
 * @param state - 元の状態
 * @param edgeRule - 新しい規則
 * @returns 新しい状態
 */
export function setEdgeRule(state: FilterState, edgeRule: EdgeRule): FilterState {
  return state.edgeRule === edgeRule ? state : { ...state, edgeRule };
}

/**
 * 孤立ノードを表示するかを変える（FR-FL-05）。
 *
 * @param state - 元の状態
 * @param showIsolated - 表示するなら true
 * @returns 新しい状態
 */
export function setShowIsolated(state: FilterState, showIsolated: boolean): FilterState {
  return state.showIsolated === showIsolated ? state : { ...state, showIsolated };
}
