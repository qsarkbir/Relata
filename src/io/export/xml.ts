/** XML の文字列の処理（GraphML、GEXF の書き出し用。FR-OUT-05）。 */

// XML 1.0 で許されない文字: 制御文字（タブ、改行、復帰を除く）、対にならないサロゲート、U+FFFE、U+FFFF。
/* eslint-disable no-control-regex -- 制御文字を検出するのが目的 */
const INVALID_XML =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/* eslint-enable no-control-regex -- 範囲の終わり */

/**
 * 要素の本文に入れる文字列を、XML 用にエスケープする。
 *
 * 【なぜ】SVG 用の `escapeXml`（render/svg）は改行を空白にする。ラベルや属性値の改行を GraphML・GEXF
 * では残したいので、別に持つ。`&`、`<`、`>` を実体参照にし、復帰（CR）は `&#13;` にする
 * （XML の読み手は CR を LF に正規化するため、実体参照にしないと値が変わる）。
 * アラビア文字などの非 ASCII 文字は、UTF-8 のまま残す（実体参照にしない）。
 *
 * @param s - 元の文字列
 * @returns 本文に入れられる文字列
 */
export function xmlText(s: string): string {
  return s
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

/**
 * 属性値に入れる文字列を、XML 用にエスケープする（二重引用符で囲む前提）。
 *
 * 属性値では、読み手がタブ・改行・復帰を空白に正規化するので、文字参照にして値を守る。
 *
 * @param s - 元の文字列
 * @returns 属性値に入れられる文字列
 */
export function xmlAttr(s: string): string {
  return xmlText(s).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;');
}
