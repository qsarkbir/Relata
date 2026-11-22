import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_VIEW, parseGraphView } from '../core/project/graphView';
import { toNodeId } from '../core/model';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { DEFAULT_FILTER_STATE } from '../core/filter';
import { DEFAULT_IMPORT_SETTINGS, serializeProject, parseProject } from '../io/project';

describe('FR-PJ-01 / NFR-08: グラフ表示の保存', () => {
  it('旧設定を既定補完し、位置・固定・seed・viewport・表示を往復する', () => {
    expect(parseGraphView({})).toEqual({ ok: true, value: DEFAULT_GRAPH_VIEW });
    const id = sampleDataset().nodes[0]?.id;
    if (id === undefined) throw new Error('fixture');
    const graph = {
      ...DEFAULT_GRAPH_VIEW,
      seed: 42,
      positions: [{ id, x: 1.123456789, y: -9.5, fixed: true }],
      viewport: { x: -100, y: 200, zoom: 2 },
      graphOptions: { weight: 'count' as const, selfLoops: false },
    };
    const result = parseProject(
      serializeProject(
        {
          dataset: sampleDataset(),
          importSettings: DEFAULT_IMPORT_SETTINGS,
          view: { filter: DEFAULT_FILTER_STATE, graph },
        },
        '2026-11-21',
      ),
    );
    if (!result.ok) throw new Error(result.reason);
    expect(result.value.view.graph).toEqual(graph);
    expect(result.warnings).toEqual([]);
  });
  it('不正な型・範囲・重複した位置は明示的に拒む', () => {
    for (const field of [
      'layout',
      'seed',
      'positions',
      'labels',
      'direction',
      'viewport',
      'graphOptions',
      'encoding',
    ])
      expect(parseGraphView({ [field]: null }).ok).toBe(false);
    for (const value of [
      { seed: -1 },
      { viewport: { x: 0, y: 0, zoom: 0 } },
      { positions: [{ id: 'x', x: Infinity, y: 0, fixed: false }] },
      {
        positions: [
          { id: 'x', x: 0, y: 0, fixed: true },
          { id: 'x', x: 1, y: 1, fixed: false },
        ],
      },
    ])
      expect(parseGraphView(value).ok).toBe(false);
  });
  it('FR-PJ-01: 存在しないノードの位置は落とし、警告にしてファイルは開く', () => {
    const result = parseProject(
      serializeProject(
        {
          dataset: sampleDataset(),
          importSettings: DEFAULT_IMPORT_SETTINGS,
          view: {
            filter: DEFAULT_FILTER_STATE,
            graph: {
              ...DEFAULT_GRAPH_VIEW,
              positions: [{ id: toNodeId('unknown-node'), x: 0, y: 0, fixed: true }],
            },
          },
        },
        '2026-11-21',
      ),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { view: { graph: { positions: [] } } },
      warnings: [
        {
          source: 'project',
          issue: { kind: 'unknown-node-position', path: 'view.graph.positions[0].id' },
        },
      ],
    });
  });
});
