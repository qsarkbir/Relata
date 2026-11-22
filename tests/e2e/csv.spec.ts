import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startApp, openCsvDialog, openProject } from './support';
test.use({ locale: 'ja-JP' });

test('FR-OUT-02 / FR-MT-04: 上部の「CSV出力」から、ノード・エッジ・指標を別々のUTF8 CSVとして保存できる', async ({
  page,
}) => {
  await startApp(page);
  await expect(page.getByRole('button', { name: 'CSV出力', exact: true })).toBeDisabled();
  await openProject(page, 'maghrib.relata.json');
  // 【なぜ】指標の計算が終わってから開くと、指標の CSV も保存できる。
  await expect(page.getByTestId('metric-global-nodeCount')).toBeVisible();
  const dialog = await openCsvDialog(page);
  const metrics = dialog.getByRole('button', { name: 'ノード指標CSV', exact: true });
  await expect(metrics).toBeEnabled();
  await expect(dialog.getByLabel('UTF-8 BOMを付ける')).toBeChecked();
  await expect(dialog.getByLabel('式として解釈されうる文字列を保護する')).toBeChecked();
  for (const [label, filename, first] of [
    ['ノードCSV', 'nodes.csv', 'id,type,label,'],
    ['エッジCSV', 'edges.csv', 'id,source,target,'],
    ['ノード指標CSV', 'metrics.csv', 'id,label,'],
    ['全体指標CSV', 'global-metrics.csv', 'metric,value,status,'],
  ]) {
    const download = page.waitForEvent('download');
    await dialog.getByRole('button', { name: label, exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(filename);
    const path = await file.path();

    const bytes = await readFile(path);
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    expect(bytes.toString('utf8').slice(1)).toContain(first ?? '');
  }
  await dialog.getByLabel('UTF-8 BOMを付ける').uncheck();
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'ノードCSV', exact: true }).click();
  const path = await (await downloaded).path();

  expect((await readFile(path)).subarray(0, 3).toString()).toBe('id,');
  await dialog.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('FR-MT-04: 新しい計算中や取消後は古い指標CSVを保存させない', async ({ page }) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  await expect(page.getByTestId('metric-global-nodeCount')).toBeVisible();
  await page.route('**/assets/metrics.worker-*.js', (route) => route.abort());
  await page.getByRole('button', { name: '指標を再計算', exact: true }).click();
  const dialog = await openCsvDialog(page);
  await expect(dialog.getByRole('button', { name: 'ノード指標CSV', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'ノードCSV', exact: true })).toBeEnabled();
  await expect(
    dialog.getByText('指標の計算が終わると保存できます', { exact: false }),
  ).toBeVisible();
});

test('FR-UI-04: 指標の計算上の注意は、ボタンから開くダイアログで詳しく読める', async ({ page }) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const open = page.getByRole('button', { name: /計算上の注意/u });
  await expect(open).toBeVisible();
  await open.click();
  const dialog = page.getByRole('dialog', { name: '指標の計算上の注意', exact: true });
  await expect(dialog.getByRole('heading', { name: /向きを無視して計算しました/u })).toBeVisible();
  await expect(dialog.getByText('弱連結成分', { exact: false })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
