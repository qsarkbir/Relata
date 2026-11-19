/**
 * 指標の純粋な計算（FR-MT-01、FR-MT-02、設計書 §7.3、D-30）。
 *
 * # グラフの規約（テストと tests/golden/metrics/generate.py も同じ）
 * - 入力は D-22 のグラフ。同じ 2 点間のエッジは 1 本にまとめてあり、`weight` は合計。
 *   念のため、同じ 2 点間（有向は向きも同じ）のエッジが複数あれば、重みを足して 1 本にする。
 * - グラフの種類（`GraphKind`）は snapshot の `options.type` で決める。`mixed` は、表示中に有向エッジが
 *   なくても混在として扱う（入・出の列や HITS の形を、フィルタの操作で変えないため。D-30）。
 * - 自己ループ: 次数は networkx に合わせる（無向は 2、有向は入と出に 1 ずつ）。媒介・近接では
 *   最短経路に影響しない。k-core、クラスタ係数、推移性では無視する（networkx の core_number は
 *   自己ループがあると例外になるため。単純グラフの定義に合わせる）。
 * - 孤立ノード: 次数 0、中心性 0、k-core 0、クラスタ係数 0。連結成分には 1 つと数える。
 * - 有向グラフと無向グラフで定義が違う指標は、両方を実装する（次数、近接、HITS、成分、相互性など）。
 * - 混在グラフ: 無向エッジを両向きの 2 本の有向エッジとみなして計算する（相互性には数えない）。
 *   無向の自己ループは、向きのある自己ループ 1 本にする。同じ 2 点間に無向と有向のエッジが両方
 *   あれば、1 本の弧にまとめて重みを足す（networkx の DiGraph と同じ意味。例: 無向 a-b（重み 1）と
 *   有向 a→b（重み 2）は、弧 a→b（3）と弧 b→a（1））。注意（MetricsNote）を返す。
 * - 無向としてしか計算できない指標: k-core、クラスタ係数、推移性。有向（混在を含む）では
 *   向きを無視して計算し、注意 'directedAsUndirected' を返す。
 * - 媒介中心性と近接中心性は重みを使わない（ホップ数。D-30）。重みを「距離」とみなすか
 *   「強さ」とみなすかで結果が逆になるため。graphology-metrics には重みを使わない指定を明示して渡す。
 *   重み 0 の弧も、最短経路を作る弧として残す。
 * - 重みを使う指標: 重み付き次数、PageRank、固有ベクトル中心性、HITS。PageRank、固有ベクトル、HITS は
 *   重み 0 の弧を除いて計算する。graphology-metrics の PageRank は、出る重みの合計が 0 の点で 0 / 0 の
 *   NaN になり、重み 0 のエッジ 1 本で全体が失敗するため。重み 0 の弧は、重みつきの行列に何も足さないので、
 *   除いても数学的に同じ結果になる（networkx と一致することをテストで確かめている）。
 *
 * 【なぜ】1 つの指標の失敗（収束しないなど）で全体を止めない。指標ごとに try/catch して、
 * 理由つきの失敗（MetricOutcome）を返す（設計書 §12）。
 *
 * 【なぜ】graphology に渡すノードのキーは、ノード ID ではなく添字の文字列（'0'、'1'、…）にする。
 * graphology-metrics は結果を素のオブジェクト（ID → 値）で返すので、ノード ID が `__proto__` などだと
 * 値を失うため。
 */
import Graph from 'graphology';
import type { Attributes } from 'graphology-types';
import betweennessCentrality from 'graphology-metrics/centrality/betweenness';
import closenessCentrality from 'graphology-metrics/centrality/closeness';
import eigenvectorCentrality from 'graphology-metrics/centrality/eigenvector';
import pagerank from 'graphology-metrics/centrality/pagerank';
import type { GraphSnapshot } from '../graph';
import {
  GLOBAL_METRIC_IDS,
  NODE_METRIC_IDS,
  type DegreeColumns,
  type GlobalMetricId,
  type GraphKind,
  type MetricFailureCode,
  type MetricOutcome,
  type MetricsNote,
  type MetricsRequest,
  type MetricsResult,
  type NodeMetricId,
  type NodeMetricValues,
} from './types';

/** 反復計算（PageRank、固有ベクトル、HITS）の収束の許容。正解値との相対誤差 1e-6 を余裕で満たすため小さくする。 */
const TOLERANCE = 1e-10;
/** 反復計算の最大の反復回数。収束しなければ 'noConvergence' の失敗にする。 */
const MAX_ITERATIONS = 10000;

/** 計算用に整えたグラフ。 */
interface Prepared {
  readonly kind: GraphKind;
  readonly ids: readonly string[];
  /** ノード ID → 添字。 */
  readonly index: ReadonlyMap<string, number>;
  /** 向きを持つ弧（混在は無向を両向きにした後。無向グラフは小さい添字から大きい添字へ 1 本）。 */
  readonly arcSource: readonly number[];
  readonly arcTarget: readonly number[];
  /** 弧の重み。 */
  readonly arcWeight: readonly number[];
  /** 単純な無向の隣接（向きと自己ループを無視）。k-core、クラスタ係数、成分用。 */
  readonly adjacency: readonly ReadonlySet<number>[];
  readonly snapshot: GraphSnapshot;
}

// 【TS】graphology-metrics の関数は `Graph<NodeAttributes, EdgeAttributes>` を受ける。
//       エッジの属性に weight（数値）があることを型で示す。
type WorkGraph = Graph<Attributes, { weight: number }>;

/**
 * エッジが無向かを判定する。
 *
 * 【なぜ】graphology の書き出しは、エッジの `undirected: true` を混在グラフ（mixed）の場合だけ付ける。
 * 無向グラフ（undirected 型）の書き出しでは省かれるため、グラフの型も見る。
 *
 * @param snapshot - スナップショット
 * @param e - エッジ
 * @returns 無向なら true
 */
// 【TS】`GraphSnapshot['edges'][number]` は「インデックスアクセス型」。`T['edges']` でエッジの配列の型、
//       `[number]` でその要素の型を取り出す。型を二重に書かずに済み、元の型が変わっても追従する。
function isUndirectedEdge(snapshot: GraphSnapshot, e: GraphSnapshot['edges'][number]): boolean {
  return e.undirected === true || snapshot.options.type === 'undirected';
}

/**
 * スナップショットを計算用に整える。計算量 O(V + E)。
 *
 * @param snapshot - グラフのスナップショット
 * @returns 計算用のグラフ
 */
function prepare(snapshot: GraphSnapshot): Prepared {
  const ids = snapshot.nodes.map((n) => n.key);
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const n = ids.length;
  // 【なぜ】混在かどうかを、エッジの有無で変えない（D-30 の補足）。
  // 【TS】`??` は左が undefined のときだけ右を使う。graphology は type を省くと mixed として扱う。
  const kind: GraphKind = snapshot.options.type ?? 'mixed';

  // 弧を集める。キーは 添字の組を 1 つの整数（s * n + t）にしたもの。
  const arcs = new Map<number, { s: number; t: number; w: number }>();
  const addArc = (s: number, t: number, w: number): void => {
    const key = s * n + t;
    const hit = arcs.get(key);
    if (hit === undefined) arcs.set(key, { s, t, w });
    else hit.w += w;
  };
  const adjacency: Set<number>[] = ids.map(() => new Set<number>());
  for (const e of snapshot.edges) {
    const s = index.get(e.source);
    const t = index.get(e.target);
    if (s === undefined || t === undefined) {
      throw new Error(`エッジ ${String(e.key)} の端点がノードにありません`);
    }
    const w = e.attributes?.weight ?? 1;
    if (s !== t) {
      adjacency[s]?.add(t);
      adjacency[t]?.add(s);
    }
    if (kind === 'undirected') {
      addArc(Math.min(s, t), Math.max(s, t), w);
    } else if (isUndirectedEdge(snapshot, e) && s !== t) {
      // 混在: 無向エッジは両向きの 2 本の弧にする（D-30）。
      addArc(s, t, w);
      addArc(t, s, w);
    } else {
      addArc(s, t, w);
    }
  }

  const arcSource: number[] = [];
  const arcTarget: number[] = [];
  const arcWeight: number[] = [];
  for (const a of arcs.values()) {
    arcSource.push(a.s);
    arcTarget.push(a.t);
    arcWeight.push(a.w);
  }
  return { kind, ids, index, arcSource, arcTarget, arcWeight, adjacency, snapshot };
}

/**
 * graphology-metrics に渡すグラフを作る。計算量 O(V + E)。
 *
 * @param p - 計算用のグラフ
 * @param options - `reverse`: 弧の向きを逆にする（有向の近接の「出」）。`dropZeroWeight`: 重み 0 の弧を除く
 * @returns ノードのキーが添字の文字列のグラフ
 */
function buildWorkGraph(
  p: Prepared,
  options: { readonly reverse?: boolean; readonly dropZeroWeight?: boolean } = {},
): WorkGraph {
  const g: WorkGraph = new Graph({
    type: p.kind === 'undirected' ? 'undirected' : 'directed',
    multi: false,
    allowSelfLoops: true,
  });
  for (let i = 0; i < p.ids.length; i++) g.addNode(String(i));
  for (let i = 0; i < p.arcSource.length; i++) {
    const weight = p.arcWeight[i] ?? 0;
    if (options.dropZeroWeight === true && weight <= 0) continue;
    const s = String(p.arcSource[i]);
    const t = String(p.arcTarget[i]);
    if (options.reverse === true) g.addEdge(t, s, { weight });
    else g.addEdge(s, t, { weight });
  }
  return g;
}

/**
 * 計算を試み、例外を理由つきの失敗にする。
 *
 * @param fn - 計算
 * @returns 成功か失敗
 */
function attempt<T>(fn: () => T): MetricOutcome<T> {
  try {
    return { ok: true, value: fn() };
  } catch (error) {
    // 【TS】catch の error は unknown。Error かを型ガード（instanceof）で確かめてから message を読む。
    const message = error instanceof Error ? error.message : String(error);
    const code: MetricFailureCode = /converge/i.test(message) ? 'noConvergence' : 'unexpected';
    return { ok: false, code, message };
  }
}

// 【TS】戻り値の型 `MetricOutcome<never>` の `never` は「値を持たない型」。失敗の側は値を持たないので、
//       どんな `MetricOutcome<T>` にも代入できる（never はすべての型の部分型）。
/**
 * 値が定まらない、または適用できないときの失敗を作る。
 *
 * @param code - 失敗の種類
 * @param message - 説明（開発者向け）
 * @returns 失敗
 */
function fail(code: MetricFailureCode, message: string): MetricOutcome<never> {
  return { ok: false, code, message };
}

/**
 * graphology-metrics が返す写像（添字の文字列 → 値）を、ノードの順の配列にする。
 *
 * @param n - ノード数
 * @param mapping - 添字の文字列 → 値
 * @returns ノードの順の配列。写像に自分自身のキーがない、または数値でないものは 0
 */
function toColumn(n: number, mapping: Readonly<Record<string, number>>): number[] {
  const column = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const key = String(i);
    // 【なぜ】`Object.hasOwn` で自分自身のキーだけを読む。継承されたキー（`__proto__` など）を読まない。
    const v: unknown = Object.hasOwn(mapping, key) ? mapping[key] : undefined;
    column[i] = typeof v === 'number' ? v : 0;
  }
  return column;
}

/**
 * 次数（個数または重みの合計）。計算量 O(V + E)。
 *
 * @param p - 計算用のグラフ
 * @param useWeight - true なら重みの合計
 * @returns 次数の列
 */
function degreeColumns(p: Prepared, useWeight: boolean): DegreeColumns {
  const n = p.ids.length;
  const total = new Array<number>(n).fill(0);
  if (p.kind === 'undirected') {
    // 無向の自己ループは両端が同じ点なので、自然に 2 と数えられる（networkx と同じ）。
    for (let i = 0; i < p.arcSource.length; i++) {
      const w = useWeight ? (p.arcWeight[i] ?? 0) : 1;
      const s = p.arcSource[i] ?? 0;
      const t = p.arcTarget[i] ?? 0;
      total[s] = (total[s] ?? 0) + w;
      total[t] = (total[t] ?? 0) + w;
    }
    return { total };
  }
  const inD = new Array<number>(n).fill(0);
  const outD = new Array<number>(n).fill(0);
  for (let i = 0; i < p.arcSource.length; i++) {
    const w = useWeight ? (p.arcWeight[i] ?? 0) : 1;
    const s = p.arcSource[i] ?? 0;
    const t = p.arcTarget[i] ?? 0;
    outD[s] = (outD[s] ?? 0) + w;
    inD[t] = (inD[t] ?? 0) + w;
  }
  for (let i = 0; i < n; i++) total[i] = (inD[i] ?? 0) + (outD[i] ?? 0);
  return { total, in: inD, out: outD };
}

/**
 * k-core 番号（Batagelj と Zaveršnik、2003、"An O(m) Algorithm for Cores Decomposition of Networks"）。
 * 計算量 O(V + E)。向きと自己ループを無視した単純な無向グラフで計算する。
 *
 * 手順: 次数の小さい順に点を取り除く。取り除く点の次数が、その点の core 番号になる。
 * 隣の点の次数は 1 減らすが、いまの core 番号より小さくはしない。バケットソートで O(V + E) にする。
 *
 * @param adjacency - 単純な無向の隣接
 * @returns ノードごとの core 番号
 */
function coreNumbers(adjacency: readonly ReadonlySet<number>[]): number[] {
  const n = adjacency.length;
  const degree = adjacency.map((a) => a.size);
  const maxDegree = degree.reduce((m, d) => Math.max(m, d), 0);
  // 手順 1: 次数ごとのバケット（bin）の開始位置を数える。
  const bin = new Array<number>(maxDegree + 1).fill(0);
  for (const d of degree) bin[d] = (bin[d] ?? 0) + 1;
  let start = 0;
  for (let d = 0; d <= maxDegree; d++) {
    const count = bin[d] ?? 0;
    bin[d] = start;
    start += count;
  }
  // 手順 2: 点を次数の昇順に並べる（vert が並び、pos が各点の位置）。
  const pos = new Array<number>(n).fill(0);
  const vert = new Array<number>(n).fill(0);
  for (let v = 0; v < n; v++) {
    const d = degree[v] ?? 0;
    const p = bin[d] ?? 0;
    pos[v] = p;
    vert[p] = v;
    bin[d] = p + 1;
  }
  for (let d = maxDegree; d >= 1; d--) bin[d] = bin[d - 1] ?? 0;
  bin[0] = 0;
  // 手順 3: 順に取り除き、隣の次数を下げる（次数が大きい隣だけ。位置を入れ替えて並びを保つ）。
  for (let i = 0; i < n; i++) {
    const v = vert[i] ?? 0;
    const dv = degree[v] ?? 0;
    for (const u of adjacency[v] ?? []) {
      const du = degree[u] ?? 0;
      if (du > dv) {
        const pu = pos[u] ?? 0;
        const pw = bin[du] ?? 0;
        const w = vert[pw] ?? 0;
        if (u !== w) {
          pos[u] = pw;
          vert[pu] = w;
          pos[w] = pu;
          vert[pw] = u;
        }
        bin[du] = pw + 1;
        degree[u] = du - 1;
      }
    }
  }
  return degree;
}

/**
 * ノードごとの三角形の数を数える（クラスタ係数と推移性の材料）。
 * 計算量 O(Σ min(d(u), d(v)))（エッジごとの、次数の小さい方の和）。ハブがあっても O(E^1.5) に収まる
 * （Chiba と Nishizeki、1985、"Arboricity and subgraph listing algorithms"。小さい方の隣接を走査する着想）。
 *
 * 手順: 各点 v について、隣 u ごとに「u の隣のうち v の隣でもある点」を数える（小さい方を走査）。
 * その合計の半分が、v を含む三角形の数。
 *
 * @param adjacency - 単純な無向の隣接
 * @returns 点ごとの三角形の数
 */
function trianglesPerNode(adjacency: readonly ReadonlySet<number>[]): number[] {
  return adjacency.map((nv, v) => {
    let twice = 0;
    for (const u of nv) {
      const nu = adjacency[u];
      if (nu === undefined) continue;
      const [small, large] = nu.size < nv.size ? [nu, nv] : [nv, nu];
      for (const w of small) {
        if (w !== v && w !== u && large.has(w)) twice++;
      }
    }
    return twice / 2;
  });
}

/**
 * クラスタ係数（Watts と Strogatz、1998、"Collective dynamics of 'small-world' networks"）。
 * 点 v の隣どうしがつながっている割合 2·T(v) / (d(v)·(d(v)-1))。次数が 2 未満なら 0（networkx と同じ）。
 *
 * @param adjacency - 単純な無向の隣接
 * @returns 点ごとのクラスタ係数
 */
function clusteringCoefficients(adjacency: readonly ReadonlySet<number>[]): number[] {
  const tri = trianglesPerNode(adjacency);
  return adjacency.map((a, v) => {
    const d = a.size;
    return d < 2 ? 0 : (2 * (tri[v] ?? 0)) / (d * (d - 1));
  });
}

/**
 * 推移性（全体のクラスタ係数）= 3 × 三角形の数 / 3 点の組（次数 2 以上の点の隣の対）の数。
 * 三角形がなければ 0。計算量はクラスタ係数と同じ。
 *
 * @param adjacency - 単純な無向の隣接
 * @returns 推移性
 */
function transitivity(adjacency: readonly ReadonlySet<number>[]): number {
  const tri = trianglesPerNode(adjacency);
  let closed = 0;
  let triads = 0;
  adjacency.forEach((a, v) => {
    closed += tri[v] ?? 0;
    triads += (a.size * (a.size - 1)) / 2;
  });
  return triads === 0 ? 0 : closed / triads;
}

/**
 * 連結成分の数（有向と混在は弱連結成分。孤立ノードも 1 つと数える）。
 * 計算量 O(V + E)（幅優先探索）。
 *
 * @param adjacency - 単純な無向の隣接
 * @returns 成分の数
 */
function countComponents(adjacency: readonly ReadonlySet<number>[]): number {
  const seen = new Array<boolean>(adjacency.length).fill(false);
  let count = 0;
  for (let s = 0; s < adjacency.length; s++) {
    if (seen[s] === true) continue;
    count++;
    const stack = [s];
    seen[s] = true;
    while (stack.length > 0) {
      const v = stack.pop() ?? 0;
      for (const u of adjacency[v] ?? []) {
        if (seen[u] !== true) {
          seen[u] = true;
          stack.push(u);
        }
      }
    }
  }
  return count;
}

/**
 * HITS（Kleinberg、1999、"Authoritative sources in a hyperlinked environment"）。
 * ハブ（よい権威を指す点）と権威（よいハブから指される点）を、べき乗法で求める。
 * 計算量: 1 回の反復が O(E)（弧の配列を 2 回なぞるだけ）。反復回数は収束の速さによる。
 *
 * 手順（networkx の `hits` と同じ）:
 * 1. ハブ h を 1/V で始める。
 * 2. 権威 a = Aᵀh（弧 s→t ごとに a[t] += h[s] × 重み）。
 * 3. ハブ h = A a（弧 s→t ごとに h[s] += a[t] × 重み）。h を最大値で割る。
 * 4. 前回との差の絶対値の和が V × 許容より小さければ終わる。
 * 5. ハブと権威を、それぞれ総和 1 にする。
 *
 * 重み 0 の弧は何も足さない（除いたのと同じ）。graphology-metrics の `hits` は 1 回の反復が
 * 文字列のキーの辞書を作り直すので使わず、`Float64Array` で自作した。
 *
 * @param p - 計算用のグラフ
 * @returns 成功か、重みの合計が 0 の `notDefined`（エッジが 0 本を含む）、収束しない失敗
 */
function hitsColumns(p: Prepared): MetricOutcome<NodeMetricValues['eigenvector']> {
  const n = p.ids.length;
  const m = p.arcSource.length;
  const source = Int32Array.from(p.arcSource);
  const target = Int32Array.from(p.arcTarget);
  const weight = Float64Array.from(p.arcWeight);
  let total = 0;
  for (let i = 0; i < m; i++) total += Math.max(weight[i] ?? 0, 0);
  if (!(total > 0)) return fail('notDefined', '重みが正のエッジがありません');

  let h = new Float64Array(n).fill(1 / n);
  const a = new Float64Array(n);
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    a.fill(0);
    for (let i = 0; i < m; i++) {
      const t = target[i] ?? 0;
      a[t] = (a[t] ?? 0) + (h[source[i] ?? 0] ?? 0) * (weight[i] ?? 0);
    }
    const next = new Float64Array(n);
    for (let i = 0; i < m; i++) {
      const s = source[i] ?? 0;
      next[s] = (next[s] ?? 0) + (a[target[i] ?? 0] ?? 0) * (weight[i] ?? 0);
    }
    let max = 0;
    for (let v = 0; v < n; v++) max = Math.max(max, next[v] ?? 0);
    let error = 0;
    for (let v = 0; v < n; v++) {
      next[v] = (next[v] ?? 0) / max;
      error += Math.abs((next[v] ?? 0) - (h[v] ?? 0));
    }
    h = next;
    if (error < n * TOLERANCE) {
      const hubSum = h.reduce((x, y) => x + y, 0);
      const authSum = a.reduce((x, y) => x + y, 0);
      return {
        ok: true,
        value: {
          kind: 'hits',
          hubs: Array.from(h, (x) => x / hubSum),
          authorities: Array.from(a, (x) => x / authSum),
        },
      };
    }
  }
  return fail('noConvergence', 'HITS が収束しませんでした');
}

/**
 * 相互性（Newman ほか、2002、"Email networks and the spread of computer viruses"）。
 * 向きのあるエッジのうち、逆向きのエッジもある割合。networkx の overall_reciprocity と同じ式
 * （往復でない対の数を使い、自己ループは「逆向きがある」に数えない）。混在では無向エッジを数えない。
 * 計算量 O(E)。
 *
 * @param p - 計算用のグラフ
 * @returns 相互性。向きのあるエッジが 0 本なら null
 */
function reciprocity(p: Prepared): number | null {
  const directed = p.snapshot.edges.filter((e) => !isUndirectedEdge(p.snapshot, e));
  if (directed.length === 0) return null;
  const n = p.ids.length;
  // 【なぜ】対のキーは、文字列の連結ではなく整数（小さい添字 × n + 大きい添字）にする。
  // ID 同士の連結は、区切り文字を含む ID で別の対と衝突しうる（filter-audit #9）。向きなしの 1 つにまとめる
  // （to_undirected と同じ）。
  const pairs = new Set<number>();
  for (const e of directed) {
    const s = p.index.get(e.source) ?? 0;
    const t = p.index.get(e.target) ?? 0;
    pairs.add(Math.min(s, t) * n + Math.max(s, t));
  }
  return ((directed.length - pairs.size) * 2) / directed.length;
}

/**
 * 成功を作る。
 *
 * @param value - 値
 * @returns 成功
 */
function succeed<T>(value: T): MetricOutcome<T> {
  return { ok: true, value };
}

// 【TS】`{ [K in NodeMetricId]: (p: Prepared) => MetricOutcome<NodeMetricValues[K]> }` は写像型。
//       指標 ID ごとに「その ID に対応する値の型を返す関数」を 1 つずつ持つ表になる。
//       キーが 1 つでも欠けると型エラーになるので、網羅性も検査される。
//       `computeNodeMetrics` は、この表の関数をキーごとに呼ぶ。
/** ノードごとの指標を計算する関数の表。ノードが 0 個のとき、graphology-metrics の媒介・近接は容量 0 の配列で例外を投げるので、各関数が空の列を返す。 */
const NODE_COMPUTERS: {
  readonly [K in NodeMetricId]: (p: Prepared) => MetricOutcome<NodeMetricValues[K]>;
} = {
  degree: (p) => attempt(() => degreeColumns(p, false)),
  weightedDegree: (p) => attempt(() => degreeColumns(p, true)),
  // Brandes（2001）, "A faster algorithm for betweenness centrality"。O(V·E)。
  // 【なぜ】getEdgeWeight: null で、重みを使わない（ホップ数）ことを明示する（D-30）。
  // 既定では 'weight' を使ってしまう。正規化は 1/((n-1)(n-2))（networkx の normalized=True）。
  betweenness: (p) =>
    attempt(() =>
      p.ids.length === 0
        ? []
        : toColumn(
            p.ids.length,
            betweennessCentrality(buildWorkGraph(p), { getEdgeWeight: null, normalized: true }),
          ),
    ),
  // Freeman（1979）、Wasserman と Faust（1994）。幅優先探索を全点から行う。O(V·(V + E))。
  // 重みなし。有向は、入（他の点から自分へ）を value、出を outgoing に入れる。
  closeness: (p) =>
    attempt(() => {
      const n = p.ids.length;
      const directed = p.kind !== 'undirected';
      if (n === 0) return directed ? { value: [], outgoing: [] } : { value: [] };
      const options = { wassermanFaust: true };
      const value = toColumn(n, closenessCentrality(buildWorkGraph(p), options));
      if (!directed) return { value };
      const outgoing = toColumn(
        n,
        closenessCentrality(buildWorkGraph(p, { reverse: true }), options),
      );
      return { value, outgoing };
    }),
  // Page ほか（1999）, "The PageRank citation ranking"。べき乗法。1 回の反復が O(E)。
  // 重み 0 の弧は除く（冒頭のコメント）。
  pagerank: (p) =>
    attempt(() =>
      p.ids.length === 0
        ? []
        : toColumn(
            p.ids.length,
            pagerank(buildWorkGraph(p, { dropZeroWeight: true }), {
              getEdgeWeight: 'weight',
              alpha: 0.85,
              tolerance: TOLERANCE,
              maxIterations: MAX_ITERATIONS,
            }),
          ),
    ),
  // 有向（混在を含む）は HITS で代える。無向はべき乗法（A + I の累乗で、二部グラフでも収束する）、
  // L2 正規化。非連結のグラフでは、値は一様な初期値から出発した結果になる（networkx と同じ）。
  eigenvector: (p) => {
    if (p.kind !== 'undirected') return hitsColumns(p);
    return attempt(() => ({
      kind: 'eigenvector' as const,
      value:
        p.ids.length === 0
          ? []
          : toColumn(
              p.ids.length,
              eigenvectorCentrality(buildWorkGraph(p, { dropZeroWeight: true }), {
                getEdgeWeight: 'weight',
                tolerance: TOLERANCE,
                maxIterations: MAX_ITERATIONS,
              }),
            ),
    }));
  },
  kCore: (p) => attempt(() => coreNumbers(p.adjacency)),
  clustering: (p) => attempt(() => clusteringCoefficients(p.adjacency)),
};

/**
 * switch の網羅性の検査（`never` に到達したら型エラー）。
 * @param x - 扱い残した値（never）
 */
function assertNeverMetric(x: never): never {
  throw new Error(`未対応の指標: ${String(x)}`);
}

/**
 * 全体の指標を 1 つ計算する。
 *
 * @param p - 計算用のグラフ
 * @param id - 指標
 * @returns 成功か失敗
 */
function computeGlobalMetric(p: Prepared, id: GlobalMetricId): MetricOutcome<number> {
  const n = p.ids.length;
  const arcs = p.arcSource.length;
  const directed = p.kind !== 'undirected';
  switch (id) {
    case 'nodeCount':
      return succeed(n);
    case 'edgeCount':
      // 【なぜ】画面に出すのは元のエッジ数。混在の無向エッジは 1 本と数える（弧は 2 本）。
      return succeed(p.snapshot.edges.length);
    case 'density':
      // 無向 2m/(n(n-1))、有向 m/(n(n-1))（混在は弧の数）。n < 2 は 0。自己ループも m に数える（networkx と同じ）。
      if (n < 2) return succeed(0);
      return succeed(((directed ? 1 : 2) * arcs) / (n * (n - 1)));
    case 'averageDegree':
      // 有向は E/V、無向は 2E/V（D-30）。ノードがなければ値が定まらない。
      if (n === 0) return fail('notDefined', 'ノードがありません');
      return succeed(((directed ? 1 : 2) * arcs) / n);
    case 'components':
      return attempt(() => countComponents(p.adjacency));
    case 'transitivity':
      return attempt(() => transitivity(p.adjacency));
    case 'reciprocity': {
      if (p.kind === 'undirected') return fail('notApplicable', '無向グラフには定義されません');
      const r = reciprocity(p);
      return r === null ? fail('notDefined', '向きのあるエッジがありません') : succeed(r);
    }
    default:
      return assertNeverMetric(id);
  }
}

/**
 * 計算結果につける注意を作る。
 *
 * @param p - 計算用のグラフ
 * @param nodeMetrics - 計算した（要求された）ノードごとの指標
 * @param globalMetrics - 計算した全体の指標
 * @returns 注意の一覧
 */
function buildNotes(
  p: Prepared,
  nodeMetrics: readonly NodeMetricId[],
  globalMetrics: readonly GlobalMetricId[],
): MetricsNote[] {
  const notes: MetricsNote[] = [];
  if (p.kind === 'mixed') {
    notes.push({ code: 'mixedAsBidirectional', nodeMetrics: [], globalMetrics: [] });
  }
  if (p.kind !== 'undirected') {
    const nm = nodeMetrics.filter((m) => m === 'kCore' || m === 'clustering');
    const gm = globalMetrics.filter((m) => m === 'transitivity' || m === 'components');
    if (nm.length + gm.length > 0) {
      notes.push({ code: 'directedAsUndirected', nodeMetrics: nm, globalMetrics: gm });
    }
  }
  // FR-MT-05: ノード型が 2 種類以上なら、1 種類のノードを前提とする指標（中心性、クラスタ係数、
  // 密度、推移性）に注意する（二部グラフなど）。
  const types = new Set(p.snapshot.nodes.map((n) => n.attributes?.type));
  if (types.size >= 2) {
    const nodeTargets: readonly NodeMetricId[] = [
      'betweenness',
      'closeness',
      'pagerank',
      'eigenvector',
      'clustering',
    ];
    const globalTargets: readonly GlobalMetricId[] = ['density', 'transitivity'];
    const nm = nodeMetrics.filter((m) => nodeTargets.includes(m));
    const gm = globalMetrics.filter((m) => globalTargets.includes(m));
    if (nm.length + gm.length > 0) {
      notes.push({ code: 'multipleNodeTypes', nodeMetrics: nm, globalMetrics: gm });
    }
  }
  return notes;
}

/** 結果の組み立て中の、書き込める写像（`MetricsResult['node']` から readonly を外した形）。 */
type NodeResultMap = { -readonly [K in NodeMetricId]?: MetricOutcome<NodeMetricValues[K]> };

/**
 * 要求された指標だけを計算して、結果の写像を作る。
 *
 * 【TS】キーごとに値の型が違う写像は、`for` で動的にキーを足すと型が合わない（ループの変数が共用体に
 * なり、書き込み先の型と結びつかない）。そこで、キーを 1 つずつ書いた式で組み立てる。
 * `...(条件 ? { キー: 値 } : {})` は「条件が真のときだけキーを足す」書き方（スプレッド構文）。
 * 型アサーションも `Record<string, unknown>` も要らず、キーの書き間違いと値の型の食い違いを検査できる。
 *
 * @param p - 計算用のグラフ
 * @param ids - 要求された指標
 * @returns 要求された指標だけを持つ写像
 */
function computeNodeMetrics(p: Prepared, ids: readonly NodeMetricId[]): NodeResultMap {
  const want = new Set<NodeMetricId>(ids);
  return {
    ...(want.has('degree') ? { degree: NODE_COMPUTERS.degree(p) } : {}),
    ...(want.has('weightedDegree') ? { weightedDegree: NODE_COMPUTERS.weightedDegree(p) } : {}),
    ...(want.has('betweenness') ? { betweenness: NODE_COMPUTERS.betweenness(p) } : {}),
    ...(want.has('closeness') ? { closeness: NODE_COMPUTERS.closeness(p) } : {}),
    ...(want.has('pagerank') ? { pagerank: NODE_COMPUTERS.pagerank(p) } : {}),
    ...(want.has('eigenvector') ? { eigenvector: NODE_COMPUTERS.eigenvector(p) } : {}),
    ...(want.has('kCore') ? { kCore: NODE_COMPUTERS.kCore(p) } : {}),
    ...(want.has('clustering') ? { clustering: NODE_COMPUTERS.clustering(p) } : {}),
  };
}

/**
 * グラフの指標を計算する（Worker の中、またはテストから直接呼ぶ純粋な関数）。
 *
 * 計算量は指標による（V はノード数、E はエッジ数）。最も重いのは媒介中心性 O(V·E) と
 * 近接中心性 O(V·(V + E))（重みなしの幅優先探索）。それ以外は O(V + E) で、反復計算は 1 回の反復が O(E)。
 *
 * 実測（Node 24、カバレッジなし、乱数のグラフ、全指標の合計。T1-09 で測定）:
 * - ノード 1,000、エッジ 5,000（NFR-04）: 有向 約 0.5 秒（媒介 約 0.13、近接 約 0.19 秒）。2 秒以内。
 * - ノード 5,000、エッジ 20,000（NFR-03 の上限）: 有向 約 5.0 秒、無向 約 5.1 秒。
 *   内訳は媒介 約 2.6〜3.2 秒、近接 約 1.7〜2.4 秒で、残りの指標は合わせて 0.3 秒ほど。
 *   NFR-04 の 2 秒は 1,000 ノード規模の目標で、上限規模では Worker に任せ、進行を表示する前提（FR-MT-03）。
 *
 * @param snapshot - グラフのスナップショット（`toSnapshot` の結果。structured clone を経たものでもよい）
 * @param request - 計算する指標。省略した項目はすべて
 * @returns 指標ごとの成功か失敗、注意
 *
 * @example
 * ```ts
 * const result = computeMetrics(toSnapshot(graph), { nodeMetrics: ['degree'] });
 * const degree = result.node.degree;
 * if (degree?.ok) console.log(degree.value.total);
 * ```
 */
export function computeMetrics(
  snapshot: GraphSnapshot,
  request: MetricsRequest = {},
): MetricsResult {
  const p = prepare(snapshot);
  const nodeIds = request.nodeMetrics ?? NODE_METRIC_IDS;
  const globalIds = request.globalMetrics ?? GLOBAL_METRIC_IDS;
  const node = computeNodeMetrics(p, nodeIds);
  const global: Partial<Record<GlobalMetricId, MetricOutcome<number>>> = {};
  for (const id of globalIds) global[id] = computeGlobalMetric(p, id);
  return { kind: p.kind, nodeIds: p.ids, node, global, notes: buildNotes(p, nodeIds, globalIds) };
}
