/**
 * プロジェクトの保存・読み込み・自動保存（T1-21）の E2E。
 *
 * 見本は tests/fixtures/e2e/（make-fixtures.ts で作る）。maghrib.relata.json はノード 15、エッジ 17、フィルタなし
 * （最初の件数は「ノード 14 / 15、エッジ 17 / 17」。孤立ノードは既定で除く）。
 * maghrib-filtered.relata.json は、地名と年のフィルタ、片端の規則、孤立ノードを表示する設定つき
 * （件数は「ノード 7 / 15、エッジ 6 / 17」）。
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  alerts,
  appliedRegion,
  confirmDialog,
  counts,
  expectCounts,
  facetValue,
  fixturePath,
  loadedNotice,
  openAttr,
  openProject,
  readAutosave,
  saveButton,
  seedAutosave,
  startApp,
  startAppWithPausedClock,
  advanceClockUntilLoaded,
  waitForAutosave,
  type SavedProject,
  saveProjectFile,
  exportButton,
  saveDialog,
} from './support';

test.use({ locale: 'ja-JP' });

const bad = (name: string) => ({
  name,
  mimeType: 'application/json',
  buffer: readFileSync(fixturePath(name)),
});

test.describe('UC-6 / FR-PJ-01: 保存と読み込みの往復', () => {
  test('UC-6 / FR-PJ-01: 保存したファイルを、新しいブラウザで開くと、件数・フィルタ・規則・孤立ノードの設定が同じ', async ({
    page,
    browser,
    baseURL,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib-filtered.relata.json');
    // 操作: フィルタを 1 つ足す（ノード型「タイプ 1」）。
    await page.getByRole('checkbox', { name: 'タイプ 1' }).check();
    await expect(appliedRegion(page).getByRole('listitem')).toHaveCount(3);
    const savedCounts = await counts(page).textContent();
    const appliedItems = appliedRegion(page).getByRole('listitem');
    const savedApplied: string[] = [];
    // 【なぜ】Firefoxの検証環境ではallTextContentsの一括取得がページを終了させる。
    // 各行の同じtextContentは個別取得できるため、順に読み、復元後は配列全体を比較する。
    for (let i = 0; i < (await appliedItems.count()); i++) {
      savedApplied.push(await appliedItems.nth(i).evaluate((element) => element.textContent));
    }

    // 操作: 保存を押してダウンロードする。
    const downloading = page.waitForEvent('download');
    await saveProjectFile(page);
    const download = await downloading;
    // 期待: ファイル名は題名（ASCII の英数字と空白）と日付、拡張子 .relata.json。
    expect(download.suggestedFilename()).toMatch(
      /^Maghrib sample-\d{4}-\d{2}-\d{2}\.relata\.json$/,
    );
    const path = await download.path();
    const text = readFileSync(path, 'utf8');
    const file = JSON.parse(text) as SavedProject; // 理由: アプリが書いた JSON
    expect(file.app).toBe('Relata');
    expect(file.view.filter.filters).toHaveLength(3);
    expect(file.view.filter.edgeRule).toBe('either-end');
    expect(file.view.filter.showIsolated).toBe(true);
    // 期待: データと読み込みの設定（暦、欠損の記号）も入っている。
    expect(file.dataset.nodes).toHaveLength(15);
    expect(JSON.stringify(file.importSettings)).toContain('hijri');

    // 操作: 別の（空の）ブラウザ文脈で、そのファイルを開く。自動保存の影響を受けないための分離。
    const context = await browser.newContext({ baseURL: baseURL ?? '', locale: 'ja-JP' });
    try {
      const page2 = await context.newPage();
      await startApp(page2);
      await openProject(page2, {
        name: download.suggestedFilename(),
        mimeType: 'application/json',
        buffer: Buffer.from(text, 'utf8'),
      });
      // 期待: 件数、適用中のフィルタ、規則、孤立ノードの設定が保存時と同じ。
      await expect(counts(page2)).toHaveText(savedCounts ?? '');
      await expect(appliedRegion(page2).getByRole('listitem')).toHaveText(savedApplied);
      await expect(page2.getByRole('radio', { name: 'どちらかの端が通過したとき' })).toBeChecked();
      await expect(page2.getByRole('checkbox', { name: /孤立ノード/ })).toBeChecked();
    } finally {
      await context.close();
    }
  });

  test('FR-PJ-01: 別のデータを開いた後でも、ファイルのフィルタ、規則、孤立ノードの設定が適用される', async ({
    page,
  }) => {
    await startApp(page);
    // 前提: 先に別のデータ（ノード 2、エッジ 1。フィルタなし）を開く。
    await openProject(page, 'other.relata.json');
    await expectCounts(page, [2, 2], [1, 1]);
    // 操作: フィルタつきのファイルを開く（置き換えの確認に「開く」で答える）。
    await openProject(page, 'maghrib-filtered.relata.json');
    // 期待: 前のデータの状態ではなく、ファイルのフィルタが効く。
    await expectCounts(page, [7, 15], [6, 17]);
    await expect(appliedRegion(page).getByRole('listitem')).toHaveCount(2);
    await expect(appliedRegion(page)).toContainText('年: 900〜970');
    await expect(page.getByRole('radio', { name: 'どちらかの端が通過したとき' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /孤立ノード/ })).toBeChecked();
  });
});

test.describe('FR-IN-08: 警告と失敗', () => {
  test('FR-IN-08: 警告のあるファイルは読み込め、警告の一覧が出る。閉じても「警告を見る」で開き直せる', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'warnings.relata.json');
    const report = page.getByRole('region', { name: '読み込みの警告' });
    // 期待: 警告 4 件（未知の項目 2、存在しない属性、データにない値）が項目ごとに並ぶ。
    await expect(report.getByRole('listitem')).toHaveCount(4);
    await expect(report).toContainText('futureFeature');
    await expect(report).toContainText('view.layoutHint');
    await expect(report).toContainText('unknown-attr');
    await expect(report).toContainText('unknown-category');
    // 期待: 問題のあるフィルタは、適用中の一覧にも「確認が必要な点」として添えられる。
    await expect(appliedRegion(page)).toContainText('この属性はデータにありません。');
    // 操作: 閉じる → 「警告 4 件を見る」で開き直す。
    await report.getByRole('button', { name: '閉じる' }).click();
    await expect(report).toBeHidden();
    await page.getByRole('button', { name: '警告 4 件を見る' }).click();
    await expect(report.getByRole('listitem')).toHaveCount(4);
  });

  const failures = [
    { file: 'not-json.txt', mime: 'text/plain', message: 'JSON として読めません' },
    {
      file: 'wrong-app.relata.json',
      mime: 'application/json',
      message: 'Relata のプロジェクトファイルではありません',
    },
    { file: 'newer-version.relata.json', mime: 'application/json', message: '新しい版（999）' },
    { file: 'broken-dataset.relata.json', mime: 'application/json', message: 'dataset.nodes' },
  ] as const;

  for (const { file, mime, message } of failures) {
    test(`FR-IN-08: ${file} は失敗として role=alert に理由が出て、今のデータとフィルタが残る`, async ({
      page,
    }) => {
      await startApp(page);
      await openProject(page, 'maghrib.relata.json');
      const box = await openAttr(page, '地名');
      await facetValue(box, 'مكناس').check();
      await expectCounts(page, [2, 15], [1, 17]);

      await openProject(
        page,
        { name: file, mimeType: mime, buffer: readFileSync(fixturePath(file)) },
        alerts(page, message),
      );
      // 期待: 失敗の見出しと理由が alert に出る。
      await expect(alerts(page, 'プロジェクトを開けませんでした')).toBeVisible();
      // 期待: 今の作業はそのまま（件数もフィルタも）。
      await expectCounts(page, [2, 15], [1, 17]);
      await expect(appliedRegion(page)).toContainText('地名: مكناس');
    });
  }

  test('FR-IN-08: データがあるときは、置き換えの確認が出る。「やめる」が既定で、Esc でもやめられる', async ({
    page,
  }) => {
    await startApp(page);
    // データが無いときは確認が出ない。
    await page.getByTestId('project-file-input').setInputFiles(fixturePath('maghrib.relata.json'));
    await expect(loadedNotice(page)).toBeVisible();
    await expect(confirmDialog(page)).toBeHidden();

    // 操作: データがある状態で別のファイルを選ぶ。
    await page.getByTestId('project-file-input').setInputFiles(fixturePath('other.relata.json'));
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'やめる' })).toBeFocused();
    // 操作: Esc でやめる。
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // 期待: 今のデータのまま。
    await expectCounts(page, [14, 15], [17, 17]);

    // 操作: もう一度選び、「やめる」を押す。
    await page.getByTestId('project-file-input').setInputFiles(fixturePath('other.relata.json'));
    await dialog.getByRole('button', { name: 'やめる' }).click();
    await expect(dialog).toBeHidden();
    await expectCounts(page, [14, 15], [17, 17]);
  });
});

test.describe('FR-UI-03: 進行表示', () => {
  test.beforeEach(async ({ page }) => {
    // 【なぜ】ファイルの読み取り（Blob.text）を、テストが合図するまで止める。短いファイルでは進行表示が一瞬で
    //   消えてしまうので、実時間に頼らず「読み込み中」の状態を作る。
    await page.addInitScript(() => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      Object.defineProperty(window, '__releaseRead', { value: release });
      // 【TS】メソッドを取り出すと `this` が外れる、という lint を避けるため、プロパティの型で受ける。
      const proto: { text: () => Promise<string> } = Blob.prototype;
      const original = proto.text;
      Blob.prototype.text = async function text(this: Blob) {
        await gate;
        return original.call(this);
      };
    });
  });

  test('FR-UI-03: 読み込み中は進行表示と「取り消し」が出て、終わると消える', async ({ page }) => {
    await startApp(page);
    await page.getByTestId('project-file-input').setInputFiles(fixturePath('maghrib.relata.json'));
    const panel = page.getByRole('region', { name: '進行中の処理' });
    await expect(
      panel.getByRole('progressbar', { name: 'プロジェクトを読み込み中' }),
    ).toBeVisible();
    await expect(panel.getByRole('button', { name: /取り消す/ })).toBeVisible();
    await page.evaluate(() => {
      (window as unknown as { __releaseRead: () => void }).__releaseRead(); // 理由: init script が足した合図
    });
    await expect(loadedNotice(page)).toBeVisible();
    await expect(panel).toBeHidden();
  });

  test('FR-UI-03: 取り消すと、読み取りが終わっても読み込まれない', async ({ page }) => {
    await startApp(page);
    await page.getByTestId('project-file-input').setInputFiles(fixturePath('maghrib.relata.json'));
    const panel = page.getByRole('region', { name: '進行中の処理' });
    await panel.getByRole('button', { name: /取り消す/ }).click();
    await expect(panel).toBeHidden();
    await page.evaluate(() => {
      (window as unknown as { __releaseRead: () => void }).__releaseRead();
    });
    // 期待: データは入らず、空の表示のまま（「保存」は押せない）。
    await expect(exportButton(page)).toBeDisabled();
    await expect(
      page.getByRole('heading', { name: 'データがまだ読み込まれていません' }),
    ).toBeVisible();
  });
});

test.describe('FR-PJ-02: 自動保存', () => {
  test('FR-PJ-02: 変更から 1 秒たつまで保存せず、1 秒後に保存する（時計を止めて確かめる）', async ({
    page,
  }) => {
    await startAppWithPausedClock(page);
    await page.getByTestId('project-file-input').setInputFiles(fixturePath('maghrib.relata.json'));
    // 読み込みの内部の待ち（描画の合間）を、読み込みが終わるまで少しずつ進める。
    await advanceClockUntilLoaded(page);
    // 【なぜ】初回のWorker結果も保存対象。配置完了まで待ってから保存の基準を作る。
    await expect(page.getByRole('status').filter({ hasText: 'ノードを表示' })).toBeVisible();
    await expect(page.locator('.task-panel')).toBeHidden();
    await page.clock.runFor(1100);
    await waitForAutosave(page);
    const initial = await readAutosave(page);
    // 配置済みノードの絞り込みなら座標更新は起きない。この明示操作から1秒を測る。
    await page.getByRole('checkbox', { name: 'タイプ 1', exact: true }).check();
    await page.clock.runFor(900);
    expect(await readAutosave(page)).toBe(initial);
    await page.clock.runFor(200);
    const saved = await waitForAutosave(page, (value) => value.view.filter.filters.length === 1);
    expect(saved.dataset.nodes).toHaveLength(15);
  });

  test('UC-6 / FR-PJ-02: 変更から 1 秒後の再読み込みで、データとフィルタが復元される', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib-filtered.relata.json');
    await page.getByRole('checkbox', { name: 'タイプ 1' }).check();
    // 待ち: 最新の状態（フィルタ 3 つ）が保存先に入るまで（保存の完了を知らせる画面が無いので、IndexedDB を調べる）。
    await waitForAutosave(page, (s) => s.view.filter.filters.length === 3);
    const before = await counts(page).textContent();

    await page.reload();
    // 期待: 復元の知らせと、同じ件数、同じ適用中のフィルタ、規則、孤立ノードの設定。
    await expect(
      page
        .getByRole('status')
        .filter({ hasText: '前回の自動保存' })
        .filter({ hasText: '復元しました' }),
    ).toBeVisible();
    await expect(counts(page)).toHaveText(before ?? '');
    await expect(appliedRegion(page).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('radio', { name: 'どちらかの端が通過したとき' })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /孤立ノード/ })).toBeChecked();
  });

  const broken = [
    { label: 'JSON でない文字列', value: '{"app": "Relata", ' },
    { label: 'Relata でない JSON', value: '{"app": "other"}' },
  ] as const;
  for (const { label, value } of broken) {
    test(`FR-PJ-02: 壊れた自動保存（${label}）でも、失敗が知らされ、アプリは動く`, async ({
      page,
    }) => {
      await startApp(page);
      await seedAutosave(page, value);
      await page.reload();
      // 期待: 復元の失敗が alert に出る。
      await expect(alerts(page, '前回の自動保存を復元できませんでした')).toBeVisible();
      // 期待: アプリは動く。ファイルを開いてフィルタを操作できる。
      await openProject(page, 'maghrib.relata.json');
      const box = await openAttr(page, '地名');
      await facetValue(box, 'مكناس').check();
      await expectCounts(page, [2, 15], [1, 17]);
    });
  }

  test('FR-PJ-02: 「自動保存を消す」で保存先が空になり、再読み込みしても復元されない', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await waitForAutosave(page);
    // 操作: 「保存」のダイアログの中の「自動保存を消す」を押す。
    await saveButton(page).click();
    await saveDialog(page).getByRole('button', { name: '自動保存を消す' }).click();
    await expect(
      page.getByRole('status').filter({ hasText: '保存してある分を消しました' }),
    ).toBeVisible();
    await expect.poll(() => readAutosave(page)).toBeNull();

    await page.reload();
    // 期待: 空の状態で始まる（復元の知らせも、データも無い）。
    await expect(
      page.getByRole('heading', { name: 'データがまだ読み込まれていません' }),
    ).toBeVisible();
    await expect(exportButton(page)).toBeDisabled();
    await expect(loadedNotice(page)).toHaveCount(0);
    expect(await readAutosave(page)).toBeNull();
  });

  const unavailable = [
    {
      label: 'indexedDB が無い',
      script: () => Object.defineProperty(window, 'indexedDB', { value: undefined }),
    },
    {
      label: 'open() が例外を投げる（プライベートブラウズ）',
      script: () =>
        Object.defineProperty(window, 'indexedDB', {
          value: {
            open() {
              throw new DOMException('denied', 'SecurityError');
            },
          },
        }),
    },
  ] as const;
  for (const { label, script } of unavailable) {
    test(`FR-PJ-02: 自動保存が使えない環境（${label}）では、知らせが一度だけ出て、作業は続けられる`, async ({
      page,
    }) => {
      await page.addInitScript(script);
      await startAppWithPausedClock(page);
      // 期待: 起動時の復元で使えないと分かり、alert で一度知らされる。
      const notice = alerts(page, '自動保存を使えません');
      await expect(notice).toBeVisible();
      await notice.getByRole('button', { name: '閉じる' }).click();
      await expect(notice).toHaveCount(0);

      // 操作: ファイルを開いてフィルタを変える。保存の試み（1 秒後）が何度か起きる時間だけ進める。
      await page
        .getByTestId('project-file-input')
        .setInputFiles(fixturePath('maghrib.relata.json'));
      await advanceClockUntilLoaded(page);
      const box = await openAttr(page, '地名');
      await facetValue(box, 'مكناس').check();
      await page.clock.runFor(1500);
      await facetValue(box, 'مراكش').check();
      await page.clock.runFor(1500);
      // 期待: 知らせは再び出ない。作業（絞り込み）は続けられている。
      await expect(alerts(page, '自動保存')).toHaveCount(0);
      await expectCounts(page, [4, 15], [3, 17]);
    });
  }
});

test.describe('NFR-07: 保存と開くのキーボード操作', () => {
  test('NFR-07: Tab と Enter で「保存」のダイアログを使い、「プロジェクトを開く」でファイルを選べる', async ({
    page,
  }) => {
    // 【なぜ】ファイル選択の待ちは、最初に登録する。Playwright は、待ちを登録した時点で、ブラウザの
    //   ファイル選択を横取りする設定を入れる。キーを押す直前に登録すると、設定が間に合わず、選択が
    //   Playwright に届かないことがある（アプリ側は input.click() を呼んでいる）。
    const chooserPromise = page.waitForEvent('filechooser');
    chooserPromise.catch(() => undefined);
    await startApp(page);
    await openProject(page, 'maghrib.relata.json');
    await page.locator('body').click({ position: { x: 1, y: 1 } });

    // 操作: Tab で順に「表データを読み込む」「保存」へ。
    await page.keyboard.press('Tab');
    await expect(
      page.getByRole('button', { name: '表データを読み込む', exact: true }),
    ).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(saveButton(page)).toBeFocused();
    // 操作: Enter で保存のダイアログを開き、最初の選択肢（プロジェクトを保存）を Enter で押す。
    await page.keyboard.press('Enter');
    const dialog = saveDialog(page);
    await expect(dialog).toBeVisible();
    const project = dialog.getByRole('button', { name: /^プロジェクトを保存/ });
    await expect(project).toBeFocused();
    const downloading = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    expect((await downloading).suggestedFilename()).toMatch(/\.relata\.json$/);
    // 期待: ダイアログは閉じ、フォーカスは「保存」に戻る。
    await expect(dialog).toBeHidden();
    await expect(saveButton(page)).toBeFocused();

    // 操作: もう一度開き、Tab で「自動保存を消す」まで進んで Enter。
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    // 【なぜ】図の書き出しは「書き出し」に移した（T2-08）ので、保存のダイアログの選択肢は 2 つ。Tab は 1 回。
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: '自動保存を消す' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('status').filter({ hasText: '保存してある分を消しました' }),
    ).toBeVisible();

    // 操作: Tab で「プロジェクトを開く」へ進み、Enter でファイル選択を開く。
    await saveButton(page).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'プロジェクトを開く' })).toBeFocused();
    await page.keyboard.press('Enter');
    const chooser = await chooserPromise;
    await chooser.setFiles(fixturePath('other.relata.json'));
    // 期待: 確認のダイアログが出て、既定のフォーカスは「やめる」。Tab で「開く」へ進み Enter で置き換える。
    const confirm = confirmDialog(page);
    await expect(confirm.getByRole('button', { name: 'やめる' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(confirm.getByRole('button', { name: '開く' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expectCounts(page, [2, 2], [1, 1]);
  });
});

test.describe('FR-UI-01: 英語の画面', () => {
  test.use({ locale: 'en-US' });

  test('FR-IN-08 / FR-UI-01: 英語でも、ボタン、知らせ、確認、失敗の文言が出る', async ({
    page,
  }) => {
    await startApp(page);
    const group = page.getByRole('group', { name: 'Project' });
    for (const name of ['Save', 'Open project']) {
      await expect(group.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // 「Clear autosave」は「Save」のダイアログの中にある。
    await group.getByRole('button', { name: 'Save', exact: true }).click();
    const save = page.getByRole('dialog', { name: 'Save', exact: true });
    await expect(save.getByRole('button', { name: 'Clear autosave', exact: true })).toBeVisible();
    await expect(save.getByRole('button', { name: /^Save project/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(save).toBeHidden();
    await openProject(page, 'maghrib.relata.json');
    await expect(counts(page)).toHaveText('Nodes 14 / 15Edges 17 / 17');
    // 操作: 壊れたファイルを開く。確認は英語の「Open」で答える。
    await openProject(
      page,
      bad('wrong-app.relata.json'),
      alerts(page, 'Not a Relata project file'),
    );
    await expect(alerts(page, 'Could not open the project')).toBeVisible();
    await expect(counts(page)).toHaveText('Nodes 14 / 15Edges 17 / 17');
  });
});
