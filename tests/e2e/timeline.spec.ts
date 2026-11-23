/**
 * 年表ビュー（T2-05b）の E2E。FR-TM-01（棒グラフと範囲選択）、FR-TM-04（幅のある年代）、
 * FR-TM-05（年代なしの件数）、FR-FL-11（年表の範囲選択でフィルタ）、FR-PJ-01（設定の保存と復元）。
 *
 * 見本は公開サンプル（public/samples/maghrib.relata.json）。日付は属性「Year (AH)」（ヒジュラ暦の年。
 * 幅のある日付）で、ノードは 219、エッジは 204（エッジに日付は無い）。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openProject, readAutosave, saveProjectFile, startApp, waitForAutosave } from './support';

test.use({ locale: 'ja-JP' });

function conditions(page: Page) {
  return page.getByRole('region', { name: '適用中の条件' });
}
/** 下の段（左のパネルにも同じ名前の欄があるので、年表の欄はここから探す）。 */
function bottom(page: Page) {
  return page.getByRole('region', { name: '下の段' });
}
function chart(page: Page) {
  return page.getByRole('application', { name: '年表の棒グラフ' });
}
/** 描画の領域全体（ポインタを受ける矩形）。 */
function plot(page: Page): Locator {
  return chart(page).locator('.tl-hit');
}
function noDate(page: Page) {
  return page.getByRole('complementary', { name: /^年代なし/ });
}
function status(page: Page) {
  return page.locator('.timeline-status');
}

async function shownNodes(page: Page): Promise<number> {
  const text = (await conditions(page).textContent()) ?? '';
  const m = /ノード\s*([\d,]+)\s*\/\s*219/u.exec(text);
  if (m?.[1] === undefined) throw new Error(`件数を読めない: ${text}`);
  return Number(m[1].replace(/,/gu, ''));
}

async function loadSample(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startApp(page);
  await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
  await expect(conditions(page)).toContainText('/ 219');
  // 孤立ノードも数える（時間で絞った後の件数を、ノードの数として読むため）。
  await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
}

async function openTimeline(page: Page): Promise<void> {
  await page.getByRole('tab', { name: '年表' }).click();
  await expect(chart(page)).toBeVisible();
  await expect(plot(page)).toBeVisible();
}

/** 描画の領域の、左から ratio の位置（0〜1）の座標。 */
async function pointAt(page: Page, ratio: number): Promise<{ x: number; y: number }> {
  const box = await plot(page).boundingBox();
  if (box === null) throw new Error('描画の領域が見えない');
  return { x: box.x + box.width * ratio, y: box.y + box.height / 2 };
}

async function drag(page: Page, from: number, to: number): Promise<void> {
  const a = await pointAt(page, from);
  const b = await pointAt(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, b.y, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

/** サンプルの先頭 3 ノードの日付を欠損にしたプロジェクト（年代なしの件数を確かめる。サンプルにも日付のないノードが 1 つあるので、合わせて 4）。 */
function undatedProject(): { name: string; mimeType: string; buffer: Buffer } {
  const text = readFileSync('public/samples/maghrib.relata.json', 'utf8');
  const file = JSON.parse(text) as { dataset: { nodes: { attrs: Record<string, unknown> }[] } }; // 理由: 自分たちの見本ファイル
  for (const node of file.dataset.nodes.slice(0, 3)) {
    node.attrs.Year = { kind: 'missing', reason: 'unrecorded' };
  }
  return {
    name: 'undated.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  };
}

/**
 * 日付の属性を 2 つ（Year と、同じ値の Year2）持ち、ノードの時間フィルタを出どころ別に 2 件持つプロジェクト。
 * 先頭は Year2 のフィルタ（全期間）、2 件目は Year のフィルタ（全期間）。
 */
function twoTimeFiltersProject(): { name: string; mimeType: string; buffer: Buffer } {
  const text = readFileSync('public/samples/maghrib.relata.json', 'utf8');
  // 理由: 自分たちの見本ファイル。必要な項目だけを型にする。
  const file = JSON.parse(text) as {
    dataset: { schema: Record<string, unknown>[]; nodes: { attrs: Record<string, unknown> }[] };
    view: { filter: { filters: unknown[] } };
  };
  file.dataset.schema.push({ key: 'Year2', label: 'Year2', appliesTo: 'node', valueType: 'date' });
  for (const node of file.dataset.nodes) node.attrs.Year2 = node.attrs.Year;
  const wide = { from: 0, to: 5_000_000, match: 'overlaps', missing: 'include' };
  file.view.filter.filters = [
    { id: 'other', kind: 'time', target: 'node', source: { kind: 'attr', attr: 'Year2' }, ...wide },
    { id: 'same', kind: 'time', target: 'node', source: { kind: 'attr', attr: 'Year' }, ...wide },
  ];
  return {
    name: 'two-time-filters.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(file)),
  };
}

test.describe('年表', () => {
  test.beforeEach(async ({ page }) => {
    await loadSample(page);
  });

  test('FR-TM-01: 下の段の「年表」タブで棒グラフが開き、閉じても中身は残る', async ({ page }) => {
    await openTimeline(page);
    // 日付の出どころの既定は、最初の日付の属性（サンプルは要素の期間を持たない）。
    await expect(bottom(page).getByLabel('日付の出どころ')).toHaveValue('attr:Year');
    await expect(bottom(page).getByLabel('区切り')).toHaveValue('10');
    expect(
      await chart(page).locator('.tl-bar-contained, .tl-bar-spanning').count(),
    ).toBeGreaterThan(0);
    // 凡例は色だけでなく、模様と文字でも区別する。
    await expect(page.locator('.timeline-legend')).toContainText('幅のある年代');
    // 閉じても描いたまま（隠すだけ）。
    await page.getByRole('button', { name: '下の段を閉じる' }).click();
    await expect(chart(page)).toBeHidden();
    await expect(page.locator('[aria-label="年表の棒グラフ"]')).toBeAttached();
  });

  test('FR-TM-01: 区切りの幅を替えると、区切りの数が変わる', async ({ page }) => {
    await openTimeline(page);
    const barsAt = async (): Promise<number> => chart(page).locator('svg g > title').count();
    const ten = await barsAt();
    await bottom(page).getByLabel('区切り').selectOption('100');
    const hundred = await barsAt();
    expect(hundred).toBeLessThan(ten);
    await bottom(page).getByLabel('区切り').selectOption('1');
    expect(await barsAt()).toBeGreaterThan(ten);
  });

  test('FR-TM-01: 暦の表示に従う（ヒジュラ暦なら AH の目盛り、区切りもヒジュラ暦の年）', async ({
    page,
  }) => {
    await openTimeline(page);
    await expect(page.getByText('区切りは西暦の年の境界で数えます。')).toBeVisible();
    await expect(chart(page).locator('.tl-tick').first()).toContainText('年');
    await conditions(page).getByLabel('暦').selectOption('hijri');
    await expect(page.getByText('区切りはヒジュラ暦の年の境界で数えます。')).toBeVisible();
    await expect(chart(page).locator('.tl-tick').first()).toContainText('AH');
  });

  test('FR-FL-11: ドラッグを離した時点で時間フィルタが入り、2 回目は置き換わり、Undo で戻る', async ({
    page,
  }) => {
    await openTimeline(page);
    const total = await shownNodes(page);
    await drag(page, 0.3, 0.6);
    await expect(conditions(page)).toContainText('時間（ノード）');
    const first = await shownNodes(page);
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(total);
    // 適用中の範囲が年表にも出る（FilterState から導き出した表示）。
    await expect(status(page)).toContainText('適用中の範囲');
    // もう一度ドラッグすると、同じ時間フィルタを置き換える（フィルタは 1 件のまま）。
    await drag(page, 0.7, 0.9);
    await expect(conditions(page)).toContainText('フィルタ 1');
    const second = await shownNodes(page);
    expect(second).not.toBe(total);
    // Undo で 1 回目の状態に戻る。
    await page.getByRole('button', { name: '元に戻す' }).click();
    expect(await shownNodes(page)).toBe(first);
    await page.getByRole('button', { name: '元に戻す' }).click();
    expect(await shownNodes(page)).toBe(total);
    await expect(conditions(page)).not.toContainText('時間（ノード）');
  });

  test('FR-FL-11: 絞り込んでも軸は変わらず、除いた分が残る。範囲を解除すると元に戻る', async ({
    page,
  }) => {
    await openTimeline(page);
    const bars = chart(page).locator('svg g > title');
    const before = await bars.count();
    await drag(page, 0.3, 0.5);
    await expect(conditions(page)).toContainText('時間（ノード）');
    expect(await bars.count()).toBe(before);
    expect(await chart(page).locator('.tl-total').count()).toBeGreaterThan(0);
    await page.getByRole('button', { name: '範囲を解除' }).click();
    await expect(conditions(page)).not.toContainText('時間（ノード）');
    await expect(chart(page).locator('.tl-total')).toHaveCount(0);
  });

  test('FR-FL-11: キーボードだけで範囲を選んで絞り込める（Shift で広げ、Enter で適用、Escape で選びなおし）', async ({
    page,
  }) => {
    await openTimeline(page);
    const total = await shownNodes(page);
    await chart(page).focus();
    await page.keyboard.press('Home');
    await expect(status(page)).toContainText('区切り');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(status(page)).toContainText('選択中');
    // Escape で起点がカーソルに戻り、1 つの区切りに戻る。
    await page.keyboard.press('Escape');
    await expect(status(page)).not.toContainText('選択中');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Enter');
    await expect(conditions(page)).toContainText('時間（ノード）');
    expect(await shownNodes(page)).toBeLessThan(total);
  });

  test('FR-FL-11: 年表で選んだ範囲は、左のパネルの時間フィルタと同じ 1 件', async ({ page }) => {
    await openTimeline(page);
    await drag(page, 0.2, 0.4);
    const section = page.locator('details#filter-time');
    await expect(section.getByLabel('開始')).not.toHaveValue('');
    await expect(section.getByLabel('終了')).not.toHaveValue('');
    await expect(conditions(page)).toContainText('フィルタ 1');
  });

  test('FR-TM-01: エッジに日付が無いとき、年表は描けない理由を文で示す', async ({ page }) => {
    await openTimeline(page);
    await bottom(page).getByLabel('対象').selectOption('edge');
    await expect(
      page.getByText('日付を持つ要素も日付の属性もないため、年表を描けません。'),
    ).toBeVisible();
    await expect(chart(page)).toBeHidden();
    // 日付がまったく無いときは、絞り込み後の全要素が年代なし（0 件とは出さない）。
    await expect(noDate(page)).toContainText('年代なし 204 件');
  });
});

test.describe('年代なしの件数と保存', () => {
  test('FR-TM-05: データが無いときは「日付が無い」ではなくデータなしの文を出し、年代なしの欄を出さない', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await startApp(page);
    await page.getByRole('tab', { name: '年表', exact: true }).click();
    await expect(bottom(page)).toContainText('データがありません');
    await expect(bottom(page)).not.toContainText('年表を描けません');
    await expect(noDate(page)).toHaveCount(0);
  });

  test('FR-TM-05: 年代のないノードの件数を軸の外に示し、絞り込みで除いた件数とは別の数', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await startApp(page);
    await openProject(page, undatedProject());
    await expect(conditions(page)).toContainText('/ 219');
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
    await openTimeline(page);
    await expect(noDate(page)).toContainText('年代なし 4 件');
    // 軸の外（別の欄）にあり、棒の中には入らない。
    await expect(chart(page).getByText('年代なし')).toHaveCount(0);
    // 年表で絞り込むと、年代なしの要素は（欠損は除く設定のため）絞り込みで除かれるが、
    // 年代なしの件数は「絞り込み後の集合の中の数」なので 0 になり、絞り込む前の数が添えられる。
    await drag(page, 0.2, 0.6);
    await expect(conditions(page)).toContainText('時間（ノード）');
    await expect(noDate(page)).toContainText('年代なし 0 件');
    await expect(noDate(page)).toContainText('絞り込む前は 4 件');
  });

  test('FR-PJ-01: 区切りの幅と出どころは保存・自動保存・復元で往復する', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await startApp(page);
    await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
    await expect(conditions(page)).toContainText('/ 219');
    await openTimeline(page);
    await bottom(page).getByLabel('区切り').selectOption('25');
    // 【なぜ】SavedProject 型は年表の項目を宣言しないので、自動保存の JSON を文字で読む。
    await waitForAutosave(page);
    await expect
      .poll(async () => (await readAutosave(page)) ?? '')
      .toContain('"timeline":{"target":"node","width":25');
    // 再読み込みで自動保存から復元される。
    await page.reload();
    await expect(conditions(page)).toContainText('/ 219');
    await page.getByRole('tab', { name: '年表' }).click();
    await expect(bottom(page).getByLabel('区切り')).toHaveValue('25');
    // 保存したファイルにも入り、読み込むと戻る。
    await bottom(page).getByLabel('区切り').selectOption('100');
    const downloading = page.waitForEvent('download');
    await saveProjectFile(page);
    const download = await downloading;
    const text = readFileSync(await download.path(), 'utf8');
    expect(text).toContain('"width":100');
    await bottom(page).getByLabel('区切り').selectOption('1');
    await openProject(page, {
      name: download.suggestedFilename(),
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await page.getByRole('tab', { name: '年表' }).click();
    await expect(bottom(page).getByLabel('区切り')).toHaveValue('100');
  });
});

test.describe('出どころの違う時間フィルタと、指している区切り', () => {
  test('FR-FL-11: 同じ対象に出どころの違う時間フィルタが複数あるとき、今の出どころのものを帯で示し、範囲を選ぶとそれだけを置き換える', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await startApp(page);
    await openProject(page, twoTimeFiltersProject());
    await expect(conditions(page)).toContainText('フィルタ 2');
    await openTimeline(page);
    await bottom(page).getByLabel('日付の出どころ').selectOption({ label: '属性: Year (AH)' });
    // 2 件目（同じ出どころ）のフィルタが年表の帯と状態の文に出る。
    await expect(chart(page).locator('.tl-band')).toHaveCount(1);
    await expect(status(page)).toContainText('適用中の範囲');
    await drag(page, 0.3, 0.6);
    // 置き換えたのは Year のフィルタだけで、Year2 のフィルタは元のまま残る（件数は 2 件のまま）。
    await expect(conditions(page)).toContainText('フィルタ 2');
    await waitForAutosave(page);
    // 【なぜ】自動保存の JSON から、各フィルタの ID・出どころ・終わりを読む（型は必要な項目だけ）。
    const readFilters = async () => {
      const saved = JSON.parse((await readAutosave(page)) ?? '{}') as {
        view?: { filter?: { filters?: { id: string; source: { attr?: string }; to?: number }[] } };
      };
      return saved.view?.filter?.filters ?? [];
    };
    await expect
      .poll(async () => (await readFilters()).find((f) => f.id === 'same')?.to)
      .not.toBe(5_000_000);
    const filters = await readFilters();
    expect(filters.map((f) => [f.id, f.source.attr])).toEqual([
      ['other', 'Year2'],
      ['same', 'Year'],
    ]);
    expect(filters.find((f) => f.id === 'other')?.to).toBe(5_000_000);
  });

  test('FR-TM-01: 棒の上にポインタを置くと、その区切りの件数を別の行に示し、離れると消える。適用中の範囲は隠さない', async ({
    page,
  }) => {
    await loadSample(page);
    await openTimeline(page);
    const hover = page.locator('.timeline-hover');
    const p = await pointAt(page, 0.5);
    await page.mouse.move(p.x, p.y);
    await expect(hover).toContainText('区切り');
    await expect(hover).toContainText('件');
    // 範囲を選んで離した後、ポインタが棒の上に残っていても、適用中の範囲の文は出たまま。
    await drag(page, 0.3, 0.6);
    await expect(status(page)).toContainText('適用中の範囲');
    // 離した後にポインタを動かすと、指している区切りの文がまた出るが、適用中の範囲の文はそのまま残る。
    // 【なぜ】適用すると「範囲を解除」のボタンが出て、描画の領域の位置が変わりうるので、座標を測り直す。
    const q = await pointAt(page, 0.5);
    await page.mouse.move(q.x, q.y);
    await expect(hover).toContainText('区切り');
    await expect(status(page)).toContainText('適用中の範囲');
    await page.mouse.move(q.x, q.y - 400);
    await expect(hover).toHaveText('');
    await expect(status(page)).toContainText('適用中の範囲');
  });
});
