/**
 * 配色（NFR-07、設計書 §8.2、R-08、D-23）。色は `#rrggbb` の小文字に統一する。
 */

// 【TS】`as const` で、配列を読み取り専用のタプル（要素の型が文字列リテラル）にする。
/**
 * カテゴリの色。Okabe-Ito の 8 色（Okabe & Ito, 2008, "Color Universal Design (CUD)":
 * 色覚の多様性があっても区別しやすい配色）をこの順で使う。
 */
export const CATEGORY_COLORS = [
  '#e69f00',
  '#56b4e9',
  '#009e73',
  '#f0e442',
  '#0072b2',
  '#d55e00',
  '#cc79a7',
  '#000000',
] as const;

/** 9 個目以降のカテゴリの色。凡例では「その他」にまとめる。 */
export const OTHER_COLOR = '#999999';
/** 欠損の色（FR-DM-02）。 */
export const MISSING_COLOR = '#dddddd';

/**
 * 連続値の色の代表点。viridis（Smith & van der Walt (2015), "A Better Default Colormap for
 * Matplotlib", SciPy 2015。CC0）を 9 等分した色で、値は R の viridisLite（Garnier）の
 * `viridis(9)` による。暗い紫から黄へ一方向に明るくなり、白黒印刷でも順序が分かる。
 * 9 色の間は sRGB で線形補間するので、元の 256 色の表とはわずかに違う。
 */
export const VIRIDIS_STOPS = [
  '#440154',
  '#472d7b',
  '#3b528b',
  '#2c728e',
  '#21908c',
  '#27ad81',
  '#5dc863',
  '#aadc32',
  '#fde725',
] as const;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * 利用者のデータから来た色を検査し、小文字の `#rrggbb` にそろえる（設計書 §8.1）。
 *
 * @param s - 色の候補
 * @returns 正しければ小文字の `#rrggbb`、不正なら null
 */
export function normalizeColor(s: string | undefined): string | null {
  return s !== undefined && HEX_COLOR.test(s) ? s.toLowerCase() : null;
}

// `#rrggbb` を [r, g, b]（0〜255）にする。呼び出すのは定数だけなので、形式は保証されている。
function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// 【TS】戻り値が `[number, number, number]` のタプルなので、添字 0〜2 は number で確定する
//       （配列 `number[]` だと noUncheckedIndexedAccess で undefined を含む）。
/**
 * viridis の色を線形補間する。
 *
 * @param t - 0〜1（範囲外は端に丸める。NaN は 0）
 * @returns 小文字の `#rrggbb`
 */
export function viridisColor(t: number): string {
  const x = Number.isNaN(t) ? 0 : Math.min(1, Math.max(0, t));
  const pos = x * (VIRIDIS_STOPS.length - 1);
  const i = Math.min(Math.floor(pos), VIRIDIS_STOPS.length - 2);
  const f = pos - i;
  // 【TS】noUncheckedIndexedAccess により添字アクセスは undefined を含む。i は範囲内だが、型には `??` で既定値を答える。
  const a = rgb(VIRIDIS_STOPS[i] ?? '#440154');
  const b = rgb(VIRIDIS_STOPS[i + 1] ?? '#fde725');
  const hex = (k: 0 | 1 | 2): string =>
    Math.round(a[k] + (b[k] - a[k]) * f)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(0)}${hex(1)}${hex(2)}`;
}
