import { describe, expect, it } from 'vitest';
import type { Dataset } from '../core/model';
import { toNodeId, toNodeTypeId } from '../core/model';
import { DEFAULT_FILTER_STATE, toFilterId } from '../core/filter';
import type { FilterState } from '../core/filter';
import { DEFAULT_GRAPH_OPTIONS } from '../core/graph';
import { getNetwork } from '../state';
import { effectiveGeoAttrs, geoCandidates, geoInputsFor, geoLayoutState } from './geoInputs';

const person = toNodeTypeId('person');
const city = toNodeTypeId('city');

describe('FR-VG-02: 地理座標の候補の属性', () => {
  it('FR-VG-02: 同じキーの属性がノードの型ごとに定義されていても、候補はキーごとに 1 つ', () => {
    const dataset: Dataset = {
      graphMode: 'directed',
      nodeTypes: [],
      nodes: [],
      edges: [],
      schema: [
        { key: 'lat', label: '緯度', appliesTo: 'node', nodeType: person, valueType: 'number' },
        { key: 'lat', label: '緯度', appliesTo: 'node', nodeType: city, valueType: 'number' },
        { key: 'name', label: '名前', appliesTo: 'node', valueType: 'string' },
        { key: 'born', label: '生年', appliesTo: 'node', valueType: 'date' },
        { key: 'lat', label: '緯度', appliesTo: 'edge', valueType: 'number' },
      ],
      meta: { title: 't' },
    };
    // 数値の属性を先に並べ、日付とエッジの属性は除く。
    expect(geoCandidates(dataset).map((a) => a.key)).toEqual(['lat', 'name']);
  });
});

describe('FR-VG-02・D-46: 地理座標の入力は core の nodeGeo を通す', () => {
  const text = (v: string) => ({ kind: 'value' as const, value: v });
  const dataset: Dataset = {
    graphMode: 'directed',
    nodeTypes: [],
    nodes: [
      {
        id: toNodeId('a'),
        type: person,
        label: 'a',
        attrs: {},
        geo: { kind: 'point', lat: 33.3, lon: 44.4 },
      },
      {
        id: toNodeId('b'),
        type: person,
        label: 'b',
        attrs: {},
        geo: { kind: 'missing', reason: 'unrecorded' },
      },
      {
        id: toNodeId('c'),
        type: person,
        label: 'c',
        attrs: { Lat: text('37.9'), Lon: text('-4.8') },
      },
      { id: toNodeId('d'), type: person, label: 'd', attrs: { Lat: text('不明'), Lon: text('1') } },
    ],
    edges: [],
    schema: [],
    meta: { title: 't' },
  };
  const show: FilterState = { ...DEFAULT_FILTER_STATE, showIsolated: true };
  const graph = getNetwork(dataset, show, DEFAULT_GRAPH_OPTIONS).graph;

  it('FR-VG-02: 出どころが geo なら、読み込みで入れた GraphNode.geo を使う（座標が無いノードは null）', () => {
    const r = geoInputsFor(dataset, graph, { kind: 'geo' });
    expect(r.map((i) => [i.id, i.point])).toEqual([
      ['a', { lat: 33.3, lon: 44.4 }],
      ['b', null],
      ['c', null],
      ['d', null],
    ]);
  });

  it('FR-VG-02: 出どころが属性の組なら、数として読める値だけを使う（不明などは座標なし）', () => {
    const r = geoInputsFor(dataset, graph, { kind: 'attrs', lat: 'Lat', lon: 'Lon' });
    expect(r.map((i) => [i.id, i.point])).toEqual([
      ['a', null],
      ['b', null],
      ['c', { lat: 37.9, lon: -4.8 }],
      ['d', null],
    ]);
  });

  it('FR-VG-02: 表示中でないノードは入力に含めない', () => {
    const only: FilterState = {
      ...show,
      filters: [{ id: toFilterId('f'), kind: 'nodeSet', include: [toNodeId('a')] }],
    };
    const small = getNetwork(dataset, only, DEFAULT_GRAPH_OPTIONS).graph;
    const r = geoInputsFor(dataset, small, { kind: 'geo' });
    expect(r.map((i) => i.id)).toEqual(['a']);
  });

  it('FR-VG-02: 配置の状態は、座標を 1 つも取り出せなければ choose、片方だけ選んでいる間も choose、データに無い属性は not-found', () => {
    const withSchema: Dataset = {
      ...dataset,
      schema: [
        { key: 'Lat', label: '緯度', appliesTo: 'node', valueType: 'number' },
        { key: 'Lon', label: '経度', appliesTo: 'node', valueType: 'number' },
      ],
    };
    const none: Dataset = { ...withSchema, nodes: dataset.nodes.slice(2) };
    const attrs = { kind: 'attrs', lat: 'Lat', lon: 'Lon' } as const;
    expect(geoLayoutState(withSchema, { kind: 'geo' }, undefined)).toBe('ready');
    expect(geoLayoutState(none, { kind: 'geo' }, undefined)).toBe('choose');
    expect(geoLayoutState(none, attrs, { lat: 'Lat', lon: 'Lon' })).toBe('ready');
    // 属性の組を片方だけ選んでいる間は、GraphNode.geo があっても待つ（選択欄と配置を食い違わせない）。
    expect(geoLayoutState(withSchema, { kind: 'geo' }, { lat: 'Lat' })).toBe('choose');
    // データに無い属性を指す出どころは、計算せず「見つかりません」。
    expect(
      geoLayoutState(withSchema, { kind: 'attrs', lat: 'X', lon: 'Lon' }, { lat: 'X', lon: 'Lon' }),
    ).toBe('not-found');
  });

  it('FR-VG-02・FR-MP-05: 出どころが明示されていれば、旧版の geoAttrs より優先して選択欄に出す', () => {
    const attrs = { lat: 'Lat', lon: 'Lon' };
    expect(effectiveGeoAttrs(undefined, attrs)).toEqual(attrs);
    expect(effectiveGeoAttrs({ kind: 'geo' }, attrs)).toBeUndefined();
    expect(effectiveGeoAttrs({ kind: 'attrs', lat: 'A', lon: 'B' }, attrs)).toEqual({
      lat: 'A',
      lon: 'B',
    });
  });
});
