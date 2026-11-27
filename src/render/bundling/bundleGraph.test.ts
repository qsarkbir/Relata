import { describe, expect, it } from 'vitest';

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
import {
  bundleEdges,
  buildBundleGraph,
  bundleEdgeIds,
  oppositesOf,
  segmentBundlesOf,
  weightsFor,
  type BundleEdge,
  type BundledPath,
} from './index';

// 点の数を 5（区間 4）にした直線の折れ線。
function line(
  id: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  directed = false,
): BundledPath {
  const points: number[] = [];
  for (let i = 0; i <= 4; i++) points.push(x1 + ((x2 - x1) * i) / 4, y1 + ((y2 - y1) * i) / 4);
  return { id, points, bundled: true, directed };
}
function w(id: string, weight: number): Pick<BundleEdge, 'id' | 'weight'> {
  return { id, weight };
}
// 長さ 1000 の水平線を基準にすると、既定の ε は 10。
const ABS = { epsilon: 5 };

describe('buildBundleGraph', () => {
  it('FR-VG-14: 平行に重なる同じ向きの 3 本は 1 つの束になり、W は重みの合計', () => {
    const paths = [
      line('a', 0, 0, 1000, 0, true),
      line('b', 0, 1, 1000, 1, true),
      line('c', 0, 2, 1000, 2, true),
    ];
    const g = buildBundleGraph(paths, [w('a', 1), w('b', 2), w('c', 3.5)], ABS);
    expect(g.bundleCount).toBe(4);
    for (const id of ['a', 'b', 'c'])
      expect(Array.from(segmentBundlesOf(g, id))).toEqual([0, 1, 2, 3]);
    expect(Array.from(g.weight)).toEqual([6.5, 6.5, 6.5, 6.5]);
    expect(bundleEdgeIds(g, 0)).toEqual(['a', 'b', 'c']);
    expect(g.invalidWeightCount).toBe(0);
  });

  it('FR-VG-13: 逆向きの有向エッジは別の束になり、互いを重なる逆向きとして指す', () => {
    const paths = [line('f', 0, 0, 1000, 0, true), line('r', 1000, 1, 0, 1, true)];
    const g = buildBundleGraph(paths, [w('f', 1), w('r', 1)], ABS);
    const f = Array.from(segmentBundlesOf(g, 'f'));
    const r = Array.from(segmentBundlesOf(g, 'r'));
    expect(new Set([...f, ...r]).size).toBe(8);
    for (let k = 0; k < 4; k++) {
      // r の区間 k は f の区間 3-k と同じ場所
      expect(oppositesOf(g, f[3 - k] ?? -1)).toEqual([r[k]]);
      expect(oppositesOf(g, r[k] ?? -1)).toEqual([f[3 - k]]);
    }
  });

  it('FR-VG-13: 同じ向きの束は opposites を持たない', () => {
    const g = buildBundleGraph(
      [line('a', 0, 0, 1000, 0, true), line('b', 0, 1, 1000, 1, true)],
      [w('a', 1), w('b', 1)],
      ABS,
    );
    expect(g.opposites.size).toBe(0);
  });

  it('FR-VG-13: 無向のエッジは向きを問わず 1 つの束にまとまる', () => {
    const paths = [line('f', 0, 0, 1000, 0), line('r', 1000, 1, 0, 1)];
    const g = buildBundleGraph(paths, [w('f', 1), w('r', 2)], ABS);
    expect(g.bundleCount).toBe(4);
    expect(Array.from(g.weight)).toEqual([3, 3, 3, 3]);
    expect(Array.from(g.directed)).toEqual([0, 0, 0, 0]);
    expect(g.opposites.size).toBe(0);
  });

  it('FR-VG-13: 無向のエッジは、重なる有向の束に加わる（逆向きでも）', () => {
    const paths = [line('d', 0, 0, 1000, 0, true), line('u', 1000, 1, 0, 1, false)];
    const g = buildBundleGraph(paths, [w('d', 1), w('u', 4)], ABS);
    expect(g.bundleCount).toBe(4);
    expect(Array.from(g.weight)).toEqual([5, 5, 5, 5]);
    expect(Array.from(g.directed)).toEqual([1, 1, 1, 1]);
  });

  it('FR-VG-14: 離れたエッジ・直交するエッジはまとまらない', () => {
    const far = buildBundleGraph(
      [line('a', 0, 0, 1000, 0), line('b', 0, 100, 1000, 100)],
      [w('a', 1), w('b', 1)],
      ABS,
    );
    expect(far.bundleCount).toBe(8);
    const cross = buildBundleGraph(
      [line('a', 0, 0, 1000, 0), line('b', 500, -500, 500, 500)],
      [w('a', 1), w('b', 1)],
      { epsilon: 300 },
    );
    // 区間 1 と 2 の中点は a の (375,0)/(625,0)、b の (500,-375) 付近など。向きが直交なので束は共有しない。
    const shared = Array.from(segmentBundlesOf(cross, 'a')).filter((x) =>
      Array.from(segmentBundlesOf(cross, 'b')).includes(x),
    );
    expect(shared).toEqual([]);
  });

  it('FR-VG-14: 結果は入力の順に依らない（決定的）', () => {
    const paths = [
      line('a', 0, 0, 1000, 0, true),
      line('b', 0, 1, 1000, 1, false),
      line('c', 1000, 2, 0, 2, true),
      line('d', 0, 50, 900, 80, true),
    ];
    const ws = [w('a', 1), w('b', 0.1), w('c', 0.2), w('d', 7)];
    const g1 = buildBundleGraph(paths, ws, ABS);
    const g2 = buildBundleGraph([...paths].reverse(), [...ws].reverse(), ABS);
    expect(g2.edgeIds).toEqual(g1.edgeIds);
    expect(Array.from(g2.segmentBundle)).toEqual(Array.from(g1.segmentBundle));
    expect(Array.from(g2.weight)).toEqual(Array.from(g1.weight));
    expect(Array.from(g2.members)).toEqual(Array.from(g1.members));
    expect(Array.from(g2.opposites.entries())).toEqual(Array.from(g1.opposites.entries()));
  });

  it('FR-VG-14: 欠損・負・有限でない重みは 0 として数え、件数を返す', () => {
    const paths = [
      line('a', 0, 0, 1000, 0),
      line('b', 0, 1, 1000, 1),
      line('c', 0, 2, 1000, 2),
      line('d', 0, 3, 1000, 3),
      line('e', 0, 4, 1000, 4),
    ];
    const g = buildBundleGraph(
      paths,
      [w('a', 2), w('b', -1), w('c', NaN), w('d', Infinity) /* e は欠損 */],
      ABS,
    );
    expect(g.invalidWeightCount).toBe(4);
    expect(Array.from(g.weight)).toEqual([2, 2, 2, 2]);
  });

  it('FR-VG-14: 自己ループ・長さ 0 は束に入らず -1、多重エッジは重みが足される', () => {
    const loop: BundledPath = { id: 'loop', points: [5, 5, 5, 5], bundled: false, directed: true };
    const g = buildBundleGraph(
      [loop, line('m1', 0, 0, 1000, 0, true), line('m2', 0, 0, 1000, 0, true)],
      [w('loop', 9), w('m1', 1), w('m2', 2)],
      ABS,
    );
    expect(Array.from(segmentBundlesOf(g, 'loop'))).toEqual([-1]);
    expect(Array.from(g.weight)).toEqual([3, 3, 3, 3]);
  });

  it('FR-VG-14: 同じエッジが同じ束に複数の区間で入っても、重みは 1 回だけ足す', () => {
    // 区間の長さが 1 の細かい折れ線: 区間の中点どうしが ε = 5 以内で同じ束になる
    const points: number[] = [];
    for (let i = 0; i <= 8; i++) points.push(i, 0);
    const g = buildBundleGraph(
      [{ id: 'fine', points, bundled: true, directed: true }],
      [w('fine', 3)],
      ABS,
    );
    expect(new Set(segmentBundlesOf(g, 'fine')).size).toBeLessThan(8);
    expect(Math.max(...g.weight)).toBe(3);
  });

  it('FR-VG-14: weightsFor は見えているエッジだけで W を出し直す', () => {
    const paths = [
      line('a', 0, 0, 1000, 0, true),
      line('b', 0, 1, 1000, 1, true),
      line('c', 0, 300, 1000, 300, true),
    ];
    const g = buildBundleGraph(paths, [w('a', 1), w('b', 2), w('c', 4)], ABS);
    expect(Array.from(weightsFor(g, ['a', 'b', 'c']))).toEqual(Array.from(g.weight));
    const only = weightsFor(g, new Set(['b', 'c', 'zzz']));
    const aBundle = segmentBundlesOf(g, 'a')[0] ?? -1;
    const cBundle = segmentBundlesOf(g, 'c')[0] ?? -1;
    expect(only[aBundle]).toBe(2);
    expect(only[cBundle]).toBe(4);
    expect(Array.from(weightsFor(g, []))).toEqual(new Array<number>(g.bundleCount).fill(0));
  });

  it('FR-VG-14: 既定の ε は平均の長さの割合で、設定で変えられる', () => {
    const paths = [line('a', 0, 0, 1000, 0), line('b', 0, 1, 1000, 1)];
    expect(buildBundleGraph(paths, []).epsilon).toBeCloseTo(10, 9);
    expect(buildBundleGraph(paths, [], { epsilonRatio: 0.05 }).epsilon).toBeCloseTo(50, 9);
    expect(buildBundleGraph(paths, [], { epsilon: 3 }).epsilon).toBe(3);
  });

  it('FR-VG-14: 範囲外の設定・不正な入力は RangeError', () => {
    const paths = [line('a', 0, 0, 1000, 0)];
    for (const epsilon of [-1, 0, NaN, Infinity]) {
      expect(() => buildBundleGraph(paths, [], { epsilon })).toThrow(RangeError);
    }
    for (const epsilonRatio of [0, -0.1, NaN, Infinity]) {
      expect(() => buildBundleGraph(paths, [], { epsilonRatio })).toThrow(RangeError);
    }
    for (const minCosine of [-0.1, 1.1, NaN]) {
      expect(() => buildBundleGraph(paths, [], { minCosine })).toThrow(RangeError);
    }
    const odd: BundledPath = { id: 'o', points: [0, 0, 1, 1, 2], bundled: true, directed: false };
    expect(() => buildBundleGraph([odd], [])).toThrow(RangeError);
  });

  it('FR-VG-14: paths の ID の重複は RangeError', () => {
    const dup = line('a', 0, 0, 10, 0);
    expect(() => buildBundleGraph([dup, dup], [])).toThrow(RangeError);
  });

  it('FR-VG-14: edges の ID の重複は最初のものを使い、余分な件数を返す', () => {
    const paths = [line('a', 0, 0, 1000, 0)];
    const g1 = buildBundleGraph(paths, [w('a', 2), w('a', 5)], ABS);
    const g2 = buildBundleGraph(paths, [w('a', 5), w('a', 2)], ABS);
    expect(g1.weight[0]).toBe(2);
    expect(g2.weight[0]).toBe(5);
    expect(g1.duplicateWeightCount).toBe(1);
  });

  it('FR-VG-14: ε が座標の幅に比べて極端に小さくても、座標が ±1e9 でも例外なく動く', () => {
    const paths = [
      line('a', 0, 0, 1000, 0),
      line('b', 0, 0, 1e9, 0),
      line('c', -1e9, -1e9, 1e9, 1e9),
    ];
    for (const epsilon of [1, 1e-6, 1e-12]) {
      const g = buildBundleGraph(paths, [w('a', 1), w('b', 1), w('c', 1)], { epsilon });
      expect(g.bundleCount).toBeGreaterThan(0);
    }
  });

  it('FR-VG-14: 束ねた対象が無いとき、全区間が -1 で束は 0 個', () => {
    const loop: BundledPath = { id: 'loop', points: [5, 5, 5, 5], bundled: false, directed: false };
    const g = buildBundleGraph([loop], [w('loop', 1)]);
    expect(g.bundleCount).toBe(0);
    expect(Array.from(g.segmentBundle)).toEqual([-1]);
    expect(g.epsilon).toBe(0);
    expect(buildBundleGraph([], []).bundleCount).toBe(0);
  });

  it('FR-VG-14: minCosine で、60 度までの交差はまとまり、それを超えるとまとまらない', () => {
    // 区間の中点が同じ位置で、角度だけが違う 2 本（点 2 つの折れ線）
    const seg = (id: string, deg: number): BundledPath => {
      const r = (deg * Math.PI) / 180;
      const [cx, sx] = [Math.cos(r), Math.sin(r)];
      return {
        id,
        points: [-100 * cx, -100 * sx, 100 * cx, 100 * sx],
        bundled: true,
        directed: true,
      };
    };
    const count = (deg: number, minCosine: number): number =>
      buildBundleGraph([seg('a', 0), seg('b', deg)], [], { epsilon: 5, minCosine }).bundleCount;
    expect(count(50, 0.5)).toBe(1);
    expect(count(70, 0.5)).toBe(2);
    expect(count(70, 0)).toBe(1);
  });

  it('FR-VG-14: 細かい折れ線で、weightsFor の全表示は weight と一致する（同じ束の重複を除く）', () => {
    const points: number[] = [];
    for (let i = 0; i <= 8; i++) points.push(i, 0);
    const g = buildBundleGraph(
      [{ id: 'fine', points, bundled: true, directed: true }, line('other', 0, 1, 1000, 1, true)],
      [w('fine', 3), w('other', 1)],
      ABS,
    );
    expect(Array.from(weightsFor(g, ['fine', 'other']))).toEqual(Array.from(g.weight));
    const only = weightsFor(g, ['fine']);
    expect(Math.max(...only)).toBe(3);
  });

  it('FR-VG-13: 有向・無向が混ざった帯で、無向 1 本の区間はすべて同じ側の束に入り、有向の W は芯で揺れない', () => {
    // 2 群（中心 (0,0) と (1000,0)、幅 100）の間の 60 本。往路・復路・無向を 1/3 ずつ。
    const rng = mulberry32(3);
    const edges: BundleEdge[] = [];
    for (let i = 0; i < 60; i++) {
      const kind = i % 3; // 0 = 往路、1 = 復路、2 = 無向（向きは往路）
      const a = { x: (rng() - 0.5) * 100, y: (rng() - 0.5) * 100 };
      const b = { x: 1000 + (rng() - 0.5) * 100, y: (rng() - 0.5) * 100 };
      const [p, q] = kind === 1 ? [b, a] : [a, b];
      edges.push({
        id: `e${String(i).padStart(3, '0')}`,
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        directed: kind !== 2,
        weight: 1,
      });
    }
    const { paths } = bundleEdges(edges);
    const g = buildBundleGraph(paths, edges);
    // 無向のエッジごとに、芯（区間 6〜25。両端の扇の部分は束が分かれるので除く）の束の「有向の向き」（往路側か
    // 復路側か）が 1 種類だけ
    for (const e of edges.filter((x) => !x.directed)) {
      const sides = new Set<string>();
      for (const b of segmentBundlesOf(g, e.id).slice(6, 26)) {
        if (b < 0) continue;
        const ids = bundleEdgeIds(g, b).filter((id) => edges.find((x) => x.id === id)?.directed);
        const forward = ids.filter((id) => Number(id.slice(1)) % 3 === 0).length;
        const backward = ids.filter((id) => Number(id.slice(1)) % 3 === 1).length;
        if (forward + backward > 0) sides.add(forward >= backward ? 'F' : 'R');
      }
      expect(sides.size).toBeLessThanOrEqual(1);
    }
    // 有向の往路 e000 の W は、芯（区間 8〜24 の中ほど）で大きく揺れない
    const core = Array.from(segmentBundlesOf(g, 'e000'))
      .slice(10, 22)
      .map((b) => g.weight[b] ?? 0);
    expect(Math.max(...core) - Math.min(...core)).toBeLessThanOrEqual(2);
  });

  it('FR-VG-13: 無向のエッジは、同じ向きの有向の束を優先し、無ければ逆向きの有向の束に入る', () => {
    const paths = [
      line('d', 0, 0, 1000, 0, true),
      line('u1', 0, 1, 1000, 1, false), // 同じ向き
      line('u2', 1000, 2, 0, 2, false), // 逆向きのみ（d しか有向が無い）
    ];
    const g = buildBundleGraph(paths, [w('d', 1), w('u1', 2), w('u2', 4)], ABS);
    expect(g.bundleCount).toBe(4);
    expect(Array.from(g.weight)).toEqual([7, 7, 7, 7]);
    expect(Array.from(g.directed)).toEqual([1, 1, 1, 1]);
  });

  it('FR-VG-13: bundleEdges の結果を入力にしても、近い往復が別の束になる（結合）', () => {
    const edges: BundleEdge[] = [];
    for (let i = 0; i < 6; i++) {
      const y = i * 4;
      edges.push({
        id: `f${String(i)}`,
        x1: 0,
        y1: y,
        x2: 1000,
        y2: y + 3,
        directed: true,
        weight: 1,
      });
      edges.push({
        id: `r${String(i)}`,
        x1: 1000,
        y1: y + 2,
        x2: 0,
        y2: y,
        directed: true,
        weight: 2,
      });
    }
    const { paths } = bundleEdges(edges, { cycles: 3 });
    const g = buildBundleGraph(paths, edges);
    const fb = segmentBundlesOf(g, 'f0');
    const rb = segmentBundlesOf(g, 'r0');
    expect(fb.length).toBe(8);
    const mid = fb[4] ?? -1;
    // 往路の束に往路 6 本、復路の束に復路 6 本が集まり、互いを指す
    expect(g.weight[mid]).toBeGreaterThan(1);
    expect(bundleEdgeIds(g, mid).every((id) => id.startsWith('f'))).toBe(true);
    const back = oppositesOf(g, mid);
    expect(back.length).toBeGreaterThan(0);
    expect(back.some((b) => rb.includes(b))).toBe(true);
    // 全部見えるときの再計算は W と一致する
    expect(
      Array.from(
        weightsFor(
          g,
          edges.map((e) => e.id),
        ),
      ),
    ).toEqual(Array.from(g.weight));
  });
});
