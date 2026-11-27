import { describe, expect, it } from 'vitest';
import type { BundlingInfo, BundlingResult } from '../render/bundling';
import { createBundlingClient, type BundlingWorkerHandle } from './bundling.client';
import type { BundlingJob, BundlingStepResult } from './bundling.worker';

const job: BundlingJob = { edges: [] };
const info: BundlingInfo = {
  cycles: 2,
  bundledCount: 0,
  unbundledCount: 0,
  compatiblePairCount: 0,
};
const result: BundlingResult = { paths: [], unbundledCount: 0 };

// 偽 Worker の記録。
interface FakeHandle {
  terminated: number;
  failure: ((error: Error) => void) | null;
  stepResolvers: ((value: BundlingStepResult) => void)[];
  stepRejecters: ((error: Error) => void)[];
  steps: number;
}
// 偽の Worker。step は手動で解決する。
function fakeWorkers(options: { startError?: Error } = {}) {
  const handles: FakeHandle[] = [];
  return {
    handles,
    spawn: (): BundlingWorkerHandle => {
      const handle: FakeHandle = {
        terminated: 0,
        failure: null,
        stepResolvers: [],
        stepRejecters: [],
        steps: 0,
      };
      handles.push(handle);
      return {
        api: {
          start: () =>
            options.startError === undefined
              ? Promise.resolve(info)
              : Promise.reject(options.startError),
          step: () => {
            handle.steps++;
            return new Promise((resolve, reject) => {
              handle.stepResolvers.push(resolve);
              handle.stepRejecters.push(reject);
            });
          },
        },
        onFailure: (listener) => {
          handle.failure = listener;
        },
        terminate: () => {
          handle.terminated++;
        },
      };
    },
    // 保留中の step を失敗させる。
    async failStep(index: number, error: Error) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      handles[index]?.stepRejecters.splice(0).forEach((reject) => {
        reject(error);
      });
    },
    // 最後の段階なのに result が null の応答を返す。
    async finishWithoutResult(index: number) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      handles[index]?.stepResolvers.splice(0).forEach((resolve) => {
        resolve({ cycle: 2, cycles: 2, done: true, result: null });
      });
    },
    // 保留中の step を、次の段階の結果で解決する。
    async finishStep(index: number, cycle: number, cycles: number) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      handles[index]?.stepResolvers.splice(0).forEach((resolve) => {
        const done = cycle >= cycles;
        resolve({ cycle, cycles, done, result: done ? result : null });
      });
    },
  };
}

describe('FR-VG-13: 束ねる Worker の client', () => {
  it('FR-VG-13: 段階ごとに進み具合を渡し、最後に結果を返して Worker を捨てる', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const progress: number[] = [];
    const run = client.run(job, (p) => progress.push(p.cycle));
    await workers.finishStep(0, 1, 2);
    await workers.finishStep(0, 2, 2);
    await expect(run).resolves.toEqual(result);
    expect(progress).toEqual([1, 2]);
    expect(workers.handles[0]?.steps).toBe(2);
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('FR-VG-13: 進み具合の関数が無くても動く', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job);
    await workers.finishStep(0, 2, 2);
    await expect(run).resolves.toEqual(result);
  });
  it('FR-VG-13: cancel は保留中の run を AbortError で reject し、Worker を terminate する', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job);
    const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await workers.finishStep(0, 0, 2).catch(() => undefined);
    client.cancel();
    await rejected;
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('FR-VG-13: 新しい run は前の計算を AbortError で中止し、新しい Worker を使う', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const first = client.run(job);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    const second = client.run(job);
    await rejected;
    expect(workers.handles).toHaveLength(2);
    expect(workers.handles[0]?.terminated).toBe(1);
    await workers.finishStep(1, 2, 2);
    await expect(second).resolves.toEqual(result);
  });
  it('FR-VG-13: Worker の異常は保留中の run を reject し、Worker を捨てる', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job);
    const rejected = expect(run).rejects.toThrow('Worker でエラー');
    await Promise.resolve();
    workers.handles[0]?.failure?.(new Error('Worker でエラー: boom'));
    await rejected;
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('FR-VG-13: 開始に失敗した（設定が不正など）ときは、その理由で reject する', async () => {
    const workers = fakeWorkers({ startError: new RangeError('束ねる設定が不正') });
    const client = createBundlingClient(workers.spawn);
    await expect(client.run(job)).rejects.toThrow('設定が不正');
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('FR-VG-13: Worker を起動できないときも reject する', async () => {
    const client = createBundlingClient(() => {
      throw new Error('起動できません');
    });
    await expect(client.run(job)).rejects.toThrow('起動できません');
  });
  it('FR-VG-13: 途中の step が失敗したら、その理由で reject し、Worker を捨てる', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job);
    const rejected = expect(run).rejects.toThrow('途中で失敗');
    await workers.finishStep(0, 1, 2);
    await workers.failStep(0, new Error('途中で失敗'));
    await rejected;
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('FR-VG-13: onProgress が例外を投げたら、run は reject し、Worker を捨てる', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job, () => {
      throw new Error('進行の表示で失敗');
    });
    const rejected = expect(run).rejects.toThrow('進行の表示');
    await workers.finishStep(0, 1, 2);
    await rejected;
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('FR-VG-13: done なのに result が null なら reject する', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job);
    const rejected = expect(run).rejects.toThrow('結果が返りません');
    await workers.finishWithoutResult(0);
    await rejected;
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('FR-VG-13: 段階の合間（onProgress の中）で cancel すると、次の step を呼ばず AbortError', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job, () => {
      client.cancel();
    });
    const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await workers.finishStep(0, 1, 2);
    await rejected;
    expect(workers.handles[0]?.steps).toBe(1);
  });
  it('FR-VG-13: 最後の段階の onProgress の中で cancel しても、AbortError で reject する', async () => {
    const workers = fakeWorkers();
    const client = createBundlingClient(workers.spawn);
    const run = client.run(job, (p) => {
      if (p.done) client.cancel();
    });
    const rejected = expect(run).rejects.toMatchObject({ name: 'AbortError' });
    await workers.finishStep(0, 2, 2);
    await rejected;
  });
});
