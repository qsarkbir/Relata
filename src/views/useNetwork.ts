import { useStore } from 'zustand';
import { getNetwork, graphViewStore, selectFilterState, selectGraphOptions } from '../state';
import type { Network } from '../state';
import { useData, useFilter } from './hooks';

/**
 * 今のデータ・フィルタ・構築の設定から、射影後のグラフを返す。
 *
 * 【なぜ】計算は state の `getNetwork` に 1 か所だけある（指標の controller も同じ関数を呼ぶ）。
 * 同じ入力なら同じ結果の参照が返るので、描画の度に作り直さない。
 * @returns グラフと射影の状態。データが無ければ null
 */
export function useNetwork(): Network | null {
  const dataset = useData((s) => s.dataset);
  const filter = useFilter(selectFilterState);
  const graphOptions = useStore(graphViewStore, selectGraphOptions);
  return dataset === null ? null : getNetwork(dataset, filter, graphOptions);
}
