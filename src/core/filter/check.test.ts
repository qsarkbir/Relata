import { describe, expect, it } from 'vitest';
import { checkFilterState } from './check';
import { fid, filterDataset, person, st } from './fixtures/filterDataset';
import { toNodeTypeId } from '../model';
import type { FilterDef } from './types';

const ds = filterDataset();
const cat = (attr: string, target: 'node' | 'edge'): FilterDef => ({
  id: fid('c'),
  kind: 'category',
  target,
  attr,
  include: [{ kind: 'value', value: 'qadi' }],
});

describe('checkFilterState（D-21 (6)）', () => {
  it('FR-FL-08: 問題のない状態は空の一覧を返す', () => {
    expect(
      checkFilterState(
        ds,
        st([
          cat('role', 'node'),
          {
            id: fid('r'),
            kind: 'range',
            target: 'edge',
            attr: 'amount',
            min: 1,
            missing: 'exclude',
          },
          { id: fid('n'), kind: 'nodeType', include: [person] },
          { id: fid('t'), kind: 'text', target: 'node', query: 'x', matching: 'loose' },
        ]),
      ),
    ).toEqual([]);
  });

  it('FR-FL-08: schema に無い属性を指すフィルタを報告する（対象が違う属性も）', () => {
    const issues = checkFilterState(ds, st([cat('nope', 'node'), cat('amount', 'node')]));
    expect(issues).toEqual([
      { kind: 'unknown-attr', filterId: 'c', target: 'node', attr: 'nope' },
      { kind: 'unknown-attr', filterId: 'c', target: 'node', attr: 'amount' },
    ]);
    const range = checkFilterState(
      ds,
      st([{ id: fid('r'), kind: 'range', target: 'node', attr: 'zzz', missing: 'include' }]),
    );
    expect(range).toEqual([{ kind: 'unknown-attr', filterId: 'r', target: 'node', attr: 'zzz' }]);
  });

  it('FR-FL-08: 存在しないノード型を報告する', () => {
    const issues = checkFilterState(
      ds,
      st([{ id: fid('n'), kind: 'nodeType', include: [person, toNodeTypeId('ghost')] }]),
    );
    expect(issues).toEqual([{ kind: 'unknown-node-type', filterId: 'n', nodeType: 'ghost' }]);
  });

  it('FR-FL-08: データに現れないカテゴリの値と欠損の理由を報告する', () => {
    const f: FilterDef = {
      id: fid('c'),
      kind: 'category',
      target: 'node',
      attr: 'role',
      include: [
        { kind: 'value', value: 'qadi' },
        { kind: 'value', value: 'vizier' },
        { kind: 'missing', reason: 'lost' },
        { kind: 'missing', reason: 'illegible' },
      ],
    };
    expect(checkFilterState(ds, st([f]))).toEqual([
      { kind: 'unknown-category', filterId: 'c', key: { kind: 'value', value: 'vizier' } },
      { kind: 'unknown-category', filterId: 'c', key: { kind: 'missing', reason: 'illegible' } },
    ]);
  });

  it('FR-FL-08: 逆転した範囲を報告する', () => {
    const issues = checkFilterState(
      ds,
      st([
        {
          id: fid('r'),
          kind: 'range',
          target: 'node',
          attr: 'age',
          min: 5,
          max: 1,
          missing: 'include',
        },
        {
          id: fid('t'),
          kind: 'time',
          target: 'node',
          source: { kind: 'span' },
          from: 9,
          to: 1,
          match: 'within',
          missing: 'include',
        },
      ]),
    );
    expect(issues).toEqual([
      { kind: 'reversed-range', filterId: 'r' },
      { kind: 'reversed-range', filterId: 't' },
    ]);
  });

  it('FR-FL-08: 入力を書き換えず、例外も投げない', () => {
    const state = st([cat('nope', 'edge')]);
    const before = JSON.stringify([ds, state]);
    expect(() => checkFilterState(ds, state)).not.toThrow();
    expect(JSON.stringify([ds, state])).toBe(before);
  });
});
