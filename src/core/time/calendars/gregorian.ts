/**
 * グレゴリオ暦（FR-DM-05、設計書 §5.1）。1582 年より前にもさかのぼって適用する（先発グレゴリオ暦）。
 *
 * 出典: Reingold, E. M. & Dershowitz, N. (2018). *Calendrical Calculations: The Ultimate Edition*,
 * Cambridge University Press（`fixed-from-gregorian`、`gregorian-from-fixed`）。
 * どちらの換算も計算量は O(1)。
 *
 * 【歴史の事情】年は天文学的な数え方（紀元前 1 年 ＝ 0 年）。史料の「紀元前 44 年」は -43 年で持つ。
 * 歴史学の年号には 0 年が無いので、入力の解釈（parse.ts）でこの数え方に直す。
 * 【なぜ】0 年を持つ数え方にすると、年の差の計算に例外がいらないため。
 */
import type { CalendarId, DayNumber } from '../../model';
import type { CalendarDate, CalendarSystem } from './types';
import { assertIntegerYear, floorDiv, mod } from './types';

/**
 * R&D の「RD」（西暦 1 年 1 月 1 日 ＝ 1 の通し番号）を JDN にするための差。
 * RD 1 ＝ JDN 1721426 なので、JDN ＝ RD ＋ 1721425。
 */
const RD_TO_JDN = 1721425;

/**
 * 閏年か（4 で割れて、100 で割れない。ただし 400 で割れれば閏年）。
 *
 * @param year - 年（天文学的な数え方。整数）
 * @returns 閏年なら true
 * @throws RangeError 年が整数でない（NaN、Infinity、小数）とき
 */
export function isGregorianLeapYear(year: number): boolean {
  assertIntegerYear(year, 'グレゴリオ暦');
  return mod(year, 4) === 0 && (mod(year, 100) !== 0 || mod(year, 400) === 0);
}

/**
 * その月の日数。
 *
 * @param year - 年（整数。でなければ RangeError）
 * @param month - 月（1〜12。外なら RangeError）
 * @returns 28〜31
 */
export function gregorianMonthLength(year: number, month: number): number {
  assertIntegerYear(year, 'グレゴリオ暦');
  switch (month) {
    case 2:
      return isGregorianLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
    case 12:
      return 31;
    default:
      throw new RangeError(`グレゴリオ暦の月は 1〜12 です: ${String(month)}`);
  }
}

/**
 * R&D の fixed-from-gregorian。年月日 → RD。
 *
 * @param year - 年
 * @param month - 月
 * @param day - 日
 * @returns RD（西暦 1 年 1 月 1 日 ＝ 1）
 */
function fixedFromGregorian(year: number, month: number, day: number): number {
  const y = year - 1;
  // 3 月以降は、2 月の長さ（閏年 29 日、平年 28 日）の分だけ引く。
  const feb = month <= 2 ? 0 : isGregorianLeapYear(year) ? -1 : -2;
  return (
    365 * y +
    floorDiv(y, 4) -
    floorDiv(y, 100) +
    floorDiv(y, 400) +
    floorDiv(367 * month - 362, 12) +
    feb +
    day
  );
}

/**
 * グレゴリオ暦の日付 → JDN。
 *
 * @param year - 年（天文学的な数え方。紀元前 1 年 ＝ 0 年）
 * @param month - 月（1〜12）
 * @param day - 日
 * @returns JDN
 *
 * @example
 * ```ts
 * gregorianToJdn(2000, 1, 1); // 2451545
 * ```
 */
export function gregorianToJdn(year: number, month: number, day: number): DayNumber {
  return fixedFromGregorian(year, month, day) + RD_TO_JDN;
}

/**
 * JDN → グレゴリオ暦の日付。
 *
 * 400 年（146097 日）、100 年（36524 日）、4 年（1461 日）、1 年の周期で分けて年を求める。
 *
 * @param jdn - JDN
 * @returns 暦の日付（年は天文学的な数え方）
 */
export function jdnToGregorian(jdn: DayNumber): CalendarDate {
  const d0 = jdn - RD_TO_JDN - 1;
  const n400 = floorDiv(d0, 146097);
  const d1 = mod(d0, 146097);
  const n100 = floorDiv(d1, 36524);
  const d2 = mod(d1, 36524);
  const n4 = floorDiv(d2, 1461);
  const d3 = mod(d2, 1461);
  const n1 = floorDiv(d3, 365);
  const base = 400 * n400 + 100 * n100 + 4 * n4 + n1;
  // 【なぜ】400 年周期の最後の日（12 月 31 日）は n100 か n1 が 4 になる。その日は base 年に属する。
  const year = n100 === 4 || n1 === 4 ? base : base + 1;
  const prior = jdn - gregorianToJdn(year, 1, 1);
  const correction = jdn < gregorianToJdn(year, 3, 1) ? 0 : isGregorianLeapYear(year) ? 1 : 2;
  const month = floorDiv(12 * (prior + correction) + 373, 367);
  const day = jdn - gregorianToJdn(year, month, 1) + 1;
  return { year, month, day };
}

/** グレゴリオ暦の換算をまとめたもの。 */
// 【TS】`satisfies CalendarSystem` は、型に合っているかだけを検査し、値の型は狭いまま残す。
// 【TS】`as const` は値を読み取り専用のリテラル型にする（id が string ではなく 'gregorian' になる）。
export const GREGORIAN = {
  id: 'gregorian' satisfies CalendarId,
  monthsPerYear: 12,
  isLeapYear: isGregorianLeapYear,
  monthLength: gregorianMonthLength,
  toJdn: gregorianToJdn,
  fromJdn: jdnToGregorian,
} as const satisfies CalendarSystem;
