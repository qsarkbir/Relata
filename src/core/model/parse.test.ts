import { describe, expect, it } from 'vitest';
import {
  checkDataset,
  isAttrValue,
  isDataset,
  isFuzzyDate,
  isGeoPoint,
  isPlainObject,
  isTimeSpan,
  makeAttrs,
  parseDataset,
  toNodeId,
  toNodeTypeId,
  type Dataset,
} from './index';
import { bceDate, edge, hijriDate, personType, sampleDataset } from './fixtures/sampleDataset';

// 失敗の path を取り出す。成功なら例外。
//
function failPath(x: unknown): string {
  const r = parseDataset(x);
  if (r.ok) throw new Error('成功してはならない');
  return r.path;
}

// JSON を往復した値。
//
function roundTrip(ds: Dataset): Record<string, unknown> {
  return JSON.parse(JSON.stringify(ds)) as Record<string, unknown>;
}

// 先頭のノードを、patch で上書きした 1 ノードだけの JSON にする。
//
function withNode(patch: Record<string, unknown>): Record<string, unknown> {
  const base = sampleDataset();
  const n = JSON.parse(JSON.stringify(base.nodes[1])) as Record<string, unknown>;
  return { ...roundTrip(base), nodes: [{ ...n, ...patch }] };
}

describe('parseDataset（FR-DM-01〜05、07）', () => {
  it('FR-DM-01: JSON を往復した Dataset は同じ内容で組み立て直される', () => {
    const ds = sampleDataset();
    const r = parseDataset(roundTrip(ds));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(ds);
  });

  it('FR-DM-01: 余分な項目と、トップレベルの __proto__ は落とす。入力は書き換えない', () => {
    const input = { ...roundTrip(sampleDataset()), extra: 1 };
    Object.defineProperty(input, '__proto__', {
      value: { polluted: 1 },
      enumerable: true,
      configurable: true,
    });
    const before = JSON.stringify(input);
    const r = parseDataset(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value)).not.toContain('extra');
      expect(Object.hasOwn(r.value, '__proto__')).toBe(false);
    }
    expect(JSON.stringify(input)).toBe(before);
  });

  it('FR-DM-01: 壊れた箇所を path で返す', () => {
    const bad = withNode({
      attrs: { born: { kind: 'date', value: { ...hijriDate, earliest: 1.5 } } },
    });
    expect(failPath(bad)).toBe('nodes[0].attrs.born.value.earliest');
    expect(failPath(null)).toBe('');
    expect(failPath({})).toBe('graphMode');
  });

  it('FR-DM-05: 配列の日付の壊れた要素の path に添字が入る', () => {
    const bad = withNode({
      attrs: { born: { kind: 'date', value: [hijriDate, { ...bceDate, latest: 'x' }] } },
    });
    expect(failPath(bad)).toBe('nodes[0].attrs.born.value[1].latest');
  });

  it('FR-DM-01: Dataset でないものは通らない（項目ごとに path を確かめる）', () => {
    const ds = roundTrip(sampleDataset());
    const attrDef = { key: 'k', label: 'l', appliesTo: 'node', valueType: 'string' };
    expect(failPath({ ...ds, graphMode: 'both' })).toBe('graphMode');
    expect(failPath({ ...ds, nodeTypes: 3 })).toBe('nodeTypes');
    expect(failPath({ ...ds, nodeTypes: [{ id: '', label: 'x' }] })).toBe('nodeTypes[0].id');
    expect(failPath({ ...ds, nodeTypes: [{ id: 'a', label: 'x', color: 1 }] })).toBe(
      'nodeTypes[0].color',
    );
    expect(failPath({ ...ds, nodeTypes: [{ id: 'a', label: 'x', shape: 'star' }] })).toBe(
      'nodeTypes[0].shape',
    );
    expect(failPath({ ...ds, nodes: [{ id: 'a' }] })).toBe('nodes[0].type');
    expect(failPath({ ...ds, nodes: [{ id: 'a', type: 't', label: 'l', attrs: 1 }] })).toBe(
      'nodes[0].attrs',
    );
    expect(failPath({ ...ds, edges: [{ id: 'e', source: 'a', target: 'b', directed: 'y' }] })).toBe(
      'edges[0].directed',
    );
    expect(failPath({ ...ds, schema: [{ ...attrDef, appliesTo: 'both' }] })).toBe(
      'schema[0].appliesTo',
    );
    expect(failPath({ ...ds, schema: [{ ...attrDef, valueType: 'text' }] })).toBe(
      'schema[0].valueType',
    );
    expect(failPath({ ...ds, schema: [{ ...attrDef, multi: {} }] })).toBe(
      'schema[0].multi.separator',
    );
    expect(failPath({ ...ds, meta: { title: 1 } })).toBe('meta.title');
    expect(failPath({ ...ds, meta: { title: 't', source: 1 } })).toBe('meta.source');
    expect(failPath({ ...ds, meta: 'x' })).toBe('meta');
  });

  it('FR-DM-05: time と geo の値の検査（欠損、終わりが分からない期間、座標の型）', () => {
    const lost = { kind: 'missing', reason: 'lost' };
    expect(parseDataset(withNode({ time: { kind: 'span', start: hijriDate, end: lost } })).ok).toBe(
      true,
    );
    expect(failPath(withNode({ time: { kind: 'x' } }))).toBe('nodes[0].time.kind');
    expect(failPath(withNode({ time: { kind: 'span', start: hijriDate, end: 5 } }))).toBe(
      'nodes[0].time.end',
    );
    expect(failPath(withNode({ time: 5 }))).toBe('nodes[0].time');
    expect(failPath(withNode({ geo: { kind: 'point', lat: 'a', lon: 0 } }))).toBe(
      'nodes[0].geo.lat',
    );
    expect(failPath(withNode({ geo: { kind: 'point', lat: 0, lon: 'a' } }))).toBe(
      'nodes[0].geo.lon',
    );
    expect(failPath(withNode({ geo: { kind: 'line' } }))).toBe('nodes[0].geo.kind');
    expect(failPath(withNode({ geo: { kind: 'missing', reason: 'x' } }))).toBe(
      'nodes[0].geo.reason',
    );
  });

  it('FR-DM-04、07: 値の検査（欠損、複数値、有限でない数、確からしさ、未知の kind）', () => {
    expect(isAttrValue({ kind: 'value', value: ['a', 1, false], certainty: 'possible' })).toBe(
      true,
    );
    expect(isAttrValue({ kind: 'value', value: [{}] })).toBe(false);
    expect(isAttrValue({ kind: 'value', value: Number.POSITIVE_INFINITY })).toBe(false);
    expect(isAttrValue({ kind: 'value', value: 'a', certainty: 'x' })).toBe(false);
    expect(isAttrValue({ kind: 'date', value: [hijriDate, bceDate] })).toBe(true);
    expect(isAttrValue({ kind: 'date', value: 5 })).toBe(false);
    expect(isAttrValue({ kind: 'missing', reason: 'lost' })).toBe(true);
    expect(isAttrValue({ kind: 'missing', reason: '' })).toBe(false);
    expect(isAttrValue({ kind: 'missing' })).toBe(false);
    expect(isAttrValue({ kind: 'other' })).toBe(false);
    expect(isAttrValue('x')).toBe(false);
  });

  it('FR-DM-05: 日は安全な整数、暦と確からしさは正しい値', () => {
    expect(isFuzzyDate(hijriDate)).toBe(true);
    expect(isFuzzyDate(bceDate)).toBe(true);
    expect(isFuzzyDate({ ...hijriDate, earliest: 1.5 })).toBe(false);
    expect(isFuzzyDate({ ...hijriDate, earliest: 2 ** 60 })).toBe(false);
    expect(isFuzzyDate({ ...hijriDate, latest: Number.NaN })).toBe(false);
    expect(isFuzzyDate({ ...hijriDate, calendar: 'mayan' })).toBe(false);
    expect(isFuzzyDate({ ...hijriDate, certainty: 'sure' })).toBe(false);
    expect(isFuzzyDate({ ...hijriDate, label: 5 })).toBe(false);
    expect(isTimeSpan({ kind: 'span', start: hijriDate })).toBe(true);
    expect(isTimeSpan({ kind: 'missing', reason: 'lost' })).toBe(false);
    expect(isGeoPoint({ kind: 'point', lat: 1, lon: 2 })).toBe(true);
    expect(isGeoPoint({ kind: 'missing', reason: 'lost' })).toBe(false);
    expect(isPlainObject([])).toBe(false);
    expect(isDataset(null)).toBe(false);
    expect(isDataset(roundTrip(sampleDataset()))).toBe(true);
  });
});

describe('性質: checkDataset が空なら、JSON を往復しても parseDataset が通る（FR-DM-01）', () => {
  const sample = sampleDataset();
  const minimal: Dataset = {
    graphMode: 'undirected',
    nodeTypes: [],
    nodes: [],
    edges: [],
    schema: [],
    meta: { title: '' },
  };
  const withProtoColumn: Dataset = {
    ...sample,
    schema: [{ key: '__proto__', label: 'p', appliesTo: 'node', valueType: 'string' }],
    nodes: [
      {
        id: toNodeId('a'),
        type: personType,
        label: 'a',
        attrs: makeAttrs([['__proto__', { kind: 'value', value: 'z' }]]),
      },
    ],
    edges: [],
  };
  const variants: [string, Dataset][] = [
    ['サンプル', sample],
    ['空', minimal],
    [
      '出典つき・色なし・形なし',
      {
        ...minimal,
        meta: { title: 't', source: 's' },
        nodeTypes: [{ id: toNodeTypeId('t'), label: 'T' }],
      },
    ],
    ['列名が __proto__', withProtoColumn],
    [
      '無向のみ',
      {
        ...sample,
        graphMode: 'undirected',
        edges: sample.edges.map((e) => ({ ...e, directed: false })),
      },
    ],
    [
      '有向のみ',
      {
        ...sample,
        graphMode: 'directed',
        edges: sample.edges.map((e) => ({ ...e, directed: true })),
      },
    ],
    ['ノードだけ', { ...sample, edges: [] }],
    [
      '辺の期間つき',
      {
        ...sample,
        edges: [edge('t1', 'p1', 'p2', { time: { kind: 'span', start: bceDate, end: hijriDate } })],
      },
    ],
  ];

  it.each(variants)('FR-DM-01: %s', (_name, ds) => {
    expect(checkDataset(ds)).toEqual([]);
    const r = parseDataset(roundTrip(ds));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual(ds);
  });
});
