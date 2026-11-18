/**
 * グラフの構築（FR-GR-01、FR-GR-02、FR-DM-03、設計書 §7.1、D-22）。
 *
 * 表示ノード集合と表示エッジ集合から graphology のグラフを作る。
 * 同じ 2 点間のエッジは 1 本にまとめ、重みと元のエッジ ID の一覧を持たせる。
 *
 * 【なぜ】毎回、Dataset と FilterResult の全体から作り直す。差分で更新しない
 * （filter-audit #1、#5）。計算量: ノード数 V、エッジ数 E に対して O(V + E)
 * （まとめの表引きは Map の平均 O(1)。属性の合計では、複数値の長さの分が加わる）。
 */
// 【TS】`import type` は型だけを取り込む（実行時には消える）。波括弧の中の `type` 修飾子は、
//       1 つの import 文で値（getAttr）と型（Dataset など）を混ぜるときに、型だけに付ける印。
import Graph from 'graphology';
import {
  getAttr,
  type Dataset,
  type EdgeId,
  type GraphEdge,
  type GraphMode,
  type Scalar,
  type NodeId,
  type NodeTypeId,
} from '../model';
import type { FilterResult } from '../filter';
import { assertNever } from '../util/assertNever';
import { DEFAULT_GRAPH_OPTIONS, type GraphOptions } from './options';

/** グラフのノードの属性。attrs は入れない（ID で Dataset から引ける）。 */
export interface RelataNodeAttributes {
  readonly label: string;
  readonly type: NodeTypeId;
}

/** まとめたエッジの属性。 */
export interface RelataEdgeAttributes {
  /** 選んだ重みでの合計（`count` なら件数）。 */
  readonly weight: number;
  /** まとめた元のエッジの件数。 */
  readonly count: number;
  // 【TS】`readonly EdgeId[]` は「中身を変えられない配列」。まとめた ID の一覧を、受け取った側が
  //       書き換えないと型で約束する。
  /** まとめた元のエッジの ID（Dataset の順）。表や詳細表示から元データに戻るため。 */
  readonly edgeIds: readonly EdgeId[];
  readonly directed: boolean;
  /**
   * 重みの値が使えないために合計に入れなかった元エッジの件数。使えない値とは、
   * `'weight'` では有限でない値と負の値、`{ attr }` では属性なし・欠損・数値でない値・
   * 有限でない値・負の値（複数値は 1 つでも該当すれば全体が該当）。
   * 【なぜ】0 として足すと合計がゆがむので、足さずに件数を示す（D-22）。他の重みでは 0。
   */
  readonly missingWeightCount: number;
}

// 【TS】`Graph<N, E, G>` はジェネリクスで、ノード・エッジ・グラフ全体の属性の型を渡す。
//       これで `getNodeAttributes` などの戻り値の型が決まる。型の別名（type）にも型引数を使える。
//       `Record<string, never>` は「どんなキーにも値を持てない」型で、グラフ属性を使わない印。
/** Relata のグラフ。型引数は (ノード属性, エッジ属性, グラフ属性)。 */
export type RelataGraph = Graph<RelataNodeAttributes, RelataEdgeAttributes, Record<string, never>>;

/**
 * エッジ 1 本の、`{ attr }` での重み。数値でなければ undefined。
 *
 * 複数値（FR-DM-07）の数値属性は、すべての要素が有限の数値なら要素の合計とする
 * （例: 「回数: 2;3」は 5）。1 つでも数値でない・有限でない・負の要素があれば、
 * 全体を使えない値（undefined）として扱う。
 *
 * @param e - エッジ
 * @param key - 属性のキー
 * @returns 合計。数値でなければ undefined
 */
function numericAttr(e: GraphEdge, key: string): number | undefined {
  const a = getAttr(e.attrs, key);
  // 【TS】`a?.kind` はオプショナルチェーン。a が undefined なら式全体が undefined になる。
  //       「属性なし」と「値でない種類（missing、date）」をまとめて除く。
  if (a?.kind !== 'value') return undefined;
  const vs: readonly Scalar[] = Array.isArray(a.value) ? a.value : [a.value];
  if (vs.length === 0) return undefined;
  let sum = 0;
  for (const v of vs) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return undefined;
    sum += v;
  }
  return sum;
}

/**
 * まとめのキー。`JSON.stringify` で作る。
 *
 * 【なぜ】`a + ',' + b` のような連結だと、ID に `,` や `->` が入ると別の組が衝突する
 * （filter-audit #9）。JSON なら区切りが引用符で守られるので衝突しない。
 * 無向は端点を並べ替えて、A–B と B–A を同じキーにする。
 *
 * @param directed - 有向か
 * @param s - 始点
 * @param t - 終点
 * @returns キー
 */
function groupKey(directed: boolean, s: NodeId, t: NodeId): string {
  if (directed) return JSON.stringify(['d', s, t]);
  return JSON.stringify(s <= t ? ['u', s, t] : ['u', t, s]);
}

/**
 * エッジを有向として扱うか。graphMode がエッジの `directed` に勝つ（FR-DM-03）。
 *
 * 【なぜ】graphology のグラフの型（directed / undirected）が許さない向きのエッジを
 * 追加すると例外になるため、graphMode に合わせる。
 *
 * @param mode - データセットの graphMode
 * @param e - エッジ
 * @returns 有向なら true
 */
function edgeDirected(mode: GraphMode, e: GraphEdge): boolean {
  switch (mode) {
    case 'directed':
      return true;
    case 'undirected':
      return false;
    case 'mixed':
      return e.directed;
    default:
      return assertNever(mode);
  }
}

interface Group {
  readonly key: string;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly directed: boolean;
  readonly edgeIds: EdgeId[];
  weight: number;
  missing: number;
}

/**
 * Dataset と絞り込みの結果からグラフを作る。
 *
 * - 型は `graphMode` に合わせる。`directed` は全エッジを有向、`undirected` は全エッジを無向として扱う。
 *   `mixed` はエッジの `directed` に従い、有向と無向を別にまとめる。
 * - 多重エッジは作らない。
 * - 孤立ノードも、表示ノード集合にあればグラフに入る（FilterState.showIsolated の結果）。
 * - 端点が表示ノード集合にないエッジは、念のため入れない。
 * - ノード ID が重複していても例外を投げない。`checkDataset` が重複を報告する。
 *   ここでは先に出たものを採る。
 *
 * @param dataset - データセット
 * @param filterResult - `applyFilters` の結果
 * @param options - 重みと自己ループの選択肢（省略時は既定）
 * @returns グラフ
 */
export function buildGraph(
  dataset: Dataset,
  filterResult: FilterResult,
  options: GraphOptions = DEFAULT_GRAPH_OPTIONS,
): RelataGraph {
  // 【TS】`new Graph(...)` の型引数は、左辺の注釈 `RelataGraph` から推論される。
  const graph: RelataGraph = new Graph({
    type: dataset.graphMode,
    multi: false,
    allowSelfLoops: true,
  });

  for (const n of dataset.nodes) {
    if (filterResult.nodeIds.has(n.id) && !graph.hasNode(n.id))
      graph.addNode(n.id, { label: n.label, type: n.type });
  }

  // 1. 表示エッジを、キーごとの組にまとめる（Map は挿入順を保つので、結果は決定的）。
  const groups = new Map<string, Group>();
  for (const e of dataset.edges) {
    if (!filterResult.edgeIds.has(e.id)) continue;
    if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
    if (!options.selfLoops && e.source === e.target) continue;

    const directed = edgeDirected(dataset.graphMode, e);
    const key = groupKey(directed, e.source, e.target);
    let g = groups.get(key);
    if (g === undefined) {
      g = { key, source: e.source, target: e.target, directed, edgeIds: [], weight: 0, missing: 0 };
      groups.set(key, g);
    }
    g.edgeIds.push(e.id);

    const w = options.weight;
    if (w === 'count') {
      g.weight += 1;
    } else if (w === 'weight') {
      // 【なぜ】有限でない値と負の値は、`{ attr }` と同じく足さずに件数へ回す。
      if (Number.isFinite(e.weight) && e.weight >= 0) g.weight += e.weight;
      else g.missing += 1;
    } else if (typeof w === 'object') {
      const v = numericAttr(e, w.attr);
      if (v === undefined) g.missing += 1;
      else g.weight += v;
    } else {
      assertNever(w);
    }
  }

  // 2. まとめたエッジをグラフに入れる。
  for (const g of groups.values()) {
    const attrs: RelataEdgeAttributes = {
      weight: g.weight,
      count: g.edgeIds.length,
      edgeIds: g.edgeIds,
      directed: g.directed,
      missingWeightCount: g.missing,
    };
    if (g.directed) graph.addDirectedEdgeWithKey(g.key, g.source, g.target, attrs);
    else graph.addUndirectedEdgeWithKey(g.key, g.source, g.target, attrs);
  }
  return graph;
}
