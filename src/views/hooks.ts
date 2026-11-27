import { useCallback } from 'react';
import { useStore } from 'zustand';
import { translate } from '../i18n';
import type { MessageKey, MessageParams } from '../i18n';
import {
  dataStore,
  displayStore,
  filterStore,
  mapViewStore,
  selectionStore,
  timelineStore,
  timeStore,
  uiStore,
  workspaceStore,
} from '../state';
import type {
  DataState,
  DisplayState,
  FilterStoreState,
  MapViewState,
  SelectionState,
  TimelineViewState,
  TimeStoreState,
  UiState,
  WorkspaceViewState,
} from '../state';
import { projectNoticeStore } from './projectNotice';
import type { ProjectNoticeState } from './projectNotice';

/**
 * uiStore の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
// 【TS】`<T>` はジェネリクス。「selector が返す型 T を、そのまま戻り値の型にする」という関係を表す。
//       呼ぶ側で `useUi((s) => s.locale)` と書くと、T は Locale と推論される。
// 【なぜ】値の一部だけを購読すると、その値が変わったときだけ再描画される。
export function useUi<T>(selector: (s: UiState) => T): T {
  return useStore(uiStore, selector);
}

/**
 * dataStore の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useData<T>(selector: (s: DataState) => T): T {
  return useStore(dataStore, selector);
}

/**
 * filterStore の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useFilter<T>(selector: (s: FilterStoreState) => T): T {
  return useStore(filterStore, selector);
}

/**
 * selectionStore（ノードと元のエッジの選択）の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useSelection<T>(selector: (s: SelectionState) => T): T {
  return useStore(selectionStore, selector);
}

/**
 * 現在の言語で翻訳する関数を返す。
 *
 * @returns `t(key, params)`
 */
export function useT(): (key: MessageKey, params?: MessageParams) => string {
  const locale = useUi((s) => s.locale);
  return useCallback((key, params) => translate(locale, key, params), [locale]);
}

/**
 * 保存と読み込みの知らせ（projectNotice）の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useProjectNotice<T>(selector: (s: ProjectNoticeState) => T): T {
  return useStore(projectNoticeStore, selector);
}

/**
 * workspaceStore（下の段と表の保存する設定）の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useWorkspaceView<T>(selector: (s: WorkspaceViewState) => T): T {
  return useStore(workspaceStore, selector);
}

/**
 * mapViewStore（地図の設定と座標の出どころ）の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useMapView<T>(selector: (s: MapViewState) => T): T {
  return useStore(mapViewStore, selector);
}

/**
 * displayStore（表示する暦など、全ビュー共通の表示設定）の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useDisplay<T>(selector: (s: DisplayState) => T): T {
  return useStore(displayStore, selector);
}

/**
 * timelineStore（年表の保存する設定）の一部を購読する。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useTimelineView<T>(selector: (s: TimelineViewState) => T): T {
  return useStore(timelineStore, selector);
}

/**
 * timeStore（時間の再生の状態。時刻、方式、窓の幅、速度、再生中か）の一部を購読する。
 *
 * 【なぜ】グラフ、年表、適用中の条件の行が同じこの状態を読む（FR-TM-03）。自分の時計や写しは持たない。
 *
 * @param selector - 取り出す値を選ぶ関数
 * @returns 選んだ値
 */
export function useTime<T>(selector: (s: TimeStoreState) => T): T {
  return useStore(timeStore, selector);
}
