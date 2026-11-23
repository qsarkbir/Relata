import { describe, expect, it } from 'vitest';
import type { Dataset } from '../model';
import { gregorianToJdn } from '../time';
import { MAX_TIMELINE_BINS } from '../filter';
import { mkNode, person, span } from '../filter/fixtures/filterDataset';
import { countMissingByPeriod } from './index';

const g = (y: number, m = 1, d = 1): number => gregorianToJdn(y, m, d);
const yearSpan = (y: number) => span(g(y, 1, 1), g(y, 12, 31));
const lost = { kind: 'missing', reason: 'lost' } as const;
const unrec = { kind: 'missing', reason: 'unrecorded' } as const;
const val = { kind: 'value', value: 'x' } as const;

const ds: Dataset = {
  graphMode: 'directed',
  nodeTypes: [{ id: person, label: 'person' }],
  nodes: [
    // a: 1505 年、生年あり
    mkNode('a', person, 'A', [['born', val]], { kind: 'span', start: yearSpan(1505) }),
    // b: 1498〜1512 年の幅（1490 年代と 1500 年代と 1510 年代にまたがる）、生年は欠損（失われた）
    mkNode('b', person, 'B', [['born', lost]], {
      kind: 'span',
      start: span(g(1498), g(1512, 12, 31)),
    }),
    // c: 1505 年、キーなし
    mkNode('c', person, 'C', [], { kind: 'span', start: yearSpan(1505) }),
    // d: 年代なし、欠損
    mkNode('d', person, 'D', [['born', unrec]]),
    // e: 不整合（終了が開始より前）
    mkNode('e', person, 'E', [['born', lost]], {
      kind: 'span',
      start: yearSpan(1600),
      end: yearSpan(1500),
    }),
  ],
  edges: [],
  schema: [{ key: 'born', label: '生年', appliesTo: 'node', valueType: 'string' }],
  meta: { title: 't' },
};
const all = new Set(ds.nodes.map((n) => n.id as string));
const run = (ids: ReadonlySet<string> = all, width: 10 | 100 = 10) =>
  countMissingByPeriod(ds, 'node', ids, { kind: 'span' }, 'gregorian', width);

describe('FR-VG-12: 時期ごとの欠損率', () => {
  it('FR-VG-12: 幅のある要素は、またがる区切りのすべてに数える。要素のある区切りだけが行になる', () => {
    const r = run();
    expect(r.rows.map((x) => x.startYear)).toEqual([1490, 1500, 1510]);
    // 1500 年代: a（あり）、b（失われた）、c（キーなし）→ 分母 3
    const row = r.rows[1]?.counts[0];
    expect(row).toMatchObject({ total: 3, present: 1, missing: 1, absent: 1 });
    expect(row?.byReason.lost).toBe(1);
    // 1490 年代は b だけ。
    expect(r.rows[0]?.counts[0]).toMatchObject({ total: 1, missing: 1 });
    expect(r.attrs.map((a) => a.key)).toEqual(['born']);
  });
  it('FR-VG-12: 年代なしと不整合な期間は、区切りとは別の行に数える', () => {
    const r = run();
    expect(r.noDate.items).toBe(1);
    expect(r.noDate.counts[0]?.byReason.unrecorded).toBe(1);
    expect(r.inconsistent.items).toBe(1);
    expect(r.inconsistent.counts[0]?.byReason.lost).toBe(1);
  });
  it('FR-VG-12: 絞り込み後の集合だけで数え直す', () => {
    const r = run(new Set(['a', 'd']));
    expect(r.shownItems).toBe(2);
    expect(r.rows.map((x) => x.startYear)).toEqual([1500]);
    expect(r.inconsistent.items).toBe(0);
  });
  it('FR-VG-12: 絞り込みで 0 件なら、行は無く shownItems が 0', () => {
    const r = run(new Set());
    expect(r.shownItems).toBe(0);
    expect(r.rows).toEqual([]);
    expect(r.tooManyBins).toBe(false);
  });
  it('FR-VG-12: 区切りが年表の上限を超えるときは、集計せず知らせる', () => {
    const far: Dataset = {
      ...ds,
      nodes: [
        mkNode('x', person, 'X', [], { kind: 'span', start: yearSpan(1) }),
        mkNode('y', person, 'Y', [], {
          kind: 'span',
          start: yearSpan(MAX_TIMELINE_BINS * 10 + 100),
        }),
      ],
    };
    const r = countMissingByPeriod(
      far,
      'node',
      new Set(['x', 'y']),
      { kind: 'span' },
      'gregorian',
      1,
    );
    expect(r.tooManyBins).toBe(true);
    expect(r.rows).toEqual([]);
  });
});
