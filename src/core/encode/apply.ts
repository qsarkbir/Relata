/**
 * 設定と値から、ノードの大きさ・色・形とエッジの太さを求める（FR-VG-03、04、08、D-23）。
 *
 * 指標やグラフには依存しない。呼び出す側が「ID → 値」の対応を作って渡す。
 * 欠損は `Missing`（値の代わりに入れる）で表し、最小の大きさ・薄い灰色にして印を付ける（FR-DM-02）。
 * 有限でない数値（NaN、±∞）も欠損として扱う。
 */
// 【TS】`import { type X }` の `type` は、その名前が型だけであることを示す。実行時には消える。
import {
  NODE_SHAPES,
  type EdgeId,
  type Missing,
  type NodeId,
  type NodeShape,
  type NodeType,
  type NodeTypeId,
  type Scalar,
} from '../model';
import { assertNever } from '../util/assertNever';
import {
  CATEGORY_COLORS,
  MISSING_COLOR,
  OTHER_COLOR,
  normalizeColor,
  viridisColor,
} from './palette';
import { makeScale, type ScaleKind, type ScaleResult } from './scale';
import type { EdgeWidthEncoding, NodeShapeEncoding, NodeSizeEncoding } from './settings';

/** 凡例の代表値 1 つ。`value` は元の値、`size` はその値の大きさ（px）。 */
export interface ScaleTick {
  readonly value: number;
  readonly size: number;
}

/** 大きさの凡例の情報。 */
export interface ScaleLegend {
  readonly kind: ScaleKind;
  readonly domain: { readonly min: number; readonly max: number };
  readonly range: { readonly min: number; readonly max: number };
  /** 負の値を 0 として扱った件数（平方根・対数）。利用者への注意書きに使う。 */
  readonly negativeCount: number;
  /** 欠損（有限でない値を含む）の件数。0 なら凡例に欠損を出さない。 */
  readonly missingCount: number;
  /** 代表値（定義域の下端、中央、上端。幅が 0 なら 1 つ）と、その大きさ。`scale.apply` で作る。 */
  readonly ticks: readonly ScaleTick[];
}

/** ノード 1 つの大きさ。`missing` が true なら値が欠損で、最小の大きさにしてある。 */
export interface SizeResult {
  readonly size: number;
  readonly missing: boolean;
}

// スケールから凡例を作る。代表値の大きさは、描画と同じ `apply` で求めるので凡例と図が食い違わない。
function makeLegend(scale: ScaleResult, missingCount: number): ScaleLegend {
  const { kind, domain, range, negativeCount } = scale;
  const values =
    domain.max > domain.min
      ? [domain.min, (domain.min + domain.max) / 2, domain.max]
      : [domain.max];
  const ticks = values.map((value) => ({ value, size: scale.apply(value) }));
  return { kind, domain, range, negativeCount, missingCount, ticks };
}

/**
 * ノードの大きさ（半径、px）を求める。
 *
 * 元が定数のときは範囲の中央にする（値が無いので、最小でも最大でもない中間が無難）。
 * 計算量: ノード数を n として O(n)。
 *
 * @param ids - 対象のノード
 * @param values - ID → 値。無い ID と、有限でない数値は欠損として扱う。定数のときは使わない
 * @param setting - 大きさの設定
 * @returns ID → 大きさと、凡例の情報（定数のときは null）
 */
// 【TS】`ReadonlyMap<K, V>` は、読み取りだけができる Map の型（set や delete が無い）。
//       入力を書き換えない約束を型で表す。
export function encodeNodeSizes(
  ids: readonly NodeId[],
  values: ReadonlyMap<NodeId, number | Missing>,
  setting: NodeSizeEncoding,
): { sizes: Map<NodeId, SizeResult>; legend: ScaleLegend | null } {
  const range = { min: setting.min, max: setting.max };
  const sizes = new Map<NodeId, SizeResult>();
  if (setting.source.kind === 'constant') {
    const size = (range.min + range.max) / 2;
    for (const id of ids) sizes.set(id, { size, missing: false });
    return { sizes, legend: null };
  }
  const finite = (v: number | Missing | undefined): v is number =>
    typeof v === 'number' && Number.isFinite(v);
  const nums: number[] = [];
  for (const id of ids) {
    const v = values.get(id);
    if (finite(v)) nums.push(v);
  }
  const scale = makeScale(nums, setting.scale, range);
  let missingCount = 0;
  for (const id of ids) {
    const v = values.get(id);
    if (finite(v)) sizes.set(id, { size: scale.apply(v), missing: false });
    else {
      missingCount += 1;
      sizes.set(id, { size: range.min, missing: true });
    }
  }
  return { sizes, legend: makeLegend(scale, missingCount) };
}

/** エッジ 1 本の太さ。`missing` が true なら重みが有限でなく、最小の太さにしてある。 */
export interface WidthResult {
  readonly width: number;
  readonly missing: boolean;
}

/**
 * エッジの太さ（px）を求める。
 *
 * 計算量: エッジ数を m として O(m)。
 *
 * @param edges - 対象のエッジ（ID と重み）
 * @param setting - 太さの設定。元が定数なら範囲の中央
 * @returns ID → 太さと、凡例の情報（定数のときは null）。有限でない重みは欠損
 */
export function encodeEdgeWidths(
  edges: readonly { readonly id: EdgeId; readonly weight: number }[],
  setting: EdgeWidthEncoding,
): { widths: Map<EdgeId, WidthResult>; legend: ScaleLegend | null } {
  const range = { min: setting.min, max: setting.max };
  const widths = new Map<EdgeId, WidthResult>();
  if (setting.source.kind === 'constant') {
    const width = (range.min + range.max) / 2;
    for (const e of edges) widths.set(e.id, { width, missing: false });
    return { widths, legend: null };
  }
  const scale = makeScale(
    edges.map((e) => e.weight),
    setting.scale,
    range,
  );
  let missingCount = 0;
  for (const e of edges) {
    if (Number.isFinite(e.weight))
      widths.set(e.id, { width: scale.apply(e.weight), missing: false });
    else {
      missingCount += 1;
      widths.set(e.id, { width: range.min, missing: true });
    }
  }
  return { widths, legend: makeLegend(scale, missingCount) };
}

/** 色の割り当ての 1 件。`missing` は欠損の印。 */
export interface ColorResult {
  readonly color: string;
  readonly missing: boolean;
}

/** カテゴリ属性の色の 1 件。`multi` は複数値の要素で、最初の値の色で塗ってある印。 */
export interface CategoryColorResult extends ColorResult {
  readonly multi: boolean;
}

/** カテゴリの凡例の 1 行。 */
export interface CategoryLegendEntry {
  readonly key: string;
  readonly color: string;
}

/** カテゴリの色の凡例。 */
export interface CategoryLegend {
  /** 色が割り当てられたカテゴリ（件数の多い順）。 */
  readonly entries: readonly CategoryLegendEntry[];
  /** 灰色（「その他」）にまとめたカテゴリの数。描画で灰色になったものと一致する。0 なら凡例に出さない。 */
  readonly otherCount: number;
  readonly otherColor: string;
  /** 欠損の要素の数。0 なら凡例に「欠損」を出さない。 */
  readonly missingCount: number;
  readonly missingColor: string;
}

/** カテゴリ属性の値。複数値（FR-DM-07）は配列。空の配列は欠損と同じに扱う。 */
export type CategoryValue = readonly Scalar[] | Missing;

// 欠損か（欠損の印か、空の配列）。
function isEmptyValue(v: CategoryValue): v is Missing | readonly never[] {
  return !Array.isArray(v) || v.length === 0;
}

// 要素の値を、色を決めるキーの一覧にする。同じ値の重複は 1 つにする。
// 【なぜ】照合キーは使わず `String(値)` で比べる（D-21 と同じ。ファセットの 1 項目に 1 色）。
function keysOf(v: CategoryValue): string[] {
  return isEmptyValue(v) ? [] : [...new Set(v.map((x) => String(x)))];
}

/**
 * カテゴリ属性の値からノードの色を決める。
 *
 * 色の順は、`basis`（絞り込み前の全要素の値）での「件数の多い順、同数ならコードユニットの文字列順」。
 * データの並びが変わっても、絞り込みで件数が変わっても色は変わらず、よく出るカテゴリに区別しやすい
 * 8 色が回る。9 個目以降は灰色（巡回しない）。`basis` に無い値は灰色になり、「その他」に数える
 * （凡例と描画を一致させる）。複数値の要素は最初の値の色で塗り、`multi: true` の印を付ける。
 * 欠損は理由を問わず 1 色。
 *
 * 計算量: 値の総数を n、カテゴリの種類数を k として O(n + k log k)（数え上げと、件数での並べ替え）。
 *
 * @param categories - 色を付けるノードの ID → カテゴリの値（または欠損）
 * @param basis - 色の順を決める集合（絞り込み前の全要素）。必須
 * @returns ID → 色と、凡例
 */
export function encodeNodeColorsByCategory(
  categories: ReadonlyMap<NodeId, CategoryValue>,
  basis: ReadonlyMap<NodeId, CategoryValue>,
): { colors: Map<NodeId, CategoryColorResult>; legend: CategoryLegend } {
  const counts = new Map<string, number>();
  for (const v of basis.values()) {
    for (const key of keysOf(v)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ordered = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  const colorOf = new Map<string, string>();
  ordered.forEach(([key], i) => colorOf.set(key, CATEGORY_COLORS[i] ?? OTHER_COLOR));
  // 灰色になるカテゴリ: basis で 9 番目以降のもの。描画で灰色になった、basis に無いものも足す。
  const otherKeys = new Set(ordered.slice(CATEGORY_COLORS.length).map(([key]) => key));
  const colors = new Map<NodeId, CategoryColorResult>();
  let missingCount = 0;
  for (const [id, v] of categories) {
    const first = keysOf(v)[0];
    if (first === undefined) {
      missingCount += 1;
      colors.set(id, { color: MISSING_COLOR, missing: true, multi: false });
      continue;
    }
    const color = colorOf.get(first) ?? OTHER_COLOR;
    if (color === OTHER_COLOR) otherKeys.add(first);
    colors.set(id, { color, missing: false, multi: keysOf(v).length > 1 });
  }
  const entries = ordered
    .slice(0, CATEGORY_COLORS.length)
    .map(([key]) => ({ key, color: colorOf.get(key) ?? OTHER_COLOR }));
  return {
    colors,
    legend: {
      entries,
      otherCount: otherKeys.size,
      otherColor: OTHER_COLOR,
      missingCount,
      missingColor: MISSING_COLOR,
    },
  };
}

/** 連続値の色の凡例。 */
export interface GradientLegend {
  /** `range`: 値に幅がある。`single`: 値が 1 種類だけ（中間の色）。`empty`: 有限な値が無い。 */
  readonly state: 'range' | 'single' | 'empty';
  /** `empty` のときは 0。 */
  readonly min: number;
  readonly max: number;
  readonly missingCount: number;
  readonly missingColor: string;
}

/**
 * 数値（指標）からノードの色を決める。viridis を、最小値〜最大値で線形に当てはめる。
 *
 * 値がすべて同じ（または 1 つだけ）なら中間の色にする。有限でない値は欠損。
 * 計算量: O(n)。
 *
 * @param values - ID → 数値または欠損
 * @returns ID → 色と、凡例
 */
export function encodeNodeColorsByNumber(values: ReadonlyMap<NodeId, number | Missing>): {
  colors: Map<NodeId, ColorResult>;
  legend: GradientLegend;
} {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values.values()) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const state = min > max ? 'empty' : min === max ? 'single' : 'range';
  if (state === 'empty') {
    min = 0;
    max = 0;
  }
  const colors = new Map<NodeId, ColorResult>();
  let missingCount = 0;
  for (const [id, v] of values) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      const t = state === 'range' ? (v - min) / (max - min) : 0.5;
      colors.set(id, { color: viridisColor(t), missing: false });
    } else {
      missingCount += 1;
      colors.set(id, { color: MISSING_COLOR, missing: true });
    }
  }
  return { colors, legend: { state, min, max, missingCount, missingColor: MISSING_COLOR } };
}

/** 不正な型の色の報告。 */
export interface InvalidTypeColor {
  readonly typeId: NodeTypeId;
  /** 不正だった元の文字列。 */
  readonly color: string;
}

/**
 * ノード型ごとの色を決める。`NodeType.color` が正しければそれを優先し（D-23）、
 * なければ型の並び順（位置）で Okabe-Ito の色を当てる。9 つ目以降の型は灰色。
 *
 * 【なぜ】位置で決めるので、他の型が色を持っていても、この型の色は変わらない。
 * 不正な色（`#rrggbb` でない）は、既定の色に戻して `invalid` に報告する（設計書 §8.1）。
 *
 * @param nodeTypes - ノード型の一覧
 * @returns 型 ID → 色、不正な色の報告
 */
export function typeColors(nodeTypes: readonly NodeType[]): {
  colors: Map<NodeTypeId, string>;
  invalid: InvalidTypeColor[];
} {
  const colors = new Map<NodeTypeId, string>();
  const invalid: InvalidTypeColor[] = [];
  nodeTypes.forEach((t, i) => {
    const own = normalizeColor(t.color);
    if (t.color !== undefined && own === null) invalid.push({ typeId: t.id, color: t.color });
    colors.set(t.id, own ?? CATEGORY_COLORS[i] ?? OTHER_COLOR);
  });
  return { colors, invalid };
}

/**
 * ノード型ごとの形を決める。`NodeType.shape` があれば優先し（D-23）、なければ型の位置で
 * 円、四角、三角、ひし形を順に当てる。5 つ目以降は巡回する。
 *
 * 色だけに頼らない（NFR-07）のは、形が重ならない最初の 4 型まで。5 型以降は、色と形の組が
 * 他の型と重なりうるので、`typeStyles` の `collisions` で報告する。
 *
 * @param nodeTypes - ノード型の一覧
 * @param setting - 形の設定。定数ならすべてその形
 * @returns 型 ID → 形
 */
export function typeShapes(
  nodeTypes: readonly NodeType[],
  setting: NodeShapeEncoding,
): Map<NodeTypeId, NodeShape> {
  const out = new Map<NodeTypeId, NodeShape>();
  nodeTypes.forEach((t, i) => {
    switch (setting.kind) {
      case 'constant':
        out.set(t.id, setting.shape);
        break;
      case 'nodeType':
        out.set(t.id, t.shape ?? NODE_SHAPES[i % NODE_SHAPES.length] ?? 'circle');
        break;
      default:
        assertNever(setting, 'NodeShapeEncoding');
    }
  });
  return out;
}

/**
 * 型の見た目が紛らわしい理由。
 *
 * - `gray`: 色が灰色（9 つ目以降の型）になり、他の型と区別しにくい
 * - `same-style`: 色と形の組が、先にある別の型と同じ
 * - `user-color-overlap`: 利用者が指定した色が、別の型の色と同じ
 */
export type TypeCollisionReason = 'gray' | 'same-style' | 'user-color-overlap';

/** 見た目が紛らわしい型の報告。画面で型の色や形の設定を促すのに使う。 */
export interface TypeCollision {
  readonly typeId: NodeTypeId;
  readonly reason: TypeCollisionReason;
}

/** 型ごとの色と形、不正な色、紛らわしい型の報告。 */
export interface TypeStyles {
  readonly colors: Map<NodeTypeId, string>;
  readonly shapes: Map<NodeTypeId, NodeShape>;
  readonly invalid: InvalidTypeColor[];
  readonly collisions: TypeCollision[];
}

/**
 * ノード型ごとの色と形をまとめて決め、紛らわしい型を報告する（D-23）。
 *
 * 計算量: 型の数を t として O(t)。
 *
 * @param nodeTypes - ノード型の一覧
 * @param shapeSetting - 形の設定
 * @returns 色、形、不正な色、紛らわしい型
 */
export function typeStyles(
  nodeTypes: readonly NodeType[],
  shapeSetting: NodeShapeEncoding,
): TypeStyles {
  const { colors, invalid } = typeColors(nodeTypes);
  const shapes = typeShapes(nodeTypes, shapeSetting);
  const collisions: TypeCollision[] = [];
  const seenStyles = new Set<string>();
  const colorUsers = new Map<string, number>();
  for (const c of colors.values()) colorUsers.set(c, (colorUsers.get(c) ?? 0) + 1);
  for (const t of nodeTypes) {
    const color = colors.get(t.id) ?? OTHER_COLOR;
    const shape = shapes.get(t.id) ?? 'circle';
    const userColor = normalizeColor(t.color);
    if (userColor === null && color === OTHER_COLOR)
      collisions.push({ typeId: t.id, reason: 'gray' });
    const style = `${color}/${shape}`;
    if (seenStyles.has(style)) collisions.push({ typeId: t.id, reason: 'same-style' });
    seenStyles.add(style);
    if (userColor !== null && (colorUsers.get(color) ?? 0) > 1)
      collisions.push({ typeId: t.id, reason: 'user-color-overlap' });
  }
  return { colors, shapes, invalid, collisions };
}
