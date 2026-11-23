import { describe, expect, it } from 'vitest';
import { toFilterId } from '../core/filter';
import type { FilterDef } from '../core/filter';
import { sampleDataset } from '../core/model/fixtures/sampleDataset';
import { createDataStore, EMPTY_IMPORT_SETTINGS } from './dataStore';
import { bindFilterToData, createFilterStore, selectFilterState } from './filterStore';
import { createDisplayStore } from './displayStore';
import { bindTimelineToData, createTimelineStore } from './timelineStore';
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

  it('FR-TM-01: 年表の設定をスナップショットに入れ、読み込みで戻す。既定なら書かない、無ければ既定', () => {
    const { data, filter } = stores();
    const timeline = createTimelineStore();
    bindTimelineToData(timeline, data);
    data.getState().setDataset(sampleDataset());
    expect(takeSnapshot(data, filter, { timeline })?.view.timeline).toBeUndefined();
    timeline.getState().patchTimeline({ width: 100, node: { kind: 'attr', attr: 'born' } });
    const snap = takeSnapshot(data, filter, { timeline });
    expect(snap?.view.timeline).toEqual({
      target: 'node',
      width: 100,
      node: { kind: 'attr', attr: 'born' },
      edge: null,
    });
    const other = createTimelineStore();
    if (snap !== null) applySnapshot(snap, data, filter, { timeline: other });
    expect(other.getState().timeline).toEqual(snap?.view.timeline);
    // timeline の無いプロジェクト（古いファイル）は既定に戻す。
    const old = takeSnapshot(data, filter);
    if (old !== null) applySnapshot(old, data, filter, { timeline: other });
    expect(other.getState().timeline.width).toBe(10);
  });

  it('FR-TM-01: データを置き換えると、年表の出どころは選び直しに戻り、幅は保つ', () => {
    const { data } = stores();
    const timeline = createTimelineStore();
    bindTimelineToData(timeline, data);
    timeline.getState().patchTimeline({ width: 25, node: { kind: 'attr', attr: 'born' } });
    data.getState().setDataset(sampleDataset());
    expect(timeline.getState().timeline).toMatchObject({ width: 25, node: null, edge: null });
  });
});
