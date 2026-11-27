/**
 * グラフ図の edge bundling の計算を、図の状態とつなぐ（FR-VG-13、14）。
 *
 * 計算の寿命と計算し直す時機は state の `bundlingController` が決める。ここでは「いまの望み」を伝え、
 * 状態を購読し、計算中の進行を共通の「処理の一覧」（uiStore）に載せるだけにする。
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { RelataGraph } from '../core/graph';
import type { BundlingViewSettings } from '../core/project';
import { BUNDLING_EDGE_WARNING_LIMIT } from '../render/bundling/settings';
import type { NodeId } from '../core/model';
import { bundleEdgesOf, bundlingController, uiStore } from '../state';
import type { BundlingView } from '../state';

/** {@link useBundling} の入力。 */
export interface UseBundlingInput {
  readonly graph: RelataGraph | null;
  // 【TS】`ReadonlyMap<K, V>` は読み取り専用の Map（`get` はあるが `set` はない）。
  readonly positions: ReadonlyMap<NodeId, { readonly x: number; readonly y: number }>;
  /** 配置の計算中か。 */
  readonly layoutBusy: boolean;
  readonly settings: BundlingViewSettings;
}

/**
 * 束ねる計算の状態を返し、入力の変化を controller に伝える。
 *
 * @param input - グラフ、座標、配置の計算中か、束ねる設定
 * @returns 計算の状態（段階、進行、結果、失敗の理由）
 */
export function useBundling(input: UseBundlingInput): BundlingView {
  const { graph, positions, layoutBusy, settings } = input;
  // 【TS】`useSyncExternalStore(購読, 現在の値)` は、React の外にある状態（controller）を安全に読むフック。
  //   `getSnapshot` は変化がなければ同じ参照を返す約束で、controller は状態を新しい値に置き換えるときだけ参照を変える。
  const view = useSyncExternalStore(bundlingController.subscribe, bundlingController.getSnapshot);
  useEffect(() => {
    // 【なぜ】入力の素はグラフと座標だけ。ズーム・パン・再生・描き方・強さは含めない（計算し直さない操作）。
    bundlingController.sync({
      enabled: settings.enabled && graph !== null,
      layoutBusy,
      sources: [graph, positions],
      strength: settings.strength,
      limit: BUNDLING_EDGE_WARNING_LIMIT,
      build: () => (graph === null ? [] : bundleEdgesOf(graph, positions)),
    });
  }, [graph, positions, layoutBusy, settings.enabled, settings.strength]);
  // 画面を離れる（GraphView が消える）ときは、計算を止めて結果を捨てる。
  useEffect(
    () => () => {
      bundlingController.sync({
        enabled: false,
        layoutBusy: false,
        sources: [],
        strength: 0,
        limit: BUNDLING_EDGE_WARNING_LIMIT,
        build: () => [],
      });
    },
    [],
  );
  const running = view.phase === 'running';
  useEffect(() => {
    if (!running) return;
    const task = uiStore.getState().startTask({ key: 'graph.bundleTask' }, () => {
      bundlingController.cancel();
    });
    const unsubscribe = bundlingController.subscribe(() => {
      uiStore.getState().updateTask(task, bundlingController.getSnapshot().progress);
    });
    return () => {
      unsubscribe();
      uiStore.getState().endTask(task);
    };
  }, [running]);
  return view;
}
