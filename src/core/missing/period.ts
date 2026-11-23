/**
 * 時期ごとの欠損率（FR-VG-12、D-42、R-21）。
 *
 * 年表と同じ日付の出どころ（`TimeSource`）と区切り（1・10・25・100 年）で、要素を時期に分け、
 * 属性ごとに欠損の件数を数える。絞り込み後の集合から毎回数え直す（差分で更新しない）。
 *
 * 【数え方】（年表 `core/filter/timeline.ts` の【数え方】と同じ）
 * 1. 要素の日付の幅は `itemDayRanges`。幅のある要素は、またがる区切りのすべてに 1 回ずつ数える。
 *    歴史資料では「15 世紀のいつか」のように幅のある年代が普通なので、1 点に潰さない。
 * 2. 日付が無い要素は「年代なし」の行、終了が開始より前の不整合な期間は「不整合」の行に別に数える
 *    （年代なしとは別。0 件なら行を出さない）。
 * 3. 欠損の数え方は属性ごとの一覧と同じ（`addToTally`。キーを持たない要素は欠損に数えない）。
 *    分母は、その区切りに数えた、その属性が当てはまる要素（ノード型を限る属性はその型のノードだけ）。
 * 4. 区切りは、絞り込み後の集合の日付から決め、要素のある区切りだけを行にする（空の区切りは出さない）。
 *    区切りの総数が年表と同じ上限（`MAX_TIMELINE_BINS`）を超えるときは集計せず `tooManyBins` を返す。
 *
 * 計算量は、要素数を n、1 要素が重なる区切りの数を k、属性の数を a として O(n·k·a)。
 */
import { MAX_TIMELINE_BINS, binStartYearsOf, isInconsistentSpan, itemDayRanges } from '../filter';
import type { Target, TimeSource } from '../filter';
import type { AttributeDef, CalendarId, Dataset, GraphEdge, GraphNode } from '../model';
import { getAttr } from '../model';
import { binDayRange, binStartYear } from '../time';
import type { TimeBinWidth } from '../time';
import { addToTally, newTally, tallyToCounts } from './stats';
import type { MissingCounts, Tally } from './stats';

/** 時期ごとの集計に使う属性（行の列になる）。 */
export interface PeriodAttr {
  readonly key: string;
  readonly label: string;
  readonly nodeType?: AttributeDef['nodeType'];
}

/** 区切り 1 つ分の行。`counts` は `PeriodMissing.attrs` と同じ順。 */
export interface PeriodRow {
  /** 区切りの最初の年（区切りを数える暦の天文学的な年）。 */
  readonly startYear: number;
  /** 区切りの初日と末日（JDN）。 */
  readonly earliest: number;
  readonly latest: number;
  /** この区切りに数えた要素の数（属性に関係なく）。 */
  readonly items: number;
  readonly counts: readonly MissingCounts[];
}

/** 区切りに入らない要素の行（年代なし、不整合）。 */
export interface PeriodSpecialRow {
  readonly items: number;
  readonly counts: readonly MissingCounts[];
}

/** 時期ごとの欠損率の結果。 */
export interface PeriodMissing {
  readonly calendar: CalendarId;
  readonly width: TimeBinWidth;
  /** 列にする属性（対象に当てはまる属性、schema の順）。 */
  readonly attrs: readonly PeriodAttr[];
  /** 区切りごとの行（昇順。要素のある区切りだけ）。 */
  readonly rows: readonly PeriodRow[];
  /** 年代のない要素。 */
  readonly noDate: PeriodSpecialRow;
  /** 期間が不整合な要素（0 件なら items が 0）。 */
  readonly inconsistent: PeriodSpecialRow;
  /** 区切りが上限を超えたため集計しなかった。`rows` は空。 */
  readonly tooManyBins: boolean;
  /** 数えた（絞り込み後の）要素の数。0 なら「絞り込みで 0 件」。 */
  readonly shownItems: number;
}

/**
 * 時期ごとに、属性の欠損を数える。
 *
 * @param dataset - データセット
 * @param target - ノードかエッジか（年表の対象に従う）
 * @param ids - 絞り込み後の要素の ID（`FilterResult.nodeIds` か `edgeIds`）
 * @param source - 日付の出どころ（年表の設定に従う）
 * @param calendar - 区切りを数える暦（`binCalendarOf(display)`）
 * @param width - 区切りの幅（年）
 * @returns 区切りごとの行と、年代なし・不整合の行
 */
export function countMissingByPeriod(
  dataset: Dataset,
  target: Target,
  ids: ReadonlySet<string>,
  source: TimeSource,
  calendar: CalendarId,
  width: TimeBinWidth,
): PeriodMissing {
  const defs = dataset.schema.filter((d) => d.appliesTo === target);
  const attrs: PeriodAttr[] = defs.map((d) => ({
    key: d.key,
    label: d.label,
    ...(d.nodeType === undefined ? {} : { nodeType: d.nodeType }),
  }));
  const items: readonly (GraphNode | GraphEdge)[] =
    target === 'node' ? dataset.nodes : dataset.edges;

  interface Bucket {
    items: number;
    readonly tallies: Tally[];
  }
  const newBucket = (): Bucket => ({ items: 0, tallies: defs.map(() => newTally()) });
  // 1 要素を、その属性ごとに集計へ足す。ノード型を限る属性は、その型のノードだけ。
  const add = (bucket: Bucket, item: GraphNode | GraphEdge): void => {
    bucket.items += 1;
    defs.forEach((d, i) => {
      // 【TS】`'type' in item` は型ガード。ノードだけが `type` を持つので、ここでは item が GraphNode に絞られる。
      if (d.nodeType !== undefined && 'type' in item && item.type !== d.nodeType) return;
      addToTally(bucket.tallies[i] ?? newTally(), getAttr(item.attrs, d.key));
    });
  };
  const noDate = newBucket();
  const inconsistent = newBucket();
  const byYear = new Map<number, Bucket>();
  let shownItems = 0;
  let firstYear = Number.POSITIVE_INFINITY;
  let lastYear = Number.NEGATIVE_INFINITY;
  const dated: { item: GraphNode | GraphEdge; years: number[] }[] = [];
  for (const item of items) {
    if (!ids.has(item.id)) continue;
    shownItems += 1;
    const ranges = itemDayRanges(item, source);
    if (ranges.length === 0) {
      add(isInconsistentSpan(item, source) ? inconsistent : noDate, item);
      continue;
    }
    const years = binStartYearsOf(ranges, calendar, width);
    for (const r of ranges) {
      firstYear = Math.min(firstYear, binStartYear(r.earliest, calendar, width));
      lastYear = Math.max(lastYear, binStartYear(r.latest, calendar, width));
    }
    dated.push({ item, years });
  }
  const finish = (b: Bucket): PeriodSpecialRow => ({
    items: b.items,
    counts: b.tallies.map(tallyToCounts),
  });
  const base = {
    calendar,
    width,
    attrs,
    noDate: finish(noDate),
    inconsistent: finish(inconsistent),
    shownItems,
  };
  if (dated.length === 0) return { ...base, rows: [], tooManyBins: false };
  // 【なぜ】年表と同じ上限と同じ数え方（先頭から末尾までの区切りの数）で、集計するかを決める。
  if ((lastYear - firstYear) / width + 1 > MAX_TIMELINE_BINS)
    return { ...base, rows: [], tooManyBins: true };
  for (const { item, years } of dated) {
    for (const y of years) {
      let b = byYear.get(y);
      if (b === undefined) {
        b = newBucket();
        byYear.set(y, b);
      }
      add(b, item);
    }
  }
  const rows: PeriodRow[] = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([startYear, b]) => {
      const { earliest, latest } = binDayRange(calendar, startYear, width);
      return { startYear, earliest, latest, ...finish(b) };
    });
  return { ...base, rows, tooManyBins: false };
}
