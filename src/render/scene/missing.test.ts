import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId } from '../../core/model';
import { buildScene } from './index';
import { renderSvg } from '../svg';

function makeGraph(): RelataGraph {
  const g: RelataGraph = new Graph({ type: 'mixed', multi: false, allowSelfLoops: true });
  for (const n of ['a', 'b']) g.addNode(n, { label: n, type: toNodeTypeId('person') });
  g.addEdgeWithKey('k1', 'a', 'b', {
    weight: 1,
    count: 1,
    edgeIds: [],
    directed: false,
    missingWeightCount: 0,
  });
  return g;
}
const pos = new Map([
  [toNodeId('a'), { x: 0, y: 0 }],
  [toNodeId('b'), { x: 100, y: 0 }],
]);

describe('FR-VG-12: 欠損の破線', () => {
  it('FR-VG-12: 指定したノードとエッジだけが dashed になり、SVG に破線が出る', () => {
    const sc = buildScene(
      makeGraph(),
      pos,
      {},
      { missingNodes: new Set([toNodeId('a')]), missingEdges: new Set(['k1']) },
    );
    expect(sc.nodes.find((n) => n.id === 'a')?.dashed).toBe(true);
    expect(sc.nodes.find((n) => n.id === 'b')?.dashed).toBe(false);
    expect(sc.edges[0]?.dashed).toBe(true);
    const svg = renderSvg(sc, {});
    expect(svg.match(/stroke-dasharray/g)?.length).toBe(2);
  });
  it('FR-VG-12: 指定が無ければ破線にしない', () => {
    const sc = buildScene(makeGraph(), pos);
    expect(sc.nodes.every((n) => !n.dashed)).toBe(true);
    expect(sc.edges[0]?.dashed).toBe(false);
  });
  it('FR-VG-12: 値の欠損と属性の欠損は、破線の間隔が違う', () => {
    const sc = buildScene(
      makeGraph(),
      pos,
      { colors: new Map([[toNodeId('b'), { color: '#dddddd', missing: true }]]) },
      { missingNodes: new Set([toNodeId('a')]) },
    );
    const svg = renderSvg(sc, {});
    expect(svg).toContain('stroke-dasharray="6 3"');
    expect(svg).toContain('stroke-dasharray="3 2"');
    expect(sc.nodes.map((n) => n.strokeWidth)).toEqual([1.5, 1.5]);
  });
  it.each(['taper', 'gradient'] as const)(
    'FR-VG-12: 有向エッジ（%s）でも、欠損のエッジは破線になる',
    (style) => {
      const g = makeGraph();
      g.clearEdges();
      g.addDirectedEdgeWithKey('d1', 'a', 'b', {
        weight: 1,
        count: 1,
        edgeIds: [],
        directed: true,
        missingWeightCount: 0,
      });
      const plain = renderSvg(buildScene(g, pos, {}, { directedStyle: style }), {});
      expect(plain).not.toContain('stroke-dasharray');
      const marked = renderSvg(
        buildScene(g, pos, {}, { directedStyle: style, missingEdges: new Set(['d1']) }),
        {},
      );
      expect(marked).toContain('stroke-dasharray="9 4"');
    },
  );
});
