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

describe('FR-VG-02: 層状（1 つ飛ばしの列）', () => {
  it('FR-VG-02: A-B-C の 3 列で A-C の辺があっても、全列の隣接で交差を減らす', () => {
    const nodes = [
      ...['a1', 'a2'].map((id) => ({ id, type: 'A' })),
      ...['b1', 'b2'].map((id) => ({ id, type: 'B' })),
      ...['c1', 'c2'].map((id) => ({ id, type: 'C' })),
    ];
    // ID 順では a1-c2 と a2-c1 が交差する（A と C は 1 つ飛ばし）。b は a と c の中間の位置を保つ。
    const edges = [
      { source: 'a1', target: 'c2' },
      { source: 'a2', target: 'c1' },
      { source: 'a1', target: 'b2' },
      { source: 'a2', target: 'b1' },
    ];
    const r = layeredLayout(nodes, edges, ['A', 'B', 'C']);
    const y = (id: string) => r.coordinates.get(id)?.y ?? 0;
    expect(r.columns).toEqual(['A', 'B', 'C']);
    // A-C の辺が交差しない（a1 が上なら c2 も上）。
    expect(Math.sign(y('a1') - y('a2'))).toBe(Math.sign(y('c2') - y('c1')));
    expect(
      crossings(r.coordinates, [
        ['a1', 'c2'],
        ['a2', 'c1'],
      ]),
    ).toBe(0);
    expect(
      crossings(r.coordinates, [
        ['a1', 'b2'],
        ['a2', 'b1'],
      ]),
    ).toBe(0);
  });
});

describe('FR-VG-02: 地理座標の縮尺と折り返し', () => {
  const spread = (ids: string[], f: (i: number) => { lat: number; lon: number } | null) =>
    ids.map((id, i) => ({ id, point: f(i) }));
  it('FR-VG-02: 地域の点（1 度の範囲）も、長辺が 40·√V になるまで拡大する', () => {
    const inputs = spread(['a', 'b', 'c', 'd'], (i) => ({ lat: 33 + i * 0.1, lon: 44 + i * 0.1 }));
    const r = geoLayout(inputs);
    const xs = [...r.coordinates.values()].map((p) => p.x);
    const ys = [...r.coordinates.values()].map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    expect(Math.max(w, h)).toBeCloseTo(40 * Math.sqrt(4), 6);
    // 最も近い点同士が、ノードの直径（32）より離れる。
    const a = r.coordinates.get('a');
    const b = r.coordinates.get('b');
    expect(Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0))).toBeGreaterThan(32);
  });
  it('FR-VG-02: 縦横比を保つ（経度の差と緯度の差の比が拡大の前後で同じ）', () => {
    const r = geoLayout(spread(['a', 'b'], (i) => ({ lat: 10, lon: i * 20 })));
    expect(r.coordinates.get('a')?.y).toBe(r.coordinates.get('b')?.y);
  });
  it('FR-VG-02: 点が 1 つだけ、または全点が同じ座標でも、0 除算せず有限の座標になる', () => {
    const one = geoLayout([{ id: 'a', point: { lat: 33, lon: 44 } }]);
    expect(one.coordinates.get('a')?.x).toBe(220);
    const same = geoLayout(spread(['a', 'b', 'c'], () => ({ lat: 33, lon: 44 })));
    for (const p of same.coordinates.values()) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
    expect(same.coordinates.get('a')).toEqual(same.coordinates.get('b'));
  });
  it('FR-VG-02: 座標なしが多いときは複数列に折り返し、行の間隔はノードの直径より広い', () => {
    const inputs = [
      { id: 'a', point: { lat: 30, lon: 40 } },
      { id: 'b', point: { lat: 31, lon: 41 } },
      ...Array.from({ length: 30 }, (_, i) => ({
        id: `n${String(i).padStart(2, '0')}`,
        point: null,
      })),
    ];
    const r = geoLayout(inputs);
    const none = [...r.coordinates].filter(([id]) => id.startsWith('n')).map(([, p]) => p);
    const columns = new Set(none.map((p) => p.x));
    expect(columns.size).toBeGreaterThan(1);
    const rows = [...new Set(none.filter((p) => p.x === none[0]?.x).map((p) => p.y))].sort(
      (p, q) => p - q,
    );
    for (let i = 1; i < rows.length; i++)
      expect((rows[i] ?? 0) - (rows[i - 1] ?? 0)).toBeGreaterThan(32);
    // 同じ座標に重ならない。
    expect(new Set(none.map((p) => `${String(p.x)},${String(p.y)}`)).size).toBe(30);
  });
  it('FR-VG-02: Worker 側でも点を検査し直す（範囲外・NaN は座標なし）', () => {
    const r = geoLayout([
      { id: 'a', point: { lat: 200, lon: 0 } },
      { id: 'b', point: { lat: Number.NaN, lon: 0 } },
      { id: 'c', point: { lat: 1, lon: 1 } },
    ]);
    expect(r.noCoordinates).toBe(2);
  });
});

describe('FR-VG-02: 数値の属性の読み取り', () => {
  const v = (value: string | number | readonly (string | number)[]) =>
    ({ kind: 'value', value }) as const;
  it('FR-VG-02: 10 進だけを通し、アラビア・インド数字・ペルシア数字を受け付け、0x21 は拒む', () => {
    const read = (value: string | number | readonly (string | number)[]) =>
      extractGeoInputs(
        [
          {
            id: 'x',
            attrs: makeAttrs([
              ['lat', v(value)],
              ['lon', v(value)],
            ]),
          },
        ],
        'lat',
        'lon',
      )[0]?.point;
    expect(read('0x21')).toBeNull();
    expect(read('٣٣٫٣')?.lat).toBe(33.3);
    expect(read('−۱۰')?.lat).toBe(-10);
    expect(read([12])?.lat).toBe(12);
    expect(read(['12', '13'])).toBeNull();
    expect(read([])).toBeNull();
  });
});
