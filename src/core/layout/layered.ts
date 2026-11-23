/**
 * 層状の配置（FR-VG-02）。ノードの型ごとに縦の列に分け、列の中の順は辺の交差が減るように並べる。
 *
 * 規約（設計書 §8.5）:
 * - 列は型ごと。列の順は利用者の指定（`columnOrder`）が先で、指定にない型は型 ID の昇順で後ろに付ける。
 *   指定にあってもデータに無い型は無視する。同じ型の重複指定は最初だけ使う。
 * - 型が 1 つだけ、または 0 の（型の無いデータを含む）ときは列が 1 つになる。
 *   列の間の辺が無いので並べ替えの手がかりが無く、ノード ID の昇順に縦に並べる。
 * - 同じ列の中の辺と自己ループは、交差の数えようが無いので無視する。多重エッジは 1 本として数える
 *   （重心は「つながる相手ノード」の位置の平均なので、本数で重くしない）。
 * - 有向・無向は区別しない（重心は両側の隣接ノードを使う）。向きは交差の数に関係しないため。
 * - 孤立ノードは、現在の順位をそのまま重心とするので、他のノードの並べ替えで自然に動かない。
 * - 決定的: 同じ入力は同じ結果になる。同点は直前の順位、さらに ID の昇順で決める（乱数は使わない）。
 *
 * 出典:
 * - Sugiyama, Tagawa & Toda (1981), "Methods for Visual Understanding of Hierarchical System
 *   Structures", IEEE Trans. Systems, Man, and Cybernetics 11(2), 109-125（重心法による交差の削減）。
 * - Eades & Wormald (1994), "Edge crossings in drawings of bipartite graphs", Algorithmica 11,
 *   379-403（重心法は 2 層でも近似であり、最適とは限らない）。
 *
 * 計算量: 反復 R 回（上限 24）で O(R · (V + E) log V)。
 */
/** 層状の配置の入力のノード。 */
export interface LayeredNode {
  readonly id: string;
  readonly type: string;
}
/** 層状の配置の入力のエッジ（向きは使わない）。 */
export interface LayeredEdge {
  readonly source: string;
  readonly target: string;
}
/** 層状の配置の結果。 */
export interface LayeredResult {
  /** 実際に使った列の順（型 ID）。画面の「列の順」の表示に使う。 */
  readonly columns: readonly string[];
  /** 全ノードの座標（x は列、y は列の中の順）。 */
  readonly coordinates: ReadonlyMap<string, { readonly x: number; readonly y: number }>;
}

/** 列の間隔と行の間隔（画面の単位）。 */
const COLUMN_GAP = 320;
const ROW_GAP = 48;
const MAX_ROUNDS = 24;

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 実際に使う列の順を決める。
 *
 * @param present - データにある型 ID
 * @param requested - 利用者が指定した列の順
 * @returns 指定の順（データにあるものだけ）に、残りの型を昇順で付けた列の順
 */
export function resolveColumnOrder(
  present: Iterable<string>,
  requested: readonly string[],
): string[] {
  const types = new Set(present);
  const result: string[] = [];
  for (const type of requested) if (types.has(type) && !result.includes(type)) result.push(type);
  const rest = [...types].filter((type) => !result.includes(type)).sort(compare);
  return [...result, ...rest];
}

/**
 * 層状の配置を計算する。
 *
 * 手順: (1) 型ごとに列に分け、列の中を ID の昇順で初期化する。(2) 隣接ノードの位置（列の中の順位を
 * 0〜1 に正規化したもの）の平均を重心とし、列を左から右、右から左へ交互に並べ替える。
 * (3) 順位が変わらなくなるか、24 往復で止める。(4) 順位を座標に直す（各列は縦に中央揃え）。
 *
 * 【なぜ】列の大きさが違っても比べられるよう、順位は列の大きさで正規化する。
 * Sugiyama らは隣り合う層の間だけを見るが、k-partite（例: 人物・組織・場所）では
 * 1 つ飛ばしの列との辺もあるので、他のすべての列の隣接ノードを使う。
 *
 * @param nodes - ノード（ID と型）
 * @param edges - エッジ
 * @param columnOrder - 利用者が指定した列の順（型 ID）
 * @returns 使った列の順と、全ノードの座標
 */
export function layeredLayout(
  nodes: readonly LayeredNode[],
  edges: readonly LayeredEdge[],
  columnOrder: readonly string[],
): LayeredResult {
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
  const columns = resolveColumnOrder(typeOf.values(), columnOrder);
  const columnIndex = new Map(columns.map((type, i) => [type, i]));
  // (1) 列に分ける。
  const order: string[][] = columns.map(() => []);
  for (const id of [...typeOf.keys()].sort(compare)) {
    const column = columnIndex.get(typeOf.get(id) ?? '');
    if (column !== undefined) order[column]?.push(id);
  }
  // 隣接（別の列のノードだけ。重複は 1 つにする）。
  const neighbours = new Map<string, Set<string>>();
  for (const e of edges) {
    const a = typeOf.get(e.source);
    const b = typeOf.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    // 【TS】`as const` で配列を読み取り専用のタプル（長さ 2 の固定配列）にする。これで下の分割代入の
    //       from と to が string 型に決まり、`undefined` の可能性を考えなくてよい。
    for (const [from, to] of [
      [e.source, e.target],
      [e.target, e.source],
    ] as const) {
      const set = neighbours.get(from) ?? new Set<string>();
      set.add(to);
      neighbours.set(from, set);
    }
  }
  const rank = new Map<string, number>();
  const refresh = (column: number): void => {
    const ids = order[column] ?? [];
    ids.forEach((id, i) => rank.set(id, ids.length <= 1 ? 0.5 : i / (ids.length - 1)));
  };
  order.forEach((_, i) => {
    refresh(i);
  });
  // (2) 重心法で並べ替える。
  const sweep = (column: number): boolean => {
    const ids = order[column] ?? [];
    const keyed = ids.map((id, index) => {
      const adjacent = neighbours.get(id);
      let sum = 0;
      for (const other of adjacent ?? []) sum += rank.get(other) ?? 0;
      const barycenter =
        adjacent === undefined || adjacent.size === 0 ? (rank.get(id) ?? 0) : sum / adjacent.size;
      return { id, index, barycenter };
    });
    keyed.sort((a, b) => a.barycenter - b.barycenter || a.index - b.index || compare(a.id, b.id));
    const next = keyed.map((k) => k.id);
    const changed = next.some((id, i) => id !== ids[i]);
    order[column] = next;
    refresh(column);
    return changed;
  };
  // (3) 往復。
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    const forward = columns.map((_, i) => i);
    // 【なぜ】reverse() は配列そのものを書き換える。コピーしてから反転し、forward を変えない。
    for (const i of [...forward, ...[...forward].reverse()]) changed = sweep(i) || changed;
    if (!changed) break;
  }
  // (4) 座標。
  const coordinates = new Map<string, { x: number; y: number }>();
  order.forEach((ids, column) => {
    ids.forEach((id, i) => {
      coordinates.set(id, { x: column * COLUMN_GAP, y: (i - (ids.length - 1) / 2) * ROW_GAP });
    });
  });
  return { columns, coordinates };
}
