// graph の入口。グラフの構築、選択肢、Worker に渡すスナップショットを export する。
export type { WeightSource, GraphOptions, ProjectionMethod, ProjectionOptions } from './options';
export { DEFAULT_GRAPH_OPTIONS, PROJECTION_METHODS, parseGraphOptions } from './options';
export type {
  ProjectionIssue,
  ProjectionResult,
  ProjectionRunOptions,
  ProjectionWarning,
} from './projection';
export {
  MAX_PROJECTION_PAIRS,
  checkProjectionSize,
  projectGraph,
  validateProjection,
} from './projection';
export type { RelataNodeAttributes, RelataEdgeAttributes, RelataGraph } from './build';
export { buildGraph } from './build';
export type { GraphSnapshot } from './snapshot';
export { toSnapshot, fromSnapshot } from './snapshot';
