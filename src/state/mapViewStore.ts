import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { DEFAULT_MAP_VIEW, resolveGeoSource } from '../core/project';
import type { CustomTiles, GraphViewSettings, MapViewSettings, MapViewport } from '../core/project';
import { isDefaultBundlingView } from './graphViewStore';
import { DEFAULT_GEO_SOURCE, sameGeoSource } from '../core/geo';
import type { GeoSource } from '../core/geo';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';

/**
 * 地図の、保存する設定のストア（D-46、D-51、D-52、D-59）。
 *
 * 持つのは、プロジェクトファイルに保存する「データ」だけ（背景、タイルの URL、表示範囲、座標の出どころ）。
 * ホバー中のノード、設定の引き出しの開閉、地図の読み込み状態などの一時的な UI 状態は、地図の部品の中
 * （views の `MapView.tsx`）に置き、ここには入れない。
 */
export interface MapViewState {
  /** 地図の設定（`view.map`）。 */
  readonly map: MapViewSettings;
  /**
   * 座標の出どころ（`view.geoSource`）。undefined は「まだ選んでいない」で、`view.graph.geoAttrs` の読み替えか
   * 既定（ノードの `geo`）になる（`resolveGeoSource`）。
   * 【なぜ】undefined と明示した `{ kind: 'geo' }` を区別する。明示した出どころは、古い `geoAttrs` に勝つため。
   */
  readonly geoSource: GeoSource | undefined;
  /**
   * 地図の設定を一部だけ変える。
   *
   * @param change - 変える項目
   */
  readonly patchMap: (change: Partial<MapViewSettings>) => void;
  /**
   * 利用者のタイルの設定を一部だけ変える。URL を編集したら、除いた鍵の項目名の一覧（`removedParams`）は消す。
   *
   * 【なぜ】`removedParams` は「開いたファイルの URL から鍵を除いた」という過去の事実の記録で、
   * 利用者が URL を入れ直したら（または別の URL にしたら）意味を失う。消すのは画面の役目（D-52）。
   *
   * @param change - 変える項目（`url`、`attribution`）
   */
  // 【TS】`Pick<T, 'a' | 'b'>` は T から項目 a と b だけを取り出した型、`Partial<…>` はその全項目を省略可にした型。
  //       合わせて「url と attribution のうち、変えたいものだけを渡せる」引数の型になる（`removedParams` は渡せない）。
  readonly patchCustomTiles: (change: Partial<Pick<CustomTiles, 'url' | 'attribution'>>) => void;
  /**
   * 表示範囲を保存する（地図の操作が止まったとき）。null は「データに合わせる」に戻す。
   *
   * @param viewport - 表示範囲
   */
  readonly setViewport: (viewport: MapViewport | null) => void;
  /**
   * 座標の出どころを変える。
   *
   * @param source - 出どころ。undefined で「選んでいない」に戻す
   */
  readonly setGeoSource: (source: GeoSource | undefined) => void;
  /**
   * 設定を置き換える。省略した項目は既定に戻る（保存ファイルに項目が無いとき、既定で補うため）。
   *
   * @param next - 新しい設定
   */
  readonly reset: (next?: {
    readonly map?: MapViewSettings;
    readonly geoSource?: GeoSource;
  }) => void;
}

/**
 * 地図の設定が既定と同じ内容かを調べる。
 *
 * 【なぜ】既定のままなら保存しない（任意の項目。D-24）。参照ではなく内容で比べる。
 * 設定は JSON に書ける単純な値だけなので、項目ごとに比べる。
 *
 * @param m - 設定
 * @returns 既定と同じなら true
 */
export function isDefaultMapView(m: MapViewSettings): boolean {
  const d = DEFAULT_MAP_VIEW;
  if (m === d) return true;
  return (
    m.background === d.background &&
    m.customTiles.url === d.customTiles.url &&
    m.customTiles.attribution === d.customTiles.attribution &&
    (m.customTiles.removedParams === undefined || m.customTiles.removedParams.length === 0) &&
    m.viewport === null &&
    m.edgeShape === d.edgeShape &&
    m.direction === d.direction &&
    JSON.stringify(m.encoding) === JSON.stringify(d.encoding) &&
    m.labels === d.labels &&
    m.playback.particles === d.playback.particles &&
    m.playback.cumulativeDegree === d.playback.cumulativeDegree &&
    isDefaultBundlingView(m.bundling)
  );
}

/**
 * 保存する座標の出どころを決める。既定と同じなら undefined（保存しない）。
 *
 * 【なぜ】明示した `{ kind: 'geo' }` でも、`view.graph.geoAttrs` が（両方そろって）あって読み替えが働くなら、
 * 保存しないと開き直したときに出どころが変わる。読み替えの結果が既定のままのときだけ省く。
 *
 * @param geoSource - ストアの出どころ
 * @param graph - `view.graph`（`geoAttrs` だけを見る）
 * @returns 保存する出どころ。保存しないなら undefined
 */
export function geoSourceToSave(
  geoSource: GeoSource | undefined,
  graph: Pick<GraphViewSettings, 'geoAttrs'> | undefined,
): GeoSource | undefined {
  if (geoSource === undefined) return undefined;
  if (
    sameGeoSource(geoSource, DEFAULT_GEO_SOURCE) &&
    sameGeoSource(resolveGeoSource(undefined, graph), DEFAULT_GEO_SOURCE)
  )
    return undefined;
  return geoSource;
}

/**
 * 地図の設定のストアを作る。テストごとに新しいストアを作れるよう、関数にしてある。
 *
 * @returns 新しいストア
 */
export function createMapViewStore() {
  return createStore<MapViewState>()((set, get) => ({
    map: DEFAULT_MAP_VIEW,
    geoSource: undefined,
    patchMap: (change) => {
      set({ map: { ...get().map, ...change } });
    },
    patchCustomTiles: (change) => {
      const { map } = get();
      const urlChanged = change.url !== undefined && change.url !== map.customTiles.url;
      // 【TS】`removedParams` を分割代入で取り除き、残りで新しい CustomTiles を作る（書き換えずに消す）。
      const { removedParams, ...rest } = map.customTiles;
      const keep = urlChanged || removedParams === undefined ? {} : { removedParams };
      set({ map: { ...map, customTiles: { ...rest, ...change, ...keep } } });
    },
    setViewport: (viewport) => {
      set({ map: { ...get().map, viewport } });
    },
    setGeoSource: (geoSource) => {
      set({ geoSource });
    },
    reset: (next) => {
      set({ map: next?.map ?? DEFAULT_MAP_VIEW, geoSource: next?.geoSource });
    },
  }));
}

/**
 * データの置き換えで、前のデータに結びついた設定を初期化する（表示範囲と座標の出どころ）。
 * 背景とタイルの設定は利用者の好みなので保つ。
 *
 * 【なぜ】表示範囲は前のデータの座標に合わせた値なので、null（新しいデータに合わせる）に戻す。
 * 座標の出どころは前のデータの属性名を指すことがある。プロジェクトを開くときは applySnapshot が置き直す。
 *
 * @param store - 地図のストア
 * @param data - データのストア
 * @returns 購読解除
 */
export function bindMapViewToData(
  store: StoreApi<MapViewState>,
  data: StoreApi<DataState>,
): () => void {
  return data.subscribe((s, prev) => {
    if (s.dataset === prev.dataset) return;
    const { map } = store.getState();
    store.getState().reset({ map: { ...map, viewport: null } });
  });
}

/** アプリ全体の地図の設定。 */
export const mapViewStore = createMapViewStore();
bindMapViewToData(mapViewStore, dataStore);
