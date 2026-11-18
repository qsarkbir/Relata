/**
 * 属性の値の型（FR-DM-04、05、07）と、その型ガード。
 */
import { assertNever } from '../util/assertNever';
import type { CalendarId, DayNumber } from './time';

/** 単純な値。 */
export type Scalar = string | number | boolean;

/**
 * 欠損の理由（FR-DM-04）。
 *
 * - `unrecorded`: 記載なし（史料に書かれていない）
 * - `lost`: 史料の亡失（書かれていたはずだが失われた）
 * - `illegible`: 判読不能
 * - `not-applicable`: 該当なし
 *
 * 史料では「書かれていない」と「失われた」を区別したいので、理由を持つ。
 */
export type MissingReason = 'unrecorded' | 'lost' | 'illegible' | 'not-applicable';

/** 確からしさ。 */
export type Certainty = 'certain' | 'probable' | 'possible';

// 【TS】`as const` は配列を「読み取り専用で、要素が文字列リテラルの配列」にする。
//       `satisfies readonly MissingReason[]` は「この一覧が型に合っているか」だけを検査し、
//       値の型は狭いまま残す。一覧に型にない値を書くと型エラーになる。
/** 取りうる欠損の理由の一覧。外から来た値の検査と、画面の選択肢に使う。 */
export const MISSING_REASONS = [
  'unrecorded',
  'lost',
  'illegible',
  'not-applicable',
] as const satisfies readonly MissingReason[];
/** 取りうる確からしさの一覧。 */
export const CERTAINTIES = [
  'certain',
  'probable',
  'possible',
] as const satisfies readonly Certainty[];

/**
 * 欠損。理由を必ず持つ（FR-DM-04）。
 */
// 【なぜ】undefined や空文字ではなく kind で表す。欠損に「理由」を持たせ、
//       集計や凡例で「記載なし」と「史料の亡失」を別々に数えられるようにするため（設計書 §5）。
export interface Missing {
  kind: 'missing';
  reason: MissingReason;
}

/**
 * 幅のある日付。最も早い日と最も遅い日で表す（FR-DM-05）。
 */
// 【なぜ】日付を単一の数値（JDN）に潰さない。史料の日付は「c.1650」「1050 AH の Ramaḍān」のように
//       幅があり、確からしさも元の暦も元の表記も、書き出しや表示で必要になる（D-18、設計書 §5.1）。
export interface FuzzyDate {
  /** 最も早い日（JDN）。安全な整数（Number.isSafeInteger）。 */
  readonly earliest: DayNumber;
  /** 最も遅い日（JDN）。earliest <= latest。 */
  readonly latest: DayNumber;
  readonly certainty: Certainty;
  /** 元の暦。表示や書き出しで元の表記に戻すため。 */
  readonly calendar: CalendarId;
  /** 元の表記（例: "c.1650"、"15 Ramaḍān 1050"）。 */
  readonly label: string;
}

/**
 * 属性の値。判別共用体にする（FR-DM-04、05、07）。
 *
 * `value` の配列は複数値（FR-DM-07）。
 */
// 【TS】「判別共用体」は、共通の項目 `kind` の値で型が決まる共用体。
//       `if (v.kind === 'date')` と書くだけで、その中の v は日付の型に絞り込まれる。
// 【TS】`readonly Scalar[]` は「中身を変えられない配列」。Dataset を不変に扱うため。
export type AttrValue =
  | { kind: 'value'; value: Scalar | readonly Scalar[]; certainty?: Certainty }
  | { kind: 'date'; value: FuzzyDate | readonly FuzzyDate[] }
  | Missing;

// 【TS】`Extract<U, T>` は共用体 U のうち T に当てはまるものだけを取り出すユーティリティ型。
/** 通常の値の種類の AttrValue。 */
export type ValueAttr = Extract<AttrValue, { kind: 'value' }>;
/** 日付の種類の AttrValue。 */
export type DateAttr = Extract<AttrValue, { kind: 'date' }>;

/**
 * 値が欠損かを判定する。
 *
 * 外から来た `unknown` にも使える（理由が正しい欠損の形かまで確かめる）。
 *
 * @param v - 判定する値
 * @returns 欠損なら true
 */
// 【TS】`v is Missing` は「型ガード」。true を返した分岐では、v が Missing として扱われる。
//       引数を unknown にすると、AttrValue でも、読み込んだばかりの未検査の値でも渡せる。
export function isMissing(v: unknown): v is Missing {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>; // 理由: 直後で kind と reason を実行時に検査する
  return o.kind === 'missing' && isMissingReason(o.reason);
}

/**
 * 欠損の理由として正しい文字列かを判定する。
 *
 * @param x - 判定する値
 * @returns MissingReason なら true
 */
export function isMissingReason(x: unknown): x is MissingReason {
  return MISSING_REASONS.some((r) => r === x);
}

/**
 * 確からしさとして正しい文字列かを判定する。
 *
 * @param x - 判定する値
 * @returns Certainty なら true
 */
export function isCertainty(x: unknown): x is Certainty {
  return CERTAINTIES.some((c) => c === x);
}

/**
 * 通常の値の属性かを判定する。
 *
 * @param v - 判定する属性値
 * @returns `kind` が 'value' なら true
 */
export function isValueAttr(v: AttrValue): v is ValueAttr {
  return v.kind === 'value';
}

/**
 * 日付の属性かを判定する。
 *
 * @param v - 判定する属性値
 * @returns `kind` が 'date' なら true
 */
export function isDateAttr(v: AttrValue): v is DateAttr {
  return v.kind === 'date';
}

/**
 * 通常の値の属性から、値を配列として取り出す（1 値でも複数値でも同じ形になる）。
 *
 * @param v - 通常の値の属性
 * @returns Scalar の配列
 */
export function scalarValues(v: ValueAttr): readonly Scalar[] {
  // 【TS】`Array.isArray` は readonly 配列を絞り込めない（型定義の制約）。そこで、
  //       Scalar（string、number、boolean）は typeof が 'object' にならないことを使う。
  //       `typeof v.value === 'object'` が true なら、残るのは配列だけである。
  return typeof v.value === 'object' ? v.value : [v.value];
}

/**
 * 日付の属性から、日付を配列として取り出す。
 *
 * @param v - 日付の属性
 * @returns FuzzyDate の配列
 */
export function dateValues(v: DateAttr): readonly FuzzyDate[] {
  // 【TS】`'earliest' in x` は「x がその名前の項目を持つか」で型を絞り込む。
  //       FuzzyDate は earliest を持ち、配列は持たないので、この分岐で両者を区別できる。
  return 'earliest' in v.value ? [v.value] : v.value;
}

/**
 * 属性値を、複数値でも 1 値でも同じ「配列」として取り出す。欠損は空配列。
 *
 * 複数値の属性（FR-DM-07）を、1 値の場合と分けずに数えるために使う。
 *
 * @param v - 属性値
 * @returns 値の配列（日付の属性なら FuzzyDate の配列）
 */
export function attrValues(v: AttrValue): readonly (Scalar | FuzzyDate)[] {
  switch (v.kind) {
    case 'missing':
      return [];
    case 'value':
      return scalarValues(v);
    case 'date':
      return dateValues(v);
    default:
      return assertNever(v, 'AttrValue');
  }
}
