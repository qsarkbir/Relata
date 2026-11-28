/** ブラウザがアラビア文字と混在する文字を組版する SVG のラベル層（NFR-09、D-53）。 */
import type { SceneLabel } from '../render/scene/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * SVG のラベルの層を作り、画面上の位置と内容を更新する関数を返す。
 *
 * @param host - 地図の要素
 * @returns ラベルの更新、文字幅の測定、後片付けの操作
 */
export function createLabelOverlay(host: HTMLElement) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.classList.add('relata-map-labels');
  svg.setAttribute('aria-hidden', 'true');
  host.append(svg);
  const measure = document.createElement('canvas').getContext('2d');
  const widths = new Map<string, number>();
  if (measure !== null) measure.font = '12px sans-serif';
  return {
    textWidth: (text: string): number => {
      const measured = widths.get(text);
      if (measured !== undefined) return measured;
      const width = measure?.measureText(text).width ?? NaN;
      widths.set(text, width);
      return width;
    },
    update(labels: readonly SceneLabel[]): void {
      const children = document.createDocumentFragment();
      for (const label of labels) {
        const text = document.createElementNS(SVG_NS, 'text');
        if (label.nodeId !== null) text.dataset.nodeId = label.nodeId;
        text.setAttribute('x', String(label.x));
        text.setAttribute('y', String(label.y));
        text.setAttribute('font-size', String(label.fontSize));
        text.setAttribute('direction', label.direction);
        text.setAttribute('unicode-bidi', 'embed');
        // SVG の start は書字方向の先頭。右から左の文字では右端が基準になる。
        text.setAttribute('text-anchor', 'start');
        // 利用者のラベルに < や & があっても、SVG の構造や外部通信を作ることはない。
        text.textContent = label.text;
        children.append(text);
      }
      svg.replaceChildren(children);
    },
    resetMeasurements(): void {
      widths.clear();
    },
    destroy(): void {
      svg.remove();
    },
  };
}
