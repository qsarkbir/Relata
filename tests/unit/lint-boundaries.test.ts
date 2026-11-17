import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

// このファイルは tests/unit/ にあるので、2 つ上がリポジトリの直下。
const root = resolve(import.meta.dirname, '../..');

/** 子プロセスの結果。code は終了コード、stdout は標準出力。 */
interface RunResult {
  code: number;
  stdout: string;
}

/**
 * 型ガード。execFile が失敗したときの例外から、終了コードと標準出力を取り出せるか判定する。
 *
 * @param e - catch した値（型は unknown）
 * @returns code と stdout を持つオブジェクトなら true
 */
// 【TS】`e is ...` は型ガード。true の分岐で、unknown だった e をこの型として扱える。
function isExecFailure(e: unknown): e is RunResult {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    typeof e.code === 'number' &&
    'stdout' in e &&
    typeof e.stdout === 'string'
  );
}

/**
 * check-boundaries.mjs を子プロセスで実行する。
 *
 * @returns 終了コードと標準出力（失敗しても例外にせず返す）
 */
async function runCheck(): Promise<RunResult> {
  try {
    const { stdout } = await execFileAsync(process.execPath, ['tests/lint/check-boundaries.mjs'], {
      cwd: root,
    });
    return { code: 0, stdout };
  } catch (e) {
    // 終了コードが 0 以外だと execFile は例外を投げる。どの項目が FAIL か見えるよう stdout を残す。
    if (isExecFailure(e)) return { code: e.code, stdout: e.stdout };
    throw e;
  }
}

// 【なぜ】check-boundaries.mjs は src/ に一時ファイル（__lint_probe__*）を書く。
// そのため、同時に動いている `npm run lint`、`tsc -b`、エディタの ESLint、
// 将来の `vitest --typecheck` が、その一時ファイルを拾う可能性がある。
// 他のテストファイルは src/ の .ts を読まないので、影響はない。
describe('NFR-11 / 設計 §4.1: 層の境界', () => {
  it(
    'NFR-11 / 設計 §4.1: 層の境界の規則がすべて効いている（check-boundaries.mjs が終了コード 0）',
    async () => {
      // 操作: スクリプトを実行する。期待: 終了コード 0。失敗時は stdout（FAIL の行）が表示される。
      const { code, stdout } = await runCheck();
      expect(code, stdout).toBe(0);
    },
    // 【なぜ】長めにする。ESLint が型情報（tsc）を使うため、初回は遅い。
    180_000,
  );
});
