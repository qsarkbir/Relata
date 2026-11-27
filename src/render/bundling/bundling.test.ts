import { describe, expect, it } from 'vitest';
import {
  BUNDLING_EDGE_WARNING_LIMIT,
  buildNeighborTable,
  bundleEdges,
  createBundlingSession,
  edgeCompatibility,
  exceedsBundlingLimit,
  findCompatiblePairs,
  findCompatiblePairsBruteForce,
  resolveBundlingSettings,
  type BundleEdge,
  type BundledPath,
} from './index';

// 固定の種の擬似乱数（Mulberry32）。テストの配置を毎回同じにする。
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function edge(
  id: string,
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  directed = false,
): BundleEdge {
  return { id, x1, y1, x2, y2, directed, weight: 1 };
}
function randomEdges(count: number, seed: number, size = 2000): BundleEdge[] {
  const r = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `e${String(i).padStart(5, '0')}`,
    x1: r() * size,
    y1: r() * size,
    x2: r() * size,
    y2: r() * size,
    directed: i % 2 === 0,
    weight: 1,
  }));
}
// 折れ線の中央の頂点の y。
function middleY(path: BundledPath): number {
  const mid = path.points.length / 4;
  return path.points[Math.floor(mid) * 2 + 1] ?? NaN;
}
function pathOf(paths: readonly BundledPath[], id: string): BundledPath {
  const found = paths.find((p) => p.id === id);
  if (found === undefined) throw new Error(`path ${id} がありません`);
  return found;
}
// 中心地へ集まる配置: 始点が 200×200、終点が 1000 先の 200×200 の範囲に散る。
function denseEdges(count: number, seed: number): BundleEdge[] {
  const r = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: `d${String(i).padStart(5, '0')}`,
    x1: r() * 200,
    y1: r() * 200,
    x2: 1000 + r() * 200,
    y2: r() * 200,
    directed: i % 2 === 0,
    weight: 1,
  }));
}
// 短くほぼ平行なエッジを広い範囲に置く配置（格子が本当に効く形）。
function wideShortEdges(count: number, seed: number): BundleEdge[] {
  const r = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const x = r() * 1500;
    const y = r() * 1500;
    return {
      id: `w${String(i).padStart(5, '0')}`,
      x1: x,
      y1: y,
      x2: x + 40 + r() * 20,
      y2: y + r() * 10,
      directed: false,
      weight: 1,
    };
  });
}
// 東向きにほぼ平行な、近いエッジ n 本（y が少しずつ違う）。
function parallelBundle(n: number, directed = false): BundleEdge[] {
  return Array.from({ length: n }, (_, i) =>
    edge(`p${String(i).padStart(2, '0')}`, [0, i * 8], [1000, i * 8 + 4], directed),
  );
}

describe('FR-VG-13: 互換度', () => {
  it('FR-VG-13: 同じエッジは 1、直交は 0、向きは関係しない', () => {
    const a = { x1: 0, y1: 0, x2: 100, y2: 0 };
    expect(edgeCompatibility(a, a)).toBeCloseTo(1, 12);
    expect(edgeCompatibility(a, { x1: 50, y1: -50, x2: 50, y2: 50 })).toBeCloseTo(0, 12);
    const reversed = { x1: 100, y1: 0, x2: 0, y2: 0 };
    expect(edgeCompatibility(a, reversed)).toBeCloseTo(1, 12);
  });
  it('FR-VG-13: 離れる・長さが違う・ずれて向き合わないほど小さい', () => {
    const a = { x1: 0, y1: 0, x2: 100, y2: 0 };
    const near = edgeCompatibility(a, { x1: 0, y1: 5, x2: 100, y2: 5 });
    const far = edgeCompatibility(a, { x1: 0, y1: 80, x2: 100, y2: 80 });
    const short = edgeCompatibility(a, { x1: 0, y1: 5, x2: 20, y2: 5 });
    const shifted = edgeCompatibility(a, { x1: 90, y1: 5, x2: 190, y2: 5 });
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(short);
    expect(near).toBeGreaterThan(shifted);
    for (const v of [near, far, short, shifted]) expect(v).toBeGreaterThanOrEqual(0);
  });
});

describe('FR-VG-13: 格子による近傍探索', () => {
  it('FR-VG-13: 格子の結果が全組の比較と同じ組・同じ互換度になる', () => {
    for (const [seed, threshold] of [
      [1, 0.6],
      [2, 0.3],
      [3, 0.9],
    ] as const) {
      const edges = randomEdges(300, seed, 500);
      const grid = findCompatiblePairs(edges, threshold);
      const brute = findCompatiblePairsBruteForce(edges, threshold);
      expect(grid).toEqual(brute);
    }
  });
  it('FR-VG-13: 短くほぼ平行なエッジを広い範囲に置いても、全組の比較と同じ（格子が効く形）', () => {
    for (const threshold of [0.6, 0.8]) {
      const edges = wideShortEdges(600, 11);
      const grid = findCompatiblePairs(edges, threshold);
      expect(grid).toEqual(findCompatiblePairsBruteForce(edges, threshold));
      expect(grid.length).toBeGreaterThan(0);
    }
  });
  it('FR-VG-13: 長い 1 本が混ざっても（長さの階級が別）、全組の比較と同じ', () => {
    const edges = [
      ...wideShortEdges(400, 12),
      edge('diag', [0, 0], [5000, 5000]),
      edge('diag2', [100, 0], [5100, 5000]),
    ].map((e) => ({ x1: e.x1, y1: e.y1, x2: e.x2, y2: e.y2 }));
    expect(findCompatiblePairs(edges, 0.6)).toEqual(findCompatiblePairsBruteForce(edges, 0.6));
  });
  it('FR-VG-13: 互換な組が無い・エッジが無いときは空', () => {
    expect(findCompatiblePairs([], 0.6)).toEqual([]);
    expect(findCompatiblePairs([{ x1: 0, y1: 0, x2: 1, y2: 0 }], 0.6)).toEqual([]);
  });
});

describe('FR-VG-13: 束ね方', () => {
  it('FR-VG-13: 端点は入力と完全に同じで、折れ線は分割数 2^cycles + 1 個の点を持つ', () => {
    const edges = parallelBundle(5);
    const { paths } = bundleEdges(edges, { cycles: 3, iterations: 10 });
    for (const e of edges) {
      const p = pathOf(paths, e.id);
      expect(p.points.length).toBe(2 * (2 ** 3 + 1));
      expect(p.points.slice(0, 2)).toEqual([e.x1, e.y1]);
      expect(p.points.slice(-2)).toEqual([e.x2, e.y2]);
      expect(p.bundled).toBe(true);
    }
  });
  it('FR-VG-13: 平行で近いエッジは、束ねる前より中央が近づく', () => {
    const edges = parallelBundle(8);
    const spread = (paths: readonly BundledPath[]): number => {
      const ys = paths.map(middleY);
      return Math.max(...ys) - Math.min(...ys);
    };
    const before = spread(bundleEdges(edges, { cycles: 1, iterations: 1, stepSize: 0.0001 }).paths);
    const after = spread(bundleEdges(edges).paths);
    expect(before).toBeGreaterThan(50);
    expect(after).toBeLessThan(before / 5);
  });
  it('FR-VG-13: 束ねる強さが高いほど中央が集まる', () => {
    const edges = [...parallelBundle(8)];
    const spread = (strength: number): number => {
      const ys = bundleEdges(edges, { strength }).paths.map(middleY);
      return Math.max(...ys) - Math.min(...ys);
    };
    expect(spread(0)).toBeGreaterThan(spread(1));
  });
  it('FR-VG-13: 直交するエッジはほぼ動かない（互換度 0）', () => {
    const edges = [edge('h', [0, 0], [1000, 0]), edge('v', [500, -500], [500, 500])];
    const { paths } = bundleEdges(edges);
    const h = pathOf(paths, 'h');
    for (let k = 0; k < h.points.length; k += 2) expect(h.points[k + 1]).toBeCloseTo(0, 9);
    const v = pathOf(paths, 'v');
    for (let k = 0; k < v.points.length; k += 2) expect(v.points[k]).toBeCloseTo(500, 9);
  });
  it('FR-VG-13: 無向エッジは、向きが逆に並んでも 1 つの束になる', () => {
    const edges = [edge('a', [0, 0], [1000, 0]), edge('b', [1000, 6], [0, 6])];
    const { paths } = bundleEdges(edges);
    expect(Math.abs(middleY(pathOf(paths, 'a')) - middleY(pathOf(paths, 'b')))).toBeLessThan(0.5);
  });
  it('FR-VG-13: 向きが同じ有向エッジは 1 つの束になる', () => {
    const { paths } = bundleEdges(parallelBundle(4, true));
    const ys = paths.map(middleY);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
  });
  it('FR-VG-13: 逆向きの有向エッジも、無向と同じく 1 本の中心線に束ねる（車線は描画側）', () => {
    const edges = [
      edge('east', [0, 0], [1000, 0], true),
      edge('west', [1000, 0], [0, 0], true),
      edge('east2', [0, 6], [1000, 6], true),
      edge('west2', [1000, 6], [0, 6], true),
    ];
    const { paths } = bundleEdges(edges);
    const ys = paths.map(middleY);
    expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(0.5);
    // 各 path は始点から終点の順のまま（向きは描画側で分かる）。
    expect(pathOf(paths, 'west').points.slice(0, 2)).toEqual([1000, 0]);
    expect(pathOf(paths, 'west').points.slice(-2)).toEqual([0, 0]);
    // 車線の設定は無い（削除済み）。
    expect('laneGap' in resolveBundlingSettings()).toBe(false);
  });
  it('FR-VG-13: 有向と無向が逆向きに並ぶときは車線に分けず束ねる', () => {
    const edges = [edge('d', [0, 0], [1000, 0], true), edge('u', [1000, 0], [0, 0], false)];
    const { paths } = bundleEdges(edges);
    expect(Math.abs(middleY(pathOf(paths, 'd')) - middleY(pathOf(paths, 'u')))).toBeLessThan(0.5);
  });
});

describe('FR-VG-13: 決定性と特殊なエッジ', () => {
  it('FR-VG-13: 入力の順を入れ替えても、同じ入力をもう一度でも、同じ結果（NFR-08）', () => {
    const edges = randomEdges(120, 7, 300);
    const first = bundleEdges(edges, { cycles: 3, iterations: 15 });
    const reversed = bundleEdges([...edges].reverse(), { cycles: 3, iterations: 15 });
    const r = mulberry32(99);
    const shuffled = [...edges].sort(() => r() - 0.5);
    expect(reversed).toEqual(first);
    expect(bundleEdges(shuffled, { cycles: 3, iterations: 15 })).toEqual(first);
    expect(first.paths.map((p) => p.id)).toEqual(edges.map((e) => e.id).sort());
  });
  it('FR-VG-13: 自己ループと長さ 0 のエッジは束ねずにそのまま返し、件数を返す', () => {
    const edges = [
      edge('loop', [10, 10], [10, 10], true),
      edge('zero', [5, 5], [5, 5]),
      edge('a', [0, 0], [100, 0]),
      edge('b', [0, 4], [100, 4]),
    ];
    const session = createBundlingSession(edges);
    expect(session.info).toMatchObject({ bundledCount: 2, unbundledCount: 2 });
    const result = bundleEdges(edges);
    expect(result.unbundledCount).toBe(2);
    expect(pathOf(result.paths, 'loop')).toEqual({
      id: 'loop',
      points: [10, 10, 10, 10],
      bundled: false,
      directed: true,
    });
    expect(pathOf(result.paths, 'zero').bundled).toBe(false);
    expect(pathOf(result.paths, 'a').bundled).toBe(true);
  });
  it('FR-VG-13: エッジが 0 本・束ねるものが無い入力も扱える', () => {
    expect(bundleEdges([])).toEqual({ paths: [], unbundledCount: 0 });
    const only = bundleEdges([edge('s', [1, 1], [1, 1])]);
    expect(only.unbundledCount).toBe(1);
  });
  it('FR-VG-13: 多重エッジ（同じ 2 点間）は別のエッジとして残り、ほぼ同じ線になる', () => {
    const edges = [edge('m1', [0, 0], [100, 50], true), edge('m2', [0, 0], [100, 50], true)];
    const { paths } = bundleEdges(edges);
    expect(paths).toHaveLength(2);
    expect(middleY(pathOf(paths, 'm1'))).toBeCloseTo(middleY(pathOf(paths, 'm2')), 9);
  });
  it('FR-VG-13: 座標が有限でない、ID が重複するときは拒否する', () => {
    expect(() => bundleEdges([edge('x', [Number.NaN, 0], [1, 1])])).toThrow(RangeError);
    expect(() => bundleEdges([edge('x', [0, 0], [1, 1]), edge('x', [0, 1], [1, 2])])).toThrow(
      '重複',
    );
  });
  it('FR-VG-13: 座標の絶対値が 1e9 を超えるときは拒否する', () => {
    expect(() => bundleEdges([edge('big', [0, 0], [2e9, 1])])).toThrow(RangeError);
    expect(() => bundleEdges([edge('ok', [-1e9, 0], [1e9, 1])])).not.toThrow();
  });
  it('FR-VG-13: 座標の尺度（メルカトルの大きな値など）が違っても同じ形になる', () => {
    const base = parallelBundle(4);
    const scaled = base.map((e) => ({
      ...e,
      x1: e.x1 * 1e4 + 3e6,
      y1: e.y1 * 1e4 - 1e6,
      x2: e.x2 * 1e4 + 3e6,
      y2: e.y2 * 1e4 - 1e6,
    }));
    const a = bundleEdges(base, { cycles: 3, iterations: 10 }).paths;
    const b = bundleEdges(scaled, { cycles: 3, iterations: 10 }).paths;
    const ya = a.map(middleY);
    const yb = b.map((p) => (middleY(p) + 1e6) / 1e4);
    ya.forEach((y, i) => {
      expect(yb[i]).toBeCloseTo(y, 6);
    });
  });
  it('FR-VG-13: maxNeighbors で切っても入力の順に依らず、上限なしとは結果が違う', () => {
    // 始点が同じで終点が (100, 30 + i) の、扇形に並ぶエッジ 12 本。互換度に差がつき、
    // 上限 2 で切ると近傍の選び方が結果に効く。
    const edges = Array.from({ length: 12 }, (_, i) =>
      edge(`m${String(i).padStart(2, '0')}`, [0, 0], [100, 30 + i], true),
    );
    const limited = bundleEdges(edges, { maxNeighbors: 2, cycles: 3, iterations: 10 });
    const shuffled = bundleEdges([...edges].reverse(), {
      maxNeighbors: 2,
      cycles: 3,
      iterations: 10,
    });
    const unlimited = bundleEdges(edges, { maxNeighbors: 1000, cycles: 3, iterations: 10 });
    expect(shuffled).toEqual(limited);
    expect(limited).not.toEqual(unlimited);
  });
  it('FR-VG-13: 同点のときは番号の小さい方を残す（鏡像の 2 本）', () => {
    // 中央の 1 本（番号 1）の上下 ±d に、互換度がまったく同じ鏡像の 2 本（番号 0 と 2）。
    const edges = [
      { x1: 0, y1: -10, x2: 100, y2: -10 },
      { x1: 0, y1: 0, x2: 100, y2: 0 },
      { x1: 0, y1: 10, x2: 100, y2: 10 },
    ];
    const table = buildNeighborTable(edges, 0.6, 1);
    expect(Array.from(table.index.slice(table.offsets[1] ?? 0, table.offsets[2] ?? 0))).toEqual([
      0,
    ]);
  });
  it('FR-VG-13: 長さ 0 のエッジを含む入力でも、全組の比較と一致し、NaN や自己との組を作らない', () => {
    const edges = [
      { x1: 0, y1: 0, x2: 0, y2: 0 },
      { x1: 1, y1: 1, x2: 1, y2: 1 },
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 0, y1: 0.1, x2: 1, y2: 0.1 },
    ];
    const grid = findCompatiblePairs(edges, 0.6);
    expect(grid.every((p) => p.i !== p.j && Number.isFinite(p.compat))).toBe(true);
    expect(grid).toEqual(findCompatiblePairsBruteForce(edges, 0.6));
    expect(grid.map((p) => [p.i, p.j])).toEqual([[2, 3]]);
    expect(buildNeighborTable(edges, 0.6, 5).pairCount).toBe(1);
  });
  it('FR-VG-13: 近傍の表は上位 maxNeighbors 件だけを、互換度の降順（同点は番号の昇順）で持つ', () => {
    const edges = parallelBundle(10);
    const table = buildNeighborTable(edges, 0.6, 3);
    const all = findCompatiblePairs(edges, 0.6);
    expect(table.pairCount).toBe(all.length);
    for (let i = 0; i < edges.length; i++) {
      const o = table.offsets[i] ?? 0;
      const n = (table.offsets[i + 1] ?? 0) - o;
      expect(n).toBe(3);
      const expected = all
        .filter((p) => p.i === i || p.j === i)
        .map((p) => ({ j: p.i === i ? p.j : p.i, compat: p.compat }))
        .sort((a, b) => b.compat - a.compat || a.j - b.j)
        .slice(0, 3);
      expect(Array.from(table.index.slice(o, o + n))).toEqual(expected.map((e) => e.j));
    }
  });
  it(
    'FR-VG-13: 密集した 5,000 本でも、準備のメモリと時間が組の数に比例しない',
    { timeout: 60000 },
    () => {
      const edges = denseEdges(5000, 5);
      const started = performance.now();
      const table = buildNeighborTable(edges, 0.6, 60);
      const elapsed = performance.now() - started;
      // 互換な組は数百万組になるが、保つのは 1 本あたり 60 件まで。
      expect(table.pairCount).toBeGreaterThan(1_000_000);
      expect(table.index.length).toBeLessThanOrEqual(5000 * 60);
      expect(elapsed).toBeLessThan(40000);
    },
  );
});

describe('FR-VG-13: セッションと設定', () => {
  it('FR-VG-13: step は段階ごとに進み、終わった後は何も変えない', () => {
    const session = createBundlingSession(parallelBundle(3), { cycles: 3, iterations: 5 });
    expect(session.step()).toEqual({ cycle: 1, cycles: 3, done: false });
    expect(session.result().paths[0]?.points.length).toBe(2 * (2 + 1));
    expect(session.step().cycle).toBe(2);
    expect(session.step()).toEqual({ cycle: 3, cycles: 3, done: true });
    const before = session.result();
    expect(session.step()).toEqual({ cycle: 3, cycles: 3, done: true });
    expect(session.result()).toEqual(before);
  });
  it('FR-VG-13: 設定は既定で補い、範囲外・整数でない・有限でない値を拒否する', () => {
    expect(resolveBundlingSettings()).toMatchObject({ cycles: 5, compatibilityThreshold: 0.6 });
    expect(resolveBundlingSettings({ cycles: 2 }).cycles).toBe(2);
    expect(() => resolveBundlingSettings({ cycles: 0 })).toThrow(RangeError);
    expect(() => resolveBundlingSettings({ cycles: 2.5 })).toThrow('整数');
    expect(() => resolveBundlingSettings({ strength: 1.5 })).toThrow(RangeError);
    expect(() => resolveBundlingSettings({ stepSize: Number.NaN })).toThrow(RangeError);
    expect(() => resolveBundlingSettings({ compatibilityThreshold: 0 })).toThrow(RangeError);
    expect(() => resolveBundlingSettings({ maxNeighbors: 5000 })).toThrow(RangeError);
    expect(resolveBundlingSettings({ cycles: undefined }).cycles).toBe(5); // undefined は既定値
    expect(() => createBundlingSession([], { iterations: 0 })).toThrow(RangeError);
  });
  it('FR-VG-13: 5,000 本を超えると警告する（ちょうど 5,000 本は超えない）', () => {
    expect(BUNDLING_EDGE_WARNING_LIMIT).toBe(5000);
    expect(exceedsBundlingLimit(5000)).toBe(false);
    expect(exceedsBundlingLimit(5001)).toBe(true);
    expect(exceedsBundlingLimit(10, 5)).toBe(true);
  });
});

describe('FR-VG-13: 性能（NFR-03）', () => {
  it(
    'FR-VG-13: 固定の種で作った 1,000 本を、緩い上限（30 秒）の中で束ねる',
    { timeout: 60000 },
    () => {
      const edges = randomEdges(1000, 20260101);
      const started = performance.now();
      const { paths } = bundleEdges(edges);
      const elapsed = performance.now() - started;
      expect(paths).toHaveLength(1000);
      expect(elapsed).toBeLessThan(30000);
    },
  );
});
