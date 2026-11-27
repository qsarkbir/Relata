/**
 * 地図に載るノードと載らないノードの仕分け（FR-MP-05、D-60）。
 *
 * 計算は `core/geo` の `geoSourceTypes` と `nodeGeo` を呼ぶだけで、ここで座標の読み方を書き直さない。
 * 対象は「絞り込み後に表示中のノード」（射影後のグラフにいるノード）。集計は、絞り込み後の集合から毎回
 * 数え直す（差分で更新しない。CLAUDE.md）。結果はストアに入れず、`Dataset`、グラフ、出どころから導き出す。
 */
import type { RelataGraph } from '../core/graph';
import { geoSourceTypes, nodeGeo, GEO_NONE_REASONS } from '../core/geo';
import type { GeoBBox, GeoNoneReason, GeoSource } from '../core/geo';
import type { Dataset, NodeId } from '../core/model';

/** 座標のあるノード 1 つ。 */
export interface PlacedNode {
  readonly id: NodeId;
  readonly lat: number;
  readonly lon: number;
}

/** 座標のないノード 1 つと、その理由。 */
export interface UnplacedNode {
  readonly id: NodeId;
  readonly label: string;
  readonly reason: GeoNoneReason;
}

/** 地図に載るもの・載らないものの仕分けの結果。 */
export interface MapPlacement {
  /** 座標のあるノード（データの並び順）。 */
  readonly placed: readonly PlacedNode[];
  /** 座標のないノード（データの並び順）。 */
  readonly unplaced: readonly UnplacedNode[];
  /** 理由ごとの件数。理由は `GEO_NONE_REASONS` の順で、0 件の理由も持つ。 */
  readonly counts: Readonly<Record<GeoNoneReason, number>>;
  /**
   * 片端か両端が座標なしのノードにつながるため、地図に描けないエッジの本数（表示中のエッジから数える）。
   * 【なぜ】座標のない端を持つエッジは描けない。黙って消さず、件数で示す（FR-MP-05）。
   */
  readonly edgesWithoutCoordinates: number;
  /** 表示中のエッジの本数。 */
  readonly edgeTotal: number;
  /** 座標のあるノードを収める範囲（無ければ null）。経度 180° をまたぐ分布は、全体を囲む単純な範囲にする。 */
  readonly bbox: GeoBBox | null;
}

/**
 * 表示中のノードを、地図に載るものと載らないものに分ける。
 *
 * 計算量: O(V + E)（V は表示中のノード数、E は表示中のエッジ数）。型の判定のためにデータ全体を 1 回なめる。
 *
 * @param dataset - 元のデータ
 * @param graph - 表示中のグラフ（絞り込み・射影後）
 * @param source - 座標の出どころ
 * @returns 仕分けの結果
 */
export function placeNodes(dataset: Dataset, graph: RelataGraph, source: GeoSource): MapPlacement {
  // 【なぜ】型単位の判定（`coverage`）は、データ全体で決める。絞り込みで一部の人物が消えても、
  //   「その型に座標の列があるか」の答えが変わらないようにするため（D-21 と同じ考え方）。
  const coverage = geoSourceTypes(dataset, source);
  const placed: PlacedNode[] = [];
  const unplaced: UnplacedNode[] = [];
  const counts: Record<GeoNoneReason, number> = {
    'no-column': 0,
    missing: 0,
    invalid: 0,
    'out-of-range': 0,
  };
  const placedIds = new Set<string>();
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const n of dataset.nodes) {
    if (!graph.hasNode(n.id)) continue;
    const r = nodeGeo(n, source, coverage);
    if (r.kind === 'point') {
      placed.push({ id: n.id, lat: r.lat, lon: r.lon });
      placedIds.add(n.id);
      west = Math.min(west, r.lon);
      east = Math.max(east, r.lon);
      south = Math.min(south, r.lat);
      north = Math.max(north, r.lat);
    } else {
      unplaced.push({ id: n.id, label: n.label, reason: r.reason });
      counts[r.reason] += 1;
    }
  }
  let edgeTotal = 0;
  let edgesWithoutCoordinates = 0;
  graph.forEachEdge((_edge, _attrs, source_, target) => {
    edgeTotal += 1;
    if (!placedIds.has(source_) || !placedIds.has(target)) edgesWithoutCoordinates += 1;
  });
  return {
    placed,
    unplaced,
    counts,
    edgesWithoutCoordinates,
    edgeTotal,
    bbox: placed.length === 0 ? null : { west, south, east, north },
  };
}

/** 理由の並び（画面の一覧の順）。 */
export const UNPLACED_REASONS = GEO_NONE_REASONS;
