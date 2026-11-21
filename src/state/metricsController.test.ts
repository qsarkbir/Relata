import { describe, expect, it } from 'vitest';
import type { Dataset } from '../core/model';
import { toNodeId, toNodeTypeId, toEdgeId } from '../core/model';
import { DEFAULT_FILTER_STATE } from '../core/filter';
import type { MetricsJob, MetricsResult } from '../core/metrics';
import { createMetricsController, type MetricsScheduler } from './metricsController';

const person = toNodeTypeId('person');
const dataset: Dataset = {
  graphMode: 'directed',
  nodeTypes: [{ id: person, label: 'Person' }],
  nodes: ['a', 'b', 'isolated'].map((id) => ({
    id: toNodeId(id),
    type: person,
    label: id,
    attrs: {},
  })),
  edges: [
    {
      id: toEdgeId('e'),
      source: toNodeId('a'),
      target: toNodeId('b'),
      directed: true,
      weight: 1,
      attrs: {},
    },
  ],
  schema: [],
  meta: { title: 'test' },
};
function fixture() {
  let now = 0;
  let key = 0;
  let cancellations = 0;
  const timers = new Map<number, { deadline: number; callback: () => void }>();
  const requests: {
    job: MetricsJob;
    resolve: (value: MetricsResult) => void;
    reject: (error: Error) => void;
  }[] = [];
  const scheduler: MetricsScheduler = {
    delay: (callback, milliseconds) => {
      const id = ++key;
      timers.set(id, { deadline: now + milliseconds, callback });
      return () => {
        timers.delete(id);
      };
    },
  };
  const controller = createMetricsController(
    {
      run: (job) =>
        new Promise((resolve, reject) => {
          requests.push({ job, resolve, reject });
        }),
      cancel: () => {
        cancellations++;
      }, // 故意に Promise を解決しない偽物でも、版番号で古い結果を捨てる。
    },
    scheduler,
  );
  return {
    controller,
    requests,
    cancellations: () => cancellations,
    advance: (milliseconds: number) => {
      now += milliseconds;
      for (const [id, timer] of timers)
        if (timer.deadline <= now) {
          timers.delete(id);
          timer.callback();
        }
    },
  };
}
const result = (count: number): MetricsResult => ({
  kind: 'directed',
  nodeIds: [],
  node: {},
  global: { nodeCount: { ok: true, value: count } },
  notes: [],
});
describe('FR-MT-03: 指標 controller', () => {
  it('最後の入力変更から200 ms待ち、絞り込み後のグラフだけをWorkerへ渡す', () => {
    const f = fixture();
    f.controller.update(dataset, DEFAULT_FILTER_STATE);
    f.advance(100);
    f.controller.update(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    f.advance(199);
    expect(f.requests).toHaveLength(0);
    f.advance(1);
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]?.job.snapshot.nodes).toHaveLength(3);
    expect(f.controller.getSnapshot().phase).toBe('running');
  });
  it('入力変更で古い値を即座に隠し、古い完了や失敗を破棄する', async () => {
    const f = fixture();
    f.controller.update(dataset, DEFAULT_FILTER_STATE);
    f.advance(200);
    f.requests[0]?.resolve(result(2));
    await Promise.resolve();
    expect(f.controller.getSnapshot().phase).toBe('ready');
    f.controller.update(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    expect(f.controller.getSnapshot().result).toBeNull();
    f.advance(200);
    f.controller.update(dataset, DEFAULT_FILTER_STATE);
    f.advance(200);
    f.requests[1]?.reject(new Error('stale failure'));
    await Promise.resolve();
    expect(f.controller.getSnapshot().phase).toBe('running');
    f.requests[2]?.resolve(result(2));
    await Promise.resolve();
    expect(f.controller.getSnapshot().result).toEqual(result(2));
  });
  it('計算中の古い結果は新しい結果を上書きしない', async () => {
    const f = fixture();
    f.controller.update(dataset, DEFAULT_FILTER_STATE);
    f.advance(200);
    f.controller.update(dataset, { ...DEFAULT_FILTER_STATE, showIsolated: true });
    f.advance(200);
    f.requests[1]?.resolve(result(3));
    await Promise.resolve();
    f.requests[0]?.resolve(result(2));
    await Promise.resolve();
    expect(f.controller.getSnapshot().result).toEqual(result(3));
  });
  it('待ち時間中でも計算中でも取り消せ、明示的な再試行で再開する', async () => {
    const f = fixture();
    f.controller.update(dataset, DEFAULT_FILTER_STATE);
    f.controller.cancel();
    f.advance(1000);
    expect(f.requests).toHaveLength(0);
    expect(f.controller.getSnapshot().phase).toBe('cancelled');
    f.controller.retry();
    f.advance(200);
    f.controller.cancel();
    f.requests[0]?.resolve(result(2));
    await Promise.resolve();
    expect(f.controller.getSnapshot().phase).toBe('cancelled');
    expect(f.controller.getSnapshot().result).toBeNull();
    expect(f.cancellations()).toBeGreaterThan(2);
  });
  it('Worker失敗を表示可能な状態にし、データを閉じると空に戻す', async () => {
    const f = fixture();
    f.controller.update(dataset, DEFAULT_FILTER_STATE);
    f.advance(200);
    f.requests[0]?.reject(new Error('Worker failed'));
    await Promise.resolve();
    expect(f.controller.getSnapshot()).toMatchObject({
      phase: 'error',
      error: 'Worker failed',
      result: null,
    });
    f.controller.update(null, DEFAULT_FILTER_STATE);
    f.controller.retry();
    expect(f.controller.getSnapshot()).toMatchObject({ phase: 'empty', result: null, input: null });
  });
  it('購読者へ最新状態だけ通知し、解除後は通知しない', () => {
    const f = fixture();
    let notifications = 0;
    const unsubscribe = f.controller.subscribe(() => {
      notifications++;
    });
    f.controller.update(dataset, DEFAULT_FILTER_STATE);
    expect(notifications).toBe(1);
    unsubscribe();
    f.advance(200);
    expect(notifications).toBe(1);
  });
});
