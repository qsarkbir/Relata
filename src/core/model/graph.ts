/**
 * グラフの型。ノード、エッジ、属性の定義、データセット全体（FR-DM-01〜08）。
 */
import type { Attrs } from './attrs';
import type { GeoValue } from './geo';
import type { EdgeId, NodeId, NodeTypeId } from './ids';
import type { TimeValue } from './time';
import type { Certainty } from './values';

/** ノード図形の種類。 */
export type NodeShape = 'circle' | 'square' | 'triangle' | 'diamond';

/** ノード型の図形の一覧。 */
export const NODE_SHAPES = [
  'circle',
  'square',
  'triangle',
  'diamond',
] as const satisfies readonly NodeShape[];

/** ノード型（k-partite の「部」）。 */
export interface NodeType {
  readonly id: NodeTypeId;
  readonly label: string;
  readonly color?: string;
  readonly shape?: NodeShape;
}

/**
 * ノード。同名異人でも、ID が違えば別のノード（FR-DM-01）。
 *
 * 【なぜ】DOM の `Node` と取り違えないよう GraphNode とする（D-19）。
 */
export interface GraphNode {
  readonly id: NodeId;
  readonly type: NodeTypeId;
  readonly label: string;
  readonly attrs: Attrs;
  readonly geo?: GeoValue;
  readonly time?: TimeValue;
  /**
   * 存在そのものの確からしさ（D-37、FR-DM-06）。無ければ「指定なし」。
   * 歴史資料では「この人物は実在したか」「この人物とこの人物は同一か」が不確かなことがある。
   */
  readonly certainty?: Certainty;
}

/** エッジ。自己ループも多重エッジも許す（FR-DM-08）。 */
export interface GraphEdge {
  /** 多重エッジを区別するため、エッジにも ID を持たせる（FR-DM-08）。 */
  readonly id: EdgeId;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly directed: boolean;
  readonly relation?: string;
  /** 既定 1。有限で 0 以上。 */
  readonly weight: number;
  readonly time?: TimeValue;
  /**
   * 関係そのものの確からしさ（D-37、FR-DM-06）。無ければ「指定なし」。
   * 史料に「おそらく師弟関係にあった」などと書かれる場合に使う。
   */
  readonly certainty?: Certainty;
  readonly attrs: Attrs;
}

/** 属性の値の型。 */
export type ValueType = 'string' | 'number' | 'date' | 'boolean' | 'category';

/** 取りうる属性の値の型の一覧。 */
export const VALUE_TYPES = [
  'string',
  'number',
  'date',
  'boolean',
  'category',
] as const satisfies readonly ValueType[];

/** 属性の定義。 */
export interface AttributeDef {
  readonly key: string;
  readonly label: string;
  readonly appliesTo: 'node' | 'edge';
  /** 特定のノード型だけが持つ属性。他の型のノードはこのキーを持たない（D-19）。 */
  readonly nodeType?: NodeTypeId;
  readonly valueType: ValueType;
  /** 複数値の区切り（FR-DM-07）。あれば配列の値を許す。 */
  readonly multi?: { readonly separator: string };
}

/** グラフの向きの扱い（FR-DM-03）。 */
export type GraphMode = 'directed' | 'undirected' | 'mixed';

/** 取りうるグラフの向きの扱いの一覧。 */
export const GRAPH_MODES = [
  'directed',
  'undirected',
  'mixed',
] as const satisfies readonly GraphMode[];

/**
 * データセット全体。不変（readonly）として扱い、変えるときは新しいオブジェクトを作る。
 *
 * `graphMode` が `directed` なら全エッジの `directed` は true、`undirected` なら false。
 * `mixed` のときだけエッジごとに異なる。
 */
export interface Dataset {
  readonly graphMode: GraphMode;
  readonly nodeTypes: readonly NodeType[];
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly schema: readonly AttributeDef[];
  // 【なぜ】欠損の記号の対応表（FR-IN-07）は読み込みの設定なので、ここには置かない
  //       （プロジェクトファイルの importSettings。D-18、D-19、T1-08）。
  readonly meta: { readonly title: string; readonly source?: string };
}
