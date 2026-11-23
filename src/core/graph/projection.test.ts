import { describe, expect, it } from 'vitest';
import {
  makeAttrs,
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type Dataset,
  type GraphEdge,
  type GraphMode,
} from '../model';
import { applyFilters, DEFAULT_FILTER_STATE, type FilterResult } from '../filter';
import { computeMetrics } from '../metrics';
import {
  DEFAULT_GRAPH_OPTIONS,
  buildGraph,
  parseGraphOptions,
  projectGraph,
  toSnapshot,
  validateProjection,
  type ProjectionMethod,
  type ProjectionOptions,
} from './index';

const P = toNodeTypeId('person');
const O = toNodeTypeId('org');
const L = toNodeTypeId('place');

function mk(
  mode: GraphMode,
  nodes: [string, string][],
  edges: [string, string, string][],
  directed = false,
): Dataset {
  return {
    graphMode: mode,
    nodeTypes: [
      { id: P, label: '人物' },
      { id: O, label: '組織' },
      { id: L, label: '場所' },
    ],
    nodes: nodes.map(([id, t]) => ({
      id: toNodeId(id),
      type: toNodeTypeId(t),
      label: id,
      attrs: makeAttrs([]),
    })),
    edges: edges.map(([id, s, t]): GraphEdge => ({
      id: toEdgeId(id),
      source: toNodeId(s),
      target: toNodeId(t),
      directed,
      weight: 5, // 元の重みは射影に使わないことを確かめる
      attrs: makeAttrs([]),
    })),
    schema: [],
    meta: { title: 't' },
  };
}

function all(d: Dataset): FilterResult {
  return {
    nodeIds: new Set(d.nodes.map((n) => n.id)),
    edgeIds: new Set(d.edges.map((e) => e.id)),
    missingExcluded: new Map(),
    counts: {
      nodes: { shown: d.nodes.length, total: d.nodes.length },
      edges: { shown: d.edges.length, total: d.edges.length },
    },
  };
}

// 人物 A、B、C、D（孤立）と組織 X（A,B,C）、Y（A,B）、Z（C）。場所 S は A と B をつなぐ（k 部の確認用）。
const NODES: [string, string][] = [
  ['A', 'person'],
  ['B', 'person'],
  ['C', 'person'],
  ['D', 'person'],
  ['X', 'org'],
  ['Y', 'org'],
  ['Z', 'org'],
  ['S', 'place'],
];
const EDGES: [string, string, string][] = [
  ['e1', 'A', 'X'],
  ['e2', 'B', 'X'],
  ['e3', 'C', 'X'],
  ['e4', 'A', 'Y'],
  ['e5', 'B', 'Y'],
  ['e6', 'C', 'Z'],
  ['e7', 'A', 'S'],
  ['e8', 'B', 'S'],
];
const proj = (method: ProjectionMethod): ProjectionOptions => ({ target: P, via: O, method });

function weights(d: Dataset, method: ProjectionMethod): Record<string, number> {
  const g = projectGraph(buildGraph(d, all(d)), proj(method)).graph;
  const r: Record<string, number> = {};
  g.forEachEdge((_e, a, s, t) => {
    r[[s, t].sort().join('-')] = a.weight;
  });
  return r;
}

describe('FR-GR-03: 3 方式の重み（手計算。networkx の bipartite の 3 関数と同じ定義）', () => {
  const d = mk('undirected', NODES, EDGES);
  // networkx 相当: weighted_projected_graph で A-B=2、A-C=1、B-C=1（手計算）。
  it('FR-GR-03: shared は共通の仲介ノードの数', () => {
    expect(weights(d, 'shared')).toEqual({ 'A-B': 2, 'A-C': 1, 'B-C': 1 });
  });
  // collaboration_weighted_projected_graph 相当: X の d=3 で 1/2、Y の d=2 で 1。A-B=1.5。
  it('FR-GR-03: newman は 1/(d_k − 1) の和', () => {
    expect(weights(d, 'newman')).toEqual({ 'A-B': 1.5, 'A-C': 0.5, 'B-C': 0.5 });
  });
  // overlap_weighted_projected_graph(jaccard=True) 相当: N(A)=N(B)={X,Y}、N(C)={X,Z}。
  it('FR-GR-03: jaccard は共通 / 和集合', () => {
    const w = weights(d, 'jaccard');
    expect(w['A-B']).toBe(1);
    expect(w['A-C']).toBeCloseTo(1 / 3);
    expect(w['B-C']).toBeCloseTo(1 / 3);
  });
  it('FR-GR-03: 射影先のノードは孤立していても残り、仲介ノードは残らない', () => {
    const g = projectGraph(buildGraph(d, all(d)), proj('shared')).graph;
    expect(g.nodes().sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(g.degree('D')).toBe(0);
    expect(g.type).toBe('undirected');
  });
  it('FR-GR-03: 入力のグラフを書き換えず、元の重みは使わない', () => {
    const g0 = buildGraph(d, all(d));
    const before = JSON.stringify(g0.export());
    projectGraph(g0, proj('shared'));
    expect(JSON.stringify(g0.export())).toBe(before);
  });
});

describe('FR-GR-04: 根拠の仲介ノードと元のエッジ ID', () => {
  it('FR-GR-04: via と edgeIds は昇順で、選択の対応づけ（D-40）に使える', () => {
    const d = mk('undirected', NODES, EDGES);
    const g = projectGraph(buildGraph(d, all(d)), proj('shared')).graph;
    const ab = g.getEdgeAttributes(g.undirectedEdge('A', 'B') ?? '');
    expect(ab.via).toEqual(['X', 'Y']);
    expect(ab.edgeIds).toEqual(['e1', 'e2', 'e4', 'e5']);
    expect(ab.count).toBe(2);
    const ac = g.getEdgeAttributes(g.undirectedEdge('A', 'C') ?? '');
    expect(ac.via).toEqual(['X']);
    expect(ac.edgeIds).toEqual(['e1', 'e3']);
  });
  it('FR-GR-04: フィルタで仲介（Y）が除かれると、根拠から外れる', () => {
    const d = mk('undirected', NODES, EDGES);
    const fr = all(d);
    const nodeIds = new Set(fr.nodeIds);
    nodeIds.delete(toNodeId('Y'));
    const edgeIds = new Set([...fr.edgeIds].filter((e) => e !== 'e4' && e !== 'e5'));
    const g = projectGraph(buildGraph(d, { ...fr, nodeIds, edgeIds }), proj('shared')).graph;
    const ab = g.getEdgeAttributes(g.undirectedEdge('A', 'B') ?? '');
    expect(ab.via).toEqual(['X']);
    expect(ab.weight).toBe(1);
  });
  it('FR-GR-04: applyFilters の結果（絞り込み後の集合）から計算できる', () => {
    const d = mk('undirected', NODES, EDGES);
    const g = projectGraph(
      buildGraph(d, applyFilters(d, DEFAULT_FILTER_STATE)),
      proj('shared'),
    ).graph;
    expect(g.size).toBe(3);
  });
});

describe('FR-GR-05: k 部グラフで、射影先と仲介を指定する', () => {
  const d = mk('undirected', NODES, EDGES);
  it('FR-GR-05: 人物を場所で射影すると A-B だけ', () => {
    const g = projectGraph(buildGraph(d, all(d)), { target: P, via: L, method: 'shared' }).graph;
    expect(g.size).toBe(1);
    expect(g.getEdgeAttributes(g.undirectedEdge('A', 'B') ?? '').via).toEqual(['S']);
  });
  it('FR-GR-05: 組織を人物で射影できる（型を入れ替える）', () => {
    const g = projectGraph(buildGraph(d, all(d)), { target: O, via: P, method: 'shared' }).graph;
    expect(g.nodes().sort()).toEqual(['X', 'Y', 'Z']);
    expect(g.getEdgeAttributes(g.undirectedEdge('X', 'Y') ?? '').via).toEqual(['A', 'B']);
  });
  it('FR-GR-05: 設定の検査（存在しない型、同じ型）', () => {
    expect(validateProjection(proj('shared'), d)).toEqual([]);
    const bad = { target: toNodeTypeId('nope'), via: O, method: 'shared' } as const;
    expect(validateProjection(bad, d)).toEqual([{ code: 'unknownTarget', type: 'nope' }]);
    expect(validateProjection({ target: P, via: toNodeTypeId('x'), method: 'shared' }, d)).toEqual([
      { code: 'unknownVia', type: 'x' },
    ]);
    expect(validateProjection({ target: P, via: P, method: 'shared' }, d)).toEqual([
      { code: 'sameType', type: 'person' },
    ]);
  });
});

describe('FR-GR-03: 有向グラフと自己ループ', () => {
  it('FR-GR-03: 有向は無向として射影し、directedAsUndirected を返す', () => {
    const d = mk('directed', NODES, EDGES, true);
    const r = projectGraph(buildGraph(d, all(d)), proj('shared'));
    expect(r.warnings).toEqual([{ code: 'directedAsUndirected' }]);
    expect(r.graph.getEdgeAttributes(r.graph.undirectedEdge('A', 'B') ?? '').weight).toBe(2);
  });
  it('FR-GR-03: 無向なら注意は出ない', () => {
    const d = mk('undirected', NODES, EDGES);
    expect(projectGraph(buildGraph(d, all(d)), proj('shared')).warnings).toEqual([]);
  });
  it('FR-GR-03: 自己ループは無視する', () => {
    const d = mk('undirected', NODES, [...EDGES, ['e9', 'A', 'A'], ['e10', 'X', 'X']]);
    const g = projectGraph(buildGraph(d, all(d)), proj('shared')).graph;
    expect(g.size).toBe(3);
    expect(g.edges().some((e) => g.isSelfLoop(e))).toBe(false);
  });
});

describe('FR-GR-03: GraphOptions.projection の読み込み', () => {
  it('FR-GR-03: 無ければ既定と同じ（projection の項目を作らない）', () => {
    const r = parseGraphOptions({});
    expect(r).toEqual({ ok: true, value: DEFAULT_GRAPH_OPTIONS });
  });
  it('FR-GR-03: 正しい設定は読める', () => {
    const r = parseGraphOptions({ projection: { target: 'person', via: 'org', method: 'newman' } });
    expect(r).toEqual({
      ok: true,
      value: { ...DEFAULT_GRAPH_OPTIONS, projection: proj('newman') },
    });
  });
  it('FR-GR-03: 不正な設定は失敗にする', () => {
    for (const projection of [
      1,
      {},
      { target: 'a', via: 'b' },
      { target: 'a', via: '', method: 'shared' },
      { target: 'a', via: 'b', method: 'x' },
    ]) {
      expect(parseGraphOptions({ projection }).ok).toBe(false);
    }
  });
});

describe('FR-MT-05: 射影の後は二部グラフへの注意が消える', () => {
  it('FR-MT-05: 射影前は multipleNodeTypes、射影後は出ない', () => {
    const d = mk('undirected', NODES, EDGES);
    const g = buildGraph(d, all(d));
    const before = computeMetrics(toSnapshot(g)).notes.map((n) => n.code);
    expect(before).toContain('multipleNodeTypes');
    const after = computeMetrics(toSnapshot(projectGraph(g, proj('shared')).graph)).notes;
    expect(after.map((n) => n.code)).not.toContain('multipleNodeTypes');
  });
});
