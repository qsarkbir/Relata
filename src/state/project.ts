import type { StoreApi } from 'zustand/vanilla';

import type { DataState } from './dataStore';
import type { FilterStoreState } from './filterStore';
import { selectFilterState } from './filterStore';

import type { ProjectView, ProjectParts } from '../core/project';
import type { GraphViewState } from './graphViewStore';
import type { WorkspaceViewState } from './workspaceStore';
import type { MapViewState } from './mapViewStore';
import { geoSourceToSave, isDefaultMapView } from './mapViewStore';
import type { TimelineViewState } from './timelineStore';
import { isDefaultTimeline } from './timelineStore';
import { DEFAULT_TABLE_VIEW, DEFAULT_WORKSPACE } from '../core/project';
import type { DisplayState } from './displayStore';
import { DEFAULT_CALENDAR_DISPLAY, isDefaultTimeSettings } from '../core/time';
import type { TimeStoreState } from './timeStore';
import { selectTimeSettings } from './timeStore';
/** 保存用表示状態の共通型。 */
export type ProjectSnapshotView = ProjectView;
/** 保存する中身の共通型。 */
export type ProjectSnapshot = ProjectParts;
// 【TS】`[K in keyof T]-?` は、T の全キーについて「任意」の印（?）を外した表を作る。
//       `ProjectSnapshotView` に任意の項目を足すと、この表にも書かないと型エラーになる（書き忘れの防止）。
/** `view` の各項目を、ストアから取り出す関数の表。 */
const VIEW_PROJECTORS: {
  readonly [K in keyof Pick<ProjectSnapshotView, 'filter'>]-?: (
    f: FilterStoreState,
  ) => ProjectSnapshotView[K];
} = {
  filter: selectFilterState,
};

/**
 * 保存する表示設定のストアの組。どれも任意。
 * 【なぜ】位置引数を並べず 1 つのオブジェクトにまとめる。表示設定のストアが増えても（暦、年表など）、
 * 呼ぶ側の引数の順を気にせず、項目を足すだけで済む。
 */
export interface ViewTargets {
  readonly graph?: StoreApi<GraphViewState>;
  readonly workspace?: StoreApi<WorkspaceViewState>;
  /** 表示する暦（R-24）。渡したときだけ保存・復元の対象にする。 */
  readonly display?: StoreApi<DisplayState>;
  /** 年表の設定（R-23）。渡したときだけ保存・復元の対象にする。 */
  readonly timeline?: StoreApi<TimelineViewState>;
  /** 時間の再生の設定（FR-TM-02）。再生中かどうかは保存しない。 */
  readonly time?: StoreApi<TimeStoreState>;
  /** 地図の設定と座標の出どころ（D-46、D-59）。渡したときだけ保存・復元の対象にする。 */
  readonly map?: StoreApi<MapViewState>;
}

/**
 * ストアから保存する中身を取り出す。
 *
 * @param data - dataStore
 * @param filter - filterStore
 * @param targets - 任意の表示設定のストア（`graph`: グラフ表示、`workspace`: 下の段と表、`display`: 表示する暦）
 * @returns 保存する中身。データが無ければ null（保存するものが無い）
 */
export function takeSnapshot(
  data: StoreApi<DataState>,
  filter: StoreApi<FilterStoreState>,
  targets: ViewTargets = {},
): ProjectSnapshot | null {
  const { dataset, importSettings } = data.getState();
  if (dataset === null) return null;
  const f = filter.getState();
  const graphView = targets.graph?.getState().view;
  const ws = targets.workspace?.getState();
  const timeline = targets.timeline?.getState().timeline;
  const time = targets.time === undefined ? undefined : selectTimeSettings(targets.time.getState());
  const mapState = targets.map?.getState();
  const geoSource =
    mapState === undefined
      ? undefined
      : geoSourceToSave(mapState.geoSource, graphView ?? undefined);
  return {
    dataset,
    importSettings,
    view: {
      filter: VIEW_PROJECTORS.filter(f),
      ...(graphView == null ? {} : { graph: graphView }),
      // 【なぜ】既定のままなら書かない。任意の項目なので、無ければ読み込みで既定が補われる（D-44）。
      ...(ws === undefined || ws.table === DEFAULT_TABLE_VIEW ? {} : { table: ws.table }),
      ...(ws === undefined || ws.workspace === DEFAULT_WORKSPACE
        ? {}
        : { workspace: ws.workspace }),
      ...(targets.display === undefined
        ? {}
        : { display: { calendar: targets.display.getState().calendar } }),
      // 【なぜ】既定と同じ内容なら書かない（任意の項目。D-24）。
      ...(timeline === undefined || isDefaultTimeline(timeline) ? {} : { timeline }),
      // 【なぜ】再生中かどうかは保存しない（開いた直後に動き出さないため）。既定と同じなら書かない。
      ...(time === undefined || isDefaultTimeSettings(time) ? {} : { time }),
      // 【なぜ】地図の設定と座標の出どころも、既定と同じなら書かない（D-59。任意の項目）。
      ...(mapState === undefined || isDefaultMapView(mapState.map) ? {} : { map: mapState.map }),
      ...(geoSource === undefined ? {} : { geoSource }),
    },
  };
}

/**
 * 読み込んだプロジェクトをストアに入れる。
 *
 * 【なぜ】順序が大事。データと設定を 1 回の更新（`loadDataset`）で入れると、`bindFilterToData` が
 * フィルタを初期化する。保存されていたフィルタは必ずその後に `reset` で入れる（逆だと保存した状態が消える）。
 *
 * @param snapshot - 読み込んだ中身
 * @param data - dataStore
 * @param filter - filterStore
 * @param targets - 任意の表示設定のストア（`graph`: グラフ表示、`workspace`: 下の段と表、`display`: 表示する暦）
 */
export function applySnapshot(
  snapshot: ProjectSnapshot,
  data: StoreApi<DataState>,
  filter: StoreApi<FilterStoreState>,
  targets: ViewTargets = {},
): void {
  const { graph, workspace } = targets;
  data.getState().loadDataset(snapshot.dataset, snapshot.importSettings);
  filter.getState().reset(snapshot.view.filter);
  graph?.getState().setView(snapshot.view.graph ?? null);
  // 【なぜ】項目が無いファイル（版 1、新しい項目の無い版 2）は、既定に戻す（前のプロジェクトの設定を残さない）。
  workspace?.getState().reset({
    ...(snapshot.view.table === undefined ? {} : { table: snapshot.view.table }),
    ...(snapshot.view.workspace === undefined ? {} : { workspace: snapshot.view.workspace }),
  });
  targets.display
    ?.getState()
    .setCalendar(snapshot.view.display?.calendar ?? DEFAULT_CALENDAR_DISPLAY);
  targets.timeline?.getState().reset(snapshot.view.timeline);
  targets.time?.getState().reset(snapshot.view.time);
  // 【なぜ】項目が無いファイル（版 2 以前）は既定に戻す（前のプロジェクトの背景や表示範囲を残さない）。
  targets.map?.getState().reset({
    ...(snapshot.view.map === undefined ? {} : { map: snapshot.view.map }),
    ...(snapshot.view.geoSource === undefined ? {} : { geoSource: snapshot.view.geoSource }),
  });
}
