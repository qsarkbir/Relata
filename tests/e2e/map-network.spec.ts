/** 地図のネットワーク表示と表・グラフとの連動。簡易背景を使い、外部へ通信しない。 */
/// <reference lib="dom" />
import { expect, test, type Page } from './fixtures';
import { readFileSync } from 'node:fs';
import { facetValue, openAttr, openProject, saveProjectFile, startApp } from './support';

test.use({ locale: 'en-US' });

const arabic = 'ابن عسكر (2026)';
const zoom = 4;
const lon = 4;
const horizontalDelta = (512 * 2 ** zoom * lon) / 360;
const mapTab = (page: Page) => page.getByRole('tab', { name: 'Map', exact: true });
const graphTab = (page: Page) => page.getByRole('tab', { name: 'Graph', exact: true });
const mapFrame = (page: Page) => page.locator('.map-engine');
const clear = (page: Page) => page.getByRole('button', { name: 'Clear selection' });
const row = (page: Page, id: string) => page.locator(`tbody tr[data-id="${id}"]`);
const bundleToggle = (page: Page) => page.getByRole('checkbox', { name: 'Bundle edges' });

function project(variant: 'default' | 'details' | 'missing' = 'default') {
  const missing = variant === 'missing';
  const detail = variant === 'details';
  const nodes = [
    { id: 'west', label: arabic, lat: 0, lon: -lon },
    { id: 'east', label: 'East', lat: 0, lon },
    { id: 'southwest', label: 'Southwest', lat: -1.2, lon: -lon },
    { id: 'southeast', label: 'Southeast', lat: -1.2, lon },
    ...(detail ? [{ id: 'unlocated', label: 'Unlocated', lat: null, lon: 0 }] : []),
  ].map(({ id, label, lat, lon: nodeLon }) => ({
    id,
    label,
    type: 'place',
    attrs: missing && id !== 'west' ? { size: { kind: 'value', value: 10 } } : {},
    ...(lat === null ? {} : { geo: { kind: 'point', lat, lon: nodeLon } }),
  }));
  const edges = [
    { id: 'e1', source: 'west', target: 'east', weight: 3 },
    { id: 'e2', source: 'southwest', target: 'southeast', weight: 1 },
    ...(detail
      ? [
          { id: 'e3', source: 'west', target: 'east', weight: 2, relation: 'Second reading' },
          { id: 'e4', source: 'west', target: 'unlocated', weight: 2 },
        ]
      : []),
  ].map((edge) => ({
    ...edge,
    directed: true,
    attrs: detail
      ? { record: { kind: 'value', value: edge.id === 'e4' ? 'Unlocated' : 'Located' } }
      : missing && edge.id === 'e2'
        ? { measured: { kind: 'value', value: 1 } }
        : {},
  }));
  return {
    name: 'map-network.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'Relata',
        formatVersion: 3,
        savedAt: '2026-11-27T00:00:00.000Z',
        dataset: {
          graphMode: 'directed',
          nodeTypes: [{ id: 'place', label: 'Place' }],
          nodes,
          edges,
          schema: [
            ...(detail
              ? [
                  {
                    key: 'record',
                    label: 'Document kind',
                    appliesTo: 'edge',
                    valueType: 'category',
                  },
                ]
              : []),
            ...(missing
              ? [
                  { key: 'size', label: 'Size', appliesTo: 'node', valueType: 'number' },
                  {
                    key: 'measured',
                    label: 'Measured weight',
                    appliesTo: 'edge',
                    valueType: 'number',
                  },
                ]
              : []),
          ],
          meta: { title: 'Map network' },
        },
        view: {
          workspace: { mainView: 'graph', tab: 'table', open: true, height: 250 },
          ...(missing ? { graph: { graphOptions: { weight: { attr: 'measured' } } } } : {}),
          map: {
            background: 'simple',
            viewport: { lon: 0, lat: 0, zoom },
            ...(missing
              ? {
                  encoding: {
                    nodeSize: { source: { kind: 'attr', attr: 'size' }, min: 10, max: 10 },
                    edgeWidth: { min: 3, max: 3 },
                  },
                }
              : {}),
          },
        },
      }),
    ),
  };
}

async function clickMap(page: Page, dx: number, dy = 0): Promise<void> {
  const area = await mapFrame(page).boundingBox();
  if (area === null) throw new Error('No map bounds');
  await page.mouse.click(area.x + area.width / 2 + dx, area.y + area.height / 2 + dy);
}

async function mapPixels(page: Page, points: readonly [number, number][]): Promise<number[][]> {
  const png = await mapFrame(page).screenshot({ scale: 'css' });
  return page.evaluate(
    async ({ data, offsets }) => {
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) throw new Error('No 2D context');
      ctx.drawImage(image, 0, 0);
      image.close();
      return offsets.map(([x, y]) => {
        const point = ctx.getImageData(
          Math.round(canvas.width / 2 + x),
          Math.round(canvas.height / 2 + y),
          1,
          1,
        );
        return Array.from(point.data.slice(0, 3));
      });
    },
    { data: png.toString('base64'), offsets: points },
  );
}

test('FR-MP-02・FR-TB-02・NFR-09・NFR-02: 地図と表で点とエッジを選び、右書きのラベルを表示する', async ({
  page,
}) => {
  const external: string[] = [];
  const mapRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.hostname !== 'localhost' && url.protocol.startsWith('http')) external.push(url.href);
    if (/\/map-[^/]+\.js$/u.test(url.pathname)) mapRequests.push(url.href);
  });
  await startApp(page);
  await openProject(page, project());
  expect(mapRequests).toEqual([]);
  await mapTab(page).click();
  const label = page.locator('.relata-map-labels text[data-node-id="west"]');
  await expect(mapFrame(page).locator('canvas')).toHaveCount(2);
  await expect(label).toHaveCount(0);
  await expect
    .poll(async () => {
      const [point, outsidePoint, line, outsideLine] = await mapPixels(page, [
        [-horizontalDelta, 0],
        [-horizontalDelta, -9],
        [0, 0],
        [0, -9],
      ]);
      return [
        JSON.stringify(point) !== JSON.stringify(outsidePoint),
        JSON.stringify(line) !== JSON.stringify(outsideLine),
      ];
    })
    .toEqual([true, true]);
  await row(page, 'west').locator('td').nth(1).click();
  await expect(label).toHaveText(arabic);
  await expect(label).toHaveAttribute('direction', 'rtl');
  await expect(label).toHaveAttribute('unicode-bidi', 'embed');
  await expect(label).toHaveAttribute('text-anchor', 'start');
  expect(
    await label.evaluate((el) => (el instanceof SVGTextElement ? el.getComputedTextLength() : 0)),
  ).toBeGreaterThan(0);

  await clear(page).click();
  await expect(label).toHaveCount(0);
  // SVG のラベルではなく、投影した点の中心をクリックする（WebGL の描画と位置を同時に検査）。
  await clickMap(page, -horizontalDelta);
  await expect(row(page, 'west')).toHaveAttribute('data-selected', 'true');
  await expect(label).toHaveText(arabic);
  await page.getByRole('button', { name: 'Edge table', exact: true }).click();
  const [before] = await mapPixels(page, [[0, 0]]);
  await clickMap(page, 0);
  await expect(row(page, 'e1')).toHaveAttribute('data-selected', 'true');
  await expect(label).toHaveCount(0);
  await row(page, 'e2').locator('td').nth(1).click();
  await expect(row(page, 'e2')).toHaveAttribute('data-selected', 'true');
  await expect.poll(async () => (await mapPixels(page, [[0, 0]]))[0]).not.toEqual(before);

  await graphTab(page).click();
  await expect(page.getByRole('region', { name: 'Selected edges' })).toBeVisible();
  await mapTab(page).click();
  await expect(row(page, 'e2')).toHaveAttribute('data-selected', 'true');
  expect(mapRequests).toHaveLength(1);
  expect(external).toEqual([]);
});

test('FR-TB-02: 地図の選択カードは集約前の関係と、座標なし・絞り込みの違いを示す', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, project('details'));
  await mapTab(page).click();
  await expect(mapFrame(page).locator('canvas')).toHaveCount(2);
  const card = page.getByRole('region', { name: 'Selected node details' });
  await clickMap(page, 0);
  await expect(card.getByText('2 original edges', { exact: false })).toBeVisible();
  await card.locator('summary').filter({ hasText: 'Original edge records' }).click();
  await expect(card.getByText('Second reading', { exact: true })).toBeVisible();
  await expect(card.getByText('e1', { exact: true })).toBeVisible();
  await expect(card.getByText('e3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edge table', exact: true }).click();
  await expect(row(page, 'e1')).toHaveAttribute('data-selected', 'true');
  await expect(row(page, 'e3')).toHaveAttribute('data-selected', 'true');
  await row(page, 'e4').locator('td').nth(1).click();
  await expect(card).toContainText('An endpoint of the selected edge has no usable coordinates.');
  const documentKind = await openAttr(page, 'Document kind');
  await facetValue(documentKind, 'Located').check();
  await expect(card).toContainText('The selected edge is excluded by the current filters.');
  await expect(card.getByText('e4', { exact: true })).toBeVisible();
  await expect(card).not.toContainText('has no usable coordinates');
  await card.getByRole('button', { name: 'Collapse the selection card' }).click();
  await expect(card.getByText('e4', { exact: true })).toBeHidden();
  await card.getByRole('button', { name: 'Expand the selection card' }).press('Escape');
  await expect(card).toHaveCount(0);
});

test('FR-VG-12・FR-MP-02: 欠損値の輪郭とエッジの破線が WebGL の画素に出る', async ({ page }) => {
  await startApp(page);
  await openProject(page, project('missing'));
  await mapTab(page).click();
  await expect(mapFrame(page).locator('canvas')).toHaveCount(2);
  const xs = Array.from({ length: 35 }, (_, index) => index - 55);
  const solidY = (512 * 2 ** zoom * Math.atanh(Math.sin((1.2 * Math.PI) / 180))) / (2 * Math.PI);
  const ring = (center: number): [number, number][] =>
    Array.from({ length: 36 }, (_, index) => {
      const angle = (index * Math.PI) / 18;
      return [center + 10 * Math.cos(angle), 10 * Math.sin(angle)];
    });
  await expect
    .poll(async () => {
      const pixels = await mapPixels(page, [
        ...xs.map((x): [number, number] => [x, 0]),
        ...xs.map((x): [number, number] => [x, solidY]),
        ...ring(-horizontalDelta),
        ...ring(horizontalDelta),
        [-horizontalDelta, 0],
      ]);
      const colors = (from: number, count: number) =>
        new Set(pixels.slice(from, from + count).map((pixel) => pixel.join(','))).size;
      // 破線のすき間から、同じ点の中心と同じ塗りの色が見える。地図の背景や輪郭の色とは別に数える。
      const fill = pixels.at(-1)?.join(',');
      const gaps = (from: number) =>
        pixels.slice(from, from + 36).filter((pixel) => pixel.join(',') === fill).length;
      return [
        colors(0, xs.length) > colors(xs.length, xs.length),
        gaps(2 * xs.length) - gaps(2 * xs.length + 36) >= 5,
      ];
    })
    .toEqual([true, true]);
});

test('FR-VG-13/14: 地図の束ねる計算はグラフ、ズームと別で、反復回数と ε は明示的に反映する', async ({
  page,
}) => {
  const workers: string[] = [];
  page.on('worker', (worker) => {
    if (worker.url().includes('bundling')) workers.push(worker.url());
  });
  await startApp(page);
  await openProject(page, project());
  await bundleToggle(page).check();
  const ready = page.getByRole('status').filter({ hasText: /^Bundled 2 edges\.$/u });
  await expect(ready).toBeVisible();
  expect(workers).toHaveLength(1);
  await mapTab(page).click();
  await expect(bundleToggle(page)).not.toBeChecked();
  await bundleToggle(page).check();
  await expect(ready).toBeVisible();
  expect(workers).toHaveLength(2);
  await page.getByRole('button', { name: 'Zoom the map in' }).click();
  await expect
    .poll(async () => {
      const [point, outsidePoint] = await mapPixels(page, [
        [-horizontalDelta * 2, 0],
        [-horizontalDelta * 2, -9],
      ]);
      return JSON.stringify(point) !== JSON.stringify(outsidePoint);
    })
    .toBe(true);
  await page.getByRole('button', { name: 'Display settings', exact: true }).click();
  const drawer = page.getByRole('complementary', { name: 'Map display settings' });
  const bundleSection = drawer.locator('summary').filter({ hasText: /^Edge bundling$/u });
  await bundleSection.click();
  await drawer.getByLabel('Drawing style', { exact: true }).selectOption('overlay');
  await drawer.getByLabel('Initial iterations', { exact: true }).fill('80');
  await drawer.getByLabel(/Bundle distance ε/).fill('2.5');
  await expect(drawer.getByText(/changed settings/)).toBeVisible();
  expect(workers).toHaveLength(2);
  await drawer.getByRole('button', { name: 'Bundle again', exact: true }).click();
  await expect(ready).toBeVisible();
  await expect(drawer.getByText(/changed settings/)).toHaveCount(0);
  expect(workers).toHaveLength(3);
  await graphTab(page).click();
  await expect(ready).toBeVisible();
  await expect(bundleToggle(page)).toBeChecked();
  await mapTab(page).click();
  await expect(ready).toBeVisible();
  expect(workers).toHaveLength(3);

  const downloadEvent = page.waitForEvent('download');
  await saveProjectFile(page);
  const download = await downloadEvent;
  const saved = readFileSync(await download.path());
  await openProject(page, {
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: saved,
  });
  await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true');
  await expect(bundleToggle(page)).toBeChecked();
  const settings = page.getByRole('button', { name: 'Display settings', exact: true });
  if ((await settings.getAttribute('aria-expanded')) !== 'true') await settings.click();
  if (!(await bundleSection.evaluate((summary) => summary.parentElement?.hasAttribute('open'))))
    await bundleSection.click();
  await expect(drawer.getByLabel('Initial iterations', { exact: true })).toHaveValue('80');
  await expect(drawer.getByLabel(/Bundle distance ε/)).toHaveValue('2.5');
  await expect(drawer.getByLabel('Drawing style', { exact: true })).toHaveValue('overlay');
});
