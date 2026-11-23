import { describe, expect, it } from 'vitest';
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, pngSize } from './png';
import { withExtension } from './download';

describe('FR-OUT-03: PNG の大きさ', () => {
  it('倍率に従って画素数が決まる（1×、2×、4×）', () => {
    expect(pngSize(1000, 500, 1)).toEqual({ width: 1000, height: 500, scale: 1, clamped: false });
    expect(pngSize(1000, 500, 2)).toMatchObject({ width: 2000, height: 1000, scale: 2 });
    expect(pngSize(1000, 500, 4)).toMatchObject({ width: 4000, height: 2000, clamped: false });
  });
  it('小数の大きさは切り上げる（端が欠けない）', () => {
    expect(pngSize(100.2, 50.5, 2)).toMatchObject({ width: 201, height: 101 });
  });
  it('canvas の上限（辺と面積）を超えるときは倍率を下げ、clamped で知らせる', () => {
    const huge = pngSize(6000, 4000, 4);
    expect(huge.clamped).toBe(true);
    expect(huge.scale).toBeLessThan(4);
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    expect(huge.width / huge.height).toBeCloseTo(1.5, 2);
    const wide = pngSize(10000, 100, 4);
    expect(wide.width).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(wide.clamped).toBe(true);
  });
  it('大きさが 0 や負でも、1 画素以上にする', () => {
    expect(pngSize(0, -5, 2)).toMatchObject({ width: 2, height: 2 });
  });
  it('FR-OUT-01: ファイル名に拡張子を付ける（二重に付けない、空は既定の名前）', () => {
    expect(withExtension('図', 'png')).toBe('図.png');
    expect(withExtension('a.PNG', 'png')).toBe('a.PNG');
    expect(withExtension('  ', 'pdf')).toBe('relata.pdf');
  });
});
