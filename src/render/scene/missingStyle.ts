/** 欠損の印の間隔（px）。値の欠損と指定した属性の欠損を区別する（FR-VG-12）。 */

/**
 * 欠損のあるノードの輪郭の破線。
 * @param attrMissing - 利用者が指定した属性が欠けているか
 * @returns 線とすき間の長さ（px）
 */
export function nodeDash(attrMissing: boolean): readonly [number, number] {
  return attrMissing ? [6, 3] : [3, 2];
}

/**
 * 欠損のあるエッジの破線。
 * @param attrMissing - 利用者が指定した属性が欠けているか
 * @returns 線とすき間の長さ（px）
 */
export function edgeDash(attrMissing: boolean): readonly [number, number] {
  return attrMissing ? [9, 4] : [4, 3];
}

/** 欠損のある先細りの帯の塗りに掛ける不透明度。輪郭の破線を見分けやすくする。 */
export const MISSING_TAPER_FILL_OPACITY = 0.4;
