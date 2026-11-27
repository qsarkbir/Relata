/**
 * 画面の高さ（T3-00、D-49）の E2E: アプリを窓の高さに収め、パネルの中でスクロールする。
 *
 * 見本は「サンプルを読み込む」のデータ（public/samples/maghrib.relata.json。219 ノード、年表に年代がある）。座標は使わず、要素の大きさとスクロールの量だけを調べる。
 */
import { expect, test, type Page } from '@playwright/test';
import { loadedNotice, startApp } from './support';

test.use({ locale: 'ja-JP' });

/** ページ全体の高さ（スクロールできる量を含む）。 */
function pageHeight(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollHeight);
}

/** サンプルを読み込む（統括役の指示の「サンプルを読み込んだ状態」）。 */
async function loadSample(page: Page): Promise<void> {
  await startApp(page);
  await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
  await expect(page.getByRole('region', { name: '適用中の条件' })).toContainText('/ 219');
}

async function openTimeline(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: '下の段を開く', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('tab', { name: '年表', exact: true }).click();
  await expect(page.locator('.timeline-chart')).toBeVisible();
}

/** 年表タブを開いたときの「見えている」検査。箱の大きさではなく、祖先の overflow で切られた分を除く。 */
test('FR-UI-02: D-49 900 px の窓で、年表の棒グラフは見え、図は 240 px 以上、ページは窓を超えない', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadSample(page);
  await openTimeline(page);
  expect(await pageHeight(page)).toBeLessThanOrEqual(900);
  await expect(page.locator('.timeline-chart')).toBeInViewport({ ratio: 0.9 });
  const canvas = await page.locator('[data-main-frame]').boundingBox();
  expect(canvas?.height ?? 0).toBeGreaterThanOrEqual(239.5);
  // 読み込みの知らせを閉じると、図はさらに高くなる。
  await loadedNotice(page).getByRole('button', { name: '閉じる' }).click();
  await expect
    .poll(async () => (await page.locator('[data-main-frame]').boundingBox())?.height ?? 0)
    // 【なぜ】中央の「グラフ｜地図」のタブの行（約 36 px。D-48）の分だけ、以前の 290 px より低い。知らせの分だけ高くなることを確かめる。
    .toBeGreaterThan((canvas?.height ?? 0) + 10);
  await expect(page.locator('.timeline-chart')).toBeInViewport({ ratio: 0.9 });
});

test('FR-UI-02: D-49 900 px の窓で、棒を指すと区切りの件数が、範囲を選ぶと状態の文が見える', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadSample(page);
  await openTimeline(page);
  const plot = page.locator('.timeline-chart .tl-hit');
  const box = await plot.boundingBox();
  if (box === null) throw new Error('plot box');
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
  await expect(page.locator('.timeline-hover bdi')).toBeVisible();
  await expect(page.locator('.timeline-hover')).toBeInViewport({ ratio: 0.9 });
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('.timeline-status')).toContainText(/適用中の範囲|選択中/);
  await expect(page.locator('.timeline-status')).toBeInViewport({ ratio: 0.9 });
});

test('FR-UI-02: D-49 900 px の窓で、表は 3 行以上が見える', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadSample(page);
  const toggle = page.getByRole('button', { name: '下の段を開く', exact: true });
  if (await toggle.isVisible()) await toggle.click();
  await page.getByRole('tab', { name: '表', exact: true }).click();
  const visibleRows = await page
    .locator('.bottom-body:not([hidden]) .table-scroll')
    .evaluate((sc) => {
      const box = sc.getBoundingClientRect();
      const head = sc.querySelector('thead')?.getBoundingClientRect().bottom ?? box.top;
      return Array.from(sc.querySelectorAll('tbody tr')).filter((tr) => {
        const r = tr.getBoundingClientRect();
        return r.top >= head - 1 && r.bottom <= box.bottom + 1;
      }).length;
    });
  expect(visibleRows).toBeGreaterThanOrEqual(3);
});

test('FR-UI-02: D-49 下の段を閉じると、見出しの高さだけになる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loadSample(page);
  // 下の段は既定で閉じている（開閉の既定は変えない）。
  await expect(page.getByRole('button', { name: '下の段を開く', exact: true })).toBeVisible();
  const box = await page.locator('.bottom-panel').boundingBox();
  expect(box?.height ?? 999).toBeLessThanOrEqual(60);
});

test('FR-UI-02: D-49 End で広げても中央の列の 40% に丸められ、分割バーの値は段の実際の高さに合う', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await loadSample(page);
  await openTimeline(page);
  const bar = page.getByRole('separator', { name: '下の段の高さ' });
  const limit = async () =>
    page
      .locator('[data-bottom-column]')
      .evaluate((el) => Math.floor((el.clientHeight - 16) /* 上下の余白 0.5rem × 2 */ * 0.4));
  // 【なぜ】描画が落ち着き、分割バーの上限が測り直されてから押す（測る前に押すと、古い上限で丸まる）。
  await expect
    .poll(async () => Math.abs(Number(await bar.getAttribute('aria-valuemax')) - (await limit())))
    .toBeLessThanOrEqual(3);
  await bar.focus();
  await page.keyboard.press('End');
  const now = Number(await bar.getAttribute('aria-valuenow'));
  expect(now).toBeLessThan(800);
  // 値は「中央の列の内側の高さ × 0.4」に一致する（図が 240 px を保てる余裕は、この窓では十分にある）。
  expect(Math.abs(now - (await limit()))).toBeLessThanOrEqual(3);
  expect(Number(await bar.getAttribute('aria-valuemax'))).toBeGreaterThanOrEqual(now);
  expect(Number(await bar.getAttribute('aria-valuemin'))).toBeLessThanOrEqual(now);
  const body = await page.locator('.bottom-body:not([hidden])').boundingBox();
  expect(Math.abs((body?.height ?? 0) - now)).toBeLessThanOrEqual(3);
  const canvas = await page.locator('[data-main-frame]').boundingBox();
  expect(canvas?.height ?? 0).toBeGreaterThanOrEqual(239.5);
});

test('FR-UI-02: D-49 600 px の窓でも、ページは窓より高くならない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loadSample(page);
  await openTimeline(page);
  expect(await pageHeight(page)).toBeLessThanOrEqual(600);
});

test('FR-UI-02: D-49 左のパネルは、長くなってもパネルの中だけでスクロールする', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await loadSample(page);
  const panel = page.getByRole('complementary', { name: '絞り込み' });
  const sizes = await panel.evaluate((el) => ({ all: el.scrollHeight, shown: el.clientHeight }));
  expect(sizes.all).toBeGreaterThan(sizes.shown);
  await panel.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(await panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await pageHeight(page)).toBeLessThanOrEqual(600);
});

test('FR-UI-02: D-49 窓が低いと、中央が中でスクロールして、下の段まで届く', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await loadSample(page);
  const tab = page.getByRole('tab', { name: '年表', exact: true });
  await tab.scrollIntoViewIfNeeded();
  await expect(tab).toBeInViewport();
  expect(await pageHeight(page)).toBeLessThanOrEqual(420);
});
