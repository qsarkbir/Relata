/** ブラウザ内でのファイルの保存（FR-OUT-01、03、04、05）。利用者のデータは外部に送らない。 */

/**
 * Blob をダウンロードとして保存する。
 *
 * document と URL.createObjectURL を使うため、DOM のない Node.js や Worker からは呼ばない。
 *
 * @param blob - 保存する内容
 * @param fileName - 保存名（拡張子まで含める）
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  let anchor: HTMLAnchorElement | undefined;
  try {
    anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
  } finally {
    anchor?.remove();
    // 【なぜ】クリック直後の解放で保存が中断される環境がある。プロジェクト保存と同じ猶予を置く。
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 10_000);
  }
}

/**
 * ファイル名に拡張子を付ける。前後の空白を除き、空なら既定の名前にする。
 *
 * @param name - 利用者の指定した名前
 * @param extension - 拡張子（ドットなし。例: `png`）
 * @param fallback - 空のときの名前（拡張子なし）
 * @returns 拡張子つきの名前
 */
export function withExtension(name: string, extension: string, fallback = 'relata'): string {
  const trimmed = name.trim() || fallback;
  return trimmed.toLowerCase().endsWith('.' + extension) ? trimmed : `${trimmed}.${extension}`;
}
