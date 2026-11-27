import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTER_STATE } from '../core/filter';
import type { FilterState } from '../core/filter';
import { toFilterId } from '../core/filter';
import { DEFAULT_GRAPH_OPTIONS } from '../core/graph';
import type { Dataset, GraphNode } from '../core/model';
import { toEdgeId, toNodeId, toNodeTypeId } from '../core/model';
import { getNetwork } from './networkView';
import { placeNodes } from './mapPlacement';

const PERSON = toNodeTypeId('person');
const PLACE = toNodeTypeId('place');

const place = (id: string, geo?: GraphNode['geo'], attrs: GraphNode['attrs'] = {}): GraphNode => ({
  id: toNodeId(id),
  type: PLACE,
  label: id,
  attrs,
  ...(geo === undefined ? {} : { geo }),
});
const person = (id: string): GraphNode => ({
  id: toNodeId(id),
  type: PERSON,
  label: id,
  attrs: {},
});
const edge = (id: string, s: string, t: string) => ({
  id: toEdgeId(id),
  source: toNodeId(s),
  target: toNodeId(t),
  directed: true,
  weight: 1,
  attrs: {},
});

/** 地名 3 つ（座標あり、欠損、範囲外）と人物 2 人（座標の列が無い）。 */
const dataset: Dataset = {
  graphMode: 'directed',
  nodeTypes: [
    { id: PERSON, label: 'Person' },
    { id: PLACE, label: 'Place' },
  ],
  nodes: [
    place('baghdad', { kind: 'point', lat: 33.3, lon: 44.4 }),
    place('unknown', { kind: 'missing', reason: 'unrecorded' }),
    place('pole', { kind: 'point', lat: 89, lon: 0 }),
    person('ali'),
    person('omar'),
  ],
  edges: [
    edge('e1', 'ali', 'baghdad'),
    edge('e2', 'omar', 'baghdad'),
    edge('e3', 'baghdad', 'unknown'),
  ],
  schema: [],
  meta: { title: 't' },
};

const SHOW_ALL: FilterState = { ...DEFAULT_FILTER_STATE, showIsolated: true };

describe('FR-MP-05: 地図に載らないノードの仕分け', () => {
  it('FR-MP-05: 理由ごとに数える（座標の列が無い型、欠損、範囲外）', () => {
    const { graph } = getNetwork(dataset, SHOW_ALL, DEFAULT_GRAPH_OPTIONS);
    const r = placeNodes(dataset, graph, { kind: 'geo' });
    expect(r.placed.map((p) => p.id)).toEqual(['baghdad']);
    expect(r.counts).toEqual({ 'no-column': 2, missing: 1, invalid: 0, 'out-of-range': 1 });
    expect(r.unplaced.map((u) => [u.id, u.reason])).toEqual([
      ['unknown', 'missing'],
      ['pole', 'out-of-range'],
      ['ali', 'no-column'],
      ['omar', 'no-column'],
    ]);
    expect(r.bbox).toEqual({ west: 44.4, south: 33.3, east: 44.4, north: 33.3 });
  });

  it('FR-MP-05: 端のどちらかが座標なしのエッジを数える（表示中のエッジから）', () => {
    const { graph } = getNetwork(dataset, SHOW_ALL, DEFAULT_GRAPH_OPTIONS);
    const r = placeNodes(dataset, graph, { kind: 'geo' });
    // e1、e2 は人物（座標なし）、e3 は欠損の地名につながる。3 本とも描けない。
    expect(r.edgeTotal).toBe(3);
    expect(r.edgesWithoutCoordinates).toBe(3);
  });

  it('FR-MP-05: 対象は絞り込み後の表示中のノードだけ（絞り込むと件数が変わる）', () => {
    const only: FilterState = {
      ...SHOW_ALL,
      filters: [
        { id: toFilterId('f1'), kind: 'nodeSet', include: [toNodeId('baghdad'), toNodeId('ali')] },
      ],
    };
    const { graph } = getNetwork(dataset, only, DEFAULT_GRAPH_OPTIONS);
    const r = placeNodes(dataset, graph, { kind: 'geo' });
    expect(r.placed.map((p) => p.id)).toEqual(['baghdad']);
    expect(r.unplaced.map((u) => u.id)).toEqual(['ali']);
    expect(r.counts['no-column']).toBe(1);
    expect(r.counts.missing).toBe(0);
    // 残ったエッジは e1（ali → baghdad）だけ。人物 ali に座標が無いので描けない。
    expect(r.edgeTotal).toBe(1);
    expect(r.edgesWithoutCoordinates).toBe(1);
  });

  it('FR-MP-05: 出どころが属性の組なら、数として読めない値は invalid になる', () => {
    const text = (v: string) => ({ kind: 'value' as const, value: v });
    const ds: Dataset = {
      ...dataset,
      nodes: [
        place('a', undefined, { Lat: text('33.3'), Lon: text('44.4') }),
        place('b', undefined, { Lat: text('不明'), Lon: text('44.4') }),
        place('c', undefined, { Lat: { kind: 'missing', reason: 'lost' }, Lon: text('44.4') }),
      ],
      edges: [],
    };
    const { graph } = getNetwork(ds, SHOW_ALL, DEFAULT_GRAPH_OPTIONS);
    const r = placeNodes(ds, graph, { kind: 'attrs', lat: 'Lat', lon: 'Lon' });
    expect(r.placed.map((p) => p.id)).toEqual(['a']);
    expect(r.counts).toEqual({ 'no-column': 0, missing: 1, invalid: 1, 'out-of-range': 0 });
  });

  it('FR-MP-05: 座標のあるノードが 1 つも無ければ bbox は null', () => {
    const { graph } = getNetwork(dataset, SHOW_ALL, DEFAULT_GRAPH_OPTIONS);
    const r = placeNodes(dataset, graph, { kind: 'attrs', lat: 'x', lon: 'y' });
    expect(r.placed).toEqual([]);
    expect(r.bbox).toBeNull();
    expect(r.unplaced).toHaveLength(5);
  });
});
