import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 【なぜ】簡易背景の陸地データ（public/geo/land-50m.geojson）の形を検査する。
// 日付変更線をまたぐ島（ウランゲリ島など）の経度が -180 を下回った不具合の再発を防ぐ。
type Ring = [number, number][];
const geo: unknown = JSON.parse(
  readFileSync(new URL('../../public/geo/land-50m.geojson', import.meta.url), 'utf8'),
);

/**
 * MultiPolygon の環をすべて取り出す。形が想定と違えば例外にする。
 *
 * @param g - 読み込んだ GeoJSON
 * @returns すべての環（外周と穴）
 */
function rings(g: unknown): Ring[] {
  // 【TS】外から読んだ JSON は unknown で受け、必要な形だけを確かめて使う。
  const fc = g as { features: { geometry: { type: string; coordinates: Ring[][] } }[] };
  const geometry = fc.features[0]?.geometry;
  if (geometry?.type !== 'MultiPolygon') throw new Error('MultiPolygon ではない');
  return geometry.coordinates.flat();
}
const all = rings(geo);

describe('FR-MP-01: 簡易背景の陸地データ', () => {
  it('FR-MP-01: すべての座標が経度 [-180, 180]、緯度 [-90, 90] に入る', () => {
    for (const ring of all) {
      for (const [x, y] of ring) {
        expect(x).toBeGreaterThanOrEqual(-180);
        expect(x).toBeLessThanOrEqual(180);
        expect(y).toBeGreaterThanOrEqual(-90);
        expect(y).toBeLessThanOrEqual(90);
      }
    }
  });

  it('FR-MP-01: 各環は閉じていて 4 点以上ある', () => {
    for (const ring of all) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      expect(ring[0]).toEqual(ring[ring.length - 1]);
    }
  });

  it('FR-MP-01: 180 度をまたぐ島の両側がある（緯度 70〜72 度に +179 付近と -179 付近）', () => {
    const pts = all.flat().filter(([, y]) => y >= 70 && y <= 72);
    expect(pts.some(([x]) => x >= 178.5 && x <= 180)).toBe(true);
    expect(pts.some(([x]) => x >= -180 && x <= -178.5)).toBe(true);
  });

  it('FR-MP-01: 環の隣り合う 2 点の経度の差が 180 度を超えない（地図を横切る辺が無い）', () => {
    for (const ring of all) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1];
        const b = ring[i];
        if (!a || !b) continue;
        // 【なぜ】南極大陸の南端（緯度 -90）の辺だけは、東西の端を結ぶ意図した辺（メルカトルの範囲の外）。
        if (a[1] === -90 && b[1] === -90) continue;
        expect(Math.abs(b[0] - a[0])).toBeLessThanOrEqual(180);
      }
    }
  });
});
