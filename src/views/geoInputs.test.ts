import { describe, expect, it } from 'vitest';
import type { Dataset } from '../core/model';
import { toNodeTypeId } from '../core/model';
import { geoCandidates } from './geoInputs';

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
