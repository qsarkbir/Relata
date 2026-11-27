import { describe, expect, it } from 'vitest';
import { extractGeoInputs } from '../layout/geo';
import { makeAttrs } from '../model';
import { geoDataset } from './fixtures/geoDataset';
import {
  checkGeoCoordinate,
  geoSourceTypes,
  DEFAULT_GEO_SOURCE,
  nodeGeo,
  nodeGeoPoint,
  parseGeoSourceValue,
  sameGeoSource,
  type GeoSource,
} from './source';

const attrsSource: GeoSource = { kind: 'attrs', lat: 'lat', lon: 'lon' };
const byId = (id: string) => {
  const n = geoDataset().nodes.find((x) => x.id === id);
  if (n === undefined) throw new Error(id);
  return n;
};

describe('nodeGeo（出どころ geo。D-46、FR-MP-05）', () => {
  it('FR-MP-05: geo の点は座標になる', () => {
    expect(nodeGeo(byId('fez'), DEFAULT_GEO_SOURCE)).toEqual({
      kind: 'point',
      lat: 34.03,
      lon: -5.0,
    });
  });
  it('FR-MP-05: geo の項目が無ければ no-column、欠損なら missing', () => {
    expect(nodeGeo(byId('nogeo'), DEFAULT_GEO_SOURCE)).toEqual({
      kind: 'none',
      reason: 'no-column',
    });
    expect(nodeGeo(byId('lost'), DEFAULT_GEO_SOURCE)).toEqual({ kind: 'none', reason: 'missing' });
  });
  it('FR-MP-05: メルカトルで描けない緯度（±85.0511 超）は out-of-range', () => {
    expect(nodeGeo(byId('pole'), DEFAULT_GEO_SOURCE)).toEqual({
      kind: 'none',
      reason: 'out-of-range',
    });
  });
  it('FR-MP-05: 境界（±85.0511287798、±180）は通る', () => {
    expect(checkGeoCoordinate(85.0511287798, 180).kind).toBe('point');
    expect(checkGeoCoordinate(-85.0511287798, -180).kind).toBe('point');
    expect(checkGeoCoordinate(85.0512, 0)).toEqual({ kind: 'none', reason: 'out-of-range' });
    expect(checkGeoCoordinate(0, 180.0001)).toEqual({ kind: 'none', reason: 'out-of-range' });
    expect(checkGeoCoordinate(Number.NaN, 0)).toEqual({ kind: 'none', reason: 'invalid' });
  });
});

describe('nodeGeo（出どころ attrs。D-46）', () => {
  it('FR-VG-02: 文字列の数、アラビア・インド数字、要素 1 つの配列を読む', () => {
    expect(nodeGeoPoint(byId('p1'), attrsSource)).toEqual({ lat: 30.5, lon: -6.5 });
    // 「٣٣٫٥」= 33.5、「٠」= 0
    expect(nodeGeoPoint(byId('p2'), attrsSource)).toEqual({ lat: 33.5, lon: 0 });
    expect(nodeGeoPoint(byId('p3'), attrsSource)).toEqual({ lat: 12, lon: 5 });
  });
  it('FR-VG-02: 数値の属性（文字列でない）も読む', () => {
    const n = {
      attrs: makeAttrs([
        ['lat', { kind: 'value', value: 12.5 }],
        ['lon', { kind: 'value', value: [-3] }],
      ]),
    };
    expect(nodeGeoPoint(n, attrsSource)).toEqual({ lat: 12.5, lon: -3 });
  });
  it('FR-MP-05: 理由の分類（複数値と数でない値は invalid、欠損は missing、列が無ければ no-column）', () => {
    expect(nodeGeo(byId('p4'), attrsSource)).toEqual({ kind: 'none', reason: 'invalid' });
    expect(nodeGeo(byId('p5'), attrsSource)).toEqual({ kind: 'none', reason: 'missing' });
    expect(nodeGeo(byId('p6'), attrsSource)).toEqual({ kind: 'none', reason: 'no-column' });
    expect(nodeGeo(byId('p7'), attrsSource)).toEqual({ kind: 'none', reason: 'invalid' });
    expect(nodeGeo(byId('p8'), attrsSource)).toEqual({ kind: 'none', reason: 'out-of-range' });
    // 属性を持たない型（org）は no-column
    expect(nodeGeo(byId('o1'), attrsSource)).toEqual({ kind: 'none', reason: 'no-column' });
  });
  it('FR-MP-05: 緯度と経度の両方が使えないときは、手前の理由を返す', () => {
    const n = {
      attrs: makeAttrs([
        ['lat', { kind: 'value', value: 99 }],
        ['lon', { kind: 'missing', reason: 'lost' }],
      ]),
    };
    expect(nodeGeo(n, attrsSource)).toEqual({ kind: 'none', reason: 'missing' });
  });
  it('FR-MP-05: 日付、真偽値、有限でない数は invalid。__proto__ という列名でも継承を読まない', () => {
    const n = {
      attrs: makeAttrs([
        ['lat', { kind: 'value', value: true }],
        ['lon', { kind: 'value', value: Number.POSITIVE_INFINITY }],
      ]),
    };
    expect(nodeGeo(n, attrsSource)).toEqual({ kind: 'none', reason: 'invalid' });
    expect(
      nodeGeo({ attrs: makeAttrs([]) }, { kind: 'attrs', lat: '__proto__', lon: 'constructor' }),
    ).toEqual({
      kind: 'none',
      reason: 'no-column',
    });
  });
  it('FR-VG-02: extractGeoInputs と同じ結果を返す（座標のあるなしと値が一致）', () => {
    const d = geoDataset();
    const old = extractGeoInputs(d.nodes, 'lat', 'lon');
    expect(old.length).toBe(d.nodes.length);
    d.nodes.forEach((n, i) => {
      expect(nodeGeoPoint(n, attrsSource)).toEqual(old[i]?.point ?? null);
    });
    // 座標が取れたノードが 3 つ以上あり、比較が空振りでないこと
    expect(old.filter((o) => o.point !== null).length).toBeGreaterThanOrEqual(3);
  });
});

describe('座標の出どころの検査と比較', () => {
  it('FR-PJ-01: 正しい形だけを受け入れ、余分な項目は落とす', () => {
    expect(parseGeoSourceValue({ kind: 'geo', extra: 1 })).toEqual({ kind: 'geo' });
    expect(parseGeoSourceValue({ kind: 'attrs', lat: 'a', lon: 'b', x: 1 })).toEqual({
      kind: 'attrs',
      lat: 'a',
      lon: 'b',
    });
    for (const bad of [
      null,
      5,
      [],
      {},
      { kind: 'attrs' },
      { kind: 'attrs', lat: '', lon: 'b' },
      { kind: 'attrs', lat: 'a', lon: 2 },
      { kind: 'other' },
    ])
      expect(parseGeoSourceValue(bad)).toBeNull();
  });
  it('FR-PJ-01: sameGeoSource', () => {
    expect(sameGeoSource({ kind: 'geo' }, { kind: 'geo' })).toBe(true);
    expect(sameGeoSource({ kind: 'geo' }, attrsSource)).toBe(false);
    expect(sameGeoSource(attrsSource, { kind: 'attrs', lat: 'lat', lon: 'lon' })).toBe(true);
    expect(sameGeoSource(attrsSource, { kind: 'attrs', lat: 'lon', lon: 'lat' })).toBe(false);
  });
});

describe('型単位の座標の出どころ（geoSourceTypes、nodeGeo の coverage）', () => {
  const d = geoDataset();
  it('FR-MP-05: 出どころが geo なら、点の geo を持つノードがいる型だけが対象（欠損の geo の人物は対象外）', () => {
    expect([...geoSourceTypes(d, { kind: 'geo' })]).toEqual(['place']);
  });
  it('FR-MP-05: 出どころが attrs なら、緯度か経度に欠損でない値を持つノードがいる型（schema は見ない）', () => {
    expect([...geoSourceTypes(d, attrsSource)]).toEqual(['person']);
    // 属性がどのノードにも無ければ、どの型も対象外
    expect([...geoSourceTypes(d, { kind: 'attrs', lat: 'nope', lon: 'nope2' })]).toEqual([]);
  });
  it('FR-MP-05: 出どころを持たない型は no-column、持つ型の中の項目なしは missing', () => {
    const geo = geoSourceTypes(d, { kind: 'geo' });
    const g = (id: string) => nodeGeo(byId(id), { kind: 'geo' }, geo);
    expect(g('p1')).toEqual({ kind: 'none', reason: 'no-column' });
    expect(g('o1')).toEqual({ kind: 'none', reason: 'no-column' });
    expect(g('nogeo')).toEqual({ kind: 'none', reason: 'missing' });
    expect(g('lost')).toEqual({ kind: 'none', reason: 'missing' });
    expect(g('pole')).toEqual({ kind: 'none', reason: 'out-of-range' });
    expect(g('fez').kind).toBe('point');
    const at = geoSourceTypes(d, attrsSource);
    const a = (id: string) => nodeGeo(byId(id), attrsSource, at);
    expect(a('fez')).toEqual({ kind: 'none', reason: 'no-column' });
    // p6 は人物（型は緯度・経度を持つ）だが緯度の項目が無い
    expect(a('p6')).toEqual({ kind: 'none', reason: 'missing' });
    expect(a('p4')).toEqual({ kind: 'none', reason: 'invalid' });
    expect(a('p1').kind).toBe('point');
  });
  it('FR-MP-05: 欠損の値しか持たない型は対象外で、ノードが欠損の値を持っていても no-column', () => {
    // p1 は geo が欠損。人物の型には点の geo が 1 つも無い
    expect(nodeGeo(byId('p1'), { kind: 'geo' }, geoSourceTypes(d, { kind: 'geo' }))).toEqual({
      kind: 'none',
      reason: 'no-column',
    });
    const allMissing = {
      ...d,
      nodes: d.nodes.map((n) =>
        n.type === 'person'
          ? {
              ...n,
              attrs: makeAttrs([
                ['lat', { kind: 'missing' as const, reason: 'unrecorded' as const }],
                ['lon', { kind: 'missing' as const, reason: 'unrecorded' as const }],
              ]),
            }
          : n,
      ),
    };
    expect([...geoSourceTypes(allMissing, attrsSource)]).toEqual([]);
    expect(
      nodeGeo(
        allMissing.nodes.find((n) => n.id === 'p1') ?? byId('p1'),
        attrsSource,
        geoSourceTypes(allMissing, attrsSource),
      ),
    ).toEqual({ kind: 'none', reason: 'no-column' });
    // 読めない値（invalid）や範囲外だけでも、値があるので対象になる
    expect(geoSourceTypes(d, attrsSource).has(byId('p7').type)).toBe(true);
  });
});
