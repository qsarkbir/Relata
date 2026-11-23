import { describe, expect, it, vi } from 'vitest';
import { toFilterId } from '../core/filter';
import type { Dataset } from '../core/model';
import { filterDataset, mkNode, person, span } from '../core/filter/fixtures/filterDataset';
import { binDayRange, gregorianToJdn, makeTimeAxis } from '../core/time';
import { createDataStore } from './dataStore';
import { createDisplayStore } from './displayStore';
import { bindFilterToData, createFilterStore } from './filterStore';
import { createGraphViewStore } from './graphViewStore';
import { createTimeFadeStore } from './timeFadeStore';
import { createTimeStore } from './timeStore';
import { createTimelineStore } from './timelineStore';

const g = (y: number): number => gregorianToJdn(y, 1, 1);
const year = (y: number) => span(g(y), gregorianToJdn(y, 12, 31));
const axis = makeTimeAxis(
  'gregorian',
  [1500, 1510, 1520, 1530].map((y) => binDayRange('gregorian', y, 10)),
);

function setup() {
  const data = createDataStore();
  const filter = createFilterStore();
  bindFilterToData(filter, data);
  const time = createTimeStore(() => axis);
  const base = filterDataset();
  const ds: Dataset = {
    ...base,
    nodes: [
      mkNode('p1', person, 'A', [], { kind: 'span', start: year(1505) }),
      mkNode('p2', person, 'B', [], { kind: 'span', start: year(1525) }),
      mkNode('p3', person, 'C', []),
    ],
    edges: [],
  };
  data.getState().setDataset(ds);
  filter.getState().setShowIsolated(true);
  const fade = createTimeFadeStore({
    data,
    filter,
    graphView: createGraphViewStore(),
    timeline: createTimelineStore(),
    display: createDisplayStore(),
    time,
  });
  return { data, filter, time, fade: fade.store };
}

describe('FR-TM-02: 薄くする要素の派生ストア（NFR-05）', () => {
  it('FR-TM-02: 時刻が無ければ何も薄くしない', () => {
    const { fade } = setup();
    expect(fade.getState().nodes.size).toBe(0);
  });
  it('FR-TM-02: 時刻を決めると、時刻の外のノードだけが入る（年代なしは入らない）', () => {
    const { fade, time } = setup();
    time.getState().seek(g(1510));
    expect([...fade.getState().nodes]).toEqual(['p2']);
  });
  it('FR-TM-02: 集合が変わらないコマでは通知しない。変わるときだけ通知する', () => {
    const { fade, time } = setup();
    time.getState().seek(g(1510));
    const listener = vi.fn();
    fade.subscribe(listener);
    const first = fade.getState();
    time.getState().seek(g(1512)); // 同じ集合
    time.getState().seek(g(1518));
    expect(listener).not.toHaveBeenCalled();
    expect(fade.getState()).toBe(first);
    time.getState().seek(g(1526)); // p2 が中に入る
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fade.getState().nodes.size).toBe(0);
  });
  it('FR-TM-02: 移動窓にすると、窓より前に終わったものも入る', () => {
    const { fade, time } = setup();
    time.getState().seek(gregorianToJdn(1525, 6, 1));
    expect(fade.getState().nodes.size).toBe(0);
    time.getState().setMode('window');
    time.getState().setWindowYears(1);
    expect([...fade.getState().nodes]).toEqual(['p1']);
  });
  it('FR-TM-03: フィルタで図から除いたノードは、薄くする集合に入らない', () => {
    const { fade, time, filter } = setup();
    time.getState().seek(g(1510));
    expect(fade.getState().nodes.has('p2')).toBe(true);
    filter.getState().add({
      id: toFilterId('t'),
      kind: 'text',
      target: 'node',
      query: 'A',
      matching: 'loose',
    });
    expect(fade.getState().nodes.has('p2')).toBe(false);
  });
});
