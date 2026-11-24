import { describe, expect, it } from 'vitest';
import { binDayRange, gregorianToJdn, makeTimeAxis } from '../core/time';
import type { TimeAxis } from '../core/time';
import { createTimeStore } from './timeStore';
import { restrictAxis } from './timeAxis';

const full: TimeAxis = (() => {
  const a = makeTimeAxis(
    'gregorian',
    [1500, 1510, 1520, 1530].map((y) => binDayRange('gregorian', y, 10)),
  );
  if (a === null) throw new Error('軸が作れない');
  return a;
})();
const from = binDayRange('gregorian', 1510, 10).earliest;
const to = binDayRange('gregorian', 1520, 10).latest;

describe('FR-TM-02: restrictAxis（範囲を選んでいる間は、再生をその範囲に限る）', () => {
  it('FR-TM-02: 範囲に重なる区切りだけを残し、最小・最大を範囲の端にする', () => {
    const r = restrictAxis(full, from, to);
    expect(r.bins).toHaveLength(2);
    expect(r.min).toBe(from);
    expect(r.max).toBe(to);
  });

  it('FR-TM-02: 区切りの途中で始まる範囲は、端の区切りを範囲で切る', () => {
    const mid = gregorianToJdn(1515, 1, 1);
    const r = restrictAxis(full, mid, to);
    expect(r.min).toBe(mid);
    expect(r.bins[0]?.earliest).toBe(mid);
    expect(r.bins[0]?.latest).toBe(binDayRange('gregorian', 1510, 10).latest);
  });

  it('FR-TM-02: 片側が開いた範囲は、軸の端までとして扱う', () => {
    const r = restrictAxis(full, from, undefined);
    expect(r.min).toBe(from);
    expect(r.max).toBe(full.max);
  });

  it('FR-TM-02: 範囲が軸と同じ、または軸と重ならないときは元の軸をそのまま返す', () => {
    expect(restrictAxis(full, full.min, full.max)).toBe(full);
    expect(restrictAxis(full, full.max + 10, full.max + 20)).toBe(full);
  });
});

describe('FR-TM-02: 範囲に限った軸での再生', () => {
  const r = restrictAxis(full, from, to);
  const make = () => createTimeStore(() => r);

  it('FR-TM-02: 再生は範囲の始めから始まり、終わりで止まる', () => {
    const s = make();
    s.getState().play();
    expect(s.getState().at).toBe(from);
    s.getState().tick(60_000);
    expect(s.getState()).toMatchObject({ at: to, playing: false });
    // 終わりから再生し直すと、範囲の始めに戻る。
    s.getState().play();
    expect(s.getState().at).toBe(from);
  });

  it('FR-TM-02: コマ送りは範囲の端を越えない。つまみで範囲の外を指すと端に収まる', () => {
    const s = make();
    for (let i = 0; i < 6; i++) s.getState().step(1);
    expect(s.getState().at).toBe(to);
    s.getState().seek(full.max);
    expect(s.getState().at).toBe(to);
    s.getState().seek(full.min);
    expect(s.getState().at).toBe(from);
  });
});
