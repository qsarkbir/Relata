import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { checkTileUrl, TILE_PLACEHOLDERS } from '../core/geo';
import type { TileUrlProblem } from '../core/geo';
import type { Dataset } from '../core/model';
import { MAP_BACKGROUNDS, MAP_EDGE_DIRECTIONS, MAP_EDGE_SHAPES, MAP_LABELS } from '../core/project';
import type { GraphViewSettings, MapBackground } from '../core/project';
import { mapBundlingController, mapViewStore, type BundlingView } from '../state';
import { BundlingControls } from './BundlingControls';
import { EncodingControls } from './EncodingControls';
import { GeoSourceControls } from './GeoSourceControls';
import { useMapView, useT } from './hooks';
import { CollapsibleSection } from './ui/CollapsibleSection';
import { Field } from './ui/Field';
import { tRich } from './richText';

/** {@link MapSettings} の props。 */
interface Props {
  readonly dataset: Dataset;
  readonly geoAttrs: GraphViewSettings['geoAttrs'];
  readonly bundlingView: BundlingView;
}

/**
 * 利用者のタイルの URL が使えない理由の文言のキー。
 *
 * @param url - 入力した URL
 * @returns 使えるなら null。使えなければ理由（空なら `empty`）
 */
function tileProblemOf(url: string): TileUrlProblem | 'empty' | null {
  if (url === '') return 'empty';
  const c = checkTileUrl(url);
  return c.ok ? null : c.problem;
}

/**
 * 地図の表示の設定（右端の引き出しの中身。D-48）。背景地図、通信の注意、座標の出どころ。
 *
 * 地図だけの設定（`view.map`）と、グラフと共通の座標の出どころ（`view.geoSource`）を編集する。
 * 【なぜ】URL と帰属表示の文は、入力の途中の文字をそのまま地図の背景にしない。途中で使える形になった URL
 * （例: `…/{y}.p`）が、利用者のタイルのサーバーへ無駄な要求を送るため。入力欄を離れたとき（blur）か Enter で反映する。
 *
 * @param props - データ、旧版の属性の指定
 * @returns 設定欄
 */
// 【TS】`GraphViewSettings['geoAttrs']`（下の props）は、グラフの設定の `geoAttrs` 項目の型を取り出す添字アクセス型。
//       旧版の読み替え元の値を、型を書き写さずにそのまま受け渡すために使う。
export function MapSettings({ dataset, geoAttrs, bundlingView }: Props) {
  const t = useT();
  const map = useMapView((s) => s.map);
  const { patchMap, patchCustomTiles } = mapViewStore.getState();
  const [urlDraft, setUrlDraft] = useState(map.customTiles.url);
  const [attrDraft, setAttrDraft] = useState(map.customTiles.attribution);
  // 開いたファイルや別のプロジェクトで保存値が変わったら、下書きを置き直す。
  const [seen, setSeen] = useState(map.customTiles);
  if (seen !== map.customTiles) {
    setSeen(map.customTiles);
    if (seen.url !== map.customTiles.url) setUrlDraft(map.customTiles.url);
    if (seen.attribution !== map.customTiles.attribution) setAttrDraft(map.customTiles.attribution);
  }
  const problem = tileProblemOf(urlDraft);
  const removed = map.customTiles.removedParams ?? [];
  const commitUrl = (): void => {
    if (urlDraft !== map.customTiles.url) patchCustomTiles({ url: urlDraft });
  };
  const commitAttr = (): void => {
    if (attrDraft !== map.customTiles.attribution) patchCustomTiles({ attribution: attrDraft });
  };
  const commitOnEnter = (commit: () => void) => (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
  };

  return (
    <>
      <CollapsibleSection title={t('map.background')} defaultOpen>
        <fieldset className="map-background">
          <legend className="visually-hidden">{t('map.background')}</legend>
          {MAP_BACKGROUNDS.map((b: MapBackground) => (
            <label key={b} className="map-radio">
              <input
                type="radio"
                name="map-background"
                checked={map.background === b}
                onChange={() => {
                  patchMap({ background: b });
                }}
              />
              {t(`map.background.${b}`)}
            </label>
          ))}
        </fieldset>
        {map.background === 'simple' && (
          <p className="rl-section-note">{t('map.background.simpleNote')}</p>
        )}
        {map.background === 'custom' && (
          <div className="map-custom-tiles">
            <Field label={t('map.tileUrl')}>
              <input
                type="url"
                dir="ltr"
                spellCheck={false}
                autoComplete="off"
                value={urlDraft}
                aria-describedby="map-tile-url-help"
                aria-invalid={problem !== null && problem !== 'empty'}
                onChange={(e) => {
                  setUrlDraft(e.currentTarget.value);
                }}
                onBlur={commitUrl}
                onKeyDown={commitOnEnter(commitUrl)}
              />
            </Field>
            <p id="map-tile-url-help" className="rl-section-note">
              {t('map.tileUrl.hint')} ({TILE_PLACEHOLDERS.join(' ')})
            </p>
            {problem !== null && (
              <p role="alert" className="map-tile-problem">
                {t(`map.tileProblem.${problem}`)}
              </p>
            )}
            {removed.length > 0 && (
              <p role="status" className="map-tile-problem" data-testid="map-removed-params">
                {tRich(t, 'map.tileKeysRemoved', {}, { names: removed.join(', ') })}
              </p>
            )}
            <Field label={t('map.tileAttribution')}>
              <input
                type="text"
                value={attrDraft}
                onChange={(e) => {
                  setAttrDraft(e.currentTarget.value);
                }}
                onBlur={commitAttr}
                onKeyDown={commitOnEnter(commitAttr)}
              />
            </Field>
            <p className="rl-section-note">{t('map.tileAttribution.hint')}</p>
            <p className="rl-section-note">{t('map.tileTerms')}</p>
          </div>
        )}
        <h4 className="map-privacy-title">{t('map.privacy.title')}</h4>
        <p className="rl-section-note" data-testid="map-privacy">
          {t('map.privacy.body')}
        </p>
      </CollapsibleSection>
      <CollapsibleSection title={t('map.geo.title')} defaultOpen>
        <GeoSourceControls dataset={dataset} geoAttrs={geoAttrs} />
      </CollapsibleSection>
      <CollapsibleSection title={t('map.appearance')}>
        <Field label={t('map.edgeShape')}>
          <select
            value={map.edgeShape}
            onChange={(e) => {
              const edgeShape = MAP_EDGE_SHAPES.find((shape) => shape === e.currentTarget.value);
              if (edgeShape !== undefined) patchMap({ edgeShape });
            }}
          >
            {MAP_EDGE_SHAPES.map((shape) => (
              <option key={shape} value={shape}>
                {t(`map.edgeShape.${shape}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('graph.direction')}>
          <select
            value={map.direction}
            onChange={(e) => {
              const direction = MAP_EDGE_DIRECTIONS.find(
                (style) => style === e.currentTarget.value,
              );
              if (direction !== undefined) patchMap({ direction });
            }}
          >
            {MAP_EDGE_DIRECTIONS.map((direction) => (
              <option key={direction} value={direction}>
                {t(`graph.${direction}`)}
              </option>
            ))}
          </select>
        </Field>
        <EncodingControls
          dataset={dataset}
          settings={map.encoding}
          showShape={false}
          onChange={(encoding) => {
            patchMap({ encoding });
          }}
        />
      </CollapsibleSection>
      <CollapsibleSection title={t('graph.section.bundling')}>
        <BundlingControls
          settings={map.bundling}
          view={bundlingView}
          controller={mapBundlingController}
          onChange={(bundling) => {
            patchMap({ bundling });
          }}
        />
      </CollapsibleSection>
      <CollapsibleSection title={t('map.labels')}>
        <Field label={t('map.labels')}>
          <select
            value={map.labels}
            onChange={(e) => {
              const labels = MAP_LABELS.find((mode) => mode === e.currentTarget.value);
              if (labels !== undefined) patchMap({ labels });
            }}
          >
            {MAP_LABELS.map((mode) => (
              <option key={mode} value={mode}>
                {t(`map.labels.${mode}`)}
              </option>
            ))}
          </select>
        </Field>
      </CollapsibleSection>
    </>
  );
}
