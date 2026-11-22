/** Worker の寿命と中止を管理する（FR-VG-01、D-17）。 */
import { wrap } from 'comlink';
import type { LayoutJob, LayoutResult } from '../core/layout';
import type { LayoutWorkerApi } from './layout.worker';

/** 起動した Worker。テストでは偽物に差し替えられる。 */
export interface LayoutWorkerHandle {
  readonly api: {
    start(job: LayoutJob): Promise<LayoutResult>;
    step(iterations: number): Promise<LayoutResult>;
  };
  terminate(): void;
  onFailure(listener: (error: Error) => void): void;
}
/** 計算を始め、step ごとに途中結果を受け取る窓口。 */
export interface LayoutClient {
  run(job: LayoutJob): Promise<LayoutResult>;
  step(iterations: number): Promise<LayoutResult>;
  cancel(): void;
}
function spawnLayoutWorker(): LayoutWorkerHandle {
  const worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
  const api = wrap<LayoutWorkerApi>(worker);
  return {
    api: { start: (job) => api.start(job), step: (iterations) => api.step(iterations) },
    terminate: () => {
      worker.terminate();
    },
    onFailure: (listener) => {
      worker.addEventListener('error', (event) => {
        listener(new Error('レイアウトの Worker でエラー: ' + event.message));
      });
      worker.addEventListener('messageerror', () => {
        listener(new Error('レイアウトの Worker のメッセージを読み取れません。'));
      });
    },
  };
}
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * レイアウト Worker の client を作る。
 *
 * 【なぜ】同期の算法の途中ではメッセージを処理できない。cancel は Worker を terminate し、
 * 保留中の Promise をすべて reject する。古い結果と古い失敗は新しい Worker に渡さない。
 * run は前の計算を破棄し、新しいセッションを始める。step は run 成功後に呼ぶ。
 * @param spawn - Worker の起動関数
 * @returns run、step、cancel
 */
export function createLayoutClient(
  spawn: () => LayoutWorkerHandle = spawnLayoutWorker,
): LayoutClient {
  let handle: LayoutWorkerHandle | null = null;
  let started = false;
  const pending = new Set<(error: Error) => void>();
  const discard = (error: Error): void => {
    const dead = handle;
    handle = null;
    started = false;
    const rejects = [...pending];
    pending.clear();
    for (const reject of rejects) reject(error);
    try {
      dead?.terminate();
    } catch {
      /* 壊れた Worker の終了失敗で reject を妨げない。 */
    }
  };
  const request = (
    current: LayoutWorkerHandle,
    operation: () => Promise<LayoutResult>,
  ): Promise<LayoutResult> =>
    new Promise((resolve, reject) => {
      pending.add(reject);
      // API の同期例外も Promise の reject として扱い、pending の掃除を必ず行う。
      Promise.resolve()
        .then(operation)
        .then(
          (result) => {
            if (pending.delete(reject) && handle === current) resolve(result);
          },
          (error: unknown) => {
            if (pending.delete(reject)) reject(toError(error));
          },
        );
    });
  return {
    async run(job) {
      discard(new DOMException('新しいレイアウトを開始しました。', 'AbortError'));
      let current: LayoutWorkerHandle;
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
        const result = await request(current, () => current.api.start(job));
        if (handle === current) started = true;
        return result;
      } catch (error) {
        if (handle === current) discard(toError(error));
        throw toError(error);
      }
    },
    step(iterations) {
      const current = handle;
      if (current === null || !started)
        return Promise.reject(new Error('レイアウトを開始してください。'));
      return request(current, () => current.api.step(iterations));
    },
    cancel() {
      discard(new DOMException('レイアウトの計算を中止しました。', 'AbortError'));
    },
  };
}
/** アプリ全体の窓口。 */
export const layoutClient: LayoutClient = createLayoutClient();
