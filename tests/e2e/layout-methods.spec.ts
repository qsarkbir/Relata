/**
 * 層状・地理座標の配置（T2-03、FR-VG-02）の E2E。
 *
 * 見本は、このファイルの中で作る小さな二部グラフ。人物 4（p1〜p4）、組織 2（o1、o2）。
 * 緯度・経度の属性（Lat、Lon）は、p1 = バグダード（33.3, 44.4）、p2 = コルドバ（37.9, -4.8）、
 * p3 は緯度が文字列「不明」、p4 は緯度が範囲外（95）。組織には座標の属性が無い。
 * したがって地理座標の配置では、座標なしは p3、p4、o1、o2 の 4 件。
 */
import { expect, test, type Page } from './fixtures';
import { openGraphSettings, openProject, startApp, waitForAutosave } from './support';

test.use({ locale: 'ja-JP' });

function projectFile() {
  const value = (v: string | number) => ({ kind: 'value', value: v });
  const person = (id: string, label: string, lat?: string | number, lon?: number) => ({
    id,
    type: 'person',
    label,
    attrs: {
      ...(lat === undefined ? {} : { Lat: value(lat) }),
      ...(lon === undefined ? {} : { Lon: value(lon) }),
    },
  });
  const edge = (id: string, source: string, target: string) => ({
    id,
    source,
    target,
    directed: false,
    weight: 1,
    attrs: {},
  });
  return {
    name: 'layout.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'Relata',
        formatVersion: 1,
        dataset: {
          graphMode: 'undirected',
          nodeTypes: [
            { id: 'person', label: '人物' },
            { id: 'org', label: 'ابن عسكر' },
          ],
          nodes: [
            person('p1', 'バグダード', 33.3, 44.4),
            person('p2', 'コルドバ', 37.9, -4.8),
            person('p3', '不明の地', '不明', 10),
            person('p4', '範囲外', 95, 10),
            { id: 'o1', type: 'org', label: 'Org One', attrs: {} },
            { id: 'o2', type: 'org', label: 'Org Two', attrs: {} },
          ],
          edges: [
            edge('e1', 'p1', 'o1'),
            edge('e2', 'p2', 'o2'),
            edge('e3', 'p3', 'o1'),
            edge('e4', 'p4', 'o2'),
          ],
          schema: [
            { key: 'Lat', label: '緯度', appliesTo: 'node', valueType: 'number' },
            { key: 'Lon', label: '経度', appliesTo: 'node', valueType: 'number' },
          ],
          meta: { title: 'Layout test' },
        },
        view: { filter: { filters: [], edgeRule: 'both-ends', showIsolated: true } },
      }),
    ),
  };
}

interface Point {
  x: number;
  y: number;
}

/** ノードの中心（図の枠の左上からの位置）。 */
async function center(page: Page, id: string) {
  const box = await page
    .locator(`.graph-canvas #graph-view-nodes > [data-id="${id}"]`)
    .boundingBox();
  const frame = await page.getByRole('img', { name: 'ネットワーク図' }).boundingBox();
  if (box === null || frame === null) throw new Error('node box');
  return { x: box.x + box.width / 2 - frame.x, y: box.y + box.height / 2 - frame.y };
}

/** 複数のノードの中心。1 つでも図に無ければ NaN を返す（比べる側の poll が、そろうまで待てるように）。 */
async function centers<const T extends readonly string[]>(
  page: Page,
  ids: T,
): Promise<{ [K in keyof T]: Point }> {
  const result: Point[] = [];
  for (const id of ids) {
    try {
      result.push(await center(page, id));
    } catch {
      result.push({ x: Number.NaN, y: Number.NaN });
    }
  }
  // 理由: 入力の ids と同じ長さの配列を、同じ長さのタプルの型として返す（要素数は上で ids に揃えた）。
  return result as unknown as { [K in keyof T]: Point };
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await startApp(page);
  await openProject(page, projectFile());
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(6);
});

test('FR-VG-02: 層状は型ごとの列に分かれ、列の順を入れ替えると左右が逆になる', async ({ page }) => {
  const drawer = await openGraphSettings(page);
  await drawer.getByLabel('配置方法').selectOption('layered');
  const order = drawer.getByRole('list', { name: '列の順（左から右）' });
  // 既定は型 ID の昇順（org、person）。
  await expect(order.getByRole('listitem')).toHaveText([/ابن عسكر/, /人物/]);
  // 配置の計算中はノードが一時的に無いので、すべてそろうまで待って比べる。
  await expect
    .poll(async () => {
      const [o1, o2, p1, p3] = await centers(page, ['o1', 'o2', 'p1', 'p3']);
      return p1.x > o1.x + 50 && Math.abs(o1.x - o2.x) < 1 && Math.abs(p1.x - p3.x) < 1;
    })
    .toBe(true);
  await drawer.getByRole('button', { name: '人物 の列を左へ' }).click();
  await expect(order.getByRole('listitem')).toHaveText([/人物/, /ابن عسكر/]);
  await expect
    .poll(async () => {
      const [o1, p1] = await centers(page, ['o1', 'p1']);
      return p1.x < o1.x - 50;
    })
    .toBe(true);
  // 設定は自動保存に残り、再読み込みで戻る。
  await waitForAutosave(page);
  await page.reload();
  const again = await openGraphSettings(page);
  await expect(again.getByLabel('配置方法')).toHaveValue('layered');
  await expect(
    again.getByRole('list', { name: '列の順（左から右）' }).getByRole('listitem'),
  ).toHaveText([/人物/, /ابن عسكر/]);
});

test('FR-VG-02: 地理座標は座標なしのノードを右端の列にまとめ、件数を示す（図から消さない）', async ({
  page,
}) => {
  const drawer = await openGraphSettings(page);
  await drawer.getByLabel('配置方法').selectOption('geo');
  // 緯度・経度の両方が選ばれるまでは計算せず、選ぶよう促す。
  await expect(page.getByTestId('no-coordinates')).toHaveText('緯度・経度の属性を選んでください');
  await drawer.getByLabel('緯度の属性').selectOption('Lat');
  await expect(page.getByTestId('no-coordinates')).toHaveText('緯度・経度の属性を選んでください');
  // 片方だけ選んだ状態を自動保存しても、再読み込みで開ける（プロジェクトが壊れない）。
  await waitForAutosave(page, (saved) =>
    JSON.stringify(saved).includes('"geoAttrs":{"lat":"Lat"}'),
  );
  await page.reload();
  const half = await openGraphSettings(page);
  await expect(half.getByLabel('緯度の属性')).toHaveValue('Lat');
  await expect(half.getByLabel('経度の属性')).toHaveValue('');
  await drawer.getByLabel('経度の属性').selectOption('Lon');
  const note = page.getByTestId('no-coordinates');
  await expect(note).toHaveText(/座標なし 4 件/);
  // 絞り込みで除いた件数の表示とは別の文言。
  await expect(note).not.toHaveText(/絞り込み/);
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(6);
  // 西（コルドバ）は左、北（コルドバ 37.9 度）は上。バグダードは右、南。
  await expect
    .poll(async () => {
      const [p1, p2, n1, ...none] = await centers(page, ['p1', 'p2', 'p3', 'p4', 'o1', 'o2']);
      // 座標なしの 4 ノードは同じ x（右端の列）で、地図の最も右（バグダード）より右にある。
      return (
        p2.x < p1.x &&
        p2.y < p1.y &&
        [n1, ...none].every((c) => c.x > p1.x && Math.abs(c.x - n1.x) < 1)
      );
    })
    .toBe(true);
  await waitForAutosave(page, (saved) => JSON.stringify(saved).includes('"lon":"Lon"'));
  await page.reload();
  const again = await openGraphSettings(page);
  await expect(again.getByLabel('緯度の属性')).toHaveValue('Lat');
  await expect(page.getByTestId('no-coordinates')).toHaveText(/座標なし 4 件/);
});
