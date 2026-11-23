/**
 * 指標・配置・描画が共有する「射影後のグラフ」の計算（FR-GR-03〜05、設計書 D-39）。
 *
 * 処理の順: `applyFilters`（`getFilterResult`）→ `buildGraph`（重みの集約）→ 射影（設定があり有効なとき）。
 * 指標の controller、配置、描画がそれぞれ別々に作ると、設定の食い違いや二重の計算が起きるので、
 * ここ 1 か所にまとめ、同じ入力（同じ参照）なら同じ結果を返す（`filterView.ts` と同じ考え方）。
 * 結果はストアに入れない（`Dataset`、`FilterState`、`GraphOptions` から導き出せるため）。
 */
import { buildGraph, projectGraph, validateProjection } from '../core/graph';
import type {
  GraphOptions,
  ProjectionIssue,
  ProjectionOptions,
  ProjectionWarning,
  RelataGraph,
} from '../core/graph';
import type { FilterState } from '../core/filter';
import type { Dataset, EdgeId } from '../core/model';
import { getFilterResult } from './filterView';

// 【TS】判別共用体。`kind` の値で、持つ項目が決まる。
/**
 * 射影の状態。画面はこれを見て、適用中の値や理由を表示する。
 *
 * - `none`: 射影の設定がない
 * - `applied`: 射影した。`warnings` は計算時の注意（有向を無向として扱った、など）
 * - `invalid`: 設定が今のデータで使えない（型が無い、など）。射影はせず、射影前のグラフを返す
 */
export type ProjectionStatus =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'applied';
      readonly options: ProjectionOptions;
      readonly warnings: readonly ProjectionWarning[];
    }
  | {
      readonly kind: 'invalid';
      readonly options: ProjectionOptions;
      readonly issues: readonly ProjectionIssue[];
    };

/** 指標・配置・描画の入力になるグラフと、射影の状態。 */
export interface Network {
  /** 射影後（射影しないときは集約後）のグラフ。 */
  readonly graph: RelataGraph;
  readonly projection: ProjectionStatus;
}

// 【TS】WeakMap はキーの参照で引く Map。キーが使われなくなれば自動で捨てられる。
//       3 段にして、Dataset → FilterState → GraphOptions の参照が同じときだけ結果を再利用する。
const cache = new WeakMap<Dataset, WeakMap<FilterState, WeakMap<GraphOptions, Network>>>();

/**
 * 射影後のグラフを返す。同じ `dataset`、`filter`、`graphOptions`（同じ参照）なら同じ結果を返す。
 *
 * 【なぜ】フィルタは射影の前の元のデータにかかる。組織を絞り込めば射影の根拠からも外れる（D-39）。
 * 設定が無効なら射影せず、`projection.kind === 'invalid'` で理由を返す（画面が示す）。
 *
 * @param dataset - データセット
 * @param filter - フィルタの状態
 * @param graphOptions - 構築の設定（重み、自己ループ、射影）
 * @returns グラフと射影の状態
 */
export function getNetwork(
  dataset: Dataset,
  filter: FilterState,
  graphOptions: GraphOptions,
): Network {
  let byFilter = cache.get(dataset);
  if (byFilter === undefined) {
    byFilter = new WeakMap();
    cache.set(dataset, byFilter);
  }
  let byOptions = byFilter.get(filter);
  if (byOptions === undefined) {
    byOptions = new WeakMap();
    byFilter.set(filter, byOptions);
  }
  let network = byOptions.get(graphOptions);
  if (network === undefined) {
    network = computeNetwork(dataset, filter, graphOptions);
    byOptions.set(graphOptions, network);
  }
  return network;
}

function computeNetwork(dataset: Dataset, filter: FilterState, options: GraphOptions): Network {
  const base = buildGraph(dataset, getFilterResult(dataset, filter), options);
  const projection = options.projection;
  if (projection === undefined) return { graph: base, projection: { kind: 'none' } };
  const issues = validateProjection(projection, dataset);
  if (issues.length > 0) {
    return { graph: base, projection: { kind: 'invalid', options: projection, issues } };
  }
  const projected = projectGraph(base, projection);
  return {
    graph: projected.graph,
    projection: { kind: 'applied', options: projection, warnings: projected.warnings },
  };
}

/**
 * 選択中の元のエッジ ID に対応する、グラフ上のエッジのキーを返す（D-40）。
 *
 * 集約したエッジや射影したエッジは、元のエッジ ID の一覧（`edgeIds`）を持つ。そのすべてが選択に
 * 含まれるエッジを「選ばれている」とみなす。
 * 【なぜ】「どれか 1 つ」ではなく「すべて」にする。射影では、1 本の元のエッジが複数の射影したエッジの
 * 根拠になる（人物 A と組織 X のエッジは、A—B と A—C の両方の根拠）。「どれか 1 つ」にすると、A—B を選んだだけで
 * A—C まで選ばれてしまう。
 *
 * @param graph - 表示中のグラフ
 * @param selected - 選択中の元のエッジ ID
 * @returns グラフ上のエッジのキー（グラフの順）
 */
export function selectedGraphEdges(
  graph: RelataGraph,
  selected: ReadonlySet<EdgeId>,
): readonly string[] {
  if (selected.size === 0) return [];
  return graph.filterEdges((_key, attrs) => attrs.edgeIds.every((id) => selected.has(id)));
}
