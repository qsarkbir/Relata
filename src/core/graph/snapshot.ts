/**
 * Worker に渡すグラフの形（D-17、D-22、設計書 §7.3）。
 *
 * 【なぜ】graphology の Graph はクラスのインスタンスで、`postMessage` の structured clone で
 * メソッドを失う。`graph.export()` の結果は素のオブジェクトと配列だけなので送れる。
 */
// 【TS】`import type` は型だけの取り込みで、実行時には消える。
import Graph from 'graphology';
import type { SerializedGraph } from 'graphology-types';
import type { RelataEdgeAttributes, RelataGraph, RelataNodeAttributes } from './build';

// 【TS】`export type` は型の別名だけを公開する。`SerializedGraph<N, E, G>` はジェネリクスで、
//       ノード・エッジ・グラフの属性の型を渡して、書き出しの形に反映させる。
/** `graph.export()` の結果。structured clone できる。 */
export type GraphSnapshot = SerializedGraph<
  RelataNodeAttributes,
  RelataEdgeAttributes,
  Record<string, never>
>;

/**
 * グラフを Worker に送れる形にする。
 * @param graph - グラフ
 * @returns スナップショット
 */
export function toSnapshot(graph: RelataGraph): GraphSnapshot {
  return graph.export();
}

/**
 * スナップショットからグラフを復元する（Worker 側で使う）。
 * @param snapshot - `toSnapshot` の結果（structured clone を経たものでもよい）
 * @returns グラフ
 */
export function fromSnapshot(snapshot: GraphSnapshot): RelataGraph {
  // 【なぜ】`Graph.from` は snapshot の `options.type`（directed / undirected / mixed）を使って
  // 作る。`new Graph()` に import すると常に mixed になり、種類が元と変わってしまう（設計書 §7.3）。
  // 【TS】型引数を明示した呼び出し。`Graph.from<N, E, G>` は snapshot の属性の型を結果に反映する。
  // 【なぜ】graphology の `Graph.from` の戻り値の型宣言が、この規則には「コンストラクタで作っていない」と
  // 見える（実体は Graph のインスタンス）。型は引数で正しく決まっているので、この 1 行だけ許す。
  // eslint-disable-next-line @typescript-eslint/no-unsafe-class-instance-assignment -- Graph.from の戻り値の型宣言による誤検出
  return Graph.from<RelataNodeAttributes, RelataEdgeAttributes, Record<string, never>>(snapshot);
}
