import { matchKey } from '../../core/text';
import type { MatchOptions } from '../../core/text';

// 【TS】`MatchOptions` の全項目を書く。ここでは数字の正規化（digits）と全角・半角の統一（compat）だけを
//       有効にし、アラビア文字の揺れや大文字小文字などの他の手順は無効にする。
//       `satisfies` で型の条件を検査しつつ、値の型は推論のまま残す。
// 【なぜ】照合キーの他の手順（空白の圧縮など）は、数値の入力には要らず、意味も変えてしまうため。
const NUMBER_MATCH = {
  compat: true,
  arabic: false,
  diacritics: false,
  digits: true,
  caseFold: false,
  invisibles: false,
  spaces: false,
} as const satisfies MatchOptions;

// 符号（任意）、整数部と小数部（どちらか一方は必須）、指数部（任意）。
// 【なぜ】`Number()` に直接渡すと、"0x10"、"Infinity"、"1_000" や空白だけの文字列まで受け付けてしまう。
//       形を先に正規表現で絞る。
const NUMBER_SHAPE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu;

/**
 * 利用者が入力した数値の文字列を、数値にする（範囲フィルタの端の値）。
 *
 * 次の書き方を受け付ける。
 * - 算用数字、アラビア・インド数字（١٢）、ペルシア数字（۱۲）、全角数字。
 * - 小数点は `.` とアラビアの小数点（٫ U+066B）。
 * - 桁区切りはアラビアの桁区切り（٬ U+066C）で、除く。
 * - 負の符号は `-` と数学のマイナス（− U+2212）。
 *
 * ASCII のカンマ `,` は、英語圏の桁区切り（1,000）にも欧州の小数点（1,5）にも使われ、決められないので、
 * 受け付けない（不正として入力のやり直しを求める。黙って誤った値にしない）。
 * 空（空白だけを含む）は「指定なし」。
 *
 * @param text - 入力された文字列
 * @returns 数値、指定なしなら undefined、数値として読めなければ 'invalid'
 * @example
 * parseNumber('١٢٫٥'); // 12.5
 * parseNumber('1e'); // 'invalid'
 * parseNumber(''); // undefined
 */
// 【TS】戻り値の型 `number | undefined | 'invalid'` は、数値、undefined、文字列リテラル 'invalid' のどれか
//       を表す共用体。文字列リテラルを混ぜると、呼ぶ側は `=== 'invalid'` で絞り込める。
export function parseNumber(text: string): number | undefined | 'invalid' {
  const key = matchKey(text, NUMBER_MATCH)
    .trim()
    .replace(/٫/gu, '.')
    .replace(/٬/gu, '')
    .replace(/−/gu, '-');
  if (key === '') return undefined;
  if (!NUMBER_SHAPE.test(key)) return 'invalid';
  const n = Number(key);
  // 【なぜ】1e999 は Infinity になる。範囲の端として意味が無いので不正にする。
  return Number.isFinite(n) ? n : 'invalid';
}
