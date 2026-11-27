/**
 * 地図の画面（views の薄い部品）の E2E（T3-03c のレビューの指摘への対応）。FR-MP-01、FR-MP-05、FR-MP-06、FR-VG-02、NFR-02。
 * D-46、D-48、D-51（補足）。OpenStreetMap には通信しない（共通の `fixtures` が差し替える）。
 */
/// <reference lib="dom" />
import { expect, solidTilePng, test, type Locator, type Page, type Request } from './fixtures';
import { readFileSync } from 'node:fs';
import { fixturePath, openGraphSettings, openProject, startApp, waitForAutosave } from './support';

test.use({ locale: 'ja-JP' });

const CUSTOM_HOST = 'tiles.example.test';
const CUSTOM_URL = `https://${CUSTOM_HOST}/old/{z}/{x}/{y}.png`;

/** 見本に座標を足したファイル。coords: geo（GraphNode.geo）、attrs（Lat、Lon の属性）、both（両方。属性は p2 と p3 が入れ替わる）。 */
function project(coords: 'geo' | 'attrs' | 'both', view: Record<string, unknown> = {}) {
  const file = JSON.parse(readFileSync(fixturePath('maghrib.relata.json'), 'utf8')) as {
    formatVersion: number;
    dataset: { nodes: Record<string, unknown>[]; schema: unknown[] };
    view: Record<string, unknown>;
  }; // 理由: テスト用の見本ファイル
  const geo: Record<string, [number, number]> = {
    p2: [33.3, 44.4],
    p3: [37.9, -4.8],
    p4: [30, 31.2],
  };
  const attrs: Record<string, [number, number]> =
    coords === 'both' ? { p2: [37.9, -4.8], p3: [33.3, 44.4], p4: [30, 31.2] } : geo;
  for (const n of file.dataset.nodes) {
    const id = String(n.id);
    const g = geo[id];
    const a = attrs[id];
    if (coords !== 'attrs' && g !== undefined) n.geo = { kind: 'point', lat: g[0], lon: g[1] };
    if (coords !== 'geo' && a !== undefined) {
      const at = n.attrs as Record<string, unknown>;
      at.Lat = { kind: 'value', value: a[0] };
      at.Lon = { kind: 'value', value: a[1] };
    }
  }
  if (coords !== 'geo')
    file.dataset.schema.push(
      { key: 'Lat', label: '緯度', appliesTo: 'node', valueType: 'number' },
      { key: 'Lon', label: '経度', appliesTo: 'node', valueType: 'number' },
    );
  file.formatVersion = 3;
  file.view = { ...file.view, ...view };
  return {
    name: 'map.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  };
}

const MAP_VIEW = { workspace: { mainView: 'map', tab: 'table', open: false, height: 300 } };

function record(page: Page): Request[] {
  const requests: Request[] = [];
  page.on('request', (r) => requests.push(r));
  return requests;
}
const tilesOf = (rs: Request[], host: string) =>
  rs.filter((r) => new URL(r.url()).hostname === host);
const zoomOf = (r: Request) => Number(/\/(\d+)\/\d+\/\d+\.png$/u.exec(r.url())?.[1]);

const mapTab = (page: Page) => page.getByRole('tab', { name: '地図', exact: true });
const graphTab = (page: Page) => page.getByRole('tab', { name: 'グラフ', exact: true });

async function openMapSettings(page: Page): Promise<Locator> {
  const drawer = page.getByRole('complementary', { name: '地図の表示の設定' });
  if (!(await drawer.isVisible())) await page.getByRole('button', { name: '表示の設定' }).click();
  await expect(drawer).toBeVisible();
  return drawer;
}

async function rects(page: Page) {
  return page.evaluate(() => {
    const r = (el: Element | null) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    };
    const attr = document.querySelector('[data-map-attribution]');
    const c = attr?.getBoundingClientRect();
    const top =
      c === undefined ? null : document.elementFromPoint(c.x + c.width / 2, c.y + c.height / 2);
    return {
      attr: r(attr),
      drawer: r(document.querySelector('#map-settings-drawer:not([hidden])')),
      list: r(document.querySelector('.map-unplaced')),
      attrOnTop: top !== null && attr?.contains(top) === true,
    };
  });
}
interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
const overlap = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test.describe('FR-MP-01・NFR-02: 最初の表示', () => {
  test('NFR-02: 座標ありのファイルで地図を初めて開くと、取る OSM のタイルは 1 つのズームの段だけ', async ({
    page,
  }) => {
    const rs = record(page);
    await startApp(page);
    await openProject(page, project('geo'));
    await mapTab(page).click();
    await expect.poll(() => tilesOf(rs, 'tile.openstreetmap.org').length).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(new Set(tilesOf(rs, 'tile.openstreetmap.org').map(zoomOf)).size).toBe(1);
  });

  test('FR-MP-01: 地図を開く → グラフへ戻る → 同じファイルを開き直す → 地図へ戻ると、最初と同じ範囲に合う', async ({
    page,
  }) => {
    const rs = record(page);
    await startApp(page);
    await openProject(page, project('geo'));
    await mapTab(page).click();
    await expect.poll(() => tilesOf(rs, 'tile.openstreetmap.org').length).toBeGreaterThan(0);
    const first = tilesOf(rs, 'tile.openstreetmap.org')[0];
    if (first === undefined) throw new Error('タイルの要求がありません');
    const z0 = zoomOf(first);
    await graphTab(page).click();
    await openProject(page, project('geo'));
    rs.length = 0;
    await mapTab(page).click();
    await expect(page.locator('.map-engine canvas.maplibregl-canvas')).toBeVisible();
    await page.waitForTimeout(800);
    // 隠れている間に合わせて壊れていれば、別のズームのタイルを取る。同じ範囲なら、取るとしても z0 だけ。
    expect(tilesOf(rs, 'tile.openstreetmap.org').every((r) => zoomOf(r) === z0)).toBe(true);
  });
});

test.describe('FR-MP-06: 帰属表示と UI の部品を重ねない', () => {
  for (const size of [
    { width: 1280, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    test(`FR-MP-06: ${String(size.width)}×${String(size.height)} で、引き出し・一覧と帰属表示が重ならず、帰属表示が最前面にある`, async ({
      page,
    }) => {
      await page.setViewportSize(size);
      await startApp(page);
      await openProject(page, project('geo'));
      await mapTab(page).click();
      await expect(page.locator('[data-map-attribution]')).toBeVisible();
      await openMapSettings(page);
      await page.getByRole('button', { name: /地図に載らないノード/ }).click();
      await expect(page.locator('.map-unplaced-body')).toBeVisible();
      const r = await rects(page);
      if (r.attr === null || r.drawer === null || r.list === null)
        throw new Error('要素が見つかりません');
      expect(r.attrOnTop).toBe(true);
      expect(overlap(r.attr, r.drawer)).toBe(false);
      expect(overlap(r.attr, r.list)).toBe(false);
      // 引き出しは地図の枠の外（横）にあり、地図に重ならない。
      const frame = await page.locator('[data-main-frame="map"]').boundingBox();
      if (frame === null) throw new Error('枠');
      expect(overlap({ x: frame.x, y: frame.y, w: frame.width, h: frame.height }, r.drawer)).toBe(
        false,
      );
    });
  }
});

test.describe('D-51 補足: 利用者のタイルのファイルは、開いた人が許すまで読まない', () => {
  const custom = {
    ...MAP_VIEW,
    map: {
      background: 'custom',
      customTiles: { url: CUSTOM_URL, attribution: '古地図', removedParams: ['access_token'] },
    },
  };

  test('NFR-02: 地図のタブを開いた状態で保存した custom のファイルを開いても、そのホストへ 1 件も要求せず、押すと要求する', async ({
    page,
    context,
  }) => {
    await context.route(`https://${CUSTOM_HOST}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: solidTilePng(90, 170, 110) }),
    );
    const rs = record(page);
    await startApp(page);
    await openProject(page, project('geo', custom));
    await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true');
    const gate = page.getByTestId('map-gate');
    await expect(gate).toContainText(CUSTOM_HOST);
    await expect(gate).toContainText('表示範囲がそのサーバーに伝わります');
    await page.waitForTimeout(800);
    expect(tilesOf(rs, CUSTOM_HOST)).toEqual([]);
    expect(rs.some((r) => /\/assets\/map-[^/]*\.js/u.test(r.url()))).toBe(false);
    // グラフへ戻るタブがある。
    await expect(graphTab(page)).toBeVisible();
    await gate.getByRole('button', { name: '地図を表示する' }).click();
    await expect.poll(() => tilesOf(rs, CUSTOM_HOST).length).toBeGreaterThan(0);
    // 鍵を入れ直す知らせの中の名前は、向きを隔離する（bdi）。
    await expect(page.locator('.map-overlay-key bdi')).toHaveText('access_token');
  });

  test('NFR-02: 自動保存からの復元（利用者自身の作業）は、そのまま地図を読む', async ({
    page,
    context,
  }) => {
    await context.route(`https://${CUSTOM_HOST}/**`, (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: solidTilePng(90, 170, 110) }),
    );
    await startApp(page);
    await openProject(page, project('geo', custom));
    await page.getByTestId('map-gate').getByRole('button', { name: '地図を表示する' }).click();
    await waitForAutosave(page, (s) => JSON.stringify(s.view).includes('"mainView":"map"'));
    const rs = record(page);
    await page.reload();
    await expect(page.getByTestId('map-gate')).toHaveCount(0);
    await expect.poll(() => tilesOf(rs, CUSTOM_HOST).length).toBeGreaterThan(0);
  });
});

test.describe('FR-VG-02・D-46: 地理座標の配置と座標の出どころ', () => {
  test('FR-VG-02: 属性の組を片方だけ選んでいる間は、GraphNode.geo があっても配置を待ち、両方選ぶと配置する', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, project('both'));
    const drawer = await openGraphSettings(page);
    await drawer.getByLabel('配置方法').selectOption('geo');
    // 既定の出どころ（geo）で配置される。
    await expect(page.getByTestId('no-coordinates')).toHaveText(/座標なし/);
    await drawer.getByLabel('緯度の属性').selectOption('Lat');
    await expect(page.getByTestId('no-coordinates')).toHaveText('緯度・経度の属性を選んでください');
    await drawer.getByLabel('経度の属性').selectOption('Lon');
    await expect(page.getByTestId('no-coordinates')).toHaveText(/座標なし/);
  });

  test('FR-VG-02: データに無い属性を指す出どころは、計算せず「見つかりません」を出す', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(
      page,
      project('geo', { geoSource: { kind: 'attrs', lat: 'NoLat', lon: 'NoLon' } }),
    );
    const drawer = await openGraphSettings(page);
    await drawer.getByLabel('配置方法').selectOption('geo');
    await expect(page.getByTestId('no-coordinates')).toContainText('見つかりません');
  });

  test('FR-MP-05・FR-VG-02: 地図の設定で出どころを変えると、地理座標の配置が計算し直される', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, project('both'));
    const drawer = await openGraphSettings(page);
    await drawer.getByLabel('配置方法').selectOption('geo');
    const xs = async () =>
      page.evaluate(() => {
        const x = (id: string) => {
          const el = document.querySelector(`.graph-canvas #graph-view-nodes > [data-id="${id}"]`);
          return el === null ? NaN : el.getBoundingClientRect().x;
        };
        return { p2: x('p2'), p3: x('p3') };
      });
    // geo では p2（東経 44.4）が p3（西経 4.8）より右。
    await expect
      .poll(async () => {
        const v = await xs();
        return v.p2 > v.p3;
      })
      .toBe(true);
    await mapTab(page).click();
    const mapDrawer = await openMapSettings(page);
    await mapDrawer.getByRole('radio', { name: /属性の組/ }).check();
    await mapDrawer.getByLabel('緯度の属性').selectOption('Lat');
    await mapDrawer.getByLabel('経度の属性').selectOption('Lon');
    await graphTab(page).click();
    // 属性の組では p2 と p3 が入れ替わるので、p2 が左になる（再配置のボタンを押さずに反映される）。
    await expect
      .poll(async () => {
        const v = await xs();
        return v.p2 < v.p3;
      })
      .toBe(true);
  });
});

test.describe('FR-MP-05: 地図に載らないノードの一覧の選択', () => {
  test('FR-MP-05: 選択中のノードをもう一度押すと選択から外れる', async ({ page }) => {
    await startApp(page);
    await openProject(page, project('geo'));
    await mapTab(page).click();
    const region = page.getByRole('region', { name: '地図に載らないノードの一覧' });
    await region.getByRole('button', { name: /地図に載らないノード/ }).click();
    const item = region.getByRole('button', { name: /عبد الله الغزواني/ });
    await item.click();
    await expect(item).toHaveAttribute('aria-pressed', 'true');
    await item.click();
    await expect(item).toHaveAttribute('aria-pressed', 'false');
  });
});

test.describe('D-48: 「グラフ｜地図」のタブは各ビューのツールバーの先頭にある', () => {
  test('D-48: グラフと地図のどちらのツールバーでも、タブが先頭に出る', async ({ page }) => {
    await startApp(page);
    await openProject(page, project('geo'));
    const g = page.getByRole('group', { name: 'グラフの操作' });
    await expect(g.getByRole('tablist').first()).toBeVisible();
    expect(await g.locator('> *').first().getAttribute('role')).toBe('tablist');
    await mapTab(page).click();
    const m = page.getByRole('group', { name: '地図の操作' });
    await expect(m.getByRole('tablist')).toBeVisible();
    expect(await m.locator('> *').first().getAttribute('role')).toBe('tablist');
    await expect(mapTab(page)).toHaveAttribute('aria-selected', 'true');
    await expect(mapTab(page)).toBeFocused();
  });
});
