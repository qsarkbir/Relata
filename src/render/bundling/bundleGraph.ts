/**
 * 束ねた後の折れ線を「束の区間」にまとめ、束ごとの重みの合計を求める（FR-VG-14、FR-VG-13、設計書 §8.4）。
 *
 * 【用語】束ねた後の各エッジは、点 0..n の折れ線。区間 k は点 k と点 k+1 の間。近くにあって
 * 同じ向きの区間どうしを 1 つの「束の区間」（以下、束。bundle）にまとめ、束を通るエッジの重みの
 * 合計 W を持たせる。太さ = スケール関数(W)（既定は平方根。D-08）は描画側が当てるので、ここでは W まで。
 *
 * 出典: 束の区間を「近い区間のまとめ」として扱う考え方は設計書 §8.4 の「束の太さ」による。
 * 近傍探索は一様格子（空間ハッシュ。Samet, H. (1990) "The Design and Analysis of Spatial Data
 * Structures", Addison-Wesley）、まとめ方は先着順の代表点クラスタリング（leader clustering。
 * Hartigan, J. A. (1975) "Clustering Algorithms", Wiley）。
 *
 * 【規約】
 * - 近さの基準 ε は「データの座標」で持つ。束ねた結果（座標）がズームに依らないので、束もズームに依らない。
 *   既定は、束ねた対象の入口と出口の距離の平均に対する割合 {@link DEFAULT_EPSILON_RATIO}。
 *   `epsilon` を渡せば絶対値で指定できる。
 * - 「近い」= 区間の中点どうしの距離が ε 以下。「同じ向き」= 区間の単位接線の内積が minCosine 以上。
 * - 有向のエッジの区間は、進行方向が逆向き（内積が -minCosine 以下）の区間とはまとめない。逆向きの束は
 *   別の束になり、位置が重なるものを `opposites` で互いに指す。描画はこれを見て、進行方向の右へ px で
 *   ずらす（D-55 の補足）。ずらし幅はデータの座標で持たない（ズームで束ね直さない規則のため）。
 * - 無向のエッジは向きを問わず（内積の絶対値が minCosine 以上なら）1 つにまとめる。
 * - 有向と無向が重なるとき: 先に有向だけで束を作り、後から無向の区間を、近くて平行な最も近い束に加える
 *   （有向の束があればそこへ。逆向きの 2 つの束が候補なら、距離の近い方）。無向だけの束は
 *   `directed = 0` で、向きを持たないので opposites にも現れない。【なぜ】無向を先に作ると束の向きが
 *   不定になり、有向の区間が内積の符号で別の束に割れてしまうため。
 * - 自己ループ・長さ 0 の区間・長さ 0 のエッジ（束ねられなかったもの）は、向きが定まらないので束に入れず、
 *   区間の束 id を -1 にする。重みの合計にも入らない（描画は -1 の区間を自分の重みの太さで描く）。
 * - 多重エッジ（ID が違い座標が同じ）は別のエッジで、同じ束に入り W に両方の重みが足される。
 * - 同じエッジが自分の隣り合う区間で同じ束に入ることがある（細かい折れ線）。そのときも、そのエッジの
 *   重みは束の W に 1 回だけ足す。
 * - 重み: 欠損（入力にない）・負・有限でない（NaN、±Infinity）は 0 として数え、件数を
 *   `invalidWeightCount` に返す。孤立ノードはエッジを持たないのでここには現れない。
 * - 決定的: エッジを ID の昇順（コード単位）で処理し、入力の順に依らない。乱数も Date も使わない（NFR-08）。
 * - DOM、Worker の型に触れない。結果は typed array、Map、文字列だけで、structured clone で送れる。
 *
 * 計算量: 区間の総数を S（= Σ(点の数 - 1)）、束の数を B とする。区間ごとに、ε の幅の格子の 3×3 マスに
 * ある代表点だけを比べるので、期待 O(S)（1 マスの代表点数に比例。ε が大きすぎ代表点が 1 マスに
 * 集中する最悪は O(S·B)）。逆向きの検出は 2ε の格子で O(B)。重みの合計は O(S)。
 * 部分集合の再計算 {@link weightsFor} は O(見えるエッジの区間数 + B)。
 */
import type { BundledPath, BundleEdge } from './settings';

/** ε の既定: 束ねた対象の「入口と出口の距離」の平均に対する割合。 */
// 【なぜ】0.01。区間 1 つの長さ（平均 ÷ 2^cycles = 約 0.03）より小さく、束ねた後の平行線の間隔
//   （束ねる強さ 0.85 で、平均の 0.5% 程度）をまとめられる大きさ。実データの束ねた結果で調整できる。
export const DEFAULT_EPSILON_RATIO = 0.01;
/** 向きの許容の既定: 単位接線の内積 cos θ の下限（0.5 = 60 度まで同じ向きとみなす）。 */
export const DEFAULT_MIN_COSINE = 0.5;

/** 束の区間のまとめ方の設定。 */
export interface BundleGraphOptions {
  /** ε（データの座標での距離）。指定すると `epsilonRatio` より優先する。0 より大きい有限の数。 */
  readonly epsilon?: number;
  /** ε を平均の長さに対する割合で決める（既定 {@link DEFAULT_EPSILON_RATIO}）。 */
  readonly epsilonRatio?: number;
  /** 同じ向きとみなす内積の下限（0〜1。既定 {@link DEFAULT_MIN_COSINE}）。 */
  readonly minCosine?: number;
}

/**
 * 束の区間のグラフ。束の番号は 0 以上 bundleCount 未満の整数（作った順。決定的）。
 *
 * 【なぜ typed array か】5,000 本 × 32 区間 = 16 万の区間があり、オブジェクトにすると Worker からの
 * 送信（structured clone）とメモリが重い。使うときは下の関数（{@link segmentBundlesOf} など）を通す。
 */
export interface BundleGraph {
  /** 実際に使った ε（データの座標）。 */
  readonly epsilon: number;
  /** 実際に使った内積の下限。 */
  readonly minCosine: number;
  /** 区間のあるエッジの ID。昇順（コード単位）。以下の「エッジ番号」はこの配列の添字。 */
  readonly edgeIds: readonly string[];
  /** エッジ ID → エッジ番号。 */
  readonly edgeIndex: ReadonlyMap<string, number>;
  /** エッジごとの重み（欠損・負・有限でないは 0 にしたもの）。 */
  readonly edgeWeights: Float64Array;
  /** 重みが欠損・負・有限でなかったエッジの数（0 として数えた）。 */
  readonly invalidWeightCount: number;
  /** エッジ e の区間は segmentBundle[segmentStart[e] .. segmentStart[e+1]) 。長さ edgeIds.length + 1。 */
  readonly segmentStart: Uint32Array;
  /** 区間ごとの束の番号（エッジ番号の順、区間 k の順）。束に入らない区間は -1。 */
  readonly segmentBundle: Int32Array;
  /** 束の数。 */
  readonly bundleCount: number;
  /** 束ごとの、通るエッジの重みの合計 W。長さ bundleCount。 */
  readonly weight: Float64Array;
  /** 束ごとに 1 = 有向のエッジを 1 本以上含む（向きを持つ）、0 = 無向だけ。 */
  readonly directed: Uint8Array;
  /** 束 b を通るエッジ番号は members[memberStart[b] .. memberStart[b+1]) （昇順、重複なし）。 */
  readonly memberStart: Uint32Array;
  /** {@link BundleGraph.memberStart} が指すエッジ番号。 */
  readonly members: Uint32Array;
  /** 束 → 位置が重なる逆向きの束の番号（昇順）。無いものは載らない。対称（a が b を指せば b も a を指す）。 */
  readonly opposites: ReadonlyMap<number, readonly number[]>;
}

// 単位接線を求める。長さ 0 なら null。【なぜ】Math.hypot は処理系で値が違いうるので平方根を使う（NFR-08）。
function unitTangent(
  points: readonly number[],
  k: number,
): { readonly tx: number; readonly ty: number } | null {
  const dx = (points[2 * k + 2] ?? NaN) - (points[2 * k] ?? NaN);
  const dy = (points[2 * k + 3] ?? NaN) - (points[2 * k + 1] ?? NaN);
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 0)) return null;
  return { tx: dx / len, ty: dy / len };
}

function compareId(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// 格子のマス番号を 1 つの整数キーにする。±2^25 の範囲で、キーは 2^52 未満に収まる。
const CELL_LIMIT = 2 ** 25;
function cellKey(ix: number, iy: number): number {
  return (ix + CELL_LIMIT) * 2 ** 26 + (iy + CELL_LIMIT);
}

/**
 * 束ねた折れ線を束の区間にまとめ、重みの合計を求める。
 *
 * @param paths - {@link bundleEdges} の結果の折れ線（点の数は 2 以上。順序は問わない）
 * @param edges - 重みを引くエッジ。`id` と `weight` だけを使う（BundleEdge の配列をそのまま渡せる）。
 *   paths にあって edges にない ID の重みは欠損として 0
 * @param options - ε などの設定
 * @returns 束の区間のグラフ
 * @throws RangeError ID の重複、設定が範囲外、ε が小さすぎて格子の番号が溢れるとき
 * @example
 * const { paths } = bundleEdges(edges);
 * const g = buildBundleGraph(paths, edges);
 * const w = g.weight[g.segmentBundle[g.segmentStart[0] ?? 0] ?? 0]; // 最初のエッジの区間 0 の束の W
 */
export function buildBundleGraph(
  paths: readonly BundledPath[],
  edges: readonly Pick<BundleEdge, 'id' | 'weight'>[],
  options: BundleGraphOptions = {},
): BundleGraph {
  const minCosine = options.minCosine ?? DEFAULT_MIN_COSINE;
  if (!(minCosine >= 0 && minCosine <= 1)) {
    throw new RangeError(
      `minCosine は 0〜1 にしてください（受け取った値: ${String(minCosine)}）。`,
    );
  }
  const ratio = options.epsilonRatio ?? DEFAULT_EPSILON_RATIO;
  if (!(Number.isFinite(ratio) && ratio > 0)) {
    throw new RangeError(
      `epsilonRatio は 0 より大きい有限の数にしてください（${String(ratio)}）。`,
    );
  }
  if (options.epsilon !== undefined && !(Number.isFinite(options.epsilon) && options.epsilon > 0)) {
    throw new RangeError(
      `epsilon は 0 より大きい有限の数にしてください（${String(options.epsilon)}）。`,
    );
  }

  // 1. ID の昇順に並べる（入力の順に依らない）。 O(E log E)
  const sorted = [...paths].sort(compareId);
  const edgeCount = sorted.length;
  const edgeIds = sorted.map((p) => p.id);
  const edgeIndex = new Map<string, number>();
  edgeIds.forEach((id, i) => {
    if (edgeIndex.has(id)) throw new RangeError(`エッジ ID ${id} が重複しています。`);
    edgeIndex.set(id, i);
  });

  // 2. 重みを整える。欠損・負・有限でないは 0。
  const rawWeight = new Map<string, number>();
  for (const e of edges) rawWeight.set(e.id, e.weight);
  const edgeWeights = new Float64Array(edgeCount);
  let invalidWeightCount = 0;
  for (let i = 0; i < edgeCount; i++) {
    const w = rawWeight.get(edgeIds[i] ?? '');
    if (w !== undefined && Number.isFinite(w) && w >= 0) edgeWeights[i] = w;
    else invalidWeightCount++;
  }

  // 3. 区間の中点と単位接線を作る（区間は点の数 - 1 個）。
  const segmentStart = new Uint32Array(edgeCount + 1);
  for (let i = 0; i < edgeCount; i++) {
    const n = (sorted[i]?.points.length ?? 0) / 2;
    segmentStart[i + 1] = (segmentStart[i] ?? 0) + Math.max(0, n - 1);
  }
  const segTotal = segmentStart[edgeCount] ?? 0;
  const mx = new Float64Array(segTotal);
  const my = new Float64Array(segTotal);
  const tx = new Float64Array(segTotal);
  const ty = new Float64Array(segTotal);
  const valid = new Uint8Array(segTotal);
  let chordSum = 0;
  let chordCount = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < edgeCount; i++) {
    const p = sorted[i];
    if (p === undefined) continue;
    const pts = p.points;
    const base = segmentStart[i] ?? 0;
    for (let k = 0; k < (segmentStart[i + 1] ?? 0) - base; k++) {
      const t = unitTangent(pts, k);
      if (t === null) continue;
      const s = base + k;
      valid[s] = 1;
      tx[s] = t.tx;
      ty[s] = t.ty;
      const x = ((pts[2 * k] ?? 0) + (pts[2 * k + 2] ?? 0)) / 2;
      const y = ((pts[2 * k + 1] ?? 0) + (pts[2 * k + 3] ?? 0)) / 2;
      mx[s] = x;
      my[s] = y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    if (p.bundled) {
      // 平均の長さは、束ねた対象の入口と出口の距離で測る（折れ線の長さは束ね方で伸びるため）。
      const n = pts.length;
      const dx = (pts[n - 2] ?? 0) - (pts[0] ?? 0);
      const dy = (pts[n - 1] ?? 0) - (pts[1] ?? 0);
      chordSum += Math.sqrt(dx * dx + dy * dy);
      chordCount++;
    }
  }

  // 4. ε を決める。束ねた対象が無く平均の長さが測れないときは、指定が無ければ 0 とし、何もまとめない。
  const epsilon = options.epsilon ?? (chordCount > 0 ? (chordSum / chordCount) * ratio : 0);
  const segmentBundle = new Int32Array(segTotal).fill(-1);

  const leaderSeg: number[] = []; // 束の代表の区間番号
  const leaderDirected: number[] = []; // 1 = 有向の代表
  const memberLists: number[][] = [];

  if (epsilon > 0 && segTotal > 0 && Number.isFinite(minX)) {
    const span = Math.max(maxX - minX, maxY - minY);
    if (span / epsilon >= CELL_LIMIT * 0.9) {
      throw new RangeError('ε が座標の範囲に比べて小さすぎます（格子の番号が溢れます）。');
    }
    const eps2 = epsilon * epsilon;
    const cellOf = (v: number, min: number): number => Math.floor((v - min) / epsilon);
    const grid = new Map<number, number[]>(); // マス → 代表の束の番号

    // 区間 s を束に振り分ける。先着順の代表点クラスタリング。 1 区間あたり 3×3 マスの代表点を比べる。
    // 有向の区間は有向の束だけに入る（先に有向を処理するので、この時点の束は全部有向）。
    // 無向の区間は、有向・無向のどの束にも入れる。
    const assign = (s: number, edgeNo: number, isDirected: boolean): void => {
      const ix = cellOf(mx[s] ?? 0, minX);
      const iy = cellOf(my[s] ?? 0, minY);
      let best = -1;
      let bestD2 = Infinity;
      for (let gx = ix - 1; gx <= ix + 1; gx++) {
        for (let gy = iy - 1; gy <= iy + 1; gy++) {
          const cell = grid.get(cellKey(gx, gy));
          if (cell === undefined) continue;
          for (const b of cell) {
            const l = leaderSeg[b] ?? 0;
            const dx = (mx[l] ?? 0) - (mx[s] ?? 0);
            const dy = (my[l] ?? 0) - (my[s] ?? 0);
            const d2 = dx * dx + dy * dy;
            if (d2 > eps2) continue;
            const dot = (tx[l] ?? 0) * (tx[s] ?? 0) + (ty[l] ?? 0) * (ty[s] ?? 0);
            // 有向: 同じ向き（内積 ≥ minCosine）だけ。無向: 向きを問わない（|内積| ≥ minCosine）。
            const ok = isDirected ? dot >= minCosine : Math.abs(dot) >= minCosine;
            if (!ok) continue;
            if (d2 < bestD2 || (d2 === bestD2 && b < best)) {
              best = b;
              bestD2 = d2;
            }
          }
        }
      }
      if (best < 0) {
        best = leaderSeg.length;
        leaderSeg.push(s);
        leaderDirected.push(isDirected ? 1 : 0);
        memberLists.push([]);
        const key = cellKey(ix, iy);
        const cell = grid.get(key);
        if (cell === undefined) grid.set(key, [best]);
        else cell.push(best);
      }
      segmentBundle[s] = best;
      const list = memberLists[best];
      // 同じエッジが同じ束に何度入っても、メンバーには 1 回だけ（W に重みを 1 回だけ足すため）。
      if (list !== undefined && list[list.length - 1] !== edgeNo) list.push(edgeNo);
      if (isDirected) leaderDirected[best] = 1;
    };

    // 5. 有向のエッジを先に、次に無向のエッジを振り分ける（上の規約）。ID の昇順なので決定的。
    for (const pass of [true, false]) {
      for (let i = 0; i < edgeCount; i++) {
        if (sorted[i]?.directed !== pass) continue;
        const from = segmentStart[i] ?? 0;
        const to = segmentStart[i + 1] ?? 0;
        for (let s = from; s < to; s++) if (valid[s] === 1) assign(s, i, pass);
      }
    }
  }

  // 6. 束ごとのメンバー（昇順）と重みの合計。無向を後から足した束は、メンバーが昇順でないので整える。
  const bundleCount = leaderSeg.length;
  const memberStart = new Uint32Array(bundleCount + 1);
  const weight = new Float64Array(bundleCount);
  const directed = new Uint8Array(bundleCount);
  for (let b = 0; b < bundleCount; b++) {
    const list = [...new Set(memberLists[b] ?? [])].sort((a, c) => a - c);
    memberLists[b] = list;
    memberStart[b + 1] = (memberStart[b] ?? 0) + list.length;
    let w = 0;
    for (const e of list) w += edgeWeights[e] ?? 0;
    weight[b] = w;
    directed[b] = leaderDirected[b] ?? 0;
  }
  const members = new Uint32Array(memberStart[bundleCount] ?? 0);
  for (let b = 0; b < bundleCount; b++) members.set(memberLists[b] ?? [], memberStart[b] ?? 0);

  // 7. 重なる逆向きの束。代表点が 2ε 以内（束の中の区間は代表から ε 以内なので、重なる束の代表は 2ε 以内に
  //    あるとみなす）で、接線が逆向き（内積 ≤ -minCosine）の有向の束の組。 O(B)
  const opposites = findOpposites(
    leaderSeg,
    leaderDirected,
    mx,
    my,
    tx,
    ty,
    epsilon,
    minCosine,
    minX,
    minY,
  );

  return {
    epsilon,
    minCosine,
    edgeIds,
    edgeIndex,
    edgeWeights,
    invalidWeightCount,
    segmentStart,
    segmentBundle,
    bundleCount,
    weight,
    directed,
    memberStart,
    members,
    opposites,
  };
}

// 逆向きの束の組を探す。2ε の格子で 3×3 マスだけを見る。
function findOpposites(
  leaderSeg: readonly number[],
  leaderDirected: readonly number[],
  mx: Float64Array,
  my: Float64Array,
  tx: Float64Array,
  ty: Float64Array,
  epsilon: number,
  minCosine: number,
  minX: number,
  minY: number,
): ReadonlyMap<number, readonly number[]> {
  const result = new Map<number, number[]>();
  if (!(epsilon > 0)) return result;
  const cell = 2 * epsilon;
  const r2 = cell * cell;
  const grid = new Map<number, number[]>();
  const coords: { ix: number; iy: number }[] = [];
  for (let b = 0; b < leaderSeg.length; b++) {
    if (leaderDirected[b] !== 1) {
      coords.push({ ix: 0, iy: 0 });
      continue;
    }
    const l = leaderSeg[b] ?? 0;
    const ix = Math.floor(((mx[l] ?? 0) - minX) / cell);
    const iy = Math.floor(((my[l] ?? 0) - minY) / cell);
    coords.push({ ix, iy });
    const key = cellKey(ix, iy);
    const list = grid.get(key);
    if (list === undefined) grid.set(key, [b]);
    else list.push(b);
  }
  for (let b = 0; b < leaderSeg.length; b++) {
    if (leaderDirected[b] !== 1) continue;
    const l = leaderSeg[b] ?? 0;
    const { ix, iy } = coords[b] ?? { ix: 0, iy: 0 };
    for (let gx = ix - 1; gx <= ix + 1; gx++) {
      for (let gy = iy - 1; gy <= iy + 1; gy++) {
        for (const c of grid.get(cellKey(gx, gy)) ?? []) {
          if (c <= b) continue; // 組は b < c の側だけで調べ、両方向に登録する
          const m = leaderSeg[c] ?? 0;
          const dx = (mx[m] ?? 0) - (mx[l] ?? 0);
          const dy = (my[m] ?? 0) - (my[l] ?? 0);
          if (dx * dx + dy * dy > r2) continue;
          const dot = (tx[l] ?? 0) * (tx[m] ?? 0) + (ty[l] ?? 0) * (ty[m] ?? 0);
          if (dot > -minCosine) continue;
          for (const [from, to] of [
            [b, c],
            [c, b],
          ] as const) {
            const list = result.get(from);
            if (list === undefined) result.set(from, [to]);
            else list.push(to);
          }
        }
      }
    }
  }
  for (const list of result.values()) list.sort((a, c) => a - c);
  return result;
}

/**
 * エッジ 1 本の、区間ごとの束の番号を返す（束に入らない区間は -1）。
 *
 * @param graph - 束の区間のグラフ
 * @param edgeId - エッジの ID
 * @returns 区間 0, 1, … の束の番号。ID が無ければ空の配列
 */
export function segmentBundlesOf(graph: BundleGraph, edgeId: string): Int32Array {
  const e = graph.edgeIndex.get(edgeId);
  if (e === undefined) return new Int32Array(0);
  return graph.segmentBundle.subarray(graph.segmentStart[e] ?? 0, graph.segmentStart[e + 1] ?? 0);
}

/**
 * 束を通るエッジの ID を昇順で返す。
 *
 * @param graph - 束の区間のグラフ
 * @param bundle - 束の番号
 * @returns エッジ ID の配列（範囲外の番号は空）
 */
export function bundleEdgeIds(graph: BundleGraph, bundle: number): string[] {
  if (!(bundle >= 0 && bundle < graph.bundleCount)) return [];
  const out: string[] = [];
  for (let i = graph.memberStart[bundle] ?? 0; i < (graph.memberStart[bundle + 1] ?? 0); i++) {
    out.push(graph.edgeIds[graph.members[i] ?? 0] ?? '');
  }
  return out;
}

/**
 * 束と位置が重なる逆向きの束の番号を返す。
 *
 * @param graph - 束の区間のグラフ
 * @param bundle - 束の番号
 * @returns 昇順の番号。無ければ空の配列（描画は、空でなければ進行方向の右へずらす）
 */
export function oppositesOf(graph: BundleGraph, bundle: number): readonly number[] {
  return graph.opposites.get(bundle) ?? [];
}

/**
 * 見えているエッジだけで、束ごとの重みの合計 W を出し直す（再生。D-56、T3-05）。
 *
 * 束ねた結果と束の区間は変えず、W だけを速く計算する。同じエッジが同じ束に複数の区間で入っても 1 回だけ数える。
 *
 * @param graph - 束の区間のグラフ
 * @param visibleEdgeIds - 見えているエッジの ID（グラフにない ID は無視する）
 * @returns 長さ bundleCount の W。見えているエッジが通らない束は 0
 * @example
 * const w = weightsFor(graph, new Set(['e1', 'e7']));
 */
export function weightsFor(graph: BundleGraph, visibleEdgeIds: Iterable<string>): Float64Array {
  const w = new Float64Array(graph.bundleCount);
  const stamp = new Int32Array(graph.bundleCount).fill(-1); // 束ごとに「最後に足したエッジ番号」
  // 【なぜ】エッジ番号の昇順に足す。buildBundleGraph の W と同じ足し算の順になり、全部見えるときは完全に一致する。
  const visible = new Set<number>();
  for (const id of visibleEdgeIds) {
    const e = graph.edgeIndex.get(id);
    if (e !== undefined) visible.add(e);
  }
  for (const e of [...visible].sort((a, c) => a - c)) {
    const weightOfEdge = graph.edgeWeights[e] ?? 0;
    for (let s = graph.segmentStart[e] ?? 0; s < (graph.segmentStart[e + 1] ?? 0); s++) {
      const b = graph.segmentBundle[s] ?? -1;
      if (b < 0 || stamp[b] === e) continue;
      stamp[b] = e;
      w[b] = (w[b] ?? 0) + weightOfEdge;
    }
  }
  return w;
}
