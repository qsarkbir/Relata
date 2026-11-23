/**
 * 再生の時刻の外にある要素の判定（FR-TM-02、D-38、R-17）。
 *
 * 再生は表示だけを変える。ここで求めるのは「薄く描く要素の ID」だけで、フィルタの結果、件数、指標は
 * 変えない（これらは `applyFilters` などが別に計算する）。時刻が動くたびに全体を作り直さないよう、
 * 要素ごとの日付の幅を 1 度だけ集める {@link buildTimeIndex} と、時刻の範囲で素早く判定する
 * {@link outOfTime} に分ける。
 *
 * 【年代のない要素の扱い】
 * - 日付が無い要素（時期の列が無い、欠損、不整合な期間）は、薄くしない。「いつのものか分からない」
 *   ことを、時刻の外とは別に扱う（年表も「年代なし」の件数を別に示す。FR-TM-05）。
 * - ただしエッジは、自分の日付が無いとき、端点のノードが時刻の外なら薄くする。関係が日付を持たない
 *   データ（人物だけに生没年がある、など）で、まだ存在しない人物の線だけが浮いて見えるのを避けるため。
 *   エッジが自分の日付を持つときは、その日付だけで決める。
 *
 * 【終わりの欠けた期間】時間フィルタ（`apply.ts` の `testSpan`）と同じく、終わりが欠損の期間は終わりを +∞
 * とみなす（「1650 年から」は、それ以後も続いているものとして扱う）。年表の区切りは開始の区切りにだけ数える
 * ので、年表と再生では見え方が違う（意図した違い）。終わりが開始より前の不整合な期間は日付なしと同じ。
 */
import { dateValues, getAttr, isMissing } from '../model';
import type { Dataset, GraphEdge, GraphNode } from '../model';
import type { TimeWindow } from '../time';
import type { TimeSource } from './types';

/** 要素 1 つの日付の幅（JDN の閉区間）。終わりは +∞ のことがある。 */
export interface TimeSpan {
  readonly start: number;
  readonly end: number;
}

/**
 * 要素 1 つの、再生で使う日付の幅の一覧を返す。
 *
 * @param item - ノードかエッジ
 * @param source - 日付の出どころ
 * @returns 日付の幅。日付が無い（または不整合な）ときは空
 */
export function itemTimeSpans(item: GraphNode | GraphEdge, source: TimeSource): TimeSpan[] {
  const out: TimeSpan[] = [];
  if (source.kind === 'span') {
    const t = item.time;
    if (t === undefined || t.kind === 'missing') return out;
    let end: number;
    if (t.end === undefined) end = t.start.latest;
    else if (isMissing(t.end)) end = Number.POSITIVE_INFINITY;
    else end = t.end.latest;
    if (Number.isSafeInteger(t.start.earliest) && end >= t.start.earliest)
      out.push({ start: t.start.earliest, end });
    return out;
  }
  const a = getAttr(item.attrs, source.attr);
  if (a?.kind !== 'date') return out;
  for (const d of dateValues(a)) {
    if (Number.isSafeInteger(d.earliest) && Number.isSafeInteger(d.latest))
      out.push({ start: Math.min(d.earliest, d.latest), end: Math.max(d.earliest, d.latest) });
  }
  return out;
}

/** 時刻の判定のために集めた、日付の幅の索引。 */
export interface TimeIndex {
  /** ノードの ID と日付の幅（日付があるものだけ）。 */
  readonly nodes: readonly { readonly id: string; readonly spans: readonly TimeSpan[] }[];
  /** エッジ。自分の日付が無いものは `spans` が空で、端点を持つ。 */
  readonly edges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly spans: readonly TimeSpan[];
  }[];
}

/**
 * 日付の幅の索引を作る。データか出どころが変わったときだけ作り直せばよい。計算量は O(要素数)。
 *
 * @param dataset - データセット
 * @param nodeSource - ノードの日付の出どころ。undefined ならノードはすべて日付なし
 * @param edgeSource - エッジの日付の出どころ。undefined ならエッジはすべて日付なし
 * @returns 索引
 */
export function buildTimeIndex(
  dataset: Dataset,
  nodeSource: TimeSource | undefined,
  edgeSource: TimeSource | undefined,
): TimeIndex {
  const nodes: { id: string; spans: TimeSpan[] }[] = [];
  for (const n of dataset.nodes) {
    const spans = nodeSource === undefined ? [] : itemTimeSpans(n, nodeSource);
    if (spans.length > 0) nodes.push({ id: n.id, spans });
  }
  const edges = dataset.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    spans: edgeSource === undefined ? [] : itemTimeSpans(e, edgeSource),
  }));
  return { nodes, edges };
}

/** 時刻の外にある要素の ID。 */
export interface OutOfTime {
  readonly nodes: ReadonlySet<string>;
  /** 元のエッジの ID（射影やまとめの前）。 */
  readonly edges: ReadonlySet<string>;
}

/**
 * 時刻の範囲の外にある要素を求める。計算量は O(要素数 + 日付の幅の数)。
 *
 * 日付の幅のどれか 1 つでも範囲と重なれば、時刻の中（薄くしない）。累積では範囲の始まりが -∞ なので、
 * 「時刻より後に始まるもの」だけが外になり、終わった後も残り続ける。
 *
 * @param index - {@link buildTimeIndex} の結果
 * @param window - 見せる日の範囲。null なら何も薄くしない
 * @returns 外にある要素の ID（日付の無い要素は含まない。エッジの端点の規則は上の説明）
 */
export function outOfTime(index: TimeIndex, window: TimeWindow | null): OutOfTime {
  const nodes = new Set<string>();
  const edges = new Set<string>();
  if (window === null) return { nodes, edges };
  const inside = (spans: readonly TimeSpan[]): boolean =>
    spans.some((s) => s.start <= window.to && s.end >= window.from);
  for (const n of index.nodes) if (!inside(n.spans)) nodes.add(n.id);
  for (const e of index.edges) {
    if (e.spans.length > 0) {
      if (!inside(e.spans)) edges.add(e.id);
    } else if (nodes.has(e.source) || nodes.has(e.target)) {
      edges.add(e.id);
    }
  }
  return { nodes, edges };
}
