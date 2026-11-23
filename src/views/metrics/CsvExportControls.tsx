import { useState } from 'react';
import type { Dataset } from '../../core/model';
import type { FilterState } from '../../core/filter';
import type { GraphOptions } from '../../core/graph';
import type { MetricsResult } from '../../core/metrics';
import { applyFilters } from '../../core/filter';
import { downloadCsv, exportDatasetCsv, exportMetricsCsv } from '../../io/export/csv';
import { useT } from '../hooks';
import { InfoTip } from '../ui/InfoTip';

/** CSVボタンの現在の入力。 */
interface CsvExportControlsProps {
  readonly dataset: Dataset;
  readonly filter: FilterState;
  readonly result: MetricsResult | null;
  /** 指標を計算したグラフの設定（射影を含む）。指標のCSVの最後の列に残す。 */
  readonly graphOptions: GraphOptions;
}
/**
 * 現在の全対象を書き出す。古い指標がある間は指標CSVだけを無効にする。
 * @param props - 現在のデータ・フィルタ・確定した指標
 * @returns BOM/式保護の選択と4つのダウンロードボタン
 */
export function CsvExportControls({
  dataset,
  filter,
  result,
  graphOptions,
}: CsvExportControlsProps) {
  const t = useT();
  const names = {
    nodes: 'csv.nodes',
    edges: 'csv.edges',
    metrics: 'csv.metrics',
    global: 'csv.global',
  } as const;
  const [bom, setBom] = useState(true);
  const [formulaProtection, setFormulaProtection] = useState(true);
  const [failed, setFailed] = useState(false);
  const save = (kind: 'nodes' | 'edges' | 'metrics' | 'global'): void => {
    setFailed(false);
    try {
      const options = { bom, formulaProtection };
      if (kind === 'nodes' || kind === 'edges')
        downloadCsv(exportDatasetCsv(dataset, applyFilters(dataset, filter), options)[kind]);
      else if (result !== null)
        downloadCsv(exportMetricsCsv(dataset, result, options, graphOptions)[kind]);
    } catch {
      setFailed(true);
    }
  };
  return (
    <fieldset className="csv-export">
      <legend>
        {t('csv.options')}{' '}
        <InfoTip topic={t('csv.options')}>
          <p>{t('csv.hint')}</p>
        </InfoTip>
      </legend>
      <label>
        <input
          type="checkbox"
          checked={bom}
          onChange={(event) => {
            setBom(event.target.checked);
          }}
        />
        {t('csv.bom')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={formulaProtection}
          onChange={(event) => {
            setFormulaProtection(event.target.checked);
          }}
        />
        {t('csv.protection')}
      </label>
      <div className="metrics-actions">
        {(['nodes', 'edges', 'metrics', 'global'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            disabled={(kind === 'metrics' || kind === 'global') && result === null}
            onClick={() => {
              save(kind);
            }}
          >
            {t(names[kind])}
          </button>
        ))}
      </div>
      <div role="alert">{failed ? t('csv.failed') : ''}</div>
    </fieldset>
  );
}
