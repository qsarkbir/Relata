import type { NodeId, NodeTypeId } from '../core/model';
import { filterStore, selectFilterState } from '../state';
import { getNumberFormat } from './intl';
import { useFilter, useT, useUi } from './hooks';
import { NODE_SET_FILTER_ID } from './filter/filterIds';
import { tRich } from './richText';

/** 一覧に出すノードの最大数。多いと選択中のカードが画面を覆うため、残りは件数で示す。 */
const MAX_LISTED = 8;

// 2 つの一覧が、順序と重複を無視して同じ集合か。
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}

/**
 * 選択したノードの要約（2 件以上のとき）と、「選択したノードで絞り込む」ボタン（FR-FL-11、D-41）。
 *
 * 範囲選択（選ぶ）と絞り込み（条件にする）を分ける。ボタンを押したときだけ `nodeSet` を足す。
 * 足したあとの選択は残す（解除は別の操作）。今のフィルタと同じ内容なら、履歴を積まないようボタンを無効にする。
 *
 * @param props - 次の項目
 *  - ids: 選択中のノード ID
 *  - nodeLabel: ID から表示名を引く関数
 *  - isVisible: ID のノードが今の図に出ているか
 *  - passTypes: 射影の適用中に、常に通す型（仲介の型）。無ければ空
 *  - typeLabel: 型 ID から表示名を引く関数
 * @returns 要約の要素
 */
export function RangeSelectSummary(props: {
  readonly ids: ReadonlySet<NodeId>;
  readonly nodeLabel: (id: NodeId) => string;
  readonly isVisible: (id: NodeId) => boolean;
  readonly unavailableLabel?: (id: NodeId) => string | undefined;
  readonly passTypes: readonly NodeTypeId[];
  readonly typeLabel: (id: NodeTypeId) => string;
}) {
  const t = useT();
  const nf = getNumberFormat(useUi((s) => s.locale));
  const current = useFilter((s) =>
    selectFilterState(s).filters.find((f) => f.id === NODE_SET_FILTER_ID),
  );
  const ids = [...props.ids];
  const listed = ids.slice(0, MAX_LISTED);
  // 【なぜ】同じ内容を押し直すと、変化の無い履歴が積まれて Redo が消える。集合として同じなら押せなくする。
  const applied =
    current?.kind === 'nodeSet' &&
    sameSet(current.include, ids) &&
    sameSet(current.passTypes ?? [], props.passTypes);
  const hasHidden = ids.some((id) => !props.isVisible(id));
  return (
    <div className="graph-range-summary">
      {ids.length > 1 && (
        <>
          <ul>
            {listed.map((id) => {
              const note =
                props.unavailableLabel?.(id) ??
                (props.isVisible(id) ? undefined : t('graph.selection.hiddenShort'));
              return (
                <li key={id}>
                  <bdi>{props.nodeLabel(id)}</bdi>
                  {note !== undefined && <> ({note})</>}
                </li>
              );
            })}
          </ul>
          {ids.length > listed.length && (
            <p>{t('graph.selection.listMore', { count: nf.format(ids.length - listed.length) })}</p>
          )}
        </>
      )}
      <button
        type="button"
        disabled={applied}
        onClick={() => {
          filterStore.getState().add({
            id: NODE_SET_FILTER_ID,
            kind: 'nodeSet',
            include: ids,
            ...(props.passTypes.length > 0 ? { passTypes: props.passTypes } : {}),
          });
        }}
      >
        {t(applied ? 'graph.selection.filterApplied' : 'graph.selection.filter')}
      </button>
      {props.passTypes.length > 0 && (
        <p>
          {tRich(
            t,
            'graph.selection.passNote',
            {},
            { types: props.passTypes.map(props.typeLabel).join(', ') },
          )}
        </p>
      )}
      {hasHidden && <p>{t('graph.selection.filterNote')}</p>}
    </div>
  );
}
