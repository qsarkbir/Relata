// model の入口。データモデルの型と小さな関数を、ここからまとめて export する。
// 【TS】型だけを再エクスポートするときは `export type { … }`、値（関数・定数）は `export { … }`。
//       型は実行時に消えるので、区別して書くとバンドラが安全に扱える（verbatimModuleSyntax）。
export type { NodeId, EdgeId, NodeTypeId, NodeIdSource } from './ids';
export {
  isValidId,
  toNodeId,
  toEdgeId,
  toNodeTypeId,
  makeNodeIdFromTypeAndKey,
  makeNodeIdFromTypeAndLabel,
  parseNodeId,
} from './ids';

export type {
  Scalar,
  MissingReason,
  Certainty,
  Missing,
  FuzzyDate,
  AttrValue,
  ValueAttr,
  DateAttr,
} from './values';
export {
  MISSING_REASONS,
  CERTAINTIES,
  isMissing,
  isMissingReason,
  isCertainty,
  isValueAttr,
  isDateAttr,
  attrValues,
  scalarValues,
  dateValues,
} from './values';

export type { Attrs } from './attrs';
export { getAttr, makeAttrs } from './attrs';

export type { DayNumber, CalendarId, TimeSpan, TimeValue } from './time';
export { CALENDAR_IDS } from './time';

export type { GeoPoint, GeoValue } from './geo';

export type {
  NodeShape,
  NodeType,
  GraphNode,
  GraphEdge,
  ValueType,
  AttributeDef,
  GraphMode,
  Dataset,
} from './graph';
export { NODE_SHAPES, VALUE_TYPES, GRAPH_MODES } from './graph';

export type { ParseResult } from './parse';
export {
  parseDataset,
  isDataset,
  isPlainObject,
  isFuzzyDate,
  isTimeSpan,
  isGeoPoint,
  isAttrValue,
} from './parse';

export type { IssueOwner, DatasetIssue } from './check';
export { checkDataset } from './check';

export type { CertaintyParse } from './certainty';
export { parseCertainty } from './certainty';
