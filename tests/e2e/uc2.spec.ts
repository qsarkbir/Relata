/**
 * UC-2: 人物と組織の所属関係（二部グラフ）を読み込み、人物どうしのネットワークに射影し、
 * 根拠（共通の組織）をたどり、書き出し・保存・再読込まで、利用者の操作だけで通す。
 *
 * 対応する要件: FR-IN-03（2 表の読み込み）、FR-GR-03（射影）、FR-GR-04（根拠の一覧）、
 * FR-MT-04/05（指標が射影後のグラフに従う）、FR-TB-01（表）、FR-OUT-02/05（CSV、GraphML、GEXF）、
 * FR-PJ-01（保存と復元）、NFR-09（アラビア文字）。
 *
 * 見本（このファイルの中で作る。歴史データにありがちな癖を含む）:
 * - 人物 6: ابن عسكر（アラビア文字）、「Hasan, al-」（カンマ）、「Eve (II)」（括弧）、孤立の Solo。
 * - 組織 3: المدرسة النظامية など。
 * - 所属 8 本: o1 に p1,p2,p3、o2 に p2,p3,p4、o3 に p4,p5。p2 と p3 だけが 2 つの組織を共有する。
 * 射影（人物 ← 組織）すると、ノード 5（Solo は孤立で除く）、エッジ 6 になる。
 */
import { expect, test, type Page } from './fixtures';
import {
  buildToggle,
  counts,
  openBuildPanel,
  openProject,
  saveProjectFile,
  startApp,
} from './support';
import { downloadText, importPair, selectNodeByLabel, stripBom } from './uc-support';
import { readFileSync } from 'node:fs';

test.use({ locale: 'ja-JP' });

const NODES = [
  'id,label,type',
  'p1,ابن عسكر,person',
  'p2,"Hasan, al-",person',
  'p3,Carol,person',
  'p4,Dan,person',
  'p5,Eve (II),person',
  'p6,Solo,person',
  'o1,المدرسة النظامية,org',
  'o2,Org Two,org',
  'o3,Org Three,org',
].join('\n');
const EDGES = [
  'source,target',
  'p1,o1',
  'p2,o1',
  'p3,o1',
  'p2,o2',
  'p3,o2',
  'p4,o2',
  'p4,o3',
  'p5,o3',
].join('\n');

function conditions(page: Page) {
  return page.getByRole('region', { name: /適用中の条件/ });
}
function metricRow(page: Page, label: string) {
  return page
    .getByRole('table', { name: 'ノードごとの指標' })
    .locator('tbody tr')
    .filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
}

test('UC-2 / FR-GR-03 / FR-GR-04 / FR-OUT-05 / FR-OUT-02 / FR-PJ-01: 所属の表を人物のネットワークに射影し、根拠・指標・書き出し・保存まで通す', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await startApp(page);

  // --- 1. 読み込み（FR-IN-03）: 2 表（ノード表とエッジ表）。型の列は見出し type から自動で対応する ---
  await importPair(page, NODES, EDGES);
  // 【歴史の事情】所属のない人物 Solo は孤立ノード。既定では図と指標に入れない（FR-FL-05）ので 8 / 9。
  await expect(counts(page)).toContainText('ノード 8 / 9');
  await expect(counts(page)).toContainText('エッジ 8 / 8');
  await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('8');

  // --- 2. ノードの型を確かめる（表ビューの型の列と、射影の欄の選択肢）---
  await page.getByRole('tab', { name: '表', exact: true }).click();
  const bottom = page.getByRole('region', { name: '下の段' });
  await expect(bottom.getByRole('cell', { name: 'person', exact: true }).first()).toBeVisible();
  await expect(bottom.getByRole('cell', { name: 'org', exact: true }).first()).toBeVisible();
  // カンマや括弧を含む名前、アラビア文字の名前が、欠けずに表に出る。
  await expect(bottom).toContainText('Hasan, al-');
  await expect(bottom).toContainText('Eve (II)');
  await expect(bottom).toContainText('ابن عسكر');
  const panel = await openBuildPanel(page);
  await panel.getByRole('checkbox', { name: '射影する' }).check();
  await expect(panel.getByLabel('射影先の型（残すノード）').locator('option')).toContainText([
    'person',
    'org',
  ]);

  // --- 3. 射影する（人物 ← 組織）---
  await panel.getByLabel('射影先の型（残すノード）').selectOption('person');
  await panel.getByLabel('仲介する型（根拠になるノード）').selectOption('org');
  await expect(conditions(page)).toContainText('射影後: ノード 5 · エッジ 6');
  await expect(buildToggle(page)).toHaveText('構築: 射影 person ← org');
  await page.keyboard.press('Escape');
  // 図のノードは人物 5（孤立の Solo は既定で出さない）。組織は図から消える。
  const nodes = page.locator('.graph-canvas #graph-view-nodes > [data-id]');
  await expect(nodes).toHaveCount(5);
  await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id="o1"]')).toHaveCount(0);

  // --- 4. 根拠（共通の組織）を選択の欄で確かめる（FR-GR-04）---
  await selectNodeByLabel(page, 'Hasan, al-');
  const card = page.getByRole('region', { name: '選択したノードの詳細' });
  const neighbors = card.getByTestId('evidence-neighbor');
  await expect(neighbors).toHaveCount(3);
  await expect(neighbors.first()).toContainText('Carol');
  await expect(neighbors.first()).toContainText('根拠 2 件');
  await card.getByRole('button', { name: 'このエッジを選ぶ: Carol' }).click();
  const edge = card.getByTestId('evidence-edge');
  await expect(edge).toContainText('根拠の仲介ノード 2 件');
  await expect(edge.locator('bdi', { hasText: 'المدرسة النظامية' })).toBeVisible();
  await expect(edge.locator('bdi', { hasText: 'Org Two' })).toBeVisible();
  // もう 1 本（p1 との根拠は o1 だけ）: アラビア文字の人物との根拠は 1 件。
  await selectNodeByLabel(page, 'ابن عسكر');
  await expect(card.getByTestId('evidence-neighbor')).toHaveCount(2);
  await expect(card.getByTestId('evidence-neighbor').first()).toContainText('根拠 1 件');

  // --- 5. 指標と表が射影後のグラフに従う（FR-MT-04、FR-MT-05）---
  await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('5');
  await expect(page.getByTestId('metric-global-edgeCount')).toHaveText('6');
  await expect(page.getByText('射影後のグラフで計算', { exact: true })).toBeVisible();
  // Carol: p1,p2 と共有(1 + 2)、p4 と 1 = 重み付き次数 4。孤立の Solo は指標の表に出ない。
  await expect(metricRow(page, 'Carol')).toContainText('4');
  await expect(metricRow(page, 'Solo')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '説明: 指標の意味と計算上の注意', exact: true }),
  ).toBeVisible();
  // 【なぜ】設計書 D-39: 表ビューは射影前の元のデータ（絞り込みだけに従う）を表示する。射影後の 6 本ではなく
  //   元の所属 8 本が並び、根拠をたどる元データとして読める。
  await page.getByRole('tab', { name: '表', exact: true }).click();
  await bottom.getByRole('button', { name: 'エッジ表' }).click();
  await expect(bottom.getByRole('table').locator('tbody tr')).toHaveCount(8);

  // --- 6. GraphML と GEXF に射影の結果が反映される（FR-OUT-05）---
  const graphml = await downloadText(page, 'GraphML');
  expect((graphml.match(/<node /g) ?? []).length).toBe(5);
  expect((graphml.match(/<edge /g) ?? []).length).toBe(6);
  expect(graphml).toContain('ابن عسكر');
  expect(graphml).toContain('Hasan, al-');
  expect(graphml).not.toContain('Org Two');
  const gexf = await downloadText(page, 'GEXF');
  expect((gexf.match(/<node /g) ?? []).length).toBe(5);
  expect((gexf.match(/<edge /g) ?? []).length).toBe(6);
  expect(gexf).not.toContain('المدرسة النظامية');

  // --- 7. 指標 CSV に射影の設定が残る（FR-OUT-02、設計書 §9.1）---
  const globalCsv = await downloadText(page, '全体指標CSV');
  const [header = '', row = ''] = stripBom(globalCsv).split('\r\n');
  const columns = header.split(',');
  expect(columns.slice(-3)).toEqual([
    'setting.projection.target',
    'setting.projection.via',
    'setting.projection.method',
  ]);
  expect(row.split(',').slice(-3)).toEqual(['person', 'org', 'shared']);
  const nodeCsv = await downloadText(page, 'ノード指標CSV');
  expect(nodeCsv).toContain('Carol');
  expect(nodeCsv).not.toContain('Org Two');

  // --- 8. 保存して読み込み直すと、射影の状態が戻る（FR-PJ-01）---
  const pendingSave = page.waitForEvent('download');
  await saveProjectFile(page);
  const saved = readFileSync(await (await pendingSave).path(), 'utf8');
  expect(saved).toContain('"projection":{"target":"person","via":"org","method":"shared"}');
  // 射影を外してから開き直し、保存した状態に戻ることを確かめる。
  const reopen = await openBuildPanel(page);
  await reopen.getByRole('checkbox', { name: '射影する' }).uncheck();
  await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('8');
  await page.keyboard.press('Escape');
  await openProject(page, {
    name: 'uc2.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(saved),
  });
  await expect(conditions(page)).toContainText('射影後: ノード 5 · エッジ 6');
  await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('5');
  await expect(buildToggle(page)).toHaveText('構築: 射影 person ← org');
  await expect(nodes).toHaveCount(5);
});

test('UC-2 / FR-GR-03: 方式を替えると重みが変わり、書き出しの指標 CSV の設定の列にも方式が残る', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await startApp(page);
  await importPair(page, NODES, EDGES);
  const panel = await openBuildPanel(page);
  await panel.getByRole('checkbox', { name: '射影する' }).check();
  await panel.getByLabel('射影先の型（残すノード）').selectOption('person');
  await panel.getByLabel('仲介する型（根拠になるノード）').selectOption('org');
  // 共通の相手の数: Carol(p3) の重み付き次数は 1 + 2 + 1 = 4。Jaccard では値が小さくなる。
  await expect(metricRow(page, 'Carol')).toContainText('4');
  await panel.getByLabel('重み付けの方式').selectOption('jaccard');
  await expect(metricRow(page, 'Carol')).not.toContainText(/(^|\s)4(\s|$)/);
  await page.keyboard.press('Escape');
  const csv = await downloadText(page, '全体指標CSV');
  const row = (stripBom(csv).split('\r\n')[1] ?? '').split(',');
  expect(row.slice(-3)).toEqual(['person', 'org', 'jaccard']);
});
