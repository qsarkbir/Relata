import { describe, expect, it } from 'vitest';
import { DEFAULT_TIME_SETTINGS } from '../time';
import { parseTimeSettings } from './timeView';

describe('FR-TM-02: view.time の読み込み（D-44）', () => {
  it('FR-TM-02: 正しい値はそのまま読む', () => {
    const r = parseTimeSettings({ at: 2_300_000, mode: 'window', windowYears: 25, speed: 50 });
    expect(r).toEqual({
      ok: true,
      value: { at: 2_300_000, mode: 'window', windowYears: 25, speed: 50 },
    });
  });
  it('FR-TM-02: 空のオブジェクトは既定で補う', () => {
    expect(parseTimeSettings({})).toEqual({ ok: true, value: DEFAULT_TIME_SETTINGS });
  });
  it('FR-TM-02: 不正な値は項目ごとに退けて既定にする（小数、文字列、範囲外、選択肢にない値）', () => {
    for (const at of [1.5, '2300000', Number.NaN, 1e12, null, {}]) {
      const r = parseTimeSettings({ at });
      expect(r.ok && r.value.at).toBe(null);
    }
    const r = parseTimeSettings({ at: 2_300_000, mode: 'loop', windowYears: 7, speed: 3 });
    expect(r).toEqual({
      ok: true,
      value: { ...DEFAULT_TIME_SETTINGS, at: 2_300_000 },
    });
  });
  it('FR-TM-02: 再生中かどうか（playing）を書いてあっても読まない', () => {
    const r = parseTimeSettings({ playing: true });
    expect(r.ok && 'playing' in r.value).toBe(false);
  });
  it('FR-TM-02: オブジェクトでなければ失敗にする', () => {
    for (const x of [null, 3, 'x', [], undefined]) expect(parseTimeSettings(x).ok).toBe(false);
  });
});
