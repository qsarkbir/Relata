import { extractGeoInputs, type GeoInput } from '../core/layout';
import type { RelataGraph } from '../core/graph';
import type { AttributeDef, Dataset } from '../core/model';
import type { GraphViewSettings } from '../core/project';

/**
 * 緯度・経度に選べるノードの属性（日付と真偽値は除く。数値の属性を先に並べる）。
 *
 * 【なぜ】緯度・経度は数値の列のことが多いが、文字列として読み込まれた列（"33.3"）も使える。
 *
 * @param dataset - 元のデータ
 * @returns 候補の属性
 */
export function geoCandidates(dataset: Dataset): AttributeDef[] {
  // 【なぜ】属性の定義はノードの型ごとに同じキーで置ける（例: 人物と都市の両方に「緯度」）。
  //       緯度・経度はキーで指定するので、キーごとに 1 つにまとめる（最初の定義を代表にする）。
  //       まとめないと、選択肢が重複し、React の `key` も衝突する。
  const byKey = new Map<string, AttributeDef>();
  for (const a of dataset.schema) {
    if (a.appliesTo !== 'node' || a.valueType === 'date' || a.valueType === 'boolean') continue;
    if (!byKey.has(a.key)) byKey.set(a.key, a);
  }
  return [...byKey.values()].sort(
    (a, b) => Number(b.valueType === 'number') - Number(a.valueType === 'number'),
  );
}

/** 緯度・経度の選択の状態。 */
export interface GeoSelection {
  /** 候補にある緯度のキー（無い・未選択なら undefined）。 */
  readonly lat: string | undefined;
  readonly lon: string | undefined;
  /** 保存された指定が、データに無い属性を指している。 */
  readonly missing: boolean;
}

/**
 * 保存された緯度・経度の指定を、今のデータの候補と照らす。
 *
 * 【なぜ】候補に無いキーは未選択として扱い、画面の選択欄（候補に無い値は表示できない）と状態を一致させる。
 *
 * @param dataset - 元のデータ
 * @param geoAttrs - 保存された指定
 * @returns 有効な指定と、データに無い属性があったか
 */
export function resolveGeoSelection(
  dataset: Dataset,
  geoAttrs: GraphViewSettings['geoAttrs'],
): GeoSelection {
  const keys = new Set(geoCandidates(dataset).map((a) => a.key));
  // 【TS】`Partial<T>` の項目は省略できる。ここでは緯度・経度のどちらか片方だけの指定も受ける。
  const pick = (key: string | undefined) => (key !== undefined && keys.has(key) ? key : undefined);
  const lat = pick(geoAttrs?.lat);
  const lon = pick(geoAttrs?.lon);
  const missing =
    (geoAttrs?.lat !== undefined && lat === undefined) ||
    (geoAttrs?.lon !== undefined && lon === undefined);
  return { lat, lon, missing };
}

/**
 * 表示中のノードの、地理座標の入力を作る（FR-VG-02）。緯度・経度の両方が選ばれていなければ全ノードが座標なし。
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
  const { lat, lon } = resolveGeoSelection(dataset, geoAttrs);
  if (lat === undefined || lon === undefined) return shown.map((n) => ({ id: n.id, point: null }));
  return extractGeoInputs(shown, lat, lon);
}
