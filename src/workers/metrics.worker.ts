/**
 * 指標を計算する Web Worker（FR-MT-01、FR-MT-02、FR-MT-03、設計書 §7.3、D-17）。
 *
 * 役割の分担: 型と純粋な計算は `src/core/metrics/`、Comlink での公開はこのファイル、
 * Worker の起動は `metrics.client.ts`。ここは薄く保ち、計算の中身は core に置く
 * （Vitest で Worker を使わずに、core の関数を直接テストするため）。
 *
 * 【なぜ】graphology の Graph はクラスのインスタンスで structured clone できないので、
 * 受け取るのは `GraphSnapshot`（素のオブジェクト）。`computeMetrics` がその中で組み立て直す。
 * 戻り値も素のオブジェクトと配列だけ。
 */
import { expose } from 'comlink';
import { computeMetrics, type MetricsJob, type MetricsResult } from '../core/metrics';

/** Worker が Comlink で公開する関数の集まり。 */
const api = {
  /**
   * 指標を計算する。同期の計算なので、途中では止められない。中止は client が Worker を terminate して行う。
   *
   * @param job - グラフのスナップショットと要求
   * @returns 指標ごとの成功か失敗
   */
  compute(job: MetricsJob): MetricsResult {
    return computeMetrics(job.snapshot, job.request);
  },
};

// 【TS】`typeof api` は、値 api の型を取り出す。client はこれを使って、呼び出しの型を検査する。
/** Worker の公開 API の型。client が `wrap<MetricsWorkerApi>` で使う。 */
export type MetricsWorkerApi = typeof api;

expose(api);
