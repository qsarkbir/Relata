import type { FilterDef } from '../../core/filter';

// 【TS】`FilterDef['kind']` は、FilterDef の `kind` の型（インデックスアクセス型）。種類を足すと自動で追従する。
//       `Extract<FilterDef, { kind: K }>` は、共用体 FilterDef から、`kind` が K のものだけを取り出す型。
/** 種類 K のフィルタ。 */
export type FilterOfKind<K extends FilterDef['kind']> = Extract<FilterDef, { kind: K }>;

/**
 * 条件に合うフィルタを、ID ではなく（種類、対象、属性）で探す。
 *
 * 【なぜ】部品が決めた ID（`filterIds.ts`）で探すと、プロジェクトファイルなどから別の ID で入ったフィルタが
 * 見つからず、チェックの状態が実際の絞り込みと食い違う（filter-audit #2、#3）。
 * 同じ条件のフィルタが複数あっても、すべて返す（部品が気づけるように）。
 *
 * @param filters - `FilterState.filters`
 * @param kind - フィルタの種類
 * @param where - 種類を絞り込んだ後の条件（対象や属性の一致）。省略すると、その種類すべて
 * @returns 条件に合うフィルタ（並びは元のまま）
 */
// 【TS】`(f): f is FilterOfKind<K>` は「型述語」。true を返したとき、TypeScript は f を FilterOfKind<K> として
//       扱う。`filter` の戻り値の型が `FilterOfKind<K>[]` になる。
export function findFilters<K extends FilterDef['kind']>(
  filters: readonly FilterDef[],
  kind: K,
  where: (f: FilterOfKind<K>) => boolean = () => true,
): FilterOfKind<K>[] {
  // 理由: `f.kind === kind` を通ったので f は FilterOfKind<K>。ジェネリクスの K では TypeScript が絞り込めない。
  return filters.filter(
    (f): f is FilterOfKind<K> => f.kind === kind && where(f as FilterOfKind<K>),
  );
}
