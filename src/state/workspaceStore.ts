import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { DEFAULT_TABLE_VIEW, DEFAULT_WORKSPACE, clampWorkspaceHeight } from '../core/project';
import type { TableViewSettings, WorkspaceSettings } from '../core/project';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';

/**
 * 下の段と表ビューの、保存する設定のストア（D-44）。
 *
 * 選択、ページ、ホバーなどの一時的な状態は持たない（選択は selectionStore、ページは表の部品の中）。
 */
export interface WorkspaceViewState {
  readonly table: TableViewSettings;
  readonly workspace: WorkspaceSettings;
  /**
   * 表の設定を一部だけ変える。
   *
   * @param change - 変える項目
   */
  readonly patchTable: (change: Partial<TableViewSettings>) => void;
  /**
   * 下の段の設定を一部だけ変える。高さは許す範囲に収める。
   *
   * @param change - 変える項目
   */
  readonly patchWorkspace: (change: Partial<WorkspaceSettings>) => void;
  /**
   * 設定を置き換える。省略した側は既定に戻る（保存ファイルに項目が無いとき、既定で補うため）。
   *
   * @param next - 新しい設定
   */
  readonly reset: (next?: {
    readonly table?: TableViewSettings;
    readonly workspace?: WorkspaceSettings;
  }) => void;
}

/**
 * 設定のストアを作る。テストごとに新しいストアを作れるよう、関数にしてある。
 *
 * @returns 新しいストア
 */
export function createWorkspaceStore() {
  return createStore<WorkspaceViewState>()((set, get) => ({
    table: DEFAULT_TABLE_VIEW,
    workspace: DEFAULT_WORKSPACE,
    patchTable: (change) => {
      set({ table: { ...get().table, ...change } });
    },
    patchWorkspace: (change) => {
      const next = { ...get().workspace, ...change };
      set({ workspace: { ...next, height: clampWorkspaceHeight(next.height) } });
    },
    reset: (next) => {
      set({
        table: next?.table ?? DEFAULT_TABLE_VIEW,
        workspace: next?.workspace ?? DEFAULT_WORKSPACE,
      });
    },
  }));
}

/**
 * データの置き換えで、前のデータの列や並べ替えを引き継がないよう初期化する。
 *
 * @param workspace - 設定のストア
 * @param data - データのストア
 * @returns 購読解除
 */
export function bindWorkspaceToData(
  workspace: StoreApi<WorkspaceViewState>,
  data: StoreApi<DataState>,
): () => void {
  return data.subscribe((s, prev) => {
    if (s.dataset !== prev.dataset) workspace.getState().reset();
  });
}

/** アプリ全体の、下の段と表の設定。 */
export const workspaceStore = createWorkspaceStore();
bindWorkspaceToData(workspaceStore, dataStore);
