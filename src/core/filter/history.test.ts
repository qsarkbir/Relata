import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from './history';
import { st } from './fixtures/filterDataset';
import { toFilterId, type FilterState } from './types';

// 区別のつく状態を n 個作る（query で見分ける）
const distinct = (n: number): FilterState[] =>
  Array.from({ length: n }, (_, i) =>
    st([
      {
        id: toFilterId(`f${String(i)}`),
        kind: 'text',
        target: 'node',
        query: String(i),
        matching: 'loose',
      },
    ]),
  );

// 【なぜ】noUncheckedIndexedAccess で配列の添字は undefined かもしれない型になる。`as` で黙らせず、
//   無ければテストの誤りとして例外にして取り出す。
const pick = (list: readonly FilterState[], i: number): FilterState => {
  const x = list[i];
  if (x === undefined) throw new Error(`状態 ${String(i)} がありません`);
  return x;
};

describe('Undo / Redo（FR-FL-10）', () => {
  it('FR-FL-10: 作ったばかりの履歴は戻せず、やり直せない', () => {
    const h = createHistory(st([]));
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undoHistory(h)).toBe(h);
    expect(redoHistory(h)).toBe(h);
  });

  it('FR-FL-10: 積んで、戻して、やり直せる', () => {
    const list = distinct(3);
    const a = pick(list, 0);
    const b = pick(list, 1);
    const c = pick(list, 2);
    let h = createHistory(a);
    h = pushHistory(pushHistory(h, b), c);
    expect(h.present).toBe(c);
    h = undoHistory(h);
    expect(h.present).toBe(b);
    expect(canRedo(h)).toBe(true);
    h = undoHistory(h);
    expect(h.present).toBe(a);
    expect(canUndo(h)).toBe(false);
    h = redoHistory(redoHistory(h));
    expect(h.present).toBe(c);
    expect(canRedo(h)).toBe(false);
  });

  it('FR-FL-10: 戻した後に新しい操作をすると、やり直しの履歴は消える', () => {
    const list = distinct(4);
    const a = pick(list, 0);
    const b = pick(list, 1);
    const c = pick(list, 2);
    const d = pick(list, 3);
    let h = pushHistory(pushHistory(createHistory(a), b), c);
    h = pushHistory(undoHistory(h), d);
    expect(canRedo(h)).toBe(false);
    expect(h.present).toBe(d);
    expect(undoHistory(h).present).toBe(b);
  });

  it('FR-FL-10: 変化の無い操作（同じ値）は履歴を増やさない', () => {
    const a = st([]);
    const h = createHistory(a);
    expect(pushHistory(h, a)).toBe(h);
  });

  it('FR-FL-10: 過去は上限（100）で打ち切り、いちばん古いものを捨てる', () => {
    const all = distinct(HISTORY_LIMIT + 50);
    let h = createHistory(st([]));
    for (const s of all) h = pushHistory(h, s);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.present).toBe(all[all.length - 1]);
    for (let i = 0; i < HISTORY_LIMIT; i += 1) h = undoHistory(h);
    expect(canUndo(h)).toBe(false);
    // 初期値と all[0]〜all[48] は捨てられた。戻れる最古は all[49]
    expect(h.present).toBe(all[49]);
  });

  it('FR-FL-10: 操作は元の履歴を書き換えない（値は不変）', () => {
    const list = distinct(2);
    const a = pick(list, 0);
    const b = pick(list, 1);
    const h0 = createHistory(a);
    const h1 = pushHistory(h0, b);
    undoHistory(h1);
    expect(h0).toEqual({ past: [], present: a, future: [] });
    expect(h1.past).toEqual([a]);
  });
});
