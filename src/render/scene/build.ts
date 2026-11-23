import { placeLabels } from '../labels/layout';
import { estimateTextWidth } from '../text/width';
import { edgeGeometry, type DirectedEdgeStyle } from '../edges/geometry';
/**
 * シーンの組み立て（設計書 §8.1、D-31）。
 */
import type { RelataGraph } from '../../core/graph';
import {
  MISSING_COLOR,
  OTHER_COLOR,
  normalizeColor,
  type ColorResult,
  type SizeResult,
  type WidthResult,
} from '../../core/encode';
import type { NodeId, NodeShape, NodeTypeId } from '../../core/model';
import { assertNever } from '../../core/util/assertNever';
import { detectDirection, type TextDirection } from '../text/direction';
import type {
  PathCommand,
  Scene,
  SceneEdge,
  SceneLabel,
  LegendMark,
  SceneLegend,
  SceneLegendItem,
  SceneNode,
} from './types';

/**
 * 文字の幅を測る関数（D-17）。画面では views が Canvas で測る関数を、テストでは偽の関数を渡す。
 * `font` は CSS の font 指定（例: `12px sans-serif`）。
 */
export type MeasureText = (text: string, font: string) => number;

/** 割り当ての結果（`core/encode` の出力）をまとめたもの。無い項目は既定の見た目になる。 */
export interface SceneEncoding {
  /** ノードの半径。`encodeNodeSizes` の `sizes`。 */
  readonly sizes?: ReadonlyMap<NodeId, SizeResult>;
  /** ノードの色。`encodeNodeColorsBy…` の `colors`。 */
  readonly colors?: ReadonlyMap<NodeId, ColorResult>;
  /** 色の割り当てが無いノードに使う、型の色（`typeStyles().colors`）。 */
  readonly typeColors?: ReadonlyMap<NodeTypeId, string>;
  /** 型の形（`typeStyles().shapes`）。 */
  readonly shapes?: ReadonlyMap<NodeTypeId, NodeShape>;
  /**
   * エッジの太さ。キーは、`buildGraph` が付けたまとめたエッジのキー（`graph.edges()` の値）。
   * 元の `EdgeId` ではない。重みの一部だけが欠損したエッジの印は、FR-VG-12（フェーズ 2）で扱う。
   * 【なぜ】グラフのエッジはまとめた後のものなので、元の `EdgeId` ではなくグラフのキーで引く。
   */
  readonly widths?: ReadonlyMap<string, WidthResult>;
}

/** 凡例の項目の指定。文言は呼ぶ側が翻訳して渡す（render は i18n に依存しない）。 */
export interface LegendItemSpec {
  readonly label: string;
  readonly fill: string;
  readonly shape?: NodeShape;
  /** 見本の半径。省略は 6。 */
  readonly r?: number;
  readonly dashed?: boolean;
  /** 指定した属性の欠損の破線（`dashed` と合わせて使う。間隔がノード・エッジの図と同じになる）。 */
  readonly attrMissing?: boolean;
  /** 見本の種類。省略は `node`。`line`、`arrow` は線、`none` は文字だけの行。 */
  readonly mark?: LegendMark;
  /** 線の見本（`line`、`arrow`、`taper`、`gradient`）の太さ（px）。省略は既定のエッジの太さ。 */
  readonly lineWidth?: number;
  /** 線の見本の不透明度（0 から 1）。省略は 1。 */
  readonly opacity?: number;
  /** 見出し（太字）にするか。 */
  readonly bold?: boolean;
}

/** 凡例の指定。 */
export interface LegendSpec {
  readonly title?: string;
  readonly items: readonly LegendItemSpec[];
}

/** ラベル候補の表示方法。候補の中から重なりを減らして描く（FR-VG-10）。 */
export type LabelMode = 'all' | 'selected' | 'large';

/** `buildScene` の選択肢。 */
export interface BuildSceneOptions {
  /** 有向エッジの表現。既定は arrow。 */
  readonly directedStyle?: DirectedEdgeStyle;
  /** 図の余白（px）。既定 24。 */
  readonly margin?: number;
  /** 選択中のノード。 */
  readonly selected?: ReadonlySet<NodeId>;
  /** 選択の強調を図に含めるか。既定は含めない（D-31）。 */
  readonly includeSelection?: boolean;
  /**
   * 「欠損の表示」で指定した属性が欠損しているノード（FR-VG-12）。枠線を破線にする。
   * 【なぜ】render は属性やデータセットを知らない。判定は core（`findMissingElements`）で済ませ、
   * シーンには「破線にするかどうか」だけを渡す。
   */
  readonly missingNodes?: ReadonlySet<NodeId>;
  /** 同じく欠損しているエッジの、グラフのエッジのキー（`graph.edges()` の値。元の `EdgeId` ではない）。線を破線にする。 */
  readonly missingEdges?: ReadonlySet<string>;
  /** ラベルの表示。既定 `all`。 */
  readonly labels?: LabelMode;
  /** `large` のときの候補数の上限（大きい順）。既定20。衝突で減っても次点を補充しない。 */
  readonly largeLabelCount?: number;
  /** ラベルの文字の大きさ（px）。既定 12。 */
  readonly labelFontSize?: number;
  /**
   * 文字の幅を測る関数。無いとき、または有限で 0 以上でない値を返したときは、
   * Unicodeコードポイント数 × 文字の大きさ × 0.6 で見積もる。ラベルと凡例は、この幅で図の範囲に収める。
   */
  readonly measureText?: MeasureText;
  readonly legend?: LegendSpec;
  /**
   * 文字のフォント。CSS の `font-family` と同じ書き方の一覧（例: `Amiri, serif`、
   * `'Times New Roman', serif`）。測定と描画で同じものを使う。既定 `sans-serif`。
   */
  // 【なぜ】測定には `${大きさ}px ${一覧}`（canvas の font、CSS の font 一括指定）を、
  //       SVG にはこの一覧をそのまま font-family 属性として渡す。どちらも同じ CSS の
  //       一覧として解釈されるので、引用符やカンマを含んでも同じフォントになる。
  readonly fontFamily?: string;
}

const DEFAULT_RADIUS = 6;
const DEFAULT_EDGE_WIDTH = 1.5;
/** エッジの既定の色。凡例の線の見本も、これを使って図と一致させる。 */
export const DEFAULT_EDGE_COLOR = '#999999';
/** エッジの既定の不透明度。 */
export const DEFAULT_EDGE_OPACITY = 0.6;
const NODE_STROKE = '#333333';
const SELECTED_STROKE = '#000000';
const LABEL_GAP = 4;
const LEGEND_GAP = 16;
const LEGEND_PAD = 8;

/**
 * 形の外接円の半径。面積を円（半径 r）とそろえた形を、中心から最も遠い点で測る。
 * 矢じりを縁で止める（T1-12）ときと、図の範囲を求めるときに使う。
 *
 * @param shape - 形
 * @param r - 公称の半径
 * @returns 外接円の半径
 */
export function shapeExtent(shape: NodeShape, r: number): number {
  switch (shape) {
    case 'circle':
      return r;
    case 'square':
      // 面積 s² = πr²、外接円の半径は対角線の半分 s/√2。
      return (r * Math.sqrt(Math.PI)) / Math.SQRT2;
    case 'triangle':
      // 正三角形の面積 (3√3/4)R² = πr²。R が外接円の半径。
      return r * Math.sqrt((4 * Math.PI) / (3 * Math.sqrt(3)));
    case 'diamond':
      // 正方形を 45 度回した形。面積 2d² = πr²、d が外接円の半径。
      return r * Math.sqrt(Math.PI / 2);
    default:
      return assertNever(shape, 'NodeShape');
  }
}

/**
 * 有限で 0 以上の数かを調べ、そうでなければ既定値を返す。
 *
 * @param v - 入力
 * @param fallback - 既定値
 * @returns 使える値
 */
function nonNeg(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) && v >= 0 ? v : fallback;
}

// 【TS】`p is {…}` は型ガード。true の分岐で、TypeScript が p を undefined でない点として扱う。
function finitePoint(
  p: { readonly x: number; readonly y: number } | undefined,
): p is { readonly x: number; readonly y: number } {
  return p !== undefined && Number.isFinite(p.x) && Number.isFinite(p.y);
}

function makeLabel(
  nodeId: NodeId | null,
  text: string,
  x: number,
  y: number,
  fontSize: number,
): SceneLabel {
  const direction: TextDirection = detectDirection(text);
  // x が文字列のどちらの端か（物理的な向き）。右から左は右端、左から右は左端。
  return {
    nodeId,
    text,
    x,
    y,
    fontSize,
    direction,
    anchor: direction === 'rtl' ? 'right' : 'left',
  };
}

function shiftLabel(l: SceneLabel, dx: number, dy: number): SceneLabel {
  return { ...l, x: l.x + dx, y: l.y + dy };
}

/**
 * グラフ、位置、割り当ての結果から、シーンを作る。
 *
 * 図の範囲は、位置のあるすべてのノードを収める（画面の拡大やパンには左右されない。D-31）。
 * 位置が無い（または有限でない）ノードは、シーンに入れず `omitted.nodesWithoutPosition` に報告する。
 * 端点がシーンに無いエッジも入れない。ノードの位置は、レイアウト（T1-13 以降）の結果をそのまま渡す。
 * 文字の幅の関数が渡されたときは、ラベルと凡例も範囲に収める。
 *
 * 計算量: ノード数 n、エッジ数 m として O(n log n + m)（「大きいノード」の並べ替え）。
 *
 * @param graph - グラフ
 * @param positions - ノードの位置
 * @param encoding - 割り当ての結果
 * @param options - 選択肢
 * @returns シーン
 */
export function buildScene(
  graph: RelataGraph,
  positions: ReadonlyMap<NodeId, { readonly x: number; readonly y: number }>,
  encoding: SceneEncoding = {},
  options: BuildSceneOptions = {},
): Scene {
  const margin = nonNeg(options.margin, 24);
  const fontSize = nonNeg(options.labelFontSize, 12);
  const fontFamily = options.fontFamily ?? 'sans-serif';
  const font = `${String(fontSize)}px ${fontFamily}`;
  const measure = options.measureText;
  // 測定の結果が使えないときは、文字数からの見積もりにする（凡例と同じ）。
  const measuredWidths = new Map<string, number>();
  const textWidth = (t: string): number => {
    const cached = measuredWidths.get(t);
    if (cached !== undefined) return cached;
    const w = measure?.(t, font);
    const width = nonNeg(w, estimateTextWidth(t, fontSize));
    measuredWidths.set(t, width);
    return width;
  };
  const selected = options.selected ?? new Set<NodeId>();
  const showSel = options.includeSelection === true;
  const labelMode = options.labels ?? 'all';

  // 1. ノード（位置の無いものは除く）。ノードの ID は、graphology では文字列。
  const rawNodes: SceneNode[] = [];
  const missingPos: NodeId[] = [];
  graph.forEachNode((key, attrs) => {
    // 【TS】graphology のキーは string。Relata ではノード ID と同じ値を使う（buildGraph が `addNode(n.id, …)`）。
    //       ブランド型への変換は型の上だけの約束で、実行時の検査は要らない（`as` を使う理由）。
    const id = key as NodeId;
    const pos = positions.get(id);
    if (!finitePoint(pos)) {
      missingPos.push(id);
      return;
    }
    const size = encoding.sizes?.get(id);
    const color = encoding.colors?.get(id);
    const fill =
      normalizeColor(color?.color) ??
      normalizeColor(encoding.typeColors?.get(attrs.type)) ??
      (color?.missing === true ? MISSING_COLOR : OTHER_COLOR);
    const isSel = showSel && selected.has(id);
    const flagged = options.missingNodes?.has(id) === true;
    const valueMissing = size?.missing === true || color?.missing === true;
    rawNodes.push({
      id,
      x: pos.x,
      y: pos.y,
      r: size !== undefined && Number.isFinite(size.size) ? Math.max(0, size.size) : DEFAULT_RADIUS,
      shape: encoding.shapes?.get(attrs.type) ?? 'circle',
      fill,
      stroke: isSel ? SELECTED_STROKE : NODE_STROKE,
      // 【なぜ】細い破線は見分けにくいので、破線のノード（どちらの意味でも）は枠線を 1.5 にそろえる。
      strokeWidth: isSel ? 3 : valueMissing || flagged ? 1.5 : 1,
      dashed: valueMissing || flagged,
      ...(flagged ? { attrMissing: true } : {}),
      selected: isSel,
    });
  });
  const byId = new Map(rawNodes.map((n) => [n.id, n]));

  // 2. 集約後の有向エッジを、方向ごとの組で索引化する。無向エッジは逆辺に数えない。
  const directedWidths = new Map<string, number>();
  graph.forEachEdge((key, attrs, source, target) => {
    if (attrs.directed) {
      const width = encoding.widths?.get(key)?.width ?? DEFAULT_EDGE_WIDTH;
      directedWidths.set(
        JSON.stringify([source, target]),
        Number.isFinite(width) ? Math.max(0, width) : DEFAULT_EDGE_WIDTH,
      );
    }
  });
  const rawEdges: SceneEdge[] = [];
  let edgesWithoutEndpoint = 0;
  let widthMatched = 0;
  const selfLoops = 0;
  graph.forEachEdge((key, attrs, source, target) => {
    const s = byId.get(source as NodeId);
    const t = byId.get(target as NodeId);
    if (s === undefined || t === undefined) {
      edgesWithoutEndpoint += 1;
      return;
    }

    const w = encoding.widths?.get(key);
    if (w !== undefined) widthMatched += 1;
    const width =
      w !== undefined && Number.isFinite(w.width) ? Math.max(0, w.width) : DEFAULT_EDGE_WIDTH;
    const reverseWidth = directedWidths.get(JSON.stringify([target, source]));
    const bend =
      attrs.directed && source !== target && reverseWidth !== undefined
        ? Math.max(24, Math.hypot(t.x - s.x, t.y - s.y) * 0.2, (width + reverseWidth) * 2)
        : 0;
    const geometry = edgeGeometry(
      s,
      t,
      shapeExtent(s.shape, s.r) + s.strokeWidth / 2,
      shapeExtent(t.shape, t.r) + t.strokeWidth / 2,
      width,
      bend,
      attrs.directed ? (options.directedStyle ?? 'arrow') : undefined,
    );
    rawEdges.push({
      id: key,
      source: s.id,
      target: t.id,
      ...geometry,
      width: geometry.shaftWidth ?? width,
      color: DEFAULT_EDGE_COLOR,
      opacity: DEFAULT_EDGE_OPACITY,
      directed: attrs.directed,
      dashed: w?.missing === true || options.missingEdges?.has(key) === true,
      ...(options.missingEdges?.has(key) === true ? { attrMissing: true } : {}),
    });
  });

  // 3. 表示設定で候補を決め、大きいノードを優先して重なりを減らす。
  const labelNodes = pickLabelNodes(rawNodes, labelMode, selected, options.largeLabelCount ?? 20);
  const labelCandidates: SceneLabel[] = [];
  for (const n of labelNodes) {
    const text = graph.getNodeAttribute(n.id, 'label');
    if (text.trim() === '') continue; // 空のラベルは出さない
    const ext = shapeExtent(n.shape, n.r) + n.strokeWidth / 2 + LABEL_GAP;
    const dir = detectDirection(text);
    // 右から左のラベルは、ノードの左側に置き、文字は左へ伸ばす（text-anchor=end）。
    const x = dir === 'rtl' ? n.x - ext : n.x + ext;
    labelCandidates.push(makeLabel(n.id, text, x, n.y + fontSize * 0.35, fontSize));
  }

  const { visible: rawLabels, hidden: hiddenLabels } = placeLabels(
    labelCandidates,
    rawNodes,
    textWidth,
  );

  // 4. 範囲。ノード・エッジの線幅とラベルを収める。
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const grow = (x0: number, y0: number, x1: number, y1: number): void => {
    minX = Math.min(minX, x0);
    minY = Math.min(minY, y0);
    maxX = Math.max(maxX, x1);
    maxY = Math.max(maxY, y1);
  };
  for (const n of rawNodes) {
    const e = shapeExtent(n.shape, n.r) + n.strokeWidth / 2;
    grow(n.x - e, n.y - e, n.x + e, n.y + e);
  }
  // 【なぜ】ノードだけで範囲を決めると、ノードより太いエッジの両端が SVG の外に切れる。
  // 直線・曲線の制御点の外接矩形を線幅の半分だけ広げる。ベジェ曲線は制御点の凸包内にあるので、
  // Q の場合も安全な上限になる（曲線に対しては少し広いが、図を切らない）。時間 O(E)。
  for (const edge of rawEdges) {
    const halfWidth = edge.width / 2;
    for (const command of edge.path) {
      grow(
        command.x - halfWidth,
        command.y - halfWidth,
        command.x + halfWidth,
        command.y + halfWidth,
      );
      if (command.type === 'Q') {
        grow(
          command.cx - halfWidth,
          command.cy - halfWidth,
          command.cx + halfWidth,
          command.cy + halfWidth,
        );
      }
    }
  }
  // 矢じりや帯は線の中心から離れるので、それぞれの頂点も範囲に含める。
  for (const edge of rawEdges) {
    for (const p of [...(edge.head ?? []), ...(edge.ribbon ?? [])]) grow(p.x, p.y, p.x, p.y);
  }
  for (const l of rawLabels) {
    const w = textWidth(l.text);
    const x0 = l.anchor === 'right' ? l.x - w : l.x;
    grow(x0, l.y - fontSize, x0 + w, l.y + fontSize * 0.3);
  }
  if (!Number.isFinite(minX)) {
    // ノードが 1 つも無い
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const dx = margin - minX;
  const dy = margin - minY;
  const nodes = rawNodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
  const edges = rawEdges.map((e) => ({
    ...e,
    ...(e.head === undefined ? {} : { head: e.head.map((p) => ({ x: p.x + dx, y: p.y + dy })) }),
    ...(e.ribbon === undefined
      ? {}
      : { ribbon: e.ribbon.map((p) => ({ x: p.x + dx, y: p.y + dy })) }),
    ...(e.gradient === undefined
      ? {}
      : {
          gradient: {
            start: { x: e.gradient.start.x + dx, y: e.gradient.start.y + dy },
            end: { x: e.gradient.end.x + dx, y: e.gradient.end.y + dy },
          },
        }),
    path: e.path.map((c): PathCommand => {
      switch (c.type) {
        case 'M':
        case 'L':
          return { ...c, x: c.x + dx, y: c.y + dy };
        case 'Q':
          return { ...c, cx: c.cx + dx, cy: c.cy + dy, x: c.x + dx, y: c.y + dy };
        default:
          return assertNever(c, 'PathCommand');
      }
    }),
  }));
  const labels = rawLabels.map((l) => shiftLabel(l, dx, dy));
  const graphWidth = maxX - minX + margin * 2;
  let width = graphWidth;
  let height = maxY - minY + margin * 2;

  // 5. 凡例は図の右側に置き、図の幅を広げる。
  // 【TS】`SceneLegend | undefined` は「凡例があるか、無いか」の共用体。下の if で代入するので、型を明示する。
  let legend: SceneLegend | undefined;
  if (options.legend !== undefined && options.legend.items.length > 0) {
    legend = layoutLegend(
      options.legend,
      graphWidth - margin + LEGEND_GAP,
      margin,
      fontSize,
      textWidth,
    );
    width = legend.x + legend.width + margin;
    height = Math.max(height, legend.y + legend.height + margin);
  }

  return {
    width,
    height,
    nodes,
    edges,
    labels,
    // 【なぜ】exactOptionalPropertyTypes のため、`legend: undefined` と書けない。あるときだけ足す。
    ...(legend === undefined ? {} : { legend }),
    fontFamily,
    hiddenLabels,
    omitted: {
      nodesWithoutPosition: missingPos,
      edgesWithoutEndpoint,
      selfLoops,
      widthsUnmatched:
        encoding.widths !== undefined &&
        encoding.widths.size > 0 &&
        widthMatched === 0 &&
        rawEdges.length > 0,
    },
  };
}

// ラベルを出すノードを決める。'large' は半径の大きい順（同じなら入力順）に count 個。
function pickLabelNodes(
  nodes: readonly SceneNode[],
  mode: LabelMode,
  selected: ReadonlySet<NodeId>,
  count: number,
): readonly SceneNode[] {
  switch (mode) {
    case 'all':
      return nodes;
    case 'selected':
      return nodes.filter((n) => selected.has(n.id));
    case 'large': {
      // 【TS】`sort` は配列を書き換えるので、先に `slice` でコピーする。安定ソートなので同じ半径は入力順が残る。
      const sorted = nodes.slice().sort((a, b) => b.r - a.r);
      const keep = new Set(sorted.slice(0, Math.max(0, count)).map((n) => n.id));
      return nodes.filter((n) => keep.has(n.id));
    }
    default:
      return assertNever(mode, 'LabelMode');
  }
}

// 凡例の配置。1 列に並べる。右から左の文字は、凡例の右端にそろえる。
// 線の見本（line、arrow）の半長は LINE_HALF。ノードの半径とは別に、見本の列の幅を決める。
const LINE_HALF = 14;
function layoutLegend(
  spec: LegendSpec,
  x: number,
  y: number,
  fontSize: number,
  textWidth: (t: string) => number,
): SceneLegend {
  const markOf = (i: LegendItemSpec): LegendMark => i.mark ?? 'node';
  const rOf = (i: LegendItemSpec): number =>
    markOf(i) === 'node' ? nonNeg(i.r, DEFAULT_RADIUS) : LINE_HALF;
  // 【なぜ】行の高さは、ノードの見本の大きさだけで決める。線の見本は幅が長いが、高さは要らない。
  const maxNodeR = Math.max(
    0,
    ...spec.items.filter((i) => markOf(i) === 'node').map((i) => nonNeg(i.r, DEFAULT_RADIUS)),
  );
  const hasSwatch = spec.items.some((i) => markOf(i) !== 'none');
  const maxR = Math.max(0, ...spec.items.filter((i) => markOf(i) !== 'none').map(rOf));
  const rowH = Math.max(fontSize + 6, maxNodeR * 2 + 4);
  const swatchCol = hasSwatch ? maxR * 2 + 6 : 0;
  const texts = [spec.title ?? '', ...spec.items.map((i) => i.label)];
  const textW = Math.max(...texts.map(textWidth));
  const width = LEGEND_PAD * 2 + swatchCol + textW;
  const titleH = spec.title !== undefined ? rowH : 0;
  const height = LEGEND_PAD * 2 + titleH + rowH * spec.items.length;
  const labelAt = (text: string, rowY: number): SceneLabel => {
    const dir = detectDirection(text);
    const lx = dir === 'rtl' ? x + width - LEGEND_PAD : x + LEGEND_PAD + swatchCol;
    return makeLabel(null, text, lx, rowY + fontSize * 0.35, fontSize);
  };
  const items: SceneLegendItem[] = spec.items.map((it, i) => {
    const cy = y + LEGEND_PAD + titleH + rowH * i + rowH / 2;
    return {
      swatch: {
        x: x + LEGEND_PAD + maxR,
        y: cy,
        r: rOf(it),
        shape: it.shape ?? 'circle',
        fill: normalizeColor(it.fill) ?? OTHER_COLOR,
        dashed: it.dashed === true,
        mark: markOf(it),
        ...(it.attrMissing === true ? { attrMissing: true } : {}),
        ...(markOf(it) !== 'node' && markOf(it) !== 'none'
          ? { lineWidth: nonNeg(it.lineWidth, DEFAULT_EDGE_WIDTH) }
          : {}),
        ...(it.opacity !== undefined ? { opacity: it.opacity } : {}),
      },
      label: labelAt(it.label, cy),
      ...(it.bold === true ? { bold: true } : {}),
    };
  });
  const title =
    spec.title !== undefined ? labelAt(spec.title, y + LEGEND_PAD + rowH / 2) : undefined;
  // 【なぜ】exactOptionalPropertyTypes のため、title も条件つきのスプレッドで足す。
  return { x, y, width, height, ...(title === undefined ? {} : { title }), items };
}
