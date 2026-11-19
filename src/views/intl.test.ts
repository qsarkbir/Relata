import { describe, expect, it } from 'vitest';
import { getCollator, getNumberFormat } from './intl';

describe('NFR-04: Intl の書式の使い回し', () => {
  it('同じ言語には同じ書式を返し、言語が違えば別のものを返す', () => {
    expect(getNumberFormat('ja')).toBe(getNumberFormat('ja'));
    expect(getNumberFormat('ja')).not.toBe(getNumberFormat('en'));
    expect(getCollator('en')).toBe(getCollator('en'));
    expect(getCollator('ja')).not.toBe(getCollator('en'));
  });
  it('NFR-09: 言語の書き方で数を書く', () => {
    expect(getNumberFormat('en').format(1234)).toBe('1,234');
    expect(getNumberFormat('ja').resolvedOptions().locale).toBe('ja');
  });
});
