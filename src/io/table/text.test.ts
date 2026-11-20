import { describe, expect, it } from 'vitest';
import { decodeTable, parseTextTable } from './text';

describe('FR-IN-01: 文字コード', () => {
  it('UTF-8 の日本語とアラビア文字を保つ', () => {
    const text = '名前,اسم\n東京,محمد';
    expect(decodeTable(new TextEncoder().encode(text))).toEqual({
      text,
      encoding: 'utf-8',
      warnings: [],
    });
  });
  it('末尾の不正バイトも検査し Shift_JIS に切り替える', () => {
    const result = decodeTable(new Uint8Array([0x61, 0x0a, 0x82, 0xa0]));
    expect(result.encoding).toBe('shift_jis');
    expect(result.text).toBe('a\nあ');
  });
  it('他言語のバイトと紛らわしい半角カナを警告する', () => {
    expect(decodeTable(new Uint8Array([0xc7, 0xc8])).warnings[0]?.code).toBe('suspect-encoding');
  });
  it('UTF-16/32 BOM と未対応の手動指定を拒む', () => {
    for (const bytes of [
      [255, 254],
      [254, 255],
      [0, 0, 254, 255],
    ]) {
      expect(() => decodeTable(new Uint8Array(bytes))).toThrow(RangeError);
    }
    expect(() => decodeTable(new Uint8Array(), 'windows-1256')).toThrow(RangeError);
  });
  it('UTF-8 BOM を優先し、不正な内容は置換の警告を返す', () => {
    const result = decodeTable(new Uint8Array([239, 187, 191, 255]), 'shift_jis');
    expect(result.encoding).toBe('utf-8');
    expect(result.warnings[0]?.code).toBe('replacement');
  });
});

describe('FR-IN-01 / FR-IN-06: レコードの解析', () => {
  it('引用内の区切り、改行、二重引用符を保持する', () => {
    expect(parseTextTable('a,b\r\n"x,y","a\n""b"""\r\n').rows).toEqual([['x,y', 'a\n"b"']]);
  });
  it('TSV、空セル、末尾の空セルを保持する', () => {
    expect(parseTextTable('a\tb\n\t', '\t').rows).toEqual([['', '']]);
    expect(parseTextTable('a\n""').rows).toEqual([['']]);
    expect(parseTextTable('').headers).toEqual([]);
  });
  it('複数物理行の次でもレコード番号を警告に使い、行を捨てない', () => {
    const result = parseTextTable('a,b\n"x\ny",z\nshort\n');
    expect(result.rows).toHaveLength(2);
    expect(result.warnings[0]?.row).toBe(3);
  });
  it('壊れた引用を黙って解釈しない', () => {
    for (const text of ['a\n"open', 'a\nx"y', 'a\n"x"tail']) {
      expect(() => parseTextTable(text)).toThrow(SyntaxError);
    }
  });
  it('重複ヘッダと特殊な列名を上書きしない', () => {
    expect(parseTextTable('__proto__,a,a\nx,y,z').headers).toEqual(['__proto__', 'a', 'a']);
  });
});
