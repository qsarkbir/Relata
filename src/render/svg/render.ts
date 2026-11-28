/**
 * シーンから SVG の文字列を作る（FR-OUT-01、設計書 §8.1、D-31）。DOM は作らない。
 *
 * 構造（Illustrator や Inkscape で編集しやすいよう、浅くする）:
 * `<svg>` > （束ねた帯があれば `<g id="bundles">`、再生で薄いものは `<g id="bundles-faded">`）、`<g id="edges">`、`<g id="nodes">`、`<g id="labels">`、`<g id="legend">`（この順）。
 * 各 `<g>` の直下に、図形が 1 つずつ並ぶ。
 */
import { assertNever } from '../../core/util/assertNever';
import type { NodeShape } from '../../core/model';
import { shapeExtent } from '../scene/build';
import { FADED_OPACITY } from '../scene/timeFade';
import type {
  PathCommand,
  Scene,
  SceneBundle,
  SceneEdge,
  SceneLabel,
  SceneLegendItem,
  SceneNode,
} from '../scene/types';
import { escapeXml, num, safeColor, safeIdPrefix } from './escape';
import { edgeDash, MISSING_TAPER_FILL_OPACITY, nodeDash } from '../scene/missingStyle';

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
  /**
   * すべての id の前に付ける文字列。1 つの文書に複数の図を入れるときの衝突を避ける。既定は空。
   * 英字で始まる英数字と `-`、`_` の文字列（例: `fig1-`）を指定する。それ以外の文字は `_` に替え、
   * 先頭が英字か `_` でなければ `_` を前に付ける（`safeIdPrefix`）。
   */
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
    (n.dashed ? ` stroke-dasharray="${nodeDash(n.attrMissing === true).join(' ')}"` : '') +
    ` id="${prefix}node-${String(index)}" data-id="${escapeXml(n.id)}"` +
    (n.selected ? ' class="selected"' : '') +
    // 【なぜ】再生の時刻の外は薄くする（消さない。D-38）。`data-out-of-time` は色や濃さに頼らず、
    //   画面の図と支援技術、テスト、書き出した SVG から「時刻の外」と分かる印。書き出しでは、
    //   利用者が「書き出し」のダイアログで外したとき、呼ぶ側が `markOutOfTime` を通さない。
    (n.faded === true ? ` opacity="${num(FADED_OPACITY)}" data-out-of-time="true"` : '');
  return shapeElement(n.shape, n.x, n.y, n.r, attrs);
}

function edgeSvg(e: SceneEdge, index: number, prefix: string): string {
  const key = prefix + 'edge-' + String(index);
  const color = safeColor(e.color, '#999999');
  // 【なぜ】時刻の外のエッジは、元の不透明度（選択の強調など）にさらに掛けて薄くする。
  const opacity = num(Math.min(1, Math.max(0, e.opacity)) * (e.faded === true ? FADED_OPACITY : 1));
  const points = (ps: readonly { readonly x: number; readonly y: number }[]) =>
    ps.map((p) => num(p.x) + ',' + num(p.y)).join(' ');
  const attrs =
    ' id="' +
    key +
    '" data-id="' +
    escapeXml(e.id) +
    '"' +
    (e.faded === true ? ' data-out-of-time="true"' : '') +
    (e.role === undefined ? '' : ' data-bundle-role="' + e.role + '"');
  // 【なぜ】値の欠損（重み）と指定した属性の欠損は、破線の間隔を変えて見分けられるようにする。
  const dash = edgeDash(e.attrMissing === true).join(' ');
  if (e.ribbon !== undefined)
    // 【なぜ】先細りの帯は塗りの図形で、線ではないので `stroke-dasharray` だけでは破線に見えない。
    //   欠損のときは、塗りを薄くして、輪郭に破線を付ける（色だけに頼らない）。
    return (
      '<polygon' +
      attrs +
      ' points="' +
      points(e.ribbon) +
      '" fill="' +
      color +
      '" fill-opacity="' +
      (e.dashed ? num(Number(opacity) * MISSING_TAPER_FILL_OPACITY) : opacity) +
      '"' +
      (e.dashed
        ? ' stroke="' +
          color +
          '" stroke-width="1" stroke-opacity="' +
          opacity +
          '" stroke-dasharray="' +
          dash +
          '"'
        : '') +
      '/>'
    );
  let defs = '';
  let stroke = color;
  // 【なぜ】userSpaceOnUseなら水平/垂直線でもbboxの幅/高さ0に依存しない。
  // 同一始終点だけが退化であり、水平線へepsilonを足す必要はない（SVG2 §14.2.2）。
  if (e.gradient !== undefined) {
    const g = e.gradient;
    const id = key + '-gradient';
    defs =
      '<defs><linearGradient id="' +
      id +
      '" gradientUnits="userSpaceOnUse" x1="' +
      num(g.start.x) +
      '" y1="' +
      num(g.start.y) +
      '" x2="' +
      num(g.end.x) +
      '" y2="' +
      num(g.end.y) +
      '"><stop offset="0" stop-color="' +
      color +
      '" stop-opacity="0.15"/><stop offset="1" stop-color="' +
      color +
      '" stop-opacity="1"/></linearGradient></defs>';
    stroke = 'url(#' + id + ')';
  }
  const shaft =
    '<path' +
    attrs +
    ' d="' +
    pathData(e.path) +
    '" fill="none" stroke="' +
    stroke +
    '" stroke-width="' +
    num(e.width) +
    '" stroke-opacity="' +
    opacity +
    '"' +
    (e.dashed ? ' stroke-dasharray="' + dash + '"' : '') +
    '/>';
  const head =
    e.head === undefined
      ? ''
      : '<polygon id="' +
        key +
        '-head" points="' +
        points(e.head) +
        '" fill="' +
        color +
        '" fill-opacity="' +
        opacity +
        '"/>';
  return defs + shaft + head;
}
// 束ねた帯の層（FR-VG-13、14）。リボンは不透明で塗り、層の `<g>` に 1 回だけ不透明度を掛ける。
// 【なぜ】同じ束を通るエッジのリボンは重なる。リボンごとに半透明にすると重なりが濃くなり、
// 束の太さが濃さで歪む。再生の時刻の外のリボンは、別の `<g>`（`bundles-faded`）にまとめて薄くする。
function bundleSvg(b: SceneBundle, prefix: string): string[] {
  const color = safeColor(b.color, '#999999');
  const layer = (id: string, opacity: number, faded: boolean): string[] => {
    const items: string[] = [];
    for (const [i, r] of b.ribbons.entries()) {
      if ((r.faded === true) !== faded) continue;
      const key = prefix + 'bundle-' + String(i);
      const pts = (ps: readonly { readonly x: number; readonly y: number }[]) =>
        ps.map((q) => num(q.x) + ',' + num(q.y)).join(' ');
      items.push(
        '<polygon id="' +
          key +
          '" data-id="' +
          escapeXml(r.edgeId) +
          '" points="' +
          pts(r.polygon) +
          '"' +
          (faded ? ' data-out-of-time="true"' : '') +
          '/>',
      );
      if (r.head !== undefined)
        items.push(
          '<polygon id="' +
            key +
            '-head" data-id="' +
            escapeXml(r.edgeId) +
            '" points="' +
            pts(r.head) +
            '"/>',
        );
    }
    return items.length === 0
      ? []
      : [
          `<g id="${prefix}${id}" fill="${color}" opacity="${num(Math.min(1, Math.max(0, opacity)))}">`,
          ...items,
          '</g>',
        ];
  };
  return [
    ...layer('bundles-faded', b.opacity * FADED_OPACITY, true),
    ...layer('bundles', b.opacity, false),
  ];
}
// 凡例の見本の SVG。ノードの図形、線、矢じり付きの線のいずれか（文字だけの行は何も出さない）。
//
// 【なぜ】線の見本の破線の間隔と矢じりの大きさは、図のエッジと同じ式（破線は 4 3 と 9 4、矢じりは
// 長さ max(6, 3w)、半幅 max(3, 1.5w)）にする。凡例と図が食い違うと、読み手が取り違える。
function legendSwatchSvg(s: SceneLegendItem['swatch'], gradientId: string): string[] {
  switch (s.mark) {
    case 'none':
      return [];
    case 'node':
      return [
        shapeElement(
          s.shape,
          s.x,
          s.y,
          s.r,
          ` fill="${safeColor(s.fill, '#999999')}" stroke="#333333" stroke-width="1"` +
            (s.dashed ? ` stroke-dasharray="${nodeDash(s.attrMissing === true).join(' ')}"` : ''),
        ),
      ];
    case 'line':
    case 'arrow':
    case 'taper':
    case 'gradient': {
      const w = s.lineWidth ?? 1.5;
      const color = safeColor(s.fill, '#999999');
      const opacity = num(Math.min(1, Math.max(0, s.opacity ?? 1)));
      const left = s.x - s.r;
      const right = s.x + s.r;
      const y = s.y;
      if (s.mark === 'taper') {
        // 先細りの帯: 始点が太く、終点が尖る（図の `ribbon` と同じ形）。
        const h = w / 2;
        return [
          `<polygon points="${num(left)},${num(y - h)} ${num(right)},${num(y)} ${num(left)},${num(y + h)}" fill="${color}" fill-opacity="${opacity}"/>`,
        ];
      }
      // 矢じりの大きさは図のエッジと同じ式: 長さ min(max(6, 3w), 線の長さの半分)、半幅 min(max(3, 1.5w), 長さ × 0.7)。
      const headLen = Math.min(Math.max(6, w * 3), s.r);
      const headHalf = Math.min(Math.max(3, w * 1.5), headLen * 0.7);
      const end = s.mark === 'arrow' ? right - headLen : right;
      // 矢じりが縮むときの幹の太さも、図と同じ（矢じりの底辺を超えない）。
      const shaft = s.mark === 'arrow' ? Math.min(w, headHalf * 2) : w;
      const dash = s.dashed
        ? ` stroke-dasharray="${edgeDash(s.attrMissing === true).join(' ')}"`
        : '';
      const out: string[] = [];
      let stroke = color;
      if (s.mark === 'gradient') {
        // 濃淡の線: 始点が薄く（0.15）、終点が濃い（1）。図の `linearGradient` と同じ。
        out.push(
          `<defs><linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="${num(left)}" y1="${num(y)}" x2="${num(right)}" y2="${num(y)}"><stop offset="0" stop-color="${color}" stop-opacity="0.15"/><stop offset="1" stop-color="${color}" stop-opacity="1"/></linearGradient></defs>`,
        );
        stroke = `url(#${gradientId})`;
      }
      out.push(
        `<path d="M${num(left)} ${num(y)} L${num(end)} ${num(y)}" fill="none" stroke="${stroke}" stroke-width="${num(shaft)}" stroke-opacity="${opacity}"${dash}/>`,
      );
      if (s.mark === 'arrow')
        out.push(
          `<polygon points="${num(right)},${num(y)} ${num(end)},${num(y + headHalf)} ${num(end)},${num(y - headHalf)}" fill="${color}" fill-opacity="${opacity}"/>`,
        );
      return out;
    }
    default:
      return assertNever(s.mark, 'LegendMark');
  }
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
  const p = safeIdPrefix(options.idPrefix ?? '');
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${font}">`,
  );
  if (options.title !== undefined) out.push(`<title>${escapeXml(options.title)}</title>`);
  if (options.background !== undefined)
    out.push(
      `<rect id="${p}background" width="${w}" height="${h}" fill="${safeColor(options.background, '#ffffff')}"/>`,
    );
  if (scene.bundle !== undefined) out.push(...bundleSvg(scene.bundle, p));
  out.push(`<g id="${p}edges">`, ...scene.edges.map((e, i) => edgeSvg(e, i, p)), '</g>');
  out.push(`<g id="${p}nodes">`, ...scene.nodes.map((n, i) => nodeSvg(n, i, p)), '</g>');
  out.push(
    `<g id="${p}labels" fill="#222222">`,
    ...scene.labels.map((l, i) =>
      textSvg(
        l,
        ` id="${p}label-${String(i)}"` +
          (l.faded === true ? ` opacity="${num(FADED_OPACITY)}" data-out-of-time="true"` : ''),
      ),
    ),
    '</g>',
  );
  if (scene.legend !== undefined) {
    const lg = scene.legend;
    out.push(`<g id="${p}legend" fill="#222222">`);
    out.push(
      `<rect x="${num(lg.x)}" y="${num(lg.y)}" width="${num(lg.width)}" height="${num(lg.height)}" fill="#ffffff" stroke="#cccccc"/>`,
    );
    if (lg.title !== undefined) out.push(textSvg(lg.title, ' font-weight="bold"'));
    for (const [index, it] of lg.items.entries()) {
      out.push(
        ...legendSwatchSvg(it.swatch, `${p}legend-gradient-${String(index)}`),
        textSvg(it.label, it.bold === true ? ' font-weight="bold"' : ''),
      );
    }
    out.push('</g>');
  }
  out.push('</svg>');
  return out.join('\n');
}
