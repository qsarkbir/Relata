import { useEffect, useMemo, useRef, useState } from 'react';
import { countNoCoordinates, resolveColumnOrder } from '../core/layout';
import { useStore } from 'zustand';
import {
  effectiveGeoAttrs,
  geoCandidates,
  geoInputsFor,
  needsGeoChoice,
  resolveGeoSelection,
} from './geoInputs';
import { mapViewStore } from '../state';
import { resolveGeoSource } from '../core/project';
import type { Dataset } from '../core/model';
import type { RelataGraph } from '../core/graph';
import type { GraphViewSettings } from '../core/project';
import { useT } from './hooks';
import { Field } from './ui/Field';

/** {@link NoCoordinatesNote} の props。 */
interface NoteProps {
  readonly dataset: Dataset;
  readonly graph: RelataGraph;
  readonly view: GraphViewSettings;
}

/**
 * 地理座標の配置で、座標なしの列に置いたノードの件数を示す（FR-VG-02）。
 * 緯度・経度が両方そろうまでは、選ぶよう促す（その間は配置を計算しない）。
 *
 * 【なぜ】絞り込みで除いた件数とは別の文言にする。座標なしのノードは図から消えず、端の列にある。
 * @param props - データ、表示中のグラフ、表示の設定
 * @returns 件数の文。地理座標の配置でない、またはグラフが空なら null
 */
export function NoCoordinatesNote({ dataset, graph, view }: NoteProps) {
  const t = useT();
  // 【なぜ】座標の出どころは地図と共通の設定（`view.geoSource`。D-46）。無ければ旧版の `geoAttrs` を読み替える。
  const geoSource = useStore(mapViewStore, (s) => s.geoSource);
  const source = useMemo(() => resolveGeoSource(geoSource, view), [geoSource, view]);
  const ready = !needsGeoChoice(dataset, source);
  const count = useMemo(
    () =>
      view.layout === 'geo' && ready ? countNoCoordinates(geoInputsFor(dataset, graph, source)) : 0,
    [dataset, graph, view.layout, source, ready],
  );
  if (view.layout !== 'geo' || graph.order === 0) return null;
  return (
    <p className="graph-no-coordinates" role="status" data-testid="no-coordinates">
      {!ready ? t('graph.geo.choose') : t('graph.noCoordinates', { count })}
    </p>
  );
}

/** {@link LayoutMethodControls} の props。 */
interface ControlsProps extends NoteProps {
  /** 設定を変えたあと、配置を計算し直す（明示的な操作なので呼ぶ側が始める）。 */
  readonly onChange: (change: Partial<GraphViewSettings>) => void;
}

/**
 * 層状（列の順）と地理座標（緯度・経度の属性）の設定欄。
 *
 * @param props - データ、表示中のグラフ、表示の設定、変更の受け取り先
 * @returns 方式に応じた設定欄。どちらでもなければ null
 */
export function LayoutMethodControls({ dataset, graph, view, onChange }: ControlsProps) {
  const t = useT();
  const geoSource = useStore(mapViewStore, (s) => s.geoSource);
  const list = useRef<HTMLOListElement>(null);
  // 【なぜ】↑↓で端まで動かすとそのボタンが無効になり、フォーカスが失われる。動かした列の、
  // 押せる側のボタンへフォーカスを戻すため、動かした直後の再描画の後に移す。
  const [focusTarget, setFocusTarget] = useState<{ type: string; dir: 'up' | 'down' } | null>(null);
  useEffect(() => {
    if (focusTarget === null || list.current === null) return;
    const row = [...list.current.querySelectorAll('li')].find(
      (li) => li.dataset.type === focusTarget.type,
    );
    const first = row?.querySelector<HTMLButtonElement>(`button[data-dir="${focusTarget.dir}"]`);
    const other = row?.querySelector<HTMLButtonElement>(
      `button[data-dir="${focusTarget.dir === 'up' ? 'down' : 'up'}"]`,
    );
    (first?.disabled === false ? first : other)?.focus();
    setFocusTarget(null);
  }, [focusTarget, view.columnOrder]);
  if (view.layout === 'layered') {
    const present = graph.nodes().map((id) => graph.getNodeAttribute(id, 'type'));
    const order = resolveColumnOrder(present, view.columnOrder ?? []);
    const name = (id: string) => dataset.nodeTypes.find((type) => type.id === id)?.label ?? id;
    const move = (index: number, delta: -1 | 1) => {
      const next = [...order];
      const [item] = next.splice(index, 1);
      if (item === undefined) return;
      next.splice(index + delta, 0, item);
      onChange({ columnOrder: next });
      setFocusTarget({ type: item, dir: delta === -1 ? 'up' : 'down' });
    };
    return (
      <div className="graph-layout-method">
        <p className="rl-section-note">{t('graph.layered.note')}</p>
        {order.length <= 1 && <p className="rl-section-note">{t('graph.layered.single')}</p>}
        <ol className="graph-column-order" aria-label={t('graph.layered.order')} ref={list}>
          {order.map((type, i) => (
            <li key={type} data-type={type}>
              <span className="graph-column-name">
                <bdi>{name(type)}</bdi>
              </span>
              <button
                type="button"
                data-dir="up"
                disabled={i === 0}
                aria-label={t('graph.layered.up', { name: name(type) })}
                onClick={() => {
                  move(i, -1);
                }}
              >
                ↑
              </button>
              <button
                type="button"
                data-dir="down"
                disabled={i === order.length - 1}
                aria-label={t('graph.layered.down', { name: name(type) })}
                onClick={() => {
                  move(i, 1);
                }}
              >
                ↓
              </button>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (view.layout === 'geo') {
    const candidates = geoCandidates(dataset);
    const selection = resolveGeoSelection(dataset, effectiveGeoAttrs(geoSource, view.geoAttrs));
    const select = (which: 'lat' | 'lon') => {
      const label = t(which === 'lat' ? 'graph.geo.lat' : 'graph.geo.lon');
      return (
        <Field label={label}>
          <select
            aria-label={label}
            value={selection[which] ?? ''}
            onChange={(e) => {
              const value = e.currentTarget.value;
              // 【なぜ】選んでいない側は項目ごと省く（空の文字列は保存しない）。画面に出ている有効な選択だけを引き継ぐ。
              const lat = which === 'lat' ? value : selection.lat;
              const lon = which === 'lon' ? value : selection.lon;
              const next = {
                ...(lat === undefined || lat === '' ? {} : { lat }),
                ...(lon === undefined || lon === '' ? {} : { lon }),
              };
              // 【なぜ】両方とも未選択に戻したら、空のオブジェクトではなく項目ごと消す（保存の形と揃える）。
              //       JSON に書き出すとき、値が undefined の項目は省かれる。
              // 【なぜ】両方そろったら、地図と共通の出どころ（`view.geoSource`）に書く。片方だけの間は出どころを
              //   決めず（undefined）、旧版と同じく `geoAttrs` に残す。
              mapViewStore
                .getState()
                .setGeoSource(
                  lat !== undefined && lat !== '' && lon !== undefined && lon !== ''
                    ? { kind: 'attrs', lat, lon }
                    : undefined,
                );
              onChange({ geoAttrs: Object.keys(next).length === 0 ? undefined : next });
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
      <div className="graph-layout-method">
        <p className="rl-section-note">{t('graph.geo.note')}</p>
        {selection.missing && (
          <p className="rl-section-note" role="alert">
            {t('graph.geo.notFound')}
          </p>
        )}
        {select('lat')}
        {select('lon')}
      </div>
    );
  }
  return null;
}
