/** 使用ライブラリ 1 件。 */
export interface LibraryInfo {
  /** npm のパッケージ名。`package.json` の `dependencies` のキーと一致させる。 */
  readonly name: string;
  readonly license: string;
}

/**
 * 画面に出す使用ライブラリの一覧（FR-UI-05）。実行時に使う依存（`dependencies`）だけを手で書く。
 *
 * 依存を足したら、ここにも足す。`libraries.test.ts` が `package.json` との一致を確かめる（D-25）。
 */
export const LIBRARIES: readonly LibraryInfo[] = [
  { name: 'bidi-js', license: 'MIT' },
  { name: 'comlink', license: 'Apache-2.0' },
  { name: 'graphology', license: 'MIT' },
  { name: 'graphology-metrics', license: 'MIT' },
  { name: 'graphology-layout-forceatlas2', license: 'MIT' },
  { name: 'harfbuzzjs', license: 'MIT' },
  { name: 'react', license: 'MIT' },
  { name: 'react-dom', license: 'MIT' },
  { name: 'xlsx', license: 'Apache-2.0' },
  { name: 'zustand', license: 'MIT' },
];

/** 使用フォント 1 件（PDF の書き出しのときだけ、このサイトから読み込む。D-43）。 */
export interface FontInfo {
  readonly name: string;
  readonly license: string;
  /** 用途。 */
  readonly script: 'latin' | 'japanese' | 'arabic';
  /** 配布している場所（`public/fonts/` 以下のファイル名）。 */
  readonly file: string;
  /** ライセンス全文のファイル名（`public/fonts/` 以下）。 */
  readonly licenseFile: string;
  /** 著作権表示。 */
  readonly copyright: string;
}

/**
 * 画面に出す使用フォントの一覧（FR-UI-05、D-43）。
 *
 * ファイルは `public/fonts/` にあり、ライセンス全文（SIL Open Font License 1.1）を同じ場所に置く。
 * `libraries.test.ts` が、ファイルの存在と、ライセンス全文の中の著作権表示との一致を確かめる。
 */
export const FONTS: readonly FontInfo[] = [
  {
    name: 'Noto Sans',
    license: 'OFL-1.1',
    script: 'latin',
    file: 'NotoSans-Regular.ttf',
    licenseFile: 'OFL-NotoSans.txt',
    copyright:
      'Copyright 2022 The Noto Project Authors (https://github.com/notofonts/latin-greek-cyrillic)',
  },
  {
    name: 'Noto Sans JP',
    license: 'OFL-1.1',
    script: 'japanese',
    file: 'NotoSansJP-Regular.ttf',
    licenseFile: 'OFL-NotoSansJP.txt',
    copyright: 'Copyright 2014-2021 Adobe (http://www.adobe.com/)',
  },
  {
    name: 'Noto Naskh Arabic',
    license: 'OFL-1.1',
    script: 'arabic',
    file: 'NotoNaskhArabic-Regular.ttf',
    licenseFile: 'OFL-NotoNaskhArabic.txt',
    copyright: 'Copyright 2022 The Noto Project Authors (https://github.com/notofonts/arabic)',
  },
];
