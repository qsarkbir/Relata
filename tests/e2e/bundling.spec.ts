/**
 * グラフ図の edge bundling（FR-VG-13、FR-VG-14）の E2E。
 *
 * 【なぜ】束ねる計算は Worker で走る。ズームや描き方の切り替えで計算し直さないことは、
 * Worker の起動回数（`new Worker` の記録）で確かめる。
 */
/// <reference lib="dom" />
import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import {
  fixturePath,
  openGraphSection,
  openProject,
  saveProjectFile,
  saveSvgFile,
  startApp,
} from './support';

test.use({ locale: 'ja-JP' });

/** 束ねる計算の Worker の起動回数を数える（ページの読み込み前に仕込む）。 */
async function countBundlingWorkers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __bundlingWorkers: number; Worker: typeof Worker };
    w.__bundlingWorkers = 0;
    const Original = w.Worker;
    w.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (String(url).includes('bundling')) w.__bundlingWorkers++;
      }
    };
  });
}
const workerStarts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __bundlingWorkers: number }).__bundlingWorkers);

const toggle = (page: Page) => page.getByRole('checkbox', { name: '束ねる', exact: true });
const bands = (page: Page) => page.locator('.graph-canvas polygon[id^="graph-view-bundle-"]');

test.describe('FR-VG-13/14: グラフ図の edge bundling', () => {
  test('FR-VG-13/14: 有効にすると帯が描かれ、重ね描き・ズームでは計算し直さない。無効にすると元の図に戻る', async ({
    page,
  }) => {
    await countBundlingWorkers(page);
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    const edges = page.locator('.graph-canvas #graph-view-edges > [data-id]');
    await expect(edges.first()).toBeVisible();
    const plainEdges = await edges.count();
    await expect(bands(page)).toHaveCount(0);
    expect(await workerStarts(page)).toBe(0);

    await toggle(page).check();
    // 計算中・計算後を通じて、図は消えない（ノードは描いたまま）。
    await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]').first()).toBeVisible();
    await expect(bands(page).first()).toBeVisible();
    expect(await workerStarts(page)).toBe(1);

    // 描き方を重ね描きにしても、計算し直さない。帯は消え、重ね描きの線が出る。
    await openGraphSection(page, /束ねる/);
    await page.getByLabel('描き方', { exact: true }).selectOption('overlay');
    await expect(bands(page)).toHaveCount(0);
    await expect(page.locator('.graph-canvas [data-bundle-role="overlay"]').first()).toBeVisible();
    await page.getByRole('button', { name: '拡大', exact: true }).click();
    await page.getByLabel('描き方', { exact: true }).selectOption('bands');
    await expect(bands(page).first()).toBeVisible();
    expect(await workerStarts(page)).toBe(1);

    // 無効にすると、元の（束ねない）図に戻る。
    await toggle(page).uncheck();
    await expect(bands(page)).toHaveCount(0);
    await expect(edges).toHaveCount(plainEdges);
  });

  test('FR-VG-13: 強さを変えただけでは計算せず、「束ね直す」で計算する', async ({ page }) => {
    await countBundlingWorkers(page);
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await toggle(page).check();
    await expect(bands(page).first()).toBeVisible();
    await openGraphSection(page, /束ねる/);
    await page.getByLabel('束ねる強さ', { exact: true }).fill('0.3');
    await expect(page.getByText(/強さを変えました/)).toBeVisible();
    expect(await workerStarts(page)).toBe(1);
    await page.getByRole('button', { name: '束ね直す', exact: true }).click();
    await expect.poll(() => workerStarts(page)).toBe(2);
    await expect(page.getByText(/強さを変えました/)).toBeHidden();
    await expect(bands(page).first()).toBeVisible();
  });

  test('FR-VG-13: 配置を変える（座標が変わる）と計算し直し、束ねた図を描き直す', async ({
    page,
  }) => {
    await countBundlingWorkers(page);
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await toggle(page).check();
    await expect(bands(page).first()).toBeVisible();
    expect(await workerStarts(page)).toBe(1);
    await openGraphSection(page, /配置/);
    await page.getByLabel('配置方法', { exact: true }).selectOption('circular');
    await expect.poll(() => workerStarts(page)).toBe(2);
    await expect(bands(page).first()).toBeVisible();
  });

  test('FR-VG-13: 選択した関係の強調線が束ねた図にも出る', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await toggle(page).check();
    await expect(bands(page).first()).toBeVisible();
    const first = page.locator('.graph-canvas #graph-view-nodes > [data-id]').first();
    const id = await first.getAttribute('data-id');
    await page.getByLabel('ノードを検索', { exact: true }).fill(id ?? '');
    await page.locator('.graph-search-results [role="option"]').first().click();
    await expect(
      page.locator('.graph-canvas [data-bundle-role="highlight"]').first(),
    ).toBeVisible();
  });

  test('FR-VG-13/14: 束ねる設定を保存して開き直すと戻り、SVG の書き出しに帯と凡例の見本が入る', async ({
    page,
    browser,
    baseURL,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await toggle(page).check();
    await expect(bands(page).first()).toBeVisible();

    const svgDownload = page.waitForEvent('download');
    await saveSvgFile(page);
    const svg = readFileSync(await (await svgDownload).path(), 'utf8');
    expect(svg).toContain('id="bundles"');
    expect(svg).toMatch(/<polygon id="bundle-\d+"/);
    expect(svg).toContain('束の太さ');

    const projectDownload = page.waitForEvent('download');
    await saveProjectFile(page);
    const download = await projectDownload;
    const text = readFileSync(await download.path(), 'utf8');
    const saved = JSON.parse(text) as { view: { graph?: { bundling?: { enabled: boolean } } } };
    expect(saved.view.graph?.bundling?.enabled).toBe(true);

    const context = await browser.newContext({ baseURL: baseURL ?? '', locale: 'ja-JP' });
    try {
      const page2 = await context.newPage();
      await startApp(page2);
      await openProject(page2, {
        name: download.suggestedFilename(),
        mimeType: 'application/json',
        buffer: Buffer.from(text, 'utf8'),
      });
      await expect(toggle(page2)).toBeChecked();
      await expect(bands(page2).first()).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('FR-VG-13: 既定のまま（束ねない）なら、保存したファイルに bundling を書かない', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]').first()).toBeVisible();
    const projectDownload = page.waitForEvent('download');
    await saveProjectFile(page);
    const text = readFileSync(await (await projectDownload).path(), 'utf8');
    const saved = JSON.parse(text) as { view: { graph?: Record<string, unknown> } };
    expect(saved.view.graph).toBeDefined();
    expect(saved.view.graph).not.toHaveProperty('bundling');
  });

  test('FR-VG-13: 表示中のエッジが 5,000 本を超えると確認が出て、「取り消す」で計算せずに中止の文言が出る', async ({
    page,
  }) => {
    await countBundlingWorkers(page);
    await startApp(page);
    // 5,001 本のエッジを持つプロジェクトを、見本のファイルから作る。
    // 【なぜ】グラフは同じ向きの同じ組を 1 本にまとめるので、異なる組を 5,001 通り作る（120 ノード）。
    const base = JSON.parse(readFileSync(fixturePath('maghrib.relata.json'), 'utf8')) as {
      dataset: { nodes: unknown[]; edges: unknown[] };
    };
    const count = 120;
    base.dataset.nodes = Array.from({ length: count }, (_, i) => ({
      id: 'n' + String(i),
      type: 'type-1',
      label: 'N' + String(i),
      attrs: {},
    }));
    const edges: unknown[] = [];
    for (let a = 0; a < count && edges.length < 5001; a++)
      for (let b = 0; b < count && edges.length < 5001; b++)
        if (a !== b)
          edges.push({
            id: 'e' + String(edges.length),
            source: 'n' + String(a),
            target: 'n' + String(b),
            directed: true,
            weight: 1,
            attrs: {},
          });
    base.dataset.edges = edges;
    await openProject(page, {
      name: 'big.relata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(base), 'utf8'),
    });
    await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]').first()).toBeVisible();
    await toggle(page).check();
    const confirm = page.getByRole('alert').filter({ hasText: /5,001/ });
    await expect(confirm).toContainText('5,000');
    expect(await workerStarts(page)).toBe(0);
    await confirm.getByRole('button', { name: '取り消す', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '束ねるのを中止しました' }),
    ).toBeVisible();
    expect(await workerStarts(page)).toBe(0);
    await expect(bands(page)).toHaveCount(0);
  });
});
