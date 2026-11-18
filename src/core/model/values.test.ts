import { describe, expect, it } from 'vitest';
import {
  MISSING_REASONS,
  attrValues,
  isCertainty,
  isDateAttr,
  isMissing,
  isMissingReason,
  isValueAttr,
  scalarValues,
  dateValues,
  type AttrValue,
} from './index';
import { bceDate, hijriDate } from './fixtures/sampleDataset';

describe('欠損と型ガード（FR-DM-04）', () => {
  it.each(MISSING_REASONS)('FR-DM-04: 欠損の理由 %s を持てる', (reason) => {
    const v: AttrValue = { kind: 'missing', reason };
    expect(isMissing(v)).toBe(true);
    expect(isMissingReason(reason)).toBe(true);
  });

  it('FR-DM-04: 欠損の 4 種の理由が揃っている', () => {
    expect([...MISSING_REASONS].sort()).toEqual([
      'illegible',
      'lost',
      'not-applicable',
      'unrecorded',
    ]);
  });

  it('FR-DM-04: 空文字、null、理由の無いもの、未知の理由は欠損ではない', () => {
    expect(isMissing('')).toBe(false);
    expect(isMissing(null)).toBe(false);
    expect(isMissing(undefined)).toBe(false);
    expect(isMissing('missing')).toBe(false);
    expect(isMissing({ kind: 'missing' })).toBe(false);
    expect(isMissing({ kind: 'missing', reason: 'nope' })).toBe(false);
    expect(isMissingReason('nope')).toBe(false);
  });

  it('FR-DM-04: 確からしさの検査', () => {
    expect(isCertainty('probable')).toBe(true);
    expect(isCertainty('maybe')).toBe(false);
  });

  it('FR-DM-05: isDateAttr と isValueAttr は kind で絞り込む', () => {
    const d: AttrValue = { kind: 'date', value: hijriDate };
    const s: AttrValue = { kind: 'value', value: 'x' };
    expect(isDateAttr(d)).toBe(true);
    expect(isDateAttr(s)).toBe(false);
    expect(isValueAttr(s)).toBe(true);
    expect(isValueAttr(d)).toBe(false);
  });
});

describe('属性値の取り出し（FR-DM-07）', () => {
  it('FR-DM-07: 1 値、複数値、日付、複数の日付、欠損を配列にそろえる', () => {
    expect(attrValues({ kind: 'value', value: 'a' })).toEqual(['a']);
    expect(attrValues({ kind: 'value', value: ['a', 2, true] })).toEqual(['a', 2, true]);
    expect(attrValues({ kind: 'date', value: hijriDate })).toEqual([hijriDate]);
    expect(attrValues({ kind: 'date', value: [hijriDate, bceDate] })).toEqual([hijriDate, bceDate]);
    expect(attrValues({ kind: 'missing', reason: 'lost' })).toEqual([]);
  });

  it('FR-DM-07: scalarValues と dateValues は 1 値でも複数値でも配列を返す', () => {
    expect(scalarValues({ kind: 'value', value: 'a' })).toEqual(['a']);
    expect(scalarValues({ kind: 'value', value: [1, 2] })).toEqual([1, 2]);
    expect(dateValues({ kind: 'date', value: hijriDate })).toEqual([hijriDate]);
    expect(dateValues({ kind: 'date', value: [bceDate] })).toEqual([bceDate]);
  });

  it('FR-DM-05: 想定外の kind を実行時に検出する', () => {
    // @ts-expect-error 古いファイルなどで来る未知の種類を、型を無視して渡す
    expect(() => attrValues({ kind: 'weird' })).toThrow();
  });
});
