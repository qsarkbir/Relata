import { describe, expect, it } from 'vitest';
import type { LayoutJob, LayoutResult } from '../core/layout';
import { toNodeId } from '../core/model';
import type { LayoutClient } from '../workers/layout.client';
import { createLayoutController } from './layoutController';

const job: LayoutJob = {
  snapshot: {
    options: { type: 'directed', multi: true, allowSelfLoops: true },
    nodes: [],
    edges: [],
    attributes: {},
  },
  options: { kind: 'forceatlas2', seed: 1 },
};
function result(x: number): LayoutResult {
  return {
    kind: 'forceatlas2',
    seed: 1,
    iterations: 0,
    positions: [{ id: toNodeId('a'), x, y: 0, fixed: false }],
  };
}
/**
 * 応答を手で返す偽の client を作る。
 *
 * @returns client、待っている応答の列、cancel の回数
 */
function fakeClient() {
  const waiting: { resolve: (r: LayoutResult) => void; reject: (e: Error) => void }[] = [];
  let cancels = 0;
  const wait = () =>
    new Promise<LayoutResult>((resolve, reject) => {
      waiting.push({ resolve, reject });
    });
  const client: LayoutClient = {
    run: wait,
    step: wait,
    cancel: () => {
      cancels++;
    },
  };
  return { client, waiting, cancels: () => cancels };
}
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('FR-VG-01: レイアウト controller（D-17）', () => {
  it('FR-VG-01: 最新の依頼の結果だけを反映し、進み具合を知らせる', async () => {
    const { client, waiting } = fakeClient();
    const controller = createLayoutController(client);
    const applied: number[] = [];
    const progress: number[] = [];
    const outcome = controller.run({
      job,
      rounds: 2,
      onProgress: (f) => progress.push(f),
      apply: (p) => applied.push(p[0]?.x ?? -1),
    });
    waiting.shift()?.resolve(result(1));
    await flush();
    waiting.shift()?.resolve(result(2));
    await flush();
    waiting.shift()?.resolve(result(3));
    expect(await outcome).toBe('applied');
    expect(applied).toEqual([3]);
    expect(progress).toEqual([0.5, 1]);
  });

  it('FR-VG-01: 中止の後に届いた古い結果は反映しない', async () => {
    const { client, waiting, cancels } = fakeClient();
    const controller = createLayoutController(client);
    const applied: number[] = [];
    const outcome = controller.run({ job, rounds: 0, apply: (p) => applied.push(p.length) });
    controller.cancel();
    // 【なぜ】Worker が中止を無視して応答しても、版番号で捨てられることを確かめる。
    waiting.shift()?.resolve(result(1));
    expect(await outcome).toBe('stale');
    expect(applied).toEqual([]);
    expect(cancels()).toBe(2);
  });

  it('FR-VG-01: 新しい依頼が来たら、前の依頼の結果も失敗も捨てる', async () => {
    const { client, waiting } = fakeClient();
    const controller = createLayoutController(client);
    const applied: string[] = [];
    const first = controller.run({ job, rounds: 0, apply: () => applied.push('first') });
    const second = controller.run({ job, rounds: 0, apply: () => applied.push('second') });
    waiting.shift()?.reject(new Error('古い失敗'));
    waiting.shift()?.resolve(result(1));
    expect(await first).toBe('stale');
    expect(await second).toBe('applied');
    expect(applied).toEqual(['second']);
  });

  it('FR-VG-01: 最新の依頼の失敗は error、中止の AbortError は stale', async () => {
    const { client, waiting } = fakeClient();
    const controller = createLayoutController(client);
    const failed = controller.run({ job, rounds: 0, apply: () => undefined });
    waiting.shift()?.reject(new Error('Worker の失敗'));
    expect(await failed).toBe('error');
    const aborted = controller.run({ job, rounds: 0, apply: () => undefined });
    waiting.shift()?.reject(new DOMException('中止', 'AbortError'));
    expect(await aborted).toBe('stale');
  });
});
