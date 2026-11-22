/** 再現可能なレイアウト（FR-VG-01、NFR-08、設計 §8.5）。 */
import iterate from 'graphology-layout-forceatlas2/iterate.js';
import type { ForceAtlas2Settings } from 'graphology-layout-forceatlas2';
import { fromSnapshot, type GraphSnapshot } from '../graph';
import { toNodeId, type NodeId } from '../model';

/** 保存できる座標とピン留め。特殊な ID も保てるよう配列で持つ。 */
export interface LayoutPosition {
  readonly id: NodeId;
  readonly x: number;
  readonly y: number;
  readonly fixed: boolean;
}
/** レイアウトの方式。 */
export type LayoutKind = 'forceatlas2' | 'circular' | 'fixed';
/** 保存・Worker 転送できる設定。seed は符号なし 32 ビット整数。 */
export interface LayoutOptions {
  readonly kind: LayoutKind;
  readonly seed: number;
  readonly positions?: readonly LayoutPosition[];
  readonly settings?: ForceAtlas2Settings;
}
/** Worker への初回の依頼。 */
export interface LayoutJob {
  readonly snapshot: GraphSnapshot;
  readonly options: LayoutOptions;
}
/** 計算途中でも保存できる結果。座標と種を同じ結果に含める。 */
export interface LayoutResult {
  readonly kind: LayoutKind;
  readonly seed: number;
  readonly iterations: number;
  readonly positions: readonly LayoutPosition[];
}
/** Worker 内で保持する計算。途中結果は step の返り値で受け取る。 */
export interface LayoutSession {
  step(iterations: number): LayoutResult;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * グラフと保存した設定から、反復を続けられる計算を作る。
 *
 * 手順: (1) 型と ID の順に整列する。(2) seed から初期位置を作る。(3) FA2 の行列を作り、
 * step ごとに同じ行列を更新する。固定点は丸めを避け、返すとき元の座標を使う。
 * ForceAtlas2: Jacomy et al. (2014), ForceAtlas2, a Continuous Graph Layout Algorithm.
 * 円形は O(V log V)、FA2 は反復ごとに O(V² + E)、Barnes-Hut 有効時は通常 O(V log V + E)。
 * @param job - スナップショットと設定
 * @returns step(n) で続きを計算できるセッション
 */
export function createLayoutSession(job: LayoutJob): LayoutSession {
  const { options } = job;
  const { kind, seed } = options;
  if (!['forceatlas2', 'circular', 'fixed'].includes(kind))
    throw new RangeError('未対応のレイアウトです。');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError('seed は 0〜2^32-1 の整数です。');
  const graph = fromSnapshot(job.snapshot);
  const ids = graph
    .nodes()
    .sort(
      (a, b) =>
        compare(graph.getNodeAttribute(a, 'type'), graph.getNodeAttribute(b, 'type')) ||
        compare(a, b),
    );
  const positions = new Map<string, LayoutPosition>();
  for (const position of options.positions ?? []) {
    if (positions.has(position.id)) throw new RangeError('座標の ID が重複しています。');
    if (
      ![position.x, position.y].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e9) ||
      typeof position.fixed !== 'boolean'
    )
      throw new RangeError('座標は有限で絶対値 10^9 以下にしてください。');
    positions.set(position.id, position);
  }
  let randomState = seed;
  // Mulberry32 (Tommy Ettinger, 2017)。整数演算でブラウザ間の初期配置を一致させる。
  const random = (): number => {
    randomState = (randomState + 0x6d2b79f5) | 0;
    let t = randomState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 【TS】Required<T> は任意の設定にも必ず値を持つことを表す。反復関数は省略を補わない。
  const settings: Required<ForceAtlas2Settings> = {
    linLogMode: false,
    outboundAttractionDistribution: false,
    adjustSizes: false,
    edgeWeightInfluence: 1,
    scalingRatio: 10,
    strongGravityMode: true,
    gravity: 0.05,
    slowDown: 1 + Math.log(Math.max(1, ids.length)),
    barnesHutOptimize: ids.length > 2000,
    barnesHutTheta: 0.5,
    ...options.settings,
  };
  for (const [key, value] of Object.entries(settings)) {
    if (
      [
        'linLogMode',
        'outboundAttractionDistribution',
        'adjustSizes',
        'strongGravityMode',
        'barnesHutOptimize',
      ].includes(key)
    ) {
      if (typeof value !== 'boolean') throw new RangeError('設定 ' + key + ' は真偽値です。');
    } else if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      ((key === 'slowDown' || key === 'barnesHutTheta') && value === 0)
    )
      throw new RangeError('設定 ' + key + ' が不正です。');
  }
  const nodeMatrix = new Float32Array(ids.length * 10);
  const indices = new Map<string, number>();
  const initial: LayoutPosition[] = ids.map((id, index) => {
    const saved = positions.get(id);
    if (kind === 'fixed' && saved === undefined)
      throw new RangeError('固定位置がありません: ' + id);
    const angle = (2 * Math.PI * index) / Math.max(1, ids.length);
    const radius = 10 * Math.sqrt(Math.max(1, ids.length));
    const x =
      saved !== undefined && (kind !== 'circular' || saved.fixed)
        ? saved.x
        : kind === 'circular'
          ? radius * Math.cos(angle)
          : radius * (random() - 0.5);
    const y =
      saved !== undefined && (kind !== 'circular' || saved.fixed)
        ? saved.y
        : kind === 'circular'
          ? radius * Math.sin(angle)
          : radius * (random() - 0.5);
    const fixed = kind === 'fixed' || (saved?.fixed ?? false);
    const offset = index * 10;
    indices.set(id, offset);
    // ライブラリ 0.10.1 の列: x,y,dx,dy,old_dx,old_dy,mass,convergence,size,fixed。
    nodeMatrix.set([x, y, 0, 0, 0, 0, 1, 1, 1, fixed ? 1 : 0], offset);
    return { id: toNodeId(id), x, y, fixed };
  });
  const edgeMatrix = new Float32Array(graph.size * 3);
  graph
    .edges()
    .sort(compare)
    .forEach((edge, index) => {
      const source = indices.get(graph.source(edge));
      const target = indices.get(graph.target(edge));
      if (source === undefined || target === undefined)
        throw new RangeError('エッジの端点がありません。');
      const weight = graph.getEdgeAttribute(edge, 'weight');
      if (!Number.isFinite(weight) || weight < 0 || weight > 1e9)
        throw new RangeError('レイアウトの重みが不正です。');
      nodeMatrix[source + 6] = (nodeMatrix[source + 6] ?? 1) + weight;
      nodeMatrix[target + 6] = (nodeMatrix[target + 6] ?? 1) + weight;
      edgeMatrix.set([source, target, weight], index * 3);
    });
  let total = 0;
  return {
    step(iterations) {
      if (!Number.isInteger(iterations) || iterations < 0 || iterations > 10000)
        throw new RangeError('反復回数は 0〜10000 の整数です。');
      if (kind === 'forceatlas2' && ids.length > 0) {
        for (let i = 0; i < iterations; i++) iterate(settings, nodeMatrix, edgeMatrix);
        total += iterations;
      }
      const result = initial.map((position, i) => {
        if (kind !== 'forceatlas2' || position.fixed) return { ...position };
        const x = nodeMatrix[i * 10];
        const y = nodeMatrix[i * 10 + 1];
        if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y))
          throw new RangeError('レイアウトが発散しました。設定や固定位置を確認してください。');
        return { ...position, x, y };
      });
      return { kind: kind, seed: seed, iterations: total, positions: result };
    },
  };
}
