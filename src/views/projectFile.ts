/**
 * プロジェクトのファイル名と、ブラウザのファイル操作（ダウンロード）。
 */

/**
 * 保存するファイル名を作る。
 *
 * 題名のうち、ASCII の英数字と `-`、`_`、`.`、空白以外は `_` にする。題名が読み取れる文字を含まないとき（アラビア文字や
 * 日本語だけの題名など）は `relata` にする。日付は ISO 8601 の先頭 10 文字。
 *
 * @param title - データの題名
 * @param savedAt - 保存日時（ISO 8601）
 * @returns 例: `Maghrib-2026-11-19.relata.json`
 */
export function projectFileName(title: string, savedAt: string): string {
  // 【なぜ】ASCII に限る。Chromium（Playwright の headless）では、非 ASCII を含む名前のダウンロードで
  //   ファイル名が "download"（拡張子なし）になることを確かめた。アラビア文字の題名はファイル名には
  //   使えないが、題名そのものはファイルの中（dataset.meta.title）に残る。
  const cleaned = title.replace(/[^A-Za-z0-9._ -]+/g, '_').trim();
  // 【なぜ】先頭のドットは隠しファイルになり、`.` や `..` だけの名前は不正になる。
  const stripped = cleaned
    .replace(/^[._ ]+/, '')
    .slice(0, 60)
    .trim();
  const base = /[A-Za-z0-9]/.test(stripped) ? stripped : '';
  return `${base === '' ? 'relata' : base}-${savedAt.slice(0, 10)}.relata.json`;
}

/**
 * 文字列をファイルとしてダウンロードさせる。データはブラウザの外へ送らない（NFR-02）。
 *
 * @param fileName - ファイル名
 * @param text - 中身（UTF-8）
 */
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  // 【なぜ】直後に解放するとダウンロードが始まる前に無効になる環境があるので、少し待つ。
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 10_000);
}
