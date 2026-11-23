/**
 * 「欠損の表示」の設定（FR-VG-12）。どの属性が欠損している要素を破線にするか。
 * `view.graph` に任意の項目として保存する（D-24。無ければ既定値）。
 */
import type { ParseResult } from '../model';
import { isPlainObject } from '../model';

// 【TS】`readonly string[]` は「中身を変えられない文字列の配列」。設定を受け取った側が
//       書き換えないと、型で約束する（保存する設定を、画面の操作で直接変えてしまう事故を防ぐ）。
/** 欠損を破線で示す属性のキー。ノードとエッジで別に持つ。 */
export interface MissingDisplay {
  readonly nodeAttrs: readonly string[];
  readonly edgeAttrs: readonly string[];
}

/** 既定は、どの属性も破線にしない。 */
export const DEFAULT_MISSING_DISPLAY: MissingDisplay = { nodeAttrs: [], edgeAttrs: [] };

const MAX_KEY_LENGTH = 1000;
const MAX_KEYS = 10000;

/**
 * 属性のキーの並びを検査する。省略（undefined）は空。
 *
 * @param x - 任意の入力
 * @param name - 項目の名前（失敗の経路に使う）
 * @returns キーの並び、または壊れた箇所
 */
function parseKeys(x: unknown, name: string): ParseResult<readonly string[]> {
  const fail = (path: string): ParseResult<readonly string[]> => ({
    ok: false,
    path,
    reason: '欠損の表示の設定が不正です',
  });
  if (x === undefined) return { ok: true, value: [] };
  if (!Array.isArray(x) || x.length > MAX_KEYS) return fail(name);
  const seen = new Set<string>();
  for (const [i, k] of x.entries()) {
    // 【なぜ】null や不正な値は黙って直さず拒否する（view.graph の他の項目と同じ。D-24、設計書 §8.5）。
    if (typeof k !== 'string' || k === '' || k.length > MAX_KEY_LENGTH || seen.has(k))
      return fail(`${name}[${String(i)}]`);
    seen.add(k);
  }
  return { ok: true, value: [...seen] };
}

/**
 * JSON から「欠損の表示」の設定を検証して作る。
 *
 * 省略（undefined）は既定で補う（v0.1 のファイルや、この項目の無いファイルも開けるように）。
 * null、オブジェクトでない値、文字列でない要素、空文字・重複・上限超えは、失敗にする。
 *
 * @param x - 任意の入力
 * @returns 設定、または壊れた項目の経路
 */
export function parseMissingDisplay(x: unknown): ParseResult<MissingDisplay> {
  if (x === undefined) return { ok: true, value: DEFAULT_MISSING_DISPLAY };
  if (!isPlainObject(x)) return { ok: false, path: '', reason: '欠損の表示の設定が不正です' };
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const nodeAttrs = parseKeys(get('nodeAttrs'), 'nodeAttrs');
  if (!nodeAttrs.ok) return nodeAttrs;
  const edgeAttrs = parseKeys(get('edgeAttrs'), 'edgeAttrs');
  if (!edgeAttrs.ok) return edgeAttrs;
  return { ok: true, value: { nodeAttrs: nodeAttrs.value, edgeAttrs: edgeAttrs.value } };
}
