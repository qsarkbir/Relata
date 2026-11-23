import { describe, expect, it } from 'vitest';
import type { Dataset } from '../core/model';
import { toEdgeId, toNodeId, toNodeTypeId } from '../core/model';
import { DEFAULT_FILTER_STATE } from '../core/filter';
import type { MetricsJob, MetricsResult } from '../core/metrics';
import { DEFAULT_GRAPH_OPTIONS, toSnapshot } from '../core/graph';
import type { GraphOptions } from '../core/graph';
import { createMetricsController } from './metricsController';
import { getNetwork, selectedGraphEdges } from './networkView';

const P = toNodeTypeId('person');
const O = toNodeTypeId('org');
const ids = (xs: string[]) => xs.map(toNodeId);

/** 人物 a,b,c と組織 x,y。a,b は x に、b,c は y に属す。 */
const dataset: Dataset = {
  graphMode: 'undirected',
  nodeTypes: [
    { id: P, label: 'Person' },
    { id: O, label: 'Org' },
  ],
  nodes: [
    ...ids(['a', 'b', 'c']).map((id) => ({ id, type: P, label: id, attrs: {} })),
    ...ids(['x', 'y']).map((id) => ({ id, type: O, label: id, attrs: {} })),
  ],
  edges: [
    ['1', 'a', 'x'],
    ['2', 'b', 'x'],
    ['3', 'b', 'y'],
    ['4', 'c', 'y'],
  ].map(([id, s, t]) => ({
    id: toEdgeId(id ?? ''),
    source: toNodeId(s ?? ''),
    target: toNodeId(t ?? ''),
    directed: false,
    weight: 1,
    attrs: {},
  })),
  schema: [],
  meta: { title: 't' },
};
const projecting: GraphOptions = {
  ...DEFAULT_GRAPH_OPTIONS,
  projection: { target: P, via: O, method: 'shared' },
};

describe('FR-GR-03: getNetwork（射影後のグラフを 1 か所で計算して共有する）', () => {
  it('FR-GR-03: 射影しない設定では、集約後のグラフをそのまま返す', () => {
    const n = getNetwork(dataset, DEFAULT_FILTER_STATE, DEFAULT_GRAPH_OPTIONS);
    expect(n.projection.kind).toBe('none');
    expect(n.graph.order).toBe(5);
  });

  it('FR-GR-03: 射影すると射影先の型のノードだけになり、状態は applied', () => {
    const n = getNetwork(dataset, DEFAULT_FILTER_STATE, projecting);
    expect(n.projection.kind).toBe('applied');
    expect([...n.graph.nodes()].sort()).toEqual(['a', 'b', 'c']);
    expect(n.graph.size).toBe(2); // a-b（x を介す）、b-c（y を介す）
  });

  it('FR-GR-03: 同じ入力の参照なら同じ結果の参照を返す（指標と描画で計算を共有する）', () => {
    const a = getNetwork(dataset, DEFAULT_FILTER_STATE, projecting);
    const b = getNetwork(dataset, DEFAULT_FILTER_STATE, projecting);
    expect(b).toBe(a);
    expect(getNetwork(dataset, DEFAULT_FILTER_STATE, { ...projecting })).not.toBe(a);
  });

  it('D-39: フィルタは射影の前の元のデータにかかる。仲介の組織を除くと根拠から外れる', () => {
    // 【なぜ】組織 x を除いた状態（フィルタで x が見えなくなった状態）と同じデータで比べる。
    const without: Dataset = {
      ...dataset,
      nodes: dataset.nodes.filter((nd) => nd.id !== toNodeId('x')),
      edges: dataset.edges.filter((e) => e.target !== toNodeId('x')),
    };
    const n = getNetwork(without, DEFAULT_FILTER_STATE, projecting);
    expect(n.graph.size).toBe(1);
    expect(n.graph.edges().map((k) => n.graph.getEdgeAttribute(k, 'via'))).toEqual([['y']]);
  });

  it('FR-GR-03: 無効な設定（型が無い）は射影せず、理由を返す', () => {
    const bad: GraphOptions = {
      ...DEFAULT_GRAPH_OPTIONS,
      projection: { target: P, via: toNodeTypeId('missing'), method: 'newman' },
    };
    const n = getNetwork(dataset, DEFAULT_FILTER_STATE, bad);
    expect(n.projection.kind).toBe('invalid');
    if (n.projection.kind === 'invalid')
      expect(n.projection.issues.map((i) => i.code)).toEqual(['unknownVia']);
    expect(n.graph.order).toBe(5); // 射影前のグラフを返す
  });

  it('FR-GR-03: 同じ型を射影先と仲介にした設定は無効（sameType）', () => {
    const n = getNetwork(dataset, DEFAULT_FILTER_STATE, {
      ...DEFAULT_GRAPH_OPTIONS,
      projection: { target: P, via: P, method: 'shared' },
    });
    expect(n.projection.kind).toBe('invalid');
  });
});

describe('NFR-03、FR-FL-05: 大きすぎる射影の拒否と、射影後の孤立ノード', () => {
  const big = (n: number): Dataset => ({
    ...dataset,
    nodes: [
      ...Array.from({ length: n }, (_, i) => ({
        id: toNodeId('q' + String(i)),
        type: P,
        label: 'q' + String(i),
        attrs: {},
      })),
      ...dataset.nodes.filter((nd) => nd.type === O),
    ],
    edges: Array.from({ length: n }, (_, i) => ({
      id: toEdgeId('b' + String(i)),
      source: toNodeId('q' + String(i)),
      target: toNodeId('x'),
      directed: false,
      weight: 1,
      attrs: {},
    })),
  });
  it('NFR-03: 組の数が上限を超えたら射影せず、tooLarge と大きな仲介ノードを返す', () => {
    const n = getNetwork(big(201), DEFAULT_FILTER_STATE, projecting);
    expect(n.projection.kind).toBe('invalid');
    if (n.projection.kind === 'invalid') {
      const issue = n.projection.issues[0];
      expect(issue?.code).toBe('tooLarge');
      if (issue?.code === 'tooLarge') expect(issue.hubs[0]).toEqual({ id: 'x', degree: 201 });
    }
    expect(n.graph.order).toBeGreaterThan(201); // 射影前のグラフ
  });
  it('FR-FL-05: 「孤立ノードを表示しない」のとき、射影で孤立した射影先ノードを除く', () => {
    // 人物 c だけが組織 y につながる（y には他の人物がいない）。
    const lone: Dataset = {
      ...dataset,
      edges: dataset.edges.filter((e) => e.id !== toEdgeId('3')),
    };
    const hidden = getNetwork(lone, DEFAULT_FILTER_STATE, projecting).graph;
    expect([...hidden.nodes()].sort()).toEqual(['a', 'b']);
    const shown = getNetwork(lone, { ...DEFAULT_FILTER_STATE, showIsolated: true }, projecting);
    expect([...shown.graph.nodes()].sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('FR-GR-04: selectedGraphEdges（元のエッジ ID から射影したエッジを対応づける）', () => {
  const graph = getNetwork(dataset, DEFAULT_FILTER_STATE, projecting).graph;
  const keyOf = (u: string, v: string) =>
    graph.edges().find((k) => [graph.source(k), graph.target(k)].sort().join() === [u, v].join()) ??
    '';

  it('FR-GR-04: 射影したエッジの edgeIds をすべて選べば、そのエッジだけが選ばれる', () => {
    const ab = keyOf('a', 'b');
    const selected = new Set(graph.getEdgeAttribute(ab, 'edgeIds'));
    expect(selectedGraphEdges(graph, selected)).toEqual([ab]);
  });

  it('FR-GR-04: 元のエッジ 1 本だけでは、それを根拠に含む射影したエッジは選ばれない（すべてが条件）', () => {
    expect(selectedGraphEdges(graph, new Set([toEdgeId('2')]))).toEqual([]);
  });

  it('FR-GR-04: 何も選んでいなければ空', () => {
    expect(selectedGraphEdges(graph, new Set())).toEqual([]);
  });
});

describe('FR-GR-03: 指標の controller も同じ射影後のグラフを使う', () => {
  it('FR-GR-03: Worker に渡すスナップショットが、getNetwork の射影後のグラフと一致する', async () => {
    const jobs: MetricsJob[] = [];
    const controller = createMetricsController(
      {
        run: (job) => {
          jobs.push(job);
          return new Promise<MetricsResult>(() => undefined);
        },
        cancel: () => undefined,
      },
      // 待ちなしで即実行する時計（200 ms の待ちはこのテストの対象ではない）。
      {
        delay: (callback) => {
          callback();
          return () => undefined;
        },
      },
    );
    controller.update(dataset, DEFAULT_FILTER_STATE, projecting);
    await Promise.resolve();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.snapshot).toEqual(
      toSnapshot(getNetwork(dataset, DEFAULT_FILTER_STATE, projecting).graph),
    );
  });
});
