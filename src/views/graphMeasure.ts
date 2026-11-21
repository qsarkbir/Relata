/**
 * 測定と描画で同じフォントを使うCanvas測定器を作る。
 * @returns renderへ渡す文字幅の測定関数
 */
export function createGraphMeasure() {
  const context = document.createElement('canvas').getContext('2d');
  return (text: string, font: string): number => {
    if (context === null) return text.length * 12;
    context.font = font;
    return context.measureText(text).width;
  };
}
