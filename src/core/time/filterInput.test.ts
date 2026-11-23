import { describe, expect, it } from 'vitest';
import { gregorianToJdn, hijriToJdn } from './calendars';
import { parseTimeFilterInput } from './filterInput';

const ok = (r: ReturnType<typeof parseTimeFilterInput>) => {
  if (!r.ok) throw new Error(`失敗: ${r.reason.code}`);
  return r;
};

describe('FR-FL-03: 時間フィルタの入力の解析', () => {
  it('FR-FL-03: 年だけなら、開始はその年の初日、終了はその年の末日', () => {
    const r = ok(parseTimeFilterInput('1500', '1510'));
    expect(r.from).toBe(gregorianToJdn(1500, 1, 1));
    expect(r.to).toBe(gregorianToJdn(1510, 12, 31));
  });
  it('FR-FL-03: 年月は月の初日と末日、年月日はその日', () => {
    const m = ok(parseTimeFilterInput('1500-03', '1500-03'));
    expect(m.from).toBe(gregorianToJdn(1500, 3, 1));
    expect(m.to).toBe(gregorianToJdn(1500, 3, 31));
    const d = ok(parseTimeFilterInput('1500-03-15', '1500-03-15'));
    expect(d.from).toBe(gregorianToJdn(1500, 3, 15));
    expect(d.to).toBe(gregorianToJdn(1500, 3, 15));
  });
  it('FR-FL-03: 片方が空なら、その端は undefined（開いた端）', () => {
    const r = ok(parseTimeFilterInput('1500', '  '));
    expect(r.from).toBe(gregorianToJdn(1500, 1, 1));
    expect(r.to).toBeUndefined();
    expect(ok(parseTimeFilterInput('', '1600')).from).toBeUndefined();
  });
  it('FR-FL-03: 印のない年は暦の引数で読み、印があれば印が優先', () => {
    expect(ok(parseTimeFilterInput('905', '', 'hijri')).from).toBe(hijriToJdn(905, 1, 1));
    expect(ok(parseTimeFilterInput('905 AH', '', 'gregorian')).from).toBe(hijriToJdn(905, 1, 1));
    expect(ok(parseTimeFilterInput('905هـ', '905هـ')).to).toBe(hijriToJdn(906, 1, 1) - 1);
  });
  it('FR-FL-03: アラビア・インド数字も読める', () => {
    expect(ok(parseTimeFilterInput('١٥٠٠', '')).from).toBe(gregorianToJdn(1500, 1, 1));
  });
  it('FR-FL-03: 失敗の理由と、どちらの入力かを返す', () => {
    const a = parseTimeFilterInput('abc', '');
    expect(a).toMatchObject({ ok: false, reason: { code: 'unrecognized', field: 'start' } });
    const b = parseTimeFilterInput('1500', '1500-13');
    expect(b).toMatchObject({ ok: false, reason: { code: 'invalid-month', field: 'end' } });
  });
  it('FR-FL-03: 両方空、逆転は専用の理由', () => {
    expect(parseTimeFilterInput('', ' ')).toMatchObject({
      ok: false,
      reason: { code: 'both-empty' },
    });
    expect(parseTimeFilterInput('1600', '1500')).toMatchObject({
      ok: false,
      reason: { code: 'filter-reversed', field: 'end' },
    });
  });
  it('FR-FL-03: 紀元前とヒジュラ暦の併用は失敗', () => {
    expect(parseTimeFilterInput('Ramadan 1050 BC', '')).toMatchObject({
      ok: false,
      reason: { code: 'bc-with-hijri' },
    });
  });
});
