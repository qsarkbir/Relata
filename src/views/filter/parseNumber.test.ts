import { describe, expect, it } from 'vitest';
import { parseNumber } from './parseNumber';

describe('parseNumber', () => {
  it('FR-FL-02: 算用数字、小数、指数、符号を読む', () => {
    expect(parseNumber('12')).toBe(12);
    expect(parseNumber(' -3.5 ')).toBe(-3.5);
    expect(parseNumber('.5')).toBe(0.5);
    expect(parseNumber('1e3')).toBe(1000);
  });

  it('FR-FL-02, NFR-09: アラビア・インド数字、ペルシア数字、全角数字を読む', () => {
    expect(parseNumber('١٢')).toBe(12);
    expect(parseNumber('۱۲')).toBe(12);
    expect(parseNumber('１２')).toBe(12);
  });

  it('FR-FL-02, NFR-09: アラビアの小数点と桁区切り、数学のマイナスを読む', () => {
    expect(parseNumber('١٢٫٥')).toBe(12.5);
    expect(parseNumber('١٬٠٠٠')).toBe(1000);
    expect(parseNumber('−4')).toBe(-4);
  });

  it('FR-FL-02: 空は指定なし', () => {
    expect(parseNumber('')).toBeUndefined();
    expect(parseNumber('   ')).toBeUndefined();
  });

  it('FR-FL-02: 数値でない入力は invalid（黙って消さない）', () => {
    for (const bad of ['1e', 'abc', '1,5', '1,000', '0x10', 'Infinity', '1e999', '--1', '1.2.3']) {
      expect(parseNumber(bad)).toBe('invalid');
    }
  });
});
