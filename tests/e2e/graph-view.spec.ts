import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  startApp,
  openProject,
  readAutosave,
  waitForAutosave,
  saveProjectFile,
  saveSvgFile,
} from './support';

test.use({ locale: 'ja-JP' });

test('FR-VG-09/11: Workerで表示し検索・選択・向きの強調と拡大・SVG保存を操作できる', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
  await expect(nodes).toHaveCount(14);
  const figure = page.getByRole('img', { name: 'ネットワーク図' });
  const initial = await figure.getAttribute('data-zoom');
  await page.getByRole('button', { name: '拡大', exact: true }).click();
  await expect(figure).not.toHaveAttribute('data-zoom', initial ?? '');
  await page.getByLabel('ノードを検索', { exact: true }).fill('ابن');
  await expect(page.locator('.graph-search-results button').first()).toBeVisible();
  await page.locator('.graph-search-results button').first().click();
  await expect(page.getByRole('region', { name: '選択したノードの詳細' })).toBeVisible();
  await page.getByLabel('関係の強調', { exact: true }).selectOption('out');
  await page.getByRole('button', { name: '位置を固定', exact: true }).click();
  await expect(page.getByRole('button', { name: '固定を解除', exact: true })).toBeVisible();
  await page.getByLabel('ラベル', { exact: true }).selectOption('selected');
  const selectedLabel = await page
    .locator('.graph-canvas #graph-view-labels text')
    .allTextContents();
  expect(selectedLabel.length).toBeGreaterThan(0);
  const download = page.waitForEvent('download');
  await saveSvgFile(page);
  const file = await download;
  const path = await file.path();
  const svg = readFileSync(path, 'utf8');
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg).not.toContain('class="selected"');
  for (const label of selectedLabel) expect(svg).toContain(label);
});

/**
 * ノードが図の枠のどこに描かれているか（外接矩形の中心）を返す。
 *
 * 【なぜ】transform の文字列は、ラベルの有無などで図の範囲が変わると、補正のために値が変わる。
 * 利用者に見える位置そのものを比べる。
 * @param page - ページ
 * @param id - ノードの ID
 * @returns 枠の左上を原点とする中心
 */
async function nodeCenter(page: Page, id: string): Promise<{ x: number; y: number }> {
  const box = await page
    .locator(`.graph-canvas #graph-view-nodes > [data-id="${id}"]`)
    .boundingBox();
  const frame = await page.getByRole('img', { name: 'ネットワーク図' }).boundingBox();
  if (box === null || frame === null) throw new Error('node box');
  // 【なぜ】周りのパネルの幅で図の枠ごと動くことがあるので、枠の左上からの位置で比べる。
  return { x: box.x + box.width / 2 - frame.x, y: box.y + box.height / 2 - frame.y };
}

test('FR-PJ-01/02 / NFR-08: 配置・固定点・拡大と表示設定をファイルと自動保存から復元する', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(14);
  await page.getByLabel('ノードを選択', { exact: true }).selectOption('p6');
  await page.getByRole('button', { name: '位置を固定', exact: true }).click();
  await page.getByLabel('向きの表現').selectOption('gradient');
  await page.getByLabel('ラベル', { exact: true }).selectOption('selected');
  await page.getByRole('button', { name: '拡大', exact: true }).click();
  const zoom = await page.getByRole('img', { name: 'ネットワーク図' }).getAttribute('data-zoom');
  const center = await nodeCenter(page, 'p1');
  const download = page.waitForEvent('download');
  await saveProjectFile(page);
  const file = await download;
  const path = await file.path();
  const text = readFileSync(path, 'utf8');
  expect(text).toContain('"fixed":true');
  expect(text).toContain('"graphOptions"');
  await waitForAutosave(page);
  await expect.poll(() => readAutosave(page)).toContain('"direction":"gradient"');
  await page.reload();
  await expect(page.getByLabel('向きの表現')).toHaveValue('gradient');
  await expect(page.getByRole('img', { name: 'ネットワーク図' })).toHaveAttribute(
    'data-zoom',
    zoom ?? '',
  );
  await expect.poll(async () => (await nodeCenter(page, 'p1')).x).toBeCloseTo(center.x, 1);
  await expect.poll(async () => (await nodeCenter(page, 'p1')).y).toBeCloseTo(center.y, 1);
  await openProject(page, {
    name: 'saved.json',
    mimeType: 'application/json',
    buffer: Buffer.from(text),
  });
  await expect(page.getByLabel('ラベル', { exact: true })).toHaveValue('selected');
  await expect(page.getByRole('img', { name: 'ネットワーク図' })).toHaveAttribute(
    'data-zoom',
    zoom ?? '',
  );
  await expect.poll(async () => (await nodeCenter(page, 'p1')).x).toBeCloseTo(center.x, 1);
  await expect.poll(async () => (await nodeCenter(page, 'p1')).y).toBeCloseTo(center.y, 1);
});

test('FR-VG-11 / NFR-08: ドラッグした位置を固定し、ファイルと再配置で保つ', async ({ page }) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
  await expect(nodes).toHaveCount(14);
  const node = nodes.first();
  const id = await node.getAttribute('data-id');
  if (id === null) throw new Error('node');
  const saveGraph = async () => {
    const download = page.waitForEvent('download');
    await saveProjectFile(page);
    const path = await (await download).path();
    const text = readFileSync(path, 'utf8');
    // 【なぜ】アプリ自身が保存したJSONから、このテストが比較する項目だけを読む。
    const saved = JSON.parse(text) as {
      view: { graph: { positions: { id: string; x: number; y: number; fixed: boolean }[] } };
    };
    const position = saved.view.graph.positions.find((p) => p.id === id);
    if (position === undefined) throw new Error('saved position');
    return { text, position };
  };
  const initial = await saveGraph();
  // 【なぜ】設定欄が増えても、画面外の座標へmouse操作を送らない。
  await node.scrollIntoViewIfNeeded();
  const box = await node.boundingBox();
  if (box === null) throw new Error('box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 35, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await page.getByLabel('ノードを選択', { exact: true }).selectOption(id);
  await expect(page.getByRole('button', { name: '固定を解除', exact: true })).toBeVisible();
  const before = await saveGraph();
  expect(before.position.fixed).toBe(true);
  expect(
    Math.abs(before.position.x - initial.position.x) +
      Math.abs(before.position.y - initial.position.y),
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: '再配置する', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'ノードを表示' })).toBeVisible();
  const after = await saveGraph();
  // 【なぜ】画面のスクロール量ではなく、保存されるworld座標と固定フラグを比較する。
  expect(after.position).toEqual(before.position);
  await openProject(page, {
    name: 'dragged.json',
    mimeType: 'application/json',
    buffer: Buffer.from(after.text),
  });
  await expect(page.locator('.task-panel')).toBeHidden();
  await page.getByLabel('ノードを選択', { exact: true }).selectOption(id);
  await expect(page.getByRole('button', { name: '固定を解除', exact: true })).toBeVisible();
});

test('FR-VG-03/04/08/09: 次数サイズ・属性色・型形・スケールとpxを選び、入出を異色で描いて保存する', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(14);
  await page.getByText('見た目の設定', { exact: true }).click();
  await page.getByLabel('ノードサイズの元', { exact: true }).selectOption('metric:degree');
  await page.getByLabel('サイズのスケール', { exact: true }).selectOption('log');
  await page.getByLabel('ノード最小半径', { exact: true }).fill('5');
  await page.getByLabel('ノード最大半径', { exact: true }).fill('20');
  await page.getByLabel('ノード色の元', { exact: true }).selectOption('attr:地名');
  await page.getByLabel('ノード形の元', { exact: true }).selectOption('nodeType');
  await page.getByLabel('線幅のスケール', { exact: true }).selectOption('linear');
  await page.getByLabel('エッジ最小幅', { exact: true }).fill('0.5');
  await page.getByLabel('エッジ最大幅', { exact: true }).fill('5');
  await page.getByLabel('ノードを選択', { exact: true }).selectOption('p6');
  const edges = page.locator('.graph-canvas #graph-view-edges');
  await expect(edges.locator('[stroke="#d55e00"]')).not.toHaveCount(0);
  await expect(edges.locator('[stroke="#0072b2"]')).not.toHaveCount(0);
  await expect(edges.locator('[stroke="#7b3294"]')).not.toHaveCount(0);
  const download = page.waitForEvent('download');
  await saveProjectFile(page);
  const path = await (await download).path();
  const saved = readFileSync(path, 'utf8');
  expect(saved).toContain('"metric":"degree"');
  expect(saved).toContain('"attr":"地名"');
  expect(saved).toContain('"scale":"log"');
  await openProject(page, {
    name: 'appearance.json',
    mimeType: 'application/json',
    buffer: Buffer.from(saved),
  });
  await expect(page.locator('.task-panel')).toBeHidden();
  await expect(page.getByLabel('ノードサイズの元', { exact: true })).toHaveValue('metric:degree');
  await expect(page.getByLabel('ノード最大半径', { exact: true })).toHaveValue('20');
  await page.getByLabel('ノード最小半径', { exact: true }).fill('30');
  await expect(page.getByRole('alert').filter({ hasText: '最小を最大以下' })).toBeVisible();
});

test('FR-VG-11: 再配置の応答待ち中でも固定・解除を失わず、進行表示を残さない', async ({ page }) => {
  // 【なぜ】Worker要求を明示的に保留する。計算速度に依存せず、固定操作との競合を再現する。
  await page.addInitScript(`
    const NativeWorker = window.Worker;
    let hold = false;
    let pending = [];
    window.addEventListener('relata-test-hold-layout', () => { hold = true; });
    window.addEventListener('relata-test-release-layout', () => {
      hold = false;
      const calls = pending;
      pending = [];
      calls.forEach(call => call());
    });
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const send = this.postMessage.bind(this);
        this.postMessage = (...message) => {
          if (hold) pending.push(() => send(...message));
          else send(...message);
        };
      }
    };
  `);
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(14);
  await page.getByLabel('ノードを選択', { exact: true }).selectOption('p6');
  for (const fixed of [true, false]) {
    await page.evaluate(() => window.dispatchEvent(new Event('relata-test-hold-layout')));
    await page.getByRole('button', { name: '再配置する', exact: true }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '配置を計算しています' }),
    ).toBeVisible();
    await page
      .getByRole('button', {
        name: fixed ? '位置を固定' : '固定を解除',
        exact: true,
      })
      .click();
    await page.evaluate(() => window.dispatchEvent(new Event('relata-test-release-layout')));
    await expect(page.locator('.task-panel')).toBeHidden();
    await expect(
      page.getByRole('button', {
        name: fixed ? '固定を解除' : '位置を固定',
        exact: true,
      }),
    ).toBeVisible();
    const download = page.waitForEvent('download');
    await saveProjectFile(page);
    const path = await (await download).path();
    const saved: unknown = JSON.parse(readFileSync(path, 'utf8'));
    expect(saved).toMatchObject({
      view: {
        graph: {
          positions: expect.arrayContaining([expect.objectContaining({ id: 'p6', fixed })]),
        },
      },
    });
  }
});

test('FR-VG-11: ホイールで拡大してもページはスクロールしない', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const figure = page.getByRole('img', { name: 'ネットワーク図' });
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(14);
  await figure.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  const zoom = await figure.getAttribute('data-zoom');
  const box = await figure.boundingBox();
  if (box === null) throw new Error('figure box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await expect(figure).not.toHaveAttribute('data-zoom', zoom ?? '');
  // 【なぜ】React の onWheel は passive なので、以前は拡大と同時にページもスクロールしていた。
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
});

test('FR-VG-11: 図の枠の高さを変えると描画範囲が追従し、設定を折りたためる', async ({ page }) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const figure = page.getByRole('img', { name: 'ネットワーク図' });
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(14);
  // 利用者が右下のつまみで高さを変えた状態を、スタイルの変更で作る。
  await page.locator('.graph-canvas').evaluate((element) => {
    if (element instanceof HTMLElement) element.style.height = '640px';
  });
  await expect(figure).toHaveAttribute('viewBox', /^0 0 \d+ 64\d$/u);
  const settings = page.locator('details.graph-settings');
  await expect(settings).toHaveAttribute('open', '');
  await settings.locator('> summary').click();
  await expect(page.getByRole('button', { name: '全体を表示', exact: true })).toBeHidden();
  await expect(figure).toBeVisible();
});

test('FR-VG-11: 位置の欠けたノードの計算中に固定を切り替えても、操作の後に計算をやり直す', async ({
  page,
}) => {
  // 【なぜ】Worker 要求を保留し、計算中に固定の操作が割り込む状況を、速度に依存せず作る。
  await page.addInitScript(`
    const NativeWorker = window.Worker;
    let hold = false;
    let pending = [];
    window.addEventListener('relata-test-hold-layout', () => { hold = true; });
    window.addEventListener('relata-test-release-layout', () => {
      hold = false;
      const calls = pending;
      pending = [];
      calls.forEach(call => call());
    });
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        const send = this.postMessage.bind(this);
        this.postMessage = (...message) => {
          if (hold) pending.push(() => send(...message));
          else send(...message);
        };
      }
    };
  `);
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
  await expect(nodes).toHaveCount(14);
  // 準備: 配置を保存し、p1 の位置だけを消したファイルを作る。
  const download = page.waitForEvent('download');
  await saveProjectFile(page);
  const saved = JSON.parse(readFileSync(await (await download).path(), 'utf8')) as {
    view: { graph: { positions: { id: string }[] } };
  };
  saved.view.graph.positions = saved.view.graph.positions.filter((p) => p.id !== 'p1');
  // 操作: 計算を保留した状態で開くと、p1 の位置を求める計算が始まる。
  await page.evaluate(() => window.dispatchEvent(new Event('relata-test-hold-layout')));
  await openProject(page, {
    name: 'partial.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  await expect(nodes).toHaveCount(13);
  await expect(page.getByRole('status').filter({ hasText: '配置を計算しています' })).toBeVisible();
  // 操作: 計算中に p6 の固定を切り替える（計算は中止される）。
  await page.getByLabel('ノードを選択', { exact: true }).selectOption('p6');
  await page.getByRole('button', { name: /^(位置を固定|固定を解除)$/ }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('relata-test-release-layout')));
  // 期待: 操作の後に計算をやり直し、p1 にも位置が付いて 14 個すべてが描かれる。
  await expect(nodes).toHaveCount(14);
  await expect(page.locator('.task-panel')).toBeHidden();
});
