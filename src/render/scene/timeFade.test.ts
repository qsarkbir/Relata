import Graph from 'graphology';
import { describe, expect, it } from 'vitest';
import type { RelataGraph } from '../../core/graph';
import { toNodeId, toNodeTypeId } from '../../core/model';
import { renderSvg } from '../svg';
import { buildScene } from './index';
import { FADED_OPACITY, markOutOfTime } from './timeFade';

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

describe('FR-TM-02: 時刻の外の印（D-38）', () => {
  const scene = buildScene(makeGraph(), pos);
  it('FR-TM-02: 何も薄くしなければ同じシーンを返す（参照を保つ）', () => {
    expect(markOutOfTime(scene, new Set(), new Set())).toBe(scene);
  });
  it('FR-TM-02: 指定したノード・ラベル・エッジだけに印を付け、数は減らさない', () => {
    const m = markOutOfTime(scene, new Set(['b']), new Set(['k1']));
    expect(m.nodes).toHaveLength(scene.nodes.length);
    expect(m.edges).toHaveLength(scene.edges.length);
    expect(m.nodes.find((n) => n.id === 'a')?.faded).toBeUndefined();
    expect(m.nodes.find((n) => n.id === 'b')?.faded).toBe(true);
    expect(m.labels.filter((l) => l.faded === true).map((l) => l.nodeId)).toEqual(['b']);
    expect(m.edges[0]?.faded).toBe(true);
    // 位置と色は変えない
    expect(m.nodes.find((n) => n.id === 'b')).toMatchObject({
      x: scene.nodes.find((n) => n.id === 'b')?.x,
      fill: scene.nodes.find((n) => n.id === 'b')?.fill,
    });
  });
  it('FR-TM-02: SVG では不透明度を下げ、data-out-of-time の印を付ける（消さない）', () => {
    const svg = renderSvg(markOutOfTime(scene, new Set(['b']), new Set(['k1'])));
    expect(svg.match(/data-out-of-time="true"/g)?.length).toBe(3); // ノード、ラベル、エッジ
    expect(svg).toContain(`opacity="${String(FADED_OPACITY)}"`);
    expect(svg).toContain('data-id="b"');
    expect(svg).toContain('data-id="k1"');
  });
  it('FR-TM-02: 印の無い図は、これまでの SVG と同じ（印の属性を足さない）', () => {
    expect(renderSvg(scene)).not.toContain('data-out-of-time');
  });
  it('FR-TM-02: 薄いエッジの不透明度は、元の不透明度に掛ける', () => {
    const e = scene.edges[0];
    if (e === undefined) throw new Error('fixture');
    const faded = renderSvg({ ...scene, edges: [{ ...e, opacity: 0.5, faded: true }] });
    expect(faded).toContain(`stroke-opacity="${String(0.5 * FADED_OPACITY)}"`);
  });
});
