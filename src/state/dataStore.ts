import { createStore } from 'zustand/vanilla';
import type { Dataset } from '../core/model';

/** dataStore の状態と操作。 */
export interface DataState {
  /** 読み込んだデータ。未読み込みなら null。 */
  readonly dataset: Dataset | null;
  /**
   * データを置き換える。Dataset は不変なので、変えるときは新しい値を渡す。
   *
   * @param dataset - 新しいデータ。空にするときは null
   */
  readonly setDataset: (dataset: Dataset | null) => void;
}

/**
 * dataStore を作る。
 *
 * @returns Zustand のストア
 */
// 【なぜ】読み込み時の警告（設計書 §10）は、読み込みを作る T1-17 で足す。型が未定のものは作らない（D-25）。
export function createDataStore() {
  return createStore<DataState>()((set) => ({
    dataset: null,
    setDataset: (dataset) => {
      set({ dataset });
    },
  }));
}

/** アプリ全体で使う dataStore。 */
export const dataStore = createDataStore();
