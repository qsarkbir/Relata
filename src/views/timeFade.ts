import { useMemo, useState } from 'react';
import { buildTimeIndex, outOfTime } from '../core/filter';
import type { RelataGraph } from '../core/graph';
import type { Dataset } from '../core/model';
import { binCalendarOf, describeDay, describeDayRange, timeWindowOf } from '../core/time';
import type { CalendarDisplay, TimeSettings } from '../core/time';
import { resolveTimeSource } from '../state';
import { useData, useDisplay, useT, useTime, useTimelineView } from './hooks';
import { renderingsText } from './filter/timeText';
import type { Translate } from './filter/labels';

/** グラフの上で薄くする要素。ノードの ID と、グラフのエッジのキー。 */
export interface GraphFade {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
}

const NO_FADE: GraphFade = { nodes: new Set(), edges: new Set() };

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * 再生の時刻の外にある、グラフの要素を求める（FR-TM-02、D-38）。
 *
 * 判定は core の `outOfTime`（元のノードとエッジ）。ここでは、まとめた後のエッジ（グラフのキー）に
 * 読み替える: 元のエッジがすべて時刻の外なら薄くする（1 つでも時刻の中にあれば見せる）。射影したエッジは、
 * 根拠の元のエッジで同じ規則を使う。日付の出どころは年表で選んでいるもの（ノードとエッジそれぞれ）。
 *
 * フィルタの結果、件数、指標は読まない・変えない。日付の幅の索引は、データか出どころが変わったときだけ
 * 作り、時刻が動くたびに計算するのは範囲の判定（O(要素数)）だけ。
 *
 * @param dataset - データセット
 * @param graph - 表示中のグラフ
 * @returns 薄くする要素。時刻が無ければ空
 */
export function useTimeFade(dataset: Dataset | null, graph: RelataGraph | null): GraphFade {
  const timeline = useTimelineView((s) => s.timeline);
  const display = useDisplay((s) => s.calendar);
  const at = useTime((s) => s.at);
  const mode = useTime((s) => s.mode);
  const windowYears = useTime((s) => s.windowYears);
  const index = useMemo(
    () =>
      dataset === null
        ? null
        : buildTimeIndex(
            dataset,
            resolveTimeSource(dataset, timeline, 'node'),
            resolveTimeSource(dataset, timeline, 'edge'),
          ),
    [dataset, timeline],
  );
  const next = useMemo((): GraphFade => {
    if (index === null || graph === null) return NO_FADE;
    const window = timeWindowOf({ at, mode, windowYears }, binCalendarOf(display));
    const out = outOfTime(index, window);
    const nodes = new Set<string>();
    for (const id of graph.nodes()) if (out.nodes.has(id)) nodes.add(id);
    const edges = new Set<string>();
    graph.forEachEdge((key, attrs) => {
      if (attrs.edgeIds.length > 0 && attrs.edgeIds.every((id) => out.edges.has(id)))
        edges.add(key);
    });
    return nodes.size === 0 && edges.size === 0 ? NO_FADE : { nodes, edges };
  }, [index, graph, at, mode, windowYears, display]);
  // 【なぜ】時刻が 1 日動いても、薄くする要素が同じなら前の値を返す。図の SVG の文字列の作り直しと
  //   画面への差し替え（重い）を、要素が入れ替わるコマだけに減らす（NFR-05）。描画の途中で前の値と比べて
  //   調整する（TimelineView と同じ書き方）。
  const [stable, setStable] = useState(next);
  const same = sameSet(stable.nodes, next.nodes) && sameSet(stable.edges, next.edges);
  if (!same) setStable(next);
  return same ? stable : next;
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
  if (s.mode === 'cumulative')
    return t('time.state.cumulative', {
      time: renderingsText(t, describeDay(s.at, display, 'year')),
    });
  const w = timeWindowOf(s, binCalendarOf(display));
  const range =
    w === null
      ? ''
      : renderingsText(t, describeDayRange({ earliest: w.from, latest: w.to }, display, 'year'));
  return t('time.state.window', { range, years: String(s.windowYears) });
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
