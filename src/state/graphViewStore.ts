import { DEFAULT_GRAPH_VIEW } from '../core/project';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { GraphViewSettings } from '../core/project/graphView';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';

/** グラフ画面の保存する状態。選択・検索・進行中の計算は含めない。 */
export interface GraphViewState {
  readonly view: GraphViewSettings | null;
  readonly setView: (view: GraphViewSettings | null) => void;
}
/**
 * グラフ表示設定のストアを作る。
 * @returns 新しいストア
 */
export function createGraphViewStore() {
  return createStore<GraphViewState>()((set) => ({
    view: null,
    setView: (view) => {
      set({ view });
    },
  }));
}
/**
 * データの置き換えで、前の配置を引き継がないよう初期化する。
 * @param graph - グラフ表示のストア
 * @param data - データのストア
 * @returns 購読解除
 */
export function bindGraphViewToData(
  graph: StoreApi<GraphViewState>,
  data: StoreApi<DataState>,
): () => void {
  return data.subscribe((s, prev) => {
    if (s.dataset !== prev.dataset) graph.getState().setView(null);
  });
}
/** アプリ全体のグラフ表示設定。 */
export const graphViewStore = createGraphViewStore();
bindGraphViewToData(graphViewStore, dataStore);

/** 指標とグラフで共有する集計の設定。
 * @param state - グラフ表示ストア
 * @returns 重みと自己ループの指定
 */
export function selectGraphOptions(state: GraphViewState) {
  return (state.view ?? DEFAULT_GRAPH_VIEW).graphOptions;
}
