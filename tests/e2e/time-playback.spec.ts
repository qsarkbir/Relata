/**
 * 時間の再生（T2-06）の E2E。FR-TM-02（再生、一時停止、コマ送り、速度、方式）、
 * FR-TM-03（グラフ・年表・適用中の条件の行で時刻を共有して連動）、FR-PJ-01（view.time の保存と復元）。
 *
 * 見本は公開サンプル（public/samples/maghrib.relata.json）。ノード 219、エッジ 204。日付は属性
 * 「Year (AH)」（ヒジュラ暦の年）で、エッジに日付は無い。再生は表示だけを変える（R-17）ので、件数と表は変わらない。
 * 待ちは時間の経過ではなく、画面の状態（時刻の文、要素の数）で行う。
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openProject, readAutosave, saveProjectFile, startApp, waitForAutosave } from './support';

test.use({ locale: 'ja-JP' });

function conditions(page: Page): Locator {
  return page.getByRole('region', { name: '適用中の条件' });
}
function bottom(page: Page): Locator {
  return page.getByRole('region', { name: '下の段' });
}
/** 年表の付近の再生の操作。 */
function controls(page: Page): Locator {
  return bottom(page).getByRole('group', { name: '時間の再生' });
}
function timeState(page: Page): Locator {
  return controls(page).getByTestId('time-state');
}
/** 図の中で、時刻の外として薄くしたノード・エッジ。 */
function fadedNodes(page: Page): Locator {
  return page.locator('#graph-view-nodes [data-out-of-time="true"]');
}
function fadedEdges(page: Page): Locator {
  return page.locator('#graph-view-edges [data-out-of-time="true"]');
}

async function loadSample(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  await startApp(page);
  await page.getByRole('button', { name: 'サンプルを読み込む' }).click();
  await expect(conditions(page)).toContainText('/ 219');
  await page.getByRole('tab', { name: '年表' }).click();
  await expect(controls(page)).toBeVisible();
  // 図が描かれるまで待つ。
  await expect(page.locator('#graph-view-nodes > *').first()).toBeAttached();
}

/** 描画を 2 回待つ（止まったはずの再生が、もう動かないことを確かめる前の区切り）。 */
async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}

/** つまみ（区切りの番号）を、全体の ratio（0〜1）の位置へ動かす。 */
async function seekRatio(page: Page, ratio: number): Promise<void> {
  const slider = controls(page).getByRole('slider', { name: '時刻' });
  const max = Number(await slider.getAttribute('max'));
  await slider.fill(String(Math.round(max * ratio)));
}

async function nodeCount(page: Page): Promise<number> {
  return page.locator('#graph-view-nodes > *').count();
}

test.describe('時間の再生', () => {
  test('FR-TM-02: 再生で時刻が進み、一時停止で止まる。コマ送りで前後へ動く', async ({ page }) => {
    await loadSample(page);
    await expect(timeState(page)).toContainText('時刻は未設定');
    await controls(page).getByLabel('速度').selectOption('100');
    const play = controls(page).getByRole('button', { name: '再生', exact: true });
    await play.click();
    await expect(
      controls(page).getByRole('button', { name: '一時停止', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    // 時刻が変わっていく（文が「まで（累積）」の形になり、年が増える）。
    await expect(timeState(page)).toContainText('まで（累積）');
    const first = (await timeState(page).textContent()) ?? '';
    await expect.poll(async () => (await timeState(page).textContent()) ?? '').not.toBe(first);
    await controls(page).getByRole('button', { name: '一時停止', exact: true }).click();
    await expect(play).toHaveAttribute('aria-pressed', 'false');
    const paused = (await timeState(page).textContent()) ?? '';
    await settleFrames(page);
    await settleFrames(page);
    await expect(timeState(page)).toHaveText(paused);

    // コマ送り: 次、次、前（年表の区切りの末日に合う）。
    const stepNext = controls(page).getByRole('button', { name: '次のコマ' });
    await stepNext.click();
    const afterNext = (await timeState(page).textContent()) ?? '';
    await stepNext.click();
    const afterNext2 = (await timeState(page).textContent()) ?? '';
    expect(afterNext2).not.toBe(afterNext);
    await controls(page).getByRole('button', { name: '前のコマ' }).click();
    await expect(timeState(page)).toHaveText(afterNext);

    // 時刻を解除すると、薄い表示もやめる。
    await controls(page).getByRole('button', { name: '時刻を解除' }).click();
    await expect(timeState(page)).toContainText('時刻は未設定');
    await expect(fadedNodes(page)).toHaveCount(0);
  });

  test('FR-TM-02: 再生を最後まで進めると、そこで止まる', async ({ page }) => {
    await loadSample(page);
    await controls(page).getByLabel('速度').selectOption('100');
    await controls(page).getByRole('button', { name: '再生', exact: true }).click();
    await expect(controls(page).getByRole('button', { name: '再生', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
      { timeout: 60_000 },
    );
    // 最後まで進んだので、累積ではすべてのノードが時刻の中（薄いものは無い）。
    await expect(timeState(page)).toContainText('まで（累積）');
    await expect(fadedNodes(page)).toHaveCount(0);
  });

  test('FR-TM-03: 時刻の外のノードとエッジは薄くなる（消えない）。件数と表は変わらない', async ({
    page,
  }) => {
    await loadSample(page);
    const total = await nodeCount(page);
    expect(total).toBeGreaterThan(0);
    // 表示件数（孤立ノードは既定で出さないので 219 より少ない）。再生の前後で同じ。
    const shownText = async (): Promise<string> =>
      /ノード\s*[\d,]+\s*\/\s*219/u.exec((await conditions(page).textContent()) ?? '')?.[0] ?? '';
    const countsBefore = await shownText();
    expect(countsBefore).not.toBe('');
    // 表の行数（時刻を動かす前）
    await page.getByRole('tab', { name: '表', exact: true }).click();
    const rows = bottom(page).locator('tbody tr');
    await expect(rows.first()).toBeVisible();
    const rowsBefore = await rows.count();
    await page.getByRole('tab', { name: '年表' }).click();

    await controls(page).getByRole('button', { name: '次のコマ' }).click();
    // 先頭の区切りの末日までの累積。多くのノードがまだ始まっていないので薄くなる。
    await expect.poll(() => fadedNodes(page).count()).toBeGreaterThan(0);
    // 消えていない: 描いたノードの数は同じ。
    expect(await nodeCount(page)).toBe(total);
    // 日付のないエッジは端点に従って薄くなる。
    await expect.poll(() => fadedEdges(page).count()).toBeGreaterThan(0);
    // 薄くしている理由が、図の上に文でも出る（消していないこと、件数が変わらないこと）。
    const note = page.getByTestId('time-fade-note');
    await expect(note).toContainText('薄く表示しています');
    await expect(note).toContainText('件数と表は変わりません');
    // 件数（表示件数）とフィルタの数は変わらない。適用中の条件の行には時刻が加わるだけ。
    expect(await shownText()).toBe(countsBefore);
    await expect(conditions(page)).toContainText('フィルタ 0');
    // 表の行数も変わらない。
    await page.getByRole('tab', { name: '表', exact: true }).click();
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBe(rowsBefore);
  });

  test('FR-TM-02: 累積と移動窓で、薄くなる要素が変わる。窓の帯が年表に出る', async ({ page }) => {
    await loadSample(page);
    // 区切りの 92% ほどまで進める（サンプルの日付はほぼ AH 900 年代＝西暦 16 世紀で、軸は 7 世紀から 17 世紀ごろまで）。
    await seekRatio(page, 0.92);
    const cursor = bottom(page).getByTestId('time-cursor');
    await expect(cursor).toBeAttached();
    await expect(cursor.locator('.tl-time-window')).toHaveCount(0);
    await expect(timeState(page)).toContainText('まで（累積）');
    const cumulative = await fadedNodes(page).count();

    await controls(page).getByLabel('表示方式').selectOption('window');
    await controls(page).getByLabel('窓の幅').selectOption('10');
    await expect(cursor.locator('.tl-time-window')).toHaveCount(1);
    // 移動窓は、終わった（窓より前の）ものも薄くするので、累積より薄い要素が増える。
    await expect.poll(() => fadedNodes(page).count()).toBeGreaterThan(cumulative);
    const windowed = await fadedNodes(page).count();
    await expect(timeState(page)).toContainText('直近10年の窓');

    // 窓を 100 年に広げると、薄い要素は減る。
    await controls(page).getByLabel('窓の幅').selectOption('100');
    await expect.poll(() => fadedNodes(page).count()).toBeLessThan(windowed);

    // 累積に戻すと、窓の帯は消え、薄い数は累積の値に戻る。
    await controls(page).getByLabel('表示方式').selectOption('cumulative');
    await expect(cursor.locator('.tl-time-window')).toHaveCount(0);
    await expect.poll(() => fadedNodes(page).count()).toBe(cumulative);
  });

  test('FR-TM-03: 年表のカーソルは時刻と連動して動き、適用中の条件の行の操作も同じ状態を使う', async ({
    page,
  }) => {
    await loadSample(page);
    const cursorLine = bottom(page).locator('.tl-time-cursor');
    await expect(cursorLine).toHaveCount(0);
    const next = controls(page).getByRole('button', { name: '次のコマ' });
    await next.click();
    await expect(cursorLine).toBeAttached();
    const x1 = Number(await cursorLine.getAttribute('x1'));
    await next.click();
    await next.click();
    await expect.poll(async () => Number(await cursorLine.getAttribute('x1'))).toBeGreaterThan(x1);

    // 適用中の条件の行に、時刻の文と小さな再生の操作がある。年表の再生と同じ状態を指す。
    await expect(conditions(page)).toContainText('再生:');
    await conditions(page).getByRole('button', { name: '再生', exact: true }).click();
    await expect(
      controls(page).getByRole('button', { name: '一時停止', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await conditions(page).getByRole('button', { name: '一時停止', exact: true }).click();
    await expect(controls(page).getByRole('button', { name: '再生', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // 条件の行の解除で、時刻が外れる。
    await conditions(page).getByRole('button', { name: '時刻を解除' }).click();
    await expect(cursorLine).toHaveCount(0);
  });

  test('FR-TM-02: 画面に、再生は表示だけを変え、絞り込みは年表の範囲選択で行うと書いてある', async ({
    page,
  }) => {
    await loadSample(page);
    await expect(controls(page)).toContainText('再生は表示だけを変えます');
    await expect(controls(page)).toContainText('年表で範囲を選びます');
  });

  test('FR-TM-02: キーボードだけで、つまみ（矢印キー）と再生の操作ができる', async ({ page }) => {
    await loadSample(page);
    const slider = controls(page).getByRole('slider', { name: '時刻' });
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(timeState(page)).toContainText('まで（累積）');
    const before = (await timeState(page).textContent()) ?? '';
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await timeState(page).textContent()) ?? '').not.toBe(before);
    const play = controls(page).getByRole('button', { name: '再生', exact: true });
    await play.focus();
    await page.keyboard.press('Enter');
    await expect(play).toHaveCount(0); // 名前が「一時停止」に変わる
    await controls(page).getByRole('button', { name: '一時停止', exact: true }).press('Enter');
    await expect(controls(page).getByRole('button', { name: '再生', exact: true })).toBeVisible();
  });

  test('FR-PJ-01: 時刻、方式、窓の幅、速度は自動保存・ファイルに入り、再生中かどうかは保存しない', async ({
    page,
  }) => {
    await loadSample(page);
    await controls(page).getByLabel('表示方式').selectOption('window');
    await controls(page).getByLabel('窓の幅').selectOption('25');
    await controls(page).getByLabel('速度').selectOption('50');
    await controls(page).getByRole('button', { name: '次のコマ' }).click();
    await controls(page).getByRole('button', { name: '次のコマ' }).click();
    const stateText = (await timeState(page).textContent()) ?? '';
    await waitForAutosave(page);
    await expect
      .poll(async () => (await readAutosave(page)) ?? '')
      .toMatch(/"time":\{"at":\d+,"mode":"window","windowYears":25,"speed":50\}/);
    expect((await readAutosave(page)) ?? '').not.toContain('playing');

    // 再読み込み: 自動保存から復元し、同じ時刻で止まっている（勝手に動き出さない）。
    await page.reload();
    await expect(conditions(page)).toContainText('/ 219');
    await page.getByRole('tab', { name: '年表' }).click();
    await expect(timeState(page)).toHaveText(stateText);
    await expect(controls(page).getByLabel('表示方式')).toHaveValue('window');
    await expect(controls(page).getByLabel('速度')).toHaveValue('50');
    await expect(controls(page).getByRole('button', { name: '再生', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect.poll(() => fadedNodes(page).count()).toBeGreaterThan(0);

    // ファイルに保存し、時刻を解除してから読み込むと戻る。
    const downloading = page.waitForEvent('download');
    await saveProjectFile(page);
    const download = await downloading;
    const text = readFileSync(await download.path(), 'utf8');
    expect(text).toContain('"windowYears":25');
    await controls(page).getByRole('button', { name: '時刻を解除' }).click();
    await expect(timeState(page)).toContainText('時刻は未設定');
    await openProject(page, {
      name: download.suggestedFilename(),
      mimeType: 'application/json',
      buffer: Buffer.from(text),
    });
    await page.getByRole('tab', { name: '年表' }).click();
    await expect(timeState(page)).toHaveText(stateText);
  });
});
