/**
 * 属性値から「ファセットの項目」（CategoryKey）を取り出す。カテゴリのフィルタと
 * ファセットの件数が同じ規則を使うよう、1 か所に置く（FR-FL-07、D-21）。
 */
import { assertNever } from '../util/assertNever';
import { dateValues, scalarValues, type AttrValue } from '../model';
import type { CategoryKey } from './types';

/**
 * CategoryKey を、Map のキーにできる文字列にする。
 *
 * 【なぜ】値の "undefined" と欠損が衝突しないよう、先頭の印（`v:` と `m:`）で種類を分ける。
 *
 * @param key - ファセットの項目
 * @returns 一意な文字列
 */
export function categoryKeyId(key: CategoryKey): string {
  switch (key.kind) {
    case 'value':
      return `v:${key.value}`;
    case 'missing':
      return `m:${key.reason}`;
    default:
      return assertNever(key, 'CategoryKey');
  }
}

/**
 * 属性値が持つファセットの項目を、重複なしで返す。
 *
 * - 値: `String(値)` を項目にする（D-21）。複数値は値ごとに 1 項目（FR-DM-07）。
 * - 日付の属性: 元の表記（`label`）を項目にする（D-21 に定めのない点。日付をカテゴリとして
 *   使うことは少ないが、"[object Object]" のような文字列を作らないため）。
 * - 欠損: 理由つきの項目 1 つ（FR-FL-06）。
 *
 * @param v - 属性値
 * @returns 項目の配列（出現順。同じ項目は 1 回だけ）
 */
export function categoryKeysOf(v: AttrValue): CategoryKey[] {
  switch (v.kind) {
    case 'missing':
      return [{ kind: 'missing', reason: v.reason }];
    case 'value':
      return distinctValues(scalarValues(v).map(String));
    case 'date':
      return distinctValues(dateValues(v).map((d) => d.label));
    default:
      return assertNever(v, 'AttrValue');
  }
}

// 文字列の並びを、重複を除いた値の項目にする。
//
function distinctValues(values: readonly string[]): CategoryKey[] {
  return [...new Set(values)].map((value) => ({ kind: 'value', value }));
}
