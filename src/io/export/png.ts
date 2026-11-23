/** PNG の書き出し（FR-OUT-03）。SVG を canvas に描いて PNG にする。 */

/** 選べる倍率。 */
export const PNG_SCALES = [1, 2, 4] as const;
/** 倍率の型。 */
export type PngScale = (typeof PNG_SCALES)[number];

/**
 * canvas の大きさの上限。
 *
 * 【なぜ】ブラウザの canvas には上限がある（Chrome は 1 辺 32767 px・面積 約 2.7 億 px、Safari は面積 約 1670 万 px
 * に及ばない場合がある）。上限を超えると、描けずに空の画像が出る。どの主要ブラウザでも動く、
 * 1 辺 16384 px、面積 約 6700 万 px（8192 × 8192）を上限にし、超えるときは倍率を下げる。
 */
export const MAX_CANVAS_SIDE = 16384;
/** canvas の面積（px²）の上限。 */
export const MAX_CANVAS_AREA = 8192 * 8192;

/** PNG の大きさの計算結果。 */
export interface PngSize {
  readonly width: number;
  readonly height: number;
  /** 実際に使う倍率（上限で下げたときは、要求より小さい）。 */
  readonly scale: number;
  /** 上限のために倍率を下げたか。画面で利用者に知らせる。 */
  readonly clamped: boolean;
}

/**
 * 図の大きさと倍率から、PNG の画素数を決める。上限を超えるときは、倍率を下げる。
 *
 * @param width - 図の幅（px）
 * @param height - 図の高さ（px）
 * @param scale - 要求する倍率
 * @returns 画素数と、実際の倍率
 * @example
 * pngSize(1000, 500, 2); // { width: 2000, height: 1000, scale: 2, clamped: false }
 */
export function pngSize(width: number, height: number, scale: number): PngSize {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const limit = Math.min(MAX_CANVAS_SIDE / Math.max(w, h), Math.sqrt(MAX_CANVAS_AREA / (w * h)));
  const effective = Math.min(scale, limit);
  const clamped = effective < scale;
  // 【なぜ】通常は切り上げて端を欠けさせない。上限で下げたときは、切り上げると上限を超えるので切り捨てる。
  const round = clamped ? Math.floor : Math.ceil;
  return {
    width: Math.min(MAX_CANVAS_SIDE, Math.max(1, round(w * effective - 1e-9))),
    height: Math.min(MAX_CANVAS_SIDE, Math.max(1, round(h * effective - 1e-9))),
    scale: effective,
    clamped,
  };
}

/** PNG にした結果。 */
export interface PngResult {
  readonly blob: Blob;
  readonly size: PngSize;
}

/**
 * SVG の文字列を PNG にする。
 *
 * SVG を画像として読み込み、拡大した canvas に描く。SVG はベクターなので、拡大しても輪郭はぼけない。
 * 文字は、ブラウザの文字の整形（アラビア文字の連結、右から左の並び）がそのまま使われる。
 * 画像として読み込んだ SVG は、外部の資源を読まない（このアプリの SVG は外部を参照しない）。
 * document と canvas を使うため、ブラウザの主スレッドで呼ぶ。
 *
 * @param svg - SVG の文字列（`width` と `height` を持つこと）
 * @param width - 図の幅（px）
 * @param height - 図の高さ（px）
 * @param scale - 倍率
 * @returns PNG と画素数
 * @throws 画像として読めない、canvas が作れない、PNG にできないとき
 */
export async function renderPng(
  svg: string,
  width: number,
  height: number,
  scale: number,
): Promise<PngResult> {
  const size = pngSize(width, height, scale);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('canvas 2d is not available');
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => {
        if (b === null) reject(new Error('toBlob failed'));
        else resolve(b);
      }, 'image/png');
    });
    return { blob, size };
  } finally {
    URL.revokeObjectURL(url);
  }
}
