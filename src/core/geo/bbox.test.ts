import { describe, expect, it } from 'vitest';
import { bboxContains, describeGeoBBox, isReversedBBox, isValidBBoxValues } from './bbox';

const box = { west: -10, south: 30, east: 0, north: 36 };

describe('bboxContains（D-58、FR-MP-04）', () => {
  it('FR-MP-04: 両端を含む', () => {
    expect(bboxContains(box, 30, -10)).toBe(true);
    expect(bboxContains(box, 36, 0)).toBe(true);
    expect(bboxContains(box, 33, -5)).toBe(true);
    expect(bboxContains(box, 36.0001, -5)).toBe(false);
    expect(bboxContains(box, 29.9999, -5)).toBe(false);
    expect(bboxContains(box, 33, 0.0001)).toBe(false);
  });
  it('FR-MP-04: west > east は 180° をまたぐ範囲', () => {
    const across = { west: 170, south: -20, east: -170, north: -10 };
    expect(bboxContains(across, -15, 178)).toBe(true);
    expect(bboxContains(across, -15, -172)).toBe(true);
    expect(bboxContains(across, -15, 180)).toBe(true);
    expect(bboxContains(across, -15, 170)).toBe(true);
    expect(bboxContains(across, -15, -170)).toBe(true);
    expect(bboxContains(across, -15, 0)).toBe(false);
    expect(bboxContains(across, -15, 169.9)).toBe(false);
  });
  it('FR-MP-04: south > north は何も通さない', () => {
    const rev = { west: -10, south: 36, east: 0, north: 30 };
    expect(isReversedBBox(rev)).toBe(true);
    expect(bboxContains(rev, 33, -5)).toBe(false);
  });
  it('FR-MP-04: 範囲の値の検査', () => {
    expect(isValidBBoxValues(box)).toBe(true);
    expect(isValidBBoxValues({ ...box, west: -181 })).toBe(false);
    expect(isValidBBoxValues({ ...box, north: 91 })).toBe(false);
    expect(isValidBBoxValues({ ...box, east: Number.NaN })).toBe(false);
  });
});

describe('describeGeoBBox', () => {
  it('FR-FL-08: 通常の範囲は緯度・経度と幅を返す', () => {
    expect(describeGeoBBox(box)).toEqual({
      lat: { south: 30, north: 36 },
      lon: { west: -10, east: 0 },
      crossesAntimeridian: false,
      reversed: false,
      lonSpan: 10,
    });
  });
  it('FR-FL-08: 180° をまたぐときは、またぐ印と、またいだ幅を返す', () => {
    const d = describeGeoBBox({ west: 170, south: -20, east: -170, north: -10 });
    expect(d.crossesAntimeridian).toBe(true);
    expect(d.lonSpan).toBe(20);
  });
  it('FR-FL-08: 逆転を示す', () => {
    expect(describeGeoBBox({ west: 0, south: 5, east: 1, north: 4 }).reversed).toBe(true);
  });
});
