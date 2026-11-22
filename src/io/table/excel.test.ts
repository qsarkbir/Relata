import { expect, it } from 'vitest';
import { SSF, utils, write } from 'xlsx';
import {
  EXCEL_MAX_BYTES,
  excelSerialDate,
  openExcel,
  sheetToTable,
  type SheetTools,
} from './excel';

// 【TS】SheetJS の SSF は型定義が any のため、使う関数だけの型を付ける（excel.ts と同じ理由）。
const dateFormats = SSF as { is_date: (format: string) => boolean };
// 【なぜ】openExcel が使うのと同じ SheetJS の関数を渡す。
const tools: SheetTools = {
  decodeCell: (address) => utils.decode_cell(address),
  encodeCell: (cell) => utils.encode_cell(cell),
  isDate: (format) => dateFormats.is_date(format),
};

it('FR-IN-02: シリアル値の起点、架空の閏日、時刻を検査する', () => {
  expect(excelSerialDate(1)).toBe('1900/01/01');
  expect(excelSerialDate(59)).toBe('1900/02/28');
  expect(excelSerialDate(61)).toBe('1900/03/01');
  expect(excelSerialDate(0, true)).toBe('1904/01/01');
  expect(() => excelSerialDate(-1, true)).toThrow(RangeError);
  for (const value of [-1, 0, 60, 1.5, Infinity])
    expect(() => excelSerialDate(value)).toThrow(RangeError);
});

it('FR-IN-02: 実際の xlsx バイトからシートを選び、文字・空欄・日付を保つ', async () => {
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['name', 'date', 'missing'],
      ['محمد', 61, null],
      ['東京', 60, '□'],
    ]),
    '人物',
  );
  utils.book_append_sheet(book, utils.aoa_to_sheet([['x'], [' y ']]), 'その他');
  const sheet = book.Sheets['人物'];
  if (sheet === undefined) throw new Error('fixture');
  sheet.B2 = { t: 'n', v: 61, z: 'yyyy-mm-dd' };
  sheet.B3 = { t: 'n', v: 60, z: 'yyyy-mm-dd' };
  const bytes: unknown = write(book, { type: 'array', bookType: 'xlsx' });
  if (!(bytes instanceof ArrayBuffer)) throw new Error('fixture bytes');
  const excel = await openExcel(new Uint8Array(bytes));
  expect(excel.sheets).toEqual(['人物', 'その他']);
  const table = excel.readSheet('人物');
  expect(table.rows).toEqual([
    ['محمد', '1900/03/01', ''],
    ['東京', '60', '□'],
  ]);
  expect(table.warnings[0]).toMatchObject({ code: 'excel-cell', row: 3 });
  expect(excel.readSheet('その他').rows).toEqual([[' y ']]);
  expect(() => excel.readSheet('ない')).toThrow(RangeError);
});

it('FR-IN-02: 1904 年起点のブックを Date を介さず換算する', async () => {
  const book = utils.book_new();
  book.Workbook = { WBProps: { date1904: true } };
  const sheet = utils.aoa_to_sheet([['date'], [0]]);
  sheet.A2 = { t: 'n', v: 0, z: 'yyyy-mm-dd' };
  utils.book_append_sheet(book, sheet, 'sheet');
  const bytes: unknown = write(book, { type: 'array', bookType: 'xlsx' });
  if (!(bytes instanceof ArrayBuffer)) throw new Error('fixture bytes');
  expect((await openExcel(new Uint8Array(bytes))).readSheet('sheet').rows).toEqual([
    ['1904/01/01'],
  ]);
});

/**
 * シートを 1 枚持つ xlsx のバイト列を作る。
 *
 * @param sheet - シート
 * @returns xlsx のバイト列
 */
function workbookBytes(sheet: ReturnType<typeof utils.aoa_to_sheet>): Uint8Array {
  const book = utils.book_new();
  utils.book_append_sheet(book, sheet, 'sheet');
  const bytes: unknown = write(book, { type: 'array', bookType: 'xlsx' });
  if (!(bytes instanceof ArrayBuffer)) throw new Error('fixture bytes');
  return new Uint8Array(bytes);
}

it('FR-IN-02: 範囲（!ref）の末尾にある空の行と列は読まない', async () => {
  const sheet = utils.aoa_to_sheet([
    ['source', 'target'],
    ['a', 'b'],
    ['b', 'c'],
  ]);
  // 【なぜ】書式だけを広く掛けたファイルでは、範囲が値のある所より広く書かれる。
  sheet['!ref'] = 'A1:D8';
  const table = (await openExcel(workbookBytes(sheet))).readSheet('sheet');
  expect(table.headers).toEqual(['source', 'target']);
  expect(table.rows).toEqual([
    ['a', 'b'],
    ['b', 'c'],
  ]);
});

it('FR-IN-02: 列全体に及ぶ範囲でも、値のあるセルだけを読んで固まらない', () => {
  const sheet = utils.aoa_to_sheet([['name'], ['x']]);
  sheet['!ref'] = 'A1:XFD1048576';
  expect(sheetToTable(sheet, tools, false).rows).toEqual([['x']]);
});

it('FR-IN-02: 途中の空の行は残し、行番号を Excel と揃える', async () => {
  const sheet = utils.aoa_to_sheet([['name'], ['x'], [], ['y']]);
  const table = (await openExcel(workbookBytes(sheet))).readSheet('sheet');
  expect(table.rows).toEqual([['x'], [''], ['y']]);
});

it('FR-IN-02: 離れたセルの値で大きくなりすぎるシートは、理由を示して拒む', () => {
  const sheet = utils.aoa_to_sheet([['name']]);
  sheet.Z200000 = { t: 's', v: 'stray' };
  sheet['!ref'] = 'A1:Z200000';
  expect(() => sheetToTable(sheet, tools, false)).toThrow(/シートが大きすぎます/);
});

it('FR-IN-02: ZIP でないファイルは、解析する前に拒む', async () => {
  const csv = new TextEncoder().encode('name\nx\n');
  await expect(openExcel(csv)).rejects.toThrow(/xlsx 形式/);
  await expect(openExcel(new Uint8Array())).rejects.toThrow(/xlsx 形式/);
});

it('FR-IN-02: 上限より大きいファイルは、読む前に拒む', async () => {
  const big = new Uint8Array(EXCEL_MAX_BYTES + 1);
  big.set([0x50, 0x4b, 0x03, 0x04]);
  await expect(openExcel(big)).rejects.toThrow(/大きすぎます/);
});
