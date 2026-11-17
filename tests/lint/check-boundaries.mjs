// 層の境界の規則（設計書 §4.1）が「実際に効いていること」を確かめるスクリプト。
//
// 【なぜ】ESLint の設定は、書き間違えても「何も検出しない」だけで、気づけない。
// そこで、わざと違反を書いた一時ファイルを ESLint の Node API で検査し、
// 期待した規則が期待した回数だけ報告されることを確かめる。
//
// 使い方: node tests/lint/check-boundaries.mjs
// npm test へ組み込む案は、docs/progress.md の T0-08 の欄を参照。
//
// 注意: 同じ作業フォルダで、型検査（tsc）やビルドと同時に動かさない。
// 一時ファイルを src/ に書くため、他の処理がそれを読み込んで失敗することがある。
//
// 【なぜ一時ファイル】型情報を使う規則（projectService）は、tsconfig に含まれる実在のファイルが必要。
// 検査が終わったら、成功しても失敗しても（Ctrl+C でも）消す。
import { ESLint } from 'eslint';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pid = process.pid;
const layers = ['core', 'render', 'io', 'workers', 'app', 'state', 'views', 'map', 'i18n'];

// この実行で新しく作ったフォルダ。元から無かったものだけを、最後に消す。
const createdDirs = [];

/** 前回の異常終了で残った一時ファイルを消す。 */
function cleanStale() {
  for (const layer of layers) {
    const dir = resolve(root, 'src', layer);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir, { recursive: true })) {
      if (String(f).includes('__lint_probe__')) {
        rmSync(resolve(dir, String(f)), { force: true });
      }
    }
  }
}

/** 書いた一時ファイルの一覧（中断時に消すため） */
const written = new Set();
/** 一時ファイルを消し、元から無かった空のフォルダを消す。 */
function cleanup() {
  for (const p of written) rmSync(p, { force: true });
  written.clear();
  // createdDirs は、この実行が作った（元から無かった）フォルダだけなので、中身ごと消してよい。
  for (const d of createdDirs) rmSync(d, { recursive: true, force: true });
}
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

/**
 * 1 つの検査項目。
 * files: 置くファイル（パス中の `__lint_probe__` は pid 付きの名前に置き換える）
 * lint: 検査するファイル（files のうちの 1 つ）
 * 補助のファイル（他の層に置くもの）は、import が解決できるように実在させる。
 */
const cases = [
  {
    name: 'core は UI・地図のパッケージを import できない',
    lint: 'src/core/__lint_probe__.ts',
    files: {
      'src/core/__lint_probe__.ts': [
        "import { useState } from 'react';",
        "import { createRoot } from 'react-dom/client';",
        "import { create } from 'zustand';",
        "import maplibregl from 'maplibre-gl';",
        "import { Deck } from '@deck.gl/core';",
        'export const a = [useState, createRoot, create, maplibregl, Deck];',
      ],
    },
    expect: { 'no-restricted-imports': 5 },
  },
  {
    name: 'core は他の層を、相対パスや回りくどい書き方でも import できない',
    lint: 'src/core/__lint_probe__.ts',
    files: {
      'src/core/__lint_probe__.ts': [
        "import { a } from '../state/a';",
        "import { b } from '../../src/views/b';",
        "import { c } from '../render/c';",
        "import { d } from '../app/d';",
        "import { e } from '../io/e';",
        "import { f } from '../map/f';",
        "import { g } from '../workers/g';",
        "import { h } from '../i18n/h';",
        "import { i } from './x/../../state/a';",
        'export const x = [a, b, c, d, e, f, g, h, i];',
      ],
      'src/state/a.ts': ['export const a = 1;'],
      'src/views/b.ts': ['export const b = 1;'],
      'src/render/c.ts': ['export const c = 1;'],
      'src/app/d.ts': ['export const d = 1;'],
      'src/io/e.ts': ['export const e = 1;'],
      'src/map/f.ts': ['export const f = 1;'],
      'src/workers/g.ts': ['export const g = 1;'],
      'src/i18n/h.ts': ['export const h = 1;'],
    },
    expect: { 'import-x/no-restricted-paths': 9 },
  },
  {
    name: 'core の中のフォルダ名が層の名前と同じでも、core 内の import は止まらない',
    lint: 'src/core/filter/__lint_probe__.ts',
    files: {
      'src/core/filter/__lint_probe__.ts': [
        "import { m } from '../encode/map';",
        "import { n } from './map';",
        'export const x = [m, n];',
      ],
      'src/core/encode/map.ts': ['export const m = 1;'],
      'src/core/filter/map.ts': ['export const n = 1;'],
    },
    expect: { 'import-x/no-restricted-paths': 0 },
  },
  {
    name: 'core はブラウザのグローバルと Date を使えない',
    lint: 'src/core/__lint_probe__.ts',
    files: {
      'src/core/__lint_probe__.ts': [
        'export const a = [window, document, navigator, localStorage, sessionStorage];',
        'export const b = [fetch, location, HTMLElement];',
        'export const c = new Date();',
      ],
    },
    expect: { 'no-restricted-globals': 9 },
  },
  {
    name: 'core は動的 import と型の位置の import を使えない',
    lint: 'src/core/__lint_probe__.ts',
    files: {
      'src/core/__lint_probe__.ts': [
        "export const a = import('react');",
        "export type T = import('react').FC;",
      ],
    },
    expect: { 'no-restricted-syntax': 2 },
  },
  {
    name: 'render は react、zustand、state、views、app、map、io、workers を import できない',
    lint: 'src/render/__lint_probe__.ts',
    files: {
      'src/render/__lint_probe__.ts': [
        "import { useState } from 'react';",
        "import { create } from 'zustand';",
        "import { a } from '../state/a';",
        "import { b } from '../views/b';",
        "import { c } from '../app/c';",
        "import { f } from '../map/f';",
        "import { e } from '../io/e';",
        "import { g } from '../workers/g';",
        'export const x = [useState, create, a, b, c, f, e, g];',
      ],
      'src/state/a.ts': ['export const a = 1;'],
      'src/views/b.ts': ['export const b = 1;'],
      'src/app/c.ts': ['export const c = 1;'],
      'src/map/f.ts': ['export const f = 1;'],
      'src/io/e.ts': ['export const e = 1;'],
      'src/workers/g.ts': ['export const g = 1;'],
    },
    expect: { 'no-restricted-imports': 2, 'import-x/no-restricted-paths': 6 },
  },
  {
    name: 'render は core と i18n を import できる（下位の層への依存は正しい向き）',
    lint: 'src/render/__lint_probe__.ts',
    files: {
      'src/render/__lint_probe__.ts': [
        "import { a } from '../core/a';",
        "import { t } from '../i18n/t';",
        'export const x = [a, t];',
      ],
      'src/core/a.ts': ['export const a = 1;'],
      'src/i18n/t.ts': ['export const t = 1;'],
    },
    expect: { 'no-restricted-imports': 0, 'import-x/no-restricted-paths': 0 },
  },
  {
    name: 'render の .tsx で JSX を書けない（暗黙の react/jsx-runtime の import を塞ぐ）',
    lint: 'src/render/__lint_probe__.tsx',
    files: {
      'src/render/__lint_probe__.tsx': ['export const a = <div />;', 'export const b = <></>;'],
    },
    // JSXElement と JSXFragment が 1 件ずつ + .tsx ファイル自体の禁止（Program）が 1 件
    expect: { 'no-restricted-syntax': 3 },
  },
  {
    name: 'io と workers は react、zustand、state、views、app を import できない',
    lint: 'src/workers/__lint_probe__.ts',
    files: {
      'src/workers/__lint_probe__.ts': [
        "import { useState } from 'react';",
        "import { a } from '../state/a';",
        "import { c } from '../core/c';",
        'export const x = [useState, a, c];',
      ],
      'src/state/a.ts': ['export const a = 1;'],
      'src/core/c.ts': ['export const c = 1;'],
    },
    expect: { 'no-restricted-imports': 1, 'import-x/no-restricted-paths': 1 },
  },
  {
    name: 'CLAUDE.md の規約: any、非 null アサーション、switch の網羅漏れ、理由なしの disable',
    lint: 'src/core/__lint_probe__.ts',
    files: {
      'src/core/__lint_probe__.ts': [
        'export const a: any = 1;',
        'export const b = (a as string | undefined)!;',
        "type U = { kind: 'a' } | { kind: 'b' };",
        '/** 要約。 @param u - 値 @returns 数 */',
        'export function f(u: U): number {',
        '  switch (u.kind) {',
        "    case 'a':",
        '      return 1;',
        '  }',
        '  return 0;',
        '}',
        '// eslint-disable-next-line @typescript-eslint/no-non-null-assertion',
        'export const c = (a as string | undefined)!;',
      ],
    },
    expect: {
      '@typescript-eslint/no-explicit-any': 1,
      '@typescript-eslint/no-non-null-assertion': 1,
      '@typescript-eslint/switch-exhaustiveness-check': 1,
      '@eslint-community/eslint-comments/require-description': 1,
    },
  },
];

/**
 * 一時ファイルの相対パスに pid と通し番号を入れる。
 * pid は並行実行どうしの衝突を避けるため。通し番号は、同じ名前のファイルを消して作り直すと、
 * ESLint の型情報の仕組み（projectService）が古いフォルダの内容を覚えていて「見つからない」と
 * 誤るのを避けるため。
 *
 * @param {string} rel - `__lint_probe__` を含む相対パス
 * @returns {string} pid 入りの相対パス
 */
let seq = 0;
const withPid = (rel) =>
  rel.replace('__lint_probe__', `__lint_probe__${String(pid)}_${String(seq)}`);

/**
 * 補助ファイルの名前は pid を入れず、書いた場所をそのまま使う（他の項目と重ならないよう、
 * 項目ごとに書いて消す）。
 *
 * @param {string} rel - 相対パス
 * @returns {string} 書き込み先の絶対パス
 */
function writeProbe(rel, lines) {
  const path = resolve(root, withPid(rel));
  // recursive の mkdir は、実際に新しく作った最上位のフォルダを返す（無ければ undefined）。
  const made = mkdirSync(resolve(path, '..'), { recursive: true });
  if (made !== undefined) createdDirs.push(made);
  // wx: 既に同名のファイルがあれば失敗させ、他のファイルを上書きしない
  writeFileSync(path, lines.join('\n') + '\n', { flag: 'wx' });
  written.add(path);
  return path;
}

cleanStale();
const eslint = new ESLint({ cwd: root });
let failed = 0;

for (const c of cases) {
  seq++;
  const mine = [];
  try {
    for (const [rel, lines] of Object.entries(c.files)) mine.push(writeProbe(rel, lines));
    const [result] = await eslint.lintFiles([resolve(root, withPid(c.lint))]);
    const messages = result?.messages ?? [];
    const counts = {};
    for (const m of messages) {
      if (m.ruleId) counts[m.ruleId] = (counts[m.ruleId] ?? 0) + 1;
    }
    // 構文エラーなどの致命的な失敗は、規則の件数に現れないので別に数える。
    const fatal = messages.filter((m) => m.fatal);
    const ok =
      fatal.length === 0 &&
      Object.entries(c.expect).every(([rule, n]) => (counts[rule] ?? 0) === n);
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.name}`);
    if (!ok) {
      failed++;
      console.log('     期待:', JSON.stringify(c.expect), '実際:', JSON.stringify(counts));
      for (const m of fatal) console.log('     致命的エラー:', m.message);
    }
  } finally {
    for (const p of mine) {
      rmSync(p, { force: true });
      written.delete(p);
    }
  }
}

// 【なぜ】DOM の型を持たない tsconfig.core.json が、core の DOM の型の使用を止めることも確かめる。
{
  seq++;
  const path = writeProbe('src/core/__lint_probe__.ts', [
    'export const a = globalThis.window;',
    'export type T = HTMLElement | Node;',
  ]);
  let output = '';
  try {
    execFileSync(
      process.execPath,
      [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.core.json'],
      { cwd: root, encoding: 'utf8', stdio: 'pipe' },
    );
  } catch (e) {
    // tsc は型エラーがあると終了コード 2 で終わる。エラーの文面は stdout に出る。
    output = String(e.stdout ?? '');
  } finally {
    rmSync(path, { force: true });
    written.delete(path);
  }
  // window は globalThis の添字として、HTMLElement と Node は名前の未定義として報告される。
  const ok =
    output.includes('(1,') && ['HTMLElement', 'Node'].every((w) => output.includes(`'${w}'`));
  console.log(
    `${ok ? 'OK  ' : 'FAIL'} core で DOM の型を使うと tsconfig.core.json の型検査で止まる`,
  );
  if (!ok) {
    failed++;
    console.log(output);
  }
}

cleanup();
process.exit(failed === 0 ? 0 : 1);
