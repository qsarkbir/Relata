import { describe, expect, it } from 'vitest';
import { checkDataset, isPlainObject, toNodeId, type Dataset } from '../../core/model';
import { DEFAULT_FILTER_STATE, toFilterId, type FilterState } from '../../core/filter';
import { cleanDataset, cleanFilter, sampleSettings } from './fixtures/projectFixture';
import { parseProject, serializeProject, type Migrations } from './project';
import { DEFAULT_IMPORT_SETTINGS, PROJECT_VIEW_KEYS, type ProjectParts } from './types';

import { DEFAULT_GRAPH_VIEW } from '../../core/project';

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
    expect(r.value.formatVersion).toBe(1);
    expect(r.warnings).toEqual([]);
    const node = r.value.dataset.nodes[0];
    expect(node && Object.hasOwn(node.attrs, '__proto__')).toBe(true);
    // 再保存して読み直しても同じ値（項目の並び順は問わない）
    expect(ok(serializeProject(r.value, AT)).value).toEqual(r.value);
  });
  it('FR-PJ-01: ProjectView のすべてのキーが保存され、読み込み後も残る', () => {
    const full = { ...parts, view: { ...parts.view, graph: DEFAULT_GRAPH_VIEW } };
    const saved = sub(obj(serializeProject(full, AT)), 'view');
    const loaded = ok(serializeProject(full, AT)).value.view;
    for (const key of PROJECT_VIEW_KEYS) {
      expect(Object.hasOwn(saved, key)).toBe(true);
      expect(Object.hasOwn(loaded, key)).toBe(true);
    }
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
    const r = parseProject('{"app":"Relata","formatVersion":2,"dataset":{}}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.kind).toBe('newer-version');
      expect(r.fileVersion).toBe(2);
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
    expect(ok(v0(), { 0: m0 }).value.dataset).toEqual(parts.dataset);
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
    expect(failed(v0()).kind).toBe('missing-migration');
  });
  it('FR-PJ-03: 移行が例外を投げても例外にならない', () => {
    const boom: Migrations = {
      0: () => {
        throw new Error('boom');
      },
    };
    expect(failed(v0(), boom).kind).toBe('migration-failed');
  });
  it('FR-PJ-03: 移行の結果が版を上げていない、またはオブジェクトでなければ失敗', () => {
    expect(failed(v0(), { 0: (old) => old }).kind).toBe('migration-failed');
    expect(failed(v0(), { 0: () => 5 }).kind).toBe('migration-failed');
  });
});
