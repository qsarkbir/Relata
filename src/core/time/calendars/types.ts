/**
 * 暦の共通の型（設計書 §5.1、D-29）。
 *
 * 暦ごとに「暦の日付 → JDN」「JDN → 暦の日付」を持ち、解析（parse.ts）は暦の違いを
 * この型の裏に隠して扱う。フェーズ 4 でユリウス暦などを足すときも、この型を実装するだけでよい。
 */
import type { CalendarId, DayNumber } from '../../model';

/**
 * 暦の日付。年は天文学的な数え方（紀元前 1 年 ＝ 0 年、紀元前 2 年 ＝ -1 年）。
 */
// 【TS】`readonly` の項目は、作ったあとで書き換えられない。日付を値として安全に受け渡すため。
export interface CalendarDate {
  readonly year: number;
  /** 1 から始まる月 */
  readonly month: number;
  /** 1 から始まる日 */
  readonly day: number;
}

/**
 * 1 つの暦の換算の関数をまとめたもの。すべて副作用のない純粋関数。
 */
export interface CalendarSystem {
  readonly id: CalendarId;
  /** 1 年の月数（グレゴリオ暦もヒジュラ暦も 12） */
  readonly monthsPerYear: number;
  /** 閏年か。年が整数でなければ RangeError。 */
  isLeapYear(year: number): boolean;
  /** その月の日数。年が整数でないか、月が 1〜monthsPerYear の外なら RangeError。 */
  monthLength(year: number, month: number): number;
  /** 暦の日付 → JDN。日付が存在するかは検査しない（isValidDate を使う）。 */
  toJdn(year: number, month: number, day: number): DayNumber;
  /** JDN → 暦の日付。 */
  fromJdn(jdn: DayNumber): CalendarDate;
}

/**
 * 年が整数であることを確かめる。整数でなければ RangeError を投げる。
 *
 * @param year - 年
 * @param calendar - 暦の名前（誤りの文に入れる）
 * @throws RangeError 年が整数でない（NaN、Infinity、小数）とき
 */
// 【なぜ】閏年の式は剰余で書いているので、NaN や小数を渡すと例外も出さずに false を返す。
//       「閏年でない」と区別がつかず、誤りが黙って先へ流れるため、入り口で止める。
export function assertIntegerYear(year: number, calendar: string): void {
  if (!Number.isInteger(year)) {
    throw new RangeError(`${calendar}の年は整数です: ${String(year)}`);
  }
}

/**
 * 日付が実在するかを判定する。
 *
 * @param cal - 暦
 * @param year - 年（天文学的な数え方）
 * @param month - 月
 * @param day - 日
 * @returns 年が整数で、月が 1〜12、日が 1〜その月の日数なら true
 */
export function isValidDate(
  cal: CalendarSystem,
  year: number,
  month: number,
  day: number,
): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (month < 1 || month > cal.monthsPerYear) return false;
  return day >= 1 && day <= cal.monthLength(year, month);
}

/**
 * 切り捨て除算（負の数でも -∞ 方向に丸める）。
 *
 * @param a - 割られる数
 * @param b - 割る数
 * @returns floor(a / b)
 *
 * 【なぜ】Reingold & Dershowitz の算法は floor（-∞ 方向）を前提にしている。JavaScript の
 * `Math.trunc` は 0 方向に丸め、`%` の余りは負の数で負になるので、紀元前（負の数）で 1 日ずれる。
 * `/` は小数を返すので、整数にするには floor が要る。
 */
export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/**
 * 常に 0 以上の剰余（`a - b * floor(a / b)`）。JavaScript の `%` は負の数で負になる。
 *
 * @param a - 割られる数
 * @param b - 割る数（正）
 * @returns 0 以上 b 未満の剰余
 */
export function mod(a: number, b: number): number {
  return a - b * Math.floor(a / b);
}
