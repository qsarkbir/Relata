// geo の入口。座標の出どころ、ノードの座標の取り出し、タイルの URL の検査をここから export する。
export type { GeoSource, GeoCoordinate, GeoNoneReason, NodeGeoResult } from './source';
export {
  DEFAULT_GEO_SOURCE,
  MAX_GEO_LAT,
  MAX_GEO_LON,
  GEO_NONE_REASONS,
  checkGeoCoordinate,
  geoSourceTypes,
  nodeGeo,
  nodeGeoPoint,
  parseGeoSourceValue,
  sameGeoSource,
} from './source';
export type { TileUrlProblem, TileUrlCheck, StripTileKeysResult } from './tileUrl';
export {
  TILE_PLACEHOLDERS,
  VALUELESS_PARAM,
  checkTileUrl,
  isSecretParamName,
  stripTileKeys,
} from './tileUrl';
export type { GeoBBox, GeoBBoxDescription } from './bbox';
export {
  crossesAntimeridian,
  isReversedBBox,
  bboxContains,
  isValidBBoxValues,
  describeGeoBBox,
} from './bbox';
