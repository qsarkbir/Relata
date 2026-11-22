import { describe, expect, it } from 'vitest';
import type { LayoutJob, LayoutResult } from '../core/layout';
import { createLayoutClient, type LayoutWorkerHandle } from './layout.client';

const job: LayoutJob = {
  snapshot: {
    options: { type: 'mixed', multi: false, allowSelfLoops: true },
    attributes: {},
    nodes: [],
    edges: [],
  },
  options: { kind: 'forceatlas2', seed: 42 },
};
const result: LayoutResult = { kind: 'forceatlas2', seed: 42, iterations: 0, positions: [] };

function fakeWorkers() {
  const handles: {
    terminated: number;
    failure: ((error: Error) => void) | null;
    resolve: ((value: LayoutResult) => void)[];
    steps: number[];
  }[] = [];
  return {
    handles,
    spawn: (): LayoutWorkerHandle => {
      const handle = {
        terminated: 0,
        failure: null as ((error: Error) => void) | null,
        resolve: [] as ((value: LayoutResult) => void)[],
        steps: [] as number[],
      }; // 理由: テストの偽 Worker の可変状態に型を付ける。
      handles.push(handle);
      return {
        api: {
          start: () =>
            new Promise((resolve) => {
              handle.resolve.push(resolve);
            }),
          step: (n) => {
            handle.steps.push(n);
            return new Promise((resolve) => {
              handle.resolve.push(resolve);
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
    async finish(index = 0) {
      await Promise.resolve();
      handles[index]?.resolve.splice(0).forEach((resolve) => {
        resolve(result);
      });
    },
  };
}
describe('FR-VG-01: レイアウト Worker client', () => {
  it('run で開始し、step ごとに結果を受け取る', async () => {
    const workers = fakeWorkers();
    const client = createLayoutClient(workers.spawn);
    const start = client.run(job);
    await workers.finish();
    await expect(start).resolves.toEqual(result);
    const step = client.step(10);
    await workers.finish();
    await expect(step).resolves.toEqual(result);
    expect(workers.handles[0]?.steps).toEqual([10]);
  });
  it('開始前や開始の完了前の step は拒否する', async () => {
    const workers = fakeWorkers();
    const client = createLayoutClient(workers.spawn);
    await expect(client.step(1)).rejects.toThrow('開始');
    const pending = client.run(job);
    await expect(client.step(1)).rejects.toThrow('開始');
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    client.cancel();
    await rejected;
  });
  it('cancel で保留 Promise を中止し、次の run で Worker を作り直す', async () => {
    const workers = fakeWorkers();
    const client = createLayoutClient(workers.spawn);
    const pending = client.run(job);
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    client.cancel();
    await rejected;
    expect(workers.handles[0]?.terminated).toBe(1);
    const next = client.run(job);
    await workers.finish(1);
    await expect(next).resolves.toEqual(result);
  });
  it('新しい run は古い計算を中止し、古い Worker の失敗を無視する', async () => {
    const workers = fakeWorkers();
    const client = createLayoutClient(workers.spawn);
    const old = client.run(job);
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const next = client.run(job);
    await rejected;
    workers.handles[0]?.failure?.(new Error('old'));
    await workers.finish(1);
    await expect(next).resolves.toEqual(result);
  });
  it('error/messageerror は保留計算を reject し、Worker を終了する', async () => {
    const workers = fakeWorkers();
    const client = createLayoutClient(workers.spawn);
    const pending = client.run(job);
    const rejected = expect(pending).rejects.toThrow('worker failure');
    workers.handles[0]?.failure?.(new Error('worker failure'));
    await rejected;
    expect(workers.handles[0]?.terminated).toBe(1);
  });
  it('同期の起動失敗と API の同期例外も reject する', async () => {
    await expect(
      createLayoutClient(() => {
        throw new Error('spawn');
      }).run(job),
    ).rejects.toThrow('spawn');
    const client = createLayoutClient(() => ({
      api: {
        start: () => {
          throw new Error('api');
        },
        step: () => Promise.resolve(result),
      },
      terminate: () => {
        /* 起動失敗だけを調べる偽物。 */
      },
      onFailure: () => {
        /* このテストでは非同期の失敗を起こさない。 */
      },
    }));
    await expect(client.run(job)).rejects.toThrow('api');
    client.cancel();
  });
});
