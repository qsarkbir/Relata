/** Excel は選択時だけ動的にロードする（FR-IN-02、R-05）。 */
import { gregorianToJdn, jdnToGregorian } from '../../core/time';
import type { TableWarning, TextTable } from './text';

/** シート名の一覧と、選択したシートの読み取り口。 */
export interface ExcelWorkbook {
  readonly sheets: readonly string[];
  readonly readSheet: (name: string) => TextTable;
}

/**
 * Excel の日付シリアルをグレゴリオ暦の日付文字列にする。
 *
 * 【なぜ】1900 年方式の 60 は実在しない 1900-02-29。補正して別の日にせず拒否する。
 * Date を介さないので、タイムゾーンや夏時間による日付のずれもない。
 * @param serial - Excel の日付シリアル（整数の日）
 * @param date1904 - 1904 年方式か
 * @returns YYYY/MM/DD。方式の起点より前、存在しない日や時刻つきには RangeError
 */
export function excelSerialDate(serial: number, date1904 = false): string {
  if (!Number.isSafeInteger(serial) || serial < (date1904 ? 0 : 1) || (!date1904 && serial === 60))
    throw new RangeError('Excel の日付が整数の日でないか、実在しない 1900-02-29 です。');
  const base = date1904 ? gregorianToJdn(1904, 1, 1) : gregorianToJdn(1899, 12, 31);
  const date = jdnToGregorian(base + serial - (!date1904 && serial > 60 ? 1 : 0));
  // BC を明記し、parseDate の歴史学の年（年 0 なし）に合わせる。
  const year = date.year <= 0 ? `BC${String(1 - date.year)}` : String(date.year);
  return `${year}/${String(date.month).padStart(2, '0')}/${String(date.day).padStart(2, '0')}`;
}

/**
 * xlsx の全バイトをローカルで開き、シートを選べる読み取り口を返す。
 * @param bytes - xlsx ファイル
 * @returns シート名と、選択したシートを表にする関数
 */
export async function openExcel(bytes: Uint8Array): Promise<ExcelWorkbook> {
  const xlsx = await import('xlsx');
  const { read, utils } = xlsx;
  // 【TS】公開 API の SSF は型定義が any のため、利用する関数だけの型を付ける。
  // 理由: SheetJS 0.20.3 の公開 API is_date(format: string): boolean に対応する。
  const formats = xlsx.SSF as { is_date: (format: string) => boolean };
  const book = read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: false });
  if (book.bookType !== 'xlsx') throw new RangeError('xlsx 形式のファイルを選んでください。');
  const date1904 = book.Workbook?.WBProps?.date1904 === true;
  return {
    sheets: [...book.SheetNames],
    readSheet: (name) => {
      if (!book.SheetNames.includes(name)) throw new RangeError('指定されたシートはありません。');
      const sheet = book.Sheets[name];
      if (sheet?.['!ref'] === undefined) return { headers: [], rows: [], warnings: [] };
      const range = utils.decode_range(sheet['!ref']);
      const records: string[][] = [];
      const warnings: TableWarning[] = [];
      // A1 を起点にして、先頭の空行・空列も残す。行番号が元の Excel の行と一致する。
      for (let r = 0; r <= range.e.r; r++) {
        const row: string[] = [];
        for (let c = 0; c <= range.e.c; c++) {
          // 【TS】ライブラリの any を unknown に閉じ込め、セルの形を実行時に調べる。
          const cell: unknown = sheet[utils.encode_cell({ r, c })];
          let text = '';
          if (typeof cell === 'object' && cell !== null && 't' in cell) {
            const value: unknown = 'v' in cell ? cell.v : undefined;
            const format: unknown = 'z' in cell ? cell.z : undefined;
            if (cell.t === 'e' || ('f' in cell && value === undefined)) {
              warnings.push({
                code: 'excel-cell',
                row: r + 1,
                message: `列 ${String(c + 1)}: エラーまたは計算結果のない数式です。`,
              });
              text = String(value ?? ('f' in cell ? cell.f : ''));
            } else if (
              typeof value === 'number' &&
              typeof format === 'string' &&
              formats.is_date(format)
            ) {
              try {
                text = excelSerialDate(value, date1904);
              } catch {
                text = String(value);
                warnings.push({
                  code: 'excel-cell',
                  row: r + 1,
                  message: `列 ${String(c + 1)}: 日付を変換できません。シリアル値を保持しました。`,
                });
              }
            } else if (
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean'
            )
              text = String(value);
          }
          row.push(text);
        }
        records.push(row);
      }
      return { headers: records.shift() ?? [], rows: records, warnings };
    },
  };
}
