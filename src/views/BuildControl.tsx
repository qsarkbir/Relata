import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { PROJECTION_METHODS } from '../core/graph';
import type { GraphOptions, ProjectionMethod } from '../core/graph';
import type { Dataset, NodeTypeId } from '../core/model';
import { DEFAULT_GRAPH_OPTIONS } from '../core/graph';
import { buildOptions, graphViewStore, selectGraphOptions } from '../state';
import type { MessageKey } from '../i18n';
import { assertNever } from '../core/util/assertNever';
import { useData, useT, useUi } from './hooks';
import { getNumberFormat } from './intl';
import { useNetwork } from './useNetwork';
import { buildPanelStore } from './buildPanelStore';
import { useCurrentMetrics } from './metrics/useCurrentMetrics';
import { Chip } from './ui/Chip';
import { Field } from './ui/Field';
import { IconButton } from './ui/icons';
import { ProjectionIssues } from './ProjectionNotice';
import './conditions.css';

// 【TS】`Record<ProjectionMethod, MessageKey>` は、方式の全部をキーに持つ表。方式を足して書き忘れると型エラーになる。
const METHOD_NAMES: Record<ProjectionMethod, MessageKey> = {
  shared: 'build.projection.method.shared',
  newman: 'build.projection.method.newman',
  jaccard: 'build.projection.method.jaccard',
};
const METHOD_HELP: Record<ProjectionMethod, MessageKey> = {
  shared: 'build.projection.help.shared',
  newman: 'build.projection.help.newman',
  jaccard: 'build.projection.help.jaccard',
};

/**
 * 型の ID から、データの型の名前（利用者の値）を引く。無ければ ID をそのまま返す。
 *
 * @param dataset - データセット
 * @param id - ノードの型の ID
 * @returns 型の名前
 */
function typeLabel(dataset: Dataset, id: NodeTypeId): string {
  return dataset.nodeTypes.find((type) => type.id === id)?.label ?? id;
}

/**
 * 適用中の条件の行に置く「ネットワークの構築」の項目と、そこから開く小さなパネル（FR-GR-03〜05）。
 *
 * 項目には、実際に適用されている値（射影、既定と違う重み、自己ループの除外）だけを出す。既定のままなら
 * 名前だけを出す（パネルを開く入口が要るため）。パネルは図の上に常時展開せず、押したときだけ開く
 * （方針 §1.2）。開閉はこの部品だけの状態で、フィルタ・選択・viewport には触れない。
 * 設定の変更は即時に反映され、`buildOptions` を通して元に戻せる。
 * @returns 項目とパネル
 */
export function BuildControl() {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const dataset = useData((s) => s.dataset);
  const options = useStore(graphViewStore, selectGraphOptions);
  const network = useNetwork();
  // 【なぜ】開閉は小さなストアに置く。図の上の注意（ProjectionIssues）が、開いている間は出ないように共有する。
  const open = useStore(buildPanelStore, (b) => b.open);
  const setOpen = (value: boolean) => {
    buildPanelStore.getState().setOpen(value);
  };
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const panelId = useId();

  // 【なぜ】開いたらパネルへフォーカスを移す（キーボードの利用者が、押した場所から探し回らずに済むように）。
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  // 【なぜ】パネルの外を押したら閉じる。閉じる操作でフォーカスは動かさない（押した先を優先する）。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panel.current?.contains(target) || toggle.current?.contains(target)) return;
      buildPanelStore.getState().setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (dataset === null || network === null) return null;
  const close = () => {
    setOpen(false);
    toggle.current?.focus();
  };
  const status = network.projection;

  // 項目に出す、実際に適用されている値。
  const parts: ReactNode[] = [];
  // 【TS】`switch` と `assertNever` で、射影の状態を足したときの書き忘れを型で検出する。
  switch (status.kind) {
    case 'none':
      break;
    case 'applied':
      parts.push(
        <span key="projection">
          {t('build.summary.projection')} <bdi>{typeLabel(dataset, status.options.target)}</bdi> ←{' '}
          <bdi>{typeLabel(dataset, status.options.via)}</bdi>
        </span>,
      );
      break;
    case 'invalid':
      parts.push(<span key="projection">{t('build.summary.projectionInvalid')}</span>);
      break;
    default:
      assertNever(status);
  }
  if (options.weight !== DEFAULT_GRAPH_OPTIONS.weight) {
    const w = options.weight;
    const weightName =
      typeof w === 'string'
        ? w === 'count'
          ? t('graph.count')
          : t('graph.weightValue')
        : (dataset.schema.find((a) => a.key === w.attr)?.label ?? w.attr);
    parts.push(
      <span key="weight">
        {t('build.summary.weight')} <bdi>{weightName}</bdi>
      </span>,
    );
  }
  if (options.selfLoops !== DEFAULT_GRAPH_OPTIONS.selfLoops) {
    parts.push(<span key="loops">{t('build.summary.noLoops')}</span>);
  }
  const label =
    parts.length === 0 ? (
      t('build.open')
    ) : (
      <>
        {t('build.summaryPrefix')}{' '}
        {parts.map((part, index) => (
          <span key={index}>
            {index > 0 && ' · '}
            {part}
          </span>
        ))}
      </>
    );

  return (
    <>
      <button
        type="button"
        ref={toggle}
        className="rl-chip build-toggle"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span className="rl-chip-text">{label}</span>
      </button>
      {status.kind === 'applied' && (
        <Chip>
          {t('build.afterProjection', {
            nodes: nf.format(network.graph.order),
            edges: nf.format(network.graph.size),
          })}
        </Chip>
      )}
      {open && (
        <section
          id={panelId}
          ref={panel}
          className="build-panel"
          role="dialog"
          aria-labelledby={`${panelId}-title`}
          tabIndex={-1}
          onKeyDown={(event) => {
            // 【なぜ】Esc で閉じ、押した項目へフォーカスを戻す（他のパネルと同じ作法）。
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
              return;
            }
            // 【なぜ】パネルの中の Ctrl/Cmd+Z は、フィルタではなく構築の設定の Undo/Redo にする。パネルの中の欄は
            // select とチェックボックスだけで、文字を打つ欄が無いので、ブラウザ標準の取り消しとは衝突しない。
            // `stopPropagation` で、document に付いたフィルタのショートカット（useFilterShortcuts）へ届かせない。
            if ((event.ctrlKey || event.metaKey) && !event.altKey) {
              const key = event.key.toLowerCase();
              if (key === 'z' || (key === 'y' && event.ctrlKey && !event.shiftKey)) {
                event.preventDefault();
                event.stopPropagation();
                if (key === 'y' || event.shiftKey) buildOptions.redo();
                else buildOptions.undo();
              }
            }
          }}
        >
          <BuildPanelBody dataset={dataset} options={options} titleId={`${panelId}-title`} />
          <div className="build-panel-actions">
            <button type="button" onClick={close}>
              {t('build.close')}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

/** {@link BuildPanelBody} の props。 */
interface BodyProps {
  readonly dataset: Dataset;
  readonly options: GraphOptions;
  readonly titleId: string;
}

/**
 * パネルの中身。重みの集約、自己ループ、射影の設定。
 *
 * @param props - データ、今の設定、見出しの ID
 * @returns 中身
 */
function BuildPanelBody({ dataset, options, titleId }: BodyProps) {
  const t = useT();
  const network = useNetwork();
  const metrics = useCurrentMetrics();
  const past = useStore(buildOptions.history, (s) => s.past.length);
  const future = useStore(buildOptions.history, (s) => s.future.length);
  const types = dataset.nodeTypes;
  const projection = options.projection;
  const canProject = types.length >= 2;
  const projecting = projection !== undefined;
  // 【なぜ】進行は、指標の計算と、配置の計算（uiStore の進行表示に載る）の両方を見る。
  const layoutBusy = useUi((s) => s.tasks.some((task) => task.label.key === 'graph.layoutTask'));
  const busy = metrics.phase === 'waiting' || metrics.phase === 'running' || layoutBusy;
  // 【なぜ】射影が実際に効いているとき（applied）だけ、重みと自己ループを無効にする。射影の設定があっても
  // 無効（型が無いなど）なら、これらの設定は使われているので触れるようにする。
  const projectionApplied = network?.projection.kind === 'applied';
  const methodHelpId = useId();

  // 【TS】`GraphOptions['projection']` は「射影の設定」の型（任意項目なので undefined を含む）。`NonNullable` で
  //       undefined を除き、`Partial` で「変えたい項目だけ」を渡せるようにする。
  const setProjection = (next: Partial<NonNullable<GraphOptions['projection']>> | null) => {
    buildOptions.apply((current) => {
      const base: GraphOptions = { weight: current.weight, selfLoops: current.selfLoops };
      if (next === null) return base;
      const first = types[0];
      const second = types[1];
      const from =
        current.projection ??
        (first && second
          ? { target: first.id, via: second.id, method: 'shared' as const } // `as const` で、method を string ではなくリテラル型 'shared' に保つ
          : undefined);
      if (from === undefined) return current;
      const merged = { ...from, ...next };
      // 【なぜ】射影先と仲介を同じ型にできない。片方を変えて重なったら、もう片方を元の値と入れ替える。
      if (merged.target === merged.via) {
        if (next.target !== undefined) merged.via = from.target;
        else merged.target = from.via;
      }
      return { ...base, projection: merged };
    });
  };
  const typeOptions = (current: NodeTypeId) => (
    <>
      {types.map((type) => (
        <option key={type.id} value={type.id} dir="auto">
          {type.label}
        </option>
      ))}
      {!types.some((type) => type.id === current) && (
        <option value={current} dir="auto">
          {t('build.projection.unknownType', { id: current })}
        </option>
      )}
    </>
  );
  const toNodeType = (value: string): NodeTypeId | undefined =>
    types.find((type) => type.id === value)?.id;

  return (
    <>
      <div className="build-panel-head">
        <h3 id={titleId}>{t('build.title')}</h3>
        <IconButton
          icon="undo"
          label={t('build.undo')}
          disabled={past === 0}
          onClick={() => {
            buildOptions.undo();
          }}
        />
        <IconButton
          icon="redo"
          label={t('build.redo')}
          disabled={future === 0}
          onClick={() => {
            buildOptions.redo();
          }}
        />
      </div>
      <p className="rl-section-note">{t('build.scope')}</p>
      <p className="rl-section-note">{t('build.noteShortcut')}</p>
      <div role="status" className="build-progress">
        {busy && (
          <>
            <progress aria-label={t('build.progress.running')} />
            <span>{t('build.progress.running')}</span>
          </>
        )}
      </div>

      <fieldset className="build-group">
        <legend>{t('build.section.aggregate')}</legend>
        <Field label={t('graph.weight')}>
          <select
            aria-label={t('graph.weight')}
            disabled={projectionApplied}
            value={
              typeof options.weight === 'string' ? options.weight : 'attr:' + options.weight.attr
            }
            onChange={(e) => {
              const value = e.currentTarget.value;
              buildOptions.apply((current) => ({
                ...current,
                weight: value === 'count' || value === 'weight' ? value : { attr: value.slice(5) },
              }));
            }}
          >
            <option value="weight">{t('graph.weightValue')}</option>
            <option value="count">{t('graph.count')}</option>
            {dataset.schema
              .filter((a) => a.appliesTo === 'edge' && a.valueType === 'number')
              .map((a) => (
                <option key={a.key} value={'attr:' + a.key} dir="auto">
                  {a.label}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t('graph.selfLoops')} inline>
          <input
            type="checkbox"
            disabled={projectionApplied}
            checked={options.selfLoops}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              buildOptions.apply((current) => ({ ...current, selfLoops: checked }));
            }}
          />
        </Field>
        {projectionApplied && <p className="rl-section-note">{t('build.aggregateIgnored')}</p>}
      </fieldset>

      <fieldset className="build-group">
        <legend>{t('build.section.projection')}</legend>
        <Field label={t('build.projection.enable')} inline>
          <input
            type="checkbox"
            // 型が足りなくても、すでに射影の設定があるときは外せるようにする（抜け出せなくならないように）。
            disabled={!canProject && !projecting}
            checked={projecting}
            onChange={(e) => {
              setProjection(e.currentTarget.checked ? {} : null);
            }}
          />
        </Field>
        {!canProject && (
          <p className="rl-section-note">
            {t('build.projection.unavailable', { count: String(types.length) })}
          </p>
        )}
        {canProject && <p className="rl-section-note">{t('build.projection.hint')}</p>}
        {projection !== undefined && (
          <>
            <Field label={t('build.projection.target')}>
              <select
                aria-label={t('build.projection.target')}
                value={projection.target}
                onChange={(e) => {
                  const id = toNodeType(e.currentTarget.value);
                  if (id !== undefined) setProjection({ target: id });
                }}
              >
                {typeOptions(projection.target)}
              </select>
            </Field>
            <Field label={t('build.projection.via')}>
              <select
                aria-label={t('build.projection.via')}
                value={projection.via}
                onChange={(e) => {
                  const id = toNodeType(e.currentTarget.value);
                  if (id !== undefined) setProjection({ via: id });
                }}
              >
                {typeOptions(projection.via)}
              </select>
            </Field>
            <Field label={t('build.projection.method')}>
              <select
                aria-label={t('build.projection.method')}
                aria-describedby={methodHelpId}
                value={projection.method}
                onChange={(e) => {
                  const method = PROJECTION_METHODS.find((m) => m === e.currentTarget.value);
                  if (method !== undefined) setProjection({ method });
                }}
              >
                {PROJECTION_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {t(METHOD_NAMES[method])}
                  </option>
                ))}
              </select>
            </Field>
            <p id={methodHelpId} className="rl-section-note">
              {t(METHOD_HELP[projection.method])}
            </p>
          </>
        )}
        {network !== null && <ProjectionIssues status={network.projection} />}
      </fieldset>
    </>
  );
}
