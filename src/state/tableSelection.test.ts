import { describe, expect, it } from 'vitest';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createSelectionStore } from './selectionStore';
import { isEdgeItem, isRowSelected, selectRow } from './tableSelection';

// テストの前提として在るはずの値を取り出す。無ければ失敗にする。
function must<T>(x: T | undefined): T {
  if (x === undefined) throw new Error('テストの前提が崩れています');
  return x;
}

const dataset = sampleDataset();
const p1 = must(dataset.nodes[0]);
const p2 = must(dataset.nodes[1]);
const e3 = must(dataset.edges.find((e) => e.id === 'e3'));

describe('表の行と選択', () => {
  it('FR-TB-02: ノードの行を選ぶと selectionStore に入り、もう一度選ぶと解除される', () => {
    const store = createSelectionStore();
    selectRow(store, p1, false);
    expect([...store.getState().nodes]).toEqual([p1.id]);
    expect(isRowSelected(store.getState(), p1)).toBe(true);
    expect(isRowSelected(store.getState(), p2)).toBe(false);
    selectRow(store, p2, false); // 置き換え
    expect([...store.getState().nodes]).toEqual([p2.id]);
    selectRow(store, p2, false); // 解除
    expect(store.getState().nodes.size).toBe(0);
  });

  it('FR-TB-02: 追加の操作は選択に加え、選択中の行は外す', () => {
    const store = createSelectionStore();
    selectRow(store, p1, true);
    selectRow(store, p2, true);
    expect(store.getState().nodes.size).toBe(2);
    selectRow(store, p1, true);
    expect([...store.getState().nodes]).toEqual([p2.id]);
  });

  it('FR-TB-02: エッジの行は元のエッジ ID と両端のノードを選び、エッジ表の強調はエッジ ID で決まる', () => {
    const store = createSelectionStore();
    selectRow(store, e3, false);
    expect(isEdgeItem(e3)).toBe(true);
    expect([...store.getState().edges]).toEqual([e3.id]);
    expect([...store.getState().nodes].sort()).toEqual([e3.source, e3.target].sort());
    // 両端のノードの行は、ノード表で強調される。別のエッジ（同じ端点でも）は強調されない。
    expect(isRowSelected(store.getState(), p1)).toBe(true);
    const e4 = must(dataset.edges.find((e) => e.id === 'e4'));
    expect(isRowSelected(store.getState(), e4)).toBe(false);
  });

  it('FR-TB-02: 図で選んだノード（nodes だけ）は、ノード表で強調され、エッジ表では強調されない', () => {
    const store = createSelectionStore();
    store.getState().select({ nodes: [p1.id] });
    expect(isRowSelected(store.getState(), p1)).toBe(true);
    expect(isRowSelected(store.getState(), e3)).toBe(false);
  });
});
