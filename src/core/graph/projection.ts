/**
 * 二部・k 部グラフの射影（FR-GR-03〜05、設計書 D-39、D-40）。
 *
 * 処理の位置: `applyFilters` → `buildGraph` → **射影** → 指標・配置。
 * フィルタは射影の前の元のデータにかかるので、組織を絞り込めば射影の根拠からも外れる。
 *
 * 射影先の型（target）のノードどうしを、共通の仲介ノード（via 型）を介して 1 本のエッジで結ぶ。
 * 歴史研究では「人物と組織の二部グラフ」から「同じ組織に属した人物の関係網」を作る場面が典型。
 * 3 部以上でも、型の組（target、via）を指定すれば同じ関数で射影できる（FR-GR-05）。
 * 射影先でも仲介でもない型のノードと、target と via の間でないエッジは無視する。
 */
import Graph from 'graphology';
import type { Dataset, EdgeId, NodeId, NodeTypeId } from '../model';
import { assertNever } from '../util/assertNever';
import type { RelataEdgeAttributes, RelataGraph, RelataNodeAttributes } from './build';
import type { ProjectionMethod, ProjectionOptions } from './options';

/**
 * 射影の設定の問題。画面が言語ごとの文言に直す。
 *
 * - `unknownTarget`: 射影先の型が、データセットのノード型にない
 * - `unknownVia`: 仲介する型が、データセットのノード型にない
 * - `sameType`: 射影先と仲介が同じ型（射影にならない）
 */
// 【TS】`code` の値で形が決まる判別共用体。`type` を持つのは型の名前を示す問題だけ。
export type ProjectionIssue =
  | { readonly code: 'unknownTarget'; readonly type: NodeTypeId }
  | { readonly code: 'unknownVia'; readonly type: NodeTypeId }
  | { readonly code: 'sameType'; readonly type: NodeTypeId };

/**
 * 射影の設定を検査する。
 *
 * @param projection - 射影の設定
 * @param dataset - データセット（ノード型の一覧を引く）
 * @returns 問題の一覧。空なら有効
 */
export function validateProjection(
  projection: ProjectionOptions,
  dataset: Pick<Dataset, 'nodeTypes'>,
): readonly ProjectionIssue[] {
  const known = new Set(dataset.nodeTypes.map((t) => t.id));
  const issues: ProjectionIssue[] = [];
  if (!known.has(projection.target))
    issues.push({ code: 'unknownTarget', type: projection.target });
  if (!known.has(projection.via)) issues.push({ code: 'unknownVia', type: projection.via });
  if (projection.target === projection.via) issues.push({ code: 'sameType', type: projection.via });
  return issues;
}

/**
 * 射影のときの注意。呼ぶ側が画面に出す。
 *
 * - `directedAsUndirected`: 射影に使うエッジに有向のものがあった。向きは無視して無向として射影した。
 */
export interface ProjectionWarning {
  readonly code: 'directedAsUndirected';
}

/** 射影の結果。 */
export interface ProjectionResult {
  /**
   * 射影したグラフ（無向）。ノードは射影先の型のすべて（共通の仲介を持たない孤立ノードも残す）。
   * エッジの属性は `RelataEdgeAttributes` で、`via`（根拠の仲介ノード）を持つ。
   */
  readonly graph: RelataGraph;
  readonly warnings: readonly ProjectionWarning[];
}

/**
 * 方式ごとの重み（定義は `projectGraph` に書く）。
 *
 * @param method - 方式
 * @param shared - 共通の仲介ノードの数
 * @param newmanSum - Newman の重みの和
 * @param degU - 一方の仲介近傍の数
 * @param degV - もう一方の仲介近傍の数
 * @returns 重み
 */
function weightOf(
  method: ProjectionMethod,
  shared: number,
  newmanSum: number,
  degU: number,
  degV: number,
): number {
  switch (method) {
    case 'shared':
      return shared;
    case 'newman':
      return newmanSum;
    case 'jaccard':
      // |N(u) ∩ N(v)| / |N(u) ∪ N(v)|。和集合 = |N(u)| + |N(v)| − 共通。
      return shared / (degU + degV - shared);
    default:
      return assertNever(method);
  }
}

function byId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * グラフを射影する。入力は書き換えない。
 *
 * 重み付けの方式（u、v は射影先のノード、N(x) は x の仲介ノードの近傍）:
 * - `shared`: 共通の仲介ノードの数 |N(u) ∩ N(v)|。networkx の `weighted_projected_graph`。
 * - `newman`: 共通の仲介ノード k ごとに 1/(d_k − 1) を足す。d_k は k につながる射影先ノードの数
 *   （k は 2 つ以上の射影先につながるので d_k ≥ 2）。多数が集まる場に居合わせたことの意味を薄める。
 *   Newman, M. E. J. (2001) "Scientific collaboration networks. II. Shortest paths, weighted networks,
 *   and centrality", Physical Review E 64, 016132。networkx の `collaboration_weighted_projected_graph`。
 * - `jaccard`: |N(u) ∩ N(v)| / |N(u) ∪ N(v)|。networkx の `overlap_weighted_projected_graph(jaccard=True)`。
 *
 * 計算量: 仲介ノード k の射影先の近傍数を d_k とすると O(Σ d_k²)（組ごとに Map を引く。平均 O(1)）。
 *
 * 仕様の決め（設計書に定めがないので推奨の扱い）:
 * - 元のエッジの重みは使わない。`buildGraph` が同じ 2 点間を 1 本にまとめた後のグラフで、
 *   つながっているかどうかだけを見る（既定は数え上げ）。
 * - 自己ループは無視する。仲介ノードの近傍に自分自身は入れない。結果にも自己ループは出ない。
 * - 向きは無視して無向として射影し、有向のエッジがあれば `directedAsUndirected` を返す。
 * - 結果のエッジ: `count` ＝根拠の仲介ノードの数、`edgeIds` ＝元のエッジ ID（根拠の両側のエッジ。
 *   選択の対応づけに使う。D-40）、`via` ＝仲介ノード ID。どちらも ID の昇順で決定的。
 *
 * @param graph - `buildGraph` の結果
 * @param projection - 射影の設定（型の検査は `validateProjection` で先にする）
 * @returns 射影したグラフと注意
 *
 * @example
 * ```ts
 * const { graph, warnings } = projectGraph(buildGraph(ds, fr, opts), {
 *   target: toNodeTypeId('person'), via: toNodeTypeId('org'), method: 'newman',
 * });
 * ```
 */
export function projectGraph(graph: RelataGraph, projection: ProjectionOptions): ProjectionResult {
  const out: RelataGraph = new Graph<
    RelataNodeAttributes,
    RelataEdgeAttributes,
    Record<string, never>
  >({
    type: 'undirected',
    multi: false,
    allowSelfLoops: false,
  });
  const isType = (n: string, t: NodeTypeId): boolean => graph.getNodeAttribute(n, 'type') === t;

  // 1. 射影先のノードをすべて入れる（孤立していても残す。ノードの有無を絞り込みと一致させるため）。
  const targets: NodeId[] = [];
  graph.forEachNode((id, a) => {
    if (a.type === projection.target) {
      // 【TS】グラフのノードキーは string。NodeId は string に目印を付けた型（ブランド型）なので、型アサーションで戻す。
      targets.push(id as NodeId); // 理由: キーは NodeId として入れたものをそのまま読み戻している
      out.addNode(id, { label: a.label, type: a.type });
    }
  });

  // 2. 仲介ノードごとに、近傍の射影先ノードと、そこへのエッジ ID を集める。
  // 【TS】クロージャの中で書き換える `let` は、TypeScript が「常に false」と狭めてしまうので、オブジェクトに入れる。
  const seen = { directed: false };
  const vias: string[] = [];
  graph.forEachNode((id) => {
    if (isType(id, projection.via)) vias.push(id);
  });
  vias.sort(byId);

  interface Pair {
    readonly u: string;
    readonly v: string;
    readonly via: NodeId[];
    readonly edgeIds: Set<EdgeId>;
    newman: number;
  }
  const pairs = new Map<string, Pair>();
  const nbrCount = new Map<string, number>(); // 射影先ノードの仲介近傍の数 |N(u)|（Jaccard 用）

  // 先に |N(u)| を数える。
  const nbrs = new Map<string, Map<string, EdgeId[]>>(); // via → (target → 元エッジ ID)
  for (const k of vias) {
    const m = new Map<string, EdgeId[]>();
    graph.forEachEdge(k, (_e, attrs, s, t) => {
      if (s === t) return; // 自己ループは無視
      const other = s === k ? t : s;
      if (!isType(other, projection.target)) return;
      if (attrs.directed) seen.directed = true;
      const ids = m.get(other) ?? [];
      ids.push(...attrs.edgeIds);
      m.set(other, ids);
    });
    nbrs.set(k, m);
    for (const u of m.keys()) nbrCount.set(u, (nbrCount.get(u) ?? 0) + 1);
  }

  // 3. 仲介ノードごとに、近傍の射影先の全組を数える。
  for (const k of vias) {
    const m = nbrs.get(k);
    if (m === undefined || m.size < 2) continue;
    const us = [...m.keys()].sort(byId);
    const d = us.length;
    for (let i = 0; i < d; i++) {
      for (let j = i + 1; j < d; j++) {
        const u = us[i];
        const v = us[j];
        if (u === undefined || v === undefined) continue;
        const key = JSON.stringify([u, v]);
        let p = pairs.get(key);
        if (p === undefined) {
          p = { u, v, via: [], edgeIds: new Set(), newman: 0 };
          pairs.set(key, p);
        }
        p.via.push(k as NodeId); // 理由: k は NodeId のキーを読み戻したもの
        p.newman += 1 / (d - 1);
        for (const id of m.get(u) ?? []) p.edgeIds.add(id);
        for (const id of m.get(v) ?? []) p.edgeIds.add(id);
      }
    }
  }

  // 4. 組をエッジとして入れる（キーの順 = 決定的）。
  for (const [key, p] of [...pairs.entries()].sort((a, b) => byId(a[0], b[0]))) {
    const shared = p.via.length;
    const attrs: RelataEdgeAttributes = {
      weight: weightOf(
        projection.method,
        shared,
        p.newman,
        nbrCount.get(p.u) ?? 0,
        nbrCount.get(p.v) ?? 0,
      ),
      count: shared,
      edgeIds: [...p.edgeIds].sort(byId),
      directed: false,
      missingWeightCount: 0,
      via: p.via, // k を昇順に処理したので昇順
    };
    out.addUndirectedEdgeWithKey(key, p.u, p.v, attrs);
  }

  return { graph: out, warnings: seen.directed ? [{ code: 'directedAsUndirected' }] : [] };
}
