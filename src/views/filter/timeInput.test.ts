import { describe, expect, it } from 'vitest';
import { gregorianToJdn, hijriToJdn } from '../../core/time';
import { formatTimeInput, resolveTimeInput, sourceToValue, valueToSource } from './timeInput';

describe('FR-FL-03: 入力 → フィルタの範囲', () => {
  it('FR-FL-03: 年の入力は、始点の最初の日から終点の最後の日までになる', () => {
    expect(resolveTimeInput('1500', '1510', 'gregorian', false)).toEqual({
      kind: 'apply',
      from: gregorianToJdn(1500, 1, 1),
      to: gregorianToJdn(1510, 12, 31),
    });
  });
  it('FR-FL-03: 空の端は開いたまま（from か to を省く）。データの範囲で埋めない', () => {
    const a = resolveTimeInput('1500', '', 'gregorian', false);
    expect(a).toEqual({ kind: 'apply', from: gregorianToJdn(1500, 1, 1) });
    expect(a).not.toHaveProperty('to');
    const b = resolveTimeInput('', '1500', 'gregorian', false);
    expect(b).toEqual({ kind: 'apply', to: gregorianToJdn(1500, 12, 31) });
    expect(b).not.toHaveProperty('from');
  });
  it('FR-FL-03: 読めない入力は、どちらの欄かを返す', () => {
    expect(resolveTimeInput('1500', 'abc', 'gregorian', false)).toEqual({
      kind: 'error',
      error: { code: 'unrecognized', field: 'end' },
    });
    expect(resolveTimeInput('1500', '1400', 'gregorian', false)).toMatchObject({
      kind: 'error',
      error: { code: 'filter-reversed' },
    });
  });
  it('FR-FL-03: 両方が空なら、適用中は解除、無ければエラー', () => {
    expect(resolveTimeInput(' ', '', 'gregorian', true)).toEqual({ kind: 'clear' });
    expect(resolveTimeInput('', '', 'gregorian', false)).toEqual({
      kind: 'error',
      error: { code: 'both-empty' },
    });
  });
  it('FR-TM-09: ヒジュラ暦の入力は、印がなくてもヒジュラ暦として読み、日の幅を足さない', () => {
    expect(resolveTimeInput('905', '906', 'hijri', false)).toEqual({
      kind: 'apply',
      from: hijriToJdn(905, 1, 1),
      to: hijriToJdn(907, 1, 1) - 1,
    });
    expect(resolveTimeInput('905-03-02', '905-03-02', 'hijri', false)).toEqual({
      kind: 'apply',
      from: hijriToJdn(905, 3, 2),
      to: hijriToJdn(905, 3, 2),
    });
  });
  it('FR-TM-09: アラビア・インド数字と AH の印を読む', () => {
    const r = resolveTimeInput('٩٠٠هـ', '906 AH', 'gregorian', false);
    expect(r).toMatchObject({ kind: 'apply', from: hijriToJdn(900, 1, 1) });
  });
});

describe('FR-FL-03: 適用中の端 → 欄の文字', () => {
  const days: [string, number][] = [
    ['ヒジュラ暦 905 年の初め頃', 2268787],
    ['2451545', 2451545],
    ['西暦 600 年 6 月 1 日（ヒジュラ以前）', gregorianToJdn(600, 6, 1)],
    ['紀元前 44 年 3 月 15 日', gregorianToJdn(-43, 3, 15)],
    ['紀元前 44 年の初日', gregorianToJdn(-43, 1, 1)],
    ['ヒジュラ以前 23 年 3 月 15 日', hijriToJdn(-22, 3, 15)],
  ];
  it.each(['gregorian', 'hijri'] as const)(
    'FR-TM-09: %s の欄に戻した文字を読み戻すと、同じ JDN になる（紀元前・ヒジュラ以前を含む）',
    (cal) => {
      for (const [, jdn] of days) {
        for (const side of ['start', 'end'] as const) {
          const text = formatTimeInput(jdn, cal, side);
          const r =
            side === 'start'
              ? resolveTimeInput(text, '', cal, false)
              : resolveTimeInput('', text, cal, false);
          expect(r, `${text} (${cal}, ${side})`).toMatchObject({
            kind: 'apply',
            [side === 'start' ? 'from' : 'to']: jdn,
          });
        }
      }
    },
  );
  it('FR-TM-09: ヒジュラ暦の欄の 0 年以前は BH、西暦は BC と書く（約 622 年のずれを防ぐ）', () => {
    expect(formatTimeInput(hijriToJdn(-22, 3, 15), 'hijri', 'start')).toBe('23-03-15 BH');
    expect(formatTimeInput(gregorianToJdn(-43, 3, 15), 'gregorian', 'start')).toBe('44-03-15 BC');
    // 西暦 600 年をヒジュラ暦の欄に戻すと、ヒジュラ以前の年になり、読み戻して同じ日になる。
    const text = formatTimeInput(gregorianToJdn(600, 6, 1), 'hijri', 'start');
    expect(text).toMatch(/BH$/);
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
