import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import type { EdgeId, NodeId } from '../core/model';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';

// 【TS】`ReadonlySet<T>` は、読むだけの Set の型（add や delete が無い）。状態を直接書き換える誤りを型で防ぐ。
// 【TS】`Iterable<T>` は、`for...of` で順に取り出せるものの型。配列でも Set でも渡せるので、呼ぶ側が形を選ばない。
/** 選択の中身。ノード ID と、元のデータのエッジ ID の集合。 */
export interface SelectionSets {
  readonly nodes: ReadonlySet<NodeId>;
  /**
   * 元のエッジ ID。
   * 【なぜ】集約したエッジや射影したエッジ（フェーズ 2 の T2-02）は、元のエッジ ID の一覧で対応づける
   * （R-19）。画面上のエッジの ID ではなく、元のデータの ID で持てば、表からの選択とも一致する。
   */
  readonly edges: ReadonlySet<EdgeId>;
}

/** selectionStore の状態と操作。 */
export interface SelectionState extends SelectionSets {
  /**
   * 選択を置き換える。省略した側は空になる。
   *
   * @param next - 新しい選択
   */
  readonly select: (next: {
    readonly nodes?: Iterable<NodeId>;
    readonly edges?: Iterable<EdgeId>;
  }) => void;
  /**
   * 選択に加える（すでにあるものは変えない）。
   *
   * @param more - 加える ID
   */
  readonly add: (more: {
    readonly nodes?: Iterable<NodeId>;
    readonly edges?: Iterable<EdgeId>;
  }) => void;
  /**
   * 選択から外す。選択に無い ID は無視する。
   *
   * @param less - 外す ID
   */
  readonly remove: (less: {
    readonly nodes?: Iterable<NodeId>;
    readonly edges?: Iterable<EdgeId>;
  }) => void;
  /** すべて解除する。 */
  readonly clear: () => void;
}

const EMPTY_NODES: ReadonlySet<NodeId> = new Set();
const EMPTY_EDGES: ReadonlySet<EdgeId> = new Set();

/**
 * 選択のストアを作る。テストごとに新しいストアを作れるよう、関数にしてある。
 *
 * 【なぜ】選択は一時的な UI の状態なので、プロジェクトには保存しない（設計書 §10、R-19）。
 * フィルタで見えなくなったノードの選択は消さない。画面が「表示されていない」と示す。
 * @returns Zustand のストア
 */
export function createSelectionStore() {
  // 【TS】`createStore<SelectionState>()(…)` と呼び出しが 2 回続くのは、型引数だけを手で指定し、
  //       残りは推論に任せるための書き方（カリー化。uiStore と同じ）。
  return createStore<SelectionState>()((set, get) => ({
    nodes: EMPTY_NODES,
    edges: EMPTY_EDGES,
    select: (next) => {
      set({ nodes: new Set(next.nodes ?? []), edges: new Set(next.edges ?? []) });
    },
    add: (more) => {
      // 【なぜ】新しい Set を作って置き換える。同じ Set を書き換えると、購読している画面が変化に気づけない。
      set({
        nodes: new Set([...get().nodes, ...(more.nodes ?? [])]),
        edges: new Set([...get().edges, ...(more.edges ?? [])]),
      });
    },
    remove: (less) => {
      const nodes = new Set(get().nodes);
      const edges = new Set(get().edges);
      for (const id of less.nodes ?? []) nodes.delete(id);
      for (const id of less.edges ?? []) edges.delete(id);
      // 【なぜ】何も外れなければ置き換えない。購読している画面を無駄に再描画させない。
      if (nodes.size === get().nodes.size && edges.size === get().edges.size) return;
      set({ nodes, edges });
    },
    clear: () => {
      // 【なぜ】すでに空なら何もしない。無駄な再描画を避ける。
      if (get().nodes.size === 0 && get().edges.size === 0) return;
      set({ nodes: EMPTY_NODES, edges: EMPTY_EDGES });
    },
  }));
}

/**
 * データの置き換えで選択を空にする。前のデータの ID が残ると、別のデータの同じ ID を誤って選ぶため。
 *
 * @param selection - 選択のストア
 * @param data - データのストア
 * @returns 購読解除
 */
// 【TS】`StoreApi<T>` は、Zustand のストアが持つ操作（getState、subscribe など）の型。
//       React に依存しない `zustand/vanilla` のストアを、引数として受け取れる。
export function bindSelectionToData(
  selection: StoreApi<SelectionState>,
  data: StoreApi<DataState>,
): () => void {
  return data.subscribe((s, prev) => {
    if (s.dataset !== prev.dataset) selection.getState().clear();
  });
}

/** アプリ全体の選択。 */
export const selectionStore = createSelectionStore();
bindSelectionToData(selectionStore, dataStore);
