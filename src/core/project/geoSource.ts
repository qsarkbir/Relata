/**
 * 座標の出どころの保存（`view.geoSource`。D-46、R-25）。
 *
 * 地図とグラフの地理座標の配置で、同じ設定を使う。無ければ既定（ノードの `geo`）。
 * 旧版の `view.graph.geoAttrs`（属性の組）は、`resolveGeoSource` で読み替える。
 */
import { DEFAULT_GEO_SOURCE, parseGeoSourceValue, type GeoSource } from '../geo';
import type { ParseResult } from '../model';
import type { GraphViewSettings } from './graphView';

/**
 * JSON から座標の出どころを組み立てる。
 *
 * 【なぜ】任意の項目なので、形が正しくなければ失敗にして、呼ぶ側（io）が警告にして既定へ戻す（D-24）。
 *
 * @param x - 任意の入力
 * @returns 出どころ、または壊れた箇所
 */
export function parseGeoSource(x: unknown): ParseResult<GeoSource> {
  const s = parseGeoSourceValue(x);
  return s === null
    ? { ok: false, path: '', reason: '座標の出どころの設定が不正です' }
    : { ok: true, value: s };
}

/**
 * 保存された設定から、実際に使う座標の出どころを決める。
 *
 * 規則（D-46）:
 * 1. `view.geoSource` があれば、それを使う。
 * 2. 無く、`view.graph.geoAttrs` の `lat` と `lon` の**両方**があれば、`{ kind: 'attrs', lat, lon }` と読み替える
 *    （T2-03 で保存したファイルの、地理座標の配置の設定を引き継ぐため）。
 * 3. それ以外（`geoAttrs` が無い、または片方だけ）は既定の `{ kind: 'geo' }`。
 *
 * 片方だけ選んだ `geoAttrs` は、読み替えずにそのまま残す。T2-03 の画面は、片方だけ選んだ状態も保存でき、
 * 既存の挙動（残りの片方を選ぶまで座標なし）を変えないため。
 *
 * @param geoSource - `view.geoSource`（無ければ undefined）
 * @param graph - `view.graph`（無ければ undefined）。`geoAttrs` だけを見る
 * @returns 使う出どころ
 */
// 【TS】`Pick<T, 'a'>` は、型 T から項目 `a` だけを取り出した型。ここでは「`geoAttrs` だけを持つ」
//       ことだけを要求し、グラフの設定の全体（位置や色など）を渡さなくてよいようにする。
export function resolveGeoSource(
  geoSource: GeoSource | undefined,
  graph: Pick<GraphViewSettings, 'geoAttrs'> | undefined,
): GeoSource {
  if (geoSource !== undefined) return geoSource;
  const attrs = graph?.geoAttrs;
  if (attrs?.lat !== undefined && attrs.lon !== undefined)
    return { kind: 'attrs', lat: attrs.lat, lon: attrs.lon };
  return DEFAULT_GEO_SOURCE;
}
