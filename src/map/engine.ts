/**
 * 地図の部品の入口（命令的な API）。素の DOM 要素に、MapLibre GL の地図と deck.gl の重ねを作る
 * （FR-MP-01、FR-MP-06、NFR-02。D-50、D-51、D-52）。
 *
 * React を使わず、views の薄い部品が `import('../map')` で動的に読み込んで呼ぶ。
 * 時間や絞り込みの状態は持たない（設計書 §9.2、D-17）。持つのは、地図の見た目の状態
 * （背景、表示範囲）だけで、保存と共有は呼ぶ側（state）が行う。
 *
 * 【なぜ】deck.gl は `interleaved: false`（MapLibre と別の canvas に重ねる）で使う。
 * 同じ WebGL の文脈に混ぜる方式は、MapLibre 本体の更新に deck.gl が追随する必要があり、
 * 不具合の切り分けが難しい。別の canvas なら互いの描画に干渉せず、地図を平面で使う（D-54）本機能では
 * 層の前後の入れ替えも要らない。PNG の書き出し（T3-06b）は、2 枚の canvas を重ねて描き直す。
 */
import { Map as MapLibreMap, setWorkerUrl } from 'maplibre-gl';
// 【なぜ】MapLibre 6 の Worker は、既定では「自分の隣の maplibre-gl-worker.mjs」を探す。Vite がまとめた後は
//   隣に無く 404 になるので、`?url` でファイルを出力に含めて、その場所を教える（外部への通信ではなく同じサイトの中）。
//   Worker の本体は他のファイルを import しない 1 つのファイルなので、`?url` で足りる。
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { LayersList } from '@deck.gl/core';
import type { GeoBBox } from '../core/geo';
import type { MapViewport } from '../core/project/mapView';
import {
  attributionFor,
  buildStyle,
  resolveBackground,
  MAP_ZOOM_RANGE,
  type BackgroundSetting,
  type BackgroundTexts,
  type MapAttribution,
  type ResolvedBackground,
} from './background';
import {
  cameraToViewport,
  clampViewport,
  fitViewport,
  sameViewport,
  viewportToCamera,
  WORLD_BBOX,
} from './viewport';
import './map.css';

// 絶対 URL にして渡す（基準の違う場所から読まれても迷わないように）。モジュールを読んだときに 1 回だけ。
setWorkerUrl(new URL(workerUrl, document.baseURI).href);

/** 簡易背景の GeoJSON の、サイト内の場所（`public/geo/`。D-51）。 */
const LAND_PATH = 'geo/land-50m.geojson';

/** 地図を作れなかった理由。 */
export type MapUnavailableReason =
  /** この環境で WebGL2 が使えない（MapLibre 6 は WebGL2 が必須）。 */
  | 'webgl2-unavailable'
  /** WebGL2 はあるが、地図の初期化に失敗した。 */
  | 'init-failed';

/** 表示範囲の変化の段階。`move` は動いている間（毎フレーム）、`end` は止まったとき。 */
export type ViewportPhase = 'move' | 'end';

/** 表示範囲の変化を受け取る関数。 */
export type ViewportListener = (viewport: MapViewport, phase: ViewportPhase) => void;

/** 地図の実行中の問題。画面の知らせに使う。 */
export interface MapEngineError {
  /** `tile`: タイルの取得に失敗、`land`: 簡易背景のデータの取得に失敗、`other`: そのほか。 */
  readonly kind: 'tile' | 'land' | 'other';
  readonly message: string;
}

/** `createMapEngine` の設定。 */
export interface MapEngineOptions {
  /** 背景の設定。`view.map` の `background` と `customTiles` をそのまま渡せる。 */
  readonly background: BackgroundSetting;
  /** 背景まわりの文言（簡易背景の帰属表示の文、「地図の誤りを報告」のリンク）。 */
  readonly texts?: BackgroundTexts;
  /**
   * 最初の表示範囲。null か省略なら、世界全体を枠に収める。
   * 【なぜ】null は「データに合わせる」を意味する（`MapViewSettings.viewport`）。
   * データに合わせる計算は、座標を知っている呼ぶ側が `fitBounds` で行う。
   */
  readonly viewport?: MapViewport | null;
  /** 実行中の問題の通知（タイルや簡易背景のデータの取得の失敗）。 */
  readonly onError?: (error: MapEngineError) => void;
  /** 簡易背景のデータの URL を差し替える（既定は `public/geo/land-50m.geojson`）。 */
  readonly landUrl?: string;
}

/** `fitBounds` の設定。 */
export interface FitBoundsOptions {
  /** 余白（px。既定 40）。 */
  readonly padding?: number;
  /** ズームの上限（既定 12。点が 1 つのときに寄りすぎないため）。 */
  readonly maxZoom?: number;
}

/** 地図の部品の操作。 */
export interface MapEngine {
  /**
   * 背景を切り替える。簡易背景に切り替えたときだけ、陸地のデータを読み込む。
   *
   * @param background - 背景の設定
   * @param texts - 文言（省略すると、作ったときの文言のまま）
   * @returns 解決結果。`problem` が付けば、利用者のタイルが使えない（海の色だけを描く）
   */
  setBackground(background: BackgroundSetting, texts?: BackgroundTexts): ResolvedBackground;
  /** 今の帰属表示（右下に出ているもの。書き出しの画像に入れるときに使う）。 */
  getAttribution(): MapAttribution;
  /**
   * 表示範囲を設定する（通知は出さない。呼んだ側が自分で決めた値なので、戻ってこない）。
   *
   * @param viewport - 表示範囲（範囲外は収める）
   */
  setViewport(viewport: MapViewport): void;
  /** 今の表示範囲。 */
  getViewport(): MapViewport;
  /**
   * 緯度経度の範囲を枠に収める（「全体を表示」と初めて開いたときの表示）。通知は出さない。
   *
   * @param bbox - 範囲（`west > east` は 180° をまたぐ）
   * @param options - 余白、ズームの上限
   * @returns 実際の表示範囲（枠の大きさと地図の制約で収めた後の値。保存するのはこれ）
   */
  fitBounds(bbox: GeoBBox, options?: FitBoundsOptions): MapViewport;
  /**
   * 表示範囲の変化（利用者の操作と、ズームの操作）を受け取る。`setViewport` と `fitBounds` では呼ばれない。
   *
   * @param listener - 受け取る関数
   * @returns 受け取りをやめる関数
   */
  onViewportChange(listener: ViewportListener): () => void;
  /** ズームを 1 段階上げる（操作ボタン用）。 */
  zoomIn(): void;
  /** ズームを 1 段階下げる（操作ボタン用）。 */
  zoomOut(): void;
  /** 枠の大きさに合わせ直す。枠の大きさが変わったとき（タブの切り替えで見えたときなど）に呼ぶ。 */
  resize(): void;
  /**
   * deck.gl の層を差し替える（T3-04 以降の、ノードとエッジの描画用）。
   *
   * @param layers - 層の一覧
   */
  setLayers(layers: LayersList): void;
  /** 表示中のタイルなどを読み終えたか（テストの待ち合わせ用）。 */
  isLoaded(): boolean;
  /** 地図を壊して、DOM と WebGL の資源を解放する。何度呼んでもよい。 */
  destroy(): void;
}

/** `createMapEngine` の結果。 */
export type MapEngineResult =
  | { readonly ok: true; readonly engine: MapEngine }
  | { readonly ok: false; readonly reason: MapUnavailableReason };

/**
 * WebGL2 が使えるかを、使い捨ての canvas で確かめる。
 *
 * @returns 使えれば true
 */
function hasWebGL2(): boolean {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2');
  if (gl === null) return false;
  // 【なぜ】確かめるだけに使った文脈をすぐ手放す（ブラウザが同時に持てる文脈の数には上限がある）。
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return true;
}

/**
 * 簡易背景のデータの絶対 URL を作る。
 *
 * 【なぜ】MapLibre は GeoJSON を Worker で読み、Worker からの相対 URL は基準がずれるので、絶対にしておく。
 * `import.meta.env.BASE_URL` は Vite の `base`（`/Relata/`）。
 *
 * @returns 絶対 URL
 */
function defaultLandUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}${LAND_PATH}`, document.baseURI).href;
}

/**
 * 帰属表示の要素の中身を作り直す（`textContent` で入れる。利用者の文を HTML として解釈しない）。
 * @param el - 帰属表示の要素
 * @param attribution - 表示する部品
 */
function renderAttribution(el: HTMLElement, attribution: MapAttribution): void {
  el.replaceChildren();
  attribution.forEach((part, i) => {
    if (i > 0) el.append(' | ');
    if (part.href === undefined) {
      const span = document.createElement('span');
      span.textContent = part.text;
      el.append(span);
    } else {
      const a = document.createElement('a');
      a.href = part.href;
      a.textContent = part.text;
      a.target = '_blank';
      a.rel = 'noopener';
      el.append(a);
    }
  });
}

/**
 * 地図の部品を作る。
 *
 * 作った時点で、選んだ背景のタイル（または簡易背景のデータ）の取得が始まる。呼ぶ前には通信しない（NFR-02）。
 * 地図は平面で、傾き・回転を使わない。`container` には、大きさが決まった（幅と高さが 0 でない）要素を渡す。
 * 大きさの変化は、中で `ResizeObserver` が見て合わせる（`container-type: size` の枠の中でも動く）。
 *
 * @param container - 地図を入れる要素（呼ぶ側が持つ。中身は地図が管理する）
 * @param options - 設定
 * @returns 操作、または作れなかった理由
 *
 * @example
 * ```ts
 * const r = createMapEngine(el, { background: { background: 'osm', customTiles: { url: '', attribution: '' } } });
 * if (r.ok) { r.engine.fitBounds(bbox); r.engine.onViewportChange((v, phase) => { if (phase === 'end') save(v); }); }
 * ```
 */
export function createMapEngine(
  container: HTMLElement,
  options: MapEngineOptions,
): MapEngineResult {
  if (!hasWebGL2()) return { ok: false, reason: 'webgl2-unavailable' };

  const landUrl = options.landUrl ?? defaultLandUrl();
  let texts: BackgroundTexts = options.texts ?? {};
  let setting = options.background;
  let styleKey = '';
  const range = MAP_ZOOM_RANGE;
  const initial = clampViewport(
    options.viewport ?? fitViewport(WORLD_BBOX, sizeOf(container)),
    range,
  );

  let map: MapLibreMap;
  try {
    const style = buildStyle(setting, { landUrl });
    styleKey = JSON.stringify(style);
    map = new MapLibreMap({
      container,
      style,
      ...viewportToCamera(initial),
      minZoom: range.min,
      maxZoom: range.max,
      // 平面の地図: 傾きと回転は使わない（D-54）。
      pitch: 0,
      minPitch: 0,
      maxPitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      // 【なぜ】世界を横に並べない。ノードは経度 -180〜180 の 1 枚にだけ描くので、
      //   複製した世界にはノードが出ず、混乱するため。
      renderWorldCopies: false,
      // 【なぜ】大きさの追随は、下の ResizeObserver が通知を出さずに行う。MapLibre 自身の追随
      //   （window と枠の監視）は、利用者の操作と見分けのつかない move を出すので切る。
      trackResize: false,
      // 帰属表示は自前の要素で出す。MapLibre のロゴと部品は使わない。
      attributionControl: false,
      maplibreLogo: false,
      // 【なぜ】期限切れのタイルを自動で取り直さない（OSM の規約に沿い、不要な再取得をしない。D-51）。
      refreshExpiredTiles: false,
      // ズーム中、まだ届いていない遠い段のタイルの取得は取り消す（既定どおり。明示して、変えないようにする）。
      cancelPendingTileRequestsWhileZooming: true,
    });
  } catch {
    return { ok: false, reason: 'init-failed' };
  }
  // 回転の操作を切る（キーボードの Shift+矢印、2 本指の回転）。
  map.keyboard.disableRotation();
  map.touchZoomRotate.disableRotation();

  const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
  map.addControl(overlay);

  const attributionEl = document.createElement('div');
  attributionEl.className = 'relata-map-attribution';
  attributionEl.dataset.mapAttribution = '';
  container.append(attributionEl);
  const showAttribution = (): MapAttribution => {
    const a = attributionFor(setting, texts);
    renderAttribution(attributionEl, a);
    return a;
  };
  let attribution = showAttribution();

  // 呼ぶ側の操作による動きは通知しない（戻ってきて循環するのを避ける）。
  let silent = false;
  const listeners = new Set<ViewportListener>();
  const emit = (phase: ViewportPhase): void => {
    if (silent || listeners.size === 0) return;
    const v = readViewport(map);
    for (const l of listeners) l(v, phase);
  };
  map.on('move', () => {
    emit('move');
  });
  map.on('moveend', () => {
    emit('end');
  });

  map.on('error', (e) => {
    if (options.onError === undefined) return;
    const cause: unknown = e.error;
    const message = cause instanceof Error ? cause.message : 'unknown error';
    const sourceId = (e as { sourceId?: unknown }).sourceId;
    // 【TS】MapLibre の error イベントの型は、取得元を明示しない。`sourceId` を型ガードで読んで分類する。
    const kind = sourceId === 'tiles' ? 'tile' : sourceId === 'land' ? 'land' : 'other';
    options.onError({ kind, message });
  });

  // 枠の大きさの変化に追随する。【なぜ】MapLibre 自身は window の resize しか見ない。
  // 【なぜ】大きさの変化で MapLibre が出す move の通知は、利用者の操作ではないので伝えない。
  //   伝えると、呼ぶ側が「表示範囲を利用者が決めた」と受け取り、「データに合わせる」（null）を失う。
  const resizeSilently = (): void => {
    const was = silent;
    silent = true;
    try {
      map.resize();
    } finally {
      silent = was;
    }
  };
  const observer = new ResizeObserver(resizeSilently);
  observer.observe(container);

  let destroyed = false;

  const engine: MapEngine = {
    setBackground(next, nextTexts) {
      setting = next;
      if (nextTexts !== undefined) texts = nextTexts;
      const style = buildStyle(setting, { landUrl });
      const key = JSON.stringify(style);
      // 【なぜ】同じスタイルなら入れ替えない（再取得と一瞬の白抜けを避ける）。
      if (key !== styleKey) {
        styleKey = key;
        map.setStyle(style, { diff: false });
      }
      attribution = showAttribution();
      return resolveBackground(setting);
    },
    getAttribution: () => attribution,
    setViewport(v) {
      const next = clampViewport(v, range);
      if (sameViewport(next, readViewport(map))) return;
      silent = true;
      try {
        map.jumpTo(viewportToCamera(next));
      } finally {
        silent = false;
      }
    },
    getViewport: () => readViewport(map),
    fitBounds(bbox, fitOptions) {
      const target = fitViewport(bbox, { ...sizeOf(container), ...fitOptions, range });
      silent = true;
      try {
        map.jumpTo(viewportToCamera(target));
      } finally {
        silent = false;
      }
      // 地図の制約（世界が枠を覆う最小ズームなど）で動いた後の値を返す。
      return readViewport(map);
    },
    onViewportChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    zoomIn: () => void map.zoomIn(),
    zoomOut: () => void map.zoomOut(),
    resize: resizeSilently,
    setLayers(layers) {
      overlay.setProps({ layers });
    },
    isLoaded: () => map.loaded(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      observer.disconnect();
      listeners.clear();
      map.removeControl(overlay);
      overlay.finalize();
      map.remove();
      attributionEl.remove();
    },
  };
  return { ok: true, engine };
}

// 地図の今の表示範囲。
function readViewport(map: MapLibreMap): MapViewport {
  const c = map.getCenter();
  return cameraToViewport({ center: [c.lng, c.lat], zoom: map.getZoom() });
}

// 枠の大きさ（px）。
function sizeOf(el: HTMLElement): { width: number; height: number } {
  return { width: el.clientWidth, height: el.clientHeight };
}
