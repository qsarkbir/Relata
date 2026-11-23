import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import {
  DEFAULT_TIME_SETTINGS,
  clearTime,
  pausePlayback,
  seekTime,
  setTimeMode,
  setTimeSpeed,
  setTimeWindowYears,
  startPlayback,
  stepTime,
  tickTime,
} from '../core/time';
import type {
  TimeAxis,
  TimeMode,
  TimeSettings,
  TimeSpeed,
  TimeState,
  TimeWindowYears,
} from '../core/time';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';
import { displayStore } from './displayStore';
import { getTimeAxis } from './timeAxis';
import { timelineStore } from './timelineStore';

/**
 * 時間の状態のストア（FR-TM-02、FR-TM-03、D-38、D-17）。
 *
 * 時刻、方式、窓の幅、速度は `view.time` に保存し、`playing`（再生中か）は保存しない一時的な状態。
 * グラフ、年表（フェーズ 3 では地図も）が同じこの状態を読んで描くので、連動する。時計は持たない:
 * `requestAnimationFrame` で `tick` を呼ぶ駆動は `src/app/` の 1 か所に置く（state を DOM に依存させない）。
 *
 * 更新の規則は `core/time/playback.ts` の純粋な関数で、ここはそれを呼んで値を入れ替えるだけ。
 */
export interface TimeStoreState extends TimeState {
  /** 再生を始める（時刻が無い、または終わりなら先頭から）。 */
  readonly play: () => void;
  /** 再生を止める（時刻は残る）。 */
  readonly pause: () => void;
  /** 再生中なら止め、止まっていれば始める。 */
  readonly toggle: () => void;
  /**
   * 経過した時間だけ進める（時計が呼ぶ）。
   *
   * @param dtMs - 経過ミリ秒
   */
  readonly tick: (dtMs: number) => void;
  /**
   * 1 コマ前後へ動かす（再生は止まる）。
   *
   * @param direction - 1 は次、-1 は前
   */
  readonly step: (direction: 1 | -1) => void;
  /**
   * 時刻を指定する（つまみの操作）。
   *
   * @param at - 時刻（JDN）
   */
  readonly seek: (at: number) => void;
  /** 時刻を解除する（グラフの薄い表示をやめる）。 */
  readonly clear: () => void;
  readonly setMode: (mode: TimeMode) => void;
  readonly setSpeed: (speed: TimeSpeed) => void;
  readonly setWindowYears: (years: TimeWindowYears) => void;
  /**
   * 保存した設定で置き換える。省略すると既定に戻る。再生中ではなくなる。
   *
   * @param next - 設定
   */
  readonly reset: (next?: TimeSettings) => void;
}

/**
 * 状態から、保存する設定の部分だけを取り出す（再生中かどうかは含めない）。
 *
 * @param s - 時間の状態
 * @returns 保存する設定
 */
export function selectTimeSettings(s: TimeState): TimeSettings {
  return { at: s.at, mode: s.mode, windowYears: s.windowYears, speed: s.speed };
}

/**
 * 時間のストアを作る。テストごとに新しいストアを作れるよう、関数にしてある。
 *
 * @param getAxis - 今の時刻の軸を返す関数（年表の軸）。null なら再生できない
 * @returns ストア
 */
// 【なぜ】軸を関数で受ける。ストアが他のストア（データ、年表、暦）を直接読むと、単体テストで
//   それらの用意が要る。アプリでは下の `timeStore` が、本物のストアから軸を求める関数を渡す。
export function createTimeStore(getAxis: () => TimeAxis | null) {
  return createStore<TimeStoreState>()((set, get) => {
    // 【TS】`(f: (s: TimeState) => TimeState)` は「状態を受けて新しい状態を返す関数」を受ける型。
    //   返した状態が同じ参照なら何も入れ替えない（購読者を無駄に起こさない）。
    const update = (f: (s: TimeState) => TimeState): void => {
      const before = get();
      const after = f(before);
      if (after === before) return;
      set({
        at: after.at,
        mode: after.mode,
        windowYears: after.windowYears,
        speed: after.speed,
        playing: after.playing,
      });
    };
    return {
      ...DEFAULT_TIME_SETTINGS,
      playing: false,
      play: () => {
        update((s) => startPlayback(s, getAxis()));
      },
      pause: () => {
        update(pausePlayback);
      },
      toggle: () => {
        update((s) => (s.playing ? pausePlayback(s) : startPlayback(s, getAxis())));
      },
      tick: (dtMs) => {
        update((s) => tickTime(s, dtMs, getAxis()));
      },
      step: (direction) => {
        update((s) => stepTime(s, direction, getAxis()));
      },
      seek: (at) => {
        const axis = getAxis();
        if (axis === null) return;
        update((s) => seekTime(s, at, axis));
      },
      clear: () => {
        update(clearTime);
      },
      setMode: (mode) => {
        update((s) => setTimeMode(s, mode));
      },
      setSpeed: (speed) => {
        update((s) => setTimeSpeed(s, speed));
      },
      setWindowYears: (years) => {
        update((s) => setTimeWindowYears(s, years));
      },
      reset: (next = DEFAULT_TIME_SETTINGS) => {
        set({ ...next, playing: false });
      },
    };
  });
}

/**
 * データの置き換えで、前のデータの時刻を解除して再生を止める（方式、窓の幅、速度は利用者の好みなので保つ）。
 *
 * 【なぜ】時刻は前のデータの年表の軸の上の位置。新しいデータでは範囲の外になりうるので、選び直しに戻す。
 * プロジェクトを開くときは `applySnapshot` が、この後で保存された時刻を入れ直す。
 *
 * @param time - 時間のストア
 * @param data - データのストア
 * @returns 購読解除
 */
export function bindTimeToData(
  time: StoreApi<TimeStoreState>,
  data: StoreApi<DataState>,
): () => void {
  return data.subscribe((s, prev) => {
    if (s.dataset !== prev.dataset) time.getState().clear();
  });
}

/** アプリ全体の時間の状態。軸は、データ・年表の設定・暦から求める。 */
export const timeStore = createTimeStore(() => {
  const dataset = dataStore.getState().dataset;
  if (dataset === null) return null;
  return getTimeAxis(dataset, timelineStore.getState().timeline, displayStore.getState().calendar);
});
bindTimeToData(timeStore, dataStore);
