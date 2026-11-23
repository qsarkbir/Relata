import { useStore } from 'zustand';
import { binCalendarOf, describeDay, describeDayRange, timeWindowOf } from '../core/time';
import type { CalendarDisplay, TimeSettings } from '../core/time';
import { assertNever } from '../core/util/assertNever';
import { timeFadeStore } from '../state';
import type { GraphFade } from '../state';
import { useData, useDisplay, useT, useTime } from './hooks';
import { renderingsText } from './filter/timeText';
import type { Translate } from './filter/labels';

/**
 * 再生の時刻の外として薄くする、グラフの要素を返す（FR-TM-02、D-38）。
 *
 * 求めるのは state の派生ストア（`timeFadeStore`）。時刻そのものは購読しないので、集合が変わらない
 * コマでは、呼んだ部品（グラフ）は再描画されない（NFR-05）。
 *
 * @returns 薄くするノードの ID と、図のエッジのキー。時刻が無ければ空
 */
export function useTimeFade(): GraphFade {
  return useStore(timeFadeStore);
}

/**
 * 時刻の説明の文を作る（適用中の条件の行、年表、グラフの注記で共通）。
 *
 * 累積は「1450年まで」、移動窓は「1441年〜1450年」。表示する暦で書き、暦の併記にも従う。
 *
 * @param t - 翻訳
 * @param display - 表示する暦
 * @param s - 時間の設定（`at` が null なら空文字）
 * @returns 文
 */
export function timeStateText(t: Translate, display: CalendarDisplay, s: TimeSettings): string {
  if (s.at === null) return '';
  switch (s.mode) {
    case 'cumulative':
      return t('time.state.cumulative', {
        time: renderingsText(t, describeDay(s.at, display, 'year')),
      });
    case 'window': {
      const w = timeWindowOf(s, binCalendarOf(display));
      const range =
        w === null
          ? ''
          : renderingsText(
              t,
              describeDayRange({ earliest: w.from, latest: w.to }, display, 'year'),
            );
      return t('time.state.window', { range, years: String(s.windowYears) });
    }
    default:
      return assertNever(s.mode, 'TimeMode');
  }
}

/**
 * 現在の言語と暦での、時刻の説明を返すフック。
 *
 * @returns 文。時刻が無ければ空文字
 */
export function useTimeStateText(): string {
  const t = useT();
  const display = useDisplay((s) => s.calendar);
  const at = useTime((s) => s.at);
  const mode = useTime((s) => s.mode);
  const windowYears = useTime((s) => s.windowYears);
  const speed = useTime((s) => s.speed);
  const dataset = useData((s) => s.dataset);
  if (dataset === null) return '';
  return timeStateText(t, display, { at, mode, windowYears, speed });
}
