import { describe, expect, it } from 'vitest';
import { checkDataset, isPlainObject, toNodeId, type Dataset } from '../../core/model';
import { DEFAULT_FILTER_STATE, toFilterId, type FilterState } from '../../core/filter';
import { cleanDataset, cleanFilter, sampleSettings } from './fixtures/projectFixture';
import { applyFilters } from '../../core/filter';
import { CURRENT_FORMAT_VERSION } from '../../core/project';
import sampleV1 from '../../../tests/fixtures/io/project/v1/maghrib-v0.1.relata.json?raw';
import {
  MIGRATIONS,
  migrateV1ToV2,
  parseImportSettings,
  parseProject,
  serializeProject,
  type Migrations,
} from './project';
import { DEFAULT_IMPORT_SETTINGS, PROJECT_VIEW_KEYS, type ProjectParts } from './types';

import {
  DEFAULT_GRAPH_VIEW,
  DEFAULT_TABLE_VIEW,
  DEFAULT_TIMELINE,
  DEFAULT_WORKSPACE,
  type TableViewSettings,
  type TimelineSettings,
  type WorkspaceSettings,
} from '../../core/project';

const AT = '2026-11-18T00:00:00Z';
const parts: ProjectParts = {
  dataset: cleanDataset(),
  importSettings: sampleSettings,
  view: { filter: cleanFilter },
};

// JSON の文字列を、plain object として読む（失敗なら例外。`as` は使わず isPlainObject で絞る）。
function obj(text: string): Record<string, unknown> {
  const x: unknown = JSON.parse(text);
  if (!isPlainObject(x)) throw new Error('オブジェクトではない');
  return x;
}
// 入れ子のオブジェクトを取り出す。
function sub(o: Record<string, unknown>, key: string): Record<string, unknown> {
  const x = o[key];
  if (!isPlainObject(x)) throw new Error(`${key} がオブジェクトではない`);
  return x;
}
// 保存した JSON を書き換えて、文字列に戻す。
function mutated(fn: (o: Record<string, unknown>) => void, p: ProjectParts = parts): string {
  const o = obj(serializeProject(p, AT));
  fn(o);
  return JSON.stringify(o);
}
// 失敗の結果から、種類と path を取り出す（成功なら例外）。
function failed(
  text: string,
  migrations?: Migrations,
  version?: number,
): { kind: string; path: string } {
  const r = parseProject(text, migrations, version);
  if (r.ok) throw new Error('失敗するはずが成功した');
  return { kind: r.kind, path: r.path };
}
function ok(text: string, migrations?: Migrations, version?: number) {
  const r = parseProject(text, migrations, version);
  if (!r.ok) throw new Error(`${r.kind} ${r.path} ${r.reason}`);
  return r;
}

describe('プロジェクトの往復', () => {
  it('FR-PJ-01（データとフィルタ）: 保存して読み込み直すと元に戻り、警告は無い', () => {
    // 前提: 元のデータが問題を持たない
    expect(checkDataset(parts.dataset)).toEqual([]);
    const r = ok(serializeProject(parts, AT));
    expect(r.value.dataset).toEqual(parts.dataset);
    expect(r.value.importSettings).toEqual(sampleSettings);
    expect(r.value.view.filter).toEqual(cleanFilter);
    expect(r.value.savedAt).toBe(AT);
    expect(r.value.formatVersion).toBe(2);
    expect(r.warnings).toEqual([]);
    const node = r.value.dataset.nodes[0];
    expect(node && Object.hasOwn(node.attrs, '__proto__')).toBe(true);
    // 再保存して読み直しても同じ値（項目の並び順は問わない）
    expect(ok(serializeProject(r.value, AT)).value).toEqual(r.value);
  });
  it('FR-PJ-01: ProjectView のすべてのキーが保存され、読み込み後も残る', () => {
    const full = {
      ...parts,
      view: {
        ...parts.view,
        graph: DEFAULT_GRAPH_VIEW,
        table: DEFAULT_TABLE_VIEW,
        workspace: DEFAULT_WORKSPACE,
        display: { calendar: 'hijri' as const },
        timeline: DEFAULT_TIMELINE,
      },
    };
    const saved = sub(obj(serializeProject(full, AT)), 'view');
    const loaded = ok(serializeProject(full, AT)).value.view;
    for (const key of PROJECT_VIEW_KEYS) {
      expect(Object.hasOwn(saved, key)).toBe(true);
      expect(Object.hasOwn(loaded, key)).toBe(true);
    }
  });
  it('FR-TB-01: 表の設定と下の段が往復し、無い項目は持たない（D-44）', () => {
    const table: TableViewSettings = {
      target: 'edge',
      node: { sort: { column: 'label', direction: 'desc' }, columns: ['label', 'id'] },
      edge: { sort: null, columns: [] },
    };
    const workspace: WorkspaceSettings = { tab: 'table', open: true, height: 420 };
    const r = ok(serializeProject({ ...parts, view: { ...parts.view, table, workspace } }, AT));
    expect(r.value.view.table).toEqual(table);
    expect(r.value.view.workspace).toEqual(workspace);
    expect(r.warnings).toEqual([]);
    // 既定の補いは読み込み側でなく、項目が無いまま（読む側のストアが既定を使う）。
    const plain = ok(serializeProject(parts, AT));
    expect(plain.value.view.table).toBeUndefined();
    expect(plain.value.view.workspace).toBeUndefined();
  });
  it('FR-TM-01: 年表の設定が往復し、無ければ持たない。壊れた項目は既定で補う（D-24）', () => {
    const timeline: TimelineSettings = {
      target: 'edge',
      width: 25,
      node: { kind: 'attr', attr: 'Year (AH)' },
      edge: { kind: 'span' },
    };
    const r = ok(serializeProject({ ...parts, view: { ...parts.view, timeline } }, AT));
    expect(r.value.view.timeline).toEqual(timeline);
    expect(r.warnings).toEqual([]);
    expect(ok(serializeProject(parts, AT)).value.view.timeline).toBeUndefined();
    const file = obj(serializeProject(parts, AT));
    const broken = ok(
      JSON.stringify({
        ...file,
        view: { ...sub(file, 'view'), timeline: { target: 'x', width: 7, node: { kind: 'attr' } } },
      }),
    );
    expect(broken.value.view.timeline).toEqual(DEFAULT_TIMELINE);
    const nul = ok(JSON.stringify({ ...file, view: { ...sub(file, 'view'), timeline: null } }));
    expect(nul.value.view.timeline).toBeUndefined();
    expect(nul.warnings).toEqual([
      { source: 'project', issue: { kind: 'unknown-field', path: 'view.timeline' } },
    ]);
  });
  it('FR-UI-02: 下の段の設定の壊れた項目は既定で補い、範囲外の高さは収める', () => {
    const text = serializeProject(parts, AT);
    const file = obj(text);
    const broken = {
      ...file,
      view: {
        ...sub(file, 'view'),
        workspace: { tab: 'no-such-tab', open: 'yes', height: 99999 },
        table: {
          target: 'x',
          node: { sort: { column: '', direction: 'up' }, columns: [1, 'a', 'a'] },
        },
      },
    };
    const r = ok(JSON.stringify(broken));
    expect(r.value.view.workspace).toEqual({ ...DEFAULT_WORKSPACE, height: 800 });
    expect(r.value.view.table?.target).toBe('node');
    expect(r.value.view.table?.node).toEqual({ sort: null, columns: ['a'] });
    expect(r.value.view.table?.edge).toEqual(DEFAULT_TABLE_VIEW.edge);
    expect(r.warnings).toEqual([]);
  });
  it('FR-UI-02: table と workspace が null でもファイルは開け、既定で補って警告で返す', () => {
    const file = obj(serializeProject(parts, AT));
    const text = JSON.stringify({
      ...file,
      view: { ...sub(file, 'view'), table: null, workspace: null },
    });
    const r = ok(text);
    expect(r.value.view.table).toBeUndefined();
    expect(r.value.view.workspace).toBeUndefined();
    expect(
      r.warnings
        .filter((w) => w.source === 'project')
        .map((w) => (w.issue as { path: string }).path),
    ).toEqual(['view.table', 'view.workspace']);
  });
  it('FR-PJ-01: 問題のあるデータも、往復で変わらず、警告で返る', () => {
    const base = cleanDataset();
    const bad: Dataset = {
      ...base,
      edges: base.edges.map((e, i) => (i === 0 ? { ...e, target: toNodeId('ghost') } : e)),
    };
    const r = ok(serializeProject({ ...parts, dataset: bad }, AT));
    expect(r.value.dataset).toEqual(bad);
    expect(
      r.warnings.some((w) => w.source === 'dataset' && w.issue.code === 'edge-dangling-endpoint'),
    ).toBe(true);
  });
});

describe('プロジェクトの読み込みの失敗', () => {
  it('FR-IN-08: JSON でない', () => {
    expect(failed('{oops').kind).toBe('not-json');
  });
  it('FR-IN-08: app が違う、または JSON が配列', () => {
    for (const t of ['{"app":"Other","formatVersion":1}', '[]', '{}']) {
      expect(failed(t).kind).toBe('not-relata');
    }
  });
  it('FR-IN-08: app が Relata で版が不正なら broken（path formatVersion）', () => {
    for (const v of ['"1"', '1.5', '-1', 'null']) {
      expect(failed(`{"app":"Relata","formatVersion":${v}}`)).toEqual({
        kind: 'broken',
        path: 'formatVersion',
      });
    }
    expect(failed('{"app":"Relata"}')).toEqual({ kind: 'broken', path: 'formatVersion' });
  });
  it('FR-PJ-03: 新しい版は読まずに断る', () => {
    const r = parseProject('{"app":"Relata","formatVersion":3,"dataset":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('newer-version');
      expect(r.fileVersion).toBe(3);
    }
  });
  it('FR-PJ-01: 壊れた dataset は path を返す', () => {
    const t = mutated((o) => {
      const nodes = sub(o, 'dataset').nodes;
      if (!Array.isArray(nodes)) throw new Error('nodes');
      nodes[1] = 5;
    });
    expect(failed(t)).toEqual({ kind: 'broken', path: 'dataset.nodes[1]' });
  });
  it('FR-PJ-01: 壊れた filter は path を返す', () => {
    const t = mutated((o) => {
      sub(o, 'view').filter = { filters: 3 };
    });
    expect(failed(t)).toEqual({ kind: 'broken', path: 'view.filter.filters' });
  });
  it('FR-PJ-01: view が配列なら broken', () => {
    expect(failed(mutated((o) => (o.view = [])))).toEqual({ kind: 'broken', path: 'view' });
  });
  it('FR-IN-07: 壊れた importSettings は path を返す', () => {
    const t = mutated((o) => {
      o.importSettings = { missingTokens: [{ token: '□', reason: 'nope' }] };
    });
    expect(failed(t).path).toBe('importSettings.missingTokens[0].reason');
  });
  it('FR-IN-07: 書式文字だけの記号と、整えると同じ記号の重複は broken', () => {
    const t1 = mutated((o) => {
      o.importSettings = { missingTokens: [{ token: '‏ ​', reason: 'lost' }] };
    });
    expect(failed(t1)).toEqual({
      kind: 'broken',
      path: 'importSettings.missingTokens[0].token',
    });
    const t2 = mutated((o) => {
      o.importSettings = {
        missingTokens: [
          { token: '□', reason: 'lost' },
          { token: '‏□ ', reason: 'illegible' },
        ],
      };
    });
    expect(failed(t2).path).toBe('importSettings.missingTokens[1].token');
  });
  it('FR-PJ-01: 列の暦の table が node／edge 以外なら broken', () => {
    expect(
      failed(
        mutated((o) => {
          const settings = o.importSettings;
          if (isPlainObject(settings))
            settings.columnCalendars = [{ column: 'x', table: 'both', calendar: 'hijri' }];
        }),
      ).path,
    ).toBe('importSettings.columnCalendars[0].table');
  });
  it('FR-PJ-01: savedAt が文字列でなければ broken', () => {
    expect(failed(mutated((o) => (o.savedAt = 5)))).toEqual({ kind: 'broken', path: 'savedAt' });
  });
});

describe('プロジェクトの読み込みの補完と警告', () => {
  it('FR-PJ-01: 任意の項目が無ければ既定値で補う（importSettings、view）', () => {
    const t = mutated((o) => {
      delete o.importSettings;
      delete o.view;
    });
    const r = ok(t);
    expect(r.value.importSettings).toEqual(DEFAULT_IMPORT_SETTINGS);
    expect(r.value.view).toEqual({ filter: DEFAULT_FILTER_STATE });
    expect(r.warnings).toEqual([]);
  });
  it('FR-PJ-01: view.filter が無くても既定の状態で補う', () => {
    const r = ok(mutated((o) => (o.view = {})));
    expect(r.value.view.filter).toEqual(DEFAULT_FILTER_STATE);
  });
  it('FR-VG-02: view.graph の columnOrder と geoAttrs は既知の項目で、警告なしに往復する', () => {
    const r = ok(
      mutated((o) => {
        sub(o, 'view').graph = {
          layout: 'geo',
          columnOrder: ['org', 'person'],
          geoAttrs: { lat: 'Lat' },
        };
      }),
    );
    expect(r.warnings).toEqual([]);
    expect(r.value.view.graph?.columnOrder).toEqual(['org', 'person']);
    expect(r.value.view.graph?.geoAttrs).toEqual({ lat: 'Lat' });
  });
  it('FR-PJ-01: savedAt が無ければ結果にも持たない（空文字で補わない）', () => {
    const r = ok(mutated((o) => delete o.savedAt));
    expect(Object.hasOwn(r.value, 'savedAt')).toBe(false);
  });
  it('FR-PJ-01: 未知の項目は落とし、警告で返す（最上位と view）', () => {
    const t = mutated((o) => {
      o.future = 1;
      sub(o, 'view').layout = {};
    });
    const r = ok(t);
    expect(Object.hasOwn(r.value, 'future')).toBe(false);
    expect(Object.hasOwn(r.value.view, 'layout')).toBe(false);
    expect(r.warnings).toEqual([
      { source: 'project', issue: { kind: 'unknown-field', path: 'future' } },
      { source: 'project', issue: { kind: 'unknown-field', path: 'view.layout' } },
    ]);
  });
  it('FR-DM-01: JSON の中の __proto__ は prototype を汚さず、落として警告にする', () => {
    const text = serializeProject(parts, AT).replace(
      '"app":"Relata"',
      '"app":"Relata","__proto__":{"polluted":true}',
    );
    const r = ok(text);
    expect(Object.hasOwn(r.value, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(r.value)).toBe(Object.prototype);
    expect('polluted' in r.value).toBe(false);
    expect(r.warnings).toContainEqual({
      source: 'project',
      issue: { kind: 'unknown-field', path: '__proto__' },
    });
  });
  it('FR-FL-08: checkFilterState の問題が警告で返る', () => {
    const bad: FilterState = {
      ...DEFAULT_FILTER_STATE,
      filters: [
        { id: toFilterId('z'), kind: 'range', target: 'node', attr: 'nope', missing: 'include' },
      ],
    };
    const r = ok(serializeProject({ ...parts, view: { filter: bad } }, AT));
    expect(r.warnings.some((w) => w.source === 'filter' && w.issue.kind === 'unknown-attr')).toBe(
      true,
    );
  });
});

describe('版の移行', () => {
  // 架空の版 0: dataset が data という名前だった
  const v0 = (): string =>
    mutated((o) => {
      o.formatVersion = 0;
      o.data = o.dataset;
      delete o.dataset;
    });
  const m0: Migrations[number] = (old) => {
    if (!isPlainObject(old)) throw new Error('オブジェクトではない');
    const { data, ...rest } = old;
    return { ...rest, dataset: data, formatVersion: 1 };
  };
  it('FR-PJ-03: 移行を当てて読める', () => {
    expect(ok(v0(), { 0: m0 }, 1).value.dataset).toEqual(parts.dataset);
  });
  it('FR-PJ-03: 多段の移行（0 → 1 → 2）が順に当たる', () => {
    const order: number[] = [];
    // 架空の版 1 → 2: view.filter を view.filters に改名していた、という想定。ここでは印だけ付ける。
    const m1: Migrations[number] = (old) => {
      order.push(1);
      if (!isPlainObject(old)) throw new Error('オブジェクトではない');
      return { ...old, formatVersion: 2 };
    };
    const m0b: Migrations[number] = (old) => {
      order.push(0);
      return m0(old);
    };
    const r = ok(v0(), { 0: m0b, 1: m1 }, 2);
    expect(order).toEqual([0, 1]);
    expect(r.value.formatVersion).toBe(2);
    expect(r.value.dataset).toEqual(parts.dataset);
  });
  it('FR-PJ-03: 移行が無い古い版は断る', () => {
    expect(failed(v0(), {}, 1).kind).toBe('missing-migration');
  });
  it('FR-PJ-03: 移行が例外を投げても例外にならない', () => {
    const boom: Migrations = {
      0: () => {
        throw new Error('boom');
      },
    };
    expect(failed(v0(), boom, 1).kind).toBe('migration-failed');
  });
  it('FR-PJ-03: 移行の結果が版を上げていない、またはオブジェクトでなければ失敗', () => {
    expect(failed(v0(), { 0: (old) => old }, 1).kind).toBe('migration-failed');
    expect(failed(v0(), { 0: () => 5 }, 1).kind).toBe('migration-failed');
  });
});

describe('版 1 → 2 の移行（D-36）', () => {
  // 版 1 のファイルを作る: 版を 1 に戻し、時間フィルタの source を消す。
  const asV1 = (): string =>
    mutated((o) => {
      o.formatVersion = 1;
      const filters = sub(sub(o, 'view'), 'filter').filters;
      if (!Array.isArray(filters)) throw new Error('filters');
      for (const f of filters) if (isPlainObject(f)) delete f.source;
    });
  it('FR-PJ-03: 現在の版は 2 で、移行は 1 → 2 だけを持つ', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(2);
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
  });
  it('FR-PJ-03: 移行関数は source の無い時間フィルタにだけ span を補う', () => {
    const out = migrateV1ToV2({
      formatVersion: 1,
      keep: 1,
      view: {
        filter: {
          edgeRule: 'both-ends',
          filters: [
            { kind: 'time', from: 1 },
            { kind: 'time', source: { kind: 'attr', attr: 'd' } },
            { kind: 'text', query: 'x' },
            5,
          ],
        },
      },
    });
    expect(out).toEqual({
      formatVersion: 2,
      keep: 1,
      view: {
        filter: {
          edgeRule: 'both-ends',
          filters: [
            { kind: 'time', from: 1, source: { kind: 'span' } },
            { kind: 'time', source: { kind: 'attr', attr: 'd' } },
            { kind: 'text', query: 'x' },
            5,
          ],
        },
      },
    });
  });
  it('FR-PJ-03: 壊れた形は落とさずそのまま返し、後段の parse が拒む', () => {
    for (const view of [5, { filter: 5 }, { filter: { filters: 'x' } }]) {
      expect(migrateV1ToV2({ formatVersion: 1, view })).toEqual({ formatVersion: 2, view });
    }
    // オブジェクトでない入力は、例外にせずそのまま返す
    expect(migrateV1ToV2(5)).toBe(5);
    expect(migrateV1ToV2(null)).toBeNull();
    expect(
      failed(
        JSON.stringify({ ...obj(serializeProject(parts, AT)), formatVersion: 1 }),
        { 1: () => 5 },
        2,
      ).kind,
    ).toBe('migration-failed');
    const t = mutated((o) => {
      o.formatVersion = 1;
      sub(o, 'view').filter = { filters: 'x' };
    });
    expect(failed(t).kind).toBe('broken');
  });
  it('FR-PJ-03: 時間フィルタ付きの版 1 が source: span で読め、同じ絞り込み結果になる', () => {
    const r = ok(asV1());
    expect(r.value.formatVersion).toBe(2);
    expect(r.value.view.filter).toEqual(cleanFilter);
    const time = r.value.view.filter.filters.find((f) => f.kind === 'time');
    expect(time?.kind === 'time' && time.source).toEqual({ kind: 'span' });
    const a = applyFilters(r.value.dataset, r.value.view.filter);
    const b = applyFilters(parts.dataset, cleanFilter);
    expect([...a.nodeIds]).toEqual([...b.nodeIds]);
    expect([...a.edgeIds]).toEqual([...b.edgeIds]);
  });
  it('FR-PJ-03: v0.1 の公開サンプル（版 1 の写し）が警告なしで読め、版 2 になる', () => {
    expect(obj(sampleV1).formatVersion).toBe(1);
    const r = ok(sampleV1);
    expect(r.value.formatVersion).toBe(2);
    expect(r.value.dataset.nodes).toHaveLength(219);
    expect(r.warnings).toEqual([]);
  });
  it('FR-PJ-03: 版 2 で保存し、版 2 として読み直せる。版 3 以上は新しい版として拒む', () => {
    const saved = serializeProject(parts, AT);
    expect(obj(saved).formatVersion).toBe(2);
    expect(ok(saved).value.view.filter).toEqual(cleanFilter);
    for (const v of [3, 4, 999]) {
      const r = parseProject(JSON.stringify({ ...obj(saved), formatVersion: v }));
      expect(!r.ok && r.kind).toBe('newer-version');
    }
  });
  it('FR-PJ-03: 版 1 を読んで保存し直すと版 2 になり、内容は変わらない', () => {
    const r = ok(sampleV1);
    const again = ok(serializeProject(r.value, AT));
    expect(again.value.dataset).toEqual(r.value.dataset);
    expect(again.value.view).toEqual(r.value.view);
    expect(again.value.formatVersion).toBe(2);
  });
});

describe('値の末尾の ? を可能性ありと読む列の設定（D-37）', () => {
  it('FR-DM-06: possibleSuffixColumns は保存して読み直すと戻り、無ければ持たない', () => {
    const settings = {
      ...sampleSettings,
      possibleSuffixColumns: [{ column: 'city', table: 'node' as const }, { column: 'note' }],
    };
    const r = ok(serializeProject({ ...parts, importSettings: settings }, AT));
    expect(r.value.importSettings).toEqual(settings);
    expect(
      Object.hasOwn(ok(serializeProject(parts, AT)).value.importSettings, 'possibleSuffixColumns'),
    ).toBe(false);
  });
  it('FR-DM-06: 壊れた指定は path つきで拒む', () => {
    for (const [bad, path] of [
      [5, 'importSettings.possibleSuffixColumns'],
      [[5], 'importSettings.possibleSuffixColumns[0]'],
      [[{ column: 1 }], 'importSettings.possibleSuffixColumns[0].column'],
      [[{ column: 'a', table: 'x' }], 'importSettings.possibleSuffixColumns[0].table'],
    ] as const) {
      const r = parseImportSettings({ possibleSuffixColumns: bad });
      expect(!r.ok && r.path).toBe(path);
    }
  });
});

describe('FR-TM-09: 表示する暦（view.display.calendar、R-24、D-45）', () => {
  const withDisplay = (calendar: unknown): string =>
    mutated((o) => {
      sub(o, 'view').display = { calendar };
    });
  it('FR-TM-09: 保存して読み直すと暦が戻る（版は 2 のまま）', () => {
    for (const calendar of ['gregorian', 'hijri', 'both'] as const) {
      const text = serializeProject(
        { ...parts, view: { ...parts.view, display: { calendar } } },
        AT,
      );
      expect(obj(text).formatVersion).toBe(CURRENT_FORMAT_VERSION);
      const r = parseProject(text);
      expect(r.ok && r.value.view.display).toEqual({ calendar });
    }
  });
  it('FR-TM-09: display が無ければ持たない（読む側が既定の西暦にする）', () => {
    const r = parseProject(serializeProject(parts, AT));
    expect(r.ok && r.value.view.display).toBeUndefined();
  });
  it('FR-TM-09: 暦の値が不正なら、view.display.calendar の壊れとして拒む', () => {
    const r = parseProject(withDisplay('julian'));
    expect(r).toMatchObject({ ok: false, kind: 'broken', path: 'view.display.calendar' });
  });
  it('FR-TM-09: display が空のオブジェクトなら既定の西暦で補う', () => {
    const r = parseProject(
      mutated((o) => {
        sub(o, 'view').display = {};
      }),
    );
    expect(r.ok && r.value.view.display).toEqual({ calendar: 'gregorian' });
  });
  it('FR-TM-09: display の未知の項目は警告にして落とす', () => {
    const r = parseProject(
      mutated((o) => {
        sub(o, 'view').display = { calendar: 'hijri', zoom: 1 };
      }),
    );
    expect(r.ok && r.warnings).toContainEqual({
      source: 'project',
      issue: { kind: 'unknown-field', path: 'view.display.zoom' },
    });
  });
});
