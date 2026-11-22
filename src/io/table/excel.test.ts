import { expect, it } from 'vitest';
import { utils, write } from 'xlsx';
import { excelSerialDate, openExcel } from './excel';

it('FR-IN-02: シリアル値の起点、架空の閏日、時刻を検査する', () => {
  expect(excelSerialDate(1)).toBe('1900/01/01');
  expect(excelSerialDate(59)).toBe('1900/02/28');
  expect(excelSerialDate(61)).toBe('1900/03/01');
  expect(excelSerialDate(0, true)).toBe('1904/01/01');
  for (const value of [60, 1.5, Infinity]) expect(() => excelSerialDate(value)).toThrow(RangeError);
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
