import { describe, expect, it } from 'vitest';
import { binDayRange, gregorianToJdn, makeTimeAxis } from '../core/time';
import type { TimeAxis } from '../core/time';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createDataStore } from './dataStore';
import { bindFilterToData, createFilterStore } from './filterStore';
import { applySnapshot, takeSnapshot } from './project';
import { bindTimeToData, createTimeStore, selectTimeSettings } from './timeStore';

const axis: TimeAxis | null = makeTimeAxis(
  'gregorian',
  [1500, 1510, 1520].map((y) => binDayRange('gregorian', y, 10)),
);
const make = () => createTimeStore(() => axis);

describe('FR-TM-02: timeStore', () => {
  it('FR-TM-02: 再生、tick、一時停止、コマ送りが状態を更新する', () => {
    const s = make();
    s.getState().play();
    expect(s.getState()).toMatchObject({ playing: true, at: axis?.min });
    s.getState().tick(1000);
    expect(s.getState().at).toBeGreaterThan(axis?.min ?? 0);
    s.getState().pause();
    expect(s.getState().playing).toBe(false);
    const stopped = s.getState().at;
    s.getState().tick(1000);
    expect(s.getState().at).toBe(stopped);
    s.getState().clear();
    s.getState().step(1);
    expect(s.getState().at).toBe(gregorianToJdn(1509, 12, 31));
    s.getState().step(1);
    expect(s.getState().at).toBe(gregorianToJdn(1519, 12, 31));
  });
  it('FR-TM-02: toggle は再生と一時停止を切り替える。軸が無いと始まらない', () => {
    const s = make();
    s.getState().toggle();
    expect(s.getState().playing).toBe(true);
    s.getState().toggle();
    expect(s.getState().playing).toBe(false);
    const none = createTimeStore(() => null);
    none.getState().toggle();
    none.getState().seek(1);
    expect(none.getState()).toMatchObject({ playing: false, at: null });
  });
  it('FR-TM-02: 方式、速度、窓の幅を変えられる。再生は止まらない', () => {
    const s = make();
    s.getState().play();
    s.getState().setMode('window');
    s.getState().setSpeed(50);
    s.getState().setWindowYears(25);
    expect(s.getState()).toMatchObject({
      mode: 'window',
      speed: 50,
      windowYears: 25,
      playing: true,
    });
  });
  it('FR-TM-03: 変わらない操作では購読者を呼ばない', () => {
    const s = make();
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.getState().setMode('cumulative');
    s.getState().pause();
    s.getState().clear();
    expect(calls).toBe(0);
  });
  it('FR-TM-02: reset は保存した設定で置き換え、再生は止まる。省略で既定', () => {
    const s = make();
    s.getState().play();
    s.getState().reset({ at: 2_300_000, mode: 'window', windowYears: 5, speed: 1 });
    expect(s.getState()).toMatchObject({ at: 2_300_000, mode: 'window', playing: false });
    s.getState().reset();
    expect(selectTimeSettings(s.getState())).toEqual({
      at: null,
      mode: 'cumulative',
      windowYears: 10,
      speed: 10,
    });
  });
});

describe('FR-TM-02: 保存（view.time）', () => {
  function stores() {
    const data = createDataStore();
    const filter = createFilterStore();
    bindFilterToData(filter, data);
    const time = make();
    bindTimeToData(time, data);
    return { data, filter, time };
  }
  it('FR-TM-02: 既定なら書かない。設定は保存し、再生中かどうかは保存しない', () => {
    const { data, filter, time } = stores();
    data.getState().setDataset(sampleDataset());
    expect(takeSnapshot(data, filter, { time })?.view.time).toBeUndefined();
    time.getState().setMode('window');
    time.getState().step(1);
    time.getState().play();
    const snap = takeSnapshot(data, filter, { time });
    expect(snap?.view.time).toEqual({
      at: gregorianToJdn(1509, 12, 31),
      mode: 'window',
      windowYears: 10,
      speed: 10,
    });
    expect(snap?.view.time).not.toHaveProperty('playing');
    const other = make();
    if (snap !== null) applySnapshot(snap, data, filter, { time: other });
    expect(other.getState()).toMatchObject({ ...snap?.view.time, playing: false });
    // 項目の無いプロジェクトは既定に戻す
    const old = takeSnapshot(data, filter);
    if (old !== null) applySnapshot(old, data, filter, { time: other });
    expect(other.getState().at).toBeNull();
  });
  it('FR-TM-02: データを置き換えると時刻は解除され、再生は止まる。方式と速度は保つ', () => {
    const { data, time } = stores();
    time.getState().setSpeed(50);
    time.getState().setMode('window');
    time.getState().play();
    data.getState().setDataset(sampleDataset());
    expect(time.getState()).toMatchObject({ at: null, playing: false, speed: 50, mode: 'window' });
  });
});
