/**
 * 地理座標の配置（FR-VG-02）。利用者が選んだ緯度・経度の属性を、メルカトル図法で平面に写す。
 *
 * 規約:
 * - 値の検査: 緯度・経度の値は、有限の数（または数として読める文字列）の 1 つの値だけを使う。
 *   複数値、欠損、数でない文字列、真偽値は「座標なし」。緯度は ±85.0511（メルカトルの正方形の
 *   範囲。極に近いと無限大に発散する）、経度は ±180 を超えたら範囲外で「座標なし」。
 *   緯度か経度のどちらか一方でも使えなければ、そのノードは座標なし。
 * - 座標なしのノードは図から消さず、地図の右側の「座標なし」の列にまとめる（件数を返す）。
 *   ID の昇順に縦に並べる。座標のあるノードが 1 つも無ければ、列だけが x = 0 に置かれる。
 * - 緯度経度の組が同じノードは同じ座標に重なる（同じ地名の人物など。ずらさない。決定的にするため）。
 * - 有向・無向は区別しない（座標は属性だけで決まる）。
 * - 歴史研究の注意: 古い地名の現在の座標は推定を含む。この配置は属性の値を信じて写すだけで、
 *   地名の同定はしない。
 *
 * 出典: Snyder (1987), "Map Projections: A Working Manual", USGS Professional Paper 1395
 * （メルカトル図法: y = ln tan(π/4 + φ/2)）。
 * 計算量: O(V log V)（座標なしの列の整列）。
 */
import { getAttr, type Attrs } from '../model';

/** 緯度（度）と経度（度）。 */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}
/** 1 ノードの地理座標の入力。`point` が null なら座標なし。 */
export interface GeoInput {
  readonly id: string;
  readonly point: LatLon | null;
}

/** メルカトルで扱える緯度の限界（度）。世界を正方形に収める値。 */
export const MAX_MERCATOR_LAT = 85.0511287798;
/** 経度 1 度あたりの長さ（画面の単位）。 */
const UNIT_PER_DEGREE = 5;
/** 座標なしの列と地図の間、行の間隔。 */
const COLUMN_MARGIN = 120;
const ROW_GAP = 28;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 属性 1 つの値を数にする。使えなければ null。
 *
 * @param attrs - ノードの属性
 * @param key - 属性のキー
 * @returns 有限の数、または null
 */
export function numericValue(attrs: Attrs, key: string): number | null {
  const a = getAttr(attrs, key);
  if (a?.kind !== 'value' || Array.isArray(a.value)) return null;
  const v: unknown = a.value;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * 緯度・経度の組が使えるか検査して、使えるなら点にする。
 *
 * @param lat - 緯度（度）
 * @param lon - 経度（度）
 * @returns 点、範囲外・非数なら null
 */
export function validGeoPoint(lat: number | null, lon: number | null): LatLon | null {
  if (lat === null || lon === null) return null;
  if (Math.abs(lat) > MAX_MERCATOR_LAT || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/**
 * ノードの属性から、地理座標の入力を作る（メインスレッドでも Worker でも使える純粋な関数）。
 *
 * @param nodes - ノード（ID と属性）
 * @param latKey - 緯度の属性のキー
 * @param lonKey - 経度の属性のキー
 * @returns ノードごとの入力（入力の順）
 */
export function extractGeoInputs(
  nodes: readonly { readonly id: string; readonly attrs: Attrs }[],
  latKey: string,
  lonKey: string,
): GeoInput[] {
  return nodes.map((n) => ({
    id: n.id,
    point: validGeoPoint(numericValue(n.attrs, latKey), numericValue(n.attrs, lonKey)),
  }));
}

/**
 * 座標なしのノードの件数。
 *
 * @param inputs - 地理座標の入力
 * @returns `point` が null のノードの数
 */
export function countNoCoordinates(inputs: readonly GeoInput[]): number {
  return inputs.filter((i) => i.point === null).length;
}

/**
 * メルカトル図法で緯度・経度を平面に写す。北が上（y が小さい）になる画面の向き。
 *
 * @param point - 緯度・経度（度）。検査済みであること
 * @returns 画面の単位の座標
 */
export function mercator(point: LatLon): { x: number; y: number } {
  const phi = (point.lat * Math.PI) / 180;
  // 【なぜ】ln tan(π/4 + φ/2) と同じ値だが、atanh(sin φ) の形なら赤道（φ = 0）がちょうど 0 になる。
  const y = Math.atanh(Math.sin(phi)) * (180 / Math.PI);
  // 【なぜ】-0 を 0 にする（赤道で y = -0 になり、保存や比較で紛らわしいため）。
  return { x: point.lon * UNIT_PER_DEGREE, y: -y * UNIT_PER_DEGREE + 0 };
}

/**
 * 地理座標の配置を計算する。
 *
 * 手順: (1) 検査済みの点をメルカトルで写す。(2) 地図の右端に余白を取り、座標なしのノードを
 * ID の昇順に 1 列に並べる（縦は地図の中央に合わせる）。
 *
 * @param inputs - 地理座標の入力（グラフのすべてのノードについて）
 * @returns 座標と、座標なしの件数
 */
export function geoLayout(inputs: readonly GeoInput[]): {
  coordinates: Map<string, { x: number; y: number }>;
  noCoordinates: number;
} {
  const coordinates = new Map<string, { x: number; y: number }>();
  const missing: string[] = [];
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const input of inputs) {
    if (input.point === null) {
      missing.push(input.id);
      continue;
    }
    const p = mercator(input.point);
    coordinates.set(input.id, p);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const hasMap = coordinates.size > 0;
  const columnX = hasMap ? maxX + COLUMN_MARGIN : 0;
  const centerY = hasMap ? (minY + maxY) / 2 : 0;
  missing.sort(compare);
  missing.forEach((id, i) => {
    coordinates.set(id, { x: columnX, y: centerY + (i - (missing.length - 1) / 2) * ROW_GAP });
  });
  return { coordinates, noCoordinates: missing.length };
}
