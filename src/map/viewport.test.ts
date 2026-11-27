import { describe, expect, it } from 'vitest';
import { MAX_GEO_LAT } from '../core/geo';
import {
  cameraToViewport,
  clampViewport,
  fitViewport,
  sameViewport,
  viewportToCamera,
  wrapLongitude,
  WORLD_BBOX,
} from './viewport';

describe('FR-MP-01: 表示範囲の変換', () => {
  it('FR-MP-01: 表示範囲とカメラは往復で元に戻る', () => {
    const v = { lon: 44.4, lat: 33.3, zoom: 6.5 };
    expect(cameraToViewport(viewportToCamera(v))).toEqual(v);
  });

  it('FR-MP-01: 経度は [-180, 180) に折り返す', () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-190)).toBe(170);
    expect(wrapLongitude(180)).toBe(-180);
    expect(wrapLongitude(45)).toBe(45);
  });

  it('FR-MP-01: 緯度・ズームは範囲に収め、数でない値は 0 に倒す', () => {
    expect(clampViewport({ lon: 0, lat: 90, zoom: 30 })).toEqual({
      lon: 0,
      lat: MAX_GEO_LAT,
      zoom: 19,
    });
    expect(clampViewport({ lon: 0, lat: -90, zoom: -3 })).toEqual({
      lon: 0,
      lat: -MAX_GEO_LAT,
      zoom: 0,
    });
    expect(clampViewport({ lon: Number.NaN, lat: Number.NaN, zoom: Number.NaN })).toEqual({
      lon: 0,
      lat: 0,
      zoom: 0,
    });
  });

  it('FR-MP-01: 同じ表示範囲かを、小さな差を許して比べる', () => {
    expect(sameViewport({ lon: 1, lat: 2, zoom: 3 }, { lon: 1 + 1e-9, lat: 2, zoom: 3 })).toBe(
      true,
    );
    expect(sameViewport({ lon: 1, lat: 2, zoom: 3 }, { lon: 1.001, lat: 2, zoom: 3 })).toBe(false);
  });
});

describe('FR-MP-01: 範囲に合わせる（fitBounds の計算）', () => {
  const size = { width: 1000, height: 600, padding: 0 };

  it('FR-MP-01: 世界全体は、幅が収まるズームになる（幅 1024 px でズーム 1）', () => {
    const v = fitViewport(WORLD_BBOX, { width: 1024, height: 4000, padding: 0 });
    expect(v.zoom).toBeCloseTo(1, 6);
    expect(v.lon).toBeCloseTo(0, 6);
    expect(v.lat).toBeCloseTo(0, 6);
  });

  it('FR-MP-01: 範囲の中心を中心にし、範囲がちょうど枠に収まる', () => {
    const bbox = { west: 40, south: 30, east: 50, north: 36 };
    const v = fitViewport(bbox, size);
    expect(v.lon).toBeCloseTo(45, 6);
    // 緯度の中心はメルカトルの中点なので、単純な平均（33）よりわずかに北になる。
    expect(v.lat).toBeGreaterThan(33);
    expect(v.lat).toBeLessThan(33.2);
    // 経度 10° の幅 = 世界の 1/36。1000 px に収まる最大のズーム: log2(1000 / (512/36))。
    const zx = Math.log2(1000 / (512 / 36));
    expect(v.zoom).toBeLessThanOrEqual(zx + 1e-9);
  });

  it('FR-MP-01: 余白の分だけ、ズームが下がる', () => {
    const bbox = { west: 40, south: 30, east: 50, north: 36 };
    const a = fitViewport(bbox, { ...size, padding: 0 });
    const b = fitViewport(bbox, { ...size, padding: 100 });
    expect(b.zoom).toBeLessThan(a.zoom);
  });

  it('FR-MP-01: 点（幅も高さも 0）は、その点を中心に上限のズーム', () => {
    const v = fitViewport({ west: 44, south: 33, east: 44, north: 33 }, { ...size, maxZoom: 10 });
    expect(v.zoom).toBe(10);
    expect(v.lon).toBeCloseTo(44, 6);
    expect(v.lat).toBeCloseTo(33, 6);
  });

  it('FR-MP-01: 既定のズームの上限は 12。それより狭い範囲でも寄りすぎない', () => {
    const v = fitViewport({ west: 44, south: 33, east: 44.0001, north: 33.0001 }, size);
    expect(v.zoom).toBe(12);
  });

  it('FR-MP-01: 180° をまたぐ範囲は、日付変更線をまたいだ区間として扱う', () => {
    // 西 170°、東 -170°（幅 20°）。中心は 180°（= -180°）。
    const v = fitViewport({ west: 170, south: -10, east: -170, north: 10 }, size);
    expect(Math.abs(v.lon)).toBeCloseTo(180, 6);
    // 幅 20° なので、反対側を回る 340° の範囲ではなく、狭い範囲に合わせたズーム。
    expect(v.zoom).toBeGreaterThan(3);
  });

  it('FR-MP-01: 枠が小さくて余白が大きくても、ズームは範囲内に収まる', () => {
    const v = fitViewport(WORLD_BBOX, { width: 10, height: 10, padding: 40 });
    expect(v.zoom).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v.zoom)).toBe(true);
  });
});
