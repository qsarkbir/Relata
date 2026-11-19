import type { FilterId, FilterState, Target } from '../core/filter';
import { assertNever } from '../core/util/assertNever';
import type { AttributeDef, Dataset } from '../core/model';
import {
  getFacetCounts,
  getFilterIssues,
  getFilterResult,
  selectCanRedo,
  selectCanUndo,
  selectFilterState,
} from '../state';
import { findFilters } from './filter/activeFilters';
import { AppliedList } from './filter/AppliedList';
import { FacetControl } from './filter/FacetControl';
import { NodeTypeControl } from './filter/NodeTypeControl';
import { RangeControl } from './filter/RangeControl';
import { TextSearch } from './filter/TextSearch';
import { useFilterShortcuts } from './filter/useFilterShortcuts';
import { useData, useFilter, useT, useUi } from './hooks';
import { getNumberFormat } from './intl';

/**
 * フィルタパネル全体（FR-FL-01〜10、FR-FL-12）。データが無いときは案内だけを出す。
 *
 * 状態は filterStore の履歴（現在の FilterState）から読む。結果とファセットの件数は
 * `getFilterResult` などで計算（同じ入力なら覚えた結果）し、部品には持たせない（D-32）。
 *
 * @returns パネルの要素
 */
export function FilterPanel() {
  const t = useT();
  const dataset = useData((s) => s.dataset);
  const canUndo = useFilter(selectCanUndo);
  const canRedo = useFilter(selectCanRedo);
  const undo = useFilter((s) => s.undo);
  const redo = useFilter((s) => s.redo);
  useFilterShortcuts(dataset !== null);

  if (dataset === null) {
    return <p className="placeholder">{t('app.region.filters.placeholder')}</p>;
  }
  return (
    <div className="filter-panel">
      <div className="filter-toolbar">
        <h2>{t('filter.title')}</h2>
        <button
          type="button"
          disabled={!canUndo}
          onClick={undo}
          title={t('filter.shortcuts')}
          aria-keyshortcuts="Control+Z Meta+Z"
        >
          {t('filter.undo')}
        </button>
        <button
          type="button"
          disabled={!canRedo}
          onClick={redo}
          title={t('filter.shortcuts')}
          aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
        >
          {t('filter.redo')}
        </button>
      </div>
      {/* 【なぜ】key にデータの識別番号を渡す。データが替わったら、部品の下書きと開閉の状態を捨てる。 */}
      <PanelBody key={datasetKey(dataset)} dataset={dataset} />
    </div>
  );
}

// 【TS】WeakMap は、キー（Dataset の参照）が不要になれば自動で捨てられる Map。Dataset ごとに番号を振る。
const datasetKeys = new WeakMap<Dataset, number>();
let nextDatasetKey = 1;
function datasetKey(dataset: Dataset): number {
  let key = datasetKeys.get(dataset);
  if (key === undefined) {
    key = nextDatasetKey++;
    datasetKeys.set(dataset, key);
  }
  return key;
}

/** データがあるときの本体の入力。 */
interface PanelBodyProps {
  readonly dataset: Dataset;
}

function PanelBody({ dataset }: PanelBodyProps) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const state = useFilter(selectFilterState);
  const setEdgeRule = useFilter((s) => s.setEdgeRule);
  const setShowIsolated = useFilter((s) => s.setShowIsolated);

  const result = getFilterResult(dataset, state);
  const issues = getFilterIssues(dataset, state);
  const nf = getNumberFormat(locale);
  const { counts } = result;
  return (
    <>
      {/* FR-FL-09: 絞り込み後と全体の数。変わったら読み上げる（role="status"）。 */}
      <p className="filter-counts" role="status" aria-label={t('filter.counts.region')}>
        <span>
          {t('filter.counts.nodes', {
            shown: nf.format(counts.nodes.shown),
            total: nf.format(counts.nodes.total),
          })}
        </span>
        <span>
          {t('filter.counts.edges', {
            shown: nf.format(counts.edges.shown),
            total: nf.format(counts.edges.total),
          })}
        </span>
      </p>

      <AppliedList
        dataset={dataset}
        filters={state.filters}
        issues={issues}
        missingExcluded={result.missingExcluded}
      />

      {/* 【TS】`as const satisfies readonly Target[]` は、配列を 'node' | 'edge' のリテラルの並びとして固定し
          （as const）、Target として正しいかも検査する（satisfies）。 */}
      {(['node', 'edge'] as const satisfies readonly Target[]).map((target) => {
        // 【なぜ】適用中のフィルタは、ID ではなく（種類、対象、属性）で探す。別の ID で入ったフィルタ
        //       （プロジェクトファイルなど）でも、部品の状態が実際の絞り込みと一致する。
        const texts = findFilters(state.filters, 'text', (f) => f.target === target);
        const types = findFilters(state.filters, 'nodeType');
        const defs = dataset.schema.filter((d) => d.appliesTo === target);
        const heading = target === 'node' ? 'filter.target.node' : 'filter.target.edge';
        return (
          <section
            key={target}
            className="filter-target"
            aria-labelledby={`filter-target-${target}`}
          >
            <h3 id={`filter-target-${target}`}>{t(heading)}</h3>
            {target === 'node' && (
              <NodeTypeControl
                nodeTypes={dataset.nodeTypes}
                active={types[0]}
                duplicates={types.length - 1}
              />
            )}
            <TextSearch target={target} active={texts[0]} duplicates={texts.length - 1} />
            <h4>{t('filter.attrs')}</h4>
            {defs.length === 0 && <p className="hint">{t('filter.attrs.none')}</p>}
            {defs.map((def) => (
              <AttrControl
                key={def.key}
                dataset={dataset}
                target={target}
                def={def}
                state={state}
                missingExcluded={result.missingExcluded}
              />
            ))}
            {defs.some((d) => d.valueType === 'date') && (
              <p className="hint">{t('filter.attrs.dateSkipped')}</p>
            )}
          </section>
        );
      })}

      <fieldset className="filter-rules">
        <legend>{t('filter.rules')}</legend>
        <fieldset>
          <legend>{t('filter.edgeRule')}</legend>
          <label>
            <input
              type="radio"
              name="edge-rule"
              checked={state.edgeRule === 'both-ends'}
              onChange={() => {
                setEdgeRule('both-ends');
              }}
            />
            {t('filter.edgeRule.bothEnds')}
          </label>
          <label>
            <input
              type="radio"
              name="edge-rule"
              checked={state.edgeRule === 'either-end'}
              onChange={() => {
                setEdgeRule('either-end');
              }}
            />
            {t('filter.edgeRule.eitherEnd')}
          </label>
        </fieldset>
        <label>
          <input
            type="checkbox"
            checked={state.showIsolated}
            onChange={(e) => {
              setShowIsolated(e.currentTarget.checked);
            }}
          />
          {t('filter.showIsolated')}
        </label>
      </fieldset>
    </>
  );
}

/** 属性 1 つの部品の入力。 */
interface AttrControlProps {
  readonly dataset: Dataset;
  readonly target: Target;
  readonly def: AttributeDef;
  readonly state: FilterState;
  readonly missingExcluded: ReadonlyMap<FilterId, number>;
}

// 属性の型で部品を選ぶ（D-32）。category、string、boolean はファセット、number は範囲。date は今後。
function AttrControl({ dataset, target, def, state, missingExcluded }: AttrControlProps) {
  switch (def.valueType) {
    case 'category':
    case 'string':
    case 'boolean': {
      const found = findFilters(
        state.filters,
        'category',
        (f) => f.target === target && f.attr === def.key,
      );
      return (
        <FacetControl
          target={target}
          def={def}
          getCounts={() => getFacetCounts(dataset, state, target, def.key)}
          active={found[0]}
          duplicates={found.length - 1}
        />
      );
    }
    case 'number': {
      const found = findFilters(
        state.filters,
        'range',
        (f) => f.target === target && f.attr === def.key,
      );
      const first = found[0];
      return (
        <RangeControl
          target={target}
          def={def}
          active={first}
          duplicates={found.length - 1}
          excluded={first === undefined ? undefined : missingExcluded.get(first.id)}
        />
      );
    }
    case 'date':
      return null;
    default:
      return assertNever(def.valueType, 'ValueType');
  }
}
