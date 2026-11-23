/**
 * 時間フィルタの日付の出どころ（D-35）の候補と、適用中の時間フィルタの説明（FR-FL-03、FR-TM-09）。
 *
 * 説明は文字にせず、JDN と種類の構造で返す。文字にするのは ui で、選んだ暦（D-45）に合わせて
 * `core/time` の `describeDayRange` で表記にする。
 */
import { dateValues, getAttr, isMissing } from '../model';
import type { AttributeDef, Dataset } from '../model';
import type { CalendarDisplay, CalendarRendering } from '../time';
import { describeDayRange } from '../time';
import { assertNever } from '../util/assertNever';
import type { FilterDef, MissingPolicy, Target, TimeMatch, TimeSource } from './types';

/**
 * 時間フィルタの出どころに選べる属性（`valueType: 'date'`）を返す。
 *
 * ノード用なら `appliesTo: 'node'`、エッジ用なら `'edge'` の属性だけ。`nodeType` を持つ属性
 * （特定のノード型だけの属性）も含める。schema の並びのまま。
 *
 * @param dataset - データセット
 * @param target - ノードかエッジか
 * @returns 日付属性の定義の一覧（無ければ空）
 */
export function dateAttributes(dataset: Dataset, target: Target): AttributeDef[] {
  return dataset.schema.filter((a) => a.valueType === 'date' && a.appliesTo === target);
}

/** 説明に出す日付の出どころ。属性なら、キーと（schema にあれば）表示名。 */
export type TimeSourceDescription =
  | { readonly kind: 'span' }
  | {
      readonly kind: 'attr';
      readonly attr: string;
      /** schema の表示名。属性が schema に無ければ `undefined`（キーを出す） */
      readonly label: string | undefined;
    };

/** 適用中の時間フィルタの説明（文字にする前の構造）。 */
export interface TimeFilterDescription {
  readonly target: Target;
  readonly source: TimeSourceDescription;
  /** 範囲の両端（JDN）。 */
  readonly from: number;
  readonly to: number;
  /** 重なる（'overlaps'）か、収まる（'within'）か。 */
  readonly match: TimeMatch;
  /** 欠損を含めるか除くか。 */
  readonly missing: MissingPolicy;
  /** 範囲が逆転していて何も通らない（欠損だけ通りうる）。 */
  readonly reversed: boolean;
  /** 範囲を選んだ暦で表した部品。逆転しているときも、そのまま出す。 */
  readonly range: CalendarRendering[];
}

/**
 * 時間フィルタを、説明用の構造にする。
 *
 * @param def - 時間フィルタ（`kind: 'time'`）
 * @param dataset - 属性の表示名を引くためのデータセット（省略すると表示名なし）
 * @param display - 表示の暦（D-45）
 * @returns 説明の構造
 */
export function describeTimeFilter(
  def: Extract<FilterDef, { kind: 'time' }>,
  dataset: Dataset | undefined,
  display: CalendarDisplay,
): TimeFilterDescription {
  const reversed = def.from > def.to;
  // 【なぜ】逆転した範囲は describeDayRange の前提（earliest <= latest）を満たさないので、並べ替えて表記にする。
  const lo = Math.min(def.from, def.to);
  const hi = Math.max(def.from, def.to);
  return {
    target: def.target,
    source: describeSource(def, dataset),
    from: def.from,
    to: def.to,
    match: def.match,
    missing: def.missing,
    reversed,
    range: describeDayRange({ earliest: lo, latest: hi }, display),
  };
}

function describeSource(
  def: Extract<FilterDef, { kind: 'time' }>,
  dataset: Dataset | undefined,
): TimeSourceDescription {
  const s = def.source;
  switch (s.kind) {
    case 'span':
      return { kind: 'span' };
    case 'attr': {
      const found = dataset?.schema.find((a) => a.key === s.attr && a.appliesTo === def.target);
      return { kind: 'attr', attr: s.attr, label: found?.label };
    }
    default:
      return assertNever(s, 'TimeSource');
  }
}

/** 日付の範囲（JDN の両端）。 */
export interface DayExtent {
  readonly min: number;
  readonly max: number;
}

/**
 * データにある日付の最小値と最大値（JDN）を求める。
 *
 * 時間フィルタの入力で、空の側（開いた端）をデータの範囲で埋めるために使う。
 * 無限大は返さない（`FilterDef` の `from`、`to` を安全な整数に保つため）。
 * 幅のある日付は、最も早い日（`earliest`）と最も遅い日（`latest`）の両方を数える。
 * `span` で終わりが分からない期間は、分かっている端だけを数える。
 *
 * @param dataset - データセット
 * @param target - ノードかエッジか
 * @param source - 日付の出どころ
 * @returns 範囲。日付が 1 つも無ければ undefined
 */
export function timeDataExtent(
  dataset: Dataset,
  target: Target,
  source: TimeSource,
): DayExtent | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const take = (earliest: number, latest: number): void => {
    if (Number.isSafeInteger(earliest) && earliest < min) min = earliest;
    if (Number.isSafeInteger(latest) && latest > max) max = latest;
  };
  const items = target === 'node' ? dataset.nodes : dataset.edges;
  for (const item of items) {
    switch (source.kind) {
      case 'span': {
        const t = item.time;
        if (t === undefined || t.kind === 'missing') break;
        take(t.start.earliest, t.start.latest);
        if (t.end !== undefined && !isMissing(t.end)) take(t.end.earliest, t.end.latest);
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
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : undefined;
}
