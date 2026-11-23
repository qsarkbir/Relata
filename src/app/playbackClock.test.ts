import { describe, expect, it } from 'vitest';
import { binDayRange, makeTimeAxis } from '../core/time';
import { createTimeStore } from '../state';
import { MAX_FRAME_MS, startPlaybackClock } from './playbackClock';
import type { ClockEnv } from './playbackClock';

const axis = makeTimeAxis(
  'gregorian',
  [1500, 1510, 1520, 1530].map((y) => binDayRange('gregorian', y, 10)),
);

/**
 * 手で進める時計（requestAnimationFrame とタブの表示状態の偽物）を作る。
 *
 * @returns 偽の窓口と、手で進める操作
 */
function fakeEnv() {
  let next = 1;
  const pending = new Map<number, (t: number) => void>();
  let visible = true;
  const listeners = new Set<() => void>();
  const env: ClockEnv = {
    request: (cb) => {
      const h = next++;
      pending.set(h, cb);
      return h;
    },
    cancel: (h) => {
      pending.delete(h);
    },
    isVisible: () => visible,
    onVisibilityChange: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return {
    env,
    pending: () => pending.size,
    // 予約されている描画を 1 回呼ぶ（t はそのコマの時刻 ms）。
    frame: (t: number) => {
      const entries = [...pending];
      pending.clear();
      for (const [, cb] of entries) cb(t);
    },
    hide: () => {
      visible = false;
      listeners.forEach((l) => {
        l();
      });
    },
  };
}

describe('FR-TM-02: 再生の時計', () => {
  it('FR-TM-02: 再生中だけ描画を予約し、経過時間で tick する', () => {
    const store = createTimeStore(() => axis);
    const clock = fakeEnv();
    const stop = startPlaybackClock(store, clock.env);
    expect(clock.pending()).toBe(0);
    store.getState().play();
    expect(clock.pending()).toBe(1);
    clock.frame(1000); // 最初のコマは基準だけ決める
    const before = store.getState().at;
    clock.frame(1500);
    expect(store.getState().at).toBeGreaterThan(before ?? 0);
    store.getState().pause();
    expect(clock.pending()).toBe(0);
    stop();
  });
  it('FR-TM-02: 経過時間の上限を超える遅れは取り戻さない', () => {
    const store = createTimeStore(() => axis);
    const ref = createTimeStore(() => axis);
    const clock = fakeEnv();
    startPlaybackClock(store, clock.env);
    store.getState().play();
    ref.getState().play();
    clock.frame(0);
    clock.frame(60_000); // 1 分止まっていた
    ref.getState().tick(MAX_FRAME_MS);
    expect(store.getState().at).toBe(ref.getState().at);
  });
  it('FR-TM-02: 終わりに着いたら止まり、予約も残らない', () => {
    const store = createTimeStore(() => axis);
    const clock = fakeEnv();
    startPlaybackClock(store, clock.env);
    store.getState().setSpeed(100);
    store.getState().play();
    let t = 0;
    for (let i = 0; i < 400 && store.getState().playing; i++) {
      t += 100;
      clock.frame(t);
    }
    expect(store.getState()).toMatchObject({ playing: false, at: axis?.max });
    expect(clock.pending()).toBe(0);
  });
  it('FR-TM-02: タブが隠れたら止める。止めた後は動き出さない', () => {
    const store = createTimeStore(() => axis);
    const clock = fakeEnv();
    startPlaybackClock(store, clock.env);
    store.getState().play();
    clock.hide();
    expect(store.getState().playing).toBe(false);
    expect(clock.pending()).toBe(0);
  });
  it('FR-TM-03: 時計を止めると購読も予約も解除される', () => {
    const store = createTimeStore(() => axis);
    const clock = fakeEnv();
    const stop = startPlaybackClock(store, clock.env);
    store.getState().play();
    stop();
    expect(clock.pending()).toBe(0);
    store.getState().pause();
    store.getState().play();
    expect(clock.pending()).toBe(0);
  });
});
