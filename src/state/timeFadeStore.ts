import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';
import { buildTimeIndex, fadedGraphEdges, outOfTime } from '../core/filter';
import type { TimeIndex } from '../core/filter';
import type { Dataset } from '../core/model';
import { binCalendarOf, timeWindowOf } from '../core/time';
import type { DataState } from './dataStore';
import { dataStore } from './dataStore';
import { displayStore } from './displayStore';
import type { DisplayState } from './displayStore';
import type { FilterStoreState } from './filterStore';
import { filterStore, selectFilterState } from './filterStore';
import { graphViewStore, selectGraphOptions } from './graphViewStore';
import type { GraphViewState } from './graphViewStore';
import { getNetwork } from './networkView';
import { resolveSource } from './timeAxis';
import { timeStore } from './timeStore';
import type { TimeStoreState } from './timeStore';
import { timelineStore } from './timelineStore';
import type { TimelineViewState } from './timelineStore';

/** グラフの上で薄くする要素（FR-TM-02、D-38）。ノードの ID と、図のエッジのキー。 */
export interface GraphFade {
  readonly nodes: ReadonlySet<string>;
  readonly edges: ReadonlySet<string>;
}

/** 何も薄くしない。 */
export const NO_FADE: GraphFade = { nodes: new Set(), edges: new Set() };

/** 派生ストアの入力になる、元のストア。テストで差し替える。 */
export interface TimeFadeSources {
  readonly data: StoreApi<DataState>;
  readonly filter: StoreApi<FilterStoreState>;
  readonly graphView: StoreApi<GraphViewState>;
  readonly timeline: StoreApi<TimelineViewState>;
  readonly display: StoreApi<DisplayState>;
  readonly time: StoreApi<TimeStoreState>;
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * 「時刻の外として薄くする要素」を求める派生ストアを作る（NFR-05、D-38）。
 *
 * 時刻は再生中に毎コマ変わるが、薄くする集合が変わるコマはずっと少ない。ここで集合を求め、
 * **集合が変わったときだけ**通知する。GraphView は時刻そのものを購読せずこのストアだけを読むので、
 * 集合が同じコマでは再描画されない。フィルタ、件数、指標は読まない・変えない。
 *
 * 入力（データ、フィルタ、構築の設定、年表の設定、暦、時刻）のどれかが変わると求め直す。
 * 日付の幅の索引はデータか年表の出どころが変わったときだけ作り直す。時刻が無く、薄くしている
 * ものも無いときは、何も計算しない。
 *
 * @param sources - 入力のストア
 * @returns 派生ストアと、購読を解く関数
 */
export function createTimeFadeStore(sources: TimeFadeSources): {
  readonly store: StoreApi<GraphFade>;
  readonly stop: () => void;
} {
  const store = createStore<GraphFade>()(() => NO_FADE);
  let indexKey: { dataset: Dataset; timeline: unknown } | null = null;
  let index: TimeIndex | null = null;

  const compute = (): GraphFade => {
    const dataset = sources.data.getState().dataset;
    const { at, mode, windowYears } = sources.time.getState();
    if (dataset === null || at === null) return NO_FADE;
    const timeline = sources.timeline.getState().timeline;
    if (index === null || indexKey?.dataset !== dataset || indexKey.timeline !== timeline) {
      index = buildTimeIndex(
        dataset,
        resolveSource(dataset, timeline, 'node'),
        resolveSource(dataset, timeline, 'edge'),
      );
      indexKey = { dataset, timeline };
    }
    const window = timeWindowOf(
      { at, mode, windowYears },
      binCalendarOf(sources.display.getState().calendar),
    );
    const out = outOfTime(index, window);
    const { graph } = getNetwork(
      dataset,
      selectFilterState(sources.filter.getState()),
      selectGraphOptions(sources.graphView.getState()),
    );
    const nodes = new Set<string>();
    for (const id of graph.nodes()) if (out.nodes.has(id)) nodes.add(id);
    const refs: { key: string; source: string; target: string; edgeIds: readonly string[] }[] = [];
    graph.forEachEdge((key, attrs, source, target) => {
      refs.push({ key, source, target, edgeIds: attrs.edgeIds });
    });
    const edges = fadedGraphEdges(index, out, refs);
    return nodes.size === 0 && edges.size === 0 ? NO_FADE : { nodes, edges };
  };

  const update = (): void => {
    const next = compute();
    const prev = store.getState();
    // 【なぜ】同じ内容なら、前の参照のまま通知しない。購読する画面の再描画を、集合が入れ替わるコマだけにする。
    if (!sameSet(prev.nodes, next.nodes) || !sameSet(prev.edges, next.edges))
      store.setState(next, true);
  };

  const unsubs = [
    sources.data.subscribe(update),
    sources.filter.subscribe((s, prev) => {
      if (selectFilterState(s) !== selectFilterState(prev)) update();
    }),
    // 【なぜ】グラフの設定は、パンやズームでも変わる。構築の設定が変わったときだけ求め直す。
    sources.graphView.subscribe((s, prev) => {
      if (selectGraphOptions(s) !== selectGraphOptions(prev)) update();
    }),
    sources.timeline.subscribe(update),
    sources.display.subscribe(update),
    sources.time.subscribe((s, prev) => {
      // 再生中かどうかだけの変化では求め直さない。
      if (s.at !== prev.at || s.mode !== prev.mode || s.windowYears !== prev.windowYears) update();
    }),
  ];
  update();
  return {
    store,
    stop: () => {
      for (const u of unsubs) u();
    },
  };
}

/** アプリ全体の、薄くする要素。 */
export const timeFadeStore = createTimeFadeStore({
  data: dataStore,
  filter: filterStore,
  graphView: graphViewStore,
  timeline: timelineStore,
  display: displayStore,
  time: timeStore,
}).store;
