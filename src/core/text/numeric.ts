/**
 * 数値の表記の正規化（緯度・経度などの数の属性を読むための純粋な関数）。
 *
 * 西アジア史の資料の表では、数がアラビア・インド数字（٠-٩）やペルシア数字（۰-۹）で書かれ、
 * 小数点が「٫」（U+066B）、負号が「−」（U+2212）のことがある。これらを 10 進の標準の表記に直して数にする。
 * 元の値は書き換えない（ここは読み取りだけ。CLAUDE.md、設計書 §5.2）。
 */

/** 数の前後や間に紛れる、見えない向きの制御文字（LRM、RLM、ALM、BOM）。 */
const INVISIBLE_MARKS = new RegExp('[\\u200e\\u200f\\u061c\\ufeff]', 'g');
/** 10 進の数の表記だけを通す正規表現（符号、整数部、小数部。指数と 16 進は通さない）。 */
const DECIMAL = /^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$/;

/**
 * 数の文字列を、正規の 10 進の表記（ASCII）に直す。数の形でなければ null。
 *
 * 手順: (1) 前後の空白と見えない制御文字を除く。(2) アラビア・インド数字とペルシア数字を ASCII に直す。
 * (3) 「٫」を小数点に、「−」「﹣」「－」を負号に直す。(4) 10 進の正規表現で検査する
 * （'0x21'、'1e3'、'Infinity'、桁区切りの「٬」を含む文字列は拒む）。
 *
 * @param text - 数の文字列
 * @returns 正規の表記。数の形でなければ null
 */
export function normalizeDecimal(text: string): string | null {
  const cleaned = text
    .replace(INVISIBLE_MARKS, '')
    .trim()
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[−﹣－]/g, '-');
  return DECIMAL.test(cleaned) ? cleaned : null;
}

/**
 * 数の文字列を有限の数にする。
 *
 * @param text - 数の文字列（ASCII、アラビア・インド数字、ペルシア数字）
 * @returns 有限の数。読めなければ null
 */
export function parseDecimal(text: string): number | null {
  const normalized = normalizeDecimal(text);
  if (normalized === null) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
