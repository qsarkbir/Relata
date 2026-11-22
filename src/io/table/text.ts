/** CSV/TSV の文字コードとレコードの解析（FR-IN-01、FR-IN-06、D-27）。 */

/** 手動で選べる文字コード。追加時は表示名も同じ場所で定義する。 */
export const MANUAL_ENCODINGS = [
  { label: 'utf-8', name: 'UTF-8' },
  { label: 'shift_jis', name: 'Shift_JIS (CP932)' },
] as const;
/** 自動判定の順序。UTF-8 を先に全体検査する。 */
export const AUTO_ENCODINGS: readonly string[] = MANUAL_ENCODINGS.map((e) => e.label);

/** ファイル全体またはレコードに関する警告。行番号はヘッダを 1 とするレコード番号。 */
export interface TableWarning {
  readonly code: 'replacement' | 'suspect-encoding' | 'column-count' | 'excel-cell';
  readonly row?: number;
  readonly message: string;
}

/** 復号結果。プレビューには text の先頭を使える。 */
export interface DecodedTable {
  readonly text: string;
  readonly encoding: string;
  readonly warnings: readonly TableWarning[];
}

/**
 * ファイル全体を復号し、判定結果と注意を返す。
 *
 * @param bytes - ファイルの全バイト
 * @param encoding - 手動指定。省略すると自動判定
 * @returns 復号した文字列。未対応の BOM や指定には RangeError
 */
export function decodeTable(bytes: Uint8Array, encoding?: string): DecodedTable {
  // 【なぜ】UTF-16/32 を Shift_JIS と誤認し、史料の名前を壊して取り込まないため。
  const unsupportedBom =
    (bytes[0] === 0xff && bytes[1] === 0xfe) ||
    (bytes[0] === 0xfe && bytes[1] === 0xff) ||
    (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff);
  if (unsupportedBom)
    throw new RangeError('UTF-16/32 の BOM は未対応です。UTF-8 で保存してください。');
  if (encoding !== undefined && !MANUAL_ENCODINGS.some((e) => e.label === encoding)) {
    throw new RangeError(`未対応の文字コード: ${encoding}`);
  }
  const utf8Bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const candidates = utf8Bom ? AUTO_ENCODINGS.slice(0, 1) : encoding ? [encoding] : AUTO_ENCODINGS;
  for (const candidate of candidates) {
    try {
      const text = new TextDecoder(candidate, { fatal: true }).decode(bytes);
      const suspicious = candidate === 'shift_jis' && /[\uff61-\uff9f]/u.test(text);
      return {
        text,
        encoding: candidate,
        warnings: suspicious
          ? [
              {
                code: 'suspect-encoding',
                message: '半角カナを含みます。文字コードと試し読みを確認してください。',
              },
            ]
          : [],
      };
    } catch {
      // 次の候補を試す。先頭だけで判定せず、末尾まで厳密に読む。
    }
  }
  const fallback = candidates[0] ?? AUTO_ENCODINGS[0] ?? 'utf-8';
  // 自動判定がすべて失敗したときは UTF-8。手動指定は指定した文字コードを保つ。
  return {
    text: new TextDecoder(fallback).decode(bytes),
    encoding: fallback,
    warnings: [
      {
        code: 'replacement',
        message: '復号できないバイトを置換文字にしました。文字コードを確認してください。',
      },
    ],
  };
}

/** 解析済みの表。列名をキーにせず配列で持ち、重複名や __proto__ も保持する。 */
export interface TextTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly warnings: readonly TableWarning[];
}

/**
 * 引用符、引用内の改行、二重引用符を含む CSV/TSV を解析する。
 *
 * RFC 4180 の引用規則で 1 文字ずつ走査する。時間・領域 O(N)。
 * 壊れた引用は位置つき SyntaxError、列数の違いは行を残して警告にする。
 * @param text - 復号済みの表
 * @param delimiter - カンマまたはタブ
 * @returns ヘッダ、データ行、レコード単位の警告
 */
export function parseTextTable(text: string, delimiter: ',' | '\t' = ','): TextTable {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  // 【TS】文字列リテラルの共用体で、引用の前後を区別する。
  let state: 'plain' | 'quoted' | 'closed' = 'plain';
  const finishCell = () => {
    record.push(cell);
    cell = '';
    state = 'plain';
  };
  const finishRecord = () => {
    finishCell();
    records.push(record);
    record = [];
  };
  const input = text.replace(/^\ufeff/u, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === undefined) break;
    if (state === 'quoted') {
      if (c === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else state = 'closed';
      } else cell += c;
    } else if (c === delimiter) finishCell();
    else if (c === '\r' || c === '\n') {
      if (c === '\r' && input[i + 1] === '\n') i++;
      finishRecord();
    } else if (c === '"' && state === 'plain' && cell === '') state = 'quoted';
    else if (state === 'closed' || c === '"') {
      throw new SyntaxError(`レコード ${String(records.length + 1)}: 引用符の位置が不正です。`);
    } else cell += c;
  }
  if (state === 'quoted')
    throw new SyntaxError(`レコード ${String(records.length + 1)}: 引用符が閉じていません。`);
  if (cell !== '' || record.length > 0 || state === 'closed') finishRecord();
  const headers = records.shift() ?? [];
  const warnings: TableWarning[] = [];
  for (const [i, row] of records.entries()) {
    if (row.length !== headers.length)
      warnings.push({
        code: 'column-count',
        row: i + 2,
        message: 'ヘッダと列数が異なります。行は保持しました。',
      });
  }
  return { headers, rows: records, warnings };
}
