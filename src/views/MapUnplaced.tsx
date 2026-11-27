import { useId, useState } from 'react';
import type { MapPlacement } from '../state';
import { UNPLACED_REASONS } from '../state';
import type { NodeId } from '../core/model';
import { useT, useUi } from './hooks';
import { getNumberFormat } from './intl';

/** 1 つの理由で一覧に並べる件数の上限。数千件の座標なしで画面が重くならないように（残りは件数だけ示す）。 */
const MAX_LISTED = 200;

/** {@link MapUnplaced} の props。 */
interface Props {
  readonly placement: MapPlacement;
  /** 一覧のノードを押したとき（選択に入る。グラフの選択中のカードと表に出る。選択中なら外れる）。 */
  readonly onPick: (id: NodeId) => void;
  /** いま選択中のノード。選択中の行は、色だけでなく印でも示す。 */
  readonly selected: ReadonlySet<NodeId>;
}

/**
 * 「地図に載らないノード N 件」の開閉できる一覧（地図の左下。FR-MP-05、D-60）。
 *
 * 理由ごと（座標の列が無い型、欠損、不正な値、範囲外）に分けて数え、端のノードが載らないために描けない
 * エッジの件数も示す。対象は絞り込み後の表示中のノード（絞り込むと件数も変わる）。
 * 【なぜ】座標のないノードを黙って落とさない。歴史資料では、座標が分からない人物や地名のほうが普通にあるため、
 * 「どれが載っていないか」を選んで確かめられるようにする。
 *
 * @param props - 仕分けの結果、選んだときの処理、選択中のノード
 * @returns 一覧。載らないノードもエッジも無ければ null
 */
export function MapUnplaced({ placement, onPick, selected }: Props) {
  const t = useT();
  const locale = useUi((s) => s.locale);
  const nf = getNumberFormat(locale);
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const total = placement.unplaced.length;
  if (total === 0 && placement.edgesWithoutCoordinates === 0) return null;
  return (
    <section className="map-unplaced" aria-label={t('map.unplaced.region')}>
      <button
        type="button"
        className="map-unplaced-toggle"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>{' '}
        {t('map.unplaced.summary', { count: nf.format(total) })}
      </button>
      <div id={bodyId} className="map-unplaced-body" hidden={!open}>
        {UNPLACED_REASONS.map((reason) => {
          const items = placement.unplaced.filter((u) => u.reason === reason);
          if (items.length === 0) return null;
          return (
            <section key={reason} data-reason={reason}>
              <h4>{t(`map.unplaced.reason.${reason}`, { count: nf.format(items.length) })}</h4>
              <ul>
                {items.slice(0, MAX_LISTED).map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      aria-label={t('map.unplaced.pick', { name: u.label })}
                      aria-pressed={selected.has(u.id)}
                      onClick={() => {
                        onPick(u.id);
                      }}
                    >
                      {/* 【なぜ】ラベルはアラビア文字などの右から左の文字も含むので、向きを隔離する（NFR-09）。 */}
                      <bdi>{u.label}</bdi>
                    </button>
                  </li>
                ))}
              </ul>
              {items.length > MAX_LISTED && (
                <p className="rl-section-note">
                  {t('map.unplaced.more', { count: nf.format(items.length - MAX_LISTED) })}
                </p>
              )}
            </section>
          );
        })}
        {placement.edgesWithoutCoordinates > 0 && (
          <p data-testid="map-unplaced-edges">
            {t('map.unplaced.edges', {
              count: nf.format(placement.edgesWithoutCoordinates),
              total: nf.format(placement.edgeTotal),
            })}
          </p>
        )}
      </div>
    </section>
  );
}
