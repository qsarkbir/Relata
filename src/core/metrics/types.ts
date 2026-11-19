/**
 * 指標の要求と結果の型（FR-MT-01、FR-MT-02、設計書 §7.3、§12、D-30）。
 *
 * 【なぜ】Worker との間で structured clone できるよう、関数やクラスのインスタンスを含まない
 * 素のオブジェクトと配列だけで作る。版番号は含めない（state 側が持つ。D-17）。
 */

import type { GraphSnapshot } from '../graph';

// 【TS】`as const` の配列から、要素の共用体型を作る定石。値（配列）と型（共用体）を 1 か所で定義でき、
//       「一覧」と「型」の食い違いを防げる。`(typeof X)[number]` は「配列の要素の型」。
/** ノードごとの指標の ID（FR-MT-01）。 */
export const NODE_METRIC_IDS = [
  'degree',
  'weightedDegree',
  'betweenness',
  'closeness',
  'pagerank',
  'eigenvector',
  'kCore',
  'clustering',
] as const;
/**
 * ノードごとの指標の ID（`NODE_METRIC_IDS` の要素の共用体型）。
 *
 * 指標ごとに値の形が違う（`NodeMetricValues` で ID から引く）。
 */
export type NodeMetricId = (typeof NODE_METRIC_IDS)[number];

/** 全体の指標の ID（FR-MT-02）。 */
export const GLOBAL_METRIC_IDS = [
  'nodeCount',
  'edgeCount',
  'density',
  'averageDegree',
  'components',
  'transitivity',
  'reciprocity',
] as const;
/**
 * 全体の指標の ID（`GLOBAL_METRIC_IDS` の要素の共用体型）。
 *
 * 値はすべて数値（`MetricOutcome<number>`）。
 */
export type GlobalMetricId = (typeof GLOBAL_METRIC_IDS)[number];

/**
 * 計算の要求。省略した項目は「すべて」。
 */
export interface MetricsRequest {
  /** 計算するノードごとの指標。省略するとすべて。 */
  readonly nodeMetrics?: readonly NodeMetricId[];
  /** 計算する全体の指標。省略するとすべて。 */
  readonly globalMetrics?: readonly GlobalMetricId[];
}

/**
 * Worker への仕事 1 件（設計書 §7.3、D-17）。グラフは `toSnapshot` の結果で渡す。
 *
 * 版番号は含めない（state 側が持つ）。
 */
export interface MetricsJob {
  readonly snapshot: GraphSnapshot;
  readonly request: MetricsRequest;
}

/** 失敗の理由の種類。画面で言語ごとの文言に直すためのコード。 */
export type MetricFailureCode =
  /** その種類のグラフには定義されない（例: 無向グラフの相互性）。 */
  | 'notApplicable'
  /** グラフが小さすぎるなどで、値が定まらない（例: エッジが 0 本の相互性）。 */
  | 'notDefined'
  /** 反復計算が収束しなかった。 */
  | 'noConvergence'
  /** 想定外の例外。 */
  | 'unexpected';

// 【TS】判別共用体。`ok` の値（true / false）で形が決まる。`if (r.ok)` の分岐の中では、
//       TypeScript が `r.value` を安全に読めると理解し、else の側では `r.code` が読める。
/**
 * 指標 1 つの計算結果。成功か、理由つきの失敗（設計書 §12。1 つの失敗で全体を止めない）。
 */
export type MetricOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: MetricFailureCode; readonly message: string };

/**
 * 次数と重み付き次数の列。配列はすべて `MetricsResult.nodeIds` と同じ順。
 *
 * 数え方（networkx に合わせる。D-30）: 無向の自己ループは 2 と数える。
 * 有向の `total` は `in + out`（自己ループは入と出に 1 ずつ）。
 */
export interface DegreeColumns {
  readonly total: readonly number[];
  /** 有向（混在を含む）のときだけ。 */
  readonly in?: readonly number[];
  /** 有向（混在を含む）のときだけ。 */
  readonly out?: readonly number[];
}

/**
 * 近接中心性の列。
 *
 * 有向では `value` は「他の点から自分への」距離に基づく値（入。networkx の既定と同じ）で、
 * `outgoing` が「自分から他の点への」値。非連結では Wasserman-Faust の補正を掛ける。
 */
export interface ClosenessColumns {
  readonly value: readonly number[];
  readonly outgoing?: readonly number[];
}

/**
 * 固有ベクトル中心性の列。有向（混在を含む）は HITS で代える（D-30）。
 *
 * - 'eigenvector': 無向グラフの固有ベクトル中心性（L2 正規化）。
 * - 'hits': 有向グラフのハブと権威（それぞれ総和 1）。
 */
export type EigenvectorColumns =
  | { readonly kind: 'eigenvector'; readonly value: readonly number[] }
  | {
      readonly kind: 'hits';
      readonly hubs: readonly number[];
      readonly authorities: readonly number[];
    };

/** ノードごとの指標の値の型。 */
export interface NodeMetricValues {
  readonly degree: DegreeColumns;
  readonly weightedDegree: DegreeColumns;
  readonly betweenness: readonly number[];
  readonly closeness: ClosenessColumns;
  readonly pagerank: readonly number[];
  readonly eigenvector: EigenvectorColumns;
  readonly kCore: readonly number[];
  readonly clustering: readonly number[];
}

/** グラフの向きの種類。混在は有向と無向のエッジが両方ある場合。 */
export type GraphKind = 'directed' | 'undirected' | 'mixed';

/**
 * 計算結果につく注意（FR-MT-05、D-30）。画面が言語ごとの文言に直して表示する。
 *
 * - 'mixedAsBidirectional': 混在グラフ（`options.type` が mixed。表示中に有向エッジがなくても）で、
 *   無向エッジを両向きの 2 本の有向エッジとみなして計算した。同じ 2 点間の無向と有向のエッジは 1 本の弧に
 *   まとめ、重みを足している（例: 無向 a-b が 1、有向 a→b が 2 なら、弧 a→b は 3、弧 b→a は 1）。
 * - 'directedAsUndirected': 有向（混在を含む）なのに、向きを無視した無向グラフで計算した指標がある。
 * - 'multipleNodeTypes': ノード型が 2 種類以上ある。中心性、クラスタ係数、密度、推移性は、
 *   1 種類のノードを前提とする。
 */
export interface MetricsNote {
  readonly code: 'mixedAsBidirectional' | 'directedAsUndirected' | 'multipleNodeTypes';
  /** 影響を受ける指標。`mixedAsBidirectional` は向きを使う指標すべてなので空にする。 */
  readonly nodeMetrics: readonly NodeMetricId[];
  readonly globalMetrics: readonly GlobalMetricId[];
}

/**
 * 指標の計算結果。
 */
export interface MetricsResult {
  readonly kind: GraphKind;
  /** ノード ID の並び。ノードごとの指標の配列は、この順に並ぶ。 */
  readonly nodeIds: readonly string[];
  // 【TS】`{ [K in NodeMetricId]?: ... }` は「写像型（mapped type）」。キーの共用体を 1 つずつ回して、
  //       キーごとに値の型を変えられる（`NodeMetricValues[K]` で対応する型を引く）。
  //       要求した指標だけが入るので、`?`（省略可能）を付ける。
  readonly node: { readonly [K in NodeMetricId]?: MetricOutcome<NodeMetricValues[K]> };
  readonly global: Readonly<Partial<Record<GlobalMetricId, MetricOutcome<number>>>>;
  readonly notes: readonly MetricsNote[];
}
