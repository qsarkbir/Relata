/**
 * edge bundling の保存可能な設定（`view.graph.bundling`、`view.map.bundling`。D-55、D-59、FR-VG-13、14）。
 *
 * 設定はグラフと地図でそれぞれ持つ。反復回数と ε は古いファイルで省略できる（D-24）。
 */
import { isPlainObject, type ParseResult } from '../model';

/** 描き方。`bands` は束の太さの帯（既定）、`overlay` は半透明の重ね描き（簡易版）。 */
export type BundlingViewStyle = 'bands' | 'overlay';

// 【TS】`as const satisfies readonly X[]` は、配列を「リテラルの読み取り専用の組」に固定しつつ（as const）、
//       要素が X として正しいかを検査する（satisfies）。型に描き方を足して、ここを書き忘れると型エラーになる。
/** 描き方の一覧。 */
export const BUNDLING_VIEW_STYLES = [
  'bands',
  'overlay',
] as const satisfies readonly BundlingViewStyle[];

/** 最初の段階の反復回数と、平均端点間距離に対する ε の比率の入力範囲。 */
export const BUNDLING_VIEW_NUMBERS = {
  iterations: { min: 1, max: 500, defaultValue: 50 },
  epsilonRatio: { min: 0.001, max: 0.1, defaultValue: 0.01 },
} as const;

/**
 * 束ねる設定（保存用）。
 *
 * 【なぜ】名前に `View` を付ける。`render/bundling` の算法用の設定（反復回数など）と取り違えないため。
 * 強さと反復回数の既定値は算法の既定に合わせる。ε の比率は座標の単位が異なる地図とグラフで共通に使える。
 */
export interface BundlingViewSettings {
  /** 束ねるか。既定は無効（計算が重いので、利用者が有効にする）。 */
  readonly enabled: boolean;
  /** 束ねる強さ（0〜1）。0 は束ねない（直線のまま）、1 は最も強く束ねる。 */
  readonly strength: number;
  /** 最初の段階の反復回数。省略時は 50。 */
  readonly iterations?: number;
  /** 区間を同じ束とみなす距離（ε）を平均端点間距離に対する比率で指定する。省略時は 0.01。 */
  readonly epsilonRatio?: number;
  readonly style: BundlingViewStyle;
}

/** 未設定のときの束ねる設定。 */
export const DEFAULT_BUNDLING_VIEW: BundlingViewSettings = {
  enabled: false,
  strength: 0.85,
  style: 'bands',
};

function numberSetting(
  key: keyof typeof BUNDLING_VIEW_NUMBERS,
  value: unknown,
): number | undefined {
  const { min, max, defaultValue } = BUNDLING_VIEW_NUMBERS[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    return undefined;
  if (key === 'iterations' && !Number.isInteger(value)) return undefined;
  return value === defaultValue ? undefined : value;
}

/**
 * JSON から束ねる設定を組み立てる。無い項目と、読めない項目は既定で補う。
 *
 * 【なぜ】任意の項目なので、1 つの壊れた値のために、ファイル全体を開けなくしない（D-24）。
 * 強さは 0〜1 の有限の数だけを受け入れる。オブジェクトでないときだけ失敗にする。
 * 知らない項目（新しい版が足したもの）は読まずに落とす。
 *
 * @param x - 任意の入力
 * @returns 設定、または壊れた箇所
 */
export function parseBundlingView(x: unknown): ParseResult<BundlingViewSettings> {
  if (!isPlainObject(x)) return { ok: false, path: '', reason: '束ねる設定が不正です' };
  const get = (k: string): unknown => (Object.hasOwn(x, k) ? x[k] : undefined);
  const enabled = get('enabled');
  const strength = get('strength');
  const iterations = numberSetting('iterations', get('iterations'));
  const epsilonRatio = numberSetting('epsilonRatio', get('epsilonRatio'));
  return {
    ok: true,
    value: {
      enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_BUNDLING_VIEW.enabled,
      strength:
        typeof strength === 'number' && Number.isFinite(strength) && strength >= 0 && strength <= 1
          ? strength
          : DEFAULT_BUNDLING_VIEW.strength,
      style: BUNDLING_VIEW_STYLES.find((s) => s === get('style')) ?? DEFAULT_BUNDLING_VIEW.style,
      ...(iterations === undefined ? {} : { iterations }),
      ...(epsilonRatio === undefined ? {} : { epsilonRatio }),
    },
  };
}
