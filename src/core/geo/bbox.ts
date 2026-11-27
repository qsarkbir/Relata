/**
 * 地理範囲（緯度経度の矩形）と、その判定・説明（D-58、FR-MP-04）。
 */
import { MAX_GEO_LON } from './source';

// 【TS】`readonly` を付けた項目は、作った後に代入し直せない。範囲を不変の値として扱い（フィルタの状態に
//       入るので、書き換えず新しく作る。§6.3）、うっかりの書き換えをコンパイル時に防ぐ。
/**
 * 地理範囲。度の単位。範囲は両端を含む。
 *
 * 経度の −180 と +180 は同じ経線（日付変更線）を指す。範囲の判定は、−180 と +180 を別の値として
 * 比べる（`west: 170, east: 180` は 180 を含み、−180 は含まない）。地図でドラッグした範囲は、
 * 経度が ±180 の外（ワールドコピー）に出ることがあるので、T3-06 が `west`、`east` を −180〜180 に
 * 正規化してから、フィルタにする。
 *
 * - `west > east` は、経度 180°（日付変更線）をまたぐ範囲（東端から西へ回る。例: 西 170°、東 −170°）。
 * - `south > north` は逆転で、何も通さない（`parseFilterState` は失敗にする）。
 */
export interface GeoBBox {
  /** 西端の経度（度。−180〜180）。 */
  readonly west: number;
  /** 南端の緯度（度）。 */
  readonly south: number;
  /** 東端の経度（度。−180〜180）。 */
  readonly east: number;
  /** 北端の緯度（度）。 */
  readonly north: number;
}

/**
 * 範囲が 180° をまたぐか。
 *
 * @param bbox - 地理範囲
 * @returns `west > east` なら true
 */
export function crossesAntimeridian(bbox: GeoBBox): boolean {
  return bbox.west > bbox.east;
}

/**
 * 範囲が逆転している（南が北より北にある）か。逆転した範囲は何も通さない。
 *
 * @param bbox - 地理範囲
 * @returns `south > north` なら true
 */
export function isReversedBBox(bbox: GeoBBox): boolean {
  return bbox.south > bbox.north;
}

/**
 * 座標が範囲に入るか。両端を含む。
 *
 * 【なぜ】経度は、`west <= east` なら通常の区間、`west > east` なら「west 以上、または east 以下」
 * （180° をまたぐ区間）として比べる。逆転した範囲（`south > north`）には、何も入らない。
 *
 * @param bbox - 地理範囲
 * @param lat - 緯度（度）
 * @param lon - 経度（度）
 * @returns 入れば true
 */
export function bboxContains(bbox: GeoBBox, lat: number, lon: number): boolean {
  if (isReversedBBox(bbox)) return false;
  if (lat < bbox.south || lat > bbox.north) return false;
  return crossesAntimeridian(bbox)
    ? lon >= bbox.west || lon <= bbox.east
    : lon >= bbox.west && lon <= bbox.east;
}

/**
 * 範囲の値が検査を通るか（有限の数、経度 ±180、緯度 ±90 の内側）。
 *
 * 逆転（`south > north`）はここでは検査しない（`isReversedBBox` で別に扱う）。
 *
 * @param bbox - 地理範囲
 * @returns 範囲の値として正しければ true
 */
export function isValidBBoxValues(bbox: GeoBBox): boolean {
  return (
    [bbox.west, bbox.south, bbox.east, bbox.north].every((v) => Number.isFinite(v)) &&
    Math.abs(bbox.west) <= MAX_GEO_LON &&
    Math.abs(bbox.east) <= MAX_GEO_LON &&
    Math.abs(bbox.south) <= 90 &&
    Math.abs(bbox.north) <= 90
  );
}

// 【TS】`interface` は、オブジェクトの形を名前づけする。項目はすべて `readonly`（作った後は書き換えない）。
/** 適用中の `geo` フィルタの説明（文字にする前の構造）。文字にするのは ui。 */
export interface GeoBBoxDescription {
  /** 緯度の範囲（度）。`south`、`north` の順。 */
  readonly lat: { readonly south: number; readonly north: number };
  /** 経度の範囲（度）。`west > east` なら 180° をまたぐ（西から東へ、東回りに 180° を越える）。 */
  readonly lon: { readonly west: number; readonly east: number };
  /** 経度が 180° をまたぐ。 */
  readonly crossesAntimeridian: boolean;
  /** 緯度が逆転していて何も通らない。 */
  readonly reversed: boolean;
  /**
   * 経度の幅（度。0〜360）。またぐときは `east + 360 − west`。
   * 【なぜ】またぐ範囲を「西 170°〜東 −170°」と書くと、反対側の広い範囲と読み違えられやすいため、幅を添える。
   */
  readonly lonSpan: number;
}

/**
 * 範囲を、説明用の構造にする。
 *
 * 画面の文言は ui が作る。例: 「緯度 30〜36°、経度 −10〜0°」「緯度 −5〜10°、経度 170°〜−170°（180°をまたぐ）」。
 *
 * @param bbox - 地理範囲
 * @returns 説明の構造
 */
export function describeGeoBBox(bbox: GeoBBox): GeoBBoxDescription {
  const crosses = crossesAntimeridian(bbox);
  return {
    lat: { south: bbox.south, north: bbox.north },
    lon: { west: bbox.west, east: bbox.east },
    crossesAntimeridian: crosses,
    reversed: isReversedBBox(bbox),
    lonSpan: crosses ? bbox.east + 360 - bbox.west : bbox.east - bbox.west,
  };
}
