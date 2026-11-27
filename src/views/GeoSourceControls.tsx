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
  /**
   * 緯度・経度の選択を、グラフの設定（`view.graph.geoAttrs`）にも書く関数。グラフの設定の引き出しだけが渡す。
   * 渡されたときは、片方だけ選んだ状態も `geoAttrs` に残し（再読み込みで戻す）、出どころは未選択に戻す
   * （選び終えるまで、グラフの配置は待つ）。渡さない地図の設定では、両方そろうまで出どころを変えない。
   */
  readonly onGeoAttrs?: (next: GraphViewSettings['geoAttrs']) => void;
  /** true なら、種類を選ぶ前から緯度・経度の選択欄を出す（グラフの設定で、従来の操作を保つ）。 */
  readonly alwaysShowAttrs?: boolean;
}

/**
 * 座標の出どころの選択欄（D-46）。地図の設定と、グラフの地理座標の配置で共通の設定（`view.geoSource`）を編集する。
 *
 * 出どころは 2 つ: 読み込みで指定した緯度・経度（`geo`）か、属性の組（緯度の列と経度の列）。
 * 【なぜ】属性の組は、緯度と経度の両方を選ぶまで出どころにしない（片方だけの出どころは作れない）。
 * 「属性の組を選ぶ」と決めただけの状態は、この部品の中の一時的な状態（`pending`）に置き、ストアには入れない。
 *
 * @param props - データ、旧版の属性の指定、グラフの設定への書き込み
 * @returns 選択欄
 */
export function GeoSourceControls({ dataset, geoAttrs, onGeoAttrs, alwaysShowAttrs }: Props) {
  const t = useT();
  const geoSource = useMapView((s) => s.geoSource);
  const source = resolveGeoSource(geoSource, { geoAttrs });
  // 【TS】`useState<A | null>(null)` は、状態の型を明示する。初期値の null だけでは型が `null` に決まり、
  //       あとから組を入れられないため。
  // 属性の組を選ぶと決めた（まだ両方そろっていない）ときの値。null なら途中ではない。
  const [pending, setPending] = useState<{ lat: string; lon: string } | null>(null);
  // 【なぜ】データを置き換えたら、前のデータの属性名を指す下書きは捨てる（描画の中で、前の値と比べて直す定石）。
  const [seenDataset, setSeenDataset] = useState(dataset);
  if (seenDataset !== dataset) {
    setSeenDataset(dataset);
    setPending(null);
  }
  const selected = effectiveGeoAttrs(geoSource, geoAttrs);
  const valid = resolveGeoSelection(dataset, selected);
  const half =
    selected !== undefined && (selected.lat === undefined) !== (selected.lon === undefined);
  const mode = pending !== null || (half && onGeoAttrs !== undefined) ? 'attrs' : source.kind;
  const candidates = geoCandidates(dataset);
  const current = pending ?? {
    lat: source.kind === 'attrs' ? source.lat : (valid.lat ?? ''),
    lon: source.kind === 'attrs' ? source.lon : (valid.lon ?? ''),
  };
  const setSource = mapViewStore.getState().setGeoSource;

  const choose = (which: 'lat' | 'lon', value: string): void => {
    const next = { ...current, [which]: value };
    const both = next.lat !== '' && next.lon !== '';
    if (both) {
      setSource({ kind: 'attrs', lat: next.lat, lon: next.lon });
      setPending(null);
    } else {
      setPending(next);
      // 片方だけの間は、グラフの設定では出どころを未選択に戻し、配置は待つ。
      if (onGeoAttrs !== undefined) setSource(undefined);
    }
    // 【なぜ】選んでいない側は項目ごと省く（空の文字列は保存しない）。両方とも未選択なら項目ごと消す。
    const attrs = {
      ...(next.lat === '' ? {} : { lat: next.lat }),
      ...(next.lon === '' ? {} : { lon: next.lon }),
    };
    onGeoAttrs?.(Object.keys(attrs).length === 0 ? undefined : attrs);
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
          name={alwaysShowAttrs === true ? 'geo-source-kind-graph' : 'geo-source-kind'}
          checked={mode === 'geo'}
          onChange={() => {
            setPending(null);
            setSource({ kind: 'geo' });
            onGeoAttrs?.(undefined);
          }}
        />
        {t('map.geo.kind.geo')}
      </label>
      <label className="map-radio">
        <input
          type="radio"
          name={alwaysShowAttrs === true ? 'geo-source-kind-graph' : 'geo-source-kind'}
          checked={mode === 'attrs'}
          onChange={() => {
            // 【なぜ】ここでは出どころを変えない。緯度と経度の両方を選んだときに決める。
            if (source.kind !== 'attrs') setPending({ lat: valid.lat ?? '', lon: valid.lon ?? '' });
          }}
        />
        {t('map.geo.kind.attrs')}
      </label>
      {(mode === 'attrs' || alwaysShowAttrs === true) && (
        <>
          {select('lat')}
          {select('lon')}
          {valid.missing && (
            <p className="rl-section-note" role="alert">
              {t('graph.geo.notFound')}
            </p>
          )}
          {mode === 'attrs' && source.kind !== 'attrs' && (
            <p className="rl-section-note">{t('map.geo.pending')}</p>
          )}
        </>
      )}
    </fieldset>
  );
}
