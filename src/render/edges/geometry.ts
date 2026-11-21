/** 有向エッジの幾何（FR-VG-05〜07、設計§8.3）。DOM は使わない。 */
import type { PathCommand, SceneNode } from '../scene/types';

/** 有向エッジの表し方。既定は arrow。 */
export type DirectedEdgeStyle = 'arrow' | 'taper' | 'gradient';
/** 図形の点。 */
export interface EdgePoint {
  readonly x: number;
  readonly y: number;
}
/** エッジを描くための形。 */
export interface EdgeGeometry {
  readonly path: readonly PathCommand[];
  readonly head?: readonly EdgePoint[];
  readonly ribbon?: readonly EdgePoint[];
  readonly gradient?: { readonly start: EdgePoint; readonly end: EdgePoint };
}
// 【TS】readonly は入力の点を変更しない約束。二次ベジェ曲線の3点をまとめる。
interface Quad {
  readonly a: EdgePoint;
  readonly c: EdgePoint;
  readonly b: EdgePoint;
}
const mix = (a: EdgePoint, b: EdgePoint, t: number): EdgePoint => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
const distance = (a: EdgePoint, b: EdgePoint): number => Math.hypot(b.x - a.x, b.y - a.y);
const point = (q: Quad, t: number): EdgePoint => mix(mix(q.a, q.c, t), mix(q.c, q.b, t), t);
function segment(q: Quad, a: number, b: number): Quad {
  const start = point(q, a);
  // de Casteljau と同値な、接線を使った部分曲線の制御点。O(1)。
  return {
    a: start,
    b: point(q, b),
    c: {
      x: start.x + (b - a) * ((1 - a) * (q.c.x - q.a.x) + a * (q.b.x - q.c.x)),
      y: start.y + (b - a) * ((1 - a) * (q.c.y - q.a.y) + a * (q.b.y - q.c.y)),
    },
  };
}
function boundary(q: Quad, center: EdgePoint, radius: number, leaving: boolean): number {
  let low = 0;
  let high = 1;
  // 40回で誤差はパラメータの 2^-40 以下。曲線は端点側の円を一度だけ横切る構成。
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    const inside = distance(point(q, mid), center) < radius;
    if (inside === leaving) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}
function pathOf(quads: readonly Quad[]): PathCommand[] {
  const first = quads[0];
  return first === undefined
    ? []
    : [
        { type: 'M', ...first.a },
        ...quads.map((q): PathCommand => {
          const cross = (q.c.x - q.a.x) * (q.b.y - q.a.y) - (q.c.y - q.a.y) * (q.b.x - q.a.x);
          return Math.abs(cross) < 1e-8
            ? { type: 'L', ...q.b }
            : { type: 'Q', cx: q.c.x, cy: q.c.y, ...q.b };
        }),
      ];
}

/**
 * ノード外接円の縁で切った、方向表現つきの経路を作る。
 * 直線も中点を制御点とする Q として計算し、同じ切断算法を使う。
 * 二次ベジェの部分曲線は de Casteljau（1959）の構成に基づく。固定回数計算のため O(1)。
 * @param source - 始点のノード
 * @param target - 終点のノード
 * @param sourceExtent - 始点の外接半径（線幅を含む）
 * @param targetExtent - 終点の外接半径（線幅を含む）
 * @param width - エッジの線幅
 * @param bend - 進行方向の右側への制御点のふくらみ。0 は直線
 * @param style - 無向なら undefined。有向なら3種類の方向表現
 * @returns 線、矢じり、先細りの帯、濃淡の基準点
 */
export function edgeGeometry(
  source: SceneNode,
  target: SceneNode,
  sourceExtent: number,
  targetExtent: number,
  width: number,
  bend: number,
  style?: DirectedEdgeStyle,
): EdgeGeometry {
  const d = distance(source, target);
  let quads: Quad[];
  if (d <= sourceExtent + targetExtent + 1) {
    // 自己ループ・重なるノードは外側の輪。左右に別の接線を持たせ、方向を読めるようにする。
    const radius = Math.max(24, sourceExtent * 2, targetExtent * 2, width * 3);
    const side = source.id === target.id || source.id < target.id ? 1 : -1;
    const top = {
      x: (source.x + target.x) / 2,
      y:
        (side === 1 ? Math.min(source.y, target.y) : Math.max(source.y, target.y)) -
        side * (Math.max(sourceExtent, targetExtent) + radius * 2),
    };
    quads = [
      { a: source, c: { x: Math.min(source.x, target.x) - radius * 2, y: top.y }, b: top },
      { a: top, c: { x: Math.max(source.x, target.x) + radius * 2, y: top.y }, b: target },
    ];
  } else {
    const mid = mix(source, target, 0.5);
    quads = [
      {
        a: source,
        c: {
          x: mid.x - ((target.y - source.y) / d) * bend,
          y: mid.y + ((target.x - source.x) / d) * bend,
        },
        b: target,
      },
    ];
  }
  const first = quads[0];
  const last = quads[quads.length - 1];
  if (first === undefined || last === undefined) return { path: [] };
  const from = boundary(first, source, sourceExtent, true);
  const to = boundary(last, target, targetExtent, false);
  quads =
    quads.length === 1
      ? [segment(first, from, to)]
      : [segment(first, from, 1), segment(last, 0, to)];
  const start = quads[0]?.a;
  const finish = quads[quads.length - 1]?.b;
  if (start === undefined || finish === undefined) return { path: [] };
  const path = pathOf(quads);
  if (style === undefined || width === 0) return { path };
  if (style === 'gradient') return { path, gradient: { start, end: finish } };
  if (style === 'taper') {
    const samples: EdgePoint[] = [];
    for (const [j, q] of quads.entries())
      for (let i = j === 0 ? 0 : 1; i <= 32; i++) samples.push(point(q, i / 32));
    const left: EdgePoint[] = [];
    const right: EdgePoint[] = [];
    for (const [i, p] of samples.entries()) {
      const prev = samples[Math.max(0, i - 1)] ?? p;
      const next = samples[Math.min(samples.length - 1, i + 1)] ?? p;
      const length = distance(prev, next) || 1;
      const half = (width / 2) * (1 - i / (samples.length - 1));
      const nx = (-(next.y - prev.y) / length) * half;
      const ny = ((next.x - prev.x) / length) * half;
      left.push({ x: p.x + nx, y: p.y + ny });
      right.push({ x: p.x - nx, y: p.y - ny });
    }
    return { path, ribbon: [...left, ...right.reverse()] };
  }
  const tail = quads[quads.length - 1];
  if (tail === undefined) return { path };
  const length = Math.min(Math.max(6, width * 3), distance(tail.a, tail.b) / 2);
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i++) {
    const t = (low + high) / 2;
    if (distance(point(tail, t), finish) > length) low = t;
    else high = t;
  }
  const cut = (low + high) / 2;
  const base = point(tail, cut);
  const norm = distance(base, finish) || 1;
  const half = Math.min(Math.max(3, width * 1.5), length * 0.7);
  const nx = (-(finish.y - base.y) / norm) * half;
  const ny = ((finish.x - base.x) / norm) * half;
  const head = [finish, { x: base.x + nx, y: base.y + ny }, { x: base.x - nx, y: base.y - ny }];
  const shaft = [...quads.slice(0, -1), segment(tail, 0, cut)];
  return { path: pathOf(shaft), head };
}
