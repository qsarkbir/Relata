import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
// 【TS】`import type` は型だけを取り込み、実行時には消える（JavaScript に何も残らない）。地図の部品の本体
//       （maplibre-gl と deck.gl を含む大きな塊）は、下の `import('../map')` で地図を初めて開くときに読む。
//       型だけの import は、この「遅延して読む」性質を損なわない。
import type { MapEngine } from '../map';
import { sameGeoSource } from '../core/geo';
import { resolveGeoSource } from '../core/project';
import { toNodeId } from '../core/model';
import type { NodeId } from '../core/model';
import { graphViewStore, mapViewStore, placeNodes, selectionStore } from '../state';
import { useData, useMapView, useSelection, useT, useUi } from './hooks';
import { getNumberFormat } from './intl';
import { MainViewTabs } from './MainViewTabs';
import { MapSettings } from './MapSettings';
import { MapUnplaced } from './MapUnplaced';
import { useNetwork } from './useNetwork';
import { Chip } from './ui/Chip';
import { Icon, IconButton } from './ui/icons';
import { StatusMessage } from './ui/StatusMessage';
import { Toolbar, ToolbarGroup } from './ui/Toolbar';
import { tRich } from './richText';
import './graph.css';
import './map.css';

/** 地図の部品の状態。`ready` になるまでは、地図の枠に「読み込み中」を重ねる。 */
type EngineStatus = 'loading' | 'ready' | 'webgl2-unavailable' | 'init-failed' | 'load-failed';

/** {@link MapView} の props。 */
interface Props {
  /** いま見えているか（「グラフ｜地図」の切り替えで隠れている間は false。戻ったときに大きさを合わせ直す）。 */
  readonly active: boolean;
}

/**
 * 地図の画面（薄い部品。FR-MP-01、FR-MP-05、FR-MP-06。D-48）。
 *
 * 地図そのもの（MapLibre と deck.gl）は `src/map/` にあり、**この部品が最初に描かれたときに**動的 import で
 * 読み込む（それまで、地図の部品もタイルも簡易背景のデータも取りに行かない。NFR-02、D-50）。
 * この部品はストアを読み、値と更新の関数を地図の部品に渡すだけで、計算はしない（座標の取り出しは
 * core、仕分けは state の `placeNodes`）。ノードとエッジの描画は T3-04。
 *
 * 【なぜ】時間の再生の時計はここに置かない（アプリに 1 つ。D-17）。地図の表示範囲は、利用者の操作が
 * 止まったときだけストアに保存する（動いている間の毎フレームを保存しない）。
 *
 * @param props - 見えているか
 * @returns 地図の画面
 */
export function MapView({ active }: Props) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const dataset = useData((s) => s.dataset);
  const map = useMapView((s) => s.map);
  const geoSource = useMapView((s) => s.geoSource);
  const graphView = useStore(graphViewStore, (s) => s.view);
  const selected = useSelection((s) => s.nodes);
  const network = useNetwork();
  const graph = network?.graph ?? null;

  const frame = useRef<HTMLDivElement>(null);
  const engineHost = useRef<HTMLDivElement>(null);
  const engineRef = useRef<MapEngine | null>(null);
  // 【TS】`typeof import('../map')` は「モジュール `../map` 全体（export の集まり）の型」。値としては読み込まず、
  //       型だけを使う。読み込み後のモジュールを入れておく入れ物の型に使う。
  const mapModule = useRef<typeof import('../map') | null>(null);
  const [status, setStatus] = useState<EngineStatus>('loading');
  const [engineReady, setEngineReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawer = useRef<HTMLElement>(null);
  const drawerToggle = useRef<HTMLButtonElement>(null);

  // 座標の出どころは、地図とグラフの地理座標の配置で共通（D-46）。
  // 【なぜ】グラフの表示設定（`graphView`）は、グラフを動かすたびに作り直される。読み替えの結果が同じなら
  //   前の値を使い続け、仕分けの計算し直しや「データに合わせる」の再実行を避ける。
  const resolved = resolveGeoSource(geoSource, graphView ?? undefined);
  const [source, setSource] = useState(resolved);
  if (!sameGeoSource(source, resolved)) setSource(resolved);
  // 表示中のノードの仕分け。絞り込み後の集合から毎回数え直す。
  const placement = useMemo(
    () => (dataset === null || graph === null ? null : placeNodes(dataset, graph, source)),
    [dataset, graph, source],
  );

  // 最新の値を、地図の部品の作成（1 回だけ）から読むための参照。
  const bbox = placement?.bbox ?? null;
  // 【なぜ】表示範囲が未保存（null）で座標があるときは、地図を作る時点で、データに合わせた最初の表示範囲を渡す。
  //   世界全体で作ってから合わせると、見ないズームのタイルを先に取りに行く（OSM の利用規約は無駄な取得を嫌う。D-51 補足）。
  //   どのデータ・出どころに合わせたかは `fitted` に覚える（下の「合わせる」効果が二重に動かさないため）。
  const fitted = useRef<{ dataset: unknown; source: unknown } | null>(null);
  const latest = useRef({ map, t, bbox, dataset, source });
  useEffect(() => {
    latest.current = { map, t, bbox, dataset, source };
  });

  // ---- 地図の部品を読み込み、作る。外れるときに壊す（StrictMode の二重実行でも 1 つだけ残る）。
  useEffect(() => {
    const host = engineHost.current;
    if (host === null) return;
    const lifetime = { cancelled: false };
    let engine: MapEngine | null = null;
    let stop: (() => void) | null = null;
    import('../map').then(
      (m) => {
        // 【なぜ】読み込みの間に外れたら、地図を作らない（作ると、すぐ壊すことになり、タイルも取りに行く）。
        if (lifetime.cancelled) return;
        mapModule.current = m;
        const { map: current, t: tr, bbox: dataBox, dataset: ds, source: src } = latest.current;
        // 保存はしない（null のまま「データに合わせる」を保つ）。`initialBounds` は viewport が null のときだけ効く。
        const fitsData = current.viewport === null && dataBox !== null;
        if (fitsData) fitted.current = { dataset: ds, source: src };
        const result = m.createMapEngine(host, {
          background: { background: current.background, customTiles: current.customTiles },
          viewport: current.viewport,
          ...(current.viewport === null && dataBox !== null ? { initialBounds: dataBox } : {}),
          texts: { reportMapErrorLabel: tr('map.reportError') },
        });
        if (!result.ok) {
          setStatus(result.reason);
          return;
        }
        engine = result.engine;
        engineRef.current = engine;
        // 利用者の操作が止まったときだけ保存する。動いている間（move）は保存しない。
        stop = engine.onViewportChange((v, phase) => {
          if (phase === 'end') mapViewStore.getState().setViewport(v);
        });
        setStatus('ready');
        setEngineReady(true);
      },
      () => {
        if (!lifetime.cancelled) setStatus('load-failed');
      },
    );
    return () => {
      lifetime.cancelled = true;
      stop?.();
      engine?.destroy();
      engineRef.current = null;
      mapModule.current = null;
      setEngineReady(false);
    };
  }, []);

  // ---- 背景（と文言）が変わったら、地図へ渡す。同じ設定なら地図の部品が何もしない。
  useEffect(() => {
    if (!engineReady) return;
    engineRef.current?.setBackground(
      { background: map.background, customTiles: map.customTiles },
      { reportMapErrorLabel: t('map.reportError') },
    );
  }, [engineReady, map.background, map.customTiles, t]);

  // ---- 保存された表示範囲が変わったら（ファイルを開いたなど）、地図へ渡す。同じ値なら何もしない。
  useEffect(() => {
    const engine = engineRef.current;
    const m = mapModule.current;
    if (!engineReady || engine === null || m === null || map.viewport === null) return;
    if (!m.sameViewport(engine.getViewport(), map.viewport)) engine.setViewport(map.viewport);
  }, [engineReady, map.viewport]);

  // ---- 隠れていた地図が見えたら、枠の大きさに合わせ直す。
  // 【なぜ】下の「データに合わせる」より先に置く。枠の大きさを合わせてから、表示範囲を決めるため。
  useEffect(() => {
    if (active && engineReady) engineRef.current?.resize();
  }, [active, engineReady]);

  // ---- 表示範囲が未保存（null）のあいだは、データの座標に合わせる。返った値は保存しない（null のまま）。
  // 【なぜ】フィルタの変更のたびに動かすと、見ている場所から飛ぶ。データか出どころが変わったときだけ合わせる。
  // 【なぜ】隠れている間（枠が 0×0）は合わせず、`fitted` も更新しない。0×0 で合わせると結果が壊れ、
  //   戻ったときに「合わせた」と誤って判断してしまう。見えたとき（`active`）に、改めて合わせる。
  useEffect(() => {
    const engine = engineRef.current;
    if (!active || !engineReady || engine === null || map.viewport !== null || bbox === null)
      return;
    if (fitted.current?.dataset === dataset && fitted.current.source === source) return;
    fitted.current = { dataset, source };
    engine.fitBounds(bbox);
  }, [active, engineReady, map.viewport, bbox, dataset, source]);

  const fitAll = useCallback(() => {
    const engine = engineRef.current;
    if (engine === null || bbox === null) return;
    // 「全体を表示」は利用者が選んだ範囲なので、返った値を保存する。
    mapViewStore.getState().setViewport(engine.fitBounds(bbox));
  }, [bbox]);

  // 一覧のノードを押すと選択に入り、選択中のノードを押すと選択から外れる（`aria-pressed` の切り替えと合わせる）。
  const pick = useCallback((id: NodeId) => {
    const sel = selectionStore.getState();
    if (sel.nodes.has(id)) sel.remove({ nodes: [id] });
    else sel.select({ nodes: [id] });
  }, []);

  const toggleDrawer = (): void => {
    const next = !drawerOpen;
    setDrawerOpen(next);
    // 【なぜ】開いたら引き出しへフォーカスを移す（グラフの設定と同じ。キーボードの利用者が地図を通り過ぎずに済む）。
    if (next) requestAnimationFrame(() => drawer.current?.focus());
  };

  if (dataset === null || graph === null || placement === null) return null;

  const hasSelection = selected.size > 0;
  const firstSelected = [...selected][0];
  const labelOf = (id: NodeId): string => dataset.nodes.find((n) => n.id === id)?.label ?? id;
  const removed = map.customTiles.removedParams ?? [];
  const keyNotice = map.background === 'custom' && removed.length > 0;
  const noCoordinates = graph.order > 0 && placement.placed.length === 0;
  const unavailableText =
    status === 'webgl2-unavailable'
      ? t('map.unavailable.webgl2')
      : status === 'init-failed'
        ? t('map.unavailable.initFailed')
        : status === 'load-failed'
          ? t('map.unavailable.loadFailed')
          : null;

  return (
    <section className="graph-view map-view" aria-labelledby="map-title">
      <h2 id="map-title" className="visually-hidden">
        {t('map.title')}
      </h2>
      <Toolbar label={t('map.toolbar')}>
        <MainViewTabs host="map" />
        {hasSelection && (
          <Chip
            title={
              selected.size === 1 && firstSelected !== undefined
                ? labelOf(firstSelected)
                : undefined
            }
            onRemove={{
              label: t('graph.selection.clear'),
              run: () => {
                selectionStore.getState().clear();
              },
            }}
          >
            {selected.size === 1 && firstSelected !== undefined ? (
              <bdi>{labelOf(toNodeId(firstSelected))}</bdi>
            ) : (
              t('graph.selection.count', { count: nf.format(selected.size) })
            )}
          </Chip>
        )}
        <ToolbarGroup>
          <IconButton
            icon="zoomIn"
            label={t('map.zoomIn')}
            disabled={status !== 'ready'}
            onClick={() => {
              engineRef.current?.zoomIn();
            }}
          />
          <IconButton
            icon="zoomOut"
            label={t('map.zoomOut')}
            disabled={status !== 'ready'}
            onClick={() => {
              engineRef.current?.zoomOut();
            }}
          />
          <IconButton
            icon="fit"
            label={t('map.fit')}
            disabled={status !== 'ready' || bbox === null}
            description={bbox === null ? t('map.fit.disabled') : undefined}
            onClick={fitAll}
          />
        </ToolbarGroup>
        <span className="rl-toolbar-spacer" />
        <button
          type="button"
          ref={drawerToggle}
          className="graph-settings-toggle"
          aria-expanded={drawerOpen}
          aria-controls="map-settings-drawer"
          onClick={toggleDrawer}
        >
          <Icon name="settings" /> {t('map.settings')}
        </button>
      </Toolbar>
      <div className="graph-body" data-drawer={drawerOpen ? 'open' : 'closed'}>
        <div className="graph-main">
          <div className="graph-stage">
            <div className="graph-canvas map-canvas" data-main-frame="map" ref={frame}>
              {/* 地図の部品が中身を管理する要素。React はここに子を描かない。 */}
              <div className="map-engine" ref={engineHost} />
              {status === 'loading' && (
                <div className="map-overlay map-overlay-center">
                  <StatusMessage state={{ kind: 'loading', message: t('map.loading') }} />
                </div>
              )}
              {unavailableText !== null && (
                <div className="map-overlay map-overlay-center" role="alert">
                  <strong>{t('map.unavailable')}</strong>
                  <p>{unavailableText}</p>
                </div>
              )}
              {status === 'ready' && graph.order === 0 && (
                <div className="map-overlay map-overlay-top" role="status">
                  {t('map.noNodes')}
                </div>
              )}
              {status === 'ready' && noCoordinates && (
                <div
                  className="map-overlay map-overlay-top"
                  role="status"
                  data-testid="map-no-coordinates"
                >
                  <strong>{t('map.noCoordinates.title')}</strong>
                  <p>{t('map.noCoordinates.body')}</p>
                </div>
              )}
              {keyNotice && status === 'ready' && (
                <div className="map-overlay map-overlay-key" role="status">
                  {tRich(t, 'map.tileKeysRemoved', {}, { names: removed.join(', ') })}
                </div>
              )}
              <MapUnplaced placement={placement} onPick={pick} selected={selected} />
            </div>
          </div>
        </div>
        <aside
          id="map-settings-drawer"
          className="graph-drawer"
          ref={drawer}
          tabIndex={-1}
          hidden={!drawerOpen}
          aria-label={t('map.drawer')}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && drawerOpen) {
              e.stopPropagation();
              setDrawerOpen(false);
              drawerToggle.current?.focus();
            }
          }}
        >
          <h3 className="graph-drawer-title">{t('map.drawer.title')}</h3>
          <p className="rl-section-note graph-drawer-note">{t('map.settingsScope')}</p>
          <MapSettings dataset={dataset} geoAttrs={graphView?.geoAttrs} />
        </aside>
      </div>
    </section>
  );
}
