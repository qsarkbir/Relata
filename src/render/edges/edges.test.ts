import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { NODE_SHAPES, toNodeId, toNodeTypeId } from '../../core/model';
import type { NodeShape } from '../../core/model';
import { buildScene, shapeExtent } from '../scene';
import { renderSvg } from '../svg';
import { edgeGeometry, type EdgePoint } from './geometry';
import type { PathCommand, SceneNode } from '../scene/types';

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

it('FR-VG-06: 位置の重なる異なるノードの間は、往復でも輪にせず中心どうしの直線にする', () => {
  const scene = buildScene(
    fixture(true),
    new Map([
      [a, { x: 0, y: 0 }],
      [b, { x: 0, y: 0 }],
    ]),
  );
  // 【なぜ】線はノードの下に隠れる。外へ迂回する輪は、密集した図を読みにくくした（利用者の指摘）。
  for (const edge of scene.edges) {
    expect(edge.path.map((command) => command.type)).toEqual(['M', 'L']);
    expect(edge.head).toBeUndefined();
  }
});

function geometryNode(id: string, x: number, y: number): SceneNode {
  return {
    id: toNodeId(id),
    x,
    y,
    r: 1,
    shape: 'circle',
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 0,
    dashed: false,
    selected: false,
  };
}

function hasCrossing(polygon: readonly EdgePoint[], closed = true): boolean {
  // 先端の左右が同じ点となる隣接重複は辺ではない。交差判定から除く。
  const points = polygon.filter((p, i) => {
    const previous = polygon[i - 1];
    return previous === undefined || Math.hypot(p.x - previous.x, p.y - previous.y) > 1e-8;
  });
  const cross = (a: EdgePoint, b: EdgePoint, c: EdgePoint) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    for (let j = i + 2; j < segmentCount; j++) {
      if (closed && i === 0 && j === segmentCount - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      if (
        c !== undefined &&
        d !== undefined &&
        cross(a, b, c) * cross(a, b, d) < -1e-8 &&
        cross(c, d, a) * cross(c, d, b) < -1e-8
      )
        return true;
    }
  }
  return false;
}

it('FR-VG-05/06: 外接円が重なるほど近い異なるノードは、どの表現でも直線で結び、向きの飾りを付けない', () => {
  for (const names of [
    ['node-10', 'node-2'],
    ['node-2', 'node-10'],
  ]) {
    const first = names[0];
    const second = names[1];
    if (first === undefined || second === undefined) throw new Error('names');
    for (const style of [undefined, 'arrow', 'taper', 'gradient'] as const) {
      const edge = edgeGeometry(
        geometryNode(first, 0, 0),
        geometryNode(second, 5, 0),
        4,
        4,
        2,
        24,
        style,
      );
      expect(edge.path).toEqual([
        { type: 'M', x: 0, y: 0 },
        { type: 'L', x: 5, y: 0 },
      ]);
      expect(edge.head ?? edge.ribbon ?? edge.gradient).toBeUndefined();
    }
  }
});

it('FR-VG-05: 短く太い曲線の先細りを曲率半径内に収め、帯を自己交差させない', () => {
  for (const bend of [10, 30, 60, 100]) {
    for (const width of [40, 80, 200]) {
      const result = edgeGeometry(
        geometryNode('s', 0, 0),
        geometryNode('t', 20, 0),
        1,
        1,
        width,
        bend,
        'taper',
      );
      if (result.ribbon === undefined) throw new Error('ribbon');
      expect(result.ribbon.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      expect(hasCrossing(result.ribbon)).toBe(false);
    }
  }
});

it('FR-VG-07: 矢じりが縮む短い辺では幹の描画幅も底辺幅以下にする', () => {
  const result = edgeGeometry(
    geometryNode('s', 0, 0),
    geometryNode('t', 20, 0),
    1,
    1,
    40,
    0,
    'arrow',
  );
  const first = result.head?.[1];
  const second = result.head?.[2];
  if (first === undefined || second === undefined || result.shaftWidth === undefined)
    throw new Error('head');
  expect(result.shaftWidth).toBeLessThan(40);
  expect(result.shaftWidth).toBeLessThanOrEqual(Math.hypot(first.x - second.x, first.y - second.y));
  const scene = buildScene(
    fixture(),
    new Map([
      [a, { x: 0, y: 0 }],
      [b, { x: 40, y: 0 }],
    ]),
    { widths: new Map([['ab', { width: 40, missing: false }]]) },
  );
  const edge = scene.edges[0];
  if (edge === undefined) throw new Error('edge');
  expect(edge.width).toBe(edge.shaftWidth);
  const svgWidth = /<path id="edge-0"[^>]*stroke-width="([^"]+)"/u.exec(renderSvg(scene))?.[1];
  expect(Number(svgWidth)).toBeCloseTo(edge.width, 3);
});

function pathSamples(path: readonly PathCommand[]): EdgePoint[] {
  const sampled: EdgePoint[] = [];
  let from: EdgePoint | undefined;
  for (const command of path) {
    if (command.type === 'M') sampled.push(command);
    else if (command.type === 'L') sampled.push(command);
    else {
      if (from === undefined) throw new Error('path');
      for (let i = 1; i <= 32; i++) {
        const t = i / 32;
        sampled.push({
          x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * command.cx + t * t * command.x,
          y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * command.cy + t * t * command.y,
        });
      }
    }
    from = command;
  }
  return sampled;
}

it('FR-VG-05/06: 近接上限・逆向き・負のbendでも中心線と先細りを8字にしない', () => {
  for (const bend of [-24, 24]) {
    for (const reverse of [false, true]) {
      for (const gap of [0, 1, 3]) {
        const first = geometryNode('node-10', reverse ? gap : 0, 0);
        const second = geometryNode('node-2', reverse ? 0 : gap, 0);
        // 【TS】as constでスタイルを文字列リテラルの配列に保つ。
        for (const style of ['gradient', 'taper'] as const) {
          const result = edgeGeometry(first, second, 1, 1, style === 'taper' ? 40 : 1, bend, style);
          expect(hasCrossing(pathSamples(result.path), false)).toBe(false);
          if (result.ribbon !== undefined) expect(hasCrossing(result.ribbon)).toBe(false);
        }
      }
    }
  }
});
