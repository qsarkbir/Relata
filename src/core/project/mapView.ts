/**
 * 地図の保存可能な設定（`view.map`。D-51、D-52、D-59、FR-MP-01、02、03、06）。
 *
 * 地図だけの設定。座標の出どころは、グラフの地理座標の配置と共通なので `view.geoSource` に置く。
 * 地図の画面の一時的な状態（ドラッグ中の矩形、選択など）は保存しない。
 */
import { checkTileUrl, MAX_GEO_LAT, MAX_GEO_LON } from '../geo';
import { DEFAULT_ENCODING, parseEncodingSettings, type EncodingSettings } from '../encode';
import { isPlainObject, type ParseResult } from '../model';
import {
  DEFAULT_BUNDLING_VIEW,
  parseBundlingView,
  type BundlingViewSettings,
} from './bundlingView';

/** 背景地図。`osm` は OpenStreetMap、`simple` は同梱の簡易背景（陸地）、`custom` は利用者の XYZ のタイル。 */
export type MapBackground = 'osm' | 'simple' | 'custom';
/** 背景の一覧。 */
export const MAP_BACKGROUNDS = [
  'osm',
  'simple',
  'custom',
] as const satisfies readonly MapBackground[];

/** エッジの形。直線か弧。 */
export type MapEdgeShape = 'line' | 'arc';
/** エッジの形の一覧。 */
export const MAP_EDGE_SHAPES = ['line', 'arc'] as const satisfies readonly MapEdgeShape[];

/** 地図の有向エッジの表し方。 */
export const MAP_EDGE_DIRECTIONS = ['arrow', 'taper', 'gradient'] as const;
/** 地図の有向エッジの表し方の型。 */
export type MapEdgeDirection = (typeof MAP_EDGE_DIRECTIONS)[number];

/** ラベルの表示。すべて、選択中のノードだけ、出さない。 */
export type MapLabels = 'all' | 'selected' | 'none';
/** ラベルの表示の一覧。 */
export const MAP_LABELS = ['all', 'selected', 'none'] as const satisfies readonly MapLabels[];

/** 利用者のタイル（`background: 'custom'` のとき使う）。 */
export interface CustomTiles {
  /**
   * XYZ の URL。`https:` で `{z}` `{x}` `{y}` を含む（D-51）。無ければ空文字（まだ入力していない）。
   * 保存の前に、鍵らしいクエリの項目は除かれる（D-52）。
   */
  readonly url: string;
  /** 帰属表示の文（利用者が書く。空ならホスト名を出す。D-51）。 */
  readonly attribution: string;
  /**
   * 保存の前に URL から除いた、鍵らしいクエリの項目名（名前だけ。値は持たない。D-52）。
   * 開いた人に「鍵を入れ直してください」と促すために残す。無ければ除いたものは無い。任意の項目（D-24）。
   * `=` の無い項目を除いたときは、名前の代わりに固定の印（`VALUELESS_PARAM`）が入る。
   * URL が空のときは保存しない。利用者が URL を編集したら、この一覧を消すのは画面の役目（保存側は、
   * 今回除いたものが無ければ、読み込んだ一覧をそのまま残す）。
   */
  readonly removedParams?: readonly string[];
}

/** 地図の表示範囲。中心の経緯度とズーム。 */
export interface MapViewport {
  readonly lon: number;
  readonly lat: number;
  readonly zoom: number;
}

/** 再生中の表示（FR-MP-03）。 */
export interface MapPlaybackSettings {
  /** 送り手から受け手へ動く粒子を出すか。 */
  readonly particles: boolean;
  /** 時刻までの累積の次数でノードの大きさを変えるか。 */
  readonly cumulativeDegree: boolean;
}

/** 地図の設定。 */
export interface MapViewSettings {
  readonly background: MapBackground;
  readonly customTiles: CustomTiles;
  /**
   * 表示範囲。null は「まだ決めていない」で、データの座標に合わせる。
   * 【なぜ】null と選んだ値を区別する。データを読み替えたときに、前のデータの範囲を引きずらないため
   * （年表の出どころの null と同じ）。
   */
  readonly viewport: MapViewport | null;
  readonly edgeShape: MapEdgeShape;
  readonly direction: MapEdgeDirection;
  readonly encoding: EncodingSettings;
  readonly labels: MapLabels;
  readonly playback: MapPlaybackSettings;
  /** 地図の束ねる設定（グラフとは別。D-55）。 */
  readonly bundling: BundlingViewSettings;
}

/** 未設定のときの地図の設定。通信は地図を開いたときだけ（D-51）なので、既定の背景は OSM。 */
export const DEFAULT_MAP_VIEW: MapViewSettings = {
  background: 'osm',
  customTiles: { url: '', attribution: '' },
  viewport: null,
  edgeShape: 'line',
  direction: 'arrow',
  encoding: { ...DEFAULT_ENCODING, nodeShape: { kind: 'constant', shape: 'circle' } },
  labels: 'selected',
  playback: { particles: true, cumulativeDegree: true },
  bundling: DEFAULT_BUNDLING_VIEW,
};

/** ズームの範囲。MapLibre の標準（0〜22）。 */
export const MAP_ZOOM_MAX = 22;
/** 帰属表示の文の長さの上限（壊れた入力で画面が崩れないように）。 */
const MAX_ATTRIBUTION_LENGTH = 500;
/** URL の長さの上限。 */
const MAX_URL_LENGTH = 2000;

// 項目を自分自身の項目として読む（継承した項目は読まない）。
//
function own(o: Record<string, unknown>, k: string): unknown {
  return Object.hasOwn(o, k) ? o[k] : undefined;
}

/**
 * 除いた鍵の項目名の一覧を読む。文字列だけ、空でなく 100 字以内、重複なし、20 件まで。
 * 【TS】`readonly string[]` を返すので、呼ぶ側は要素を足せず、新しい配列を作ることになる。
 *
 * @param x - 任意の入力
 * @returns 名前の一覧。1 件も無ければ undefined
 */
export function parseRemovedParams(x: unknown): readonly string[] | undefined {
  if (!Array.isArray(x)) return undefined;
  // 【TS】`Array.isArray` は any[] に絞るので、unknown の配列として受け直す（`as` を使わない）。
  const arr: readonly unknown[] = x;
  const names: string[] = [];
  for (const n of arr) {
    if (typeof n === 'string' && n !== '' && n.length <= 100 && !names.includes(n)) names.push(n);
    if (names.length >= 20) break;
  }
  return names.length === 0 ? undefined : names;
}

function parseViewport(x: unknown): MapViewport | null {
  if (!isPlainObject(x)) return null;
  const lon = own(x, 'lon');
  const lat = own(x, 'lat');
  const zoom = own(x, 'zoom');
  if (
    typeof lon !== 'number' ||
    typeof lat !== 'number' ||
    typeof zoom !== 'number' ||
    !Number.isFinite(lon) ||
    !Number.isFinite(lat) ||
    !Number.isFinite(zoom) ||
    Math.abs(lon) > MAX_GEO_LON ||
    Math.abs(lat) > MAX_GEO_LAT ||
    zoom < 0 ||
    zoom > MAP_ZOOM_MAX
  )
    return null;
  return { lon, lat, zoom };
}

// 利用者のタイルを読む。既定に戻した項目のパス（`customTiles` からの相対）も `reset` に積む。
//
function parseCustomTiles(x: unknown, reset: string[]): CustomTiles {
  if (x === undefined) return DEFAULT_MAP_VIEW.customTiles;
  if (!isPlainObject(x)) {
    reset.push('customTiles');
    return DEFAULT_MAP_VIEW.customTiles;
  }
  const rawUrl = own(x, 'url');
  const rawAttribution = own(x, 'attribution');
  // 【なぜ】使えない URL（http、雛形なしなど）は、空にして落とす。読み込んだ後にタイルの要求が壊れたり、
  //   `https:` 以外へ通信したりしないため。利用者は入れ直せる。落としたことは `reset` で伝える（D-24）。
  const urlOk =
    typeof rawUrl === 'string' && rawUrl.length <= MAX_URL_LENGTH && checkTileUrl(rawUrl).ok;
  if (rawUrl !== undefined && rawUrl !== '' && !urlOk) reset.push('customTiles.url');
  if (rawAttribution !== undefined && typeof rawAttribution !== 'string')
    reset.push('customTiles.attribution');
  const removedParams = parseRemovedParams(own(x, 'removedParams'));
  return {
    url: urlOk ? rawUrl : '',
    attribution:
      typeof rawAttribution === 'string' ? rawAttribution.slice(0, MAX_ATTRIBUTION_LENGTH) : '',
    ...(removedParams === undefined ? {} : { removedParams }),
  };
}

// 列挙の値を読む。読めなければ既定にして、パスを `reset` に積む（項目が無いときは積まない）。
//
function oneOf<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  reset: string[],
): T {
  const found = allowed.find((a) => a === raw);
  if (found === undefined && raw !== undefined) reset.push(path);
  return found ?? fallback;
}

/** 地図の設定の読み込み結果。 */
export interface ParsedMapView {
  readonly value: MapViewSettings;
  /** 読めずに既定へ戻した項目のパス（`view.map` からの相対。例: `customTiles.url`）。呼ぶ側が警告にする（D-24）。 */
  readonly reset: readonly string[];
}

/**
 * JSON から地図の設定を組み立て、既定に戻した項目のパスも返す。
 *
 * @param x - 任意の入力
 * @returns 設定と、既定に戻した項目のパス。オブジェクトでなければ失敗
 */
export function parseMapViewDetailed(x: unknown): ParseResult<ParsedMapView> {
  if (!isPlainObject(x)) return { ok: false, path: '', reason: '地図の設定が不正です' };
  const reset: string[] = [];
  const playback = own(x, 'playback');
  if (playback !== undefined && !isPlainObject(playback)) reset.push('playback');
  const pb = isPlainObject(playback) ? playback : {};
  const bool = (k: 'particles' | 'cumulativeDegree'): boolean => {
    const v = own(pb, k);
    if (typeof v === 'boolean') return v;
    if (v !== undefined) reset.push(`playback.${k}`);
    return DEFAULT_MAP_VIEW.playback[k];
  };
  const rawBundling = own(x, 'bundling');
  const bundling = rawBundling === undefined ? undefined : parseBundlingView(rawBundling);
  if (bundling !== undefined && !bundling.ok) reset.push('bundling');
  const rawViewport = own(x, 'viewport');
  const rawEncoding = own(x, 'encoding');
  const encoding = rawEncoding === undefined ? undefined : parseEncodingSettings(rawEncoding);
  if (encoding !== undefined && !encoding.ok) reset.push('encoding');
  const viewport = parseViewport(rawViewport);
  // 【なぜ】null は「データに合わせる」という正しい値なので、既定に戻したことにしない。
  if (rawViewport !== undefined && rawViewport !== null && viewport === null)
    reset.push('viewport');
  const value: MapViewSettings = {
    background: oneOf(
      own(x, 'background'),
      MAP_BACKGROUNDS,
      DEFAULT_MAP_VIEW.background,
      'background',
      reset,
    ),
    customTiles: parseCustomTiles(own(x, 'customTiles'), reset),
    viewport,
    edgeShape: oneOf(
      own(x, 'edgeShape'),
      MAP_EDGE_SHAPES,
      DEFAULT_MAP_VIEW.edgeShape,
      'edgeShape',
      reset,
    ),
    direction: oneOf(
      own(x, 'direction'),
      MAP_EDGE_DIRECTIONS,
      DEFAULT_MAP_VIEW.direction,
      'direction',
      reset,
    ),
    encoding:
      encoding?.ok === true
        ? { ...encoding.value, nodeShape: DEFAULT_MAP_VIEW.encoding.nodeShape }
        : DEFAULT_MAP_VIEW.encoding,
    labels: oneOf(own(x, 'labels'), MAP_LABELS, DEFAULT_MAP_VIEW.labels, 'labels', reset),
    playback: { particles: bool('particles'), cumulativeDegree: bool('cumulativeDegree') },
    bundling: bundling?.ok === true ? bundling.value : DEFAULT_BUNDLING_VIEW,
  };
  return { ok: true, value: { value, reset } };
}

/**
 * JSON から地図の設定を組み立てる。無い項目と、読めない項目は既定で補う。
 *
 * 【なぜ】任意の項目なので、1 つの壊れた値のために、データを含むファイル全体を開けなくしない（D-24）。
 * オブジェクトでないときだけ失敗にする（呼ぶ側が警告にして既定へ戻す）。
 * タイルの URL は検査して、使えないものは空にする（鍵の除去は保存のとき。io の `serializeProject`）。
 * 既定に戻した項目を知りたいときは `parseMapViewDetailed` を使う。
 *
 * @param x - 任意の入力
 * @returns 設定、または壊れた箇所
 */
export function parseMapView(x: unknown): ParseResult<MapViewSettings> {
  const r = parseMapViewDetailed(x);
  return r.ok ? { ok: true, value: r.value.value } : r;
}
