import { describe, expect, it } from 'vitest';
// 【なぜ】`?raw` で文字列として読む。app の tsconfig に node の型も JSON モジュールの設定も無いため。
import packageText from '../../package.json?raw';
import { LIBRARIES } from './libraries';

describe('使用ライブラリの一覧', () => {
  it('FR-UI-05: package.json の dependencies と名前が一致する', () => {
    // 【TS】`unknown` は「何でもありうる型」。JSON.parse の結果は型が保証されないので、絞り込んでから使う。
    const pkg: unknown = JSON.parse(packageText);
    if (typeof pkg !== 'object' || pkg === null || !('dependencies' in pkg)) {
      throw new Error('package.json に dependencies がありません');
    }
    const deps = pkg.dependencies;
    if (typeof deps !== 'object' || deps === null) {
      throw new Error('dependencies がオブジェクトではありません');
    }
    const names = Object.keys(deps).sort();
    expect(LIBRARIES.map((l) => l.name).sort()).toEqual(names);
  });

  it('FR-UI-05: 名前に重複が無く、ライセンスが空でない', () => {
    expect(new Set(LIBRARIES.map((l) => l.name)).size).toBe(LIBRARIES.length);
    for (const l of LIBRARIES) expect(l.license.length).toBeGreaterThan(0);
  });
});
