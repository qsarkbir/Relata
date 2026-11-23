// time の入口。暦の換算と日付の解析をここから export する。
export * from './calendars';
export { HIJRI_MONTH_LABELS, hijriMonthFromName } from './months';
export { parseDate, parseTimeSpan, DEFAULT_CIRCA_YEARS, DEFAULT_HIJRI_DAY_MARGIN } from './parse';
export type {
  ParseDateOptions,
  DateFailureCode,
  DateFailure,
  DateWarningCode,
  DateWarning,
  DateParseSuccess,
  DateParseFailure,
  DateParseResult,
  TimeSpanParseSuccess,
  TimeSpanParseResult,
} from './parse';
export type { CalendarDisplay, DatePrecision, DateParts, CalendarRendering } from './display';
export {
  CALENDAR_DISPLAYS,
  DEFAULT_CALENDAR_DISPLAY,
  isCalendarDisplay,
  calendarsOf,
  inputCalendarOf,
  jdnToParts,
  inferPrecision,
  describeDayRange,
  describeBound,
  inferBoundPrecision,
  describeDay,
} from './display';
export type {
  TimeFilterInputFailureCode,
  TimeFilterInputFailure,
  TimeFilterInputResult,
} from './filterInput';
export { parseTimeFilterInput } from './filterInput';
export {
  TIME_BIN_WIDTHS,
  DEFAULT_TIME_BIN_WIDTH,
  isTimeBinWidth,
  binCalendarOf,
  binStartYear,
  binDayRange,
  binsDayRange,
} from './bins';
export type { TimeBinWidth } from './bins';
