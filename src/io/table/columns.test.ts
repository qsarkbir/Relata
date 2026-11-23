import { expect, it } from 'vitest';
import {
  convertCell,
  createCellConverter,
  inferColumnType,
  isPossibleSuffixColumn,
} from './columns';

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

it('FR-IN-05: 真偽値は大小文字と空白を許容し、数値表現は受け付けない', () => {
  expect(convertCell(' TRUE ', { type: 'boolean' }).value).toEqual({ kind: 'value', value: true });
  expect(convertCell(' false ', { type: 'boolean' }).value).toEqual({
    kind: 'value',
    value: false,
  });
  for (const text of [' 1 ', '0']) expect(convertCell(text, { type: 'boolean' }).ok).toBe(false);
  expect(convertCell(' \uFEFF1.5 ', { type: 'number' }).value).toEqual({
    kind: 'value',
    value: 1.5,
  });
});
it('FR-IN-05 / FR-IN-07: 準備した変換関数でも欠損と不正値を同じように判定する', () => {
  // 【TS】as const は列の型と欠損理由を文字列リテラルとして保つ。
  const options = { type: 'number', missingTokens: [{ token: '□', reason: 'lost' }] } as const;
  const convert = createCellConverter(options);
  for (const text of ['□', '', ' 2 ', 'not-number'])
    expect(convert(text)).toEqual(convertCell(text, options));
  expect(inferColumnType(['□', 'true', ' FALSE '], options.missingTokens)).toBe('boolean');
});

it('FR-DM-06: 末尾の ? を可能性ありと読む選択は、有効な列だけで効く', () => {
  const on = { type: 'string', possibleSuffix: true } as const;
  expect(convertCell('Basra?', on).value).toEqual({
    kind: 'value',
    value: 'Basra',
    certainty: 'possible',
  });
  // 1 個以上の ? を外す。前後の空白も許す
  expect(convertCell('Basra ??? ', on).value).toEqual({
    kind: 'value',
    value: 'Basra',
    certainty: 'possible',
  });
  // 既定は無効: 原文のまま
  expect(convertCell('Basra?', { type: 'string' }).value).toEqual({
    kind: 'value',
    value: 'Basra?',
  });
  // ? が無ければ certainty を持たない
  expect(convertCell('Basra', on).value).toEqual({ kind: 'value', value: 'Basra' });
  // ? だけの値は外すと空になるので、原文のまま
  expect(convertCell('?', on).value).toEqual({ kind: 'value', value: '?' });
  // 数値と複数値
  expect(convertCell('1050?', { type: 'number', possibleSuffix: true }).value).toEqual({
    kind: 'value',
    value: 1050,
    certainty: 'possible',
  });
  expect(convertCell('a?;b', { ...on, separator: ';' }).value).toEqual({
    kind: 'value',
    value: ['a', 'b'],
    certainty: 'possible',
  });
  // 欠損の記号は、? を外す前の原文で照合する
  expect(
    convertCell('?', { ...on, missingTokens: [{ token: '?', reason: 'unrecorded' }] }).value,
  ).toEqual({ kind: 'missing', reason: 'unrecorded' });
  // 日付の列は対象外（日付の解析が ? を扱う）。原文の ? を勝手に外さない
  const date = convertCell('1650?', { type: 'date', possibleSuffix: true });
  expect(date.value.kind === 'value' && 'certainty' in date.value).toBe(false);
});

it('FR-DM-06: 外した値が欠損の記号なら、値にせずその記号の欠損にする', () => {
  const opts = {
    type: 'string',
    possibleSuffix: true,
    missingTokens: [
      { token: 'unknown', reason: 'unrecorded' },
      { token: '〔欠〕', reason: 'lost' },
    ],
  } as const;
  expect(convertCell('unknown?', opts).value).toEqual({ kind: 'missing', reason: 'unrecorded' });
  expect(convertCell('〔欠〕?', opts).value).toEqual({ kind: 'missing', reason: 'lost' });
  expect(convertCell('Basra?', opts).value).toMatchObject({ kind: 'value', value: 'Basra' });
});

it('FR-DM-06: アラビア語の疑問符、全角の ？、末尾の RLM を扱う', () => {
  const on = { type: 'string', possibleSuffix: true } as const;
  const possible = (v: string) => ({ kind: 'value', value: v, certainty: 'possible' });
  expect(convertCell('بصرة؟', on).value).toEqual(possible('بصرة'));
  expect(convertCell('بصرة؟‏', on).value).toEqual(possible('بصرة'));
  expect(convertCell('بصرة‏؟', on).value).toEqual(possible('بصرة'));
  expect(convertCell('東京？', on).value).toEqual(possible('東京'));
  expect(convertCell('بصرة‏', on).value).toEqual({ kind: 'value', value: 'بصرة‏' });
});

it('FR-DM-06: 保存した possibleSuffixColumns から列ごとの有効・無効を引く（表の区別つき）', () => {
  const refs = [{ column: 'place' }, { column: 'note', table: 'node' as const }];
  expect(isPossibleSuffixColumn(refs, 'place')).toBe(true);
  expect(isPossibleSuffixColumn(refs, 'note', 'node')).toBe(true);
  expect(isPossibleSuffixColumn(refs, 'note', 'edge')).toBe(false);
  expect(isPossibleSuffixColumn(refs, 'note')).toBe(false);
  expect(isPossibleSuffixColumn(undefined, 'place')).toBe(false);
});
