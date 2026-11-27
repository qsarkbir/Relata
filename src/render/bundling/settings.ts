/**
 * Edge bundling の入力・設定・出力の型と、設定の検査（FR-VG-13、D-55、設計書 §8.4）。
 *
 * 【規約】
 * - 座標は任意の平面座標（グラフのレイアウト座標、地図ではメルカトルの平面座標）。ズームに依らない。
 * - 自己ループ（始点と終点が同じ点）と長さ 0 のエッジは束ねず、2 点の線のまま返す。件数も返す。
 * - 多重エッジ（同じ 2 点間の複数のエッジ）は、ID が違えば別々のエッジとして扱う。
 *   座標が同じなので互換度は 1 になり、ほぼ同じ線に重なる（太さは T3-02 が重みの合計で出す）。
 * - 孤立ノードはエッジを持たないので、ここには現れない。
 * - 有向と無向: 算法は向きを使わない。逆向きに並ぶエッジは、有向でも無向でも、点の対応を反転して
 *   1 本の中心線に束ねる。各 path は始点から終点の順なので、向きの描き分け（車線、先細り、矢印）は
 *   描画側（T3-02）が画面の px で行う（D-55 の補足。`directed` は描画側が使うために入力に持つ）。
 * - 座標の絶対値は 1e9 以下（layout と同じ上限）。
 * - DOM、Worker、`Date`、`Math.random` は使わない。同じ入力は同じ結果になる（NFR-08）。
 *
 * このファイルは Worker からも読まれるので、DOM の型に触れない（設計書 §4.1、D-30）。
 */

/** 束ねる対象のエッジ 1 本。 */
// 【TS】`readonly` の項目は、代入しようとすると型エラーになる。入力を書き換えないことを型で保証する。
export interface BundleEdge {
  /** エッジの ID。結果の対応づけと、処理順（ID の昇順）に使う。 */
  readonly id: string;
  /** 始点の x。 */
  readonly x1: number;
  /** 始点の y。 */
  readonly y1: number;
  /** 終点の x。 */
  readonly x2: number;
  /** 終点の y。 */
  readonly y2: number;
  /** 有向なら true。算法では使わず、描画側が向きの表現に使う。 */
  readonly directed: boolean;
  /** 重み。この算法の力には使わない（束の太さは T3-02 で、通るエッジの重みの合計から出す）。 */
  readonly weight: number;
}

/** 束ねる設定。すべて任意で、足りない項目は {@link DEFAULT_BUNDLING_SETTINGS} で補う。 */
export interface BundlingSettings {
  /** 束ねる強さ（0〜1）。大きいほど強く束ねる（ばねを弱くする）。 */
  readonly strength: number;
  /** 段階の数（1〜8）。段階 c の分割数は 2^(c+1)（2、4、8、…）。 */
  readonly cycles: number;
  /** 最初の段階の反復回数（1〜500）。段階ごとに 2/3 倍していく。 */
  readonly iterations: number;
  /** 最初の段階の移動の割合（0.0001〜1。Holten ほかのステップ幅 S に当たる）。1 反復で目標へ動く割合で、段階ごとに半分にする。 */
  readonly stepSize: number;
  /** 互換度のしきい値（0.05〜0.99）。これ未満の組は引き合わない。 */
  readonly compatibilityThreshold: number;
  /** 1 本のエッジが相手にする互換エッジの上限（1〜1000）。多い所の時間を抑える。 */
  readonly maxNeighbors: number;
}

/** 既定の設定。 */
// 【TS】`as const` は値を読み取り専用のリテラル型（例: 0.85 という型）に固定する。
//   `satisfies` は「この型に合うか」を検査しつつ、値の型を広げずに保つ（項目の付け間違いを防ぐ）。
export const DEFAULT_BUNDLING_SETTINGS = {
  strength: 0.85,
  cycles: 5,
  iterations: 50,
  stepSize: 0.4,
  compatibilityThreshold: 0.6,
  maxNeighbors: 60,
} as const satisfies BundlingSettings;

/** 警告を出すエッジ数の境目（D-55）。これを超えたら、始めてよいかを利用者に確かめる。 */
export const BUNDLING_EDGE_WARNING_LIMIT = 5000;

/**
 * エッジ数が警告の境目（5,000 本）を超えるかを返す。
 *
 * @param edgeCount - 束ねる対象のエッジ数
 * @param limit - 境目（既定は 5,000）
 * @returns 超えているなら true（ちょうど 5,000 本は超えない）
 */
export function exceedsBundlingLimit(
  edgeCount: number,
  limit: number = BUNDLING_EDGE_WARNING_LIMIT,
): boolean {
  return edgeCount > limit;
}

// 【TS】`Record<K, V>` は「キー K のそれぞれが値 V を持つ」オブジェクトの型。
//   `keyof T` は T の項目名の和（'strength' | 'cycles' | …）。設定に項目を足して範囲を書き忘れると、型エラーになる。
/** 設定の項目ごとの範囲。 */
const RANGES: Record<keyof BundlingSettings, { min: number; max: number; integer: boolean }> = {
  strength: { min: 0, max: 1, integer: false },
  cycles: { min: 1, max: 8, integer: true },
  iterations: { min: 1, max: 500, integer: true },
  stepSize: { min: 0.0001, max: 1, integer: false },
  compatibilityThreshold: { min: 0.05, max: 0.99, integer: false },
  maxNeighbors: { min: 1, max: 1000, integer: true },
};

/**
 * 設定を検査し、足りない項目（と undefined の項目）を既定値で補う。
 *
 * @param input - 利用者の設定（一部だけでよい）
 * @returns 補い終えた設定
 * @throws RangeError 範囲外、整数でない、有限でない値があるとき
 */
// 【TS】`Partial<T>` は T のすべての項目を任意にした型。
export function resolveBundlingSettings(input: Partial<BundlingSettings> = {}): BundlingSettings {
  // 【TS】Object.keys は string[] を返すので、`as` で項目名の型に絞る（RANGES のキーそのものなので安全）。
  const keys = Object.keys(RANGES) as (keyof BundlingSettings)[];
  const merged: Record<keyof BundlingSettings, number> = { ...DEFAULT_BUNDLING_SETTINGS };
  for (const key of keys) {
    // 【なぜ】`{ ...既定, ...input }` だと、値が undefined の項目が既定値を上書きしてしまう。
    const given = input[key];
    const value = given ?? merged[key];
    const range = RANGES[key];
    if (
      !Number.isFinite(value) ||
      value < range.min ||
      value > range.max ||
      (range.integer && !Number.isInteger(value))
    ) {
      throw new RangeError(
        `束ねる設定 ${key} は ${String(range.min)}〜${String(range.max)}` +
          `${range.integer ? ' の整数' : ''}にしてください（受け取った値: ${String(value)}）。`,
      );
    }
    merged[key] = value;
  }
  return merged;
}

/** 束ねた後の 1 本の折れ線。 */
export interface BundledPath {
  /** エッジの ID。 */
  readonly id: string;
  /**
   * 折れ線の頂点。x, y, x, y, … の順に並べた平らな配列（長さは偶数、2 点以上）。
   * 先頭と末尾は入力の始点と終点と完全に同じ。
   * 【なぜ】平らな配列にする。Worker から送る（structured clone）量と作る数を減らすため。
   */
  readonly points: readonly number[];
  /** 束ねる対象だったなら true。自己ループと長さ 0 のエッジは false（2 点の線のまま）。 */
  readonly bundled: boolean;
  /** 入力の `directed` をそのまま写す（描画側が id から引き直さずに向きの表現を決めるため）。 */
  readonly directed: boolean;
}

/** 束ねた結果。 */
export interface BundlingResult {
  /** エッジ ID の昇順（コード単位の比較）の折れ線。入力の順に依らない。 */
  readonly paths: readonly BundledPath[];
  /** 束ねずにそのまま返した件数（自己ループと長さ 0）。 */
  readonly unbundledCount: number;
}

/** 段階ごとの進み具合。 */
export interface BundlingProgress {
  /** 終わった段階の数（0〜cycles）。 */
  readonly cycle: number;
  /** 段階の総数。 */
  readonly cycles: number;
  /** すべて終わったなら true。 */
  readonly done: boolean;
}

/** 計算の準備で分かる情報。 */
export interface BundlingInfo {
  /** 段階の総数。 */
  readonly cycles: number;
  /** 束ねる対象の本数。 */
  readonly bundledCount: number;
  /** 束ねない本数（自己ループ、長さ 0）。 */
  readonly unbundledCount: number;
  /** 互換度がしきい値以上の組の数（上限で切る前）。 */
  readonly compatiblePairCount: number;
}
