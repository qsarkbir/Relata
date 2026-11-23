/** PNG の書き出し（FR-OUT-03）。SVG を canvas に描いて PNG にする。 */

/** 選べる倍率。 */
// 【TS】`as const` は配列を読み取り専用にし、要素を数値リテラルの型にする。
export const PNG_SCALES = [1, 2, 4] as const;
// 【TS】`(typeof PNG_SCALES)[number]` は、配列の要素の型（1 | 2 | 4）を取り出す。値の一覧と型を 1 か所で持つ。
/** 倍率の型。 */
export type PngScale = (typeof PNG_SCALES)[number];

/**
 * canvas の大きさの上限。
 *
 * 【なぜ】ブラウザの canvas には上限がある。Chrome は 1 辺 32767 px・面積 約 2.7 億 px だが、Safari
 * （iOS を含む）は面積が 16,777,216 px（4096 × 4096）までで、超えると描けずに空の画像が出る。
 * どの主要ブラウザでも動くよう、1 辺 16384 px、面積 16,777,216 px を上限にし、超えるときは倍率を下げる。
 * それでも `toBlob` が失敗する環境（メモリ不足など）では、倍率を半分にして `renderPng` がやり直す。
 */
export const MAX_CANVAS_SIDE = 16384;
/** canvas の面積（px²）の上限。 */
export const MAX_CANVAS_AREA = 16_777_216;

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
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    // 【なぜ】上限の内側でも、環境によっては canvas を PNG にできない（`toBlob` が null）。その場合は、
    // 倍率を半分にして最大 3 回やり直す。それでも作れなければ、最後のエラーを投げる。
    let requested = scale;
    for (let attempt = 0; ; attempt++) {
      const size = pngSize(width, height, requested);
      const clamped = size.clamped || requested < scale;
      const blob = await canvasToPng(image, size);
      if (blob !== null) return { blob, size: { ...size, clamped } };
      if (attempt >= 2) throw new Error('toBlob failed');
      requested = size.scale / 2;
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 画像を canvas に描いて PNG の Blob にする。作れなければ null。
async function canvasToPng(image: HTMLImageElement, size: PngSize): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (context === null) return null;
  context.drawImage(image, 0, 0, size.width, size.height);
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/png');
  });
}
