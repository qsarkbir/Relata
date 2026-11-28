/**
 * 版 3（D-59）: `geo` のフィルタ、`view.geoSource`、`view.map`、`view.workspace.mainView`、
 * 移行の連鎖、タイルの URL の鍵の除去（D-52）。
 */
import { describe, expect, it } from 'vitest';
import { toFilterId, type FilterState } from '../../core/filter';
import { isPlainObject } from '../../core/model';
import {
  DEFAULT_GRAPH_VIEW,
  DEFAULT_MAP_VIEW,
  DEFAULT_WORKSPACE,
  type MapViewSettings,
} from '../../core/project';
import { geoDataset } from '../../core/geo/fixtures/geoDataset';
import sampleV1 from '../../../tests/fixtures/io/project/v1/maghrib-v0.1.relata.json?raw';
import sampleV2 from '../../../public/samples/maghrib.relata.json?raw';
import e2eMaghrib from '../../../tests/fixtures/e2e/maghrib.relata.json?raw';
import e2eFiltered from '../../../tests/fixtures/e2e/maghrib-filtered.relata.json?raw';
import e2eWarnings from '../../../tests/fixtures/e2e/warnings.relata.json?raw';
import {
  migrateV2ToV3,
  parseProject,
  serializeProject,
  serializeProjectWithReport,
  type ParseProjectResult,
} from './project';
import { CURRENT_FORMAT_VERSION, DEFAULT_IMPORT_SETTINGS, type ProjectParts } from './types';

const AT = '2026-11-27T00:00:00Z';
const geoFilter: FilterState = {
  filters: [
    {
      id: toFilterId('g1'),
      kind: 'geo',
      source: { kind: 'attrs', lat: 'lat', lon: 'lon' },
      bbox: { west: 170, south: -20, east: -170, north: -10 },
      missing: 'exclude',
    },
  ],
  edgeRule: 'both-ends',
  showIsolated: false,
};
const parts: ProjectParts = {
  dataset: geoDataset(),
  importSettings: DEFAULT_IMPORT_SETTINGS,
  view: { filter: geoFilter },
};
const withMap = (map: MapViewSettings): ProjectParts => ({
  ...parts,
  view: { ...parts.view, map },
});

function obj(text: string): Record<string, unknown> {
  const x: unknown = JSON.parse(text);
  if (!isPlainObject(x)) throw new Error('オブジェクトではない');
  return x;
}
function ok(r: ParseProjectResult) {
  if (!r.ok) throw new Error(`失敗: ${r.kind} ${r.path} ${r.reason}`);
  return r;
}

describe('geo フィルタと新しい view の項目の往復（FR-PJ-01、FR-MP-04）', () => {
  it('FR-MP-04: geo フィルタを保存して読み直すと同じで、フィルタの警告も無い', () => {
    const r = ok(parseProject(serializeProject(parts, AT)));
    expect(r.value.view.filter).toEqual(geoFilter);
    expect(r.value.formatVersion).toBe(3);
    // 試験用のデータは、緯度の列を持たない人物（p6）をわざと含むので、データの警告は除いて見る。
    expect(r.warnings.filter((w) => w.source !== 'dataset')).toEqual([]);
  });
  it('FR-PJ-01: geoSource、map、mainView が往復し、無ければ持たない', () => {
    const map: MapViewSettings = {
      ...DEFAULT_MAP_VIEW,
      background: 'simple',
      viewport: { lon: 10, lat: 20, zoom: 4 },
      edgeShape: 'arc',
      direction: 'gradient',
      labels: 'all',
      bundling: { ...DEFAULT_MAP_VIEW.bundling, iterations: 75, epsilonRatio: 0.03 },
    };
    const full: ProjectParts = {
      ...parts,
      view: {
        ...parts.view,
        geoSource: { kind: 'attrs', lat: 'lat', lon: 'lon' },
        map,
        workspace: { ...DEFAULT_WORKSPACE, mainView: 'map' },
      },
    };
    const r = ok(parseProject(serializeProject(full, AT)));
    expect(r.value.view.geoSource).toEqual({ kind: 'attrs', lat: 'lat', lon: 'lon' });
    expect(r.value.view.map).toEqual(map);
    expect(r.value.view.workspace?.mainView).toBe('map');
    const plain = ok(parseProject(serializeProject(parts, AT)));
    expect(plain.value.view.geoSource).toBeUndefined();
    expect(plain.value.view.map).toBeUndefined();
  });
  it('FR-PJ-01: 壊れた geoSource と map は、警告にして落とす（ファイルは開く。D-24）', () => {
    const o = obj(serializeProject(parts, AT));
    const view = o.view;
    if (!isPlainObject(view)) throw new Error('view');
    view.geoSource = { kind: 'attrs' };
    view.map = 5;
    const r = ok(parseProject(JSON.stringify(o)));
    expect(r.value.view.geoSource).toBeUndefined();
    expect(r.value.view.map).toBeUndefined();
    expect(r.warnings).toEqual(
      expect.arrayContaining([
        { source: 'project', issue: { kind: 'unknown-field', path: 'view.geoSource' } },
        { source: 'project', issue: { kind: 'unknown-field', path: 'view.map' } },
      ]),
    );
  });
  it('FR-PJ-01: 南北が逆転した geo フィルタのファイルは、filter の壊れとして拒む', () => {
    const o = obj(serializeProject(parts, AT));
    const view = o.view;
    if (!isPlainObject(view) || !isPlainObject(view.filter) || !Array.isArray(view.filter.filters))
      throw new Error('filter');
    const f: unknown = view.filter.filters[0];
    if (!isPlainObject(f) || !isPlainObject(f.bbox)) throw new Error('bbox');
    f.bbox.south = 0;
    f.bbox.north = -5;
    const r = parseProject(JSON.stringify(o));
    expect(r).toMatchObject({
      ok: false,
      kind: 'broken',
      path: 'view.filter.filters[0].bbox.north',
    });
  });
});

describe('版 3 への移行の連鎖（D-59、FR-PJ-03）', () => {
  it('FR-PJ-03: 移行関数は版だけを上げ、他は変えない。壊れた入力は返す', () => {
    expect(migrateV2ToV3({ formatVersion: 2, keep: [1], view: { x: 1 } })).toEqual({
      formatVersion: 3,
      keep: [1],
      view: { x: 1 },
    });
    expect(migrateV2ToV3(5)).toBe(5);
    expect(migrateV2ToV3(null)).toBeNull();
  });
  it('FR-PJ-03: 版 1（v0.1 の写し）が 1 → 2 → 3 の連鎖で、警告なしで開ける', () => {
    expect(obj(sampleV1).formatVersion).toBe(1);
    const r = ok(parseProject(sampleV1));
    expect(r.value.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(r.warnings).toEqual([]);
  });
  it('FR-PJ-03: 版 2 の公開サンプルが 2 → 3 で、警告なしで開ける', () => {
    expect(obj(sampleV2).formatVersion).toBe(2);
    const r = ok(parseProject(sampleV2));
    expect(r.value.formatVersion).toBe(3);
    expect(r.value.dataset.nodes.length).toBeGreaterThan(0);
    expect(r.warnings).toEqual([]);
    // 版 3 の新しい項目は持たない（読む側が既定を使う）
    expect(r.value.view.geoSource).toBeUndefined();
    expect(r.value.view.map).toBeUndefined();
  });
  it('FR-PJ-03: E2E の写し（版 1）が開け、保存し直すと版 3 で内容が変わらない', () => {
    for (const text of [e2eMaghrib, e2eFiltered, e2eWarnings]) {
      const r = ok(parseProject(text));
      expect(r.value.formatVersion).toBe(3);
      const again = ok(parseProject(serializeProject(r.value, AT)));
      expect(again.value.dataset).toEqual(r.value.dataset);
      expect(again.value.view).toEqual(r.value.view);
    }
  });
  it('FR-PJ-03: 版 4 以上は、新しい版として拒む', () => {
    for (const v of [4, 99]) {
      const r = parseProject(
        JSON.stringify({ ...obj(serializeProject(parts, AT)), formatVersion: v }),
      );
      expect(r).toMatchObject({ ok: false, kind: 'newer-version', fileVersion: v });
    }
  });
});

describe('タイルの URL の鍵の除去（D-52、NFR-02）', () => {
  const tiles = (url: string): MapViewSettings => ({
    ...DEFAULT_MAP_VIEW,
    background: 'custom',
    customTiles: { url, attribution: 'attr' },
  });
  const base = 'https://tiles.example.org/{z}/{x}/{y}.png';

  it('NFR-02: 保存した文字列に鍵が残らず、除いた項目名を返す', () => {
    const r = serializeProjectWithReport(withMap(tiles(`${base}?style=a&api_key=SECRET123`)), AT);
    expect(r.strippedKeys).toEqual(['api_key']);
    expect(r.text).not.toContain('SECRET123');
    // 名前だけは removedParams に残る（値は残らない）
    expect(r.text).toContain('removedParams');
    const back = ok(parseProject(r.text));
    expect(back.value.view.map?.customTiles.url).toBe(`${base}?style=a`);
  });
  it('NFR-02: serializeProject（文字列だけ返す版）も鍵を除く', () => {
    const text = serializeProject(withMap(tiles(`${base}?access_token=TOK`)), AT);
    expect(text).not.toContain('TOK');
    expect(ok(parseProject(text)).value.view.map?.customTiles.url).toBe(base);
  });
  it('NFR-02: 除いた項目名を customTiles.removedParams に名前だけ残し、値は残さない', () => {
    const r = serializeProjectWithReport(withMap(tiles(`${base}?style=a&access_token=SECRET`)), AT);
    const back = ok(parseProject(r.text));
    expect(back.value.view.map?.customTiles.removedParams).toEqual(['access_token']);
    expect(r.text).not.toContain('SECRET');
    // 再保存しても、名前は残り、重複しない
    const again = serializeProjectWithReport(back.value, AT);
    expect(ok(parseProject(again.text)).value.view.map?.customTiles.removedParams).toEqual([
      'access_token',
    ]);
    expect(again.strippedKeys).toEqual([]);
  });
  it('NFR-02: フラグメント（#以降）と署名の項目、; 区切りの鍵も、保存の文字列に残らない', () => {
    for (const q of [
      `${base}#access_token=SECRET`,
      `${base}?X-Amz-Signature=SECRET&X-Amz-Credential=SECRET`,
      `${base}?style=a;key=SECRET`,
      `${base}?key[]=SECRET`,
    ]) {
      const text = serializeProject(withMap(tiles(q)), AT);
      expect(text).not.toContain('SECRET');
      expect(ok(parseProject(text)).value.view.map?.customTiles.url).toMatch(/^https:\/\/tiles/);
    }
  });
  it('NFR-02: 使えない URL（資格情報つき、http、雛形なし）は、保存で空にして知らせる', () => {
    for (const u of [
      'https://user:SECRET@tiles.example.org/{z}/{x}/{y}.png',
      'http://tiles.example.org/{z}/{x}/{y}.png',
      'https://tiles.example.org/tile.png',
    ]) {
      const r = serializeProjectWithReport(withMap(tiles(u)), AT);
      expect(r.tileUrlDropped).toBe(true);
      expect(r.text).not.toContain('SECRET');
      expect(ok(parseProject(r.text)).value.view.map?.customTiles.url).toBe('');
    }
    expect(serializeProjectWithReport(withMap(tiles('')), AT).tileUrlDropped).toBe(false);
    expect(serializeProjectWithReport(withMap(tiles(base)), AT).tileUrlDropped).toBe(false);
  });
  it('FR-MP-01: 読み込みで使えないタイルの URL を空にしたら、警告にする（D-24）', () => {
    const o = obj(serializeProject(withMap(tiles(base)), AT));
    const view = o.view;
    if (!isPlainObject(view) || !isPlainObject(view.map) || !isPlainObject(view.map.customTiles))
      throw new Error('map');
    view.map.customTiles.url = 'http://tiles.example.org/{z}/{x}/{y}.png';
    const r = ok(parseProject(JSON.stringify(o)));
    expect(r.value.view.map?.customTiles.url).toBe('');
    expect(r.warnings).toContainEqual({
      source: 'project',
      issue: { kind: 'unknown-field', path: 'view.map.customTiles.url' },
    });
  });
  it('FR-VG-13: 壊れた view.graph.bundling を落としたら、警告にする（図は開く。D-24）', () => {
    const o = obj(
      serializeProject({ ...parts, view: { ...parts.view, graph: DEFAULT_GRAPH_VIEW } }, AT),
    );
    const view = o.view;
    if (!isPlainObject(view) || !isPlainObject(view.graph)) throw new Error('graph');
    view.graph.bundling = 5;
    const r = ok(parseProject(JSON.stringify(o)));
    expect(r.value.view.graph?.bundling).toBeUndefined();
    expect(r.warnings).toContainEqual({
      source: 'project',
      issue: { kind: 'unknown-field', path: 'view.graph.bundling' },
    });
    // 正しい bundling は警告なし
    view.graph.bundling = { enabled: true, strength: 0.3, style: 'bands' };
    expect(
      ok(parseProject(JSON.stringify(o))).warnings.filter((w) => w.source === 'project'),
    ).toEqual([]);
  });
  it('NFR-02: = の無い項目（値そのものの鍵）は、名前を removedParams に残さない', () => {
    const r = serializeProjectWithReport(withMap(tiles(`${base}?pk.eyJ1secretkey`)), AT);
    expect(r.text).not.toContain('eyJ1');
    expect(ok(parseProject(r.text)).value.view.map?.customTiles.removedParams).toEqual([
      '(valueless)',
    ]);
  });
  it('NFR-02: removedParams は今回除いたものに置き換わり、URL が空なら保存しない（上限 20 件）', () => {
    const withParams = (url: string, removedParams: string[]): ProjectParts =>
      withMap({ ...tiles(url), customTiles: { url, attribution: '', removedParams } });
    // 今回除いたものが無ければ、読み込んだ一覧を残す
    const keep = serializeProject(withParams(base, ['key']), AT);
    expect(ok(parseProject(keep)).value.view.map?.customTiles.removedParams).toEqual(['key']);
    // 今回除いたものがあれば、前の名前と合わせず置き換える
    const replaced = serializeProject(withParams(`${base}?token=T`, ['key']), AT);
    expect(ok(parseProject(replaced)).value.view.map?.customTiles.removedParams).toEqual(['token']);
    // URL が空なら保存しない
    const empty = serializeProject(withParams('', ['key']), AT);
    expect(ok(parseProject(empty)).value.view.map?.customTiles.removedParams).toBeUndefined();
    // 上限
    const many = Array.from({ length: 30 }, (_, i) => `k${String(i)}`);
    const capped = serializeProject(withParams(base, many), AT);
    expect(ok(parseProject(capped)).value.view.map?.customTiles.removedParams).toHaveLength(20);
  });
  it('NFR-02: ; 区切りの正当な値は、鍵を外しても壊れない', () => {
    const text = serializeProject(withMap(tiles(`${base}?layers=a;b&key=X`)), AT);
    expect(ok(parseProject(text)).value.view.map?.customTiles.url).toBe(`${base}?layers=a;b`);
  });
  it('NFR-02: 入力は書き換えず、鍵が無ければ除いた名前は空', () => {
    const p = withMap(tiles(`${base}?key=K`));
    serializeProject(p, AT);
    expect(p.view.map?.customTiles.url).toBe(`${base}?key=K`);
    expect(serializeProjectWithReport(withMap(tiles(base)), AT).strippedKeys).toEqual([]);
    expect(serializeProjectWithReport(parts, AT).strippedKeys).toEqual([]);
  });
});
