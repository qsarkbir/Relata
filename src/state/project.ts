import type { StoreApi } from 'zustand/vanilla';
import type { FilterState } from '../core/filter';
import type { Dataset } from '../core/model';
import type { DataState, StoredImportSettings } from './dataStore';
import type { FilterStoreState } from './filterStore';
import { selectFilterState } from './filterStore';

/** プロジェクトの表示状態。`io/project` の `ProjectView` と同じ形（D-33 (8)）。 */
export interface ProjectSnapshotView {
  readonly filter: FilterState;
}

/**
 * プロジェクトとして保存する中身。`io/project` の `ProjectParts` と同じ形（state は io を import できない。D-26）。
 */
export interface ProjectSnapshot {
  readonly dataset: Dataset;
  readonly importSettings: StoredImportSettings;
  readonly view: ProjectSnapshotView;
}

// 【TS】`[K in keyof T]-?` は、T の全キーについて「任意」の印（?）を外した表を作る。
//       `ProjectSnapshotView` に任意の項目を足すと、この表にも書かないと型エラーになる（書き忘れの防止）。
/** `view` の各項目を、ストアから取り出す関数の表。 */
const VIEW_PROJECTORS: {
  readonly [K in keyof ProjectSnapshotView]-?: (f: FilterStoreState) => ProjectSnapshotView[K];
} = {
  filter: selectFilterState,
};

/**
 * ストアから保存する中身を取り出す。
 *
 * @param data - dataStore
 * @param filter - filterStore
 * @returns 保存する中身。データが無ければ null（保存するものが無い）
 */
export function takeSnapshot(
  data: StoreApi<DataState>,
  filter: StoreApi<FilterStoreState>,
): ProjectSnapshot | null {
  const { dataset, importSettings } = data.getState();
  if (dataset === null) return null;
  const f = filter.getState();
  return { dataset, importSettings, view: { filter: VIEW_PROJECTORS.filter(f) } };
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
 */
export function applySnapshot(
  snapshot: ProjectSnapshot,
  data: StoreApi<DataState>,
  filter: StoreApi<FilterStoreState>,
): void {
  data.getState().loadDataset(snapshot.dataset, snapshot.importSettings);
  filter.getState().reset(snapshot.view.filter);
}
