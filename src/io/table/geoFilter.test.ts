/**
 * 本物の 2 表の読み込み（`importTables`）を通した `geo` フィルタ（D-58、D-21 (2)、FR-MP-04）。
 *
 * 人物の緯度・経度が空欄だと、読み込みは人物の `geo` を欠損にする。それでも人物は「座標を持つ型」
 * として扱われず、地名だけに座標がある 2 部グラフで、人物とエッジが巻き添えで消えてはいけない。
 */
import { describe, expect, it } from 'vitest';
import { applyFilters, toFilterId, type FilterDef } from '../../core/filter';
import type { GeoSource } from '../../core/geo';
import { importTables } from './dataset';
import type { TableMapping } from './dataset';
import { parseTextTable } from './text';

const NODES =
  'id,label,type,lat,lon\n1,Ali,person,,\n2,Fes,place,34.03,-5\n3,Tunis,place,36.8,10.18';
const EDGES = 'source,target\n1,2\n1,3';
const edgeMapping: TableMapping = { fields: { source: 0, target: 1 }, attributes: [] };
// 座標を特殊列（lat、lon）として読む → `GraphNode.geo`
const geoMapping: TableMapping = {
  fields: { id: 0, label: 1, type: 2, lat: 3, lon: 4 },
  attributes: [],
};
// 座標を属性として読む → `attrs`
const attrMapping: TableMapping = {
  fields: { id: 0, label: 1, type: 2 },
  attributes: [
    { column: 3, key: 'lat', label: 'lat', type: 'number' },
    { column: 4, key: 'lon', label: 'lon', type: 'number' },
  ],
};

function run(mapping: TableMapping, source: GeoSource, edgeRule: 'both-ends' | 'either-end') {
  const imported = importTables(parseTextTable(NODES), parseTextTable(EDGES), mapping, edgeMapping);
  if (imported.dataset === null) throw new Error('読み込みに失敗');
  const f: FilterDef = {
    id: toFilterId('g'),
    kind: 'geo',
    source,
    // 両方の地名（Fes、Tunis）を含む範囲
    bbox: { west: -10, south: 30, east: 20, north: 40 },
    missing: 'exclude',
  };
  const dataset = imported.dataset;
  const r = applyFilters(dataset, { filters: [f], edgeRule, showIsolated: false });
  const labelOf = (id: string) => dataset.nodes.find((n) => n.id === id)?.label;
  return { r, labels: [...r.nodeIds].map((id) => labelOf(id)).sort(), dataset };
}

describe('FR-MP-04: 人物の座標が空欄の 2 表を読んだ後の geo フィルタ', () => {
  it('FR-MP-04: 前提: 人物の geo は欠損になる（読み込みの実際の挙動）', () => {
    const { dataset } = run(geoMapping, { kind: 'geo' }, 'both-ends');
    expect(dataset.nodes[0]?.geo).toEqual({ kind: 'missing', reason: 'unrecorded' });
  });
  for (const [name, mapping, source] of [
    ['geo', geoMapping, { kind: 'geo' }],
    ['attrs', attrMapping, { kind: 'attrs', lat: 'lat', lon: 'lon' }],
  ] as const) {
    it(`FR-MP-04: 出どころが ${name} でも、両端の規則で人物と地名へのエッジ 2 本が残る`, () => {
      const { r, labels } = run(mapping, source, 'both-ends');
      expect(labels).toEqual(['Ali', 'Fes', 'Tunis']);
      expect(r.edgeIds.size).toBe(2);
      // 人物は座標を持つ型ではないので、欠損として除いた件数に数えない
      expect(r.missingExcluded.get(toFilterId('g'))).toBe(0);
    });
    it(`FR-MP-04: 出どころが ${name} でも、片端の規則でエッジ 2 本が残る`, () => {
      expect(run(mapping, source, 'either-end').r.edgeIds.size).toBe(2);
    });
  }
});
