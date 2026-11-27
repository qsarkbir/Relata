/**
 * グラフ画面の保存可能な設定（FR-PJ-01、FR-VG-09/11、NFR-08）。
 */
import { DEFAULT_ENCODING, parseEncodingSettings, type EncodingSettings } from '../encode';
import { DEFAULT_GRAPH_OPTIONS, parseGraphOptions, type GraphOptions } from '../graph';
import { parseBundlingView, type BundlingViewSettings } from './bundlingView';
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
  /** 層状の配置の列の順（型 ID）。任意（D-24）。無ければ型 ID の昇順（FR-VG-02）。 */
  readonly columnOrder?: readonly string[];
  /** 地理座標の配置の緯度・経度の属性のキー。任意（D-24）。無ければ未選択（FR-VG-02）。 */
  readonly geoAttrs?: { readonly lat?: string; readonly lon?: string };
  /** グラフ図の edge bundling の設定。任意（D-24、D-59）。無ければ既定（`DEFAULT_BUNDLING_VIEW`。無効）。 */
  readonly bundling?: BundlingViewSettings;
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
  const missingDisplay = parseMissingDisplay(get('missingDisplay'));
  if (!missingDisplay.ok)
    return fail('missingDisplay' + (missingDisplay.path === '' ? '' : '.' + missingDisplay.path));
  const value = (key: string, fallback: unknown): unknown =>
    get(key) === undefined ? fallback : get(key);
  const layout = value('layout', DEFAULT_GRAPH_VIEW.layout);
  const labels = value('labels', DEFAULT_GRAPH_VIEW.labels);
  const direction = value('direction', DEFAULT_GRAPH_VIEW.direction);
  const seed = value('seed', DEFAULT_GRAPH_VIEW.seed);
  const largeLabelCount = value('largeLabelCount', DEFAULT_GRAPH_VIEW.largeLabelCount);
  if (
    layout !== 'forceatlas2' &&
    layout !== 'circular' &&
    layout !== 'fixed' &&
    layout !== 'layered' &&
    layout !== 'geo'
  )
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
  const rawOrder = get('columnOrder');
  if (
    rawOrder !== undefined &&
    (!Array.isArray(rawOrder) || rawOrder.some((t) => typeof t !== 'string' || t === ''))
  )
    return fail('columnOrder');
  const rawGeo = get('geoAttrs');
  if (
    rawGeo !== undefined &&
    (!isPlainObject(rawGeo) ||
      [rawGeo.lat, rawGeo.lon].some((k) => k !== undefined && (typeof k !== 'string' || k === '')))
  )
    return fail('geoAttrs');
  const geoAttrs =
    rawGeo === undefined || !isPlainObject(rawGeo)
      ? undefined
      : {
          ...(typeof rawGeo.lat === 'string' ? { lat: rawGeo.lat } : {}),
          ...(typeof rawGeo.lon === 'string' ? { lon: rawGeo.lon } : {}),
        };
  // 【なぜ】bundling は見た目の任意の設定なので、壊れていても図ごと拒まず、無いものとして扱う（D-24）。
  const bundlingParsed =
    get('bundling') === undefined ? undefined : parseBundlingView(get('bundling'));
  const bundling = bundlingParsed?.ok === true ? bundlingParsed.value : undefined;
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
      // 【なぜ】任意項目は、あるときだけ値に含める（D-24。無い項目は既定値で補う）。
      ...(rawOrder === undefined ? {} : { columnOrder: (rawOrder as string[]).slice() }), // 理由: 上で全要素が文字列だと検査済み
      // 【なぜ】片方だけ選んだ状態も保存できる。選んでいない側は項目ごと省き、両方なければ geoAttrs ごと省く。
      ...(geoAttrs === undefined || Object.keys(geoAttrs).length === 0 ? {} : { geoAttrs }),
      ...(bundling === undefined ? {} : { bundling }),
      viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
      missingDisplay: missingDisplay.value,
    },
  };
}
