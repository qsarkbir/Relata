/**
 * FilterState の検査（D-21 (6)）。データセットに対して意味のないフィルタを見つける。
 *
 * 【なぜ】存在しない属性や値を指すフィルタは、エラーにはならないが何も絞らないか、
 * 全部を除くかのどちらかで、利用者には「一覧に出ているのに効かない」ように見える
 * （旧版 filter-audit #2、#3 と同じ種類の混乱）。警告として一覧にして見えるようにする。
 */
import { assertNever } from '../util/assertNever';
import { getAttr, type AttributeDef, type Dataset } from '../model';
import { categoryKeyId, categoryKeysOf } from './keys';
import type { CategoryKey, FilterId, FilterState, Target } from './types';

// 【TS】判別共用体。`kind` の値で、持つ項目が決まる。呼び出し側は switch で分岐し、
//       assertNever で扱い漏れをコンパイル時に検出できる。
/** フィルタの問題 1 件。 */
export type FilterIssue =
  /** schema に無い属性（対象に合う `appliesTo` の定義が無い）を指している。 */
  | {
      readonly kind: 'unknown-attr';
      readonly filterId: FilterId;
      readonly target: Target;
      readonly attr: string;
    }
  /** データセットに無いノード型を指している。 */
  | { readonly kind: 'unknown-node-type'; readonly filterId: FilterId; readonly nodeType: string }
  /** データに現れない値（または欠損の理由）を選んでいる。 */
  | { readonly kind: 'unknown-category'; readonly filterId: FilterId; readonly key: CategoryKey }
  /** 範囲が逆転している（min > max、または from > to）。何も通らない。 */
  | { readonly kind: 'reversed-range'; readonly filterId: FilterId }
  /** 時間フィルタの `from` と `to` の両方が無い（範囲が決まっていない。何も絞らない）。 */
  | { readonly kind: 'time-unbounded'; readonly filterId: FilterId }
  /** 時間フィルタが指す属性が日付型（`valueType: 'date'`）でない（D-35）。 */
  | { readonly kind: 'attr-not-date'; readonly filterId: FilterId; readonly attr: string }
  /** `nodeSet` のフィルタが、データセットに無いノード ID を含んでいる（D-41）。 */
  | { readonly kind: 'unknown-node-id'; readonly filterId: FilterId; readonly nodeId: string };

/**
 * FilterState がデータセットと整合しているかを検査する。
 *
 * 見つける問題: 存在しない属性、存在しないノード型、データに現れないカテゴリの値、
 * 逆転した範囲。例外は投げない（`checkDataset` と同じ流儀）。入力は書き換えない。
 *
 * 計算量: O(F·(V+E)) （カテゴリのフィルタだけ、対象の要素を 1 回ずつ見る）。
 *
 * @param dataset - データセット
 * @param state - フィルタの状態
 * @returns 問題の一覧（無ければ空）
 */
export function checkFilterState(dataset: Dataset, state: FilterState): FilterIssue[] {
  const issues: FilterIssue[] = [];
  const typeIds = new Set<string>(dataset.nodeTypes.map((t) => t.id));
  for (const f of state.filters) {
    switch (f.kind) {
      case 'category': {
        if (!hasAttr(dataset, f.target, f.attr)) {
          issues.push({ kind: 'unknown-attr', filterId: f.id, target: f.target, attr: f.attr });
          break;
        }
        const present = presentKeys(dataset, f.target, f.attr);
        for (const key of f.include) {
          if (!present.has(categoryKeyId(key))) {
            issues.push({ kind: 'unknown-category', filterId: f.id, key });
          }
        }
        break;
      }
      case 'range':
        if (!hasAttr(dataset, f.target, f.attr)) {
          issues.push({ kind: 'unknown-attr', filterId: f.id, target: f.target, attr: f.attr });
        }
        if (f.min !== undefined && f.max !== undefined && f.min > f.max) {
          issues.push({ kind: 'reversed-range', filterId: f.id });
        }
        break;
      case 'time':
        if (f.from === undefined && f.to === undefined) {
          issues.push({ kind: 'time-unbounded', filterId: f.id });
        } else if (f.from !== undefined && f.to !== undefined && f.from > f.to) {
          issues.push({ kind: 'reversed-range', filterId: f.id });
        }
        if (f.source.kind === 'attr') {
          const def = findAttr(dataset, f.target, f.source.attr);
          // 【なぜ】属性が無い／対象（node・edge）が合わないときは unknown-attr、
          //   あるが日付型でないときは attr-not-date。直し方が違うので分ける。
          if (def === undefined) {
            issues.push({
              kind: 'unknown-attr',
              filterId: f.id,
              target: f.target,
              attr: f.source.attr,
            });
          } else if (def.valueType !== 'date') {
            issues.push({ kind: 'attr-not-date', filterId: f.id, attr: f.source.attr });
          }
        }
        break;
      case 'nodeSet': {
        // 【なぜ】データに無い ID は報告するだけで、フィルタは落とさない。
        //   別のデータで作った選択でも、一覧に出して利用者が解除を決められるようにする。
        const nodeIds = new Set<string>(dataset.nodes.map((n) => n.id));
        for (const id of f.include) {
          if (!nodeIds.has(id))
            issues.push({ kind: 'unknown-node-id', filterId: f.id, nodeId: id });
        }
        // 存在しない型は nodeType と同じ報告にする。
        for (const t of f.passTypes ?? []) {
          if (!typeIds.has(t))
            issues.push({ kind: 'unknown-node-type', filterId: f.id, nodeType: t });
        }
        break;
      }
      case 'certainty':
        // 確からしさのキーは固定の 4 つなので、データセットとの食い違いは起こらない。
        break;
      case 'text':
        break;
      case 'nodeType':
        for (const t of f.include) {
          if (!typeIds.has(t))
            issues.push({ kind: 'unknown-node-type', filterId: f.id, nodeType: t });
        }
        break;
      default:
        return assertNever(f, 'FilterDef');
    }
  }
  return issues;
}

// schema から、その対象の属性の定義を探す。
//
function findAttr(dataset: Dataset, target: Target, attr: string): AttributeDef | undefined {
  return dataset.schema.find((d) => d.key === attr && d.appliesTo === target);
}

// schema に、その対象の属性として定義があるか。
//
function hasAttr(dataset: Dataset, target: Target, attr: string): boolean {
  return findAttr(dataset, target, attr) !== undefined;
}

// データに実際に現れる項目（categoryKeyId）の集合。
//
function presentKeys(dataset: Dataset, target: Target, attr: string): Set<string> {
  const out = new Set<string>();
  const owners = target === 'node' ? dataset.nodes : dataset.edges;
  for (const o of owners) {
    const a = getAttr(o.attrs, attr);
    if (a === undefined) continue;
    for (const k of categoryKeysOf(a)) out.add(categoryKeyId(k));
  }
  return out;
}
