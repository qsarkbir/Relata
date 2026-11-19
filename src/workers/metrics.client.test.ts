/**
 * metrics.client の振る舞いのテスト（FR-MT-03）。
 *
 * Worker は起動せず、偽の Worker に差し替える（設計書 §7.3。本物の Worker は E2E で確かめる）。
 */
import { describe, expect, it } from 'vitest';
import type { MetricsJob, MetricsResult } from '../core/metrics';
import { createMetricsClient, type MetricsWorkerHandle } from './metrics.client';

const job: MetricsJob = {
  snapshot: {
    options: { type: 'undirected', multi: false, allowSelfLoops: true },
    attributes: {},
    nodes: [],
    edges: [],
  },
  request: {},
};
const result: MetricsResult = { kind: 'undirected', nodeIds: [], node: {}, global: {}, notes: [] };

/**
 * 偽の Worker。resolveAll で保留中の計算を終わらせる。terminate された回数を数える。
 *
 * @returns 偽の Worker の起動関数と、状態を読む関数
 */
function fakeWorkers(): {
  spawn: () => MetricsWorkerHandle;
  spawned: () => number;
  terminated: () => number;
  resolveAll: () => void;
  /** Worker の error / messageerror を起こす。 */
  fail: (error: Error) => void;
} {
  let spawned = 0;
  let terminated = 0;
  const resolvers: ((r: MetricsResult) => void)[] = [];
  const failureListeners: ((error: Error) => void)[] = [];
  return {
    spawn: () => {
      spawned++;
      return {
        api: {
          compute: () =>
            new Promise<MetricsResult>((resolve) => {
              resolvers.push(resolve);
            }),
        },
        terminate: () => {
          terminated++;
        },
        onFailure: (listener) => {
          failureListeners.push(listener);
        },
      };
    },
    spawned: () => spawned,
    terminated: () => terminated,
    fail: (error) => {
      failureListeners.forEach((l) => {
        l(error);
      });
    },
    resolveAll: () => {
      resolvers.forEach((r) => {
        r(result);
      });
    },
  };
}

describe('FR-MT-03: metrics.client', () => {
  it('FR-MT-03: run は Worker の結果を返す', async () => {
    const w = fakeWorkers();
    const client = createMetricsClient(w.spawn);
    const p = client.run(job);
    w.resolveAll();
    await expect(p).resolves.toEqual(result);
  });

  it('FR-MT-03: Worker は最初の run で 1 回だけ起動し、使い回す', async () => {
    const w = fakeWorkers();
    const client = createMetricsClient(w.spawn);
    expect(w.spawned()).toBe(0);
    const p1 = client.run(job);
    const p2 = client.run(job);
    w.resolveAll();
    await Promise.all([p1, p2]);
    expect(w.spawned()).toBe(1);
  });

  it('FR-MT-03: cancel は保留中の Promise を AbortError で reject し、Worker を terminate する', async () => {
    const w = fakeWorkers();
    const client = createMetricsClient(w.spawn);
    const p = client.run(job);
    client.cancel();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(w.terminated()).toBe(1);
  });

  it('FR-MT-03: cancel の後の run は、Worker を作り直す', async () => {
    const w = fakeWorkers();
    const client = createMetricsClient(w.spawn);
    const stale = client.run(job);
    client.cancel();
    await stale.catch(() => undefined);
    const fresh = client.run(job);
    expect(w.spawned()).toBe(2);
    w.resolveAll();
    await expect(fresh).resolves.toEqual(result);
  });

  it('FR-MT-03: cancel した計算の結果が後から届いても、resolve しない', async () => {
    const w = fakeWorkers();
    const client = createMetricsClient(w.spawn);
    const p = client.run(job);
    client.cancel();
    w.resolveAll();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('FR-MT-03: 保留中がなければ cancel しても落ちない。Worker がなければ terminate もしない', () => {
    const w = fakeWorkers();
    const client = createMetricsClient(w.spawn);
    client.cancel();
    expect(w.terminated()).toBe(0);
  });

  it('FR-MT-03: Worker の例外は reject として返る', async () => {
    const client = createMetricsClient(() => ({
      api: { compute: () => Promise.reject(new Error('boom')) },
      terminate: () => undefined,
      onFailure: () => undefined,
    }));
    await expect(client.run(job)).rejects.toThrow('boom');
  });

  it('FR-MT-03: Worker の error（messageerror を含む）で、保留中をすべて reject し、次の run は作り直す', async () => {
    const w = fakeWorkers();
    const client = createMetricsClient(w.spawn);
    const p1 = client.run(job);
    const p2 = client.run(job);
    w.fail(new Error('worker error'));
    await expect(p1).rejects.toThrow('worker error');
    await expect(p2).rejects.toThrow('worker error');
    expect(w.terminated()).toBe(1);
    const fresh = client.run(job);
    expect(w.spawned()).toBe(2);
    w.resolveAll();
    await expect(fresh).resolves.toEqual(result);
  });

  it('FR-MT-03: spawn が同期の例外を投げても、reject になる（その後の run でまた試す）', async () => {
    let attempts = 0;
    const w = fakeWorkers();
    const client = createMetricsClient(() => {
      attempts++;
      if (attempts === 1) throw new Error('cannot spawn');
      return w.spawn();
    });
    await expect(client.run(job)).rejects.toThrow('cannot spawn');
    const p = client.run(job);
    w.resolveAll();
    await expect(p).resolves.toEqual(result);
  });
});
