import { DEFAULT_ENCODING, parseEncodingSettings, type EncodingSettings } from '../encode';
import { DEFAULT_GRAPH_OPTIONS, parseGraphOptions, type GraphOptions } from '../graph';
/** グラフ画面の保存可能な設定（FR-PJ-01、FR-VG-09/11、NFR-08）。 */
import { DEFAULT_MISSING_DISPLAY, parseMissingDisplay, type MissingDisplay } from '../missing';
import type { LayoutKind, LayoutPosition } from '../layout';
import type { ParseResult } from '../model';
import { isPlainObject, toNodeId } from '../model';

/** 表示方法。render に依存せず同じリテラルを使う。 */
export interface GraphViewSettings {
  readonly graphOptions: GraphOptions;
  readonly encoding: EncodingSettings;
  readonly layout: LayoutKind;
  readonly seed: number;
  readonly positions: readonly LayoutPosition[];
  readonly labels: 'all' | 'selected' | 'large';
  readonly largeLabelCount: number;
  readonly direction: 'arrow' | 'taper' | 'gradient';
  readonly viewport: { readonly x: number; readonly y: number; readonly zoom: number };
  /** 欠損を破線で示す属性（FR-VG-12）。無いファイルでは既定（どれも破線にしない）。 */
  readonly missingDisplay: MissingDisplay;
}
/** 未設定時のグラフ表示。位置はWorkerが計算する。 */
export const DEFAULT_GRAPH_VIEW: GraphViewSettings = {
  graphOptions: DEFAULT_GRAPH_OPTIONS,
  encoding: DEFAULT_ENCODING,
  layout: 'forceatlas2',
  seed: 1,
  positions: [],
  labels: 'all',
  largeLabelCount: 20,
  direction: 'arrow',
  viewport: { x: 0, y: 0, zoom: 1 },
  missingDisplay: DEFAULT_MISSING_DISPLAY,
};
/**
 * JSONから表示設定を検証して組み立て直す。
 * @param x - 任意の入力
 * @returns 設定、または壊れた項目の経路
 */
export function parseGraphView(x: unknown): ParseResult<GraphViewSettings> {
  const fail = (path: string): ParseResult<GraphViewSettings> => ({
    ok: false,
    path,
    reason: 'グラフ表示設定が不正です',
  });
  if (!isPlainObject(x)) return fail('');
  const get = (key: string): unknown => (Object.hasOwn(x, key) ? x[key] : undefined);
  const encoding = parseEncodingSettings(
    get('encoding') === undefined ? DEFAULT_ENCODING : get('encoding'),
  );
  if (!encoding.ok) return fail('encoding.' + encoding.path);
  const graphOptions = parseGraphOptions(
    get('graphOptions') === undefined ? DEFAULT_GRAPH_OPTIONS : get('graphOptions'),
  );
  if (!graphOptions.ok) return fail('graphOptions.' + graphOptions.path);
  const value = (key: string, fallback: unknown): unknown =>
    get(key) === undefined ? fallback : get(key);
  const layout = value('layout', DEFAULT_GRAPH_VIEW.layout);
  const labels = value('labels', DEFAULT_GRAPH_VIEW.labels);
  const direction = value('direction', DEFAULT_GRAPH_VIEW.direction);
  const seed = value('seed', DEFAULT_GRAPH_VIEW.seed);
  const largeLabelCount = value('largeLabelCount', DEFAULT_GRAPH_VIEW.largeLabelCount);
  if (layout !== 'forceatlas2' && layout !== 'circular' && layout !== 'fixed')
    return fail('layout');
  if (labels !== 'all' && labels !== 'selected' && labels !== 'large') return fail('labels');
  if (direction !== 'arrow' && direction !== 'taper' && direction !== 'gradient')
    return fail('direction');
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    return fail('seed');
  if (
    typeof largeLabelCount !== 'number' ||
    !Number.isInteger(largeLabelCount) ||
    largeLabelCount < 0 ||
    largeLabelCount > 10000
  )
    return fail('largeLabelCount');
  const rawPositions = value('positions', []);
  if (!Array.isArray(rawPositions)) return fail('positions');
  const positions: LayoutPosition[] = [];
  const seen = new Set<string>();
  for (const [i, p] of rawPositions.entries()) {
    const path = 'positions[' + String(i) + ']';
    if (!isPlainObject(p) || typeof p.id !== 'string' || p.id === '' || seen.has(p.id))
      return fail(path);
    if (
      typeof p.x !== 'number' ||
      !Number.isFinite(p.x) ||
      Math.abs(p.x) > 1e9 ||
      typeof p.y !== 'number' ||
      !Number.isFinite(p.y) ||
      Math.abs(p.y) > 1e9 ||
      typeof p.fixed !== 'boolean'
    )
      return fail(path);
    seen.add(p.id);
    positions.push({ id: toNodeId(p.id), x: p.x, y: p.y, fixed: p.fixed });
  }
  const viewport = value('viewport', DEFAULT_GRAPH_VIEW.viewport);
  if (
    !isPlainObject(viewport) ||
    typeof viewport.x !== 'number' ||
    !Number.isFinite(viewport.x) ||
    Math.abs(viewport.x) > 1e9 ||
    typeof viewport.y !== 'number' ||
    !Number.isFinite(viewport.y) ||
    Math.abs(viewport.y) > 1e9 ||
    typeof viewport.zoom !== 'number' ||
    !Number.isFinite(viewport.zoom) ||
    viewport.zoom < 0.1 ||
    viewport.zoom > 10
  )
    return fail('viewport');
  return {
    ok: true,
    value: {
      graphOptions: graphOptions.value,
      encoding: encoding.value,
      layout,
      labels,
      direction,
      seed,
      largeLabelCount,
      positions,
      viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
      missingDisplay: parseMissingDisplay(get('missingDisplay')),
    },
  };
}
