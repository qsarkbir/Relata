import type { StoreApi } from 'zustand/vanilla';

import type { DataState } from './dataStore';
import type { FilterStoreState } from './filterStore';
import { selectFilterState } from './filterStore';

import type { ProjectView, ProjectParts } from '../core/project';
import type { GraphViewSettings } from '../core/project';
import type { GraphViewState } from './graphViewStore';
import { isDefaultBundlingView } from './graphViewStore';
import type { WorkspaceViewState } from './workspaceStore';
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
}

// 既定と同じ束ねる設定を落とす（項目ごと無くす）。
function withoutDefaultBundling(view: GraphViewSettings): GraphViewSettings {
  if (view.bundling === undefined || !isDefaultBundlingView(view.bundling)) return view;
  // 【TS】分割代入の rest で `bundling` だけを除いた残りを作る（元のオブジェクトは変えない）。
  // 【なぜ】項目を列挙して作り直すと、設定に項目が増えたとき書き漏らす。コピーしてから `bundling` だけを消す。
  // 【TS】`-readonly [K in keyof T]` は、全項目の readonly を外した型（`delete` は任意の項目にだけ使える）。
  const copy: { -readonly [K in keyof GraphViewSettings]: GraphViewSettings[K] } = { ...view };
  delete copy.bundling;
  return copy;
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
  return {
    dataset,
    importSettings,
    view: {
      filter: VIEW_PROJECTORS.filter(f),
      // 【なぜ】束ねる設定が既定（無効）と同じなら書かない。任意の項目なので、無ければ既定が補われる（D-24）。
      ...(graphView == null ? {} : { graph: withoutDefaultBundling(graphView) }),
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
}
