// ESLint の設定（flat config 形式）。
//
// 【なぜ】このファイルは TypeScript ではなく JavaScript（.js）で書く。.ts にすると、
// ESLint が設定を読むために追加の道具（jiti）を必要とするため。設定ファイル自身は
// 型検査の対象にしない（下の disableTypeChecked）。
//
// flat config は「設定オブジェクトの配列」である。上から順に読まれ、ファイルの場所（files）が
// 一致したオブジェクトの設定が重ねられ、後ろのものが勝つ。同じ規則を 2 か所で設定した場合、
// オプションは混ぜ合わされず、後ろのものに丸ごと置き換わる。
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import jsdoc from 'eslint-plugin-jsdoc';
import importX, { createNodeResolver } from 'eslint-plugin-import-x';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// ---------------------------------------------------------------------------
// 層の境界（設計書 §4.1）の定義
// ---------------------------------------------------------------------------

// 【なぜ】tsconfig.app.json は src/ 全体に DOM の型を与えるため、tsc は src/core/ が
// window や document を使っても止めない（tsconfig.core.json は型の面から止めるが、
// 実行時の値の参照は ESLint でも二重に止める）。main.tsx のように、境界の外
// （src/app など）では DOM を自由に使える。
// core で自分が `Node`（グラフのノード）という型を定義するのは問題ない。
// no-restricted-globals は「宣言されていない（組み込みの）名前」だけを検出するため。
const browserGlobalNames = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'location',
  'history',
  'alert',
  'confirm',
  'prompt',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'Blob',
  'File',
  'FileReader',
  'URL',
  'HTMLElement',
  'SVGElement',
  'Element',
  'Event',
  'MouseEvent',
  'CanvasRenderingContext2D',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
];

const browserGlobalRestrictions = browserGlobalNames.map((name) => ({
  name,
  message: `${name} はブラウザの機能です。src/core/ は DOM やブラウザ API に依存しません（設計書 §4.1、CLAUDE.md）。必要な値は引数で受け取ってください。`,
}));
// 【なぜ】Worker（*.worker.ts）には DOM が無い。Worker にもあるもの（fetch、URL、Blob、Worker、
// indexedDB、navigator、location、XMLHttpRequest、WebSocket、File、FileReader、Event）は禁止しない。
const workerForbiddenGlobalNames = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'history',
  'alert',
  'confirm',
  'prompt',
  'HTMLElement',
  'SVGElement',
  'Element',
  'MouseEvent',
  'CanvasRenderingContext2D',
  'getComputedStyle',
];
const workerGlobalRestrictions = workerForbiddenGlobalNames.map((name) => ({
  name,
  message: `${name} は DOM の機能です。Web Worker の中では使えません。window の代わりに self を使い、画面に触れる処理は client（メインスレッド）側に置きます（設計書 §4.1、D-30）。`,
}));
// 【なぜ】src/i18n/ は render（書き出しのラベル）からも使われるため、ブラウザに依存しない（D-15）。
// 言語の判定に要る値（navigator.languages など）は、呼ぶ側が引数で渡す。
const i18nBrowserGlobalRestrictions = browserGlobalNames.map((name) => ({
  name,
  message: `${name} はブラウザの機能です。src/i18n/ は render からも使われるため、ブラウザに依存しません（設計書 §4.1、D-15）。言語の判定に要る値は、呼ぶ側が引数で渡してください。`,
}));
// 【なぜ】src/state/ は Worker の外の「画面の状態」を持つ層だが、React にも DOM にも依存させない（D-26）。
// 状態は純粋な TypeScript の関数として単体テストでき、見た目は views が担う。
// 永続化（localStorage など）が要るときは、呼ぶ側（app）が保存先を渡す。
const stateBrowserGlobalRestrictions = browserGlobalNames.map((name) => ({
  name,
  message: `${name} はブラウザの機能です。src/state/ は React にも DOM にも依存しません（設計書 §4.1、D-26）。保存先や時刻などは、app から引数や関数として渡してください。`,
}));
const i18nDateRestriction = {
  name: 'Date',
  message:
    'Date は使いません。src/i18n/ はブラウザにも暦にも依存せず、日付の整形は core の関数に任せます（設計書 §4.1、§5.1）。',
};

// 【なぜ】日付は内部で JDN（ユリウス通日）の整数として持つ。Date はグレゴリオ暦を前提とし、
// 紀元前や幅のある年代、ヒジュラ暦の扱いに向かず、タイムゾーンにも左右される（設計書 §5.1）。
const dateRestriction = {
  name: 'Date',
  message:
    'Date は使いません。日付は JDN の整数で持ち、暦の換算は src/core/time/ の関数だけで行います（CLAUDE.md、設計書 §5.1）。',
};

// 【なぜ】JSX を書くと、変換の結果として react/jsx-runtime が暗黙に import される。
// import 文には現れないので、no-restricted-imports では見つけられない。構文そのものを禁止する。
// 動的 import（import('react')）と、型の位置の import('react') も、import 文の検査をすり抜けるので、
// あわせて禁止する。
const noImplicitDependencySyntax = [
  {
    selector: 'JSXElement',
    message:
      'JSX は使いません。JSX は暗黙に react/jsx-runtime を import するため、core と render が React に依存してしまいます（設計書 §4.1）。',
  },
  {
    selector: 'JSXFragment',
    message:
      'JSX は使いません。JSX は暗黙に react/jsx-runtime を import するため、core と render が React に依存してしまいます（設計書 §4.1）。',
  },
  {
    selector: 'ImportExpression',
    message:
      '動的な import() は使いません。import 文の層の検査をすり抜けるためです（設計書 §4.1）。',
  },
  {
    selector: 'TSImportType',
    message:
      "型の位置の import('x') は使いません。import 文の層の検査をすり抜けるためです。`import type` を使ってください（設計書 §4.1）。",
  },
];

// core、render、i18n、state には .tsx のファイル自体を置かない。JSX を書く場所は views と app だけである。
const noTsxFileSyntax = {
  selector: 'Program',
  message:
    'src/core/、src/render/、src/i18n/、src/state/ に .tsx ファイルは置きません。JSX を書くのは src/views/ と src/app/ だけです（設計書 §4.1）。',
};

// 【なぜ】地図の部品（maplibre-gl、deck.gl、d3-geo）は、地図を初めて開いたときだけ読み込む（D-50）。
// どこかの層が静的に import すると、普段の起動にも含まれて重くなる。そこで、使ってよい層を
// src/map/ だけにして、ほかの層からは名前で止める。d3-geo（SVG の書き出し）も、書き出しの図を
// 描く map-geo の renderer が src/map/ の中に置くため、src/map/ に限る（D-50、D-54、D-60）。
const mapPackages = ['maplibre-gl', 'deck.gl', '@deck.gl', 'd3-geo'];
const mapPackagesReason =
  '地図の部品（maplibre-gl、deck.gl、d3-geo）は src/map/ だけが使います。地図を初めて開いたときだけ読み込むためです（設計書 §4.1、D-50）。';

// 【なぜ】Math.random は同じ入力で結果が変わり、地図の絵と書き出しが再現できなくなる（NFR-08）。
const randomRestriction = [
  {
    object: 'Math',
    property: 'random',
    message:
      'Math.random は使いません。同じ入力は同じ結果になるようにします（NFR-08、設計書 §4.1、D-52）。',
  },
];

// 層ごとの「パッケージ名による」禁止。パスの解決が要らないので no-restricted-imports で書く。
/**
 * パッケージ名の禁止リストから、no-restricted-imports のオプションを作る。
 *
 * @param {string[]} names - 禁止するパッケージ名（'react' なら 'react/*' も禁止する）
 * @param {string} reason - 禁止の理由（message に入る）
 * @returns {object} no-restricted-imports に渡すオプション
 */
function restrictPackages(names, reason) {
  return {
    paths: names.map((name) => ({ name, message: `${name} には依存しません。${reason}` })),
    patterns: [{ group: names.map((name) => `${name}/*`), message: reason }],
  };
}

// 層の依存の向きの禁止（設計書 §4.1 の図）。
// 【なぜ】正規表現ではなく「パスを解決して」判定する（eslint-plugin-import-x の no-restricted-paths）。
// '../graph/../../state' のような回りくどい書き方でも、解決後の場所で判定できる。
// target の層から、from の層への import を止める。
const state = './src/state';
const views = './src/views';
const app = './src/app';
const render = './src/render';
const map = './src/map';
const io = './src/io';
const workers = './src/workers';
const i18n = './src/i18n';

/**
 * 「target の層は from の層を import できない」という禁止の組を作る。
 *
 * @param {string} target - 禁止する側の層のフォルダ
 * @param {string[]} froms - import してはいけない層のフォルダ
 * @param {string} message - 違反したときの説明
 * @returns {object[]} no-restricted-paths の zones の要素
 */
function zones(target, froms, message) {
  return froms.map((from) => ({ target, from, message }));
}

export default defineConfig(
  // 検査しない場所。【なぜ】upstream/ は旧 Palladio の参照用ソースで、変更もビルドもしない。
  {
    ignores: [
      'upstream/',
      'dist/',
      'node_modules/',
      'coverage/',
      'playwright-report/',
      'test-results/',
    ],
  },

  // 【なぜ】eslint-disable コメントに理由を必須にし、効いていない disable は error にする。
  // 規約（CLAUDE.md）は「非 null アサーションなどは理由を書ける場合だけ」と定めている。
  // 理由の無い disable で規則を黙らせる抜け道を塞ぐ。
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    rules: {
      '@eslint-community/eslint-comments/require-description': 'error',
    },
  },

  // 推奨の規則一式。
  js.configs.recommended,
  // 【TS】strictTypeChecked は「型情報を使う厳しめの規則一式」。型情報を使う規則は、
  // TypeScript のコンパイラに問い合わせるので少し遅いが、any の伝わりや Promise の放置など、
  // 構文だけでは分からない誤りを見つけられる。stylistic は書き方の統一に関する規則。
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // 【なぜ】projectService は、各ファイルが属する tsconfig を TypeScript 自身に探させる方式。
        // tsconfig を手で列挙しなくてよい。
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- CLAUDE.md の TypeScript 規約を error にする ---
      // any は使わない。外から来るデータは unknown で受け、型ガードで絞り込む。
      '@typescript-eslint/no-explicit-any': 'error',
      // 非 null アサーション（!）は、理由をコメントに書ける場合だけ許す。
      // 使うときは、その行の直前に、理由を書いた eslint-disable-next-line を置く。
      // 例: // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- has() で存在を確認済み
      // 理由の無い disable は、上の require-description が error にする。
      '@typescript-eslint/no-non-null-assertion': 'error',
      // 判別共用体の switch で、case の書き漏らしを止める。default で assertNever を呼ぶ書き方と併用する。
      // 【なぜ】assertNever は「到達したら実行時に例外」、この規則は「書いた時点でエラー」。二重に守る。
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: false },
      ],
    },
  },

  // React（画面）の規則と、ブラウザのグローバル（src/ 全体はブラウザで動く）。
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 【なぜ】コンポーネント以外も export するファイルは、開発中の即時反映（Fast Refresh）が
      // 効かなくなる。Vite の雛形と同じ警告を出す。
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ---------------------------------------------------------------------------
  // 層の境界（設計書 §4.1）。違反の見本と自動検査は tests/lint/ を参照。
  // ---------------------------------------------------------------------------
  {
    files: [
      'src/core/**/*.{ts,tsx}',
      'src/render/**/*.{ts,tsx}',
      'src/map/**/*.{ts,tsx}',
      'src/io/**/*.{ts,tsx}',
      'src/workers/**/*.{ts,tsx}',
      'src/i18n/**/*.{ts,tsx}',
      'src/state/**/*.{ts,tsx}',
      'src/views/**/*.{ts,tsx}',
    ],
    plugins: { 'import-x': importX },
    settings: {
      // 【なぜ】既定の解決器は .ts を探さないので、拡張子なしの import（'../state/a'）が
      // 解決できず、no-restricted-paths が何も検査しなくなる。TypeScript の拡張子を教える。
      'import-x/resolver-next': [
        createNodeResolver({ extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'] }),
      ],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        restrictPackages(
          ['react', 'react-dom', 'zustand', ...mapPackages],
          'src/core/ は UI・地図の部品に依存せず、純粋な TypeScript に保ちます（設計書 §4.1）。',
        ),
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: zones(
            './src/core',
            [state, views, app, render, map, io, workers, i18n],
            'src/core/ は他の層（state、views、app、render、map、io、workers、i18n）を import しません。依存は上位の層から core へ向かう一方向です（設計書 §4.1）。',
          ),
        },
      ],
      'no-restricted-globals': ['error', ...browserGlobalRestrictions, dateRestriction],
      'no-restricted-syntax': ['error', ...noImplicitDependencySyntax],
    },
  },
  {
    files: ['src/i18n/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        restrictPackages(
          ['react', 'react-dom', 'zustand', ...mapPackages],
          'src/i18n/ は render からも使われるため（D-15）、React・Zustand・地図の部品に依存しません（設計書 §4.1）。',
        ),
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: zones(
            './src/i18n',
            [state, views, app, render, map, io, workers],
            'src/i18n/ は render からも使われるため（D-15）、state、views、app、render、map、io、workers を import しません。core には依存してよい（設計書 §4.1）。',
          ),
        },
      ],
      'no-restricted-globals': ['error', ...i18nBrowserGlobalRestrictions, i18nDateRestriction],
      'no-restricted-syntax': ['error', ...noImplicitDependencySyntax],
    },
  },
  {
    files: ['src/state/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...['react', 'react-dom', ...mapPackages].map((name) => ({
              name,
              message: `${name} には依存しません。src/state/ は React・地図の部品に依存せず、画面の外でも動く純粋な状態にします（設計書 §4.1、D-26）。`,
            })),
            // 【なぜ】'zustand' の本体は React 用の入口（use フックを含む）。
            // 状態の定義には React に依存しない 'zustand/vanilla' を使い、views 側で React に結びつける。
            {
              name: 'zustand',
              message:
                "'zustand' は React 用の入口なので使いません。'zustand/vanilla' を使ってください（設計書 §4.1、D-26）。",
            },
          ],
          patterns: [
            {
              group: ['react/*', 'react-dom/*', ...mapPackages.map((name) => `${name}/*`)],
              message: 'src/state/ は React・地図の部品に依存しません（設計書 §4.1、D-26）。',
            },
            // 【なぜ】zustand/vanilla と zustand/middleware は React に依存しないので許す。
            // React に依存する入口（react、traditional、shallow の useShallow）だけを名指しで止める。
            {
              group: ['zustand/react', 'zustand/react/*', 'zustand/traditional', 'zustand/shallow'],
              message:
                "zustand の React 用の入口は使いません。'zustand/vanilla' を使ってください（設計書 §4.1、D-26）。",
            },
          ],
        },
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: [
            ...zones(
              './src/state',
              [views, app, render, map, io],
              'src/state/ は views、app、render、map、io を import しません。依存は上位の層から下へ向かう一方向です。core、i18n、workers の *.client.ts には依存してよい（設計書 §4.1、D-26）。',
            ),
            // 【なぜ】workers は、Worker の中身（*.worker.ts）だけを止める。*.client.ts は
            // 画面なしで呼べる窓口なので、state から使ってよい。from は glob で書く。
            {
              target: './src/state',
              from: './src/workers/**/*.worker.ts',
              message:
                'src/state/ は *.worker.ts を import しません。Worker は workers/*.client.ts の窓口を通して使います（設計書 §4.1、D-26）。',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', ...stateBrowserGlobalRestrictions],
      'no-restricted-syntax': ['error', ...noImplicitDependencySyntax],
    },
  },
  {
    files: ['src/render/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        restrictPackages(
          ['react', 'react-dom', 'zustand', ...mapPackages],
          'src/render/ は画面からも書き出し処理（画面なし）からも呼べるようにします。地図の部品も使いません（設計書 §4.1、D-50）。',
        ),
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: zones(
            './src/render',
            [state, views, app, map, io, workers],
            'src/render/ は state、views、app、map、io、workers を import しません。描画に必要な値は引数で受け取ります（設計書 §4.1）。',
          ),
        },
      ],
      'no-restricted-syntax': ['error', ...noImplicitDependencySyntax],
      // 【なぜ】render は書き出しにも使われ、同じ入力は同じ絵になる必要がある（NFR-08）。T3-01 のレビューの申し送り。
      'no-restricted-globals': ['error', dateRestriction],
      'no-restricted-properties': ['error', ...randomRestriction],
    },
  },
  // 【なぜ】src/map/ は「画面の部品の中身」で、ストアと React の部品は views の薄い部品（MapView.tsx）が持つ。
  // 地図の部品は props で値と更新の関数を受け取るだけにして、ストアを読まない（phase3-plan §4）。
  // こうすると、地図の中身を React とストアなしで単体テストでき、react と zustand への依存も入らない。
  // DOM と WebGL、maplibre-gl、@deck.gl は使ってよいので、ブラウザのグローバルは禁止しない。
  // core と render には依存してよいが、state、views、app、io、workers は import しない（D-52）。
  {
    files: ['src/map/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        restrictPackages(
          ['react', 'react-dom', 'zustand'],
          'src/map/ は画面の部品の中身です。ストアと React の部品は views の MapView.tsx が持ち、値と更新の関数は props で受け取ります（設計書 §4.1、D-52、phase3-plan §4）。',
        ),
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: zones(
            './src/map',
            [state, views, app, io, workers],
            'src/map/ は state、views、app、io、workers を import しません。ストアの値と更新の関数は views から props で受け取ります（設計書 §4.1、D-52）。core、render、i18n には依存してよい。',
          ),
        },
      ],
      'no-restricted-globals': ['error', dateRestriction],
      'no-restricted-properties': ['error', ...randomRestriction],
      // 【なぜ】JSX は react/jsx-runtime を暗黙に import するので、React の禁止をすり抜ける。
      // 動的 import と型の位置の import('x') も、層の検査をすり抜けるので止める。
      // 地図の部分全体は views が動的 import で読み込む（D-50）ので、map の中では静的 import で足りる。
      'no-restricted-syntax': ['error', ...noImplicitDependencySyntax],
    },
  },
  // 【なぜ】views は Worker の client を直接呼ばず、state の controller を通す（設計書 §4.1、D-17）。
  // 版番号と古い結果の破棄を 1 か所にまとめ、画面ごとに作り直さないため（PR #31 のレビュー）。
  {
    files: ['src/views/**/*.{ts,tsx}'],
    rules: {
      // 【なぜ】views も地図の部品を直接 import しない。src/map/ を動的 import で読み込む（D-50）。
      'no-restricted-imports': ['error', restrictPackages(mapPackages, mapPackagesReason)],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: zones(
            './src/views',
            [workers, app],
            'src/views/ は workers と app を import しません。Worker は src/state/ の controller を通して使います（設計書 §4.1、D-17、D-26）。',
          ),
        },
      ],
    },
  },
  {
    files: ['src/io/**/*.{ts,tsx}', 'src/workers/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        restrictPackages(
          ['react', 'react-dom', 'zustand', ...mapPackages],
          'src/io/ と src/workers/ は画面の部品・地図の部品に依存しません。Worker の中では React も DOM も使えません（設計書 §4.1）。',
        ),
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: import.meta.dirname,
          zones: [
            ...zones(
              './src/io',
              [state, views, app, map],
              'src/io/ は state、views、app、map を import しません。依存は上位の層から下へ向かう一方向です（設計書 §4.1）。',
            ),
            ...zones(
              './src/workers',
              [state, views, app, map],
              'src/workers/ は state、views、app、map を import しません。依存は上位の層から下へ向かう一方向です（設計書 §4.1）。',
            ),
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', restrictPackages(mapPackages, mapPackagesReason)],
    },
  },
  // 【なぜ】Web Worker の中（*.worker.ts）には window も document も無い。上の src/ 全体の設定は
  // globals.browser を与えるので、ここで Worker のグローバル（self、postMessage など）に差し替え、
  // DOM だけにあるものを禁止する。fetch、URL、Blob、Worker など Worker にもあるものは禁止しない。
  // 型の面では tsconfig.worker.json（lib に DOM なし）が止める（設計書 §4.1、D-30）。
  // 【なぜ】no-restricted-globals は、この設定より前に書いた core などの設定とは files が重ならないので、
  // ここで単独に設定してよい。
  {
    files: ['src/workers/**/*.worker.ts'],
    languageOptions: {
      globals: {
        ...globals.worker,
        // globals.browser が与えた DOM のグローバルを外す（'off' は宣言の取り消し）。
        ...Object.fromEntries(workerForbiddenGlobalNames.map((name) => [name, 'off'])),
      },
    },
    rules: {
      'no-restricted-globals': ['error', ...workerGlobalRestrictions],
    },
  },
  // core、render、i18n には .tsx ファイル自体を置かない。上と同じ規則を再掲するのは、
  // 同じ規則を設定し直すと、後ろのものが前のものを丸ごと置き換えるため。
  {
    files: ['src/core/**/*.tsx', 'src/render/**/*.tsx', 'src/i18n/**/*.tsx', 'src/state/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...noImplicitDependencySyntax, noTsxFileSyntax],
    },
  },

  // ---------------------------------------------------------------------------
  // TSDoc の検査（eslint-plugin-jsdoc）。
  // 【なぜ】「export する関数・クラス・型には TSDoc を書く」「@param、@returns を書く」は
  // CLAUDE.md の規約。書き忘れと、引数名の食い違いを機械で止める。
  // TSDoc の後ろに `// 【TS】` の行コメントが挟まる書き方でも TSDoc を見つけられることは、
  // src/app/App.tsx で確認済み。
  // ---------------------------------------------------------------------------
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { jsdoc },
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          // 【なぜ】CLAUDE.md は export する型にも TSDoc を求めるので、interface と type 別名も対象にする。
          // enum は erasableSyntaxOnly で使えないため、対象に含めない。
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
        },
      ],
      // 【なぜ】分割代入の引数（{ a, b }: Props）は、TSDoc に個別の名前を書くと冗長なので検査しない。
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/require-returns': 'error',
      // 【TS】型は型注釈に書くので、TSDoc に {string} のような型は書かない。
      'jsdoc/no-types': 'error',
    },
  },

  // 設定ファイル（JavaScript）は型検査の対象にしない。Node で動く。
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  // tests/ の .ts と、テストツールの設定ファイルは tsconfig.test.json（T0-08）に含まれる。
  // projectService がそれを見つけて型情報を使う。層の境界の規則は src/ の各層にだけ掛かり、tests/ には掛からない。
  {
    files: ['vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // 【なぜ】最後に置く。ESLint が持つ整形の規則のうち、Prettier と衝突するものを切る。
  // 整形は Prettier に任せ、ESLint は「誤りの検出」に専念する。
  prettierConfig,
);
