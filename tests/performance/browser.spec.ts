/// <reference lib="dom" />
import { expect, test } from '@playwright/test';
import { DEFAULT_GRAPH_VIEW } from '../../src/core/project';
import { toNodeId } from '../../src/core/model';
import { openProject, startApp } from '../e2e/support';

// 【なぜ】実機差を閾値によるCI失敗で隠さず、値と達成判定を添付する。公開判定は測定条件と併せて行う。
function project(count: number, neighbors: number) {
  const nodes = Array.from({ length: count }, (_, i) => ({
    id: 'n' + String(i),
    type: i < count / 2 ? 'first' : 'second',
    label: 'Person ' + String(i),
    attrs: {},
  }));
  return {
    name: 'performance.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'Relata',
        formatVersion: 1,
        dataset: {
          graphMode: 'directed',
          nodes,
          edges: nodes.flatMap((node, i) =>
            Array.from({ length: neighbors }, (_, j) => ({
              id: 'e' + String(i * neighbors + j),
              source: node.id,
              target: 'n' + String((i + j + 1) % count),
              directed: true,
              weight: 1,
              attrs: {},
            })),
          ),
          nodeTypes: [
            { id: 'first', label: 'First' },
            { id: 'second', label: 'Second' },
          ],
          schema: [],
          meta: { title: 'Performance' },
        },
        view: {
          filter: { filters: [], edgeRule: 'both-ends', showIsolated: true },
          graph: {
            ...DEFAULT_GRAPH_VIEW,
            layout: 'fixed',
            labels: 'selected',
            positions: nodes.map((node, i) => ({
              id: toNodeId(node.id),
              x: (i % 100) * 12,
              y: Math.floor(i / 100) * 12,
              fixed: true,
            })),
          },
        },
      }),
    ),
  };
}

test.use({ locale: 'ja-JP' });
test('NFR-04: 1000ノード5000エッジのフィルタ再描画と指標完了時間を測る', async ({ page }, info) => {
  await startApp(page);
  await openProject(page, project(1000, 5));
  await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('1,000', {
    timeout: 120_000,
  });
  const start = await page.evaluate(() => performance.now());
  await page.getByRole('checkbox', { name: 'First', exact: true }).check();
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(500);
  const redrawMs = (await page.evaluate(() => performance.now())) - start;
  await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('500', { timeout: 120_000 });
  const metricsMs = (await page.evaluate(() => performance.now())) - start;
  await info.attach('nfr-04.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        browser: 'Chromium headless',
        nodes: 1000,
        edges: 5000,
        redrawMs,
        metricsMs,
        redrawTargetMet: redrawMs <= 500,
        metricsTargetMet: metricsMs <= 2000,
        condition:
          '固定配置・選択中のみラベル。操作開始からPlaywrightの画面確認まで（指標はdebounceを含む）。',
      },
      null,
      2,
    ),
  });
});

for (const count of [2000, 5000]) {
  test(`NFR-03/05: ${String(count)}ノードのパン操作とフレーム間隔を測る`, async ({
    page,
  }, info) => {
    await startApp(page);
    await openProject(page, project(count, 4));
    const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
    await expect(nodes).toHaveCount(count, { timeout: 120_000 });
    const cancel = page.getByRole('button', { name: '指標の計算を取り消す', exact: true });
    if (await cancel.isVisible()) await cancel.click();
    const figure = page.getByRole('img', { name: 'ネットワーク図' });
    await figure.scrollIntoViewIfNeeded();
    const initial = await page.locator('.graph-canvas svg > g').getAttribute('transform');
    const milliseconds = await figure.evaluate(async (element) => {
      const start = performance.now();
      for (let i = 0; i < 30; i++) {
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }
      return performance.now() - start;
    });
    await expect(page.locator('.graph-canvas svg > g')).not.toHaveAttribute(
      'transform',
      initial ?? '',
    );
    const fps = 30000 / milliseconds;
    await info.attach('pan.json', {
      contentType: 'application/json',
      body: JSON.stringify(
        {
          browser: 'Chromium headless',
          nodes: count,
          edges: count * 4,
          milliseconds,
          fps,
          fpsTargetMet: count === 2000 ? fps >= 30 : null,
          condition:
            '固定配置・選択中のみラベル・指標計算を取消。30回のキーによるパンと各requestAnimationFrameを測定。',
        },
        null,
        2,
      ),
    });
  });
}
