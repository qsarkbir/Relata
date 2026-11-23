import { describe, expect, it } from 'vitest';
import type { AttrValue, Dataset, GraphEdge, GraphNode } from '../model';
import { makeAttrs, toEdgeId, toNodeId, toNodeTypeId } from '../model';
import { parseGraphView, DEFAULT_GRAPH_VIEW } from '../project';
import {
  WHOLE_SCOPE,
  countMissingByAttribute,
  findMissingElements,
  missingRate,
  reasonRate,
} from './index';

const person = toNodeTypeId('person');
const place = toNodeTypeId('place');
const miss = (reason: 'unrecorded' | 'lost' | 'illegible' | 'not-applicable'): AttrValue => ({
  kind: 'missing',
  reason,
});
const val = (v: string): AttrValue => ({ kind: 'value', value: v });
const node = (id: string, type = person, attrs: [string, AttrValue][] = []): GraphNode => ({
  id: toNodeId(id),
  type,
  label: id,
  attrs: makeAttrs(attrs),
});
const edge = (id: string, attrs: [string, AttrValue][] = []): GraphEdge => ({
  id: toEdgeId(id),
  source: toNodeId('a'),
  target: toNodeId('b'),
  directed: true,
  weight: 1,
  attrs: makeAttrs(attrs),
});
const dataset: Dataset = {
  graphMode: 'directed',
  nodeTypes: [],
  nodes: [
    node('a', person, [['生年', miss('lost')]]),
    node('b', person, [['生年', miss('unrecorded')]]),
    node('c', person, [['生年', val('950')]]),
    node('d', person, []),
    node('p', place, [['生年', miss('lost')]]),
  ],
  edges: [edge('e1', [['出典', miss('illegible')]]), edge('e2', [['出典', val('x')]])],
  schema: [
    { key: '生年', label: '生年', appliesTo: 'node', nodeType: person, valueType: 'string' },
    { key: '出典', label: '出典', appliesTo: 'edge', valueType: 'string' },
  ],
  meta: { title: 't' },
};

describe('FR-VG-12: 属性ごとの欠損の集計', () => {
  it('FR-VG-12: 理由別に数え、ノード型を限る属性は、その型のノードだけを分母にする', () => {
    const rows = countMissingByAttribute(dataset, WHOLE_SCOPE);
    const r = rows[0]?.whole;
    expect(r).toMatchObject({ total: 4, present: 1, missing: 2, absent: 1 });
    expect(r?.byReason).toEqual({ unrecorded: 1, lost: 1, illegible: 0, 'not-applicable': 0 });
    expect(r === undefined ? null : missingRate(r)).toBe(0.5);
    expect(r === undefined ? null : reasonRate(r, 'lost')).toBe(0.25);
  });
  it('FR-VG-12: 絞り込み後の集合で数え直し、全体の値と並べる', () => {
    const rows = countMissingByAttribute(dataset, {
      nodeIds: new Set([toNodeId('a'), toNodeId('c')]),
      edgeIds: new Set([toEdgeId('e2')]),
    });
    expect(rows[0]?.filtered).toMatchObject({ total: 2, missing: 1, present: 1 });
    expect(rows[0]?.whole.total).toBe(4);
    expect(rows[1]?.filtered).toMatchObject({ total: 1, missing: 0 });
    expect(rows[1]?.whole).toMatchObject({ total: 2, missing: 1 });
  });
  it('FR-VG-12: 同じキーの属性をノードの型ごとに定義したときは、型ごとに別の行を返し、行に型を持たせる', () => {
    const twoTypes: Dataset = {
      ...dataset,
      schema: [
        { key: '生年', label: '生年', appliesTo: 'node', nodeType: person, valueType: 'string' },
        { key: '生年', label: '生年', appliesTo: 'node', nodeType: place, valueType: 'string' },
      ],
    };
    const rows = countMissingByAttribute(twoTypes, WHOLE_SCOPE);
    expect(rows.map((r) => [r.key, r.nodeType])).toEqual([
      ['生年', person],
      ['生年', place],
    ]);
    expect(rows[0]?.whole).toMatchObject({ total: 4, missing: 2 });
    expect(rows[1]?.whole).toMatchObject({ total: 1, missing: 1 });
    // 型を限らない属性の行には `nodeType` の項目が無い。
    expect(countMissingByAttribute(dataset, WHOLE_SCOPE)[1]).not.toHaveProperty('nodeType');
  });
  it('FR-VG-12: 分母が 0 の割合は null', () => {
    const rows = countMissingByAttribute(dataset, { nodeIds: new Set(), edgeIds: new Set() });
    expect(rows[0] === undefined ? 0 : missingRate(rows[0].filtered)).toBeNull();
  });
  it('FR-VG-12: 欠損している要素だけを集める（キー無しは含めない）', () => {
    const m = findMissingElements(dataset, ['生年'], ['出典']);
    expect([...m.nodes].sort()).toEqual(['a', 'b', 'p']);
    expect([...m.edges]).toEqual(['e1']);
    expect(findMissingElements(dataset, [], []).nodes.size).toBe(0);
  });
});

describe('FR-VG-12: 「欠損の表示」の保存', () => {
  it('FR-VG-12: 項目の無い（v0.1 の）設定は既定で開ける', () => {
    const r = parseGraphView({});
    expect(r.ok && r.value.missingDisplay).toEqual(DEFAULT_GRAPH_VIEW.missingDisplay);
  });
  it('FR-VG-12: 往復する', () => {
    const r = parseGraphView({ missingDisplay: { nodeAttrs: ['生年'], edgeAttrs: ['出典'] } });
    expect(r.ok && r.value.missingDisplay).toEqual({ nodeAttrs: ['生年'], edgeAttrs: ['出典'] });
  });
  it.each([
    ['null', null, 'missingDisplay'],
    ['文字列', 'x', 'missingDisplay'],
    ['配列でない一覧', { nodeAttrs: 'x' }, 'missingDisplay.nodeAttrs'],
    ['文字列でない要素', { edgeAttrs: ['a', 3] }, 'missingDisplay.edgeAttrs[1]'],
    ['空文字', { nodeAttrs: [''] }, 'missingDisplay.nodeAttrs[0]'],
    ['重複', { nodeAttrs: ['a', 'a'] }, 'missingDisplay.nodeAttrs[1]'],
    ['長すぎるキー', { nodeAttrs: ['a'.repeat(1001)] }, 'missingDisplay.nodeAttrs[0]'],
    [
      '上限超えの件数',
      { nodeAttrs: Array.from({ length: 10001 }, String) },
      'missingDisplay.nodeAttrs',
    ],
  ])('FR-VG-12: 不正な値は拒否する（%s）', (_name, input, path) => {
    const r = parseGraphView({ missingDisplay: input });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.path).toBe(path);
  });
});
