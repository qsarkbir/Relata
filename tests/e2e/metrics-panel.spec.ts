import { expect, test } from './fixtures';
import { openProject, startApp } from './support';

function projectFile(kind: 'directed' | 'undirected' = 'directed', count = 4, isolated = false) {
  return {
    name: 'metrics.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'Relata',
        formatVersion: 1,
        dataset: {
          graphMode: kind,
          nodeTypes: [{ id: 'person', label: 'Person' }],
          nodes: Array.from({ length: count }, (_, i) => ({
            id: 'n' + String(i),
            type: 'person',
            label: String.fromCharCode(65 + i),
            attrs: {},
          })),
          edges: [1, 2].map((target) => ({
            id: 'e' + String(target),
            source: 'n0',
            target: 'n' + String(target),
            directed: kind === 'directed',
            weight: 1,
            attrs: {},
          })),
          schema: [],
          meta: { title: 'Metrics test' },
        },
        view: { filter: { filters: [], edgeRule: 'both-ends', showIsolated: isolated } },
      }),
    ),
  };
}
test.describe('FR-MT-02/03/04 / FR-UI-04: 指標パネル', () => {
  test.use({ locale: 'ja-JP' });
  test('実Workerで全体・入出次数・HITSを計算し、並べ替えと用語説明を表示する', async ({ page }) => {
    await startApp(page);
    const workerStarted = page.waitForEvent('worker', (worker) =>
      worker.url().includes('metrics.worker'),
    );
    await openProject(page, projectFile());
    const worker = await workerStarted;
    expect(worker.url()).toContain('metrics.worker');
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('3');
    await expect(page.getByTestId('metric-global-edgeCount')).toHaveText('2');
    const table = page.getByRole('table', { name: 'ノードごとの指標' });
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(
      table.getByRole('button', { name: '入次数で並べ替え', exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole('button', { name: 'HITS（権威）で並べ替え', exact: true }),
    ).toBeAttached();
    const degree = table.getByRole('button', { name: '次数（合計）で並べ替え', exact: true });
    await expect(degree).toHaveAttribute('title', /接続する線の数/);
    await degree.click();
    await expect(table.locator('th[aria-sort="descending"]')).toContainText('次数（合計）');
    await expect(table.locator('tbody tr').first().getByRole('rowheader')).toHaveText('A');
    await degree.click();
    await expect(table.locator('tbody tr').first().getByRole('rowheader')).toHaveText('B');
    // 【なぜ】指標の意味は、狭いパネルに広げず、アイコンから開くダイアログで読む（利用者の指摘）。
    await page.getByRole('button', { name: /^説明: 指標の意味と計算上の注意/ }).click();
    const info = page.getByRole('dialog', { name: '指標の意味と計算上の注意', exact: true });
    await expect(info.getByText(/ほかのノード間の最短経路をどれだけ仲介/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(info).toBeHidden();
    await page.screenshot({ path: 'test-results/metrics-panel.png', fullPage: true });
  });
  test('孤立ノードの設定変更で自動再計算し、古い値を表示し続けない', async ({ page }) => {
    await startApp(page);
    await openProject(page, projectFile());
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('3');
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('4');
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).uncheck();
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('3');
  });
  test('待ち時間中に取り消せ、再計算すると実Workerの結果が表示される', async ({ page }) => {
    await startApp(page);
    await openProject(page, projectFile());
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('3');
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'));
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
    await expect(
      page.getByRole('progressbar', { name: '絞り込み後のグラフの指標を計算中…' }),
    ).toBeVisible();
    await page.getByRole('button', { name: '指標の計算を取り消す' }).click();
    await page.clock.runFor(500);
    await expect(page.getByText('計算を取り消しました。', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'ノードごとの指標' })).toHaveCount(0);
    await page.getByRole('button', { name: '指標を再計算', exact: true }).click();
    await page.clock.runFor(250);
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('4');
  });
  test('複数のノード型を持つデータに指標の注意を表示する', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('14');
    // 【なぜ】注意はボタンの件数で示し、全文はダイアログで読む（利用者の指摘、2026-11-22）。
    await page
      .getByRole('button', { name: '説明: 指標の意味と計算上の注意（注意 2 件）', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: '指標の意味と計算上の注意', exact: true });
    await expect(dialog.getByText(/ノード型が複数あります/)).toBeVisible();
    await expect(dialog.getByText(/次の指標は向きを無視して計算しました/)).toBeVisible();
  });
  test('Worker読込の失敗を表示し、再試行で復旧できる', async ({ page }) => {
    await page.route('**/*metrics.worker*.js', (route) => route.abort());
    await startApp(page);
    await openProject(page, projectFile());
    await expect(
      page.getByRole('alert').filter({ hasText: '指標を計算できませんでした' }),
    ).toBeVisible();
    await page.unroute('**/*metrics.worker*.js');
    await page.getByRole('button', { name: '指標を再計算', exact: true }).click();
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('3');
  });
});
test.describe('FR-MT-04 / FR-UI-01: 英語・ページ分割・非該当', () => {
  test.use({ locale: 'en-US' });
  test('無向の相互性は対象外、ノード表を50行ずつ英語で表示する', async ({ page }) => {
    await startApp(page);
    await openProject(page, projectFile('undirected', 120, true));
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('120');
    await expect(page.getByTestId('metric-global-reciprocity')).toHaveText('Not applicable');
    const table = page.getByRole('table', { name: 'Node metrics' });
    await expect(table.locator('tbody tr')).toHaveCount(50);
    await expect(
      table.getByRole('button', { name: 'Sort by Eigenvector centrality', exact: true }),
    ).toBeAttached();
    await expect(page.getByText('Rows 1–50 of 120', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next 50 rows', exact: true }).click();
    await expect(page.getByText('Rows 51–100 of 120', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Next 50 rows', exact: true }).click();
    await expect(table.locator('tbody tr')).toHaveCount(20);
    await expect(page.getByRole('button', { name: 'Next 50 rows', exact: true })).toBeDisabled();
    await table.getByRole('button', { name: 'Sort by Degree (total)', exact: true }).click();
    await expect(page.getByText('Rows 1–50 of 120', { exact: true })).toBeVisible();
  });
});
