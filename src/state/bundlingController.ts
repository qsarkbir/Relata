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
import { toNodeId } from '../core/model';
import type { NodeId } from '../core/model';
// 【なぜ】state は render の「型」だけ読んでよい（値は不可。ESLint が止める。設計書 §4.1 の例外）。
// 【TS】`import type` は型だけの取り込みで、実行時には消える。
import type { BundleEdge, BundleGraph, BundledPath } from '../render/bundling';
import { createBundlingClient, type BundlingClient } from '../workers/bundling.client';

/** 計算の段階。`idle` は何もしていない（無効、または配置の計算中）、`waiting` は入力が落ち着くのを待っている。 */
// 【TS】文字列リテラルの共用体。`'idle' | 'waiting' | …` のどれかだけを許し、打ち間違いを型エラーにする。
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
  readonly iterations?: number;
  readonly epsilonRatio?: number;
  /**
   * この結果を作ったときの入力の素（`BundlingRequest.sources`）。
   * 【なぜ】入力が変わった直後の 1 回の描画で、古い経路を新しい座標に重ねないよう、画面が今の入力と比べて使う。
   */
  readonly sources: readonly unknown[];
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
  readonly iterations?: number;
  readonly epsilonRatio?: number;
  /**
   * 確認を求めるエッジ数の境目。これを超える本数のときは `confirm` で止まる（D-55。既定の 5,000）。
   * 【なぜ】定数は render 側にあり、state は render の値を読めない。値を知っている views が渡す。
   */
  readonly limit: number;
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
  // 【TS】`ReadonlyMap<K, V>` は読み取り専用の Map（`get` はあるが `set` はない）。
  positions: ReadonlyMap<NodeId, { readonly x: number; readonly y: number }>,
): BundleEdge[] {
  const edges: BundleEdge[] = [];
  graph.forEachEdge((key, attrs, source, target) => {
    const a = positions.get(toNodeId(source));
    const b = positions.get(toNodeId(target));
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

// 【TS】`readonly unknown[]` は「中身を変えられず、要素の型を問わない配列」。`unknown` は何でも入るが、使う前に絞り込みが要る。ここは `Object.is` で比べるだけなので絞り込まない。
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
  // 【TS】`Set<() => void>` は「引数も戻り値も無い関数」の集合。購読者（変化を知りたい側）を重複なく持つ。
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
    // 【TS】`void (async () => { … })()` は、その場で非同期関数を呼び、Promise を待たずに捨てる書き方。
    //   `void` は「結果を意図して捨てる」印。中の失敗は try/catch で拾うので、未処理の拒否は起きない。
    void (async () => {
      try {
        const done = await client.run(
          {
            edges,
            settings: {
              strength: request.strength,
              ...(request.iterations === undefined ? {} : { iterations: request.iterations }),
            },
            buildGraph: true,
            ...(request.epsilonRatio === undefined ? {} : { epsilonRatio: request.epsilonRatio }),
          },
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
          result: {
            paths: done.paths,
            graph: done.graph,
            strength: request.strength,
            ...(request.iterations === undefined ? {} : { iterations: request.iterations }),
            ...(request.epsilonRatio === undefined ? {} : { epsilonRatio: request.epsilonRatio }),
            sources: request.sources,
          },
          error: null,
        });
      } catch (failure: unknown) {
        // 【なぜ】中止による AbortError は失敗として見せない。版が進んでいれば、どの失敗も古い。
        if (token !== revision) return;
        // 版が同じなのに中止された（Worker が他の理由で止められた）ときは、中止として見せる。
        if (failure instanceof DOMException && failure.name === 'AbortError') {
          publish({ ...IDLE, phase: 'cancelled' });
          return;
        }
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
    if (!confirmed && edges.length > request.limit) {
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

/** 本物のタイマーの時計。`setTimeout` は Node でも使えるタイマーで、DOM の API ではない。 */
export const timerScheduler: BundlingScheduler = {
  /**
   * 一定時間の後に callback を呼ぶ。
   * @param callback - 呼ぶ関数
   * @param milliseconds - 待つ時間
   * @returns 待ちを取り消す関数
   */
  delay: (callback, milliseconds) => {
    const timer = setTimeout(callback, milliseconds);
    return () => {
      clearTimeout(timer);
    };
  },
};

/**
 * Worker を新しく持つ controller を作る。
 *
 * 【なぜ】Worker の client は 1 つの計算しか持てない（新しい依頼が前の計算を止める）。
 * グラフ図と地図（T3-04）で別の controller を作るときは、controller ごとに client を分ける。
 *
 * @returns 専用の client を持つ controller
 */
export function createWorkerBundlingController(): BundlingController {
  return createBundlingController(createBundlingClient(), timerScheduler);
}

/** グラフ図の束ねる計算の窓口（アプリ全体で 1 つ）。 */
export const bundlingController: BundlingController = createWorkerBundlingController();

/** 地図の束ねる計算の窓口。グラフの計算を中止せず、結果も個別に保つ。 */
export const mapBundlingController: BundlingController = createWorkerBundlingController();
