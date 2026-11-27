import type { GeoInput } from '../core/layout';
import type { RelataGraph } from '../core/graph';
import { geoSourceTypes, nodeGeo } from '../core/geo';
import type { GeoSource } from '../core/geo';
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
// 【TS】`GraphViewSettings['geoAttrs']` は「型 GraphViewSettings の geoAttrs 項目の型」を取り出す添字アクセス型。
//       項目の型を書き写さずに済み、元の型が変われば自動で追随する（任意の項目なので `| undefined` を含む）。
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
 * 地理座標の配置の画面（緯度・経度の選択欄）に出す、選択中の属性の組。
 *
 * 【なぜ】座標の出どころ（`view.geoSource`）が地図と共通の設定で、選択欄はその `attrs` を編集する。
 * 出どころが明示されていれば、それが優先する（`attrs` ならその組、`geo` なら「選んでいない」）。
 * 無ければ、旧版の `view.graph.geoAttrs`（片方だけの選択も保てる）を見る（D-46）。
 *
 * @param geoSource - 保存された出どころ（無ければ undefined）
 * @param geoAttrs - `view.graph.geoAttrs`
 * @returns 選択欄に出す緯度・経度のキー
 */
export function effectiveGeoAttrs(
  geoSource: GeoSource | undefined,
  geoAttrs: GraphViewSettings['geoAttrs'],
): GraphViewSettings['geoAttrs'] {
  if (geoSource === undefined) return geoAttrs;
  return geoSource.kind === 'attrs' ? { lat: geoSource.lat, lon: geoSource.lon } : undefined;
}

/** 地理座標の配置を計算できる状態か。 */
export type GeoLayoutState =
  /** 計算できる。 */
  | 'ready'
  /** 選ぶ必要がある（座標を 1 つも取り出せない、または緯度・経度の片方だけを選んでいる）。 */
  | 'choose'
  /** 保存された出どころが、今のデータに無い属性を指している。 */
  | 'not-found';

/**
 * 地理座標の配置を計算してよいかを判定する（FR-VG-02、D-46）。計算しない間は、前の配置を上書きしない。
 *
 * 順に見る: (1) データに無い属性を指していれば `not-found`。(2) 属性の組を片方だけ選んでいる間は `choose`
 * （選び終わるまで待つ。選択欄の表示と、配置に使う出どころを食い違わせない）。(3) 出どころの種類を問わず、
 * 座標を 1 つも取り出せなければ `choose`。
 *
 * @param dataset - 元のデータ
 * @param source - 座標の出どころ（読み替え後）
 * @param selected - 選択欄に出す属性の組（`effectiveGeoAttrs` の結果）
 * @returns 状態
 */
export function geoLayoutState(
  dataset: Dataset,
  source: GeoSource,
  selected: GraphViewSettings['geoAttrs'],
): GeoLayoutState {
  if (resolveGeoSelection(dataset, selected).missing) return 'not-found';
  const half =
    selected !== undefined && (selected.lat === undefined) !== (selected.lon === undefined);
  if (source.kind === 'geo' && half) return 'choose';
  return geoSourceTypes(dataset, source).size === 0 ? 'choose' : 'ready';
}

/**
 * 表示中のノードの、地理座標の入力を作る（FR-VG-02）。座標は地図と同じ出どころ・同じ関数（core の `nodeGeo`）で取り出す。
 * 座標の取り出せないノードは `point: null`（座標なしの列に置く）。
 *
 * @param dataset - 元のデータ
 * @param graph - 表示中のグラフ（射影・絞り込み後）
 * @param source - 座標の出どころ
 * @returns ノードごとの入力
 */
export function geoInputsFor(dataset: Dataset, graph: RelataGraph, source: GeoSource): GeoInput[] {
  const coverage = geoSourceTypes(dataset, source);
  return dataset.nodes
    .filter((n) => graph.hasNode(n.id))
    .map((n) => {
      const r = nodeGeo(n, source, coverage);
      return { id: n.id, point: r.kind === 'point' ? { lat: r.lat, lon: r.lon } : null };
    });
}
