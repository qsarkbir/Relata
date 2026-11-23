import { aggregateTimeline, resolveTimelineSource, timelineSourceOptions } from '../core/filter';
import type { TimeSource } from '../core/filter';
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
