/**
 * 背景地図の選び方と、MapLibre のスタイルの組み立て（FR-MP-01、FR-MP-06、NFR-02。D-51、D-52）。
 *
 * このファイルは純粋な関数だけで、maplibre-gl の実行時のコードを import しない（型だけ）。
 * WebGL の無い環境（単体テスト）でも、スタイルと帰属表示の選び方を確かめられるようにするため。
 */
import type { StyleSpecification } from 'maplibre-gl';
import { checkTileUrl, type TileUrlProblem } from '../core/geo';
import type { CustomTiles, MapBackground } from '../core/project/mapView';

/** OpenStreetMap のタイルの URL。規約どおり、サブドメインを使わずこのまま使う（D-51 の補足）。 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** OpenStreetMap の著作権のページ。帰属表示のリンク先。 */
export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
/** 「地図の誤りを報告」のページ（規約の推奨。D-51 の補足 (5)）。 */
export const OSM_FIX_THE_MAP_URL = 'https://www.openstreetmap.org/fixthemap';
/** OpenStreetMap の帰属表示の文。固有の表記なので翻訳しない（D-51）。 */
export const OSM_ATTRIBUTION_TEXT = '© OpenStreetMap contributors';
/** 簡易背景の帰属表示の既定の文。固有名なので翻訳しない。呼ぶ側が上書きもできる。 */
export const SIMPLE_ATTRIBUTION_TEXT = 'Natural Earth';
/** 簡易背景の出典のページ。 */
export const NATURAL_EARTH_URL = 'https://www.naturalearthdata.com/';

/**
 * 背景地図の設定。`MapViewSettings` の背景に関わる 2 項目をそのまま渡せる形。
 *
 * 【なぜ】ui は `view.map` の `background` と `customTiles` をそのまま渡せばよく、
 * 変換を書かずに済む。
 */
export interface BackgroundSetting {
  readonly background: MapBackground;
  readonly customTiles: CustomTiles;
}

/** 背景まわりの文言と場所。 */
export interface BackgroundTexts {
  /** 簡易背景の帰属表示（既定 `SIMPLE_ATTRIBUTION_TEXT`）。 */
  readonly simpleAttribution?: string;
  /** 「地図の誤りを報告」のリンクの文言。渡したときだけ、OSM の帰属表示の後ろに添える。 */
  readonly reportMapErrorLabel?: string;
}

/** 帰属表示の 1 つの部分。`href` があればリンクにする。 */
export interface AttributionPart {
  readonly text: string;
  readonly href?: string;
}

/**
 * 右下に常に出す帰属表示。
 *
 * 【なぜ】HTML の文字列ではなく部品の配列にする。利用者が書いた文（古地図の出典）を
 * HTML として解釈させないため（DOM には `textContent` で入れる。XSS を避ける）。
 */
export type MapAttribution = readonly AttributionPart[];

/** 背景が描くもの（スタイルの作り方）。 */
export type BackgroundKind =
  /** OpenStreetMap のラスタータイル。 */
  | 'osm'
  /** 同梱の陸地の GeoJSON。 */
  | 'simple'
  /** 利用者の XYZ のタイル。 */
  | 'custom'
  /** 利用者のタイルの URL が空、または使えない。海の色だけを描く。 */
  | 'custom-empty';

/** 背景の解決結果。 */
export interface ResolvedBackground {
  readonly kind: BackgroundKind;
  /** 使えない理由。使えるなら undefined。`empty` はまだ入力していない。 */
  readonly problem?: TileUrlProblem | 'empty';
  /** 取得先のタイルの URL の雛形（`osm`、`custom`）。 */
  readonly tileUrl?: string;
}

/** ズームの範囲（MapLibre と deck.gl で共通の、世界が 512 px となるズーム）。 */
export interface ZoomRange {
  readonly min: number;
  readonly max: number;
}

/** 地図の最大ズーム。OSM のタイルは 19 まで（D-51）。 */
export const MAP_MAX_ZOOM = 19;
/** 地図の最小ズーム。 */
export const MAP_MIN_ZOOM = 0;

/** 海の色（落ち着いた青灰色）。タイルを待つ間の下地にも使う。 */
export const SEA_COLOR = '#d6e2ea';
/** 陸の色（落ち着いた薄い灰褐色）。 */
export const LAND_COLOR = '#f1eee6';
/** 陸の輪郭の色。 */
export const LAND_OUTLINE_COLOR = '#c4bfae';

/**
 * ズームの範囲。背景によらず同じ（OSM の最大ズーム 19 に合わせ、簡易背景も同じにして、
 * 背景を切り替えても表示範囲が変わらないようにする）。
 */
export const MAP_ZOOM_RANGE: ZoomRange = { min: MAP_MIN_ZOOM, max: MAP_MAX_ZOOM };

/**
 * 背景の設定から、何を描くかを決める。
 *
 * 利用者のタイルは `checkTileUrl`（`https:` で `{z}{x}{y}` を含む）を通ったものだけを使う。
 *
 * @param setting - 背景の設定
 * @returns 解決結果
 */
export function resolveBackground(setting: BackgroundSetting): ResolvedBackground {
  switch (setting.background) {
    case 'osm':
      return { kind: 'osm', tileUrl: OSM_TILE_URL };
    case 'simple':
      return { kind: 'simple' };
    case 'custom': {
      const url = setting.customTiles.url;
      if (url === '') return { kind: 'custom-empty', problem: 'empty' };
      const check = checkTileUrl(url);
      // 【TS】`check.ok` で判別共用体が絞られ、false の枝では `check.problem` が読める。
      if (!check.ok) return { kind: 'custom-empty', problem: check.problem };
      return { kind: 'custom', tileUrl: url };
    }
    default:
      return assertNeverBackground(setting.background);
  }
}

// 【TS】`never` は「ここには来ない」型。背景の種類を足して `case` を書き忘れると、
//       ここの引数の型が合わずコンパイルエラーになる（網羅性の検査）。
function assertNeverBackground(x: never): never {
  throw new Error(`未対応の背景です: ${String(x)}`);
}

/**
 * URL からホスト名を取り出す（小文字。ポートは除く）。`URL` クラスを使わず文字列で処理する
 * （`{z}` を含む雛形は `URL` に通すと符号化されるため。tileUrl.ts と同じ理由）。
 *
 * @param url - `https://` で始まるタイルの URL
 * @returns ホスト名。取り出せなければ空文字
 */
export function hostOfTileUrl(url: string): string {
  const rest = url.replace(/^https:\/\//iu, '');
  const authority = rest.split(/[/?#]/u, 1)[0] ?? '';
  return authority.replace(/:\d*$/u, '').toLowerCase();
}

/**
 * 背景に応じた帰属表示を選ぶ（FR-MP-06）。
 *
 * - OSM: 「© OpenStreetMap contributors」（著作権のページへのリンク）。`reportMapErrorLabel` があれば、
 *   「地図の誤りを報告」のリンクを添える。
 * - 簡易背景: 「Natural Earth」（出典のページへのリンク）。
 * - 利用者のタイル: 利用者が書いた文。空ならホスト名。
 * - 利用者のタイルが使えないとき: 何も描かないので、帰属表示も出さない。
 *
 * @param setting - 背景の設定
 * @param texts - 文言
 * @returns 帰属表示の部品。出さないときは空
 */
export function attributionFor(
  setting: BackgroundSetting,
  texts: BackgroundTexts = {},
): MapAttribution {
  const resolved = resolveBackground(setting);
  switch (resolved.kind) {
    case 'osm': {
      const parts: AttributionPart[] = [{ text: OSM_ATTRIBUTION_TEXT, href: OSM_COPYRIGHT_URL }];
      if (texts.reportMapErrorLabel !== undefined && texts.reportMapErrorLabel !== '')
        parts.push({ text: texts.reportMapErrorLabel, href: OSM_FIX_THE_MAP_URL });
      return parts;
    }
    case 'simple':
      return [
        { text: texts.simpleAttribution ?? SIMPLE_ATTRIBUTION_TEXT, href: NATURAL_EARTH_URL },
      ];
    case 'custom': {
      const written = setting.customTiles.attribution.trim();
      // 【なぜ】書いていなければホスト名を出す。タイルの出どころを、見る人が必ず確かめられるようにする（D-51）。
      const text = written !== '' ? written : hostOfTileUrl(resolved.tileUrl ?? '');
      return text === '' ? [] : [{ text }];
    }
    case 'custom-empty':
      return [];
    default:
      return assertNeverKind(resolved.kind);
  }
}

function assertNeverKind(x: never): never {
  throw new Error(`未対応の背景です: ${String(x)}`);
}

/** スタイルを組み立てるときの設定。 */
export interface StyleOptions {
  /** 簡易背景の GeoJSON の絶対 URL（`public/geo/land-50m.geojson`）。 */
  readonly landUrl: string;
}

/**
 * 背景の設定から MapLibre のスタイルを組み立てる。
 *
 * 【なぜ】スタイルはコードで組み、外部のスタイル JSON を読まない（NFR-02）。
 * `glyphs`（文字の層）と `sprite` は持たず、記号の層も作らない。外部のフォント配信へ通信しないため（D-51）。
 * 平面の地図（Web メルカトル）なので、`projection` は mercator を明示する。
 * 先読みや画面外のタイルの取得を増やさないため、ラスターのタイルは 256 px、`maxzoom` は 19 のままにする。
 *
 * @param setting - 背景の設定
 * @param options - スタイルの設定
 * @returns MapLibre のスタイル
 */
export function buildStyle(setting: BackgroundSetting, options: StyleOptions): StyleSpecification {
  const resolved = resolveBackground(setting);
  const base = {
    version: 8 as const,
    projection: { type: 'mercator' as const },
    layers: [{ id: 'sea', type: 'background' as const, paint: { 'background-color': SEA_COLOR } }],
  };
  switch (resolved.kind) {
    case 'osm':
    case 'custom':
      return {
        ...base,
        sources: {
          tiles: {
            type: 'raster',
            // 【なぜ】雛形をそのまま 1 本だけ渡す。OSM の規約はサブドメインの使い分けを禁じている（D-51）。
            tiles: [resolved.tileUrl ?? OSM_TILE_URL],
            tileSize: 256,
            minzoom: 0,
            maxzoom: MAP_MAX_ZOOM,
            // 帰属表示は MapLibre の部品ではなく、engine が自分の要素で出す（畳まれないように）。
          },
        },
        layers: [...base.layers, { id: 'tiles', type: 'raster', source: 'tiles' }],
      };
    case 'simple':
      return {
        ...base,
        sources: { land: { type: 'geojson', data: options.landUrl } },
        layers: [
          ...base.layers,
          { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': LAND_COLOR } },
          {
            id: 'land-outline',
            type: 'line',
            source: 'land',
            paint: { 'line-color': LAND_OUTLINE_COLOR, 'line-width': 0.6 },
          },
        ],
      };
    case 'custom-empty':
      return { ...base, sources: {} };
    default:
      return assertNeverKind(resolved.kind);
  }
}
