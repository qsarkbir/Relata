import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  DEFAULT_FILTER_STATE,
  addFilter,
  canRedo,
  canUndo,
  clearFilters,
  createHistory,
  pushHistory,
  redoHistory,
  removeFilter,
  replaceFilter,
  setEdgeRule,
  setShowIsolated,
  undoHistory,
} from '../core/filter';
import type { EdgeRule, FilterDef, FilterHistory, FilterId, FilterState } from '../core/filter';
import { dataStore } from './dataStore';
import type { DataState } from './dataStore';

/** filterStore の状態と操作。 */
export interface FilterStoreState {
  /**
   * フィルタ状態の履歴。これが唯一の持ち主で、現在の `FilterState` は `history.present`（D-32）。
   */
  // 【なぜ】現在の状態や「適用中のフィルタの一覧」を別の項目として持たない。
  //       2 か所に持つと食い違う（旧版の filter-audit #2、#3）。読む側は `selectFilterState` で取り出す。
  readonly history: FilterHistory;
  /** フィルタを追加する（同じ ID があれば置き換える）。 */
  readonly add: (def: FilterDef) => void;
  /** 既にあるフィルタを置き換える。 */
  readonly replace: (def: FilterDef) => void;
  /** フィルタを 1 つ解除する（FR-FL-08）。 */
  readonly remove: (id: FilterId) => void;
  /** フィルタをすべて解除する（FR-FL-08）。edgeRule と showIsolated は残る。 */
  readonly clearAll: () => void;
  /** エッジの表示の規則を変える（FR-FL-04）。 */
  readonly setEdgeRule: (rule: EdgeRule) => void;
  /** 孤立ノードを表示するかを変える（FR-FL-05）。 */
  readonly setShowIsolated: (show: boolean) => void;
  /** 1 つ前に戻す（FR-FL-10）。 */
  readonly undo: () => void;
  /** 戻した操作をやり直す（FR-FL-10）。 */
  readonly redo: () => void;
  /**
   * 履歴を捨てて、指定した状態から始める。データの読み替えと、プロジェクトの読み込み（T1-21）で使う。
   *
   * 【なぜ】データを読み替えると履歴は自動で初期化される（`bindFilterToData`）。プロジェクトの
   * 読み込み（T1-21）では、`setDataset` の後に `reset(saved)` を呼んで、保存されていたフィルタを入れる
   * （順序が逆だと、`setDataset` の初期化で保存した状態が消える）。
   *
   * @param initial - 最初の状態。省略すると何も絞らない既定の状態
   */
  readonly reset: (initial?: FilterState) => void;
}

/**
 * 履歴から現在の FilterState を取り出す。
 *
 * @param s - filterStore の状態
 * @returns 現在の状態（履歴の `present`）
 */
export function selectFilterState(s: FilterStoreState): FilterState {
  return s.history.present;
}

/**
 * 元に戻せるかを返す。
 *
 * @param s - filterStore の状態
 * @returns 過去があれば true
 */
export function selectCanUndo(s: FilterStoreState): boolean {
  return canUndo(s.history);
}

/**
 * やり直せるかを返す。
 *
 * @param s - filterStore の状態
 * @returns やり直しの状態があれば true
 */
export function selectCanRedo(s: FilterStoreState): boolean {
  return canRedo(s.history);
}

/**
 * filterStore を作る。
 *
 * 操作はすべて core の純粋関数（`addFilter` など）に任せ、ここでは履歴に積むだけにする
 * （計算をしない。設計書 §4.3）。
 *
 * @param initial - 最初の状態
 * @returns Zustand のストア
 */
export function createFilterStore(initial: FilterState = DEFAULT_FILTER_STATE) {
  // 【TS】`createStore<FilterStoreState>()(…)` と呼び出しが 2 回続くのは、型引数だけを手で指定し、
  //       残りの型は推論に任せるための書き方（カリー化。uiStore と同じ）。
  return createStore<FilterStoreState>()((set) => {
    // 【なぜ】全操作の共通部分。変化が無ければ pushHistory が同じ履歴を返すので、履歴を増やさない。
    const change = (fn: (s: FilterState) => FilterState): void => {
      set((s) => {
        const history = pushHistory(s.history, fn(s.history.present));
        return history === s.history ? s : { history };
      });
    };
    return {
      history: createHistory(initial),
      add: (def) => {
        change((s) => addFilter(s, def));
      },
      replace: (def) => {
        change((s) => replaceFilter(s, def));
      },
      remove: (id) => {
        change((s) => removeFilter(s, id));
      },
      clearAll: () => {
        change(clearFilters);
      },
      setEdgeRule: (rule) => {
        change((s) => setEdgeRule(s, rule));
      },
      setShowIsolated: (show) => {
        change((s) => setShowIsolated(s, show));
      },
      undo: () => {
        set((s) => {
          const history = undoHistory(s.history);
          return history === s.history ? s : { history };
        });
      },
      redo: () => {
        set((s) => {
          const history = redoHistory(s.history);
          return history === s.history ? s : { history };
        });
      },
      reset: (next = DEFAULT_FILTER_STATE) => {
        set({ history: createHistory(next) });
      },
    };
  });
}

/**
 * データを読み替えたら、フィルタの履歴を初期化するよう結びつける。
 *
 * 【なぜ】別のデータに前のデータのフィルタ（存在しない属性や値を指すもの）を持ち越すと、
 * 「一覧に出ているのに効かない」状態になる（filter-audit #2、#3）。
 *
 * @param filter - 履歴を初期化する filterStore
 * @param data - 見張る dataStore
 * @returns 結びつけを解く関数
 */
export function bindFilterToData(
  filter: StoreApi<FilterStoreState>,
  data: StoreApi<DataState>,
): () => void {
  return data.subscribe((state, prev) => {
    if (state.dataset !== prev.dataset) filter.getState().reset();
  });
}

/** アプリ全体で使う filterStore。 */
export const filterStore = createFilterStore();
// 【なぜ】アプリ全体のストア同士は、ここで 1 度だけ結ぶ（解除は要らない）。
bindFilterToData(filterStore, dataStore);
