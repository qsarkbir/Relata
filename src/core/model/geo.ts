/**
 * 地点の型。
 */
import type { Missing } from './values';

/** 地点（十進数の度。緯度 -90〜90、経度 -180〜180）。 */
export interface GeoPoint {
  readonly kind: 'point';
  readonly lat: number;
  readonly lon: number;
}

/**
 * ノードの `geo` の型。
 *
 * 【なぜ】`undefined`（項目が無い）は「このデータには地点の列が無い」、`Missing` は
 * 「列はあるが値が空（記載なし、亡失など）」を表す（D-18）。
 */
export type GeoValue = GeoPoint | Missing;
