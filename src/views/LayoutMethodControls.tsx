import { useMemo } from 'react';
import { countNoCoordinates, resolveColumnOrder } from '../core/layout';
import { geoInputsFor } from './geoInputs';
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
 *
 * 【なぜ】絞り込みで除いた件数とは別の文言にする。座標なしのノードは図から消えず、端の列にある。
 * @param props - データ、表示中のグラフ、表示の設定
 * @returns 件数の文。地理座標の配置でなければ null
 */
export function NoCoordinatesNote({ dataset, graph, view }: NoteProps) {
  const t = useT();
  const count = useMemo(
    () =>
      view.layout === 'geo' ? countNoCoordinates(geoInputsFor(dataset, graph, view.geoAttrs)) : 0,
    [dataset, graph, view.layout, view.geoAttrs],
  );
  if (view.layout !== 'geo') return null;
  return (
    <p className="graph-no-coordinates" role="status" data-testid="no-coordinates">
      {t('graph.noCoordinates', { count })}
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
    };
    return (
      <div className="graph-layout-method">
        <p className="rl-section-note">{t('graph.layered.note')}</p>
        {order.length <= 1 && <p className="rl-section-note">{t('graph.layered.single')}</p>}
        <ol className="graph-column-order" aria-label={t('graph.layered.order')}>
          {order.map((type, i) => (
            <li key={type}>
              <span className="graph-column-name">
                <bdi>{name(type)}</bdi>
              </span>
              <button
                type="button"
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
    // 【なぜ】数値の属性を先に並べる。緯度・経度は数値の列のことが多いが、文字列として読み込まれた
    // 列（"33.3"）も使えるので、日付と真偽値以外の属性を選べるようにする。
    const candidates = dataset.schema
      .filter((a) => a.appliesTo === 'node' && a.valueType !== 'date' && a.valueType !== 'boolean')
      .sort((a, b) => Number(b.valueType === 'number') - Number(a.valueType === 'number'));
    const select = (which: 'lat' | 'lon') => {
      const current = view.geoAttrs?.[which] ?? '';
      return (
        <Field label={t(which === 'lat' ? 'graph.geo.lat' : 'graph.geo.lon')}>
          <select
            aria-label={t(which === 'lat' ? 'graph.geo.lat' : 'graph.geo.lon')}
            value={current}
            onChange={(e) => {
              const value = e.currentTarget.value;
              const other = view.geoAttrs?.[which === 'lat' ? 'lon' : 'lat'] ?? '';
              onChange({
                geoAttrs: which === 'lat' ? { lat: value, lon: other } : { lat: other, lon: value },
              });
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
        {select('lat')}
        {select('lon')}
      </div>
    );
  }
  return null;
}
