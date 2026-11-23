/**
 * 射影（T2-02）の E2E: 「ネットワークの構築」のパネル、射影後のグラフと指標、根拠の一覧。
 *
 * 見本は、このファイルの中で作る小さな二部グラフ（人物 5、組織 3、場所 1。エッジ 9）。
 * 人物 → 組織: o1 に p1,p2,p3、o2 に p2,p3,p4、o3 に p4,p5。場所 l1 は p1 だけがつながる（第 3 の型）。
 * 人物 ← 組織で射影すると、ノード 5、エッジ 6。p2—p3 だけが 2 つの組織（o1、o2）を共有する。
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  buildPanel,
  buildToggle,
  counts,
  facetValue,
  openAttr,
  openBuildPanel,
  openProject,
  saveProjectFile,
  selectNode,
  startApp,
} from './support';

interface Options {
  readonly types?: readonly string[];
  readonly projection?: { target: string; via: string; method: string };
  /** 組織 o1 だけにつながる人物を、この数だけ足す（大きすぎる射影の確認用）。 */
  readonly extraPersons?: number;
}

/** 小さな二部グラフのプロジェクトファイル。 */
function projectFile(options: Options = {}) {
  const types = options.types ?? ['person', 'org', 'place'];
  const labels: Record<string, string> = { person: '人物', org: '組織', place: '場所' };
  const node = (id: string, type: string, label: string, tag: string) => ({
    id,
    type,
    label,
    attrs: { Tag: { kind: 'value', value: tag } },
  });
  const edge = (id: string, source: string, target: string) => ({
    id,
    source,
    target,
    directed: false,
    weight: 1,
    attrs: {},
  });
  const nodes = [
    node('p1', 'person', 'ابن عسكر', 'P'),
    node('p2', 'person', 'Bob', 'P'),
    node('p3', 'person', 'Carol', 'P'),
    node('p4', 'person', 'Dan', 'P'),
    node('p5', 'person', 'Eve', 'P'),
    node('o1', 'org', 'Org One', 'A'),
    node('o2', 'org', 'Org Two', 'B'),
    node('o3', 'org', 'Org Three', 'B'),
    node('l1', 'place', 'Fes', 'P'),
  ].filter((n) => types.includes(n.type));
  const extra = Array.from({ length: options.extraPersons ?? 0 }, (_, i) => `q${String(i)}`);
  nodes.push(...extra.map((id) => node(id, 'person', id, 'P')));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = [
    edge('e1', 'p1', 'o1'),
    edge('e2', 'p2', 'o1'),
    edge('e3', 'p3', 'o1'),
    edge('e4', 'p2', 'o2'),
    edge('e5', 'p3', 'o2'),
    edge('e6', 'p4', 'o2'),
    edge('e7', 'p4', 'o3'),
    edge('e8', 'p5', 'o3'),
    edge('e9', 'p1', 'l1'),
    ...extra.map((id) => edge(`x-${id}`, id, 'o1')),
  ].filter((e) => ids.has(e.source) && ids.has(e.target));
  return {
    name: 'bipartite.relata.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({
        app: 'Relata',
        formatVersion: 1,
        dataset: {
          graphMode: 'undirected',
          nodeTypes: types.map((id) => ({ id, label: labels[id] ?? id })),
          nodes,
          edges,
          schema: [{ key: 'Tag', label: 'Tag', appliesTo: 'node', valueType: 'category' }],
          meta: { title: 'Bipartite test' },
        },
        view: {
          filter: { filters: [], edgeRule: 'both-ends', showIsolated: false },
          ...(options.projection === undefined
            ? {}
            : {
                graph: {
                  graphOptions: {
                    weight: 'weight',
                    selfLoops: true,
                    projection: options.projection,
                  },
                },
              }),
        },
      }),
    ),
  };
}

/** 構築のパネルで射影をかける（人物 ← 組織、既定の方式）。 */
async function project(page: Page) {
  const panel = await openBuildPanel(page);
  await panel.getByRole('checkbox', { name: '射影する' }).check();
  await panel.getByLabel('射影先の型（残すノード）').selectOption('person');
  await panel.getByLabel('仲介する型（根拠になるノード）').selectOption('org');
  return panel;
}

function conditions(page: Page) {
  return page.getByRole('region', { name: /適用中の条件/ });
}

/** ノード指標の表の、指定したノードの行。 */
function metricRow(page: Page, label: string) {
  return page
    .getByRole('table', { name: 'ノードごとの指標' })
    .locator('tbody tr')
    .filter({ has: page.getByRole('rowheader', { name: label, exact: true }) });
}

test.describe('日本語の画面', () => {
  test.use({ locale: 'ja-JP' });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await startApp(page);
    await openProject(page, projectFile());
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('9');
  });

  test('FR-GR-03: パネルは既定で閉じ、射影すると件数と指標が射影後のグラフに変わる', async ({
    page,
  }) => {
    await expect(buildPanel(page)).toHaveCount(0);
    await expect(buildToggle(page)).toHaveText('ネットワークの構築');
    await project(page);
    await expect(conditions(page)).toContainText('射影後: ノード 5 · エッジ 6');
    await expect(buildToggle(page)).toHaveText('構築: 射影 人物 ← 組織');
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('5');
    await expect(page.getByTestId('metric-global-edgeCount')).toHaveText('6');
    await expect(page.getByText('射影後のグラフで計算', { exact: true })).toBeVisible();
    // 図のノードも射影先の 5 つだけ。
    await expect(page.locator('.graph-canvas #graph-view-nodes > [data-id]')).toHaveCount(5);
    // 元の件数（フィルタの結果）は射影の影響を受けない。
    await expect(conditions(page)).toContainText('ノード 9 / 9');
  });

  test('FR-GR-03: 方式を変えると重みが変わる（共通の相手の数 → Newman → Jaccard）', async ({
    page,
  }) => {
    const panel = await project(page);
    // p2 の重み付き次数: 共通の相手の数なら 1 + 2 + 1 = 4。
    await expect(metricRow(page, 'Bob')).toContainText('4');
    const method = panel.getByLabel('重み付けの方式');
    await method.selectOption('newman');
    // Newman: 0.5 + 1 + 0.5 = 2。
    await expect(metricRow(page, 'Bob')).not.toContainText(/(^|\s)4(\s|$)/);
    await expect(panel.getByText(/Newman 2001/)).toBeVisible();
    await method.selectOption('jaccard');
    await expect(panel.getByText(/0 から 1/)).toBeVisible();
  });

  test('FR-GR-04: 射影後のノードを選ぶと隣接ノードごとの根拠の件数が出て、エッジを選ぶと仲介ノードが出る', async ({
    page,
  }) => {
    await project(page);
    await page.keyboard.press('Escape');
    await selectNode(page, 'p2');
    const card = page.getByRole('region', { name: '選択したノードの詳細' });
    const neighbors = card.getByTestId('evidence-neighbor');
    await expect(neighbors).toHaveCount(3);
    // 根拠の多い順: Carol（o1 と o2 の 2 件）が先頭。
    await expect(neighbors.first()).toContainText('Carol');
    await expect(neighbors.first()).toContainText('根拠 2 件');
    await card.getByRole('button', { name: 'このエッジを選ぶ: Carol' }).click();
    const edge = card.getByTestId('evidence-edge');
    await expect(edge).toHaveCount(1);
    await expect(edge).toContainText('Bob — Carol');
    await expect(edge).toContainText('根拠の仲介ノード 2 件');
    await expect(edge.locator('bdi', { hasText: 'Org One' })).toBeVisible();
    await expect(edge.locator('bdi', { hasText: 'Org Two' })).toBeVisible();
  });

  test('FR-MT-05: 射影すると、複数のノード型の注意が消える', async ({ page }) => {
    await expect(
      page.getByRole('button', { name: '説明: 指標の意味と計算上の注意（注意 1 件）' }),
    ).toBeVisible();
    await project(page);
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('5');
    await expect(
      page.getByRole('button', { name: '説明: 指標の意味と計算上の注意', exact: true }),
    ).toBeVisible();
  });

  test('FR-GR-03: フィルタで仲介の組織を除くと、根拠から外れる（フィルタは射影の前にかかる）', async ({
    page,
  }) => {
    await project(page);
    await page.keyboard.press('Escape');
    const box = await openAttr(page, 'Tag');
    // Tag が B の組織（o2、o3）を外す: P と A だけを残す。p4、p5 は残った組織につながらず孤立するので、
    // 既定の「孤立ノードを表示しない」で射影先から外れる。
    await facetValue(box, 'P').check();
    await facetValue(box, 'A').check();
    await expect(conditions(page)).toContainText('射影後: ノード 3 · エッジ 3');
    await selectNode(page, 'p2');
    const card = page.getByRole('region', { name: '選択したノードの詳細' });
    await card.getByRole('button', { name: 'このエッジを選ぶ: Carol' }).click();
    const edge = card.getByTestId('evidence-edge');
    await expect(edge).toContainText('根拠の仲介ノード 1 件');
    await expect(edge.locator('bdi', { hasText: 'Org Two' })).toHaveCount(0);
  });

  test('FR-GR-03: 元に戻す・やり直すで射影を戻せる', async ({ page }) => {
    const panel = await project(page);
    await expect(conditions(page)).toContainText('射影後: ノード 5');
    await panel.getByLabel('重み付けの方式').selectOption('newman');
    const undo = panel.getByRole('button', { name: '構築の設定を元に戻す' });
    await undo.click();
    await expect(panel.getByLabel('重み付けの方式')).toHaveValue('shared');
    await undo.click();
    await expect(undo).toBeDisabled();
    await expect(buildToggle(page)).toHaveText('ネットワークの構築');
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('9');
    await expect(panel.getByRole('checkbox', { name: '射影する' })).not.toBeChecked();
    await panel.getByRole('button', { name: '構築の設定をやり直す' }).click();
    await expect(panel.getByRole('checkbox', { name: '射影する' })).toBeChecked();
  });

  test('FR-GR-03: 保存して開き直すと射影が戻る', async ({ page }) => {
    await project(page);
    await page.keyboard.press('Escape');
    const pending = page.waitForEvent('download');
    await saveProjectFile(page);
    const saved = readFileSync(await (await pending).path(), 'utf8');
    expect(saved).toContain('"projection":{"target":"person","via":"org","method":"shared"}');
    await openProject(page, {
      name: 'again.relata.json',
      mimeType: 'application/json',
      buffer: Buffer.from(saved),
    });
    await expect(conditions(page)).toContainText('射影後: ノード 5 · エッジ 6');
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('5');
    await expect(buildToggle(page)).toHaveText('構築: 射影 人物 ← 組織');
  });

  test('FR-GR-03: キーボードで操作でき、Esc で閉じて項目へフォーカスが戻る。開閉で選択と viewport は変わらない', async ({
    page,
  }) => {
    await selectNode(page, 'p2');
    const svg = page.locator('.graph-canvas svg');
    const zoom = await svg.getAttribute('data-zoom');
    const filters = await conditions(page).textContent();
    await buildToggle(page).focus();
    await page.keyboard.press('Enter');
    await expect(buildPanel(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(buildPanel(page)).toHaveCount(0);
    await expect(buildToggle(page)).toBeFocused();
    await expect(buildToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByRole('region', { name: '選択したノードの詳細' })).toContainText('p2');
    await expect(svg).toHaveAttribute('data-zoom', zoom ?? '');
    expect(await conditions(page).textContent()).toBe(filters);
  });
});

test.describe('日本語の画面（特別なデータ）', () => {
  test.use({ locale: 'ja-JP' });

  test('FR-GR-03: ノードの型が 1 つのデータでは、射影の欄を無効にして理由を示す', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, projectFile({ types: ['person'] }));
    const panel = await openBuildPanel(page);
    await expect(panel.getByRole('checkbox', { name: '射影する' })).toBeDisabled();
    await expect(
      panel.getByText(/ノードの型が 2 つ以上あるデータで使えます。このデータの型は 1 つ/),
    ).toBeVisible();
  });

  test('FR-GR-03: 設定が今のデータで無効（型が無い）なら、射影せず理由を画面に出す', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(
      page,
      projectFile({ projection: { target: 'person', via: 'ghost', method: 'shared' } }),
    );
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('9');
    await expect(buildToggle(page)).toHaveText('構築: 射影（適用できません）');
    await expect(
      page.getByText('仲介する型「ghost」がこのデータにありません。射影は適用していません。'),
    ).toBeVisible();
    await expect(counts(page)).toBeVisible();
  });

  test('FR-GR-05: 3 つ目の型（場所）は射影先でも仲介でもなければ無視される。場所を仲介にもできる', async ({
    page,
  }) => {
    await startApp(page);
    await openProject(page, projectFile());
    const panel = await project(page);
    await expect(page.getByTestId('metric-global-nodeCount')).toHaveText('5');
    // 仲介を「場所」に替える: 場所につながる人物は p1 だけなので、エッジは 0。
    await panel.getByLabel('仲介する型（根拠になるノード）').selectOption('place');
    await expect(page.getByTestId('metric-global-edgeCount')).toHaveText('0');
    // 射影先と仲介を同じ型にすると、もう一方が入れ替わる（無効な組にならない）。
    await panel.getByLabel('射影先の型（残すノード）').selectOption('place');
    await expect(panel.getByLabel('仲介する型（根拠になるノード）')).toHaveValue('person');
  });
});

test.describe('日本語の画面（構築の追加の確認）', () => {
  test.use({ locale: 'ja-JP' });
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await startApp(page);
  });

  test('FR-GR-03: パネルの中の Ctrl+Z は構築の設定を戻し、フィルタの Undo は走らない', async ({
    page,
  }) => {
    await openProject(page, projectFile());
    // 先にフィルタを 1 つ足す（これが戻ってしまえば失敗とわかる）。
    const box = await openAttr(page, 'Tag');
    await facetValue(box, 'P').check();
    await facetValue(box, 'A').check();
    await expect(conditions(page)).toContainText('フィルタ 1');
    const panel = await project(page);
    const method = panel.getByLabel('重み付けの方式');
    await method.selectOption('newman');
    await method.focus();
    await page.keyboard.press('Control+z');
    await expect(method).toHaveValue('shared');
    await expect(conditions(page)).toContainText('フィルタ 1');
    await page.keyboard.press('Control+Shift+z');
    await expect(method).toHaveValue('newman');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await expect(panel.getByRole('checkbox', { name: '射影する' })).not.toBeChecked();
    await expect(conditions(page)).toContainText('フィルタ 1');
  });

  test('FR-GR-03: 型が 1 つのデータで射影の設定を持つファイルでも、射影を外せる', async ({
    page,
  }) => {
    await openProject(
      page,
      projectFile({
        types: ['person'],
        projection: { target: 'person', via: 'org', method: 'shared' },
      }),
    );
    const panel = await openBuildPanel(page);
    const checkbox = panel.getByRole('checkbox', { name: '射影する' });
    await expect(checkbox).toBeEnabled();
    // 射影は効いていない（無効）ので、重みの欄は触れる。
    await expect(panel.getByLabel('重みの集計')).toBeEnabled();
    await checkbox.uncheck();
    await expect(checkbox).toBeDisabled();
    await expect(buildToggle(page)).toHaveText('ネットワークの構築');
  });

  test('FR-GR-04: 選んだエッジが今のグラフに無くなったら、表示されていないと示して解除できる', async ({
    page,
  }) => {
    await openProject(page, projectFile());
    const panel = await project(page);
    await page.keyboard.press('Escape');
    await selectNode(page, 'p2');
    const card = page.getByRole('region', { name: '選択したノードの詳細' });
    await card.getByRole('button', { name: 'このエッジを選ぶ: Carol' }).click();
    await expect(card.getByTestId('evidence-edge')).toHaveCount(1);
    await buildToggle(page).click();
    await panel.getByLabel('仲介する型（根拠になるノード）').selectOption('place');
    await expect(card).toContainText('選んだエッジは、今のグラフに表示されていません。');
    // パネルは図の上に重なるので、閉じてからカードを操作する。
    await page.keyboard.press('Escape');
    await card.getByRole('button', { name: 'エッジの選択を解除' }).click();
    await expect(card).not.toContainText('選んだエッジは、今のグラフに表示されていません。');
  });

  test('NFR-03: 組の数が上限を超える射影は適用せず、大きな仲介ノードを示す', async ({ page }) => {
    await openProject(page, projectFile({ extraPersons: 201 }));
    const panel = await project(page);
    await expect(
      panel.getByText(/上限（20000 組）を超えるため、射影は適用していません/),
    ).toBeVisible();
    await expect(panel.getByText(/大きな仲介ノード:/)).toContainText('Org One');
    await expect(panel.getByText(/絞り込みで除くと/)).toBeVisible();
    await expect(buildToggle(page)).toHaveText('構築: 射影（適用できません）');
    // パネルが開いている間は、図の上に同じ文を重ねて出さない。
    await expect(page.getByText(/射影は適用していません/)).toHaveCount(1);
  });

  test('FR-FL-05: 孤立ノードを表示しないとき、射影で孤立した射影先ノードも除く', async ({
    page,
  }) => {
    await openProject(page, projectFile());
    await project(page);
    await page.keyboard.press('Escape');
    const box = await openAttr(page, 'Tag');
    // 組織 o1（A）と人物だけを残す。p4、p5 は残った組織につながらない。
    await facetValue(box, 'P').check();
    await facetValue(box, 'A').check();
    await expect(conditions(page)).toContainText('射影後: ノード 3 · エッジ 3');
    await page.getByRole('checkbox', { name: '孤立ノードを表示する' }).check();
    await expect(conditions(page)).toContainText('射影後: ノード 5 · エッジ 3');
  });
});

test.describe('English UI', () => {
  test.use({ locale: 'en-US' });

  test('FR-GR-03: the panel and the conditions row do not overflow in English', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await startApp(page);
    await openProject(
      page,
      projectFile(),
      page.getByRole('status').filter({ hasText: /Loaded project|Restored/ }),
    );
    const toggle = page
      .getByRole('region', { name: /Applied conditions/ })
      .getByRole('button', { name: /^(Network construction|Construction:)/ });
    await toggle.click();
    const panel = page.getByRole('dialog', { name: 'Network construction', exact: true });
    await panel.getByRole('checkbox', { name: 'Project', exact: true }).check();
    await expect(panel.getByLabel('Target type (nodes to keep)')).toBeVisible();
    await panel.getByLabel('Weighting method').selectOption('newman');
    await expect(toggle).toContainText('Construction: Projection');
    const overflow = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const bar = page.getByRole('region', { name: /Applied conditions/ });
    expect(await bar.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByText('Computed on the projected graph', { exact: true })).toBeVisible();
    // 日本語の文字が残っていない。
    await expect(panel).not.toContainText(/[ぁ-んァ-ン]/);
  });
});
