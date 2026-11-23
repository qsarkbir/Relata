/**
 * 表の行と選択（selectionStore）の橋渡し（FR-TB-02）。
 *
 * 選択の状態は selectionStore だけに持つ。表は別の選択を持たず、ここの関数で読み書きする。
 */
import type { StoreApi } from 'zustand/vanilla';
import type { GraphEdge } from '../core/model';
import type { SelectionSets, SelectionState } from './selectionStore';
import type { TableItem } from './tableModel';

/**
 * 行がエッジかを判定する型ガード。
 *
 * @param row - 表の行
 * @returns エッジなら true
 */
// 【TS】`row is GraphEdge` は型ガード。true の分岐では、row を GraphEdge として扱える。
//       ノードは `source` を持たないので、`in` 演算子で見分けられる。
export function isEdgeItem(row: TableItem): row is GraphEdge {
  return 'source' in row;
}

/**
 * 行が選択されているか。ノード表の行はノード ID、エッジ表の行は元のエッジ ID で照合する（D-40）。
 *
 * @param selection - 選択の集合
 * @param row - 表の行
 * @returns 選択中なら true
 */
export function isRowSelected(selection: SelectionSets, row: TableItem): boolean {
  return isEdgeItem(row) ? selection.edges.has(row.id) : selection.nodes.has(row.id);
}

/**
 * 表の行を選ぶ（FR-TB-02）。
 *
 * - 通常: その行だけを選ぶ。すでにその行だけが選ばれていれば解除する。
 * - 追加（Ctrl、Cmd、Shift を押したクリック）: その行を選択に加える。選択中なら外す。
 *
 * エッジの行を選ぶと、両端のノードも選択に入れる。図は選択中のノードを強調し、選択中のカードも
 * ノードを表示するので、エッジを選んだときに図で見つかるようにするため。
 *
 * @param selection - 選択のストア
 * @param row - 選ぶ行
 * @param additive - 追加の操作か
 */
export function selectRow(
  selection: StoreApi<SelectionState>,
  row: TableItem,
  additive: boolean,
): void {
  const state = selection.getState();
  const selected = isRowSelected(state, row);
  const parts = isEdgeItem(row)
    ? { nodes: [row.source, row.target], edges: [row.id] }
    : { nodes: [row.id], edges: [] };
  if (additive) {
    if (selected) state.remove(parts);
    else state.add(parts);
    return;
  }
  const only = isEdgeItem(row)
    ? state.edges.size === 1 && selected
    : state.nodes.size === 1 && selected;
  if (only) state.clear();
  else state.select(parts);
}
