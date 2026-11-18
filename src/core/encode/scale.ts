/**
 * 値を大きさ・太さ（ピクセル）に写すスケール（FR-VG-04、設計書 §8.2、D-08、D-23）。
 */
import { assertNever } from '../util/assertNever';

/** スケールの種類。 */
export type ScaleKind = 'linear' | 'sqrt' | 'log';

// 【TS】`as const` は配列を「読み取り専用で、要素が文字列リテラルの配列」にする。
//       `satisfies readonly ScaleKind[]` は「この一覧が型に合っているか」だけを検査し、
//       値の型は狭いまま残す。型にない値を書くと型エラーになる。
/** 取りうるスケールの種類の一覧。外から来た値の検査と、画面の選択肢に使う。 */
export const SCALE_KINDS = ['linear', 'sqrt', 'log'] as const satisfies readonly ScaleKind[];

// 【TS】`readonly` は「後から書き換えない」ことを表す修飾子（プロパティに付ける）。
/** 出力の範囲（ピクセル）。 */
export interface PixelRange {
  readonly min: number;
  readonly max: number;
}

/** 作ったスケールと、凡例や警告に必要な情報。 */
export interface ScaleResult {
  readonly kind: ScaleKind;
  /** 定義域。常に 0 を含む [min(0, 最小値), max(0, 最大値)]。平方根と対数は負を 0 とみなすので下端が 0。 */
  readonly domain: { readonly min: number; readonly max: number };
  readonly range: PixelRange;
  /** 値のうち負だった件数。平方根と対数では 0 として扱った件数（線形では 0 を基準にそのまま使う）。 */
  readonly negativeCount: number;
  /** 値を大きさに写す関数。範囲外の値は端に丸める。有限でない値は最小値にする。 */
  readonly apply: (v: number) => number;
}

// 【TS】`Exclude<A, B>` は和集合 A から B を除いた型。ここでは 'sqrt' | 'log' だけを受ける。
// 変換 f。平方根は √v、対数は log(1+v)。負の値は 0 とみなす（どちらも負では定義できないため）。
function transform(kind: Exclude<ScaleKind, 'linear'>, v: number): number {
  const x = Math.max(0, v);
  return kind === 'sqrt' ? Math.sqrt(x) : Math.log1p(x);
}

/**
 * 値の集合からスケールを作る。
 *
 * 定義域は [min(0, 最小値), max(0, 最大値)]（D-23。全部負でも 0 を含む）。
 * 出力は「最小 + t ×（最大 − 最小）」。平方根で range.min が 0 のときに限り、半径の 2 乗（面積）が
 * 値に比例する（min > 0 では値 0 も最小の大きさで描かれる）。
 * 値が空、1 つだけ、すべて 0 のときは定義域の幅が 0 になるので、t を 0 にして 0 除算を避ける
 * （最大の値が 1 つだけで正なら、その値が t = 1 になる）。
 *
 * 計算量: 値の数を n として O(n)（定義域を決める 1 回の走査）。`apply` は 1 回 O(1)。
 *
 * @param values - スケールの定義域を決める値（欠損は含めない）。有限でない値は無視する
 * @param kind - スケールの種類
 * @param range - 出力の範囲（ピクセル）
 * @returns スケールと、負の値の件数など
 */
// 【TS】引数の `Iterable<number>` は、配列にも Set にも `Map.values()` にも使える「繰り返せるもの」の型。
export function makeScale(
  values: Iterable<number>,
  kind: ScaleKind,
  range: PixelRange,
): ScaleResult {
  let lo = 0;
  let hi = 0;
  let negativeCount = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (v < 0) negativeCount += 1;
  }
  const span = range.max - range.min;
  const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

  let domain: { min: number; max: number };
  let toT: (v: number) => number;
  switch (kind) {
    case 'linear': {
      domain = { min: lo, max: hi };
      const width = hi - lo;
      toT = (v) => (width > 0 ? (v - lo) / width : 0);
      break;
    }
    case 'sqrt':
    case 'log': {
      // 【なぜ】負の値は 0 とみなすので、定義域の下端も 0 になる。
      domain = { min: 0, max: hi };
      const top = transform(kind, hi);
      toT = (v) => (top > 0 ? transform(kind, v) / top : 0);
      break;
    }
    default:
      return assertNever(kind, 'ScaleKind');
  }
  return {
    kind,
    domain,
    range,
    negativeCount: kind === 'linear' ? 0 : negativeCount,
    apply: (v) => (Number.isFinite(v) ? range.min + clamp01(toT(v)) * span : range.min),
  };
}
