import { EncodingControls } from './EncodingControls';
import { graphEncoding } from './graphEncoding';
import { createGraphMeasure } from './graphMeasure';
/** グラフ表示と操作。元データとフィルタは既存ストアを参照する（T1-19）。 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { applyFilters } from '../core/filter';
import { buildGraph, toSnapshot } from '../core/graph';
import { DEFAULT_GRAPH_VIEW } from '../core/project';
import type { GraphViewSettings } from '../core/project';
import type { NodeId } from '../core/model';
import { toNodeId } from '../core/model';
import { matchIncludes, LOOSE_MATCH } from '../core/text';
import { buildScene, renderSvg } from '../render';
import { createSvgExport, downloadSvg } from '../io/export';
import { setSvgExporter } from './svgExport';
import { IconButton } from './ui/icons';
import { InfoTip } from './ui/InfoTip';
import { graphViewStore, layoutController, uiStore } from '../state';
import { useData, useFilter, useT } from './hooks';
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
  const filters = useFilter((s) => s.history.present);
  const stored = useStore(graphViewStore, (s) => s.view);
  const view = stored ?? DEFAULT_GRAPH_VIEW;
  const t = useT();
  const [selected, setSelected] = useState<ReadonlySet<NodeId>>(new Set());
  const [query, setQuery] = useState('');
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
    x: number;
    y: number;
    px: number;
    py: number;
    moved: boolean;
  } | null>(null);
  const graph = useMemo(
    () =>
      dataset === null
        ? null
        : buildGraph(dataset, applyFilters(dataset, filters), view.graphOptions),
    [dataset, filters, view.graphOptions],
  );
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
    setSelected(new Set());
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
  const selectedId = [...visibleSelected][0];
  const display = {
    ...scene,
    nodes: scene.nodes.map((node) =>
      matches.includes(node.id) ? { ...node, fill: '#ffcc00' } : node,
    ),
    edges: scene.edges.map((edge) => ({
      ...edge,
      color:
        visibleSelected.has(edge.source) && visibleSelected.has(edge.target)
          ? '#7b3294'
          : !edge.directed && (visibleSelected.has(edge.source) || visibleSelected.has(edge.target))
            ? '#7b3294'
            : visibleSelected.has(edge.target)
              ? '#d55e00'
              : visibleSelected.has(edge.source)
                ? '#0072b2'
                : edge.color,
      opacity:
        visibleSelected.size === 0 ||
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
    setSelected(id === '' ? new Set() : new Set([toNodeId(id)]));
  };
  return (
    <section className="graph-view" aria-labelledby="graph-title">
      <h2 id="graph-title">{t('graph.title')}</h2>
      {/* 【なぜ】図を広く使えるよう、図の上の設定と操作をまとめて折りたためるようにする。既定は開く。 */}
      <details className="graph-settings" open>
        <summary>{t('graph.settings')}</summary>
        <div className="graph-controls">
          <label>
            {t('graph.layout')}{' '}
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
          </label>
          <label>
            {t('graph.seed')}{' '}
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
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setIteration((v) => v + 1);
            }}
          >
            {t('graph.relayout')}
          </button>
          <label>
            {t('graph.labels')}{' '}
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
          </label>
          <label>
            {t('graph.direction')}{' '}
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
          </label>
          <label>
            {t('graph.weight')}{' '}
            <select
              value={
                typeof view.graphOptions.weight === 'string'
                  ? view.graphOptions.weight
                  : 'attr:' + view.graphOptions.weight.attr
              }
              onChange={(e) => {
                const value = e.currentTarget.value;
                patch({
                  graphOptions: {
                    ...view.graphOptions,
                    weight:
                      value === 'count' || value === 'weight' ? value : { attr: value.slice(5) },
                  },
                });
              }}
            >
              <option value="weight">{t('graph.weightValue')}</option>
              <option value="count">{t('graph.count')}</option>
              {dataset.schema
                .filter((a) => a.appliesTo === 'edge' && a.valueType === 'number')
                .map((a) => (
                  <option key={a.key} value={'attr:' + a.key}>
                    {a.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={view.graphOptions.selfLoops}
              onChange={(e) => {
                patch({
                  graphOptions: { ...view.graphOptions, selfLoops: e.currentTarget.checked },
                });
              }}
            />
            {t('graph.selfLoops')}
          </label>
        </div>
        <EncodingControls
          dataset={dataset}
          settings={view.encoding}
          onChange={(value) => {
            patch({ encoding: value });
          }}
        />
        <div className="graph-controls">
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
        </div>
        <label>
          {t('graph.search')}{' '}
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
            }}
          />
        </label>
        {query !== '' && (
          <ul className="graph-search-results">
            {matches.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
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
                  }}
                >
                  <bdi>{graph.getNodeAttribute(id, 'label')}</bdi> <bdi>{id}</bdi>
                </button>
              </li>
            ))}
          </ul>
        )}
        <label>
          {t('graph.selectNode')}{' '}
          <select
            aria-label={t('graph.selectNode')}
            value={selectedId ?? ''}
            onChange={(e) => {
              choose(e.currentTarget.value);
            }}
          >
            <option value="">{t('graph.none')}</option>
            {graph.nodes().map((id) => (
              <option key={id} value={id} dir="auto">
                {graph.getNodeAttribute(id, 'label')} ({id})
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('graph.highlight')}{' '}
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
        </label>{' '}
        <InfoTip topic={t('graph.highlight')}>
          <p>{t('graph.highlightLegend')}</p>
        </InfoTip>
      </details>
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
            const element = e.target instanceof Element ? e.target.closest('[data-id]') : null;
            const id =
              element?.closest('#graph-view-nodes') === null
                ? undefined
                : (element?.getAttribute('data-id') ?? undefined);
            const position = id === undefined ? undefined : positions.get(toNodeId(id));
            drag.current = {
              ...(id === undefined ? {} : { id: toNodeId(id) }),
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
                positions: (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).positions.map(
                  (position) =>
                    position.id === start.id
                      ? {
                          ...position,
                          x:
                            start.px +
                            dx /
                              (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).viewport.zoom,
                          y:
                            start.py +
                            dy /
                              (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).viewport.zoom,
                          fixed: true,
                        }
                      : position,
                ),
              });
          }}
          onPointerUp={(e) => {
            const start = drag.current;
            drag.current = null;
            if (start !== null && !start.moved) choose(start.id ?? '');
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
      <div role="status">
        {busy ? t('graph.computing') : t('graph.ready', { count: String(scene.nodes.length) })}
      </div>
      <div role="alert">{error ? t('graph.failed') : ''}</div>
      {selectedId !== undefined && graph.hasNode(selectedId) && (
        <section aria-label={t('graph.details')}>
          <h3>
            <bdi>{graph.getNodeAttribute(selectedId, 'label')}</bdi>
          </h3>
          <p>
            <bdi>{selectedId}</bdi>
          </p>
          <button
            type="button"
            onClick={() => {
              // 【なぜ】計算開始時の固定状態を持つWorker結果で、直後の固定操作を上書きしない。
              // ドラッグと同じく世代を進め、待機中の結果も失敗も無効にする。
              interruptLayout();
              patch({
                positions: (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).positions.map(
                  (p) => (p.id === selectedId ? { ...p, fixed: !p.fixed } : p),
                ),
              });
              resumeLayout();
            }}
          >
            {positions.get(selectedId)?.fixed ? t('graph.unpin') : t('graph.pin')}
          </button>
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
        </section>
      )}
    </section>
  );
}
