import type { NodeId } from '../core/model';
import { filterStore } from '../state';
import { getNumberFormat } from './intl';
import { useT, useUi } from './hooks';
import { NODE_SET_FILTER_ID } from './filter/filterIds';

/** 一覧に出すノードの最大数。多いと選択中のカードが画面を覆うため、残りは件数で示す。 */
const MAX_LISTED = 8;

/**
 * 複数選択の要約と、「選択したノードで絞り込む」ボタン（FR-FL-11、D-41）。
 *
 * 範囲選択（選ぶ）と絞り込み（条件にする）を分ける。ボタンを押したときだけ `nodeSet` を足す。
 * 足したあとの選択は残す（解除は別の操作）。
 *
 * @param props - ids: 選択中のノード ID
 *   nodeLabel: ID から表示名を引く関数
 *   isVisible: ID のノードが今の図に出ているか
 * @returns 要約の要素
 */
export function RangeSelectSummary(props: {
  readonly ids: ReadonlySet<NodeId>;
  readonly nodeLabel: (id: NodeId) => string;
  readonly isVisible: (id: NodeId) => boolean;
}) {
  const t = useT();
  const nf = getNumberFormat(useUi((s) => s.locale));
  const ids = [...props.ids];
  const listed = ids.slice(0, MAX_LISTED);
  return (
    <div className="graph-range-summary">
      <p>{t('graph.selection.count', { count: nf.format(ids.length) })}</p>
      <ul>
        {listed.map((id) => (
          <li key={id}>
            <bdi>{props.nodeLabel(id)}</bdi>
            {!props.isVisible(id) && <> ({t('graph.selection.hiddenShort')})</>}
          </li>
        ))}
      </ul>
      {ids.length > listed.length && (
        <p>{t('graph.selection.listMore', { count: nf.format(ids.length - listed.length) })}</p>
      )}
      <button
        type="button"
        onClick={() => {
          filterStore.getState().add({ id: NODE_SET_FILTER_ID, kind: 'nodeSet', include: ids });
        }}
      >
        {t('graph.selection.filter')}
      </button>
    </div>
  );
}
