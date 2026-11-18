import { describe, expect, it } from 'vitest';
import { cleanMissingCell, compileMissingTokens, matchMissingToken } from './missing';
import type { MissingToken } from './types';

const tokens: MissingToken[] = [
  { token: '〔欠〕', reason: 'lost' },
  { token: '□', reason: 'illegible' },
  { token: '—', reason: 'not-applicable' },
  { token: 'é', reason: 'lost' },
];

describe('matchMissingToken', () => {
  it('FR-IN-07: 〔欠〕は lost、□は illegible', () => {
    expect(matchMissingToken('〔欠〕', tokens)).toBe('lost');
    expect(matchMissingToken('□', tokens)).toBe('illegible');
  });
  it('FR-IN-07: 前後の空白は除いて照合する', () => {
    expect(matchMissingToken('  □ \t', tokens)).toBe('illegible');
  });
  it('FR-IN-07: NFC と NFD は同じ記号', () => {
    expect(matchMissingToken('é', tokens)).toBe('lost');
  });
  it('FR-IN-07: 空欄と空白だけは unrecorded（§6.5）', () => {
    expect(matchMissingToken('', [])).toBe('unrecorded');
    expect(matchMissingToken('  　 ', tokens)).toBe('unrecorded');
  });
  it('FR-IN-07: 対応表に無い文字列と、揺れた記号は欠損にしない', () => {
    expect(matchMissingToken('Ahmad', tokens)).toBeUndefined();
    expect(matchMissingToken('―', tokens)).toBeUndefined();
    expect(matchMissingToken('□□', tokens)).toBeUndefined();
  });
  it('FR-IN-07: 端に付いた RLM などの書式文字は除いて照合する', () => {
    expect(matchMissingToken('\u200f□\u200f', tokens)).toBe('illegible');
    expect(matchMissingToken('\ufeff〔欠〕\u202c', tokens)).toBe('lost');
  });
  it('FR-IN-07: ゼロ幅空白だけのセルは unrecorded', () => {
    expect(matchMissingToken('\u200b', tokens)).toBe('unrecorded');
    expect(matchMissingToken('\u200f \u2060', tokens)).toBe('unrecorded');
  });
  it('FR-IN-07: 語の中の ZWNJ は残す（端の ZWNJ は落とす）', () => {
    expect(cleanMissingCell('می\u200cخواهم')).toBe('می\u200cخواهم');
    expect(cleanMissingCell('\u200cx\u200c')).toBe('x');
  });
  it('FR-IN-07: compileMissingTokens は一度だけ表を作り、空と重複を報告する', () => {
    const c = compileMissingTokens([
      { token: '□', reason: 'illegible' },
      { token: '\u200f□', reason: 'lost' },
      { token: ' \u200b', reason: 'lost' },
    ]);
    expect(c.problems).toEqual([
      { index: 1, kind: 'duplicate' },
      { index: 2, kind: 'empty' },
    ]);
    // 重複は先の記号が残る。コンパイル済みの表でも配列でも同じ結果
    expect(matchMissingToken('□', c)).toBe('illegible');
    expect(matchMissingToken('x', c)).toBeUndefined();
  });
});
