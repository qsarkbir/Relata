/** グラフの範囲選択（Shift ＋ ドラッグ）と選択で絞り込む: FR-FL-11 */
import { test, expect, type Page } from '@playwright/test';
import { appliedRegion, openProject, startApp } from './support';

const NODES = '.graph-canvas #graph-view-nodes > [data-id]';

/** 図の SVG。 */
function figure(page: Page) {
  return page.locator('.graph-canvas svg').first();
}
/** 選択中のカード。 */
function card(page: Page) {
  return page.getByRole('region', { name: /^(選択したノードの詳細|Selected node details)$/ });
}
/** 図全体を Shift ＋ ドラッグで囲む。 */
async function shiftDragAll(page: Page): Promise<void> {
  const box = await figure(page).boundingBox();
  if (box === null) throw new Error('図が見つからない');
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 4 });
  await expect(page.getByTestId('range-rect')).toBeVisible();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('range-rect')).toBeHidden();
}

test.describe('日本語の画面', () => {
  test.use({ locale: 'ja-JP' });

  test('FR-FL-11: Shift＋ドラッグで複数選択し、選択で絞り込み、Undo と Esc で戻せる', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await expect(page.locator(NODES)).toHaveCount(14);
    await shiftDragAll(page);
    await expect(card(page)).toContainText('14 件を選択中');

    // 通常のドラッグ（Shift なし）はパンで、選択を変えない。
    const box = await figure(page).boundingBox();
    if (box === null) throw new Error('図が見つからない');
    await page.mouse.move(box.x + 5, box.y + box.height - 5);
    await page.mouse.down();
    await page.mouse.move(box.x + 40, box.y + box.height - 30, { steps: 4 });
    await page.mouse.up();
    await expect(card(page)).toContainText('14 件を選択中');

    // 絞り込む前は条件が増えない。押すと nodeSet が足される。
    await expect(appliedRegion(page)).not.toContainText('選択したノード（');
    await card(page).getByRole('button', { name: '選択したノードで絞り込む' }).click();
    await expect(appliedRegion(page)).toContainText('選択したノード（14 件）');
    // 同じ選択で押し直せない（履歴を積まない）。
    await expect(card(page).getByRole('button', { name: '絞り込みに適用済み' })).toBeDisabled();

    await page.keyboard.press('Control+z');
    await expect(appliedRegion(page)).not.toContainText('選択したノード（');
    await page.keyboard.press('Control+Shift+z');
    await expect(appliedRegion(page)).toContainText('選択したノード（14 件）');

    // カードの中で Esc を押すと選択が消え、フォーカスは図に戻る。
    await card(page).getByRole('heading').focus();
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await expect(figure(page)).toBeFocused();
  });

  test('FR-FL-11: Shift＋クリックで 1 つずつ足す・外す。1 件でも絞り込める', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    const nodes = page.locator(NODES);
    await nodes.nth(0).click({ modifiers: ['Shift'] });
    await expect(
      card(page).getByRole('button', { name: '選択したノードで絞り込む' }),
    ).toBeVisible();
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await expect(card(page)).toContainText('2 件を選択中');
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await expect(card(page)).not.toContainText('2 件を選択中');
    await card(page).getByRole('button', { name: '選択したノードで絞り込む' }).click();
    await expect(appliedRegion(page)).toContainText('選択したノード（1 件）');
  });

  test('FR-FL-11: 拡大・パンの後も、見えているノードだけを矩形で選ぶ', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    const zoomIn = page.getByRole('button', { name: '拡大', exact: true });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();
    const box = await figure(page).boundingBox();
    if (box === null) throw new Error('図が見つからない');
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 80, { steps: 4 });
    await page.mouse.up();
    // 画面に見えている（図の枠の中に中心がある）ノードの数を、画面から数える。
    // 【なぜ】パンの後の描き直しが終わってから数える（2 フレーム待つ）。数える範囲は、下の shiftDragAll が
    // 囲む範囲（枠から内側へ 2 px）と同じにする。枠の端から 2 px 以内に中心があるノードを「見えている」と
    // 数えると、囲んだ範囲には入らず、件数が 1 つずれて CI で失敗した。
    const visible = await page.evaluate(async (sel) => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      });
      const svg = document.querySelector('.graph-canvas svg');
      if (svg === null) return -1;
      const f = svg.getBoundingClientRect();
      const inset = 2;
      return [...document.querySelectorAll(sel)].filter((el) => {
        const r = el.getBoundingClientRect();
        const x = (r.left + r.right) / 2;
        const y = (r.top + r.bottom) / 2;
        return (
          x >= f.left + inset && x <= f.right - inset && y >= f.top + inset && y <= f.bottom - inset
        );
      }).length;
    }, NODES);
    await shiftDragAll(page);
    if (visible === 0) await expect(card(page)).toHaveCount(0);
    else if (visible === 1) await expect(card(page)).toBeVisible();
    else await expect(card(page)).toContainText(`${String(visible)} 件を選択中`);
  });

  test('FR-FL-11: 選択を変えて押し直すと、条件は 1 つのまま置き換わる', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    const nodes = page.locator(NODES);
    await nodes.nth(0).click({ modifiers: ['Shift'] });
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await card(page).getByRole('button', { name: '選択したノードで絞り込む' }).click();
    await expect(appliedRegion(page)).toContainText('選択したノード（2 件）');
    await expect(nodes).toHaveCount(2);
    await nodes.nth(1).click({ modifiers: ['Shift'] });
    await card(page).getByRole('button', { name: '選択したノードで絞り込む' }).click();
    await expect(appliedRegion(page)).toContainText('選択したノード（1 件）');
    await expect(appliedRegion(page).getByText('選択したノード（')).toHaveCount(1);
  });
});

test.describe('射影の適用中', () => {
  test.use({ locale: 'ja-JP' });

  test('FR-FL-11: 射影の適用中に絞り込んでも、仲介の型を通すのでエッジが残る', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await startApp(page);
    await openProject(page, bipartiteProject());
    await expect(page.locator(NODES)).toHaveCount(5);
    await shiftDragAll(page);
    await expect(card(page)).toContainText('5 件を選択中');
    await expect(card(page)).toContainText('組織のノードはすべて通します');
    // アラビア文字のラベルは <bdi> に入る。
    await expect(card(page).locator('bdi', { hasText: 'ابن عسكر' })).toBeVisible();
    await card(page).getByRole('button', { name: '選択したノードで絞り込む' }).click();
    await expect(appliedRegion(page)).toContainText('選択したノード（5 件。組織はすべて通す）');
    await expect(page.getByRole('region', { name: /適用中の条件/ })).toContainText(
      '射影後: ノード 5 · エッジ 6',
    );
  });
});

test.describe('英語の画面', () => {
  test.use({ locale: 'en-US' });

  test('FR-FL-11: 英語でも文言が出て、キーボードで解除できる', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await shiftDragAll(page);
    await expect(card(page)).toContainText('14 selected');
    await card(page).getByRole('button', { name: 'Filter to the selected nodes' }).click();
    await expect(page.getByRole('region', { name: 'Active filters' })).toContainText(
      'Selected nodes (14)',
    );
    await figure(page).focus();
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
  });
});

/** 小さな二部グラフ（人物 5、組織 3。エッジ 8）。射影（人物 ← 組織）を保存したファイル。 */
function bipartiteProject() {
  const node = (id: string, type: string, label: string) => ({ id, type, label, attrs: {} });
  const edge = (id: string, source: string, target: string) => ({
    id,
    source,
    target,
    directed: false,
    weight: 1,
    attrs: {},
  });
  return {
    name: 'bipartite.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'Relata',
        formatVersion: 1,
        dataset: {
          graphMode: 'undirected',
          nodeTypes: [
            { id: 'person', label: '人物' },
            { id: 'org', label: '組織' },
          ],
          nodes: [
            node('p1', 'person', 'ابن عسكر'),
            node('p2', 'person', 'Bob'),
            node('p3', 'person', 'Carol'),
            node('p4', 'person', 'Dan'),
            node('p5', 'person', 'Eve'),
            node('o1', 'org', 'Org One'),
            node('o2', 'org', 'Org Two'),
            node('o3', 'org', 'Org Three'),
          ],
          edges: [
            edge('e1', 'p1', 'o1'),
            edge('e2', 'p2', 'o1'),
            edge('e3', 'p3', 'o1'),
            edge('e4', 'p2', 'o2'),
            edge('e5', 'p3', 'o2'),
            edge('e6', 'p4', 'o2'),
            edge('e7', 'p4', 'o3'),
            edge('e8', 'p5', 'o3'),
          ],
          schema: [],
          meta: { title: 'Bipartite test' },
        },
        view: {
          filter: { filters: [], edgeRule: 'both-ends', showIsolated: false },
          graph: {
            graphOptions: {
              weight: 'weight',
              selfLoops: true,
              projection: { target: 'person', via: 'org', method: 'shared' },
            },
          },
        },
      }),
    ),
  };
}
