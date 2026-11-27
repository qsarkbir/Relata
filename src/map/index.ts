/**
 * 地図の部品の入口（`src/map/`）。views の薄い部品が `import('../map')` で動的に読み込む（D-50）。
 *
 * 【なぜ】入口を 1 つにする。maplibre-gl と deck.gl は大きいので、地図を初めて開いたときだけ
 * 読み込む別のチャンクにする。他の層からこの入口を静的に import してはいけない。
 * ここから export する純粋な関数（背景の解決、帰属表示、表示範囲の計算）は、
 * 単体テストでは個別のファイルを直接 import して確かめる（WebGL を読み込まないため）。
 */
export { createMapEngine } from './engine';
export type {
  FitBoundsOptions,
  MapEngine,
  MapEngineError,
  MapEngineOptions,
  MapEngineResult,
  MapUnavailableReason,
  ViewportListener,
  ViewportPhase,
} from './engine';
export {
  attributionFor,
  hostOfTileUrl,
  resolveBackground,
  MAP_ZOOM_RANGE,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  OSM_ATTRIBUTION_TEXT,
  OSM_COPYRIGHT_URL,
  SIMPLE_ATTRIBUTION_TEXT,
} from './background';
export type {
  AttributionPart,
  BackgroundKind,
  BackgroundSetting,
  BackgroundTexts,
  MapAttribution,
  ResolvedBackground,
  ZoomRange,
} from './background';
export { clampViewport, fitViewport, sameViewport, WORLD_BBOX } from './viewport';
export type { FitOptions } from './viewport';
