import { useState } from 'react';
import { mapViewStore } from '../state';
import { resolveGeoSource } from '../core/project';
import type { Dataset } from '../core/model';
import type { GraphViewSettings } from '../core/project';
import { effectiveGeoAttrs, geoCandidates, resolveGeoSelection } from './geoInputs';
import { useMapView, useT } from './hooks';
import { Field } from './ui/Field';

/** {@link GeoSourceControls} の props。 */
interface Props {
  readonly dataset: Dataset;
  /** 旧版の `view.graph.geoAttrs`（出どころが未選択のときの読み替え元）。 */
  readonly geoAttrs: GraphViewSettings['geoAttrs'];
}

/**
 * 座標の出どころの選択欄（D-46）。地図の設定と、グラフの地理座標の配置で共通の設定（`view.geoSource`）を編集する。
 *
 * 出どころは 2 つ: 読み込みで指定した緯度・経度（`geo`）か、属性の組（緯度の列と経度の列）。
 * 【なぜ】属性の組は、緯度と経度の両方を選ぶまで保存しない（片方だけの出どころは作れない）。
 * 選んでいる途中の状態は、この部品の中の一時的な状態（`pending`）に置き、ストアには入れない。
 *
 * @param props - データ、旧版の属性の指定
 * @returns 選択欄
 */
export function GeoSourceControls({ dataset, geoAttrs }: Props) {
  const t = useT();
  const geoSource = useMapView((s) => s.geoSource);
  const source = resolveGeoSource(geoSource, { geoAttrs });
  // 属性の組を選んでいる途中（片方だけ選んだ）の値。null なら途中ではない。
  const [pending, setPending] = useState<{ lat: string; lon: string } | null>(null);
  const mode = pending !== null ? 'attrs' : source.kind;
  const candidates = geoCandidates(dataset);
  const valid = resolveGeoSelection(dataset, effectiveGeoAttrs(geoSource, geoAttrs));
  const current = pending ?? {
    lat: source.kind === 'attrs' ? source.lat : (valid.lat ?? ''),
    lon: source.kind === 'attrs' ? source.lon : (valid.lon ?? ''),
  };
  const setSource = mapViewStore.getState().setGeoSource;

  const choose = (which: 'lat' | 'lon', value: string): void => {
    const next = { ...current, [which]: value };
    if (next.lat !== '' && next.lon !== '') {
      setSource({ kind: 'attrs', lat: next.lat, lon: next.lon });
      setPending(null);
    } else {
      setPending(next);
    }
  };
  const select = (which: 'lat' | 'lon') => {
    const label = t(which === 'lat' ? 'graph.geo.lat' : 'graph.geo.lon');
    const value = current[which];
    return (
      <Field label={label}>
        <select
          aria-label={label}
          value={candidates.some((a) => a.key === value) ? value : ''}
          onChange={(e) => {
            choose(which, e.currentTarget.value);
          }}
        >
          <option value="">{t('graph.geo.none')}</option>
          {candidates.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
      </Field>
    );
  };

  return (
    <fieldset className="map-geo-source">
      <legend>{t('map.geo.kind')}</legend>
      <p className="rl-section-note">{t('map.geo.note')}</p>
      <label className="map-radio">
        <input
          type="radio"
          name="geo-source-kind"
          checked={mode === 'geo'}
          onChange={() => {
            setPending(null);
            setSource({ kind: 'geo' });
          }}
        />
        {t('map.geo.kind.geo')}
      </label>
      <label className="map-radio">
        <input
          type="radio"
          name="geo-source-kind"
          checked={mode === 'attrs'}
          onChange={() => {
            // 【なぜ】ここでは保存しない。緯度と経度の両方を選んだときに、出どころを決める。
            if (source.kind !== 'attrs') setPending({ lat: valid.lat ?? '', lon: valid.lon ?? '' });
          }}
        />
        {t('map.geo.kind.attrs')}
      </label>
      {mode === 'attrs' && (
        <>
          {select('lat')}
          {select('lon')}
          {pending !== null && <p className="rl-section-note">{t('map.geo.pending')}</p>}
        </>
      )}
    </fieldset>
  );
}
