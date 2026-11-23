/**
 * 日付（JDN）を、選んだ暦の表示用の部品に分ける（FR-TM-09、設計書 D-45）。
 *
 * 内部の値は JDN のまま変えない。ここは「どの暦で何年何月何日か」を数値と種類で返すだけで、
 * 月名や「年」「AH」などの文言は組み立てない（それは i18n を持つ ui の仕事。core は i18n に依存しない）。
 * `Date` は使わず、換算は `calendars/` の関数だけで行う。
 *
 * 【歴史の事情】
 * - ヒジュラ暦の 1 年は約 354 日で、西暦の 1 年とずれていく。ヒジュラ暦の 1 年は西暦の 2 つの年に
 *   またがり、西暦の 1 年にはヒジュラ暦の 2 つの年が重なる
 *   （前の年の終わりと次の年の始まりが入る）。このため、年だけの日付の幅（例: 1050 AH）を
 *   西暦で表すと「1640〜1641 年」のような範囲になる。1 つの年に潰さず、始点と終点の部品を返す。
 * - 年は天文学的な数え方（紀元前 1 年 ＝ 0 年）で持つ（calendars/types.ts）。表示用の部品では
 *   0 以下の年を `era: 'before'` と、`1 - 年` の正の年に直す。ヒジュラ暦の 1 年より前（紀元前に
 *   当たる側）も、解析は受けない（`bc-with-hijri`）が、「頃」の幅が及ぶことはあるので、同じ規則で
 *   表せるようにしてある。
 */
import type { CalendarId, DayNumber } from '../model';
import { assertNever } from '../util';
import type { DayRange } from './calendars';
import { getCalendar } from './calendars';

/**
 * 表示する暦の選択（R-24、D-45）。`view.display.calendar` に保存する値。
 *
 * `both` は西暦とヒジュラ暦の両方を並べる。
 */
export type CalendarDisplay = 'gregorian' | 'hijri' | 'both';

/** 取りうる表示の暦の一覧。外から来た値の検査や、切り替えの選択肢の並びに使う。 */
export const CALENDAR_DISPLAYS = [
  'gregorian',
  'hijri',
  'both',
] as const satisfies readonly CalendarDisplay[];

/** 既定の表示の暦。 */
export const DEFAULT_CALENDAR_DISPLAY: CalendarDisplay = 'gregorian';

/**
 * 値が CalendarDisplay かを判定する。
 *
 * @param v - 判定する値（外から来た unknown）
 * @returns CalendarDisplay なら true
 */
// 【TS】`v is CalendarDisplay` は型ガード。true の分岐で TypeScript が v を CalendarDisplay として扱う。
export function isCalendarDisplay(v: unknown): v is CalendarDisplay {
  return typeof v === 'string' && (CALENDAR_DISPLAYS as readonly string[]).includes(v);
}

/**
 * 表示の選択に含まれる暦を、表示する順に返す。`both` は西暦、ヒジュラ暦の順。
 *
 * @param display - 表示の暦の選択
 * @returns 暦の ID の配列
 */
export function calendarsOf(display: CalendarDisplay): readonly CalendarId[] {
  switch (display) {
    case 'gregorian':
      return ['gregorian'];
    case 'hijri':
      return ['hijri'];
    case 'both':
      return ['gregorian', 'hijri'];
    default:
      return assertNever(display, 'CalendarDisplay');
  }
}

/**
 * 利用者が暦の印なしで日付を入力するとき、どの暦で読むか。
 *
 * 【なぜ】表示がヒジュラ暦なら、利用者は「905」をヒジュラ暦の年のつもりで書く。
 * `both` は西暦を主にする（併記の先頭が西暦のため）。
 *
 * @param display - 表示の暦の選択
 * @returns 入力の既定の暦
 */
export function inputCalendarOf(display: CalendarDisplay): CalendarId {
  return display === 'hijri' ? 'hijri' : 'gregorian';
}

/** 表示の細かさ。年だけ、年月、年月日。 */
export type DatePrecision = 'year' | 'month' | 'day';

/**
 * 表示用の日付の部品。文言は含まない（i18n 側が組み立てる）。
 *
 * - `era`: `'common'` は 1 年以降（西暦なら CE、ヒジュラ暦なら AH）。`'before'` は 0 年以前
 *   （西暦なら紀元前 BCE、ヒジュラ暦ならヒジュラ以前）。
 * - `year`: 常に 1 以上の整数。`before` のときは `1 - 天文学的な年`（紀元前 44 年なら 44）。
 * - `month`、`day`: 精度が足りるときだけ付く。月は 1〜12（ヒジュラ暦の月名は `HIJRI_MONTH_LABELS`）。
 */
export interface DateParts {
  readonly calendar: CalendarId;
  readonly era: 'common' | 'before';
  readonly year: number;
  readonly month?: number;
  readonly day?: number;
}

/**
 * 1 つの暦で表した日付または日付の幅。`to` があれば範囲（`from` 〜 `to`）。
 */
export interface CalendarRendering {
  readonly calendar: CalendarId;
  readonly from: DateParts;
  /** 範囲のときだけ。始点と同じ部品になるときは付けない。 */
  readonly to?: DateParts;
}

/**
 * JDN を、1 つの暦の表示用の部品にする。
 *
 * @param jdn - JDN（整数）
 * @param calendar - 暦
 * @param precision - 表示の細かさ（既定は日）
 * @returns 表示用の部品
 * @throws RangeError JDN が整数でないとき
 *
 * @example
 * ```ts
 * jdnToParts(gregorianToJdn(1640, 4, 23), 'hijri', 'year'); // { calendar: 'hijri', era: 'common', year: 1050 }
 * jdnToParts(gregorianToJdn(0, 6, 1), 'gregorian', 'month'); // { calendar: 'gregorian', era: 'before', year: 1, month: 6 }
 * ```
 */
export function jdnToParts(
  jdn: DayNumber,
  calendar: CalendarId,
  precision: DatePrecision = 'day',
): DateParts {
  const d = getCalendar(calendar).fromJdn(jdn);
  // 【なぜ】天文学的な年 0 以下を「紀元前 1 − 年」に直す。0 年は存在しないと表示する慣習に合わせる。
  const era = d.year >= 1 ? 'common' : 'before';
  const year = d.year >= 1 ? d.year : 1 - d.year;
  switch (precision) {
    case 'year':
      return { calendar, era, year };
    case 'month':
      return { calendar, era, year, month: d.month };
    case 'day':
      return { calendar, era, year, month: d.month, day: d.day };
    default:
      return assertNever(precision, 'DatePrecision');
  }
}

/**
 * 日の幅（JDN の閉区間）が、ある暦の「年全体」「月全体」「それ以外」のどれかを調べる。
 *
 * 【なぜ】FuzzyDate は精度を持たない（幅だけを持つ）。「1500」と読んだ日付は 1500 年の初日から末日までの
 * 幅になるので、幅がその暦の年（月）にぴったり重なれば、その精度で表す。ヒジュラ暦の年の幅を
 * 西暦で見ると年にぴったり重ならないので、日の精度で（範囲として）出る。
 *
 * @param range - 日の幅
 * @param calendar - 暦
 * @returns 精度
 */
export function inferPrecision(range: DayRange, calendar: CalendarId): DatePrecision {
  const cal = getCalendar(calendar);
  const a = cal.fromJdn(range.earliest);
  const b = cal.fromJdn(range.latest);
  if (a.day !== 1) return 'day';
  const endsMonth = b.day === cal.monthLength(b.year, b.month);
  if (!endsMonth) return 'day';
  // 年全体: 1 月 1 日から 12 月の末日まで（複数年でもよい）。
  if (a.month === 1 && b.month === cal.monthsPerYear) return 'year';
  return 'month';
}

/**
 * 日の幅を、選んだ暦で表示用の部品にする。
 *
 * 暦ごとに、始点（`earliest`）と終点（`latest`）を同じ精度の部品にし、同じなら 1 つの日付、
 * 違えば範囲にする。`both` は西暦、ヒジュラ暦の順に 2 つ返す。精度は暦ごとに決める
 * （`precision` を渡せば全部の暦でそれを使う）。1 点の日付は `earliest` と `latest` を同じにする。
 *
 * @param range - 日の幅
 * @param display - 表示の暦の選択
 * @param precision - 精度を決め打ちするとき。省略すると幅から暦ごとに推測する
 * @returns 暦ごとの表示。`display` に含まれる暦の数だけ
 *
 * @example
 * ```ts
 * // 1050 AH（1640-04-23〜1641-04-11）を西暦で
 * describeDayRange(range, 'gregorian'); // [{ from: 1640 年 4 月 23 日, to: 1641 年 4 月 11 日 }]
 * describeDayRange(range, 'hijri'); // [{ calendar: 'hijri', from: { era: 'common', year: 1050 } }]
 * ```
 */
export function describeDayRange(
  range: DayRange,
  display: CalendarDisplay,
  precision?: DatePrecision,
): CalendarRendering[] {
  return calendarsOf(display).map((calendar) => {
    const p = precision ?? inferPrecision(range, calendar);
    const from = jdnToParts(range.earliest, calendar, p);
    const to = jdnToParts(range.latest, calendar, p);
    return sameParts(from, to) ? { calendar, from } : { calendar, from, to };
  });
}

/**
 * 1 つの JDN を、選んだ暦で表示用の部品にする（日の精度）。
 *
 * @param jdn - JDN
 * @param display - 表示の暦の選択
 * @param precision - 精度（既定は日）
 * @returns 暦ごとの表示（範囲にならない）
 */
export function describeDay(
  jdn: DayNumber,
  display: CalendarDisplay,
  precision: DatePrecision = 'day',
): CalendarRendering[] {
  return describeDayRange({ earliest: jdn, latest: jdn }, display, precision);
}

/**
 * 2 つの部品が同じ日付を表すか。
 *
 * @param a - 部品
 * @param b - 部品
 * @returns 同じなら true
 */
function sameParts(a: DateParts, b: DateParts): boolean {
  return (
    a.calendar === b.calendar &&
    a.era === b.era &&
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day
  );
}
