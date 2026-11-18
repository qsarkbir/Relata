/**
 * 日付と期間の型（FR-DM-05）。暦の換算は `src/core/time/`（T1-02）が担当する。
 */
import type { FuzzyDate, Missing } from './values';

/** ユリウス通日（JDN）の整数。暦に依存しない日の通し番号（設計書 §5.1）。紀元前は小さな（または負の）値になる。 */
export type DayNumber = number;

/** 暦。フェーズ 4 で 'julian' | 'solar-hijri' | 'rumi' を足す。 */
export type CalendarId = 'gregorian' | 'hijri';

/** 取りうる暦の一覧。外から来た値の検査に使う。 */
export const CALENDAR_IDS = ['gregorian', 'hijri'] as const satisfies readonly CalendarId[];

/**
 * 期間。始点と終点がそれぞれ幅を持てる。
 *
 * - `end` が無い（undefined）: 1 点の日付。
 * - `end` が `Missing`: 終わりが分からない期間（「1650 年から」など。D-19）。
 */
// 【TS】項目の `readonly` は「作ったあとで代入できない」ことを型で示す（Dataset を不変に扱うため）。
export interface TimeSpan {
  readonly kind: 'span';
  readonly start: FuzzyDate;
  readonly end?: FuzzyDate | Missing;
}

/**
 * ノードやエッジの `time` の型。
 *
 * 【なぜ】`undefined`（項目が無い）は「このデータには時期の列が無い」、`Missing` は
 * 「列はあるが値が空」を表す（D-18）。欠損を undefined で表さない規約と両立させる。
 */
export type TimeValue = TimeSpan | Missing;
