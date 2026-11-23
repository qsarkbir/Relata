import { describe, expect, it } from 'vitest';
import { normalizeDecimal, parseDecimal } from './numeric';

describe('FR-VG-02: 数値の表記の正規化', () => {
  it('FR-VG-02: ASCII の 10 進を読む', () => {
    expect(parseDecimal('33.3')).toBe(33.3);
    expect(parseDecimal(' -4.8 ')).toBe(-4.8);
    expect(parseDecimal('+10')).toBe(10);
    expect(parseDecimal('.5')).toBe(0.5);
  });
  it('FR-VG-02: アラビア・インド数字、ペルシア数字、「٫」、「−」を読む', () => {
    expect(parseDecimal('٣٣٫٣')).toBe(33.3);
    expect(parseDecimal('۴۴٫۴')).toBe(44.4);
    expect(parseDecimal('−٤٫٨')).toBe(-4.8);
    expect(parseDecimal('‏-۱۰')).toBe(-10);
  });
  it('FR-VG-02: 16 進、指数、無限大、空、桁区切り、文字を拒む', () => {
    for (const bad of [
      '0x21',
      '1e3',
      'Infinity',
      '',
      ' ',
      '1,5',
      '١٬٠٠٠',
      '12abc',
      '.',
      '--1',
      'NaN',
    ])
      expect(parseDecimal(bad), bad).toBeNull();
    expect(normalizeDecimal('٣')).toBe('3');
  });
});
