import { useEffect } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { timeStore } from '../state';
import type { TimeStoreState } from '../state';

// 【TS】`interface` の `readonly` な関数の項目だけで「窓口」の形を決める。本物（ブラウザ）と偽物（テスト）が
//       同じ形を満たせば差し替えられる。これを依存の注入と呼ぶ。
/** 時計が使う、ブラウザの機能の窓口。テストでは偽物（手で進める時計）に替える。 */
export interface ClockEnv {
  /** 次の描画の直前に `cb(時刻 ms)` を呼ぶよう頼み、取り消し用の番号を返す。 */
  readonly request: (cb: (timestamp: number) => void) => number;
  /** `request` の取り消し。 */
  readonly cancel: (handle: number) => void;
  /** タブが見えているか。 */
  readonly isVisible: () => boolean;
  /** タブの表示状態が変わったときに `cb` を呼ぶよう登録する。解除する関数を返す。 */
  readonly onVisibilityChange: (cb: () => void) => () => void;
}

/**
 * 1 コマの経過時間の上限（ミリ秒）。
 *
 * 【なぜ】描画が一時的に止まった（重い処理、デバッガ）後に大きな値で時刻が飛ぶと、見落とす。
 * 上限を超える間は、遅れた分を取り戻さず、上限までしか進めない。
 */
export const MAX_FRAME_MS = 250;

/**
 * 再生の時計を作る（設計書 §9.2、D-17。アプリに 1 つだけ）。
 *
 * ストアの `playing` を見て、再生中だけ描画ごとに `tick(経過ミリ秒)` を呼ぶ。タブが隠れたら再生を止める
 * （`pause`。戻ってきても勝手に動き出さない。隠れている間は描画が呼ばれず、時刻が飛ぶのを避ける）。
 * グラフと年表は、この時計を持たず、ストアの値を読んで描くだけ。
 *
 * @param store - 時間のストア
 * @param env - ブラウザの機能の窓口
 * @returns 時計を止める関数（購読と予約を解除する）
 */
// 【TS】戻り値の型 `() => void` は「引数なしで呼ぶと止める関数」。React の `useEffect` が、
//       後片付けの関数として受け取れる形でもある。
export function startPlaybackClock(store: StoreApi<TimeStoreState>, env: ClockEnv): () => void {
  let handle: number | null = null;
  let last: number | null = null;
  // 【なぜ】`tick` が状態を変えると購読（下の `sync`）が同期で呼ばれる。コマの処理の最中に `sync` が
  //   別の予約を取ると、予約が二重になり、時刻が倍の速さで進む。コマの最中は `sync` を何もしない扱いにする。
  let inFrame = false;

  const frame = (timestamp: number): void => {
    handle = null;
    if (!store.getState().playing) {
      last = null;
      return;
    }
    const dt = last === null ? 0 : Math.min(MAX_FRAME_MS, timestamp - last);
    last = timestamp;
    // 【なぜ】先に次の予約を取らず、tick の結果（終わりで止まったか）を見てから予約する。
    inFrame = true;
    try {
      store.getState().tick(dt);
    } catch (e) {
      // 【なぜ】tick で例外が出たまま次の予約を取ると、毎コマ失敗し続ける。再生を止めてから投げ直す。
      store.getState().pause();
      last = null;
      throw e;
    } finally {
      inFrame = false;
    }
    if (store.getState().playing) handle = env.request(frame);
    else last = null;
  };

  const sync = (): void => {
    if (inFrame) return;
    const playing = store.getState().playing;
    if (playing && handle === null) {
      last = null;
      handle = env.request(frame);
    } else if (!playing && handle !== null) {
      env.cancel(handle);
      handle = null;
      last = null;
    }
  };

  const unsubscribe = store.subscribe(sync);
  const unwatch = env.onVisibilityChange(() => {
    if (!env.isVisible()) store.getState().pause();
  });
  sync();
  return () => {
    unsubscribe();
    unwatch();
    if (handle !== null) env.cancel(handle);
    handle = null;
  };
}

/**
 * ブラウザの本物の窓口を作る。
 *
 * @returns `requestAnimationFrame` と `visibilitychange` を使う窓口
 */
function browserEnv(): ClockEnv {
  return {
    request: (cb) => requestAnimationFrame(cb),
    cancel: (h) => {
      cancelAnimationFrame(h);
    },
    isVisible: () => document.visibilityState === 'visible',
    onVisibilityChange: (cb) => {
      document.addEventListener('visibilitychange', cb);
      return () => {
        document.removeEventListener('visibilitychange', cb);
      };
    },
  };
}

/**
 * アプリの最上位で 1 度だけ呼ぶ。再生の時計を動かす。
 *
 * 【なぜ】時計をここに 1 つだけ置く。年表、グラフ、（フェーズ 3 の）地図が別々に時計を持つと、
 * 動きがずれ、連動（FR-TM-03）が崩れる。
 */
export function usePlaybackClock(): void {
  useEffect(() => startPlaybackClock(timeStore, browserEnv()), []);
}
