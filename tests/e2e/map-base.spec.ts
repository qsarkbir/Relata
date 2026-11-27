/**
 * 地図の部品（src/map/）の E2E（T3-03）。FR-MP-01、FR-MP-06、NFR-02。D-50、D-51、D-52。
 *
 * 【なぜ】OpenStreetMap のタイルには、実際には通信しない。タイルの URL は `page.route` で差し替え、
 * 「要求の形が規約どおりか」だけを確かめる（OSM の利用規約は自動の取得を禁じている。D-51 の補足）。
 * 入口は本物の画面（「グラフ｜地図」の地図のタブ。`MapView.tsx`）。
 */
/// <reference lib="dom" />
import { expect, test, type BrowserContext, type Page, type Request } from './fixtures';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    // 先読みしない: 表示範囲を覆う枚数（各辺 ceil(長さ/256)+1 枚）を超えない。
    const area = await page.locator('.map-engine').boundingBox();
    if (area === null) throw new Error('表示範囲の大きさが取れません');
    const limit = (Math.ceil(area.width / 256) + 1) * (Math.ceil(area.height / 256) + 1);
    expect(osm.length).toBeLessThanOrEqual(limit);
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
    // 【なぜ】networkidle ではなく、描画を 2 フレーム進めてから数える（要求は描画の更新で出るため）。
    await page.evaluate(
      () =>
        new Promise<void>((done) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              done();
            });
          });
        }),
    );
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

/** 画面の地図の枠の、(x, y)（枠の左上から）の色を読む。 */
async function colorAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = await page.locator('.map-engine').screenshot();
  return page.evaluate(
    async ({ b64, px, py }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d');
      if (ctx === null) throw new Error('2D の文脈を作れません');
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(px, py, 1, 1).data;
      return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0] as [number, number, number];
    },
    { b64: shot.toString('base64'), px: x, py: y },
  );
}

/** Web メルカトルの、世界の幅を 1 としたときの座標（北が y = 0）。 */
function mercator(lon: number, lat: number): { x: number; y: number } {
  const rad = (lat * Math.PI) / 180;
  return {
    x: (lon + 180) / 360,
    y: 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI),
  };
}

const LAND_RGB = [0xf1, 0xee, 0xe6];
const SEA_RGB = [0xd6, 0xe2, 0xea];

test.describe('FR-MP-01: 簡易背景の陸地の塗り', () => {
  // 【なぜ】世界の陸地のデータは、日付変更線をまたぐ環（ユーラシア）を平面で扱えるよう切り直してある。
  //   切り直さないと、イベリア半島から西ヨーロッパの陸が海の色の長方形で抜け、黒海の北に海の色の三角形が出た（T3-03b）。
  test('FR-MP-01: 地中海の周りの陸地が欠けない（イベリア半島、フランス、ウクライナの内陸は陸の色、地中海は海の色）', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const center = { lon: 18, lat: 44, zoom: 3 };
    await startApp(page);
    await openProject(
      page,
      projectWithCoords({
        coords: 'geo',
        view: {
          workspace: { mainView: 'map', tab: 'table', open: false, height: 300 },
          map: {
            background: 'simple',
            viewport: center,
            customTiles: { url: '', attribution: '' },
          },
        },
      }),
    );
    await expect(page.locator('[data-map-attribution]')).toHaveText('Natural Earth');
    const box = await page.locator('.map-engine').boundingBox();
    if (box === null) throw new Error('地図の大きさが取れません');
    const c = mercator(center.lon, center.lat);
    const scale = 512 * 2 ** center.zoom;
    const at = (lon: number, lat: number): [number, number] => {
      const p = mercator(lon, lat);
      return [
        Math.round(box.width / 2 + (p.x - c.x) * scale),
        Math.round(box.height / 2 + (p.y - c.y) * scale),
      ];
    };
    const near = (a: number[], e: number[]): boolean =>
      e.every((v, i) => Math.abs((a[i] ?? 0) - v) <= 6);
    const points: [string, number, number, number[]][] = [
      ['地中海（イオニア海）', 17, 36, SEA_RGB],
      ['イベリア半島の内陸', -4, 40, LAND_RGB],
      ['フランスの内陸', 2.5, 47, LAND_RGB],
      ['西フランス（ビスケー湾岸）', -1, 46.5, LAND_RGB],
      ['ブルターニュ', -3, 48, LAND_RGB],
      ['ジョージア（黒海の東岸）', 42.5, 42, LAND_RGB],
      ['トルコ北東部', 40, 40.5, LAND_RGB],
      ['ウクライナの内陸', 31, 49, LAND_RGB],
      ['黒海の北の陸（南ロシア）', 41, 48, LAND_RGB],
      ['ドイツの内陸', 10, 51, LAND_RGB],
    ];
    for (const [name, lon, lat, rgb] of points) {
      const [x, y] = at(lon, lat);
      expect(x, `${name} は枠の中`).toBeGreaterThan(0);
      expect(x, `${name} は枠の中`).toBeLessThan(box.width);
      expect(y, `${name} は枠の中`).toBeGreaterThan(0);
      expect(y, `${name} は枠の中`).toBeLessThan(box.height);
      await expect
        .poll(async () => near(await colorAt(page, x, y), rgb), { message: name })
        .toBe(true);
    }
  });
});

/** 地図の部品のチャンクを、画面とは別に読み込んで使うための入口（型は最小限）。 */
interface MapModule {
  createMapEngine(
    el: HTMLElement,
    o: {
      background: { background: string; customTiles: { url: string; attribution: string } };
      initialBounds?: { west: number; south: number; east: number; north: number };
      onError?: (e: { kind: string; message: string }) => void;
    },
  ): {
    ok: boolean;
    engine?: {
      isLoaded(): boolean;
      destroy(): void;
      getViewport(): { lon: number; lat: number; zoom: number };
    };
  };
}
interface ContextWindow {
  __contexts?: { canvas: HTMLCanvasElement; gl: WebGL2RenderingContext }[];
}

test.describe('FR-MP-01・NFR-02: 地図の部品の後始末と失敗の通知', () => {
  test('FR-MP-01: destroy すると、MapLibre と deck.gl の両方の WebGL の文脈を手放す', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    // 作られた WebGL2 の文脈を、canvas と対で記録する。
    await page.addInitScript(() => {
      const w = window as unknown as ContextWindow;
      w.__contexts = [];
      // eslint-disable-next-line @typescript-eslint/unbound-method -- 元の関数を、this を付けて呼び直すために取り出す
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        this: HTMLCanvasElement,
        ...args: unknown[]
      ) {
        const gl: unknown = Reflect.apply(original, this, args);
        if (args[0] === 'webgl2' && gl instanceof WebGL2RenderingContext)
          w.__contexts?.push({ canvas: this, gl });
        return gl;
      } as typeof original;
    });
    const rec = record(page);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    await expectColor(page, OSM_TILE_RGB);
    const chunk = rec.requests.map((r) => r.url()).find((u) => /\/assets\/map-[^/]*\.js/u.test(u));
    if (chunk === undefined) throw new Error('地図のチャンクが読まれていません');
    const result = await page.evaluate(async (url) => {
      const w = window as unknown as ContextWindow;
      // 【TS】動的 import の戻り値は型が付かないので、最小の型で受け直す。
      const m = (await import(/* @vite-ignore */ url)) as MapModule; // 理由: 自分のアプリのチャンク
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px';
      document.body.append(host);
      const r = m.createMapEngine(host, {
        background: { background: 'simple', customTiles: { url: '', attribution: '' } },
      });
      if (!r.ok || r.engine === undefined) throw new Error('地図を作れません');
      const engine = r.engine;
      while (!engine.isLoaded()) await new Promise((res) => setTimeout(res, 50));
      const canvases = [...host.querySelectorAll('canvas')];
      engine.destroy();
      return canvases.map((c) => ({
        name: c.id !== '' ? c.id : c.className,
        lost: w.__contexts?.find((x) => x.canvas === c)?.gl.isContextLost() ?? null,
      }));
    }, chunk);
    // MapLibre の canvas と deck.gl の canvas の 2 枚。どちらの文脈も失われている。
    expect(result.map((r) => r.name).sort()).toEqual(['deckgl-overlay', 'maplibregl-canvas']);
    expect(result.map((r) => r.lost)).toEqual([true, true]);
  });

  test('NFR-02: initialBounds で作ると、世界全体のタイルを取らず、範囲に合う 1 つの段だけを取る', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    // 画面の地図は作らず、地図のチャンクだけを直接読む（チャンクの名前は出力のフォルダから探す）。
    const dist = join(import.meta.dirname, '..', '..', 'dist', 'assets');
    const chunk = readdirSync(dist).find((f) => /^map-[^.]+\.js$/u.test(f));
    if (chunk === undefined) throw new Error('地図のチャンクが見つかりません');
    const url = new URL(`assets/${chunk}`, page.url()).href;
    const viewport = await page.evaluate(async (u) => {
      const m = (await import(/* @vite-ignore */ u)) as MapModule; // 理由: 自分のアプリのチャンク
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:500px';
      document.body.append(host);
      const r = m.createMapEngine(host, {
        background: { background: 'osm', customTiles: { url: '', attribution: '' } },
        initialBounds: { west: 40, south: 30, east: 50, north: 36 },
      });
      if (!r.ok || r.engine === undefined) throw new Error('地図を作れません');
      while (!r.engine.isLoaded()) await new Promise((res) => setTimeout(res, 50));
      return r.engine.getViewport();
    }, url);
    expect(viewport.lon).toBeCloseTo(45, 3);
    const zooms = new Set(rec.external().map((r) => /\/(\d+)\/\d+\/\d+\.png$/u.exec(r.url())?.[1]));
    expect(rec.external().length).toBeGreaterThan(0);
    expect(zooms.size).toBe(1);
    expect(Number([...zooms][0])).toBeGreaterThanOrEqual(4);
  });

  test('NFR-02: タイルの取得の失敗は、タイルが何枚失敗しても 1 回だけ通知される', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await startApp(page);
    await openProject(page, projectWithCoords({ coords: 'geo' }));
    await openMapTab(page);
    await expectColor(page, OSM_TILE_RGB);
    const chunk = rec.requests.map((r) => r.url()).find((u) => /\/assets\/map-[^/]*\.js/u.test(u));
    if (chunk === undefined) throw new Error('地図のチャンクが読まれていません');
    // 差し替えていない外部ホストは、mockTiles が通信せずに失敗させる。
    const unreachable = 'https://unreachable.example.test/{z}/{x}/{y}.png';
    await page.evaluate(
      async ({ url, tiles }) => {
        const m = (await import(/* @vite-ignore */ url)) as MapModule; // 理由: 自分のアプリのチャンク
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:500px';
        document.body.append(host);
        const errors: string[] = [];
        (window as unknown as { __errors?: string[] }).__errors = errors;
        m.createMapEngine(host, {
          background: { background: 'custom', customTiles: { url: tiles, attribution: '' } },
          onError: (e) => errors.push(e.kind),
        });
      },
      { url: chunk, tiles: unreachable },
    );
    await expect
      .poll(() => rec.requests.filter((r) => r.url().includes('unreachable.example.test')).length)
      .toBeGreaterThan(2);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __errors?: string[] }).__errors))
      .toEqual(['tile']);
    await page.waitForTimeout(500);
    expect(
      await page.evaluate(() => (window as unknown as { __errors?: string[] }).__errors),
    ).toEqual(['tile']);
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
    // 利用者のタイルのファイルは、開いた人が許すまで読まない（D-51 補足）。確認の画面で押す。
    await page.getByTestId('map-gate').getByRole('button', { name: '地図を表示する' }).click();
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
    // 保存したファイルを開き直す。ここから先の要求だけを調べる（鍵つきの URL は、もう使われない）。
    const beforeReopen = rec.requests.length;
    await openProject(page, {
      name: 'saved.relata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(loadedNotice(page)).toBeVisible();
    // 開き直したファイルも、確認の画面で止まる。
    await page.getByTestId('map-gate').getByRole('button', { name: '地図を表示する' }).click();
    await expect(page.locator('.map-overlay-key')).toContainText('access_token');
    const drawer = await openMapSettings(page);
    await expect(drawer.getByRole('radio', { name: /自分の地図タイル/ })).toBeChecked();
    await expect(drawer.getByLabel('タイルの URL')).toHaveValue(`${CUSTOM_URL}?style=old`);
    await expect(drawer.getByTestId('map-removed-params')).toContainText('access_token');
    // URL を編集すると、入れ直しの促しは消える。
    await setCustomUrl(drawer, `${CUSTOM_URL}?style=old&x=1`);
    await expect(drawer.getByTestId('map-removed-params')).toHaveCount(0);
    // 開き直した後の要求に、鍵（SECRET123）を含むものが無い。
    expect(rec.requests.slice(beforeReopen).filter((r) => r.url().includes('SECRET123'))).toEqual(
      [],
    );
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
