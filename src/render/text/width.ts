/**
 * 実測できない文字列の幅を、Unicodeコードポイント数から見積もる。
 *
 * 【なぜ】UTF-16のtext.lengthでは、絵文字や拡張漢字1文字を2文字と数えてしまう。
 * 結合文字や連結文字の実際の幅は推定できないので、通常は同じフォントの実測値を使う。
 * @param text - 元の文字列
 * @param fontSize - 文字の大きさ（px）
 * @returns コードポイント数×文字サイズ×0.6の推定幅
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  return Array.from(text).length * fontSize * 0.6;
}
