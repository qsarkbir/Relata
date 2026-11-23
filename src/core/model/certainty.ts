/**
 * 確からしさの文字列を読む（D-37、FR-DM-06）。
 *
 * 読み込み（io）の「確からしさ」の列で使う。ここでは文字列から Certainty への変換だけを行い、
 * 列の対応づけや警告の出し方は呼び出し側が決める。
 */
import { matchKey, LOOSE_MATCH } from '../text';
import type { Certainty } from './values';

/** 確からしさの読み取り結果。空欄は「無し」、読めない値は失敗。 */
// 【TS】判別共用体。`kind` で 3 通りを見分ける。例外の代わりに値で失敗を返す。
export type CertaintyParse =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly value: Certainty }
  | { readonly kind: 'invalid'; readonly text: string };

// 照合キー（ゆるい照合）から Certainty への対応。
// 【なぜ】キーは matchKey を通した形で書く。大文字小文字や全角半角の揺れは照合キーが吸収する。
// 史料の注記では「?」「??」と書く習慣があるので、どちらも「可能性あり」とする（D-37）。
const TABLE: ReadonlyMap<string, Certainty> = new Map<string, Certainty>(
  (
    [
      ['確実', 'certain'],
      ['おそらく', 'probable'],
      ['可能性あり', 'possible'],
      ['certain', 'certain'],
      ['probable', 'probable'],
      ['possible', 'possible'],
      ['?', 'possible'],
      ['??', 'possible'],
    ] as const
  ).map(([k, v]): [string, Certainty] => [matchKey(k, LOOSE_MATCH), v]),
);

// 【なぜ】アラビア語・ペルシア語のキーボードの `?` キーは U+061F（؟）を入れる。全角の `？` も
//   同様に `?` として読む（NFKC でも変わるが、ここで明示して照合キーの設定に依存しない）。
// 前後の空白と見えない書式文字（RLM、LRM、双方向の制御文字、ゼロ幅の文字、BOM）は、
// 右から左の文字を含む表からの貼り付けで混ざりやすいので、照合の前に両端から除く
// （io/project/missing.ts の欠損の記号と同じ範囲）。
const EDGE_JUNK =
  /^[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\u2060\uFEFF\u0085]+|[\s\u200B-\u200F\u202A-\u202E\u2066-\u2069\u061C\u2060\uFEFF\u0085]+$/gu;
const QUESTION_MARKS = /[\u061F\uFF1F]/gu;

/**
 * 確からしさの文字列を Certainty に読む。
 *
 * 受け付ける表記: `確実／おそらく／可能性あり`、`certain／probable／possible`、
 * `?` と `??`（どちらも possible。アラビア文字の `؟`、全角の `？` も同じ）。照合は `matchKey`（D-20）なので、大文字小文字、
 * 全角半角（`？`）、前後の空白の違いは無視する。空（空白だけを含む）は「無し」。
 * 例外は投げない。
 *
 * @param text - 読む文字列
 * @returns `none`（空）、`ok`（読めた）、`invalid`（読めない。元の文字列を持つ）
 *
 * @example
 * ```ts
 * parseCertainty('Probable'); // { kind: 'ok', value: 'probable' }
 * parseCertainty('');         // { kind: 'none' }
 * parseCertainty('たぶん');    // { kind: 'invalid', text: 'たぶん' }
 * ```
 */
export function parseCertainty(text: string): CertaintyParse {
  const key = matchKey(text.replace(EDGE_JUNK, '').replace(QUESTION_MARKS, '?'), LOOSE_MATCH);
  if (key === '') return { kind: 'none' };
  const value = TABLE.get(key);
  return value === undefined ? { kind: 'invalid', text } : { kind: 'ok', value };
}
