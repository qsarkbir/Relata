/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test';
import { openProject, startApp } from './support';

test.use({ locale: 'ja-JP' });

/** 既定の「定数」のノードの半径（設定の min 2.5 と max 10 の中央、px）。 */
const DEFAULT_RADIUS = 6.25;

const nodes = (page: Page) => page.locator('.graph-canvas #graph-view-nodes > [data-id]');
const figure = (page: Page) => page.getByRole('img', { name: 'ネットワーク図' });

/** 画面上のノードの半径の中央値（外接矩形の幅の半分。枠線を含むので、半径より少し大きい）。 */
async function medianRadius(page: Page): Promise<number> {
  return nodes(page).evaluateAll((els) => {
    const r = els.map((e) => e.getBoundingClientRect().width / 2).sort((a, b) => a - b);
    return r[Math.floor(r.length / 2)] ?? 0;
  });
}

/** すべてのノードが、図の枠の中に見えているか。 */
async function allNodesInFrame(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const frame = document.querySelector('.graph-canvas svg')?.getBoundingClientRect();
    if (frame === undefined) return false;
    return [...document.querySelectorAll('#graph-view-nodes > [data-id]')].every((el) => {
      const r = el.getBoundingClientRect();
      return (
        r.left >= frame.left &&
        r.right <= frame.right &&
        r.top >= frame.top &&
        r.bottom <= frame.bottom
      );
    });
  });
}

test.describe('FR-VG-01 / FR-VG-03 / FR-VG-04 / FR-VG-05: 画面上の大きさ', () => {
  test.beforeEach(async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await expect(nodes(page)).toHaveCount(14);
  });

  test('FR-VG-03: 全体を表示したときの画面上の半径が、設定した半径に近い', async ({ page }) => {
    await expect
      .poll(async () => medianRadius(page))
      // 枠線（1px）と形の外接円の分だけ、半径より少し大きい。以前は拡大率（2 前後）の分だけ大きかった。
      .toBeLessThan(DEFAULT_RADIUS * 1.5);
    expect(await medianRadius(page)).toBeGreaterThan(DEFAULT_RADIUS * 0.8);
  });

  test('FR-VG-03/04: 拡大・縮小しても、半径と線の太さは画面上の px のまま', async ({ page }) => {
    const before = await medianRadius(page);
    const edgeWidth = () =>
      page.locator('.graph-canvas #graph-view-edges path').first().getAttribute('stroke-width');
    const widthBefore = await edgeWidth();
    const zoom = Number(await figure(page).getAttribute('data-zoom'));
    await page.getByRole('button', { name: '拡大', exact: true }).click();
    await page.getByRole('button', { name: '拡大', exact: true }).click();
    await expect
      .poll(async () => Number(await figure(page).getAttribute('data-zoom')))
      .toBeGreaterThan(zoom);
    expect(await medianRadius(page)).toBeCloseTo(before, 0);
    expect(await edgeWidth()).toBe(widthBefore);
    await page.getByRole('button', { name: '縮小', exact: true }).click();
    expect(await medianRadius(page)).toBeCloseTo(before, 0);
  });

  test('FR-VG-05: 拡大すると、ノードどうしの距離だけが広がる', async ({ page }) => {
    const gap = () =>
      nodes(page).evaluateAll((els) => {
        const a = els[0]?.getBoundingClientRect();
        const b = els[1]?.getBoundingClientRect();
        return a === undefined || b === undefined ? 0 : Math.hypot(a.x - b.x, a.y - b.y);
      });
    const before = await gap();
    await page.getByRole('button', { name: '拡大', exact: true }).click();
    await expect.poll(gap).toBeGreaterThan(before * 1.2);
  });
});

test.describe('NFR-03: 0 件の図の拡大・縮小', () => {
  test.beforeEach(async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await expect(nodes(page)).toHaveCount(14);
  });

  /** 全ノードを除く絞り込みを適用する。 */
  async function applyEmptyFilter(page: Page): Promise<void> {
    const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
    await search.getByRole('searchbox').fill('zzzz-none');
    await search.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.getByText('絞り込みや表示の条件に合うノードがありません')).toBeVisible();
  }

  test('0 件のとき、「全体を表示」と拡大・縮小は押せず、理由が分かる', async ({ page }) => {
    await applyEmptyFilter(page);
    for (const name of ['全体を表示', '拡大', '縮小']) {
      const button = page.getByRole('button', { name, exact: true });
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('title', /表示するノードが無いため/);
    }
  });

  test('0 件のときのホイールは、倍率を変えない', async ({ page }) => {
    await applyEmptyFilter(page);
    const before = await figure(page).getAttribute('data-zoom');
    const box = await figure(page).boundingBox();
    if (box === null) throw new Error('図の枠が無い');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -300);
    await expect(figure(page)).toHaveAttribute('data-zoom', before ?? '');
  });

  test('FR-VG-05: 拡大した後に 0 件にして解除すると、全体が枠に収まる倍率に戻る', async ({
    page,
  }) => {
    for (let i = 0; i < 4; i += 1)
      await page.getByRole('button', { name: '拡大', exact: true }).click();
    await applyEmptyFilter(page);
    await page.getByRole('button', { name: 'すべて解除', exact: true }).click();
    await expect(nodes(page)).toHaveCount(14);
    // 自動で全体を表示する。以前の（拡大した）倍率を引き継がない。
    await expect.poll(async () => allNodesInFrame(page)).toBe(true);
    expect(Number(await figure(page).getAttribute('data-zoom'))).toBeLessThanOrEqual(4);
    await expect(page.getByRole('button', { name: '全体を表示', exact: true })).toBeEnabled();
  });
});
