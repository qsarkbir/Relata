import { describe, expect, it } from 'vitest';
import { DEFAULT_TABLE_VIEW, DEFAULT_WORKSPACE } from '../core/project';
import { toNodeId } from '../core/model';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createDataStore } from './dataStore';
import { bindFilterToData, createFilterStore } from './filterStore';
import { applySnapshot, takeSnapshot } from './project';
import { createSelectionStore } from './selectionStore';
import { bindWorkspaceToData, createWorkspaceStore } from './workspaceStore';

function stores() {
  const data = createDataStore();
  const filter = createFilterStore();
  bindFilterToData(filter, data);
  const workspace = createWorkspaceStore();
  bindWorkspaceToData(workspace, data);
  return { data, filter, workspace };
}

describe('workspaceStore', () => {
  it('FR-UI-02: 高さは範囲に収める', () => {
    const { workspace } = stores();
    workspace.getState().patchWorkspace({ height: 5 });
    expect(workspace.getState().workspace.height).toBe(120);
    workspace.getState().patchWorkspace({ height: 99999 });
    expect(workspace.getState().workspace.height).toBe(800);
  });

  it('FR-UI-02: 開閉やタブの切り替えは、フィルタ、選択、表の並べ替えを変えない', () => {
    const { data, filter, workspace } = stores();
    data.getState().setDataset(sampleDataset());
    const selection = createSelectionStore();
    selection.getState().select({ nodes: [sampleDataset().nodes[0]?.id ?? toNodeId('x')] });
    workspace.getState().patchTable({
      node: { sort: { column: 'label', direction: 'desc' }, columns: null },
    });
    const before = {
      filter: filter.getState().history.present,
      selection: selection.getState().nodes,
      table: workspace.getState().table,
    };
    workspace.getState().patchWorkspace({ open: true });
    workspace.getState().patchWorkspace({ tab: 'table' });
    workspace.getState().patchWorkspace({ open: false });
    expect(filter.getState().history.present).toBe(before.filter);
    expect(selection.getState().nodes).toBe(before.selection);
    expect(workspace.getState().table).toBe(before.table);
  });

  it('FR-TB-01: データを置き換えたときだけ初期化する', () => {
    const { data, workspace } = stores();
    workspace.getState().patchTable({ target: 'edge' });
    workspace.getState().patchWorkspace({ open: true });
    expect(workspace.getState().table.target).toBe('edge');
    data.getState().setDataset(sampleDataset());
    expect(workspace.getState().table).toBe(DEFAULT_TABLE_VIEW);
    expect(workspace.getState().workspace).toBe(DEFAULT_WORKSPACE);
  });
});

describe('保存と読み込みのスナップショット', () => {
  it('FR-UI-02: 既定のままなら書かず、変えると保存され、読み込むと戻る', () => {
    const { data, filter, workspace } = stores();
    data.getState().setDataset(sampleDataset());
    const plain = takeSnapshot(data, filter, undefined, workspace);
    expect(plain?.view.table).toBeUndefined();
    expect(plain?.view.workspace).toBeUndefined();
    workspace.getState().patchTable({ target: 'edge' });
    workspace.getState().patchWorkspace({ open: true, height: 410 });
    const snap = takeSnapshot(data, filter, undefined, workspace);
    expect(snap?.view.table?.target).toBe('edge');
    expect(snap?.view.workspace).toEqual({ tab: 'table', open: true, height: 410 });
    if (snap === null) throw new Error('snapshot');

    // 別のストアへ読み込むと、設定が戻る。
    const other = stores();
    applySnapshot(snap, other.data, other.filter, undefined, other.workspace);
    expect(other.workspace.getState().table.target).toBe('edge');
    expect(other.workspace.getState().workspace.height).toBe(410);
    // 項目の無い（版 1 や古い版 2 の）ファイルを読むと、前の設定を残さず既定に戻る。
    const viewWithout = { filter: snap.view.filter };
    applySnapshot(
      { ...snap, view: viewWithout },
      other.data,
      other.filter,
      undefined,
      other.workspace,
    );
    expect(other.workspace.getState().table).toBe(DEFAULT_TABLE_VIEW);
    expect(other.workspace.getState().workspace).toBe(DEFAULT_WORKSPACE);
  });
});
