/**
 * ヒジュラ暦（太陰暦）の計算上の暦（FR-TM-06、設計書 §5.1、D-29）。
 *
 * 30 年周期の「表の暦」（tabular Islamic calendar）。30 年のうち 11 年が閏年（12 月が 30 日）。
 * 紀元（1 年 1 月 1 日）はユリウス暦 622 年 7 月 16 日（金曜日）＝ JDN 1948440。convertdate と同じ。
 *
 * 出典: Reingold, E. M. & Dershowitz, N. (2018). *Calendrical Calculations: The Ultimate Edition*,
 * Cambridge University Press（`fixed-from-islamic`、`islamic-from-fixed`）。計算量はどちらも O(1)。
 *
 * 【歴史の事情】実際の暦は新月の観測で始まりが決まり、計算上の暦と 1〜2 日ずれることがある。
 * そのため、日付まで指定された値には幅を持たせる（parse.ts の hijriDayMargin）。
 */
import type { CalendarId, DayNumber } from '../../model';
import type { CalendarDate, CalendarSystem } from './types';
import { assertIntegerYear, floorDiv, mod } from './types';

/** ヒジュラ暦の紀元（1 年 1 月 1 日）の JDN。 */
export const HIJRI_EPOCH_JDN = 1948440;

/**
 * 閏年か。(14 + 11 × 年) を 30 で割った余りが 11 未満の年（負の年でも成り立つ）。
 *
 * @param year - ヒジュラ暦の年（整数）
 * @returns 閏年なら true
 * @throws RangeError 年が整数でない（NaN、Infinity、小数）とき
 */
export function isHijriLeapYear(year: number): boolean {
  assertIntegerYear(year, 'ヒジュラ暦');
  return mod(14 + 11 * year, 30) < 11;
}

/**
 * その月の日数。奇数月は 30 日、偶数月は 29 日、閏年の 12 月だけ 30 日。
 *
 * @param year - ヒジュラ暦の年（整数。でなければ RangeError）
 * @param month - 月（1〜12。外なら RangeError）
 * @returns 29 または 30
 */
export function hijriMonthLength(year: number, month: number): number {
  assertIntegerYear(year, 'ヒジュラ暦');
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`ヒジュラ暦の月は 1〜12 です: ${String(month)}`);
  }
  if (month % 2 === 1) return 30;
  return month === 12 && isHijriLeapYear(year) ? 30 : 29;
}

/**
 * ヒジュラ暦の日付 → JDN。
 *
 * @param year - ヒジュラ暦の年
 * @param month - 月（1〜12。9 がラマダーン）
 * @param day - 日
 * @returns JDN
 *
 * @example
 * ```ts
 * hijriToJdn(1, 1, 1); // 1948440
 * ```
 */
export function hijriToJdn(year: number, month: number, day: number): DayNumber {
  return (
    HIJRI_EPOCH_JDN +
    (day - 1) +
    29 * (month - 1) +
    floorDiv(6 * month - 1, 11) +
    354 * (year - 1) +
    floorDiv(3 + 11 * year, 30)
  );
}

/**
 * JDN → ヒジュラ暦の日付。
 *
 * 30 年周期（10631 日）から年を求め、年内の通し日から月を求める。
 *
 * @param jdn - JDN
 * @returns 暦の日付
 */
export function jdnToHijri(jdn: DayNumber): CalendarDate {
  const year = floorDiv(30 * (jdn - HIJRI_EPOCH_JDN) + 10646, 10631);
  const prior = jdn - hijriToJdn(year, 1, 1);
  const month = floorDiv(11 * prior + 330, 325);
  const day = jdn - hijriToJdn(year, month, 1) + 1;
  return { year, month, day };
}

/** ヒジュラ暦の換算をまとめたもの。 */
// 【TS】`as const` は値を読み取り専用のリテラル型にする。
export const HIJRI = {
  id: 'hijri' satisfies CalendarId,
  monthsPerYear: 12,
  isLeapYear: isHijriLeapYear,
  monthLength: hijriMonthLength,
  toJdn: hijriToJdn,
  fromJdn: jdnToHijri,
} as const satisfies CalendarSystem;
