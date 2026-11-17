import { describe, expect, it } from 'vitest';

/**
 * 2 つの数を足す、テストの見本用の純粋な関数。
 *
 * 【なぜ】src/core にまだ実装が無いため、Vitest が動くことの確認用に、テスト内で小さな関数を定義する。
 * 純粋な関数とは、同じ入力に必ず同じ出力を返し、外の状態に触れない関数のこと。
 * core の実装が入ったら、同じ形（入力、操作、期待する結果）で core の関数をテストする。
 *
 * @param a - 1 つ目の数
 * @param b - 2 つ目の数
 * @returns a と b の和
 */
function sum(a: number, b: number): number {
  return a + b;
}

describe('NFR-11: テスト基盤', () => {
  it('NFR-11: Vitest が動く（入力 1 と 2 の和は 3 になる）', () => {
    expect(sum(1, 2)).toBe(3);
  });

  it('NFR-11: 負の数を含む入力でも純粋な関数が同じ結果を返す', () => {
    expect(sum(-5, 2)).toBe(-3);
  });
});
