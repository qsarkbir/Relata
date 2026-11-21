import { createStore } from 'zustand/vanilla';
import type { Dataset } from '../core/model';

import type { ImportSettings, MissingToken, ColumnCalendar } from '../core/project';
/** 既存APIを保つための別名（共通型の所有者はcore/project）。 */
export type StoredImportSettings = ImportSettings;
/** 既存APIを保つための欠損記号型。 */
export type StoredMissingToken = MissingToken;
/** 既存APIを保つための暦型。 */
export type StoredColumnCalendar = ColumnCalendar;
/** 既定の読み込み設定（`io/project` の `DEFAULT_IMPORT_SETTINGS` と同じ値）。 */
export const EMPTY_IMPORT_SETTINGS: StoredImportSettings = {
  missingTokens: [],
  columnCalendars: [],
};

/** dataStore の状態と操作。 */
export interface DataState {
  /** 読み込んだデータ。未読み込みなら null。 */
  readonly dataset: Dataset | null;
  /**
   * 読み込みの設定（欠損の記号、文字コード、列ごとの暦）。
   * 【なぜ】Dataset の一部ではなく、データと並べて持つ。プロジェクトに保存し、再読み込みで使う（D-24）。
   * 読み込みのウィザード（T1-17）が書き換える。
   */
  readonly importSettings: StoredImportSettings;
  /**
   * データを置き換える。Dataset は不変なので、変えるときは新しい値を渡す。
   * フィルタの履歴は `bindFilterToData` が初期化する。
   *
   * @param dataset - 新しいデータ。空にするときは null
   */
  readonly setDataset: (dataset: Dataset | null) => void;
  /**
   * 読み込みの設定を置き換える。
   *
   * @param settings - 新しい設定
   */
  readonly setImportSettings: (settings: StoredImportSettings) => void;
  /**
   * データと読み込みの設定を 1 回の更新で入れる（プロジェクトの読み込み用）。
   *
   * 【なぜ】2 回に分けると、購読者（自動保存など）が「新しい設定と古いデータ」の組を見てしまう。
   *
   * @param dataset - 新しいデータ
   * @param settings - 新しい読み込みの設定
   */
  readonly loadDataset: (dataset: Dataset, settings: StoredImportSettings) => void;
}

/**
 * dataStore を作る。
 *
 * @returns Zustand のストア
 */
// 【なぜ】読み込み時の警告（設計書 §10）は、io の型（ProjectWarning）に依存するため state には置けない。
//       views の `projectNotice` が、読み込みの結果として持つ（D-33 (3)、(8)）。
export function createDataStore() {
  return createStore<DataState>()((set) => ({
    dataset: null,
    importSettings: EMPTY_IMPORT_SETTINGS,
    setDataset: (dataset) => {
      set({ dataset });
    },
    setImportSettings: (importSettings) => {
      set({ importSettings });
    },
    loadDataset: (dataset, importSettings) => {
      set({ dataset, importSettings });
    },
  }));
}

/** アプリ全体で使う dataStore。 */
export const dataStore = createDataStore();
