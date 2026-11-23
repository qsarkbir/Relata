import { describe, expect, it } from 'vitest';
import { parseCertainty } from './certainty';

describe('parseCertainty（D-37、FR-DM-06）', () => {
  it.each([
    ['確実', 'certain'],
    ['おそらく', 'probable'],
    ['可能性あり', 'possible'],
    ['certain', 'certain'],
    ['Probable', 'probable'],
    [' POSSIBLE ', 'possible'],
    ['?', 'possible'],
    ['??', 'possible'],
    ['？', 'possible'],
    ['？？', 'possible'],
    ['\u061F', 'possible'],
    ['\u061F\u061F', 'possible'],
    ['\u200F\u061F\u200E', 'possible'],
    ['\uFEFF certain \u200B', 'certain'],
  ])('FR-DM-06: %s を %s と読む', (text, value) => {
    expect(parseCertainty(text)).toEqual({ kind: 'ok', value });
  });

  it('FR-DM-06: 空と空白だけは「無し」', () => {
    expect(parseCertainty('')).toEqual({ kind: 'none' });
    expect(parseCertainty('  ​ ')).toEqual({ kind: 'none' });
  });

  it('FR-DM-06: 読めない値は例外ではなく失敗を返す', () => {
    expect(parseCertainty('たぶん')).toEqual({ kind: 'invalid', text: 'たぶん' });
    expect(parseCertainty('???')).toEqual({ kind: 'invalid', text: '???' });
  });
});
