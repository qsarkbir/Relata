import { describe, expect, it } from 'vitest';
import { applyFilters } from './apply';
import { checkFilterState } from './check';
import { certaintyFacetCounts, facetCounts } from './facets';
import { fid, mkEdge, mkNode, person, place, span, st, str, num } from './fixtures/filterDataset';
import { parseFilterState } from './parse';
import { addFilter, replaceFilter } from './state';
import { FILTER_KINDS, DEFAULT_FILTER_STATE, type FilterDef } from './types';
import { makeAttrs, toNodeId, type AttributeDef, type Dataset } from '../model';

// 日付の属性 born（人物だけ）と、複数値の日付 visited、日付でない属性 name2 を持つデータ。
const dateAttr = (...d: ReturnType<typeof span>[]) =>
  ({ kind: 'date', value: d.length === 1 && d[0] ? d[0] : d }) as const;

function ds(): Dataset {
  const schema: AttributeDef[] = [
    { key: 'born', label: 'born', appliesTo: 'node', nodeType: person, valueType: 'date' },
    { key: 'name2', label: 'name2', appliesTo: 'node', valueType: 'string' },
    { key: 'sealed', label: 'sealed', appliesTo: 'edge', valueType: 'date' },
  ];
  const withAttrs = (
    id: string,
    label: string,
    entries: Parameters<typeof makeAttrs>[0],
    certainty?: 'certain' | 'probable' | 'possible',
  ) => ({
    ...mkNode(id, person, label, []),
    attrs: makeAttrs(entries),
    ...(certainty ? { certainty } : {}),
  });
  return {
    graphMode: 'undirected',
    nodeTypes: [
      { id: person, label: 'person' },
      { id: place, label: 'place' },
    ],
    nodes: [
      withAttrs('a', 'A', [['born', dateAttr(span(100, 110))]], 'certain'),
      withAttrs('b', 'B', [['born', dateAttr(span(200), span(500))]], 'possible'),
      withAttrs('c', 'C', [['born', { kind: 'missing', reason: 'unrecorded' }]]),
      withAttrs('d', 'D', [['born', { kind: 'value', value: 'x' }]]),
      { ...mkNode('p', place, 'P', []), attrs: makeAttrs([]) },
    ],
    edges: [
      mkEdge('e1', 'a', 'b', num(1), { certainty: 'probable' }),
      mkEdge('e2', 'b', 'c', num(1)),
    ],
    schema,
    meta: { title: 't' },
  };
}

const born = (
  from: number,
  to: number,
  extra: Partial<Extract<FilterDef, { kind: 'time' }>> = {},
): FilterDef => ({
  id: fid('t'),
  kind: 'time',
  target: 'node',
  source: { kind: 'attr', attr: 'born' },
  from,
  to,
  match: 'overlaps',
  missing: 'exclude',
  ...extra,
});
const shown = (f: FilterDef): string[] =>
  [...applyFilters(ds(), st([f], { showIsolated: true })).nodeIds].sort();

describe('時間フィルタの source（D-35）', () => {
  it('FR-FL-03: 日付の属性の複数値はどれか 1 つが重なれば通す', () => {
    // B は 200 と 500 の 2 つの日付を持つ。450–600 には 500 だけが入る。
    expect(shown(born(450, 600))).toContain('b');
    expect(shown(born(300, 400))).not.toContain('b');
  });

  it('FR-FL-03: within は日付の幅が範囲に収まるときだけ通す', () => {
    expect(shown(born(95, 105, { match: 'within' }))).not.toContain('a');
    expect(shown(born(95, 115, { match: 'within' }))).toContain('a');
  });

  it('FR-FL-03: キーを持たない要素（型に当てはまらない属性）は通す', () => {
    expect(shown(born(1000, 2000))).toEqual(['p']);
  });

  it('FR-FL-06: 欠損は missing の指定に従い、日付でない値は通さない', () => {
    expect(shown(born(0, 1000))).toEqual(['a', 'b', 'p']);
    expect(shown(born(0, 1000, { missing: 'include' }))).toEqual(['a', 'b', 'c', 'p']);
    const r = applyFilters(ds(), st([born(0, 1000)]));
    expect(r.missingExcluded.get(fid('t'))).toBe(1);
  });

  it('FR-FL-03: 逆転した範囲は何も通さない（キー無しの要素を除く）', () => {
    expect(shown(born(10, 5))).toEqual(['p']);
  });

  it('FR-FL-03: span は今までどおり要素の time を見る', () => {
    const d = ds();
    const withTime: Dataset = {
      ...d,
      nodes: d.nodes.map((n) =>
        n.id === 'a' ? { ...n, time: { kind: 'span', start: span(100), end: span(120) } } : n,
      ),
    };
    const f = born(110, 115, { source: { kind: 'span' } });
    expect(applyFilters(withTime, st([f], { showIsolated: true })).nodeIds.has(toNodeId('a'))).toBe(
      true,
    );
  });
});

describe('checkFilterState（時間の source、nodeSet）', () => {
  it('FR-FL-03: 属性が無い、対象が違う、日付型でないものを報告する', () => {
    const issues = checkFilterState(
      ds(),
      st([
        born(0, 1, { id: fid('x'), source: { kind: 'attr', attr: 'nope' } }),
        born(0, 1, { id: fid('y'), target: 'edge' }),
        born(0, 1, { id: fid('z'), source: { kind: 'attr', attr: 'name2' } }),
        born(0, 1, { id: fid('ok') }),
        born(0, 1, { id: fid('okedge'), target: 'edge', source: { kind: 'attr', attr: 'sealed' } }),
      ]),
    );
    expect(issues).toEqual([
      { kind: 'unknown-attr', filterId: 'x', target: 'node', attr: 'nope' },
      { kind: 'unknown-attr', filterId: 'y', target: 'edge', attr: 'born' },
      { kind: 'attr-not-date', filterId: 'z', attr: 'name2' },
    ]);
  });

  it('FR-FL-11: データに無い ID を報告し、フィルタは落とさない', () => {
    const f: FilterDef = {
      id: fid('s'),
      kind: 'nodeSet',
      include: [toNodeId('a'), toNodeId('ghost')],
    };
    expect(checkFilterState(ds(), st([f]))).toEqual([
      { kind: 'unknown-node-id', filterId: 's', nodeId: 'ghost' },
    ]);
  });
});

describe('nodeSet（D-41、FR-FL-11）', () => {
  const set = (...ids: string[]): FilterDef => ({
    id: fid('s'),
    kind: 'nodeSet',
    include: ids.map(toNodeId),
  });

  it('FR-FL-11: ID が集合に含まれるノードだけ通す', () => {
    expect(shown(set('a', 'p'))).toEqual(['a', 'p']);
  });

  it('FR-FL-11: 空の集合は何も通さず、ラベルでは照合しない', () => {
    expect(shown(set())).toEqual([]);
    expect(shown(set('A'))).toEqual([]);
  });

  it('FR-FL-11: エッジは両端の規則に従って、通ったノード間だけ残る', () => {
    const r = applyFilters(ds(), st([set('a', 'b')]));
    expect([...r.edgeIds]).toEqual(['e1']);
  });

  it('FR-FL-11: addFilter / replaceFilter で追加・置き換えができ、種類の一覧に含まれる', () => {
    const s1 = addFilter(DEFAULT_FILTER_STATE, set('a'));
    const s2 = replaceFilter(s1, set('b'));
    expect(s2.filters).toHaveLength(1);
    expect(s2.filters[0]).toEqual(set('b'));
    expect(FILTER_KINDS).toContain('nodeSet');
    expect(FILTER_KINDS).toContain('certainty');
  });

  it('FR-FL-11: ファセットの件数は nodeSet を通った要素で数える', () => {
    const f: FilterDef = {
      id: fid('s'),
      kind: 'nodeSet',
      include: [toNodeId('a')],
    };
    const d = ds();
    const withRole: Dataset = {
      ...d,
      nodes: d.nodes.map((n) => ({ ...n, attrs: makeAttrs([['role', str('r')]]) })),
      schema: [...d.schema, { key: 'role', label: 'role', appliesTo: 'node', valueType: 'string' }],
    };
    const [r] = facetCounts(withRole, st([f]), 'node', 'role');
    expect(r).toMatchObject({ filtered: 1, total: 5 });
  });
});

describe('certainty フィルタ（D-37、FR-DM-06）', () => {
  const cert = (
    target: 'node' | 'edge',
    ...include: Extract<FilterDef, { kind: 'certainty' }>['include']
  ): FilterDef => ({
    id: fid('c'),
    kind: 'certainty',
    target,
    include,
  });

  it('FR-DM-06: 指定した確からしさのノードだけを通し、持たない要素は unspecified で選ぶ', () => {
    const nodes = (f: FilterDef) =>
      [...applyFilters(ds(), st([f], { showIsolated: true })).nodeIds].sort();
    expect(nodes(cert('node', 'certain', 'possible'))).toEqual(['a', 'b']);
    expect(nodes(cert('node', 'unspecified'))).toEqual(['c', 'd', 'p']);
    expect(nodes(cert('node'))).toEqual([]);
  });

  it('FR-DM-06: エッジにも使える', () => {
    const r = applyFilters(ds(), st([cert('edge', 'probable')]));
    expect([...r.edgeIds]).toEqual(['e1']);
  });

  it('FR-DM-06: ファセットは 4 項目を常に返し、同じ対象の確からしさのフィルタを除いて数える', () => {
    const f = cert('node', 'certain');
    const counts = certaintyFacetCounts(ds(), st([f]), 'node');
    expect(counts.map((c) => [c.key, c.filtered, c.total])).toEqual([
      ['certain', 1, 1],
      ['probable', 0, 0],
      ['possible', 1, 1],
      ['unspecified', 3, 3],
    ]);
    // 他のフィルタ（時間）を通った要素だけが filtered に入る
    const withTime = certaintyFacetCounts(ds(), st([f, born(0, 150)]), 'node');
    expect(withTime.find((c) => c.key === 'certain')).toMatchObject({ filtered: 1, total: 1 });
    expect(withTime.find((c) => c.key === 'possible')).toMatchObject({ filtered: 0, total: 1 });
  });

  it('FR-DM-06: check は問題を報告しない', () => {
    expect(checkFilterState(ds(), st([cert('node', 'certain')]))).toEqual([]);
  });
});

describe('parseFilterState（版 2 の追加）', () => {
  const run = (f: unknown) => parseFilterState({ filters: [f] });

  it('FR-FL-03: source は必須で、span と attr を読む', () => {
    const base = {
      id: 't',
      kind: 'time',
      target: 'node',
      from: 1,
      to: 2,
      match: 'within',
      missing: 'include',
    };
    expect(run(base)).toMatchObject({ ok: false, path: 'filters[0].source' });
    expect(run({ ...base, source: { kind: 'x' } })).toMatchObject({
      ok: false,
      path: 'filters[0].source.kind',
    });
    expect(run({ ...base, source: { kind: 'attr' } })).toMatchObject({
      ok: false,
      path: 'filters[0].source.attr',
    });
    expect(run({ ...base, source: { kind: 'span', extra: 1 } })).toMatchObject({
      ok: true,
      value: { filters: [{ source: { kind: 'span' } }] },
    });
    expect(run({ ...base, source: { kind: 'attr', attr: 'born' } })).toMatchObject({
      ok: true,
      value: { filters: [{ source: { kind: 'attr', attr: 'born' } }] },
    });
  });

  it('FR-FL-11: nodeSet を読み、不正な ID を拒否する', () => {
    expect(run({ id: 's', kind: 'nodeSet', include: ['a', 'b'] })).toMatchObject({
      ok: true,
      value: { filters: [{ kind: 'nodeSet', include: ['a', 'b'] }] },
    });
    expect(run({ id: 's', kind: 'nodeSet', include: [''] })).toMatchObject({
      ok: false,
      path: 'filters[0].include[0]',
    });
    expect(run({ id: 's', kind: 'nodeSet', include: 'a' })).toMatchObject({ ok: false });
  });

  it('FR-DM-06: certainty を読み、不正なキーと対象を拒否する', () => {
    expect(
      run({ id: 'c', kind: 'certainty', target: 'edge', include: ['possible', 'unspecified'] }),
    ).toMatchObject({
      ok: true,
      value: {
        filters: [{ kind: 'certainty', target: 'edge', include: ['possible', 'unspecified'] }],
      },
    });
    expect(run({ id: 'c', kind: 'certainty', target: 'edge', include: ['maybe'] })).toMatchObject({
      ok: false,
      path: 'filters[0].include[0]',
    });
    expect(run({ id: 'c', kind: 'certainty', include: [] })).toMatchObject({
      ok: false,
      path: 'filters[0].target',
    });
  });

  it('FR-PJ-03: 新しい種類は JSON の往復で変わらない', () => {
    const state = st([
      born(1, 2),
      { id: fid('s'), kind: 'nodeSet', include: [toNodeId('a')] },
      { id: fid('c'), kind: 'certainty', target: 'node', include: ['certain', 'unspecified'] },
    ]);
    const r = parseFilterState(JSON.parse(JSON.stringify(state)));
    expect(r).toEqual({ ok: true, value: state });
  });
});
