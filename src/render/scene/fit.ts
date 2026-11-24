/**
 * 「全体を表示」の倍率の決定（設計書 §8.1、FR-VG-01）。
 */
import type { Scene } from './types';

/** 手で拡大・縮小できる倍率の下限と上限。 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;
/**
 * 「全体を表示」が選ぶ倍率の上限。
 *
 * 【なぜ】ノードが 1 つだけ、または互いにごく近いときは、収まる倍率がいくらでも大きくなる。
 * 利用者が「非常に拡大される」と感じる原因になるので、全体表示は位置を最大 4 倍までにとどめる。
 */
export const MAX_FIT_ZOOM = 4;
/** 全体を収めるときに、枠の上下左右に残す余白（CSS ピクセル）。 */
export const FIT_MARGIN = 20;

/** `fitZoomFor` の結果。 */
export interface FitResult {
  /** 位置に掛ける倍率（`buildScene` の `zoom`）。 */
  readonly zoom: number;
  /** その倍率で作ったシーン。呼ぶ側が、枠の中央に置くために幅と高さを使う。 */
  readonly scene: Scene;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/**
 * 図の全体が枠に収まる位置の倍率を求める。
 *
 * 半径、太さ、ラベルは px のままなので、シーンの幅は「位置の広がり × 倍率 ＋ 倍率に依らない分」になる。
 * 倍率 1 でシーンを作って「倍率に依らない分」を測り、残りの幅に位置の広がりを収める。
 * ラベルの置き方が倍率で変わるので、求めた倍率で作り直して 1 回だけ補正する。
 * ノードが 0 件のときは 1 を返す（収める対象が無く、巨大な倍率になるのを避ける）。
 *
 * 計算量: シーンの組み立て（`build`）3 回分。
 *
 * @param build - 倍率からシーンを作る関数
 * @param size - 枠の大きさ（CSS ピクセル）
 * @returns 倍率と、その倍率のシーン
 */
export function fitZoomFor(
  build: (zoom: number) => Scene,
  size: { readonly width: number; readonly height: number },
): FitResult {
  const first = build(1);
  if (first.nodes.length === 0) return { zoom: 1, scene: first };
  const xs = first.nodes.map((n) => n.x);
  const ys = first.nodes.map((n) => n.y);
  // 位置の広がり（倍率 1 のとき）。ノードの中心だけで測る。半径などは「倍率に依らない分」に入る。
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);
  const roomW = Math.max(1, size.width - FIT_MARGIN * 2);
  const roomH = Math.max(1, size.height - FIT_MARGIN * 2);
  // 位置の広がりが無い（1 件だけ、または全部が同じ点）なら、倍率は図の見た目に関わらない。1 にする。
  if (spanX <= 0 && spanY <= 0) return { zoom: 1, scene: first };
  const solve = (scene: Scene, z: number): number => {
    const zx = spanX > 0 ? (roomW - (scene.width - spanX * z)) / spanX : Infinity;
    const zy = spanY > 0 ? (roomH - (scene.height - spanY * z)) / spanY : Infinity;
    const best = Math.min(zx, zy, MAX_FIT_ZOOM);
    return clamp(best, MIN_ZOOM, MAX_FIT_ZOOM);
  };
  const z1 = solve(first, 1);
  const second = build(z1);
  const z2 = solve(second, z1);
  if (Math.abs(z2 - z1) < 1e-9) return { zoom: z1, scene: second };
  return { zoom: z2, scene: build(z2) };
}
