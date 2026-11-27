// filter の入口。フィルタの型、適用、ファセットの件数、Undo の履歴をここから export する。
// 【TS】型だけの export は `export type`、値は `export { … }`（verbatimModuleSyntax のため区別する）。
export type {
  FilterId,
  Target,
  MissingPolicy,
  CategoryKey,
  TextMatching,
  TimeMatch,
  TimeSource,
  CertaintyKey,
  FilterDef,
  EdgeRule,
  FilterState,
} from './types';
export type { GeoBBox } from '../geo';
export { toFilterId, FILTER_KINDS, CERTAINTY_KEYS, DEFAULT_FILTER_STATE } from './types';

export {
  addFilter,
  replaceFilter,
  removeFilter,
  clearFilters,
  setEdgeRule,
  setShowIsolated,
} from './state';

export type { FilterResult, FilterCounts } from './apply';
export { applyFilters } from './apply';

export type { FacetCount } from './facets';
export { facetCounts, certaintyFacetCounts } from './facets';
export type { CertaintyFacetCount } from './facets';

export type { FilterIssue } from './check';
export { checkFilterState } from './check';

export { categoryKeyId, categoryKeysOf } from './keys';

export type { FilterHistory } from './history';
export {
  HISTORY_LIMIT,
  createHistory,
  pushHistory,
  undoHistory,
  redoHistory,
  canUndo,
  canRedo,
} from './history';

export { parseFilterState } from './parse';

export type {
  TimeSourceDescription,
  TimeFilterDescription,
  TimeBound,
  DayExtent,
} from './timeSource';
export { dateAttributes, describeTimeFilter, timeDataExtent } from './timeSource';

export type { GeoSourceDescription, GeoFilterDescription } from './geoFilter';
export { describeGeoFilter } from './geoFilter';

export type { TimelineBin, TimelineResult } from './timeline';
export {
  MAX_TIMELINE_BINS,
  aggregateTimeline,
  itemDayRanges,
  binStartYearsOf,
  isInconsistentSpan,
  resolveTimelineSource,
  sameTimeSource,
  timelineSourceOptions,
} from './timeline';

export type { TimeSpan, TimeIndex, OutOfTime, GraphEdgeRef } from './timeFade';
export { itemTimeSpans, buildTimeIndex, outOfTime, fadedGraphEdges } from './timeFade';
