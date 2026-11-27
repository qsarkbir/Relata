import { describe, expect, it } from 'vitest';
import Graph from 'graphology';
import type { RelataGraph } from '../core/graph';
import { toNodeId, toNodeTypeId } from '../core/model';
import type {
  BundleEdge,
  BundleGraph,
  BundlingClient,
  BundlingJob,
} from '../workers/bundling.client';
import {
  bundleEdgesOf,
  createBundlingController,
  type BundlingRequest,
} from './bundlingController';

function edges(n: number): BundleEdge[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 'e' + String(i),
    x1: 0,
    y1: i,
    x2: 10,
    y2: i,
    directed: true,
    weight: 1,
  }));
}
const fakeGraph = { bundleCount: 0 } as unknown as BundleGraph; // 【なぜ】中身は見ない。controller は運ぶだけ。

/**
 * 応答を手で返す偽の client。
 *
 * @returns client、待っている呼び出しの列、cancel の回数
 */
function fakeClient() {
  const waiting: {
    job: BundlingJob;
    onProgress: ((p: { cycle: number; cycles: number; done: boolean }) => void) | undefined;
    resolve: (r: Awaited<ReturnType<BundlingClient['run']>>) => void;
    reject: (e: Error) => void;
  }[] = [];
  let cancels = 0;
  const client: BundlingClient = {
    run: (job, onProgress) =>
      new Promise((resolve, reject) => {
        waiting.push({ job, onProgress, resolve, reject });
      }),
    cancel: () => {
      cancels++;
    },
  };
  return { client, waiting, cancels: () => cancels };
}
/**
 * 手で進める時計。
 *
 * @returns scheduler と、待っている遅延を実行する関数
 */
function fakeScheduler() {
  const tasks: { callback: () => void; live: boolean }[] = [];
  return {
    scheduler: {
      delay: (callback: () => void) => {
        const task = { callback, live: true };
        tasks.push(task);
        return () => {
          task.live = false;
        };
      },
    },
    fire: () => {
      for (const t of tasks.splice(0)) if (t.live) t.callback();
    },
  };
}
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}
function request(over: Partial<BundlingRequest> & { count?: number } = {}): BundlingRequest {
  const list = edges(over.count ?? 3);
  return {
    enabled: true,
    layoutBusy: false,
    sources: ['g', 'p'],
    strength: 0.85,
    build: () => list,
    ...over,
  };
}
function setup() {
  const c = fakeClient();
  const s = fakeScheduler();
  const controller = createBundlingController(c.client, s.scheduler);
  return { ...c, ...s, controller };
}
const done = { paths: [], unbundledCount: 0, graph: fakeGraph };

describe('FR-VG-13: 束ねる controller（D-55、D-17）', () => {
  it('FR-VG-13: 有効にすると待ってから Worker で計算し、結果を ready で持つ', async () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request());
    expect(controller.getSnapshot().phase).toBe('waiting');
    expect(waiting).toHaveLength(0);
    fire();
    expect(controller.getSnapshot().phase).toBe('running');
    expect(waiting[0]?.job.buildGraph).toBe(true);
    expect(waiting[0]?.job.settings?.strength).toBe(0.85);
    waiting[0]?.onProgress?.({ cycle: 1, cycles: 4, done: false });
    expect(controller.getSnapshot().progress).toBe(0.25);
    waiting[0]?.resolve(done);
    await flush();
    const view = controller.getSnapshot();
    expect(view.phase).toBe('ready');
    expect(view.result?.graph).toBe(fakeGraph);
    expect(view.result?.strength).toBe(0.85);
  });

  it('FR-VG-13: 版番号で古い結果を捨てる（新しい依頼の後に古い応答が来ても反映しない）', async () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request());
    fire();
    controller.sync(request({ sources: ['g2', 'p'] })); // 入力が変わった
    fire();
    expect(waiting).toHaveLength(2);
    waiting[1]?.resolve({ ...done, unbundledCount: 2 });
    await flush();
    waiting[0]?.resolve({ ...done, unbundledCount: 1 }); // 古い応答が遅れて来る
    await flush();
    expect(controller.getSnapshot().phase).toBe('ready');
    expect(controller.getSnapshot().result?.paths).toEqual([]);
    waiting[0]?.reject(new Error('古い失敗'));
    await flush();
    expect(controller.getSnapshot().phase).toBe('ready');
  });

  it('FR-VG-13: 取り消すと cancelled になり、後から来る結果も失敗も捨てる。束ねない図（結果なし）に戻る', async () => {
    const { controller, waiting, fire, cancels } = setup();
    controller.sync(request());
    fire();
    const before = cancels();
    controller.cancel();
    expect(cancels()).toBeGreaterThan(before);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'cancelled', result: null });
    waiting[0]?.resolve(done);
    await flush();
    expect(controller.getSnapshot().phase).toBe('cancelled');
    // 入力が同じなら、取り消した後に自動では始め直さない
    controller.sync(request());
    expect(controller.getSnapshot().phase).toBe('cancelled');
  });

  it('FR-VG-13: 失敗は error と理由を持つ（AbortError は失敗にしない）', async () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request());
    fire();
    waiting[0]?.reject(new Error('壊れた'));
    await flush();
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'error',
      error: '壊れた',
      result: null,
    });
    controller.rebundle();
    expect(controller.getSnapshot().phase).toBe('running');
    waiting[1]?.reject(new DOMException('中止', 'AbortError'));
    await flush();
    expect(controller.getSnapshot().phase).toBe('running');
  });

  it('FR-VG-13: 5,000 本を超えると確認で止まり、「始める」で計算する（5,000 本ちょうどは確認しない）', () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request({ count: 5000 }));
    fire();
    expect(controller.getSnapshot().phase).toBe('running');
    controller.cancel();
    controller.sync(request({ count: 5001, sources: ['g2', 'p'] }));
    fire();
    expect(controller.getSnapshot()).toMatchObject({ phase: 'confirm', edgeCount: 5001 });
    expect(waiting).toHaveLength(1); // 確認の間は計算しない
    controller.confirm();
    expect(controller.getSnapshot().phase).toBe('running');
    expect(waiting).toHaveLength(2);
  });

  it('FR-VG-13: 確認で「やめる」と cancelled になり、計算しない', () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request({ count: 6000 }));
    fire();
    controller.cancel();
    expect(controller.getSnapshot().phase).toBe('cancelled');
    controller.confirm();
    expect(waiting).toHaveLength(0);
  });

  it('FR-VG-13: 入力（グラフ・座標）が変わると計算し直し、前の結果を捨てて束ねない図に戻す', async () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request());
    fire();
    waiting[0]?.resolve(done);
    await flush();
    controller.sync(request({ sources: ['g', 'p2'] })); // 配置が変わった
    expect(controller.getSnapshot()).toMatchObject({ phase: 'waiting', result: null });
    fire();
    expect(waiting).toHaveLength(2);
  });

  it('FR-VG-13: ズーム・パン・再生・描き方の切り替え・強さの変更では計算し直さない（同じ入力の sync は何もしない）', async () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request());
    fire();
    waiting[0]?.resolve(done);
    await flush();
    const ready = controller.getSnapshot();
    // 画面の再描画のたびに sync が呼ばれても、入力の素（参照）が同じなら何も起きない
    controller.sync(request());
    controller.sync(request({ strength: 0.5 }));
    fire();
    expect(controller.getSnapshot()).toBe(ready);
    expect(waiting).toHaveLength(1);
  });

  it('FR-VG-13: 強さの変更は「束ね直す」で始まり、新しい強さで計算する', async () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request());
    fire();
    waiting[0]?.resolve(done);
    await flush();
    controller.sync(request({ strength: 0.5 }));
    controller.rebundle();
    expect(controller.getSnapshot().phase).toBe('running');
    expect(waiting[1]?.job.settings?.strength).toBe(0.5);
  });

  it('FR-VG-13: 配置の計算中は始めず、終わって座標が確定してから計算する', () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request({ layoutBusy: true }));
    fire();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(waiting).toHaveLength(0);
    controller.sync(request({ layoutBusy: false }));
    fire();
    expect(waiting).toHaveLength(1);
  });

  it('FR-VG-13: 無効にすると計算を止めて結果を捨てる。有効に戻すと計算し直す', async () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request());
    fire();
    waiting[0]?.resolve(done);
    await flush();
    controller.sync(request({ enabled: false }));
    expect(controller.getSnapshot()).toMatchObject({ phase: 'idle', result: null });
    controller.sync(request());
    fire();
    expect(waiting).toHaveLength(2);
  });

  it('FR-VG-13: 表示中のエッジが 0 本なら計算しない', () => {
    const { controller, waiting, fire } = setup();
    controller.sync(request({ count: 0 }));
    fire();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(waiting).toHaveLength(0);
  });

  it('FR-VG-13: 購読者に変化を知らせ、解除できる', () => {
    const { controller, fire } = setup();
    let calls = 0;
    const off = controller.subscribe(() => calls++);
    controller.sync(request());
    fire();
    expect(calls).toBeGreaterThan(0);
    off();
    const seen = calls;
    controller.cancel();
    expect(calls).toBe(seen);
  });
});

describe('FR-VG-13: bundleEdgesOf', () => {
  it('FR-VG-13: グラフのエッジのキー・座標・向き・重みから束ねる対象を作る（座標の無い端点は除く）', () => {
    const g: RelataGraph = new Graph({ type: 'mixed', multi: false, allowSelfLoops: true });
    for (const id of ['a', 'b', 'c']) g.addNode(id, { label: id, type: toNodeTypeId('t') });
    const attrs = { count: 1, edgeIds: [], missingWeightCount: 0 };
    g.addEdgeWithKey('ab', 'a', 'b', { ...attrs, weight: 3, directed: true });
    g.addEdgeWithKey('bc', 'b', 'c', { ...attrs, weight: 1, directed: false });
    const positions = new Map([
      [toNodeId('a'), { x: 1, y: 2 }],
      [toNodeId('b'), { x: 3, y: 4 }],
    ]);
    expect(bundleEdgesOf(g, positions)).toEqual([
      { id: 'ab', x1: 1, y1: 2, x2: 3, y2: 4, directed: true, weight: 3 },
    ]);
  });
});
