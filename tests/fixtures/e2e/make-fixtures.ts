/**
 * E2E テスト用のプロジェクトファイル（`*.relata.json`）を作る小さなスクリプト。
 *
 * 生成の手順（作業フォルダの根で、Node 24 を使う）:
 *
 *   node tests/fixtures/e2e/make-fixtures.ts
 *   npx prettier --write tests/fixtures/e2e
 *
 * 【なぜ】手で JSON を書かず、アプリ本体の `serializeProject`（src/io/project）で作る。ファイルの形が
 * 変わっても、このスクリプトを実行し直せば見本が追従し、「アプリが自分で書いたファイルを読めるか」を試せる。
 * `serializeProject` は TypeScript で、拡張子なしの import を使うので、Node 単体では読めない。Vite の
 * `ssrLoadModule` で読み込む（アプリの型は import しない。tests/ の tsconfig の対象外のため、型は下で最小限を宣言する）。
 *
 * 元データ: tests/fixtures/io/palladio/maghrib-20231106.json（利用者のマグリブのデータ。公開してよい）の
 * `Persons`（Id、Label、Type、Year、地名）と `Relations`（From、To）から、人物 13 人と、その間の関係を手で選んだ。
 * ラベル、年、地名は元データのまま。ただし、テストで試したい場合のために、次を足した（合成データ。史実ではない）。
 *   - 欠損の理由 4 種。年の欠損: unrecorded = 20、lost = 39、illegible = anon、not-applicable = 35b。
 *     地名の欠損: unrecorded = anon、illegible = 7、lost = 40、not-applicable = 35b（FR-FL-06 の理由別の項目の確認用）。
 *   - 同名異人: `p35` と `p35b`（ラベルが同じで ID が違う）。
 *   - カンマと括弧を含むラベル: `anon`。
 *   - 自己ループ: `e-self`（p6 → p6）。往復エッジ: 元データの 11 と 12（39 ⇄ 35）。孤立ノード: `p20`。
 *   - ハムザ付きのアリフ（أ）を含むラベル: 元データのまま（أبو…、أحمد…）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

/** 出力先（このスクリプトと同じフォルダ）。 */
const OUT = import.meta.dirname;
/** リポジトリの根。 */
const ROOT = join(OUT, '..', '..', '..');

/** serializeProject の最小の型（アプリの型は import しない）。 */
type Serialize = (parts: unknown, savedAt: string) => string;

// ---- 元データ ----
interface PalladioFile {
  readonly label: string;
  readonly data: readonly Record<string, string>[];
}
const source = JSON.parse(
  readFileSync(join(ROOT, 'tests/fixtures/io/palladio/maghrib-20231106.json'), 'utf8'),
) as { readonly files: readonly PalladioFile[] }; // 理由: 自作の見本の読み込みで、形は元ファイルで確かめた
const persons = source.files.find((f) => f.label === 'Persons')?.data ?? [];
const relations = source.files.find((f) => f.label === 'Relations')?.data ?? [];

/** 選んだ人物の Id（元データ）。 */
const PICKED = ['1', '2', '3', '4', '5', '6', '7', '18', '19', '35', '39', '40', '20'];
const byId = new Map(persons.map((p) => [p.Id ?? '', p]));
const byLabel = new Map(persons.map((p) => [p.Label ?? '', p.Id ?? '']));

/** 欠損の理由。 */
type Reason = 'unrecorded' | 'lost' | 'illegible' | 'not-applicable';
const missing = (reason: Reason) => ({ kind: 'missing', reason });
const text = (value: string) => ({ kind: 'value', value });
const num = (value: number) => ({ kind: 'value', value });

// 年の欠損の上書き（理由を 4 種そろえる）。
const YEAR_MISSING: Record<string, Reason> = { '20': 'unrecorded', '39': 'lost' };
// 地名の欠損の上書き。
const PLACE_MISSING: Record<string, Reason> = { '7': 'illegible', '40': 'lost' };

function node(id: string, type: string, label: string, place: unknown, year: unknown) {
  return { id, type, label, attrs: { 地名: place, Year: year } };
}

const nodes = [
  ...PICKED.map((id) => {
    const p = byId.get(id);
    if (p === undefined) throw new Error(`元データに Id ${id} がありません`);
    const reason = YEAR_MISSING[id];
    const year = reason !== undefined ? missing(reason) : num(Number(p.Year));
    const placeReason = PLACE_MISSING[id];
    const place = placeReason !== undefined ? missing(placeReason) : text(p['地名'] ?? '');
    return node(`p${id}`, `type-${p.Type ?? ''}`, p.Label ?? '', place, year);
  }),
  // 同名異人: p35 と同じラベル。別の人物（ID が違う）。年は「該当なし」の欠損。
  node(
    'p35b',
    'type-2',
    byId.get('35')?.Label ?? '',
    missing('not-applicable'),
    missing('not-applicable'),
  ),
  // カンマと括弧を含むラベル。地名は記載なし、年は判読不能。
  node(
    'anon',
    'type-3',
    'Ibn Khajjū, Abū l-Qāsim (pupil; name illegible)',
    missing('unrecorded'),
    missing('illegible'),
  ),
];

// 元データの関係から、選んだ人物の間のものだけを取る。
const picked = new Set(PICKED);
const edges = relations.flatMap((r) => {
  const from = byLabel.get(r.From ?? '');
  const to = byLabel.get(r.To ?? '');
  if (from === undefined || to === undefined || !picked.has(from) || !picked.has(to)) return [];
  return [{ no: r.No ?? '', from: `p${from}`, to: `p${to}` }];
});
const mkEdge = (id: string, source: string, target: string, relation?: string) => ({
  id,
  source,
  target,
  directed: true,
  ...(relation === undefined ? {} : { relation }),
  weight: 1,
  attrs: {},
});

const dataset = {
  graphMode: 'directed',
  nodeTypes: [
    { id: 'type-1', label: 'タイプ 1' },
    { id: 'type-2', label: 'タイプ 2' },
    { id: 'type-3', label: 'タイプ 3' },
  ],
  nodes,
  edges: [
    ...edges.map((e) => mkEdge(`e${e.no}`, e.from, e.to, e.no === '1' ? 'أخذ عن' : undefined)),
    // 自己ループ、同名異人からの関係、カンマを含むラベルの人物からの関係。
    mkEdge('e-self', 'p6', 'p6', 'ذكر نفسه'),
    mkEdge('e-35b', 'p35b', 'p39'),
    mkEdge('e-anon', 'anon', 'p40'),
  ],
  schema: [
    { key: '地名', label: '地名', appliesTo: 'node', valueType: 'category' },
    { key: 'Year', label: '年', appliesTo: 'node', valueType: 'number' },
  ],
  meta: {
    title: 'Maghrib sample',
    source: 'tests/fixtures/io/palladio/maghrib-20231106.json から抜き出した見本（一部は合成）',
  },
};

const importSettings = {
  missingTokens: [{ token: '〔欠〕', reason: 'lost' }],
  encoding: 'utf-8',
  columnCalendars: [{ column: 'Year', calendar: 'hijri' }],
};

// 【なぜ】日時を固定する。再生成しても差分が出ないようにするため。
const SAVED_AT = '2026-01-02T03:04:05.000Z';

// ---- 別のデータ（「別のデータの後に開いても…」の確認用）----
const otherDataset = {
  graphMode: 'undirected',
  nodeTypes: [{ id: 'person', label: '人物' }],
  nodes: [
    { id: 'a', type: 'person', label: 'A', attrs: {} },
    { id: 'b', type: 'person', label: 'B', attrs: {} },
  ],
  edges: [{ id: 'ab', source: 'a', target: 'b', directed: false, weight: 1, attrs: {} }],
  schema: [],
  meta: { title: 'Other data' },
};

const NO_FILTER = { filters: [], edgeRule: 'both-ends', showIsolated: false };
/** 範囲（年 900〜970、欠損は除く）、地名のファセット、片端の規則、孤立ノードを表示。 */
const FILTERED = {
  filters: [
    {
      id: 'f-place',
      kind: 'category',
      target: 'node',
      attr: '地名',
      include: [
        { kind: 'value', value: 'مكناس' },
        { kind: 'value', value: 'مواهب' },
        { kind: 'value', value: 'جبل بني حسان' },
        { kind: 'missing', reason: 'unrecorded' },
      ],
    },
    {
      id: 'f-year',
      kind: 'range',
      target: 'node',
      attr: 'Year',
      min: 900,
      max: 970,
      missing: 'exclude',
    },
  ],
  edgeRule: 'either-end',
  showIsolated: true,
};

const server = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true },
  appType: 'custom',
});
try {
  const mod: unknown = await server.ssrLoadModule('/src/io/project/index.ts');
  const serialize = (mod as { readonly serializeProject: Serialize }).serializeProject; // 理由: 読み込んだモジュールの型は unknown。名前は上で確かめた
  const make = (ds: unknown, filter: unknown, settings: unknown = importSettings): string =>
    serialize({ dataset: ds, importSettings: settings, view: { filter } }, SAVED_AT);
  const write = (name: string, body: string): void => {
    writeFileSync(join(OUT, name), body);
  };

  const clean = make(dataset, NO_FILTER);
  write('maghrib.relata.json', clean);
  write('maghrib-filtered.relata.json', make(dataset, FILTERED));
  write(
    'other.relata.json',
    make(otherDataset, NO_FILTER, { missingTokens: [], columnCalendars: [] }),
  );

  // ---- 警告が出るファイル（読み込みは成功する）----
  // 未知の最上位の項目、view の未知の項目、存在しない属性を指すフィルタ、データに無い値を選んだフィルタ。
  const warn = JSON.parse(clean) as Record<string, unknown>; // 理由: 自分で作った JSON
  warn.futureFeature = { note: '新しい版が足した項目' };
  warn.view = {
    filter: {
      filters: [
        { id: 'f-ghost', kind: 'range', target: 'node', attr: 'Ghost', min: 1, missing: 'exclude' },
        {
          id: 'f-nowhere',
          kind: 'category',
          target: 'node',
          attr: '地名',
          include: [{ kind: 'value', value: 'No such place' }],
        },
      ],
      edgeRule: 'both-ends',
      showIsolated: false,
    },
    layoutHint: 'future',
  };
  write('warnings.relata.json', JSON.stringify(warn));

  // ---- 失敗するファイル ----
  write('not-json.txt', '{"app": "Relata", "formatVersion": 1, "dataset": ');
  write(
    'wrong-app.relata.json',
    JSON.stringify({ ...(JSON.parse(clean) as object), app: 'Palladio' }),
  );
  write(
    'newer-version.relata.json',
    JSON.stringify({ ...(JSON.parse(clean) as object), formatVersion: 999 }),
  );
  const brokenDataset = JSON.parse(clean) as { dataset: { nodes: unknown[] } };
  brokenDataset.dataset.nodes = 'not an array' as unknown as unknown[]; // 理由: 壊れたファイルを作るため、わざと型を破る
  write('broken-dataset.relata.json', JSON.stringify(brokenDataset));
} finally {
  await server.close();
}
