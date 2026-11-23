/** 書簡の取込から論文用出力と再読込まで、実際の画面とWorkerを通す（UC-1）。 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  counts,
  openCsvDialog,
  openBuildPanel,
  openGraphSection,
  openProject,
  saveProjectFile,
  saveSvgFile,
  startApp,
} from './support';

/**
 * 上部の「CSV出力」のダイアログから CSV を保存し、ダイアログを閉じて中身を返す。
 *
 * @param page - ページ
 * @param name - ダイアログ内のボタンの名前
 * @returns 保存された CSV の文字列
 */
async function csvText(page: Page, name: string): Promise<string> {
  const dialog = await openCsvDialog(page);
  // 【なぜ】古い入力の指標は保存させないので、計算が終わってボタンが使えるまで待つ。
  await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled();
  const pending = page.waitForEvent('download');
  await dialog.getByRole('button', { name, exact: true }).click();
  const text = readFileSync(await (await pending).path(), 'utf8');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return text;
}

test.use({ locale: 'ja-JP' });
test('UC-1 / FR-IN-04 / FR-VG-03 / FR-MT-04 / FR-OUT-01/02 / FR-PJ-01: 書簡を読み込み中心性と絞込を図・CSV・保存へ反映する', async ({
  page,
}) => {
  await startApp(page);
  await page.getByRole('button', { name: '表データを読み込む', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '表データの読み込み', exact: true });
  await dialog
    .getByLabel('表の貼り付け', { exact: true })
    .fill(
      'From,To,date,weight\nGroup A1,Group A2,1650-01-01,2\nGroup A1,C,1650-02-01,3\nGroup A2,Group A1,1651-01-01,1\nC,C,1652-01-01,4',
    );
  await dialog.getByRole('button', { name: '表を解析してプレビュー', exact: true }).click();
  await dialog.getByRole('button', { name: '列の対応へ', exact: true }).click();
  await dialog.getByRole('button', { name: '変換して結果を確認', exact: true }).click();
  await dialog.getByRole('button', { name: 'このデータを読み込む', exact: true }).click();
  const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
  await expect(nodes).toHaveCount(3);
  await openGraphSection(page, '見た目');
  await page.getByLabel('ノードサイズの元', { exact: true }).selectOption('metric:degree');
  // 【なぜ】重みと自己ループは「ネットワークの構築」のパネルへ移した（T2-02）。開いて変え、Esc で閉じる。
  const build = await openBuildPanel(page);
  await build.getByLabel('自己ループを含む', { exact: true }).uncheck();
  await page.keyboard.press('Escape');
  await expect(build).toBeHidden();
  // 【なぜ】図の自己ループ設定を指標・CSVも使うことを確認する（元表には4件ある）。
  expect(await csvText(page, '全体指標CSV')).toContain('edgeCount,3,ok,directed');
  const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
  await search.getByRole('searchbox').fill('Group A');
  await search.getByRole('button', { name: '検索', exact: true }).click();
  await expect(counts(page)).toContainText('ノード 2 / 3');
  await expect(nodes).toHaveCount(2);
  expect(await csvText(page, '全体指標CSV')).toContain('edgeCount,2,ok,directed');
  const metricCsv = await csvText(page, 'ノード指標CSV');
  expect(metricCsv).toContain('Group A1');
  expect(metricCsv).toContain('Group A2');
  expect(metricCsv).not.toMatch(/,C,/u);
  const pendingSvg = page.waitForEvent('download');
  await saveSvgFile(page);
  const svg = readFileSync(await (await pendingSvg).path(), 'utf8');
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).toContain('Group A');
  await page.getByRole('button', { name: '拡大', exact: true }).click();
  const transform = await page.locator('.graph-canvas svg > g').getAttribute('transform');
  const pending = page.waitForEvent('download');
  await saveProjectFile(page);
  const saved = readFileSync(await (await pending).path(), 'utf8');
  expect(saved).toContain('"metric":"degree"');
  expect(saved).toContain('"selfLoops":false');
  expect(saved).toContain('"positions":');
  await openProject(page, {
    name: 'letters.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(saved),
  });
  await expect(page.locator('.task-panel')).toBeHidden();
  await expect(nodes).toHaveCount(2);
  await expect(page.getByLabel('ノードサイズの元', { exact: true })).toHaveValue('metric:degree');
  await expect(
    (await openBuildPanel(page)).getByLabel('自己ループを含む', { exact: true }),
  ).not.toBeChecked();
  await expect(page.locator('.graph-canvas svg > g')).toHaveAttribute('transform', transform ?? '');
  expect(await csvText(page, '全体指標CSV')).toContain('edgeCount,2,ok,directed');
});
