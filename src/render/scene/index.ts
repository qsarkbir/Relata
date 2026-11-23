export type {
  PathCommand,
  TextDirection,
  SceneNode,
  SceneEdge,
  SceneLabel,
  LegendMark,
  SceneLegendItem,
  SceneLegend,
  SceneOmitted,
  Scene,
} from './types';
export type {
  MeasureText,
  SceneEncoding,
  LegendItemSpec,
  LegendSpec,
  LabelMode,
  BuildSceneOptions,
} from './build';
export { buildScene, shapeExtent, DEFAULT_EDGE_COLOR, DEFAULT_EDGE_OPACITY } from './build';

export type { DirectedEdgeStyle, EdgePoint } from '../edges/geometry';
export { FADED_OPACITY, markOutOfTime } from './timeFade';
