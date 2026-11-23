import { describe, expect, it } from 'vitest';
import { gregorianToJdn, hijriToJdn } from '../../core/time';
import { formatTimeInput, resolveTimeInput, sourceToValue, valueToSource } from './timeInput';

const extent = { min: gregorianToJdn(1400, 1, 1), max: gregorianToJdn(1600, 12, 31) };

describe('FR-FL-03: 入力 → フィルタの範囲', () => {
  it('FR-FL-03: 年の入力は、始点の最初の日から終点の最後の日までになる', () => {
    expect(resolveTimeInput('1500', '1510', 'gregorian', extent, false)).toEqual({
      kind: 'apply',
      from: gregorianToJdn(1500, 1, 1),
      to: gregorianToJdn(1510, 12, 31),
    });
  });
  it('FR-FL-03: 空の端はデータの最小値・最大値で埋め、無限大を入れない', () => {
    const a = resolveTimeInput('1500', '', 'gregorian', extent, false);
    expect(a).toEqual({ kind: 'apply', from: gregorianToJdn(1500, 1, 1), to: extent.max });
    const b = resolveTimeInput('', '1500', 'gregorian', extent, false);
    expect(b).toEqual({ kind: 'apply', from: extent.min, to: gregorianToJdn(1500, 12, 31) });
  });
  it('FR-FL-03: データに日付が無く片側が空なら、no-data', () => {
    expect(resolveTimeInput('1500', '', 'gregorian', undefined, false)).toEqual({
      kind: 'error',
      error: { code: 'no-data', field: 'end' },
    });
  });
  it('FR-FL-03: 空の側を埋めて逆転するなら、原因の欄を示して適用しない', () => {
    expect(resolveTimeInput('1700', '', 'gregorian', extent, false)).toEqual({
      kind: 'error',
      error: { code: 'beyond-start', field: 'start' },
    });
    expect(resolveTimeInput('', '1300', 'gregorian', extent, false)).toEqual({
      kind: 'error',
      error: { code: 'beyond-end', field: 'end' },
    });
  });
  it('FR-FL-03: 読めない入力は、どちらの欄かを返す', () => {
    expect(resolveTimeInput('1500', 'abc', 'gregorian', extent, false)).toEqual({
      kind: 'error',
      error: { code: 'unrecognized', field: 'end' },
    });
    expect(resolveTimeInput('1500', '1400', 'gregorian', extent, false)).toMatchObject({
      kind: 'error',
      error: { code: 'filter-reversed' },
    });
  });
  it('FR-FL-03: 両方が空なら、適用中は解除、無ければエラー', () => {
    expect(resolveTimeInput(' ', '', 'gregorian', extent, true)).toEqual({ kind: 'clear' });
    expect(resolveTimeInput('', '', 'gregorian', extent, false)).toEqual({
      kind: 'error',
      error: { code: 'both-empty' },
    });
  });
  it('FR-TM-09: ヒジュラ暦の入力は、印がなくてもヒジュラ暦として読み、日の幅を足さない', () => {
    expect(resolveTimeInput('905', '906', 'hijri', extent, false)).toEqual({
      kind: 'apply',
      from: hijriToJdn(905, 1, 1),
      to: hijriToJdn(907, 1, 1) - 1,
    });
    const day = resolveTimeInput('905-03-02', '905-03-02', 'hijri', extent, false);
    expect(day).toEqual({
      kind: 'apply',
      from: hijriToJdn(905, 3, 2),
      to: hijriToJdn(905, 3, 2),
    });
  });
  it('FR-TM-09: アラビア・インド数字と AH の印を読む', () => {
    const r = resolveTimeInput('٩٠٥هـ', '906 AH', 'gregorian', extent, false);
    expect(r).toMatchObject({ kind: 'apply', from: hijriToJdn(905, 1, 1) });
  });
});

describe('FR-FL-03: 適用中の端 → 欄の文字', () => {
  it.each(['gregorian', 'hijri'] as const)('FR-TM-09: %s で読み戻すと同じ JDN になる', (cal) => {
    const days = [2268787, 2268900, 2300000, 2451545, 1705355];
    for (const jdn of days) {
      for (const side of ['start', 'end'] as const) {
        const text = formatTimeInput(jdn, cal, side);
        const r =
          side === 'start'
            ? resolveTimeInput(text, '', cal, { min: jdn, max: jdn + 1e6 }, false)
            : resolveTimeInput('', text, cal, { min: jdn - 1e6, max: jdn }, false);
        if (jdn === 1705355) continue; // 紀元前は年だけに丸める
        expect(r).toMatchObject({ kind: 'apply', [side === 'start' ? 'from' : 'to']: jdn });
      }
    }
  });
  it('FR-FL-03: 年の最初の日と最後の日は年だけで書く', () => {
    expect(formatTimeInput(gregorianToJdn(1500, 1, 1), 'gregorian', 'start')).toBe('1500');
    expect(formatTimeInput(gregorianToJdn(1510, 12, 31), 'gregorian', 'end')).toBe('1510');
    expect(formatTimeInput(gregorianToJdn(1510, 3, 31), 'gregorian', 'end')).toBe('1510-03');
    expect(formatTimeInput(gregorianToJdn(1510, 3, 15), 'gregorian', 'end')).toBe('1510-03-15');
  });
  it('FR-FL-03: 出どころの値の往復', () => {
    expect(valueToSource(sourceToValue({ kind: 'span' }))).toEqual({ kind: 'span' });
    expect(valueToSource(sourceToValue({ kind: 'attr', attr: 'a:b' }))).toEqual({
      kind: 'attr',
      attr: 'a:b',
    });
  });
});
