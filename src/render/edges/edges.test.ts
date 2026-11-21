import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { NODE_SHAPES, toNodeId, toNodeTypeId } from '../../core/model';
import type { NodeShape } from '../../core/model';
import { buildScene, shapeExtent } from '../scene';
import { renderSvg } from '../svg';

const a = toNodeId('a');
const b = toNodeId('b');
const type = toNodeTypeId('person');
function fixture(reciprocal = false, loop = false): RelataGraph {
  const graph: RelataGraph = new Graph({ type: 'mixed', multi: true, allowSelfLoops: true });
  graph.addNode(a, { label: 'محمد', type });
  graph.addNode(b, { label: '東京', type });
  const attrs = { weight: 1, count: 1, edgeIds: [], directed: true, missingWeightCount: 0 };
  graph.addDirectedEdgeWithKey('ab', a, b, attrs);
  if (reciprocal) graph.addDirectedEdgeWithKey('ba', b, a, attrs);
  if (loop) graph.addDirectedEdgeWithKey('aa', a, a, attrs);
  return graph;
}
const positions = new Map([
  [a, { x: 0, y: 0 }],
  [b, { x: 200, y: 0 }],
]);

describe('FR-VG-05〜07: 有向エッジ', () => {
  it.each(NODE_SHAPES)(
    'FR-VG-07: %s の外接円の縁に矢じりを置き、幹は手前で止める',
    (shape: NodeShape) => {
      const scene = buildScene(fixture(), positions, { shapes: new Map([[type, shape]]) });
      const edge = scene.edges[0];
      const node = scene.nodes.find((n) => n.id === b);
      if (edge === undefined || node === undefined) throw new Error('fixture');
      const tip = edge.head?.[0];
      if (tip === undefined) throw new Error('head');
      expect(Math.hypot(tip.x - node.x, tip.y - node.y)).toBeCloseTo(
        shapeExtent(shape, node.r) + node.strokeWidth / 2,
        6,
      );
      const end = edge.path.at(-1);
      expect(end?.x).toBeLessThan(tip.x);
      const svg = renderSvg(scene);
      expect(svg).toContain('edge-0-head');
      expect(svg).toContain('direction="rtl"');
    },
  );
  it('FR-VG-05 / FR-VG-07: 太さに応じて矢じりを大きくし、極端な太さでも全体を収める', () => {
    const small = buildScene(fixture(), positions, {
      widths: new Map([['ab', { width: 1, missing: false }]]),
    });
    const large = buildScene(fixture(), positions, {
      widths: new Map([['ab', { width: 10, missing: false }]]),
    });
    const headWidth = (scene: ReturnType<typeof buildScene>) =>
      Math.abs((scene.edges[0]?.head?.[1]?.y ?? 0) - (scene.edges[0]?.head?.[2]?.y ?? 0));
    expect(headWidth(large)).toBeGreaterThan(headWidth(small));
    for (const scene of [small, large])
      for (const p of scene.edges[0]?.head ?? []) {
        expect(p.x).toBeGreaterThanOrEqual(24);
        expect(p.y).toBeGreaterThanOrEqual(24);
        expect(p.x).toBeLessThanOrEqual(scene.width - 24);
        expect(p.y).toBeLessThanOrEqual(scene.height - 24);
      }
  });
  it('FR-VG-06: 往復はそれぞれ進行方向の右側へ膨らむ別々の弧になる', () => {
    const scene = buildScene(fixture(true), positions);
    const ab = scene.edges[0]?.path[1];
    const ba = scene.edges[1]?.path[1];
    if (ab?.type !== 'Q' || ba?.type !== 'Q') throw new Error('curves');
    const y = scene.nodes[0]?.y ?? 0;
    expect(ab.cy).toBeGreaterThan(y);
    expect(ba.cy).toBeLessThan(y);
    expect(scene.edges.every((e) => e.head !== undefined)).toBe(true);
  });
  it('FR-VG-05: 先細りは始点が太く終点が閉じる帯、濃淡は薄→濃の自己完結SVG', () => {
    const taper = buildScene(fixture(), positions, {}, { directedStyle: 'taper' });
    const ribbon = taper.edges[0]?.ribbon;
    expect(ribbon?.length).toBeGreaterThan(10);
    expect(taper.edges[0]?.head).toBeUndefined();
    if (ribbon === undefined) throw new Error('ribbon');
    expect(ribbon[0]?.y).not.toBe(ribbon.at(-1)?.y);
    expect(renderSvg(taper)).toContain('<polygon id="edge-0"');
    const gradient = renderSvg(
      buildScene(fixture(), positions, {}, { directedStyle: 'gradient' }),
      { idPrefix: 'fig1-' },
    );
    expect(gradient).toContain('id="fig1-edge-0-gradient"');
    expect(gradient).toContain('stroke="url(#fig1-edge-0-gradient)"');
    expect(gradient).toContain('stop-opacity="0.15"');
    expect(gradient).not.toContain('edge-0-head');
  });
  it.each(['arrow', 'taper', 'gradient'] as const)(
    'FR-VG-05: %s でも自己ループと重なるノードの位置を有限の輪で描く',
    (directedStyle) => {
      for (const pos of [
        positions,
        new Map([
          [a, { x: 0, y: 0 }],
          [b, { x: 0, y: 0 }],
        ]),
      ]) {
        const scene = buildScene(fixture(false, true), pos, {}, { directedStyle });
        expect(scene.edges).toHaveLength(2);
        expect(scene.omitted.selfLoops).toBe(0);
        const loop = scene.edges.find((e) => e.id === 'aa');
        expect(loop?.path).toHaveLength(3);
        expect(JSON.stringify(scene)).not.toContain('null');
        const svg = renderSvg(scene);
        expect(svg).not.toMatch(/NaN|Infinity/u);
      }
    },
  );
  it('FR-VG-05: 無向エッジには矢じり・先細り・濃淡を適用せず、幅0は矢じりもない', () => {
    const graph = fixture();
    graph.addUndirectedEdgeWithKey('undirected', a, b, {
      weight: 1,
      count: 1,
      edgeIds: [],
      directed: false,
      missingWeightCount: 0,
    });
    for (const directedStyle of ['arrow', 'taper', 'gradient'] as const) {
      const scene = buildScene(
        graph,
        positions,
        { widths: new Map([['ab', { width: 0, missing: false }]]) },
        { directedStyle },
      );
      expect(
        scene.edges.every(
          (e) => e.head === undefined && e.ribbon === undefined && e.gradient === undefined,
        ),
      ).toBe(true);
    }
  });
});

it('FR-VG-06: 同じ位置のノードの往復も上下の別の輪へ分ける', () => {
  const scene = buildScene(
    fixture(true),
    new Map([
      [a, { x: 0, y: 0 }],
      [b, { x: 0, y: 0 }],
    ]),
  );
  const first = scene.edges[0]?.path[1];
  const second = scene.edges[1]?.path[1];
  const y = scene.nodes[0]?.y ?? 0;
  if (first?.type !== 'Q' || second?.type !== 'Q') throw new Error('curves');
  expect(first.cy).toBeLessThan(y);
  expect(second.cy).toBeGreaterThan(y);
});
