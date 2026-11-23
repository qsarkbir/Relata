import { describe, expect, it } from 'vitest';
import { nodesInBox } from './useRangeSelect';

// getBoundingClientRect と data-id だけを持つ偽の要素。
function fake(id: string, x: number, y: number): Element {
  return {
    getAttribute: (name: string) => (name === 'data-id' ? id : null),
    getBoundingClientRect: () => ({ left: x - 5, right: x + 5, top: y - 5, bottom: y + 5 }),
  } as unknown as Element; // 理由: 必要な 2 つの関数だけを持つテスト用の代用品
}

describe('FR-FL-11: 矩形の中のノードの判定', () => {
  const els = [fake('a', 10, 10), fake('b', 50, 50), fake('c', 200, 10)];
  it('FR-FL-11: 中心が矩形に入るノードだけを返す', () => {
    expect(nodesInBox(els, { left: 0, top: 0, right: 60, bottom: 60 })).toEqual(['a', 'b']);
  });
  it('FR-FL-11: 何も入らなければ空', () => {
    expect(nodesInBox(els, { left: 100, top: 100, right: 150, bottom: 150 })).toEqual([]);
  });
});
