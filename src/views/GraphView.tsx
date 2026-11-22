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
import { graphViewStore, layoutController, uiStore } from '../state';
import { useData, useFilter, useT } from './hooks';
import './graph.css';

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
  const handledIteration = useRef(0);
  const svg = useRef<SVGSVGElement>(null);
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
    const zoom = Math.max(0.1, Math.min(10, 760 / scene.width, 460 / scene.height));
    patch({
      viewport: {
        zoom,
        x: 400 - (scene.width / 2 - offset.x) * zoom,
        y: 250 - (scene.height / 2 - offset.y) * zoom,
      },
    });
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
          const zoom = Math.max(0.1, Math.min(10, 760 / built.width, 460 / built.height));
          patch({
            positions: nextPositions,
            ...(current.positions.length === 0
              ? {
                  viewport: {
                    zoom,
                    x: 400 - (built.width / 2 - delta.x) * zoom,
                    y: 250 - (built.height / 2 - delta.y) * zoom,
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
  const zoomBy = (factor: number, x = 400, y = 250) => {
    const current = (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).viewport;
    const zoom = Math.max(0.1, Math.min(10, current.zoom * factor));
    patch({
      viewport: {
        zoom,
        x: x - ((x - current.x) * zoom) / current.zoom,
        y: y - ((y - current.y) * zoom) / current.zoom,
      },
    });
  };
  const choose = (id: string) => {
    setSelected(id === '' ? new Set() : new Set([toNodeId(id)]));
  };
  return (
    <section className="graph-view" aria-labelledby="graph-title">
      <h2 id="graph-title">{t('graph.title')}</h2>
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
              patch({ graphOptions: { ...view.graphOptions, selfLoops: e.currentTarget.checked } });
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
        <button
          type="button"
          onClick={() => {
            zoomBy(1.25);
          }}
        >
          {t('graph.zoomIn')}
        </button>
        <button
          type="button"
          onClick={() => {
            zoomBy(0.8);
          }}
        >
          {t('graph.zoomOut')}
        </button>
        <button type="button" onClick={fit}>
          {t('graph.fit')}
        </button>
        <button
          type="button"
          disabled={scene.nodes.length === 0}
          onClick={() => {
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
          }}
        >
          {t('graph.export')}
        </button>
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
                        x: 400 - p.x * view.viewport.zoom,
                        y: 250 - p.y * view.viewport.zoom,
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
      <p>{t('graph.highlightLegend')}</p>
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
      </label>
      <div className="graph-canvas">
        <svg
          ref={svg}
          viewBox="0 0 800 500"
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
          onWheel={(e) => {
            e.preventDefault();
            const p = point(e.clientX, e.clientY);
            zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y);
          }}
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
            if (id !== undefined) {
              layoutController.cancel();
              setBusy(false);
            }
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
          }}
          onPointerCancel={() => {
            drag.current = null;
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
              layoutController.cancel();
              setBusy(false);
              patch({
                positions: (graphViewStore.getState().view ?? DEFAULT_GRAPH_VIEW).positions.map(
                  (p) => (p.id === selectedId ? { ...p, fixed: !p.fixed } : p),
                ),
              });
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
