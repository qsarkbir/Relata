import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixturePath, openProject, startApp } from './support';

test.use({ locale: 'ja-JP' });
test('FR-FL-08 / FR-TM-09: 保存済みの時間フィルタを日英の暦の日付で表示し解除ボタンも同じ説明にする', async ({
  page,
}) => {
  const source: unknown = JSON.parse(readFileSync(fixturePath('maghrib.relata.json'), 'utf8'));
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    throw new Error('fixture');
  // 暦の既知値: 2451545=2000-01-01、2451604=2000-02-29。
  const text = JSON.stringify({
    ...source,
    view: {
      filter: {
        filters: [
          {
            id: 'time',
            kind: 'time',
            target: 'edge',
            from: 2451545,
            to: 2451604,
            match: 'overlaps',
            missing: 'include',
          },
        ],
        edgeRule: 'both-ends',
        showIsolated: true,
      },
    },
  });
  await startApp(page);
  await openProject(page, {
    name: 'time.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  const applied = page.getByRole('region', { name: /適用中のフィルタ|Active filters/ });
  await expect(applied).toContainText('期間: 2000年1月〜2000年2月（重なる）');
  await expect(page.getByRole('button', { name: /期間: 2000年1月〜2000年2月/ })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(applied).toContainText('Element period: Jan 2000–Feb 2000 (overlaps)');
  await page.getByRole('button', { name: /Element period: Jan 2000–Feb 2000/ }).click();
  await expect(applied).not.toContainText('Jan 2000');
});
