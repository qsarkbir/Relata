import { describe, expect, it } from 'vitest';
import { geoDataset, orgT, personT, placeT } from '../geo/fixtures/geoDataset';
import { makeAttrs, toEdgeId, toNodeId, toNodeTypeId, type Dataset } from '../model';
import type { GeoBBox, GeoSource } from '../geo';
import { applyFilters } from './apply';
import { checkFilterState } from './check';
import { describeGeoFilter } from './geoFilter';
import { parseFilterState } from './parse';
import {
  DEFAULT_FILTER_STATE,
  FILTER_KINDS,
  toFilterId,
  type FilterDef,
  type FilterState,
} from './types';

const fid = toFilterId;
type GeoDef = Extract<FilterDef, { kind: 'geo' }>;
const geoDef = (bbox: GeoBBox, extra: Partial<GeoDef> = {}): GeoDef => ({
  id: fid('g'),
  kind: 'geo',
  source: { kind: 'geo' },
  bbox,
  missing: 'exclude',
  ...extra,
});
const st = (...filters: FilterDef[]): FilterState => ({
  ...DEFAULT_FILTER_STATE,
  filters,
  // 孤立ノードも見たいので、エッジの有無によらず通過したノードを返す
  showIsolated: true,
});
const shown = (f: FilterDef): string[] => [...applyFilters(geoDataset(), st(f)).nodeIds].sort();
const attrs: GeoSource = { kind: 'attrs', lat: 'lat', lon: 'lon' };
const WORLD: GeoBBox = { west: -180, south: -90, east: 180, north: 90 };

const PLACES = ['fez', 'tunis', 'mecca', 'fiji', 'samoa', 'pole', 'lost', 'nogeo'];
const PERSONS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
const among = (ids: string[], f: FilterDef): string[] => shown(f).filter((id) => ids.includes(id));
const BOX: GeoBBox = { west: -10, south: 30, east: 0, north: 36 };

describe('geo フィルタの適用（D-58、FR-MP-04）', () => {
  it('FR-MP-04: 範囲の中の座標だけ通す。両端を含む', () => {
    // fez (34.03, -5.0)。tunis (36.8, 10.18) の端を、範囲の端にして含むことを確かめる
    expect(among(PLACES, geoDef(BOX))).toEqual(['fez']);
    expect(among(PLACES, geoDef({ west: -5.0, south: 34.03, east: 10.18, north: 36.8 }))).toEqual([
      'fez',
      'tunis',
    ]);
  });
  it('FR-MP-04: 経度 180° をまたぐ範囲（west > east）は、両側の点を通す', () => {
    // fiji 178、samoa -172 は、170 → -170 の範囲に入る。fez などは入らない
    expect(among(PLACES, geoDef({ west: 170, south: -20, east: -170, north: -10 }))).toEqual([
      'fiji',
      'samoa',
    ]);
  });
  it('FR-MP-04: south > north は、座標のあるノードを何も通さない（出どころの無い型は通る）', () => {
    const f = geoDef({ west: -180, south: 40, east: 180, north: 30 });
    expect(among(PLACES, f)).toEqual([]);
    // 人物は geo の出どころを持たない型なので、範囲に関係なく通る（D-21 (2)）
    expect(among(PERSONS, f)).toEqual(PERSONS);
  });
  it('FR-MP-04: 座標のある型の中の座標なし（欠損、項目なし、範囲外）は missing の指定に従う', () => {
    expect(among(PLACES, geoDef(WORLD, { missing: 'include' })).length).toBe(8);
    // lost は欠損、nogeo は geo が付いていない（読み込みは空欄などに geo を付けない）、pole は範囲外
    expect(among(PLACES, geoDef(WORLD, { missing: 'exclude' }))).toEqual([
      'fez',
      'fiji',
      'mecca',
      'samoa',
      'tunis',
    ]);
  });
  it('FR-MP-04: 座標の出どころを持たない型（人物、組織）は、欠損として除かない', () => {
    const exc = shown(geoDef(WORLD, { missing: 'exclude' }));
    for (const id of [...PERSONS, 'o1']) expect(exc).toContain(id);
  });
  it('FR-MP-04: 欠損で除いた件数は、座標のある型の中の座標なしだけ数える（D-21 (7)）', () => {
    const r = applyFilters(geoDataset(), st(geoDef(WORLD, { missing: 'exclude' })));
    // pole、lost、nogeo の 3 件。人物 8 人と組織は数えない
    expect(r.missingExcluded.get(fid('g'))).toBe(3);
    const inc = applyFilters(geoDataset(), st(geoDef(WORLD, { missing: 'include' })));
    expect(inc.missingExcluded.get(fid('g'))).toBe(0);
    // 出どころが attrs なら、人物の中の座標なし p4〜p8 の 5 件（地名と組織は出どころを持たない）
    const a = applyFilters(geoDataset(), st(geoDef(WORLD, { source: attrs })));
    expect(a.missingExcluded.get(fid('g'))).toBe(5);
  });
  it('FR-MP-04: 出どころが attrs なら、属性の組から座標を取る（アラビア・インド数字、配列 1 つも）', () => {
    // p1 (30.5, -6.5)、p2 (33.5, 0)、p3 (12, 5)
    expect(
      among(PERSONS, geoDef({ west: -10, south: 30, east: 0, north: 34 }, { source: attrs })),
    ).toEqual(['p1', 'p2']);
    expect(
      among(PERSONS, geoDef({ west: 0, south: 10, east: 6, north: 13 }, { source: attrs })),
    ).toEqual(['p3']);
  });
  it('FR-MP-04: 出どころが違えば、同じ範囲でも結果が違う（source はフィルタが持つ）', () => {
    expect(among([...PLACES, ...PERSONS], geoDef(BOX, { source: { kind: 'geo' } }))).toEqual([
      'fez',
      ...PERSONS,
    ]);
    expect(among([...PLACES, ...PERSONS], geoDef(BOX, { source: attrs }))).toEqual(
      [...PLACES, 'p1', 'p2'].sort(),
    );
  });
  it('FR-MP-04: passTypes の型のノードは座標に関係なく通し、欠損の件数にも数えない（D-41）', () => {
    const f = geoDef(BOX, { passTypes: [placeT] });
    expect(among(PLACES, f)).toEqual([...PLACES].sort());
    expect(applyFilters(geoDataset(), st(f)).missingExcluded.get(fid('g'))).toBe(0);
    const g = geoDef(WORLD, { source: attrs, passTypes: [personT] });
    expect(among(PERSONS, g)).toEqual(PERSONS);
    expect(applyFilters(geoDataset(), st(g)).missingExcluded.get(fid('g'))).toBe(0);
    // 組織は出どころを持たない型なので、passTypes に無くても通る
    expect(shown(geoDef(BOX, { passTypes: [orgT] }))).toContain('o1');
  });
  it('FR-MP-04: 他のフィルタとの組み合わせは、両方を通ったものだけ', () => {
    const typeOnly: FilterDef = { id: fid('t'), kind: 'nodeType', include: [placeT] };
    const r = applyFilters(geoDataset(), st(typeOnly, geoDef(WORLD)));
    expect([...r.nodeIds].sort()).toEqual(['fez', 'fiji', 'mecca', 'samoa', 'tunis']);
  });
  it('FR-MP-04: 入力のデータセットとフィルタ状態を書き換えない', () => {
    const d = geoDataset();
    const state = st(geoDef(WORLD));
    const before = JSON.stringify([d, state]);
    applyFilters(d, state);
    expect(JSON.stringify([d, state])).toBe(before);
  });
});

describe('geo フィルタと 2 部グラフのエッジの規則（D-21 (2)、FR-FL-04）', () => {
  // 人物と地名の 2 部グラフ。座標があるのは地名だけ。pole、lost、nogeo は座標のない地名。
  const link = (id: string, s: string, t: string) => ({
    id: toEdgeId(id),
    source: toNodeId(s),
    target: toNodeId(t),
    directed: false,
    weight: 1,
    attrs: makeAttrs([]),
  });
  const bip: Dataset = {
    ...geoDataset(),
    edges: [
      link('e1', 'p1', 'fez'),
      link('e2', 'p2', 'tunis'),
      link('e3', 'p3', 'mecca'),
      link('e4', 'p1', 'pole'),
      link('e5', 'p4', 'lost'),
      link('e6', 'p2', 'nogeo'),
    ],
  };
  const run = (edgeRule: 'both-ends' | 'either-end') =>
    applyFilters(bip, {
      filters: [geoDef(WORLD, { missing: 'exclude' })],
      edgeRule,
      showIsolated: false,
    });
  it('FR-FL-04: 両端の規則では、座標のある地名につながるエッジだけが残り、人物は巻き添えで消えない', () => {
    const r = run('both-ends');
    expect([...r.edgeIds].sort()).toEqual(['e1', 'e2', 'e3']);
    expect([...r.nodeIds].sort()).toEqual(['fez', 'mecca', 'p1', 'p2', 'p3', 'tunis']);
    // 除いた件数は座標のない地名の 3 件だけ。人物は数えない
    expect(r.missingExcluded.get(fid('g'))).toBe(3);
  });
  it('FR-FL-04: 片端の規則では、片方でも通ればエッジが残り、除かれた端点も表示される', () => {
    const r = run('either-end');
    expect([...r.edgeIds].sort()).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
    expect(r.nodeIds.has(toNodeId('pole'))).toBe(true);
  });
  it('FR-FL-04: 範囲に入る地名が無ければ両端の規則でエッジは 0 本（人物が除かれたからではない）', () => {
    const r = applyFilters(bip, {
      filters: [geoDef({ west: 100, south: 0, east: 110, north: 10 })],
      edgeRule: 'both-ends',
      showIsolated: true,
    });
    expect(r.edgeIds.size).toBe(0);
    for (const id of PERSONS) expect(r.nodeIds.has(toNodeId(id))).toBe(true);
  });
});

describe('geo フィルタの検査（D-46）', () => {
  it('FR-MP-04: attrs の属性が無い、日付・真偽値のものを報告する', () => {
    const issues = checkFilterState(
      geoDataset(),
      st(
        geoDef(WORLD, { id: fid('a'), source: { kind: 'attrs', lat: 'nope', lon: 'lon' } }),
        geoDef(WORLD, { id: fid('b'), source: { kind: 'attrs', lat: 'when', lon: 'flag' } }),
        geoDef(WORLD, { id: fid('ok'), source: attrs }),
        geoDef(WORLD, { id: fid('geo'), source: { kind: 'geo' } }),
      ),
    );
    expect(issues).toEqual([
      { kind: 'unknown-attr', filterId: 'a', target: 'node', attr: 'nope' },
      { kind: 'attr-not-number', filterId: 'b', attr: 'when' },
      { kind: 'attr-not-number', filterId: 'b', attr: 'flag' },
      // when、flag は座標を持つノードが 1 つも無い
      { kind: 'geo-no-coordinates', filterId: 'b' },
    ]);
  });
  it('FR-MP-04: 存在しない型の passTypes を報告する', () => {
    const f = geoDef(WORLD, { passTypes: [orgT, toNodeTypeId('ghost')] });
    expect(checkFilterState(geoDataset(), st(f))).toEqual([
      { kind: 'unknown-node-type', filterId: 'g', nodeType: 'ghost' },
    ]);
  });
});

describe('geo フィルタの parse（FR-PJ-01、D-24）', () => {
  const roundTrip = (f: FilterDef) => {
    const text = JSON.stringify(st(f));
    const r = parseFilterState(JSON.parse(text));
    expect(r.ok).toBe(true);
    return r.ok ? r.value.filters[0] : undefined;
  };
  it('FR-PJ-01: 往復で同じ値になり、passTypes が無ければ項目を作らない', () => {
    const a = geoDef({ west: 170, south: -20, east: -170, north: -10 }, { source: attrs });
    expect(roundTrip(a)).toEqual(a);
    const b = geoDef(WORLD, { passTypes: [orgT], missing: 'include' });
    expect(roundTrip(b)).toEqual(b);
    expect(Object.hasOwn(roundTrip(a) ?? {}, 'passTypes')).toBe(false);
  });
  it('FR-PJ-01: 種類の一覧に geo がある', () => {
    expect(FILTER_KINDS).toContain('geo');
  });
  const base = {
    id: 'g',
    kind: 'geo',
    source: { kind: 'geo' },
    bbox: { west: 0, south: 0, east: 1, north: 1 },
    missing: 'include',
  };
  const fails = (o: Record<string, unknown>) => parseFilterState({ filters: [o] });
  it('FR-PJ-01: south > north は失敗、west > east は正しい', () => {
    expect(fails({ ...base, bbox: { west: 0, south: 5, east: 1, north: 4 } })).toMatchObject({
      ok: false,
      path: 'filters[0].bbox.north',
    });
    expect(fails({ ...base, bbox: { west: 10, south: 0, east: -10, north: 1 } }).ok).toBe(true);
  });
  it('FR-PJ-01: source、bbox の値、missing、passTypes の不正は、経路つきで失敗', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ ...base, source: undefined }, 'filters[0].source'],
      [{ ...base, source: { kind: 'attrs', lat: 'a' } }, 'filters[0].source'],
      [{ ...base, bbox: undefined }, 'filters[0].bbox'],
      [{ ...base, bbox: { west: 0, south: 0, east: 1 } }, 'filters[0].bbox.north'],
      [{ ...base, bbox: { west: 181, south: 0, east: 1, north: 1 } }, 'filters[0].bbox.west'],
      [{ ...base, bbox: { west: 0, south: -91, east: 1, north: 1 } }, 'filters[0].bbox.south'],
      [
        { ...base, bbox: { west: 0, south: 0, east: Number.NaN, north: 1 } },
        'filters[0].bbox.east',
      ],
      [{ ...base, missing: 'x' }, 'filters[0].missing'],
      [{ ...base, passTypes: 'x' }, 'filters[0].passTypes'],
      [{ ...base, passTypes: [''] }, 'filters[0].passTypes[0]'],
    ];
    for (const [o, path] of cases) expect(fails(o)).toMatchObject({ ok: false, path });
  });
});

describe('geo フィルタの説明と空の型の検査（FR-FL-08、FR-MP-04）', () => {
  it('FR-FL-08: 座標を持つ型の一覧（ID とラベル）を説明に含める', () => {
    expect(describeGeoFilter(geoDef(WORLD), geoDataset()).coordinateTypes).toEqual([
      { id: placeT, label: 'place' },
    ]);
    expect(
      describeGeoFilter(geoDef(WORLD, { source: attrs }), geoDataset()).coordinateTypes,
    ).toEqual([{ id: personT, label: 'person' }]);
    expect(describeGeoFilter(geoDef(WORLD), undefined).coordinateTypes).toEqual([]);
  });
  it('FR-MP-04: 座標を持つ型が 1 つも無ければ geo-no-coordinates を報告する', () => {
    const d = geoDataset();
    const none = { ...d, nodes: d.nodes.filter((n) => n.type === orgT) };
    expect(checkFilterState(none, st(geoDef(WORLD)))).toEqual([
      { kind: 'geo-no-coordinates', filterId: 'g' },
    ]);
    expect(checkFilterState(d, st(geoDef(WORLD)))).toEqual([]);
    // 属性の組でも同じ（属性に値を持つノードが無い）
    expect(
      checkFilterState(
        none,
        st(geoDef(WORLD, { source: { kind: 'attrs', lat: 'lat', lon: 'lon' } })),
      ).map((i) => i.kind),
    ).toContain('geo-no-coordinates');
  });
});

describe('geo フィルタの説明（FR-FL-08）', () => {
  it('FR-FL-08: 範囲、出どころ（表示名つき）、欠損の扱い、passTypes を構造で返す', () => {
    const d = describeGeoFilter(
      geoDef({ west: -10, south: 30, east: 0, north: 36 }, { source: attrs, passTypes: [orgT] }),
      geoDataset(),
    );
    expect(d).toMatchObject({
      lat: { south: 30, north: 36 },
      lon: { west: -10, east: 0 },
      crossesAntimeridian: false,
      reversed: false,
      source: {
        kind: 'attrs',
        lat: 'lat',
        lon: 'lon',
        latLabel: 'Latitude',
        lonLabel: 'Longitude',
      },
      missing: 'exclude',
      passTypes: [orgT],
    });
  });
  it('FR-FL-08: 180° をまたぐ範囲と、データセット無し（表示名なし）', () => {
    const d = describeGeoFilter(
      geoDef({ west: 170, south: -20, east: -170, north: -10 }, { source: attrs }),
      undefined,
    );
    expect(d.crossesAntimeridian).toBe(true);
    expect(d.source).toMatchObject({ kind: 'attrs', latLabel: undefined });
    expect(describeGeoFilter(geoDef(WORLD), undefined).source).toEqual({ kind: 'geo' });
  });
});
