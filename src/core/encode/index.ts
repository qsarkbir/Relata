// encode の入口。スケール、配色、割り当ての設定、適用の関数をここから export する。
// 【TS】型だけの再エクスポートは `export type { … }`、値は `export { … }`（verbatimModuleSyntax のため区別する）。
export type { ScaleKind, PixelRange, ScaleResult } from './scale';
export { SCALE_KINDS, makeScale } from './scale';

export {
  CATEGORY_COLORS,
  OTHER_COLOR,
  MISSING_COLOR,
  VIRIDIS_STOPS,
  normalizeColor,
  viridisColor,
} from './palette';

export type {
  NodeSizeSource,
  NodeSizeEncoding,
  NodeColorEncoding,
  NodeShapeEncoding,
  EdgeWidthEncoding,
  EncodingSettings,
} from './settings';
export { DEFAULT_ENCODING, parseEncodingSettings } from './settings';

export type {
  ScaleTick,
  ScaleLegend,
  WidthResult,
  CategoryColorResult,
  CategoryValue,
  TypeCollisionReason,
  TypeCollision,
  TypeStyles,
  SizeResult,
  ColorResult,
  CategoryLegendEntry,
  CategoryLegend,
  GradientLegend,
  InvalidTypeColor,
} from './apply';
export {
  encodeNodeSizes,
  encodeEdgeWidths,
  encodeNodeColorsByCategory,
  encodeNodeColorsByNumber,
  typeColors,
  typeShapes,
  typeStyles,
} from './apply';
