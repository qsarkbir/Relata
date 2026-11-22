import { useSyncExternalStore } from 'react';
import { useStore } from 'zustand';
import type { Dataset } from '../../core/model';
import type { FilterState } from '../../core/filter';
import type { GraphOptions } from '../../core/graph';
import type { MetricsResult } from '../../core/metrics';
import {
  graphViewStore,
  metricsController,
  selectFilterState,
  selectGraphOptions,
  type MetricsView,
} from '../../state';
import { useData, useFilter } from '../hooks';

/** 今のデータと絞り込みに対応する指標の状態。 */
export interface CurrentMetrics {
  readonly dataset: Dataset | null;
  readonly filter: FilterState;
  readonly graphOptions: GraphOptions;
  /** 計算の段階。controller が古い入力の結果を持っていれば 'waiting' とみなす。 */
  readonly phase: MetricsView['phase'];
  /** 今の入力に対して計算が終わった結果。それ以外は null。 */
  readonly result: MetricsResult | null;
  /** 失敗したときの説明。 */
  readonly error: string | null;
}

/**
 * 指標の controller を購読し、今のデータ・絞り込み・グラフの設定に対応する結果だけを返す。
 *
 * 【なぜ】指標パネルと CSV のダイアログが同じ判定を使う。前のデータやフィルタで計算した
 * 古い数値を、表示にも書き出しにも使わないため（D-17）。計算の開始は指標パネルが行う。
 * @returns データ、フィルタ、段階、結果
 */
export function useCurrentMetrics(): CurrentMetrics {
  const dataset = useData((s) => s.dataset);
  const filter = useFilter(selectFilterState);
  const graphOptions = useStore(graphViewStore, selectGraphOptions);
  const view = useSyncExternalStore(metricsController.subscribe, metricsController.getSnapshot);
  // 【なぜ】effect が次の入力を渡す前の描画でも、前のデータ・フィルタの数値を見せない。
  const current =
    view.input?.dataset === dataset &&
    view.input.filter === filter &&
    view.input.graphOptions === graphOptions;
  const phase = dataset === null ? 'empty' : current ? view.phase : 'waiting';
  return {
    dataset,
    filter,
    graphOptions,
    phase,
    result: current && phase === 'ready' ? view.result : null,
    error: current ? view.error : null,
  };
}
