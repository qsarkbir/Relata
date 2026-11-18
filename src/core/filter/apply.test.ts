import { describe, expect, it } from 'vitest';
import { applyFilters } from './apply';
import {
  fid,
  filterDataset,
  mkEdge,
  mkNode,
  person,
  place,
  num,
  str,
  sorted,
  span,
  st,
} from './fixtures/filterDataset';
import { toNodeId, type Dataset } from '../model';
import type { FilterDef } from './types';

const ds = filterDataset();

const roleQadi: FilterDef = {
  id: fid('role'),
  kind: 'category',
  target: 'node',
  attr: 'role',
  include: [{ kind: 'value', value: 'qadi' }],
};
type RangeDef = Extract<FilterDef, { kind: 'range' }>;
const ageMin40 = (missing: 'include' | 'exclude'): RangeDef => ({
  id: fid('age'),
  kind: 'range',
  target: 'node',
  attr: 'age',
  min: 40,
  missing,
});
const nodeText = (query: string, matching: 'loose' | 'strict'): FilterDef => ({
  id: fid('t'),
  kind: 'text',
  target: 'node',
  query,
  matching,
});

describe('applyFilters: 基本', () => {
  it('FR-FL-05: フィルタなしでは孤立ノード以外の全ノードと全エッジが表示される', () => {
    const r = applyFilters(ds, st([]));
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'p1', 'p2', 'p3', 'p4']);
    expect(sorted(r.edgeIds)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
  });

  it('FR-FL-05: showIsolated を true にすると孤立ノードも表示する', () => {
    const r = applyFilters(ds, st([], { showIsolated: true }));
    expect(r.nodeIds.size).toBe(7);
    expect(r.nodeIds.has(toNodeId('iso'))).toBe(true);
  });

  it('FR-FL-09: 絞り込み後と全体の件数を返す', () => {
    const r = applyFilters(ds, st([roleQadi]));
    expect(r.counts).toEqual({
      nodes: { shown: 3, total: 7 },
      edges: { shown: 2, total: 5 },
    });
  });

  it('入力の Dataset と FilterState を書き換えない', () => {
    const state = st([roleQadi]);
    const before = JSON.stringify([ds, state]);
    applyFilters(ds, state);
    expect(JSON.stringify([ds, state])).toBe(before);
  });

  it('filter-audit #1: 同じ入力なら何度呼んでも同じ結果（差分に依存しない）', () => {
    const a = applyFilters(ds, st([roleQadi, ageMin40('exclude')]));
    applyFilters(ds, st([]));
    const b = applyFilters(ds, st([roleQadi, ageMin40('exclude')]));
    expect(sorted(b.nodeIds)).toEqual(sorted(a.nodeIds));
    expect(sorted(b.edgeIds)).toEqual(sorted(a.edgeIds));
  });
});

describe('applyFilters: ノード用とエッジ用の分離とエッジの規則', () => {
  it('FR-FL-01: ノード用フィルタはエッジの属性を見ない（同じ属性名でも対象が別）', () => {
    // amount を持つのはエッジだけ。target: 'node' で amount を指定しても、ノードにキーが無いので全員通る
    const r = applyFilters(
      ds,
      st([{ id: fid('a'), kind: 'category', target: 'node', attr: 'amount', include: [] }]),
    );
    expect(sorted(r.edgeIds)).toHaveLength(5);
  });

  it('FR-FL-01: エッジ用フィルタはエッジだけを絞り、両端のノードは別の規則で決まる', () => {
    const r = applyFilters(
      ds,
      st([
        {
          id: fid('amt'),
          kind: 'range',
          target: 'edge',
          attr: 'amount',
          min: 10,
          missing: 'exclude',
        },
      ]),
    );
    expect(sorted(r.edgeIds)).toEqual(['e1', 'e4']);
    expect(sorted(r.nodeIds)).toEqual(['c2', 'p1', 'p2', 'p4']);
  });

  it('FR-FL-04: 両端の規則では、片端が除かれたエッジは表示しない', () => {
    const r = applyFilters(ds, st([roleQadi]));
    expect(sorted(r.edgeIds)).toEqual(['e4', 'e5']);
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'p4']);
  });

  it('FR-FL-04: 片端の規則では、除かれたノードも端点として表示する', () => {
    const r = applyFilters(ds, st([roleQadi], { edgeRule: 'either-end' }));
    expect(sorted(r.edgeIds)).toEqual(['e1', 'e3', 'e4', 'e5']);
    // e1 の p2、e3 の p3 は role が qadi でないが、端点として表示される。e2 の両端は不通過なので p2、p3 は e1、e3 経由
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'p1', 'p2', 'p3', 'p4']);
  });

  it('FR-FL-05: 孤立ノードを表示するときは、通過したノードも残る', () => {
    const r = applyFilters(ds, st([roleQadi], { showIsolated: true }));
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'p1', 'p4']);
  });

  it('FR-FL-04: 自己ループと多重エッジも端点の規則どおりに扱う', () => {
    const base: Dataset = {
      ...ds,
      nodes: [
        mkNode('x', person, 'X', [['age', num(1)]]),
        mkNode('y', person, 'Y', [['age', num(99)]]),
      ],
      edges: [
        mkEdge('l', 'x', 'x', num(1)),
        mkEdge('m1', 'x', 'y', num(1)),
        mkEdge('m2', 'x', 'y', num(1)),
      ],
    };
    const f: FilterDef = {
      id: fid('a'),
      kind: 'range',
      target: 'node',
      attr: 'age',
      max: 10,
      missing: 'exclude',
    };
    expect(sorted(applyFilters(base, st([f])).edgeIds)).toEqual(['l']);
    expect(sorted(applyFilters(base, st([f], { edgeRule: 'either-end' })).edgeIds)).toEqual([
      'l',
      'm1',
      'm2',
    ]);
  });

  it('データに無いノードを指すエッジの端点は、表示ノードに足さない', () => {
    const base: Dataset = { ...ds, edges: [mkEdge('d', 'p1', 'ghost', num(1))] };
    const r = applyFilters(base, st([], { edgeRule: 'either-end' }));
    expect(sorted(r.nodeIds)).toEqual(['p1']);
  });
});

describe('applyFilters: k-partite（D-21 (2)）', () => {
  it('FR-FL-01: 地名の属性で絞っても、その属性を持たない人物は消えない', () => {
    const r = applyFilters(
      ds,
      st(
        [
          {
            id: fid('r'),
            kind: 'category',
            target: 'node',
            attr: 'region',
            include: [{ kind: 'value', value: 'Egypt' }],
          },
        ],
        { showIsolated: true },
      ),
    );
    expect(sorted(r.nodeIds)).toEqual(['c1', 'iso', 'p1', 'p2', 'p3', 'p4']);
  });

  it('FR-FL-02: 範囲フィルタも、その属性を持たない地名をそのまま通す', () => {
    const r = applyFilters(ds, st([ageMin40('exclude')], { showIsolated: true }));
    expect(r.nodeIds.has(toNodeId('c1'))).toBe(true);
    expect(r.nodeIds.has(toNodeId('c2'))).toBe(true);
  });

  it('FR-FL-02: ノード型のフィルタ。include が空なら全ノードを除く', () => {
    const only = applyFilters(ds, st([{ id: fid('nt'), kind: 'nodeType', include: [person] }]));
    expect(sorted(only.nodeIds)).toEqual(['p1', 'p2', 'p3']);
    expect(sorted(only.edgeIds)).toEqual(['e1', 'e2']);
    const none = applyFilters(
      ds,
      st([{ id: fid('nt'), kind: 'nodeType', include: [] }], { showIsolated: true }),
    );
    expect(none.nodeIds.size).toBe(0);
    const both = applyFilters(
      ds,
      st([{ id: fid('nt'), kind: 'nodeType', include: [person, place] }]),
    );
    expect(both.nodeIds.size).toBe(6);
  });
});

describe('applyFilters: カテゴリ（FR-FL-02、FR-FL-06）', () => {
  it('FR-FL-02: 複数値はどれか 1 つが当たれば通す', () => {
    const r = applyFilters(
      ds,
      st([{ ...roleQadi, include: [{ kind: 'value', value: 'scholar' }] }], { showIsolated: true }),
    );
    // p1（qadi と scholar）、p2、iso が通る。p4 は qadi だけ、p3 は欠損
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'iso', 'p1', 'p2']);
  });

  it('FR-FL-06: 欠損は理由ごとの項目として選べる', () => {
    const lost = applyFilters(
      ds,
      st([{ ...roleQadi, include: [{ kind: 'missing', reason: 'lost' }] }], { showIsolated: true }),
    );
    expect(sorted(lost.nodeIds)).toEqual(['c1', 'c2', 'p3']);
    const unrec = applyFilters(
      ds,
      st([{ ...roleQadi, include: [{ kind: 'missing', reason: 'unrecorded' }] }], {
        showIsolated: true,
      }),
    );
    expect(sorted(unrec.nodeIds)).toEqual(['c1', 'c2']);
  });

  it('D-21 (2): include が空なら、その属性を持つ要素をすべて除く（持たない要素は通す）', () => {
    const r = applyFilters(ds, st([{ ...roleQadi, include: [] }], { showIsolated: true }));
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2']);
  });

  it('D-21 (2): 数値の属性も String(値) で比べる', () => {
    const r = applyFilters(
      ds,
      st([{ ...roleQadi, attr: 'age', include: [{ kind: 'value', value: '30' }] }], {
        showIsolated: true,
      }),
    );
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'p1']);
  });

  it('FR-FL-06: 値の文字列 "undefined" は欠損と別物（filter-audit #10）', () => {
    const r = applyFilters(
      ds,
      st([{ ...roleQadi, include: [{ kind: 'value', value: 'undefined' }] }], {
        showIsolated: true,
      }),
    );
    // 欠損の p3 も "undefined" という値には当たらない
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2']);
  });

  it('FR-FL-01: エッジ用のカテゴリ（amount の値と欠損）', () => {
    const r = applyFilters(
      ds,
      st([
        {
          id: fid('e'),
          kind: 'category',
          target: 'edge',
          attr: 'amount',
          include: [
            { kind: 'value', value: '5' },
            { kind: 'missing', reason: 'lost' },
          ],
        },
      ]),
    );
    expect(sorted(r.edgeIds)).toEqual(['e2', 'e3']);
  });
});

describe('applyFilters: 範囲と欠損（FR-FL-06）', () => {
  it('FR-FL-06: 欠損を除外すると、除いた件数がフィルタごとに返る', () => {
    const r = applyFilters(ds, st([ageMin40('exclude')]));
    expect(r.missingExcluded.get(fid('age'))).toBe(1);
  });

  it('FR-FL-06: 欠損を含める設定では通り、除いた件数は 0', () => {
    const r = applyFilters(ds, st([ageMin40('include')], { showIsolated: true }));
    expect(r.nodeIds.has(toNodeId('p3'))).toBe(true);
    expect(r.missingExcluded.get(fid('age'))).toBe(0);
  });

  it('D-21 (7): 欠損で除いた件数は、他のフィルタの結果と無関係に対象の全要素で数える', () => {
    // 先に role で p3 を除いておいても、age の「欠損で除いた件数」は 1 のまま
    const r = applyFilters(ds, st([roleQadi, ageMin40('exclude')]));
    expect(r.missingExcluded.get(fid('age'))).toBe(1);
    expect(r.missingExcluded.get(fid('role'))).toBe(0);
  });

  it('D-21 (3): 範囲は両端を含み、片端だけの指定もできる', () => {
    const both = applyFilters(
      ds,
      st([{ ...ageMin40('exclude'), min: 30, max: 50 }], { showIsolated: true }),
    );
    expect(sorted(both.nodeIds)).toEqual(['c1', 'c2', 'p1', 'p2']);
    const maxOnly = applyFilters(
      ds,
      st(
        [{ id: fid('a'), kind: 'range', target: 'node', attr: 'age', max: 20, missing: 'include' }],
        {
          showIsolated: true,
        },
      ),
    );
    expect(sorted(maxOnly.nodeIds)).toEqual(['c1', 'c2', 'iso', 'p3']);
  });

  it('D-21 (3): 数値でない値は範囲に合わない（欠損とは別。欠損の件数に数えない）', () => {
    const r = applyFilters(
      ds,
      st(
        [{ id: fid('n'), kind: 'range', target: 'node', attr: 'role', min: 0, missing: 'exclude' }],
        {
          showIsolated: true,
        },
      ),
    );
    // role が文字列の人物は除かれ、Missing の p3 だけが欠損として数えられる
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2']);
    expect(r.missingExcluded.get(fid('n'))).toBe(1);
  });

  it('FR-FL-06: エッジ用の範囲でも欠損の件数を返す', () => {
    const r = applyFilters(
      ds,
      st([
        {
          id: fid('amt'),
          kind: 'range',
          target: 'edge',
          attr: 'amount',
          min: 0,
          missing: 'exclude',
        },
      ]),
    );
    expect(r.missingExcluded.get(fid('amt'))).toBe(2);
    expect(sorted(r.edgeIds)).toEqual(['e1', 'e2', 'e4']);
  });
});

describe('applyFilters: 時間（FR-FL-03、D-21 (4)）', () => {
  const time = (
    from: number,
    to: number,
    match: 'overlaps' | 'within',
    missing: 'include' | 'exclude' = 'exclude',
    target: 'node' | 'edge' = 'node',
  ): FilterDef => ({ id: fid('tm'), kind: 'time', target, from, to, match, missing });
  const nodes = (f: FilterDef): string[] =>
    sorted(applyFilters(ds, st([f], { showIsolated: true })).nodeIds);

  it('FR-FL-03: 範囲と重なる（既定）。時期の項目が無いノードは通す', () => {
    // p1 は [100, 220]。p4 は [300, 無限]。iso は Missing（除外）。p2、p3、地名は項目が無いので通る
    expect(nodes(time(150, 160, 'overlaps'))).toEqual(['c1', 'c2', 'p1', 'p2', 'p3']);
  });

  it('FR-FL-03: 範囲に収まる。幅の端がはみ出すと通らない', () => {
    expect(nodes(time(90, 230, 'within'))).toContain('p1');
    expect(nodes(time(90, 210, 'within'))).not.toContain('p1');
  });

  it('FR-FL-03: 幅の端（earliest と latest）で境界を含む', () => {
    expect(nodes(time(220, 400, 'overlaps'))).toContain('p1');
    expect(nodes(time(221, 250, 'overlaps'))).not.toContain('p1');
  });

  it('D-21 (4): 終わりが分からない期間は、終わりを無限とみなす（within は通らない）', () => {
    expect(nodes(time(1000, 2000, 'overlaps'))).toContain('p4');
    expect(nodes(time(250, 1_000_000_000, 'within'))).not.toContain('p4');
    expect(nodes(time(250, 400, 'overlaps'))).toContain('p4');
    expect(nodes(time(0, 299, 'overlaps'))).not.toContain('p4');
  });

  it('D-21 (4): 終点の無い期間は 1 点の日付として扱う（start の幅）', () => {
    const single: Dataset = {
      ...ds,
      nodes: [mkNode('s', person, 'S', [], { kind: 'span', start: span(100, 120) })],
      edges: [],
    };
    // start は [100, 120]。[121, 130] とは重ならず、[110, 130] とは重なる
    const f = (from: number, to: number): FilterDef => time(from, to, 'overlaps');
    const run = (d: FilterDef): number =>
      applyFilters(single, st([d], { showIsolated: true })).nodeIds.size;
    expect(run(f(121, 130))).toBe(0);
    expect(run(f(110, 130))).toBe(1);
  });

  it('FR-FL-06: 欠損（Missing）は missing の指定に従い、除外した件数を返す', () => {
    const ex = applyFilters(
      ds,
      st([time(150, 160, 'overlaps', 'exclude')], { showIsolated: true }),
    );
    expect(ex.missingExcluded.get(fid('tm'))).toBe(1);
    const inc = applyFilters(
      ds,
      st([time(150, 160, 'overlaps', 'include')], { showIsolated: true }),
    );
    expect(inc.missingExcluded.get(fid('tm'))).toBe(0);
    expect(inc.nodeIds.has(toNodeId('iso'))).toBe(true);
  });

  it('FR-FL-03: エッジの時間フィルタ。時期の列が無いエッジは通り、Missing は設定に従う', () => {
    const r = applyFilters(ds, st([time(1050, 1060, 'overlaps', 'exclude', 'edge')]));
    expect(sorted(r.edgeIds)).toEqual(['e1', 'e3', 'e4', 'e5']);
    expect(r.missingExcluded.get(fid('tm'))).toBe(1);
  });
});

describe('applyFilters: テキスト（FR-FL-12、D-21 (1)）', () => {
  const names = (q: string, m: 'loose' | 'strict'): string[] =>
    sorted(applyFilters(ds, st([nodeText(q, m)], { showIsolated: true })).nodeIds);

  it('FR-FL-12: ゆるい照合は大文字小文字を区別しない。厳密な照合は区別する', () => {
    expect(names('ahmad', 'loose')).toEqual(['p1']);
    expect(names('ahmad', 'strict')).toEqual([]);
    expect(names('Ahmad', 'strict')).toEqual(['p1']);
  });

  it('FR-FL-12: アラビア文字の母音記号の揺れを、ゆるい照合では無視する', () => {
    expect(names('أَحْمَد', 'loose')).toEqual(['p2']);
    expect(names('أَحْمَد', 'strict')).toEqual([]);
    expect(names('أحمد', 'strict')).toEqual(['p2']);
  });

  it('FR-FL-12: 文字列の属性値も検索する（転写の補助記号と、アラビア・インド数字）', () => {
    expect(names('hanafi', 'loose')).toEqual(['p1']);
    expect(names('hanafi', 'strict')).toEqual([]);
    expect(names('3', 'loose')).toEqual(['p2']);
  });

  it('D-21 (1): 空の検索語は全件を通す', () => {
    expect(names('', 'loose')).toHaveLength(7);
    expect(names('  ', 'loose')).toHaveLength(7);
  });

  it('FR-FL-02: 数値の属性値は検索の対象にしない', () => {
    expect(names('30', 'loose')).toEqual([]);
  });

  it('FR-FL-01: エッジのテキスト検索は relation を見る（relation の無いエッジは合わない）', () => {
    const r = applyFilters(
      ds,
      st([{ id: fid('t'), kind: 'text', target: 'edge', query: 'friend', matching: 'loose' }]),
    );
    expect(sorted(r.edgeIds)).toEqual(['e2']);
    expect(sorted(r.nodeIds)).toEqual(['p2', 'p3']);
  });
});

describe('applyFilters: 列名が Object.prototype の名前（D-19）', () => {
  const tricky: Dataset = {
    ...ds,
    nodes: [
      mkNode('a', person, 'A', [
        ['constructor', str('x')],
        ['__proto__', str('y')],
      ]),
      mkNode('b', person, 'B', []),
    ],
    edges: [mkEdge('e', 'a', 'b', num(1))],
  };
  const cat = (attr: string, value: string): FilterDef => ({
    id: fid('c'),
    kind: 'category',
    target: 'node',
    attr,
    include: [{ kind: 'value', value }],
  });

  it('FR-FL-02: constructor という列名を持たないノードは、継承した値で誤判定されず通る', () => {
    const r = applyFilters(tricky, st([cat('constructor', 'zzz')], { showIsolated: true }));
    // 持つ a は値が合わず除かれ、持たない b は通る
    expect(sorted(r.nodeIds)).toEqual(['b']);
  });

  it('FR-FL-02: __proto__ という列名でもカテゴリが働く', () => {
    const r = applyFilters(tricky, st([cat('__proto__', 'y')], { showIsolated: true }));
    expect(sorted(r.nodeIds)).toEqual(['a', 'b']);
    const r2 = applyFilters(tricky, st([cat('__proto__', 'n')], { showIsolated: true }));
    expect(sorted(r2.nodeIds)).toEqual(['b']);
  });

  it('FR-FL-12: __proto__ という列名の値もテキスト検索の対象になる', () => {
    const r = applyFilters(tricky, st([nodeText('y', 'loose')], { showIsolated: true }));
    expect(sorted(r.nodeIds)).toEqual(['a']);
  });
});

describe('applyFilters: 逆転した範囲（D-21 (6)）', () => {
  it('FR-FL-02: min > max の範囲は何も通さず、欠損の扱いは missing の指定に従う', () => {
    const f = { ...ageMin40('include'), min: 60, max: 40 };
    const r = applyFilters(ds, st([f], { showIsolated: true }));
    // 数値を持つ人物は全員除かれ、欠損の p3 は include で残る。地名はキーが無いので通る
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'p3']);
    const ex = applyFilters(ds, st([{ ...f, missing: 'exclude' }], { showIsolated: true }));
    expect(sorted(ex.nodeIds)).toEqual(['c1', 'c2']);
    expect(ex.missingExcluded.get(f.id)).toBe(1);
  });

  it('FR-FL-03: from > to の時間範囲は何も通さず、Missing だけが missing の指定に従う', () => {
    const f: FilterDef = {
      id: fid('tm'),
      kind: 'time',
      target: 'node',
      from: 500,
      to: 100,
      match: 'overlaps',
      missing: 'include',
    };
    const r = applyFilters(ds, st([f], { showIsolated: true }));
    // p1、p4 は除かれ、Missing の iso は残る。時期の項目が無いノードは通る
    expect(sorted(r.nodeIds)).toEqual(['c1', 'c2', 'iso', 'p2', 'p3']);
  });
});
