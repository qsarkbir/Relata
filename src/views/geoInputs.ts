import { extractGeoInputs, type GeoInput } from '../core/layout';
import type { RelataGraph } from '../core/graph';
import type { Dataset } from '../core/model';
import type { GraphViewSettings } from '../core/project';

/**
 * 表示中のノードの、地理座標の入力を作る（FR-VG-02）。属性が未選択なら全ノードが座標なし。
 *
 * @param dataset - 元のデータ
 * @param graph - 表示中のグラフ（射影・絞り込み後）
 * @param geoAttrs - 緯度・経度の属性のキー
 * @returns ノードごとの入力
 */
export function geoInputsFor(
  dataset: Dataset,
  graph: RelataGraph,
  geoAttrs: GraphViewSettings['geoAttrs'],
): GeoInput[] {
  const shown = dataset.nodes.filter((n) => graph.hasNode(n.id));
  if (geoAttrs === undefined) return shown.map((n) => ({ id: n.id, point: null }));
  return extractGeoInputs(shown, geoAttrs.lat, geoAttrs.lon);
}
