/**
 * フィルタの型（FR-FL-01〜06、設計書 §6.1、D-21）。
 *
 * フィルタは関数ではなく「データ」として持つ。そのため、保存（FR-PJ-01）、
 * 元に戻す（FR-FL-10）、一覧表示（FR-FL-08）が、値の複製と比較だけで済む。
 */
import type { DayNumber, MissingReason, NodeTypeId } from '../model';

// 【TS】「ブランド型」。ふつうの文字列を FilterId として渡す取り違えを、コンパイル時に防ぐ
//       （仕組みは model/ids.ts の NodeId と同じ。実行時にはただの文字列）。
/** フィルタの識別子。個別の解除（FR-FL-08）と置き換えで、どのフィルタかを指すのに使う。 */
export type FilterId = string & { readonly __brand: 'FilterId' };

/**
 * 文字列を FilterId にする。
 *
 * @param s - ID の文字列（空文字は不可）
 * @returns FilterId
 * @throws RangeError 空文字のとき
 */
export function toFilterId(s: string): FilterId {
  // 【なぜ】空の ID は「ID が無い」状態と区別できないため拒否する（model/ids.ts と同じ方針）。
  if (s.length === 0) throw new RangeError('FilterId は空文字にできません');
  return s as FilterId; // 理由: ブランドは型の上だけの印で、ここが唯一の変換点
}

/** フィルタをかける対象。ノード用とエッジ用を別々に持つ（FR-FL-01、filter-audit #6）。 */
export type Target = 'node' | 'edge';

/** 欠損の扱い。数値と時間の範囲で、欠損を含めるか除くか（FR-FL-06）。既定の画面は 'exclude'。 */
export type MissingPolicy = 'include' | 'exclude';

/**
 * ファセットの項目。値そのものか、理由つきの欠損（FR-FL-06）。
 *
 * 【なぜ】欠損を文字列 "undefined" で表さない（filter-audit #10）。値と欠損は型で別物にする。
 * 値は `String(元の値)` で、数値の 3 も文字列の "3" も同じ項目になる（D-21）。
 */
export type CategoryKey =
  | { readonly kind: 'value'; readonly value: string }
  | { readonly kind: 'missing'; readonly reason: MissingReason };

/** テキスト検索の照合の強さ。'loose' は表記の揺れを無視（FR-FL-12）、'strict' は NFC 正規化だけ。 */
export type TextMatching = 'loose' | 'strict';

/** 時間フィルタの判定。'overlaps' は範囲と重なる（既定）、'within' は範囲に収まる（FR-FL-03）。 */
export type TimeMatch = 'overlaps' | 'within';

// 【TS】`readonly` は書き換え不可の印で、`readonly T[]` は要素の追加や代入ができない配列の型。
//       FilterState を不変の値として扱う約束（§6.3）を、型で守らせる。
// 【TS】`kind` で種類を見分ける「判別共用体」。`switch (def.kind)` の各 case の中では、
//       TypeScript がその種類の項目（`include` や `min` など）を使えるようにしてくれる。
/**
 * フィルタ 1 つの定義。
 *
 * - `category`: 属性の値（複数値ならどれか 1 つ）が `include` のどれかに当たれば通す。
 * - `range`: 数値の範囲（両端を含む）。`min`/`max` の片方だけでもよい。
 * - `time`: 期間が [from, to] と重なる、または収まる。
 * - `text`: ラベル（エッジなら relation）と文字列の属性値への部分一致。
 * - `nodeType`: ノード型で絞る（ノード専用なので `target` を持たない）。
 */
export type FilterDef =
  | {
      readonly id: FilterId;
      readonly kind: 'category';
      readonly target: Target;
      readonly attr: string;
      readonly include: readonly CategoryKey[];
    }
  | {
      readonly id: FilterId;
      readonly kind: 'range';
      readonly target: Target;
      readonly attr: string;
      readonly min?: number;
      readonly max?: number;
      readonly missing: MissingPolicy;
    }
  | {
      readonly id: FilterId;
      readonly kind: 'time';
      readonly target: Target;
      readonly from: DayNumber;
      readonly to: DayNumber;
      readonly match: TimeMatch;
      readonly missing: MissingPolicy;
    }
  | {
      readonly id: FilterId;
      readonly kind: 'text';
      readonly target: Target;
      readonly query: string;
      readonly matching: TextMatching;
    }
  | {
      readonly id: FilterId;
      readonly kind: 'nodeType';
      readonly include: readonly NodeTypeId[];
    };

/** フィルタの種類の一覧。外から来た値の検査に使う。 */
// 【TS】`FilterDef['kind']` は「FilterDef の kind の型」を取り出す書き方（インデックスアクセス型）。
//       FilterDef に種類を足すと自動で追従する。`as const satisfies readonly X[]` は、
//       値を「文字列リテラルの読み取り専用タプル」として固定しつつ（as const）、
//       X の要素として正しいかを検査する（satisfies）。書き間違いと、型の拡張の取りこぼしを防ぐ。
export const FILTER_KINDS = [
  'category',
  'range',
  'time',
  'text',
  'nodeType',
] as const satisfies readonly FilterDef['kind'][];

/** エッジの表示の規則。'both-ends' は両端が通過（既定）、'either-end' は片端でも通過（FR-FL-04）。 */
export type EdgeRule = 'both-ends' | 'either-end';

/**
 * フィルタ全体の状態。変更不可の値として扱い、変えるときは新しい値を作る（§6.3）。
 *
 * 【なぜ】適用中のフィルタの一覧（FR-FL-08）は `filters` そのもの。表示用に別の一覧を持たない
 * （filter-audit #2、#3: 一覧と実際の絞り込みがずれた旧版の不具合を、構造的に防ぐ）。
 */
export interface FilterState {
  readonly filters: readonly FilterDef[];
  readonly edgeRule: EdgeRule;
  /** 孤立ノード（表示されるエッジが無いノード）を表示するか（FR-FL-05）。 */
  readonly showIsolated: boolean;
}

/** 何もフィルタをかけていない既定の状態。両端の規則、孤立ノードは表示しない。 */
export const DEFAULT_FILTER_STATE: FilterState = {
  filters: [],
  edgeRule: 'both-ends',
  showIsolated: false,
};
