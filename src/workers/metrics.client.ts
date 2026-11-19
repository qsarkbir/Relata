/**
 * 指標の Worker を起動して呼ぶ client（FR-MT-03、設計書 §7.3、D-17）。
 *
 * 公開する API は `run(job)` と `cancel()`。版番号の管理と、古い結果の破棄は state 側の仕事で、
 * ここには含めない。
 *
 * 【なぜ】`cancel()` は、保留中の Promise を `AbortError` で reject してから Worker を terminate し、
 * 次の `run` のために作り直す。Worker は同期の計算を途中で止められず、terminate すると Comlink の
 * Promise は決して終わらない（永遠に保留になる）ため、先に自分で reject する必要がある。
 */
import { wrap } from 'comlink';
import type { MetricsJob, MetricsResult } from '../core/metrics';
import type { MetricsWorkerApi } from './metrics.worker';

/** 起動した Worker と、それを呼ぶ口。テストでは偽物に差し替える。 */
export interface MetricsWorkerHandle {
  readonly api: { compute(job: MetricsJob): Promise<MetricsResult> };
  /** Worker を止める。 */
  terminate(): void;
  /**
   * Worker の失敗（`error`、`messageerror` のイベント）を受ける関数を登録する。
   *
   * 【なぜ】Worker の読み込みの失敗や、メッセージを復元できない失敗は、Comlink の Promise に届かない
   * （永遠に保留になる）。client が自分で受けて、保留中の依頼を reject する。
   */
  onFailure(listener: (error: Error) => void): void;
}

/** client の公開 API。 */
export interface MetricsClient {
  /**
   * 計算を頼む。Worker がなければ起動する。
   *
   * 新しい依頼で前の計算を止めるのは、呼ぶ側（state）の仕事。先に `cancel()` を呼ぶこと。
   *
   * @param job - グラフのスナップショットと要求
   * @returns 計算結果。`cancel()` されたら、`name` が 'AbortError' の例外で reject する
   */
  run(job: MetricsJob): Promise<MetricsResult>;
  /** 保留中の計算を AbortError で reject し、Worker を止め、次の `run` で作り直す。 */
  cancel(): void;
}

/**
 * 本物の Worker を起動する。
 *
 * @returns Worker と、Comlink で包んだ呼び出し口
 */
function spawnMetricsWorker(): MetricsWorkerHandle {
  // 【なぜ】`new URL(..., import.meta.url)` の形で書くと、Vite が Worker のファイルを別にビルドする。
  const worker = new Worker(new URL('./metrics.worker.ts', import.meta.url), { type: 'module' });
  const api = wrap<MetricsWorkerApi>(worker);
  return {
    api: { compute: (job) => api.compute(job) },
    terminate: () => {
      worker.terminate();
    },
    onFailure: (listener) => {
      worker.addEventListener('error', (event) => {
        listener(new Error(`指標の Worker でエラーが起きました: ${event.message}`));
      });
      worker.addEventListener('messageerror', () => {
        listener(new Error('指標の Worker とのメッセージを読み取れませんでした'));
      });
    },
  };
}

/**
 * client を作る。
 *
 * @param spawn - Worker を起動する関数。既定は本物の Worker。テストでは偽物を渡す
 * @returns client
 *
 * @example
 * ```ts
 * const client = createMetricsClient();
 * const result = await client.run({ snapshot: toSnapshot(graph), request: {} });
 * ```
 */
export function createMetricsClient(
  spawn: () => MetricsWorkerHandle = spawnMetricsWorker,
): MetricsClient {
  let handle: MetricsWorkerHandle | null = null;
  // 保留中の依頼の reject 関数。cancel や Worker の失敗で、まとめて reject する。
  const pending = new Set<(reason: Error) => void>();

  /**
   * 保留中の依頼をすべて reject し、Worker を捨てる（次の run で作り直す）。
   *
   * @param reason - reject の理由
   */
  const rejectAllAndDiscard = (reason: Error): void => {
    const rejects = [...pending];
    pending.clear();
    const dead = handle;
    handle = null;
    for (const reject of rejects) reject(reason);
    try {
      dead?.terminate();
    } catch {
      // 【なぜ】すでに壊れた Worker の terminate の失敗は、利用者に知らせても対処できないので無視する。
    }
  };

  return {
    run(job) {
      let current: MetricsWorkerHandle;
      try {
        if (handle === null) {
          const spawned = spawn();
          spawned.onFailure((error) => {
            // 古い（すでに捨てた）Worker の失敗は、新しい Worker に影響させない。
            if (handle === spawned) rejectAllAndDiscard(error);
          });
          handle = spawned;
        }
        current = handle;
      } catch (error) {
        // 【なぜ】spawn の同期の例外（Worker を作れない環境など）も、Promise の reject にそろえる。
        return Promise.reject(toError(error));
      }
      return new Promise<MetricsResult>((resolve, reject) => {
        pending.add(reject);
        current.api.compute(job).then(
          (value) => {
            // cancel や失敗の後なら、すでに reject されている。二重に決着させない。
            if (pending.delete(reject)) resolve(value);
          },
          (error: unknown) => {
            if (pending.delete(reject)) reject(toError(error));
          },
        );
      });
    },
    cancel() {
      rejectAllAndDiscard(new DOMException('指標の計算を中止しました', 'AbortError'));
    },
  };
}

/**
 * 例外を Error にそろえる。
 *
 * @param error - 捕まえた値（unknown）
 * @returns Error
 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/** アプリ全体で使う client。 */
export const metricsClient: MetricsClient = createMetricsClient();
