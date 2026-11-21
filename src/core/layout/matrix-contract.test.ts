/** ForceAtlas2 0.10.1 の実際の helpers/iterate 間の行列契約を検証する。 */
import { expect, it, vi } from 'vitest';
import { graphToByteArrays } from 'graphology-layout-forceatlas2/helpers.js';
import { fromSnapshot, type GraphSnapshot } from '../graph';
import { toNodeId, toNodeTypeId } from '../model';
import { createLayoutSession } from './compute';

const { calls } = vi.hoisted(() => {
  const calls: { nodes: Float32Array; edges: Float32Array }[] = [];
  return { calls };
});
// iterate の入口だけを差し替え、実装が渡した配列を観測する。
// 実際に動く算法・固定点は compute.test.ts が別に検証する。
vi.mock('graphology-layout-forceatlas2/iterate.js', () => ({
  default: (_settings: unknown, nodes: Float32Array, edges: Float32Array) => {
    calls.push({ nodes: nodes.slice(), edges: edges.slice() });
  },
}));

it('FR-VG-01: ノード端点は index*10、自己ループmassは両端加算でライブラリと一致する', () => {
  const type = toNodeTypeId('person');
  const snapshot: GraphSnapshot = {
    options: { type: 'directed', multi: false, allowSelfLoops: true },
    attributes: {},
    nodes: ['a', 'b'].map((key) => ({ key, attributes: { label: key, type } })),
    edges: [
      {
        key: 'a-loop',
        source: 'a',
        target: 'a',
        attributes: { weight: 3, count: 1, edgeIds: [], directed: true, missingWeightCount: 0 },
      },
      {
        key: 'b-edge',
        source: 'a',
        target: 'b',
        attributes: { weight: 2, count: 1, edgeIds: [], directed: true, missingWeightCount: 0 },
      },
    ],
  };
  const positions = [
    { id: toNodeId('a'), x: 1, y: 2, fixed: false },
    { id: toNodeId('b'), x: 7, y: 8, fixed: false },
  ];
  const session = createLayoutSession({
    snapshot,
    options: { kind: 'forceatlas2', seed: 1, positions },
  });
  session.step(1);
  expect(calls).toHaveLength(1);
  const captured = calls[0];
  if (captured === undefined) throw new Error('反復関数が呼ばれていません');
  const graph = fromSnapshot(snapshot);
  graph.updateEachNodeAttributes((id, attrs) => ({
    ...attrs,
    x: id === 'a' ? 1 : 7,
    y: id === 'a' ? 2 : 8,
    fixed: false,
  }));
  const reference = graphToByteArrays(graph, (_edge, attrs) => attrs.weight);
  expect(captured).toEqual(reference);
  // iterate.js の PPN=10 と NODE_MASS=6 を、そのまま確かめる。
  // node a: 1 + loop 3 + loop 3 + a→b 2 = 9、node b: 1 + a→b 2 = 3。
  expect([...captured.edges]).toEqual([0, 0, 3, 0, 10, 2]);
  expect(captured.nodes[6]).toBe(9);
  expect(captured.nodes[10 + 6]).toBe(3);
  expect(captured.nodes[10]).toBe(7);
  expect(captured.nodes[10 + 1]).toBe(8);
});
