// missing の入口。欠損の集計（属性ごとの欠損率、破線にする要素の判定）と、「欠損の表示」の設定を export する（FR-VG-12）。
// 【TS】型だけの export は `export type`、値（関数・定数）は `export`（verbatimModuleSyntax）。
export { DEFAULT_MISSING_DISPLAY, parseMissingDisplay } from './display';
export type { MissingDisplay } from './display';
export {
  WHOLE_SCOPE,
  countMissingByAttribute,
  findMissingElements,
  missingRate,
  reasonRate,
} from './stats';
export type {
  AttrMissingRow,
  MissingCounts,
  MissingElements,
  MissingScope,
  ReasonCounts,
} from './stats';
export { countMissingByPeriod } from './period';
export type { PeriodAttr, PeriodMissing, PeriodRow, PeriodSpecialRow } from './period';
