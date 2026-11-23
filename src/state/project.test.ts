import { describe, expect, it } from 'vitest';
import { toFilterId } from '../core/filter';
import type { FilterDef } from '../core/filter';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createDataStore, EMPTY_IMPORT_SETTINGS } from './dataStore';
import { bindFilterToData, createFilterStore, selectFilterState } from './filterStore';
import { createDisplayStore } from './displayStore';
import { applySnapshot, takeSnapshot } from './project';

const f: FilterDef = {
  id: toFilterId('a'),
  kind: 'category',
  target: 'node',
  attr: 'role',
  include: [{ kind: 'value', value: 'qadi' }],
};

function stores() {
  const data = createDataStore();
  const filter = createFilterStore();
  bindFilterToData(filter, data); // 本番と同じ結びつき（setDataset でフィルタを初期化する）
  return { data, filter };
}

describe('state/project', () => {
  it('FR-IN-08: setDataset の後に reset するので、保存したフィルタが消えない', () => {
    const { data, filter } = stores();
    const src = createFilterStore();
    src.getState().add(f);
    applySnapshot(
      {
        dataset: sampleDataset(),
        importSettings: { missingTokens: [], columnCalendars: [], encoding: 'utf-8' },
        view: { filter: selectFilterState(src.getState()) },
      },
      data,
      filter,
    );
    expect(selectFilterState(filter.getState()).filters).toHaveLength(1);
    expect(data.getState().importSettings.encoding).toBe('utf-8');
    expect(data.getState().dataset).not.toBeNull();
  });

  it('FR-IN-08: loadDataset はデータと設定を 1 回の更新で入れる', () => {
    const data = createDataStore();
    let updates = 0;
    data.subscribe(() => updates++);
    data.getState().loadDataset(sampleDataset(), { missingTokens: [], columnCalendars: [] });
    expect(updates).toBe(1);
  });

  it('FR-PJ-01: データが無ければスナップショットは null、あれば現在の状態を返す', () => {
    const { data, filter } = stores();
    expect(takeSnapshot(data, filter)).toBeNull();
    data.getState().setDataset(sampleDataset());
    filter.getState().add(f);
    const snap = takeSnapshot(data, filter);
    expect(snap?.view.filter.filters).toHaveLength(1);
    expect(snap?.importSettings).toBe(EMPTY_IMPORT_SETTINGS);
  });

  it('FR-TM-09: 表示の暦をスナップショットに入れ、読み込みで戻す。無ければ既定の西暦', () => {
    const { data, filter } = stores();
    const display = createDisplayStore('both');
    data.getState().setDataset(sampleDataset());
    const snap = takeSnapshot(data, filter, { display });
    expect(snap?.view.display).toEqual({ calendar: 'both' });
    const other = createDisplayStore('gregorian');
    if (snap !== null) applySnapshot(snap, data, filter, { display: other });
    expect(other.getState().calendar).toBe('both');
    // display の無いプロジェクト（古いファイル）は既定の西暦に戻す。
    const old = takeSnapshot(data, filter);
    if (old !== null) applySnapshot(old, data, filter, { display: other });
    expect(other.getState().calendar).toBe('gregorian');
  });
});
