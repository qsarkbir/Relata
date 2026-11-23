/**
 * 年表の区切り（ビン）の算出（FR-TM-01、D-42）。
 *
 * 年表は、日付を「1 年・10 年・25 年・100 年」ごとの区切りに分けて件数を数える。後で欠損の
 * 「時期ごとの欠損率」（T2-04、FR-VG-12）も同じ区切りで数えるので、区切りの算出はこのファイルに
 * 独立した関数として置く。年表の集計（`core/filter/timeline.ts`）はここを呼ぶだけで、
 * 暦の換算を自前で書かない（設計書 §5.1）。
 *
 * 【なぜ】区切りは、選んだ暦の「年」の整数倍に合わせる。西暦なら 1500〜1509 年、ヒジュラ暦なら
 * 900〜909 AH。JDN を一定の日数で割ると、閏年のたびに年の境界とずれ、「1500 年の件数」が
 * 隣の区切りに混ざるため。暦の長さの違い（ヒジュラ暦の 1 年は約 354 日）も、年を単位にすれば吸収できる。
 *
 * 【歴史の事情】世紀（100 年区切り）は、歴史学では 1501〜1600 年を 16 世紀と数えるが、ここでは
 * 区切りの始まりを 100 の倍数（1500〜1599 年）にする。25 年区切りも同じ規則で、年の整数倍
 * （1500、1525、…）から始める。「世紀」ではなく「100 年区切り」と呼ぶのはそのため。
 * 天文学的な年（0 年がある）で数えるので、紀元前 1 年は 0 年、紀元前 44 年は -43 年の区切りに入る。
 */
import type { CalendarId, DayNumber } from '../model';
import { getCalendar, yearRange } from './calendars';
import type { DayRange } from './calendars';
import type { CalendarDisplay } from './display';
import { inputCalendarOf } from './display';

// 【TS】`as const` で配列を読み取り専用のリテラルの組にし、`(typeof X)[number]` で
//       「1 | 10 | 25 | 100」という和集合の型を作る。選択肢を足すと型も広がる。
/** 年表の区切りの幅（年）の一覧（D-42）。 */
export const TIME_BIN_WIDTHS = [1, 10, 25, 100] as const;

/** 年表の区切りの幅（年）。 */
export type TimeBinWidth = (typeof TIME_BIN_WIDTHS)[number];

/** 既定の区切りの幅。 */
export const DEFAULT_TIME_BIN_WIDTH: TimeBinWidth = 10;

/**
 * 値が区切りの幅として正しいかを判定する型ガード。
 *
 * @param v - 判定する値（保存ファイルから読んだ値など）
 * @returns 1・10・25・100 のどれかなら true
 */
export function isTimeBinWidth(v: unknown): v is TimeBinWidth {
  return TIME_BIN_WIDTHS.some((w) => w === v);
}

/**
 * 区切りを数える暦を、表示する暦から決める。
 *
 * 【なぜ】`both`（西暦とヒジュラ暦の併記）は 1 つの軸に 2 つの区切りを引けないので、西暦で区切る。
 * 併記の先頭が西暦であることと、日付の入力の既定（`inputCalendarOf`）に合わせる。
 *
 * @param display - 表示する暦の選択
 * @returns 区切りを数える暦
 */
export function binCalendarOf(display: CalendarDisplay): CalendarId {
  return inputCalendarOf(display);
}

/**
 * ある日が入る区切りの始まりの年を返す。
 *
 * @param jdn - 日（JDN。整数でなければ RangeError）
 * @param calendar - 区切りを数える暦
 * @param width - 区切りの幅（年）
 * @returns 区切りの最初の年（その暦の天文学的な年。幅の整数倍）
 *
 * @example
 * ```ts
 * binStartYear(gregorianToJdn(1507, 3, 1), 'gregorian', 10); // 1500
 * binStartYear(gregorianToJdn(-43, 3, 15), 'gregorian', 100); // -100（紀元前 44 年）
 * ```
 */
export function binStartYear(jdn: DayNumber, calendar: CalendarId, width: TimeBinWidth): number {
  const { year } = getCalendar(calendar).fromJdn(jdn);
  // 【なぜ】負の年でも「小さい側へ丸める」ように Math.floor を使う（Math.trunc だと 0 側へ丸まり、
  //   -43 年が 0 年の区切りに入ってしまう）。`+ 0` は -0 を 0 にそろえる。
  return Math.floor(year / width) * width + 0;
}

/**
 * 区切りが覆う日の幅（始まりの年の初日から、最後の年の末日まで）を返す。
 *
 * @param calendar - 区切りを数える暦
 * @param startYear - 区切りの最初の年（`binStartYear` の値）
 * @param width - 区切りの幅（年）
 * @returns JDN の閉区間
 */
export function binDayRange(
  calendar: CalendarId,
  startYear: number,
  width: TimeBinWidth,
): DayRange {
  const cal = getCalendar(calendar);
  return {
    earliest: yearRange(cal, startYear).earliest,
    latest: yearRange(cal, startYear + width - 1).latest,
  };
}

/**
 * 連続する区切りをまとめた日の幅を返す。年表で範囲を選んだとき、時間フィルタの端にする。
 *
 * @param calendar - 区切りを数える暦
 * @param firstStartYear - 先頭の区切りの最初の年
 * @param lastStartYear - 末尾の区切りの最初の年
 * @param width - 区切りの幅（年）
 * @returns 先頭の区切りの初日から、末尾の区切りの末日まで
 */
export function binsDayRange(
  calendar: CalendarId,
  firstStartYear: number,
  lastStartYear: number,
  width: TimeBinWidth,
): DayRange {
  return {
    earliest: binDayRange(calendar, firstStartYear, width).earliest,
    latest: binDayRange(calendar, lastStartYear, width).latest,
  };
}
