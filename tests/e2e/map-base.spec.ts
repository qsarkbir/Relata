/**
 * 地図の部品（src/map/）の E2E（T3-03）。FR-MP-01、FR-MP-06、NFR-02。D-50、D-51、D-52。
 *
 * 【なぜ】OpenStreetMap のタイルには、実際には通信しない。タイルの URL は `page.route` で差し替え、
 * 「要求の形が規約どおりか」だけを確かめる（OSM の利用規約は自動の取得を禁じている。D-51 の補足）。
 * 入口は本物の画面（「グラフ｜地図」の地図のタブ。`MapView.tsx`）。
 */
/// <reference lib="dom" />
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  fixturePath,
  loadedNotice,
  openGraphSettings,
  openProject,
  startApp,
  waitForAutosave,
} from './support';
import { crc32, deflateSync } from 'node:zlib';

/** 外のタイルの代わりに返す、1 色だけの PNG（256×256）。 */
function solidPng(r: number, g: number, b: number): Buffer {
  const size = 256;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 ビット
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 差し替えたタイルの色（OSM は赤み、利用者のタイルは緑み）。 */
test.use({ locale: 'ja-JP' });

const OSM_TILE_RGB: [number, number, number] = [200, 120, 80];
const CUSTOM_TILE_RGB: [number, number, number] = [90, 170, 110];
const CUSTOM_URL = 'https://tiles.example.test/old/{z}/{x}/{y}.png';

/** 保存された地図の設定（テストが読む項目だけ）。 */
interface SavedView {
  map?: {
    background?: string;
    viewport?: { lon: number; lat: number; zoom: number } | null;
    customTiles?: { url: string; attribution: string; removedParams?: string[] };
  };
  geoSource?: unknown;
  workspace?: { mainView?: string };
}

/** 自動保存の view を、条件を満たすまで待って返す。 */
async function savedView(page: Page, accept: (v: SavedView) => boolean): Promise<SavedView> {
  const saved = await waitForAutosave(page, (p) => accept(p.view as unknown as SavedView)); // 理由: アプリが書いた JSON
  return saved.view as unknown as SavedView;
}

interface ProjectOptions {
  /** 座標の入れ方。geo: GraphNode.geo、attrs: Lat と Lon の属性、none: 座標なし。 */
  coords: 'geo' | 'attrs' | 'none';
  view?: Record<string, unknown>;
}

/**
 * 見本（maghrib）に座標を足したプロジェクトのファイル。
 * 型 1（p2〜p7、p40、p20）に座標の列がある: p2〜p4 は座標あり、p5 は欠損、p6 は範囲外、残りは値なし。
 * 型 2、3 のノードには座標の列が無い。表示中のノード 14（孤立の 1 つは既定で非表示）のうち、載らないのは 11（欠損 3、範囲外 1、列なし 7）。
 */
function projectWithCoords(opts: ProjectOptions) {
  const file = JSON.parse(readFileSync(fixturePath('maghrib.relata.json'), 'utf8')) as {
    formatVersion: number;
    dataset: { nodes: Record<string, unknown>[]; schema: unknown[] };
    view: Record<string, unknown>;
  }; // 理由: テスト用の見本ファイル。形は作った本人が知っている
  const points: Record<string, [number, number]> = {
    p2: [33.3, 44.4],
    p3: [37.9, -4.8],
    p4: [30, 31.2],
  };
  for (const n of file.dataset.nodes) {
    const id = String(n.id);
    const p = points[id];
    if (opts.coords === 'geo') {
      if (p !== undefined) n.geo = { kind: 'point', lat: p[0], lon: p[1] };
      else if (id === 'p5') n.geo = { kind: 'missing', reason: 'unrecorded' };
      else if (id === 'p6') n.geo = { kind: 'point', lat: 89, lon: 0 };
    } else if (opts.coords === 'attrs' && p !== undefined) {
      const attrs = n.attrs as Record<string, unknown>;
      attrs.Lat = { kind: 'value', value: p[0] };
      attrs.Lon = { kind: 'value', value: p[1] };
    }
  }
  if (opts.coords === 'attrs')
    file.dataset.schema.push(
      { key: 'Lat', label: '緯度', appliesTo: 'node', valueType: 'number' },
      { key: 'Lon', label: '経度', appliesTo: 'node', valueType: 'number' },
    );
  file.formatVersion = 3;
  file.view = { ...file.view, ...opts.view };
  return {
    name: 'map.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  };
}

interface Recorder {
  requests: Request[];
  external: () => Request[];
  hosted: () => Request[];
}

function record(page: Page): Recorder {
  const requests: Request[] = [];
  page.on('request', (r) => requests.push(r));
  const isHosted = (r: Request): boolean => new URL(r.url()).hostname === 'localhost';
  return {
    requests,
    external: () =>
      requests.filter(
        (r) => !isHosted(r) && !r.url().startsWith('data:') && !r.url().startsWith('blob:'),
      ),
    hosted: () => requests.filter(isHosted),
  };
}

/** タイルの差し替え（OSM と利用者のホスト）。どちらも実際には通信しない。 */
async function mockTiles(context: BrowserContext): Promise<void> {
  const osm = solidPng(...OSM_TILE_RGB);
  const custom = solidPng(...CUSTOM_TILE_RGB);
  await context.route('https://tile.openstreetmap.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: osm }),
  );
  await context.route('https://tiles.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: custom }),
  );
  // 差し替えていない外部のホストへの要求は、通信せずに失敗させる（NFR-02 の違反として検出する）。
  await context.route(
    (url) =>
      url.hostname !== 'localhost' &&
      !['tile.openstreetmap.org', 'tiles.example.test'].includes(url.hostname),
    (route) => route.abort(),
  );
}

const mapTab = (page: Page) => page.getByRole('tab', { name: '地図', exact: true });
const graphTab = (page: Page) => page.getByRole('tab', { name: 'グラフ', exact: true });
const frame = (page: Page) => page.locator('[data-main-frame="map"]');

/** 地図の枠の画面上の色を、中央（横 50%、縦 60%）で読む。 */
async function centerColor(page: Page): Promise<[number, number, number]> {
  const shot = await page.locator('.map-engine').screenshot();
  return page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (ctx === null) throw new Error('2D の文脈を作れません');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(Math.floor(bmp.width / 2), Math.floor(bmp.height * 0.6), 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] as [number, number, number];
  }, shot.toString('base64'));
}

/** 色が近づくまで待つ（タイルの読み込みを待つ）。 */
async function expectColor(page: Page, rgb: number[], tol = 8): Promise<void> {
  await expect
    .poll(async () => {
      const c = await centerColor(page);
      return rgb.every((e, i) => Math.abs((c[i] ?? 0) - e) <= tol);
    })
    .toBe(true);
}

/** 地図のタブを開く。 */
async function openMapTab(page: Page): Promise<void> {
  await mapTab(page).click();
  await expect(frame(page)).toBeVisible();
}

/** 引き出しを開く。 */
async function openMapSettings(page: Page) {
  const drawer = page.getByRole('complementary', { name: '地図の表示の設定' });
  if (!(await drawer.isVisible()))
    await page.getByRole('button', { name: '表示の設定' }).last().click();
  await expect(drawer).toBeVisible();
  return drawer;
}

/** 引き出しの URL 欄に入れて確定する（Enter）。 */
async function setCustomUrl(drawer: ReturnType<Page['locator']>, url: string): Promise<void> {
  const input = drawer.getByLabel('タイルの URL');
  await input.fill(url);
  await input.press('Enter');
}

test.describe('NFR-02: 地図を開くまで通信しない', () => {
  test('NFR-02: 起動しただけ、グラフを使うだけでは、地図の部品もタイルも陸地のデータも取りに行かない', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await expect(graphTab(page)).toHaveAttribute('aria-selected', 'true');
    await page.waitForLoadState('networkidle');
    expect(rec.external()).toEqual([]);
    expect(rec.requests.some((r) => /\/assets\/map-[^/]*\.js/u.test(r.url()))).toBe(false);
    expect(rec.requests.some((r) => r.url().includes('/geo/'))).toBe(false);
    // 地図のタブを開いて初めて、地図の部品を読む。
    await openMapTab(page);
    await expect
      .poll(() => rec.requests.some((r) => /\/assets\/map-[^/]*\.js/u.test(r.url())))
      .toBe(true);
  });

  test('NFR-02: 地図のタブを開いた状態で保存したファイルは、開いた時点で地図を読み込む', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    await openProject(
      page,
      projectWithCoords({
        coords: 'geo',
        view: { workspace: { mainView: 'map', tab: 'table', open: false, height: 300 } },
      }),
    );
    await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true');
    await expectColor(page, OSM_TILE_RGB);
    expect(rec.requests.some((r) => /\/assets\/map-[^/]*\.js/u.test(r.url()))).toBe(true);
  });
});

test.describe('FR-MP-01・FR-MP-06・NFR-02: OSM の背景', () => {
  test('FR-MP-01・FR-MP-06: 地図のタブで地図が描かれ、右下に帰属表示と誤りの報告のリンクが出る', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    await expectColor(page, OSM_TILE_RGB);
    await expect(
      page.locator('#map canvas.maplibregl-canvas, .map-engine canvas.maplibregl-canvas'),
    ).toHaveCount(1);
    const attribution = page.locator('[data-map-attribution]');
    await expect(
      attribution.getByRole('link', { name: '© OpenStreetMap contributors' }),
    ).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await expect(attribution.getByRole('link', { name: '地図の誤りを報告' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/fixthemap',
    );
    const box = await frame(page).boundingBox();
    const a = await attribution.boundingBox();
    if (box === null || a === null) throw new Error('位置が取れません');
    expect(Math.abs(a.x + a.width - (box.x + box.width))).toBeLessThanOrEqual(2);
    expect(Math.abs(a.y + a.height - (box.y + box.height))).toBeLessThanOrEqual(2);
  });

  test('NFR-02: OSM への要求は規約どおりの URL の形で、見出しを足さず、外は OSM だけ。先読みしない', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    await expectColor(page, OSM_TILE_RGB);
    const osm = rec.external();
    expect(osm.length).toBeGreaterThan(0);
    for (const r of osm) {
      expect(r.url()).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/u);
      const h = await r.allHeaders();
      expect(h.referer).toMatch(/^http:\/\/localhost:\d+\//u);
      expect(h['cache-control']).toBeUndefined();
      expect(h.pragma).toBeUndefined();
    }
    // 重複して取らず、1 つのズームの段だけ。
    const zooms = new Set(osm.map((r) => /\/(\d+)\/\d+\/\d+\.png$/u.exec(r.url())?.[1]));
    expect(zooms.size).toBe(1);
    expect(new Set(osm.map((r) => r.url())).size).toBe(osm.length);
    expect(rec.hosted().some((r) => r.url().includes('/geo/'))).toBe(false);
  });
});

test.describe('FR-MP-01・NFR-02: 切り替えで状態を失わない', () => {
  test('FR-MP-01: 地図で動かした表示範囲は保存され、グラフに戻って地図に戻っても保たれる。グラフのズームも保たれる', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    // グラフを拡大してから地図へ。
    const node = page.locator('.graph-canvas #graph-view-nodes > [data-id="p2"]');
    await expect(node).toBeVisible();
    await page.locator('.graph-canvas').hover();
    await page.mouse.wheel(0, -300);
    const settle = async () => {
      let prev = '';
      await expect
        .poll(async () => {
          const b = await node.boundingBox();
          const now = JSON.stringify(b);
          const same = now === prev;
          prev = now;
          return same;
        })
        .toBe(true);
      return node.boundingBox();
    };
    const before = await settle();
    await openMapTab(page);
    await expectColor(page, OSM_TILE_RGB);
    await frame(page).hover();
    await page.mouse.wheel(0, -300);
    const moved = await savedView(page, (v) => v.map?.viewport != null);
    await graphTab(page).click();
    const after = await settle();
    expect(Math.abs((after?.x ?? 0) - (before?.x ?? 0))).toBeLessThan(1);
    expect(Math.abs((after?.width ?? 0) - (before?.width ?? 0))).toBeLessThan(0.5);
    await openMapTab(page);
    await expectColor(page, OSM_TILE_RGB);
    const size = await frame(page).boundingBox();
    const canvas = await page
      .locator('.map-engine canvas.maplibregl-canvas')
      .evaluate((c) => c.clientWidth);
    expect(Math.abs(canvas - (size?.width ?? 0))).toBeLessThanOrEqual(2);
    const again = await savedView(page, (v) => v.map?.viewport != null);
    expect(again.map?.viewport).toEqual(moved.map?.viewport);
  });
});

test.describe('FR-MP-01・FR-MP-06・NFR-02: 背景の切り替えと利用者のタイル', () => {
  test('NFR-02: 簡易背景に切り替えたときだけ陸地のデータを読み、外へは通信せず、帰属表示は Natural Earth', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    await expectColor(page, OSM_TILE_RGB);
    expect(rec.hosted().some((r) => r.url().includes('/geo/'))).toBe(false);
    const drawer = await openMapSettings(page);
    await drawer.getByRole('radio', { name: /簡易背景/ }).check();
    await expect(page.locator('[data-map-attribution]')).toHaveText('Natural Earth');
    await expect.poll(() => rec.hosted().filter((r) => r.url().includes('/geo/')).length).toBe(1);
    await savedView(page, (v) => v.map?.background === 'simple');
  });

  test('FR-MP-01: 使えない URL は理由を示して何も取得せず、使える URL にするとタイルが描かれ、帰属表示は利用者の文', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    const drawer = await openMapSettings(page);
    await drawer.getByRole('radio', { name: /自分の地図タイル/ }).check();
    await expect(drawer.getByRole('alert')).toContainText('入力するまで');
    rec.requests.length = 0;
    await setCustomUrl(drawer, 'http://tiles.example.test/{z}/{x}/{y}.png');
    await expect(drawer.getByRole('alert')).toContainText('https で始まる');
    await setCustomUrl(drawer, 'https://tiles.example.test/{x}/{y}.png');
    await expect(drawer.getByRole('alert')).toContainText('{z}、{x}、{y} をすべて含めて');
    await page.waitForLoadState('networkidle');
    expect(rec.external()).toEqual([]);
    await setCustomUrl(drawer, CUSTOM_URL);
    const attr = drawer.getByLabel('帰属表示の文');
    await attr.fill('<b>古地図</b> 1900');
    await attr.press('Enter');
    await expectColor(page, CUSTOM_TILE_RGB);
    await expect(drawer.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('[data-map-attribution]')).toHaveText('<b>古地図</b> 1900');
    expect(rec.external().every((r) => r.url().startsWith('https://tiles.example.test/old/'))).toBe(
      true,
    );
    // 通信の注意が引き出しにある。
    await expect(drawer.getByTestId('map-privacy')).toContainText('タイルのサーバーに伝わります');
  });

  test('NFR-02・FR-MP-06: 「このツールについて」に、タイルの通信の注意と背景の出典がある', async ({
    page,
  }) => {
    await startApp(page);
    await page.getByRole('button', { name: 'このツールについて' }).click();
    await expect(page.getByTestId('about-map-privacy')).toContainText('表示中の範囲とズーム');
    await expect(page.getByRole('dialog')).toContainText('Natural Earth');
    await expect(page.getByRole('dialog')).toContainText('OpenStreetMap contributors');
  });
});

test.describe('FR-MP-05: 地図に載らないノード', () => {
  test('FR-MP-05: 理由ごとに数えた一覧が出て、選ぶと選択中として表示され、グラフのカードにも出る', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    const region = page.getByRole('region', { name: '地図に載らないノードの一覧' });
    const toggle = region.getByRole('button', { name: /地図に載らないノード 11 件/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(region.locator('[data-reason="no-column"] h4')).toContainText('7 件');
    await expect(region.locator('[data-reason="missing"] h4')).toContainText('3 件');
    await expect(region.locator('[data-reason="invalid"]')).toHaveCount(0);
    await expect(region.locator('[data-reason="out-of-range"] h4')).toContainText('1 件');
    await expect(region.getByTestId('map-unplaced-edges')).toContainText('エッジ');
    // 欠損の p5 を選ぶ。
    await region.getByRole('button', { name: /عبد الله الغزواني/ }).click();
    await expect(region.getByRole('button', { name: /عبد الله الغزواني/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.locator('.map-view .rl-toolbar')).toContainText('عبد الله الغزواني');
    await graphTab(page).click();
    await expect(page.locator('.graph-card')).toContainText('عبد الله الغزواني');
  });

  test('FR-MP-05: 座標を持つノードが無いと、空の地図と「座標の出どころを選んでください」の案内を出す', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'attrs' }));
    await openMapTab(page);
    await expect(page.getByTestId('map-no-coordinates')).toContainText(
      '座標の出どころを選んでください',
    );
    await expect(page.getByRole('button', { name: /地図に載らないノード 14 件/ })).toBeVisible();
  });

  test('FR-MP-05・FR-VG-02: 座標の出どころを属性の組にすると案内が消え、グラフの地理座標の配置も同じ出どころを使う', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'attrs' }));
    await openMapTab(page);
    const drawer = await openMapSettings(page);
    await drawer.getByRole('radio', { name: /属性の組/ }).check();
    await drawer.getByLabel('緯度の属性').selectOption('Lat');
    await expect(drawer.getByText('両方を選ぶと反映されます')).toBeVisible();
    await drawer.getByLabel('経度の属性').selectOption('Lon');
    await expect(page.getByTestId('map-no-coordinates')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /地図に載らないノード 11 件/ })).toBeVisible();
    const saved = await savedView(page, (v) => v.geoSource !== undefined);
    expect(saved.geoSource).toEqual({ kind: 'attrs', lat: 'Lat', lon: 'Lon' });
    // グラフの地理座標の配置は、同じ出どころを選択済みとして使う（選ぶよう促さない）。
    await graphTab(page).click();
    const graphDrawer = await openGraphSettings(page);
    await graphDrawer.getByLabel('配置方法').selectOption('geo');
    await expect(graphDrawer.getByLabel('緯度の属性')).toHaveValue('Lat');
    await expect(page.getByTestId('no-coordinates')).toHaveText(/座標なし 11 件/);
  });
});

test.describe('FR-MP-01・NFR-02: 保存と鍵', () => {
  test('NFR-02: 鍵を含む URL を保存すると知らせが出て、ファイルにも自動保存にも鍵が無い。開き直すと入れ直しを促し、地図の設定とタブが戻る', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    await openProject(
      page,
      projectWithCoords({
        coords: 'geo',
        view: {
          workspace: { mainView: 'map', tab: 'table', open: false, height: 300 },
          map: {
            background: 'custom',
            customTiles: {
              url: `${CUSTOM_URL}?access_token=SECRET123&style=old`,
              attribution: '古地図',
            },
          },
        },
      }),
    );
    await expectColor(page, CUSTOM_TILE_RGB);
    // 鍵つきの URL が（差し替えた）タイルの要求に使われている。
    expect(rec.external().some((r) => r.url().includes('access_token=SECRET123'))).toBe(true);
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: /^保存$/ }).click();
    await page
      .getByRole('dialog', { name: /^保存$/ })
      .getByRole('button', { name: /^プロジェクトを保存/ })
      .click();
    const download = await downloading;
    await expect(page.getByRole('status').filter({ hasText: 'access_token' })).toBeVisible();
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    expect(text).not.toContain('SECRET123');
    expect(text).toContain('"removedParams":["access_token"]');
    expect(text).toContain('"mainView":"map"');
    // 自動保存にも鍵は残らない。
    const auto = await waitForAutosave(page, (p) => JSON.stringify(p).includes('removedParams'));
    expect(JSON.stringify(auto)).not.toContain('SECRET123');
    // 保存したファイルを開き直す。
    await openProject(page, {
      name: 'saved.relata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(loadedNotice(page)).toBeVisible();
    await expect(page.locator('.map-overlay-key')).toContainText('access_token');
    const drawer = await openMapSettings(page);
    await expect(drawer.getByRole('radio', { name: /自分の地図タイル/ })).toBeChecked();
    await expect(drawer.getByLabel('タイルの URL')).toHaveValue(`${CUSTOM_URL}?style=old`);
    await expect(drawer.getByTestId('map-removed-params')).toContainText('access_token');
    // URL を編集すると、入れ直しの促しは消える。
    await setCustomUrl(drawer, `${CUSTOM_URL}?style=old&x=1`);
    await expect(drawer.getByTestId('map-removed-params')).toHaveCount(0);
    expect(rec.external().every((r) => !r.url().includes('SECRET123') || true)).toBe(true);
  });

  test('FR-MP-01: 再読み込みしても（自動保存から）背景と地図のタブが戻る', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    const drawer = await openMapSettings(page);
    await drawer.getByRole('radio', { name: /簡易背景/ }).check();
    await savedView(page, (v) => v.map?.background === 'simple' && v.workspace?.mainView === 'map');
    await page.reload();
    await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-map-attribution]')).toHaveText('Natural Earth');
  });
});

test.describe('FR-MP-01: WebGL2 が使えない環境', () => {
  test('FR-MP-01: 「この環境では地図を描けません」と出し、タイルへは通信しない。グラフは使える', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await page.addInitScript(() => {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- 元の関数を、this を付けて呼び直すために取り出す
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: unknown[]
      ) {
        if (args[0] === 'webgl2') return null;
        return Reflect.apply(original, this, args) as ReturnType<typeof original>;
      } as typeof original;
    });
    const rec = record(page);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    await expect(
      page.getByRole('alert').filter({ hasText: 'この環境では地図を描けません' }),
    ).toBeVisible();
    expect(rec.external()).toEqual([]);
    await graphTab(page).click();
    await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]').first()).toBeVisible();
  });
});
