/**
 * 測定と描画で同じフォントを使うCanvas測定器を作る。
 * @returns renderへ渡す文字幅の測定関数。測定不能時はNaNを返し、render共通の見積もりへ委ねる
 */
export function createGraphMeasure() {
  const context = document.createElement('canvas').getContext('2d');
  return (text: string, font: string): number => {
    // 【なぜ】独自の文字数/フォントサイズで見積もらず、配置と範囲計算の共通fallbackを使う。
    if (context === null) return NaN;
    context.font = font;
    return context.measureText(text).width;
  };
}
