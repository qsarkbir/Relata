// edge bundling の入口。DOM にも Worker にも依存しない（設計書 §4.1、§8.4）。
export {
  BUNDLING_EDGE_WARNING_LIMIT,
  DEFAULT_BUNDLING_SETTINGS,
  exceedsBundlingLimit,
  resolveBundlingSettings,
} from './settings';
export type {
  BundleEdge,
  BundledPath,
  BundlingInfo,
  BundlingProgress,
  BundlingResult,
  BundlingSettings,
} from './settings';
export {
  edgeCompatibility,
  buildNeighborTable,
  findCompatiblePairs,
  findCompatiblePairsBruteForce,
} from './compatibility';
export type { CompatEdge, CompatPair, NeighborTable } from './compatibility';
export { bundleEdges, createBundlingSession, MAX_BUNDLING_COORDINATE } from './session';
export type { BundlingSession } from './session';
export {
  DEFAULT_EPSILON_RATIO,
  DEFAULT_MIN_COSINE,
  buildBundleGraph,
  bundleEdgeIds,
  oppositesOf,
  segmentBundlesOf,
  weightsFor,
} from './bundleGraph';
export type { BundleGraph, BundleGraphOptions } from './bundleGraph';
