import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId, type NodeId } from '../../core/model';
import { buildScene } from './build';
import { fitZoomFor, FIT_MARGIN, MAX_FIT_ZOOM, MIN_ZOOM } from './fit';

const id = (s: string): NodeId => toNodeId(s);

function makeGraph(ids: string[], edges: [string, string][] = []): RelataGraph {
  const g: RelataGraph = new Graph({ type: 'mixed', multi: false, allowSelfLoops: true });
  for (const n of ids) g.addNode(n, { label: n, type: toNodeTypeId('person') });
  edges.forEach(([s, t], i) =>
    g.addEdgeWithKey(`e${String(i)}`, s, t, {
      weight: 1,
      count: 1,
      edgeIds: [],
      directed: true,
      missingWeightCount: 0,
    }),
  );
  return g;
}
const measure = (text: string): number => text.length * 7;
const sizes = { sizes: new Map([[id('a'), { size: 10, missing: false }]]) };

describe('FR-VG-01: 位置だけを拡大し、半径・線幅・矢じりは px のまま', () => {
  const g = makeGraph(['a', 'b'], [['a', 'b']]);
  const pos = new Map([
    [id('a'), { x: 0, y: 0 }],
    [id('b'), { x: 100, y: 0 }],
  ]);
  it('zoom を変えても、半径と線の太さは変わらない', () => {
    const one = buildScene(g, pos, sizes, { zoom: 1, measureText: measure });
    const four = buildScene(g, pos, sizes, { zoom: 4, measureText: measure });
    expect(four.nodes.map((n) => n.r)).toEqual(one.nodes.map((n) => n.r));
    expect(four.edges.map((e) => e.width)).toEqual(one.edges.map((e) => e.width));
    expect(four.labels.map((l) => l.fontSize)).toEqual(one.labels.map((l) => l.fontSize));
  });
  it('ノード間の距離だけが zoom 倍になる', () => {
    const four = buildScene(g, pos, sizes, { zoom: 4 });
    const [a, b] = four.nodes;
    expect((b?.x ?? 0) - (a?.x ?? 0)).toBeCloseTo(400);
  });
  it('矢じりの大きさは zoom に依らず、終点はノードの縁にある', () => {
    const extent = (zoom: number) => {
      const sc = buildScene(g, pos, {}, { zoom });
      const head = sc.edges[0]?.head ?? [];
      const xs = head.map((p) => p.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(extent(3)).toBeCloseTo(extent(1));
  });
  it('不正な zoom（0、負、NaN）は 1 として扱う', () => {
    const base = buildScene(g, pos, {}, {});
    for (const zoom of [0, -2, Number.NaN])
      expect(buildScene(g, pos, {}, { zoom }).nodes.map((n) => n.x)).toEqual(
        base.nodes.map((n) => n.x),
      );
  });
});

describe('FR-VG-01: 全体表示の倍率', () => {
  const build = (g: RelataGraph, pos: Map<NodeId, { x: number; y: number }>) => (zoom: number) =>
    buildScene(g, pos, {}, { zoom, measureText: measure });
  it('広がりのある図は、枠の余白を残して収まる', () => {
    const g = makeGraph(['a', 'b', 'c']);
    const pos = new Map([
      [id('a'), { x: 0, y: 0 }],
      [id('b'), { x: 2000, y: 100 }],
      [id('c'), { x: 500, y: 1500 }],
    ]);
    const size = { width: 800, height: 500 };
    const fitted = fitZoomFor(build(g, pos), size);
    expect(fitted.zoom).toBeLessThan(1);
    expect(fitted.scene.width).toBeLessThanOrEqual(size.width - FIT_MARGIN * 2 + 1);
    expect(fitted.scene.height).toBeLessThanOrEqual(size.height - FIT_MARGIN * 2 + 1);
    // 収める方向が決まる側は、ほぼ余白いっぱいまで使う
    expect(Math.max(fitted.scene.width / 760, fitted.scene.height / 460)).toBeGreaterThan(0.9);
  });
  it('NFR-03: ノードが 1 件だけでも倍率は過大にならない（1）', () => {
    const g = makeGraph(['a']);
    const fitted = fitZoomFor(build(g, new Map([[id('a'), { x: 5, y: 5 }]])), {
      width: 800,
      height: 500,
    });
    expect(fitted.zoom).toBe(1);
  });
  it('ごく近い 2 点でも、倍率は上限を超えない', () => {
    const g = makeGraph(['a', 'b']);
    const pos = new Map([
      [id('a'), { x: 0, y: 0 }],
      [id('b'), { x: 0.5, y: 0.5 }],
    ]);
    expect(fitZoomFor(build(g, pos), { width: 800, height: 500 }).zoom).toBe(MAX_FIT_ZOOM);
  });
  it('ノードが 0 件なら、倍率は 1（巨大にならない）', () => {
    const fitted = fitZoomFor(build(makeGraph([]), new Map()), { width: 800, height: 500 });
    expect(fitted.zoom).toBe(1);
    expect(fitted.scene.nodes).toHaveLength(0);
  });
  it('枠が極端に小さいときは下限で止まる', () => {
    const g = makeGraph(['a', 'b']);
    const pos = new Map([
      [id('a'), { x: 0, y: 0 }],
      [id('b'), { x: 100000, y: 0 }],
    ]);
    expect(fitZoomFor(build(g, pos), { width: 100, height: 100 }).zoom).toBe(MIN_ZOOM);
  });
});
