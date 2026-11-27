/**
 * 欠損の可視化（T2-04）の E2E: FR-VG-12。
 *
 * 見本は maghrib.relata.json（ノード 15。既定では孤立の p20 を除いて 14）。
 * 属性「地名」が欠損するのは p7、p40、p35b、anon の 4 つ。属性「年」（キーは Year）は p39、p20、p35b、anon の 4 つ（p20 は既定で除かれる）。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from './fixtures';
import { openGraphSection, openProject, readAutosave, startApp } from './support';

test.use({ locale: 'ja-JP' });

function workspace(page: Page) {
  return page.getByRole('region', { name: /^(下の段|Bottom panel)$/ });
}
function missingTable(page: Page) {
  return page.getByTestId('missing-table');
}
/** 描いた図の中の、破線の図形の数。 */
function dashed(page: Page) {
  return page.locator('.graph-canvas svg [stroke-dasharray]');
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
});

test('FR-VG-12: 「欠損」タブは属性ごとに、絞り込み後と全体の欠損を理由別に並べ、閉じても描いたまま', async ({
  page,
}) => {
  await page.getByRole('tab', { name: '欠損' }).click();
  const table = missingTable(page);
  await expect(table).toBeVisible();
  const row = (attr: string, scope: 'filtered' | 'whole') =>
    table.locator(`tr[data-attr="${attr}"][data-scope="${scope}"]`);
  await expect(row('地名', 'whole')).toContainText('15');
  await expect(row('地名', 'whole').getByTestId('missing-total')).toHaveText(/^4（26\.7%）$/);
  await expect(row('地名', 'filtered').getByTestId('missing-total')).toHaveText(/^4（28\.6%）$/);
  await expect(row('Year', 'whole').getByTestId('missing-total')).toHaveText(/^4（26\.7%）$/);
  // p20（記載なし）は既定の絞り込みで除かれるので、絞り込み後は 3。
  await expect(row('Year', 'filtered').getByTestId('missing-total')).toHaveText(/^3（21\.4%）$/);
  // 理由別の列。
  await expect(table.getByRole('columnheader', { name: '判読不能' })).toBeVisible();
  // 絞り込みを変えると数え直す: タイプ 2 だけに絞る前後で、絞り込み後の件数が変わる。
  const before = await row('地名', 'filtered').textContent();
  await page.getByRole('checkbox', { name: 'タイプ 2' }).check();
  await expect(row('地名', 'filtered').getByTestId('missing-total')).toHaveText(/^1（25%）$/);
  expect(before).not.toContain('1（25%）');
  await expect(row('地名', 'whole').getByTestId('missing-total')).toHaveText(/^4（26\.7%）$/);
  // 閉じても中身は描いたまま（隠すだけ）。
  await page.getByRole('button', { name: '下の段を閉じる' }).click();
  await expect(table).toBeHidden();
  await expect(table).toBeAttached();
  await expect(workspace(page)).toBeVisible();
});

test('FR-VG-12: 「欠損の表示」で選んだ属性が欠損しているノードの枠線が破線になり、保存して開き直しても残る', async ({
  page,
}) => {
  const before = await dashed(page).count();
  await openGraphSection(page, '欠損の表示');
  const box = page.getByRole('checkbox', { name: '地名' });
  await expect(box).not.toBeChecked();
  await box.check();
  // 地名が欠損する 4 ノードが、枠線の破線で区別される。
  for (const id of ['p7', 'p40', 'p35b', 'anon'])
    await expect(page.locator(`.graph-canvas svg [data-id="${id}"][stroke-dasharray]`)).toHaveCount(
      1,
    );
  await expect(page.locator('.graph-canvas svg [data-id="p1"][stroke-dasharray]')).toHaveCount(0);
  expect(await dashed(page).count()).toBe(before + 4);
  // 自動保存に view.graph.missingDisplay として残る。
  await expect
    .poll(async () => {
      const text = await readAutosave(page);
      return text?.includes('"missingDisplay":{"nodeAttrs":["地名"]');
    })
    .toBe(true);
  // 解除すると、破線は消える。
  await box.uncheck();
  await expect(dashed(page)).toHaveCount(before);
});

test('FR-VG-12: キーボードだけで、タブの切り替えと欠損の表示の選択ができる', async ({ page }) => {
  await page.getByRole('tab', { name: '表', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '欠損' })).toHaveAttribute('aria-selected', 'true');
  await openGraphSection(page, '欠損の表示');
  await page.getByRole('checkbox', { name: '年' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox', { name: '年' })).toBeChecked();
});

test('FR-VG-12: 絞り込みで 0 件のとき、データなしと区別して「0 件」を示す', async ({ page }) => {
  await page.getByRole('tab', { name: '欠損' }).click();
  await expect(page.getByText('絞り込みで 0 件です')).toBeHidden();
  // ノードのテキスト検索で、合うものが無い条件にする（表の E2E と同じ手順）。
  const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
  await search.getByRole('searchbox').fill('zzzz-none');
  await search.getByRole('button', { name: '検索', exact: true }).click();
  await expect(page.getByText('絞り込みで 0 件です')).toBeVisible();
  await expect(workspace(page)).not.toContainText('データを読み込むと');
  // 表は出したまま、絞り込み後の行は割合なし。全体の行は変わらない。
  await expect(
    missingTable(page)
      .locator('tr[data-attr="地名"][data-scope="filtered"]')
      .getByTestId('missing-total'),
  ).toHaveText('0（割合なし）');
});

test.describe('時期ごとの欠損率（サンプル）', () => {
  /** 公開サンプル（日付は属性 Year、ノード 219）を開く。 */
  async function loadSample(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
    await expect(page.getByRole('region', { name: '適用中の条件' })).toContainText('/ 219');
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
  }
  const periodTable = (page: Page) => page.getByTestId('missing-period-table');

  test('FR-VG-12: 年表の設定に従い、時期ごと・属性ごとに欠損の件数と割合を示す。区切りを変えると数え直す', async ({
    page,
  }) => {
    await page.goto('./');
    await loadSample(page);
    await page.getByRole('tab', { name: '欠損' }).click();
    await expect(page.getByTestId('missing-period-basis')).toContainText('区切り: 10 年');
    await expect(periodTable(page)).toBeVisible();
    const rows = periodTable(page).locator('tbody tr[data-period]');
    const before = await rows.count();
    expect(before).toBeGreaterThan(1);
    await expect(rows.first().locator('td').first()).toHaveText(/^\d+ \/ \d+（.+）$/);
    // 年表のタブで区切りを 100 年にすると、欠損の時期ごとの行も数え直される。
    await page.getByRole('tab', { name: '年表' }).click();
    await page.getByLabel('区切り').selectOption('100');
    await page.getByRole('tab', { name: '欠損' }).click();
    await expect(page.getByTestId('missing-period-basis')).toContainText('区切り: 100 年');
    expect(await rows.count()).toBeLessThan(before);
  });

  test('FR-VG-12: 年代のない要素は、区切りとは別の行に数える', async ({ page }) => {
    await page.goto('./');
    const file = JSON.parse(readFileSync('public/samples/maghrib.relata.json', 'utf8')) as {
      dataset: { nodes: { attrs: Record<string, unknown> }[] };
    }; // 理由: 自分たちの見本ファイル
    for (const node of file.dataset.nodes.slice(0, 3))
      node.attrs.Year = { kind: 'missing', reason: 'unrecorded' };
    await openProject(page, {
      name: 'undated.relata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
    await page.getByRole('tab', { name: '欠損' }).click();
    // サンプルにも日付のないノードが 1 つあるので、合わせて 4。
    await expect(periodTable(page).locator('tr[data-period="noDate"] th')).toContainText('(4)');
  });

  test('FR-VG-12: 絞り込みで 0 件のときは、時期ごとの節でもデータなしと区別して示す', async ({
    page,
  }) => {
    await page.goto('./');
    await loadSample(page);
    const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
    await search.getByRole('searchbox').fill('zzzz-none');
    await search.getByRole('button', { name: '検索', exact: true }).click();
    await page.getByRole('tab', { name: '欠損' }).click();
    await expect(page.getByText('時期ごとの欠損率は数えられません')).toBeVisible();
    await expect(periodTable(page)).toHaveCount(0);
  });

  test('FR-VG-12: 日付のある要素が無くても、年代なしの行は出る（「日付のある区切りが無い」とは言わない）', async ({
    page,
  }) => {
    await page.goto('./');
    const file = JSON.parse(readFileSync('public/samples/maghrib.relata.json', 'utf8')) as {
      dataset: { nodes: { attrs: Record<string, unknown> }[] };
    }; // 理由: 自分たちの見本ファイル
    for (const node of file.dataset.nodes)
      node.attrs.Year = { kind: 'missing', reason: 'unrecorded' };
    await openProject(page, {
      name: 'all-undated.relata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(file)),
    });
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
    await page.getByRole('tab', { name: '欠損' }).click();
    await expect(page.getByText('日付のあるものがありません')).toBeVisible();
    await expect(periodTable(page).locator('tr[data-period="noDate"]')).toBeVisible();
  });
});
