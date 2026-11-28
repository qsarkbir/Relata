import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../core/graph';
import { mercator } from '../core/layout/geo';
import { toNodeId, toNodeTypeId } from '../core/model';
import { buildBundleGraph, bundleEdges } from '../render/bundling';
import { buildMapScene, mapLabels, toDeckPosition, type MapNetwork } from './scene';

const a = toNodeId('a');
const b = toNodeId('b');
const c = toNodeId('c');
const arabic = 'ابن عسكر (2026)';

function fixture(): MapNetwork {
  const graph: RelataGraph = new Graph({ type: 'directed', multi: false, allowSelfLoops: true });
  const type = toNodeTypeId('place');
  graph.addNode(a, { label: arabic, type });
  graph.addNode(b, { label: 'B', type });
  graph.addNode(c, { label: 'Unplaced', type });
  const attrs = { weight: 1, count: 1, edgeIds: [], directed: true, missingWeightCount: 0 };
  graph.addEdgeWithKey('ab', a, b, attrs);
  graph.addEdgeWithKey('bc', b, c, attrs);
  const positions = new Map([
    [a, mercator({ lat: 0, lon: -10 })],
    [b, mercator({ lat: 0, lon: 10 })],
  ]);
  return {
    graph,
    positions,
    encoding: {},
    selected: new Set(),
    selectedEdgeKeys: new Set(),
    direction: 'arrow',
    edgeShape: 'line',
    labels: 'all',
  };
}

describe('FR-MP-02: Web メルカトルの地図のシーン', () => {
  it('FR-MP-02・FR-VG-05/07: 直線や弧を選べ、矢じりはズームによらず点の縁で止まる', () => {
    const network = fixture();
    for (const zoom of [3, 8, 20]) {
      const straight = buildMapScene(network, zoom);
      expect(straight.omitted.nodesWithoutPosition).toEqual([c]);
      expect(straight.omitted.edgesWithoutEndpoint).toBe(1);
      expect(straight.edges.map((edge) => edge.id)).toEqual(['ab']);
      const [edge] = straight.edges;
      const target = straight.nodes.find((node) => node.id === b);
      const tip = edge?.head?.[0];
      if (target === undefined || tip === undefined) throw new Error('矢じりか点が無い');
      expect(edge?.path.map((point) => point.type)).toEqual(['M', 'L']);
      expect(target.x - tip.x).toBeCloseTo(target.r + target.strokeWidth / 2, 3);
      const [x, y] = toDeckPosition(target, 2 ** zoom);
      expect(x).toBeCloseTo(256 + (256 * 10) / 180, 10);
      expect(y).toBe(256);
      const arc = buildMapScene({ ...network, edgeShape: 'arc' }, zoom).edges[0];
      expect(arc?.path.map((point) => point.type)).toEqual(['M', 'Q']);
    }
    const taper = buildMapScene({ ...network, direction: 'taper' }, 4).edges[0];
    expect(taper?.ribbon?.length).toBeGreaterThan(3);
    expect(taper?.head).toBeUndefined();
    const gradient = buildMapScene({ ...network, direction: 'gradient' }, 4).edges[0];
    expect(gradient?.gradient?.end.x).toBeGreaterThan(gradient?.gradient?.start.x ?? 0);
  });

  it('FR-MP-02・FR-VG-06: 往復を反対側の弧に分け、片端だけのエッジを描かない', () => {
    const network = fixture();
    const attrs = network.graph.getEdgeAttributes('ab');
    network.graph.addEdgeWithKey('ba', b, a, attrs);
    const [ab, ba] = buildMapScene(network, 3).edges;
    const to = ab?.path[1];
    const from = ba?.path[1];
    if (to?.type !== 'Q' || from?.type !== 'Q') throw new Error('往復の弧が無い');
    expect(to.cy).toBeGreaterThan(0);
    expect(from.cy).toBeLessThan(0);
  });

  it('FR-VG-13/14: 投影した束の帯と選択の強調を作り、重ね描きに切り替えられる', () => {
    const network = fixture();
    const edges = [{ id: 'ab', x1: -10, y1: 0, x2: 10, y2: 0, directed: true, weight: 3 }];
    const { paths } = bundleEdges(edges);
    const bundled = { paths, graph: buildBundleGraph(paths, edges), scale: 'sqrt' as const };
    const input = { ...network, bundled, selectedEdgeKeys: new Set(['ab']) };
    const bands = buildMapScene(input, 4);
    expect(bands.bundle?.ribbons.map((ribbon) => ribbon.edgeId)).toEqual(['ab']);
    expect(bands.bundle?.widthScale).toMatchObject({ maxWeight: 3, kind: 'sqrt' });
    expect(bands.edges.map((edge) => edge.role)).toContain('highlight');
    const overlay = buildMapScene({ ...input, bundled: { ...bundled, style: 'overlay' } }, 7);
    expect(overlay.bundle?.ribbons).toHaveLength(0);
    expect(overlay.edges.map((edge) => edge.role)).toContain('overlay');
  });

  it('NFR-09・FR-TB-02: 選択中の右書きラベルは、画面座標で点の左に置き重なりを解消する', () => {
    const f = fixture();
    const network = { ...f, labels: 'selected' as const, selected: new Set([a]) };
    const scene = buildMapScene(network, 4);
    expect(scene.nodes.find((n) => n.id === a)?.selected).toBe(true);
    const viewport = { zoom: 4, lat: 0, lon: -10 };
    const size = { width: 500, height: 300 };
    const measure = () => 90;
    const labels = mapLabels(scene, network, viewport, size, measure);
    expect(labels).toMatchObject([{ text: arabic, direction: 'rtl', anchor: 'right' }]);
    expect(labels[0]?.x).toBeLessThan(size.width / 2);
    expect(mapLabels(scene, { ...network, labels: 'none' }, viewport, size, measure)).toEqual([]);
    network.graph.setNodeAttribute(b, 'label', 'دمشق');
    expect(
      mapLabels(scene, { ...network, labels: 'all' }, { ...viewport, zoom: 0 }, size, () => 300),
    ).toHaveLength(1);
  });
});
