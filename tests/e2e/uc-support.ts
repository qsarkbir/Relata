/**
 * UC-2、UC-4、UC-5 の E2E が共有する部品。読み込みウィザードを利用者と同じ手順で操作する。
 *
 * 【なぜ】ユースケースの E2E は「利用者の操作だけで通す」ことが目的なので、データは画面の
 * 「表データを読み込む」から入れる（ストアやプロジェクトファイルの直接投入はしない）。
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openExportDialog } from './support';

/** 列の設定の上書き（用途、型、暦）。キーは見出しの文字列。 */
export type ColumnOverrides = Readonly<
  Record<string, { role?: string; type?: string; calendar?: string }>
>;

/** 読み込みウィザード（ダイアログ）。 */
export function wizard(page: Page): Locator {
  return page.getByRole('dialog', { name: '表データの読み込み', exact: true });
}

/**
 * ノード表とエッジ表の 2 表を、ウィザードで読み込む。
 *
 * @param page - ページ（アプリは開いてある）
 * @param nodes - ノード表の CSV 文字列（見出しつき）
 * @param edges - エッジ表の CSV 文字列（見出しつき）
 * @param nodeColumns - ノード表の列の上書き
 * @param edgeColumns - エッジ表の列の上書き
 * @param tokens - 欠損の記号と理由（史料の欠落を表す「□」など。FR-IN-07）
 */
export async function importPair(
  page: Page,
  nodes: string,
  edges: string,
  nodeColumns: ColumnOverrides = {},
  edgeColumns: ColumnOverrides = {},
  tokens: readonly { symbol: string; reason: string }[] = [],
): Promise<void> {
  await page.getByRole('button', { name: '表データを読み込む', exact: true }).click();
  const dialog = wizard(page);
  await dialog.getByRole('combobox', { name: '表の形式', exact: true }).selectOption('pair');
  for (const [label, text] of [
    ['ノード表', nodes],
    ['エッジ表', edges],
  ] as const) {
    const group = dialog.getByRole('group', { name: label, exact: true });
    await group.getByLabel('表の貼り付け').fill(text);
    await group.getByRole('button', { name: '表を解析してプレビュー' }).click();
  }
  await dialog.getByRole('button', { name: '列の対応へ' }).click();
  await applyColumns(dialog, 'ノード表', nodes, nodeColumns);
  await applyColumns(dialog, 'エッジ表', edges, edgeColumns);
  for (const [i, token] of tokens.entries()) {
    await dialog.getByRole('button', { name: '欠損記号を追加' }).click();
    await dialog.getByLabel('記号', { exact: true }).nth(i).fill(token.symbol);
    await dialog
      .getByRole('combobox', { name: '理由', exact: true })
      .nth(i)
      .selectOption(token.reason);
  }
  await dialog.getByRole('button', { name: '変換して結果を確認' }).click();
  await dialog.getByRole('button', { name: 'このデータを読み込む' }).click();
  await expect(dialog).toBeHidden();
}

/** 列の設定を、見出しの位置から欄の名前を組み立てて変える。 */
async function applyColumns(
  dialog: Locator,
  group: string,
  csv: string,
  overrides: ColumnOverrides,
): Promise<void> {
  const headers = (csv.split('\n')[0] ?? '').split(',');
  for (const [header, setting] of Object.entries(overrides)) {
    const index = headers.indexOf(header) + 1;
    if (index === 0) throw new Error(`見出しが無い: ${header}`);
    const prefix = `${group} ${String(index)} ${header}`;
    if (setting.role !== undefined)
      await dialog.getByLabel(`${prefix} 用途`, { exact: true }).selectOption(setting.role);
    if (setting.type !== undefined)
      await dialog.getByLabel(`${prefix} 列の型`, { exact: true }).selectOption(setting.type);
    if (setting.calendar !== undefined)
      await dialog.getByLabel(`${prefix} 暦`, { exact: true }).selectOption(setting.calendar);
  }
}

/**
 * 「書き出し」のダイアログから、名前のボタンで保存し、中身を文字列で返す。
 *
 * @param page - ページ
 * @param name - ボタンの名前（'GraphML'、'全体指標CSV' など）
 * @returns 保存されたファイルの文字列
 */
export async function downloadText(page: Page, name: string): Promise<string> {
  const dialog = await openExportDialog(page);
  const button = dialog.getByRole('button', { name, exact: true });
  await expect(button).toBeEnabled();
  const pending = page.waitForEvent('download');
  await button.click();
  const text = readFileSync(await (await pending).path(), 'utf8');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return text;
}

/**
 * ノードをラベルで選ぶ（検索の欄に入れ、結果の一覧から候補を押す）。
 *
 * 【なぜ】ウィザードで読み込むと ID は読み込み時に作られる（「K6:person:p2」のような形）。利用者が
 * 見るのはラベルなので、ラベルで選ぶ。support.ts の `selectNode` は ID で選ぶ。
 *
 * @param page - ページ
 * @param label - ノードのラベル（完全一致の候補を押す）
 */
export async function selectNodeByLabel(page: Page, label: string): Promise<void> {
  await page.getByLabel(/^(ノードを検索|Find a node)$/).fill(label);
  await page
    .locator('.graph-search-results [role="option"]')
    .filter({ has: page.locator('bdi', { hasText: label }) })
    .first()
    .click();
}

/**
 * 先頭の BOM（U+FEFF）を取り除く。Excel で開けるよう、CSV は BOM 付きの UTF-8 で書き出すため。
 *
 * @param text - 文字列
 * @returns BOM を除いた文字列
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
