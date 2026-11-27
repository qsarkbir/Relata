import { EncodingControls } from './EncodingControls';
import { MissingDisplayControls } from './MissingDisplayControls';
import { graphEncodingWithLegends } from './graphEncoding';
import { createGraphMeasure } from './graphMeasure';
/** グラフ表示と操作。元データとフィルタは既存ストアを参照する（T1-19）。 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { toSnapshot } from '../core/graph';
import { DEFAULT_GRAPH_VIEW, resolveGeoSource } from '../core/project';
import type { GraphViewSettings } from '../core/project';
import type { NodeId } from '../core/model';
import { toNodeId } from '../core/model';
import { findMissingElements } from '../core/missing';
import { matchIncludes, LOOSE_MATCH } from '../core/text';
import { buildScene, fitZoomFor, markOutOfTime, renderSvg, MAX_ZOOM, MIN_ZOOM } from '../render';
import { createSvgExport } from '../io/export';
import { setFigureSource } from './figureExport';
import { buildFigureLegend } from './figureLegend';
import { Icon, IconButton } from './ui/icons';
import { InfoTip } from './ui/InfoTip';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { Field } from './ui/Field';
import { LayoutMethodControls, NoCoordinatesNote } from './LayoutMethodControls';
import { geoInputsFor, needsGeoChoice } from './geoInputs';
import { GraphSearch } from './GraphSearch';
import { getNumberFormat } from './intl';
import { StatusMessage } from './ui/StatusMessage';
import { Toolbar, ToolbarGroup } from './ui/Toolbar';
import { Chip } from './ui/Chip';
import {
  graphViewStore,
  layoutController,
  mapViewStore,
  selectedGraphEdges,
  selectionStore,
  uiStore,
} from '../state';
import { useData, useSelection, useT, useUi } from './hooks';
import { TimeFadeNote } from './TimeFadeNote';
import { useTimeFade } from './timeFade';
import { useNetwork } from './useNetwork';
import { clientToSvg, useRangeSelect } from './useRangeSelect';
import { RangeSelectSummary } from './RangeSelectSummary';
import { buildPanelStore } from './buildPanelStore';
import { ProjectionIssues } from './ProjectionNotice';
import { NeighborEvidence, SelectedEdges } from './ProjectionEvidence';
import './graph.css';

/** 図の枠の既定の大きさ（CSS ピクセル）。枠の大きさを測るまでと、測れない環境で使う。 */
const DEFAULT_CANVAS = { width: 800, height: 500 } as const;
/**
 * シーンの組み直しを、拡大の操作の後まで待つ大きさの目安（ノード数 + エッジ数）。
 * これを超える図は、拡大の最中は今のシーンを引き伸ばし、操作が止まってから作り直す（NFR-03）。
 */
const LIVE_SCENE_LIMIT = 3000;
/** 重い図で、拡大の操作が止まってからシーンを作り直すまでの待ち（ミリ秒）。 */
const RESCALE_DELAY = 120;

/**
 * 図の中の点 (x, y) を動かさずに、拡大率を factor 倍にする。
 *
 * 【なぜ】部品の外に置き、ストアから今の値を読む。ホイールの処理を一度だけ登録しても、
 * 古い表示の値を使わずに済むため。
 * @param factor - 拡大率に掛ける倍率
 * @param x - 固定する点の x（SVG の座標）
 * @param y - 固定する点の y（SVG の座標）
 */
function zoomAround(factor: number, x: number, y: number): void {
  const current = graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, current.viewport.zoom * factor));
  graphViewStore.getState().setView({
    ...current,
    viewport: {
      zoom,
      x: x - ((x - current.viewport.x) * zoom) / current.viewport.zoom,
      y: y - ((y - current.viewport.y) * zoom) / current.viewport.zoom,
    },
  });
}

/**
 * Workerの位置をSVGへ描き、選択・検索・固定・保存・SVG出力を操作する。
 * @returns データがない場合はnull、それ以外はグラフの操作領域
 */
export function GraphView() {
  const dataset = useData((s) => s.dataset);
  const stored = useStore(graphViewStore, (s) => s.view);
  const view = stored ?? DEFAULT_GRAPH_VIEW;
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  // 【なぜ】選択は state の selectionStore に置く（D-40）。表ビューなど他のビューと共有し、
  // 設定の引き出しやカードの開閉では変わらない。データを置き換えると、ストア側が空にする。
  const selected = useSelection((s) => s.nodes);
  const selectedEdges = useSelection((s) => s.edges);
  const [query, setQuery] = useState('');
  // 【なぜ】引き出しとカードの開閉は、この部品の一時的な状態。開閉しても、viewport・選択・配置・フィルタは
  // 別の場所（ストア）にあるので変わらない。閉じても中身は描いたまま隠す（hidden）。
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [cardOpen, setCardOpen] = useState(true);
  const drawer = useRef<HTMLElement>(null);
  const cardTitle = useRef<HTMLHeadingElement>(null);
  const drawerToggle = useRef<HTMLButtonElement>(null);
  const [highlight, setHighlight] = useState<'both' | 'in' | 'out'>('both');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [iteration, setIteration] = useState(0);
  // 【なぜ】ドラッグや固定の切り替えで計算を中止したかを覚えておく。中止の後に位置の無いノードが
  // 残っていたら、操作が終わった時点で計算をやり直す（レビューの推奨。そのままだと、利用者が
  // 「再配置する」を押すまで、位置の決まらないノードが図に出ない）。
  const interrupted = useRef(false);
  const handledIteration = useRef(0);
  // 【なぜ】方式を変えたとき、再配置のとき、列の順や属性を変えたときは、計算の後に図を収め直す
  // （「全体を表示」と同じ）。位置が全く変わるので、前の拡大率のままだと図が画面の外に出ることがある。
  const refitAfterLayout = useRef(false);
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const rangeRect = useRef<SVGRectElement>(null);
  // 【なぜ】フックは早期 return より前で呼ぶ（呼ぶ順序を変えない）。
  // 【なぜ】枠の大きさは利用者がつまみで変えられる。SVG の座標を CSS ピクセルと 1 対 1 にするため、
  // 測った大きさを viewBox に使う。レイアウトの効果は大きさの変化で動かしたくないので、ref にも写す。
  const [canvas, setCanvas] = useState<{ width: number; height: number }>(DEFAULT_CANVAS);
  const canvasRef = useRef<{ width: number; height: number }>(DEFAULT_CANVAS);
  const drag = useRef<{
    id?: NodeId;
    /** 押した場所のエッジのキー（ノードでなければ）。離したときに、動いていなければ選ぶ。 */
    edgeKey?: string;
    x: number;
    y: number;
    px: number;
    py: number;
    moved: boolean;
  } | null>(null);
  // 【なぜ】描画・配置・指標が、同じ射影後のグラフを使う。計算は state の getNetwork が 1 か所で行う（D-39）。
  const network = useNetwork();
  const range = useRangeSelect(svg, rangeRect, (key) => {
    const g = network?.graph;
    if (g?.hasEdge(key) !== true) return [];
    return g.getEdgeAttribute(key, 'edgeIds');
  });
  // 【なぜ】構築のパネルが開いている間は、同じ理由をパネルの中だけに出す（支援技術の二重の読み上げを防ぐ）。
  const buildPanelOpen = useStore(buildPanelStore, (b) => b.open);
  const graph = network?.graph ?? null;
  const selectedEdgeKeys = useMemo(
    () => (graph === null ? [] : selectedGraphEdges(graph, selectedEdges)),
    [graph, selectedEdges],
  );
  const selectedEdgeSet = useMemo(() => new Set(selectedEdgeKeys), [selectedEdgeKeys]);
  const patch = (change: Partial<GraphViewSettings>) => {
    graphViewStore
      .getState()
      .setView({ ...(graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW), ...change });
  };
  const encodingWithLegends = useMemo(
    () =>
      graph === null || dataset === null
        ? null
        : graphEncodingWithLegends(dataset, graph, view.encoding),
    [graph, dataset, view.encoding],
  );
  const encoding = useMemo(() => encodingWithLegends?.encoding ?? {}, [encodingWithLegends]);
  // 【なぜ】「欠損の表示」の判定は core の関数で行う。図のエッジはまとめた後のものなので、元のエッジのどれかが
  // 欠損していれば、そのエッジ（グラフのキー）を破線にする。位置や配置の計算には関わらない（再配置しない）。
  const missingMarks = useMemo(() => {
    if (graph === null || dataset === null) return { nodes: undefined, edges: undefined };
    const found = findMissingElements(
      dataset,
      view.missingDisplay.nodeAttrs,
      view.missingDisplay.edgeAttrs,
    );
    const edges = new Set<string>();
    if (found.edges.size > 0)
      graph.forEachEdge((key, attrs) => {
        if (attrs.edgeIds.some((id) => found.edges.has(id))) edges.add(key);
      });
    return { nodes: found.nodes, edges };
  }, [graph, dataset, view.missingDisplay]);
  const visibleSelected = useMemo(
    () => new Set([...selected].filter((id) => graph?.hasNode(id))),
    [selected, graph],
  );
  const positions = useMemo(() => new Map(view.positions.map((p) => [p.id, p])), [view.positions]);
  const measureText = useMemo(() => createGraphMeasure(), []);
  // 【なぜ】再生の「時刻の外」は、配置やシーンの組み立てには入れない（再生のたびに再配置・再構築しない。R-17）。
  //   組み立て済みのシーンに、薄くする印だけを後から付ける。フィルタ、件数、指標には関わらない。
  const timeFade = useTimeFade();
  // 【なぜ】半径・線の太さ・文字・矢じりは、拡大しても設定した px のままにする（利用者の報告）。
  //   図全体を scale() で拡大せず、シーンの側で位置だけを倍率に合わせて作る（buildScene の zoom）。
  //   倍率が変わるとシーンを作り直すので、重い図は、拡大の操作が止まってから作り直し、その間は
  //   今のシーンを引き伸ばして見せる（NFR-03）。軽い図は、操作のたびにそのまま作り直す。
  const [settledZoom, setSettledZoom] = useState(view.viewport.zoom);
  const live = graph === null || graph.order + graph.size <= LIVE_SCENE_LIMIT;
  const sceneZoom = live ? view.viewport.zoom : settledZoom;
  useEffect(() => {
    if (live || settledZoom === view.viewport.zoom) return;
    const timer = setTimeout(() => {
      setSettledZoom(view.viewport.zoom);
    }, RESCALE_DELAY);
    return () => {
      clearTimeout(timer);
    };
  }, [live, settledZoom, view.viewport.zoom]);
  /** 倍率 zoom のシーンを作る（図に出す要素の指定は、画面の描画と全体表示で同じ）。 */
  const buildAt = useCallback(
    (
      sourceGraph: NonNullable<typeof graph>,
      sourcePositions: ReadonlyMap<NodeId, { readonly x: number; readonly y: number }>,
      zoom: number,
    ) =>
      buildScene(sourceGraph, sourcePositions, encoding, {
        labels: view.labels,
        largeLabelCount: view.largeLabelCount,
        selected: visibleSelected,
        includeSelection: true,
        directedStyle: view.direction,
        measureText,
        zoom,
        // 【TS】条件付きスプレッド: `...(条件 ? {} : { 項目 })` は、値がある時だけ項目を足す。
        //   値が無いとき、項目そのものを作らず、既定の扱いを buildScene 側に任せるため。
        ...(missingMarks.nodes === undefined ? {} : { missingNodes: missingMarks.nodes }),
        ...(missingMarks.edges === undefined ? {} : { missingEdges: missingMarks.edges }),
      }),
    [
      encoding,
      view.labels,
      view.largeLabelCount,
      visibleSelected,
      view.direction,
      measureText,
      missingMarks,
    ],
  );
  const scene = useMemo(
    () => (graph === null ? null : buildAt(graph, positions, sceneZoom)),
    [graph, positions, sceneZoom, buildAt],
  );
  // 【なぜ】シーンの座標は「位置 × 倍率 ＋ ずれ」。ずれは最初のノードから逆算する（余白と範囲の補正）。
  const offset =
    scene?.nodes[0] === undefined
      ? { x: 0, y: 0 }
      : {
          x: scene.nodes[0].x - (positions.get(scene.nodes[0].id)?.x ?? 0) * sceneZoom,
          y: scene.nodes[0].y - (positions.get(scene.nodes[0].id)?.y ?? 0) * sceneZoom,
        };
  /**
   * 全体が枠に収まるように、倍率と位置を決めて反映する。ノードが 0 件のときは何もしない。
   * 【なぜ】0 件の図は余白だけなので、収める倍率が巨大になり、フィルタを解除した後も残ってしまう。
   */
  const fit = useCallback(() => {
    if (graph === null) return;
    const fitted = fitZoomFor((z) => buildAt(graph, positions, z), canvas);
    const first = fitted.scene.nodes[0];
    if (first === undefined) return;
    const dx = first.x - (positions.get(first.id)?.x ?? 0) * fitted.zoom;
    const dy = first.y - (positions.get(first.id)?.y ?? 0) * fitted.zoom;
    setSettledZoom(fitted.zoom);
    graphViewStore.getState().setView({
      ...(graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW),
      viewport: {
        zoom: fitted.zoom,
        x: canvas.width / 2 - (fitted.scene.width / 2 - dx),
        y: canvas.height / 2 - (fitted.scene.height / 2 - dy),
      },
    });
  }, [graph, positions, canvas, buildAt]);
  const hasNodes = (scene?.nodes.length ?? 0) > 0;
  // 【なぜ】フィルタなどで 0 件になった後、1 件以上に戻ったときは、自動で全体を表示する。0 件の間に
  //   変えた倍率（や、以前の巨大な倍率）を引き継ぐと、解除した直後の図が画面の外に出る（利用者の報告）。
  //   データを開いた直後（保存した表示を復元する場合）は対象にしない。0 件になったのが絞り込みの結果で、
  //   同じデータのまま戻ったときだけ行う。
  const emptyByFilter =
    graph !== null && dataset !== null && graph.order === 0 && dataset.nodes.length > 0;
  const wasEmpty = useRef<{ empty: boolean; dataset: typeof dataset }>({
    empty: false,
    dataset,
  });
  const restored = graph !== null && graph.order > 0;
  useEffect(() => {
    const before = wasEmpty.current;
    wasEmpty.current = { empty: emptyByFilter, dataset };
    if (before.empty && before.dataset === dataset && restored) fit();
  }, [emptyByFilter, restored, dataset, fit]);
  /** 操作のために計算を中止する。計算中だったら、後でやり直す印を付ける。 */
  const interruptLayout = () => {
    if (busy) interrupted.current = true;
    layoutController.cancel();
    setBusy(false);
  };
  /** 中止した計算で位置が欠けたままなら、計算をやり直す。 */
  const resumeLayout = () => {
    if (!interrupted.current || graph === null) return;
    interrupted.current = false;
    const saved = new Set(
      (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).positions.map((p) => p.id),
    );
    if (graph.nodes().some((id) => !saved.has(toNodeId(id)))) setIteration((v) => v + 1);
  };
  const [previousDataset, setPreviousDataset] = useState(dataset);
  if (previousDataset !== dataset) {
    setPreviousDataset(dataset);
    setQuery('');
  }

  useEffect(() => {
    if (graph === null) return;
    const lifetime = { cancelled: false };
    // 【なぜ】版番号と古い結果の破棄は state の layoutController が持つ（D-17）。
    // ここでは効果の後片付けが済んだかだけを見る。
    const isStale = () => lifetime.cancelled;
    const current = graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW;
    const savedIds = new Set(current.positions.map((p) => p.id));
    const allSaved = graph.nodes().every((id) => savedIds.has(toNodeId(id)));
    // 【なぜ】座標の出どころは地図と共通（`view.geoSource`。D-46）。どのノードにも座標が取り出せない間
    //   （出どころが `geo` なのに `geo` を持つノードが無い）は計算せず、前の配置を上書きしない。
    const geoSourceNow = resolveGeoSource(mapViewStore.getState().geoSource, current);
    const waitingForGeo =
      current.layout === 'geo' && dataset !== null && needsGeoChoice(dataset, geoSourceNow);
    if (waitingForGeo) handledIteration.current = iteration;
    if (waitingForGeo || (allSaved && iteration === handledIteration.current)) {
      queueMicrotask(() => {
        if (!isStale()) {
          setBusy(false);
          setError(false);
        }
      });
      return () => {
        lifetime.cancelled = true;
      };
    }
    handledIteration.current = iteration;
    const task = uiStore.getState().startTask({ key: 'graph.layoutTask' }, () => {
      layoutController.cancel();
      setBusy(false);
    });
    const run = async () => {
      await Promise.resolve();
      if (isStale()) return;
      setBusy(true);
      setError(false);
      const kind = current.layout === 'fixed' && !allSaved ? 'circular' : current.layout;
      // 層状・地理座標の入力。属性の値の検査（座標なし）はここ（メインスレッド）で済ませ、Worker へは数だけ渡す。
      const methodOptions =
        kind === 'layered'
          ? { columnOrder: current.columnOrder ?? [] }
          : kind === 'geo' && dataset !== null
            ? { geo: geoInputsFor(dataset, graph, geoSourceNow) }
            : {};
      const outcome = await layoutController.run({
        job: {
          snapshot: toSnapshot(graph),
          options: { kind, seed: current.seed, positions: current.positions, ...methodOptions },
        },
        rounds: kind === 'forceatlas2' ? 10 : 0,
        onProgress: (fraction) => {
          uiStore.getState().updateTask(task, fraction);
        },
        apply: (positions) => {
          const merged = new Map(current.positions.map((p) => [p.id, p]));
          for (const p of positions) merged.set(p.id, p);
          const nextPositions = [...merged.values()];
          const refit = refitAfterLayout.current;
          refitAfterLayout.current = false;
          // 保存された全座標は再開時にそのまま使う。初回だけ全体を収める。
          const raw = new Map(nextPositions.map((p) => [p.id, p]));
          const size = canvasRef.current;
          // 【なぜ】全体表示の倍率は、半径や文字が px のままのシーンから求める（fitZoomFor）。
          //   収め直すときだけ計算する（シーンの組み立てを 3 回するため。計算の途中の反映では省く）。
          const fitted =
            current.positions.length === 0 || refit
              ? fitZoomFor((z) => buildScene(graph, raw, encoding, { measureText, zoom: z }), size)
              : null;
          const first = fitted?.scene.nodes[0];
          // 【なぜ】ノードが 0 件のときは倍率を変えない（収める対象が無い）。
          if (fitted !== null && first !== undefined) {
            const dx = first.x - (raw.get(first.id)?.x ?? 0) * fitted.zoom;
            const dy = first.y - (raw.get(first.id)?.y ?? 0) * fitted.zoom;
            setSettledZoom(fitted.zoom);
            patch({
              positions: nextPositions,
              viewport: {
                zoom: fitted.zoom,
                x: size.width / 2 - (fitted.scene.width / 2 - dx),
                y: size.height / 2 - (fitted.scene.height / 2 - dy),
              },
            });
          } else patch({ positions: nextPositions });
        },
      });
      uiStore.getState().endTask(task);
      if (outcome === 'error' && !isStale()) setError(true);
      if (!isStale()) setBusy(false);
    };
    void run();
    return () => {
      lifetime.cancelled = true;
      layoutController.cancel();
      uiStore.getState().endTask(task);
    };
    // 位置・viewportの保存更新では反復を再開しない。入力グラフと方式/seed、明示再計算だけを監視する。
  }, [graph, dataset, view.layout, view.seed, iteration, measureText, encoding]);
  const hasFigure = dataset !== null && graph !== null && scene !== null;
  // 【なぜ】「書き出し」のダイアログから図を書き出せるよう、今の図を作る関数を登録する（figureExport.ts）。
  const canExport = hasFigure && scene.nodes.length > 0;
  useEffect(() => {
    if (!canExport || encodingWithLegends === null) {
      setFigureSource(null);
      return;
    }
    setFigureSource({
      title: dataset.meta.title,
      build: (request) => {
        const options = {
          labels: view.labels,
          largeLabelCount: view.largeLabelCount,
          // 【なぜ】選択ラベルの候補は渡し、選択の輪郭だけを書き出しから除く。
          selected: visibleSelected,
          includeSelection: false,
          directedStyle: view.direction,
          measureText: request.measureText ?? measureText,
          ...(missingMarks.nodes === undefined ? {} : { missingNodes: missingMarks.nodes }),
          ...(missingMarks.edges === undefined ? {} : { missingEdges: missingMarks.edges }),
          // 【なぜ】画面で薄く表示している要素を、書き出しでも薄くする（画面と図を食い違わせない）。
          // 利用者が「書き出し」のダイアログで外したときと、何も薄くしていないときは付けない。
          ...(request.timeFade && (timeFade.nodes.size > 0 || timeFade.edges.size > 0)
            ? { timeFade }
            : {}),
          title: dataset.meta.title,
        };
        const plain = createSvgExport(graph, positions, encoding, options);
        if (!request.legend && !request.credit) return plain;
        // 凡例は、図に現れた破線の種類などを調べるため、凡例なしのシーンを見てから作る。
        const legend = buildFigureLegend({
          t,
          formatNumber: (n) => nf.format(n),
          dataset,
          graph,
          settings: view.encoding,
          encoding,
          legends: encodingWithLegends.legends,
          directedStyle: view.direction,
          scene: plain.scene,
          legend: request.legend,
          ...(request.credit
            ? {
                credit: {
                  title: dataset.meta.title,
                  ...(dataset.meta.source === undefined ? {} : { source: dataset.meta.source }),
                  date: request.createdAt,
                },
              }
            : {}),
        });
        return legend === undefined
          ? plain
          : createSvgExport(graph, positions, encoding, { ...options, legend });
      },
    });
    return () => {
      setFigureSource(null);
    };
  }, [
    canExport,
    dataset,
    graph,
    positions,
    encoding,
    encodingWithLegends,
    view.labels,
    view.largeLabelCount,
    view.direction,
    view.encoding,
    visibleSelected,
    measureText,
    missingMarks,
    timeFade,
    t,
    nf,
  ]);
  useEffect(() => {
    const element = svg.current;
    if (!hasFigure || element === null) return;
    // 【なぜ】React の onWheel は passive で登録されるので、preventDefault が効かず、拡大・縮小と同時に
    // ページもスクロールしてしまう。DOM に直接 passive: false で登録して、ページのスクロールを止める。
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // 【なぜ】ノードが無いときは拡大・縮小しない（巨大な倍率が残るため）。
      if (!hasNodes) return;
      const matrix = element.getScreenCTM();
      const p =
        matrix === null
          ? { x: event.clientX, y: event.clientY }
          : new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
      zoomAround(event.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', onWheel);
    };
  }, [hasFigure, hasNodes]);
  useEffect(() => {
    const element = frame.current;
    if (!hasFigure || element === null || typeof ResizeObserver === 'undefined') return;
    // 【なぜ】枠の大きさ（窓の大きさ、下の段の高さ、左右のパネルの開閉）を測り、viewBox と全体表示に使う。
    const observer = new ResizeObserver(() => {
      // 【なぜ】「グラフ｜地図」の切り替えで隠れると枠の大きさは 0 になる。0 を測った値として採ると、
      //   戻ったときに viewBox が一瞬 1×1 になり、倍率や全体表示の計算が乱れる。隠れている間は前の値を保つ（D-48）。
      if (element.clientWidth === 0 && element.clientHeight === 0) return;
      const width = Math.max(1, Math.round(element.clientWidth));
      const height = Math.max(1, Math.round(element.clientHeight));
      canvasRef.current = { width, height };
      setCanvas((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [hasFigure]);
  // 【なぜ】SVG の文字列は、図の内容（シーン・選択・検索・強調）が変わったときだけ作り直す。
  // パンやズーム、矩形選択のたびに全体を組み直さない（描画の負荷を避ける）。
  const inner = useMemo(() => {
    if (scene === null) return '';
    const matchSet = new Set(
      query === ''
        ? []
        : (graph?.nodes() ?? []).filter(
            (id) =>
              matchIncludes(graph?.getNodeAttribute(id, 'label') ?? '', query, LOOSE_MATCH) ||
              matchIncludes(id, query, LOOSE_MATCH),
          ),
    );
    const marked = markOutOfTime(scene, timeFade.nodes, timeFade.edges);
    const display = {
      ...marked,
      nodes: marked.nodes.map((node) =>
        matchSet.has(node.id) ? { ...node, fill: '#ffcc00' } : node,
      ),
      edges: marked.edges.map((edge) => ({
        ...edge,
        // 選んだエッジは、色に加えて太さでも示す（色だけで伝えない）。
        ...(selectedEdgeSet.has(edge.id) ? { width: Math.max(edge.width * 2, 3) } : {}),
        color: selectedEdgeSet.has(edge.id)
          ? '#7b3294'
          : visibleSelected.has(edge.source) && visibleSelected.has(edge.target)
            ? '#7b3294'
            : !edge.directed &&
                (visibleSelected.has(edge.source) || visibleSelected.has(edge.target))
              ? '#7b3294'
              : visibleSelected.has(edge.target)
                ? '#d55e00'
                : visibleSelected.has(edge.source)
                  ? '#0072b2'
                  : edge.color,
        opacity:
          selectedEdgeSet.has(edge.id) ||
          (visibleSelected.size === 0 && selectedEdgeSet.size === 0) ||
          (highlight !== 'in' && visibleSelected.has(edge.source)) ||
          (highlight !== 'out' && visibleSelected.has(edge.target))
            ? edge.opacity
            : 0.12,
      })),
    };
    const markup = renderSvg(display, { idPrefix: 'graph-view-' });
    // 生成器が検証・エスケープしたSVGの中身だけを使う。任意の利用者HTMLは挿入しない。
    return markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</svg>'));
  }, [scene, graph, query, visibleSelected, selectedEdgeSet, highlight, timeFade]);
  if (dataset === null || graph === null || scene === null) return null;
  const matches = graph
    .nodes()
    .filter(
      (id) =>
        query !== '' &&
        (matchIncludes(graph.getNodeAttribute(id, 'label'), query, LOOSE_MATCH) ||
          matchIncludes(id, query, LOOSE_MATCH)),
    );
  // 表示中の選択を優先し、無ければ（絞り込みで見えなくなった）選択の先頭をカードに出す。
  const selectedId = [...visibleSelected][0] ?? [...selected][0];
  const point = (clientX: number, clientY: number) => clientToSvg(svg.current, clientX, clientY);
  // 【なぜ】シーンは倍率 sceneZoom で作ってある。今の倍率との差は、作り直しを待つ間だけ引き伸ばして見せる
  //   （軽い図や、待ちが終わった後は 1 で、`translate` だけ）。位置が viewport.zoom のとおりに並ぶ。
  const stretch = view.viewport.zoom / sceneZoom;
  const zoomBy = (factor: number) => {
    if (!hasNodes) return;
    zoomAround(factor, canvas.width / 2, canvas.height / 2);
  };
  const choose = (id: string) => {
    if (id === '') {
      selectionStore.getState().clear();
      return;
    }
    selectionStore.getState().select({ nodes: [toNodeId(id)] });
    // 【なぜ】カードを畳んだ後に別のノードを選んでも閉じたままだと、選んでも反応が無いように見える。
    //   選び直したら開く（畳むのは「今の選択の詳細を隠す」操作で、以後ずっと隠す設定ではない）。
    setCardOpen(true);
  };
  // 選択中のノードの名前。表示されていなければ元のデータから引く（選択は消さない）。
  const nodeLabel = (id: NodeId): string =>
    graph.hasNode(id)
      ? graph.getNodeAttribute(id, 'label')
      : (dataset.nodes.find((n) => n.id === id)?.label ?? id);
  const openDrawer = () => {
    const next = !drawerOpen;
    setDrawerOpen(next);
    // 【なぜ】開いたら引き出しへフォーカスを移す。引き出しは図の後ろにあるので、移さないと
    // キーボードの利用者が図を通り過ぎるまで Tab を押すことになる。
    if (next) {
      requestAnimationFrame(() => {
        drawer.current?.focus();
      });
    }
  };

  // 選んだ元のエッジが、今のグラフのどのエッジにも対応しない（射影の設定やフィルタが変わった）。
  // 【なぜ】選択は消さず、表示されていないと示す（D-40）。
  const hiddenEdges = selectedEdges.size > 0 && selectedEdgeKeys.length === 0;
  const hasSelection = selected.size > 0 || selectedEdges.size > 0;
  const selectedFirst = [...selected][0];
  const selectionText =
    selected.size === 1 && selectedFirst !== undefined ? (
      <>
        <bdi>{nodeLabel(selectedFirst)}</bdi>
        {!visibleSelected.has(selectedFirst) && <> ({t('graph.selection.hiddenShort')})</>}
      </>
    ) : selected.size === 0 ? (
      hiddenEdges ? (
        t('evidence.selectedEdges')
      ) : (
        t('evidence.edgeCount', { count: nf.format(selectedEdgeKeys.length) })
      )
    ) : (
      t('graph.selection.count', { count: nf.format(selected.size) })
    );
  // カードの見出し。ノードを選んでいればその名前、エッジだけなら選んだ本数。
  // 複数選択のときは件数にする（先頭のノード名にすると、本文の一覧と重なる）。
  // 選択の要約と「選択したノードで絞り込む」のボタン。件数に応じてカードの中の位置を変える。
  const rangeSummary =
    selected.size >= 1 ? (
      <RangeSelectSummary
        ids={selected}
        nodeLabel={nodeLabel}
        passTypes={network?.projection.kind === 'applied' ? [network.projection.options.via] : []}
        typeLabel={(id) => dataset.nodeTypes.find((nt) => nt.id === id)?.label ?? id}
        isVisible={(id) => graph.hasNode(id)}
      />
    ) : null;
  const cardHeading =
    selected.size > 1
      ? t('graph.selection.count', { count: nf.format(selected.size) })
      : selectedId !== undefined
        ? nodeLabel(selectedId)
        : hiddenEdges
          ? t('evidence.selectedEdges')
          : t('evidence.edgeCount', { count: nf.format(selectedEdgeKeys.length) });
  const selectedVisible = selectedId !== undefined && graph.hasNode(selectedId);
  return (
    <section className="graph-view" aria-labelledby="graph-title">
      <h2 id="graph-title" className="visually-hidden">
        {t('graph.title')}
      </h2>
      <Toolbar label={t('graph.toolbar')}>
        <GraphSearch
          query={query}
          onQuery={setQuery}
          hits={matches.map((id) => ({ id, label: graph.getNodeAttribute(id, 'label') }))}
          formatCount={(count) => t('graph.search.count', { count: nf.format(count) })}
          onPick={(id) => {
            choose(id);
            const p = positions.get(toNodeId(id));
            if (p !== undefined)
              patch({
                viewport: {
                  ...view.viewport,
                  x: canvas.width / 2 - p.x * view.viewport.zoom,
                  y: canvas.height / 2 - p.y * view.viewport.zoom,
                },
              });
            // 【なぜ】選んだら一覧を閉じ、図を隠さない（探索中の少ない手順）。
            setQuery('');
            // 【なぜ】選んだ後にフォーカスが body へ落ちないよう、カードの見出しへ移す。
            // そこから Tab で、畳むボタン、固定ボタンへ進める。
            setCardOpen(true);
            requestAnimationFrame(() => {
              cardTitle.current?.focus();
            });
          }}
        />
        {hasSelection && (
          <Chip
            title={
              selected.size === 1 && selectedFirst !== undefined
                ? nodeLabel(selectedFirst)
                : undefined
            }
            onRemove={{
              label: t('graph.selection.clear'),
              run: () => {
                selectionStore.getState().clear();
              },
            }}
          >
            {selectionText}
          </Chip>
        )}
        <ToolbarGroup>
          <Field label={t('graph.highlight')}>
            <select
              aria-label={t('graph.highlight')}
              value={highlight}
              onChange={(e) => {
                const v = e.currentTarget.value;
                if (v === 'both' || v === 'in' || v === 'out') setHighlight(v);
              }}
            >
              <option value="both">{t('graph.both')}</option>
              <option value="in">{t('graph.in')}</option>
              <option value="out">{t('graph.out')}</option>
            </select>
          </Field>
          <InfoTip topic={t('graph.highlight')}>
            <p>{t('graph.highlightLegend')}</p>
          </InfoTip>
        </ToolbarGroup>
        <ToolbarGroup>
          <IconButton
            icon="zoomIn"
            label={t('graph.zoomIn')}
            disabled={!hasNodes}
            description={hasNodes ? undefined : t('graph.zoomDisabled')}
            onClick={() => {
              zoomBy(1.25);
            }}
          />
          <IconButton
            icon="zoomOut"
            label={t('graph.zoomOut')}
            disabled={!hasNodes}
            description={hasNodes ? undefined : t('graph.zoomDisabled')}
            onClick={() => {
              zoomBy(0.8);
            }}
          />
          <IconButton
            icon="fit"
            label={t('graph.fit')}
            onClick={fit}
            disabled={!hasNodes}
            description={hasNodes ? undefined : t('graph.zoomDisabled')}
          />
        </ToolbarGroup>
        <span className="rl-toolbar-spacer" />
        <button
          type="button"
          ref={drawerToggle}
          className="graph-settings-toggle"
          aria-expanded={drawerOpen}
          aria-controls="graph-settings-drawer"
          onClick={openDrawer}
        >
          <Icon name="settings" /> {t('graph.settings')}
        </button>
      </Toolbar>
      {network !== null && !buildPanelOpen && <ProjectionIssues status={network.projection} />}
      <NoCoordinatesNote dataset={dataset} graph={graph} view={view} />
      {graph.order === 0 && (
        <StatusMessage
          state={
            dataset.nodes.length === 0
              ? { kind: 'empty', message: t('graph.empty') }
              : {
                  kind: 'no-results',
                  message: t('graph.noNodes'),
                  hint: t('graph.noNodesHint'),
                }
          }
        />
      )}
      <div className="graph-body" data-drawer={drawerOpen ? 'open' : 'closed'}>
        <div className="graph-main">
          <div className="graph-stage">
            <div className="graph-canvas" data-main-frame="graph" ref={frame}>
              <svg
                ref={svg}
                viewBox={`0 0 ${String(canvas.width)} ${String(canvas.height)}`}
                role="img"
                tabIndex={0}
                onKeyDown={(e) => {
                  const offsets: Record<string, [number, number]> = {
                    ArrowLeft: [-20, 0],
                    ArrowRight: [20, 0],
                    ArrowUp: [0, -20],
                    ArrowDown: [0, 20],
                  };
                  if (e.key === 'Escape') {
                    // ドラッグ中は矩形の取り消しだけ。そうでなければ選択を解除する。
                    if (range.active()) range.cancel();
                    else selectionStore.getState().clear();
                    return;
                  }
                  const delta = offsets[e.key];
                  if (delta !== undefined) {
                    e.preventDefault();
                    patch({
                      viewport: {
                        ...view.viewport,
                        x: view.viewport.x + delta[0],
                        y: view.viewport.y + delta[1],
                      },
                    });
                  }
                }}
                aria-label={t('graph.figure')}
                data-zoom={view.viewport.zoom}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  if (range.begin(e)) return;
                  const p = point(e.clientX, e.clientY);
                  const element =
                    e.target instanceof Element ? e.target.closest('[data-id]') : null;
                  const id =
                    element?.closest('#graph-view-nodes') === null
                      ? undefined
                      : (element?.getAttribute('data-id') ?? undefined);
                  const position = id === undefined ? undefined : positions.get(toNodeId(id));
                  // 【なぜ】エッジも押して選べる。射影したエッジの根拠を見るため（FR-GR-04）。
                  const edgeKey =
                    id === undefined && element?.closest('#graph-view-edges') != null
                      ? (element.getAttribute('data-id') ?? undefined)
                      : undefined;
                  drag.current = {
                    ...(id === undefined ? {} : { id: toNodeId(id) }),
                    ...(edgeKey === undefined ? {} : { edgeKey }),
                    x: p.x,
                    y: p.y,
                    px: position?.x ?? view.viewport.x,
                    py: position?.y ?? view.viewport.y,
                    moved: false,
                  };
                  svg.current?.setPointerCapture(e.pointerId);
                  if (id !== undefined) interruptLayout();
                }}
                onPointerMove={(e) => {
                  if (range.active()) {
                    range.move(e);
                    return;
                  }
                  const start = drag.current;
                  if (start === null) return;
                  const p = point(e.clientX, e.clientY);
                  const dx = p.x - start.x;
                  const dy = p.y - start.y;
                  start.moved ||= Math.abs(dx) + Math.abs(dy) > 2;
                  if (!start.moved) return;
                  if (start.id === undefined)
                    patch({
                      viewport: {
                        ...(graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).viewport,
                        x: start.px + dx,
                        y: start.py + dy,
                      },
                    });
                  else
                    patch({
                      positions: (
                        graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW
                      ).positions.map((position) =>
                        position.id === start.id
                          ? {
                              ...position,
                              x:
                                start.px +
                                dx /
                                  (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).viewport
                                    .zoom,
                              y:
                                start.py +
                                dy /
                                  (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).viewport
                                    .zoom,
                              fixed: true,
                            }
                          : position,
                      ),
                    });
                }}
                onPointerUp={(e) => {
                  if (range.active()) {
                    range.end(e);
                    setCardOpen(true);
                    return;
                  }
                  const start = drag.current;
                  drag.current = null;
                  if (start !== null && !start.moved) {
                    if (start.edgeKey !== undefined && graph.hasEdge(start.edgeKey)) {
                      // 選ぶのは元のエッジ ID。表の選択と同じ ID で持つ（D-40）。
                      selectionStore
                        .getState()
                        .select({ edges: graph.getEdgeAttribute(start.edgeKey, 'edgeIds') });
                      setCardOpen(true);
                    } else choose(start.id ?? '');
                  }
                  if (svg.current?.hasPointerCapture(e.pointerId))
                    svg.current.releasePointerCapture(e.pointerId);
                  resumeLayout();
                }}
                onLostPointerCapture={() => {
                  range.cancel();
                }}
                onPointerCancel={() => {
                  range.cancel();
                  drag.current = null;
                  resumeLayout();
                }}
              >
                <g
                  transform={`translate(${String(view.viewport.x - offset.x * stretch)} ${String(view.viewport.y - offset.y * stretch)}) scale(${String(stretch)})`}
                  dangerouslySetInnerHTML={{ __html: inner }}
                />
                {/* 【なぜ】矩形は常に置き、フックが属性を直接書き換える（ドラッグ中に再描画しない）。
                    色だけに頼らず破線で示し、操作の対象にはしない。 */}
                <rect
                  ref={rangeRect}
                  className="graph-range"
                  visibility="hidden"
                  data-testid="range-rect"
                />
              </svg>
            </div>
            <TimeFadeNote fade={timeFade} />
            {(selectedId !== undefined || selectedEdges.size > 0) && (
              <section
                className="graph-card"
                aria-label={t('graph.details')}
                onKeyDown={(e) => {
                  // 【なぜ】キーボードだけでも選択を解除できるよう、カードの中でも Esc で解除する。
                  if (e.key === 'Escape') {
                    selectionStore.getState().clear();
                    // 【なぜ】カードが消えるとフォーカスが失われる。キーボードの利用者が続けて操作できるよう図へ戻す。
                    svg.current?.focus();
                  }
                }}
              >
                <div className="graph-card-head">
                  <h3 ref={cardTitle} tabIndex={-1} title={cardHeading}>
                    <bdi>{cardHeading}</bdi>
                  </h3>
                  <button
                    type="button"
                    className="icon-button"
                    aria-expanded={cardOpen}
                    aria-controls="graph-card-body"
                    aria-label={t(cardOpen ? 'graph.selection.collapse' : 'graph.selection.expand')}
                    title={t(cardOpen ? 'graph.selection.collapse' : 'graph.selection.expand')}
                    onClick={() => {
                      setCardOpen((v) => !v);
                    }}
                  >
                    <Icon name={cardOpen ? 'chevronUp' : 'chevronDown'} />
                  </button>
                </div>
                <div id="graph-card-body" className="graph-card-body" hidden={!cardOpen}>
                  {selectedId !== undefined && selected.size <= 1 && (
                    <p>
                      <bdi>{selectedId}</bdi>
                    </p>
                  )}
                  {/* 【なぜ】複数選択では、絞り込みのボタンをカードの先頭に置く（単一ノードの操作は出さないため）。 */}
                  {selected.size > 1 && rangeSummary}
                  {selectedEdgeKeys.length > 0 && (
                    <SelectedEdges graph={graph} edgeKeys={selectedEdgeKeys} />
                  )}
                  {hiddenEdges && (
                    <>
                      <p className="graph-card-hidden">{t('evidence.edgeHidden')}</p>
                      <button
                        type="button"
                        onClick={() => {
                          // ノードの選択は残し、表示されていないエッジの選択だけを解除する。
                          selectionStore.getState().select({ nodes: selected });
                        }}
                      >
                        {t('evidence.clearEdges')}
                      </button>
                    </>
                  )}
                  {selectedId === undefined || selected.size > 1 ? null : selectedVisible ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          // 【なぜ】計算開始時の固定状態を持つWorker結果で、直後の固定操作を上書きしない。
                          // ドラッグと同じく世代を進め、待機中の結果も失敗も無効にする。
                          interruptLayout();
                          patch({
                            positions: (
                              graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW
                            ).positions.map((p) =>
                              p.id === selectedId ? { ...p, fixed: !p.fixed } : p,
                            ),
                          });
                          resumeLayout();
                        }}
                      >
                        {positions.get(selectedId)?.fixed ? t('graph.unpin') : t('graph.pin')}
                      </button>
                      {network?.projection.kind === 'applied' && (
                        <NeighborEvidence graph={graph} nodeId={selectedId} />
                      )}
                      <h4>{t('graph.in')}</h4>
                      <ul>
                        {graph.inNeighbors(selectedId).map((id) => (
                          <li key={id}>
                            <bdi>{graph.getNodeAttribute(id, 'label')}</bdi>
                          </li>
                        ))}
                      </ul>
                      <h4>{t('graph.out')}</h4>
                      <ul>
                        {graph.outNeighbors(selectedId).map((id) => (
                          <li key={id}>
                            <bdi>{graph.getNodeAttribute(id, 'label')}</bdi>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    // 【なぜ】フィルタで見えなくなっても選択は消さない（R-19）。理由を文で示し、色だけに頼らない。
                    <p className="graph-card-hidden">{t('graph.selection.hidden')}</p>
                  )}
                  {/* 【なぜ】1 件の選択では、主な操作（固定）を先に置き、絞り込みはカードの末尾に置く（キーボードの順を変えない）。 */}
                  {selected.size === 1 && rangeSummary}
                </div>
              </section>
            )}
          </div>
          <div role="status">
            {busy ? (
              <StatusMessage
                announce={false}
                state={{ kind: 'loading', message: t('graph.computing') }}
              />
            ) : (
              t('graph.ready', { count: String(scene.nodes.length) })
            )}
          </div>
          <div role="alert">
            {error && (
              <StatusMessage
                announce={false}
                state={{ kind: 'error', message: t('graph.failed') }}
              />
            )}
          </div>
        </div>
        <aside
          id="graph-settings-drawer"
          className="graph-drawer"
          ref={drawer}
          tabIndex={-1}
          hidden={!drawerOpen}
          aria-label={t('graph.drawer')}
          onKeyDown={(e) => {
            // 【なぜ】Esc で閉じ、開閉ボタンへフォーカスを戻す。
            if (e.key === 'Escape' && drawerOpen) {
              e.stopPropagation();
              setDrawerOpen(false);
              drawerToggle.current?.focus();
            }
          }}
        >
          <h3 className="graph-drawer-title">{t('graph.drawer')}</h3>
          <p className="rl-section-note graph-drawer-note">{t('graph.settingsScope')}</p>
          <CollapsibleSection title={t('graph.section.layout')} defaultOpen>
            <Field label={t('graph.layout')}>
              <select
                aria-label={t('graph.layout')}
                value={view.layout}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  if (
                    value === 'forceatlas2' ||
                    value === 'circular' ||
                    value === 'fixed' ||
                    value === 'layered' ||
                    value === 'geo'
                  ) {
                    patch({ layout: value });
                    refitAfterLayout.current = true;
                    setIteration((v) => v + 1);
                  }
                }}
              >
                <option value="forceatlas2">ForceAtlas2</option>
                <option value="circular">{t('graph.circular')}</option>
                <option value="fixed">{t('graph.fixed')}</option>
                <option value="layered">{t('graph.layered')}</option>
                <option value="geo">{t('graph.geo')}</option>
              </select>
            </Field>
            <LayoutMethodControls
              dataset={dataset}
              graph={graph}
              view={view}
              onChange={(change) => {
                // 【なぜ】列の順・属性の変更は配置の明示的な操作なので、ここで計算を始める。
                patch(change);
                refitAfterLayout.current = true;
                setIteration((v) => v + 1);
              }}
            />
            <Field label={t('graph.seed')}>
              <input
                type="number"
                min="0"
                max="4294967295"
                value={view.seed}
                onChange={(e) => {
                  const value = e.currentTarget.valueAsNumber;
                  if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
                    patch({ seed: value, positions: view.positions.filter((p) => p.fixed) });
                    setIteration((v) => v + 1);
                  }
                }}
              />
            </Field>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                refitAfterLayout.current = true;
                setIteration((v) => v + 1);
              }}
            >
              {t('graph.relayout')}
            </button>
          </CollapsibleSection>
          <CollapsibleSection title={t('graph.section.appearance')}>
            <EncodingControls
              dataset={dataset}
              settings={view.encoding}
              onChange={(value) => {
                patch({ encoding: value });
              }}
            />
          </CollapsibleSection>
          <CollapsibleSection title={t('graph.section.labels')} defaultOpen>
            <Field label={t('graph.labels')}>
              <select
                aria-label={t('graph.labels')}
                value={view.labels}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  if (value === 'all' || value === 'selected' || value === 'large')
                    patch({ labels: value });
                }}
              >
                <option value="all">{t('graph.all')}</option>
                <option value="selected">{t('graph.selected')}</option>
                <option value="large">{t('graph.large')}</option>
              </select>
            </Field>
            <Field label={t('graph.direction')}>
              <select
                aria-label={t('graph.direction')}
                value={view.direction}
                onChange={(e) => {
                  const value = e.currentTarget.value;
                  if (value === 'arrow' || value === 'taper' || value === 'gradient')
                    patch({ direction: value });
                }}
              >
                <option value="arrow">{t('graph.arrow')}</option>
                <option value="taper">{t('graph.taper')}</option>
                <option value="gradient">{t('graph.gradient')}</option>
              </select>
            </Field>
          </CollapsibleSection>
          <CollapsibleSection title={t('graph.section.missing')} note={t('missing.display.note')}>
            <MissingDisplayControls
              dataset={dataset}
              settings={view.missingDisplay}
              onChange={(value) => {
                patch({ missingDisplay: value });
              }}
            />
          </CollapsibleSection>
        </aside>
      </div>
    </section>
  );
}
