/**
 * シーンから SVG の文字列を作る（FR-OUT-01、設計書 §8.1、D-31）。DOM は作らない。
 *
 * 構造（Illustrator や Inkscape で編集しやすいよう、浅くする）:
 * `<svg>` > `<g id="edges">`、`<g id="nodes">`、`<g id="labels">`、`<g id="legend">`（この順）。
 * 各 `<g>` の直下に、図形が 1 つずつ並ぶ。
 */
import { assertNever } from '../../core/util/assertNever';
import type { NodeShape } from '../../core/model';
import { shapeExtent } from '../scene/build';
import type { PathCommand, Scene, SceneEdge, SceneLabel, SceneNode } from '../scene/types';
import { escapeXml, num, safeColor } from './escape';

/** `renderSvg` の選択肢。 */
export interface RenderSvgOptions {
  /** 背景色（`#rrggbb`）。省略は透明。論文の図では白を指定するとよい。 */
  readonly background?: string;
  /**
   * 文字のフォントの上書き（CSS の `font-family` の一覧）。省略はシーンのもの（測定と同じ）。
   * 上書きすると、ラベルの幅はシーンを作ったときのフォントで測ったままになる。
   */
  readonly fontFamily?: string;
  /** 図の題（`<title>`。読み上げと、ファイルを開いたときの手がかり）。 */
  readonly title?: string;
  /** すべての id の前に付ける文字列。1 つの文書に複数の図を入れるときの衝突を避ける。既定は空。 */
  readonly idPrefix?: string;
}

function pathData(path: readonly PathCommand[]): string {
  return path
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${num(c.x)} ${num(c.y)}`;
        case 'Q':
          return `Q${num(c.cx)} ${num(c.cy)} ${num(c.x)} ${num(c.y)}`;
        default:
          return assertNever(c, 'PathCommand');
      }
    })
    .join(' ');
}

// 形の属性。面積を円とそろえた大きさで描く（shapeExtent と同じ式）。
function shapeElement(shape: NodeShape, x: number, y: number, r: number, attrs: string): string {
  const e = shapeExtent(shape, r);
  switch (shape) {
    case 'circle':
      return `<circle cx="${num(x)}" cy="${num(y)}" r="${num(r)}"${attrs}/>`;
    case 'square': {
      const s = r * Math.sqrt(Math.PI);
      return `<rect x="${num(x - s / 2)}" y="${num(y - s / 2)}" width="${num(s)}" height="${num(s)}"${attrs}/>`;
    }
    case 'triangle': {
      // 頂点が上の正三角形。外接円の半径が e。
      const pts = [0, 1, 2].map((k) => {
        const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3;
        return `${num(x + e * Math.cos(a))},${num(y + e * Math.sin(a))}`;
      });
      return `<polygon points="${pts.join(' ')}"${attrs}/>`;
    }
    case 'diamond':
      return `<polygon points="${num(x)},${num(y - e)} ${num(x + e)},${num(y)} ${num(x)},${num(y + e)} ${num(x - e)},${num(y)}"${attrs}/>`;
    default:
      return assertNever(shape, 'NodeShape');
  }
}

function nodeSvg(n: SceneNode, index: number, prefix: string): string {
  const attrs =
    ` fill="${safeColor(n.fill, '#999999')}" stroke="${safeColor(n.stroke, '#333333')}"` +
    ` stroke-width="${num(n.strokeWidth)}"` +
    (n.dashed ? ' stroke-dasharray="3 2"' : '') +
    ` id="${prefix}node-${String(index)}" data-id="${escapeXml(n.id)}"` +
    (n.selected ? ' class="selected"' : '');
  return shapeElement(n.shape, n.x, n.y, n.r, attrs);
}

function edgeSvg(e: SceneEdge, index: number, prefix: string): string {
  return (
    `<path id="${prefix}edge-${String(index)}" data-id="${escapeXml(e.id)}" d="${pathData(e.path)}" fill="none"` +
    ` stroke="${safeColor(e.color, '#999999')}" stroke-width="${num(e.width)}"` +
    ` stroke-opacity="${num(Math.min(1, Math.max(0, e.opacity)))}"` +
    (e.dashed ? ' stroke-dasharray="4 3"' : '') +
    '/>'
  );
}

function textSvg(l: SceneLabel, extra: string): string {
  // 右から左のラベルには direction と unicode-bidi を付ける（NFR-09）。text-anchor は基準点の側を決める。
  const rtl = l.direction === 'rtl' ? ' direction="rtl" unicode-bidi="embed"' : '';
  // 【なぜ】SVG の text-anchor は start/end が「書字方向の先頭/末尾」。direction="rtl" では start が右端になる。
  // だから、x が右端（anchor=right）の右から左のラベルは start、左端の左から右のラベルも start、組み合わせが逆なら end。
  const svgAnchor = (l.anchor === 'left') === (l.direction === 'ltr') ? 'start' : 'end';
  return (
    `<text${extra} x="${num(l.x)}" y="${num(l.y)}" font-size="${num(l.fontSize)}"` +
    ` text-anchor="${svgAnchor}"${rtl}>${escapeXml(l.text)}</text>`
  );
}

/**
 * シーンを SVG の文字列にする。
 *
 * 文字列と属性値はすべてエスケープし、色は `#rrggbb` を検査する（不正なら既定の色）。
 * 画面でも書き出しでも、同じ関数の結果を使う（画面と書き出した図が一致する）。
 *
 * @param scene - シーン
 * @param options - 選択肢
 * @returns SVG の文字列（XML 宣言なし）
 */
export function renderSvg(scene: Scene, options: RenderSvgOptions = {}): string {
  const w = num(scene.width);
  const h = num(scene.height);
  const font = escapeXml(options.fontFamily ?? scene.fontFamily);
  const p = escapeXml(options.idPrefix ?? '');
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${font}">`,
  );
  if (options.title !== undefined) out.push(`<title>${escapeXml(options.title)}</title>`);
  if (options.background !== undefined)
    out.push(
      `<rect id="${p}background" width="${w}" height="${h}" fill="${safeColor(options.background, '#ffffff')}"/>`,
    );
  out.push(`<g id="${p}edges">`, ...scene.edges.map((e, i) => edgeSvg(e, i, p)), '</g>');
  out.push(`<g id="${p}nodes">`, ...scene.nodes.map((n, i) => nodeSvg(n, i, p)), '</g>');
  out.push(
    `<g id="${p}labels" fill="#222222">`,
    ...scene.labels.map((l, i) => textSvg(l, ` id="${p}label-${String(i)}"`)),
    '</g>',
  );
  if (scene.legend !== undefined) {
    const lg = scene.legend;
    out.push(`<g id="${p}legend" fill="#222222">`);
    out.push(
      `<rect x="${num(lg.x)}" y="${num(lg.y)}" width="${num(lg.width)}" height="${num(lg.height)}" fill="#ffffff" stroke="#cccccc"/>`,
    );
    if (lg.title !== undefined) out.push(textSvg(lg.title, ' font-weight="bold"'));
    for (const it of lg.items) {
      const s = it.swatch;
      out.push(
        shapeElement(
          s.shape,
          s.x,
          s.y,
          s.r,
          ` fill="${safeColor(s.fill, '#999999')}" stroke="#333333" stroke-width="1"` +
            (s.dashed ? ' stroke-dasharray="3 2"' : ''),
        ),
        textSvg(it.label, ''),
      );
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}
