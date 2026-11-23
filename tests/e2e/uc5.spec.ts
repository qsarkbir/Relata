/**
 * UC-5: ヒジュラ暦で日付が記された史料や、年代に幅のある史料（「1050 年頃」など）を読み込み、
 * 西暦に換算して、幅を保ったまま時間で絞り込み、再生して、保存と再読込まで、利用者の操作だけで通す。
 *
 * 対応する要件: FR-IN-05（日付の取り込み）、FR-DM-05（幅のある日付）、FR-FL-03（時間フィルタ。重なる／収まる）、
 * FR-TM-01/04/05（年表、幅、年代なし）、FR-TM-02/03（再生は表示だけ）、FR-TM-09（暦の切り替え）、
 * FR-PJ-01（保存と復元）。
 *
 * 見本（このファイルの中で作る）: 人物 7。属性 Active（活動の年代。日付）は
 * - a1「1050頃」: 「頃」の既定の幅は前後 5 年なので 1045〜1055 年。確からしさは「おそらく」。
 * - a2「1100-1150」: 範囲。1100〜1150 年。
 * - a3「505 AH」: ヒジュラ暦の年。西暦 1111〜1112 年ごろに換算される。
 * - a4「1200」: 西暦 1200 年。
 * - a5「600-650 AH」: ヒジュラ暦の範囲。西暦 1203〜1253 年ごろ。
 * - a6「1300」、a7: 欠損（年代なし）。
 * 【歴史の事情】元の表記（「505 AH」など）は書き換えない。換算した値は年表と時間フィルタに現れる。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openProject, saveProjectFile, startApp } from './support';
import { importPair } from './uc-support';

test.use({ locale: 'ja-JP' });

const NODES = [
  'id,label,Active',
  'a1,Ahmad,1050頃',
  'a2,Badr,1100-1150',
  'a3,Chams,505 AH',
  'a4,Daud,1200',
  'a5,Ezra,600-650 AH',
  'a6,Fatima,1300',
  'a7,Ghazi,',
].join('\n');
const EDGES = ['source,target', 'a1,a2', 'a2,a3', 'a3,a4', 'a4,a5', 'a5,a6', 'a6,a7'].join('\n');

function conditions(page: Page): Locator {
  return page.getByRole('region', { name: '適用中の条件' });
}
function bottom(page: Page): Locator {
  return page.getByRole('region', { name: '下の段' });
}
function calendar(page: Page): Locator {
  return conditions(page).getByLabel('暦');
}
function timeSection(page: Page): Locator {
  return page.locator('details#filter-time');
}
function nodes(page: Page): Locator {
  return page.locator('.graph-canvas #graph-view-nodes > [data-id]');
}
function controls(page: Page): Locator {
  return bottom(page).getByRole('group', { name: '時間の再生' });
}
function faded(page: Page): Locator {
  return page.locator('#graph-view-nodes [data-out-of-time="true"]');
}
/** 年表の棒の説明（<title>）。区切りごとの件数と、幅のある年代の件数が読める。 */
async function barTitles(page: Page): Promise<string[]> {
  const texts = await bottom(page)
    .locator('svg g > title')
    .evaluateAll((els) => els.map((el) => el.textContent));
  return texts;
}
/** 区切りの名前（「1110年〜1119年」など）から棒の説明を 1 つ選ぶ。 */
async function bar(page: Page, period: string): Promise<string> {
  const found = (await barTitles(page)).find((t) => t.startsWith(period));
  if (found === undefined) throw new Error(`棒が無い: ${period}`);
  return found;
}
async function applyTime(page: Page, start: string, end: string): Promise<void> {
  const section = timeSection(page);
  await section.getByLabel('開始').fill(start);
  await section.getByLabel('終了').fill(end);
  await section.getByRole('button', { name: '適用' }).click();
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await startApp(page);
  await importPair(page, NODES, EDGES, { Active: { type: 'date' } });
  await expect(conditions(page)).toContainText('/ 7');
  // 所属のない（エッジのない）ノードも数える。時間で絞った結果を、ノードそのものの数として読むため。
  await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
  await expect(conditions(page)).toContainText('ノード 7 / 7');
});

test('UC-5 / FR-DM-05 / FR-TM-01 / FR-TM-04 / FR-TM-05 / FR-TM-09: 元の表記は保ち、西暦に換算した幅を年表で確かめ、暦を切り替える', async ({
  page,
}) => {
  // --- 表: 元の表記のまま（書き換えない）。「頃」は確からしさ「おそらく」として読まれる ---
  await page.getByRole('tab', { name: '表', exact: true }).click();
  const cells = bottom(page).getByRole('table').locator('tbody');
  await expect(cells).toContainText('1050頃 (おそらく)');
  await expect(cells).toContainText('505 AH');
  await expect(cells).toContainText('600-650 AH');
  await expect(cells).toContainText('1100-1150');
  await expect(cells).toContainText('（欠損: 記載なし）');

  // --- 年表: 西暦に換算された幅（10 年区切り）---
  await page.getByRole('tab', { name: '年表' }).click();
  await expect(page.getByRole('application', { name: '年表の棒グラフ' })).toBeVisible();
  // 「1050頃」は前後 5 年の 1045〜1055 年なので、1040 年代と 1050 年代の 2 つの区切りにまたがる。
  await expect.poll(() => bar(page, '1040年〜1049年')).toContain('1 件（うち幅のある年代 1 件');
  expect(await bar(page, '1050年〜1059年')).toContain('1 件（うち幅のある年代 1 件');
  // 「505 AH」は 1111〜1112 年ごろに換算される。範囲「1100-1150」と合わせて 1110 年代は 2 件。
  expect(await bar(page, '1110年〜1119年')).toContain('2 件（うち幅のある年代 1 件');
  // 「1300」は幅のない 1 点。「600-650 AH」は 1203〜1253 年ごろ（1200 年代の 2 件は 1200 と 600 AH）。
  expect(await bar(page, '1300年〜1309年')).toContain('1 件（うち幅のある年代 0 件');
  expect(await bar(page, '1200年〜1209年')).toContain('2 件');
  expect(await bar(page, '1250年〜1259年')).toContain('1 件（うち幅のある年代 1 件');
  // 年代のない a7 は、区切りには入らず、軸の外の件数に出る（FR-TM-05）。
  await expect(page.getByRole('complementary', { name: /^年代なし/ })).toContainText(
    '年代なし 1 件',
  );
  await expect(bottom(page).locator('.timeline-legend')).toContainText('幅のある年代');

  // --- 暦の切り替え（FR-TM-09）: 年表の目盛りと区切りがヒジュラ暦になる。元の値は変わらない ---
  await expect(bottom(page).locator('.tl-tick').first()).toContainText('年');
  await calendar(page).selectOption('hijri');
  await expect(bottom(page).getByText('区切りはヒジュラ暦の年の境界で数えます。')).toBeVisible();
  await expect(bottom(page).locator('.tl-tick').first()).toContainText('AH');
  // 西暦の区切りだった 1110 年代（503〜513 AH）が、ヒジュラ暦の区切りで数え直される（この区切りには a3 の 505 AH が入る）。
  expect((await barTitles(page)).some((t) => t.includes('AH'))).toBe(true);
  // 西暦とヒジュラ暦の併記: 区切りの説明に両方が出る。
  await calendar(page).selectOption('both');
  expect(await bar(page, '1110年〜1119年')).toContain('（503 AH〜513 AH）');
  // 暦を替えても、データの件数と元の表記は変わらない。
  await expect(conditions(page)).toContainText('ノード 7 / 7');
  await page.getByRole('tab', { name: '表', exact: true }).click();
  await expect(cells).toContainText('505 AH');
  await expect(cells).toContainText('1050頃 (おそらく)');
  await calendar(page).selectOption('gregorian');
});

test('UC-5 / FR-FL-03: 幅を保ったまま時間で絞り込む。幅が範囲に重なる要素が残り、「収まる」にすると外れる', async ({
  page,
}) => {
  // 範囲 1052〜1060 年。a1「1050頃」は幅が 1045〜1055 年なので、点（1050 年）では外れるが、幅が重なるので残る。
  await applyTime(page, '1052', '1060');
  await expect(conditions(page)).toContainText('時間（ノード）: 1052年〜1060年（重なる）');
  await expect(conditions(page)).toContainText('ノード 1 / 7');
  await expect(nodes(page)).toHaveCount(1);
  // 「収まる」にすると、幅が範囲からはみ出す a1 は外れる（即時に反映される）。
  await timeSection(page).getByLabel('範囲との関係').selectOption('within');
  await expect(conditions(page)).toContainText('ノード 0 / 7');
  // 範囲を 1040〜1060 年にすると、a1 の幅（1045〜1055）が収まるので残る。
  await applyTime(page, '1040', '1060');
  await expect(conditions(page)).toContainText('ノード 1 / 7');
  // 重なる、に戻して、ヒジュラ暦（505 AH）と、範囲（1100-1150）を同時に拾う。
  await timeSection(page).getByLabel('範囲との関係').selectOption('overlaps');
  await applyTime(page, '1105', '1115');
  // a2（1100〜1150）と a3（505 AH = 1111〜1112 年ごろ）。
  await expect(conditions(page)).toContainText('ノード 2 / 7');
  // 暦をヒジュラ暦にして、ヒジュラ暦の年で範囲を入れる: 600〜650 AH は a5（600-650 AH）と、1203 年ごろ以降の重なり。
  await calendar(page).selectOption('hijri');
  await applyTime(page, '600', '650');
  await expect(conditions(page)).toContainText('ノード 1 / 7');
  await expect(nodes(page)).toHaveCount(1);
  // 日付が欠損の a7 は、既定では絞り込みから除かれる（含めるかどうかは選べる）。
  await expect(page.getByRole('region', { name: '適用中のフィルタ' })).toContainText('AH');
});

test('UC-5 / FR-TM-02 / FR-TM-03: 時間の再生は表示だけを変え、件数と表の行数は変わらない', async ({
  page,
}) => {
  await page.getByRole('tab', { name: '表', exact: true }).click();
  const rows = bottom(page).getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(7);
  await page.getByRole('tab', { name: '年表' }).click();
  await expect(faded(page)).toHaveCount(0);
  await controls(page).getByRole('button', { name: '次のコマ' }).click();
  // 先頭の区切りまでの累積: まだ始まっていない多くのノードが薄くなる。消えてはいない。
  await expect.poll(() => faded(page).count()).toBeGreaterThan(0);
  await expect(nodes(page)).toHaveCount(7);
  await expect(page.getByTestId('time-fade-note')).toContainText('件数と表は変わりません');
  await expect(conditions(page)).toContainText('ノード 7 / 7');
  await expect(conditions(page)).toContainText('フィルタ 0');
  await page.getByRole('tab', { name: '表', exact: true }).click();
  await expect(rows).toHaveCount(7);
  // 時刻を解除すると薄い表示も消える。
  await page.getByRole('tab', { name: '年表' }).click();
  await controls(page).getByRole('button', { name: '時刻を解除' }).click();
  await expect(faded(page)).toHaveCount(0);
});

test('UC-5 / FR-PJ-01 / FR-FL-03 / FR-TM-09: 保存して読み込み直すと、時間フィルタと表示の暦が戻る', async ({
  page,
}) => {
  await calendar(page).selectOption('hijri');
  await applyTime(page, '500', '510');
  // a2（493〜545 AH ごろ）と a3（505 AH）。
  await expect(conditions(page)).toContainText('ノード 2 / 7');
  await page.getByRole('tab', { name: '年表' }).click();
  await controls(page).getByRole('button', { name: '次のコマ' }).click();
  const stateText = (await controls(page).getByTestId('time-state').textContent()) ?? '';
  const pending = page.waitForEvent('download');
  await saveProjectFile(page);
  const saved = readFileSync(await (await pending).path(), 'utf8');
  expect(saved).toContain('"calendar":"hijri"');
  expect(saved).toContain('"kind":"time"');

  // 別の状態に変えてから開く（フィルタを外し、暦を戻す）。
  await page
    .getByRole('region', { name: '適用中のフィルタ' })
    .getByRole('button', { name: /を解除する/ })
    .click();
  await calendar(page).selectOption('gregorian');
  await controls(page).getByRole('button', { name: '時刻を解除' }).click();
  await expect(conditions(page)).toContainText('ノード 7 / 7');
  await openProject(page, {
    name: 'uc5.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(saved),
  });
  await expect(calendar(page)).toHaveValue('hijri');
  await expect(conditions(page)).toContainText('ノード 2 / 7');
  await expect(conditions(page)).toContainText('AH');
  await expect(nodes(page)).toHaveCount(2);
  await page.getByRole('tab', { name: '年表' }).click();
  await expect(controls(page).getByTestId('time-state')).toHaveText(stateText);
});
