// 【TS】as constは設定のkindをリテラルに保ち、判別共用体として検査する。
import { useState } from 'react';
import { parseEncodingSettings } from '../core/encode';
import type { EncodingSettings } from '../core/encode';
import type { Dataset } from '../core/model';
import { NODE_SHAPES } from '../core/model';
import { useT } from './hooks';
import { InfoTip } from './ui/InfoTip';
/** 見た目操作の入力。 */
interface Props {
  readonly dataset: Dataset;
  readonly settings: EncodingSettings;
  readonly onChange: (settings: EncodingSettings) => void;
}
/**
 * ノードの大きさ・色・形、サイズ/線幅のスケールとpx範囲を操作する。
 * @param props - 元データ・現在の設定・更新先
 * @returns 保存可能な見た目の操作欄
 */
export function EncodingControls({ dataset, settings, onChange }: Props) {
  const t = useT();
  const [invalid, setInvalid] = useState(false);
  const update = (next: EncodingSettings) => {
    const result = parseEncodingSettings(next);
    setInvalid(!result.ok);
    if (result.ok) onChange(result.value);
  };
  const metrics = ['degree', 'inDegree', 'outDegree'] as const;
  const sizeSource = settings.nodeSize.source;
  const sizeValue =
    sizeSource.kind === 'constant'
      ? 'constant'
      : sizeSource.kind === 'attr'
        ? 'attr:' + sizeSource.attr
        : 'metric:' + sizeSource.metric;
  const color = settings.nodeColor;
  const colorValue =
    color.kind === 'nodeType'
      ? 'nodeType'
      : color.kind === 'attr'
        ? 'attr:' + color.attr
        : 'metric:' + color.metric;
  return (
    // 【なぜ】見出しと開閉は、表示の設定の引き出しの節（CollapsibleSection）が持つ。ここでは中身だけを返す。
    <div className="graph-encoding">
      <label>
        {t('graph.sizeSource')}{' '}
        <select
          aria-label={t('graph.sizeSource')}
          value={sizeValue}
          onChange={(e) => {
            const value = e.currentTarget.value;
            const source =
              value === 'constant'
                ? { kind: 'constant' as const }
                : value.startsWith('attr:')
                  ? { kind: 'attr' as const, attr: value.slice(5) }
                  : { kind: 'metric' as const, metric: value.slice(7) };
            update({ ...settings, nodeSize: { ...settings.nodeSize, source } });
          }}
        >
          <option value="constant">{t('graph.constant')}</option>
          {metrics.map((metric) => (
            <option key={metric} value={'metric:' + metric}>
              {t(`graph.${metric}`)}
            </option>
          ))}
          {dataset.schema
            .filter((a) => a.appliesTo === 'node' && a.valueType === 'number')
            .map((a) => (
              <option key={a.key} value={'attr:' + a.key}>
                {a.label}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t('graph.colorSource')}{' '}
        <select
          aria-label={t('graph.colorSource')}
          value={colorValue}
          onChange={(e) => {
            const value = e.currentTarget.value;
            update({
              ...settings,
              nodeColor:
                value === 'nodeType'
                  ? { kind: 'nodeType' }
                  : value.startsWith('attr:')
                    ? { kind: 'attr', attr: value.slice(5) }
                    : { kind: 'metric', metric: value.slice(7) },
            });
          }}
        >
          <option value="nodeType">{t('graph.byType')}</option>
          {metrics.map((metric) => (
            <option key={metric} value={'metric:' + metric}>
              {t(`graph.${metric}`)}
            </option>
          ))}
          {dataset.schema
            .filter(
              (a) =>
                a.appliesTo === 'node' && ['category', 'string', 'boolean'].includes(a.valueType),
            )
            .map((a) => (
              <option key={a.key} value={'attr:' + a.key}>
                {a.label}
              </option>
            ))}
        </select>
      </label>
      <label>
        {t('graph.shapeSource')}{' '}
        <select
          aria-label={t('graph.shapeSource')}
          value={settings.nodeShape.kind === 'nodeType' ? 'nodeType' : settings.nodeShape.shape}
          onChange={(e) => {
            const value = e.currentTarget.value;
            if (value === 'nodeType') update({ ...settings, nodeShape: { kind: 'nodeType' } });
            else
              for (const shape of NODE_SHAPES)
                if (shape === value)
                  update({ ...settings, nodeShape: { kind: 'constant', shape } });
          }}
        >
          <option value="nodeType">{t('graph.byType')}</option>
          {NODE_SHAPES.map((shape) => (
            <option key={shape} value={shape}>
              {t(`graph.${shape}`)}
            </option>
          ))}
        </select>
      </label>
      {(['nodeSize', 'edgeWidth'] as const).map((key) => (
        <fieldset key={key}>
          <legend>{t(key === 'nodeSize' ? 'graph.nodePixels' : 'graph.edgePixels')}</legend>
          <label>
            {t('graph.scale')}{' '}
            <select
              aria-label={t(key === 'nodeSize' ? 'graph.sizeScale' : 'graph.widthScale')}
              value={settings[key].scale}
              onChange={(e) => {
                const value = e.currentTarget.value;
                if (value === 'linear' || value === 'sqrt' || value === 'log')
                  update({ ...settings, [key]: { ...settings[key], scale: value } });
              }}
            >
              <option value="linear">{t('graph.linear')}</option>
              <option value="sqrt">{t('graph.sqrt')}</option>
              <option value="log">{t('graph.log')}</option>
            </select>
          </label>
          {(['min', 'max'] as const).map((bound) => (
            <label key={bound}>
              {t(bound === 'min' ? 'graph.minPixels' : 'graph.maxPixels')}{' '}
              <input
                aria-label={t(
                  key === 'nodeSize'
                    ? bound === 'min'
                      ? 'graph.nodeMin'
                      : 'graph.nodeMax'
                    : bound === 'min'
                      ? 'graph.edgeMin'
                      : 'graph.edgeMax',
                )}
                type="number"
                min="0"
                step="0.5"
                value={settings[key][bound]}
                onChange={(e) => {
                  update({
                    ...settings,
                    [key]: { ...settings[key], [bound]: e.currentTarget.valueAsNumber },
                  });
                }}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <label>
        {t('graph.widthSource')}{' '}
        <select
          aria-label={t('graph.widthSource')}
          value={settings.edgeWidth.source.kind}
          onChange={(e) => {
            const kind = e.currentTarget.value;
            if (kind === 'weight' || kind === 'constant')
              update({ ...settings, edgeWidth: { ...settings.edgeWidth, source: { kind } } });
          }}
        >
          <option value="weight">{t('graph.weightValue')}</option>
          <option value="constant">{t('graph.constant')}</option>
        </select>
      </label>
      <div className="info-row">
        <InfoTip topic={t('graph.appearance')}>
          <p>{t('graph.numericHint')}</p>
        </InfoTip>
      </div>
      <div role="alert">{invalid ? t('graph.invalidEncoding') : ''}</div>
    </div>
  );
}
