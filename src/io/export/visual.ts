/**
 * ネットワーク形式（GraphML、GEXF）に書く表示情報（位置、大きさ、色、形）。FR-OUT-05、FR-OUT-01。
 *
 * 【なぜ】属性の表だけの GraphML や GEXF は、外部のビューアで開くと、ノードが原点に重なったり、
 * ラベルが出なかったりする（yEd、yFiles は yFiles 拡張の `y:ShapeNode` が無いと位置も形も分からない。
 * Gephi は属性 `x`、`y`、`size`、`r`、`g`、`b` を、GEXF では `viz:` 要素を読む）。
 * 画面の図と同じ見た目で開けるように、図のシーン（SVG・PNG・PDF と同じもの）の値をそのまま使う。
 */

/** ノードの形。core の `NodeShape` と同じ（io から render への依存を増やさないため、ここで再宣言する）。 */
export type VisualShape = 'circle' | 'square' | 'triangle' | 'diamond';

/** 色（0 から 255 の整数）。 */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/** ノード 1 つの表示情報。座標は図の左上を原点とし、y は下向き（SVG と同じ）。 */
export interface NodeVisual {
  readonly x: number;
  readonly y: number;
  /** 半径（px）。 */
  readonly r: number;
  readonly shape: VisualShape;
  readonly color: Rgb;
}

/** エッジ 1 本の表示情報。 */
export interface EdgeVisual {
  readonly color: Rgb;
  readonly width: number;
}

/** 書き出しに付ける表示情報。キーは、ノードは ID、エッジは表示中のグラフのエッジのキー。 */
export interface NetworkVisual {
  readonly nodes: ReadonlyMap<string, NodeVisual>;
  readonly edges: ReadonlyMap<string, EdgeVisual>;
}

/**
 * 色の文字列を RGB にする。`#rgb`、`#rrggbb`、`rgb(r, g, b)`、`rgba(...)` を読む。
 *
 * @param text - CSS の色
 * @returns RGB。読めなければ null（その要素は色を省く）
 */
export function parseColor(text: string): Rgb | null {
  const s = text.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (hex !== null) {
    const h = hex[1] ?? '';
    const full = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }
  const fn = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)/.exec(s);
  if (fn !== null) {
    const c = (v: string | undefined): number => Math.min(255, Math.round(Number(v)));
    return { r: c(fn[1]), g: c(fn[2]), b: c(fn[3]) };
  }
  return null;
}

/**
 * RGB を `#RRGGBB` にする。
 *
 * @param c - 色
 * @returns 大文字 16 進
 */
export function hexColor(c: Rgb): string {
  const h = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * 座標や大きさを、小数 2 桁までの文字列にする（ファイルを小さくし、浮動小数点の長い桁を避ける）。
 *
 * @param n - 数
 * @returns 例: `12.5`、`-0` は `0`
 */
export function num(n: number): string {
  const r = Math.round(n * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
}

// 【TS】引数の型に「必要な項目だけ」を書く（構造的部分型）。`Scene` や `SceneNode` をそのまま渡せるが、
//       io が render の型に依存しなくて済む。
/** シーンから表示情報を取り出すのに必要な項目。`Scene` がこれを満たす。 */
export interface VisualScene {
  readonly nodes: readonly {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly shape: VisualShape;
    readonly fill: string;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly color: string;
    readonly width: number;
  }[];
}

/**
 * 図のシーンから、書き出しに付ける表示情報を作る。
 *
 * シーンのノードの ID はグラフのノードの ID と同じ、エッジの ID はグラフのエッジのキーと同じ
 * （射影やまとめたエッジでも同じ）。色が読めない要素は、その要素だけ色を省く。
 *
 * @param scene - 図のシーン
 * @returns 表示情報
 */
export function visualFromScene(scene: VisualScene): NetworkVisual {
  const nodes = new Map<string, NodeVisual>();
  for (const n of scene.nodes) {
    const color = parseColor(n.fill);
    if (color === null) continue;
    nodes.set(n.id, { x: n.x, y: n.y, r: n.r, shape: n.shape, color });
  }
  const edges = new Map<string, EdgeVisual>();
  for (const e of scene.edges) {
    const color = parseColor(e.color);
    if (color === null) continue;
    edges.set(e.id, { color, width: e.width });
  }
  return { nodes, edges };
}
