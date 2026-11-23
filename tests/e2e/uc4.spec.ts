/**
 * UC-4: 欠損の多いデータで、どの属性・どの時期に欠損が偏っているかを確かめ、欠損を含めた場合と
 * 除いた場合でネットワークの見え方を比べる。利用者の操作だけで通す。
 *
 * 対応する要件: FR-IN-07（欠損の記号と理由）、FR-DM-04（欠損の理由）、FR-VG-12（欠損の可視化）、
 * FR-FL-06（欠損の扱い）、FR-OUT-01/07（凡例つきの書き出し）。
 *
 * 見本（このファイルの中で作る）: 人物 10、エッジ 10（鎖状 9 本 + 1 本）。属性は
 * - Place（地名）: 古い世代（生年 1100 以前）に欠損が偏る。n1、n2、n4、n10 は空欄（記載なし）、n3 は「□」（判読不能）。
 * - Born（生年。日付）: n10 だけ欠損。
 * - Rank（序列。数値）: n2、n4、n7 が欠損。
 */
import { expect, test, type Page } from '@playwright/test';
import { appliedRegion, counts, openAttr, openGraphSection, startApp } from './support';
import { downloadText, importPair } from './uc-support';

test.use({ locale: 'ja-JP' });

const NODES = [
  'id,label,Place,Born,Rank',
  'n1,Ahmad,,1000,5',
  'n2,Badr,,1020,',
  'n3,Chams,□,1050,3',
  'n4,Daud,,1100,',
  'n5,Ezra,Cairo,1120,8',
  'n6,Fatima,Cairo,1150,2',
  'n7,Ghazi,Fes,1200,',
  'n8,Hind,Fes,1220,9',
  'n9,Idris,Fes,1250,4',
  'n10,Jamal,,,6',
].join('\n');
const EDGES = [
  'source,target',
  'n1,n2',
  'n2,n3',
  'n3,n4',
  'n4,n5',
  'n5,n6',
  'n6,n7',
  'n7,n8',
  'n8,n9',
  'n9,n10',
  'n1,n3',
].join('\n');

function bottom(page: Page) {
  return page.getByRole('region', { name: '下の段' });
}
function dashed(page: Page) {
  return page.locator('.graph-canvas svg [stroke-dasharray]');
}

test('UC-4 / FR-VG-12: 欠損率の一覧で、属性ごと・時期ごとの偏りを確かめ、破線で図に出す', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await startApp(page);
  await importPair(
    page,
    NODES,
    EDGES,
    { Place: { type: 'category' }, Born: { type: 'date' }, Rank: { type: 'number' } },
    {},
    [{ symbol: '□', reason: 'illegible' }],
  );
  await expect(counts(page)).toContainText('ノード 10 / 10');

  // --- 属性ごとの欠損率（FR-VG-12）---
  await page.getByRole('tab', { name: '欠損' }).click();
  const table = page.getByTestId('missing-table');
  await expect(table).toBeVisible();
  const row = (attr: string, scope: 'filtered' | 'whole') =>
    table.locator(`tr[data-attr="${attr}"][data-scope="${scope}"]`);
  // 地名は 5 / 10（空欄 4 + 判読不能 1）、序列は 3 / 10、生年は 1 / 10。属性によって欠損率が大きく違う。
  await expect(row('Place', 'whole').getByTestId('missing-total')).toHaveText(/^5（50%）$/);
  await expect(row('Rank', 'whole').getByTestId('missing-total')).toHaveText(/^3（30%）$/);
  await expect(row('Born', 'whole').getByTestId('missing-total')).toHaveText(/^1（10%）$/);
  // 理由別の列があり、「□」を判読不能として取り込んだ分が数えられる。
  await expect(table.getByRole('columnheader', { name: '判読不能' })).toBeVisible();

  // --- 時期ごとの欠損率（偏りの確認）---
  // 年表のタブで区切りを 100 年にすると、欠損の時期ごとの行も 100 年で数え直される。
  await page.getByRole('tab', { name: '年表' }).click();
  await bottom(page).getByLabel('区切り').selectOption('100');
  await page.getByRole('tab', { name: '欠損' }).click();
  const periods = page.getByTestId('missing-period-table');
  await expect(page.getByTestId('missing-period-basis')).toContainText('区切り: 100 年');
  const periodRows = periods.locator('tbody tr[data-period]:not([data-period="noDate"])');
  await expect(periodRows).toHaveCount(3);
  // 列は属性（Place、Rank）の順。地名の欠損は古い世代（1000 年代）に偏り、新しい世代（1200 年代）にはない。
  await expect(periodRows.nth(0).locator('td').first()).toHaveText(/^3 \/ 3（100%）$/);
  await expect(periodRows.nth(1).locator('td').first()).toHaveText(/^1 \/ 3（33\.3%）$/);
  await expect(periodRows.nth(2).locator('td').first()).toHaveText(/^0 \/ 3（0%）$/);
  // 年代のない n10 は区切りの行とは別の行に数える（地名は欠損）。
  await expect(periods.locator('tr[data-period="noDate"]')).toContainText('1 / 1（100%）');

  // --- 破線の表示（欠損を含めたまま図で見分ける）---
  const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
  await expect(nodes).toHaveCount(10);
  const before = await dashed(page).count();
  await openGraphSection(page, '欠損の表示');
  await page.getByRole('checkbox', { name: 'Place' }).check();
  // 地名が欠損する 5 ノード（n1、n2、n3、n4、n10）が破線の枠になる。図のノードの数は変わらない。
  await expect.poll(() => dashed(page).count()).toBe(before + 5);
  await expect(nodes).toHaveCount(10);

  // --- 欠損を含める／除く（フィルタ）の比較（FR-FL-06）---
  await expect(counts(page)).toContainText('エッジ 10 / 10');
  const rank = await openAttr(page, 'Rank');
  await rank.getByRole('textbox', { name: '最小' }).fill('1');
  await rank.getByRole('button', { name: '適用' }).click();
  // 除く（既定）: 序列が欠損する n2、n4、n7 が消え、エッジは両端が残る 4 本だけになる。
  await expect(counts(page)).toContainText('ノード 7 / 10');
  await expect(counts(page)).toContainText('エッジ 4 / 10');
  await expect(appliedRegion(page)).toContainText('欠損で除外: 3 件');
  await expect(nodes).toHaveCount(7);
  // 含める: 欠損のものも残り、ネットワークは元どおりつながる。
  await rank.getByRole('combobox', { name: '欠損の扱い' }).selectOption('include');
  await expect(counts(page)).toContainText('ノード 10 / 10');
  await expect(counts(page)).toContainText('エッジ 10 / 10');
  await expect(appliedRegion(page)).toContainText('欠損を含む');
  await expect(nodes).toHaveCount(10);
  // 破線の表示はフィルタと独立（除いても含めても、選んだ属性の欠損は破線のまま）。
  await expect.poll(() => dashed(page).count()).toBe(before + 5);

  // --- 書き出しに欠損の破線の凡例が入る（FR-OUT-07）---
  const svg = await downloadText(page, 'SVG');
  expect(svg).toContain('id="legend"');
  expect(svg).toContain('欠損の表示（破線）');
  expect(svg).toContain('ノード: 指定した属性が欠損（粗い破線）');
  expect(svg).toContain('stroke-dasharray');
});
