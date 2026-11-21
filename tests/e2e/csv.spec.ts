import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { startApp, openProject } from './support';
test.use({ locale: 'ja-JP' });

test('FR-OUT-02 / FR-MT-04: ノード・エッジ・指標を別々のUTF8 CSVとして保存できる', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const metrics = page.getByRole('button', { name: 'ノード指標CSV', exact: true });
  await expect(metrics).toBeEnabled();
  await expect(page.getByLabel('UTF-8 BOMを付ける')).toBeChecked();
  await expect(page.getByLabel('式として解釈されうる文字列を保護する')).toBeChecked();
  for (const [label, filename, first] of [
    ['ノードCSV', 'nodes.csv', 'id,type,label,'],
    ['エッジCSV', 'edges.csv', 'id,source,target,'],
    ['ノード指標CSV', 'metrics.csv', 'id,label,'],
    ['全体指標CSV', 'global-metrics.csv', 'metric,value,status,'],
  ]) {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: label, exact: true }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(filename);
    const path = await file.path();

    const bytes = await readFile(path);
    expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]);
    expect(bytes.toString('utf8').slice(1)).toContain(first ?? '');
  }
  await page.getByLabel('UTF-8 BOMを付ける').uncheck();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ノードCSV', exact: true }).click();
  const path = await (await downloaded).path();

  expect((await readFile(path)).subarray(0, 3).toString()).toBe('id,');
});

test('FR-MT-04: 新しい計算中や取消後は古い指標CSVを保存させない', async ({ page }) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const metrics = page.getByRole('button', { name: 'ノード指標CSV', exact: true });
  await expect(metrics).toBeEnabled();
  await page.route('**/assets/metrics.worker-*.js', (route) => route.abort());
  await page.getByRole('button', { name: '指標を再計算', exact: true }).click();
  await expect(metrics).toBeDisabled();
  await expect(page.getByRole('button', { name: 'ノードCSV', exact: true })).toBeEnabled();
});
