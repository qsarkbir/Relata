/** Edge bundling の Worker の寿命と中止を管理する（FR-VG-13、D-55、D-17）。 */
// 【TS】`import type` は型だけを読み込み、実行時には消える。worker のファイルを client に実行時に混ぜない。
import { wrap } from 'comlink';
import type {
  BundleEdge,
  BundleGraph,
  BundledPath,
  BundlingInfo,
  BundlingProgress,
  BundlingResult,
} from '../render/bundling';
import type { BundlingJob, BundlingStepResult, BundlingWorkerApi } from './bundling.worker';

// 【なぜ】state は render を import できない（設計書 §4.1）。型は client を通して渡す。
export type { BundleEdge, BundleGraph, BundledPath, BundlingJob };
/** `run` の結果。`job.buildGraph` が true のときだけ `graph` を持つ。 */
export interface BundlingRunResult extends BundlingResult {
  readonly graph?: BundleGraph;
}

/** 起動した Worker。テストでは偽物に差し替えられる。 */
export interface BundlingWorkerHandle {
  readonly api: {
    start(job: BundlingJob): Promise<BundlingInfo>;
    step(): Promise<BundlingStepResult>;
  };
  terminate(): void;
  onFailure(listener: (error: Error) => void): void;
}
/** 束ねる計算の窓口。 */
export interface BundlingClient {
  /**
   * 計算を最後まで行う。前の計算は AbortError で中止する。段階が終わるたびに onProgress を呼ぶ
   * （関数は Worker へ渡さず、メインスレッドの中だけで呼ぶ）。
   */
  run(
    job: BundlingJob,
    onProgress?: (progress: BundlingProgress) => void,
  ): Promise<BundlingRunResult>;
  /** 中止する。保留中の Promise を AbortError で reject し、Worker を terminate する。 */
  cancel(): void;
}
function spawnBundlingWorker(): BundlingWorkerHandle {
  const worker = new Worker(new URL('./bundling.worker.ts', import.meta.url), { type: 'module' });
  const api = wrap<BundlingWorkerApi>(worker);
  return {
    api: { start: (job) => api.start(job), step: () => api.step() },
    terminate: () => {
      worker.terminate();
    },
    onFailure: (listener) => {
      worker.addEventListener('error', (event) => {
        listener(new Error('束ねる計算の Worker でエラー: ' + event.message));
      });
      worker.addEventListener('messageerror', () => {
        listener(new Error('束ねる計算の Worker のメッセージを読み取れません。'));
      });
    },
  };
}
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * 束ねる計算の client を作る。
 *
 * 【なぜ】同期の算法の途中ではメッセージを処理できないので、段階ごとに step を呼ぶ形にして、
 * 進み具合を受け取れるようにする。cancel は Worker を terminate して作り直す（layout.client と同じ）。
 * 保留中の Promise はすべて AbortError で reject し、古い結果と古い失敗は新しい Worker に渡さない。
 * @param spawn - Worker の起動関数
 * @returns run と cancel
 */
export function createBundlingClient(
  spawn: () => BundlingWorkerHandle = spawnBundlingWorker,
): BundlingClient {
  let handle: BundlingWorkerHandle | null = null;
  const pending = new Set<(error: Error) => void>();
  const discard = (error: Error): void => {
    const dead = handle;
    handle = null;
    const rejects = [...pending];
    pending.clear();
    for (const reject of rejects) reject(error);
    try {
      dead?.terminate();
    } catch {
      /* 壊れた Worker の終了失敗で reject を妨げない。 */
    }
  };
  // 【TS】`<T>` はジェネリクス（型引数）。start でも step でも、operation の結果の型 T をそのまま返す。
  const request = <T>(current: BundlingWorkerHandle, operation: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      pending.add(reject);
      // API の同期例外も Promise の reject として扱い、pending の掃除を必ず行う。
      Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            if (pending.delete(reject) && handle === current) resolve(value);
          },
          (error: unknown) => {
            if (pending.delete(reject)) reject(toError(error));
          },
        );
    });
  const abort = (): Error => new DOMException('束ねる計算を中止しました。', 'AbortError');
  return {
    async run(job, onProgress) {
      discard(new DOMException('新しい束ねる計算を開始しました。', 'AbortError'));
      let current: BundlingWorkerHandle;
      try {
        current = spawn();
        handle = current;
        current.onFailure((error) => {
          if (handle === current) discard(error);
        });
      } catch (error) {
        discard(toError(error));
        throw toError(error);
      }
      try {
        await request(current, () => current.api.start(job));
        for (;;) {
          // 段階の合間に cancel されたときも、次の呼び出しを待たずに止める。
          if (handle !== current) throw abort();
          const progress = await request(current, () => current.api.step());
          onProgress?.({ cycle: progress.cycle, cycles: progress.cycles, done: progress.done });
          if (progress.done) {
            if (progress.result === null) throw new Error('束ねた結果が返りませんでした。');
            // onProgress の中で cancel されたときも、最後の段階を成功として返さない。
            if (handle !== current) throw abort();
            // 終わった Worker はすぐ捨てる（次の run が新しい Worker を作る）。
            discard(abort());
            return progress.graph === undefined
              ? progress.result
              : { ...progress.result, graph: progress.graph };
          }
        }
      } catch (error) {
        if (handle === current) discard(toError(error));
        throw toError(error);
      }
    },
    cancel() {
      discard(abort());
    },
  };
}
/** アプリ全体の窓口。 */
export const bundlingClient: BundlingClient = createBundlingClient();
// 【なぜ】5,000 本の警告の境目は算法側の定数と同じものを使う（state は render を直接 import できない）。
export { BUNDLING_EDGE_WARNING_LIMIT, exceedsBundlingLimit } from '../render/bundling/settings';
