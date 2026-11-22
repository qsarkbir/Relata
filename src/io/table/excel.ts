/** Excel は選択時だけ動的にロードする（FR-IN-02、R-05）。 */
import { gregorianToJdn, jdnToGregorian } from '../../core/time';
import type { TableWarning, TextTable } from './text';

/** シート名の一覧と、選択したシートの読み取り口。 */
export interface ExcelWorkbook {
  readonly sheets: readonly string[];
  readonly readSheet: (name: string) => TextTable;
}

/**
 * 読み込める xlsx ファイルの大きさの上限（バイト）。
 *
 * 【なぜ】解析は画面と同じスレッドで動く。上限を超える大きさのファイルで、タブが固まるのを防ぐ。
 * 想定する最大の規模（5000 ノード、20000 エッジ。NFR-05）の表でも、数 MB に収まる。
 */
export const EXCEL_MAX_BYTES = 50 * 1024 * 1024;
/**
 * 1 枚のシートから読むセルの数（行数 × 列数）の上限。
 *
 * 【なぜ】書式を列全体に掛けたシートは、範囲（`!ref`）が 1,048,576 行に及ぶことがある。
 * 範囲ではなく値のあるセルから大きさを決めるが、離れた所に値が 1 つあるだけでも大きくなるので、上限を設ける。
 */
export const EXCEL_MAX_CELLS = 2_000_000;

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
 * バイト列が ZIP の局所ファイルヘッダ（`PK\x03\x04`）で始まるかを確かめる。
 *
 * 【なぜ】xlsx は ZIP の入れ物。SheetJS の `read` は xls、ods、HTML、SYLK なども解析するので、
 * 解析した後に形式を確かめるのでは、信頼できないファイルを余計な解析器に通してしまう。先に入れ物を確かめる。
 * @param bytes - ファイルの全バイト
 * @returns ZIP の署名で始まれば true
 */
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * xlsx の全バイトをローカルで開き、シートを選べる読み取り口を返す。
 *
 * シートの大きさは、`!ref`（ファイルに書かれた範囲）ではなく、値のあるセルから決める。
 * 範囲の末尾にある空の行と列は読まない。先頭と途中の空の行は残す（行番号を Excel と揃えるため）。
 * @param bytes - xlsx ファイル
 * @returns シート名と、選択したシートを表にする関数
 * @throws RangeError - 大きすぎるファイル、xlsx でないファイル、大きすぎるシート
 */
export async function openExcel(bytes: Uint8Array): Promise<ExcelWorkbook> {
  if (bytes.length > EXCEL_MAX_BYTES)
    throw new RangeError(
      `ファイルが大きすぎます（上限 ${String(EXCEL_MAX_BYTES / 1024 / 1024)} MB）。`,
    );
  if (!isZip(bytes)) throw new RangeError('xlsx 形式のファイルを選んでください。');
  const xlsx = await import('xlsx');
  const { read, utils } = xlsx;
  // 【TS】公開 API の SSF は型定義が any のため、利用する関数だけの型を付ける。
  // 理由: SheetJS 0.20.3 の公開 API is_date(format: string): boolean に対応する。
  const formats = xlsx.SSF as { is_date: (format: string) => boolean };
  const book = read(bytes, { type: 'array', cellDates: false, cellNF: true, cellText: false });
  if (book.bookType !== 'xlsx') throw new RangeError('xlsx 形式のファイルを選んでください。');
  const date1904 = book.Workbook?.WBProps?.date1904 === true;
  const tools: SheetTools = {
    decodeCell: (address) => utils.decode_cell(address),
    encodeCell: (cell) => utils.encode_cell(cell),
    isDate: (format) => formats.is_date(format),
  };
  return {
    sheets: [...book.SheetNames],
    readSheet: (name) => {
      if (!book.SheetNames.includes(name)) throw new RangeError('指定されたシートはありません。');
      const sheet = book.Sheets[name];
      if (sheet?.['!ref'] === undefined) return { headers: [], rows: [], warnings: [] };
      return sheetToTable(sheet, tools, date1904);
    },
  };
}

/**
 * セルが、表に読む値を持つかを判定する。
 *
 * 空の文字列だけのセルや、書式だけのセルは、値を持たないとみなす。エラーと数式は値として扱う
 * （読み込みで警告を出すため）。
 * @param cell - SheetJS のセル（形は実行時に調べる）
 * @returns 値を持てば true
 */
function hasContent(cell: unknown): boolean {
  if (typeof cell !== 'object' || cell === null || !('t' in cell)) return false;
  if (cell.t === 'e' || 'f' in cell) return true;
  const value: unknown = 'v' in cell ? cell.v : undefined;
  return value !== undefined && value !== null && value !== '';
}

/** シートの読み取りに使う SheetJS の関数。テストでは同じ関数を直接渡す。 */
export interface SheetTools {
  readonly decodeCell: (address: string) => { readonly r: number; readonly c: number };
  readonly encodeCell: (cell: { readonly r: number; readonly c: number }) => string;
  readonly isDate: (format: string) => boolean;
}

/**
 * SheetJS のシート（セルの番地をキーに持つオブジェクト）を、文字列の表にする。
 *
 * 【なぜ】`openExcel` から切り出す。巨大な範囲を持つシートの検査を、xlsx ファイルを書かずに
 * テストできるようにするため（範囲が巨大なファイルは、テストの準備で書き出すだけで時間がかかる）。
 * @param sheet - シート。キーはセルの番地（'A1' など）と、'!' で始まる付帯情報
 * @param tools - 番地の変換と、日付の書式の判定
 * @param date1904 - ブックが 1904 年方式か
 * @returns ヘッダ、データ行、セル単位の警告
 * @throws RangeError - 値のある範囲が {@link EXCEL_MAX_CELLS} を超えるとき
 */
// 【TS】`Readonly<Record<string, unknown>>` は「どんな文字列のキーでも引けるオブジェクト」の型。
//       値は unknown なので、使う前に形を調べる必要がある。
export function sheetToTable(
  sheet: Readonly<Record<string, unknown>>,
  tools: SheetTools,
  date1904: boolean,
): TextTable {
  // 手順 1: 値のあるセルだけを見て、最後の行と列を求める。時間 O(セルの数)。
  // 【なぜ】`!ref` はファイルに書かれた範囲をそのまま使うので、空の行や列を含みうる。
  // 範囲の末尾の空行は「ラベルが空」などのエラーになり、取込全体が止まっていた。
  let lastRow = -1;
  let lastColumn = -1;
  for (const address of Object.keys(sheet)) {
    // 【なぜ】'!' で始まるキーは、範囲や結合などの付帯情報で、セルではない。
    if (address.startsWith('!')) continue;
    const cell: unknown = sheet[address];
    if (!hasContent(cell)) continue;
    const { r, c } = tools.decodeCell(address);
    if (r > lastRow) lastRow = r;
    if (c > lastColumn) lastColumn = c;
  }
  if (lastRow < 0) return { headers: [], rows: [], warnings: [] };
  if ((lastRow + 1) * (lastColumn + 1) > EXCEL_MAX_CELLS)
    throw new RangeError(
      `シートが大きすぎます（${String(lastRow + 1)} 行 × ${String(lastColumn + 1)} 列）。` +
        `離れたセルに値が残っていないか確かめてください（上限 ${String(EXCEL_MAX_CELLS)} セル）。`,
    );
  const records: string[][] = [];
  const warnings: TableWarning[] = [];
  // 手順 2: A1 を起点にして、先頭の空行・空列も残す。行番号が元の Excel の行と一致する。
  for (let r = 0; r <= lastRow; r++) {
    const row: string[] = [];
    for (let c = 0; c <= lastColumn; c++) {
      // 【TS】ライブラリの any を unknown に閉じ込め、セルの形を実行時に調べる。
      const cell: unknown = sheet[tools.encodeCell({ r, c })];
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
          tools.isDate(format)
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
}
