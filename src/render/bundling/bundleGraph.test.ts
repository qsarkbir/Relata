import { describe, expect, it } from 'vitest';
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
    expect(() => buildBundleGraph(paths, [], { epsilon: -1 })).toThrow(RangeError);
    const dup = line('a', 0, 0, 10, 0);
    expect(() => buildBundleGraph([dup, dup], [])).toThrow(RangeError);
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
