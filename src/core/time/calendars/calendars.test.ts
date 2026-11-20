import { describe, expect, it } from 'vitest';
import golden from '../fixtures/calendar-golden.json';
import {
  GREGORIAN,
  HIJRI,
  HIJRI_EPOCH_JDN,
  getCalendar,
  gregorianToJdn,
  hijriToJdn,
  isValidDate,
  jdnToGregorian,
  jdnToHijri,
  monthRange,
  shiftYears,
  yearRange,
} from './index';

// 正解値は convertdate（Python）で作ったもの。fixtures/generate_calendar_golden.py を参照。
type Row = readonly [number, number, number, number];

/**
 * JSON から読んだ行を、[JDN, 年, 月, 日] の 4 つの数に絞る型ガード。
 *
 * @param r - JSON の 1 行
 * @returns 4 つの数なら true
 */
function isRow(r: readonly number[]): r is readonly [number, number, number, number] {
  return r.length === 4;
}

/**
 * JSON の行の配列を検査して Row の配列にする（形が違えばテストを落とす）。
 *
 * @param rows - JSON の行
 * @returns Row の配列
 */
function toRows(rows: readonly (readonly number[])[]): Row[] {
  return rows.map((r) => {
    if (!isRow(r)) throw new Error(`正解値の行の形が違います: ${r.join(',')}`);
    return r;
  });
}
const gregRows = toRows(golden.gregorian);
const hijriRows = toRows(golden.hijri);

describe('グレゴリオ暦の換算', () => {
  it('FR-DM-05: 正解値のすべてで、暦の日付 → JDN と JDN → 暦の日付が一致する', () => {
    expect(gregRows.length).toBeGreaterThan(3000);
    for (const [jdn, y, m, d] of gregRows) {
      expect(gregorianToJdn(y, m, d)).toBe(jdn);
      expect(jdnToGregorian(jdn)).toEqual({ year: y, month: m, day: d });
    }
  });

  it('FR-DM-05: 紀元前 1 年 ＝ 0 年、2000-01-01 ＝ 2451545', () => {
    expect(gregorianToJdn(2000, 1, 1)).toBe(2451545);
    expect(gregorianToJdn(1, 1, 1)).toBe(1721426);
    expect(gregorianToJdn(0, 12, 31) + 1).toBe(gregorianToJdn(1, 1, 1));
    expect(jdnToGregorian(1721425)).toEqual({ year: 0, month: 12, day: 31 });
  });

  it('FR-DM-05: 閏年（100 の倍数は平年、400 の倍数は閏年、負の年も）', () => {
    expect(GREGORIAN.isLeapYear(1900)).toBe(false);
    expect(GREGORIAN.isLeapYear(2000)).toBe(true);
    expect(GREGORIAN.isLeapYear(0)).toBe(true);
    expect(GREGORIAN.isLeapYear(-100)).toBe(false);
    expect(GREGORIAN.monthLength(2000, 2)).toBe(29);
    expect(GREGORIAN.monthLength(1900, 2)).toBe(28);
    expect(GREGORIAN.monthLength(2001, 4)).toBe(30);
    expect(GREGORIAN.monthLength(2001, 12)).toBe(31);
    expect(() => GREGORIAN.monthLength(2001, 13)).toThrow(RangeError);
  });
});

describe('暦の年の検査', () => {
  // 【なぜ】閏年の式は剰余なので、整数でない年では黙って false になる。誤りとして止まることを確かめる。
  it.each([NaN, Infinity, -Infinity, 1640.5])(
    'FR-DM-05 / FR-TM-06: 年が整数でない（%s）と、閏年の判定と月の日数は RangeError',
    (year) => {
      expect(() => GREGORIAN.isLeapYear(year)).toThrow(RangeError);
      expect(() => HIJRI.isLeapYear(year)).toThrow(RangeError);
      expect(() => GREGORIAN.monthLength(year, 2)).toThrow(RangeError);
      expect(() => HIJRI.monthLength(year, 12)).toThrow(RangeError);
      // 閏年に関わらない月でも同じ
      expect(() => GREGORIAN.monthLength(year, 1)).toThrow(RangeError);
      expect(() => HIJRI.monthLength(year, 1)).toThrow(RangeError);
    },
  );
  it.each([NaN, Infinity, 2451545.5])(
    'FR-DM-05 / FR-TM-06: JDN が整数でない（%s）と、暦の日付への換算は RangeError',
    (jdn) => {
      expect(() => jdnToGregorian(jdn)).toThrow(RangeError);
      expect(() => jdnToHijri(jdn)).toThrow(RangeError);
      expect(() => shiftYears(GREGORIAN, jdn, 1)).toThrow(RangeError);
    },
  );
  it('FR-DM-05: 整数でない年でも、isValidDate は例外を投げず false を返す', () => {
    expect(isValidDate(GREGORIAN, 1640.5, 2, 29)).toBe(false);
    expect(isValidDate(HIJRI, NaN, 12, 30)).toBe(false);
  });
});

describe('ヒジュラ暦の紀元の前後（0 年以下）', () => {
  it('FR-TM-06: 0 年の最後の日（12 月 29 日。0 年は平年）の翌日が、紀元の 1 年 1 月 1 日', () => {
    expect(HIJRI.isLeapYear(0)).toBe(false);
    expect(HIJRI.monthLength(0, 12)).toBe(29);
    expect(hijriToJdn(0, 12, 29) + 1).toBe(HIJRI_EPOCH_JDN);
    expect(jdnToHijri(HIJRI_EPOCH_JDN - 1)).toEqual({ year: 0, month: 12, day: 29 });
  });
  it('FR-TM-06: -2 年 1 月 1 日から 2 年の終わりまで、1 日ずつ往復が一致し、日付が途切れない', () => {
    // 【なぜ】正解値（convertdate）は飛び飛びの日なので、紀元をまたぐ範囲は 1 日ずつも確かめる。
    const start = hijriToJdn(-2, 1, 1);
    const end = hijriToJdn(2, 12, HIJRI.monthLength(2, 12));
    let prev = jdnToHijri(start - 1);
    for (let jdn = start; jdn <= end; jdn++) {
      const d = jdnToHijri(jdn);
      expect(isValidDate(HIJRI, d.year, d.month, d.day)).toBe(true);
      expect(hijriToJdn(d.year, d.month, d.day)).toBe(jdn);
      // 前の日の翌日であること（日、月、年のどれかが 1 つ進む）
      const next =
        prev.day < HIJRI.monthLength(prev.year, prev.month)
          ? { year: prev.year, month: prev.month, day: prev.day + 1 }
          : prev.month < 12
            ? { year: prev.year, month: prev.month + 1, day: 1 }
            : { year: prev.year + 1, month: 1, day: 1 };
      expect(d).toEqual(next);
      prev = d;
    }
    // 5 年分（-2〜2 年）。閏年は -1 年と 2 年の 2 つ（(14 + 11 × 年) mod 30 < 11）。
    expect(end - start + 1).toBe(354 * 5 + 2);
  });
});

describe('ヒジュラ暦の換算', () => {
  it('FR-TM-06: 正解値のすべてで、暦の日付 → JDN と JDN → 暦の日付が一致する', () => {
    expect(hijriRows.length).toBeGreaterThan(3000);
    for (const [jdn, y, m, d] of hijriRows) {
      expect(hijriToJdn(y, m, d)).toBe(jdn);
      expect(jdnToHijri(jdn)).toEqual({ year: y, month: m, day: d });
    }
  });

  it('FR-TM-06: 紀元（1 年 1 月 1 日）は JDN 1948440、1050 年は 1640-04-23〜1641-04-11', () => {
    expect(hijriToJdn(1, 1, 1)).toBe(HIJRI_EPOCH_JDN);
    expect(jdnToGregorian(hijriToJdn(1050, 1, 1))).toEqual({ year: 1640, month: 4, day: 23 });
    expect(jdnToGregorian(hijriToJdn(1050, 12, 29))).toEqual({ year: 1641, month: 4, day: 11 });
  });

  it('FR-TM-06: 閏年と月の日数が convertdate と一致する', () => {
    const leap = new Set(golden.hijriLeapYears);
    for (let y = -50; y <= 100; y++) expect(HIJRI.isLeapYear(y)).toBe(leap.has(y));
    for (const [y = 0, m = 0, len] of golden.hijriMonthLengths) {
      expect(HIJRI.monthLength(y, m)).toBe(len);
    }
    expect(() => HIJRI.monthLength(1050, 0)).toThrow(RangeError);
  });
});

describe('暦の補助', () => {
  it('FR-DM-05: getCalendar は ID から暦を返す', () => {
    expect(getCalendar('gregorian')).toBe(GREGORIAN);
    expect(getCalendar('hijri')).toBe(HIJRI);
  });

  it('FR-DM-05: isValidDate は実在しない日付を退ける', () => {
    expect(isValidDate(GREGORIAN, 2000, 2, 29)).toBe(true);
    expect(isValidDate(GREGORIAN, 1900, 2, 29)).toBe(false);
    expect(isValidDate(GREGORIAN, 2000, 13, 1)).toBe(false);
    expect(isValidDate(GREGORIAN, 2000, 1, 1.5)).toBe(false);
    expect(isValidDate(HIJRI, 1049, 12, 30)).toBe(true);
    expect(isValidDate(HIJRI, 1050, 12, 30)).toBe(false);
  });

  it('FR-DM-05: yearRange、monthRange、shiftYears', () => {
    expect(yearRange(GREGORIAN, 1650)).toEqual({
      earliest: gregorianToJdn(1650, 1, 1),
      latest: gregorianToJdn(1650, 12, 31),
    });
    expect(monthRange(GREGORIAN, 1650, 2).latest).toBe(gregorianToJdn(1650, 2, 28));
    // 閏日は月末に寄せる
    expect(shiftYears(GREGORIAN, gregorianToJdn(2000, 2, 29), 1)).toBe(gregorianToJdn(2001, 2, 28));
    expect(shiftYears(HIJRI, hijriToJdn(1050, 5, 3), -5)).toBe(hijriToJdn(1045, 5, 3));
  });
});
