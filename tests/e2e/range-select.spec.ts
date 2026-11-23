/** グラフの範囲選択（Shift ＋ ドラッグ）と選択で絞り込む: FR-FL-11 */
import { test, expect } from '@playwright/test';
import { appliedRegion, openProject, startApp } from './support';

test.use({ locale: 'ja-JP' });

test('FR-FL-11: Shift＋ドラッグで複数選択し、選択で絞り込み、Undo と Esc で戻せる', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
  await expect(nodes).toHaveCount(14);
  const box = await page.locator('.graph-canvas svg').first().boundingBox();
  if (box === null) throw new Error('図が見つからない');

  // Shift ＋ ドラッグで図全体を囲む。矩形が出て、離すと消える。
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 4 });
  await expect(page.getByTestId('range-rect')).toBeVisible();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('range-rect')).toHaveCount(0);
  const card = page.getByRole('region', { name: '選択したノードの詳細' });
  await expect(card).toContainText('件を選択中');

  // 通常のドラッグ（Shift なし）はパンで、選択を変えない。
  const before = await card.textContent();
  await page.mouse.move(box.x + 5, box.y + box.height - 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + box.height - 30, { steps: 4 });
  await page.mouse.up();
  await expect(card).toHaveText(before ?? '');

  // 絞り込む前は条件が増えない。押すと nodeSet が足される。
  await expect(appliedRegion(page)).not.toContainText('選択したノード（');
  await card.getByRole('button', { name: '選択したノードで絞り込む' }).click();
  await expect(appliedRegion(page)).toContainText('選択したノード（');

  // Undo で戻る
  await page.keyboard.press('Control+z');
  await expect(appliedRegion(page)).not.toContainText('選択したノード（');

  // Esc で選択を解除
  await page.locator('.graph-canvas svg').first().focus();
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});
