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
  { name: 'graphology', license: 'MIT' },
  { name: 'react', license: 'MIT' },
  { name: 'react-dom', license: 'MIT' },
  { name: 'zustand', license: 'MIT' },
];
