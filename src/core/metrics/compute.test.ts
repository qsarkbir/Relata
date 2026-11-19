/**
 * 指標の計算のテスト（FR-MT-01、FR-MT-02、D-30）。
 *
 * 正解値は tests/golden/metrics/generate.py が networkx で作った golden.json。
 * 許容誤差は相対 1e-6（0 に近い値は絶対誤差 1e-9 も併用）。整数の指標は完全一致（設計書 §7.3）。
 */
import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import golden from '../../../tests/golden/metrics/golden.json';
import { toNodeTypeId, type NodeTypeId } from '../model';
import {
  toSnapshot,
  type GraphSnapshot,
  type RelataEdgeAttributes,
  type RelataGraph,
  type RelataNodeAttributes,
} from '../graph';
import { computeMetrics } from './compute';
import { NODE_METRIC_IDS, type MetricOutcome, type MetricsResult } from './types';

// 【TS】`declare const` は型だけの宣言（実体は作らない）。core の tsconfig は DOM の型を持たないので、
//       structuredClone を、このテストの中だけで宣言して使う（Worker の structured clone の確認用）。
declare const structuredClone: <V>(value: V) => V;

interface GoldenEdge {
  source: string;
  target: string;
  weight: number;
  directed: boolean;
}
interface GoldenCase {
  type: 'directed' | 'undirected' | 'mixed';
  nodes: string[];
  edges: GoldenEdge[];
  expected: {
    node: Record<string, Record<string, number>>;
    global: Record<string, number>;
    /** false なら HITS は定義されない（重みの合計が 0）。 */
    hitsDefined?: boolean;
  };
}
// 【TS】JSON を import した型は、ファイルの中身そのものの細かい型になり、ケースごとにキーが違うため
//       1 つの型にまとめられない。そこで、期待する形を interface で宣言し、`as unknown as` で合わせる。
//       理由: 形は generate.py が保証している。形が違えば、下のテストが値の欠けで失敗する。
const cases = golden.cases as unknown as Record<string, GoldenCase>;

const PERSON = toNodeTypeId('person');
const PLACE = toNodeTypeId('place');

/**
 * テスト用に GraphSnapshot を作る。ノード型は typeOf で決める（既定はすべて person）。
 * @param type - グラフの種類
 * @param nodes - ノード ID
 * @param edges - エッジ
 * @param typeOf - ノード ID からノード型を引く関数
 * @returns スナップショット
 */
function snapshotOf(
  type: 'directed' | 'undirected' | 'mixed',
  nodes: readonly string[],
  edges: readonly GoldenEdge[],
  typeOf: (id: string) => NodeTypeId = () => PERSON,
): GraphSnapshot {
  const g: RelataGraph = new Graph<
    RelataNodeAttributes,
    RelataEdgeAttributes,
    Record<string, never>
  >({ type, multi: false, allowSelfLoops: true });
  for (const id of nodes) g.addNode(id, { label: id, type: typeOf(id) });
  edges.forEach((e, i) => {
    // 【TS】型アサーションを避けるため、属性は型に合うオブジェクトとして 1 か所で作る。
    const attrs: RelataEdgeAttributes = {
      weight: e.weight,
      count: 1,
      edgeIds: [],
      directed: e.directed,
      missingWeightCount: 0,
    };
    if (e.directed) g.addDirectedEdgeWithKey(`e${String(i)}`, e.source, e.target, attrs);
    else g.addUndirectedEdgeWithKey(`e${String(i)}`, e.source, e.target, attrs);
  });
  return toSnapshot(g);
}

function goldenSnapshot(name: string): GraphSnapshot {
  const c = cases[name];
  if (c === undefined) throw new Error(`正解値にケースがありません: ${name}`);
  // 二部グラフだけは、人と場所の 2 種類のノード型にする。
  const typeOf =
    name === 'bipartite' ? (id: string) => (id.startsWith('p') ? PERSON : PLACE) : undefined;
  return snapshotOf(c.type, c.nodes, c.edges, typeOf);
}

/**
 * 成功を取り出す（失敗なら、理由つきでテストを落とす）。
 * @param outcome - 指標の結果
 * @returns 成功の値
 */
function ok<T>(outcome: MetricOutcome<T> | undefined): T {
  if (outcome === undefined) throw new Error('指標が結果にありません');
  if (!outcome.ok) throw new Error(`指標が失敗: ${outcome.code} ${outcome.message}`);
  return outcome.value;
}

/**
 * 相対誤差 1e-6 以内、または絶対誤差 1e-9 以内。
 * @param actual - 実際の値
 * @param expected - 正解の値
 * @param label - 失敗時に出す名前
 */
function expectClose(actual: number, expected: number, label: string): void {
  const diff = Math.abs(actual - expected);
  const tolerance = Math.max(1e-6 * Math.abs(expected), 1e-9);
  expect(diff, `${label}: 実際 ${String(actual)}、正解 ${String(expected)}`).toBeLessThanOrEqual(
    tolerance,
  );
}

/**
 * 列（ノードの順の配列）を、正解の写像（ノード ID → 値）と照合する。
 * @param result - 計算結果（ノード ID の順を引くため）
 * @param column - 実際の列
 * @param expected - 正解の値
 * @param label - 失敗時に出す名前
 * @param exact - true なら完全一致
 */
function expectColumn(
  result: MetricsResult,
  column: readonly number[],
  expected: Record<string, number> | undefined,
  label: string,
  exact: boolean,
): void {
  if (expected === undefined) throw new Error(`正解値に ${label} がありません`);
  expect(column.length).toBe(result.nodeIds.length);
  result.nodeIds.forEach((id, i) => {
    const want = expected[id];
    if (want === undefined) throw new Error(`正解値に ${label}[${id}] がありません`);
    const got = column[i] ?? Number.NaN;
    if (exact) expect(got, `${label}[${id}]`).toBe(want);
    else expectClose(got, want, `${label}[${id}]`);
  });
}

describe('FR-MT-01: ノードごとの指標が networkx の正解値と一致する', () => {
  for (const [name, c] of Object.entries(cases)) {
    it(`FR-MT-01: ${name}（${c.type}）`, () => {
      const result = computeMetrics(goldenSnapshot(name));
      expect(result.kind).toBe(c.type);
      const want = c.expected.node;

      const degree = ok(result.node.degree);
      expectColumn(result, degree.total, want.degree, 'degree', true);
      const weighted = ok(result.node.weightedDegree);
      expectColumn(result, weighted.total, want.weightedDegree, 'weightedDegree', true);
      if (c.type === 'undirected') {
        expect(degree.in).toBeUndefined();
        expect(degree.out).toBeUndefined();
      } else {
        expectColumn(result, degree.in ?? [], want.degreeIn, 'degreeIn', true);
        expectColumn(result, degree.out ?? [], want.degreeOut, 'degreeOut', true);
        expectColumn(result, weighted.in ?? [], want.weightedDegreeIn, 'weightedDegreeIn', true);
        expectColumn(result, weighted.out ?? [], want.weightedDegreeOut, 'weightedDegreeOut', true);
      }

      expectColumn(result, ok(result.node.betweenness), want.betweenness, 'betweenness', false);
      const closeness = ok(result.node.closeness);
      expectColumn(result, closeness.value, want.closeness, 'closeness', false);
      if (c.type === 'undirected') expect(closeness.outgoing).toBeUndefined();
      else expectColumn(result, closeness.outgoing ?? [], want.closenessOut, 'closenessOut', false);
      expectColumn(result, ok(result.node.pagerank), want.pagerank, 'pagerank', false);

      if (c.expected.hitsDefined === false) {
        // 重みの合計が 0 の有向グラフ: HITS だけが notDefined の失敗になり、他の指標は成功する。
        const outcome = result.node.eigenvector;
        expect(outcome?.ok).toBe(false);
        if (outcome !== undefined && !outcome.ok) expect(outcome.code).toBe('notDefined');
        expectColumn(result, ok(result.node.kCore), want.kCore, 'kCore', true);
        return;
      }
      const eig = ok(result.node.eigenvector);
      if (c.type === 'undirected') {
        expect(eig.kind).toBe('eigenvector');
        if (eig.kind === 'eigenvector') {
          expectColumn(result, eig.value, want.eigenvector, 'eigenvector', false);
        }
      } else {
        expect(eig.kind).toBe('hits');
        if (eig.kind === 'hits') {
          expectColumn(result, eig.hubs, want.hubs, 'hubs', false);
          expectColumn(result, eig.authorities, want.authorities, 'authorities', false);
        }
      }

      expectColumn(result, ok(result.node.kCore), want.kCore, 'kCore', true);
      expectColumn(result, ok(result.node.clustering), want.clustering, 'clustering', false);
    });
  }
});

describe('FR-MT-02: 全体の指標が networkx の正解値と一致する', () => {
  const integerMetrics = ['nodeCount', 'edgeCount', 'components'] as const;
  for (const [name, c] of Object.entries(cases)) {
    it(`FR-MT-02: ${name}（${c.type}）`, () => {
      const result = computeMetrics(goldenSnapshot(name));
      for (const [key, want] of Object.entries(c.expected.global)) {
        // 理由: key は正解値の JSON の文字列で、GlobalMetricId かは型では分からない。
        //       間違った key なら undefined になり、下の ok() が「指標が結果にありません」で落とす。
        const outcome = (result.global as Record<string, MetricOutcome<number> | undefined>)[key];
        const got = ok(outcome);
        // 理由: `includes` の引数は配列の要素の型（リテラルの共用体）に限られるので、string の配列に広げる。
        if ((integerMetrics as readonly string[]).includes(key)) expect(got, key).toBe(want);
        else expectClose(got, want, key);
      }
      // 相互性は有向（混在を含む）のときだけ値を持つ。無向は適用できない失敗。
      const rec = result.global.reciprocity;
      if (c.type === 'undirected') {
        expect(rec?.ok).toBe(false);
        if (rec !== undefined && !rec.ok) expect(rec.code).toBe('notApplicable');
      }
    });
  }
});

describe('FR-MT-01: 規約（D-30）', () => {
  it('FR-MT-01: 無向の自己ループの次数は 2、有向は入と出に 1 ずつ', () => {
    const u = computeMetrics(
      snapshotOf('undirected', ['a'], [{ source: 'a', target: 'a', weight: 3, directed: false }]),
    );
    expect(ok(u.node.degree).total).toEqual([2]);
    expect(ok(u.node.weightedDegree).total).toEqual([6]);
    const d = computeMetrics(
      snapshotOf('directed', ['a'], [{ source: 'a', target: 'a', weight: 3, directed: true }]),
    );
    const dd = ok(d.node.degree);
    expect([dd.in, dd.out, dd.total]).toEqual([[1], [1], [2]]);
  });

  it('FR-MT-01: 媒介・近接は重みを使わない（重みを変えても結果が同じ）', () => {
    const edges = (w: number): GoldenEdge[] => [
      { source: 'a', target: 'b', weight: w, directed: false },
      { source: 'b', target: 'c', weight: 1, directed: false },
      { source: 'c', target: 'd', weight: 1, directed: false },
      { source: 'a', target: 'd', weight: 100, directed: false },
    ];
    const nodes = ['a', 'b', 'c', 'd'];
    const r1 = computeMetrics(snapshotOf('undirected', nodes, edges(1)), {
      nodeMetrics: ['betweenness', 'closeness'],
    });
    const r2 = computeMetrics(snapshotOf('undirected', nodes, edges(50)), {
      nodeMetrics: ['betweenness', 'closeness'],
    });
    expect(ok(r1.node.betweenness)).toEqual(ok(r2.node.betweenness));
    expect(ok(r1.node.closeness)).toEqual(ok(r2.node.closeness));
  });

  it('FR-MT-01: 混在グラフは注意を返し、向きを無視した指標も注意する', () => {
    const r = computeMetrics(goldenSnapshot('mixed'));
    const codes = r.notes.map((n) => n.code);
    expect(codes).toContain('mixedAsBidirectional');
    expect(codes).toContain('directedAsUndirected');
    const dir = r.notes.find((n) => n.code === 'directedAsUndirected');
    expect(dir?.nodeMetrics).toEqual(['kCore', 'clustering']);
  });

  it('FR-MT-01: 有向グラフは directedAsUndirected だけ、無向グラフは注意なし', () => {
    expect(computeMetrics(goldenSnapshot('directed_weighted')).notes.map((n) => n.code)).toEqual([
      'directedAsUndirected',
    ]);
    expect(computeMetrics(goldenSnapshot('undirected_weighted')).notes).toEqual([]);
  });

  it('FR-MT-05: ノード型が 2 種類以上なら、中心性、クラスタ係数、密度、推移性に注意する', () => {
    const r = computeMetrics(goldenSnapshot('bipartite'));
    const note = r.notes.find((n) => n.code === 'multipleNodeTypes');
    expect(note?.nodeMetrics).toEqual([
      'betweenness',
      'closeness',
      'pagerank',
      'eigenvector',
      'clustering',
    ]);
    expect(note?.globalMetrics).toEqual(['density', 'transitivity']);
  });

  it('FR-MT-01: mixed 型は、有向エッジしかなくても混在として扱う（表の形を変えない）', () => {
    const r = computeMetrics(
      snapshotOf(
        'mixed',
        ['a', 'b', 'c'],
        [
          { source: 'a', target: 'b', weight: 1, directed: true },
          { source: 'b', target: 'c', weight: 1, directed: true },
        ],
      ),
    );
    expect(r.kind).toBe('mixed');
    expect(r.notes.map((n) => n.code)).toContain('mixedAsBidirectional');
    expect(ok(r.node.degree).in).toEqual([0, 1, 1]);
    expect(ok(r.node.eigenvector).kind).toBe('hits');
    expect(ok(r.global.reciprocity)).toBe(0);
  });

  it('FR-MT-01: エッジが 1 本もない mixed 型でも、混在の形（入・出の列、HITS は notDefined）', () => {
    const r = computeMetrics(snapshotOf('mixed', ['a', 'b'], []));
    expect(r.kind).toBe('mixed');
    expect(ok(r.node.degree).in).toEqual([0, 0]);
    const eig = r.node.eigenvector;
    expect(eig?.ok).toBe(false);
  });

  it('FR-MT-01: ノード ID が __proto__ や constructor でも、値を失わない', () => {
    const ids = ['__proto__', 'constructor', 'toString', 'a'];
    // 【なぜ】graphology の Graph は、キーが __proto__ のノードの辺をうまく扱えない（辺の索引が素のオブジェクト）ので、
    // Graph を経由せず、スナップショットを手で組み立てる。計算側（graphology-metrics に渡すキーを添字にする）
    // が、ID の文字列に依存しないことを確かめる。
    const attributes = { weight: 1, count: 1, edgeIds: [], directed: false, missingWeightCount: 0 };
    const snapshot: GraphSnapshot = {
      options: { type: 'undirected', multi: false, allowSelfLoops: true },
      attributes: {},
      nodes: ids.map((key) => ({ key, attributes: { label: key, type: PERSON } })),
      edges: ids.slice(0, -1).map((source, i) => ({
        key: `e${String(i)}`,
        source,
        target: ids[i + 1] ?? '',
        attributes,
        undirected: true,
      })),
    };
    const r = computeMetrics(snapshot);
    expect(r.nodeIds).toEqual(ids);
    // 4 点の道 __proto__ - constructor - toString - a。媒介は両端が 0、中の 2 点が 2/3。
    const b = ok(r.node.betweenness);
    expect(b[0]).toBe(0);
    expect(b[1]).toBeCloseTo(2 / 3, 9);
    expect(b[2]).toBeCloseTo(2 / 3, 9);
    expect(b[3]).toBe(0);
    for (const id of NODE_METRIC_IDS) expect(r.node[id]?.ok, id).toBe(true);
  });

  it('FR-MT-01: 混在で、無向と有向のエッジが同じ 2 点にあるときは重みを足す', () => {
    const r = computeMetrics(
      snapshotOf(
        'mixed',
        ['a', 'b'],
        [
          { source: 'a', target: 'b', weight: 1, directed: false },
          { source: 'a', target: 'b', weight: 2, directed: true },
        ],
      ),
      { nodeMetrics: ['weightedDegree'] },
    );
    const w = ok(r.node.weightedDegree);
    // a→b は 2 + 1 = 3、b→a は 1。
    expect(w.out).toEqual([3, 1]);
    expect(w.in).toEqual([1, 3]);
  });
});

describe('FR-MT-01、FR-MT-02: 小さいグラフと要求の絞り込み', () => {
  it('FR-MT-02: ノードもエッジもないグラフでも落ちない', () => {
    const r = computeMetrics(snapshotOf('undirected', [], []));
    expect(ok(r.global.nodeCount)).toBe(0);
    expect(ok(r.global.density)).toBe(0);
    expect(ok(r.global.components)).toBe(0);
    expect(r.global.averageDegree?.ok).toBe(false);
    expect(ok(r.node.betweenness)).toEqual([]);
  });

  it('FR-MT-01: 孤立ノードだけのグラフは中心性 0、k-core 0、成分はノード数', () => {
    const r = computeMetrics(snapshotOf('undirected', ['a', 'b', 'c'], []));
    expect(ok(r.node.betweenness)).toEqual([0, 0, 0]);
    expect(ok(r.node.closeness).value).toEqual([0, 0, 0]);
    expect(ok(r.node.kCore)).toEqual([0, 0, 0]);
    expect(ok(r.node.pagerank).every((v) => Math.abs(v - 1 / 3) < 1e-9)).toBe(true);
    expect(ok(r.global.components)).toBe(3);
  });

  it('FR-MT-02: 向きのあるエッジがない有向グラフの相互性は値が定まらない失敗', () => {
    const r = computeMetrics(snapshotOf('directed', ['a', 'b'], []));
    const rec = r.global.reciprocity;
    expect(rec?.ok).toBe(false);
    if (rec !== undefined && !rec.ok) expect(rec.code).toBe('notDefined');
  });

  it('FR-MT-03: 要求した指標だけを計算する', () => {
    const r = computeMetrics(goldenSnapshot('undirected_weighted'), {
      nodeMetrics: ['degree'],
      globalMetrics: ['density'],
    });
    expect(Object.keys(r.node)).toEqual(['degree']);
    expect(Object.keys(r.global)).toEqual(['density']);
  });

  it('FR-MT-03: 指定がなければすべての指標を計算する', () => {
    const r = computeMetrics(goldenSnapshot('directed_weighted'));
    expect(Object.keys(r.node).sort()).toEqual([...NODE_METRIC_IDS].sort());
  });

  it('FR-MT-01: 結果は structured clone できる（Worker から返せる）', () => {
    const r = computeMetrics(goldenSnapshot('mixed'));
    expect(structuredClone(r)).toEqual(r);
  });

  it('FR-MT-01: スナップショットが structured clone を経ても同じ結果になる', () => {
    const s = goldenSnapshot('directed_weighted');
    expect(computeMetrics(structuredClone(s))).toEqual(computeMetrics(s));
  });

  it('FR-MT-01: 端点がノードにないエッジ（壊れたスナップショット）は例外になる', () => {
    const s = goldenSnapshot('undirected_weighted');
    const broken: GraphSnapshot = {
      ...s,
      edges: [
        ...s.edges,
        {
          key: 'bad',
          source: 'a',
          target: 'zzz',
          attributes: s.edges[0]?.attributes,
          undirected: true,
        },
      ],
    };
    expect(() => computeMetrics(broken)).toThrow(/zzz|bad/);
  });
});

describe('NFR-04: 1,000 ノード程度での実行時間の目安', () => {
  // 【なぜ】core は Date を使えないので時間は測らない。タイムアウトは、カバレッジの計測（4 倍ほど遅くなる）でも
  // 落ちない余裕を見た 10 秒で、「止まらずに終わる」ことの確認にとどめる。実測（計測なしで約 0.5 秒）は完了報告に書く。
  it(
    'NFR-04: ノード 1,000、エッジ 5,000 で、全指標が終わる（目安 0.5 秒）',
    { timeout: 10000 },
    () => {
      // 疑似乱数（線形合同法）で、再現できるグラフを作る（NFR-08）。
      let seed = 12345;
      const rand = (n: number): number => {
        seed = (seed * 48271) % 2147483647; // MINSTD。積が 2^53 に収まる。
        return seed % n;
      };
      const nodes = Array.from({ length: 1000 }, (_, i) => `n${String(i)}`);
      const seen = new Set<string>();
      const edges: GoldenEdge[] = [];
      while (edges.length < 5000) {
        const s = rand(1000);
        const t = rand(1000);
        const key = `${String(s)}-${String(t)}`;
        if (s === t || seen.has(key)) continue;
        seen.add(key);
        edges.push({
          source: `n${String(s)}`,
          target: `n${String(t)}`,
          weight: 1 + rand(5),
          directed: true,
        });
      }
      const snap = snapshotOf('directed', nodes, edges);
      const r = computeMetrics(snap);
      for (const id of NODE_METRIC_IDS) expect(r.node[id]?.ok, id).toBe(true);
    },
  );
});

describe('FR-MT-01: 負の重み・有限でない重み（外から作られたスナップショット）', () => {
  /**
   * 重みを指定した 3 点の輪のスナップショット（buildGraph は負の重みを作らないが、外から来うる）。
   *
   * @param weights - エッジ 3 本の重み
   * @param type - グラフの種類
   * @returns スナップショット
   */
  const make = (weights: number[], type: 'directed' | 'undirected'): GraphSnapshot => {
    const nodes = ['a', 'b', 'c'];
    const pairs = [
      ['a', 'b'],
      ['b', 'c'],
      ['c', 'a'],
    ];
    return {
      options: { type, multi: false, allowSelfLoops: true },
      attributes: {},
      nodes: nodes.map((key) => ({ key, attributes: { label: key, type: PERSON } })),
      edges: pairs.map(([source, target], i) => ({
        key: `e${String(i)}`,
        source: source ?? '',
        target: target ?? '',
        attributes: {
          weight: weights[i] ?? 1,
          count: 1,
          edgeIds: [],
          directed: type === 'directed',
          missingWeightCount: 0,
        },
        ...(type === 'undirected' ? { undirected: true } : {}),
      })),
    };
  };

  for (const [name, weights] of [
    ['負', [1, -5, 1]],
    ['NaN', [1, Number.NaN, 1]],
    ['無限大', [1, Number.POSITIVE_INFINITY, 1]],
  ] as const) {
    it(`FR-MT-01: ${name}の重みがあると、HITS・PageRank は notDefined で、空回りせずすぐ返る`, () => {
      const r = computeMetrics(make([...weights], 'directed'));
      for (const outcome of [r.node.eigenvector, r.node.pagerank]) {
        expect(outcome?.ok).toBe(false);
        if (outcome !== undefined && !outcome.ok) expect(outcome.code).toBe('notDefined');
      }
      // 他の指標は計算される。
      for (const id of ['degree', 'betweenness', 'closeness', 'kCore', 'clustering'] as const) {
        expect(r.node[id]?.ok, id).toBe(true);
      }
      expect(r.global.density?.ok).toBe(true);
    });
  }

  it('FR-MT-01: 無向グラフの固有ベクトルも、負の重みで notDefined', () => {
    const r = computeMetrics(make([1, -5, 1], 'undirected'));
    expect(r.node.eigenvector?.ok).toBe(false);
    expect(r.node.betweenness?.ok).toBe(true);
  });
});
