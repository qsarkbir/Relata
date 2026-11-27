/**
 * グラフ図の edge bundling の計算の寿命: 版番号、中止、古い結果の破棄、計算し直す時機（FR-VG-13、14、D-55、D-17）。
 *
 * 【なぜ】views が Worker の client と版番号を直接持たないため（設計書 §4.1）。結果（束ねた経路と束の区間のまとめ）は
 * 画面の状態として持つが、プロジェクトファイルには保存しない（phase3-plan §4「計算結果のキャッシュ」）。
 *
 * 計算し直す時機（phase3-plan §4.1）:
 * - 入力（`sources`）が変わったとき: フィルタ・構築（グラフ）、配置（座標）。ズーム・パン・再生・描き方の切り替えは
 *   入力に入らないので、何も起きない。
 * - 束ねるを有効にしたとき。無効にしたら計算を止めて結果を捨てる。
 * - 配置の計算中は走らせない（終わって座標が確定してから）。
 * - 強さの変更は自動では走らせず、{@link BundlingController.rebundle}（「束ね直す」）で始める。
 * - 表示中のエッジが 5,000 本を超えるときは、始める前に `confirm` の状態で止まり、利用者の確認を待つ。
 */
import type { RelataGraph } from '../core/graph';
import type { NodeId } from '../core/model';
import {
  BUNDLING_EDGE_WARNING_LIMIT,
  bundlingClient,
  exceedsBundlingLimit,
  type BundleEdge,
  type BundleGraph,
  type BundledPath,
  type BundlingClient,
} from '../workers/bundling.client';

/** 計算の段階。`idle` は何もしていない（無効、または配置の計算中）、`waiting` は入力が落ち着くのを待っている。 */
export type BundlingPhase =
  'idle' | 'waiting' | 'confirm' | 'running' | 'ready' | 'cancelled' | 'error';

/** 束ねた結果。保存しない。 */
export interface BundlingOutcome {
  /** 束ねた折れ線。`id` はグラフのエッジのキー、座標はレイアウトの座標。 */
  readonly paths: readonly BundledPath[];
  /** 束の区間のまとめ（Worker で作る）。 */
  readonly graph: BundleGraph;
  /** この結果を作ったときの強さ。いまの設定と違えば「束ね直す」を促す。 */
  readonly strength: number;
}

/** 保存しない計算の状態。 */
export interface BundlingView {
  readonly phase: BundlingPhase;
  /** 進み具合（0〜1）。`running` のときだけ意味がある。 */
  readonly progress: number;
  /** `confirm` のとき、束ねる対象の本数。 */
  readonly edgeCount: number;
  /** `ready` のときだけ値がある。計算中・中止・失敗では null（束ねない図を描く）。 */
  readonly result: BundlingOutcome | null;
  /** `error` のとき、理由。 */
  readonly error: string | null;
}

/** 画面が「いまの望み」を伝える入力。 */
export interface BundlingRequest {
  /** 束ねるを有効にしているか。 */
  readonly enabled: boolean;
  /** 配置の計算中か。true の間は計算を始めない。 */
  readonly layoutBusy: boolean;
  /**
   * 計算の入力の素（グラフ、座標など）。要素ごとに `Object.is` で前回と比べ、1 つでも違えば計算し直す。
   * 【なぜ】ズームやパンでは変わらない参照だけを渡せば、「計算しない操作」が自然に守られる。
   */
  readonly sources: readonly unknown[];
  /** 束ねる強さ（0〜1）。入力の素に含めない（変えても自動では計算しない）。 */
  readonly strength: number;
  /** 束ねる対象のエッジを作る。重いので、実際に始めるときにだけ呼ぶ。 */
  readonly build: () => readonly BundleEdge[];
}

/** 遅延の時計。テストで偽物に差し替える。 */
export interface BundlingScheduler {
  delay(callback: () => void, milliseconds: number): () => void;
}

/** 束ねる計算の窓口。 */
export interface BundlingController {
  readonly getSnapshot: () => BundlingView;
  readonly subscribe: (listener: () => void) => () => void;
  /** いまの望みを伝える。計算し直す時機かどうかは、ここで決める。 */
  sync(request: BundlingRequest): void;
  /** 「束ね直す」。強さの変更などを、入力が同じでも反映する。 */
  rebundle(): void;
  /** 5,000 本を超える確認に「始める」と答える。 */
  confirm(): void;
  /** 計算（または確認待ち）をやめる。束ねない図に戻る。 */
  cancel(): void;
}

/** 警告の境目（5,000 本）。算法側の定数をそのまま見せる。 */
export { BUNDLING_EDGE_WARNING_LIMIT };

/** 入力が落ち着くのを待つ時間（ミリ秒）。ドラッグで座標が動き続ける間は始めない。 */
export const BUNDLING_SETTLE_DELAY = 300;

const IDLE: BundlingView = { phase: 'idle', progress: 0, edgeCount: 0, result: null, error: null };

/**
 * グラフと座標から、束ねる対象のエッジを作る。
 *
 * 太さと同じ重み（`graph.getEdgeAttribute(key, 'weight')`。欠損や不正は算法が 0 として数える）を使う。
 * 座標の無い端点を持つエッジは対象にしない。
 *
 * @param graph - 表示中のグラフ
 * @param positions - ノード ID → レイアウトの座標
 * @returns 束ねる対象（id はグラフのエッジのキー）
 */
export function bundleEdgesOf(
  graph: RelataGraph,
  positions: ReadonlyMap<NodeId, { readonly x: number; readonly y: number }>,
): BundleEdge[] {
  const edges: BundleEdge[] = [];
  graph.forEachEdge((key, attrs, source, target) => {
    const a = positions.get(source as NodeId);
    const b = positions.get(target as NodeId);
    if (a === undefined || b === undefined) return;
    edges.push({
      id: key,
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      directed: attrs.directed,
      weight: attrs.weight,
    });
  });
  return edges;
}

function sameSources(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

/**
 * 束ねる計算を管理する controller を作る。
 *
 * @param client - 本物またはテスト用の Worker client
 * @param scheduler - 遅延の時計
 * @returns 状態の購読と、sync・rebundle・confirm・cancel
 */
export function createBundlingController(
  client: BundlingClient,
  scheduler: BundlingScheduler,
): BundlingController {
  let revision = 0;
  let view: BundlingView = IDLE;
  let cancelTimer: (() => void) | null = null;
  let latest: BundlingRequest | null = null;
  let lastSources: readonly unknown[] | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: BundlingView): void => {
    view = next;
    for (const listener of listeners) listener();
  };
  const stop = (): void => {
    revision++;
    cancelTimer?.();
    cancelTimer = null;
    client.cancel();
  };
  const run = (request: BundlingRequest, edges: readonly BundleEdge[]): void => {
    const token = revision;
    publish({ phase: 'running', progress: 0, edgeCount: edges.length, result: null, error: null });
    void (async () => {
      try {
        const done = await client.run(
          { edges, settings: { strength: request.strength }, buildGraph: true },
          (p) => {
            if (token === revision && p.cycles > 0)
              publish({ ...view, phase: 'running', progress: p.cycle / p.cycles });
          },
        );
        if (token !== revision) return;
        if (done.graph === undefined) throw new Error('束ねた結果のグラフが返りませんでした。');
        publish({
          phase: 'ready',
          progress: 1,
          edgeCount: edges.length,
          result: { paths: done.paths, graph: done.graph, strength: request.strength },
          error: null,
        });
      } catch (failure: unknown) {
        // 【なぜ】中止による AbortError は失敗として見せない。版が進んでいれば、どの失敗も古い。
        if (token !== revision) return;
        if (failure instanceof DOMException && failure.name === 'AbortError') return;
        publish({
          phase: 'error',
          progress: 0,
          edgeCount: edges.length,
          result: null,
          error: failure instanceof Error ? failure.message : String(failure),
        });
      }
    })();
  };
  const begin = (request: BundlingRequest, confirmed: boolean): void => {
    const edges = request.build();
    if (edges.length === 0) {
      publish(IDLE);
      return;
    }
    if (!confirmed && exceedsBundlingLimit(edges.length)) {
      publish({ ...IDLE, phase: 'confirm', edgeCount: edges.length });
      return;
    }
    run(request, edges);
  };
  return {
    getSnapshot: () => view,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sync(request) {
      latest = request;
      if (!request.enabled || request.layoutBusy) {
        // 【なぜ】無効にしたとき、配置の計算中のときは、前の結果も捨てる（座標が変わるので古くなる）。
        lastSources = null;
        if (view.phase !== 'idle') {
          stop();
          publish(IDLE);
        }
        return;
      }
      if (lastSources !== null && sameSources(lastSources, request.sources)) return;
      lastSources = request.sources;
      stop();
      publish({ ...IDLE, phase: 'waiting' });
      const token = revision;
      cancelTimer = scheduler.delay(() => {
        if (token !== revision || latest === null) return;
        cancelTimer = null;
        begin(latest, false);
      }, BUNDLING_SETTLE_DELAY);
    },
    rebundle() {
      if (latest === null || !latest.enabled || latest.layoutBusy) return;
      lastSources = latest.sources;
      stop();
      begin(latest, false);
    },
    confirm() {
      if (view.phase !== 'confirm' || latest === null) return;
      stop();
      begin(latest, true);
    },
    cancel() {
      if (view.phase === 'idle' || view.phase === 'cancelled') return;
      stop();
      publish({ ...IDLE, phase: 'cancelled' });
    },
  };
}

/** アプリ全体で共有する束ねる計算の窓口。`setTimeout` は Node でも使えるタイマーで、DOM の API ではない。 */
export const bundlingController: BundlingController = createBundlingController(bundlingClient, {
  delay: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
});
