import { describe, expect, it } from 'vitest';
import { assertNever } from './assertNever';

type Shape = { kind: 'circle'; r: number } | { kind: 'square'; side: number };

// 【TS】全 case を扱った版。default の s は never になるので assertNever に渡せる。
function areaComplete(s: Shape): number {
  switch (s.kind) {
    case 'circle':
      return Math.PI * s.r ** 2;
    case 'square':
      return s.side ** 2;
    default:
      return assertNever(s);
  }
}

// 【TS】'square' を扱い忘れた版。default の s は square 型のままなので型エラーになる。
function areaIncomplete(s: Shape): number {
  // 扱い残しを意図的に作るので、ESLint の網羅検査はここだけ止める。
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- 扱い残しを意図的に作る
  switch (s.kind) {
    case 'circle':
      return Math.PI * s.r ** 2;
    default:
      // @ts-expect-error 扱い残しがあるので、never に代入できない
      return assertNever(s);
  }
}

// 【TS】以下の `as never` は、実行時に想定外の値が来た場合を再現するため、
//       型検査をわざと迂回している。通常のコードでは使わない。
describe('assertNever', () => {
  it('NFR-10: 全 case を扱えば通常どおり値を返す', () => {
    expect(areaComplete({ kind: 'square', side: 3 })).toBe(9);
  });

  it('NFR-10: case の扱い忘れは型エラーになる（@ts-expect-error で検査）', () => {
    // 型の検査は上の @ts-expect-error が担う。実行時は扱い残しの値で例外になる。
    expect(() => areaIncomplete({ kind: 'square', side: 2 })).toThrow(/square/);
  });

  it('NFR-10: 想定外の値で呼ぶと例外になり、メッセージに値が含まれる', () => {
    // 【なぜ】古いプロジェクトファイルなど、型に合わない値が実行時に来る場合を模す。
    const bad = { kind: 'triangle' } as unknown as Shape;
    expect(() => areaComplete(bad)).toThrow(/Unexpected value: \{"kind":"triangle"\}/);
  });

  it('NFR-10: message を指定すると先頭に付く', () => {
    expect(() => assertNever('x' as never, 'Shape')).toThrow('Shape: "x"');
  });

  it('NFR-10: 循環参照を含む値でも、例外の組み立てで落ちない', () => {
    const loop: { self?: unknown } = {};
    loop.self = loop;
    expect(() => assertNever(loop as never)).toThrow(/Unexpected value/);
  });

  it('NFR-10: JSON にできない値（BigInt、undefined）でも Error を投げる', () => {
    expect(() => assertNever(10n as never)).toThrow('Unexpected value: 10');
    expect(() => assertNever(undefined as never)).toThrow('Unexpected value: undefined');
  });

  it('NFR-10: 長い値は 200 字で切り詰め、末尾に「…」を付ける', () => {
    const big = { text: 'a'.repeat(1000) };
    let message = '';
    try {
      assertNever(big as never);
    } catch (e) {
      message = e instanceof Error ? e.message : '';
    }
    // 'Unexpected value: ' の後ろが 200 字 + 「…」
    expect(message).toBe(`Unexpected value: ${JSON.stringify(big).slice(0, 200)}…`);
  });
});
