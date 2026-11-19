/**
 * SVG（XML）に入れる文字列の処理（設計書 §8.1）。利用者のデータや、共有されたプロジェクトファイルの
 * 文字列が SVG に入るため、テキストと属性値はすべてここを通す。
 */
import { normalizeColor } from '../../core/encode';

// XML 1.0 で許されない文字（制御文字、サロゲートの片割れ、U+FFFE、U+FFFF）。
// タブ、改行、復帰は許されるが、属性値では空白に正規化されて形が変わるので、空白 1 つにする。
/* eslint-disable no-control-regex -- 制御文字を検出するのが目的 */
const WHITESPACE_CONTROL = /[\t\n\r]/g;
// 【なぜ】サロゲートペア（U+10000 以上の文字）の片割れだけが残った文字列は XML に入れられない。
// 否定先読み `(?!…)` で「高位の次が低位でない」、否定後読み `(?<!…)` で「低位の前が高位でない」
// ものを見つけ、対になっているものは残す。
const INVALID_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/* eslint-enable no-control-regex -- 範囲の終わり */

/**
 * テキストと属性値のエスケープ。`& < > " '` を実体参照にし、XML で使えない文字を除く。
 *
 * @param s - 元の文字列
 * @returns 安全な文字列（テキストにも、引用符で囲んだ属性値にも使える）
 */
export function escapeXml(s: string): string {
  return s
    .replace(WHITESPACE_CONTROL, ' ')
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 色を検査する。`#rrggbb` だけを通し、小文字にそろえる。それ以外は既定の色に替える。
 *
 * @param color - 色の候補
 * @param fallback - 不正なときの色（`#rrggbb`）
 * @returns `#rrggbb`
 */
export function safeColor(color: string, fallback: string): string {
  return normalizeColor(color) ?? normalizeColor(fallback) ?? '#000000';
}

/**
 * 数値を SVG に入れる文字列にする。有限でなければ 0、小数は 3 桁に丸める。
 *
 * @param n - 数値
 * @returns 文字列
 */
export function num(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const r = Math.round(n * 1000) / 1000;
  if (!Number.isFinite(r)) return '0'; // 非常に大きい値の丸めで無限大になる場合
  return String(Object.is(r, -0) ? 0 : r);
}
