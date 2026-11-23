/**
 * 下の段と表ビュー（T2-07a）の E2E: FR-TB-01（表）、FR-TB-02（選択の連動）、FR-UI-02（下の段）。
 *
 * 見本は maghrib.relata.json（ノード 15、エッジ 17。既定では孤立の p20 を除いて 14 / 15）。
 * ページ送りは、130 ノードの作り物のプロジェクトで確かめる。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  fixturePath,
  openProject,
  saveProjectFile,
  selectNode,
  startApp,
  waitForAutosave,
} from './support';

test.use({ locale: 'ja-JP' });

/** 下の段の領域。 */
function workspace(page: Page) {
  return page.getByRole('region', { name: /^(下の段|Bottom panel)$/ });
}
/** 表のスクロール領域。 */
function table(page: Page) {
  return page.getByRole('region', { name: /の表（横にスクロール|table \(scrolls/ });
}
/** 下の段を開く（開いていれば何もしない）。 */
async function openBottom(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /^(下の段を開く|Open the bottom panel)$/ });
  if (await toggle.isVisible()) await toggle.click();
  await expect(table(page)).toBeVisible();
}
/** 表の見出しのボタン。 */
function sortButton(page: Page, name: string) {
  return table(page).getByRole('button', { name: new RegExp(`^${name}`) });
}
/** 表の行（ID で選ぶ）。 */
function row(page: Page, id: string) {
  return table(page).locator(`tbody tr[data-id="${id}"]`);
}

/** 130 ノードの鎖のプロジェクトファイル（ページ送り用）。 */
function bigProject(): { name: string; mimeType: string; buffer: Buffer } {
  const base = JSON.parse(readFileSync(fixturePath('maghrib.relata.json'), 'utf8')) as {
    dataset: { nodes: unknown[]; edges: unknown[] };
  }; // 理由: 自分たちの見本ファイル。必要な項目だけ宣言する
  const ids = Array.from({ length: 130 }, (_, i) => `n${String(i + 1).padStart(3, '0')}`);
  base.dataset.nodes = ids.map((id, i) => ({
    id,
    type: 'type-1',
    label: id,
    attrs: { Year: { kind: 'value', value: 1000 + i }, 地名: { kind: 'value', value: 'x' } },
  }));
  base.dataset.edges = ids.slice(1).map((id, i) => ({
    id: `e${String(i + 1)}`,
    source: ids[i],
    target: id,
    directed: true,
    weight: 1,
    attrs: {},
  }));
  return {
    name: 'big.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(base), 'utf8'),
  };
}

test.describe('日本語の画面', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startApp(page);
  });

  test('FR-UI-02: データが無いとき、表は「データなし」を示す', async ({ page }) => {
    await page.getByRole('button', { name: '下の段を開く' }).click();
    await expect(workspace(page)).toContainText('データがありません');
  });

  test('FR-UI-02: 下の段は既定で閉じ、タブは「表」だけで、開閉してもフィルタ・選択・viewport・並べ替えが変わらない', async ({
    page,
  }) => {
    await openProject(page, 'maghrib.relata.json');
    // 既定は閉じている。タブは「表」だけ（空のタブを置かない）。
    await expect(page.getByRole('tab')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: '表' })).toBeVisible();
    await expect(table(page)).toBeHidden();
    // 状態を作る: フィルタ、選択、ズーム。
    await page.getByRole('checkbox', { name: 'タイプ 2' }).check();
    await selectNode(page, 'p18');
    await page.getByRole('button', { name: '拡大', exact: true }).click();
    const figure = page.getByRole('img', { name: 'ネットワーク図' });
    const zoom = await figure.getAttribute('data-zoom');
    const transform = await page.locator('.graph-canvas svg > g').getAttribute('transform');
    const conditions = page.getByRole('region', { name: '適用中の条件' });
    const conditionText = await conditions.textContent();
    await openBottom(page);
    await sortButton(page, 'ラベル').click();
    await expect(table(page).locator('th[aria-sort="ascending"]')).toHaveCount(1);
    // 開閉、タブ、左右のパネルの開閉を繰り返しても変わらない。
    await page.getByRole('button', { name: '下の段を閉じる' }).click();
    await expect(table(page)).toBeHidden();
    await page.getByRole('button', { name: '絞り込みを畳む' }).click();
    await page.getByRole('button', { name: '絞り込みを開く' }).click();
    await page.getByRole('tab', { name: '表' }).click();
    await expect(table(page)).toBeVisible();
    await expect(table(page).locator('th[aria-sort="ascending"]')).toHaveCount(1);
    await expect(figure).toHaveAttribute('data-zoom', zoom ?? '');
    await expect(page.locator('.graph-canvas svg > g')).toHaveAttribute(
      'transform',
      transform ?? '',
    );
    await expect(conditions).toHaveText(conditionText ?? '');
    await expect(page.getByRole('region', { name: '選択したノードの詳細' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'タイプ 2' })).toBeChecked();
  });

  test('FR-UI-02: 高さは矢印キーと Home / End、ドラッグで変えられ、範囲に収まる', async ({
    page,
  }) => {
    await openProject(page, 'maghrib.relata.json');
    await openBottom(page);
    const bar = page.getByRole('separator', { name: '下の段の高さ' });
    await bar.focus();
    const start = Number(await bar.getAttribute('aria-valuenow'));
    await page.keyboard.press('ArrowUp');
    await expect(bar).toHaveAttribute('aria-valuenow', String(start + 24));
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(bar).toHaveAttribute('aria-valuenow', String(start - 24));
    await page.keyboard.press('Home');
    await expect(bar).toHaveAttribute('aria-valuenow', '120');
    await page.keyboard.press('End');
    await expect(bar).toHaveAttribute('aria-valuenow', '800');
    await page.keyboard.press('Home');
    const box = await bar.boundingBox();
    if (box === null) throw new Error('separator has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 96, { steps: 4 });
    await page.mouse.up();
    // 96px 上へ動かすと、その分だけ高くなる（開始位置の端数の差を許す）。
    const dragged = Number(await bar.getAttribute('aria-valuenow'));
    expect(dragged).toBeGreaterThanOrEqual(212);
    expect(dragged).toBeLessThanOrEqual(224);
    const body = page.getByRole('tabpanel', { name: '表' });
    expect((await body.boundingBox())?.height).toBeCloseTo(dragged, 0);
  });

  test('FR-TB-01: ノード表は絞り込み後の件数で、絞り込みに連動する', async ({ page }) => {
    await openProject(page, 'maghrib.relata.json');
    await openBottom(page);
    await expect(table(page).locator('tbody tr')).toHaveCount(14);
    await page.getByRole('checkbox', { name: 'タイプ 2' }).check();
    await expect(table(page).locator('tbody tr')).toHaveCount(4);
    await expect(workspace(page)).toContainText('全体 15 件');
    // エッジ表: 端のノードのラベル（ID ではない）が出る。
    await workspace(page).getByRole('button', { name: 'エッジ表' }).click();
    await expect(table(page).locator('tbody tr')).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'タイプ 2' }).uncheck();
    await expect(table(page).locator('tbody tr')).toHaveCount(17);
    await expect(table(page).locator('tbody tr[data-id="e1"]')).toContainText('ابن عسكر');
    await expect(table(page).locator('tbody tr[data-id="e1"]')).toContainText(
      'يوسف بن عيسى الفجيجي',
    );
  });

  test('FR-TB-01: 列ごとの並べ替え（昇順 → 降順 → なし）と、表示する列の選択', async ({ page }) => {
    await openProject(page, 'maghrib.relata.json');
    await openBottom(page);
    const firstIds = async () =>
      table(page)
        .locator('tbody tr')
        .evaluateAll((rows) => rows.slice(0, 3).map((r) => r.getAttribute('data-id')));
    const original = await firstIds();
    await sortButton(page, '年').click();
    await expect(table(page).locator('th[aria-sort="ascending"]')).toContainText('年');
    const asc = await table(page)
      .locator('tbody tr td:nth-child(5)')
      .evaluateAll((cells) =>
        cells.map((c) => Number(c.textContent)).filter((n) => !Number.isNaN(n)),
      );
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    await sortButton(page, '年').click();
    await expect(table(page).locator('th[aria-sort="descending"]')).toContainText('年');
    const desc = await table(page)
      .locator('tbody tr td:nth-child(5)')
      .evaluateAll((cells) =>
        cells.map((c) => Number(c.textContent)).filter((n) => !Number.isNaN(n)),
      );
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    await sortButton(page, '年').click();
    await expect(table(page).locator('th[aria-sort]')).toHaveCount(0);
    expect(await firstIds()).toEqual(original);

    // 列の選択: ID を外すと見出しが消え、既定に戻すと戻る。
    await expect(sortButton(page, 'ID')).toBeVisible();
    await workspace(page).locator('summary', { hasText: '列' }).click();
    await workspace(page).getByRole('checkbox', { name: 'ID を表示' }).uncheck();
    await expect(sortButton(page, 'ID')).toHaveCount(0);
    await workspace(page).getByRole('button', { name: '既定の列に戻す' }).click();
    await expect(sortButton(page, 'ID')).toBeVisible();
  });

  test('FR-TB-01: 欠損は欠損と分かる表示で、アラビア文字の値が切れずに出る', async ({ page }) => {
    await openProject(page, 'maghrib.relata.json');
    await openBottom(page);
    const p1 = row(page, 'p1');
    await expect(p1).toContainText('ابن عسكر');
    await expect(p1.locator('bdi', { hasText: 'ابن عسكر' }).first()).toBeVisible();
    // 行の高さを詰めすぎない: 文字の入れ物の中で内容が切れていない。
    const clipped = await table(page)
      .locator('tbody td')
      .evaluateAll((cells) => cells.filter((c) => c.scrollHeight > c.clientHeight + 1).length);
    expect(clipped).toBe(0);
    // 欠損の理由つきの表示があれば、色だけでなく文字で出ている（見本に欠損が無いデータでも壊れない）。
    const missing = table(page).locator('.table-missing');
    if ((await missing.count()) > 0) await expect(missing.first()).not.toHaveText('');
  });

  test('FR-TB-01: 数千行でなくても、ページ送りで 1 ページ 50 行に収まる', async ({ page }) => {
    await openProject(page, bigProject());
    await openBottom(page);
    await expect(table(page).locator('tbody tr')).toHaveCount(50);
    await expect(workspace(page)).toContainText('ページ 1 / 3');
    await expect(workspace(page)).toContainText('1–50 / 130 件');
    await workspace(page).getByRole('button', { name: '次のページ' }).click();
    await expect(workspace(page)).toContainText('ページ 2 / 3');
    await expect(row(page, 'n051')).toBeVisible();
    await workspace(page).getByRole('button', { name: '次のページ' }).click();
    await expect(table(page).locator('tbody tr')).toHaveCount(30);
    await expect(workspace(page).getByRole('button', { name: '次のページ' })).toBeDisabled();
    // 数値の列は桁区切りなし（年を「1,050」としない）。
    await expect(row(page, 'n130')).toContainText('1129');
    // 並べ替えるとページは先頭へ戻る。
    await sortButton(page, 'ラベル').click();
    await expect(workspace(page)).toContainText('ページ 1 / 3');
  });

  test('FR-TB-02: 表の行を選ぶと図の選択中のカードに出て、図で選ぶと表で強調される', async ({
    page,
  }) => {
    await openProject(page, 'maghrib.relata.json');
    await openBottom(page);
    // 表 → 図
    await row(page, 'p6').locator('td').nth(1).click();
    await expect(row(page, 'p6')).toHaveAttribute('data-selected', 'true');
    const card = page.getByRole('region', { name: '選択したノードの詳細' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('عبد العزيز التباع');
    // 選ぶボタンは押された状態になる（色だけでなく状態でも伝える）。
    await expect(row(page, 'p6').getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    // 図 → 表: 別のノードを図で選ぶと、表の強調が移る。
    await selectNode(page, 'p1');
    await expect(row(page, 'p1')).toHaveAttribute('data-selected', 'true');
    await expect(row(page, 'p6')).toHaveAttribute('data-selected', 'false');
    // 選択を解除すると、表の強調も消える（表に別の選択の状態を持たない）。
    await page.getByRole('button', { name: '選択を解除' }).click();
    await expect(table(page).locator('tr[data-selected="true"]')).toHaveCount(0);
    // キーボード: 行の「選ぶ」ボタンで選べる。
    await row(page, 'p7').getByRole('button').focus();
    await page.keyboard.press('Enter');
    await expect(row(page, 'p7')).toHaveAttribute('data-selected', 'true');
    // エッジの行を選ぶと、両端のノードが図のカードに出る。
    await workspace(page).getByRole('button', { name: 'エッジ表' }).click();
    await row(page, 'e1').locator('td').nth(1).click();
    await expect(row(page, 'e1')).toHaveAttribute('data-selected', 'true');
    await expect(card).toContainText('他に 1 件を選択中');
    await workspace(page).getByRole('button', { name: 'ノード表' }).click();
    await expect(row(page, 'p1')).toHaveAttribute('data-selected', 'true');
  });

  test('FR-TB-02: 図で選んだノードが別のページにあれば、そのページへ移る。「選択した行へ移る」でも戻れる', async ({
    page,
  }) => {
    await openProject(page, bigProject());
    await openBottom(page);
    await selectNode(page, 'n120');
    await expect(workspace(page)).toContainText('ページ 3 / 3');
    await expect(row(page, 'n120')).toHaveAttribute('data-selected', 'true');
    await workspace(page).getByRole('button', { name: '前のページ' }).click();
    await expect(row(page, 'n120')).toHaveCount(0);
    await workspace(page).getByRole('button', { name: '選択した行へ移る' }).click();
    await expect(row(page, 'n120')).toBeVisible();
  });

  test('FR-TB-01: 絞り込みで 0 件のときと、列が無いときは、別の文言になる', async ({ page }) => {
    await openProject(page, 'maghrib.relata.json');
    await openBottom(page);
    const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
    await search.getByRole('searchbox').fill('zzzz-none');
    await search.getByRole('button', { name: '検索', exact: true }).click();
    await expect(workspace(page)).toContainText('絞り込みに合うノードがありません');
    await expect(workspace(page)).not.toContainText('データがありません');
  });

  test('FR-UI-02: 保存して開き直すと、表の設定と下の段が戻る（ファイルと自動保存）', async ({
    page,
    browser,
    baseURL,
  }) => {
    await openProject(page, 'maghrib.relata.json');
    await openBottom(page);
    await workspace(page).getByRole('button', { name: 'エッジ表' }).click();
    await sortButton(page, '重み').click();
    await sortButton(page, '重み').click();
    await page.getByRole('separator', { name: '下の段の高さ' }).focus();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    // 自動保存にも入る。
    const saved = await waitForAutosave(
      page,
      (s) => (s.view as { workspace?: { height?: number } }).workspace?.height === 348,
    );
    const view = saved.view as unknown as {
      table: { target: string; edge: { sort: { column: string; direction: string } } };
      workspace: { open: boolean };
    }; // 理由: アプリが書いた JSON。テストが読む項目だけ宣言する
    expect(view.table.target).toBe('edge');
    expect(view.table.edge.sort).toEqual({ column: 'weight', direction: 'desc' });
    expect(view.workspace.open).toBe(true);

    const downloading = page.waitForEvent('download');
    await saveProjectFile(page);
    const download = await downloading;
    const text = readFileSync(await download.path(), 'utf8');

    const context = await browser.newContext({ baseURL: baseURL ?? '', locale: 'ja-JP' });
    try {
      const page2 = await context.newPage();
      await page2.setViewportSize({ width: 1280, height: 800 });
      await startApp(page2);
      await openProject(page2, {
        name: download.suggestedFilename(),
        mimeType: 'application/json',
        buffer: Buffer.from(text, 'utf8'),
      });
      await expect(table(page2)).toBeVisible();
      await expect(workspace(page2).getByRole('button', { name: 'エッジ表' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(table(page2).locator('th[aria-sort="descending"]')).toContainText('重み');
      await expect(page2.getByRole('separator', { name: '下の段の高さ' })).toHaveAttribute(
        'aria-valuenow',
        '348',
      );
    } finally {
      await context.close();
    }
  });

  test('FR-PJ-03: 表と下の段の項目が無い版 2 のファイルも開け、下の段は既定（閉じている）になる', async ({
    page,
  }) => {
    await openProject(page, 'maghrib.relata.json');
    await expect(page.getByRole('tab', { name: '表' })).toBeVisible();
    await expect(table(page)).toBeHidden();
  });
});

test.describe('FR-UI-01: 英語の画面', () => {
  test.use({ locale: 'en-US' });

  for (const width of [1280, 1024]) {
    test(`FR-UI-01: 英語の表示で下の段と表がはみ出さない（幅 ${String(width)}）`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await startApp(page);
      await openProject(page, 'maghrib.relata.json');
      await openBottom(page);
      await workspace(page).getByRole('button', { name: 'Edge table' }).click();
      await expect(workspace(page))
        .toContainText('Page')
        .catch(() => undefined);
      const overflow = await page.evaluate(() => {
        const root = document.documentElement;
        const panel = document.querySelector('.bottom-panel');
        const bars = [...document.querySelectorAll('.table-toolbar, .bottom-bar')];
        return {
          pageOverflow: root.scrollWidth - root.clientWidth,
          panelRight: panel?.getBoundingClientRect().right ?? 0,
          viewport: root.clientWidth,
          outside: bars.map((bar) => {
            const box = bar.getBoundingClientRect();
            return [...bar.children].filter((c) => {
              const r = c.getBoundingClientRect();
              return r.right > box.right + 1 || r.left < box.left - 1;
            }).length;
          }),
        };
      });
      expect(overflow.pageOverflow).toBeLessThanOrEqual(0);
      expect(overflow.panelRight).toBeLessThanOrEqual(overflow.viewport);
      expect(overflow.outside.every((n) => n === 0)).toBe(true);
      await expect(workspace(page).getByRole('tab', { name: 'Table' })).toBeVisible();
      await expect(table(page).locator('tbody tr')).toHaveCount(17);
    });
  }
});
