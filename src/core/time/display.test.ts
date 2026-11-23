import { describe, expect, it } from 'vitest';
import { gregorianToJdn, hijriToJdn, yearRange, HIJRI, GREGORIAN } from './calendars';
import {
  calendarsOf,
  describeDay,
  describeDayRange,
  inferPrecision,
  inputCalendarOf,
  isCalendarDisplay,
  jdnToParts,
} from './display';
import { parseDate } from './parse';

describe('FR-TM-09: 表示の暦の選択', () => {
  it('FR-TM-09: both は西暦、ヒジュラ暦の順', () => {
    expect(calendarsOf('both')).toEqual(['gregorian', 'hijri']);
    expect(calendarsOf('hijri')).toEqual(['hijri']);
  });
  it('FR-TM-09: 型ガードは未知の値を拒む', () => {
    expect(isCalendarDisplay('both')).toBe(true);
    expect(isCalendarDisplay('julian')).toBe(false);
    expect(isCalendarDisplay(undefined)).toBe(false);
  });
  it('FR-TM-09: 印なしの入力は、ヒジュラ暦表示のときだけヒジュラ暦で読む', () => {
    expect(inputCalendarOf('hijri')).toBe('hijri');
    expect(inputCalendarOf('both')).toBe('gregorian');
  });
});

describe('FR-TM-09: JDN を部品にする', () => {
  it('FR-TM-09: 精度ごとに持つ項目が変わる', () => {
    const j = gregorianToJdn(1640, 4, 23);
    expect(jdnToParts(j, 'gregorian', 'year')).toEqual({
      calendar: 'gregorian',
      era: 'common',
      year: 1640,
    });
    expect(jdnToParts(j, 'gregorian', 'month')).toEqual({
      calendar: 'gregorian',
      era: 'common',
      year: 1640,
      month: 4,
    });
    expect(jdnToParts(j, 'gregorian')).toEqual({
      calendar: 'gregorian',
      era: 'common',
      year: 1640,
      month: 4,
      day: 23,
    });
  });
  it('FR-TM-09: 1640-04-23 はヒジュラ暦 1050 年', () => {
    expect(jdnToParts(gregorianToJdn(1640, 4, 23), 'hijri', 'year').year).toBe(1050);
  });
  it('FR-TM-09: 紀元前は 0 年を 1 BCE、-43 年を 44 BCE にする', () => {
    expect(jdnToParts(gregorianToJdn(0, 3, 1), 'gregorian', 'year')).toMatchObject({
      era: 'before',
      year: 1,
    });
    expect(jdnToParts(gregorianToJdn(-43, 3, 15), 'gregorian')).toMatchObject({
      era: 'before',
      year: 44,
      month: 3,
      day: 15,
    });
  });
  it('FR-TM-09: ヒジュラ暦の年の初め・終わりの日は年をまたがない', () => {
    const first = hijriToJdn(1050, 1, 1);
    const last = hijriToJdn(1050, 12, HIJRI.monthLength(1050, 12));
    expect(jdnToParts(first, 'hijri')).toMatchObject({ year: 1050, month: 1, day: 1 });
    expect(jdnToParts(last, 'hijri')).toMatchObject({ year: 1050, month: 12 });
    expect(jdnToParts(last + 1, 'hijri')).toMatchObject({ year: 1051, month: 1, day: 1 });
    expect(jdnToParts(first - 1, 'hijri').year).toBe(1049);
  });
  it('FR-TM-09: ヒジュラ暦 1 年 1 月 1 日の前日は紀元前側（0 年）になる', () => {
    expect(jdnToParts(hijriToJdn(1, 1, 1) - 1, 'hijri', 'year')).toEqual({
      calendar: 'hijri',
      era: 'before',
      year: 1,
    });
  });
  it('FR-TM-09: 整数でない JDN は RangeError', () => {
    expect(() => jdnToParts(1.5, 'gregorian')).toThrow(RangeError);
  });
});

describe('FR-TM-09: 幅の精度の推測と範囲の表示', () => {
  it('FR-TM-09: 年全体の幅は年精度、月全体は月精度、それ以外は日精度', () => {
    expect(inferPrecision(yearRange(GREGORIAN, 1500), 'gregorian')).toBe('year');
    expect(
      inferPrecision(
        { earliest: gregorianToJdn(1500, 3, 1), latest: gregorianToJdn(1500, 3, 31) },
        'gregorian',
      ),
    ).toBe('month');
    expect(
      inferPrecision(
        { earliest: gregorianToJdn(1500, 3, 15), latest: gregorianToJdn(1500, 3, 15) },
        'gregorian',
      ),
    ).toBe('day');
  });
  it('FR-TM-09: 複数年の幅（1500〜1510）は年精度の範囲', () => {
    const r = { earliest: gregorianToJdn(1500, 1, 1), latest: gregorianToJdn(1510, 12, 31) };
    const [g] = describeDayRange(r, 'gregorian');
    expect(g?.from).toMatchObject({ year: 1500 });
    expect(g?.to).toMatchObject({ year: 1510 });
    expect(g?.from.month).toBeUndefined();
  });
  it('FR-TM-09: 1050 AH は、ヒジュラ暦では 1 つの年、西暦では 2 年にまたがる範囲', () => {
    const p = parseDate('1050 AH');
    if (!p.ok) throw new Error('解析に失敗');
    const [h] = describeDayRange(p.value, 'hijri');
    expect(h).toEqual({
      calendar: 'hijri',
      from: { calendar: 'hijri', era: 'common', year: 1050 },
    });
    const [g] = describeDayRange(p.value, 'gregorian');
    expect(g?.from).toMatchObject({ year: 1640, month: 4, day: 23 });
    expect(g?.to).toMatchObject({ year: 1641, month: 4, day: 11 });
  });
  it('FR-TM-09: both は西暦とヒジュラ暦の 2 つを返す', () => {
    const r = describeDay(gregorianToJdn(1640, 4, 23), 'both');
    expect(r.map((x) => x.calendar)).toEqual(['gregorian', 'hijri']);
    expect(r[1]?.from).toMatchObject({ year: 1050 });
    expect(r[1]?.to).toBeUndefined();
  });
  it('FR-TM-09: 西暦 1 年はヒジュラ暦の連続する 2 つの年にまたがる', () => {
    for (const y of [1979, 1980, 1640]) {
      const [h] = describeDayRange(yearRange(GREGORIAN, y), 'hijri');
      expect(h?.to?.year).toBe((h?.from.year ?? 0) + 1);
    }
  });
});
