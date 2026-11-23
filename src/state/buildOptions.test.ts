import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_VIEW } from '../core/project';
import { DEFAULT_GRAPH_OPTIONS } from '../core/graph';
import { toNodeId, toNodeTypeId } from '../core/model';
import type { Dataset } from '../core/model';
import { createDataStore } from './dataStore';
import { createGraphViewStore, selectGraphOptions } from './graphViewStore';
import { createBuildOptions } from './buildOptions';

const projection = {
  target: toNodeTypeId('person'),
  via: toNodeTypeId('org'),
  method: 'shared',
} as const;

function setup() {
  const graph = createGraphViewStore();
  const data = createDataStore();
  const build = createBuildOptions(graph, data);
  return { graph, data, build };
}

describe('FR-GR-03: buildOptions（構築の設定の変更と、元に戻す・やり直す）', () => {
  it('FR-GR-03: 射影を入れると view.graph.graphOptions に保存され、元に戻せる', () => {
    const { graph, build } = setup();
    build.apply((c) => ({ ...c, projection }));
    expect(selectGraphOptions(graph.getState()).projection).toEqual(projection);
    build.undo();
    expect(selectGraphOptions(graph.getState())).toEqual(DEFAULT_GRAPH_OPTIONS);
    build.redo();
    expect(selectGraphOptions(graph.getState()).projection).toEqual(projection);
  });

  it('FR-GR-03: 変化の無い設定は履歴に積まない', () => {
    const { build } = setup();
    build.apply((c) => ({ ...c }));
    expect(build.history.getState().past).toHaveLength(0);
  });

  it('FR-GR-03: 新しい変更をすると、やり直しの履歴は捨てる', () => {
    const { build } = setup();
    build.apply((c) => ({ ...c, selfLoops: false }));
    build.undo();
    build.apply((c) => ({ ...c, weight: 'count' }));
    expect(build.history.getState().future).toHaveLength(0);
  });

  it('FR-GR-03: 射影の設定が変わると、固定していない位置を捨てて配置を計算し直させる（固定は残す）', () => {
    const { graph, build } = setup();
    graph.getState().setView({
      ...DEFAULT_GRAPH_VIEW,
      positions: [
        { id: toNodeId('a'), x: 1, y: 2, fixed: false },
        { id: toNodeId('b'), x: 3, y: 4, fixed: true },
      ],
    });
    build.apply((c) => ({ ...c, selfLoops: false }));
    expect(graph.getState().view?.positions).toHaveLength(2); // 重みと自己ループでは変えない
    build.apply((c) => ({ ...c, projection }));
    expect(graph.getState().view?.positions.map((p) => p.id)).toEqual(['b']);
  });

  it('FR-GR-03: プロジェクトを開くなど外から設定が置き換わったら、履歴を捨てる', () => {
    const { graph, build } = setup();
    build.apply((c) => ({ ...c, projection }));
    graph.getState().setView({
      ...DEFAULT_GRAPH_VIEW,
      graphOptions: { ...DEFAULT_GRAPH_OPTIONS, weight: 'count' },
    });
    expect(build.history.getState().past).toHaveLength(0);
  });

  it('FR-GR-03: データを置き換えたら、履歴を捨てる', () => {
    const { data, build } = setup();
    build.apply((c) => ({ ...c, projection }));
    data.getState().setDataset(emptyDataset);
    expect(build.history.getState().past).toHaveLength(0);
  });
});

const emptyDataset: Dataset = {
  graphMode: 'undirected',
  nodeTypes: [],
  nodes: [],
  edges: [],
  schema: [],
  meta: { title: 'x' },
};
