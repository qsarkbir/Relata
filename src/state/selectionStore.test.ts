import { describe, expect, it } from 'vitest';
import { toEdgeId, toNodeId } from '../core/model';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createDataStore } from './dataStore';
import { bindSelectionToData, createSelectionStore } from './selectionStore';

const a = toNodeId('a');
const b = toNodeId('b');
const e1 = toEdgeId('e1');

describe('selectionStore', () => {
  it('FR-VG-09: select は選択を置き換え、省略した側は空になる', () => {
    const s = createSelectionStore();
    s.getState().select({ nodes: [a], edges: [e1] });
    s.getState().select({ nodes: [b] });
    expect([...s.getState().nodes]).toEqual([b]);
    expect(s.getState().edges.size).toBe(0);
  });

  it('FR-VG-09: add は加え、remove は外し、clear はすべて解除する', () => {
    const s = createSelectionStore();
    s.getState().add({ nodes: [a] });
    s.getState().add({ nodes: [b], edges: [e1] });
    expect([...s.getState().nodes]).toEqual([a, b]);
    s.getState().remove({ nodes: [a, toNodeId('none')] });
    expect([...s.getState().nodes]).toEqual([b]);
    s.getState().clear();
    expect(s.getState().nodes.size).toBe(0);
    expect(s.getState().edges.size).toBe(0);
  });

  it('FR-VG-09: 状態は新しい Set で置き換わり、同じ Set を書き換えない', () => {
    const s = createSelectionStore();
    s.getState().add({ nodes: [a] });
    const before = s.getState().nodes;
    s.getState().add({ nodes: [b] });
    expect(s.getState().nodes).not.toBe(before);
    expect(before.size).toBe(1);
  });

  it('FR-VG-09: 空のときの clear は状態を変えない', () => {
    const s = createSelectionStore();
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.getState().clear();
    expect(calls).toBe(0);
  });

  it('FR-VG-09: データを置き換えると選択が空になる', () => {
    const data = createDataStore();
    const s = createSelectionStore();
    bindSelectionToData(s, data);
    s.getState().select({ nodes: [a], edges: [e1] });
    data.getState().setDataset(sampleDataset());
    expect(s.getState().nodes.size).toBe(0);
    expect(s.getState().edges.size).toBe(0);
  });

  it('FR-VG-09: 何も外れない remove は購読を呼ばない', () => {
    const s = createSelectionStore();
    s.getState().add({ nodes: [a] });
    let calls = 0;
    s.subscribe(() => {
      calls += 1;
    });
    s.getState().remove({ nodes: [b] });
    expect(calls).toBe(0);
  });
});
