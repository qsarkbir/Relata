/**
 * 時間フィルタと暦の表示（T2-05a）の E2E。FR-FL-03、FR-TM-09、FR-FL-08。
 *
 * 見本は公開サンプル（public/samples/maghrib.relata.json。Palladio 式の 1 表）。日付は属性
 * 「Year (AH)」（ヒジュラ暦の年）で、要素の期間（time）は持たない。ノードは 219、エッジは 204。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { appliedRegion, fixturePath, openProject, saveProjectFile, startApp } from './support';

test.use({ locale: 'ja-JP' });

/** 適用中の条件の行。 */
function conditions(page: Page) {
  return page.getByRole('region', { name: '適用中の条件' });
}

/** 時間の節（details）。 */
function timeSection(page: Page) {
  return page.locator('details#filter-time');
}

/** 暦の切り替え（適用中の条件の行）。 */
function calendarSelect(page: Page) {
  return conditions(page).getByLabel('暦');
}

/** 絞り込み後のノード数（適用中の条件の行の「ノード n / 219」から読む）。 */
async function shownNodes(page: Page): Promise<number> {
  const text = (await conditions(page).textContent()) ?? '';
  const m = /ノード\s*([\d,]+)\s*\/\s*219/u.exec(text);
  if (m?.[1] === undefined) throw new Error(`件数を読めない: ${text}`);
  return Number(m[1].replace(/,/gu, ''));
}

async function loadSample(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 800 });
  await startApp(page);
  await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
  await expect(conditions(page)).toContainText('/ 219');
}

/** 開始と終了を入れ、「適用」を押す。 */
async function applyTime(page: Page, start: string, end: string): Promise<void> {
  const section = timeSection(page);
  await section.getByLabel('開始').fill(start);
  await section.getByLabel('終了').fill(end);
  await section.getByRole('button', { name: '適用' }).click();
}

test.describe('日本語の画面', () => {
  test.beforeEach(async ({ page }) => {
    await loadSample(page);
  });

  test('FR-FL-03: 属性の日付で絞り込むと、件数が変わり、一覧に出どころと重なる／収まるが出る', async ({
    page,
  }) => {
    // 【なぜ】孤立ノードを表示する。既定では、エッジが 1 本も残らないノードは数に入らない（FR-FL-05）ので、
    //   時間で絞った結果の数を、ノードそのものの数として読めるようにする。
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
    const total = await shownNodes(page);
    // 出どころの候補は、日付の属性だけ（要素の期間を持つ要素が無いので「要素の期間」は出ない）。
    const source = timeSection(page).getByLabel('日付の出どころ');
    await expect(source.locator('option')).toHaveText(['属性: Year (AH)']);
    // 西暦 1495 年は、ヒジュラ暦 900 年と 901 年にまたがる。
    await applyTime(page, '1495', '1495');
    const overlaps = await shownNodes(page);
    expect(overlaps).toBeGreaterThan(0);
    expect(overlaps).toBeLessThan(total);
    const applied = appliedRegion(page);
    await expect(applied).toContainText('Year (AH)');
    await expect(applied).toContainText('1495年');
    await expect(applied).toContainText('（重なる）');
    // 適用中の条件の行にも期間が出る。
    await expect(conditions(page)).toContainText('時間（ノード）: 1495年（重なる）');
    // 「収まる」にすると、1 年にまたがる幅は 1495 年に収まらないので 0 件になる。即時に反映される。
    await timeSection(page).getByLabel('範囲との関係').selectOption('within');
    await expect(conditions(page)).toContainText('ノード 0 / 219');
    await expect(applied).toContainText('（収まる）');
    // Undo で「重なる」に戻る。
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(conditions(page)).toContainText('（重なる）');
    expect(await shownNodes(page)).toBe(overlaps);
    // 解除すると件数も行も元に戻る。
    await applied.getByRole('button', { name: /を解除する/ }).click();
    await expect(conditions(page)).not.toContainText('時間（ノード）');
    expect(await shownNodes(page)).toBe(total);
  });

  test('FR-FL-03: 読めない入力は、どちらの欄かを示して適用しない', async ({ page }) => {
    const total = await shownNodes(page);
    const section = timeSection(page);
    await applyTime(page, '1500', 'abc');
    const alert = section.getByRole('alert');
    await expect(alert).toContainText('終了');
    await expect(alert).toContainText('日付として読めません');
    await expect(section.getByLabel('終了')).toHaveAttribute('aria-invalid', 'true');
    await expect(section.getByLabel('開始')).toHaveAttribute('aria-invalid', 'false');
    await expect(section.getByLabel('終了')).toHaveAccessibleDescription(/日付として読めません/);
    expect(await shownNodes(page)).toBe(total);
    // 終了が開始より前。
    await applyTime(page, '1500', '1400');
    await expect(alert).toContainText('終了が開始より前です');
    // 両方が空。
    await applyTime(page, '', '');
    await expect(alert).toContainText('開始か終了のどちらかを入力してください');
    expect(await shownNodes(page)).toBe(total);
    await expect(conditions(page)).toContainText('フィルタ 0');
  });

  test('FR-FL-03: 適用前の値は欄の中だけにあり、適用中の条件には出ない', async ({ page }) => {
    const section = timeSection(page);
    await section.getByLabel('開始').fill('1500');
    await expect(section).toContainText('未適用の変更があります');
    await expect(conditions(page)).not.toContainText('1500');
    await expect(appliedRegion(page)).not.toContainText('1500');
    // Enter でも適用できる。
    await section.getByLabel('開始').press('Enter');
    await expect(conditions(page)).toContainText('時間（ノード）');
    await expect(section).not.toContainText('未適用の変更があります');
    // 空の端は開いたまま（データの範囲で埋めない）。
    await expect(section.getByLabel('終了')).toHaveValue('');
  });

  test('FR-TM-09: ヒジュラ暦の入力は、印がなくてもヒジュラ暦の年として読む', async ({ page }) => {
    await calendarSelect(page).selectOption('hijri');
    await applyTime(page, '900', '910');
    await expect(appliedRegion(page)).toContainText('900 AH〜910 AH');
    const hijri = await shownNodes(page);
    expect(hijri).toBeGreaterThan(0);
    // 印つきの入力（アラビア・インド数字と هـ）は同じ範囲になる。
    await applyTime(page, '٩٠٠هـ', '910 AH');
    expect(await shownNodes(page)).toBe(hijri);
    await expect(timeSection(page).getByLabel('開始')).toHaveValue('900');
  });

  test('FR-TM-09: 暦を切り替えると説明と欄の文字が変わり、件数は変わらない', async ({ page }) => {
    await applyTime(page, '1495', '1495');
    const count = await shownNodes(page);
    const applied = appliedRegion(page);
    await expect(applied).toContainText('1495年');
    // ヒジュラ暦: 年ではなく日の幅（西暦の年はヒジュラ暦の年と揃わない）。月の名前と AH が出る。
    await calendarSelect(page).selectOption('hijri');
    await expect(applied).toContainText(/\d AH/);
    await expect(applied).not.toContainText('1495年');
    await expect(conditions(page)).toContainText(/\d AH/);
    expect(await shownNodes(page)).toBe(count);
    // 入力欄の印のない年は、ヒジュラ暦として読む旨が出る。
    await expect(timeSection(page)).toContainText('ヒジュラ暦として読みます');
    // 両方: 西暦にヒジュラ暦を併記する。
    await calendarSelect(page).selectOption('both');
    await expect(applied).toContainText('1495年');
    await expect(applied).toContainText('（');
    await expect(applied).toContainText(/\d AH/);
    expect(await shownNodes(page)).toBe(count);
    // 西暦に戻す。
    await calendarSelect(page).selectOption('gregorian');
    await expect(applied).not.toContainText(/\d AH/);
    expect(await shownNodes(page)).toBe(count);
  });

  test('FR-FL-03: 節の開閉とパネルの開閉で、フィルタと入力の途中の値が変わらない', async ({
    page,
  }) => {
    await applyTime(page, '1495', '1495');
    const count = await shownNodes(page);
    const section = timeSection(page);
    await section.getByLabel('開始').fill('1400');
    await section.locator('summary').click(); // 畳む
    await section.locator('summary').click(); // 開く
    await expect(section.getByLabel('開始')).toHaveValue('1400');
    await page.getByRole('button', { name: '絞り込みを畳む' }).click();
    await page.getByRole('button', { name: /絞り込みを開く/ }).click();
    await expect(section.getByLabel('開始')).toHaveValue('1400');
    expect(await shownNodes(page)).toBe(count);
    // 適用中の条件の行の期間から、時間の節へ移れる（畳んでいても開く）。
    await section.locator('summary').click();
    await conditions(page)
      .getByRole('button', { name: /時間（ノード）/ })
      .click();
    await expect(section).toHaveJSProperty('open', true);
    await expect(section.locator('summary')).toBeFocused();
  });

  test('FR-FL-03 / FR-TM-09: 保存して開き直すと、時間フィルタと暦が戻る', async ({ page }) => {
    await calendarSelect(page).selectOption('hijri');
    await applyTime(page, '900', '910');
    const count = await shownNodes(page);
    const downloading = page.waitForEvent('download');
    await saveProjectFile(page);
    const path = await (await downloading).path();
    const text = readFileSync(path, 'utf8');
    const saved: unknown = JSON.parse(text);
    expect(JSON.stringify(saved)).toContain('"display":{"calendar":"hijri"}');
    // 別の状態にしてから、保存したファイルを開き直す。
    await calendarSelect(page).selectOption('gregorian');
    await appliedRegion(page)
      .getByRole('button', { name: /を解除する/ })
      .click();
    await openProject(page, {
      name: 'time.relata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await expect(calendarSelect(page)).toHaveValue('hijri');
    await expect(appliedRegion(page)).toContainText('900 AH〜910 AH');
    expect(await shownNodes(page)).toBe(count);
    await expect(timeSection(page).getByLabel('開始')).toHaveValue('900');
  });
});

for (const width of [1280, 1024]) {
  test(`FR-FL-03: 英語の表示（幅 ${String(width)}）で時間の節と条件の行がはみ出さない`, async ({
    page,
  }) => {
    await loadSample(page);
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', { name: 'English', exact: true }).click();
    await calendarSelect(page).or(page.getByLabel('Calendar')).first().selectOption('both');
    const section = page.locator('details#filter-time');
    await section.getByLabel('Start').fill('1495');
    await section.getByLabel('End').fill('1496');
    await section.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByRole('region', { name: 'Active filters' })).toContainText('overlaps');
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const panel = document.querySelector('details#filter-time');
      const inputs = [
        ...document.querySelectorAll('details#filter-time input, details#filter-time select'),
      ];
      const box = panel?.getBoundingClientRect();
      return {
        page: doc.scrollWidth - doc.clientWidth,
        controls: inputs.filter((el) => {
          const r = el.getBoundingClientRect();
          return box !== undefined && (r.right > box.right + 1 || r.left < box.left - 1);
        }).length,
      };
    });
    expect(overflow.page).toBeLessThanOrEqual(0);
    expect(overflow.controls).toBe(0);
  });
}

/** 小さな見本（ノード 15）に、期間（time）を足したプロジェクトを作る。 */
function projectWithSpans(view: Record<string, unknown>): {
  name: string;
  mimeType: string;
  buffer: Buffer;
} {
  const source: unknown = JSON.parse(readFileSync(fixturePath('maghrib.relata.json'), 'utf8'));
  if (typeof source !== 'object' || source === null || Array.isArray(source))
    throw new Error('fixture');
  const dataset = (source as { dataset: { nodes: Record<string, unknown>[] } }).dataset; // 理由: 自作の見本の形
  const day = (jdn: number) => ({
    earliest: jdn,
    latest: jdn,
    certainty: 'certain',
    calendar: 'gregorian',
    label: String(jdn),
  });
  // 1 つ目: 1600 年 1 月 1 日から、終わりが分からない期間。2 つ目: 1590 年頃の 1 点。
  const nodes = dataset.nodes.map((n, i) =>
    i === 0
      ? {
          ...n,
          time: {
            kind: 'span',
            start: day(2305448),
            end: { kind: 'missing', reason: 'unrecorded' },
          },
        }
      : i === 1
        ? { ...n, time: { kind: 'span', start: day(2305448 - 3650) } }
        : n,
  );
  return {
    name: 'spans.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...source, dataset: { ...dataset, nodes }, view })),
  };
}

test.describe('開いた端と、ヒジュラ以前の日付', () => {
  test('FR-FL-03: 終了を空にして「収まる」にすると、終わりの分からない期間も通る', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startApp(page);
    await openProject(
      page,
      projectWithSpans({ filter: { filters: [], edgeRule: 'both-ends', showIsolated: true } }),
    );
    const section = timeSection(page);
    await expect(conditions(page)).toContainText('ノード 15 / 15');
    await section.getByLabel('範囲との関係').selectOption('within');
    await applyTime(page, '1600', '');
    // 1590 年の 1 点は開始より前なので除かれる。終わりの分からない期間は、終了が開いているので通る。
    await expect(conditions(page)).toContainText('ノード 14 / 15');
    await expect(conditions(page)).toContainText('1600年1月1日以後（収まる）');
    await expect(section.getByLabel('終了')).toHaveValue('');
    // 終了を入れると、終わりの分からない期間は収まると言えないので除かれる。
    await applyTime(page, '1600', '1650');
    await expect(conditions(page)).toContainText('ノード 13 / 15');
  });

  test('FR-TM-09: ヒジュラ暦の表示でヒジュラ以前の日付を欄に戻して再適用しても、範囲が変わらない', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startApp(page);
    // 西暦 600 年 6 月 1 日（JDN 1940357）以後。ヒジュラ暦の 1 年（西暦 622 年）より前。
    await openProject(
      page,
      projectWithSpans({
        filter: {
          filters: [
            {
              id: 't',
              kind: 'time',
              target: 'node',
              source: { kind: 'span' },
              from: 1940357,
              match: 'overlaps',
              missing: 'include',
            },
          ],
          edgeRule: 'both-ends',
          showIsolated: true,
        },
        display: { calendar: 'hijri' },
      }),
    );
    const section = timeSection(page);
    const start = section.getByLabel('開始');
    await expect(start).toHaveValue(/ BH$/);
    const before = await appliedRegion(page).textContent();
    const count = await conditions(page).textContent();
    await section.getByRole('button', { name: '適用' }).click();
    await expect(start).toHaveValue(/ BH$/);
    expect(await appliedRegion(page).textContent()).toBe(before);
    expect(await conditions(page).textContent()).toBe(count);
    // 西暦の表示に切り替えても、範囲は同じ（西暦 600 年）。
    await calendarSelect(page).selectOption('gregorian');
    await expect(appliedRegion(page)).toContainText('600年6月1日以後');
  });
});
