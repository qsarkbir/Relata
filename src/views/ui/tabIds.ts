/**
 * タブとパネルを結ぶ要素の ID（`Tabs` と、パネルを描く側が同じ規則を使う）。
 * 【なぜ】部品のファイルには部品だけを置く（Fast Refresh のため）。関数はここに分ける。
 */

/**
 * タブの要素の ID。
 *
 * @param prefix - `Tabs` に渡した接頭辞
 * @param id - タブの ID
 * @returns 要素の ID
 */
export function tabElementId(prefix: string, id: string): string {
  return `${prefix}-tab-${id}`;
}

/**
 * タブに対応するパネルの要素の ID。呼ぶ側が、パネルの `id` と `aria-labelledby` に使う。
 *
 * @param prefix - `Tabs` に渡した接頭辞
 * @param id - タブの ID
 * @returns 要素の ID
 */
export function tabPanelElementId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}
