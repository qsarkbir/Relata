/**
 * 欠損の記号の照合（FR-IN-07、要件 §6.5、D-24）。
 */
import type { MissingReason } from '../../core/model';
import type { MissingToken } from './types';

// 【なぜ】両端から落とす「見えない書式文字」の一覧。ゼロ幅の文字（U+200B〜U+200F）、双方向の制御文字
//   （U+202A〜U+202E、U+2066〜U+2069、U+061C）、WORD JOINER（U+2060）、BOM（U+FEFF）、NEL（U+0085）。
//   アラビア文字やヘブライ文字の表では、セルの端に RLM などが紛れ込みやすく、目には同じ記号に見えるため。
//   `\s` は Unicode の空白（NBSP、全角空白など）を含む。
//   語の中の ZWNJ（U+200C。ペルシア語などで語の形を整える）は意味を持つので、端だけを落とし、中は残す。
const EDGE_JUNK = '\\s\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\u061C\\u2060\\uFEFF\\u0085';
const EDGE_JUNK_RE = new RegExp(`^[${EDGE_JUNK}]+|[${EDGE_JUNK}]+$`, 'gu');

/**
 * セルの文字列から、両端の空白と見えない書式文字を除き、NFC に正規化する。
 *
 * 記号の照合と、対応表の検査の両方が使う（同じ規則で揃えるため）。語の中の ZWNJ は残す。
 *
 * @param s - セルの文字列、または記号
 * @returns 整えた文字列。空白や書式文字だけなら空文字
 */
export function cleanMissingCell(s: string): string {
  return s.replace(EDGE_JUNK_RE, '').normalize('NFC');
}

/** 対応表の問題 1 件。`index` は `tokens` の何番目か。 */
export interface MissingTokenProblem {
  readonly index: number;
  /** `empty`: 空白や書式文字だけ。`duplicate`: 整えると先の記号と同じ。 */
  readonly kind: 'empty' | 'duplicate';
}

/** 一度だけ作る照合の表。キーは整えた記号。 */
export interface CompiledMissingTokens {
  readonly table: ReadonlyMap<string, MissingReason>;
  /** 見つかった問題。あれば、プロジェクトファイルとしては壊れている。 */
  readonly problems: readonly MissingTokenProblem[];
}

/**
 * 対応表を、照合用の `Map` にまとめる。
 *
 * 計算量: O(T·L)（T は記号の数、L は記号の長さ）。以後の照合は 1 セルあたり O(L)。
 * 【なぜ】セルごとに対応表を走査すると O(セル数 × T) になる。数万行の表で無駄なので、一度だけ作る。
 * 重複は先の記号を残す（問題として報告もする）。
 *
 * @param tokens - 記号と理由の対応
 * @returns 照合の表と、見つかった問題
 */
export function compileMissingTokens(tokens: readonly MissingToken[]): CompiledMissingTokens {
  const table = new Map<string, MissingReason>();
  const problems: MissingTokenProblem[] = [];
  for (const [index, t] of tokens.entries()) {
    const key = cleanMissingCell(t.token);
    if (key === '') problems.push({ index, kind: 'empty' });
    else if (table.has(key)) problems.push({ index, kind: 'duplicate' });
    else table.set(key, t.reason);
  }
  return { table, problems };
}

/**
 * セルの文字列が欠損の記号なら、その理由を返す。
 *
 * 両端の空白と見えない書式文字を除き、NFC 正規化した後の完全一致で照合する。
 * 空欄（空白や書式文字だけ）は `'unrecorded'`（記載なし）。
 *
 * @param cell - セルの文字列
 * @param tokens - 対応表。大量のセルを調べるときは `compileMissingTokens` の結果を渡す
 * @returns 欠損の理由。欠損でなければ undefined
 */
// 【なぜ】`src/core/text/` の照合キー（大文字小文字、アラビア文字の揺れの吸収）は使わない。
//         記号の揺れ（「—」と「―」など）は、利用者が意図して使い分けたものとみなす（D-24）。
//         NFC だけは、同じ文字の符号の違い（合成済みか結合文字か）を揃えるために行う。
export function matchMissingToken(
  cell: string,
  tokens: readonly MissingToken[] | CompiledMissingTokens,
): MissingReason | undefined {
  const c = cleanMissingCell(cell);
  if (c === '') return 'unrecorded';
  // 【TS】`'table' in tokens` は型ガード。true の分岐では CompiledMissingTokens、false では配列に絞られる。
  const compiled = 'table' in tokens ? tokens : compileMissingTokens(tokens);
  return compiled.table.get(c);
}
