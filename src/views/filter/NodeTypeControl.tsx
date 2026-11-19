import type { NodeType, NodeTypeId } from '../../core/model';
import { useFilter, useT } from '../hooks';
import type { FilterOfKind } from './activeFilters';
import { DuplicateNotice } from './DuplicateNotice';
import { NODE_TYPE_FILTER_ID } from './filterIds';

/** ノード型の部品の入力。 */
interface NodeTypeControlProps {
  readonly nodeTypes: readonly NodeType[];
  /** いま適用中のノード型の最初のフィルタ（無ければ undefined）。 */
  readonly active: FilterOfKind<'nodeType'> | undefined;
  /** 同じ条件の、2 つ目以降のフィルタの数。 */
  readonly duplicates: number;
}

/**
 * ノード型のフィルタ（FR-FL-02）。チェックした型だけを表示する。
 *
 * チェックの状態は `active`（FilterState のフィルタ）から導き出す。何も選ばなければフィルタを外す。
 *
 * @param props - ノード型の一覧、適用中のフィルタ、重複の数
 * @returns ノード型の選択の要素
 */
export function NodeTypeControl({ nodeTypes, active, duplicates }: NodeTypeControlProps) {
  const t = useT();
  const add = useFilter((s) => s.add);
  const remove = useFilter((s) => s.remove);
  const selected = new Set<NodeTypeId>(active?.include ?? []);

  const toggle = (id: NodeTypeId, on: boolean): void => {
    // 【なぜ】操作は最初のフィルタに対して行う（ID はそのフィルタのもの）。
    const fid = active?.id ?? NODE_TYPE_FILTER_ID;
    const include = on
      ? [...(active?.include ?? []).filter((x) => x !== id), id]
      : (active?.include ?? []).filter((x) => x !== id);
    // 【なぜ】選択が空になったフィルタは外す（空の include は全ノードを除いてしまう。D-21 (2)）。
    if (include.length === 0) remove(fid);
    else add({ id: fid, kind: 'nodeType', include });
  };

  return (
    <fieldset className="node-types">
      <legend>{t('filter.nodeTypes')}</legend>
      <p className="hint">{t('filter.nodeTypes.hint')}</p>
      <DuplicateNotice count={duplicates} />
      <ul className="facet-list">
        {nodeTypes.map((nt) => (
          <li key={nt.id}>
            <label>
              <input
                type="checkbox"
                checked={selected.has(nt.id)}
                onChange={(e) => {
                  toggle(nt.id, e.currentTarget.checked);
                }}
              />
              <bdi>{nt.label}</bdi>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
