import { createStore } from 'zustand/vanilla';
import type { Dataset } from '../core/model';

/**
 * 「利用者のタイルの地図を、開いた人が許すまで読まない」ための待ちの状態（一時的な UI 状態。保存しない）。
 *
 * 【なぜ】ファイルの作者が、地図のタブを開いた状態で保存し、背景に自分のサーバーのタイルを指定すると、
 * 開いただけで、開いた人の IP と時刻と表示範囲がそのサーバーに伝わる。ファイルを開いたとき、背景が
 * `custom` なら、地図を自動では読まず、ホスト名を見せて、開いた人が押したときだけ読む（D-51 補足）。
 * 自動保存の復元（利用者自身の作業）は対象にしない。
 */
export interface MapGateState {
  /** 待っているときの、タイルのホスト名と、そのデータ。無ければ null。データが替われば無効（`held` を使う）。 */
  readonly hold: { readonly host: string; readonly dataset: Dataset } | null;
  /**
   * 待たせる。
   *
   * @param host - タイルのホスト名
   * @param dataset - 読み込んだデータ
   */
  readonly holdFor: (host: string, dataset: Dataset) => void;
  /** 待ちを解く（地図の読み込みを許す）。 */
  readonly release: () => void;
}

/**
 * 待ちのストアを作る。
 *
 * @returns ストア
 */
export function createMapGateStore() {
  return createStore<MapGateState>()((set) => ({
    hold: null,
    holdFor: (host, dataset) => {
      set({ hold: { host, dataset } });
    },
    release: () => {
      set({ hold: null });
    },
  }));
}

/** アプリ全体の待ちの状態。 */
export const mapGateStore = createMapGateStore();

/**
 * タイルの URL からホスト名を取り出す。雛形（`{z}` など）を含んでいてよい。
 *
 * @param url - 利用者のタイルの URL
 * @returns ホスト名。取り出せなければ null
 */
export function tileHost(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    return host === '' ? null : host;
  } catch {
    return null;
  }
}
