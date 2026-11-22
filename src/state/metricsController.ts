/** 指標の版番号・200 ms の待ち・古い結果の破棄（FR-MT-03、D-17、D-30）。 */
import { buildGraph, toSnapshot, DEFAULT_GRAPH_OPTIONS, type GraphOptions } from '../core/graph';
import type { Dataset } from '../core/model';
import type { FilterState } from '../core/filter';
import type { MetricsResult } from '../core/metrics';
import { metricsClient, type MetricsClient } from '../workers/metrics.client';
import { getFilterResult } from './filterView';

/** 計算の入力。参照が替わった時点で古い結果を表示しないため、結果と組にする。 */
export interface MetricsInput {
  readonly dataset: Dataset;
  readonly filter: FilterState;
  readonly graphOptions: GraphOptions;
}
/** 保存しない一時キャッシュの状態。 */
export interface MetricsView {
  readonly phase: 'empty' | 'waiting' | 'running' | 'ready' | 'cancelled' | 'error';
  readonly input: MetricsInput | null;
  readonly result: MetricsResult | null;
  readonly error: string | null;
}
/** 時計は引数で受け取る。テストで偽の時計に差し替えるため。 */
export interface MetricsScheduler {
  delay(callback: () => void, milliseconds: number): () => void;
}
/** 指標計算の寿命と購読を管理する口。 */
export interface MetricsController {
  readonly getSnapshot: () => MetricsView;
  readonly subscribe: (listener: () => void) => () => void;
  update(dataset: Dataset | null, filter: FilterState, graphOptions?: GraphOptions): void;
  cancel(): void;
  retry(): void;
}

/**
 * 指標の非同期計算を管理する。
 *
 * 【なぜ】結果は Dataset と FilterState から導出できるので、保存するストアに入れない。
 * Worker が中止を無視して完了しても、版番号で古い結果を捨てる。待ちは呼び出し回数でなく最後の入力から測る。
 * @param client - 本物またはテスト用 Worker client
 * @param scheduler - 遅延とその中止を提供する時計
 * @returns 入力の更新、中止、再試行と、一時結果の購読口
 */
export function createMetricsController(
  client: MetricsClient,
  scheduler: MetricsScheduler,
): MetricsController {
  let revision = 0;
  let cancelTimer: (() => void) | null = null;
  let view: MetricsView = { phase: 'empty', input: null, result: null, error: null };
  const listeners = new Set<() => void>();
  const publish = (next: MetricsView): void => {
    view = next;
    for (const listener of listeners) listener();
  };
  const stop = (): void => {
    revision++;
    cancelTimer?.();
    cancelTimer = null;
    client.cancel();
  };
  const update: MetricsController['update'] = (
    dataset,
    filter,
    graphOptions = DEFAULT_GRAPH_OPTIONS,
  ) => {
    stop();
    if (dataset === null) {
      publish({ phase: 'empty', input: null, result: null, error: null });
      return;
    }
    const input: MetricsInput = { dataset, filter, graphOptions };
    const version = revision;
    publish({ phase: 'waiting', input, result: null, error: null });
    cancelTimer = scheduler.delay(() => {
      if (version !== revision) return;
      cancelTimer = null;
      publish({ phase: 'running', input, result: null, error: null });
      void (async () => {
        try {
          const graph = buildGraph(dataset, getFilterResult(dataset, filter), graphOptions);
          const result = await client.run({ snapshot: toSnapshot(graph), request: {} });
          if (version === revision) publish({ phase: 'ready', input, result, error: null });
        } catch (error) {
          if (version === revision)
            publish({
              phase: 'error',
              input,
              result: null,
              error: error instanceof Error ? error.message : String(error),
            });
        }
      })();
    }, 200);
  };
  return {
    getSnapshot: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    cancel: () => {
      stop();
      publish({
        phase: view.input === null ? 'empty' : 'cancelled',
        input: view.input,
        result: null,
        error: null,
      });
    },
    retry: () => {
      const input = view.input;
      if (input !== null) update(input.dataset, input.filter, input.graphOptions);
    },
  };
}
/**
 * アプリ全体で共有する指標の一時キャッシュ。
 *
 * 【なぜ】views が Worker の client を直接 import しないため、組み立てを state に置く（§4.1、D-17）。
 * `setTimeout` は Node でも使えるタイマーで、DOM の API ではない。
 */
export const metricsController: MetricsController = createMetricsController(metricsClient, {
  delay: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
});
