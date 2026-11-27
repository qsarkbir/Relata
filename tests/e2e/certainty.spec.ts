/**
 * 確からしさ（T2-01b、D-37、FR-DM-06）の E2E。
 * 読み込みのウィザードで「確からしさ」の列と「末尾の ? を可能性ありと読む」を選び、左のパネルで絞り込む。
 * 見本は tests/fixtures/e2e/certainty-edges.csv（エッジ 4 本: 確実 1、おそらく 1、可能性あり 1、指定なし 1。
 * place 列の値は「بغداد؟」「Basra?」「Mosul」「Cairo」）。
 */
import { expect, test } from './fixtures';
import type { Page } from './fixtures';
import { readFileSync } from 'node:fs';
import {
  appliedRegion,
  counts,
  expectCounts,
  facetValue,
  fixturePath,
  openAttr,
  openProject,
  saveProjectFile,
  startApp,
  type SavedProject,
} from './support';

const CSV = fixturePath('certainty-edges.csv');

interface Words {
  readonly open: string;
  readonly dialog: string;
  readonly read: string;
  readonly next: string;
  readonly validate: string;
  readonly commit: string;
  readonly file: string;
  readonly table: string;
  readonly use: string;
  readonly suffix: string;
  readonly type: string;
  readonly certainty: string;
}
const JA: Words = {
  open: '表データを読み込む',
  dialog: '表データの読み込み',
  read: '表を解析してプレビュー',
  next: '列の対応へ',
  validate: '変換して結果を確認',
  commit: 'このデータを読み込む',
  file: 'ファイル',
  table: '1表',
  use: '用途',
  suffix: '末尾の ? を可能性ありと読む',
  type: '列の型',
  certainty: '確からしさ',
};
const EN: Words = {
  open: 'Import tables',
  dialog: 'Import tabular data',
  read: 'Read and preview table',
  next: 'Set up columns',
  validate: 'Convert and review',
  commit: 'Import this dataset',
  file: 'File',
  table: 'Single table',
  use: 'Role',
  suffix: 'Read a trailing ? as possible',
  type: 'Column type',
  certainty: 'Certainty',
};

/** CSV を読み込み、列の対応の段階まで進む。 */
async function toColumns(page: Page, w: Words) {
  await startApp(page);
  await page.getByRole('button', { name: w.open, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: w.dialog, exact: true });
  await dialog.getByLabel(w.file, { exact: true }).setInputFiles(CSV);
  await dialog.getByRole('button', { name: w.read }).click();
  await dialog.getByRole('button', { name: w.next, exact: true }).click();
  return dialog;
}

test.describe('FR-DM-06: 確からしさ（日本語）', () => {
  test.use({ locale: 'ja-JP' });

  test('FR-DM-06: 列の対応、末尾の ? の選択、左のパネルの絞り込み、保存と開き直し', async ({
    page,
  }) => {
    const dialog = await toColumns(page, JA);
    // 期待: 見出し certainty は役割「確からしさ」に自動で対応づく。
    await expect(
      dialog.getByLabel(`${JA.table} 3 certainty ${JA.use}`, { exact: true }),
    ).toHaveValue('certainty');
    // 期待: 末尾の ? の選択は既定で無効。日付の列にしたら選択は出ない。
    const suffix = dialog.getByLabel(`${JA.table} 4 place ${JA.suffix}`, { exact: true });
    await expect(suffix).not.toBeChecked();
    await dialog.getByLabel(`${JA.table} 4 place ${JA.type}`, { exact: true }).selectOption('date');
    await expect(suffix).toHaveCount(0);
    await dialog
      .getByLabel(`${JA.table} 4 place ${JA.type}`, { exact: true })
      .selectOption('string');
    await suffix.check();
    await dialog.getByRole('button', { name: JA.validate, exact: true }).click();
    await expect(dialog).toContainText('エッジ 4 件');
    await dialog.getByRole('button', { name: JA.commit, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expectCounts(page, [3, 3], [4, 4]);

    // 値から ? が外れている（place のファセット）。
    const place = await openAttr(page, 'place');
    await expect(facetValue(place, 'Basra')).toBeVisible();
    await expect(facetValue(place, 'بغداد')).toBeVisible();
    await expect(facetValue(place, 'Mosul')).toBeVisible();

    // 左のパネル: 確からしさの 4 項目と件数。
    const box = await openAttr(page, JA.certainty);
    for (const name of ['確実', 'おそらく', '可能性あり', '指定なし']) {
      await expect(facetValue(box, name)).toHaveAccessibleName(/他の条件に合う件数 1、全体 1/);
    }
    await facetValue(box, '可能性あり').check();
    await expectCounts(page, [2, 3], [1, 4]);
    await expect(appliedRegion(page)).toContainText('確からしさ: 可能性あり');
    await expect(page.getByRole('region', { name: '適用中の条件' })).toContainText('フィルタ 1');
    // 自分自身のフィルタは件数から除かれ、他の項目は 0 にならない。
    await expect(facetValue(box, '確実')).toHaveAccessibleName(/他の条件に合う件数 1、全体 1/);
    await facetValue(box, '指定なし').check();
    await expectCounts(page, [3, 3], [2, 4]);

    // Undo で 1 つ戻る。
    await page.keyboard.press('Control+z');
    await expectCounts(page, [2, 3], [1, 4]);
    await expect(facetValue(box, '指定なし')).not.toBeChecked();

    // 保存すると、末尾の ? の選択とフィルタが残る。開き直しても同じ。
    const downloading = page.waitForEvent('download');
    await saveProjectFile(page);
    const download = await downloading;
    const path = await download.path();
    // 理由: アプリが書き出した JSON を、E2E 用の保存型 SavedProject（テストが読む項目だけ）で調べる。
    const saved = JSON.parse(readFileSync(path, 'utf8')) as SavedProject;
    expect(saved.importSettings).toMatchObject({ possibleSuffixColumns: [{ column: 'place' }] });
    expect(saved.view.filter.filters.map((f) => f.kind)).toEqual(['certainty']);
    await openProject(page, {
      name: 'certainty.relata.json',
      mimeType: 'application/json',
      buffer: readFileSync(path),
    });
    await expectCounts(page, [2, 3], [1, 4]);
    await expect(appliedRegion(page)).toContainText('確からしさ: 可能性あり');
    // 【なぜ】適用中の一覧に出てから開く。読み込み直しでパネルが作り直される途中の部品を押さないため。
    await expect(facetValue(await openAttr(page, JA.certainty), '可能性あり')).toBeChecked();
  });

  test('FR-DM-06: 末尾の ? を選ばないと原文のまま。確からしさの列が無いデータでは節を出さない', async ({
    page,
  }) => {
    await startApp(page);
    await page.getByRole('button', { name: JA.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: JA.dialog, exact: true });
    await dialog
      .getByLabel('表の貼り付け', { exact: true })
      .fill('From,To,place\nA,B,Basra?\nB,C,Mosul');
    await dialog.getByRole('button', { name: JA.read }).click();
    await dialog.getByRole('button', { name: JA.next, exact: true }).click();
    await dialog.getByRole('button', { name: JA.validate, exact: true }).click();
    await dialog.getByRole('button', { name: JA.commit, exact: true }).click();
    await expect(dialog).toBeHidden();
    const place = await openAttr(page, 'place');
    await expect(facetValue(place, 'Basra?')).toBeVisible();
    await expect(page.locator('summary', { hasText: JA.certainty })).toHaveCount(0);
  });

  test('FR-DM-06: 読めない確からしさは、行・列と値つきの警告になる', async ({ page }) => {
    await startApp(page);
    await page.getByRole('button', { name: JA.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: JA.dialog, exact: true });
    await dialog
      .getByLabel('表の貼り付け', { exact: true })
      .fill('From,To,certainty\nA,B,たぶん\nB,C,certain');
    await dialog.getByRole('button', { name: JA.read }).click();
    await dialog.getByRole('button', { name: JA.next, exact: true }).click();
    await dialog.getByRole('button', { name: JA.validate, exact: true }).click();
    const warning = dialog.getByRole('listitem').filter({ hasText: 'レコード 2' });
    await expect(warning).toContainText('certainty');
    await expect(warning).toContainText('確からしさを読めない値です');
    await expect(warning).toContainText('たぶん');
    // 警告だけなので、読み込みは続けられる。
    await expect(dialog.getByRole('button', { name: JA.commit, exact: true })).toBeEnabled();
  });
});

test.describe('FR-DM-06: 確からしさ（English）', () => {
  test.use({ locale: 'en-US' });

  test('FR-DM-06: the wizard, the filter section and the warning work in English', async ({
    page,
  }) => {
    const dialog = await toColumns(page, EN);
    await dialog.getByLabel(`${EN.table} 4 place ${EN.suffix}`, { exact: true }).check();
    await dialog.getByRole('button', { name: EN.validate, exact: true }).click();
    await dialog.getByRole('button', { name: EN.commit, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(counts(page)).toContainText('Edges 4 / 4');
    const box = await openAttr(page, EN.certainty);
    await facetValue(box, 'Possible').check();
    await expect(counts(page)).toContainText('Edges 1 / 4');
    await expect(box.getByRole('checkbox', { name: /^Certain/ }).first()).toHaveAccessibleName(
      /1 matching the other filters, 1 in total/,
    );
    await expect(page.getByRole('region', { name: 'Active filters' })).toContainText(
      'Certainty: Possible',
    );
  });
});
