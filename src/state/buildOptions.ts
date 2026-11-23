/**
 * 「ネットワークの構築」の設定（重み、自己ループ、射影）の変更と、元に戻す・やり直す（FR-GR-03、D-39）。
 *
 * 保存の位置は `view.graph.graphOptions` のまま変えない。ここは「変更の入口」と「変更の履歴」だけを持つ。
 * 履歴は一時的な UI の状態なので、プロジェクトには保存しない（設計書 §10）。
 */
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { DEFAULT_GRAPH_VIEW } from '../core/project';
import type { GraphOptions } from '../core/graph';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';
import { graphViewStore, selectGraphOptions } from './graphViewStore';
import type { GraphViewState } from './graphViewStore';

/** 履歴の状態。 */
export interface BuildHistoryState {
  readonly past: readonly GraphOptions[];
  readonly future: readonly GraphOptions[];
}

/** 構築の設定の変更口。 */
export interface BuildOptionsController {
  /** 履歴（購読用）。 */
  readonly history: StoreApi<BuildHistoryState>;
  /**
   * 設定を変える。変化が無ければ何もしない。
   *
   * @param change - 今の設定から新しい設定を作る関数
   */
  apply(change: (current: GraphOptions) => GraphOptions): void;
  /** 1 つ前の設定に戻す。 */
  undo(): void;
  /** 戻した変更をやり直す。 */
  redo(): void;
}

const EMPTY: BuildHistoryState = { past: [], future: [] };
/** 履歴の上限。長く使っても増え続けないようにする。 */
const LIMIT = 50;

/**
 * 射影の設定が同じかを、値で比べる。
 *
 * @param a - 一方の設定
 * @param b - もう一方の設定
 * @returns 同じなら true
 */
function sameProjection(a: GraphOptions, b: GraphOptions): boolean {
  return JSON.stringify(a.projection ?? null) === JSON.stringify(b.projection ?? null);
}

/**
 * 構築の設定の変更口を作る。テストごとに別のストアを渡せるよう、関数にしてある。
 *
 * 射影の設定が変わるとグラフの顔ぶれが変わるので、固定していない位置を捨てて配置を計算し直させる
 * （射影前の位置を引き継ぐと、人物と組織が混ざった配置のまま射影後のグラフが描かれるため）。
 * 固定したノードの位置は残す。
 *
 * @param graph - グラフ表示のストア
 * @param data - データのストア
 * @returns 変更口
 */
export function createBuildOptions(
  graph: StoreApi<GraphViewState>,
  data: StoreApi<DataState>,
): BuildOptionsController {
  const history = createStore<BuildHistoryState>()(() => EMPTY);
  // 【なぜ】自分が書き換えている間は、「外から設定が置き換わった」という判定（履歴の破棄）を働かせない。
  const own = { writing: false };
  const write = (next: GraphOptions): void => {
    const view = graph.getState().view ?? DEFAULT_GRAPH_VIEW;
    const dropPositions = !sameProjection(view.graphOptions, next);
    own.writing = true;
    try {
      graph.getState().setView({
        ...view,
        graphOptions: next,
        ...(dropPositions ? { positions: view.positions.filter((p) => p.fixed) } : {}),
      });
    } finally {
      own.writing = false;
    }
  };
  // プロジェクトを開く、データを置き換えるなど、外から設定が替わったら履歴を捨てる。
  graph.subscribe((state, prev) => {
    if (!own.writing && selectGraphOptions(state) !== selectGraphOptions(prev))
      history.setState(EMPTY);
  });
  data.subscribe((state, prev) => {
    if (state.dataset !== prev.dataset) history.setState(EMPTY);
  });
  return {
    history,
    apply: (change) => {
      const current = selectGraphOptions(graph.getState());
      const next = change(current);
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      history.setState({ past: [...history.getState().past, current].slice(-LIMIT), future: [] });
      write(next);
    },
    undo: () => {
      const { past, future } = history.getState();
      const previous = past[past.length - 1];
      if (previous === undefined) return;
      history.setState({
        past: past.slice(0, -1),
        future: [selectGraphOptions(graph.getState()), ...future],
      });
      write(previous);
    },
    redo: () => {
      const { past, future } = history.getState();
      const next = future[0];
      if (next === undefined) return;
      history.setState({
        past: [...past, selectGraphOptions(graph.getState())],
        future: future.slice(1),
      });
      write(next);
    },
  };
}

/** アプリ全体の構築の設定の変更口。 */
export const buildOptions: BuildOptionsController = createBuildOptions(graphViewStore, dataStore);
