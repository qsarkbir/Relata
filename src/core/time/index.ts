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
