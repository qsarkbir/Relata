import { describe, expect, it } from 'vitest';
import type { TimelineBin } from '../../core/filter';
import { bandIndexes, binIndexAt, tickIndexes } from './timelineLayout';

const bin = (i: number): TimelineBin => ({
  startYear: i * 10,
  earliest: i * 100,
  latest: i * 100 + 99,
  count: 0,
  contained: 0,
  total: 0,
});
const bins = [0, 1, 2, 3, 4].map(bin);

describe('FR-FL-11: 年表の座標と区切りの対応', () => {
  it('FR-FL-11: 位置から区切りの番号を求め、範囲の外は端に寄せる', () => {
    expect(binIndexAt(0, 100, 5)).toBe(0);
    expect(binIndexAt(39, 100, 5)).toBe(1);
    expect(binIndexAt(40, 100, 5)).toBe(2);
    expect(binIndexAt(-30, 100, 5)).toBe(0);
    expect(binIndexAt(500, 100, 5)).toBe(4);
    expect(binIndexAt(10, 0, 5)).toBe(0);
  });
  it('FR-TM-01: 目盛りは最小の間隔を保ち、先頭を含む', () => {
    expect(tickIndexes(10, 100, 5)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tickIndexes(100, 200, 50)).toEqual([0, 25, 50, 75]);
    expect(tickIndexes(0, 100, 50)).toEqual([]);
  });
  it('FR-FL-11: 適用中の範囲が覆う区切りを返し、開いた端は年表の端まで', () => {
    expect(bandIndexes(bins, 150, 320)).toEqual({ first: 1, last: 3 });
    expect(bandIndexes(bins, undefined, 120)).toEqual({ first: 0, last: 1 });
    expect(bandIndexes(bins, 250, undefined)).toEqual({ first: 2, last: 4 });
    expect(bandIndexes(bins, 1000, 2000)).toBeNull();
    expect(bandIndexes(bins, -500, -100)).toBeNull();
    expect(bandIndexes([], 0, 1)).toBeNull();
  });
});
