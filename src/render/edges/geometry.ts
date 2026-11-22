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
  /** 矢じりが縮む場合の幹の実描画幅。省略時は要求した線幅を使う。 */
  readonly shaftWidth?: number;
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
    // 近接していても、位置が違えば進行方向の法線を使う。
    // 【なぜ】向きが定まらない同一座標だけは、IDの辞書順で再現可能な上下を補う。
    const radius = Math.max(24, sourceExtent * 2, targetExtent * 2, width * 3, Math.abs(bend));
    const ux = d > 1e-9 ? (target.x - source.x) / d : source.id <= target.id ? -1 : 1;
    const uy = d > 1e-9 ? (target.y - source.y) / d : 0;
    const turn = bend < 0 ? -1 : 1;
    const canonical = source.id <= target.id ? 1 : -1;
    // 有向は法線方向、無向は直交する軸方向に輪を作り、混在時の3本を分ける。
    const away =
      style === undefined
        ? { x: d > 1e-9 ? ux * canonical : 1, y: d > 1e-9 ? uy * canonical : 0 }
        : { x: -uy * turn, y: ux * turn };
    // 有向の制御点は進行方向の後方/前方へ広げる。法線から回転すると
    // 向きによって両脚が内側へ向かい、ノード外で8字に交差するため。
    const across = style === undefined ? { x: -away.y, y: away.x } : { x: ux, y: uy };
    const offset = Math.max(sourceExtent, targetExtent) + radius * 2;
    const top = {
      x: (source.x + target.x) / 2 + away.x * offset,
      y: (source.y + target.y) / 2 + away.y * offset,
    };
    quads = [
      {
        a: source,
        c: {
          x: source.x + away.x * offset - across.x * radius * 2,
          y: source.y + away.y * offset - across.y * radius * 2,
        },
        b: top,
      },
      {
        a: top,
        c: {
          x: target.x + away.x * offset + across.x * radius * 2,
          y: target.y + away.y * offset + across.y * radius * 2,
        },
        b: target,
      },
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
    let totalLength = 0;
    for (let i = 1; i < samples.length; i++) {
      const previous = samples[i - 1];
      const current = samples[i];
      if (previous !== undefined && current !== undefined)
        totalLength += distance(previous, current);
    }
    // 二次曲線の曲率半径R=|q'|³/|q'×q''|。分母は一定なので、速度が最小のtでRも最小。
    // 中点だけの経験則でなく、極短・強く曲がる弧でもオフセットが曲率半径を超えない幅にする。
    let minimumRadius = Infinity;
    for (const q of quads) {
      const vx = q.c.x - q.a.x;
      const vy = q.c.y - q.a.y;
      const ax = q.b.x - 2 * q.c.x + q.a.x;
      const ay = q.b.y - 2 * q.c.y + q.a.y;
      const acceleration = ax * ax + ay * ay;
      const cross = Math.abs(vx * ay - vy * ax);
      if (cross > 1e-12 && acceleration > 0) {
        const t = Math.max(0, Math.min(1, -(vx * ax + vy * ay) / acceleration));
        const radius = (2 * Math.hypot(vx + t * ax, vy + t * ay) ** 3) / cross;
        minimumRadius = Math.min(minimumRadius, radius);
      }
    }
    const endpointsDistance = distance(start, finish);
    const maximumHalf = Math.min(
      width / 2,
      totalLength / 4,
      minimumRadius * 0.45,
      endpointsDistance > 1e-9 ? endpointsDistance / 4 : Infinity,
    );
    const left: EdgePoint[] = [];
    const right: EdgePoint[] = [];
    for (const [i, p] of samples.entries()) {
      const prev = samples[Math.max(0, i - 1)] ?? p;
      const next = samples[Math.min(samples.length - 1, i + 1)] ?? p;
      const length = distance(prev, next) || 1;
      const half = maximumHalf * (1 - i / (samples.length - 1));
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
  // 【なぜ】短い経路で矢じりの底辺だけ縮んだとき、太い幹の角が左右へ出ないようにする。
  return { path: pathOf(shaft), head, shaftWidth: Math.min(width, half * 2) };
}
