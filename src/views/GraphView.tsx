import { EncodingControls } from './EncodingControls';
import { graphEncoding } from './graphEncoding';
import { createGraphMeasure } from './graphMeasure';
/** グラフ表示と操作。元データとフィルタは既存ストアを参照する（T1-19）。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { toSnapshot } from '../core/graph';
import { DEFAULT_GRAPH_VIEW } from '../core/project';
import type { GraphViewSettings } from '../core/project';
import type { NodeId } from '../core/model';
import { toNodeId } from '../core/model';
import { matchIncludes, LOOSE_MATCH } from '../core/text';
import { buildScene, renderSvg } from '../render';
import { createSvgExport, downloadSvg } from '../io/export';
import { setSvgExporter } from './svgExport';
import { Icon, IconButton } from './ui/icons';
import { InfoTip } from './ui/InfoTip';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { Field } from './ui/Field';
import { GraphSearch } from './GraphSearch';
import { getNumberFormat } from './intl';
import { StatusMessage } from './ui/StatusMessage';
import { Toolbar, ToolbarGroup } from './ui/Toolbar';
import { Chip } from './ui/Chip';
import {
  graphViewStore,
  layoutController,
  selectedGraphEdges,
  selectionStore,
  uiStore,
} from '../state';
import { useData, useSelection, useT, useUi } from './hooks';
import { useNetwork } from './useNetwork';
import { buildPanelStore } from './buildPanelStore';
import { ProjectionIssues } from './ProjectionNotice';
import { NeighborEvidence, SelectedEdges } from './ProjectionEvidence';
import './graph.css';

/** 図の枠の既定の大きさ（CSS ピクセル）。枠の大きさを測るまでと、測れない環境で使う。 */
const DEFAULT_CANVAS = { width: 800, height: 500 } as const;
/** 全体を収めるときに、枠の上下左右に残す余白（CSS ピクセル）。 */
const FIT_MARGIN = 20;

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
  const zoom = Math.max(0.1, Math.min(10, current.viewport.zoom * factor));
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
 * 図の全体を、余白を残して枠に収める拡大率を求める。
 *
 * @param width - 図の幅
 * @param height - 図の高さ
 * @param size - 枠の大きさ
 * @returns 0.1〜10 に収めた拡大率
 */
function fitZoom(
  width: number,
  height: number,
  size: { readonly width: number; readonly height: number },
): number {
  const room = (length: number) => Math.max(1, length - FIT_MARGIN * 2);
  return Math.max(0.1, Math.min(10, room(size.width) / width, room(size.height) / height));
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
  const svg = useRef<SVGSVGElement>(null);
  const frame = useRef<HTMLDivElement>(null);
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
  const encoding = useMemo(
    () => (graph === null || dataset === null ? {} : graphEncoding(dataset, graph, view.encoding)),
    [graph, dataset, view.encoding],
  );
  const visibleSelected = useMemo(
    () => new Set([...selected].filter((id) => graph?.hasNode(id))),
    [selected, graph],
  );
  const positions = useMemo(() => new Map(view.positions.map((p) => [p.id, p])), [view.positions]);
  const measureText = useMemo(() => createGraphMeasure(), []);
  const scene = useMemo(
    () =>
      graph === null
        ? null
        : buildScene(graph, positions, encoding, {
            labels: view.labels,
            largeLabelCount: view.largeLabelCount,
            selected: visibleSelected,
            includeSelection: true,
            directedStyle: view.direction,
            measureText,
          }),
    [
      graph,
      positions,
      encoding,
      view.labels,
      view.largeLabelCount,
      visibleSelected,
      view.direction,
      measureText,
    ],
  );
  const offset =
    scene?.nodes[0] === undefined
      ? { x: 0, y: 0 }
      : {
          x: scene.nodes[0].x - (positions.get(scene.nodes[0].id)?.x ?? 0),
          y: scene.nodes[0].y - (positions.get(scene.nodes[0].id)?.y ?? 0),
        };
  const fit = () => {
    if (scene === null) return;
    const zoom = fitZoom(scene.width, scene.height, canvas);
    patch({
      viewport: {
        zoom,
        x: canvas.width / 2 - (scene.width / 2 - offset.x) * zoom,
        y: canvas.height / 2 - (scene.height / 2 - offset.y) * zoom,
      },
    });
  };
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
    if (allSaved && iteration === handledIteration.current) {
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
      const outcome = await layoutController.run({
        job: {
          snapshot: toSnapshot(graph),
          options: { kind, seed: current.seed, positions: current.positions },
        },
        rounds: kind === 'forceatlas2' ? 10 : 0,
        onProgress: (fraction) => {
          uiStore.getState().updateTask(task, fraction);
        },
        apply: (positions) => {
          const merged = new Map(current.positions.map((p) => [p.id, p]));
          for (const p of positions) merged.set(p.id, p);
          const nextPositions = [...merged.values()];
          // 保存された全座標は再開時にそのまま使う。初回だけ全体を収める。
          const raw = new Map(nextPositions.map((p) => [p.id, p]));
          const built = buildScene(graph, raw, encoding, { measureText });
          const first = built.nodes[0];
          const delta =
            first === undefined
              ? { x: 0, y: 0 }
              : {
                  x: first.x - (raw.get(first.id)?.x ?? 0),
                  y: first.y - (raw.get(first.id)?.y ?? 0),
                };
          const size = canvasRef.current;
          const zoom = fitZoom(built.width, built.height, size);
          patch({
            positions: nextPositions,
            ...(current.positions.length === 0
              ? {
                  viewport: {
                    zoom,
                    x: size.width / 2 - (built.width / 2 - delta.x) * zoom,
                    y: size.height / 2 - (built.height / 2 - delta.y) * zoom,
                  },
                }
              : {}),
          });
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
  }, [graph, view.layout, view.seed, iteration, measureText, encoding]);
  const hasFigure = dataset !== null && graph !== null && scene !== null;
  // 【なぜ】「保存」のダイアログから図を保存できるよう、今の図を保存する関数を登録する（svgExport.ts）。
  const canExport = hasFigure && scene.nodes.length > 0;
  useEffect(() => {
    if (!canExport) {
      setSvgExporter(null);
      return;
    }
    setSvgExporter(() => {
      downloadSvg(
        createSvgExport(graph, positions, encoding, {
          labels: view.labels,
          largeLabelCount: view.largeLabelCount,
          // 【なぜ】選択ラベルの候補は渡し、選択の輪郭だけを保存から除く。
          selected: visibleSelected,
          includeSelection: false,
          directedStyle: view.direction,
          measureText,
          title: dataset.meta.title,
        }),
      );
    });
    return () => {
      setSvgExporter(null);
    };
  }, [
    canExport,
    dataset,
    graph,
    positions,
    encoding,
    view.labels,
    view.largeLabelCount,
    view.direction,
    visibleSelected,
    measureText,
  ]);
  useEffect(() => {
    const element = svg.current;
    if (!hasFigure || element === null) return;
    // 【なぜ】React の onWheel は passive で登録されるので、preventDefault が効かず、拡大・縮小と同時に
    // ページもスクロールしてしまう。DOM に直接 passive: false で登録して、ページのスクロールを止める。
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
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
  }, [hasFigure]);
  useEffect(() => {
    const element = frame.current;
    if (!hasFigure || element === null || typeof ResizeObserver === 'undefined') return;
    // 【なぜ】枠の大きさ（利用者のつまみ操作、窓の幅の変化）を測り、viewBox と全体表示に使う。
    const observer = new ResizeObserver(() => {
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
  if (dataset === null || graph === null || scene === null) return null;
  const matches = graph
    .nodes()
    .filter(
      (id) =>
        query !== '' &&
        (matchIncludes(graph.getNodeAttribute(id, 'label'), query, LOOSE_MATCH) ||
          matchIncludes(id, query, LOOSE_MATCH)),
    );
  const matchSet = new Set(matches);
  // 表示中の選択を優先し、無ければ（絞り込みで見えなくなった）選択の先頭をカードに出す。
  const selectedId = [...visibleSelected][0] ?? [...selected][0];
  const display = {
    ...scene,
    nodes: scene.nodes.map((node) => (matchSet.has(node.id) ? { ...node, fill: '#ffcc00' } : node)),
    edges: scene.edges.map((edge) => ({
      ...edge,
      // 選んだエッジは、色に加えて太さでも示す（色だけで伝えない）。
      ...(selectedEdgeSet.has(edge.id) ? { width: Math.max(edge.width * 2, 3) } : {}),
      color: selectedEdgeSet.has(edge.id)
        ? '#7b3294'
        : visibleSelected.has(edge.source) && visibleSelected.has(edge.target)
          ? '#7b3294'
          : !edge.directed && (visibleSelected.has(edge.source) || visibleSelected.has(edge.target))
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
  const inner = markup.slice(markup.indexOf('>') + 1, markup.lastIndexOf('</svg>'));
  const point = (clientX: number, clientY: number) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix === null || matrix === undefined
      ? { x: clientX, y: clientY }
      : new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  };
  const zoomBy = (factor: number) => {
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
  const cardHeading =
    selectedId !== undefined
      ? nodeLabel(selectedId)
      : hiddenEdges
        ? t('evidence.selectedEdges')
        : t('evidence.edgeCount', { count: nf.format(selectedEdgeKeys.length) });
  const selectedVisible = selectedId !== undefined && graph.hasNode(selectedId);
  return (
    <section className="graph-view" aria-labelledby="graph-title">
      <h2 id="graph-title">{t('graph.title')}</h2>
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
            onClick={() => {
              zoomBy(1.25);
            }}
          />
          <IconButton
            icon="zoomOut"
            label={t('graph.zoomOut')}
            onClick={() => {
              zoomBy(0.8);
            }}
          />
          <IconButton icon="fit" label={t('graph.fit')} onClick={fit} />
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
            <div className="graph-canvas" ref={frame}>
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
                onPointerCancel={() => {
                  drag.current = null;
                  resumeLayout();
                }}
              >
                <g
                  transform={`translate(${String(view.viewport.x - offset.x * view.viewport.zoom)} ${String(view.viewport.y - offset.y * view.viewport.zoom)}) scale(${String(view.viewport.zoom)})`}
                  dangerouslySetInnerHTML={{ __html: inner }}
                />
              </svg>
            </div>
            {(selectedId !== undefined || selectedEdges.size > 0) && (
              <section className="graph-card" aria-label={t('graph.details')}>
                <div className="graph-card-head">
                  <h3 ref={cardTitle} tabIndex={-1} title={cardHeading}>
                    <bdi>{cardHeading}</bdi>
                    {selected.size > 1 && (
                      <span className="graph-card-more">
                        {' '}
                        {t('graph.selection.more', { count: nf.format(selected.size - 1) })}
                      </span>
                    )}
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
                  {selectedId !== undefined && (
                    <p>
                      <bdi>{selectedId}</bdi>
                    </p>
                  )}
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
                  {selectedId === undefined ? null : selectedVisible ? (
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
                  if (value === 'forceatlas2' || value === 'circular' || value === 'fixed') {
                    patch({ layout: value });
                    setIteration((v) => v + 1);
                  }
                }}
              >
                <option value="forceatlas2">ForceAtlas2</option>
                <option value="circular">{t('graph.circular')}</option>
                <option value="fixed">{t('graph.fixed')}</option>
              </select>
            </Field>
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
        </aside>
      </div>
    </section>
  );
}
