import { describe, expect, it } from 'vitest';
// 【なぜ】`?raw` で文字列として読む。app の tsconfig に node の型も JSON モジュールの設定も無いため。
import packageText from '../../package.json?raw';
import sansLicense from '../../public/fonts/OFL-NotoSansJP.txt?raw';
import arabicLicense from '../../public/fonts/OFL-NotoNaskhArabic.txt?raw';
import { PDF_FONT_FILES } from '../io/export';
import { FONTS, LIBRARIES } from './libraries';

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

  it('D-43: 使用フォントの一覧が、PDF が読み込むファイルと一致し、ライセンス全文に著作権表示がある', () => {
    expect(FONTS.map((f) => f.file).sort()).toEqual(Object.values(PDF_FONT_FILES).sort());
    const licenses: Record<string, string> = {
      'OFL-NotoSansJP.txt': sansLicense,
      'OFL-NotoNaskhArabic.txt': arabicLicense,
    };
    for (const font of FONTS) {
      const text = licenses[font.licenseFile] ?? '';
      expect(text).toContain(font.copyright);
      expect(text).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });
});
