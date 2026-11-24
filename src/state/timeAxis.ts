import { aggregateTimeline, resolveTimelineSource, timelineSourceOptions } from '../core/filter';
import type { FilterState, TimeSource } from '../core/filter';
import { sameTimeSource } from '../core/filter';
import type { Dataset } from '../core/model';
import type { TimelineSettings } from '../core/project';
import { binCalendarOf, makeTimeAxis } from '../core/time';
import type { CalendarDisplay, TimeAxis } from '../core/time';

/**
 * 日付の出どころを、設定と候補から決める（年表と同じ規則）。
 *
 * @param dataset - データセット
 * @param settings - 年表の設定
 * @param target - ノードかエッジか
 * @returns 使う出どころ。日付が無ければ undefined
 */
export function resolveSource(
  dataset: Dataset,
  settings: TimelineSettings,
  target: 'node' | 'edge',
): TimeSource | undefined {
  return resolveTimelineSource(timelineSourceOptions(dataset, target), settings[target]);
}

// 【なぜ】軸の計算は全要素を数えるので、再生の 1 コマごとには作り直さない。入力（データ、年表の設定、暦）が
//   同じ間は前の結果を返す。1 つだけ覚える（入力が変わるのは利用者が操作したときだけ）。
let cache: {
  readonly dataset: Dataset;
  readonly timeline: TimelineSettings;
  readonly display: CalendarDisplay;
  readonly axis: TimeAxis | null;
} | null = null;

/**
 * 再生の時刻の軸を求める。年表の軸（選んだ対象、出どころ、区切りの幅、暦）と同じ区切りを使う。
 *
 * 軸は絞り込みの結果に依らない（年表の軸は、絞り込む前の全要素の日付で決まる）ので、フィルタを変えても
 * 時刻の範囲は変わらない。区切りが多すぎる（`tooManyBins`）、または日付が無いときは null（再生できない）。
 *
 * @param dataset - データセット
 * @param timeline - 年表の設定
 * @param display - 表示する暦の選択
 * @returns 軸。無ければ null
 */
export function getTimeAxis(
  dataset: Dataset,
  timeline: TimelineSettings,
  display: CalendarDisplay,
): TimeAxis | null {
  if (
    cache !== null &&
    cache.dataset === dataset &&
    cache.timeline === timeline &&
    cache.display === display
  )
    return cache.axis;
  const source = resolveSource(dataset, timeline, timeline.target);
  const calendar = binCalendarOf(display);
  const axis =
    source === undefined
      ? null
      : makeTimeAxis(
          calendar,
          aggregateTimeline(dataset, timeline.target, undefined, source, calendar, timeline.width)
            .bins,
        );
  cache = { dataset, timeline, display, axis };
  return axis;
}

/**
 * 軸を、日の範囲（両端を含む。無ければ開いた端）に狭める。
 *
 * 区切りは範囲に重なるものだけを残し、端の区切りは範囲で切る。時刻の最小・最大も範囲の端になる。
 * 範囲が軸と重ならないときは、軸をそのまま返す（再生できなくなるより、全体で動く方がよい）。
 *
 * @param axis - 元の軸
 * @param from - 範囲の始まり（無ければ軸の始まり）
 * @param to - 範囲の終わり（無ければ軸の終わり）
 * @returns 狭めた軸。変わらないときは元の軸と同じ参照
 */
export function restrictAxis(
  axis: TimeAxis,
  from: number | undefined,
  to: number | undefined,
): TimeAxis {
  const min = Math.max(axis.min, from ?? axis.min);
  const max = Math.min(axis.max, to ?? axis.max);
  if (min > max) return axis;
  if (min === axis.min && max === axis.max) return axis;
  const bins = axis.bins
    .filter((b) => b.latest >= min && b.earliest <= max)
    .map((b) => ({ earliest: Math.max(b.earliest, min), latest: Math.min(b.latest, max) }));
  return { calendar: axis.calendar, bins, min, max };
}

let restrictedCache: {
  readonly axis: TimeAxis;
  readonly from: number | undefined;
  readonly to: number | undefined;
  readonly result: TimeAxis;
} | null = null;

/**
 * 再生の動く範囲の軸を求める（FR-TM-02、D-38）。
 *
 * 年表の軸のうち、今の出どころの時間フィルタ（年表で選んだ範囲）が適用中なら、その期間に限る。
 * 始点、終点、コマ送り、つまみ、終わりでの停止は、すべてこの軸に従う。範囲を解除すれば全体に戻る。
 * 出どころの違う時間フィルタ、別の対象の時間フィルタは見ない（年表の帯と同じ規則）。
 *
 * @param dataset - データセット
 * @param timeline - 年表の設定
 * @param display - 表示する暦の選択
 * @param filters - フィルタの状態
 * @returns 軸。日付が無ければ null
 */
export function getPlaybackAxis(
  dataset: Dataset,
  timeline: TimelineSettings,
  display: CalendarDisplay,
  filters: FilterState,
): TimeAxis | null {
  const axis = getTimeAxis(dataset, timeline, display);
  if (axis === null) return null;
  const source = resolveSource(dataset, timeline, timeline.target);
  if (source === undefined) return axis;
  let range: { from: number | undefined; to: number | undefined } | null = null;
  for (const f of filters.filters) {
    if (f.kind === 'time' && f.target === timeline.target && sameTimeSource(f.source, source)) {
      range = { from: f.from, to: f.to };
      break;
    }
  }
  if (range === null) return axis;
  const c = restrictedCache;
  if (c !== null && c.axis === axis && c.from === range.from && c.to === range.to) return c.result;
  const result = restrictAxis(axis, range.from, range.to);
  restrictedCache = { axis, from: range.from, to: range.to, result };
  return result;
}
