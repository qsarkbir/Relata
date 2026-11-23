/**
 * 画面の土台（T2-11）の E2E: 適用中の条件の行、図のツールバー、表示の設定の引き出し、選択中のカード。
 *
 * 見本は maghrib.relata.json（ノード 15、エッジ 17。既定では孤立の p20 を除いて 14 / 15）。
 */
import { expect, test, type Page } from '@playwright/test';
import { appliedRegion, openGraphSettings, openProject, selectNode, startApp } from './support';

test.use({ locale: 'ja-JP' });

/** 適用中の条件の行。 */
function conditions(page: Page) {
  return page.getByRole('region', { name: '適用中の条件' });
}

test.describe('日本語の画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
  });

  test('FR-FL-09: 適用中の条件の行の件数が絞り込みと一致する', async ({ page }) => {
    await expect(conditions(page)).toContainText('ノード 14 / 15');
    await expect(conditions(page)).toContainText('エッジ 17 / 17');
    await expect(conditions(page)).toContainText('フィルタ 0');
    await page.getByRole('checkbox', { name: 'タイプ 2' }).check();
    await expect(conditions(page)).toContainText('ノード 4 / 15');
    await expect(conditions(page)).toContainText('エッジ 2 / 17');
    await expect(conditions(page)).toContainText('フィルタ 1');
    // 解除すると、行からも消える（別の状態を持たない）。
    await page.getByRole('checkbox', { name: 'タイプ 2' }).uncheck();
    await expect(conditions(page)).toContainText('フィルタ 0');
    await expect(conditions(page)).toContainText('ノード 14 / 15');
  });

  test('FR-FL-08: 適用中の条件の行からフィルタの一覧へ移れる', async ({ page }) => {
    await page.getByRole('checkbox', { name: 'タイプ 2' }).check();
    // 左のパネルを畳んでも、行から開いて一覧へフォーカスが移る。
    await page.getByRole('button', { name: '絞り込みを畳む' }).click();
    await expect(appliedRegion(page)).toBeHidden();
    const chip = conditions(page).getByRole('button', { name: 'フィルタ 1', exact: true });
    await expect(chip).toHaveAccessibleDescription('左のパネルの適用中のフィルタの一覧を開きます');
    await chip.click();
    await expect(appliedRegion(page)).toBeVisible();
    await expect(appliedRegion(page)).toBeFocused();
  });

  test('FR-VG-11: 表示の設定は既定で閉じ、開閉と Esc で viewport と選択が変わらない', async ({
    page,
  }) => {
    const toggle = page.getByRole('button', { name: '表示の設定', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByLabel('ラベル', { exact: true })).toBeHidden();
    await selectNode(page, 'p6');
    await page.getByRole('button', { name: '拡大', exact: true }).click();
    const figure = page.getByRole('img', { name: 'ネットワーク図' });
    const zoom = await figure.getAttribute('data-zoom');
    const transform = await page.locator('.graph-canvas svg > g').getAttribute('transform');
    // 開く: 図の横に出て、フォーカスが引き出しへ移る。
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const drawer = await openGraphSettings(page);
    await expect(drawer).toBeFocused();
    await expect(drawer).toContainText('グラフだけ');
    await expect(drawer).toContainText('グラフと指標に共通');
    // 節を畳んで開き直しても、選択は残る。
    await drawer.getByText('ラベルと向き', { exact: true }).click();
    await drawer.getByText('ラベルと向き', { exact: true }).click();
    await expect(page.getByRole('region', { name: '選択したノードの詳細' })).toBeVisible();
    await expect(page.getByRole('button', { name: '選択を解除' })).toBeVisible();
    // Esc で閉じ、開閉ボタンへフォーカスが戻る。
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(figure).toHaveAttribute('data-zoom', zoom ?? '');
    await expect(page.locator('.graph-canvas svg > g')).toHaveAttribute(
      'transform',
      transform ?? '',
    );
    await expect(page.getByRole('region', { name: '選択したノードの詳細' })).toBeVisible();
    // カードを畳んでも選択は残る。
    await page.getByRole('button', { name: '選択中のカードを畳む' }).click();
    await expect(page.getByRole('button', { name: '位置を固定', exact: true })).toBeHidden();
    await expect(figure).toHaveAttribute('data-zoom', zoom ?? '');
    // 畳んだ後に図の上で別のノードを選ぶと、カードは開き直る（選んでも反応が無いように見せない）。
    const other = page
      .locator('.graph-canvas #graph-view-nodes > [data-id]:not([data-id="p6"])')
      .first();
    await other.click();
    await expect(page.getByRole('button', { name: '位置を固定', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '選択を解除' }).click();
    await expect(page.getByRole('region', { name: '選択したノードの詳細' })).toBeHidden();
  });

  test('FR-VG-09: 絞り込みで見えなくなっても選択は消えず、カードに表示されていないと出る', async ({
    page,
  }) => {
    await selectNode(page, 'p6');
    await expect(page.getByRole('button', { name: '位置を固定', exact: true })).toBeVisible();
    // p6 はタイプ 2 ではない。
    await page.getByRole('checkbox', { name: 'タイプ 2' }).check();
    const card = page.getByRole('region', { name: '選択したノードの詳細' });
    await expect(card).toContainText('表示されていません');
    await expect(page.getByRole('button', { name: '位置を固定', exact: true })).toBeHidden();
    // 解除すると、また表示されて操作できる。
    await page.getByRole('checkbox', { name: 'タイプ 2' }).uncheck();
    await expect(page.getByRole('button', { name: '位置を固定', exact: true })).toBeVisible();
  });

  test('FR-VG-11: 該当なしの検索と、絞り込みで 0 件の図が、別の文言になる', async ({ page }) => {
    const popup = page.locator('.graph-search-popup');
    const input = page.getByLabel('ノードを検索', { exact: true });
    await input.fill('zzzz-none');
    await expect(popup).toContainText('該当するノードがありません');
    // 一覧を描いていない 0 件のときは、存在しない一覧の ID を指さない。
    await expect(input).not.toHaveAttribute('aria-controls', /.+/);
    await page.keyboard.press('Escape');
    await expect(popup).toBeHidden();
    await input.fill('');
    // 全ノードを除く絞り込み。
    const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
    await search.getByRole('searchbox').fill('zzzz-none');
    await search.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.getByText('絞り込みや表示の条件に合うノードがありません')).toBeVisible();
    await expect(popup).toBeHidden();
  });

  test('NFR-07: キーボードだけで、検索 → 選択 → 固定ができる', async ({ page }) => {
    // 【なぜ】配置の計算が終わって位置が出るまで、固定の操作は効かない（固定する位置が無い）。
    //   負荷が高いと計算が遅れるので、他の固定のテストと同じく、ノードが描かれるのを待つ。
    await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(14);
    await page.getByLabel('ノードを検索', { exact: true }).focus();
    await page.keyboard.type('p6');
    await expect(page.locator('.graph-search-results [role="option"]')).toHaveCount(1);
    await page.keyboard.press('Enter');
    // 選んだ後は、カードの見出しへフォーカスが移る（body に落ちない）。
    await expect(page.locator('.graph-card h3')).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: '位置を固定', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: '固定を解除', exact: true })).toBeVisible();
  });

  test('FR-FL-08: 既定と違う表示の規則だけが条件の行に出て、押すと規則へ移る', async ({ page }) => {
    await expect(conditions(page)).not.toContainText('エッジを表示する条件');
    await page.getByRole('radio', { name: 'どちらかの端が通過したとき' }).check();
    await expect(conditions(page)).toContainText('エッジを表示する条件');
    // WCAG 2.5.3: ボタンの名前は見えている文字そのもの。押すと何が起きるかは説明として読む。
    const chip = conditions(page).getByRole('button', { name: /^エッジを表示する条件/ });
    await expect(chip).toHaveAccessibleDescription(/左のパネルの該当箇所を開きます/);
    await chip.click();
    await expect(page.locator('#filter-rules')).toBeFocused();
  });
});

test.describe('FR-UI-01: 英語の画面', () => {
  test.use({ locale: 'en-US' });

  for (const width of [1280, 1024]) {
    test(`FR-UI-01: 英語の表示でツールバーと条件の行がはみ出さない（幅 ${String(width)}）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await startApp(page);
      await openProject(page, 'maghrib.relata.json');
      await selectNode(page, 'p6');
      await page.getByRole('button', { name: 'Display settings', exact: true }).click();
      const overflow = await page.evaluate(() => {
        const page = document.documentElement;
        const bars = [...document.querySelectorAll('.rl-toolbar, .conditions-bar')];
        return {
          pageOverflow: page.scrollWidth - page.clientWidth,
          bars: bars.map((bar) => {
            const box = bar.getBoundingClientRect();
            const outside = [...bar.children].filter((child) => {
              const c = child.getBoundingClientRect();
              return c.right > box.right + 1 || c.left < box.left - 1;
            });
            return outside.length;
          }),
        };
      });
      expect(overflow.pageOverflow).toBeLessThanOrEqual(0);
      expect(overflow.bars.every((n) => n === 0)).toBe(true);
      await expect(page.getByRole('region', { name: 'Applied conditions' })).toContainText(
        'Nodes 14 / 15',
      );
    });
  }
});
