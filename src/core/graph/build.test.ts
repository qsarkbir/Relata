import { describe, expect, it } from 'vitest';
import {
  makeAttrs,
  toEdgeId,
  toNodeId,
  toNodeTypeId,
  type AttrValue,
  type Dataset,
  type GraphEdge,
  type GraphMode,
} from '../model';
import { DEFAULT_FILTER_STATE, applyFilters, type FilterResult } from '../filter';
import {
  DEFAULT_GRAPH_OPTIONS,
  buildGraph,
  fromSnapshot,
  parseGraphOptions,
  toSnapshot,
  type GraphOptions,
} from './index';

// 【TS】`declare const` は「この名前の変数が実行環境に存在する」と型だけを宣言する（実体は作らない）。
// 【なぜ】core の tsconfig は DOM を含めないので structuredClone の型が無い。実行環境（Node、
//       ブラウザ、Worker）には必ずあるので、テストの中だけで型を宣言して使う。
declare const structuredClone: <V>(value: V) => V;

const T = toNodeTypeId('person');

function edge(
  id: string,
  s: string,
  t: string,
  extra: Partial<GraphEdge> = {},
  attrs: [string, AttrValue][] = [],
): GraphEdge {
  return {
    id: toEdgeId(id),
    source: toNodeId(s),
    target: toNodeId(t),
    directed: true,
    weight: 1,
    attrs: makeAttrs(attrs),
    ...extra,
  };
}

function ds(mode: GraphMode, ids: string[], edges: GraphEdge[]): Dataset {
  return {
    graphMode: mode,
    nodeTypes: [{ id: T, label: '人物' }],
    nodes: ids.map((id) => ({ id: toNodeId(id), type: T, label: `L:${id}`, attrs: makeAttrs([]) })),
    edges,
    schema: [],
    meta: { title: 't' },
  };
}

/**
 * 全部を表示する FilterResult。
 * @param d - データセット
 * @returns 全ノード・全エッジを表示する結果
 */
function all(d: Dataset): FilterResult {
  return {
    nodeIds: new Set(d.nodes.map((n) => n.id)),
    edgeIds: new Set(d.edges.map((e) => e.id)),
    missingExcluded: new Map(),
    counts: {
      nodes: { shown: d.nodes.length, total: d.nodes.length },
      edges: { shown: d.edges.length, total: d.edges.length },
    },
  };
}

/**
 * 見つからなければ失敗させる（テスト用。非 null アサーションの代わり）。
 * @param x - 値
 * @returns undefined でない値
 */
function must(x: string | undefined): string {
  if (x === undefined) throw new Error('エッジが見つかりません');
  return x;
}

const opt = (o: Partial<GraphOptions> = {}): GraphOptions => ({ ...DEFAULT_GRAPH_OPTIONS, ...o });
const num = (n: number): AttrValue => ({ kind: 'value', value: n });

describe('buildGraph', () => {
  it('FR-GR-01: 有向は向きごとにまとめる（A→B と B→A は別）', () => {
    const d = ds(
      'directed',
      ['A', 'B'],
      [edge('1', 'A', 'B'), edge('2', 'A', 'B'), edge('3', 'B', 'A')],
    );
    const g = buildGraph(d, all(d));
    expect(g.type).toBe('directed');
    expect(g.size).toBe(2);
    const ab = g.getEdgeAttributes(g.edge('A', 'B'));
    expect(ab.weight).toBe(2);
    expect(ab.edgeIds).toEqual(['1', '2']);
    expect(g.getEdgeAttributes(g.edge('B', 'A')).edgeIds).toEqual(['3']);
  });

  it('FR-GR-01: 無向は A–B と B–A を 1 本にまとめる', () => {
    const d = ds(
      'undirected',
      ['A', 'B'],
      [edge('1', 'A', 'B', { directed: false }), edge('2', 'B', 'A', { directed: false })],
    );
    const g = buildGraph(d, all(d));
    expect(g.type).toBe('undirected');
    expect(g.size).toBe(1);
    const a = g.getEdgeAttributes(must(g.edges()[0]));
    expect(a.count).toBe(2);
    expect(a.directed).toBe(false);
  });

  it('FR-DM-03: 混在では有向と無向を別にまとめる', () => {
    const d = ds(
      'mixed',
      ['A', 'B'],
      [
        edge('1', 'A', 'B'),
        edge('2', 'A', 'B', { directed: false }),
        edge('3', 'B', 'A', { directed: false }),
        edge('4', 'B', 'A'),
      ],
    );
    const g = buildGraph(d, all(d));
    expect(g.type).toBe('mixed');
    expect(g.size).toBe(3);
    expect(g.getEdgeAttributes(must(g.undirectedEdge('A', 'B'))).edgeIds).toEqual(['2', '3']);
    expect(g.getEdgeAttributes(must(g.directedEdge('A', 'B'))).edgeIds).toEqual(['1']);
    expect(g.getEdgeAttributes(must(g.directedEdge('B', 'A'))).edgeIds).toEqual(['4']);
  });

  it('FR-GR-01: 重み weight は GraphEdge.weight の合計、count は件数', () => {
    const d = ds(
      'directed',
      ['A', 'B'],
      [edge('1', 'A', 'B', { weight: 2.5 }), edge('2', 'A', 'B', { weight: 4 })],
    );
    const e = (o: GraphOptions) => {
      const g = buildGraph(d, all(d), o);
      return g.getEdgeAttributes(must(g.edges()[0]));
    };
    expect(e(opt()).weight).toBe(6.5);
    expect(e(opt({ weight: 'weight' })).weight).toBe(6.5);
    expect(e(opt({ weight: 'count' })).weight).toBe(2);
    expect(e(opt({ weight: 'count' })).count).toBe(2);
  });

  it('FR-GR-01: 属性の合計。欠損と数値でない値は 0 として足さず件数に出す', () => {
    const d = ds(
      'directed',
      ['A', 'B'],
      [
        edge('1', 'A', 'B', {}, [['n', num(3)]]),
        edge('2', 'A', 'B', {}, [['n', { kind: 'missing', reason: 'lost' }]]),
        edge('3', 'A', 'B', {}, [['n', { kind: 'value', value: 'many' }]]),
        edge('4', 'A', 'B', {}, []),
        edge('5', 'A', 'B', {}, [['n', { kind: 'value', value: [1, 2] }]]),
        edge('6', 'A', 'B', {}, [['n', { kind: 'value', value: [1, 'x'] }]]),
        edge('7', 'A', 'B', {}, [['n', num(Number.NaN)]]),
      ],
    );
    const g = buildGraph(d, all(d), opt({ weight: { attr: 'n' } }));
    const a = g.getEdgeAttributes(must(g.edges()[0]));
    expect(a.weight).toBe(6); // 3 + (1+2)
    expect(a.missingWeightCount).toBe(5);
    expect(a.count).toBe(7);
  });

  it('FR-GR-02: 自己ループは既定で含め、selfLoops: false で除く', () => {
    const d = ds('directed', ['A', 'B'], [edge('1', 'A', 'A'), edge('2', 'A', 'B')]);
    expect(buildGraph(d, all(d)).size).toBe(2);
    const g = buildGraph(d, all(d), opt({ selfLoops: false }));
    expect(g.size).toBe(1);
    expect(g.hasEdge('A', 'A')).toBe(false);
    expect(g.order).toBe(2);
  });

  it('FR-GR-01: フィルタで除かれたエッジとノードは入らず、孤立ノードは showIsolated で入る', () => {
    const d = ds('directed', ['A', 'B', 'C', 'Z'], [edge('1', 'A', 'B'), edge('2', 'B', 'C')]);
    // 手で作った結果: C とエッジ 2 を除く。Z は孤立で残す。
    const r: FilterResult = {
      ...all(d),
      nodeIds: new Set([toNodeId('A'), toNodeId('B'), toNodeId('Z')]),
      edgeIds: new Set([toEdgeId('1')]),
    };
    const g = buildGraph(d, r);
    expect(g.nodes().sort()).toEqual(['A', 'B', 'Z']);
    expect(g.size).toBe(1);
    expect(g.degree('Z')).toBe(0);
  });

  it('FR-FL-05: applyFilters の結果（showIsolated の true/false）をそのまま反映する', () => {
    const d = ds('directed', ['A', 'B', 'Z'], [edge('1', 'A', 'B')]);
    const on = buildGraph(d, applyFilters(d, { ...DEFAULT_FILTER_STATE, showIsolated: true }));
    expect(on.hasNode('Z')).toBe(true);
    const off = buildGraph(d, applyFilters(d, { ...DEFAULT_FILTER_STATE, showIsolated: false }));
    expect(off.hasNode('Z')).toBe(false);
    expect(off.order).toBe(2);
  });

  it('FR-GR-01: 元のエッジ ID の一覧から元データに戻れる。ノードは label と type を持つ', () => {
    const d = ds('directed', ['A', 'B'], [edge('1', 'A', 'B', { relation: 'teacher' })]);
    const g = buildGraph(d, all(d));
    const a = g.getEdgeAttributes(must(g.edges()[0]));
    const orig = a.edgeIds.map((id) => d.edges.find((e) => e.id === id));
    expect(orig[0]?.relation).toBe('teacher');
    expect(g.getNodeAttributes('A')).toEqual({ label: 'L:A', type: T });
  });

  it('FR-GR-01: ID に , " -> を含んでも別の組が衝突しない', () => {
    // 単純な連結 `${s},${t}` や `${s}->${t}` なら同じキーになる組を用意する。
    const d = ds(
      'directed',
      ['a', 'b,c', 'a,b', 'c', 'a->b', 'c"d', 'x', 'a"', 'b'],
      [
        edge('1', 'a', 'b,c'),
        edge('2', 'a,b', 'c'),
        edge('3', 'a->b', 'c"d'),
        edge('4', 'a', 'b'),
        edge('5', 'x', 'a"'),
      ],
    );
    const g = buildGraph(d, all(d));
    expect(g.size).toBe(5);
    expect(new Set(g.edges()).size).toBe(5);
    expect(g.hasEdge('a->b', 'c"d')).toBe(true);
  });

  it('FR-GR-01: 入力の Dataset と FilterResult を書き換えない', () => {
    const d = ds('mixed', ['A', 'B'], [edge('1', 'A', 'B')]);
    const before = JSON.stringify(d);
    buildGraph(d, all(d));
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('buildGraph の追加の確認', () => {
  it('FR-DM-03: graphMode がエッジの directed に勝つ（undirected に directed: true のエッジ）', () => {
    const d = ds('undirected', ['A', 'B'], [edge('1', 'A', 'B'), edge('2', 'B', 'A')]);
    const g = buildGraph(d, all(d));
    expect(g.type).toBe('undirected');
    expect(g.size).toBe(1);
    expect(g.getEdgeAttributes(must(g.edges()[0])).directed).toBe(false);
    const d2 = ds('directed', ['A', 'B'], [edge('1', 'A', 'B', { directed: false })]);
    const g2 = buildGraph(d2, all(d2));
    expect(g2.getEdgeAttributes(must(g2.edges()[0])).directed).toBe(true);
  });

  it('FR-DM-03: mixed で同じノードの有向と無向の自己ループが共存して 2 本になる', () => {
    const d = ds('mixed', ['A'], [edge('1', 'A', 'A'), edge('2', 'A', 'A', { directed: false })]);
    const g = buildGraph(d, all(d));
    expect(g.size).toBe(2);
    expect(g.hasDirectedEdge('A', 'A')).toBe(true);
    expect(g.hasUndirectedEdge('A', 'A')).toBe(true);
    expect(buildGraph(d, all(d), opt({ selfLoops: false })).size).toBe(0);
  });

  it('FR-GR-02: undirected の自己ループは含め、selfLoops: false で除く', () => {
    const d = ds(
      'undirected',
      ['A', 'B'],
      [edge('1', 'A', 'A', { directed: false }), edge('2', 'A', 'B', { directed: false })],
    );
    expect(buildGraph(d, all(d)).size).toBe(2);
    const g = buildGraph(d, all(d), opt({ selfLoops: false }));
    expect(g.size).toBe(1);
    expect(g.hasEdge('A', 'A')).toBe(false);
  });

  it('FR-GR-01: weight でも有限でない値と負の値は足さず missingWeightCount に数える', () => {
    const d = ds(
      'directed',
      ['A', 'B'],
      [
        edge('1', 'A', 'B', { weight: 2 }),
        edge('2', 'A', 'B', { weight: Number.NaN }),
        edge('3', 'A', 'B', { weight: -1 }),
        edge('4', 'A', 'B', { weight: Number.POSITIVE_INFINITY }),
      ],
    );
    const g = buildGraph(d, all(d));
    const a = g.getEdgeAttributes(must(g.edges()[0]));
    expect(a.weight).toBe(2);
    expect(a.missingWeightCount).toBe(3);
    expect(a.count).toBe(4);
  });

  it('FR-GR-01: { attr } の負の値も欠損として数える', () => {
    const d = ds(
      'directed',
      ['A', 'B'],
      [edge('1', 'A', 'B', {}, [['n', num(4)]]), edge('2', 'A', 'B', {}, [['n', num(-2)]])],
    );
    const g = buildGraph(d, all(d), opt({ weight: { attr: 'n' } }));
    const a = g.getEdgeAttributes(must(g.edges()[0]));
    expect(a.weight).toBe(4);
    expect(a.missingWeightCount).toBe(1);
  });

  it('FR-DM-01: ノード ID が重複しても例外を投げず、先に出たものを採る', () => {
    const d = ds('directed', ['A', 'B'], [edge('1', 'A', 'B')]);
    const dup: Dataset = {
      ...d,
      nodes: [...d.nodes, ...d.nodes.slice(0, 1).map((n) => ({ ...n, label: '後から出た A' }))],
    };
    const g = buildGraph(dup, all(dup));
    expect(g.order).toBe(2);
    expect(g.getNodeAttribute('A', 'label')).toBe('L:A');
  });
});

describe('GraphSnapshot', () => {
  it('FR-GR-01: structuredClone を往復しても同じグラフに戻る', () => {
    const d = ds(
      'mixed',
      ['A', 'B', 'Z'],
      [edge('1', 'A', 'B', { weight: 3 }), edge('2', 'B', 'A', { directed: false })],
    );
    const g = buildGraph(d, all(d));
    const snap = structuredClone(toSnapshot(g));
    const g2 = fromSnapshot(snap);
    expect(g2.type).toBe('mixed');
    expect(g2.order).toBe(3);
    expect(g2.size).toBe(2);
    expect(toSnapshot(g2)).toEqual(toSnapshot(g));
    expect(g2.getEdgeAttributes(must(g2.directedEdge('A', 'B'))).weight).toBe(3);
  });
});

describe('fromSnapshot', () => {
  it('FR-DM-03: 3 種の graphMode の往復で type が保たれ、undirected は無向のまま戻る', () => {
    for (const mode of ['directed', 'undirected', 'mixed'] as const) {
      const d = ds(mode, ['A', 'B'], [edge('1', 'A', 'B', { directed: mode === 'directed' })]);
      const g2 = fromSnapshot(structuredClone(toSnapshot(buildGraph(d, all(d)))));
      expect(g2.type).toBe(mode);
      expect(g2.size).toBe(1);
      const k = must(g2.edges()[0]);
      if (mode === 'undirected') {
        expect(g2.isUndirected(k)).toBe(true);
        expect(g2.hasEdge('B', 'A')).toBe(true);
      }
      if (mode === 'directed') expect(g2.hasEdge('B', 'A')).toBe(false);
    }
  });
});

describe('parseGraphOptions', () => {
  it('FR-GR-01: 空のオブジェクトは既定値で補う', () => {
    expect(parseGraphOptions({})).toEqual({ ok: true, value: DEFAULT_GRAPH_OPTIONS });
  });
  it('FR-GR-01: 3 種の重みを読める', () => {
    expect(parseGraphOptions({ weight: 'count', selfLoops: false })).toEqual({
      ok: true,
      value: { weight: 'count', selfLoops: false },
    });
    expect(parseGraphOptions({ weight: { attr: 'n', extra: 1 } })).toEqual({
      ok: true,
      value: { weight: { attr: 'n' }, selfLoops: true },
    });
  });
  it('FR-GR-01: 型の違いは壊れた箇所つきで失敗する', () => {
    expect(parseGraphOptions(null)).toMatchObject({ ok: false });
    expect(parseGraphOptions({ weight: 'sum' })).toMatchObject({ ok: false, path: 'weight' });
    expect(parseGraphOptions({ weight: { attr: '' } })).toMatchObject({
      ok: false,
      path: 'weight.attr',
    });
    expect(parseGraphOptions({ selfLoops: 1 })).toMatchObject({ ok: false, path: 'selfLoops' });
  });
});
