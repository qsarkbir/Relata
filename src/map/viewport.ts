/**
 * 表示範囲（`MapViewport`）と MapLibre・deck.gl のカメラの相互の変換、範囲に合わせる計算（FR-MP-01）。
 *
 * 純粋な関数だけ。ズームは MapLibre と deck.gl が共通に使う値（ズーム 0 で世界の幅が 512 px）。
 * 【なぜ】OSM の「ズーム 19」（256 px のタイルの番号）とは 1 つずれる（同じ見え方が MapLibre では 1 小さい）。
 * 保存する `MapViewport.zoom` は、deck.gl の描画と同じ値でそろえたほうが、ノードの座標変換で混乱しない。
 */
import { MAX_GEO_LAT, MAX_GEO_LON, type GeoBBox } from '../core/geo';
import type { MapViewport } from '../core/project/mapView';
import { MAP_MAX_ZOOM, MAP_MIN_ZOOM, type ZoomRange } from './background';

/** ズーム 0 のときの世界の幅（px）。 */
export const WORLD_SIZE_AT_ZOOM_0 = 512;

/** MapLibre に渡すカメラ（中心の [経度, 緯度] とズーム）。 */
export interface MapCamera {
  // 【なぜ】MapLibre の型（LngLatLike）は読み取り専用でない組を求めるので、readonly にしない。
  center: [number, number];
  zoom: number;
}

/**
 * 経度を [-180, 180) に折り返す。
 *
 * @param lon - 経度（度）
 * @returns 折り返した経度
 */
export function wrapLongitude(lon: number): number {
  // 【なぜ】範囲内の値はそのまま返す（折り返しの計算で浮動小数点の誤差が入り、往復で値が変わるのを避ける）。
  if (lon >= -180 && lon < 180) return lon;
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * 表示範囲を、使える範囲に収める。経度は折り返し、緯度は Web メルカトルの限界、ズームは範囲に丸める。
 *
 * @param v - 表示範囲
 * @param range - ズームの範囲（既定は `MAP_MIN_ZOOM`〜`MAP_MAX_ZOOM`）
 * @returns 収めた表示範囲。数でない値（NaN など）は 0 に倒す
 */
export function clampViewport(
  v: MapViewport,
  range: ZoomRange = { min: MAP_MIN_ZOOM, max: MAP_MAX_ZOOM },
): MapViewport {
  const fin = (n: number): number => (Number.isFinite(n) ? n : 0);
  return {
    lon: wrapLongitude(fin(v.lon)),
    lat: Math.min(MAX_GEO_LAT, Math.max(-MAX_GEO_LAT, fin(v.lat))),
    zoom: Math.min(range.max, Math.max(range.min, fin(v.zoom))),
  };
}

/**
 * 表示範囲を MapLibre のカメラに変換する。
 *
 * @param v - 表示範囲
 * @returns カメラ
 */
export function viewportToCamera(v: MapViewport): MapCamera {
  return { center: [v.lon, v.lat], zoom: v.zoom };
}

/**
 * MapLibre のカメラを表示範囲に変換する。経度は [-180, 180) に折り返す。
 *
 * @param camera - 中心とズーム
 * @returns 表示範囲
 */
export function cameraToViewport(camera: MapCamera): MapViewport {
  return { lon: wrapLongitude(camera.center[0]), lat: camera.center[1], zoom: camera.zoom };
}

/**
 * 同じ表示範囲か（描き直しを避けるための比較）。
 *
 * @param a - 表示範囲
 * @param b - 表示範囲
 * @param epsilon - 許す差（既定は 1e-7。経緯度 1 万分の 1 mm 未満、ズーム 1e-7）
 * @returns 同じなら true
 */
export function sameViewport(a: MapViewport, b: MapViewport, epsilon = 1e-7): boolean {
  return (
    Math.abs(a.lon - b.lon) < epsilon &&
    Math.abs(a.lat - b.lat) < epsilon &&
    Math.abs(a.zoom - b.zoom) < epsilon
  );
}

// 緯度から、メルカトルの y（0〜1。北が 0）。
function mercatorY(lat: number): number {
  const clamped = Math.min(MAX_GEO_LAT, Math.max(-MAX_GEO_LAT, lat));
  const rad = (clamped * Math.PI) / 180;
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI);
}

// メルカトルの y から緯度。
function latitudeOfY(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** 範囲に合わせるときの設定。 */
export interface FitOptions {
  /** 地図の枠の幅（px）。 */
  readonly width: number;
  /** 地図の枠の高さ（px）。 */
  readonly height: number;
  /** 範囲の周りの余白（px。既定 40）。 */
  readonly padding?: number;
  /** ズームの上限。点が 1 つのときや極端に狭い範囲で寄りすぎないため（既定 12）。 */
  readonly maxZoom?: number;
  /** ズームの範囲（既定は地図全体の範囲）。 */
  readonly range?: ZoomRange;
}

/**
 * 緯度経度の範囲がちょうど収まる表示範囲を求める（「全体を表示」と初めて開いたときの表示。FR-MP-01）。
 *
 * 経度 180°をまたぐ範囲（`west > east`）も扱う。点（幅も高さも 0）は、中心をその点にして上限のズームにする。
 * 平面のメルカトル投影で、`幅 px / (512 × 2^ズーム)` が範囲の幅（0〜1）に収まる最大のズームを選ぶ。
 * 計算量は O(1)。
 *
 * 【なぜ】MapLibre の `cameraForBounds` を使わず自前で計算する。WebGL の無い単体テストで確かめられ、
 * 画面の大きさがまだ 0 のとき（隠れたタブ）も、呼び出す側が決めた大きさで計算できるため。
 *
 * @param bbox - 緯度経度の範囲
 * @param options - 枠の大きさ、余白、上限
 * @returns 表示範囲
 */
export function fitViewport(bbox: GeoBBox, options: FitOptions): MapViewport {
  const padding = options.padding ?? 40;
  const range = options.range ?? { min: MAP_MIN_ZOOM, max: MAP_MAX_ZOOM };
  const maxZoom = Math.min(options.maxZoom ?? 12, range.max);
  // 経度 180°をまたぐ範囲は、東端に 360 を足して連続した区間にする。
  const east = bbox.west > bbox.east ? bbox.east + 360 : bbox.east;
  const dx = (east - bbox.west) / 360;
  const yNorth = mercatorY(bbox.north);
  const ySouth = mercatorY(bbox.south);
  const dy = Math.abs(ySouth - yNorth);
  const availW = Math.max(1, options.width - 2 * padding);
  const availH = Math.max(1, options.height - 2 * padding);
  // 範囲が 0 の向きは、その向きで決まるズームを無限大として、他方に任せる。
  const zx = dx > 0 ? Math.log2(availW / (WORLD_SIZE_AT_ZOOM_0 * dx)) : Number.POSITIVE_INFINITY;
  const zy = dy > 0 ? Math.log2(availH / (WORLD_SIZE_AT_ZOOM_0 * dy)) : Number.POSITIVE_INFINITY;
  const zoom = Math.min(range.max, Math.max(range.min, Math.min(zx, zy, maxZoom)));
  return {
    lon: wrapLongitude((bbox.west + east) / 2),
    lat: latitudeOfY((yNorth + ySouth) / 2),
    zoom,
  };
}

/** 地図全体を収めるときの範囲。 */
export const WORLD_BBOX: GeoBBox = {
  west: -MAX_GEO_LON,
  south: -MAX_GEO_LAT,
  east: MAX_GEO_LON,
  north: MAX_GEO_LAT,
};
