/**
 * 年表のビンの集計（FR-TM-01、FR-TM-04、FR-TM-05、D-35、D-42）。
 *
 * 絞り込み後の集合のノードかエッジを、日付の出どころ（時間フィルタと同じ `TimeSource`）と
 * 区切りの幅（1・10・25・100 年）で数える。純粋関数で、毎回数え直す（差分で更新しない）。
 *
 * 【数え方】（設計書 D-35 の補足）
 * 1. 要素の「日付の幅」は、出どころごとに次のとおり。
 *    - `span`: 開始の最も早い日から、終了の最も遅い日まで（時間フィルタの `span` と同じ端）。終了が無い
 *      （1 点の日付）なら開始の幅だけ。終了が欠損（「1650 年から」。D-19）のときも開始の幅だけで、
 *      終わりを推測して幅を延ばさない。**時間フィルタは終了が欠損の期間の終わりを +∞ とみなす**ので、
 *      年表は開始の区切りにしか数えなくても、その要素は開始より後の範囲で絞り込んでも残る（意図した違い）。
 *    - 終了の最も遅い日が開始の最も早い日より前の不整合な期間は、時間フィルタと同じく幅を持たない
 *      ものとして区切りに数えず、`inconsistent` に別に数える（年代なしではない）。
 *    - `attr`: 日付の値 1 つにつき 1 つの幅（複数値は幅が複数）。
 * 2. 要素は、日付の幅と重なる区切りのすべてに 1 回ずつ数える（同じ区切りに幅が 2 つ入っても 1 回）。
 *    時間フィルタの「重なる」（`overlaps`）と同じ考え方なので、年表で区切りを選んで「重なる」で絞り込むと、
 *    選んだ区切りの棒に数えた要素が残る（FR-FL-11）。「収まる」（`within`）に替えると、幅が範囲をはみ出す
 *    要素は残らない。
 *    その代わり、幅のある要素は複数の区切りに現れ、棒の高さを足しても要素数にならない。
 * 3. 棒の中を 2 つに分ける。`contained` はその区切りに日付の幅がすべて収まる要素、残り
 *    （`count - contained`）は幅が区切りをまたぐ要素。年表は後者を模様の違う部分で示し、色だけに頼らず
 *    「幅のある年代」（FR-TM-04）を読めるようにする。
 * 4. 日付が 1 つも無い要素（時期の列が無い、欠損、日付でない属性）は区切りに数えず、`noDate` に数える
 *    （FR-TM-05）。絞り込みで除いた件数とは別の数で、絞り込み後の集合の中の件数。
 * 5. 軸は、絞り込む前の全要素の日付から決める（`total` も全要素の数）。絞り込むと棒が消えて
 *    範囲を選び直せなくなるのを避け、絞り込みで除いた分を薄く並べて見せるため。
 *
 * 区切りの算出は `core/time/bins.ts` に任せ、暦の換算をここでは書かない。計算量は、要素数を n、
 * 1 要素が重なる区切りの数を k として O(n·k)。区切りの総数は {@link MAX_TIMELINE_BINS} までに制限する。
 */
import { dateValues, getAttr, isMissing } from '../model';
import type { Dataset, GraphEdge, GraphNode } from '../model';
import { binDayRange, binStartYear } from '../time';
import type { DayRange, TimeBinWidth } from '../time';
import type { CalendarId } from '../model';
import { assertNever } from '../util/assertNever';
import { dateAttributes, timeDataExtent } from './timeSource';
import type { Target, TimeSource } from './types';

// 【TS】`readonly` を付けた項目は代入できない。集計の結果は作った後で書き換えない約束を型で表す。
//       `ReadonlySet<string>` は add や delete を持たない Set の型で、受け取る側が集合を書き換えないと示す。
/** 年表の区切りの数の上限。これを超える（桁違いに離れた日付がある）ときは、集計せずに知らせる。 */
export const MAX_TIMELINE_BINS = 2000;

/** 年表の区切り 1 つ。 */
export interface TimelineBin {
  /** 区切りの最初の年（区切りを数える暦の天文学的な年。幅の整数倍）。 */
  readonly startYear: number;
  /** 区切りの初日と末日（JDN）。 */
  readonly earliest: number;
  readonly latest: number;
  /** 絞り込み後の集合で、この区切りと重なる要素の数。 */
  readonly count: number;
  /** そのうち、日付の幅がすべてこの区切りに収まる要素の数。 */
  readonly contained: number;
  /** 絞り込む前の全要素で、この区切りと重なる要素の数（軸の背景）。 */
  readonly total: number;
}

/** 年表の集計の結果。 */
export interface TimelineResult {
  readonly calendar: CalendarId;
  readonly width: TimeBinWidth;
  /** 先頭から末尾まで切れ目なく並べた区切り（空の区切りも含む）。日付が無ければ空。 */
  readonly bins: readonly TimelineBin[];
  /** 区切りが上限を超えたため集計しなかった。`bins` は空。 */
  readonly tooManyBins: boolean;
  /** 全要素の日付の最も早い日と最も遅い日（JDN）。日付が無ければ undefined。離れた日付を確かめる案内に使う。 */
  readonly extent: { readonly earliest: number; readonly latest: number } | undefined;
  /** 絞り込み後の集合のうち、日付が無い要素の数。 */
  readonly noDate: number;
  /** 絞り込む前の全要素のうち、日付が無い要素の数。 */
  readonly noDateTotal: number;
  /** 絞り込み後の集合のうち、期間が不整合（終了が開始より前）で数えなかった要素の数。 */
  readonly inconsistent: number;
  /** 絞り込む前の全要素のうち、期間が不整合な要素の数。 */
  readonly inconsistentTotal: number;
  /** `total` の最大（棒の高さの目盛りの上限）。 */
  readonly maxTotal: number;
}

/**
 * 要素 1 つの、日付の幅の一覧を返す。年表が数える日付の幅の定義（上の【数え方】1）。
 *
 * T2-04（欠損の時期別）が、同じ区切りで数えるときにも使う。
 *
 * @param item - ノードかエッジ
 * @param source - 日付の出どころ
 * @returns 日付の幅（JDN）。日付が無ければ空。安全な整数でない端を持つ幅は除く
 */
// 【TS】`GraphNode | GraphEdge` は共用体型。どちらも `time` と `attrs` を持つので、同じ関数で扱える。
//       `switch (source.kind)` は判別共用体（`TimeSource`）の分岐で、`assertNever` が分岐の書き忘れを検出する。
export function itemDayRanges(item: GraphNode | GraphEdge, source: TimeSource): DayRange[] {
  const out: DayRange[] = [];
  const take = (earliest: number, latest: number): void => {
    if (Number.isSafeInteger(earliest) && Number.isSafeInteger(latest)) {
      out.push({ earliest: Math.min(earliest, latest), latest: Math.max(earliest, latest) });
    }
  };
  switch (source.kind) {
    case 'span': {
      const t = item.time;
      if (t === undefined || t.kind === 'missing') break;
      if (t.end === undefined || isMissing(t.end)) {
        take(t.start.earliest, t.start.latest);
      } else if (t.end.latest >= t.start.earliest) {
        // 【なぜ】時間フィルタ（apply.ts の testSpan）と同じ端: 開始の最も早い日から終了の最も遅い日まで。
        take(t.start.earliest, t.end.latest);
      }
      // 終了が開始より前の不整合な期間は幅を持たない（`isInconsistentSpan` で別に数える）。
      break;
    }
    case 'attr': {
      const a = getAttr(item.attrs, source.attr);
      if (a?.kind !== 'date') break;
      for (const d of dateValues(a)) take(d.earliest, d.latest);
      break;
    }
    default:
      assertNever(source, 'TimeSource');
  }
  return out;
}

/**
 * 要素の `span` が不整合（終了の最も遅い日が開始の最も早い日より前）かを返す。
 *
 * 時間フィルタはこの期間をどの範囲とも重ならないものとして扱うので、年表も区切りに数えず、
 * 「日付が不整合」として別に示す。`attr` の出どころには不整合の概念が無く、常に false。
 *
 * @param item - ノードかエッジ
 * @param source - 日付の出どころ
 * @returns 不整合なら true
 */
export function isInconsistentSpan(item: GraphNode | GraphEdge, source: TimeSource): boolean {
  if (source.kind !== 'span') return false;
  const t = item.time;
  if (t === undefined || t.kind === 'missing') return false;
  return t.end !== undefined && !isMissing(t.end) && t.end.latest < t.start.earliest;
}

/**
 * 日付の幅の一覧が重なる区切りの、最初の年の一覧を返す（重複なし、昇順）。
 *
 * @param ranges - 日付の幅（`itemDayRanges` の結果）
 * @param calendar - 区切りを数える暦
 * @param width - 区切りの幅（年）
 * @returns 区切りの最初の年。幅が空なら空
 */
export function binStartYearsOf(
  ranges: readonly DayRange[],
  calendar: CalendarId,
  width: TimeBinWidth,
): number[] {
  const years = new Set<number>();
  for (const r of ranges) {
    const last = binStartYear(r.latest, calendar, width);
    for (let y = binStartYear(r.earliest, calendar, width); y <= last; y += width) years.add(y);
  }
  return [...years].sort((a, b) => a - b);
}

/**
 * 年表の集計をする。
 *
 * @param dataset - データセット
 * @param target - ノードかエッジか
 * @param ids - 絞り込み後の要素の ID の集合（`FilterResult.nodeIds` か `edgeIds`）。undefined なら全要素
 * @param source - 日付の出どころ
 * @param calendar - 区切りを数える暦（`binCalendarOf(display)`）
 * @param width - 区切りの幅（年）
 * @returns 区切りごとの件数と、日付の無い要素の数
 */
export function aggregateTimeline(
  dataset: Dataset,
  target: Target,
  ids: ReadonlySet<string> | undefined,
  source: TimeSource,
  calendar: CalendarId,
  width: TimeBinWidth,
): TimelineResult {
  const items: readonly (GraphNode | GraphEdge)[] =
    target === 'node' ? dataset.nodes : dataset.edges;

  // 手順 1: 要素ごとに日付の幅を集め、区切りの範囲（最初と最後）を決める。
  interface Row {
    readonly shown: boolean;
    readonly ranges: readonly DayRange[];
  }
  const rows: Row[] = [];
  let firstYear = Number.POSITIVE_INFINITY;
  let earliestDay = Number.POSITIVE_INFINITY;
  let latestDay = Number.NEGATIVE_INFINITY;
  let lastYear = Number.NEGATIVE_INFINITY;
  let noDate = 0;
  let noDateTotal = 0;
  let inconsistent = 0;
  let inconsistentTotal = 0;
  for (const item of items) {
    const shown = ids === undefined || ids.has(item.id);
    const ranges = itemDayRanges(item, source);
    if (ranges.length === 0 && isInconsistentSpan(item, source)) {
      inconsistentTotal += 1;
      if (shown) inconsistent += 1;
      continue;
    }
    if (ranges.length === 0) {
      noDateTotal += 1;
      if (shown) noDate += 1;
      continue;
    }
    rows.push({ shown, ranges });
    for (const r of ranges) {
      earliestDay = Math.min(earliestDay, r.earliest);
      latestDay = Math.max(latestDay, r.latest);
      firstYear = Math.min(firstYear, binStartYear(r.earliest, calendar, width));
      lastYear = Math.max(lastYear, binStartYear(r.latest, calendar, width));
    }
  }
  const empty = {
    calendar,
    width,
    noDate,
    noDateTotal,
    inconsistent,
    inconsistentTotal,
    maxTotal: 0,
  } as const;
  const extent = rows.length === 0 ? undefined : { earliest: earliestDay, latest: latestDay };
  if (rows.length === 0) return { ...empty, bins: [], tooManyBins: false, extent };
  const binCount = (lastYear - firstYear) / width + 1;
  if (binCount > MAX_TIMELINE_BINS) return { ...empty, bins: [], tooManyBins: true, extent };

  // 手順 2: 区切りごとの件数を数える。1 要素は重なる区切りに 1 回ずつ。
  const count = new Array<number>(binCount).fill(0);
  const contained = new Array<number>(binCount).fill(0);
  const total = new Array<number>(binCount).fill(0);
  for (const row of rows) {
    const years = binStartYearsOf(row.ranges, calendar, width);
    // 【なぜ】幅がすべて 1 つの区切りに収まる要素だけを「収まる」にする。複数の値のうち 1 つでも
    //   別の区切りにあれば、その要素は区切りをまたぐものとして扱う。
    const single =
      years.length === 1 &&
      row.ranges.every(
        (r) =>
          binStartYear(r.earliest, calendar, width) === binStartYear(r.latest, calendar, width),
      );
    for (const y of years) {
      const i = (y - firstYear) / width;
      total[i] = (total[i] ?? 0) + 1;
      if (row.shown) {
        count[i] = (count[i] ?? 0) + 1;
        if (single) contained[i] = (contained[i] ?? 0) + 1;
      }
    }
  }
  const bins: TimelineBin[] = [];
  let maxTotal = 0;
  for (let i = 0; i < binCount; i += 1) {
    const startYear = firstYear + i * width;
    const { earliest, latest } = binDayRange(calendar, startYear, width);
    const t = total[i] ?? 0;
    maxTotal = Math.max(maxTotal, t);
    bins.push({
      startYear,
      earliest,
      latest,
      count: count[i] ?? 0,
      contained: contained[i] ?? 0,
      total: t,
    });
  }
  return {
    calendar,
    width,
    bins,
    tooManyBins: false,
    extent,
    noDate,
    noDateTotal,
    inconsistent,
    inconsistentTotal,
    maxTotal,
  };
}

/**
 * 2 つの日付の出どころが同じかを返す。
 *
 * @param a - 出どころ
 * @param b - 出どころ
 * @returns 同じなら true（`attr` は属性のキーが同じとき）
 */
// 【TS】`a.kind === 'span' ? … : b.kind === 'attr' && a.attr === b.attr` の `a.attr` は、三項演算子の else 側で
//       a が `{ kind: 'attr' }` に絞り込まれているため書ける（判別共用体の絞り込み）。
export function sameTimeSource(a: TimeSource, b: TimeSource): boolean {
  return a.kind === 'span' ? b.kind === 'span' : b.kind === 'attr' && a.attr === b.attr;
}

/**
 * 年表（と、同じ出どころを使う欠損の時期別の一覧）で選べる日付の出どころを返す。
 *
 * 要素の期間（`span`）は、その対象に期間のある要素があるときだけ。続けて、日付の属性を schema の順に。
 * 時間フィルタの出どころの選択肢（`TimeControl`）と同じ規則。
 *
 * @param dataset - データセット
 * @param target - ノードかエッジか
 * @returns 選べる出どころ（無ければ空）
 */
export function timelineSourceOptions(dataset: Dataset, target: Target): TimeSource[] {
  const out: TimeSource[] = [];
  if (timeDataExtent(dataset, target, { kind: 'span' }) !== undefined) out.push({ kind: 'span' });
  for (const a of dateAttributes(dataset, target)) out.push({ kind: 'attr', attr: a.key });
  return out;
}

/**
 * 保存された選択（または未選択）から、実際に使う出どころを決める。
 *
 * 選択が候補に無い（属性が消えた、日付でなくなった）ときや、未選択（null）のときは、最初の候補を使う。
 *
 * @param options - `timelineSourceOptions` の結果
 * @param chosen - 設定に保存された出どころ。未選択は null
 * @returns 使う出どころ。候補が無ければ undefined
 */
export function resolveTimelineSource(
  options: readonly TimeSource[],
  chosen: TimeSource | null,
): TimeSource | undefined {
  return options.find((o) => chosen !== null && sameTimeSource(o, chosen)) ?? options[0];
}
