/**
 * 暦の入口。暦の ID から換算の関数を引き、年・月の幅を作る補助も置く。
 */
import type { CalendarId, DayNumber } from '../../model';
import { assertNever } from '../../util';
import { GREGORIAN } from './gregorian';
import { HIJRI } from './hijri';
import type { CalendarSystem } from './types';

export { GREGORIAN, gregorianToJdn, jdnToGregorian, isGregorianLeapYear } from './gregorian';
export { HIJRI, HIJRI_EPOCH_JDN, hijriToJdn, jdnToHijri, isHijriLeapYear } from './hijri';
export type { CalendarDate, CalendarSystem } from './types';
export { isValidDate } from './types';

/**
 * 暦の ID から暦の換算を引く。
 *
 * @param id - 暦の ID
 * @returns その暦の CalendarSystem
 */
export function getCalendar(id: CalendarId): CalendarSystem {
  // 【TS】CalendarId を足したのに分岐を書き忘れると、assertNever でコンパイルエラーになる。
  switch (id) {
    case 'gregorian':
      return GREGORIAN;
    case 'hijri':
      return HIJRI;
    default:
      return assertNever(id, 'CalendarId');
  }
}

/** 日の幅（JDN の閉区間）。 */
export interface DayRange {
  readonly earliest: DayNumber;
  readonly latest: DayNumber;
}

/**
 * ある年の初日から末日までの幅。
 *
 * @param cal - 暦
 * @param year - 年
 * @returns その年の JDN の幅
 */
export function yearRange(cal: CalendarSystem, year: number): DayRange {
  return monthSpan(cal, year, 1, cal.monthsPerYear);
}

/**
 * ある月の初日から末日までの幅。
 *
 * @param cal - 暦
 * @param year - 年
 * @param month - 月
 * @returns その月の JDN の幅
 */
export function monthRange(cal: CalendarSystem, year: number, month: number): DayRange {
  return monthSpan(cal, year, month, month);
}

function monthSpan(cal: CalendarSystem, year: number, first: number, last: number): DayRange {
  return {
    earliest: cal.toJdn(year, first, 1),
    latest: cal.toJdn(year, last, cal.monthLength(year, last)),
  };
}

/**
 * JDN を、同じ暦の「n 年前後」の同じ月日にずらす。
 *
 * その月にその日が無ければ（閏日など）月末に寄せる。
 *
 * @param cal - 暦
 * @param jdn - もとの日（整数。でなければ RangeError）
 * @param years - ずらす年数（負なら過去。整数）
 * @returns ずらした JDN
 */
export function shiftYears(cal: CalendarSystem, jdn: DayNumber, years: number): DayNumber {
  const d = cal.fromJdn(jdn);
  const y = d.year + years;
  return cal.toJdn(y, d.month, Math.min(d.day, cal.monthLength(y, d.month)));
}
