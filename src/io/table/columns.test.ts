import { expect, it } from 'vitest';
import { convertCell, inferColumnType } from './columns';

it('FR-IN-05: 列全体を検査し、年だけの列は数値を優先する', () => {
  expect(inferColumnType(['', '1650', '1660'])).toBe('number');
  expect(inferColumnType(['true', 'false'])).toBe('boolean');
  expect(inferColumnType(['1650-01-01'])).toBe('date');
  expect(inferColumnType(['1', 'abc'])).toBe('string');
});
it('FR-IN-05 / FR-IN-07: 欠損理由、複数値、列のヒジュラ暦を保つ', () => {
  expect(
    convertCell('〔欠〕', { type: 'date', missingTokens: [{ token: '〔欠〕', reason: 'lost' }] })
      .value,
  ).toEqual({ kind: 'missing', reason: 'lost' });
  expect(convertCell('1;2', { type: 'number', separator: ';' }).value).toEqual({
    kind: 'value',
    value: [1, 2],
  });
  const result = convertCell('1050', { type: 'date', calendar: 'hijri' });
  expect(result.ok).toBe(true);
  expect(result.value).toMatchObject({ kind: 'date', value: { calendar: 'hijri', label: '1050' } });
});
it('FR-IN-06: 不正な値や複数値中の欠損を捨てず原文を返す', () => {
  for (const text of ['Infinity', '0xff', '1;;2']) {
    const result = convertCell(text, { type: 'number', separator: ';' });
    expect(result.ok).toBe(false);
    expect(result.value).toEqual({ kind: 'value', value: text });
    expect(result.warnings).not.toHaveLength(0);
  }
});
