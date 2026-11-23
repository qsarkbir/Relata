/**
 * E2E テストの共通の部品（プロジェクトファイルの選択、自動保存（IndexedDB）の読み書き、よく使う要素）。
 *
 * 【なぜ】待ちは `waitForTimeout` で書かず、画面や保存先の「状態」を待つ（`expect` と `expect.poll`）。
 * 状態を待てば、遅い環境でも速い環境でも同じ結果になる。
 */
// 【なぜ】tests/ の tsconfig には DOM の型が無い。`page.evaluate` に渡す関数はブラウザの中で動き、
//   `indexedDB` や `document` を使うので、このファイルだけ DOM の型を足す（設定ファイルは変えない）。
/// <reference lib="dom" />
import { expect, type Locator, type Page } from '@playwright/test';
import { join } from 'node:path';

/** 見本のプロジェクトファイルの置き場（tests/fixtures/e2e/。make-fixtures.ts で作る）。 */
export function fixturePath(name: string): string {
  return join(import.meta.dirname, '..', 'fixtures', 'e2e', name);
}

/** 見本の件数（maghrib.relata.json）。ノード 15、エッジ 17。 */
export const TOTAL = { nodes: 15, edges: 17 } as const;

/**
 * アプリを開き、最初の描画が終わる（見出しとヘッダのボタンが出る）まで待つ。
 *
 * 【なぜ】`goto` の完了（load イベント）は、React の最初の描画の完了を保証しない。描画の前にキー操作や
 * クリックをすると、操作が空振りする。「見えるまで待つ」を共通にして、取りこぼしを防ぐ。
 */
export async function startApp(page: Page): Promise<void> {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Relata', level: 1 })).toBeVisible();
  await expect(page.getByTestId('project-file-input')).toBeAttached();
}

/** 読み込みの結果の知らせ（読み込めた、復元した）。文言ではなく役割と要点（題名を含む語）で選ぶ。 */
export function loadedNotice(page: Page): Locator {
  return page
    .getByRole('status')
    .filter({ hasText: /読み込みました|復元しました|Loaded project|Restored/ });
}

/** 失敗の知らせ（role=alert。入れ物は常にあり、中身だけ変わる。D-33）。文字で絞って使う。 */
export function alerts(page: Page, text?: string | RegExp): Locator {
  const all = page.getByRole('alert');
  return text === undefined ? all : all.filter({ hasText: text });
}

/** 「保存」ボタン（データがあるときだけ押せる）。 */
export function saveButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(保存|Save)$/ });
}

/** 上部の「書き出し」ボタン（T2-08）。データが無いときは押せない。 */
export function exportButton(page: Page): Locator {
  return page.getByRole('button', { name: /^(書き出し|Export)$/ });
}

/** 「保存」を押して開くダイアログ。 */
export function saveDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /^(保存|Save)$/ });
}

/**
 * 「保存」のダイアログを開き、プロジェクトの保存を選ぶ（FR-PJ-01）。ダウンロードの待ちは呼ぶ側で登録する。
 *
 * @param page - ページ
 */
export async function saveProjectFile(page: Page): Promise<void> {
  await saveButton(page).click();
  await saveDialog(page)
    .getByRole('button', { name: /^(プロジェクトを保存|Save project)/ })
    .click();
  await expect(saveDialog(page)).toBeHidden();
}

/**
 * 「書き出し」のダイアログを開き、図の書き出しの形式のボタンを押す（FR-OUT-01、03、04）。
 * ダウンロードの待ちは呼ぶ側で登録する。押したあと、ダイアログは開いたまま（続けて別の形式を出せる）。
 *
 * @param page - ページ
 * @param format - 形式のボタンの名前
 * @returns 書き出しのダイアログ
 */
export async function exportFigureAs(
  page: Page,
  format: 'SVG' | 'PNG' | 'PDF' | 'GraphML' | 'GEXF',
): Promise<Locator> {
  const dialog = await openExportDialog(page);
  await dialog.getByRole('button', { name: format, exact: true }).click();
  return dialog;
}

/**
 * 「書き出し」のダイアログを開き、SVG の書き出しを選んで閉じる（FR-OUT-01）。
 * ダウンロードの待ちは呼ぶ側で登録する。
 *
 * @param page - ページ
 */
export async function saveSvgFile(page: Page): Promise<void> {
  const dialog = await exportFigureAs(page, 'SVG');
  // 【なぜ】ダウンロードの開始は押した直後に起きる。閉じる操作は Esc でよい。
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

/** 置き換えの確認のダイアログ（D-33）。 */
export function confirmDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /今のデータを置き換えますか|Replace the current data/ });
}

/**
 * プロジェクトファイルを選び、読み込みの結果の知らせが出るまで待つ。
 *
 * 【なぜ】データがあるときは、置き換える前の確認のダイアログが出る設計（D-33）。「保存」が押せる（= データがある）
 * なら、ダイアログを待って「開く」を押す。前の読み込みの知らせが残っていても、ダイアログは必ず先に出るので、
 * 古い知らせを新しい結果と取り違えない。
 *
 * @param page - ページ
 * @param file - 見本のファイル名、または名前と中身の組
 * @param expectNotice - 待つ知らせ。省略すると「読み込めた」知らせ
 */
export async function openProject(
  page: Page,
  file: string | { name: string; mimeType: string; buffer: Buffer },
  expectNotice: Locator = loadedNotice(page),
): Promise<void> {
  // 【なぜ】「保存」はデータが無くても押せる（自動保存を消すため）。データの有無は「書き出し」で判断する。
  const hasData = await exportButton(page).isEnabled();
  await page
    .getByTestId('project-file-input')
    .setInputFiles(typeof file === 'string' ? fixturePath(file) : file);
  if (hasData) {
    const dialog = confirmDialog(page);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^(開く|Open)$/ }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(expectNotice).toBeVisible();
}

/** 表示中の数の領域（ノード n / m、エッジ n / m）。 */
export function counts(page: Page): Locator {
  return page.getByRole('status', { name: /表示中の数|Items shown/ });
}

/** 件数を確かめる（「ノード 2 / 15」「エッジ 1 / 17」の形。言語は ja）。 */
export async function expectCounts(
  page: Page,
  nodes: [shown: number, total: number],
  edges: [shown: number, total: number],
): Promise<void> {
  await expect(counts(page)).toHaveText(
    `ノード ${String(nodes[0])} / ${String(nodes[1])}エッジ ${String(edges[0])} / ${String(edges[1])}`,
  );
}

/** 適用中のフィルタの一覧の領域。 */
export function appliedRegion(page: Page): Locator {
  return page.getByRole('region', { name: '適用中のフィルタ' });
}

/**
 * 属性 1 つの `<details>`（ファセットや範囲の部品）。
 *
 * 【なぜ】`<details>` は名前の無い group になり、役割と名前では選べない。見出しにあたる `<summary>` の
 * 文字で選ぶ。
 */
export function attrBox(page: Page, label: string): Locator {
  return page.locator('details').filter({ has: page.locator('summary', { hasText: label }) });
}

/** 属性の部品を開く（既に開いていれば何もしない）。 */
export async function openAttr(page: Page, label: string): Promise<Locator> {
  const box = attrBox(page, label);
  if ((await box.getAttribute('open')) === null) await box.locator('summary').click();
  await expect(box).toHaveAttribute('open', '');
  return box;
}

/** ファセットの 1 項目（チェックボックス）。名前は「値 他の条件に合う件数…」なので、値の前方一致で選ぶ。 */
export function facetValue(box: Locator, value: string | RegExp): Locator {
  const name =
    typeof value === 'string' ? new RegExp(`^${value.replace(/[()（）]/g, '\\$&')}`) : value;
  return box.getByRole('checkbox', { name });
}

const IDB_READ = (): Promise<string | null> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB が使えません'));
      return;
    }
    const open = indexedDB.open('relata', 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore('autosave');
    };
    open.onerror = () => {
      reject(new Error('IndexedDB を読めません'));
    };
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('autosave').objectStore('autosave').get('current');
      req.onsuccess = () => {
        db.close();
        resolve(typeof req.result === 'string' ? req.result : null);
      };
      req.onerror = () => {
        db.close();
        reject(new Error('IndexedDB を読めません'));
      };
    };
  });

/** 自動保存（IndexedDB の relata/autosave/current）の文字列。無ければ null。 */
export function readAutosave(page: Page): Promise<string | null> {
  return page.evaluate(IDB_READ);
}

/** 自動保存に、利用者の操作を通さず値を直接書く（壊れた保存の再現用）。 */
export async function seedAutosave(page: Page, value: unknown): Promise<void> {
  await page.evaluate(
    (v) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('relata', 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('autosave');
        };
        open.onerror = () => {
          reject(new Error('open failed'));
        };
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('autosave', 'readwrite');
          tx.objectStore('autosave').put(v, 'current');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            reject(new Error('put failed'));
          };
        };
      }),
    value,
  );
}

/**
 * 自動保存の中身が条件を満たすまで待つ（自動保存は変更の 1 秒後。完了を待つ手段が画面に無いので、保存先を調べる）。
 *
 * @returns 保存された JSON（解析済み）
 */
export async function waitForAutosave(
  page: Page,
  accept: (saved: SavedProject) => boolean = () => true,
): Promise<SavedProject> {
  let last: SavedProject | undefined;
  await expect
    .poll(async () => {
      const text = await readAutosave(page);
      if (text === null) return false;
      last = JSON.parse(text) as SavedProject; // 理由: アプリが書いた JSON。形は下の型で必要な項目だけ宣言する
      return accept(last);
    })
    .toBe(true);
  if (last === undefined) throw new Error('unreachable');
  return last;
}

/** 保存されたプロジェクトの、テストが読む項目だけの型。 */
export interface SavedProject {
  readonly app: string;
  readonly formatVersion: number;
  readonly dataset: {
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
    readonly meta: { readonly title: string };
  };
  readonly importSettings: unknown;
  readonly view: {
    readonly filter: {
      readonly filters: readonly { readonly kind: string; readonly attr?: string }[];
      readonly edgeRule: string;
      readonly showIsolated: boolean;
    };
  };
}

/**
 * 時計を止めた状態でアプリを開く（自動保存の 1 秒を、実時間を待たずに進めるため）。
 *
 * 【なぜ】`page.clock` で `setTimeout` を偽物にし、`runFor` で進めた分だけ時間が流れる。「900 ミリ秒では
 * 保存されず、1100 ミリ秒では保存される」を、実行の速さに左右されず確かめられる。
 * 時計は、最初の描画が済んでから止める（止めたままだと、アプリの起動が進まない）。
 */
export async function startAppWithPausedClock(page: Page): Promise<void> {
  const start = new Date('2026-06-01T00:00:00Z');
  await page.clock.install({ time: start });
  await startApp(page);
  await page.clock.pauseAt(new Date('2026-06-01T00:01:00Z'));
}

/**
 * 時計を止めたまま、ファイルの読み込みが終わって「読み込みました」が出るまで、時計を少しずつ進める。
 *
 * 【なぜ】ファイルの中身を読む処理（`Blob.text()`）は、偽の時計と関係なく実時間で終わる。
 *       読み込みの内部の待ち（`setTimeout`）は偽の時計で動くので、中身を読み終える前に
 *       `runFor(100)` を済ませてしまうと、その待ちが進まず、知らせが出ない（負荷が高いときに起きる）。
 *       そこで、知らせが出るまで 50 ミリ秒ずつ進める。進めすぎは 50 ミリ秒以内に収まる。
 *
 * @param page - Playwright のページ
 */
export async function advanceClockUntilLoaded(page: Page): Promise<void> {
  await expect(async () => {
    await page.clock.runFor(50);
    await expect(loadedNotice(page)).toBeVisible({ timeout: 100 });
  }).toPass({ timeout: 10_000 });
}

/**
 * 上部の「書き出し」からダイアログを開き、その dialog を返す（FR-OUT-02）。
 *
 * @param page - ページ
 * @returns CSV 出力のダイアログ
 */
export async function openExportDialog(page: Page): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: '書き出し', exact: true });
  // 【なぜ】既に開いていれば、そのまま使う（続けて別の形式を書き出せる）。
  if (!(await dialog.isVisible()))
    await page.getByRole('button', { name: '書き出し', exact: true }).click();
  await expect(dialog).toBeVisible();
  return dialog;
}

/** 「書き出し」のダイアログを開く（CSV の操作もここにある。FR-OUT-02）。 */
export const openCsvDialog = openExportDialog;

/** グラフの「表示の設定」の引き出しを開く（既に開いていれば何もしない）。既定では閉じている。 */
export async function openGraphSettings(page: Page): Promise<Locator> {
  const toggle = page.getByRole('button', { name: /^(表示の設定|Display settings)$/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  const drawer = page.getByRole('complementary', { name: /表示の設定|Display settings/ });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** 引き出しの節（見出しは `<summary>`）を開く。引き出しも開く。 */
export async function openGraphSection(page: Page, title: string | RegExp): Promise<void> {
  const drawer = await openGraphSettings(page);
  const section = drawer.locator('details.rl-section').filter({
    has: page.locator('summary', { hasText: title }),
  });
  if ((await section.getAttribute('open')) === null) await section.locator('summary').click();
  await expect(section).toHaveAttribute('open', '');
}

/**
 * ノードを ID で選ぶ。検索の欄に ID を入れ、結果の一覧から ID が完全に一致する行を押す。
 *
 * 【なぜ】以前の「ノードを選択」の選択肢は、検索と結果の一覧に統合した（T2-11）。
 */
export async function selectNode(page: Page, id: string): Promise<void> {
  await page.getByLabel(/^(ノードを検索|Find a node)$/).fill(id);
  await page
    .locator('.graph-search-results [role="option"]')
    .filter({ has: page.locator('bdi', { hasText: new RegExp(`^${id}$`) }) })
    .click();
}

/** 適用中の条件の行の「ネットワークの構築」の項目（既定のときは名前だけ、適用中の値があれば「構築: …」）。 */
export function buildToggle(page: Page): Locator {
  return page.getByRole('region', { name: /適用中の条件|Applied conditions/ }).getByRole('button', {
    name: /^(ネットワークの構築|構築:|Network construction|Construction:)/,
  });
}

/** 「ネットワークの構築」のパネル（小さなダイアログ。非モーダル）。 */
export function buildPanel(page: Page): Locator {
  return page.getByRole('dialog', { name: /^(ネットワークの構築|Network construction)$/ });
}

/** 「ネットワークの構築」のパネルを開く（既に開いていれば何もしない）。 */
export async function openBuildPanel(page: Page): Promise<Locator> {
  const toggle = buildToggle(page);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(buildPanel(page)).toBeVisible();
  return buildPanel(page);
}
