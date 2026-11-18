/**
 * 属性の表 `Attrs` と、その読み書きの関数（D-19）。
 */
import type { AttrValue } from './values';

/**
 * 属性の表。キーは利用者の列名、値は AttrValue。
 *
 * 【なぜ】`attrs[key]` で直接引かず、必ず `getAttr` を使う。キーは利用者の列名なので
 * `constructor`、`toString`、`__proto__` などもありうる。素のオブジェクトを `attrs[key]` で
 * 引くと、データに無いのに `Object.prototype` の項目が返り、存在しない列があるように見える。
 */
// 【TS】`Readonly<Record<string, X>>` は「文字列のキーで X を引く、書き換え不可の辞書」。
export type Attrs = Readonly<Record<string, AttrValue>>;

/**
 * 属性の値を安全に引く。
 *
 * `attrs[key]` で直接引いてはならない（`constructor` や `__proto__` という列名で、
 * `Object.prototype` の項目を返してしまうため）。
 *
 * @param attrs - 属性の表
 * @param key - 列名
 * @returns 値。そのキーを自分で持っていなければ undefined（「当てはまらない」。欠損は Missing の値で表す）
 */
export function getAttr(attrs: Attrs, key: string): AttrValue | undefined {
  // 【なぜ】Object.hasOwn は、自分自身の項目だけを調べる（継承した項目は見ない）。
  if (!Object.hasOwn(attrs, key)) return undefined;
  // 【TS】noUncheckedIndexedAccess により、この結果の型は `AttrValue | undefined`。
  return attrs[key]; // core でこの直接参照が許されるのは、ここだけ
}

/**
 * （キー, 値）の組から属性の表を作る。
 *
 * `Object.fromEntries` は各項目を「自分自身の項目」として作るので、`__proto__` という列名でも
 * prototype を書き換えず、普通の項目になる。同じキーが複数あれば、後のものが勝つ。
 *
 * @param entries - （キー, 値）の組の並び
 * @returns 属性の表
 */
// 【TS】`Iterable<T>` は for...of で回せるもの全般（配列、Set、Map、ジェネレータなど）。
export function makeAttrs(entries: Iterable<readonly [string, AttrValue]>): Attrs {
  return Object.fromEntries(entries);
}
