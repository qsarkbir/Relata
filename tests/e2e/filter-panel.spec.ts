/**
 * フィルタパネル（T1-18）の E2E。読み込んだ見本のプロジェクト（tests/fixtures/e2e/maghrib.relata.json）の上で試す。
 *
 * 見本は、ノード 15（孤立 1、同名異人 1 組、欠損の理由 4 種）、エッジ 17（自己ループ、往復を含む）。
 * 既定（孤立ノードを表示しない）では、最初の件数は「ノード 14 / 15、エッジ 17 / 17」。
 * 期待する件数は、見本の中身から手で数えた（各テストのコメントに根拠を書く）。
 */
import { expect, test } from '@playwright/test';
import {
  appliedRegion,
  attrBox,
  expectCounts,
  facetValue,
  openAttr,
  openProject,
  startApp,
} from './support';

test.use({ locale: 'ja-JP' });

test.beforeEach(async ({ page }) => {
  await startApp(page);
  await openProject(page, 'maghrib.relata.json');
});

test.describe('FR-FL-09: 件数', () => {
  test('FR-FL-09: 読み込み直後は、絞り込み後と全体の数が並ぶ（孤立ノードは既定で除く）', async ({
    page,
  }) => {
    // 期待: ノード 15 のうち孤立の p20 を除いた 14、エッジは 17 すべて。
    await expectCounts(page, [14, 15], [17, 17]);
  });
});

test.describe('FR-FL-01 / FR-FL-02: 対象ごとのフィルタとノード型', () => {
  test('FR-FL-01: ノード用とエッジ用が別の区画として並ぶ', async ({ page }) => {
    await expect(page.getByRole('region', { name: 'ノード' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'エッジ' })).toBeVisible();
    // 期待: ノードにもエッジにも、別々のテキスト検索がある。
    await expect(page.getByRole('search', { name: 'ノードのテキスト検索' })).toBeVisible();
    await expect(page.getByRole('search', { name: 'エッジのテキスト検索' })).toBeVisible();
  });

  test('FR-FL-02: ノード型「タイプ 2」だけにすると、そのノードと間のエッジだけが残る', async ({
    page,
  }) => {
    // 操作: タイプ 2 をチェック。タイプ 2 は p18、p19、p39、p35b（4 人）。
    await page.getByRole('checkbox', { name: 'タイプ 2' }).check();
    // 期待: 両端がタイプ 2 のエッジは e9（18→19）と e-35b（35b→39）の 2 本。端点の 4 人が見える。
    await expectCounts(page, [4, 15], [2, 17]);
    await expect(appliedRegion(page)).toContainText('タイプ 2');
    // 期待: 解除ボタンの読み上げに、選んでいる型の名前が入る（どのボタンか区別できる）。
    await expect(
      appliedRegion(page).getByRole('button', { name: '「ノード ノード型: タイプ 2」を解除する' }),
    ).toBeVisible();
  });

  test('FR-FL-02: エッジ用のテキスト検索は、関係の名前（relation）に当たる', async ({ page }) => {
    // 操作: エッジの検索語に「ذكر」（自己ループ e-self の relation「ذكر نفسه」の一部）。
    const search = page.getByRole('search', { name: 'エッジのテキスト検索' });
    await search.getByRole('searchbox').fill('ذكر');
    await search.getByRole('button', { name: '検索' }).click();
    // 期待: エッジは e-self の 1 本。両端（p6）だけが残るのでノード 1。
    await expectCounts(page, [1, 15], [1, 17]);
  });
});

test.describe('FR-FL-02 / FR-FL-07: ファセット', () => {
  test('FR-FL-02 / FR-FL-07: 値をチェックすると一覧に出て件数が変わり、同じファセットの他の値は 0 にならない', async ({
    page,
  }) => {
    const box = await openAttr(page, '地名');
    // 操作: 「مكناس」（p3、p4）をチェック。
    await facetValue(box, 'مكناس').check();
    // 期待: 両端が通る e4（3→4）だけ。ノード 2、エッジ 1。
    await expectCounts(page, [2, 15], [1, 17]);
    // 期待: 適用中の一覧に載る。
    await expect(appliedRegion(page)).toContainText('地名: مكناس');
    // 期待: 同じ属性の他の値（مراكش 2 / 2）は、自分自身のフィルタに影響されず 0 にならない。
    await expect(facetValue(box, 'مراكش')).toHaveAccessibleName(/他の条件に合う件数 2、全体 2/);
    await expect(facetValue(box, 'مكناس')).toHaveAccessibleName(/他の条件に合う件数 2、全体 2/);
  });

  test('FR-FL-07: 他の属性のフィルタは件数に効く（年が 950 以上なら、مكناس は 0 / 2）', async ({
    page,
  }) => {
    const place = await openAttr(page, '地名');
    const year = await openAttr(page, '年');
    // 操作: 年の最小に 950 を適用（p4=900 と p3=930 は外れる）。
    await year.getByRole('textbox', { name: '最小' }).fill('950');
    await year.getByRole('button', { name: '適用' }).click();
    // 期待: مكناس は「他の条件に合う件数 0、全体 2」。شفشاون（p1=980、p2=950）は 2 / 2。
    await expect(facetValue(place, 'مكناس')).toHaveAccessibleName(/他の条件に合う件数 0、全体 2/);
    await expect(facetValue(place, 'شفشاون')).toHaveAccessibleName(/他の条件に合う件数 2、全体 2/);
  });

  test('FR-FL-06: 欠損は理由ごとの項目として並び、他の値と同じように選べる', async ({ page }) => {
    const box = await openAttr(page, '地名');
    // 期待: 4 つの理由が別々の項目（見本は地名に 4 種の欠損がある）。
    for (const reason of ['記載なし', '失われた', '判読不能', '該当なし']) {
      await expect(facetValue(box, `（欠損: ${reason}）`)).toBeVisible();
    }
    // 操作: 「失われた」（p40）と「記載なし」（anon）を選ぶ。
    await facetValue(box, '（欠損: 失われた）').check();
    await facetValue(box, '（欠損: 記載なし）').check();
    // 期待: e-anon（anon→40）だけが両端とも通る。
    await expectCounts(page, [2, 15], [1, 17]);
    await expect(appliedRegion(page)).toContainText('（欠損: 失われた）');
  });
});

test.describe('FR-FL-06 / UC-4: 範囲と欠損の扱い', () => {
  test('FR-FL-06 / UC-4: 欠損を除く（既定）と含めるで件数が変わり、除いた件数が一覧に常に出る', async ({
    page,
  }) => {
    const year = await openAttr(page, '年');
    await year.getByRole('textbox', { name: '最小' }).fill('900');
    await year.getByRole('button', { name: '適用' }).click();
    // 期待（除く）: 年が 900 以上で欠損でないのは p1、p2、p3、p4、p5、p6、p18、p19、p35、p40 の 10 人。
    //   その間のエッジは e1、e2、e3、e4、e6、e8、e9、e13、e141、e-self の 10 本。
    await expectCounts(page, [10, 15], [10, 17]);
    // 期待: 欠損のために除いた 4 件（p20、p39、anon、p35b）が、一覧と部品の両方に出る。
    await expect(appliedRegion(page)).toContainText('年: 900 以上');
    await expect(appliedRegion(page)).toContainText('欠損で除外: 4 件');
    await expect(year).toContainText('欠損のために除いた件数: 4');

    // 操作: 欠損の扱いを「含める」にする（適用中なら即時に反映される）。
    await year.getByRole('combobox', { name: '欠損の扱い' }).selectOption('include');
    // 期待: 通るのは p7（860）以外の 14 人。エッジは e5、e7、e10 を除く 14 本。孤立の p20 は見えず 13 人。
    await expectCounts(page, [13, 15], [14, 17]);
    await expect(appliedRegion(page)).toContainText('欠損を含む');
    await expect(appliedRegion(page)).not.toContainText('欠損で除外');
  });

  test('FR-FL-02: 数値欄にアラビア・インド数字（٩٠٠）を入れて適用できる', async ({ page }) => {
    const year = await openAttr(page, '年');
    await year.getByRole('textbox', { name: '最小' }).fill('٩٠٠');
    await year.getByRole('button', { name: '適用' }).click();
    // 期待: 「900」と同じ結果（10 / 10）で、一覧にも 900 と出る。
    await expectCounts(page, [10, 15], [10, 17]);
    await expect(appliedRegion(page)).toContainText('年: 900 以上');
    await expect(year.getByRole('alert')).toHaveCount(0);
  });

  test('FR-FL-02: 数値として読めない「1e」はエラーになり、フィルタは変わらない', async ({
    page,
  }) => {
    const year = await openAttr(page, '年');
    await year.getByRole('textbox', { name: '最小' }).fill('1e');
    await year.getByRole('button', { name: '適用' }).click();
    // 期待: エラー（role=alert）が出て、件数は初期のまま、一覧は空のまま。
    await expect(year.getByRole('alert')).toHaveText('数値を入力してください。');
    await expectCounts(page, [14, 15], [17, 17]);
    await expect(appliedRegion(page)).toContainText('適用中のフィルタはありません。');
  });

  test('FR-FL-02 / FR-FL-06: 不正な下書きのまま欠損の扱いだけ切り替えても、誤りの表示は残る', async ({
    page,
  }) => {
    const year = await openAttr(page, '年');
    const min = year.getByRole('textbox', { name: '最小' });
    await min.fill('900');
    await min.press('Enter');
    await expectCounts(page, [10, 15], [10, 17]);
    // 操作: 最小を読めない値にして適用し、誤りを出す。
    await min.fill('abc');
    await year.getByRole('button', { name: '適用' }).click();
    await expect(year.getByRole('alert')).toHaveText('数値を入力してください。');
    // 操作: 欠損の扱いだけ切り替える（適用中なので即時に反映される）。
    await year.getByRole('combobox', { name: '欠損の扱い' }).selectOption('include');
    // 期待: 欠損の扱いは反映され（範囲は 900 以上のまま）、入力欄の「abc」と誤りの表示は残る。
    await expectCounts(page, [13, 15], [14, 17]);
    await expect(appliedRegion(page)).toContainText('年: 900 以上');
    await expect(min).toHaveValue('abc');
    await expect(year.getByRole('alert')).toHaveText('数値を入力してください。');
  });

  test('FR-FL-02: 最小が最大より大きいと適用できない', async ({ page }) => {
    const year = await openAttr(page, '年');
    await year.getByRole('textbox', { name: '最小' }).fill('950');
    await year.getByRole('textbox', { name: '最大' }).fill('900');
    await year.getByRole('button', { name: '適用' }).click();
    await expect(year.getByRole('alert')).toContainText('最小が最大より大きい');
    await expectCounts(page, [14, 15], [17, 17]);
  });

  test('FR-FL-02: 入力して適用するまでは「未適用」と示し、適用すると消える', async ({ page }) => {
    const year = await openAttr(page, '年');
    const min = year.getByRole('textbox', { name: '最小' });
    await min.fill('900');
    // 期待: 未適用の表示が出て、件数は変わらない。入力欄の説明（aria-describedby）にもなる。
    await expect(year.getByText('未適用の変更があります')).toBeVisible();
    await expect(min).toHaveAccessibleDescription(/未適用の変更があります/);
    await expectCounts(page, [14, 15], [17, 17]);
    // 操作: Enter で適用。
    await min.press('Enter');
    await expect(year.getByText('未適用の変更があります')).toBeHidden();
    await expectCounts(page, [10, 15], [10, 17]);
  });
});

test.describe('FR-FL-12: テキスト検索のゆるい／厳密', () => {
  test('FR-FL-12: ゆるいならハムザなしの「احمد」が「أحمد」に当たり、厳密に切り替えると当たらない', async ({
    page,
  }) => {
    const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
    // 操作: ハムザ付きのアリフを含まない「احمد」で検索（既定は「ゆるい」）。
    await search.getByRole('searchbox').fill('احمد');
    await search.getByRole('button', { name: '検索' }).click();
    // 期待: ラベルが「أحمد…」の p18 と p19 に当たる。間のエッジ e9 が 1 本。
    await expectCounts(page, [2, 15], [1, 17]);
    await expect(appliedRegion(page)).toContainText('ゆるい');

    // 操作: 「厳密」に切り替える（適用中なら即時に反映される）。
    await search.getByRole('combobox', { name: '照合' }).selectOption('strict');
    // 期待: 表記が違うので 1 件も当たらない。
    await expectCounts(page, [0, 15], [0, 17]);
    await expect(appliedRegion(page)).toContainText('厳密');

    // 操作: ハムザ付きの「أحمد」を厳密のまま検索する。
    await search.getByRole('searchbox').fill('أحمد');
    await search.getByRole('button', { name: '検索' }).click();
    // 期待: 厳密でも、表記が同じなら当たる。
    await expectCounts(page, [2, 15], [1, 17]);
  });

  test('FR-FL-12: 空の検索語で確定すると、検索を解除する', async ({ page }) => {
    const search = page.getByRole('search', { name: 'ノードのテキスト検索' });
    await search.getByRole('searchbox').fill('احمد');
    await search.getByRole('button', { name: '検索' }).click();
    await expectCounts(page, [2, 15], [1, 17]);
    await search.getByRole('searchbox').fill('');
    await search.getByRole('button', { name: '検索' }).click();
    await expectCounts(page, [14, 15], [17, 17]);
    await expect(appliedRegion(page)).toContainText('適用中のフィルタはありません。');
  });
});

test.describe('FR-FL-04 / FR-FL-05: エッジの規則と孤立ノード', () => {
  test('FR-FL-04: 「どちらかの端が通過したとき」に切り替えると、片端だけ通るエッジも残る', async ({
    page,
  }) => {
    const box = await openAttr(page, '地名');
    await facetValue(box, 'مكناس').check(); // p3、p4
    await expectCounts(page, [2, 15], [1, 17]);
    // 操作: 片端の規則にする。
    await page.getByRole('radio', { name: 'どちらかの端が通過したとき' }).check();
    // 期待: p3 か p4 を端にもつ e3（2→3）、e4、e5（4→7）の 3 本。端点の p2、p3、p4、p7 の 4 人が見える。
    await expectCounts(page, [4, 15], [3, 17]);
  });

  test('FR-FL-05: 孤立ノードを表示するにすると、エッジのないノードも数える', async ({ page }) => {
    const box = await openAttr(page, '地名');
    await facetValue(box, 'المدينة').check(); // p20 だけ（エッジなし）
    // 期待: 既定（表示しない）では何も見えない。
    await expectCounts(page, [0, 15], [0, 17]);
    // 操作: 孤立ノードを表示する。
    await page.getByRole('checkbox', { name: /孤立ノード/ }).check();
    await expectCounts(page, [1, 15], [0, 17]);
  });
});

test.describe('FR-FL-08: 適用中のフィルタの一覧と解除', () => {
  test('FR-FL-08: 個別に解除すると、その部品のチェックも外れる。一括解除で全部なくなる', async ({
    page,
  }) => {
    const place = await openAttr(page, '地名');
    const year = await openAttr(page, '年');
    await facetValue(place, 'مكناس').check();
    await year.getByRole('textbox', { name: '最小' }).fill('900');
    await year.getByRole('button', { name: '適用' }).click();
    const applied = appliedRegion(page);
    await expect(applied.getByRole('listitem')).toHaveCount(2);

    // 操作: 地名の行だけ解除する。
    await applied.getByRole('button', { name: /地名: مكناس.*を解除する/ }).click();
    // 期待: 一覧は 1 行、部品のチェックは外れ、件数は年のフィルタだけの結果（10 / 10）。
    await expect(applied.getByRole('listitem')).toHaveCount(1);
    await expect(facetValue(place, 'مكناس')).not.toBeChecked();
    await expectCounts(page, [10, 15], [10, 17]);

    // 操作: すべて解除。
    await applied.getByRole('button', { name: 'すべて解除' }).click();
    await expect(applied).toContainText('適用中のフィルタはありません。');
    await expect(year.getByRole('textbox', { name: '最小' })).toHaveValue('');
    await expect(applied.getByRole('button', { name: 'すべて解除' })).toBeDisabled();
    await expectCounts(page, [14, 15], [17, 17]);
  });

  test('FR-FL-08: 部品の側でチェックを全部外すと、一覧からも消える', async ({ page }) => {
    const place = await openAttr(page, '地名');
    await facetValue(place, 'مكناس').check();
    await expect(appliedRegion(page).getByRole('listitem')).toHaveCount(1);
    await facetValue(place, 'مكناس').uncheck();
    await expect(appliedRegion(page)).toContainText('適用中のフィルタはありません。');
  });
});

test.describe('FR-FL-10: Undo / Redo', () => {
  test('FR-FL-10: ボタンで元に戻し、やり直せる', async ({ page }) => {
    const undo = page.getByRole('button', { name: '元に戻す' });
    const redo = page.getByRole('button', { name: 'やり直す' });
    await expect(undo).toBeDisabled();
    const box = await openAttr(page, '地名');
    await facetValue(box, 'مكناس').check();
    await expectCounts(page, [2, 15], [1, 17]);
    await undo.click();
    await expectCounts(page, [14, 15], [17, 17]);
    await expect(facetValue(box, 'مكناس')).not.toBeChecked();
    await expect(redo).toBeEnabled();
    await redo.click();
    await expectCounts(page, [2, 15], [1, 17]);
    await expect(facetValue(box, 'مكناس')).toBeChecked();
  });

  test('FR-FL-10: Ctrl+Z で元に戻し、Shift+Ctrl+Z でやり直す', async ({ page }) => {
    const box = await openAttr(page, '地名');
    await facetValue(box, 'مكناس').check();
    await expectCounts(page, [2, 15], [1, 17]);
    // 操作: チェックボックスにフォーカスがある状態で Ctrl+Z。
    await page.keyboard.press('Control+z');
    await expectCounts(page, [14, 15], [17, 17]);
    await page.keyboard.press('Control+Shift+z');
    await expectCounts(page, [2, 15], [1, 17]);
  });

  test('FR-FL-10: 検索欄にフォーカスがあるときは Ctrl+Z でフィルタを戻さない（欄の取り消しに任せる）', async ({
    page,
  }) => {
    const box = await openAttr(page, '地名');
    await facetValue(box, 'مكناس').check();
    await expectCounts(page, [2, 15], [1, 17]);
    // 操作: 検索欄に入力してフォーカスを置いたまま Ctrl+Z。
    const searchbox = page
      .getByRole('search', { name: 'ノードのテキスト検索' })
      .getByRole('searchbox');
    await searchbox.fill('abc');
    await searchbox.press('Control+z');
    // 期待: フィルタは戻らない。
    await expectCounts(page, [2, 15], [1, 17]);
    await expect(page.getByRole('button', { name: '元に戻す' })).toBeEnabled();
    await expect(appliedRegion(page)).toContainText('地名: مكناس');
  });

  test('FR-FL-10: ダイアログが開いている間は Ctrl+Z が効かない', async ({ page }) => {
    const box = await openAttr(page, '地名');
    await facetValue(box, 'مكناس').check();
    await expectCounts(page, [2, 15], [1, 17]);
    await page.getByRole('button', { name: 'このツールについて' }).click();
    const dialog = page.getByRole('dialog', { name: 'このツールについて' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Control+z');
    // 期待: 閉じてからも、フィルタは残っている。
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectCounts(page, [2, 15], [1, 17]);
  });
});

test.describe('NFR-07: フィルタのキーボード操作', () => {
  test('NFR-07: Tab、Enter、Space だけで、属性を開いて値を選べる', async ({ page }) => {
    // 操作: 「地名」の見出しへ Tab で進む（先頭から数える。上限を決め、無限に回らない）。
    const summary = page.locator('summary', { hasText: '地名' });
    await page.locator('body').click({ position: { x: 1, y: 1 } });
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await summary.evaluate((el) => el === document.activeElement);
    }
    expect(reached, '地名の見出しに Tab で到達できる').toBe(true);
    // 操作: Enter で開き、Tab で最初の項目へ、Space でチェック。
    await page.keyboard.press('Enter');
    await expect(attrBox(page, '地名')).toHaveAttribute('open', '');
    // 【なぜ】項目の描画は `toggle` イベントの後（React の状態の更新）。項目が見えてから Tab を押す。
    //   `open` 属性の確認だけで進むと、項目が描かれる前に Tab が次の見出しへ進んでしまう。
    await expect(page.getByRole('checkbox', { name: /^شفشاون/ })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('checkbox', { name: /^شفشاون/ })).toBeFocused();
    await page.keyboard.press('Space');
    // 期待: شفشاون（p1、p2）が選ばれる。p1→p2 の e1 が 1 本。
    await expectCounts(page, [2, 15], [1, 17]);
  });
});
