// 自前の ESLint 規則: src/map/ を「値として静的に」import することを止める（設計書 §4.1、D-50）。
//
// 【なぜ】文字列のパターン（'**/map'）は import の指定子の文字列だけを見て、パスを解決しない。
// すると、src/views/foo/map.ts のような無関係なファイルを './map' で import しただけで誤って止まる。
// この規則は、import したファイルの場所を `path.resolve` で求め、src/map/ の下かどうかで判定する。
// import-x/no-restricted-paths もパスを解決するが、型だけの import を許す設定が無い。
// typescript-eslint の no-restricted-imports の `regex` は、views と app の深さごとに
// 正規表現を変えねばならず、'../views/../map' のような書き方も見逃す。そのため自前の小さな規則にした。
//
// 止めるもの: 値の `import ... from`、`import '...'`、`export ... from`、`export * from`。
// 許すもの: `import type` と `export type ... from`（消えて実行時に残らない）、動的 `import()`
// （map を初めて開くときの正規の読み込み方。ImportExpression は見ない）。
// 注意: verbatimModuleSyntax が有効なので、`import { type U } from '../map'`（インラインの type だけ）は
// 副作用だけの import として実行時に残る。そのため、宣言全体が `import type` でなければ止める。
import { isAbsolute, dirname, relative, resolve } from 'node:path';

const mapDir = resolve(import.meta.dirname, '../../src/map');

/**
 * ファイルが src/map/ の下（または src/map 自身）にあるかを返す。
 *
 * @param {string} path - 絶対パス
 * @returns {boolean} src/map の下なら true
 */
function isInsideMap(path) {
  const rel = relative(mapDir, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** @type {import('eslint').Rule.RuleModule} */
export const noStaticMapImport = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      value:
        'src/map/ を値として静的に import しません。地図は動的 import() で初めて開いたときに読み込みます。型だけなら `import type` を使えます（設計書 §4.1、D-50）。',
    },
  },
  create(context) {
    const dir = dirname(context.filename);
    /**
     * import / export の宣言を検査する。
     *
     * @param {import('estree').Node & { source?: { value?: unknown } | null }} node - 宣言
     * @param {string | undefined} kind - 'type' なら型だけ
     */
    function check(node, kind) {
      const source = node.source?.value;
      if (kind === 'type' || typeof source !== 'string' || !source.startsWith('.')) return;
      if (isInsideMap(resolve(dir, source))) context.report({ node, messageId: 'value' });
    }
    return {
      ImportDeclaration: (node) => {
        check(node, node.importKind);
      },
      ExportNamedDeclaration: (node) => {
        check(node, node.exportKind);
      },
      ExportAllDeclaration: (node) => {
        check(node, node.exportKind);
      },
    };
  },
};

/** eslint.config.js の plugins に渡す、この規則だけを持つプラグイン。 */
export default { rules: { 'no-static-map-import': noStaticMapImport } };
