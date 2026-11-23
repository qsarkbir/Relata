/**
 * 地理座標の配置（FR-VG-02）。利用者が選んだ緯度・経度の属性を、メルカトル図法で平面に写す。
 *
 * 規約:
 * - 値の検査: 緯度・経度の値は、有限の数（または 10 進の数として読める文字列。アラビア・インド数字、
 *   ペルシア数字、「٫」、「−」も可。'0x21' は不可）の 1 つの値だけを使う。要素 1 つの配列は可。
 *   2 つ以上の複数値、欠損、数でない文字列、真偽値は「座標なし」。緯度は ±85.0511（メルカトルの正方形の
 *   範囲。極に近いと無限大に発散する）、経度は ±180 を超えたら範囲外で「座標なし」。
 *   緯度か経度のどちらか一方でも使えなければ、そのノードは座標なし。
 * - 座標なしのノードは図から消さず、地図の右側の「座標なし」の列にまとめる（件数を返す）。
 *   ID の昇順に、地図の高さに合わせて複数列に折り返す。座標のあるノードが 1 つも無ければ x = 0 から置く。
 * - 縮尺: 座標のある点の外接矩形の長辺を 40·√V に拡大する（縦横比は保つ）。1 点だけなら既定の縮尺。
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
import { parseDecimal } from '../text/numeric';

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
/** 座標のある点が 1 つだけ（または全点が同じ座標）のときの、度あたりの長さ（画面の単位）。0 除算を避ける。 */
const DEFAULT_UNIT_PER_DEGREE = 5;
/** 外接矩形の長辺の目標の長さは `MAP_SIZE_FACTOR * √V`（V はノード数）。 */
const MAP_SIZE_FACTOR = 40;
/** 外接矩形の長辺がこれ以下（度。メルカトルの単位）なら、全点が同一とみなす。 */
const SAME_POINT_EPSILON = 1e-9;
/**
 * 座標なしの列の行の間隔と列の間隔、地図との余白。
 * 【なぜ】ノードの直径の最大は 32（半径 16。D-23 の既定の上限）。それより広く取り、重ならないようにする。
 */
const ROW_GAP = 40;
const COLUMN_GAP = 48;
const COLUMN_MARGIN = 120;
/** 地図が低くても、座標なしの列の行数をこれだけは確保する（1 列に長く並べないため）。 */
const MIN_ROWS = 8;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 属性 1 つの値を数にする。使えなければ null。
 *
 * 要素 1 つの配列（複数値の属性で値が 1 つだけ）は、その要素を使う。2 つ以上は使えない。
 * 文字列は `parseDecimal`（10 進の表記だけ。アラビア・インド数字やペルシア数字も可。'0x21' は不可）で読む。
 *
 * @param attrs - ノードの属性
 * @param key - 属性のキー
 * @returns 有限の数、または null
 */
export function numericValue(attrs: Attrs, key: string): number | null {
  const a = getAttr(attrs, key);
  if (a?.kind !== 'value') return null;
  // 【TS】`Array.isArray` は型ガード。true の分岐では a.value が配列として扱える。
  const v: unknown = Array.isArray(a.value)
    ? a.value.length === 1
      ? a.value[0]
      : undefined
    : a.value;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return parseDecimal(v);
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
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
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
 * メルカトル図法で緯度・経度を平面に写す（縮尺は度 = 1 の単位）。北が上（y が小さい）になる画面の向き。
 *
 * @param point - 緯度・経度（度）。検査済みであること
 * @returns 度を単位とした座標（拡大は `geoLayout` が行う）
 */
export function mercator(point: LatLon): { x: number; y: number } {
  const phi = (point.lat * Math.PI) / 180;
  // 【なぜ】ln tan(π/4 + φ/2) と同じ値だが、atanh(sin φ) の形なら赤道（φ = 0）がちょうど 0 になる。
  const y = Math.atanh(Math.sin(phi)) * (180 / Math.PI);
  // 【なぜ】-0 を 0 にする（赤道で y = -0 になり、保存や比較で紛らわしいため）。
  return { x: point.lon, y: -y + 0 };
}

/**
 * 地理座標の配置を計算する。
 *
 * 手順: (1) 検査済みの点をメルカトルで写し、外接矩形を求める。(2) 外接矩形の長辺が
 * `40·√V`（V はノード数）になるよう、縦横比を保って一様に拡大する（地域のデータでも点が重ならず、
 * 世界のデータでも座標なしの列が地図を押しつぶさない）。点が 1 つだけ、または全点が同じ座標なら、
 * 既定の拡大率を使う。(3) 座標なしのノードを ID の昇順に、地図の高さに合わせた行数の列へ折り返して、
 * 地図の右に置く（列は縦に地図の中央に合わせる）。
 *
 * @param inputs - 地理座標の入力（グラフのすべてのノードについて）
 * @returns 座標と、座標なしの件数
 */
export function geoLayout(inputs: readonly GeoInput[]): {
  coordinates: Map<string, { x: number; y: number }>;
  noCoordinates: number;
} {
  const raw = new Map<string, { x: number; y: number }>();
  const missing: string[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const input of inputs) {
    // 【なぜ】Worker に届いた値は型を信じず、ここでも検査し直す。
    const point = input.point === null ? null : validGeoPoint(input.point.lat, input.point.lon);
    if (point === null) {
      missing.push(input.id);
      continue;
    }
    const p = mercator(point);
    raw.set(input.id, p);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const hasMap = raw.size > 0;
  const longSide = hasMap ? Math.max(maxX - minX, maxY - minY) : 0;
  const scale =
    longSide > SAME_POINT_EPSILON
      ? (MAP_SIZE_FACTOR * Math.sqrt(inputs.length)) / longSide
      : DEFAULT_UNIT_PER_DEGREE;
  const coordinates = new Map<string, { x: number; y: number }>();
  for (const [id, p] of raw) coordinates.set(id, { x: p.x * scale, y: p.y * scale });
  const mapRight = hasMap ? maxX * scale : 0;
  const mapHeight = hasMap ? (maxY - minY) * scale : 0;
  const centerY = hasMap ? ((minY + maxY) / 2) * scale : 0;
  const left = hasMap ? mapRight + COLUMN_MARGIN : 0;
  missing.sort(compare);
  const rows = Math.max(
    1,
    Math.min(missing.length, Math.max(MIN_ROWS, Math.floor(mapHeight / ROW_GAP) + 1)),
  );
  missing.forEach((id, i) => {
    const column = Math.floor(i / rows);
    const row = i % rows;
    // 最後の列は行数が少ないので、その列の行数で中央に揃える。
    const inColumn = Math.min(rows, missing.length - column * rows);
    coordinates.set(id, {
      x: left + column * COLUMN_GAP,
      y: centerY + (row - (inColumn - 1) / 2) * ROW_GAP,
    });
  });
  return { coordinates, noCoordinates: missing.length };
}
