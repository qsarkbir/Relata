import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '../graph';
import { makeAttrs, toNodeId, toNodeTypeId } from '../model';
import { createLayoutSession } from './compute';
import { countNoCoordinates, extractGeoInputs, geoLayout, mercator, validGeoPoint } from './geo';
import { layeredLayout, resolveColumnOrder } from './layered';

// 交差を直接数える補助（2 つの列の間の辺だけ）。
function crossings(
  coords: ReadonlyMap<string, { x: number; y: number }>,
  edges: readonly [string, string][],
): number {
  let n = 0;
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i] ?? ['', ''];
      const [c, d] = edges[j] ?? ['', ''];
      const ya = coords.get(a)?.y ?? 0;
      const yb = coords.get(b)?.y ?? 0;
      const yc = coords.get(c)?.y ?? 0;
      const yd = coords.get(d)?.y ?? 0;
      if ((ya - yc) * (yb - yd) < 0) n++;
    }
  return n;
}

describe('FR-VG-02: 層状の配置', () => {
  const nodes = [
    ...['p1', 'p2', 'p3'].map((id) => ({ id, type: 'person' })),
    ...['o1', 'o2', 'o3'].map((id) => ({ id, type: 'org' })),
  ];
  // ID 順のままだと p1-o3, p2-o2, p3-o1 が全部交差する。
  const edges = [
    { source: 'p1', target: 'o3' },
    { source: 'p2', target: 'o2' },
    { source: 'p3', target: 'o1' },
  ];
  it('FR-VG-02: 型ごとに列を分け、重心法で交差が 0 になる', () => {
    const r = layeredLayout(nodes, edges, []);
    expect(r.columns).toEqual(['org', 'person']);
    const pairs = edges.map((e): [string, string] => [e.source, e.target]);
    expect(crossings(r.coordinates, pairs)).toBe(0);
    expect(r.coordinates.get('o1')?.x).toBe(0);
    expect(r.coordinates.get('p1')?.x).toBeGreaterThan(0);
  });
  it('FR-VG-02: 列の順の指定が先になり、無い型や重複は無視する', () => {
    expect(resolveColumnOrder(['a', 'b', 'c'], ['c', 'zzz', 'c', 'a'])).toEqual(['c', 'a', 'b']);
    const r = layeredLayout(nodes, edges, ['person', 'org']);
    expect(r.coordinates.get('p1')?.x).toBe(0);
  });
  it('FR-VG-02: 型が 1 つなら 1 列で、ID の昇順に並ぶ（辺は無視）', () => {
    const r = layeredLayout(
      [
        { id: 'b', type: 't' },
        { id: 'a', type: 't' },
      ],
      [{ source: 'a', target: 'b' }],
      [],
    );
    expect(r.columns).toEqual(['t']);
    expect((r.coordinates.get('a')?.y ?? 0) < (r.coordinates.get('b')?.y ?? 0)).toBe(true);
    expect(layeredLayout([], [], []).coordinates.size).toBe(0);
  });
  it('FR-VG-02: 決定的で、自己ループ・多重エッジ・孤立ノードがあっても全ノードに座標がある', () => {
    const more = [...nodes, { id: 'iso', type: 'org' }];
    const noisy = [...edges, ...edges, { source: 'p1', target: 'p1' }];
    const a = layeredLayout(more, noisy, []);
    const b = layeredLayout(more, noisy, []);
    expect([...a.coordinates]).toEqual([...b.coordinates]);
    expect(a.coordinates.size).toBe(more.length);
  });
});

describe('FR-VG-02: 地理座標の配置', () => {
  it('FR-VG-02: メルカトル。赤道・本初子午線は原点、北は上、経度は線形', () => {
    expect(mercator({ lat: 0, lon: 0 })).toEqual({ x: 0, y: 0 });
    expect(mercator({ lat: 40, lon: 0 }).y).toBeLessThan(0);
    expect(mercator({ lat: 0, lon: 90 }).x).toBeCloseTo(2 * mercator({ lat: 0, lon: 45 }).x, 9);
    // 85.0511 度で y が x（経度 180 度）と同じ大きさになる（正方形の世界地図）。
    expect(-mercator({ lat: 85.0511287798, lon: 0 }).y).toBeCloseTo(
      mercator({ lat: 0, lon: 180 }).x,
      3,
    );
  });
  it('FR-VG-02: 数でない値・範囲外・複数値・欠損は座標なし', () => {
    const attrs = (lat: unknown, lon: unknown) =>
      makeAttrs([
        ['lat', lat as never],
        ['lon', lon as never],
      ]);
    const v = (value: string | number | boolean | readonly (string | number)[]) =>
      ({ kind: 'value', value }) as const;
    const nodes = [
      { id: 'ok', attrs: attrs(v(33.3), v(44.4)) },
      { id: 'str', attrs: attrs(v('33.3'), v(' 44.4 ')) },
      { id: 'text', attrs: attrs(v('Baghdad'), v(44)) },
      { id: 'range', attrs: attrs(v(91), v(0)) },
      { id: 'pole', attrs: attrs(v(89), v(0)) },
      { id: 'lon', attrs: attrs(v(0), v(181)) },
      { id: 'multi', attrs: attrs(v([1, 2]), v(3)) },
      { id: 'missing', attrs: attrs({ kind: 'missing', reason: 'unrecorded' }, v(3)) },
      { id: 'bool', attrs: attrs(v(true), v(3)) },
      { id: 'nan', attrs: attrs(v(Number.NaN), v(3)) },
      { id: 'none', attrs: makeAttrs([]) },
    ];
    const inputs = extractGeoInputs(nodes, 'lat', 'lon');
    expect(inputs.filter((i) => i.point !== null).map((i) => i.id)).toEqual(['ok', 'str']);
    expect(countNoCoordinates(inputs)).toBe(9);
    expect(validGeoPoint(-85.06, 0)).toBeNull();
    expect(validGeoPoint(-85, -180)).not.toBeNull();
  });
  it('FR-VG-02: 座標なしのノードは地図の右の 1 列に、ID 順で置き、消さない', () => {
    const r = geoLayout([
      { id: 'z', point: null },
      { id: 'a', point: { lat: 30, lon: 40 } },
      { id: 'b', point: { lat: 35, lon: 50 } },
      { id: 'n', point: null },
    ]);
    expect(r.noCoordinates).toBe(2);
    expect(r.coordinates.size).toBe(4);
    const maxMapX = Math.max(r.coordinates.get('a')?.x ?? 0, r.coordinates.get('b')?.x ?? 0);
    expect(r.coordinates.get('n')?.x).toBeGreaterThan(maxMapX);
    expect(r.coordinates.get('n')?.x).toBe(r.coordinates.get('z')?.x);
    expect((r.coordinates.get('n')?.y ?? 0) < (r.coordinates.get('z')?.y ?? 0)).toBe(true);
    expect(geoLayout([{ id: 'q', point: null }]).coordinates.get('q')).toEqual({ x: 0, y: 0 });
  });
});

describe('FR-VG-02: 配置の session', () => {
  const attrs = { weight: 1, count: 1, edgeIds: [], directed: false, missingWeightCount: 0 };
  const snapshot: GraphSnapshot = {
    options: { type: 'undirected', multi: false, allowSelfLoops: true },
    attributes: {},
    nodes: [
      ['p1', 'person'],
      ['p2', 'person'],
      ['o1', 'org'],
    ].map(([key, type]) => ({
      key: key ?? '',
      attributes: { type: toNodeTypeId(type ?? ''), label: key ?? '' },
    })),
    edges: [{ key: 'e', source: 'p1', target: 'o1', attributes: attrs }],
  };
  it('FR-VG-02: 層状は同じ入力で同じ結果。ピン留めした座標は動かさない', () => {
    const options = { kind: 'layered', seed: 1, columnOrder: ['person', 'org'] } as const;
    const a = createLayoutSession({ snapshot, options }).step(5);
    expect(a).toEqual(createLayoutSession({ snapshot, options }).step(0));
    const pin = { id: toNodeId('p1'), x: 7, y: 8, fixed: true };
    const b = createLayoutSession({ snapshot, options: { ...options, positions: [pin] } }).step(0);
    expect(b.positions.find((p) => p.id === 'p1')).toEqual(pin);
  });
  it('FR-VG-02: 地理座標は座標なしの件数を返し、入力に無いノードも座標なしにする', () => {
    const geo = [{ id: 'p1', point: { lat: 10, lon: 20 } }];
    const r = createLayoutSession({
      snapshot,
      options: { kind: 'geo', seed: 1, geo },
    }).step(0);
    expect(r.noCoordinates).toBe(2);
    expect(r.positions).toHaveLength(3);
    expect(() => createLayoutSession({ snapshot, options: { kind: 'geo', seed: 1 } })).toThrow(
      RangeError,
    );
  });
});
