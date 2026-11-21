import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixturePath, openProject, startApp } from './support';

test.use({ locale: 'ja-JP' });
test('FR-FL-08: 保存済みの時間フィルタを日英の暦の日付で表示し解除ボタンも同じ説明にする', async ({
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
  await expect(applied).toContainText('グレゴリオ暦 2000年01月01日〜2000年02月29日');
  await expect(page.getByRole('button', { name: /グレゴリオ暦 2000年01月01日/ })).toBeVisible();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(applied).toContainText('Gregorian 2000-01-01 to 2000-02-29');
  await page.getByRole('button', { name: /Gregorian 2000-01-01/ }).click();
  await expect(applied).not.toContainText('Gregorian');
});
