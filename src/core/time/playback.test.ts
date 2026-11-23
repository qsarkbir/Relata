import { describe, expect, it } from 'vitest';
import { gregorianToJdn } from './calendars';
import { binDayRange } from './bins';
import {
  DEFAULT_TIME_SETTINGS,
  binIndexOfTime,
  clearTime,
  makeTimeAxis,
  meanYearDays,
  pausePlayback,
  seekTime,
  setTimeMode,
  setTimeSpeed,
  setTimeWindowYears,
  startPlayback,
  stepTime,
  tickTime,
  timeWindowOf,
} from './playback';
import type { TimeAxis, TimeState } from './playback';

// 1500〜1529 年を 10 年区切りで 3 つ（西暦）。
const bins = [1500, 1510, 1520].map((y) => binDayRange('gregorian', y, 10));
const axis = ((): TimeAxis => {
  const a = makeTimeAxis('gregorian', bins);
  if (a === null) throw new Error('fixture');
  return a;
})();
const idle: TimeState = { ...DEFAULT_TIME_SETTINGS, playing: false };
const at = (y: number, m = 1, d = 1): number => gregorianToJdn(y, m, d);

describe('FR-TM-02: 時刻の軸', () => {
  it('FR-TM-02: 軸は先頭の区切りの初日から末尾の区切りの末日まで。区切りが無ければ null', () => {
    expect(axis.min).toBe(at(1500, 1, 1));
    expect(axis.max).toBe(at(1529, 12, 31));
    expect(makeTimeAxis('gregorian', [])).toBeNull();
  });
  it('FR-TM-02: 暦の平均の年の長さ（ヒジュラ暦は約 354 日）', () => {
    expect(meanYearDays('gregorian')).toBeCloseTo(365.2425);
    expect(meanYearDays('hijri')).toBeCloseTo(354.37, 2);
  });
});

describe('FR-TM-02: 再生と一時停止', () => {
  it('FR-TM-02: 時刻が無いとき再生は先頭から始まる', () => {
    const s = startPlayback(idle, axis);
    expect(s).toMatchObject({ playing: true, at: axis.min });
  });
  it('FR-TM-02: 終わりに着いているときの再生は先頭から。途中なら続きから', () => {
    expect(startPlayback({ ...idle, at: axis.max }, axis).at).toBe(axis.min);
    expect(startPlayback({ ...idle, at: at(1512) }, axis).at).toBe(at(1512));
  });
  it('FR-TM-02: 軸が無い（日付が無い）と再生は始まらない', () => {
    expect(startPlayback(idle, null)).toBe(idle);
  });
  it('FR-TM-02: 一時停止は時刻を残す。止まっていれば同じ参照を返す', () => {
    const p = startPlayback(idle, axis);
    expect(pausePlayback(p)).toMatchObject({ playing: false, at: axis.min });
    expect(pausePlayback(idle)).toBe(idle);
  });
  it('FR-TM-02: 時刻の解除は再生も止める', () => {
    const p = startPlayback(idle, axis);
    expect(clearTime(p)).toMatchObject({ at: null, playing: false });
    expect(clearTime(idle)).toBe(idle);
  });
});

describe('FR-TM-02: 時刻を進める', () => {
  it('FR-TM-02: 経過時間 × 速度（年/秒）× 年の日数だけ進む', () => {
    const p: TimeState = { ...idle, at: axis.min, playing: true, speed: 10 };
    const next = tickTime(p, 500, axis);
    // 0.5 秒 × 10 年/秒 = 5 年 ≒ 1826 日
    expect(next.at).toBe(axis.min + Math.round(5 * 365.2425));
    expect(next.playing).toBe(true);
  });
  it('FR-TM-02: 終わりに着いたら、そこで止まる（繰り返さない）', () => {
    const p: TimeState = { ...idle, at: axis.max - 3, playing: true, speed: 100 };
    expect(tickTime(p, 1000, axis)).toMatchObject({ at: axis.max, playing: false });
  });
  it('FR-TM-02: 再生中でなければ進まない。経過が 0 以下や不正でも進まない', () => {
    expect(tickTime({ ...idle, at: axis.min }, 100, axis)).toEqual({ ...idle, at: axis.min });
    const p: TimeState = { ...idle, at: axis.min, playing: true };
    expect(tickTime(p, 0, axis)).toBe(p);
    expect(tickTime(p, -5, axis)).toBe(p);
    expect(tickTime(p, Number.NaN, axis)).toBe(p);
  });
  it('FR-TM-02: 短い経過でも 1 日は進む（遅い速度で止まって見えない）', () => {
    const p: TimeState = { ...idle, at: axis.min, playing: true, speed: 1 };
    expect(tickTime(p, 1, axis).at).toBe(axis.min + 1);
  });
});

describe('FR-TM-02: コマ送り（年表の区切りに合わせる）', () => {
  it('FR-TM-02: 時刻が無いとき、次のコマは先頭の区切りの末日', () => {
    expect(stepTime(idle, 1, axis).at).toBe(at(1509, 12, 31));
  });
  it('FR-TM-02: 次のコマは、今より後で最も近い区切りの末日。末尾で止まる', () => {
    const s1 = stepTime({ ...idle, at: at(1509, 12, 31) }, 1, axis);
    expect(s1.at).toBe(at(1519, 12, 31));
    const s2 = stepTime({ ...idle, at: at(1515, 6, 1) }, 1, axis);
    expect(s2.at).toBe(at(1519, 12, 31));
    expect(stepTime({ ...idle, at: axis.max }, 1, axis).at).toBe(axis.max);
  });
  it('FR-TM-02: 前のコマは、今より前で最も近い区切りの末日。先頭で止まる', () => {
    expect(stepTime({ ...idle, at: at(1529, 12, 31) }, -1, axis).at).toBe(at(1519, 12, 31));
    expect(stepTime({ ...idle, at: at(1515, 6, 1) }, -1, axis).at).toBe(at(1509, 12, 31));
    // 先頭の区切りの途中から前へ戻ると、軸の始まりへ（後ろへ進まない）
    expect(stepTime({ ...idle, at: at(1505) }, -1, axis).at).toBe(axis.min);
    expect(stepTime({ ...idle, at: at(1509, 12, 31) }, -1, axis).at).toBe(axis.min);
  });
  it('FR-TM-02: 時刻が無いときの前のコマは軸の始まり。動かないときは同じ参照を返す', () => {
    expect(stepTime(idle, -1, axis).at).toBe(axis.min);
    const atMin: TimeState = { ...idle, at: axis.min };
    expect(stepTime(atMin, -1, axis)).toBe(atMin);
    const atMax: TimeState = { ...idle, at: axis.max };
    expect(stepTime(atMax, 1, axis)).toBe(atMax);
  });
  it('FR-TM-02: コマ送りは再生を止める', () => {
    const p: TimeState = { ...idle, at: axis.min, playing: true };
    expect(stepTime(p, 1, axis).playing).toBe(false);
  });
});

describe('FR-TM-03: 時刻の指定と窓', () => {
  it('FR-TM-03: 時刻は軸の範囲に収め、整数にする', () => {
    expect(seekTime(idle, axis.min - 1000, axis).at).toBe(axis.min);
    expect(seekTime(idle, axis.max + 1000, axis).at).toBe(axis.max);
    expect(seekTime(idle, at(1512) + 0.4, axis).at).toBe(at(1512));
  });
  it('FR-TM-03: 時刻が入る区切りの番号', () => {
    expect(binIndexOfTime(at(1500), axis)).toBe(0);
    expect(binIndexOfTime(at(1515), axis)).toBe(1);
    expect(binIndexOfTime(at(1529, 12, 31), axis)).toBe(2);
    expect(binIndexOfTime(axis.min - 99, axis)).toBe(0);
  });
  it('FR-TM-02: 累積は時刻より前をすべて見せ、移動窓は窓の幅の日数だけ見せる', () => {
    const t = at(1515);
    expect(timeWindowOf({ at: t, mode: 'cumulative', windowYears: 10 }, 'gregorian')).toEqual({
      from: Number.NEGATIVE_INFINITY,
      to: t,
    });
    const w = timeWindowOf({ at: t, mode: 'window', windowYears: 10 }, 'gregorian');
    expect(w?.to).toBe(t);
    expect(t - (w?.from ?? 0) + 1).toBe(Math.round(10 * 365.2425));
    expect(timeWindowOf(DEFAULT_TIME_SETTINGS, 'gregorian')).toBeNull();
  });
  it('FR-TM-02: 方式、速度、窓の幅の変更。同じ値なら同じ参照', () => {
    expect(setTimeMode(idle, 'window').mode).toBe('window');
    expect(setTimeMode(idle, 'cumulative')).toBe(idle);
    expect(setTimeSpeed(idle, 50).speed).toBe(50);
    expect(setTimeSpeed(idle, 10)).toBe(idle);
    expect(setTimeWindowYears(idle, 25).windowYears).toBe(25);
    expect(setTimeWindowYears(idle, 10)).toBe(idle);
  });
});
