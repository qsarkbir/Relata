import { describe, expect, it } from 'vitest';
import { applyFilters } from './apply';
import { facetCounts } from './facets';
import {
  fid,
  filterDataset,
  mkEdge,
  mkNode,
  num,
  person,
  span,
  str,
  st,
} from './fixtures/filterDataset';
import { getAttr, type Dataset } from '../model';
import type { FilterDef } from './types';

const ds = filterDataset();

const roleFilter = (...values: string[]): FilterDef => ({
  id: fid('role'),
  kind: 'category',
  target: 'node',
  attr: 'role',
  include: values.map((value) => ({ kind: 'value', value })),
});
const ageMin40: FilterDef = {
  id: fid('age'),
  kind: 'range',
  target: 'node',
  attr: 'age',
  min: 40,
  missing: 'exclude',
};

// 項目の読みやすい表記。値は "v:値"、欠損は "m:理由"
const label = (k: { kind: string; value?: string; reason?: string }): string =>
  k.kind === 'value' ? `v:${k.value ?? ''}` : `m:${k.reason ?? ''}`;
const summary = (r: ReturnType<typeof facetCounts>): Record<string, string> =>
  Object.fromEntries(r.map((i) => [label(i.key), `${String(i.filtered)}/${String(i.total)}`]));

describe('facetCounts', () => {
  it('FR-FL-07: 全体の件数。複数値は値ごとに数え、欠損は理由ごとの項目になる', () => {
    const r = facetCounts(ds, st([], { showIsolated: true }), 'node', 'role');
    expect(summary(r)).toEqual({
      'v:qadi': '2/2',
      'v:scholar': '3/3',
      'm:lost': '1/1',
    });
  });

  it('FR-FL-06: 値の項目が先、欠損の項目は MISSING_REASONS の順で後ろに並ぶ', () => {
    const r = facetCounts(ds, st([]), 'edge', 'amount');
    expect(r.map((i) => label(i.key))).toEqual([
      'v:10',
      'v:5',
      'v:20',
      'm:lost',
      'm:not-applicable',
    ]);
  });

  it('FR-FL-06: 文字列 "undefined" の項目を作らない（filter-audit #10）', () => {
    const r = facetCounts(ds, st([]), 'node', 'role');
    expect(r.some((i) => i.key.kind === 'value' && i.key.value === 'undefined')).toBe(false);
  });

  it('FR-FL-07: edgeRule と showIsolated に左右されない（孤立ノードも条件に合えば数える）', () => {
    const hidden = summary(facetCounts(ds, st([]), 'node', 'role'));
    const shown = summary(facetCounts(ds, st([], { showIsolated: true }), 'node', 'role'));
    const either = summary(facetCounts(ds, st([], { edgeRule: 'either-end' }), 'node', 'role'));
    expect(hidden['v:scholar']).toBe('3/3');
    expect(shown).toEqual(hidden);
    expect(either).toEqual(hidden);
  });

  it('FR-FL-07: 件数は条件に合う数で、表示中の件数（FR-FL-09）とは別。既定の設定で A(qadi)-B(amir)', () => {
    const d: Dataset = {
      ...ds,
      nodes: [
        mkNode('A', person, 'A', [['role', str('qadi')]]),
        mkNode('B', person, 'B', [['role', str('amir')]]),
      ],
      edges: [mkEdge('e', 'A', 'B', num(1))],
    };
    const state = st([roleFilter('qadi')]); // 既定: both-ends、showIsolated: false
    expect(summary(facetCounts(d, state, 'node', 'role'))).toEqual({
      'v:qadi': '1/1',
      'v:amir': '1/1',
    });
    // 表示は 0（B が除かれ、エッジが両端の規則で消え、A は孤立するため）
    const r = applyFilters(d, state);
    expect(r.nodeIds.size).toBe(0);
    expect(r.edgeIds.size).toBe(0);
  });

  it('FR-FL-07: 自分自身のフィルタを除いて数えるので、同じファセットの他の値が 0 にならない', () => {
    const state = st([roleFilter('qadi')], { showIsolated: true });
    expect(summary(facetCounts(ds, state, 'node', 'role'))).toEqual({
      'v:qadi': '2/2',
      'v:scholar': '3/3',
      'm:lost': '1/1',
    });
  });

  it('FR-FL-07: 他のフィルタは件数に効く', () => {
    const state = st([roleFilter('qadi'), ageMin40], { showIsolated: true });
    // age >= 40 を通るのは p2、p4（p3 は欠損で除外、p1 と iso は 30 と 20）。地名は通る
    expect(summary(facetCounts(ds, state, 'node', 'role'))).toEqual({
      'v:qadi': '1/2',
      'v:scholar': '1/3',
      'm:lost': '0/1',
    });
  });

  it('FR-FL-07: 別の属性のカテゴリのフィルタは除かない', () => {
    const regionOnly: FilterDef = {
      id: fid('r'),
      kind: 'category',
      target: 'node',
      attr: 'region',
      include: [{ kind: 'value', value: 'Egypt' }],
    };
    const r = facetCounts(ds, st([regionOnly], { showIsolated: true }), 'node', 'region');
    expect(summary(r)).toEqual({ 'v:Egypt': '1/1', 'v:Anatolia': '1/1' });
  });

  it('FR-FL-07: その属性のキーを持たない要素は、どの項目にも数えない（k-partite）', () => {
    const r = facetCounts(ds, st([], { showIsolated: true }), 'node', 'region');
    expect(r.reduce((n, i) => n + i.total, 0)).toBe(2);
  });

  it('FR-FL-07: エッジのファセットは、エッジ用のフィルタだけで数える（ノード用の規則は関係しない）', () => {
    const nodeRole: FilterDef = { ...roleFilter('qadi'), id: fid('x') };
    const r = summary(facetCounts(ds, st([nodeRole]), 'edge', 'amount'));
    expect(r).toEqual({
      'v:10': '1/1',
      'v:5': '1/1',
      'v:20': '1/1',
      'm:lost': '1/1',
      'm:not-applicable': '1/1',
    });
    const amountFilter: FilterDef = {
      id: fid('y'),
      kind: 'range',
      target: 'edge',
      attr: 'amount',
      min: 10,
      missing: 'exclude',
    };
    const r2 = summary(facetCounts(ds, st([amountFilter]), 'edge', 'role'));
    expect(r2).toEqual({});
  });

  it('FR-FL-09: 絞り込み後の件数が、適用結果と食い違わない', () => {
    const state = st([roleFilter('qadi'), ageMin40], { showIsolated: true });
    const result = applyFilters(ds, state);
    const items = facetCounts(ds, state, 'node', 'role');
    // 自分自身の role フィルタは別として、age だけを適用した結果の role=qadi の数は、
    // role=qadi を選んだ結果の表示ノードのうち qadi を持つ数と一致する
    const qadiShown = ds.nodes.filter((n) => {
      const a = getAttr(n.attrs, 'role');
      return result.nodeIds.has(n.id) && a?.kind === 'value' && String(a.value).includes('qadi');
    }).length;
    expect(items.find((i) => i.key.kind === 'value' && i.key.value === 'qadi')?.filtered).toBe(
      qadiShown,
    );
  });

  it('FR-FL-07: 数値と同じ文字列は同じ項目に数える（String(値)）', () => {
    const d: Dataset = {
      ...ds,
      nodes: [
        mkNode('a', person, 'A', [['k', num(3)]]),
        mkNode('b', person, 'B', [['k', str('3')]]),
      ],
      edges: [mkEdge('e', 'a', 'b', num(1))],
    };
    expect(summary(facetCounts(d, st([]), 'node', 'k'))).toEqual({ 'v:3': '2/2' });
  });

  it('FR-FL-07: 列名が constructor や __proto__ でも件数が正しい', () => {
    const d: Dataset = {
      ...ds,
      nodes: [mkNode('a', person, 'A', [['__proto__', str('y')]]), mkNode('b', person, 'B', [])],
      edges: [mkEdge('e', 'a', 'b', num(1))],
    };
    expect(summary(facetCounts(d, st([]), 'node', '__proto__'))).toEqual({ 'v:y': '1/1' });
    expect(facetCounts(d, st([]), 'node', 'constructor')).toEqual([]);
  });

  it('FR-FL-07: 日付の属性は元の表記（label）を項目にする。"[object Object]" を作らない', () => {
    const d: Dataset = {
      ...ds,
      nodes: [
        mkNode('a', person, 'A', [
          [
            'born',
            {
              kind: 'date',
              value: [
                { ...span(1), label: 'c.1650' },
                { ...span(2), label: 'c.1650' },
              ],
            },
          ],
        ]),
        mkNode('b', person, 'B', [
          ['born', { kind: 'date', value: { ...span(3), label: '1 Muharram 1000' } }],
        ]),
      ],
      edges: [mkEdge('e', 'a', 'b', num(1))],
    };
    expect(summary(facetCounts(d, st([]), 'node', 'born'))).toEqual({
      'v:c.1650': '1/1',
      'v:1 Muharram 1000': '1/1',
    });
  });

  it('入力を書き換えない', () => {
    const state = st([roleFilter('qadi')]);
    const before = JSON.stringify([ds, state]);
    facetCounts(ds, state, 'node', 'role');
    expect(JSON.stringify([ds, state])).toBe(before);
  });
});
