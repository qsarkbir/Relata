import { expect, test } from './fixtures';
import { utils, write } from 'xlsx';
import { readFileSync } from 'node:fs';
import {
  startApp,
  counts,
  openProject,
  confirmDialog,
  loadedNotice,
  type SavedProject,
  saveProjectFile,
} from './support';

test.use({ locale: 'ja-JP' });
async function begin(page: import('@playwright/test').Page) {
  await startApp(page);
  await page.getByRole('button', { name: '表データを読み込む', exact: true }).click();
  return page.getByRole('dialog', { name: '表データの読み込み', exact: true });
}
test('FR-IN-04 / FR-IN-05: 1表の貼付→列設定→確認→読込を1つの操作で使える', async ({ page }) => {
  const dialog = await begin(page);
  await dialog
    .getByLabel('表の貼り付け', { exact: true })
    .fill('From,To,born,topic\nA,B,1050,x;y\nA,C,1050,z');
  await dialog.getByRole('button', { name: '表を解析してプレビュー', exact: true }).click();
  await expect(dialog.getByRole('table', { name: '読み込みプレビュー' })).toContainText('A');
  await dialog.getByRole('button', { name: '列の対応へ', exact: true }).click();
  await dialog.getByLabel('1表 3 born 用途', { exact: true }).selectOption('sourceAttr');
  await dialog.getByLabel('1表 3 born 列の型', { exact: true }).selectOption('date');
  await dialog.getByLabel('1表 3 born 暦', { exact: true }).selectOption('hijri');
  await dialog.getByLabel('1表 4 topic 複数値の区切り', { exact: true }).fill(';');
  await dialog.getByRole('button', { name: '変換して結果を確認', exact: true }).click();
  await expect(dialog).toContainText('ノード 3 件、エッジ 2 件');
  await dialog.getByRole('button', { name: 'このデータを読み込む', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(counts(page)).toContainText('ノード 3 / 3');
  await expect(counts(page)).toContainText('エッジ 2 / 2');
});
test('FR-IN-03 / FR-IN-06: 2表の不正参照をレコード番号で示し、既存データを変更しない', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  await page.getByRole('button', { name: '表データを読み込む', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '表データの読み込み', exact: true });
  await dialog.getByRole('combobox', { name: '表の形式', exact: true }).selectOption('pair');
  const nodes = dialog.getByRole('group', { name: 'ノード表', exact: true });
  const edges = dialog.getByRole('group', { name: 'エッジ表', exact: true });
  await nodes.getByLabel('表の貼り付け').fill('id,label\n1,A\n2,B');
  await nodes.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await edges.getByLabel('表の貼り付け').fill('source,target\n1,absent');
  await edges.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await dialog.getByRole('button', { name: '列の対応へ' }).click();
  await dialog.getByRole('button', { name: '変換して結果を確認' }).click();
  await expect(dialog).toContainText('レコード 2');
  await expect(dialog).toContainText('参照先のノードがありません');
  await expect(dialog.getByRole('button', { name: 'このデータを読み込む' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'やめる', exact: true }).click();
  await expect(counts(page)).toContainText('/ 15');
});
test('FR-IN-03 / FR-IN-06: 修正した表を読み直し、置換確認の取消と確定を選べる', async ({
  page,
}) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
  await page.getByRole('button', { name: '表データを読み込む', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '表データの読み込み', exact: true });
  await dialog.getByRole('combobox', { name: '表の形式', exact: true }).selectOption('pair');
  for (const [label, text] of [
    ['ノード表', 'id,label\n1,A\n2,B'],
    ['エッジ表', 'source,target\n1,2'],
  ]) {
    const group = dialog.getByRole('group', { name: label, exact: true });
    await group.getByLabel('表の貼り付け').fill(text ?? '');
    await group.getByRole('button', { name: '表を解析してプレビュー' }).click();
  }
  await dialog.getByRole('button', { name: '列の対応へ' }).click();
  await dialog.getByRole('button', { name: '変換して結果を確認' }).click();
  await dialog.getByRole('button', { name: 'このデータを読み込む' }).click();
  await confirmDialog(page).getByRole('button', { name: 'やめる', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(counts(page)).toContainText('/ 15');
  await dialog.getByRole('button', { name: 'このデータを読み込む' }).click();
  await confirmDialog(page).getByRole('button', { name: '開く', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(counts(page)).toContainText('ノード 2 / 2');
});
test('FR-IN-01: Shift_JISを判定し、手動のUTF-8設定とプレビューを切り替えられる', async ({
  page,
}) => {
  const dialog = await begin(page);
  const bytes = Buffer.from([
    0x46, 0x72, 0x6f, 0x6d, 0x2c, 0x54, 0x6f, 0x0a, 0x82, 0xa0, 0x2c, 0x82, 0xa2,
  ]);
  await dialog
    .getByLabel('ファイル', { exact: true })
    .setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: bytes });
  await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await expect(dialog).toContainText('shift_jis');
  await expect(dialog.getByRole('table')).toContainText('あ');
  await dialog.getByRole('combobox', { name: '文字コード', exact: true }).selectOption('utf-8');
  await expect(dialog.getByRole('button', { name: '列の対応へ' })).toBeDisabled();
  await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await expect(dialog).toContainText('復号できないバイトを置換文字');
  await expect(dialog.getByRole('button', { name: '列の対応へ' })).toBeDisabled();
  await dialog.getByLabel('この文字コードのプレビューを確認し、このまま進む').check();
  await expect(dialog.getByRole('button', { name: '列の対応へ' })).toBeEnabled();
});
test('FR-IN-02: Excelのシートを選んでプレビュー・読み込みができる', async ({ page }) => {
  const book = utils.book_new();
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['From', 'To'],
      ['wrong', 'sheet'],
    ]),
    'First',
  );
  utils.book_append_sheet(
    book,
    utils.aoa_to_sheet([
      ['From', 'To'],
      ['東京', 'محمد'],
    ]),
    'Second',
  );
  const raw: unknown = write(book, { type: 'array', bookType: 'xlsx' });
  if (!(raw instanceof ArrayBuffer)) throw new Error('fixture');
  const dialog = await begin(page);
  await dialog.getByLabel('ファイル', { exact: true }).setInputFiles({
    name: 'people.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from(raw),
  });
  await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await dialog.getByRole('combobox', { name: 'シート', exact: true }).selectOption('Second');
  await expect(dialog.getByRole('table')).toContainText('محمد');
  await expect(dialog.getByRole('table')).not.toContainText('wrong');
  await dialog.getByRole('button', { name: '列の対応へ' }).click();
  await dialog.getByRole('button', { name: '変換して結果を確認' }).click();
  await dialog.getByRole('button', { name: 'このデータを読み込む' }).click();
  await expect(counts(page)).toContainText('ノード 2 / 2');
});
test('FR-IN-07: 欠損の記号を判読不能へ対応づけ、エラーでなく読める', async ({ page }) => {
  const dialog = await begin(page);
  await dialog.getByLabel('表の貼り付け', { exact: true }).fill('From,To,year\nA,B,□');
  await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await dialog.getByRole('button', { name: '列の対応へ' }).click();
  await dialog.getByRole('button', { name: '欠損記号を追加' }).click();
  await dialog.getByLabel('記号', { exact: true }).fill('□');
  await dialog.getByRole('combobox', { name: '理由', exact: true }).selectOption('illegible');
  await dialog.getByLabel('1表 3 year 列の型', { exact: true }).selectOption('date');
  await dialog.getByRole('button', { name: '変換して結果を確認' }).click();
  await expect(dialog.getByRole('button', { name: 'このデータを読み込む' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'このデータを読み込む' }).click();
  await expect(loadedNotice(page)).toBeVisible();
});
test('FR-UI-01 / NFR-07: 英語のキーボード操作で開いてEscで閉じてもデータを変えない', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await startApp(page);
  const button = page.getByRole('button', { name: 'Import tables', exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Import tabular data', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  await context.close();
});

test('FR-UI-03 / FR-IN-06: モーダル内で遅い読取を取り消し、後から届いた結果を捨てて再試行できる', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = (file: File): Promise<ArrayBuffer> => Blob.prototype.arrayBuffer.call(file);
    let released = false;
    const gate = new Promise<void>((resolve) => {
      window.addEventListener(
        'release-import-read',
        () => {
          released = true;
          resolve();
        },
        { once: true },
      );
    });
    File.prototype.arrayBuffer = async function (this: File): Promise<ArrayBuffer> {
      const bytes = await original(this);
      if (this.name === 'held.csv' && !released) await gate;
      document.documentElement.setAttribute('data-import-read-returned', 'yes');
      return bytes;
    };
  });
  const dialog = await begin(page);
  await dialog
    .getByLabel('ファイル', { exact: true })
    .setInputFiles({ name: 'held.csv', mimeType: 'text/csv', buffer: Buffer.from('From,To\nA,B') });
  await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await expect(dialog.getByRole('progressbar', { name: '1表を読み込み中' })).toBeVisible();
  await dialog.getByRole('button', { name: '表の読み取りを取り消す' }).click();
  await expect(dialog.getByRole('button', { name: '表を解析してプレビュー' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: '列の対応へ' })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event('release-import-read')));
  await expect(page.locator('html')).toHaveAttribute('data-import-read-returned', 'yes');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  );
  await expect(dialog.getByRole('table')).toHaveCount(0);
  await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await expect(dialog.getByRole('button', { name: '列の対応へ' })).toBeEnabled();
});

test('FR-UI-01 / FR-IN-06: 英語の解析失敗を主文で知らせ、修正して読み直せる', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();
  await startApp(page);
  await page.getByRole('button', { name: 'Import tables', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import tabular data', exact: true });
  await dialog.getByRole('textbox', { name: 'Paste a table', exact: true }).fill('From,To\n"open');
  await dialog.getByRole('button', { name: 'Read and preview table' }).click();
  await expect(
    dialog.getByRole('alert').filter({ hasText: 'Could not read the table' }),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Set up columns' })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Paste a table', exact: true }).fill('From,To\nA,B');
  await dialog.getByRole('button', { name: 'Read and preview table' }).click();
  await expect(dialog.getByRole('button', { name: 'Set up columns' })).toBeEnabled();
  await context.close();
});

for (const formulaProtection of [false, true]) {
  test(`FR-IN-01 / FR-PJ-01: CSV保護の読戻し${formulaProtection ? 'ON' : 'OFF'}を保存した文字列に反映する`, async ({
    page,
  }) => {
    const dialog = await begin(page);
    // 【なぜ】式候補と元からあるアポストロフィを区別する。OFFで勝手に消さず、ONでも1個だけ戻す。
    await dialog
      .getByRole('textbox', { name: '表の貼り付け', exact: true })
      .fill("From,To,note\n'=SUM(1),''original,'@note");
    const protection = dialog.getByRole('checkbox', {
      name: '式の保護を戻して読む',
      exact: true,
    });
    await expect(protection).not.toBeChecked();
    if (formulaProtection) await protection.check();
    await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
    await dialog.getByRole('button', { name: '列の対応へ' }).click();
    await dialog.getByRole('button', { name: '変換して結果を確認' }).click();
    await dialog.getByRole('button', { name: 'このデータを読み込む' }).click();
    await expect(dialog).toBeHidden();
    const downloading = page.waitForEvent('download');
    await saveProjectFile(page);
    const download = await downloading;
    // 【TS】アプリが書き出したJSONを、既存のE2E用保存型で調べる。
    const saved = JSON.parse(readFileSync(await download.path(), 'utf8')) as SavedProject;
    expect(saved.dataset.nodes).toEqual([
      expect.objectContaining({ label: formulaProtection ? '=SUM(1)' : "'=SUM(1)" }),
      expect.objectContaining({ label: formulaProtection ? "'original" : "''original" }),
    ]);
    expect(saved.dataset.edges).toEqual([
      expect.objectContaining({
        attrs: { note: { kind: 'value', value: formulaProtection ? '@note' : "'@note" } },
      }),
    ]);
  });
}
test('FR-IN-06 / FR-UI-03: 変換待機中は列・型名・欠損を変更できず、取消は使える', async ({
  page,
}) => {
  const dialog = await begin(page);
  await dialog
    .getByRole('textbox', { name: '表の貼り付け', exact: true })
    .fill('From,To,note\nA,B,x');
  await dialog.getByRole('button', { name: '表を解析してプレビュー' }).click();
  await dialog.getByRole('button', { name: '列の対応へ' }).click();
  await dialog.getByRole('button', { name: '欠損記号を追加' }).click();
  // 【なぜ】描画待ちを止め、古い設定を捕捉している時間帯の入力制限を確かめる。
  // 固定した仮想時刻から未来へ止め、ホスト時刻との前後関係に依存しない。
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2030-01-02T00:00:00Z'));
  await dialog.getByRole('button', { name: '変換して結果を確認' }).click();
  await expect(dialog.getByLabel('1表 3 note 用途', { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('1表 3 note 列の型', { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('記号', { exact: true })).toBeDisabled();
  // 型名入力も含め、列設定領域の全入力が継承したdisabled状態になる。
  for (const input of await dialog.locator('fieldset[disabled] input').all()) {
    await expect(input).toBeDisabled();
  }
  const cancel = dialog.getByRole('button', { name: 'やめる', exact: true });
  await expect(cancel).toBeEnabled();
  await cancel.click();
  await expect(dialog).toBeHidden();
  await page.clock.runFor(100);
  await page.getByRole('button', { name: '表データを読み込む', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '列の対応へ' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'このデータを読み込む' })).toHaveCount(0);
});

test('FR-UI-04 / NFR-07: ウィザードの説明はアイコンのダイアログで読み、Esc で説明だけを閉じる', async ({
  page,
}) => {
  await startApp(page);
  await page.getByRole('button', { name: '表データを読み込む', exact: true }).click();
  const wizard = page.getByRole('dialog', { name: '表データの読み込み', exact: true });
  await wizard.getByLabel('表の貼り付け', { exact: true }).fill('From,To\nA,B');
  await wizard.getByRole('button', { name: '表を解析してプレビュー', exact: true }).click();
  await wizard.getByRole('button', { name: '列の対応へ', exact: true }).click();
  // 期待: 説明文は画面に並べず、アイコンから開く。
  await expect(wizard.getByText('完全に一致したときだけ', { exact: false })).toHaveCount(0);
  await wizard.getByRole('button', { name: '説明: 欠損の記号と理由', exact: true }).click();
  const info = page.getByRole('dialog', { name: '欠損の記号と理由', exact: true });
  await expect(info.getByText('完全に一致したときだけ', { exact: false })).toBeVisible();
  // 操作: Esc。説明のダイアログだけが閉じ、ウィザードは開いたまま。
  await page.keyboard.press('Escape');
  await expect(info).toBeHidden();
  await expect(wizard).toBeVisible();
  await expect(
    wizard.getByRole('button', { name: '説明: 欠損の記号と理由', exact: true }),
  ).toBeFocused();
});
