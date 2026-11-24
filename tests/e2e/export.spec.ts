import { expect, test, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { exportFigureAs, openExportDialog, openProject, saveButton, startApp } from './support';

test.use({ locale: 'ja-JP' });

/** 形式のボタンを押して、保存されたファイルの中身を返す。 */
async function download(page: Page, format: 'SVG' | 'PNG' | 'PDF' | 'GraphML' | 'GEXF') {
  const pending = page.waitForEvent('download');
  await exportFigureAs(page, format);
  const file: Download = await pending;
  const path = await file.path();
  return { name: file.suggestedFilename(), bytes: readFileSync(path) };
}

/** PNG の幅と高さ（IHDR）。 */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test.describe('T2-08: 書き出し', () => {
  test('FR-OUT-01 / FR-PJ-01: 保存のダイアログはプロジェクトだけ。図・グラフ・CSV の書き出しは「書き出し」にある', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await saveButton(page).click();
    const save = page.getByRole('dialog', { name: '保存', exact: true });
    await expect(save.getByRole('button', { name: /^プロジェクトを保存/ })).toBeVisible();
    await expect(save.getByRole('button', { name: /SVG|PNG|PDF|図を保存/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    const dialog = await openExportDialog(page);
    for (const name of ['SVG', 'PNG', 'PDF', 'GraphML', 'GEXF', 'ノードCSV', 'エッジCSV']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled();
    }
  });

  test('FR-OUT-01 / FR-OUT-07: SVG に凡例と出典表記（データ名・作成日・「Relata で作成」）を入れる／入れない', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    const withLegend = await download(page, 'SVG');
    expect(withLegend.name).toMatch(/\.svg$/);
    const svg = withLegend.bytes.toString('utf8');
    expect(svg).toContain('id="legend"');
    expect(svg).toContain('Relata で作成');
    expect(svg).toMatch(/作成日: \d{4}-\d{2}-\d{2}/);
    expect(svg).toContain('データ: ');
    // 凡例の見出しは日本語。向きの表現（矢印）の説明が入る。
    expect(svg).toContain('凡例');
    expect(svg).toContain('有向（矢印の先が終点）');
    // 構造: 凡例の <g> はラベルの <g> の後ろ。編集しやすいよう、<g> の入れ子は 1 段。
    expect(svg.indexOf('id="labels"')).toBeLessThan(svg.indexOf('id="legend"'));

    const dialog = await openExportDialog(page);
    await dialog.getByLabel('凡例を入れる', { exact: false }).uncheck();
    await dialog.getByLabel('出典表記を入れる', { exact: false }).uncheck();
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'SVG', exact: true }).click();
    const plain = readFileSync(await (await pending).path(), 'utf8');
    expect(plain).not.toContain('id="legend"');
    expect(plain).not.toContain('Relata で作成');
  });

  test('FR-OUT-07: 凡例は英語に切り替えると英語になり、凡例だけ・出典だけも選べる', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await page.getByRole('button', { name: 'English', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export' });
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await dialog.getByLabel('Include a legend', { exact: false }).uncheck();
    const pending = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'SVG', exact: true }).click();
    const svg = readFileSync(await (await pending).path(), 'utf8');
    expect(svg).toContain('Made with Relata');
    expect(svg).toMatch(/Created: \d{4}-\d{2}-\d{2}/);
    expect(svg).not.toContain('Directed (arrowhead');
  });

  test('FR-OUT-03: PNG は倍率に従った大きさで保存される（1倍と 2倍）', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    const dialog = await openExportDialog(page);
    await dialog.getByLabel('PNG の倍率').selectOption('1');
    const pending1 = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'PNG', exact: true }).click();
    const one = await pending1;
    expect(one.suggestedFilename()).toMatch(/\.png$/);
    const size1 = pngSize(readFileSync(await one.path()));
    await dialog.getByLabel('PNG の倍率').selectOption('2');
    const pending2 = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'PNG', exact: true }).click();
    const size2 = pngSize(readFileSync(await (await pending2).path()));
    expect(size1.width).toBeGreaterThan(100);
    expect(Math.abs(size2.width - size1.width * 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(size2.height - size1.height * 2)).toBeLessThanOrEqual(1);
  });

  test('FR-OUT-04 / NFR-02: PDF は %PDF で始まり、フォントはこのサイトから初回だけ読み込む（外部通信なし）', async ({
    page,
  }) => {
    const hosts = new Set<string>();
    const fonts: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      hosts.add(url.host);
      if (url.pathname.includes('/fonts/')) fonts.push(url.pathname);
    });
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    // 書き出す前には、フォントを読み込んでいない。
    expect(fonts).toEqual([]);
    const dialog = await openExportDialog(page);
    await expect(dialog.getByText('初回だけ読み込みます', { exact: false })).toBeVisible();
    const first = await download(page, 'PDF');
    expect(first.name).toMatch(/\.pdf$/);
    expect(first.bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(first.bytes.subarray(-6).toString('latin1')).toContain('%%EOF');
    expect(fonts.filter((f) => f.endsWith('NotoSans-Regular.ttf'))).toHaveLength(1);
    expect(fonts.filter((f) => f.endsWith('NotoSansJP-Regular.ttf'))).toHaveLength(1);
    expect(fonts.filter((f) => f.endsWith('NotoNaskhArabic-Regular.ttf'))).toHaveLength(1);
    // 2 回目は読み込み直さない。
    await download(page, 'PDF');
    expect(fonts).toHaveLength(3);
    // 【なぜ】比べる相手は、アプリを開いた先のホスト（手元のサーバーでも公開サイトでも同じテストを使うため）。
    expect([...hosts]).toEqual([new URL(page.url()).host]);
  });

  test('FR-OUT-05: GraphML と GEXF は、表示中のグラフ（アラビア文字のラベル、向き、重み）を含む', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    const graphml = await download(page, 'GraphML');
    expect(graphml.name).toMatch(/\.graphml$/);
    const gml = graphml.bytes.toString('utf8');
    expect(gml).toContain('xmlns="http://graphml.graphdrawing.org/xmlns"');
    expect(gml).toContain('xsi:schemaLocation=');
    // 外部のビューア（yEd、yFiles、Gephi）が図の見た目で開けるよう、位置・形・色・ラベルを含む。
    expect(gml).toContain('xmlns:y="http://www.yworks.com/xml/graphml"');
    expect((gml.match(/<y:ShapeNode>/g) ?? []).length).toBe(14);
    expect(gml).toMatch(/<y:Geometry x="-?[\d.]+" y="-?[\d.]+" width="[\d.]+" height="[\d.]+"\/>/);
    expect(gml).toMatch(/<y:Fill color="#[0-9A-F]{6}"/);
    expect(gml).toContain('>ابن عسكر</y:NodeLabel>');
    expect(gml).toContain('<y:Arrows source="none" target="standard"/>');
    expect(gml).toContain('attr.name="size"');
    expect(gml).toContain('ابن عسكر');
    expect(gml).toContain('edgedefault="directed"');
    expect((gml.match(/<node /g) ?? []).length).toBe(14);
    const gexf = await download(page, 'GEXF');
    expect(gexf.name).toMatch(/\.gexf$/);
    const gx = gexf.bytes.toString('utf8');
    expect(gx).toContain('version="1.3"');
    expect(gx).toContain('label="ابن عسكر"');
    expect(gx).toContain('xmlns:viz="http://gexf.net/1.3/viz"');
    expect((gx.match(/<viz:position /g) ?? []).length).toBe(14);
    expect(gx).toContain('<viz:thickness ');
    expect((gx.match(/<node /g) ?? []).length).toBe(14);
    expect((gx.match(/<edge /g) ?? []).length).toBeGreaterThan(0);
  });

  test('§9.1: 指標の CSV の最後の列に、グラフの設定（重み・射影）が残る', async ({ page }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await expect(page.getByTestId('metric-global-nodeCount')).toBeVisible();
    const dialog = await openExportDialog(page);
    const button = dialog.getByRole('button', { name: '全体指標CSV', exact: true });
    await expect(button).toBeEnabled();
    const pending = page.waitForEvent('download');
    await button.click();
    const text = readFileSync(await (await pending).path(), 'utf8');
    const header = text.slice(1).split('\r\n')[0] ?? '';
    expect(
      header.endsWith(
        'setting.weight,setting.selfLoops,setting.projection.target,setting.projection.via,setting.projection.method',
      ),
    ).toBe(true);
  });
});
