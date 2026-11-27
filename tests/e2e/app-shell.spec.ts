import { expect, test } from './fixtures';
import { startApp } from './support';

// 【なぜ】ブラウザの言語は test.use({ locale }) で明示する。Chromium の既定は en-US で、
//       言語の自動判定（D-16）が入ったので、指定しないと lang が環境しだいになってしまう。

test.describe('アプリの外枠（日本語のブラウザ）', () => {
  test.use({ locale: 'ja-JP' });

  test('NFR-01: 静的にビルドしたアプリが表示される（見出し「Relata」と lang="ja"）', async ({
    page,
  }) => {
    // 操作: ビルド済みのアプリを開く。
    // 【なぜ】相対の './' にする。baseURL が /Relata/ なので、base の外（'/'）を開く誤りを防げる。
    await page.goto('./');

    // 期待: 見出し「Relata」が見える。
    await expect(page.getByRole('heading', { name: 'Relata', level: 1 })).toBeVisible();
    // 期待: ブラウザが ja-JP なので html の lang は ja（読み上げや字形選択のため）。
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });
});

test.describe('FR-UI-01 / D-16: 言語の自動判定', () => {
  const cases = [
    { locale: 'ja-JP', expected: 'ja' },
    { locale: 'en-US', expected: 'en' },
    // 未対応の言語（アラビア語）は英語に落ちる。
    { locale: 'ar', expected: 'en' },
  ] as const;

  for (const { locale, expected } of cases) {
    test.describe(`ブラウザの言語 ${locale}`, () => {
      test.use({ locale });

      test(`FR-UI-01 / D-16: ${locale} で開くと html の lang が ${expected} になる`, async ({
        page,
      }) => {
        // 操作: 保存された選択のない状態で開く（テストごとに新しい文脈なので空）。
        await page.goto('./');
        // 期待: 判定結果が lang に反映される。
        await expect(page.locator('html')).toHaveAttribute('lang', expected);
      });
    });
  }
});

test.describe('FR-UI-01: 言語の切り替え', () => {
  test.use({ locale: 'ja-JP' });

  test('FR-UI-01: 言語のボタンで lang、title、案内文、aria-pressed が変わり、再読み込みしても残る', async ({
    page,
  }) => {
    await page.goto('./');
    const group = page.getByRole('group', { name: '言語' });
    const jaBtn = group.getByRole('button', { name: '日本語' });
    const enBtn = group.getByRole('button', { name: 'English' });

    // 初期（日本語）: 案内文、title、押下状態。
    await expect(page.getByText('歴史研究のためのネットワーク可視化ツール')).toBeVisible();
    await expect(jaBtn).toHaveAttribute('aria-pressed', 'true');
    await expect(enBtn).toHaveAttribute('aria-pressed', 'false');

    // 操作: English を押す。
    await enBtn.click();

    // 期待: lang、title、案内文、aria-pressed が英語側に変わる。
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page).toHaveTitle('Relata');
    await expect(
      page.getByText('A network visualization tool for historical research'),
    ).toBeVisible();
    // 【なぜ】グループ名も英語（Language）に変わるので、取り直す。
    const enGroup = page.getByRole('group', { name: 'Language' });
    await expect(enGroup.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(enGroup.getByRole('button', { name: '日本語' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // 操作: 再読み込み。ブラウザ側は ja-JP のままなので、残るなら保存された選択が効いている。
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(
      page.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'English' }),
    ).toHaveAttribute('aria-pressed', 'true');

    // 操作: 日本語に戻して、また再読み込み。
    await page.getByRole('button', { name: '日本語' }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
  });
});

test.describe('FR-UI-05: このツールについて', () => {
  test.use({ locale: 'en-US' });

  test('FR-UI-05: ダイアログに Palladio、BSD-3-Clause、ライブラリ（react、react-dom、zustand）が出る', async ({
    page,
  }) => {
    await page.goto('./');
    // 操作: 「About this tool」を押す。
    await page.getByRole('button', { name: 'About this tool' }).click();

    const dialog = page.getByRole('dialog', { name: 'About this tool' });
    await expect(dialog).toBeVisible();
    // 期待: 由来とライセンス。
    await expect(dialog).toContainText('Palladio');
    await expect(dialog).toContainText('BSD-3-Clause');
    // 期待: ライブラリの表に 3 つ（名前の完全一致。react が react-dom に部分一致しないように）。
    const table = dialog.getByRole('table');
    for (const name of ['react', 'react-dom', 'zustand']) {
      await expect(table.getByRole('cell', { name, exact: true })).toBeVisible();
    }
  });
});

test.describe('NFR-07: キーボード操作', () => {
  test.use({ locale: 'en-US' });

  test('NFR-07: Tab と Enter だけでダイアログを開け、Esc で閉じ、フォーカスが元のボタンに戻る', async ({
    page,
  }) => {
    // 【なぜ】`startApp` で、最初の描画（見出しとヘッダのボタン）が済むまで待つ。`goto` の完了は描画の完了を
    //   保証しない。描画の前に Tab を押すと、キー入力が空振りして、その後の `toBeFocused` が待っても満たされない
    //   （初回の起動が遅いときだけ落ちる、不安定さの疑われる原因）。
    await startApp(page);
    const opener = page.getByRole('button', { name: 'About this tool' });
    await expect(opener).toBeVisible();
    // 【なぜ】開始位置を明示する。ページにフォーカスが無い状態の最初の Tab は、環境によって取りこぼされうる。
    //   ページの端（見出しの外）をクリックして、文書にフォーカスを置いてから、先頭へ戻す。
    await page.locator('body').click({ position: { x: 1, y: 1 } });

    // 操作: Tab だけで「About this tool」へ進む。順序はヘッダの左から:
    //   「Import tables」「Save」「Open project」（データが無いので「Export CSV」は無効で飛ばされる）、日本語、English、About。
    const order = [
      page.getByRole('button', { name: 'Import tables' }),
      page.getByRole('button', { name: 'Save', exact: true }),
      page.getByRole('button', { name: 'Open project' }),
      page.getByRole('button', { name: '日本語' }),
      page.getByRole('button', { name: 'English' }),
      opener,
    ];
    for (const button of order) {
      await page.keyboard.press('Tab');
      await expect(button).toBeFocused();
    }

    // 操作: Enter で開く。
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'About this tool' });
    await expect(dialog).toBeVisible();
    // 期待: フォーカスはダイアログの中に移る。
    await expect(dialog.locator(':focus')).toHaveCount(1);

    // 操作: Esc で閉じる。
    await page.keyboard.press('Escape');
    // 期待: 閉じて、フォーカスは開いたボタンに戻る。
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});
