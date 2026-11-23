/**
 * 年表の描画に使う、画面の座標と区切りの番号の変換（FR-TM-01、FR-FL-11）。
 *
 * 日付や暦の計算はしない（`core` の仕事）。区切りの並び（`TimelineBin[]`）の添字と、
 * 横方向の位置（ピクセル）の対応だけを扱う純粋な関数。
 */
import type { TimelineBin } from '../../core/filter';

/**
 * 横方向の位置から、区切りの番号を求める。範囲の外は両端の区切りに寄せる。
 *
 * 【なぜ】ドラッグが描画の領域の外へ出ても、端の区切りまで選べるようにするため。
 *
 * @param x - 描画の領域の左端からの距離
 * @param plotWidth - 描画の領域の幅
 * @param count - 区切りの数（1 以上）
 * @returns 0 以上 count 未満の番号
 */
export function binIndexAt(x: number, plotWidth: number, count: number): number {
  if (count <= 0 || plotWidth <= 0) return 0;
  const i = Math.floor((x / plotWidth) * count);
  return Math.min(count - 1, Math.max(0, i));
}

/**
 * 目盛りの文字を付ける区切りの番号を返す。隣の目盛りと `minGap` ピクセル以上離す。
 *
 * @param count - 区切りの数
 * @param plotWidth - 描画の領域の幅
 * @param minGap - 目盛りの文字の間の最小の距離
 * @returns 目盛りを付ける番号（昇順。先頭の区切りを含む）
 */
export function tickIndexes(count: number, plotWidth: number, minGap: number): number[] {
  if (count <= 0) return [];
  const barWidth = plotWidth > 0 ? plotWidth / count : 0;
  const step = barWidth > 0 ? Math.max(1, Math.ceil(minGap / barWidth)) : count;
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  return out;
}

/**
 * 適用中の時間フィルタの範囲（JDN）が覆う区切りの番号の範囲を返す。
 *
 * 開いた端（undefined）は、年表の端まで。範囲が年表の外にあるときは null。
 *
 * @param bins - 区切りの並び
 * @param from - 範囲の始まり（JDN）。開いた端は undefined
 * @param to - 範囲の終わり（JDN）。開いた端は undefined
 * @returns 先頭と末尾の番号。重ならなければ null
 */
// 【TS】戻り値の型 `{ … } | null` は「該当なし」を null で表す書き方。呼ぶ側は `if (band !== null)` で絞り込んでから使う。
//       `readonly` の項目は代入できない。
export function bandIndexes(
  bins: readonly TimelineBin[],
  from: number | undefined,
  to: number | undefined,
): { readonly first: number; readonly last: number } | null {
  if (bins.length === 0) return null;
  const firstFound = from === undefined ? 0 : bins.findIndex((b) => b.latest >= from);
  if (firstFound < 0) return null;
  let last = bins.length - 1;
  if (to !== undefined) {
    last = -1;
    bins.forEach((b, i) => {
      if (b.earliest <= to) last = i;
    });
  }
  return last < firstFound ? null : { first: firstFound, last };
}

/**
 * ある日の始まりの位置を、区切りの単位（整数部が区切りの番号、小数部が区切りの中の割合）で返す。
 *
 * 再生のカーソルや移動窓の帯を、年表の横軸の上に置くために使う。区切りは切れ目なく並ぶので、
 * 日数の割合で位置を内挿する。区切りの外は両端に寄せる。区切りの日数は暦の年の長さで少し違うため、
 * ピクセルではなく区切りの割合で扱う。
 *
 * @param bins - 区切り（古い順、切れ目なし）。空なら 0
 * @param day - 日（JDN）。その日の始まりの位置を返す
 * @returns 0 以上 区切りの数 以下の値
 */
export function dayBoundary(
  bins: readonly { readonly earliest: number; readonly latest: number }[],
  day: number,
): number {
  const first = bins[0];
  const last = bins[bins.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (day <= first.earliest) return 0;
  if (day > last.latest) return bins.length;
  let index = 0;
  bins.forEach((b, i) => {
    if (b.earliest <= day) index = i;
  });
  const b = bins[index];
  if (b === undefined) return 0;
  return index + (day - b.earliest) / (b.latest - b.earliest + 1);
}
