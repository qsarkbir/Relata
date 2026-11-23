import { describe, expect, it } from 'vitest';
import { gregorianToJdn, hijriToJdn } from './calendars';
import {
  DEFAULT_TIME_BIN_WIDTH,
  TIME_BIN_WIDTHS,
  binCalendarOf,
  binDayRange,
  binStartYear,
  binsDayRange,
  isTimeBinWidth,
} from './bins';

describe('FR-TM-01: 年表の区切りの幅', () => {
  it('FR-TM-01: 幅は 1・10・25・100 年だけ（D-42）', () => {
    expect(TIME_BIN_WIDTHS).toEqual([1, 10, 25, 100]);
    expect(isTimeBinWidth(25)).toBe(true);
    expect(isTimeBinWidth(5)).toBe(false);
    expect(isTimeBinWidth('10')).toBe(false);
    expect(DEFAULT_TIME_BIN_WIDTH).toBe(10);
  });
  it('FR-TM-09: 区切りの暦は、ヒジュラ暦の表示だけヒジュラ暦。併記は西暦', () => {
    expect(binCalendarOf('gregorian')).toBe('gregorian');
    expect(binCalendarOf('hijri')).toBe('hijri');
    expect(binCalendarOf('both')).toBe('gregorian');
  });
});

describe('FR-TM-01: 区切りの始まりの年', () => {
  it('FR-TM-01: 西暦は幅の整数倍の年から始まる', () => {
    const j = gregorianToJdn(1507, 3, 1);
    expect(binStartYear(j, 'gregorian', 1)).toBe(1507);
    expect(binStartYear(j, 'gregorian', 10)).toBe(1500);
    expect(binStartYear(j, 'gregorian', 25)).toBe(1500);
    expect(binStartYear(gregorianToJdn(1526, 1, 1), 'gregorian', 25)).toBe(1525);
    expect(binStartYear(gregorianToJdn(1599, 12, 31), 'gregorian', 100)).toBe(1500);
    expect(binStartYear(gregorianToJdn(1600, 1, 1), 'gregorian', 100)).toBe(1600);
  });
  it('FR-TM-01: 年の境界は閏年でもずれない（12 月 31 日と 1 月 1 日）', () => {
    expect(binStartYear(gregorianToJdn(1999, 12, 31), 'gregorian', 10)).toBe(1990);
    expect(binStartYear(gregorianToJdn(2000, 1, 1), 'gregorian', 10)).toBe(2000);
    expect(binStartYear(gregorianToJdn(2000, 2, 29), 'gregorian', 1)).toBe(2000);
  });
  it('FR-TM-01: 紀元前は小さい側へ丸める（紀元前 44 年 = -43 年は -100 年の区切り）', () => {
    expect(binStartYear(gregorianToJdn(-43, 3, 15), 'gregorian', 100)).toBe(-100);
    expect(binStartYear(gregorianToJdn(0, 6, 1), 'gregorian', 10)).toBe(0);
    expect(binStartYear(gregorianToJdn(-1, 6, 1), 'gregorian', 10)).toBe(-10);
  });
  it('FR-TM-09: ヒジュラ暦の区切りは、ヒジュラ暦の年の整数倍', () => {
    expect(binStartYear(hijriToJdn(905, 9, 1), 'hijri', 10)).toBe(900);
    expect(binStartYear(hijriToJdn(1050, 1, 1), 'hijri', 100)).toBe(1000);
    // 西暦 1500 年はヒジュラ暦 905〜906 年。西暦の区切りとは別の区切りに入る。
    expect(binStartYear(gregorianToJdn(1500, 6, 1), 'hijri', 10)).toBe(900);
  });
});

describe('FR-TM-01: 区切りが覆う日の幅', () => {
  it('FR-TM-01: 西暦 10 年の区切りは、始まりの年の 1 月 1 日から最後の年の 12 月 31 日まで', () => {
    expect(binDayRange('gregorian', 1500, 10)).toEqual({
      earliest: gregorianToJdn(1500, 1, 1),
      latest: gregorianToJdn(1509, 12, 31),
    });
  });
  it('FR-TM-01: 隣り合う区切りは隙間も重なりもない', () => {
    const a = binDayRange('gregorian', 1500, 25);
    const b = binDayRange('gregorian', 1525, 25);
    expect(b.earliest).toBe(a.latest + 1);
    const h = binDayRange('hijri', 900, 10);
    expect(binDayRange('hijri', 910, 10).earliest).toBe(h.latest + 1);
  });
  it('FR-TM-01: 区切りの両端の日は、同じ区切りに入る', () => {
    const r = binDayRange('hijri', 900, 10);
    expect(binStartYear(r.earliest, 'hijri', 10)).toBe(900);
    expect(binStartYear(r.latest, 'hijri', 10)).toBe(900);
    expect(binStartYear(r.latest + 1, 'hijri', 10)).toBe(910);
  });
  it('FR-FL-11: 連続する区切りをまとめた幅は、先頭の初日から末尾の末日まで', () => {
    expect(binsDayRange('gregorian', 1500, 1520, 10)).toEqual({
      earliest: gregorianToJdn(1500, 1, 1),
      latest: gregorianToJdn(1529, 12, 31),
    });
  });
});
