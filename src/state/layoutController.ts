/** レイアウト計算の版番号・反復・古い結果の破棄（FR-VG-01、D-17）。 */
import type { LayoutJob, LayoutPosition } from '../core/layout';
import { layoutClient, type LayoutClient } from '../workers/layout.client';

/** 1 回の計算の依頼。 */
export interface LayoutRequest {
  readonly job: LayoutJob;
  /** ForceAtlas2 のとき、`run` の後に 10 反復ずつ進める回数。0 なら `run` だけ。 */
  readonly rounds: number;
  /** 進み具合（0〜1）を受け取る。 */
  readonly onProgress?: (fraction: number) => void;
  /**
   * 最新の依頼の結果だけを受け取る。
   *
   * 【なぜ】結果を Promise で返すと、受け取ってから反映するまでの間に中止が入りうる。
   * 版の確認と反映を同じ同期の処理の中で行うため、反映は関数で受け取る。
   */
  readonly apply: (positions: readonly LayoutPosition[]) => void;
}
/** 計算の終わり方。`stale` は、後から来た依頼か中止によって結果を捨てたことを表す。 */
export type LayoutOutcome = 'applied' | 'stale' | 'error';
/** レイアウト計算の寿命を管理する口。 */
export interface LayoutController {
  /** 前の計算を捨てて、新しい計算を始める。 */
  run(request: LayoutRequest): Promise<LayoutOutcome>;
  /** 計算を中止し、待っている結果も失敗もすべて捨てる（ドラッグや固定の切り替えのとき）。 */
  cancel(): void;
}

/**
 * レイアウトの非同期計算を管理する。
 *
 * 【なぜ】views が Worker の client と版番号を直接持たないため（設計書 §4.1、D-17）。
 * Worker が中止を無視して応答しても、版番号が進んでいれば結果を捨てる。
 * @param client - 本物またはテスト用の Worker client
 * @returns 計算の開始と中止
 */
export function createLayoutController(client: LayoutClient): LayoutController {
  let revision = 0;
  const cancel = (): void => {
    revision++;
    client.cancel();
  };
  return {
    async run(request) {
      cancel();
      const token = revision;
      const isStale = () => token !== revision;
      try {
        let result = await client.run(request.job);
        for (let n = 0; n < request.rounds; n++) {
          if (isStale()) return 'stale';
          result = await client.step(10);
          request.onProgress?.((n + 1) / request.rounds);
        }
        if (isStale()) return 'stale';
        request.apply(result.positions);
        return 'applied';
      } catch (failure: unknown) {
        // 【なぜ】中止による AbortError は失敗として見せない。版が進んでいれば、どの失敗も古い。
        if (isStale() || (failure instanceof DOMException && failure.name === 'AbortError'))
          return 'stale';
        return 'error';
      }
    },
    cancel,
  };
}
/** アプリ全体で共有するレイアウトの窓口。 */
export const layoutController: LayoutController = createLayoutController(layoutClient);
