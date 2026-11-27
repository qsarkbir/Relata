/**
 * 地図の部品（src/map/）の E2E（T3-03）。FR-MP-01、FR-MP-06、NFR-02。D-50、D-51、D-52。
 *
 * 【なぜ】OpenStreetMap のタイルには、実際には通信しない。タイルの URL は `page.route` で差し替え、
 * 「要求の形が規約どおりか」だけを確かめる（OSM の利用規約は自動の取得を禁じている。D-51 の補足）。
 * 対象は一時のページ `map-probe.html`（`src/views/mapProbe.ts`）。ui の地図の画面ができたら、
 * 入口をそちらに替える。
 */
/// <reference lib="dom" />
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
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
const OSM_TILE_RGB: [number, number, number] = [200, 120, 80];
const CUSTOM_TILE_RGB: [number, number, number] = [90, 170, 110];

/** probe が出す、E2E で使う操作（型は最小限）。 */
interface ProbeEngine {
  isLoaded(): boolean;
  setViewport(v: { lon: number; lat: number; zoom: number }): void;
  getViewport(): { lon: number; lat: number; zoom: number };
  getAttribution(): { text: string; href?: string }[];
  fitBounds(
    b: { west: number; south: number; east: number; north: number },
    o?: { padding?: number; maxZoom?: number },
  ): { lon: number; lat: number; zoom: number };
  setBackground(b: { background: string; customTiles: { url: string; attribution: string } }): {
    kind: string;
    problem?: string;
  };
  onViewportChange(l: (v: unknown, phase: string) => void): () => void;
}
interface ProbeWindow {
  __mapProbe?: { engine: ProbeEngine | null; reason: string | null; errors: string[] };
}

/** 外へ出ようとした要求と、サイト内の要求を記録する。 */
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

async function openProbe(page: Page, query: string): Promise<void> {
  await page.goto(`./map-probe.html?${query}`);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as ProbeWindow).__mapProbe?.engine !== null))
    .toBe(true);
  // タイルや陸地のデータを読み終えるまで待つ。
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as ProbeWindow).__mapProbe?.engine?.isLoaded() ?? false,
      ),
    )
    .toBe(true);
}

/** 地図の枠の画面上の色を、(x, y)（枠の左上から）で読む。 */
async function pixelAt(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const shot = await page.locator('#map').screenshot();
  return page.evaluate(
    async ({ b64, px, py }) => {
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
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

function near(actual: number[], expected: number[], tol = 6): void {
  expected.forEach((e, i) => {
    expect(Math.abs((actual[i] ?? 0) - e)).toBeLessThanOrEqual(tol);
  });
}

test.describe('NFR-02: 地図を開くまで通信しない', () => {
  test('NFR-02: アプリを開いただけでは、地図の部品を読まず、タイルも陸地のデータも取りに行かない', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await page.goto('./');
    await expect(page.getByRole('heading', { name: 'Relata', level: 1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(rec.external()).toEqual([]);
    expect(rec.requests.some((r) => /\/assets\/map-[^/]*\.js/u.test(r.url()))).toBe(false);
    expect(rec.requests.some((r) => r.url().includes('/geo/'))).toBe(false);
  });
});

test.describe('FR-MP-01・FR-MP-06・NFR-02: OSM の背景', () => {
  test('FR-MP-01: WebGL2 で地図が描かれ、差し替えたタイルが画面に出る', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await openProbe(page, 'background=osm&lon=44&lat=33&zoom=5');
    near(await pixelAt(page, 400, 250), OSM_TILE_RGB);
    // MapLibre の canvas と、deck.gl の重ねの canvas がある。
    await expect(page.locator('#map canvas.maplibregl-canvas')).toHaveCount(1);
    expect(
      await page.evaluate(() => (window as unknown as ProbeWindow).__mapProbe?.errors),
    ).toEqual([]);
  });

  test('NFR-02: OSM への要求は、規約どおりの URL の形で、見出しを足さず、サイトの外は OSM だけ', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await openProbe(page, 'background=osm&lon=44&lat=33&zoom=5');
    const osm = rec.external();
    expect(osm.length).toBeGreaterThan(0);
    for (const r of osm) {
      // https://tile.openstreetmap.org/{z}/{x}/{y}.png だけ。サブドメインも、クエリも付けない。
      expect(r.url()).toMatch(/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/u);
      const h = await r.allHeaders();
      // ブラウザの既定の Referer を送る（Referrer-Policy で止めていない）。
      expect(h.referer).toMatch(/^http:\/\/localhost:\d+\//u);
      // no-cache の見出しを足さない。
      expect(h['cache-control']).toBeUndefined();
      expect(h.pragma).toBeUndefined();
    }
    // 簡易背景のデータは読まない。
    expect(rec.hosted().some((r) => r.url().includes('/geo/'))).toBe(false);
  });

  test('NFR-02: 先読み・画面外のタイルを取らない（表示中の 1 段のタイルだけ）。ズームは 19 まで', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await openProbe(page, 'background=osm&lon=44&lat=33&zoom=5');
    const tiles = rec.external().map((r) => /\/(\d+)\/(\d+)\/(\d+)\.png$/u.exec(r.url()));
    const zooms = new Set(tiles.map((m) => Number(m?.[1])));
    // 地図のズーム 5（512 px 基準）、256 px のタイルは 1 つ上の段（タイルの z=6）。
    expect([...zooms]).toEqual([6]);
    // 800×500 の枠が覆うタイルの数を超えない（余りを含めても 6 列×4 行まで）。
    expect(tiles.length).toBeLessThanOrEqual(24);
    // 重複して取らない。
    expect(new Set(rec.external().map((r) => r.url())).size).toBe(tiles.length);
    // 最大ズーム
    await page.evaluate(() =>
      (window as unknown as ProbeWindow).__mapProbe?.engine?.setViewport({
        lon: 44,
        lat: 33,
        zoom: 30,
      }),
    );
    expect(
      await page.evaluate(
        () => (window as unknown as ProbeWindow).__mapProbe?.engine?.getViewport().zoom,
      ),
    ).toBe(19);
  });

  test('FR-MP-06: 右下に「© OpenStreetMap contributors」が常に出て、著作権のページへのリンクになる', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await openProbe(page, 'background=osm&lon=44&lat=33&zoom=5&report');
    const attribution = page.locator('[data-map-attribution]');
    await expect(attribution).toBeVisible();
    const link = attribution.getByRole('link', { name: '© OpenStreetMap contributors' });
    await expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
    await expect(attribution.getByRole('link', { name: 'Report a map error' })).toHaveAttribute(
      'href',
      'https://www.openstreetmap.org/fixthemap',
    );
    // 右下: 枠の右下の角に接している。
    const frame = await page.locator('#map').boundingBox();
    const box = await attribution.boundingBox();
    if (frame === null || box === null) throw new Error('位置が取れません');
    expect(Math.abs(box.x + box.width - (frame.x + frame.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - (frame.y + frame.height))).toBeLessThanOrEqual(1);
    // 畳む部品を持たない（MapLibre の帰属表示の切り替えボタンがない）。
    await expect(page.locator('.maplibregl-ctrl-attrib-button')).toHaveCount(0);
  });
});

test.describe('FR-MP-01・FR-MP-06・NFR-02: 簡易背景', () => {
  test('NFR-02: 簡易背景を選んだときだけ public/geo/ を読み、外へは通信しない', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await openProbe(page, 'background=simple&lon=44&lat=33&zoom=4');
    expect(rec.external()).toEqual([]);
    const geo = rec.hosted().filter((r) => r.url().includes('/geo/'));
    expect(geo.map((r) => new URL(r.url()).pathname)).toEqual(['/Relata/geo/land-50m.geojson']);
    expect(
      await page.evaluate(() => (window as unknown as ProbeWindow).__mapProbe?.errors),
    ).toEqual([]);
  });

  test('FR-MP-01: 簡易背景は陸が薄い灰褐色、海が青灰色の 2 色（文字は描かない）', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await openProbe(page, 'background=simple&lon=44&lat=33&zoom=4');
    near(await pixelAt(page, 400, 250), [0xf1, 0xee, 0xe6]);
    await page.evaluate(() =>
      (window as unknown as ProbeWindow).__mapProbe?.engine?.setViewport({
        lon: -30,
        lat: 30,
        zoom: 4,
      }),
    );
    await expect
      .poll(async () => (await pixelAt(page, 400, 250)).join(','))
      .toBe([0xd6, 0xe2, 0xea].join(','));
  });

  test('FR-MP-06: 簡易背景の帰属表示は「Natural Earth」', async ({ page, context }) => {
    await mockTiles(context);
    await openProbe(page, 'background=simple');
    await expect(page.locator('[data-map-attribution]')).toHaveText('Natural Earth');
  });

  test('FR-MP-01: 背景を OSM から簡易へ切り替えると、そのとき初めて陸地のデータを読む', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    await openProbe(page, 'background=osm&lon=44&lat=33&zoom=4');
    expect(rec.hosted().some((r) => r.url().includes('/geo/'))).toBe(false);
    await page.evaluate(() =>
      (window as unknown as ProbeWindow).__mapProbe?.engine?.setBackground({
        background: 'simple',
        customTiles: { url: '', attribution: '' },
      }),
    );
    await expect.poll(() => rec.hosted().filter((r) => r.url().includes('/geo/')).length).toBe(1);
    await expect(page.locator('[data-map-attribution]')).toHaveText('Natural Earth');
  });
});

test.describe('FR-MP-01・FR-MP-06・NFR-02: 利用者のタイル', () => {
  const url = encodeURIComponent('https://tiles.example.test/old/{z}/{x}/{y}.png');

  test('FR-MP-01・FR-MP-06: 利用者の XYZ のタイルが描かれ、帰属表示は利用者が書いた文（HTML として解釈しない）', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    const rec = record(page);
    const text = '<b>古地図</b> 1900';
    await openProbe(
      page,
      `background=custom&lon=44&lat=33&zoom=4&url=${url}&attribution=${encodeURIComponent(text)}`,
    );
    near(await pixelAt(page, 400, 250), CUSTOM_TILE_RGB);
    expect(
      rec
        .external()
        .every((r) => /^https:\/\/tiles\.example\.test\/old\/\d+\/\d+\/\d+\.png$/u.test(r.url())),
    ).toBe(true);
    await expect(page.locator('[data-map-attribution]')).toHaveText(text);
    await expect(page.locator('[data-map-attribution] b')).toHaveCount(0);
  });

  test('FR-MP-06: 帰属表示の文が空なら、ホスト名を出す', async ({ page, context }) => {
    await mockTiles(context);
    await openProbe(page, `background=custom&lon=44&lat=33&zoom=4&url=${url}`);
    await expect(page.locator('[data-map-attribution]')).toHaveText('tiles.example.test');
  });

  test('NFR-02: http や雛形のない URL は使わず、何も取得しない', async ({ page, context }) => {
    await mockTiles(context);
    const rec = record(page);
    await openProbe(
      page,
      `background=custom&url=${encodeURIComponent('http://tiles.example.test/{z}/{x}/{y}.png')}`,
    );
    expect(rec.external()).toEqual([]);
    await expect(page.locator('[data-map-attribution]')).toBeEmpty();
  });
});

test.describe('FR-MP-01: 表示範囲と操作', () => {
  test('FR-MP-01: fitBounds は範囲に収まる表示範囲を返し、通知は出さない。操作の通知は出る', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await openProbe(page, 'background=simple');
    const result = await page.evaluate(() => {
      const engine = (window as unknown as ProbeWindow).__mapProbe?.engine;
      if (!engine) throw new Error('no engine');
      const events: string[] = [];
      engine.onViewportChange((_v, phase) => events.push(phase));
      const v = engine.fitBounds({ west: 40, south: 30, east: 50, north: 36 }, { padding: 40 });
      return { v, events };
    });
    expect(result.events).toEqual([]);
    expect(result.v.lon).toBeCloseTo(45, 3);
    expect(result.v.zoom).toBeGreaterThan(4);
    // 利用者の操作（ホイールでのズーム）で、止まったときの通知が来る。
    await page.evaluate(() => {
      const w = window as unknown as ProbeWindow & { __phases?: string[] };
      w.__phases = [];
      w.__mapProbe?.engine?.onViewportChange((_v, phase) => w.__phases?.push(phase));
    });
    await page.locator('#map').hover();
    await page.mouse.wheel(0, -300);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __phases?: string[] }).__phases?.includes('end'),
        ),
      )
      .toBe(true);
  });

  test('FR-MP-01: 回転と傾きの操作を切ってある（キーボードの Shift+矢印でも回らない）', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await openProbe(page, 'background=simple&lon=44&lat=33&zoom=4');
    // 【なぜ】フォーカスの枠は、当てた直後の 1 フレーム遅れて絵に入り、前後の比較がずれる。枠を消して比べる。
    await page.addStyleTag({ content: '#map canvas { outline: none !important; }' });
    await page.locator('#map canvas.maplibregl-canvas').focus();
    const before = await page.locator('#map').screenshot();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await page.mouse.move(400, 250);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(500, 300, { steps: 5 });
    await page.mouse.up({ button: 'right' });
    // 回転・傾きが入ると、海岸線の位置が変わって絵が変わる。変わらなければ、北が上のまま。
    await page.waitForTimeout(500);
    expect((await page.locator('#map').screenshot()).equals(before)).toBe(true);
  });

  test('FR-MP-01: 枠の大きさが変わると、地図の canvas も追随する（container-type: size の枠の中でも）', async ({
    page,
    context,
  }) => {
    await mockTiles(context);
    await openProbe(page, 'background=simple&lon=44&lat=33&zoom=4');
    await page.evaluate(() => {
      const w = window as unknown as ProbeWindow & { __phases?: string[] };
      w.__phases = [];
      w.__mapProbe?.engine?.onViewportChange((_v, phase) => w.__phases?.push(phase));
    });
    await page.locator('#frame').evaluate((el) => {
      el.style.width = '500px';
      el.style.height = '300px';
    });
    await expect
      .poll(() => page.locator('#map canvas.maplibregl-canvas').evaluate((c) => c.clientWidth))
      .toBe(500);
    expect(
      await page.locator('#map canvas.maplibregl-canvas').evaluate((c) => c.clientHeight),
    ).toBe(300);
    // 大きさの変化は利用者の操作ではないので、表示範囲の変化として通知しない（「データに合わせる」を失わせない）。
    expect(
      await page.evaluate(() => (window as unknown as { __phases?: string[] }).__phases),
    ).toEqual([]);
  });
});

test.describe('FR-MP-01: WebGL2 が使えない環境', () => {
  test('FR-MP-01: 地図を作れない理由を通知し、タイルへは通信しない', async ({ page, context }) => {
    await mockTiles(context);
    const rec = record(page);
    await page.goto('./map-probe.html?background=osm&nowebgl');
    await expect(page.getByRole('status')).toHaveText('この環境では地図を描けません');
    expect(await page.evaluate(() => (window as unknown as ProbeWindow).__mapProbe?.reason)).toBe(
      'webgl2-unavailable',
    );
    expect(rec.external()).toEqual([]);
  });
});
