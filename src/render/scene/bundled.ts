/**
 * 束ねたエッジの描画の幾何（FR-VG-13、FR-VG-14、設計書 §8.1、§8.3、§8.4、D-08、D-55）。
 *
 * 入力は、束ねた折れ線（`bundleEdges` の結果）と、束の区間のまとめ（`buildBundleGraph` の結果）。
 * 出力は、帯（束の太さのリボン）または重ね描きの線。DOM にも React にも依存しない。
 *
 * 【規約】
 * - 折れ線の座標は「レイアウトの座標」で、ズームのたびに `zoom` 倍して px にする。太さ・ずらし・矢じりは
 *   最初から px で持つ（設計書 §8.1「大きさは画面の px」）。束の区間のまとめ（BundleGraph）は、ズームでは作り直さない。
 * - 太さの目盛りの最大は、全期間の最大の重み `maxWeight`（再生で W が変わっても目盛りは動かさない）。
 *   幅 = 最大の幅 × スケール関数(W / maxWeight)。スケールの既定は平方根（D-08）。幅の下限 `minWidth` で、
 *   W が小さい束も見えるようにする（W が 0 の束は描かない）。
 * - 帯（`bands`）: エッジごとにリボンを作るが、すべて不透明で塗り、**層全体に 1 回だけ不透明度を掛ける**
 *   （SVG は `<g opacity>`、PDF は透過グループ）。【なぜ】同じ束を通る複数のエッジのリボンがほぼ重なるので、
 *   リボンごとに半透明にすると、重なった所が濃くなり、束の太さが濃さで歪むため。
 *   点 i の半幅は、隣り合う区間の幅の平均（束 -1 の区間は、そのエッジ自身の重みの幅）。
 * - 往復（`oppositesOf` が空でない束を通る有向エッジ）: 中心線を進行方向の右へ「半幅 + gap/2」だけずらす。
 *   逆向きの束も同じ式で自分の右へずれるので、2 つの帯は gap だけ離れる（D-55 の補足）。
 * - 向き: 先細り（taper。既定）は終端の手前で半幅を 0 へ細くする。矢印（arrow）は、終端に矢じりを置き、帯の
 *   終端を矢じりの底辺へ向けて狭める。矢じりの大きさはそのエッジ自身の重みの幅に比例する（既存の式と同じ）。
 *   濃淡（gradient）は帯では先細りにする。線の端はノードの縁（外接円）で止める。
 * - 簡易版（`overlay`）: 各エッジを自分の重みの幅の半透明の線で重ね描きする（通常のエッジ `SceneEdge` と同じ形）。
 * - 決定的: エッジを ID の昇順に処理する。乱数も Date も使わない（NFR-08）。
 *
 * 計算量: 折れ線の点の総数を P として O(P)（エッジごとに点の数に比例）。5,000 本 × 33 点で数十 ms。
 */
import { makeScale, type ScaleKind } from '../../core/encode';
import type { NodeId } from '../../core/model';
import type { BundleGraph } from '../bundling/bundleGraph';
import { oppositesOf, segmentBundlesOf } from '../bundling/bundleGraph';
import type { BundledPath } from '../bundling/settings';
import type { DirectedEdgeStyle, EdgePoint } from '../edges/geometry';
import type { LegendItemSpec } from './build';
import type { PathCommand, SceneBundle, SceneBundleRibbon, SceneEdge } from './types';

/** 束ねた経路の描き方。`bands` は束の太さの帯（既定）、`overlay` は半透明の重ね描き（簡易版）。 */
export type BundleDrawStyle = 'bands' | 'overlay';

/**
 * `buildScene` に渡す、束ねた結果と描き方（`BuildSceneOptions.bundled`）。
 *
 * 【なぜ】束ねる計算（Worker）と、描く設定（太さ、描き方）は別。ここは「計算の結果」と「描く設定」を
 * 1 つにまとめた入口で、ズーム・パン・太さの変更・再生では、この値を作り直さずに `buildScene` を呼び直せる。
 */
export interface SceneBundling {
  /** 束ねた折れ線。`id` はグラフのエッジのキー（`graph.edges()` の値）にそろえる。点の座標はレイアウトの座標。 */
  readonly paths: readonly BundledPath[];
  /** `buildBundleGraph(paths, edges)` の結果。ズームでは作り直さない。 */
  readonly graph: BundleGraph;
  /** 描き方。既定は `bands`。 */
  readonly style?: BundleDrawStyle;
  /**
   * 束ごとの W（長さ `graph.bundleCount`）。再生では `weightsFor(graph, 現れているエッジの ID)` を渡す。
   * 省略、または長さが合わないときは `graph.weight`（全期間）を使う。W が 0 の束は描かない。
   * 【なぜ】長さが合わないときに例外にしない: 束ねる計算のやり直しの途中で古い W が残っても、図を壊さないため。
   */
  // 【TS】`ArrayLike<number>` は「length と添字で読める数の並び」。`Float64Array` も普通の配列も渡せる
  //       （読むだけなので、書き換えられる型は要らない）。
  readonly weights?: ArrayLike<number>;
  /** 太さのスケール。既定は平方根（D-08）。 */
  readonly scale?: ScaleKind;
  /** 最大の太さ（px）。既定 {@link DEFAULT_BUNDLE_MAX_WIDTH}。 */
  readonly maxWidth?: number;
  /** 最小の太さ（px）。W が正の束の下限。既定 {@link DEFAULT_BUNDLE_MIN_WIDTH}。 */
  readonly minWidth?: number;
  /** 目盛りの最大の重み。省略は全期間の最大（`graph.weight` とエッジの重みの最大）。 */
  readonly maxWeight?: number;
  /** 色（`#rrggbb`）。省略はエッジの既定の色。 */
  readonly color?: string;
  /** 不透明度（0〜1）。帯は層全体に、簡易版は線ごとに掛ける。省略は帯 0.6、簡易版 0.3。 */
  readonly opacity?: number;
  /** 往復の 2 つの帯の間のすき間（px）。既定 1。 */
  readonly laneGap?: number;
}

/** 最大の太さの既定（px）。 */
export const DEFAULT_BUNDLE_MAX_WIDTH = 14;
/** 最小の太さの既定（px）。 */
export const DEFAULT_BUNDLE_MIN_WIDTH = 1;
const DEFAULT_LANE_GAP = 1;
/** 往復でずらす条件: 逆向きの束の W が、自分の W のこの割合以上（対称）。 */
const OPPOSITE_RATIO = 0.2;
/** 幅の移動平均の半径（区間の数）。 */
const SMOOTH_RADIUS = 2;

// 配列をその場で移動平均（半径 SMOOTH_RADIUS、端は窓を狭める）にする。O(n)。
function smooth(a: number[]): void {
  const src = a.slice();
  for (let i = 0; i < a.length; i++) {
    let sum = 0;
    let c = 0;
    for (
      let j = Math.max(0, i - SMOOTH_RADIUS);
      j <= Math.min(a.length - 1, i + SMOOTH_RADIUS);
      j++
    ) {
      sum += src[j] ?? 0;
      c++;
    }
    a[i] = sum / c;
  }
}
const BANDS_OPACITY = 0.6;
const OVERLAY_OPACITY = 0.3;
/** 強調（選んだノードのエッジ）の線の太さと色。 */
const HIGHLIGHT_WIDTH = 1.5;
const HIGHLIGHT_COLOR = '#222222';
/** 欠損のエッジの、帯の上に引く破線の太さ。 */
const MISSING_LINE_WIDTH = 1.5;

/** 束ねた描画の入力のうち、エッジごとのもの。`buildScene` がグラフから作る。 */
export interface BundleDrawEdge {
  readonly id: string;
  readonly sourceId: NodeId;
  readonly targetId: NodeId;
  readonly directed: boolean;
  readonly source: { readonly x: number; readonly y: number; readonly extent: number };
  readonly target: { readonly x: number; readonly y: number; readonly extent: number };
  /** 重みの欠損、または指定した属性の欠損。 */
  readonly dashed: boolean;
  readonly attrMissing: boolean;
  /** 選んだノードに関わるエッジか（選択の強調を図に含めるときだけ true）。 */
  readonly highlighted: boolean;
  /** 束ねないときと同じエッジの幅（px。割り当ての `widths` で決まる）。簡易版の線の太さに使う。 */
  readonly width: number;
}

/** `layoutBundled` の選択肢（`buildScene` から渡す）。 */
export interface BundleLayoutOptions {
  readonly zoom: number;
  readonly directedStyle: DirectedEdgeStyle;
  readonly edges: readonly BundleDrawEdge[];
}

/** `layoutBundled` の結果。 */
export interface BundleLayout {
  readonly bundle: SceneBundle;
  /** 簡易版の線、強調の線、欠損の破線。シーンの `edges` に足す。 */
  readonly lines: readonly SceneEdge[];
  /** この層で描いたエッジのキー。通常のエッジとしては描かない。 */
  // 【TS】`ReadonlySet<T>` は、読むだけの Set（`add` や `delete` が型に無い）。受け取った側が書き換えない約束。
  readonly handled: ReadonlySet<string>;
}

/** 解決済みの太さの設定。 */
export interface BundleWidthScale {
  readonly kind: ScaleKind;
  readonly maxWeight: number;
  readonly maxWidth: number;
  readonly minWidth: number;
  /** 重みを幅（px）に。0 以下は 0（描かない）、正の値は minWidth 以上。 */
  readonly widthOf: (weight: number) => number;
}

function finitePositive(v: number | undefined, fallback: number): number {
  return v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;
}

/**
 * 重み W を幅（px）に写すスケールを作る。凡例の見本（{@link bundleLegendSamples}）も同じものを使う。
 *
 * @param input - 束ねた結果と設定
 * @returns 解決済みの設定と、重みから幅への関数
 * @example
 * resolveBundleWidthScale({ paths, graph }).widthOf(4); // 最大が 16 なら sqrt(4/16) × 14 = 7
 */
export function resolveBundleWidthScale(
  // 【TS】`Pick<T, 'a' | 'b'>` は、型 T から指定した項目だけを取り出した型。この関数が読む項目だけを
  //       要求するので、`SceneBundling` 全体（paths など）を渡さなくてもテストや凡例から呼べる。
  input: Pick<SceneBundling, 'graph' | 'scale' | 'maxWidth' | 'minWidth' | 'maxWeight'>,
): BundleWidthScale {
  const kind = input.scale ?? 'sqrt';
  const maxWidth = finitePositive(input.maxWidth, DEFAULT_BUNDLE_MAX_WIDTH);
  const rawMin = input.minWidth;
  const minWidth = Math.min(
    maxWidth,
    rawMin !== undefined && Number.isFinite(rawMin) && rawMin >= 0
      ? rawMin
      : DEFAULT_BUNDLE_MIN_WIDTH,
  );
  let maxWeight = 0;
  if (input.maxWeight !== undefined && Number.isFinite(input.maxWeight) && input.maxWeight > 0) {
    maxWeight = input.maxWeight;
  } else {
    for (const w of input.graph.weight) if (w > maxWeight) maxWeight = w;
    for (const w of input.graph.edgeWeights) if (w > maxWeight) maxWeight = w;
  }
  // 【なぜ】範囲の下端を 0 にして makeScale を使う。平方根では、幅が W の平方根に比例する（下限より上で）。
  const scale = makeScale([maxWeight], kind, { min: 0, max: maxWidth });
  const widthOf = (weight: number): number =>
    weight > 0 && maxWeight > 0 ? Math.max(minWidth, scale.apply(weight)) : 0;
  return { kind, maxWeight, maxWidth, minWidth, widthOf };
}

/**
 * 帯の太さの凡例の見本（重みと幅の組）。最大の重みから、重みを 1/4 ずつにした 3 つ（平方根では幅が 1、1/2、1/4）。
 *
 * @param scale - {@link resolveBundleWidthScale} の結果
 * @returns 大きい順の見本。最大の重みが 0 なら空
 */
export function bundleLegendSamples(
  scale: BundleWidthScale,
): { readonly weight: number; readonly width: number }[] {
  if (!(scale.maxWeight > 0)) return [];
  return [1, 0.25, 0.0625].map((r) => {
    const weight = scale.maxWeight * r;
    return { weight, width: scale.widthOf(weight) };
  });
}

/**
 * 帯の太さの凡例の項目（線の見本。太さは図の帯と同じ px）。文言は呼ぶ側が翻訳して渡す。
 *
 * @param scale - {@link resolveBundleWidthScale} の結果
 * @param label - 重み W から文言を作る関数（例: `(w) => t('legend.bundleWeight', { w })`）
 * @param color - 見本の色（図の色と同じにする。省略は既定のエッジの色）
 * @returns `LegendSpec.items` に足す項目（大きい順）
 */
export function bundleLegendItems(
  scale: BundleWidthScale,
  label: (weight: number) => string,
  color = '#999999',
): LegendItemSpec[] {
  return bundleLegendSamples(scale).map((s) => ({
    label: label(s.weight),
    fill: color,
    // 【TS】`as const` は 'line' を string に広げず、リテラル型 'line' のまま保つ（`LegendMark` に合わせるため）。
    mark: 'line' as const,
    lineWidth: s.width,
  }));
}

// ---- 折れ線の操作（すべて px） ----

interface Vtx {
  x: number;
  y: number;
  /** 半幅（px）。 */
  h: number;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// 点 i の進行方向の単位接線（前後の点から。端は片側）。長さ 0 なら (1, 0)。
function tangentAt(vs: readonly Vtx[], i: number): { tx: number; ty: number } {
  const a = vs[Math.max(0, i - 1)];
  const b = vs[Math.min(vs.length - 1, i + 1)];
  if (a === undefined || b === undefined) return { tx: 1, ty: 0 };
  const len = dist(a, b);
  return len > 1e-12 ? { tx: (b.x - a.x) / len, ty: (b.y - a.y) / len } : { tx: 1, ty: 0 };
}

// 円（中心 c、半径 r）の内側の点 a から外側の点 b へ向かう線分と円の交点の割合 t（0〜1）。
function exitFraction(a: Vtx, b: Vtx, c: { x: number; y: number }, r: number): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.x;
  const fy = a.y - c.y;
  const A = dx * dx + dy * dy;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - r * r;
  const disc = Math.max(0, B * B - 4 * A * C);
  // a が内側（C < 0）なので、大きい方の解が出口。
  const t = A > 0 ? (-B + Math.sqrt(disc)) / (2 * A) : 1;
  return Math.min(1, Math.max(0, t));
}

function lerpVtx(a: Vtx, b: Vtx, t: number): Vtx {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, h: a.h + (b.h - a.h) * t };
}

/**
 * 折れ線の両端を、ノードの外接円の縁で切る。円の外に出る点が見つからない（全部ノードの中）ときは null。
 *
 * 【なぜ】切るのは px の円なので、ズームのたびに行う（座標は倍率で変わり、円の大きさは変わらない）。
 *
 * @param vs - 点（始点がノード s の中心、終点がノード t の中心の近く）
 * @param s - 始点側の円
 * @param t - 終点側の円
 * @returns 切った点。使える長さが残らないとき null
 */
function clipPolyline(
  vs: readonly Vtx[],
  s: { x: number; y: number; extent: number },
  t: { x: number; y: number; extent: number },
): Vtx[] | null {
  let first = -1;
  for (let i = 0; i < vs.length; i++) {
    const p = vs[i];
    if (p !== undefined && dist(p, s) >= s.extent) {
      first = i;
      break;
    }
  }
  let last = -1;
  for (let i = vs.length - 1; i >= 0; i--) {
    const p = vs[i];
    if (p !== undefined && dist(p, t) >= t.extent) {
      last = i;
      break;
    }
  }
  if (first < 0 || last < 0 || first > last) return null;
  const out: Vtx[] = [];
  const f = vs[first];
  const l = vs[last];
  if (f === undefined || l === undefined) return null;
  if (first > 0) {
    const prev = vs[first - 1];
    if (prev !== undefined) out.push(lerpVtx(prev, f, exitFraction(prev, f, s, s.extent)));
  }
  for (let i = first; i <= last; i++) {
    const p = vs[i];
    if (p !== undefined) out.push({ ...p });
  }
  if (last < vs.length - 1) {
    const next = vs[last + 1];
    if (next !== undefined) {
      // 終点側は、円の内側の点 next から外側の点 l へ向かうので、割合を反対向きに測る。
      out.push(lerpVtx(next, l, exitFraction(next, l, t, t.extent)));
    }
  }
  if (out.length < 2) return null;
  let length = 0;
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1];
    const b = out[i];
    if (a !== undefined && b !== undefined) length += dist(a, b);
  }
  return length > 1e-6 ? out : null;
}

// 弧長 s の位置で折れ線を切る（その位置に点を足す）。s が全長以上なら何もしない。戻り値は [手前側, 点の添字]。
function splitAt(vs: readonly Vtx[], s: number): { pts: Vtx[]; index: number } {
  const pts = vs.map((v) => ({ ...v }));
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (a === undefined || b === undefined) continue;
    const d = dist(a, b);
    if (acc + d >= s) {
      if (d <= 1e-12 || s - acc <= 1e-9) return { pts, index: i - 1 };
      if (acc + d - s <= 1e-9) return { pts, index: i };
      pts.splice(i, 0, lerpVtx(a, b, (s - acc) / d));
      return { pts, index: i };
    }
    acc += d;
  }
  return { pts, index: pts.length - 1 };
}

function lengthOf(vs: readonly Vtx[]): number {
  let n = 0;
  for (let i = 1; i < vs.length; i++) {
    const a = vs[i - 1];
    const b = vs[i];
    if (a !== undefined && b !== undefined) n += dist(a, b);
  }
  return n;
}

// 半幅つきの折れ線から、リボンの多角形（左側の列 + 右側の列の逆順）を作る。
function ribbonOf(vs: readonly Vtx[]): EdgePoint[] {
  const left: EdgePoint[] = [];
  const right: EdgePoint[] = [];
  for (const [i, p] of vs.entries()) {
    const { tx, ty } = tangentAt(vs, i);
    // 右手の法線（画面は y が下向き。東向きの右は南）。
    const nx = -ty * p.h;
    const ny = tx * p.h;
    left.push({ x: p.x - nx, y: p.y - ny });
    right.push({ x: p.x + nx, y: p.y + ny });
  }
  return [...left, ...right.reverse()];
}

function pathOfPoints(vs: readonly { x: number; y: number }[]): PathCommand[] {
  return vs.map((p, i): PathCommand => ({ type: i === 0 ? 'M' : 'L', x: p.x, y: p.y }));
}

// 矢じりの形は既存の矢印（edges/geometry.ts）と同じ式。長さ min(max(6, 3w), 全長/2)、半幅 min(max(3, 1.5w), 長さ×0.7)。
function arrowSizes(width: number, totalLength: number): { len: number; half: number } {
  const len = Math.min(Math.max(6, width * 3), totalLength / 2);
  return { len, half: Math.min(Math.max(3, width * 1.5), len * 0.7) };
}

/**
 * 束ねた折れ線を、帯と線にする。
 *
 * @param input - 束ねた結果と描く設定
 * @param options - ズーム、向きの表し方、エッジごとの情報
 * @returns 帯の層、線、この層で描いたエッジのキー
 */
export function layoutBundled(input: SceneBundling, options: BundleLayoutOptions): BundleLayout {
  const style: BundleDrawStyle = input.style ?? 'bands';
  const scale = resolveBundleWidthScale(input);
  const graph = input.graph;
  const weights: ArrayLike<number> =
    input.weights?.length === graph.bundleCount ? input.weights : graph.weight;
  const gap = input.laneGap !== undefined && input.laneGap >= 0 ? input.laneGap : DEFAULT_LANE_GAP;
  const color = input.color ?? '#999999';
  const opacity = Math.min(
    1,
    Math.max(
      0,
      input.opacity !== undefined && Number.isFinite(input.opacity)
        ? input.opacity
        : style === 'bands'
          ? BANDS_OPACITY
          : OVERLAY_OPACITY,
    ),
  );
  // 往復のずらしをするか（束ごとに 1 回だけ判定）。逆向きの束があっても、片方の W がもう片方の
  // OPPOSITE_RATIO 倍に満たなければ（往路だけの束にごく小さな逆向きが重なる場合）ずらさない。
  // 判定は対称（両方の束が同じ結論になる）なので、2 つの帯がずれ方で重なることはない。
  const laneCache = new Map<number, boolean>();
  const hasLane = (b: number): boolean => {
    let v = laneCache.get(b);
    if (v === undefined) {
      const wb = weights[b] ?? 0;
      v = oppositesOf(graph, b).some((o) => {
        const wo = weights[o] ?? 0;
        return wb > 0 && wo > 0 && Math.min(wb, wo) >= OPPOSITE_RATIO * Math.max(wb, wo);
      });
      laneCache.set(b, v);
    }
    return v;
  };
  const infoById = new Map(options.edges.map((e) => [e.id, e]));
  const ribbons: SceneBundleRibbon[] = [];
  const lines: SceneEdge[] = [];
  const handled = new Set<string>();

  // 【なぜ】ID の昇順（paths の順に依らない）。同じ入力から同じ SVG になる。
  const sorted = [...input.paths].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const path of sorted) {
    const info = infoById.get(path.id);
    // 束ねていない経路（自己ループ、長さ 0）と、グラフに無いエッジは、通常のエッジとして描く。
    if (info === undefined || !path.bundled) continue;
    const n = path.points.length / 2;
    const e = graph.edgeIndex.get(path.id);
    if (n < 2 || e === undefined) continue;
    const segBundles = segmentBundlesOf(graph, path.id);
    if (segBundles.length !== n - 1) continue;

    // 【なぜ】簡易版は、束ねないときと同じエッジごとの幅（割り当ての `widths`、既定 0.5〜2.5 px）で描く。
    // 凡例の「エッジの太さ」と一致させるため。帯は、束のスケール（0〜maxWidth px）で描く。
    const ownWidth = style === 'overlay' ? info.width : scale.widthOf(graph.edgeWeights[e] ?? 0);
    // 区間ごとの幅（px）と、往復のずらし（px）。
    const segWidth: number[] = [];
    const segShift: number[] = [];
    for (let k = 0; k < n - 1; k++) {
      const b = segBundles[k] ?? -1;
      const bandWidth = b >= 0 ? scale.widthOf(weights[b] ?? 0) : ownWidth;
      // 簡易版は、束の太さでなく、そのエッジ自身の幅で描く。ずらしも自分の幅で決める。
      const width = style === 'bands' ? bandWidth : ownWidth;
      segWidth.push(width);
      // 【なぜ】ずらしは束に従う（無向のエッジも、入った束の車線に従う。エッジの directed では決めない）。
      segShift.push(b >= 0 && width > 0 && hasLane(b) ? width / 2 + gap / 2 : 0);
    }
    // 【なぜ】束は先着順の代表点で分けるので、扇の部分で W が区間ごとに上下する（例 147, 77, 106, 74）。
    // 帯の縁がギザギザにならないよう、帯の幅とずらしを 5 区間の移動平均でなめらかにする（W 一定の芯は変わらない）。
    if (style === 'bands') {
      const raw = segWidth.slice();
      smooth(segWidth);
      smooth(segShift);
      // 【なぜ】元の幅が 0（再生で W が 0 の区間）は 0 に戻す。平均が 0 の区間へはみ出さないように。
      raw.forEach((w, k) => {
        if (w === 0) {
          segWidth[k] = 0;
          segShift[k] = 0;
        }
      });
    }
    // 点の半幅とずらしは、隣り合う区間の平均（端は片側）。
    const avg = (a: readonly number[], i: number): number => {
      const l = i > 0 ? a[i - 1] : undefined;
      const r = i < a.length ? a[i] : undefined;
      return ((l ?? r ?? 0) + (r ?? l ?? 0)) / 2;
    };
    let base: Vtx[] = [];
    for (let i = 0; i < n; i++) {
      base.push({
        x: (path.points[2 * i] ?? 0) * options.zoom,
        y: (path.points[2 * i + 1] ?? 0) * options.zoom,
        h: avg(segWidth, i) / 2,
      });
    }
    // 往復のずらし: 中心線を進行方向の右へ。
    const shifted = base.map((p, i) => {
      const o = avg(segShift, i);
      if (o === 0) return p;
      const { tx, ty } = tangentAt(base, i);
      return { x: p.x + -ty * o, y: p.y + tx * o, h: p.h };
    });
    base = shifted;
    const clipped = clipPolyline(base, info.source, info.target);
    if (clipped === null) continue; // 両端のノードが重なる。通常のエッジ（中心どうしの直線）にまかせる。
    handled.add(path.id);

    const total = lengthOf(clipped);
    const directedStyle = info.directed ? options.directedStyle : undefined;

    if (style === 'overlay') {
      lines.push(
        overlayLine(path.id, info, clipped, ownWidth, total, directedStyle, color, opacity),
      );
    } else {
      const ribbon = bandRibbon(path.id, clipped, ownWidth, total, directedStyle);
      if (ribbon !== null) ribbons.push(ribbon);
      // 選んだノードのエッジは、帯の上に細い線で強調する。欠損のエッジは、細い破線で示す。
      if (info.highlighted)
        lines.push(
          thinLine(
            path.id,
            info,
            clipped,
            HIGHLIGHT_WIDTH,
            HIGHLIGHT_COLOR,
            0.9,
            false,
            'highlight',
          ),
        );
      if (info.dashed)
        lines.push(
          thinLine(path.id, info, clipped, MISSING_LINE_WIDTH, color, 0.9, true, 'missing'),
        );
    }
  }
  return {
    bundle: {
      style,
      color,
      opacity,
      ribbons,
      widthScale: {
        kind: scale.kind,
        maxWeight: scale.maxWeight,
        maxWidth: scale.maxWidth,
        minWidth: scale.minWidth,
      },
    },
    lines,
    handled,
  };
}

// 帯: 半幅つきの折れ線 → リボン。向きは終端の手前で狭める（先細り）か、矢じりを足す（矢印）。
function bandRibbon(
  id: string,
  vs: readonly Vtx[],
  ownWidth: number,
  total: number,
  style: DirectedEdgeStyle | undefined,
): SceneBundleRibbon | null {
  if (!vs.some((v) => v.h > 0)) return null; // W が 0 の束だけを通る。描かない。
  if (style === undefined) return { edgeId: id, polygon: ribbonOf(vs) };
  // 向きの印の大きさは、そのエッジ自身の幅（W の幅ではない）に比例させる。自身の幅が 0 なら最小の幅を使う。
  const w = Math.max(ownWidth, 1);
  if (style === 'arrow') {
    const { len, half } = arrowSizes(w, total);
    const zone = Math.min(total * 0.35, Math.max(16, 4 * w));
    // 矢じりの底辺（終端から len 手前）で切り、その手前の zone で半幅を矢じりの半幅へ寄せる。
    const cut = splitAt(vs, total - len);
    const body = cut.pts.slice(0, cut.index + 1);
    const zoneStart = splitAt(body, Math.max(0, lengthOf(body) - zone));
    const shaped = zoneStart.pts.map((p, i, all) => {
      if (i <= zoneStart.index) return p;
      const u = (i - zoneStart.index) / Math.max(1, all.length - 1 - zoneStart.index);
      return { ...p, h: p.h + (Math.min(p.h, half) - p.h) * u };
    });
    const baseP = body[body.length - 1];
    const tip = vs[vs.length - 1];
    if (baseP === undefined || tip === undefined) return null;
    const d = dist(baseP, tip) || 1;
    const nx = (-(tip.y - baseP.y) / d) * half;
    const ny = ((tip.x - baseP.x) / d) * half;
    return {
      edgeId: id,
      polygon: ribbonOf(shaped),
      head: [
        { x: tip.x, y: tip.y },
        { x: baseP.x + nx, y: baseP.y + ny },
        { x: baseP.x - nx, y: baseP.y - ny },
      ],
    };
  }
  // 先細り（濃淡は帯では先細りにする）。終端の zone で半幅を 0 へ。
  const zone = Math.min(total * 0.35, Math.max(16, 4 * w));
  const split = splitAt(vs, Math.max(0, total - zone));
  const shaped = split.pts.map((p, i, all) => {
    if (i <= split.index) return p;
    return { ...p, h: p.h * (1 - (i - split.index) / Math.max(1, all.length - 1 - split.index)) };
  });
  return { edgeId: id, polygon: ribbonOf(shaped) };
}

function edgeBase(id: string, info: BundleDrawEdge) {
  return {
    id,
    directed: info.directed,
    dashed: info.dashed,
    ...(info.attrMissing ? { attrMissing: true } : {}),
  };
}

// 帯の上の細い線（強調と欠損）。向きの印は付けない（帯の側に付いている）。
function thinLine(
  id: string,
  info: BundleDrawEdge,
  vs: readonly Vtx[],
  width: number,
  color: string,
  opacity: number,
  dashed: boolean,
  role: 'highlight' | 'missing',
): SceneEdge {
  return {
    ...edgeBase(id, info),
    dashed,
    source: info.sourceId,
    target: info.targetId,
    path: pathOfPoints(vs),
    width,
    color,
    opacity,
    role,
  };
}

// 簡易版: 通常のエッジと同じ SceneEdge。太さは自分の重みの幅。
function overlayLine(
  id: string,
  info: BundleDrawEdge,
  vs: readonly Vtx[],
  ownWidth: number,
  total: number,
  style: DirectedEdgeStyle | undefined,
  color: string,
  opacity: number,
): SceneEdge {
  const width = Math.max(ownWidth, 0.5);
  const common = {
    ...edgeBase(id, info),
    source: info.sourceId,
    target: info.targetId,
    color,
    opacity,
    // 【TS】`as const`: 同上。'overlay' のまま保たないと、`SceneEdge.role` の型に合わない。
    role: 'overlay' as const,
  };
  const first = vs[0];
  const last = vs[vs.length - 1];
  if (style === undefined || first === undefined || last === undefined) {
    return { ...common, path: pathOfPoints(vs), width };
  }
  if (style === 'gradient') {
    return {
      ...common,
      path: pathOfPoints(vs),
      width,
      gradient: { start: { x: first.x, y: first.y }, end: { x: last.x, y: last.y } },
    };
  }
  if (style === 'taper') {
    // 全長で、始点の半幅から 0 へ。
    let acc = 0;
    const tapered = vs.map((p, i) => {
      const prev = vs[i - 1];
      if (prev !== undefined) acc += dist(prev, p);
      return { ...p, h: (width / 2) * (1 - (total > 0 ? acc / total : 1)) };
    });
    return { ...common, path: pathOfPoints(vs), width, ribbon: ribbonOf(tapered) };
  }
  const { len, half } = arrowSizes(width, total);
  const cut = splitAt(vs, total - len);
  const body = cut.pts.slice(0, cut.index + 1);
  const baseP = body[body.length - 1];
  if (baseP === undefined) return { ...common, path: pathOfPoints(vs), width };
  const d = dist(baseP, last) || 1;
  const nx = (-(last.y - baseP.y) / d) * half;
  const ny = ((last.x - baseP.x) / d) * half;
  return {
    ...common,
    path: pathOfPoints(body),
    width: Math.min(width, half * 2),
    head: [
      { x: last.x, y: last.y },
      { x: baseP.x + nx, y: baseP.y + ny },
      { x: baseP.x - nx, y: baseP.y - ny },
    ],
  };
}
